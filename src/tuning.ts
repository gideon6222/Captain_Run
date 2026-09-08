/* Every number that shapes how the game feels, and the arithmetic derived from
   it. Pure: nothing here reads live state, so each function takes the upgrade
   table and whatever run-scoped value it needs as an argument.

   That shape is deliberate. These are the numbers a balance change moves, and
   a function that reads a module-level `S` and `run` cannot be checked without
   booting the whole game. */

import { clamp } from './util.js';

export const T = {
  roadW: 8.4,
  laneClamp: 3.0,
  baseSpeed: 11.5,
  steerSpeed: 11.0,
  chunk: 12,
  levelChunks: 34,

  /* THE STACK.

     Candles trail the leader along its own recorded path, like a snake, rather
     than clumping around it like a crowd. That is the mechanic the reference
     game is built on, and its strategy guide names the consequence exactly:
     as the stack gets longer you have to start steering *well before* an
     obstacle is in reach, because the back of the line is still going where
     the front went a second ago. Growing the stack is therefore a genuine
     trade - more candles is more money and less agility - rather than a number
     that only ever goes up. */
  startCandles: 6,
  maxCandles: 27,        // what the renderer draws, so the HUD count never lies
  /* Three abreast, in rows that trail the leader.

     Single file was the first attempt and it is unreadable: every candle hides
     behind the one in front, so a tray of twenty-six showed the player one
     candle's worth of colour. Three across shows the banding, reads as a tray
     of goods rather than a queue, and still lags exactly the same way - it is
     the *row* that follows the path, so the back of the tray is still going
     where the front went a second ago. */
  rowWidth: 3,
  rowGap: 0.66,          // lateral spacing within a row
  trailGap: 0.98,        // spacing between rows along the recorded path
  /* The path-history ring buffer, and it is sized against the WORST case, not
     the usual one. At running speed a frame advances ~0.19 units so 4000
     samples remember 760 units, but `push` drops steps under 0.02, so the
     floor is 80 units - still comfortably past the 24 the longest stack asks
     for. Undersized, the tail silently bunches at the oldest sample, which
     looks like the stack collapsing for no reason. Three Float64Arrays at this
     length is 96 KB against a measured 22 MB heap: memory is not a constraint
     on this hardware and should not be treated as one. */
  trailSamples: 4000,

  /* Per-candle geometry. A candle is a stack of dipped colour layers, and its
     radius grows with the square root of accumulated area, so the eighth dip
     widens it far less than the second. Without that a full run ends with tree
     trunks on the tray. */
  /* Tall and narrow, roughly 4:1.

     The bands are horizontal, so height is the axis they are read along, and a
     squat candle hides them: at 1.3 units tall with three bands the camera -
     which looks down the runway from above - saw mostly the top band and the
     whole tray read as one colour. Height is also the only axis that grows
     much with dips, so it is what "more work" looks like from a distance. */
  coreR: 0.26,
  rPerLayer: 0.050,
  coreH: 1.55,
  hPerLayer: 0.16,
  wickH: 0.26,

  /* Stations treat the WHOLE stack at once, so count and quality are
     independent axes: obstacles take candles, stations make each candle worth
     more. Two axes that never interfere is what keeps both readable. */
  maxLayers: 8,

  /* Value. A finished candle is worth its material multiplied by everything
     done to it - multiplied, never added. A flat bonus is decisive on a small
     stack and a rounding error on a big one, so one of the two things the
     player is doing would always be the wrong thing to think about. */
  perCandleBase: 9,
  layerValue: 0.34,      // per wax layer, as a fraction
  contrastValue: 0.30,   // per adjacent pair that reads as two colours
  glitterValue: 0.26,    // per glitter pass
  maxGlitter: 3,

  /* Obstacles take candles off the tail, and they take a lot.

     Measured at 3/2/4: a scripted run that never touched the screen finished
     with fourteen candles and earned three stars, because the gates hand out
     more growth over a level than soft obstacles can claw back. The whole
     spread between never steering and steering well was 1.3x, which means the
     game was not really being played. These numbers are what make the tray
     something you have to protect rather than something that accumulates. */
  barrierTake: 5,
  rollerTake: 3,
  sawTake: 6,

  cashPickup: 120,       // face value of a banknote on the runway, before scale
  magnetBase: 2.0,

  /* How often each seeded roll comes up. Named and gathered here rather than
     left as bare numbers inside the spawn code, because that is exactly how
     the first game on this stack ended up with three mechanics whose real odds
     nobody could see. */
  barrierChance: 0.42,
  rollerChance: 0.30,
  sawChance: 0.22,
  cashChance: 0.58,
  gateChance: 0.72,
  guardedCash: 0.55,     // how often an obstacle is planted on the cash line

  /* Stars are cut against par scaled by what the level pays, so three stars
     means the same standard of work at the first workshop and the ninth.

     Measured, not chosen. Four scripted runs of level 1 with no upgrades -
     never steering, dodging only, dodging and sweeping banknotes, and dodging
     while choosing station halves - and par is set so the best of them lands
     just on three stars. Re-measure whenever obstacle damage, gate rates or
     the craft multipliers move, because all three feed it. */
  par: 9100,

  levelScale: 1.55,      // how much harder each workshop is
  priceScale: 1.70,      // and how much better it pays
};

