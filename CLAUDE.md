# Candle Gift

A candle-factory runner. Steer a tray of candles down a runway floating in open sky, pick a
side at every gantry — a wax vat, a glitter sprinkler, a press or a bow — dodge the barriers
and saws that knock candles off the back, sweep up the banknotes, and sell the tray at the
gift table.

Modelled closely on **Candle Gift** by Rollic Games (`com.TwoPageGames.CandleGift`, 2022),
at Gideon's request, from screenshots his girlfriend sent and from the game's own strategy
guide. See `NOTES.md` for what was taken from it and what was invented.

Live: **https://gideon6222.github.io/Captain_Run/**
Repo: github.com/gideon6222/Captain_Run
Target: Samsung S26 Ultra, Chrome, portrait, installed to the home screen.

> **The repo name is historical.** It held Captain Run, a viking crowd-runner, through
> v0.3.0; then Wick, a candle-dipping runner, at v1.0.0; and this from v2.0.0. Nothing in
> the build depends on the name (`base: './'`), so renaming it on GitHub is safe whenever
> Gideon wants. Until then, `Captain_Run` in a path or URL means Candle Gift.

**Read `C:\dev\gamedev-notes` first** — `SKILL.md` (process), `PIPELINE.md` (stack, shipping,
measured limits), `CRAFT.md` (design lessons, several drawn from this repo), `ASSETS.md`,
`PLAYTESTS.md`.

---

## Stack

Vite 5 with `base: './'`, three.js pinned to 0.166.0 in its own chunk, `vite-plugin-pwa`
generating the service worker, TypeScript for the pure layer, Playwright against the
production build, node unit tests, a per-chunk bundle size guard, and CI that runs all of it
before deploying to Pages.

```bash
npm run dev        # play it locally
npm test           # unit tests over the pure modules (node --test + esbuild)
npm run typecheck  # tsc over src, then over e2e and test
npm run e2e        # Playwright against the real build
npm run size       # bundle size guard, fails in both directions
```

`node` is not on `PATH` in every shell here; it lives at `C:\Program Files\nodejs`.

## Files

| File | What it is |
|---|---|
| `index.html` | Shell: all CSS, HUD, workshop screen, results card, error overlay, SW registration |
| `src/main.js` | The game: renderer, stations, spawning, simulation, shop, boot |
| `src/stack.ts` | **The trailing tray.** Path history and the row layout that lags behind it |
| `src/candle.ts` | The recipe — bands, glitter, mould, wrap — and the geometry derived from it |
| `src/appraise.ts` | What a tray is worth at the gift table, and the star rating |
| `src/tuning.ts` | `T`, waxes, moulds, wraps, workshops, upgrades, derived stats |
| `src/util.ts` | `clamp`, `lerp`, `smooth`, `hash`, `fmt`, `makeRng` |
| `src/save.ts` | The one localStorage key (`candlegift.v1`), and a defensive loader |
| `src/sfx.ts` | The whole audio graph, synthesised, built on first gesture |
| `src/gfx.ts` | Toon materials, inverted-hull outlines, the instanced `Layer` |
| `src/changelog.js` | `VERSION` and the patch notes shown in the workshop |
| `e2e/smoke.spec.ts` | 24 tests against the built game, including the thirty-second golden |
| `NOTES.md` | Design decisions, tuning as shipped, and what to do next |

## The two axes

Everything in the game is one of these, and they never interfere:

- **How many candles** — gates add (`+N` / `x2`), obstacles knock them off the back.
- **What each one is worth** — the stations, which treat the whole tray at once.

That separation is why both stay readable. Obstacles cannot quietly change quality and
stations cannot quietly change count, so the HUD can show one number for each and the
results screen can multiply them.

## Invariants

- **The tray trails the leader along its own recorded path.** `stack.ts` keeps a ring buffer
  of where the leader has been; row *r* sits `r × trailGap` back **along that path**, not
  behind the leader in a straight line. A long tray therefore has to be steered early,
  because the back is still going where the front went a second ago — which is the mechanic
  the reference game is built on and the reason a bigger tray is a trade rather than free.
  **Obstacles test every candle, not the leader**, or the whole thing is decoration.
- **The silhouette is derived from the recipe, never stored beside it.** Bands, radius,
  height and value are all functions of the same object, so the candles on screen cannot
  disagree with the candles being paid for.
- **A candle is a layer cake, not an onion.** Dips are *horizontal bands stacked up* the
  candle, newest on top. Modelled as concentric shells — which is what dipping physically
  does — the outermost band hides every band inside it and five dips render as a plain
  cylinder. The HUD chips are drawn in the same order, so the two never need reconciling.
