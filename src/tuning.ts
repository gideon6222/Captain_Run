/* Every number that shapes how the game feels, and the arithmetic derived from
   it. Pure: nothing here reads live state, so each function takes the upgrade
   table and whatever run-scoped value it needs as an argument.

   `REFERENCE.md` is the observed record of the game this is modelled on. Where
   a number here has a shape rather than a value - the tray lying down, the
   pools being half-width, the shops replacing stat upgrades - that file says
   why. */

import { clamp } from './util.js';

export const T = {
  roadW: 8.4,
  laneClamp: 3.0,
  baseSpeed: 11.5,
  steerSpeed: 11.0,
  chunk: 12,
  levelChunks: 34,

  /* THE TRAY, and it LIES DOWN.

     The reference's player object is one long loaf of candles lying flat along
     the track, packed side by side with their gold tips poking out one edge -
     not a crowd of upright candles. It grows lengthwise, which is what its
     strategy guide means by "as your candle stack gets longer... you need to
     start moving well before an obstacle is in reach".

     So one candle per row and each candle spans most of the lane. A wide, low
     loaf reads its colours off the top faces receding from the camera, which
     is how the reference solves the readability problem that three-abreast
     upright candles were solving before. */
  startCandles: 8,
  maxCandles: 30,
  rowWidth: 1,
  rowGap: 0,
  trailGap: 0.62,        // how tightly the loaf packs along the runway
  trailSamples: 4000,

  /* One candle, lying across the lane. `candleHeight` is its LENGTH and the
     bands run along it - the reference's screenshots show a candle in a wax
     pool striped along its length, which is the shape this produces. */
  coreR: 0.30,
  rPerLayer: 0.045,
  coreH: 1.9,            // length across the lane
  hPerLayer: 0.10,
  wickH: 0.30,           // the gold tip that pokes out of the loaf

  maxLayers: 8,

  perCandleBase: 9,
  layerValue: 0.34,
  contrastValue: 0.30,
  glitterValue: 0.26,
  scentValue: 0.55,      // the Scent Shop station, once bought
  maxGlitter: 3,

  /* Stations are POOLS ON THE GROUND, in pairs across the runway.

     "If there are two pools of wax side by side, you should swipe left and
     right quickly to try and dunk all of your candles in both of the pools."
     A pool has to be longer than the loaf is deep to matter, and each covers
     half the width so one line misses the other. */
  poolLen: 11.0,
  poolInset: 0.15,

  looseWorth: 1,
  magnetBase: 2.0,

  /* Obstacles take candles off the back of the loaf. Flat rather than
     proportional: the player has to be able to look at one and know the cost. */
  barrierTake: 3,
  rollerTake: 2,
  sawTake: 4,
  sweeperTake: 3,

  cashPickup: 120,

  barrierChance: 0.40,
  rollerChance: 0.28,
  sawChance: 0.20,
  sweeperChance: 0.26,
  cashChance: 0.50,
  looseChance: 0.80,
  guardedCash: 0.55,

  /* The end of a run is a VERTICAL VALUE GAUGE with a numeric scale, not a
     star rating - see REFERENCE.md. `par` is the value the gauge is calibrated
     against; the ticks are drawn from it.

     MEASURED, not chosen, and measured with a bot that lives in the repo:
     `playLevel` in `e2e/smoke.spec.ts` plays a whole level under one of four
     policies, and `par` is picked so they land on different ratings. Level one,
     no upgrades:

       idle    4,912  ($140 each)  - never steers            0 stars
       dodge  18,158  ($680 each)  - only avoids hazards     1 star
       gather 14,048  ($447 each)  - only chases pickups     1 star
       weave  39,134 ($1,312 each) - dodges, sweeps both
                                     pools, then collects    3 stars

     Weaving is worth 9.4x idling per candle, which is the number that says the
     pools are the game.

     Measure with THAT bot and no other. An earlier pass used an ad-hoc policy
     written in the browser console with a slightly longer lookahead, scored
     64,606 on the same build, and set par 44% too high - a bot is a definition
     of "playing well", so a par measured against a bot nobody can re-run is a
     number nobody can check. Re-measure whenever a station, a multiplier or the
     obstacle mix changes; all three move it. */
  par: 32000,
  gaugeTicks: 7,
  /* Full scale on the gauge, as a multiple of par. Three stars is 1.15x par, so
     the bar has to keep going well past that or a good run pegs it and a great
     run looks identical to it. At 1.8 the weaving bot fills 68%. */
  gaugeMax: 1.8,

  levelScale: 1.55,
  priceScale: 1.70,
};

