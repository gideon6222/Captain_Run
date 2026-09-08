import test from 'node:test';
import assert from 'node:assert/strict';
import { loadPure } from './harness.mjs';

const P = await loadPure();
const { T, WAXES } = P;

const TALLOW = 0, CRIMSON = 1, VERDIGRIS = 2, AMBER = 4, GOLDLEAF = 5;
const fresh = () => P.newCandle(T.coreWax);

/* The candle is the score, the health bar and the avatar at once, so these
   tests are about the properties the rest of the game leans on rather than
   about arithmetic. Anything asserted here is something that would be a
   silent, ugly bug on screen if it stopped holding. */

test('a new candle is one core layer at the minimum or above', () => {
  const c = fresh();
  assert.equal(c.length, 1);
  assert.equal(P.totalWax(c), T.coreWax);
  assert.ok(P.newCandle(0)[0].amt >= T.minCore,
    'a candle built below the floor must still be a candle');
});

test('dipping the same colour fattens; a new colour adds a ring', () => {
  const c = fresh();
  P.addWax(c, TALLOW, 4, 9);
  assert.equal(c.length, 1, 'tallow on tallow is not a second tallow ring');
  assert.equal(P.totalWax(c), T.coreWax + 4);

  P.addWax(c, CRIMSON, 4, 9);
  assert.equal(c.length, 2);
  assert.equal(P.outer(c).wax, CRIMSON);
});

test('a full mould merges rather than dropping the dip on the floor', () => {
  const c = fresh();
  /* Alternate so every dip is a colour change and each one wants a new ring. */
  for (let i = 0; i < 20; i++) P.addWax(c, i % 2 ? CRIMSON : VERDIGRIS, 2, 4);
  assert.equal(c.length, 4, 'the mould caps the ring count');
  assert.equal(P.totalWax(c), T.coreWax + 40, 'but no wax is ever lost to the cap');
  assert.equal(P.outer(c).wax, CRIMSON,
    'and the outside is the colour you were last dipped in, or the picture lies');
});

test('shaving eats inward and stops at the core floor', () => {
  const c = fresh();
  P.addWax(c, CRIMSON, 5, 9);
  P.addWax(c, VERDIGRIS, 5, 9);
  assert.equal(c.length, 3);

  const took = P.shave(c, 6);
  assert.equal(took, 6);
  assert.equal(c.length, 2, 'the outermost ring is gone and crimson is showing');
  assert.equal(P.outer(c).wax, CRIMSON);

  /* Now take far more than is left. */
  const rest = P.shave(c, 999);
  assert.equal(c.length, 1, 'down to the bare core');
  assert.equal(P.totalWax(c), T.minCore);
  assert.ok(rest > 0);

  /* And the run is still alive: nothing here can take it. */
  assert.equal(P.shave(c, 999), 0, 'a bare core cannot be shaved further');
  assert.equal(P.totalWax(c), T.minCore);
});

test('a blade leaves the candle crooked; heat does not', () => {
  const a = fresh(); P.addWax(a, CRIMSON, 10, 9);
  const b = fresh(); P.addWax(b, CRIMSON, 10, 9);

  P.shave(a, 4, T.bladeLop);
  P.melt(b, 4);

  assert.ok(P.avgLop(a) > 0, 'a blade knocks it out of true');
  assert.equal(P.avgLop(b), 0, 'heat comes off the whole surface evenly');
  assert.equal(P.totalWax(a), P.totalWax(b), 'and both cost the same wax');
});

test('lopsidedness is capped and wax-weighted', () => {
  const c = fresh();
  P.addWax(c, CRIMSON, 30, 9);
  for (let i = 0; i < 40; i++) P.shave(c, 0.1, 0.5);
  assert.ok(P.avgLop(c) <= 1, 'lop never exceeds fully out of true');
  for (const l of c) assert.ok(l.lop <= 1);
});

// -- geometry ---------------------------------------------------------------

