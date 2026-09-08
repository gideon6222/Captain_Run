/* Every number that shapes how the game feels, and the arithmetic derived from
   it. Pure: nothing here reads live state, so each function takes the upgrade
   table and whatever run-scoped value it needs as an argument.

   That shape is deliberate. These are the numbers a balance change moves, and
   a function that reads a module-level `S` and `run` cannot be checked without
   booting the whole game. */

import { clamp } from './util.js';

export const T = {
  /* The road is wider than it looks like it needs to be, and that is the
     point.

     A blade's disc is `bladeR` and the candle's own radius grows past 0.65 on
     a good run, so the pair sweeps about 1.1 units of road. Measured against
     the first version of these numbers - a 1.5 half-band and a 0.62 disc -
     that came to 1.29 of 1.5, so an unsteered forty seconds lost 64 wax to
     blades while keeping 66, and a *steered* run could not do meaningfully
     better because there was nowhere to go. Steering was decoration.

     The band has to stay wider than (bladeR + a fat candle) by enough to drive
     through, or the only real hazard in the game is weather. `blades cannot be
     dodged` in e2e is the standing check on that. */
  roadW: 7.6,
  laneClamp: 2.5,
  baseSpeed: 10.5,
  steerSpeed: 9.5,
  chunk: 12,
  levelChunks: 38,

  /* The candle itself. Wax is measured in `units`; everything the player does
     adds or removes units, and the geometry is derived from the total rather
     than stored, so the silhouette can never disagree with the score. */
  coreWax: 7,          // the bare core you start every run with
  minCore: 3,          // wax below which the core cannot be shaved. Not a
                       // mercy: a candle with no core is not a candle, and
                       // there would be nothing left on screen to steer.
  maxLayers: 9,        // past this a new dip fattens the outer layer instead
  waxPerCoin: 3.4,     // base coin value of one unit of wax

  /* Geometry. Radius grows with the square root of area, so the twentieth unit
     of wax widens the candle far less than the second. That is what stops a
     long clean run from filling the screen, and it is why a *new colour* is
     worth more than more of the same one. */
  coreR: 0.30,
  rPerWax: 0.030,
  coreH: 1.05,
  hPerWax: 0.052,
  stepH: 0.30,         // how much shorter each layer is than the one inside it
  lopPerR: 0.55,       // how far a fully lopsided layer leans, in radii

  /* The wick is the clock. It is not a health bar - nothing in this game can
     kill you - it is the reason to keep moving, and it is the light. */
  wickBase: 52,        // seconds of wick at zero upgrades
  wickBurn: 1.0,       // wick-seconds per second, lit and out of trouble
  heatWick: 1.9,       // extra wick-seconds per second inside a heat lamp
  heatMelt: 3.1,       // wax units per second inside a heat lamp

  bladeR: 0.45,        // the disc's radius, and half of what makes it dodgeable
  bladeShave: 4.6,     // wax a blade takes
  bladeLop: 0.30,      // and how far it knocks the candle out of true
  dripWax: 0.9,        // one wax droplet off the road
  vatWaxBase: 5.0,     // the smaller side of a dip arch
  vatWaxBig: 9.0,      // the larger one

  /* Deliberately far short of half the road.

     At 3.4 - carried over from the previous game, where the steerable band was
     1.5 wide - the magnet reached every droplet on the road from a standing
     start, so a run that never touched the screen collected 114 wax and
     appraised MASTERWORK. A pickup radius wider than the play space is not a
     pickup radius, it is an income. This has to stay well under `laneClamp` or
     droplets stop being a reason to steer. */
  magnetBase: 1.2,

  /* How often each seeded roll comes up. Named and gathered here rather than
     left as bare numbers inside the spawn code, because that is exactly how
     the previous game on this stack ended up with three mechanics whose real
     odds nobody could see. */
  bladeChance: 0.46,
  /* How often a chunk's blade is planted on its droplet line instead of
     somewhere independent.

     Without this the two systems never meet: a scripted run that dodged to
     whichever edge was further from the blade took *zero* damage while
     collecting everything, because the wax and the danger were in unrelated
     places and there was no decision to get wrong. A guarded droplet line is
     the whole risk-reward beat of the runner. */
  guardedDrips: 0.55,
  lampChance: 0.30,
  waterChance: 0.22,
  dripChance: 0.60,
  scentChance: 0.16,
  sceneryChance: 0.58,

  /* Appraisal. Craftsmanship is a *multiplier* on the material value, not a
     bonus added to it. That is the whole reason both axes stay alive: a flat
     bonus is decisive on a small candle and a rounding error on a big one, so
     one of the two things the player is doing would always be the wrong thing
     to think about. As a multiplier, doubling the wax always doubles the
     money, and a well-designed candle is always worth about twice a plain one.

     `par` is what a competent run of a workshop is worth, and grades are cut
     against it scaled by what that workshop *pays* - so a FINE means the same
     standard of candle at the first bench and the ninth.

     660 is measured, not chosen. Three scripted runs of the first workshop
     through the debug seam: never touching the screen scores 353, dodging
     blades scores 610, and dodging blades *and* sweeping every droplet scores
     1046. Those land on PLAIN, GOOD and MASTERWORK respectively, which is the
     spread the grades are for. Set from the first guess of 260 instead, doing
     nothing at all graded FINE and both skilled runs hit the ceiling - a top
     grade every competent run earns is not a grade. Re-measure this number
     whenever wax income moves. */
  layerBonus: 0.16,    // per colour change, as a fraction of material value
  contrastBonus: 0.26, // per adjacent pair that genuinely reads as two colours
  purityFloor: 0.52,   // what a completely lopsided candle keeps
  undelivered: 0.55,   // what the wick running out costs you
  par: 660,

  /* Difficulty and prices both climb with the workshop number. The game is the
     race between those two curves, so these two lines are the whole balance. */
  levelScale: 1.62,
  priceScale: 1.72,
};

