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

test('a seeded trail starts as rows behind the leader, not a pile', () => {
  const t = P.newTrail();
  P.seedTrail(t, 0, 0);
  const out = [];
  P.layout(t, 9, out);

  // three abreast: a row shares one distance back and spreads across x
  assert.equal(out[0].z, out[1].z, 'a row shares one distance back');
  assert.equal(out[1].z, out[2].z);
  assert.ok(out[0].x < out[1].x && out[1].x < out[2].x, 'and spreads across the tray');
  assert.ok(Math.abs(out[1].x) < 1e-9, 'centred on the leader path');

  /* If this fails the whole tray is inside the leader on frame one and visibly
     explodes outward over the first half second - the first thing a player
     ever sees. */
  const gap = out[0].z - out[ROW()].z;
  assert.ok(Math.abs(gap - T.trailGap) < 0.05, `row spacing should be trailGap, got ${gap}`);
  for (let r = 1; r * ROW() < 9; r++) {
    assert.ok(out[r * ROW()].z < out[(r - 1) * ROW()].z, `row ${r} must sit behind row ${r - 1}`);
  }
});

test('the tray is wider than one candle but still fits the runway', () => {
  /* Single file was the first attempt and it is unreadable: every candle hides
     behind the one in front, so a tray of twenty-six showed the player one
     candle's worth of colour. */
  const t = P.newTrail();
  P.seedTrail(t, 0, 0);
  const out = [];
  P.layout(t, T.maxCandles, out);
  let maxOff = 0;
  for (const p of out) maxOff = Math.max(maxOff, Math.abs(p.x));
  assert.ok(maxOff > 0.2, 'the tray must be more than one candle wide');
  assert.ok(maxOff <= T.roadW / 2,
    'and a tray on the centre line must not already hang off the runway');
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
  const nearCentre = out[ROW() + 1].x;                 // second row, centre
  const farCentre = out[T.maxCandles - ROW() + 1].x;   // last row, centre
  assert.ok(farCentre < nearCentre,
    'more candles must mean more of them still on the old line');
});

test('candles in a row lag identically, so a row is a rank not a smear', () => {
  const t = P.newTrail();
  P.seedTrail(t, 0, 0);
  for (let z = 0; z < 20; z += 0.25) P.push(t, 0, z);
  for (let z = 20; z < 23; z += 0.25) P.push(t, 2, z);
  const out = [];
  P.layout(t, 9, out);
  for (let r = 0; r * ROW() < 9; r++) {
    const a = out[r * ROW()], b = out[r * ROW() + ROW() - 1];
    assert.equal(a.z, b.z, `row ${r} must share one z`);
    assert.ok(Math.abs((b.x - a.x) - (ROW() - 1) * T.rowGap) < 1e-9,
      `row ${r} must keep its width through a turn`);
  }
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
