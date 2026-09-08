/* The chandler's bench: what a finished candle is worth.

   This replaces the boss fight the previous game on this stack ended each run
   with, and it is a better ending for the same reason a shop is better than a
   pop-up. A DPS check asks one question and the answer is always "did you buy
   enough damage". An appraisal reads back every decision the run made - what
   you dipped in, in what order, how much of it you kept, and whether you got
   here before the wick did - and pays differently for each. The player watches
   the parts count up one at a time and can tell, without being told, which one
   they were bad at.

   Pure, so `npm test` can assert the shape of the whole economy: that a varied
   candle beats a fat one of the same weight, that lopsidedness costs, and that
   running out of wick is expensive but never ruinous. */

import { T } from './tuning.js';
import { clamp } from './util.js';
import { avgLop, colourCount, contrastPairs, totalWax, waxValue, type Candle } from './candle.js';

export interface AppraisalInput {
  delivered: boolean;   // did you reach the bench, or did the wick beat you
  valueMul: number;     // dyes, beeswax, myrrh
  priceMul: number;     // how much this workshop pays per unit of wax
}

export interface Appraisal {
  bulk: number;         // coins of raw material
  layerMul: number;     // the two craftsmanship multipliers, reported apart
  contrastMul: number;  // so the results screen can name what earned what
  craft: number;        // 1 + layerMul + contrastMul
  purity: number;
  delivered: number;
  value: number;        // coins, floored
  grade: string;
  wax: number;
  colours: number;
  pairs: number;
}

/* Best first. `gradeFor` walks this in order, so the thresholds must descend. */
export const GRADES = [
  { at: 1.55, g: 'MASTERWORK' },
  { at: 1.15, g: 'FINE' },
  { at: 0.82, g: 'GOOD' },
  { at: 0.52, g: 'PLAIN' },
  { at: 0.26, g: 'ROUGH' },
  { at: -1,   g: 'STUB' },
];

/* Graded against what this workshop pays, not against how hard it is.

   Those are different divisors and picking the wrong one makes the grade a
   lie. A workshop pays `priceScale` more per unit of wax, so an identical
   candle carried to a later bench is worth more coins - and if the grade were
   cut against difficulty instead, that same candle would quietly grade *up*
   the further you climbed, which is precisely backwards for a word that is
   supposed to describe the candle. Dividing by the price means a FINE is the
   same standard of work at the first bench and the ninth, and the only things
   that move it are the player getting better and buying better. */
export function gradeFor(value: number, expected: number): string {
  const ratio = value / Math.max(1e-6, expected);
  for (const g of GRADES) if (ratio >= g.at) return g.g;
  return GRADES[GRADES.length - 1].g;
}

export function appraise(c: Candle, o: AppraisalInput): Appraisal {
  /* Material value is the floor, and it is never zero: even a bare core sells,
     so a run that went badly still pays for the next attempt. This game has no
     other income, and an income that can round to nothing is a game that can
     strand the player. */
  const bulk = waxValue(c) * T.waxPerCoin * o.priceMul;

  /* Craftsmanship multiplies the material rather than being added to it. A
     flat bonus would be decisive on a small candle and a rounding error on a
     big one, so one of the two things the player is doing would always be the
     wrong thing to be thinking about. */
  const layerMul = Math.max(0, colourCount(c) - 1) * T.layerBonus;
  const pairs = contrastPairs(c);
  const contrastMul = pairs * T.contrastBonus;
  const craft = 1 + layerMul + contrastMul;

  /* Lopsidedness is a multiplier too, so it scales with how good the candle
     otherwise was: a masterwork knocked crooked hurts, a stub being crooked
     barely registers, which is the right emotional shape. It bottoms out at
     purityFloor rather than at zero - a wonky candle is a cheap candle, never
     a worthless one. */
  const purity = clamp(1 - avgLop(c) * (1 - T.purityFloor), T.purityFloor, 1);
  const delivered = o.delivered ? 1 : T.undelivered;

  const value = Math.floor(bulk * craft * purity * delivered * o.valueMul);
  return {
    bulk, layerMul, contrastMul, craft, purity, delivered,
    value: Math.max(1, value),
    grade: gradeFor(value, T.par * o.priceMul),
    wax: totalWax(c),
    colours: colourCount(c),
    pairs,
  };
}
