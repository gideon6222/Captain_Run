/* The stack: a line of candles that follows the leader along its own path.

   This is the mechanic the whole game turns on, and it is the reason a bigger
   stack is a real decision rather than a number that only goes up. The candles
   do not cluster around the player - each one sits a fixed distance *behind*
   the leader measured along the route the leader actually drove, so the tail
   is still going where the front went a second ago. Swerve late and you clear
   the obstacle yourself and drag half your stack through it.

   Pure and testable: a ring buffer of samples in, a list of positions out. No
   three.js, no run state. The e2e suite drives the real game for the feel; the
   unit tests here pin the properties that make the feel possible - that the
   tail genuinely lags, that it never teleports, and that a long stack lags
   more than a short one. */

import { T } from './tuning.js';

export interface Trail {
  xs: Float64Array;
  zs: Float64Array;
  ds: Float64Array;   // cumulative distance travelled at each sample
  head: number;       // index of the newest sample
  n: number;          // how many samples are live (up to capacity)
}

export function newTrail(cap = T.trailSamples): Trail {
  return {
    xs: new Float64Array(cap), zs: new Float64Array(cap), ds: new Float64Array(cap),
    head: -1, n: 0,
  };
}

/* Seed the buffer so the stack starts as a line rather than materialising.

   Without this every candle reads the same sample on frame one, the whole
   stack is stacked inside the leader, and it visibly explodes outward over the
   first half second - which looks like a bug and is the first thing the player
   ever sees. */
export function seedTrail(t: Trail, x: number, z: number): void {
  t.head = -1; t.n = 0;
  const span = T.trailGap * (Math.ceil(T.maxCandles / T.rowWidth) + 4);
  const steps = 140;
  for (let i = steps; i >= 0; i--) push(t, x, z - (i / steps) * span);
}

export function push(t: Trail, x: number, z: number): void {
  const cap = t.xs.length;
  if (t.head >= 0) {
    const dx = x - t.xs[t.head], dz = z - t.zs[t.head];
    const step = Math.sqrt(dx * dx + dz * dz);
    /* Sub-millimetre samples are noise that fills the buffer and shortens how
       far back it can remember, which silently shrinks the maximum stack. */
    if (step < 0.02) return;
    const nd = t.ds[t.head] + step;
    t.head = (t.head + 1) % cap;
    t.ds[t.head] = nd;
  } else {
    t.head = 0;
    t.ds[0] = 0;
  }
  t.xs[t.head] = x;
  t.zs[t.head] = z;
  if (t.n < cap) t.n++;
}

export const travelled = (t: Trail): number => (t.head < 0 ? 0 : t.ds[t.head]);

/* Where the leader was `back` units of travel ago, interpolated between the
   two samples that straddle it.

   Walks backwards from the head rather than binary-searching: the buffer is
   ordered by distance but wraps, and a stack asks for at most 26 positions per
   frame off a head that moves a few samples per frame, so a linear walk is
   both simpler and faster than getting the wrap arithmetic wrong. */
export function sampleBack(t: Trail, back: number, out: { x: number; z: number }): void {
  const cap = t.xs.length;
  if (t.head < 0) { out.x = 0; out.z = 0; return; }
  const want = t.ds[t.head] - Math.max(0, back);
  let i = t.head;
  for (let k = 0; k < t.n - 1; k++) {
    const prev = (i - 1 + cap) % cap;
    if (t.ds[prev] <= want) {
      const span = t.ds[i] - t.ds[prev];
      const f = span > 1e-9 ? (want - t.ds[prev]) / span : 0;
      out.x = t.xs[prev] + (t.xs[i] - t.xs[prev]) * f;
      out.z = t.zs[prev] + (t.zs[i] - t.zs[prev]) * f;
      return;
    }
    i = prev;
  }
  /* Older than anything remembered: hold the oldest sample. */
  out.x = t.xs[i]; out.z = t.zs[i];
}

/* How far behind the leader candle `i` rides.

   Keyed on the ROW, not the candle: three candles abreast are all the same
   distance back. */
export const rowOf = (i: number): number => Math.floor(i / T.rowWidth);
export const backFor = (i: number): number => rowOf(i) * T.trailGap;

/* Fill `out` with a position per candle, front row first.

   The row follows the leader's recorded path and the candle is offset sideways
   within it, which is what keeps a wide tray lagging exactly like a narrow one
   while still showing the player more than one candle's worth of colour. */
export function layout(t: Trail, count: number, out: { x: number; z: number }[]): number {
  const n = Math.min(count, T.maxCandles);
  while (out.length < n) out.push({ x: 0, z: 0 });
  const mid = (T.rowWidth - 1) / 2;
  for (let i = 0; i < n; i++) {
    sampleBack(t, backFor(i), out[i]);
    out[i].x += ((i % T.rowWidth) - mid) * T.rowGap;
  }
  return n;
}

/* Obstacles eat the stack from the BACK.

   Losing the tail rather than the head is the only version that reads
   correctly: the leader is the thing the thumb is steering and having it
   vanish mid-corner feels like the game took the controls away, while the tail
   is exactly what the player failed to think about. It also means the stack
   shortens toward agility as it takes damage, which is a mercy the player can
   feel rather than be told about. */
export const takeFromStack = (count: number, take: number): number =>
  Math.max(0, count - Math.max(0, take));
