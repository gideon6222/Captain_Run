# Candle Gift — notes

Per-game truth. Where this and the shared phone-game-studio pipeline disagree, **this file wins.**

| Topic | Status |
|---|---|
| Stack | Vite + `vite-plugin-pwa`, TypeScript for the pure layer, Playwright smoke tests, node unit tests, a bundle size guard and CI. Inherited whole through two previous games in this repo. |
| Source | `src/main.js` is the renderer and the glue. `stack.ts`, `tray.ts`, `candle.ts`, `appraise.ts`, `tuning.ts`, `util.ts`, `save.ts`, `sfx.ts` and `gfx.ts` are out and tested. |
| three.js | 0.166.0, split into its own chunk. |
| Deploy | Push to `main`. CI typechecks, unit-tests, size-guards and smoke-tests the real build, then deploys to Pages. |
| Pages | Enabled by hand on 2026-09-07. A workflow cannot turn it on. |
| Debug seam | `?debug` exposes `window.__CR` — `freeze()`, `advance(seconds, step, draw)`, `state()`, `steer(x)`, `stackAt()`, `tray()`, `trayStats()`, `result()`, `appraiseNow()`, the entity lists, `T`, `WAXES`, `MOULDS`, `WRAPS`, `KINDS`, and the scene, camera, renderer and layers. `freeze()` first. |

## Where this game came from

Gideon's girlfriend remembered a mobile game about being a candle — collect layers of wax,
traps take them off, sell at the end. The first build here (Wick, v1.0.0) was made from that
description alone, and got the *loop* right and the *presentation* wrong.

Then he sent two screenshots of the actual game: **Candle Gift** by Rollic Games
(`com.TwoPageGames.CandleGift`, January 2022). Its own store copy and Gamezebo's strategy
guide fill in the rest.

**What the reference actually is**, and what was taken from it:

- *"Guiding a stack of candles down a runway, dunking them in various goops, covering them in
  glitter and wrapping them up in bows."* — so the player is not a candle, they are a
  **production line**. Taken wholesale.
- *"As your candle stack gets longer, you need to be aware of everything happening in front
  of you, and sometimes you need to start moving well before an obstacle is in reach."* — the
  stack **trails**. This is the single most important line in the research and it is the
  mechanic the whole game is now built on.
- *"Upgrade your stats at the beginning of a level… prioritise earning power and candle stack
  growth."* — the shop is pre-level stat upgrades, and those two are deliberately the first
  rows in it.
- Three stars a level; extra stations, including a boutique.
- The look, straight off the screenshots: a **purple runway floating in blue sky**, hot-pink
  pill signs on gantries labelling each station (`CANDLE`, `GLITTER`, `MOLD`), cyan liquid
  wax, green banknotes and floating `+208$` text, red `X X X` barriers, falling confetti.
  One screenshot has `CANDLE` on the left of a gantry and `GLITTER` on the right, which is
  where the two-halves station design comes from.

**What is invented here**: the contrast bonus (adjacent bands have to actually read as two
colours, judged on hue *or* lightness), the moulds being real geometry rather than a
multiplier, and lighting every candle one at a time on the gift table.

## The two axes

- **Count** — loose candles on the runway add one each; obstacles knock them off the back.
- **Quality** — the pools, and every candle carries **its own** recipe.

The payout is the sum of the candles, so a tray that wove through both pools is worth far
more than one that held a line, even though both crossed the same stations.

## The trailing tray is the game

`stack.ts` keeps a ring buffer of where the leader has been. Row *r* sits `r × trailGap`
back **along that recorded path**. Three candles abreast per row, so the tray is a tray and
not a queue — single file was the first attempt and every candle hid behind the one in
front, so a tray of twenty-six showed the player one candle's worth of colour.

Obstacles test **every candle**, which is the entire point: swerve late and you clear the
barrier yourself and drag the back half of your tray through it.

## Tuning as shipped

- Runway 8.4 wide, steering clamped to ±3.0, 11.5 u/s, 34 chunks ≈ 37 s.
- Tray starts at 8, caps at 27 (nine rows of three — a whole number of rows, so no row is
  ever short).
- Eight gantries at fixed chunks, each a **pair of pools** 11 units long: wax early and often,
  glitter and press through the middle, wrap late and offered twice.
- No gates. The tray grows only by collecting loose candles off the runway.
- Barriers take 3 candles, rollers 2, saws 4, before the Steady Tray upgrade.
- Cream is the candle core and is never offered at a pool — a cream dip on a cream candle is
  a no-op, and a station that can do nothing teaches the player to stop reading signs.
