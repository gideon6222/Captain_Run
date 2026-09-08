import test from 'node:test';
import assert from 'node:assert/strict';
import { loadPure } from './harness.mjs';

const P = await loadPure();
const { T } = P;

const ROW = () => T.rowWidth;

/* The trailing tray is the mechanic the game turns on, so these tests pin the
   properties that make it feel like anything: that the back genuinely lags
   behind the front, that a longer tray lags further, and that nothing ever
   teleports. Get any of those wrong and the tray is a decoration that follows
   the player exactly - which is a crowd, a different and worse game. */

test('a seeded trail starts as a loaf behind the leader, not a pile', () => {
  const t = P.newTrail();
  P.seedTrail(t, 0, 0);
  const out = [];
  P.layout(t, 9, out);

  /* One candle per row now: the candle itself lies ACROSS the lane, so the
     loaf is a single file of wide slabs rather than three narrow ones abreast.
     Every candle therefore sits at its own distance back. */
  assert.equal(T.rowWidth, 1, 'the loaf is single file - the candles are what is wide');
  for (let i = 1; i < 9; i++) {
    assert.ok(out[i].z < out[i - 1].z, `candle ${i} must sit behind candle ${i - 1}`);
    assert.ok(Math.abs(out[i].x - out[i - 1].x) < 1e-9, 'and on the same line');
  }

  /* If this fails the whole loaf is inside the leader on frame one and visibly
     explodes outward over the first half second - the first thing a player
     ever sees. */
  const gap = out[0].z - out[1].z;
  assert.ok(Math.abs(gap - T.trailGap) < 0.05, `spacing should be trailGap, got ${gap}`);
});

test('the loaf is long enough to matter, and a candle spans the lane', () => {
  /* The readability that three-abreast rows used to provide now comes from the
     candle being wide: you look down the top faces of a long loaf, so every
     candle's colour is on screen at once. */
  const t = P.newTrail();
  P.seedTrail(t, 0, 0);
  const out = [];
  P.layout(t, T.maxCandles, out);
  const len = out[0].z - out[out.length - 1].z;
  assert.ok(len > T.poolLen * 0.8,
    `a full loaf (${len.toFixed(1)}) should be comparable to a pool (${T.poolLen})`);

  const r = P.newRecipe();
  const across = P.candleHeight(r);
  assert.ok(across > T.laneClamp * 0.5, 'a candle must be a real fraction of the lane wide');
  assert.ok(across < T.roadW, 'but must not be wider than the runway');
});

test('the back lags: it is where the leader was, not where the leader is', () => {
  const t = P.newTrail();
  P.seedTrail(t, 0, 0);
  // drive straight, then hard right
  for (let z = 0; z < 24; z += 0.25) P.push(t, 0, z);
  for (let z = 24; z < 28; z += 0.25) P.push(t, 3, z);

  const out = [];
  P.layout(t, T.maxCandles, out);
  // compare row centres, so the lateral offset within a row does not muddy it
  assert.ok(Math.abs(out[1].x - 3) < 0.05, 'the front row has committed to the swerve');
  assert.ok(out[T.maxCandles - 2].x < 1.5,
    `the back of the tray must still be on the old line, got x=${out[T.maxCandles - 2].x}`);
});

test('a longer tray lags further, which is the whole trade', () => {
  const t = P.newTrail();
  P.seedTrail(t, 0, 0);
  for (let z = 0; z < 30; z += 0.25) P.push(t, 0, z);
  for (let z = 30; z < 33; z += 0.25) P.push(t, 2.5, z);

  const out = [];
  P.layout(t, T.maxCandles, out);
  assert.ok(out[T.maxCandles - 1].x < out[1].x,
    'more candles must mean more of them still on the old line');
});

test('positions are continuous - nothing teleports between frames', () => {
  const t = P.newTrail();
  P.seedTrail(t, 0, 0);
  const a = [], b = [];
  for (let z = 0; z < 12; z += 0.2) P.push(t, Math.sin(z * 0.4) * 2, z);
  P.layout(t, 12, a);
  const snapshot = a.map((p) => ({ ...p }));
  P.push(t, Math.sin(12 * 0.4) * 2, 12.2);
  P.layout(t, 12, b);
  for (let i = 0; i < 12; i++) {
    const d = Math.hypot(b[i].x - snapshot[i].x, b[i].z - snapshot[i].z);
    assert.ok(d < 0.6, `candle ${i} jumped ${d.toFixed(3)} in one 0.2-unit step`);
  }
});

test('sampling further back than the trail remembers holds the oldest point', () => {
  const t = P.newTrail();
  P.push(t, 5, 5);
  const out = { x: 0, z: 0 };
  P.sampleBack(t, 9999, out);
  assert.equal(out.x, 5);
  assert.equal(out.z, 5);
});

test('near-identical samples are dropped so the buffer keeps its memory', () => {
  /* Sub-millimetre samples would fill the ring buffer with noise and silently
     shorten how far back it can remember, which shortens the maximum tray. */
  const t = P.newTrail();
  P.push(t, 0, 0);
  for (let i = 0; i < 500; i++) P.push(t, 0, 0.001 * i);
  assert.ok(t.n < 60, `buffer took ${t.n} samples from 500 tiny steps`);
});

test('the layout never returns more candles than the renderer draws', () => {
  const t = P.newTrail();
  P.seedTrail(t, 0, 0);
  const out = [];
  const n = P.layout(t, 9999, out);
  assert.equal(n, T.maxCandles, 'the HUD count must never promise what is not drawn');
});

test('obstacles eat the tail, never the leader, and never past zero', () => {
  assert.equal(P.takeFromStack(10, 3), 7);
  assert.equal(P.takeFromStack(2, 5), 0, 'a tray cannot go negative');
  assert.equal(P.takeFromStack(6, 0), 6);
});
