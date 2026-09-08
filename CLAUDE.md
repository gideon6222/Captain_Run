# Candle Gift

A candle-factory runner. Steer one long slab of candles — lying flat along the track, gold
tips down one edge — through pools of wax lying in the runway, weaving so different parts of
the slab come out different colours. Glitter, a mould press, a rotate plate and a gift wrap
finish them; barriers, spike rollers, saws and a sliding sweeper knock candles off the back;
banknotes and loose candles lie on the track. Sell the batch on a value gauge at the end and
buy the next shop.

Modelled on **Candle Gift** by Rollic Games (`com.TwoPageGames.CandleGift`), at Gideon's
request.

**`REFERENCE.md` is the observed record of that game — read it before changing how anything
looks or what a station does.** It has the store screenshots, a gameplay video, the full
station and obstacle list, and an honest list of where this build still differs. Two rebuilds
were made on inference before it existed and both got the presentation wrong; the game is
delisted, so that file is now the primary source.

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
| `src/tray.ts` | The candles currently on the tray, one recipe each; growth, damage, stats |
| `src/candle.ts` | ONE candle's recipe — bands, glitter, mould, wrap — and its geometry |
| `src/appraise.ts` | What a tray is worth at the gift table, and the star rating |
| `src/tuning.ts` | `T`, waxes, moulds, wraps, workshops, upgrades, derived stats |
| `src/util.ts` | `clamp`, `lerp`, `smooth`, `hash`, `fmt`, `makeRng` |
| `src/save.ts` | The one localStorage key (`candlegift.v1`), and a defensive loader |
| `src/sfx.ts` | The whole audio graph, synthesised, built on first gesture |
| `src/gfx.ts` | Toon materials, inverted-hull outlines, the instanced `Layer` |
| `src/changelog.js` | `VERSION` and the patch notes shown in the workshop |
| `e2e/smoke.spec.ts` | 26 tests against the built game, the four-policy bot, and the thirty-second golden |
| `REFERENCE.md` | **What the real game actually does**, observed from its screenshots and a gameplay video |
| `NOTES.md` | Design decisions, tuning as shipped, and what to do next |

## The two axes

Everything in the game is one of these:

- **How many candles** — loose candles on the runway add one each, obstacles knock them off
  the back of the tray.
- **What each one is worth** — the pools, and **every candle carries its own recipe**.

## Per-candle recipes are the game

The single most important fact in the repo, and it was wrong for two builds.

Wax is a **pool on the ground**, not a gate. Which candles get which colour depends on where
each one was as the tray snaked over it — and because the tray trails along the leader's
recorded path, **the player's line is the decision.** The reference's own strategy guide says
it outright: *"if there are two pools of wax side by side, you should swipe left and right
quickly to try and dunk all of your candles in both of the pools."*

Treating the tray as one shared recipe deletes that entire skill. Measured, it produced an
**identical** per-candle value across four scripted play styles — never touching the screen
scored the same quality as playing perfectly. With per-candle recipes and half-width pools,
weaving is worth **9.4× per candle** over never steering.

`weaving the pools beats holding a line` in e2e is the standing guard on it, and
`par still separates the four ways of playing a level` pins the four ratings.

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
- **A prop placed relative to where the player *stops* has to clear where the camera goes
  when they stop.** The gift table sat two units past the finish line; the end-of-run camera
  swung *forward* past that line to look back at the slab, so a six-metre white slab ended up
  between the lens and the thing being framed and the shot was mostly table corner. The
  camera now stays behind the slab and the counter moved to +15, which also puts the shop
  fronts in frame as a backdrop rather than in the way.
- **Use `requestAnimationFrame` to draw, never to undo.**
- **`freeze()` before `advance()` in any harness**, or every recorded number moves with the
  machine.
- **`freeze()` restarts the level; it does not reset `S.level`.** Every layout decision is
  keyed on `hash(chunk, something + S.level)`, so a test that plays two policies back to back
  plays them on two *completely different runways* — not "one slightly harder". That is what
  `restart()` in the e2e helpers is for, and until it existed the headline comparison between
  weaving and gathering was measuring the luck of level two. Level 2 happens to be a bad
  draw: the same bot loses 22 candles there against 6 on level 1.
- **Seeding or clearing the save needs `Storage.prototype.setItem` frozen first**, or the
  outgoing page writes live state back over it on reload.

## Numbers that are calibrated, not chosen

