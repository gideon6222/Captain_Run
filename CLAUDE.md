# Wick

Candle-dipping runner. Steer a candle up a workshop road, pass through arches of coloured
wax that add rings, dodge blades that shave them off and heat that melts them, race the
wick, and sell the finished candle to the chandler between runs.

Live: **https://gideon6222.github.io/Captain_Run/**
Repo: github.com/gideon6222/Captain_Run
Target: Samsung S26 Ultra, Chrome, portrait, installed to the home screen.

> **The repo name is historical.** It held Captain Run, a viking crowd-runner, through
> v0.3.0, and was reshaped into this game on 2026-09-07 at Gideon's request. Nothing in the
> build depends on the name (`base: './'`), so renaming it on GitHub is safe whenever he
> wants; until then, `Captain_Run` in a URL means Wick.

**Read `C:\dev\gamedev-notes` first** — `SKILL.md` (process), `PIPELINE.md` (stack, shipping,
measured limits), `CRAFT.md` (design lessons, several drawn from this repo), `ASSETS.md`,
`PLAYTESTS.md`.

---

## Stack

Vite 5 with `base: './'`, three.js pinned to 0.166.0 in its own chunk, `vite-plugin-pwa`
generating the service worker, TypeScript for the extracted modules, Playwright against the
production build, node unit tests over the pure layer, a per-chunk bundle size guard, and CI
that runs all of it before deploying to Pages.

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
| `index.html` | Shell: all CSS, HUD, workshop screen, appraisal panel, error overlay, SW registration |
| `src/main.js` | The game: renderer, spawning, simulation, render pass, shop, boot |
| `src/candle.ts` | **The candle.** Layer stack, and every bit of geometry derived from it |
| `src/appraise.ts` | What a finished candle is worth, and the grade |
| `src/tuning.ts` | `T`, waxes, workshops, scents, and the derived stats as pure functions |
| `src/util.ts` | `clamp`, `lerp`, `smooth`, `hash`, `fmt`, `makeRng` |
| `src/save.ts` | The one localStorage key (`wick.v1`), and a defensive loader |
| `src/sfx.ts` | The whole audio graph, synthesised, built on first gesture |
| `src/gfx.ts` | Toon materials, inverted-hull outlines, the instanced `Layer` |
| `src/changelog.js` | `VERSION` and the patch notes shown in the workshop |
| `test/` | `harness.mjs` bundles `pure-entry.ts` with esbuild so node can import TS |
| `e2e/smoke.spec.ts` | 23 tests against the built game, including the forty-second golden |
| `NOTES.md` | Design decisions, tuning as shipped, and what to do next |

## The split

`main.js` is the renderer and the glue; everything that can be decided without a GPU lives in
a `.ts` module with unit tests. That boundary is the useful one, and `test/pure-entry.ts` is
its standing check: if importing it ever starts pulling in three.js or the DOM, a module that
was supposed to be pure has grown a dependency on the game.

Imports of the TS modules from `main.js` are **extensionless** (`'./util'`, not `'./util.js'`)
— Vite only rewrites `.js` to `.ts` for TS importers.

## Invariants

- **The silhouette is derived from the layer list, never stored beside it.** Radius, height,
  lean and appraised value are all functions of the same array, so the candle on screen
  cannot disagree with the candle being scored. In a game whose entire premise is "protect
  the thing you can see", that is the one bug the player would never forgive.
- **Nothing that affects game state may use `Math.random`.** Decisions keyed on a place go
  through `hash(a, b)` seeded on (chunk, workshop); everything else draws from `rnd`, the
  per-run stream from `makeRng`. Cosmetic jitter — spark scatter, dust motes, camera shake,
  flame flicker — stays on `Math.random` deliberately. The hard part is that "cosmetic" is
  not obvious: a droplet's position decides when it comes within magnet reach, which decides
  how much wax is on the candle when it meets the next blade. **Anything that decides *when*
  is simulation.**
- **World +x is screen LEFT.** The camera sits behind the candle looking along `+z`, which is
  a 180° turn about Y, and that mirrors the x axis — measured, not assumed: world +2 projects
  to NDC −0.31. So the drag handler subtracts. The previous game on this stack mapped it the
  obvious way and shipped inverted steering for its whole life, because every test drove
  `steer()` in world coordinates and nobody ever played it with a thumb. `dragging right
  moves the candle right` in e2e drives real pointer events for exactly this reason.
