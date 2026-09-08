/* The gift table: what the tray is worth when it reaches the end of the runway.

   Every candle is priced individually and the results add up, which is the
   whole point of per-candle recipes: a tray where the player wove through both
   pools is worth far more than one that held a straight line through a single
   pool, even though both crossed the same stations. Under the old shared-recipe
   model those two runs were identical.

   Pure, so `npm test` can assert the shape of the economy: that weaving beats
   holding a line, that a bigger tray pays proportionally, and that a wiped
   tray still pays something. */

import { T, WAXES } from './tuning.js';
import { statsOf, trayValue, type Tray, type TrayStats } from './tray.js';

export interface AppraisalInput {
  cash: number;       // banknotes picked up on the way
  earnMul: number;    // earning power
  priceMul: number;   // what this level pays
}

export interface Appraisal {
  count: number;
  candles: number;    // coins from the candles themselves
  cash: number;
  value: number;      // total paid, floored
  stars: number;      // 0..3
  each: number;       // average per candle
  stats: TrayStats;
}

/* Three stars is meant to be a real standard, not a participation award.

   The gaps between thresholds have to match the real spread between bad and
   good play, and that spread is measured rather than assumed: thresholds
   bunched inside a 1.5x band handed three stars to everybody, including the
   run that never touched the screen. */
export const STAR_AT = [0.30, 0.60, 1.15];

export function starsFor(value: number, expected: number): number {
  const ratio = value / Math.max(1e-6, expected);
  let s = 0;
  for (const t of STAR_AT) if (ratio >= t) s++;
  return s;
}

export function appraise(t: Tray, o: AppraisalInput): Appraisal {
  const candles = trayValue(t) * o.priceMul;
  const value = Math.floor((candles + o.cash) * o.earnMul);
  return {
    count: t.length,
    candles,
    cash: o.cash,
    /* Never zero: even a single bare candle sells, so a run that went badly
       still pays toward the next attempt. There is no other income in the
       game and an income that can round to nothing can strand a player. */
    value: Math.max(1, value),
    stars: starsFor(value, T.par * o.priceMul),
    each: t.length ? (candles / t.length) : 0,
    stats: statsOf(t, WAXES.length),
  };
}