// -- wax ---------------------------------------------------------------------

export interface Wax {
  n: string;
  col: number;
  hue: number;   // 0..1 around the wheel
  lit: number;   // 0..1 perceptual lightness
  price: number; // multiplier on this layer's contribution
}

/* Candy colours, straight off the reference: saturated cyan, hot pink and a
   sharp yellow against a purple runway.

   The warm ones sit close together on the hue wheel on purpose - stacking them
   is the expensive-looking mistake, and the cheap contrasting dip beats a
   second matching one. Which of the two is better depends on what the stack is
   already wearing, which is what makes a vat a decision rather than a bigger
   number. */
export const WAXES: Wax[] = [
  { n: 'CREAM',     col: 0xfff0d0, hue: 0.11, lit: 0.92, price: 1.00 },
  { n: 'AQUA',      col: 0x4fe3f0, hue: 0.51, lit: 0.78, price: 1.20 },
  { n: 'BUBBLEGUM', col: 0xff4d8d, hue: 0.94, lit: 0.56, price: 1.30 },
  { n: 'SUNBEAM',   col: 0xffd429, hue: 0.14, lit: 0.80, price: 1.35 },
  { n: 'MINT',      col: 0x5ef0a8, hue: 0.41, lit: 0.82, price: 1.45 },
  { n: 'LILAC',     col: 0xb07bff, hue: 0.73, lit: 0.63, price: 1.55 },
];

/* Hue distance around the wheel: 0.5 is opposite, 0 is the same colour. */
export function hueGap(a: number, b: number): number {
  const d = Math.abs(a - b) % 1;
  return d > 0.5 ? 1 - d : d;
}

/* Whether two waxes read as two colours at arm's length.

   Hue distance alone is wrong, and a unit test caught it before any of this
   was drawn: cream and bubblegum are near-neighbours on the wheel and are
   obviously two colours, because one is nearly white. Lightness is doing the
   work there, exactly as CRAFT.md says. Either axis counts, which makes pale
   cream genuinely useful as a separator between two saturated dips rather than
   the cheap wax you tolerate - and that is how a real layered candle is
   banded. */
export const reads2 = (a: Wax, b: Wax) =>
  hueGap(a.hue, b.hue) > 0.18 || Math.abs(a.lit - b.lit) > 0.30;

// -- moulds and wrapping ------------------------------------------------------

/* The press stamps a shape into every candle on the tray. `sides`, `twist` and
   `bulge` drive the actual geometry, so a mould the player unlocked is one
   they can see from across the runway - not a number on a results screen. */
export interface Mould { n: string; sides: number; twist: number; bulge: number; mul: number; }
export const MOULDS: Mould[] = [
  { n: 'PLAIN',  sides: 16, twist: 0.00, bulge: 0.00, mul: 1.00 },
  { n: 'FLUTED', sides: 12, twist: 0.00, bulge: 0.16, mul: 1.35 },
  { n: 'TWIST',  sides: 8,  twist: 1.40, bulge: 0.15, mul: 1.60 },
  { n: 'STAR',   sides: 6,  twist: 0.00, bulge: 0.34, mul: 1.90 },
];

/* Wrapping is the last station and the biggest single multiplier, which is why
   it sits at the end of the runway - where the stack is at its most valuable
   and the obstacles are at their thickest. */
export interface Wrap { n: string; col: number; mul: number; }
export const WRAPS: Wrap[] = [
  { n: 'BARE',   col: 0x000000, mul: 1.00 },
  { n: 'RIBBON', col: 0xff4d8d, mul: 1.45 },
  { n: 'BOXED',  col: 0xffd429, mul: 1.90 },
  { n: 'LUXE',   col: 0x8be0ff, mul: 2.40 },
];

// -- workshops ----------------------------------------------------------------

export interface Workshop {
  name: string;
  sky: [string, string];
  road: number; rail: number; stripe: number;
  prop: number; cloud: number;
  waxes: number[];
}

/* Bright, high-key and saturated, all four of them.

   This is a deliberate reversal of the previous build, which ramped the
   ambient light down per workshop until the candle's own flame was the only
   thing lighting the scene. That was a good technique aimed at the wrong game.
   A factory runway is daylight: the reference is a purple track floating in
   blue sky with hot-pink signage, and it is relentlessly bright. The flame
   survives where it actually earns its place - the gift table at the end,
   where the finished candles are lit one at a time. */
/* The runway is always dark and saturated; the sky is always light. That
   pairing is not decoration, it is the only thing separating the play space
   from the background.

   The second workshop was first written as a pink runway under a pink sky -
   the same hue, a similar lightness - and the track dissolved into the
   backdrop from twenty units out, which is exactly the distance you steer by.
   Change the *lightness* between road and sky, not just the hue, or a themed
   level quietly becomes an unreadable one. */
