import test from 'node:test';
import assert from 'node:assert/strict';
import { loadPure } from './harness.mjs';

const P = await loadPure();
const { T, MOULDS, WRAPS } = P;

const CREAM = 0, AQUA = 1, GUM = 2, SUN = 3, MINT = 4;
const OPTS = { count: 10, cash: 0, earnMul: 1, priceMul: 1 };
const opt = (o) => ({ ...OPTS, ...o });

const recipe = (cols = [], glitter = 0, mould = 0, wrap = 0) => {
  const r = P.newRecipe();
  for (const c of cols) P.dip(r, c);
  P.addGlitter(r, glitter); P.press(r, mould); P.wrapIn(r, wrap);
  return r;
};

/* The gift table ends every level, so it is where a design mistake gets paid
   for over and over. These are intent tests: each states something the game is
   supposed to be *about*, and would still pass if every constant moved. */

test('both axes matter: twice the stack pays twice, and so does twice the craft', () => {
  const plain = recipe();
  const fancy = recipe([AQUA, GUM], 2, 2, 2);

  const small = P.appraise(plain, opt({ count: 10 }));
  const big = P.appraise(plain, opt({ count: 20 }));
  assert.ok(Math.abs(big.value / small.value - 2) < 0.02,
    'doubling the stack must double the payout exactly');

  const good = P.appraise(fancy, opt({ count: 10 }));
  assert.ok(good.value > small.value * 2,
    'and craftsmanship must be worth at least as much as bulk');
});

test('a varied tray beats a plain one of the same stack size', () => {
  /* The most important claim the economy makes. If it is false, every vat
     collapses into "drive through whatever" and colour is decoration. */
  const plain = P.appraise(recipe(), opt());
  const varied = P.appraise(recipe([GUM, MINT, AQUA]), opt());
  assert.ok(varied.value > plain.value * 1.8,
    `variety should pay clearly (plain ${plain.value}, varied ${varied.value})`);
});

test('contrast beats variety that all looks the same', () => {
  const warm = P.appraise(recipe([SUN]), opt());       // cream + sunbeam, both pale warm
  const cool = P.appraise(recipe([GUM]), opt());       // cream + bubblegum, light vs dark
  assert.equal(warm.colours, cool.colours, 'both are two colours');
  assert.ok(cool.value > warm.value,
    `contrast should beat a matching pair (warm ${warm.value}, cool ${cool.value})`);
});

test('every station is worth visiting', () => {
  const base = P.appraise(recipe(), opt()).value;
  assert.ok(P.appraise(recipe([AQUA]), opt()).value > base, 'a wax vat');
  assert.ok(P.appraise(recipe([], 1), opt()).value > base, 'glitter');
  assert.ok(P.appraise(recipe([], 0, 1), opt()).value > base, 'a press');
  assert.ok(P.appraise(recipe([], 0, 0, 1), opt()).value > base, 'wrapping');
});

test('wrapping is the biggest single multiplier, since it is last and riskiest', () => {
  const r = recipe([AQUA, GUM]);
  const bare = P.appraise(r, opt());
  const luxe = P.appraise(recipe([AQUA, GUM], 0, 0, WRAPS.length - 1), opt());
  assert.ok(luxe.value > bare.value * 2,
    'the station at the end of the runway has to be worth carrying a full stack to');
});

test('cash picked up on the way is added before earning power, not after', () => {
  const r = recipe([AQUA]);
  const noCash = P.appraise(r, opt({ cash: 0, earnMul: 2 }));
  const cash = P.appraise(r, opt({ cash: 500, earnMul: 2 }));
  assert.equal(cash.value - noCash.value, 1000,
    'earning power must multiply banknotes too, or the reach upgrade is a trap');
});

test('an empty tray still pays something', () => {
  /* A level that pays zero is one the player cannot recover from, and there is
     no other income in the game. */
  const a = P.appraise(recipe(), opt({ count: 0 }));
  assert.ok(a.value >= 1, `a wiped stack must still pay, got ${a.value}`);
  assert.equal(a.stars, 0);
});

test('stars describe the tray, not the workshop it was sold in', () => {
  /* The same tray carried to a later workshop is worth more coins because that
     workshop pays more - but it is the same tray, so it must earn the same
     stars. Getting this divisor wrong is invisible and permanent: ratings
     would drift upward for free as the player climbed. */
  const r = recipe([AQUA, GUM, MINT], 2, 2, 1);
  const first = P.appraise(r, opt());
  for (const lvl of [2, 4, 7]) {
    const a = P.appraise(r, opt({ priceMul: P.priceFor(lvl) }));
    assert.equal(a.stars, first.stars, `workshop ${lvl} rated the same tray differently`);
    assert.ok(a.value > first.value, 'though it must still pay more coins');
  }
});

test('all four star ratings are reachable', () => {
  const seen = new Set();
  const cols = [[], [AQUA], [AQUA, GUM], [AQUA, GUM, MINT], [AQUA, GUM, MINT, SUN]];
  for (const count of [0, 1, 4, 10, 18, 26]) {
    for (const c of cols) {
      for (const m of [0, MOULDS.length - 1]) {
        for (const w of [0, WRAPS.length - 1]) {
          seen.add(P.appraise(recipe(c, 3, m, w), opt({ count })).stars);
        }
      }
    }
  }
  for (const s of [0, 1, 2, 3]) {
    assert.ok(seen.has(s), `no tray in the sweep ever earned ${s} stars`);
  }
});

test('three stars is a real standard, not a participation award', () => {
  /* A bare tray of the starting size must not already be three stars, or the
     rating says nothing on the very first level. */
  const opening = P.appraise(recipe(), opt({ count: P.startCandles(P.DEF_UP) }));
  assert.ok(opening.stars < 2, `an untouched opening tray rated ${opening.stars} stars`);
});

test('the results screen can reconstruct the total it displays', () => {
  const r = recipe([AQUA, GUM], 2, 1, 1);
  const a = P.appraise(r, opt({ count: 12, cash: 300, earnMul: 1.4 }));
  const craft = a.layerMul * a.contrastMul * a.glitterMul * a.mouldMul * a.wrapMul;
  assert.ok(Math.abs(a.craft - craft) < 1e-9, 'craft must be the product of its parts');
  assert.ok(Math.abs(a.candles - a.each * a.count) < 1e-6);
  assert.equal(a.value, Math.max(1, Math.floor((a.candles + a.cash) * 1.4)));
});
