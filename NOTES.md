# Wick — notes

Per-game truth. Where this and the shared phone-game-studio pipeline disagree, **this file wins.**

| Topic | Status |
|---|---|
| Stack | Vite + `vite-plugin-pwa`, TypeScript for the pure layer, Playwright smoke tests, node unit tests, a bundle size guard and CI. Inherited whole from Captain Run, which held this repo until 2026-09-07. |
| Source | `src/main.js` is the renderer and the glue. `candle.ts`, `appraise.ts`, `tuning.ts`, `util.ts`, `save.ts`, `sfx.ts` and `gfx.ts` are out and tested. |
| three.js | 0.166.0 as an npm dependency, split into its own chunk. |
| Deploy | Push to `main`. CI typechecks, unit-tests, size-guards and smoke-tests the real build, then deploys to Pages. **No cache version to bump.** |
| Pages | Enabled by hand on 2026-09-07 (Settings → Pages → Source = "GitHub Actions"). A workflow cannot turn it on; the token is refused on the create-a-pages-site endpoint. |
| Debug seam | `?debug` exposes `window.__CR` — `freeze()`, `advance(seconds, step, draw)`, `state()`, `steer(x)`, `candle()`, `appraisal()`, `appraiseNow()`, the entity lists, `T`, `WAXES`, `SCENTS`, and the scene, camera, renderer and layers. `freeze()` first. |

## Where this game came from

Gideon's girlfriend remembered a mobile game about being a candle: you collect layers of wax,
traps take them off, and at the end of a level you sell the candle for money that buys
upgrades. No single title matches all of that. The two halves are real and well known:

- **Candle Craft / Candle Craft 3D** (Voodoo) — dip a candle in coloured wax *layers*, sell
  it, spend the coins on upgrades, moulds and rarer waxes and scents.
- **Gem Stack** (MWM) — a runner where you "collect, stack and **protect**" through "sharp
  traps and smashable obstacles", and reaching the finish with the stack intact is what pays.

Either she is remembering a game that fused them — the market is full of those and they churn
— or she is blending the two. It does not matter much: the mechanics she described are
unambiguous, and Captain Run was already an auto-runner where you drag to steer and pass
gates that grow or cut the thing you are protecting. This is that game with different nouns
and a much better ending.

## What the game is

You are a candle on a workshop road. Everything is automatic except steering.

- **Dip arches** every six chunks offer two waxes, e.g. `+9 GOLDLEAF` against `+5 CRIMSON`.
  Same colour as your outside just fattens that ring; a new colour adds a ring.
- **Droplets** along the road thicken the ring you are already wearing. They never author a
  new one — the arch decides *what* the candle is, droplets decide *how much of it*.
- **Blades** shave wax off one side and leave the candle out of true. **Heat lamps** melt it
  evenly. **Water** snuffs the wick.
- **The wick** is the clock and the light. It burns down, faster in heat, and if it gutters
  the run ends where it is and sells at 55%.
- **The chandler** appraises what arrives: material value × craftsmanship × how straight it
  is. Grades run STUB → ROUGH → PLAIN → GOOD → FINE → MASTERWORK.

Three resources with three distinct jobs, per CRAFT.md's "one resource is no resource":

- **Wax** — run-scoped, and it is the avatar. Never banked.
- **Coins** — persistent, buys everything in the workshop.
- **Scents** — a permanent collection of six, found in the world, never sold.

## The candle is the score, the health bar and the avatar

The one design decision everything else follows from. `src/candle.ts` holds a list of layers
and derives radius, height, lean and value from it; nothing about the shape is stored. So:

- Total wax reads as **width**, number of dips reads as **steps**, damage reads as a **lean**.
  There is no HUD number for the main resource because there does not need to be one.
- A blade taking the outer ring **reveals the colour underneath**, so damage is informative:
  you can read your own history off your body.
- Layer radius grows with the square root of accumulated area, so a long clean run cannot
  grow until it fills the screen, and a *new colour* is worth more than more of the same.

## The flame is the light