- **`par: 24000` and `STAR_AT = [0.30, 0.60, 1.15]`** — measured, not picked, measured with
  **the bot that lives in the repo** (`playLevel` in `e2e/smoke.spec.ts`), and measured
  **over six levels, not one**. Means, normalised by `priceFor(level)`, no upgrades: idling
  4,448; dodging only 9,748; gathering pickups 16,747; **weaving the pools 29,759**. Those
  land on **0 / 1 / 2 / 3 stars**.

  **One level is not a measurement.** A single policy swings 25% on layout luck — dodging
  scores 18,158 on level 1 and 1,350 on level 5, where it is worse than idling. Par set from
  level 1 alone put weaving on three stars there and two everywhere else.

  **Measure with that bot and no other.** An earlier pass wrote an ad-hoc policy in the
  browser console with a slightly longer lookahead, scored 64,606 on the same build and set
  par 44% too high. A bot is a *definition of playing well*; a par measured against one
  nobody can re-run is a number nobody can check. `par still separates the ways of playing a
  level` pins **level one's** ratings (0/2/1/3 — level 1 is a good draw for dodging), which
  is a regression guard, not the calibration.
- **`gaugeMax: 1.8`.** The end-of-run gauge runs to 1.8 × par, so the weaving bot fills 68%
  of it. At 1.35 a three-star run pegged the bar and a great run looked identical to a good
  one, which is the whole thing the gauge exists to distinguish.
- **The sweeper's collision half-width is 1.15 against a drawn half-width of 1.7**, and it
  swings `laneClamp × 0.55`, not × 0.78. It is the one obstacle that moves, so it is the one
  where the gap has to be *provably* there: at full width and the standard 0.34 tolerance it
  covered 61% of the steerable band at every point in its swing, and the scripted weaving bot
  lost half its slab to it. A moving obstacle with no gap is not an obstacle, it is a tax.
  The bar is yawed 0.42 rad, so its lateral half-extent is `1.7 × cos(0.42) = 1.55` against
  a collision reach of `1.15 + 0.34 = 1.49` — that is the pair to keep in step, not the raw
  numbers.
- **The spiked roller is anchored to a rail and `x`/`w` are derived from that.** It spawns
  with a `side` and a `reach`, and the centre and half-width it hands the shared collision
  test are `side × (roadW/2 − reach/2)` and `reach/2`. Anchoring is what guarantees the gap
  is on the far side, and deriving the collision box from the drawing is what stops the two
  drifting apart.
- **There are THREE obstacle kinds, because the reference has three.** The circular saw was
  a viking-runner leftover that appears in none of the eight store screenshots. **Removing an
  obstacle kind means removing its share of the danger, not redistributing it** — backfilling
  the saw's slot with a third barrier kept the runway equally busy and cost the weaving bot
  a fifth of its score, because every second spent dodging is a second not spent in a pool.
- **`barrierTake: 3, rollerTake: 3, sweeperTake: 3`.** These were 5/3/6 when growth came from
  `×2` gates. Growth is now loose candles worth one each, so the old numbers meant a single
  barrier took five of the eight you start with.
- **`poolLen: 11.0`.** A pool has to be longer than the tray is deep, or it cannot get the
  whole tray in even standing still — and short enough that one line misses the other pool.
- **No workshop offers wax 0 (CREAM) at a pool.** Cream is the candle's core and `dip`
  refuses a colour a candle already wears, so a cream pool was a dead station that read on
  screen only as a tray that stubbornly stayed beige. Removing it took average colours per
  candle from 2.07 to 2.70.
- **`bestMould`/`bestWrap` floor at 1.** At 0 the level-1 press stamped PLAIN onto plain
  candles and printed "ALREADY PLAIN" — a station with a gantry and a sign that did nothing
  until an upgrade several levels later.
- **Road dark, sky light, always.** Workshop 2 shipped as a pink runway under a pink sky and
  the track dissolved into the backdrop at about twenty units, which is the distance you
  steer by. A unit test asserts ≥0.25 lightness between every road and its sky.
- **Candles are ~4:1 tall and the camera is low.** The bands are horizontal, so they are only
  legible from the side; a high camera sees the tops and a three-colour tray reads as one
  colour.
- **Draw calls 26–85**, measured across a whole level with every upgrade at 3 (which is the
  worst case: every station kind active). Everything on the runway is instanced; the
  *stations* are the cost, at three pooled gantries of about twelve visible meshes each, and
  the three shop fronts past the finish line add twelve more when they come into frustum.
  The e2e budget is 90. Shop fronts started at seven meshes apiece and pushed the peak to 87
  — a crossed pair of bars for a `+` and an outline hull are invisible at that distance and
  cost the same as the panel.

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
