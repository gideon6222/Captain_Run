/* Small pure helpers. No three.js, no DOM, no game state - so they can be
   imported by a node test without a browser. */

export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/* Frame-rate independent smoothing.

   `pos += (target - pos) * 0.1` looks fine at 60fps and is a different spring
   at 120, which is what the phone actually runs at. This is the fix: the
   fraction to move this frame, given a rate and a real dt. See CRAFT.md in
   gamedev-notes. */
export const smooth = (rate: number, dt: number) => 1 - Math.exp(-rate * dt);

/* Deterministic 2D hash, uniform over [0,1).

   Every spawn decision goes through this rather than Math.random, which is
   what makes a whole run reproducible from (chunk, ascent) alone - and is what
   the forty-second golden test in e2e/ depends on. Nothing that affects game
   state may use Math.random.

   Two details are load-bearing and both were wrong for the game's whole life:

   `>>>`, not `>>`. A signed shift sign-extends, so `h ^ (h >> 16)` always
   cleared the top bit and the function returned [0, 0.5) - measured max
   0.499999 over 800,000 samples. Nothing errored. It silently disabled every
   mechanic gated on a threshold above a half: brutes (`> 0.72`) never spawned,
   punishing gates (`> 0.68`) never appeared so every choice was between two
   good options, and the good gate never swapped sides (`> 0.5`) so the correct
   lane was always the same one. Anything placed with `(hash() - 0.5) * width`
   also came out negative every time, which pinned enemies, crates and shrines
   to the left half of the road.

   `Math.imul`, not `*`. A 32-bit value times a 31-bit constant is ~2^62, well
   past the 2^53 an IEEE double holds exactly, so the low bits - the ones the
   next xor-shift mixes back down - were being rounded away before they were
   used. imul does the multiply the mixing step assumes. */
export function hash(a: number, b: number): number {
  let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/* Compact numbers for the HUD. Thousands keep one decimal until they reach
   five figures, so the width of the readout stays roughly still while the
   number climbs. */
export function fmt(n: number): string {
  n = Math.floor(n);
  if (n < 1000) return '' + n;
  if (n < 1e6) return (n / 1e3).toFixed(n < 1e4 ? 1 : 0) + 'K';
  if (n < 1e9) return (n / 1e6).toFixed(n < 1e7 ? 1 : 0) + 'M';
  return (n / 1e9).toFixed(1) + 'B';
}