export interface Wax {
  n: string;
  col: number;
  hue: number;   // 0..1 around the wheel
  lit: number;   // 0..1 perceptual lightness
  price: number; // multiplier on waxPerCoin
}

/* Six waxes, and the three warm ones sit deliberately close together on the
   hue wheel.

   Stacking amber on tallow on gold-leaf is the expensive-looking mistake:
   every layer is worth a lot per unit and the finished candle scores almost no
   contrast. The cheap green next to the pricey amber beats a second amber -
   and which of the two is better depends on what you are already wearing,
   which is CRAFT.md's "two upside gates beat a good gate and a bad gate"
   expressed in colour rather than in numbers.

   The price spread is deliberately narrow - under 2x from tallow to gold leaf.
   A wide one made material value dominate: gold leaf on amber scored higher
   than any amount of good design, so the arch collapsed back into "take the
   bigger number" and the whole colour system was decoration. Measured, with
   prices up to 2.9x: a warm three-colour candle beat a contrasting one of the
   same size on raw wax alone. */
export const WAXES: Wax[] = [
  { n: 'TALLOW',    col: 0xf0e3c2, hue: 0.11, lit: 0.86, price: 1.00 },
  { n: 'CRIMSON',   col: 0xd6314a, hue: 0.98, lit: 0.45, price: 1.25 },
  { n: 'VERDIGRIS', col: 0x2fb98a, hue: 0.44, lit: 0.56, price: 1.35 },
  { n: 'INDIGO',    col: 0x5350d8, hue: 0.67, lit: 0.44, price: 1.50 },
  { n: 'AMBER',     col: 0xff9d1e, hue: 0.08, lit: 0.63, price: 1.65 },
  { n: 'GOLDLEAF',  col: 0xffd24a, hue: 0.13, lit: 0.79, price: 1.90 },
];

