import test from 'node:test';
import assert from 'node:assert/strict';
import { loadPure } from './harness.mjs';

const { clamp, lerp, smooth, hash, fmt, makeRng } = await loadPure();

test('clamp holds the ends', () => {
  assert.equal(clamp(5, 0, 10), 5);
  assert.equal(clamp(-1, 0, 10), 0);
  assert.equal(clamp(99, 0, 10), 10);
  /* an inverted range is a caller bug; this records what it currently does so
     a change to it is a deliberate one */
  assert.equal(clamp(5, 10, 0), 10);
});

test('lerp is exact at both ends', () => {
  assert.equal(lerp(2, 8, 0), 2);
  assert.equal(lerp(2, 8, 1), 8);
  assert.equal(lerp(2, 8, 0.5), 5);
});

/* The property that matters is the one the whole codebase relies on: the same
   real-world time produces the same movement regardless of how it is sliced
   into frames. A naive `t * rate` fails this and drifts on a 120 Hz phone. */
test('smoothing is frame-rate independent', () => {
  const step = (n, dt) => {
    let v = 0;
    for (let i = 0; i < n; i++) v += (1 - v) * smooth(6, dt);
    return v;
  };
  const at60 = step(60, 1 / 60);
  const at120 = step(120, 1 / 120);
  const at30 = step(30, 1 / 30);
  assert.ok(Math.abs(at60 - at120) < 1e-3, `60Hz ${at60} vs 120Hz ${at120}`);
  assert.ok(Math.abs(at60 - at30) < 1e-3, `60Hz ${at60} vs 30Hz ${at30}`);
});

test('smoothing never overshoots and never stalls', () => {
  assert.equal(smooth(6, 0), 0);
  /* a long frame - a backgrounded tab, a stall - must saturate at 1, never
     past it, or the value it drives springs through its target */
  assert.ok(smooth(6, 10) <= 1);
  assert.ok(smooth(6, 10) > 0.99);
  assert.ok(smooth(6, 0.5) > 0 && smooth(6, 0.5) < 1);
});

/* Every spawn decision goes through hash. If it stops being deterministic, or
   leaves its range, the forty-second golden in e2e/ stops meaning anything -
   and would fail in a way that blames the simulation instead. */
test('hash is deterministic and in range', () => {
  for (let a = -3; a < 40; a++) {
    for (let b = 0; b < 8; b++) {
      const v = hash(a, b);
      assert.equal(v, hash(a, b), `hash(${a},${b}) changed between calls`);
      assert.ok(v >= 0 && v < 1, `hash(${a},${b}) = ${v} out of range`);
    }
  }
});

test('hash separates neighbours', () => {
  /* Adjacent chunks must not land in the same bucket, or a whole ascent spawns
     the same thing over and over. */
  const buckets = new Set();
  for (let c = 0; c < 12; c++) buckets.add(Math.floor(hash(c, 1) * 8));
  assert.ok(buckets.size >= 5, `only ${buckets.size} distinct buckets in 12 chunks`);
  assert.notEqual(hash(3, 1), hash(1, 3), 'hash is symmetric in its arguments');
});

/* THE regression test on this file.

   For the whole of the game's life a signed shift kept this below 0.5, and it
   failed completely silently: brutes (`> 0.72`), punishing gates (`> 0.68`)
   and the good gate swapping sides (`> 0.5`) simply never happened, and
   `(hash() - 0.5) * width` pinned every spawn to the left half of the road.

   The lesson generalises past this game: a random source that is merely
   plausible is indistinguishable from a correct one by eye, and every mechanic
   built on it fails as absence, which is the one failure mode playtesting
   cannot see. Test the source, not the symptom. */
test('hash covers the whole unit interval, evenly', () => {
  const deciles = new Array(10).fill(0);
  let n = 0, min = 1, max = 0;
  for (let a = -400; a < 400; a++) {
    for (let b = 0; b < 60; b++) {
      const v = hash(a, b);
      deciles[Math.floor(v * 10)]++;
      if (v < min) min = v;
      if (v > max) max = v;
      n++;
    }
  }
  assert.ok(max > 0.999, `hash never returned above ${max} - a signed shift is clearing the top bit`);
  assert.ok(min < 0.001, `hash never returned below ${min}`);
  for (let d = 0; d < 10; d++) {
    const pct = (deciles[d] / n) * 100;
    assert.ok(Math.abs(pct - 10) < 1.5, `decile ${d} holds ${pct.toFixed(2)}% of samples`);
  }
});

/* Every threshold the game compares a hash against, checked against the source
   rather than against the spawn it produces. Each of these was dead. */
test('the thresholds the game actually uses can all fire', () => {
  const fires = (t) => {
    let hit = 0;
    for (let c = 0; c < 200; c++) if (hash(c, 88) > t) hit++;
    return hit;
  };
  assert.ok(fires(0.5) > 60, 'gate sides never swap');
  assert.ok(fires(0.68) > 30, 'punishing gates never appear');
  assert.ok(fires(0.72) > 25, 'brutes never spawn');
});

/* The run stream. Anything whose value decides *when* something happens - loot
   scatter velocity, axe flight time - draws from this rather than Math.random,
   or the whole-game golden flakes about one run in ten. */
test('a seeded stream replays exactly and two seeds do not', () => {
  const a = makeRng(7), b = makeRng(7), c = makeRng(8);
  const first = [], second = [], other = [];
  for (let i = 0; i < 200; i++) { first.push(a()); second.push(b()); other.push(c()); }
  assert.deepEqual(second, first, 'the same seed must replay the same stream');
  assert.notDeepEqual(other, first, 'a different seed must give a different stream');
});

test('a seeded stream is uniform and does not repeat itself', () => {
  const r = makeRng(3);
  const seen = new Set();
  const deciles = new Array(10).fill(0);
  const n = 4000;
  for (let i = 0; i < n; i++) {
    const v = r();
    assert.ok(v >= 0 && v < 1, `${v} out of range at draw ${i}`);
    seen.add(v);
    deciles[Math.floor(v * 10)]++;
  }
  /* A stream that cycles would silently make every burst identical. */
  assert.ok(seen.size > n * 0.99, `only ${seen.size} distinct values in ${n} draws`);
  for (let d = 0; d < 10; d++) {
    const pct = (deciles[d] / n) * 100;
    assert.ok(Math.abs(pct - 10) < 3, `decile ${d} holds ${pct.toFixed(1)}%`);
  }
});

test('fmt keeps the readout narrow', () => {
  assert.equal(fmt(0), '0');
  assert.equal(fmt(999), '999');
  assert.equal(fmt(1000), '1.0K');
  assert.equal(fmt(9999), '10.0K');
  assert.equal(fmt(10000), '10K');
  assert.equal(fmt(1e6), '1.0M');
  assert.equal(fmt(1e9), '1.0B');
  /* it is fed floats straight out of the run */
  assert.equal(fmt(1584.93), '1.6K');
});
