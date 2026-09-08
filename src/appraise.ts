/* The gift table: what the tray is worth when it reaches the end of the runway.

   Two axes, multiplied. How many candles survived, and what each one is worth
   after everything the stations did to it. That is the whole economy, and
   keeping it as a product rather than a sum is what stops either half becoming
   the only thing worth thinking about: doubling the stack always doubles the
   payout, and a well-made candle is always worth about twice a plain one, at
   every size of stack.

   Pure, so `npm test` can assert the shape of the economy: that variety beats
   bulk at equal cost, that wrapping is worth reaching, and that a wiped stack
   still pays something. */

import { T, MOULDS, WRAPS } from './tuning.js';
import { colourCount, contrastPairs, waxValue, type Recipe } from './candle.js';

export interface AppraisalInput {
  count: number;      // candles that survived
  cash: number;       // banknotes picked up on the way
  earnMul: number;    // earning power
  priceMul: number;   // what this workshop pays
}

export interface Appraisal {
  count: number;
  each: number;       // value of one finished candle
  layerMul: number;   // reported apart so the results screen can name each one
  contrastMul: number;
  glitterMul: number;
  mouldMul: number;
  wrapMul: number;
  craft: number;      // the product of all of them
  candles: number;    // count * each
  cash: number;
  value: number;      // total paid, floored
  stars: number;      // 0..3
  colours: number;
  pairs: number;
}

/* Three stars is meant to be a real standard, not a participation award.

   The gaps between the thresholds have to match the real spread between bad
   and good play, and that spread is measured rather than assumed: at level 1
   a run that never touches the screen and a run that plays well are about 3.5x
   apart, so thresholds bunched inside a 1.5x band would hand three stars to
   everybody - which is exactly what the first set did. */
export const STAR_AT = [0.30, 0.60, 1.15];

export function starsFor(value: number, expected: number): number {
  const ratio = value / Math.max(1e-6, expected);
  let s = 0;
  for (const t of STAR_AT) if (ratio >= t) s++;
  return s;
}

export function appraise(r: Recipe, o: AppraisalInput): Appraisal {
  /* Material first, and it is never zero: even a single bare candle sells, so
     a run that went badly still pays toward the next attempt. This game has no
     other income and an income that can round to nothing can strand a player. */
  const material = waxValue(r) * T.perCandleBase;

  const layerMul = 1 + Math.max(0, colourCount(r) - 1) * T.layerValue;
  const pairs = contrastPairs(r);
  const contrastMul = 1 + pairs * T.contrastValue;
  const glitterMul = 1 + r.glitter * T.glitterValue;
  const mouldMul = MOULDS[r.mould].mul;
  const wrapMul = WRAPS[r.wrap].mul;
  const craft = layerMul * contrastMul * glitterMul * mouldMul * wrapMul;

  const each = material * craft * o.priceMul;
  const count = Math.max(0, Math.floor(o.count));
  const candles = each * count;
  const value = Math.floor((candles + o.cash) * o.earnMul);

  return {
    count, each, layerMul, contrastMul, glitterMul, mouldMul, wrapMul, craft,
    candles, cash: o.cash,
    value: Math.max(1, value),
    stars: starsFor(value, T.par * o.priceMul),
    colours: colourCount(r),
    pairs,
  };
}