- Six waxes; prices span under 2×; contrast counts hue **or** lightness.
- Four moulds (PLAIN → FLUTED → TWIST → STAR) and four wraps (BARE → RIBBON → BOXED → LUXE),
  each a real geometry change and a real multiplier.
- Four workshops, all bright, all with a dark runway under a light sky.

## The overhaul (v3.0.0) — what "still pretty far off" actually meant

Gideon's third pass on this game, and the first two were built on inference. The fix came
from one sentence in the reference's strategy guide that had been sitting in the research
since the first session:

> *"If there are two pools of wax side by side, you should swipe left and right quickly to
> try and dunk all of your candles in both of the pools."*

Wax is a **pool on the ground**. Every candle keeps its own recipe. The player's line decides
which candles get what. Everything else followed:

- Stations became pairs of pools lying in the runway, with working machinery over them — a
  ladle that pours, a ram that slams.
- `+N` / `×2` gates are gone; they were carried over from the viking game this repo used to
  hold. The tray grows by collecting **loose candles lying on the runway**, which is what the
  reference's screenshot shows.
- The results screen reports the *tray* — colours per candle, how many moulded, how many
  wrapped, how many came out plain — because there is no longer one recipe to describe.

Measured: weaving is worth **2.6× per candle** over driving straight through. Under the old
shared-tray model all four scripted play styles produced the *same* per-candle value.

## What this build got wrong first, and what fixed it

Recorded because each one is cheap to reintroduce.

1. **Full-width stations.** Every tray got every treatment regardless of input; measured,
   per-candle value was *identical* across four play styles. Split into two halves.
2. **Obstacles too soft.** Gates out-grew them, so a run that never touched the screen kept
   fourteen candles and scored three stars.
3. **Concentric bands.** Physically how dipping works, and it renders as nothing — the outer
   shell hides the rest. Horizontal bands instead.
4. **Single file.** Every candle hidden behind the one in front.
5. **High camera.** Horizontal bands are only legible from the side.
6. **A pink runway under a pink sky** in workshop 2, which dissolved at steering distance.
7. **The level-1 press stamped PLAIN onto plain candles** and printed "ALREADY PLAIN".
8. **The music hook still pointed at "the wick is out"**, a state this game does not have —
   an octave drop that could never fire. Repointed at a nearly-empty tray.
9. **Stations treated the whole tray**, which removed all player input from quality. Pools
   and per-candle recipes.
10. **CREAM was a pool colour and also the candle core**, so a third of the dips were no-ops.
11. **`touch-action: none` on body** stopped the shop scrolling on a phone — a hard blocker,
    since START sat below the upgrade list. Reported by Gideon.

## Known gaps / next

1. **The upgrade list is still ours, not the reference's.** He asked for "same traps and
   upgrades"; the traps are matched from the screenshots (X barriers, spike rollers, saws),
   but no source on the web lists the reference's upgrades and they cannot be derived from
   two action shots. **A screenshot of its upgrade screen would settle this in one message.**
2. **Nobody has played it with a thumb.** Everything above is verified through the debug seam
   and screenshots. Unverified: whether weaving feels good or fiddly at speed, whether the
   drag sensitivity is right, whether a full tray feels heavy in the good way, and whether
   the audio is pleasant.
3. **The 1-vs-2 star boundary is fragile** — idling and gathering score within 4% of each
   other, because the magnet collects pickups almost by itself. Shrinking the magnet or
   scattering pickups wider would separate them.
2. **Balance past level 1 is modelled, not played.** The four scripted runs that set `par`
   were all level 1 with no upgrades.
3. **Stations are the draw-call cost** — three pooled gantries of nine meshes each is most of
   the 45–65. Instancing the posts and vats would roughly halve it. Not urgent at 65 against
   a ~100 mobile guideline, but it is the first thing to do if a later workshop adds props.
4. **The gift table is a box with legs.** It is the last thing the player looks at every
   level. `ASSETS.md`'s "stationary, close to the camera, looked at while nothing else is
   happening" exception genuinely applies here.
5. **No per-workshop mechanics.** The four differ in palette and wax choice only. The
   reference has themed stations; the hooks are all in `WORKSHOPS`.
6. **The stack cap is 27 and a good run hits it**, so the count axis tops out. Either raise
   the cap with a wider tray, or make late gates multiplicative against a rising obstacle
   toll so holding the cap is the challenge.
