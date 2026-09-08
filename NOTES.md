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

`stack.ts` keeps a ring buffer of where the leader has been. Candle *i* sits `i × trailGap`
back **along that recorded path**.

Single file, one candle per row — because **the candle is what is wide**. Each one lies
*across* the lane, so you look down the top faces of a long loaf and every candle's colour is
on screen at once. That is the reference's own answer to the readability problem, and it
replaced three-abreast rows of upright candles, which solved the same problem by being three
times as wide as the thing they were modelling.

Obstacles test **every candle**, which is the entire point: swerve late and you clear the
barrier yourself and drag the back half of your tray through it.

## Tuning as shipped

- Runway 8.4 wide, steering clamped to ±3.0, 11.5 u/s, 34 chunks ≈ 37 s.
- Slab starts at 8 candles, caps at 30, packed `trailGap` 0.62 apart along the path.
- Ten stations at fixed chunks, each a **pair of pools** 11 units long: wax early and often,
  glitter and press through the middle, rotate and wrap late, scent once it is bought.
- No gates. The slab grows only by collecting loose candles off the runway.
- Barriers take 3 candles, rollers 2, saws 4, the sweeper 3, before the Steady Tray upgrade.
- The sweeper is the only obstacle that **moves**, and its position is a function of `run.z`
  rather than of elapsed time — the same thing at a constant speed, and reproducible, so the
  golden still holds.
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

## The accuracy pass (v4.0.0) — building from the video instead of from inference

Gideon sent a gameplay video and asked for the base game to match it before improving on it.
`REFERENCE.md` is the observed record that came out of watching it; this is what changed.

- **The player object lies down.** One long slab of candles packed side by side across the
  lane with gold tips down one edge, not a crowd of upright candles. It grows lengthwise.
- **The white workshop** under a **flat** cyan sky. Not a gradient: a sky fading to near-white
  at the horizon put a white runway against a white backdrop at exactly the distance you steer
  by — the same failure as the pink-on-pink theme, caught by the same unit test.
- **ROTATE**, a white plate with a curved arrow that turns the slab end for end. It acts on
  the tray rather than on a candle, so it is the one station whose `apply` does nothing and
  `updatePools` handles as a special case.
- **SCENT**, and it is a *station you buy*, not a percentage. That is the reference's whole
  progression model — the shop panels beside its track add stations.
- **The sweeper**, an orange bar with dark blue chevrons sliding across the lane.
- **A value gauge** with a numeric scale at the end of a run, drawn from `par`.
- **Stacked-candle towers** below the track, and **shop fronts** either side past the finish.
- **Fredoka**, self-hosted, 30 KB — the single highest-return asset import in the game.

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
12. **The gift table was two units past the finish line**, and the end-of-run camera swung
    *forward* past that line to look back at the slab — so a six-metre white slab sat between
    the lens and the thing being framed. A prop placed relative to where the player *stops*
    has to clear where the camera goes when they stop.
13. **A par measured with a throwaway bot.** An ad-hoc policy written in the browser console,
    with a slightly longer lookahead than the one in the repo, scored 64,606 where the repo's
    own `playLevel` scores 39,134 — and par went in 44% too high. A bot is a definition of
    "playing well"; measure against the one anybody can re-run.
14. **Two policies compared across two different levels.** `freeze()` restarts the level but
    leaves `S.level` alone, and every layout decision is keyed on it, so the headline
    weaving-versus-gathering test was comparing two unrelated runways. Level 2 is a bad draw:
    the same bot loses 22 candles there against 6 on level 1.
15. **A sweeper with no gap.** At its drawn half-width plus the standard 0.34 tolerance it
    covered 61% of the steerable band at every point in its swing. A moving obstacle with no
    gap is not an obstacle, it is a tax.

## Known gaps / next

1. **The upgrade list is still ours, not the reference's.** He asked for "same traps and
   upgrades"; the traps are matched from the screenshots (X barriers, spike rollers, saws),
   but no source on the web lists the reference's upgrades and they cannot be derived from
   two action shots. **A screenshot of its upgrade screen would settle this in one message.**
2. **Nobody has played it with a thumb.** Everything above is verified through the debug seam
   and screenshots. Unverified: whether weaving feels good or fiddly at speed, whether the
   drag sensitivity is right, whether a full tray feels heavy in the good way, and whether
   the audio is pleasant.
3. **`dodge` now out-scores `gather`** — 18,158 against 14,048. Both are one-dimensional
   policies so the ordering between them does not matter for `par`, but it says the pickup
   line is not worth the candles it costs to chase. Scattering banknotes closer to the racing
   line, or making `guardedCash` rarer, would fix it.
4. **Balance past level 1 is modelled, not played**, and level 2 is measurably a bad draw:
   the weaving bot brings home 29 candles on level 1 and 14 on level 2, purely from layout.
   Layouts want a floor — a minimum gap between obstacles, or a cap on how much of a chunk
   can be hazard.
5. **Stations are the draw-call cost** — three pooled gantries of about twelve visible meshes
   each is most of the 26–85. Instancing the arms, posts and pools would roughly halve it.
   Not urgent at 85 against a ~100 mobile guideline, but it is the first thing to do if a
   later workshop adds props.
6. **The shop fronts are scenery.** The reference lets you buy from them in the track, with a
   green `+` on each panel. Ours draw the panels and open a sheet instead.
7. **No per-workshop mechanics.** The four differ in palette and wax choice only. The
   reference has themed stations; the hooks are all in `WORKSHOPS`.
8. **The cap is 30 and a good run hits it**, so the count axis tops out. Either raise the cap
   or make the late stations multiplicative against a rising obstacle toll, so *holding* the
   cap is the challenge.
