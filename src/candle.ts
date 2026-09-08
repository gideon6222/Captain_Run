/* One candle: what has been done to it, and the geometry that follows.

   **Every candle on the tray carries its own recipe.** That is the single most
   important fact in this game, and it was wrong for a whole build.

   The reference's own strategy guide gives it away: "if there are two pools of
   wax side by side, you should swipe left and right quickly to try and dunk
   all of your candles in both of the pools". Wax is a pool on the *ground*, so
   which candles get which colour depends on where each one was as the stack
   snaked through it - and because the stack trails along the leader's recorded
   path, the player's line *is* the decision. Treating the tray as one shared
   recipe, which is what the previous build did, deletes that entire skill and
   turns every station into something that happens to you.

   It is also why the reference's stack is visibly alternating colours rather
   than uniform: those candles were dipped at different moments.

   Pure: no three.js, no DOM, no run state. */

import { T, WAXES, MOULDS, WRAPS, reads2 } from './tuning.js';
import { clamp } from './util.js';

export interface Recipe {
  layers: number[];   // wax ids, BOTTOM band first, newest dip last
  glitter: number;
  mould: number;
  wrap: number;
}

export const newRecipe = (): Recipe => ({ layers: [0], glitter: 0, mould: 0, wrap: 0 });

export const topWax = (r: Recipe): number => r.layers[r.layers.length - 1];

/* Dip this one candle. Returns whether anything changed, so the caller knows
   whether to make a noise about it.

   The same colour twice running does nothing - a candle that crosses one pool
   lengthwise must not come out with six identical bands, or holding a straight
   line through the biggest pool would beat weaving, which is backwards. A
   different colour adds a band on top, up to the mould's capacity, after which
   the top band is recoloured instead. */
export function dip(r: Recipe, wax: number): boolean {
  if (topWax(r) === wax) return false;
  if (r.layers.length >= T.maxLayers) { r.layers[r.layers.length - 1] = wax; return true; }
  r.layers.push(wax);
  return true;
}

export function addGlitter(r: Recipe, n = 1): boolean {
  const before = r.glitter;
  r.glitter = clamp(r.glitter + n, 0, T.maxGlitter);
  return r.glitter !== before;
}

/* A press and a wrapper only ever improve what they find. A station that can
   quietly downgrade a candle while showing the same sign is a trap rather than
   a decision - and with per-candle state the player cannot even see which
   candles would be hurt. */
export function press(r: Recipe, mould: number): boolean {
  if (mould <= r.mould) return false;
  r.mould = clamp(mould, 0, MOULDS.length - 1);
  return true;
}

export function wrapIn(r: Recipe, wrap: number): boolean {
  if (wrap <= r.wrap) return false;
  r.wrap = clamp(wrap, 0, WRAPS.length - 1);
  return true;
}

export const cloneRecipe = (r: Recipe): Recipe => ({
  layers: r.layers.slice(), glitter: r.glitter, mould: r.mould, wrap: r.wrap,
});

// -- geometry, all derived ----------------------------------------------------

/* A candle is a layer cake, not an onion.

   Dips modelled as concentric shells - which is what dipping physically does -
   render as almost nothing, because the outermost shell hides every shell
   inside it. Horizontal bands stacked up the candle, oldest at the bottom and
   newest on top, put every dip on screen at once. */
export const candleHeight = (r: Recipe): number =>
  T.coreH + r.layers.length * T.hPerLayer;

export const bandHeight = (r: Recipe): number =>
  candleHeight(r) / Math.max(1, r.layers.length);

export function bandYs(r: Recipe): number[] {
  const h = bandHeight(r);
  return r.layers.map((_, i) => (i + 0.5) * h);
}

/* Radius per band, bottom first: widens slowly with dips, and tapers a little
   toward the top so the silhouette reads as a candle rather than a pipe. */
export function radii(r: Recipe): number[] {
  const n = r.layers.length;
  const base = Math.sqrt(T.coreR * T.coreR + n * T.rPerLayer * T.rPerLayer * 3);
  return r.layers.map((_, i) => base * (1 - 0.07 * (n > 1 ? i / (n - 1) : 0)));
}

export const candleRadius = (r: Recipe): number =>
  radii(r)[0] * (1 + MOULDS[r.mould].bulge * 0.5);

// -- what one candle is worth -------------------------------------------------

/* Adjacent bands that genuinely read as two colours - see `reads2`. A count of
   pairs over a threshold, not a sum of distances: a sum pays a little for every
   dip and the player can stop thinking about colour, a threshold means each
   pool either earns it or does not. */
export function contrastPairs(r: Recipe): number {
  let n = 0;
  for (let i = 1; i < r.layers.length; i++) {
    if (reads2(WAXES[r.layers[i]], WAXES[r.layers[i - 1]])) n++;
  }
  return n;
}

export const colourCount = (r: Recipe): number => new Set(r.layers).size;

export function waxValue(r: Recipe): number {
  let v = 0;
  for (const w of r.layers) v += WAXES[w].price;
  return v;
}

/* Craftsmanship multiplies material, never adds to it. A flat bonus is
   decisive on a thin candle and a rounding error on a fat one, so one of the
   two things the player is doing would always be the wrong thing to think
   about. */
export function craftOf(r: Recipe): number {
  return (1 + Math.max(0, colourCount(r) - 1) * T.layerValue)
    * (1 + contrastPairs(r) * T.contrastValue)
    * (1 + r.glitter * T.glitterValue)
    * MOULDS[r.mould].mul
    * WRAPS[r.wrap].mul;
}

export const candleValue = (r: Recipe): number =>
  waxValue(r) * T.perCandleBase * craftOf(r);
