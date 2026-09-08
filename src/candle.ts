/* The recipe: what has been done to the candles on the tray, and the geometry
   that follows from it.

   Every station treats the whole stack at once, so there is one recipe shared
   by every candle rather than one per candle. That is not a shortcut - it is
   what keeps the game's two axes from interfering. Obstacles change *how many*
   candles you have; stations change *what each one is worth*. Neither can
   quietly move the other, so both stay readable on screen and in the payout.

   Pure: no three.js, no DOM, no run state. A node test can pour six vats and
   two glitter passes and check the silhouette and the value without booting a
   renderer.

   The rule everything else follows from: **the silhouette is derived from the
   recipe, never stored beside it.** Radius, height, banding and value are all
   functions of the same object, so the candle on screen cannot disagree with
   the candle being paid for. */

import { T, WAXES, MOULDS, WRAPS, reads2 } from './tuning.js';
import { clamp } from './util.js';

export interface Recipe {
  layers: number[];   // wax ids, BOTTOM band first, newest dip last
  glitter: number;    // how many glitter passes, 0..maxGlitter
  mould: number;      // index into MOULDS
  wrap: number;       // index into WRAPS
}

export const newRecipe = (): Recipe => ({ layers: [0], glitter: 0, mould: 0, wrap: 0 });

export const outerWax = (r: Recipe): number => r.layers[r.layers.length - 1];

/* Dip the whole tray in a vat.

   The same colour twice in a row does nothing - dipping a pink candle in pink
   again does not give it a second pink band, and pretending it did would let a
   player farm layer bonuses by driving through one vat repeatedly. A different
   colour adds a band on top, up to the mould's capacity, after which the top
   band is recoloured instead: the top of the candle is what it was last dipped
   in, and the picture has to be able to be trusted. */
export function dip(r: Recipe, wax: number, times = 1): Recipe {
  for (let i = 0; i < times; i++) {
    if (outerWax(r) === wax) return r;
    if (r.layers.length >= T.maxLayers) { r.layers[r.layers.length - 1] = wax; return r; }
    r.layers.push(wax);
  }
  return r;
}

export const addGlitter = (r: Recipe, n = 1): Recipe => {
  r.glitter = clamp(r.glitter + n, 0, T.maxGlitter);
  return r;
};

/* A press only ever improves the shape. Driving through a FLUTED press with a
   STAR already stamped must not quietly downgrade the tray - the player has no
   way to know that was a cost, and a station that can hurt you while showing
   the same "+" signage is a trap rather than a decision. */
export const press = (r: Recipe, mould: number): Recipe => {
  if (mould > r.mould) r.mould = clamp(mould, 0, MOULDS.length - 1);
  return r;
};

export const wrapIn = (r: Recipe, wrap: number): Recipe => {
  if (wrap > r.wrap) r.wrap = clamp(wrap, 0, WRAPS.length - 1);
  return r;
};

// -- geometry, all derived ----------------------------------------------------

/* A candle is a layer cake, not an onion.

   The first version modelled dips as concentric shells, which is what dipping
   physically does - and it renders as almost nothing, because the outermost
   shell hides every shell inside it. Five dips came out as a plain cream
   cylinder with a two-millimetre rim of colour at the base. The reference
   draws them the readable way instead: horizontal bands stacked up the candle,
   oldest at the bottom, newest on top, every one of them visible at once.

   So `layers[0]` is the bottom band and the last entry is the top band, which
   is also the order the HUD chips are drawn in. What the player sees on the
   candle and what they see in the corner of the screen are the same list. */

export const bandCount = (r: Recipe): number => r.layers.length;

/* Total height, which grows with every dip - that is how "more work" reads at
   a glance, since the width barely moves. */
export const candleHeight = (r: Recipe): number =>
  T.coreH + r.layers.length * T.hPerLayer;

export const bandHeight = (r: Recipe): number =>
  candleHeight(r) / Math.max(1, r.layers.length);

/* The centre height of each band, bottom band first. */
export function bandYs(r: Recipe): number[] {
  const h = bandHeight(r);
  return r.layers.map((_, i) => (i + 0.5) * h);
}

/* Radius per band, bottom first.

   The candle widens slowly with the number of dips - square root of
   accumulated area, so the eighth dip barely moves it - and tapers a little
   toward the top so the silhouette reads as a candle rather than a pipe. */
export function radii(r: Recipe): number[] {
  const n = r.layers.length;
  const base = Math.sqrt(T.coreR * T.coreR + n * T.rPerLayer * T.rPerLayer * 3);
  return r.layers.map((_, i) => base * (1 - 0.07 * (n > 1 ? i / (n - 1) : 0)));
}

export const candleRadius = (r: Recipe): number =>
  radii(r)[0] * (1 + MOULDS[r.mould].bulge * 0.5);

// -- what makes a candle good -------------------------------------------------

/* Adjacent bands that genuinely read as two colours - see `reads2`.

   Deliberately a count of *pairs over a threshold*, not a sum of colour
   distances. A sum would pay a little for every dip and the player could stop
   thinking about colour entirely; a threshold means each vat either earns the
   bonus or does not, which is a judgement you can actually make at the station
   in the half-second you have to make it. */
export function contrastPairs(r: Recipe): number {
  let n = 0;
  for (let i = 1; i < r.layers.length; i++) {
    if (reads2(WAXES[r.layers[i]], WAXES[r.layers[i - 1]])) n++;
  }
  return n;
}

export const colourCount = (r: Recipe): number => new Set(r.layers).size;

/* The material value of one candle: its bands at their own colours' prices. */
export function waxValue(r: Recipe): number {
  let v = 0;
  for (const w of r.layers) v += WAXES[w].price;
  return v;
}

export const cloneRecipe = (r: Recipe): Recipe => ({
  layers: r.layers.slice(), glitter: r.glitter, mould: r.mould, wrap: r.wrap,
});
