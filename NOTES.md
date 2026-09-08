# Candle Gift — notes

Per-game truth. Where this and the shared phone-game-studio pipeline disagree, **this file wins.**

| Topic | Status |
|---|---|
| Stack | Vite + `vite-plugin-pwa`, TypeScript for the pure layer, Playwright smoke tests, node unit tests, a bundle size guard and CI. Inherited whole through two previous games in this repo. |
| Source | `src/main.js` is the renderer and the glue. `stack.ts`, `candle.ts`, `appraise.ts`, `tuning.ts`, `util.ts`, `save.ts`, `sfx.ts` and `gfx.ts` are out and tested. |
| three.js | 0.166.0, split into its own chunk. |
| Deploy | Push to `main`. CI typechecks, unit-tests, size-guards and smoke-tests the real build, then deploys to Pages. |
| Pages | Enabled by hand on 2026-09-07. A workflow cannot turn it on. |
| Debug seam | `?debug` exposes `window.__CR` — `freeze()`, `advance(seconds, step, draw)`, `state()`, `steer(x)`, `stackAt()`, `recipe()`, `result()`, `appraiseNow()`, the entity lists, `T`, `WAXES`, `MOULDS`, `WRAPS`, `KINDS`, and the scene, camera, renderer and layers. `freeze()` first. |

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

- **Count** — gates add candles, obstacles knock them off the back of the tray.
- **Quality** — the stations, which treat the whole tray at once.

They never interfere, which is what keeps both readable, and the payout is their product.

## The trailing tray is the game

`stack.ts` keeps a ring buffer of where the leader has been. Row *r* sits `r × trailGap`
back **along that recorded path**. Three candles abreast per row, so the tray is a tray and
not a queue — single file was the first attempt and every candle hid behind the one in
front, so a tray of twenty-six showed the player one candle's worth of colour.

Obstacles test **every candle**, which is the entire point: swerve late and you clear the
barrier yourself and drag the back half of your tray through it.

## Tuning as shipped

- Runway 8.4 wide, steering clamped to ±3.0, 11.5 u/s, 34 chunks ≈ 37 s.
- Tray starts at 6, caps at 27 (nine rows of three — a whole number of rows, so no row is
  ever short).
- Eight gantries at fixed chunks, each two halves: wax early and often, glitter and press
  through the middle, wrap late and offered twice.
- Gates on the even chunks between gantries, `+3..+8` against `x2`.
- Barriers take 5 candles, rollers 3, saws 6, all before the Steady Tray upgrade.
- Six waxes; prices span under 2×; contrast counts hue **or** lightness.
- Four moulds (PLAIN → FLUTED → TWIST → STAR) and four wraps (BARE → RIBBON → BOXED → LUXE),
  each a real geometry change and a real multiplier.
- Four workshops, all bright, all with a dark runway under a light sky.

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

## Known gaps / next

1. **Nobody has played it with a thumb.** Everything above is verified through the debug seam
   and screenshots. Unverified: whether the drag sensitivity (8 screen-widths across a
   6-unit band) is right, whether a full tray feels heavy in the good way or the sluggish
   way, whether the results screen is satisfying, and whether the audio is pleasant.
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