/* Hue distance around the wheel: 0.5 is opposite, 0 is the same colour. */
export function hueGap(a: number, b: number): number {
  const d = Math.abs(a - b) % 1;
  return d > 0.5 ? 1 - d : d;
}

/* Whether two waxes read as two colours on a candle at arm's length.

   Hue distance alone was wrong, and the unit tests caught it before any of
   this was drawn. Cream tallow and crimson are *neighbours* on the wheel -
   0.13 apart - and they are obviously two colours, because one is nearly white
   and the other is not. Lightness is doing the work there, exactly as CRAFT.md
   says: hue alone is not enough separation, especially at phone size.

   Either axis counts, which makes pale tallow genuinely useful as a separator
   between two saturated dips rather than the cheap wax you tolerate - and that
   is how a real layered candle is banded. */
export const reads2 = (a: Wax, b: Wax) =>
  hueGap(a.hue, b.hue) > 0.18 || Math.abs(a.lit - b.lit) > 0.30;

export interface Workshop {
  name: string;
  sky: [string, string];
  fog: number; ground: number; road: number; kerb: number;
  prop: number; prop2: number; rock: number; far: number; dust: number;
  amb: number;        // ambient light: the dark is what justifies the flame
  waxes: number[];    // which waxes this workshop offers at its vats
}

/* Four workshops, and the light falls through them. The Chandlery is a warm
   evening you can see across; the Deep Dark is lit by your candle and nothing
   else. That ramp is progression the player feels without being told, and it
   is why ambient light is a per-workshop number rather than a constant. */
export const WORKSHOPS: Workshop[] = [
  { name: 'THE CHANDLERY', sky: ['#e8a765', '#3b2340'], fog: 0x6a4560, ground: 0x4a3426, road: 0x8a6a4c, kerb: 0x5d452e,
    prop: 0x7a5236, prop2: 0x3d2718, rock: 0x6b5a4a, far: 0x5a3f52, dust: 0xffdba8, amb: 0.42, waxes: [0, 1, 2] },
  { name: 'THE FROSTWORKS', sky: ['#7fb6d8', '#1c2b46'], fog: 0x3f5878, ground: 0xa8bccb, road: 0x8d9dad, kerb: 0x63758a,
    prop: 0x2c5148, prop2: 0x2a3242, rock: 0x8595a4, far: 0x44607f, dust: 0xdff2ff, amb: 0.34, waxes: [0, 2, 3] },
  { name: 'THE EMBERWORKS', sky: ['#c9482a', '#25090e'], fog: 0x5e1d16, ground: 0x3d1d16, road: 0x60392c, kerb: 0x3f2419,
    prop: 0x6d2a17, prop2: 0x2e150d, rock: 0x462824, far: 0x6b2c1c, dust: 0xff9d4a, amb: 0.26, waxes: [1, 4, 5] },
  { name: 'THE DEEP DARK', sky: ['#241241', '#07040f'], fog: 0x140b26, ground: 0x16102a, road: 0x2c2247, kerb: 0x1c1533,
    prop: 0x3b2470, prop2: 0x171029, rock: 0x241a3c, far: 0x2a1a4d, dust: 0xc79bff, amb: 0.15, waxes: [3, 4, 5] },
];

export interface Upgrades {
  core: number; hard: number; wick: number; dye: number;
  scoop: number; hand: number; bees: number; mould: number;
}

/* Scents are the only reward in the game whose value does not decay.

   Coins are a rung: every amount you earn makes the last amount look small, so
   "what have I got" is always a number that will be embarrassing next week. A
   collection is the opposite, and it is the reason to run a workshop you have
   already beaten. Each scent is found once, in the world, behind a trap, and
   never appears in the shop - a reward you can buy on a schedule is a price,
   not a discovery. */