The one technique picked for this game that had not been used before. A `PointLight` at the
wick, intensity tracking the candle's radius, plus an additive halo quad for bloom. Three
things fall out of it for free: a small candle lights less road, each workshop is darker than
the last so the ramp is felt rather than announced, and water does not print a message — it
turns the lights off.

CRAFT.md already had the half of this that matters: fog cannot fade the far edges of a 2.5D
plane, because a camera twenty units back is roughly equidistant from all of it. A point
light is the thing that falls off across the ground. Attaching it to the avatar is the step
that makes it a mechanic instead of a lighting choice.

## Tuning as shipped

- Road 7.6 wide, steer clamped to ±2.5, run speed 10.5 u/s.
- Level = 38 chunks of 12 units ≈ 44 s of travel, against a 52 s wick.
- Arches at `c % 6 === 4`, six per level, always two upside options.
- Blades `bladeR: 0.45`, take 4.6 wax × workshop scale and 0.30 lean.
- Heat melts 3.1 wax/s and burns 1.9 extra wick/s. Water snuffs for 5 s.
- **Heat relights a snuffed wick.** The hazard you spend the run avoiding is the thing you
  need the moment water takes your flame, and you pay for it in melt while you stand there.
  Best interaction in the game.
- Six waxes; prices span under 2×; contrast counts hue *or* lightness.
- Four workshops (Chandlery / Frostworks / Emberworks / Deep Dark), ambient 0.42 → 0.15.
- Everything hostile scales `1.62^(level-1)`; a workshop pays `1.72^(level-1)`.

## Things this build got wrong first, and what fixed them

Recorded because each one is cheap to reintroduce.

1. **Steering was inverted.** The camera looks along `+z`, which mirrors x. Inherited
   unnoticed from Captain Run, which had it for its entire life — every test there drove
   `steer()` in *world* coordinates, which is exactly the layer the bug hides under. Now
   there is an e2e test that drives real pointer events and projects the result.
2. **The smoke tests were landscape.** `devices['Desktop Chrome']` spreads its own 1280×720
   viewport *after* the top-level `use`, so the portrait size was discarded and every test
   framed a picture the phone never renders.
3. **Blades were undodgeable.** Disc plus candle swept 1.29 of a 1.5 half-band.
4. **The magnet swept the whole road**, so a run with no input collected everything and
   graded MASTERWORK.
5. **Contrast was hue-only**, which scored cream-on-crimson as one colour. Caught by a unit
   test before it was ever drawn.
6. **Droplets carried their own colour**, so the road authored the candle's design and the
   arch — the only real decision — was one voice among many. The first golden came out with
   seven rings from five dips, which is what surfaced it.
7. **Arch labels were invisible, then mirrored.** A `PlaneGeometry` faces `+z` and the camera
   looks along `+z`.

## Known gaps / next

1. **Nobody has played it with a thumb.** Everything above is verified through the debug seam
   and screenshots. Specifically unverified: whether the drag sensitivity (9.5 screen-widths
   across the road) feels right, whether the wick is tense or stressful, whether the
   appraisal screen is satisfying or just a table, and whether the audio is pleasant on a
   phone speaker. Ask about those four.
2. **Balance past workshop 2 is modelled, not played.** The three scripted runs that set
   `par` were all workshop 1 with no upgrades.
3. **Scents are found but never chased.** They spawn on hazards, which is right, but there is
   no indication one is *in* the level before you reach it. A shelf entry saying which
   workshop a missing scent appears in would turn the collection into a reason to replay.
4. **No prestige layer.** The obvious next system once the workshop ladder runs out.
5. Workshops differ in palette, ambient and wax palette, but the geometry does not change.
   Per-workshop hazards — an Emberworks that is mostly heat, a Frostworks where wax sets
   brittle — would fix that. The hooks are all in `WORKSHOPS`.
6. The bench at the end of the road is a box with legs. It is the last thing the player looks
   at every run and deserves better; ASSETS.md's "stationary, close to the camera, looked at
   while nothing else is happening" exception may genuinely apply to it.