- **Nothing that affects game state may use `Math.random`.** Place-keyed decisions go through
  `hash(a, b)` seeded on (chunk, level); everything else draws from `rnd`. Cosmetic jitter —
  confetti scatter, cloud shapes, camera shake — stays on `Math.random` deliberately. The
  trap is that "cosmetic" is not obvious: a banknote's position decides when it comes within
  magnet reach, which decides how much cash is banked before the next barrier. **Anything
  that decides *when* is simulation.**
- **World +x is screen LEFT.** The camera sits behind the tray looking along `+z`, which is a
  180° turn about Y — measured, not assumed: world +2 projects to NDC −0.31. So the drag
  handler subtracts. The first game on this stack mapped it the obvious way and shipped
  inverted steering for its whole life, because every test drove `steer()` in world
  coordinates. `dragging right moves the tray right` in e2e drives real pointer events.
- **A `PlaneGeometry` faces `+z`, and this camera looks along `+z`.** Any flat thing added to
  the world shows the player its back: culled by `FrontSide`, mirrored if you "fix" it with
  `DoubleSide`. Rotate it `Math.PI` about Y. When something renders as nothing, enumerate
  what you did *not* configure.
- **Anything the player must reach or dodge goes through `laneX`**, which places inside
  `laneClamp` — not across the road mesh, which is deliberately wider.
- **Any `reset → push → flush` render path will eventually lose its flush and fail silently.**
  Assert `mesh.count` against the model; `e2e` does, including that only the *pressed* mould's
  band layer draws anything.
- **Use `requestAnimationFrame` to draw, never to undo.**
- **`freeze()` before `advance()` in any harness**, or every recorded number moves with the
  machine.
- **Seeding or clearing the save needs `Storage.prototype.setItem` frozen first**, or the
  outgoing page writes live state back over it on reload.

## Numbers that are calibrated, not chosen

- **`par: 9100` and `STAR_AT = [0.30, 0.60, 1.15]`** — measured, not picked. Four scripted
  runs of level 1 with no upgrades: never steering scores 4,485; dodging 7,935; dodging plus
  choosing station halves 8,880; dodging plus sweeping banknotes 10,575. Those land on
  **1 / 2 / 2 / 3 stars**, so three stars needs both good dodging and the money.
  **Re-measure whenever obstacle damage, gate rates or the craft multipliers move.**
- **`barrierTake: 5, rollerTake: 3, sawTake: 6`.** At 3/2/4 a run that never touched the
  screen finished with fourteen candles and three stars: gates hand out more growth over a
  level than soft obstacles can claw back, and the whole spread between idling and playing
  well was 1.3×.
- **Stations are two halves, never full width.** Full-width gantries gave every tray every
  treatment regardless of input — per-candle value came out *identical* across every play
  style. The halves are the only place skill touches quality.
- **`bestMould`/`bestWrap` floor at 1.** At 0 the level-1 press stamped PLAIN onto plain
  candles and printed "ALREADY PLAIN" — a station with a gantry and a sign that did nothing
  until an upgrade several levels later.
- **Road dark, sky light, always.** Workshop 2 shipped as a pink runway under a pink sky and
  the track dissolved into the backdrop at about twenty units, which is the distance you
  steer by. A unit test asserts ≥0.25 lightness between every road and its sky.
- **Candles are ~4:1 tall and the camera is low.** The bands are horizontal, so they are only
  legible from the side; a high camera sees the tops and a three-colour tray reads as one
  colour.
- **Draw calls 45–65.** Everything on the runway is instanced; the stations are the expensive
  part (three pooled gantries of nine meshes each). The e2e budget is 80.

## Testing

`npm run e2e` is the safety net; run it before and after anything structural. The golden
records the whole simulation after **thirty** simulated seconds — inside a level, since a
level is about thirty-seven seconds of runway. If a deliberate balance change moves those
numbers, **read the diff**, re-record in the same commit, and say so in the message.

**Playwright runs on port 4179, not vite's default 4173.** Several games are built on this
machine at once and every one of them copied the same port; two suites then fight, and the
failures do not look like a port conflict.

**The test viewport must come after the device spread.** `devices['Desktop Chrome']` carries
its own 1280×720, which silently overrode the portrait size.

## Record as you go

Write lessons into `gamedev-notes` **in the same commit as the change that taught them**, not
at the end of a session. Several games run at once; a lesson recorded after this one finishes
is one the next game never got.
