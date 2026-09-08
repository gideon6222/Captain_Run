import test from 'node:test';
import assert from 'node:assert/strict';
import { loadPure } from './harness.mjs';

const P = await loadPure();
const { T, WAXES, MOULDS, WRAPS } = P;

const CREAM = 0, AQUA = 1, GUM = 2, SUN = 3, MINT = 4, LILAC = 5;

/* The recipe is the score and the silhouette at once, so these tests are about
   the properties the rest of the game leans on rather than about arithmetic.
   Anything asserted here would be a silent, ugly bug on screen if it stopped
   holding. */

test('a fresh candle is one cream band, unpressed and unwrapped', () => {
  const r = P.newRecipe();
  assert.deepEqual(r.layers, [CREAM]);
  assert.equal(r.glitter, 0);
  assert.equal(r.mould, 0);
  assert.equal(r.wrap, 0);
});

test('dipping a new colour bands it; the same colour twice does nothing', () => {
  const r = P.newRecipe();
  assert.equal(P.dip(r, AQUA), true, 'a dip that changed something says so');
  assert.deepEqual(r.layers, [CREAM, AQUA]);
  assert.equal(P.dip(r, AQUA), false,
    'a candle crossing one pool lengthwise must not come out with six identical bands');
  assert.deepEqual(r.layers, [CREAM, AQUA]);
  P.dip(r, GUM);
  assert.equal(r.layers.length, 3);
  assert.equal(P.topWax(r), GUM);
});

test('a full mould recolours the top rather than dropping the dip', () => {
  const r = P.newRecipe();
  const cols = [AQUA, GUM, SUN, MINT, LILAC, AQUA, GUM, SUN, MINT, LILAC];
  for (const c of cols) P.dip(r, c);
  assert.equal(r.layers.length, T.maxLayers, 'the band count is capped');
  assert.equal(P.topWax(r), LILAC,
    'and the top is the colour it was last dipped in, or the picture lies');
});

test('glitter caps, and a press only ever improves the shape', () => {
  const r = P.newRecipe();
  assert.equal(P.addGlitter(r, 99), true);
  assert.equal(r.glitter, T.maxGlitter);
  assert.equal(P.addGlitter(r, 1), false, 'a maxed candle reports no change');

  assert.equal(P.press(r, 3), true);
  assert.equal(r.mould, 3);
  assert.equal(P.press(r, 1), false, 'a weaker press must not downgrade a candle');
  assert.equal(r.mould, 3);

  P.wrapIn(r, 2);
  assert.equal(P.wrapIn(r, 1), false, 'nor may a plainer wrapping');
  assert.equal(r.wrap, 2);
});

// -- geometry -----------------------------------------------------------------

test('a candle is a layer cake: every band visible, newest on top', () => {
  /* The whole reason the geometry was rewritten. Modelled as concentric shells
     - which is what dipping physically does - the outermost band hides every
     band inside it, and five dips render as a plain cream cylinder with a
     two-millimetre rim of colour at the base. */
  const r = P.newRecipe();
  P.dip(r, AQUA); P.dip(r, GUM);
  const ys = P.bandYs(r), rad = P.radii(r);

  assert.equal(ys.length, r.layers.length);
  assert.equal(rad.length, r.layers.length);
  for (let i = 1; i < ys.length; i++) {
    assert.ok(ys[i] > ys[i - 1], `band ${i} must sit above band ${i - 1}`);
  }
  const h = P.bandHeight(r);
  assert.ok(Math.abs(ys[0] - h / 2) < 1e-9, 'the bottom band sits on the tray');
  assert.ok(Math.abs(ys[ys.length - 1] + h / 2 - P.candleHeight(r)) < 1e-9,
    'and the top band reaches the top - no gap, no overhang');
  assert.equal(P.topWax(r), GUM, 'the newest dip is the top band');
});

test('dips make a candle taller, and barely wider', () => {
  /* Height is how "more work" reads at a glance. Width has to stay nearly
     still, or a full tray is a row of tree trunks. */
  const one = P.newRecipe();
  const many = P.newRecipe();
  for (const c of [AQUA, GUM, SUN, MINT, LILAC]) P.dip(many, c);

  assert.ok(P.candleHeight(many) > P.candleHeight(one) * 1.2, 'clearly taller');
  const widened = P.candleRadius(many) / P.candleRadius(one);
  assert.ok(widened > 1, 'a little wider');
  assert.ok(widened < 1.5, `but not ${widened.toFixed(2)}x wider`);
  assert.ok(P.candleRadius(many) < 0.9, 'and a sane size in absolute terms');
});

test('bands taper toward the top, so it reads as a candle not a pipe', () => {
  const r = P.newRecipe();
  for (const c of [AQUA, GUM, SUN]) P.dip(r, c);
  const rad = P.radii(r);
  assert.ok(rad[rad.length - 1] < rad[0], 'the top band is narrower than the bottom');
  assert.ok(rad[rad.length - 1] > rad[0] * 0.8, 'but only slightly');
});

test('a bulging mould widens the candle, so a press is visible', () => {
  const plain = P.newRecipe();
  const star = P.newRecipe();
  P.press(star, MOULDS.findIndex((m) => m.n === 'STAR'));
  assert.ok(P.candleRadius(star) > P.candleRadius(plain),
    'an upgrade the player cannot see is one they buy on trust');
});

// -- what makes a candle good --------------------------------------------------

test('contrast counts pairs that read as two colours, not warm-on-warm', () => {
  const warm = P.newRecipe();       // cream core
  P.dip(warm, SUN);
  assert.equal(P.contrastPairs(warm), 0, 'cream and sunbeam are both pale and warm');

  const varied = P.newRecipe();
  P.dip(varied, GUM); P.dip(varied, MINT);
  assert.equal(P.contrastPairs(varied), 2);
});

test('lightness counts as contrast, not only hue', () => {
  /* Cream and bubblegum are near-neighbours on the wheel and are obviously two
     colours, because one is nearly white. This is the assertion that caught
     the first colour model, which scored that pair as no contrast at all. */
  assert.ok(P.hueGap(WAXES[CREAM].hue, WAXES[GUM].hue) < 0.25,
    'the pair really is hue-close, or this test proves nothing');
  assert.equal(P.reads2(WAXES[CREAM], WAXES[GUM]), true);
  assert.equal(P.reads2(WAXES[CREAM], WAXES[SUN]), false);
});

test('the mould and wrap ladders both climb', () => {
  for (let i = 1; i < MOULDS.length; i++) {
    assert.ok(MOULDS[i].mul > MOULDS[i - 1].mul, `${MOULDS[i].n} must beat ${MOULDS[i - 1].n}`);
  }
  for (let i = 1; i < WRAPS.length; i++) {
    assert.ok(WRAPS[i].mul > WRAPS[i - 1].mul, `${WRAPS[i].n} must beat ${WRAPS[i - 1].n}`);
  }
  assert.equal(WRAPS[0].mul, 1, 'unwrapped is the baseline');
  assert.equal(MOULDS[0].mul, 1, 'unpressed is the baseline');
});

test('every mould is a different shape, not just a different number', () => {
  const sig = MOULDS.map((m) => m.sides + '/' + m.twist + '/' + m.bulge);
  assert.equal(new Set(sig).size, MOULDS.length,
    'two moulds that render identically are one mould and a price');
});
