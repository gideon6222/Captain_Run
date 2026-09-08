import test from 'node:test';
import assert from 'node:assert/strict';
import { loadPure } from './harness.mjs';

const P = await loadPure();
const { T, WAXES } = P;

const CREAM = 0, AQUA = 1, GUM = 2, SUN = 3, MINT = 4;

/* Per-candle recipes are the whole game, so these are the tests that would
   have caught the previous build being wrong: a tray whose candles can differ
   is worth more than one whose candles cannot, and weaving has to be the thing
   that makes them differ. */

test('a fresh tray is n plain candles, each with its own recipe', () => {
  const t = P.newTray(5);
  assert.equal(t.length, 5);
  for (const r of t) assert.deepEqual(r.layers, [CREAM]);

  /* Separate objects, not one shared reference - the bug this whole model
     exists to prevent, and a shared reference would look identical until the
     first dip silently coloured the entire tray. */
  P.dip(t[0], AQUA);
  assert.deepEqual(t[0].layers, [CREAM, AQUA]);
  assert.deepEqual(t[1].layers, [CREAM], 'dipping one candle must not touch another');
});

test('a tray never exceeds what the renderer draws', () => {
  const t = P.newTray(T.maxCandles + 20);
  assert.equal(t.length, T.maxCandles);
  assert.equal(P.grow(t, 10), 0, 'a full tray takes no more');
});

test('candles picked up arrive plain, at the back', () => {
  /* A pickup joining with the treatments the rest of the tray already has
     would make late pickups worth more than early ones for no visible reason,
     and would reward ignoring the first half of a level. */
  const t = P.newTray(2);
  for (const r of t) { P.dip(r, AQUA); P.addGlitter(r, 2); P.press(r, 2); }
  assert.equal(P.grow(t, 3), 3);
  assert.equal(t.length, 5);
  const fresh = t[t.length - 1];
  assert.deepEqual(fresh.layers, [CREAM]);
  assert.equal(fresh.glitter, 0);
  assert.equal(fresh.mould, 0);
});

test('obstacles eat the tail, never the leader, and never past zero', () => {
  const t = P.newTray(6);
  P.dip(t[0], AQUA);                       // mark the leader
  assert.equal(P.shrink(t, 2), 2);
  assert.equal(t.length, 4);
  assert.deepEqual(t[0].layers, [CREAM, AQUA], 'the leader survives');
  assert.equal(P.shrink(t, 99), 4);
  assert.equal(t.length, 0, 'and a tray cannot go negative');
  assert.equal(P.shrink(t, 3), 0);
});

// -- the claim the whole design rests on --------------------------------------

test('weaving both pools beats holding a line through one', () => {
  /* The reference's own advice: "if there are two pools of wax side by side,
     you should swipe left and right quickly to try and dunk all of your
     candles in both of the pools". If that is not worth more than sitting in
     one pool, the steering does nothing and the game is a screensaver. */
  const held = P.newTray(12);
  for (const r of held) P.dip(r, AQUA);           // every candle, one colour

  const woven = P.newTray(12);
  woven.forEach((r, i) => { P.dip(r, AQUA); P.dip(r, i % 2 ? GUM : MINT); });

  const a = P.trayValue(held), b = P.trayValue(woven);
  assert.ok(b > a * 1.4, `weaving should pay clearly (held ${a.toFixed(0)}, woven ${b.toFixed(0)})`);
});

test('a tray of mixed quality is worth the sum of its candles, not an average', () => {
  const t = P.newTray(4);
  P.dip(t[0], AQUA); P.dip(t[0], GUM); P.addGlitter(t[0], 3); P.press(t[0], 3); P.wrapIn(t[0], 3);
  const sum = t.reduce((v, r) => v + P.candleValue(r), 0);
  assert.ok(Math.abs(P.trayValue(t) - sum) < 1e-9);
  assert.ok(P.bestCandle(t) > P.averageValue(t),
    'one great candle must show up as better than the tray average');
});

test('the stats the results screen reports match the tray it was given', () => {
  const t = P.newTray(4);
  P.dip(t[0], AQUA); P.press(t[0], 2); P.wrapIn(t[0], 1);
  P.dip(t[1], GUM); P.addGlitter(t[1], 2);
  // t[2] and t[3] left plain
  const st = P.statsOf(t, WAXES.length);

  assert.equal(st.count, 4);
  assert.equal(st.pressed, 1);
  assert.equal(st.wrapped, 1);
  assert.equal(st.plain, 2, 'candles that never got dipped are counted and named');
  assert.equal(st.avgGlitter, 0.5);
  assert.equal(st.avgColours, (2 + 2 + 1 + 1) / 4);

  assert.equal(st.palette[CREAM], 4, 'every candle has a cream core');
  assert.equal(st.palette[AQUA], 1);
  assert.equal(st.palette[GUM], 1);
  assert.equal(st.palette[SUN], 0);
});

test('an empty tray is describable without dividing by zero', () => {
  const t = P.newTray(0);
  const st = P.statsOf(t, WAXES.length);
  assert.equal(st.count, 0);
  assert.ok(Number.isFinite(st.avgColours));
  assert.ok(Number.isFinite(st.avgGlitter));
  assert.equal(P.averageValue(t), 0);
  assert.equal(P.trayValue(t), 0);
});