- **A `PlaneGeometry` faces `+z`, and this camera looks along `+z`.** Any flat thing added to
  the world shows the player its back: culled by `FrontSide`, and mirrored if you "fix" it
  with `DoubleSide`. Rotate it `Math.PI` about Y. When something renders as nothing,
  enumerate what you did *not* configure, not what you did.
- **Anything the player must reach or dodge goes through `laneX`**, which places inside
  `laneClamp` — not across the road mesh, which is deliberately wider. A hazard outside the
  steerable band is drawn, is in the level, and can never once interact with anyone.
- **Any `reset → push → flush` render path will eventually lose its flush and fail silently.**
  Assert `mesh.count` against the model; `e2e` does.
- **Use `requestAnimationFrame` to draw, never to undo.** A flash cleared from a rAF callback
  sticks at full opacity when the tab is hidden. `setTimeout` instead.
- **`freeze()` before `advance()` in any harness**, or the run has been playing itself for
  however long the machine took to boot and every recorded number moves with the machine.
- **Seeding or clearing the save needs `Storage.prototype.setItem` frozen first**, or the
  outgoing page writes live state back over it on reload.

## Numbers that are calibrated, not chosen

- **`par: 660`** — measured, not picked. Three scripted runs of workshop 1 through the debug
  seam: never touching the screen scores 353, dodging blades scores 610, dodging *and*
  sweeping droplets scores 1046. Those land on PLAIN, GOOD and MASTERWORK. At the first guess
  of 260, doing nothing graded FINE and both skilled runs hit the ceiling. **Re-measure this
  whenever wax income moves.**
- **`laneClamp: 2.5` against `bladeR: 0.45`.** A blade plus a grown candle sweeps ~1.1 units.
  At the first numbers (1.5 band, 0.62 disc) that was 1.29 of 1.5, so steering was decoration:
  an unsteered run lost 64 wax and a perfectly steered one could not do much better. The band
  must stay well wider than `bladeR + a fat candle`.
- **`magnetBase: 1.2`.** Carried over at 3.4 it exceeded half the road, so a run that never
  touched the screen collected every droplet and appraised MASTERWORK. Must stay well under
  `laneClamp` or droplets stop being a reason to steer.
- **Wax prices span under 2×.** At 2.9× for gold leaf, material value dominated and the dip
  arch collapsed into "take the bigger number" — a warm three-colour candle beat a
  contrasting one of the same size on raw wax alone.
- **Contrast counts lightness, not only hue.** Cream tallow and crimson are 0.13 apart on the
  wheel and are obviously two colours. The unit tests caught the hue-only model before any of
  it was drawn.
- **Ambient 0.42 → 0.15 across the four workshops**, floored at 0.12 by `ambientFor`. Below
  that the four-step toon `gradientMap` collapses into flat black. The flame is a real
  `PointLight` whose intensity tracks the candle's radius, so a bad run is also a dark one.
- **Draw calls 32–43.** Everything is instanced per kind, so candle size does not move this.

## Testing

`npm run e2e` is the safety net; run it before and after anything structural. The golden
records the whole simulation after forty simulated seconds. If a deliberate balance change
moves those numbers, **read the diff**, re-record in the same commit, and say so in the
message. A rendering, layout or build change must not touch them — the viewport and control
fixes on 2026-09-07 left the golden byte-identical, which is the proof that seam works.

**Playwright runs on port 4179, not vite's default 4173.** Several games are built on this
machine at once and every one of them copied the same port; two suites then fight, and the
failures do not look like a port conflict. Coreward's tests taking 4173 produced a run of
`ERR_CONNECTION_REFUSED` here that read exactly like boot bugs.

**The test viewport must come after the device spread.** `devices['Desktop Chrome']` carries
its own 1280×720, which silently overrode the portrait size — so for a while the smoke tests
framed a landscape picture this portrait-only game never renders.

## Record as you go

Write lessons into `gamedev-notes` **in the same commit as the change that taught them**, not
at the end of a session. Several games run at once; a lesson recorded after this one finishes
is one the next game never got.
