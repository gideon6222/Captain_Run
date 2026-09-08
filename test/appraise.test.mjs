import test from 'node:test';
import assert from 'node:assert/strict';
import { loadPure } from './harness.mjs';

const P = await loadPure();
const { T } = P;

const TALLOW = 0, CRIMSON = 1, VERDIGRIS = 2, AMBER = 4, GOLDLEAF = 5;
const OPTS = { delivered: true, valueMul: 1, priceMul: 1 };
const opt = (o) => ({ ...OPTS, ...o });

/* The appraisal is the end of every run, so it is where a design mistake gets
   paid for over and over. These are intent tests: each one states something
   the game is supposed to be *about* and would still pass if every constant
   moved. */

function build(pairs) {
  const c = P.newCandle(T.coreWax, pairs[0][0]);
  c[0].amt = pairs[0][1];
  for (let i = 1; i < pairs.length; i++) P.addWax(c, pairs[i][0], pairs[i][1], 9);
  return c;
}

test('a varied candle beats a fat plain one of the same wax', () => {
  /* This is the single most important claim the economy makes. If it is false,
     every dip arch collapses into "take the bigger number" and the colour
     system is decoration. */
  const plain = build([[TALLOW, 36]]);
  const varied = build([[TALLOW, 12], [CRIMSON, 12], [VERDIGRIS, 12]]);
  assert.equal(P.totalWax(plain), P.totalWax(varied), 'same wax, fair comparison');

  const a = P.appraise(plain, opt()), b = P.appraise(varied, opt());
  assert.ok(b.value > a.value * 1.3,
    `variety should pay clearly (plain ${a.value}, varied ${b.value})`);
});

test('and contrast beats variety that all looks the same', () => {
  const warm = build([[TALLOW, 12], [AMBER, 12], [GOLDLEAF, 12]]);
  const cool = build([[TALLOW, 12], [CRIMSON, 12], [VERDIGRIS, 12]]);
  const a = P.appraise(warm, opt()), b = P.appraise(cool, opt());

  assert.equal(a.colours, b.colours, 'both are three colours');
  assert.ok(a.bulk > b.bulk, 'and the warm one is made of pricier wax');
  assert.ok(b.value > a.value,
    `contrast should beat raw material (warm ${a.value}, cool ${b.value})`);
});

test('bulk still matters: twice the wax is worth clearly more', () => {
  const small = build([[TALLOW, 10], [CRIMSON, 10]]);
  const big = build([[TALLOW, 20], [CRIMSON, 20]]);
  assert.ok(P.appraise(big, opt()).value > P.appraise(small, opt()).value * 1.5,
    'a bigger candle of the same design must be worth more');
});

test('a crooked candle is cheaper, and never worthless', () => {
  const clean = build([[TALLOW, 14], [CRIMSON, 14]]);
  const bent = build([[TALLOW, 14], [CRIMSON, 14]]);
  for (const l of bent) l.lop = 1;

  const a = P.appraise(clean, opt()), b = P.appraise(bent, opt());
  assert.ok(b.value < a.value, 'lopsidedness costs');
  assert.equal(b.purity.toFixed(4), T.purityFloor.toFixed(4), 'and bottoms out at the floor');
  assert.ok(b.value > a.value * 0.4, 'but a wonky candle is still a candle');
});

test('running out of wick is expensive and survivable', () => {
  const c = build([[TALLOW, 14], [CRIMSON, 14]]);
  const there = P.appraise(c, opt({ delivered: true }));
  const short = P.appraise(c, opt({ delivered: false }));
  assert.ok(short.value < there.value * 0.7, 'the bench is worth reaching');
  assert.ok(short.value > there.value * 0.4, 'but the run is not wiped');
});

test('the worst possible candle still pays something', () => {
  /* A run that pays zero is a run the player cannot recover from, and the game
     has no other income. */
  const stub = P.newCandle(0);
  const a = P.appraise(stub, opt());
  assert.ok(a.value >= 1, `a bare core must still sell, got ${a.value}`);
  assert.equal(a.grade, 'STUB');
});

test('a grade describes the candle, not the workshop it was sold in', () => {
  /* The same candle carried to a later bench is worth more coins because that
     bench pays more per unit - but it is the same candle, so it must grade the
     same. Getting this divisor wrong is invisible and permanent: grades would
     drift upward for free as the player climbed. */
  const c = build([[TALLOW, 14], [CRIMSON, 14], [VERDIGRIS, 14]]);
  for (const lvl of [1, 2, 4, 7]) {
    const a = P.appraise(c, opt({ priceMul: P.priceFor(lvl) }));
    assert.equal(a.grade, P.appraise(c, opt()).grade,
      `workshop ${lvl} graded the same candle differently`);
  }
  assert.ok(P.appraise(c, opt({ priceMul: P.priceFor(4) })).value >
            P.appraise(c, opt()).value, 'a later workshop still pays more coins');
});

test('GRADES descends, or gradeFor returns the wrong band', () => {
  for (let i = 1; i < P.GRADES.length; i++) {
    assert.ok(P.GRADES[i].at < P.GRADES[i - 1].at, 'thresholds must descend');
  }
});

test('every grade is reachable', () => {
  /* A grade nobody can ever be awarded is a lie on the results screen, and it
     is exactly the kind of thing that survives for a game's whole life. */
  const seen = new Set();
  for (let wax = 0; wax <= 120; wax += 2) {
    for (const spread of [1, 2, 3, 5]) {
      const per = wax / spread;
      const cols = [CRIMSON, VERDIGRIS, GOLDLEAF, TALLOW, AMBER];
      const c = P.newCandle(Math.max(T.minCore, per), TALLOW);
      for (let i = 1; i < spread; i++) P.addWax(c, cols[i % cols.length], per, 9);
      seen.add(P.appraise(c, opt()).grade);
    }
  }
  for (const g of P.GRADES) {
    assert.ok(seen.has(g.g), `no candle in the sweep ever graded ${g.g}`);
  }
});

test('the appraisal reports the parts it actually charged for', () => {
  /* The results screen counts these up one at a time. If the reported parts do
     not reconstruct the reported total, the screen is telling the player a
     story about a number it did not compute - which is worse than showing no
     breakdown at all. */
  const c = build([[TALLOW, 12], [CRIMSON, 12], [VERDIGRIS, 8]]);
  const a = P.appraise(c, opt({ valueMul: 1.3 }));
  assert.equal(a.craft, 1 + a.layerMul + a.contrastMul);
  const rebuilt = Math.floor(a.bulk * a.craft * a.purity * a.delivered * 1.3);
  assert.equal(a.value, Math.max(1, rebuilt));
  assert.equal(a.wax, P.totalWax(c));
  assert.equal(a.colours, 3);
  assert.equal(a.pairs, P.contrastPairs(c));
});