test('the silhouette is a stepped tower: wider outward, shorter outward', () => {
  const c = fresh();
  P.addWax(c, CRIMSON, 6, 9);
  P.addWax(c, VERDIGRIS, 6, 9);
  const r = P.radii(c), h = P.heights(c);

  assert.equal(r.length, c.length);
  for (let i = 1; i < r.length; i++) {
    assert.ok(r[i] > r[i - 1], `ring ${i} must be wider than the one inside it`);
    assert.ok(h[i] < h[i - 1], `ring ${i} must be shorter than the one inside it`);
  }
  assert.ok(h[h.length - 1] > 0, 'no ring may collapse to nothing and vanish');
});

test('radius has diminishing returns, height does not', () => {
  /* This is what makes a new colour worth more than more of the same one, and
     what stops a clean run growing until it fills the screen. */
  const thin = P.newCandle(T.coreWax);
  const fat = P.newCandle(T.coreWax);
  P.addWax(fat, TALLOW, 60, 9);

  const gainThin = P.candleRadius(P.addWax(P.cloneCandle(thin), TALLOW, 10, 9)) - P.candleRadius(thin);
  const gainFat = P.candleRadius(P.addWax(P.cloneCandle(fat), TALLOW, 10, 9)) - P.candleRadius(fat);
  assert.ok(gainFat < gainThin * 0.6,
    `ten units should widen a fat candle much less (thin +${gainThin.toFixed(3)}, fat +${gainFat.toFixed(3)})`);

  const hThin = P.candleHeight(thin), hFat = P.candleHeight(fat);
  assert.ok(hFat > hThin, 'height keeps climbing so the candle still reads as growing');
});

test('a lean is proportional to the ring it is on', () => {
  const c = fresh();
  P.addWax(c, CRIMSON, 20, 9);
  c[0].lop = 1; c[1].lop = 1;
  const l = P.leans(c);
  assert.ok(l[1] > l[0], 'the wide outer ring leans further in world units');
});

// -- what makes a candle good ----------------------------------------------

test('contrast counts pairs that read as two colours, not warm-on-warm', () => {
  const warm = fresh();                       // tallow core
  P.addWax(warm, AMBER, 6, 9);
  P.addWax(warm, GOLDLEAF, 6, 9);
  assert.equal(P.contrastPairs(warm), 0,
    'tallow, amber and gold-leaf are the expensive-looking mistake');

  const varied = fresh();
  P.addWax(varied, CRIMSON, 6, 9);
  P.addWax(varied, VERDIGRIS, 6, 9);
  assert.equal(P.contrastPairs(varied), 2);
});

test('lightness counts as contrast, not only hue', () => {
  /* Cream tallow and crimson are 0.13 apart on the wheel - neighbours - and
     are obviously two colours on a candle, because one is nearly white. This
     is the assertion that caught the first colour model, which scored that
     pair as no contrast at all. */
  assert.ok(P.hueGap(WAXES[TALLOW].hue, WAXES[CRIMSON].hue) < 0.18,
    'the pair really is hue-adjacent, or this test is proving nothing');
  assert.equal(P.reads2(WAXES[TALLOW], WAXES[CRIMSON]), true);
  assert.equal(P.reads2(WAXES[AMBER], WAXES[GOLDLEAF]), false,
    'two warm mid-lights do not read as two colours');
});

test('the pricey waxes really are pricier, and tallow is the baseline', () => {
  assert.equal(WAXES[TALLOW].price, 1);
  for (let i = 1; i < WAXES.length; i++) {
    assert.ok(WAXES[i].price > 1, `${WAXES[i].n} should beat plain tallow per unit`);
  }
  assert.ok(WAXES[GOLDLEAF].price === Math.max(...WAXES.map((w) => w.price)),
    'gold leaf is the top of the ladder');
});

test('waxValue prices each ring by its own colour', () => {
  const c = P.newCandle(10, TALLOW);
  P.addWax(c, GOLDLEAF, 10, 9);
  assert.equal(P.waxValue(c), 10 * WAXES[TALLOW].price + 10 * WAXES[GOLDLEAF].price);
});