// -- wax ---------------------------------------------------------------------

export interface Wax {
  n: string;
  col: number;
  hue: number;
  lit: number;
  price: number;
}

/* Candy colours, off the reference: hot pink, cyan, mint and gold against a
   pale runway. The warm ones sit close together on the hue wheel on purpose -
   stacking them is the expensive-looking mistake. */
export const WAXES: Wax[] = [
  { n: 'CREAM',     col: 0xfff0d0, hue: 0.11, lit: 0.92, price: 1.00 },
  { n: 'AQUA',      col: 0x4fe3f0, hue: 0.51, lit: 0.78, price: 1.20 },
  { n: 'BUBBLEGUM', col: 0xff3d92, hue: 0.94, lit: 0.52, price: 1.30 },
  { n: 'SUNBEAM',   col: 0xffd429, hue: 0.14, lit: 0.80, price: 1.35 },
  { n: 'MINT',      col: 0x5ef0a8, hue: 0.41, lit: 0.82, price: 1.45 },
  { n: 'LILAC',     col: 0xb07bff, hue: 0.73, lit: 0.63, price: 1.55 },
];

export function hueGap(a: number, b: number): number {
  const d = Math.abs(a - b) % 1;
  return d > 0.5 ? 1 - d : d;
}

/* Whether two waxes read as two colours at arm's length. Hue distance alone is
   wrong - cream and bubblegum are near-neighbours on the wheel and obviously
   two colours, because one is nearly white. Either axis counts. */
export const reads2 = (a: Wax, b: Wax) =>
  hueGap(a.hue, b.hue) > 0.18 || Math.abs(a.lit - b.lit) > 0.30;

// -- moulds and wrapping ------------------------------------------------------

export interface Mould { n: string; sides: number; twist: number; bulge: number; mul: number; }
export const MOULDS: Mould[] = [
  { n: 'PLAIN',  sides: 16, twist: 0.00, bulge: 0.00, mul: 1.00 },
  { n: 'FLUTED', sides: 12, twist: 0.00, bulge: 0.16, mul: 1.35 },
  { n: 'TWIST',  sides: 8,  twist: 1.40, bulge: 0.15, mul: 1.60 },
  { n: 'STAR',   sides: 6,  twist: 0.00, bulge: 0.34, mul: 1.90 },
];

/* Wrapping turns a candle into a wrapped gift box with a bow, which is exactly
   what the reference does at its WRAP station - the loaf visibly becomes a row
   of presents. Biggest single multiplier, and it sits late on the runway. */
export interface Wrap { n: string; col: number; bow: number; mul: number; }
export const WRAPS: Wrap[] = [
  { n: 'BARE',   col: 0x000000, bow: 0x000000, mul: 1.00 },
  { n: 'RIBBON', col: 0xff3d92, bow: 0xffd429, mul: 1.45 },
  { n: 'BOXED',  col: 0xd8ecff, bow: 0xff3d92, mul: 1.90 },
  { n: 'LUXE',   col: 0xffd429, bow: 0xff3d92, mul: 2.40 },
];

// -- workshops ----------------------------------------------------------------

export interface Workshop {
  name: string;
  sky: [string, string];
  road: number; rail: number; stripe: number;
  prop: number; cloud: number;
  waxes: number[];
}

/* The reference's main theme is a WHITE runway with pale lavender stripes and
   lilac rails, under a flat bright cyan sky - not the purple this build used
   for two versions. Purple is its second theme, so it stays as workshop two.

   Rule that still holds: the road and the sky must differ in LIGHTNESS, not
   just hue, or the track dissolves into the backdrop at the distance you steer
   by. There is a test. */
