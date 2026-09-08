/* The tray: the candles currently on it, each with its own recipe.

   Kept apart from `stack.ts`, which owns *where* the candles are, because the
   two answer different questions and change at different times: the trail
   moves every frame, the tray only when a pool, a press or an obstacle touches
   it. Keeping them separate also means the layout can be tested without any
   recipes and the economy without any positions.

   The candle at index 0 is the one the player is steering; the tray grows and
   shrinks from the BACK. That is not arbitrary - see `shrink`. */

import { T } from './tuning.js';
import {
  candleValue, cloneRecipe, colourCount, newRecipe, type Recipe,
} from './candle.js';

export type Tray = Recipe[];

export const newTray = (n: number): Tray =>
  Array.from({ length: Math.max(0, Math.min(n, T.maxCandles)) }, () => newRecipe());

/* New candles arrive plain, at the back of the line.

   A picked-up candle joining with the treatments the rest of the tray already
   has would make late pickups worth more than early ones for no reason the
   player could see, and would quietly reward ignoring the first half of a
   level. It starts bare and has to be taken through the pools like everything
   else. */
export function grow(t: Tray, n: number): number {
  const room = T.maxCandles - t.length;
  const add = Math.max(0, Math.min(n, room));
  for (let i = 0; i < add; i++) t.push(newRecipe());
  return add;
}

/* Obstacles eat the tray from the BACK.

   Losing the tail rather than the head is the only version that reads
   correctly: the leader is the thing the thumb is steering, and having it
   vanish mid-corner feels like the game took the controls away, while the tail
   is exactly what the player failed to think about. It also means the tray
   shortens toward agility as it takes damage, which is a mercy the player can
   feel rather than be told about. */
export function shrink(t: Tray, n: number): number {
  const take = Math.max(0, Math.min(n, t.length));
  t.length = t.length - take;
  return take;
}

export const cloneTray = (t: Tray): Tray => t.map(cloneRecipe);

/* The ROTATE station: turn the whole loaf end for end.

   Worth having because the tray is asymmetric in two ways that matter. New
   candles join the BACK plain, and obstacles eat the BACK - so the back is
   both the least finished and the most exposed. Turning the loaf swaps those:
   your plain new candles come to the front where the next pools will catch
   them first, and your best work moves to where it can be knocked off. A real
   decision in one button, and it costs nothing to render. */
export function rotate(t: Tray): void {
  t.reverse();
}

// -- what the whole tray is worth ---------------------------------------------

export const trayValue = (t: Tray): number => {
  let v = 0;
  for (const r of t) v += candleValue(r);
  return v;
};

export const bestCandle = (t: Tray): number => {
  let v = 0;
  for (const r of t) v = Math.max(v, candleValue(r));
  return v;
};

export const averageValue = (t: Tray): number => (t.length ? trayValue(t) / t.length : 0);

/* Aggregates the results screen needs. Reported rather than recomputed there,
   so the panel and the payout cannot drift apart. */
export interface TrayStats {
  count: number;
  avgColours: number;
  avgGlitter: number;
  pressed: number;   // how many candles carry a mould better than plain
  wrapped: number;
  scented: number;
  plain: number;     // candles that never got dipped in anything
  palette: number[]; // how many candles carry each wax, indexed by wax id
}

export function statsOf(t: Tray, waxCount: number): TrayStats {
  const palette = new Array(waxCount).fill(0);
  let colours = 0, glitter = 0, pressed = 0, wrapped = 0, scented = 0, plain = 0;
  for (const r of t) {
    colours += colourCount(r);
    glitter += r.glitter;
    if (r.mould > 0) pressed++;
    if (r.wrap > 0) wrapped++;
    if (r.scent > 0) scented++;
    if (r.layers.length <= 1 && r.glitter === 0 && r.mould === 0 && r.wrap === 0) plain++;
    const seen = new Set(r.layers);
    for (const w of seen) if (w < waxCount) palette[w]++;
  }
  const n = Math.max(1, t.length);
  return {
    count: t.length,
    avgColours: colours / n,
    avgGlitter: glitter / n,
    pressed, wrapped, scented, plain, palette,
  };
}
