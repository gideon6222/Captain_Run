/* The candle: a stack of wax layers, and the geometry derived from it.

   This module is the whole game in one data structure, so it is pure and it is
   tested. Nothing in here knows about three.js, the DOM or the run - it takes
   a candle and returns a candle, which is what lets a node test assert that
   nine dips and four blades leave the right thing standing without booting a
   renderer.

   The one rule that everything else follows from: **the silhouette is derived
   from the layer list, never stored alongside it.** Radius, height, lean and
   appraised value are all functions of the same array. There is therefore no
   way for the candle on screen to disagree with the candle being scored, which
   is the failure this design exists to make impossible - in a game whose whole
   point is "protect the thing you can see", a score that drifts from the
   picture is the one bug the player would never forgive. */

import { T, WAXES, reads2 } from './tuning.js';
import { clamp } from './util.js';

export interface WaxLayer {
  wax: number;   // index into WAXES
  amt: number;   // wax units in this layer
  lop: number;   // 0 = true, 1 = fully out of true. Blades push this up.
}

export type Candle = WaxLayer[];

/* Layer 0 is the core and is always index 0; the outermost layer is the last.
   Dips push onto the end, blades take from the end. */
export const newCandle = (coreAmt: number, wax = 0): Candle =>
  [{ wax, amt: Math.max(T.minCore, coreAmt), lop: 0 }];

export const totalWax = (c: Candle): number => {
  let t = 0;
  for (const l of c) t += l.amt;
  return t;
};

export const outer = (c: Candle): WaxLayer => c[c.length - 1];

/* Add wax of one colour.

   Same colour as the current outside just fattens that layer - dipping a red
   candle in red again does not give it a second red ring, and pretending it
   did would let a player farm layer bonuses from one vat. A different colour
   starts a new layer, unless the mould is full, in which case it merges. The
   merge keeps the *new* colour, because the outside of the candle is what you
   just dipped it in and the player must be able to trust the picture. */
export function addWax(c: Candle, wax: number, amt: number, maxLayers: number): Candle {
  if (amt <= 0) return c;
  const o = outer(c);
  if (o.wax === wax) { o.amt += amt; return c; }
  if (c.length >= maxLayers) { o.wax = wax; o.amt += amt; return c; }
  c.push({ wax, amt, lop: 0 });
  return c;
}

/* Take wax off the outside, eating inward through as many layers as it takes.

   Returns how much was actually removed, which is not always what was asked
   for: the core will not go below `minCore`. That floor is the reason a bad
   run is a cheap candle rather than a dead one - CRAFT.md's "never let a
   hazard take the run", applied to the only thing there is to lose here.

   `lop` is spread over the layers it touched rather than only the outermost,
   so a candle that has been shaved to the core is visibly crooked all the way
   down instead of straightening out as it gets smaller. */
export function shave(c: Candle, amt: number, lop = 0): number {
  let want = amt, took = 0;
  while (want > 0 && c.length > 0) {
    const o = outer(c);
    const floor = c.length === 1 ? T.minCore : 0;
    const avail = o.amt - floor;
    if (avail <= 0) break;
    const take = Math.min(avail, want);
    o.amt -= take;
    want -= take;
    took += take;
    if (lop > 0) o.lop = clamp(o.lop + lop, 0, 1);
    /* An emptied layer is gone, but never the core: a candle is always at
       least one layer, or every downstream `outer()` reads undefined. */
    if (o.amt <= 1e-9 && c.length > 1) c.pop();
    else if (take < 1e-9) break;
  }
  return took;
}

/* Melting differs from shaving in one way that matters: it is even. Heat comes
   off the whole surface, so it costs wax without costing symmetry, which is
   what makes a heat lamp a different decision from a blade rather than a
   slower one. */
export const melt = (c: Candle, amt: number): number => shave(c, amt, 0);

// -- geometry, all derived --------------------------------------------------

/* Outer radius of each layer, innermost first.

   Square root of accumulated area, so the candle widens fast while it is thin
   and slowly once it is fat. Two things fall out of that for free: a long
   clean run cannot grow until it fills the screen, and adding a *new colour*
   beats adding more of the one you have - because the value is in the layer
   count and the contrast, and those do not have diminishing returns. */
export function radii(c: Candle): number[] {
  const out: number[] = [];
  let area = T.coreR * T.coreR;
  for (const l of c) {
    area += l.amt * T.rPerWax * T.rPerWax * 6;
    out.push(Math.sqrt(area));
  }
  return out;
}

/* Height of each layer's top, innermost first.

   The core is the tallest and thinnest, and every layer around it is shorter
   than the one inside - so the candle is a stepped tower with the wick at the
   peak, every band visible at once from the side, widest and newest at the
   bottom. That is the silhouette doing the work CRAFT.md asks of it: how much
   wax reads as width, how many dips reads as steps, and both are legible at
   thumbnail size without a single HUD number. */
export function heights(c: Candle): number[] {
  const total = T.coreH + totalWax(c) * T.hPerWax;
  const out: number[] = [];
  for (let i = 0; i < c.length; i++) {
    out.push(Math.max(0.18, total - i * T.stepH));
  }
  return out;
}

export const candleHeight = (c: Candle): number => heights(c)[0];
export const candleRadius = (c: Candle): number => radii(c)[c.length - 1];

/* How far each layer leans, in world units. Damage is directional - a blade on
   the left knocks the candle right - so this is signed by nothing here; the
   sign lives in the run, which knows which side it was hit from. */
export function leans(c: Candle): number[] {
  const r = radii(c);
  return c.map((l, i) => l.lop * r[i] * T.lopPerR);
}

/* Wax-weighted, because a wonky core is worse than a wonky skin. */
export function avgLop(c: Candle): number {
  let w = 0, t = 0;
  for (const l of c) { w += l.lop * l.amt; t += l.amt; }
  return t > 0 ? w / t : 0;
}

// -- what makes a candle good -----------------------------------------------

/* Adjacent pairs that genuinely read as two colours - see `reads2`.

   Deliberately a count of *pairs over a threshold*, not a sum of colour
   distances. A sum would pay a little for every dip and the player could stop
   thinking about colour entirely; a threshold means each dip either earns the
   bonus or does not, which is a judgement you can actually make at the arch in
   the half-second you have to make it. */
export function contrastPairs(c: Candle): number {
  let n = 0;
  for (let i = 1; i < c.length; i++) {
    if (reads2(WAXES[c[i].wax], WAXES[c[i - 1].wax])) n++;
  }
  return n;
}

export const colourCount = (c: Candle): number => {
  const seen = new Set<number>();
  for (const l of c) seen.add(l.wax);
  return seen.size;
};

/* The raw material value: every unit of wax at its own colour's price. */
export function waxValue(c: Candle): number {
  let v = 0;
  for (const l of c) v += l.amt * WAXES[l.wax].price;
  return v;
}

export const cloneCandle = (c: Candle): Candle => c.map((l) => ({ ...l }));