export const WORKSHOPS: Workshop[] = [
  /* The sky is a FLAT saturated cyan that never fades toward white, which is
     what the reference's is. A gradient running to near-white at the horizon
     put a white runway against a white background at exactly the distance the
     player steers by - the same failure as the pink-on-pink theme, caught by
     the same test. */
  { name: 'THE WORKSHOP',  sky: ['#12b3ee', '#4ac6f2'], road: 0xf2eefb, rail: 0xb07ae4, stripe: 0xe0d4f4,
    prop: 0xd8ecff, cloud: 0xffffff, waxes: [2, 1, 3] },
  { name: 'NIGHT SHIFT',   sky: ['#12b3ee', '#4ac6f2'], road: 0x5a27ab, rail: 0xd8c0ff, stripe: 0x7440c9,
    prop: 0xff3d92, cloud: 0xffffff, waxes: [1, 2, 4] },
  { name: 'SUGAR FACTORY', sky: ['#ffc98f', '#fff4e2'], road: 0xb01f68, rail: 0xffe6f2, stripe: 0xd13a83,
    prop: 0x4fe3f0, cloud: 0xffffff, waxes: [3, 2, 5] },
  { name: 'THE BOUTIQUE',  sky: ['#c9a4ff', '#f4ecff'], road: 0x35176e, rail: 0xe8dcff, stripe: 0x4a2496,
    prop: 0xffd429, cloud: 0xffffff, waxes: [5, 2, 3] },
];

/* Rough perceptual lightness of a packed 0xRRGGBB, 0..1. Lives here so the
   test checks the same numbers the game draws. */
export function lightnessOf(col: number): number {
  const r = ((col >> 16) & 255) / 255, g = ((col >> 8) & 255) / 255, b = (col & 255) / 255;
  return 0.299 * r + 0.587 * g + 0.114 * b;
}
export const hexLightness = (hex: string): number =>
  lightnessOf(parseInt(hex.replace('#', ''), 16));

// -- shops --------------------------------------------------------------------

/* Progression is BUYING SHOPS, not levelling stats.

   The reference ends each run by driving between shop panels beside the track
   - SCENT SHOP $4,000, ONLINE SHOP $1,000, LUXURY SHOP - each with a green
   plus button, which is what a store review means by "purchasing extra
   stations like the boutique". The observed names and the two observed prices
   are used as-is; the rest follow the same shape. */
export interface Upgrades {
  stack: number;   // Bigger Batch
  earn: number;    // Online Shop
  grip: number;    // Steady Tray
  reach: number;   // Long Reach
  vat: number;     // Deeper Vats
  spark: number;   // Glitter Cannon
  press: number;   // The Boutique - moulds
  wrap: number;    // Luxury Shop - wrapping
  scent: number;   // Scent Shop - adds a SCENT station to every run
}

export const DEF_UP: Upgrades = {
  stack: 0, earn: 0, grip: 0, reach: 0, vat: 0, spark: 0, press: 0, wrap: 0, scent: 0,
};

export const scaleFor = (level: number) => Math.pow(T.levelScale, level - 1);
export const priceFor = (level: number) => Math.pow(T.priceScale, level - 1);

export const startCandles = (up: Upgrades) => T.startCandles + up.stack * 2;

export const takeMul = (up: Upgrades) => Math.pow(0.88, up.grip);
export const obstacleTake = (base: number, up: Upgrades) =>
  Math.max(1, Math.round(base * takeMul(up)));

export const earnMul = (up: Upgrades) => 1 + up.earn * 0.14;
export const magnetR = (up: Upgrades) => T.magnetBase * (1 + up.reach * 0.26);
export const vatLayers = (up: Upgrades) => 1 + Math.floor(up.vat / 3);
export const glitterPer = (up: Upgrades) => 1 + Math.floor(up.spark / 3);

/* The press and wrap stations always do *something* from the first level.
   Starting them at index 0 meant a level-1 press stamping PLAIN onto plain
   candles - a station with a gantry and a sign that was a dead beat. */
export const bestMould = (up: Upgrades) => clamp(1 + up.press, 1, MOULDS.length - 1);
export const bestWrap = (up: Upgrades) => clamp(1 + up.wrap, 1, WRAPS.length - 1);
export const MAX_PRESS = MOULDS.length - 2;
export const MAX_WRAP = WRAPS.length - 2;

/* The Scent Shop is the one upgrade that adds a STATION rather than a number,
   which is the reference's whole progression model. Bought once. */
export const hasScent = (up: Upgrades) => up.scent > 0;

/* Where a hazard, a banknote or a pickup goes across the runway. Everything
   the player must reach or dodge lives inside the band a thumb can steer
   across, which is `laneClamp`, not the width of the road mesh. */
export const laneX = (h: number, inset = 0) =>
  clamp((h - 0.5) * 2 * T.laneClamp, -T.laneClamp + inset, T.laneClamp - inset);