export const WORKSHOPS: Workshop[] = [
  { name: 'THE WORKSHOP',  sky: ['#3aa8ee', '#bfeaff'], road: 0x5a27ab, rail: 0xf0e4ff, stripe: 0x7440c9,
    prop: 0xff4d8d, cloud: 0xffffff, waxes: [0, 1, 2] },
  { name: 'SUGAR FACTORY', sky: ['#ffc98f', '#fff4e2'], road: 0xb01f68, rail: 0xffe6f2, stripe: 0xd13a83,
    prop: 0x4fe3f0, cloud: 0xffffff, waxes: [0, 3, 1] },
  { name: 'MINT ATELIER',  sky: ['#8fe8ff', '#f0fffb'], road: 0x156b62, rail: 0xdcfff6, stripe: 0x22897d,
    prop: 0xffd429, cloud: 0xffffff, waxes: [4, 1, 2] },
  { name: 'THE BOUTIQUE',  sky: ['#c9a4ff', '#f4ecff'], road: 0x35176e, rail: 0xe8dcff, stripe: 0x4a2496,
    prop: 0xffd429, cloud: 0xffffff, waxes: [5, 2, 3] },
];

/* Rough perceptual lightness of a packed 0xRRGGBB, 0..1. Only used by a test,
   but it lives here so the test is checking the same numbers the game draws. */
export function lightnessOf(col: number): number {
  const r = ((col >> 16) & 255) / 255, g = ((col >> 8) & 255) / 255, b = (col & 255) / 255;
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

export function hexLightness(hex: string): number {
  return lightnessOf(parseInt(hex.replace('#', ''), 16));
}

// -- upgrades and progression -------------------------------------------------

/* Stat upgrades bought between levels, which is how the reference does it -
   its strategy guide's advice is to "spread upgrades evenly and prioritise
   earning power and candle stack growth", so those two are deliberately the
   first rows in the shop. */
export interface Upgrades {
  stack: number;   // candle stack growth
  earn: number;    // earning power
  grip: number;    // how few candles an obstacle takes
  reach: number;   // cash magnet
  press: number;   // best mould unlocked
  wrap: number;    // best wrapping unlocked
  vat: number;     // layers a single vat lays down
  spark: number;   // glitter potency
}

export const DEF_UP: Upgrades = {
  stack: 0, earn: 0, grip: 0, reach: 0, press: 0, wrap: 0, vat: 0, spark: 0,
};

export const scaleFor = (level: number) => Math.pow(T.levelScale, level - 1);
export const priceFor = (level: number) => Math.pow(T.priceScale, level - 1);

export const startCandles = (up: Upgrades) => T.startCandles + up.stack * 2;
export const maxCandles = () => T.maxCandles;

/* Grip reduces how many candles an obstacle knocks off, and it floors at one.
   An obstacle that can cost nothing is scenery. */
export const takeMul = (up: Upgrades) => Math.pow(0.88, up.grip);
export const obstacleTake = (base: number, up: Upgrades) =>
  Math.max(1, Math.round(base * takeMul(up)));

export const earnMul = (up: Upgrades) => 1 + up.earn * 0.14;
export const magnetR = (up: Upgrades) => T.magnetBase * (1 + up.reach * 0.26);
export const vatLayers = (up: Upgrades) => 1 + Math.floor(up.vat / 3);
export const glitterPer = (up: Upgrades) => 1 + Math.floor(up.spark / 3);
/* The press and wrap stations always do *something*, from the first level.

   Starting them at index 0 meant the level-1 press stamped PLAIN onto plain
   candles and printed "ALREADY PLAIN" - a station on the runway, with a sign,
   that was a dead beat until an upgrade was bought several levels later. A
   station the player drives through and gets nothing from teaches them to stop
   reading the signs. So the floor is the first real mould and the first real
   wrapping, and the upgrades climb from there. */
export const bestMould = (up: Upgrades) => clamp(1 + up.press, 1, MOULDS.length - 1);
export const bestWrap = (up: Upgrades) => clamp(1 + up.wrap, 1, WRAPS.length - 1);
export const MAX_PRESS = MOULDS.length - 2;
export const MAX_WRAP = WRAPS.length - 2;

/* Where a hazard, a banknote or a station goes across the runway.

   Everything the player must reach or dodge has to live inside the band a
   thumb can steer across, which is `laneClamp`, not the width of the road
   mesh. Placing to the full road width instead is the same class of mistake as
   a content band below the deepest reachable ground: the object is drawn, it
   is in the level, and it can never once interact with the player. Nothing
   errors and nothing looks missing.

   The runway is deliberately wider than the band so the play space has
   shoulders to read against - that is a visual decision, and this function is
   the seam that stops it silently becoming a gameplay one. */
export const laneX = (h: number, inset = 0) =>
  clamp((h - 0.5) * 2 * T.laneClamp, -T.laneClamp + inset, T.laneClamp - inset);