export interface Scent { n: string; ic: string; eff: string; }
export const SCENTS: Scent[] = [
  { n: 'BEESWAX BALM', ic: '\u{1F41D}', eff: 'Blades take 18% less wax' },
  { n: 'PINE RESIN',   ic: '\u{1F332}', eff: 'Droplets carry 15% more wax' },
  { n: 'CLOVE OIL',    ic: '\u{1F330}', eff: 'The wick burns 12% slower' },
  { n: 'MYRRH',        ic: '\u{1F3FA}', eff: 'Every candle appraises 15% higher' },
  { n: 'SEA SALT',     ic: '\u{1F9C2}', eff: 'Water only dims the flame, never snuffs it' },
  { n: 'SMOKE GLASS',  ic: '\u{1FAE7}', eff: 'Heat melts 30% less wax' },
];
export const SCENT_BALM = 0, SCENT_RESIN = 1, SCENT_CLOVE = 2,
             SCENT_MYRRH = 3, SCENT_SALT = 4, SCENT_GLASS = 5;

const has = (scents: number[], id: number) => scents.indexOf(id) >= 0;

// -- derived stats ------------------------------------------------------------

export const scaleFor = (level: number) => Math.pow(T.levelScale, level - 1);
export const priceFor = (level: number) => Math.pow(T.priceScale, level - 1);

export const startWax = (up: Upgrades) => T.coreWax + up.core * 3;

/* Where a hazard or a droplet goes across the road, from a 0..1 hash.

   Everything the player must be able to *reach* or *dodge* has to live inside
   the band a thumb can actually steer across, which is `laneClamp`, not the
   width of the road mesh. Placing to the full road width instead is the same
   class of mistake as a content band that starts below the deepest reachable
   ground: the object is drawn, it is in the level, and it can never once
   interact with the player. Nothing errors and nothing looks missing.

   The road is deliberately wider than the band so the play space has shoulders
   to read against - that is a visual decision, and this function is the seam
   that keeps it from silently becoming a gameplay one. */
export const laneX = (h: number, inset = 0) =>
  clamp((h - 0.5) * 2 * T.laneClamp, -T.laneClamp + inset, T.laneClamp - inset);

export const wickLength = (up: Upgrades, scents: number[]) =>
  T.wickBase * (1 + up.wick * 0.11) * (has(scents, SCENT_CLOVE) ? 1 / 0.88 : 1);

/* Blades and heat are answered by different things on purpose. Hard Wax is
   what you buy when you keep clipping blades; Smoke Glass is *found*, and
   answers a hazard that only gets dangerous a workshop later. */
export const shaveMul = (up: Upgrades, scents: number[]) =>
  Math.pow(0.88, up.hard) * (has(scents, SCENT_BALM) ? 0.82 : 1);

export const meltMul = (up: Upgrades, scents: number[]) =>
  Math.pow(0.92, up.hard) * (has(scents, SCENT_GLASS) ? 0.70 : 1);

export const dripMul = (up: Upgrades, scents: number[]) =>
  (1 + up.scoop * 0.06) * (has(scents, SCENT_RESIN) ? 1.15 : 1);

export const lopMul = (up: Upgrades) => Math.pow(0.86, up.hand);
export const magnetR = (up: Upgrades) => T.magnetBase * (1 + up.scoop * 0.22);
export const valueMul = (up: Upgrades, scents: number[]) =>
  (1 + up.dye * 0.09) * (1 + up.bees * 0.13) * (has(scents, SCENT_MYRRH) ? 1.15 : 1);
export const maxLayers = (up: Upgrades) => T.maxLayers + up.mould;
export const snuffs = (scents: number[]) => !has(scents, SCENT_SALT);

/* Clamped because a workshop's ambient level is a look, not a slider: below
   about 0.10 the toon bands collapse into flat black and the four-step
   gradient map - which is the whole art style - stops being visible at all. */
export const ambientFor = (level: number) =>
  clamp(WORKSHOPS[(level - 1) % WORKSHOPS.length].amb, 0.12, 0.9);
