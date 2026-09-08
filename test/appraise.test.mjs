import test from 'node:test';
import assert from 'node:assert/strict';
import { loadPure } from './harness.mjs';

const P = await loadPure();
const { T, MOULDS, WRAPS } = P;

const CREAM = 0, AQUA = 1, GUM = 2, SUN = 3, MINT = 4;
const OPTS = { cash: 0, earnMul: 1, priceMul: 1 };
const opt = (o) => ({ ...OPTS, ...o });

const tray = (n, treat) => {
  const t = P.newTray(n);
  if (treat) t.forEach((r, i) => treat(r, i));
  return t;
};

/* The gift table ends every level, so it is where a design mistake gets paid
   for over and over. Intent tests: each states something the game is supposed
   to be *about* and would still pass if every constant moved. */

test('the payout is the sum of the candles, plus cash, times earning power', () => {
  const t = tray(10, (r) => { P.dip(r, AQUA); P.dip(r, GUM); });
  const a = P.appraise(t, opt({ cash: 500, earnMul: 1.4, priceMul: 2 }));
  const expected = Math.floor((P.trayValue(t) * 2 + 500) * 1.4);
  assert.equal(a.value, expected);
  assert.equal(a.count, 10);
  assert.ok(Math.abs(a.each - a.candles / 10) < 1e-9);
});

test('twice the tray pays twice', () => {
  const small = P.appraise(tray(8, (r) => P.dip(r, AQUA)), opt());
  const big = P.appraise(tray(16, (r) => P.dip(r, AQUA)), opt());
  assert.ok(Math.abs(big.value / small.value - 2) < 0.02);
});

test('weaving both pools beats holding a line, at the till', () => {
  /* The economic form of the reference's own advice. If this is false the
     steering does not matter and every other system is decoration. */
  const held = P.appraise(tray(12, (r) => P.dip(r, AQUA)), opt());
  const woven = P.appraise(tray(12, (r, i) => { P.dip(r, AQUA); P.dip(r, i % 2 ? GUM : MINT); }), opt());
  assert.ok(woven.value > held.value * 1.4,
    `weaving should pay clearly (held ${held.value}, woven ${woven.value})`);
});

test('contrast beats variety that all looks the same', () => {
  const warm = P.appraise(tray(10, (r) => P.dip(r, SUN)), opt());   // cream + sunbeam, both pale
  const cool = P.appraise(tray(10, (r) => P.dip(r, GUM)), opt());   // cream + bubblegum, light vs dark
  assert.ok(cool.value > warm.value,
    `contrast should beat a matching pair (warm ${warm.value}, cool ${cool.value})`);
});

test('every station is worth visiting', () => {
  const base = P.appraise(tray(10), opt()).value;
  assert.ok(P.appraise(tray(10, (r) => P.dip(r, AQUA)), opt()).value > base, 'a wax pool');
  assert.ok(P.appraise(tray(10, (r) => P.addGlitter(r, 1)), opt()).value > base, 'glitter');
  assert.ok(P.appraise(tray(10, (r) => P.press(r, 1)), opt()).value > base, 'a press');
  assert.ok(P.appraise(tray(10, (r) => P.wrapIn(r, 1)), opt()).value > base, 'wrapping');
});

test('treating only half the tray is worth about half the bonus', () => {
  /* The property that makes partial credit real: a sweep that catches half the
     candles must not pay like a sweep that caught all of them, or there is no
     reason to keep weaving once you have clipped a pool once. */
  const none = P.appraise(tray(12), opt()).value;
  const half = P.appraise(tray(12, (r, i) => { if (i < 6) P.dip(r, GUM); }), opt()).value;
  const all = P.appraise(tray(12, (r) => P.dip(r, GUM)), opt()).value;
  const gotHalf = half - none, gotAll = all - none;
  assert.ok(gotHalf > 0, 'half a tray treated must be worth something');
  assert.ok(Math.abs(gotHalf / gotAll - 0.5) < 0.02,
    `half the tray should be half the bonus, got ${(gotHalf / gotAll).toFixed(3)}`);
});

test('an empty tray still pays something', () => {
  const a = P.appraise(P.newTray(0), opt());
  assert.ok(a.value >= 1, `a wiped tray must still pay, got ${a.value}`);
  assert.equal(a.stars, 0);
  assert.equal(a.each, 0);
});

test('stars describe the tray, not the level it was sold in', () => {
  /* The same tray carried to a later level is worth more coins because that
     level pays more - but it is the same tray, so it must earn the same stars.
     Getting this divisor wrong is invisible and permanent. */
  const t = tray(14, (r, i) => { P.dip(r, AQUA); P.dip(r, i % 2 ? GUM : MINT); P.addGlitter(r, 1); });
  const first = P.appraise(t, opt());
  for (const lvl of [2, 4, 7]) {
    const a = P.appraise(t, opt({ priceMul: P.priceFor(lvl) }));
    assert.equal(a.stars, first.stars, `level ${lvl} rated the same tray differently`);
    assert.ok(a.value > first.value, 'though it must still pay more coins');
  }
});

test('all four star ratings are reachable', () => {
  /* The sweep has to reach as far as a good run actually does, or it decides
     `par` by accident: it used to top out at 27 candles and three dips, which
     is short of the 30 candles and ~3.8 colours a weaving bot brings home, so
     raising par to the measured number made three stars look unreachable when
     it was only unreachable *inside the sweep*. */
  const seen = new Set();
  for (const n of [0, 2, 6, 12, 20, T.maxCandles]) {
    for (const dips of [0, 1, 2, 3, 5, T.maxLayers]) {
      for (const m of [0, MOULDS.length - 1]) {
        for (const w of [0, WRAPS.length - 1]) {
          const cols = [AQUA, GUM, MINT, SUN];
          const t = tray(n, (r) => {
            for (let d = 0; d < dips; d++) P.dip(r, cols[d % cols.length]);
            P.addGlitter(r, 3); P.press(r, m); P.wrapIn(r, w);
          });
          seen.add(P.appraise(t, opt()).stars);
        }
      }
    }
  }
  for (const s of [0, 1, 2, 3]) {
    assert.ok(seen.has(s), `no tray in the sweep ever earned ${s} stars`);
  }
});

test('three stars is a real standard, not a participation award', () => {
  const opening = P.appraise(tray(P.startCandles(P.DEF_UP)), opt());
  assert.ok(opening.stars < 2, `an untouched opening tray rated ${opening.stars} stars`);
});
