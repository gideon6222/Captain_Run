# Captain Run — notes

Per-game truth. Where this and the shared phone-game-studio pipeline disagree, **this file wins.**

| Topic | Status |
|---|---|
| Stack | Vite + `vite-plugin-pwa`, TypeScript for the extracted modules, Playwright smoke tests, node unit tests, a bundle size guard and CI. Migrated 2026-09-07; see `PIPELINE.md` in `gamedev-notes` for the shared shape. |
| Source | `src/main.js` is the game and is being emptied module by module. `src/tuning.ts`, `src/util.ts`, `src/save.ts` and `src/changelog.js` are out and unit-tested. Every further extraction lands as `.ts`. |
| three.js | 0.166.0 as an npm dependency, split into its own chunk. No importmap, no CDN. |
| Deploy | Push to `main`. CI typechecks, unit-tests, size-guards and smoke-tests the real build, then deploys to Pages. **No cache version to bump** — Workbox generates the precache from the hashed output. |
| Pages | **Never enabled on this repo.** The URL has always 404'd. The workflow cannot turn it on — the token is refused on the create-a-pages-site endpoint — so it needs Settings → Pages → Source = "GitHub Actions", once, by hand. Until then the deploy job is the only red step. |
| Debug seam | `?debug` exposes `window.__CR` — `freeze()`, `advance(seconds)`, `state()`, `steer(x)`, `T`, `enemies()`, `gates()`, `boss()` and the layer objects. `freeze()` first: it stops the rAF tick and restarts the ascent, so `advance(n)` is exactly n seconds from a clean start rather than n seconds after however long the machine took to boot. |

## What the game is

An auto-runner welded to an idle RPG. Drag anywhere to steer the warband left and right;
everything else is automatic. Crates and draugr burst into gold, iron and runes that magnet
into the crowd. Iron fills a forge bar that upgrades the axe a tier at a time *within the
run*; gold buys permanent upgrades at the camp between ascents. Each ascent ends at a jotunn
with an HP bar — a pure DPS check, which is the wall that sends you to the shop.

Three resources with three distinct jobs, per CRAFT.md's "one resource is no resource":

- **Gold** — persistent, buys everything at the camp. Leftover iron converts at 2× on run end.
- **Iron** — run-scoped only. Feeds the forge bar. Never banked.
- **Runes** — persistent, rare, only buys the Runestone blessings (sealed until Ascent 4).

## Graphics approach (2026-09-07)

Everything is procedural geometry. No models, no textures, no external assets. That was
originally forced — pushes went through the GitHub connector, which corrupts binaries — and
it no longer is: the repo is local with a real build, so glTF is available if a model would
earn its place. See `ASSETS.md` in `gamedev-notes`. The toon-and-outline look is coherent as
it stands, so this is an option rather than a plan.

- **`MeshToonMaterial` + a runtime `DataTexture` gradient map** with four hard bands
  (`0.36 / 0.62 / 0.84 / 1.0`), `NearestFilter` on both min and mag or the banding vanishes.
- **Inverted-hull outlines, scaled per axis rather than pushed along normals.** `Layer`'s
  `outline` argument is a *world-unit thickness*; the constructor reads the geometry's own
  bounding box and derives a non-uniform scale from it. This gives the same edge width on a
  0.075-wide axe haft and a 30-unit mountain, and unlike a normal-push it leaves no gaps at
  box corners. First attempt used a flat 1.08 scale factor and the outlines were sub-pixel.
- **Instanced parts, not instanced characters.** One `InstancedMesh` per body part
  (`L` for crew, `E` for draugr and the jotunn, `W` for world and pickups), rewritten every
  frame from a procedural run cycle. 26 vikings, 18 draugr, a boss, 420 loot chunks and all
  scenery come to roughly **42–55 draw calls**.
- The jotunn is the draugr rig at `scale: 3.3` with a different `instanceColor`. Free boss.
- Lighting: ambient 0.72, hemisphere 0.55, directional 2.6. Higher ambient washes the toon
  bands out completely — that was the first pass and it looked flat.
- Sky is a CSS gradient on the container with `alpha: true` and no scene background, fog
  colour matched to it. Carried over from Coreward.

## Tuning as shipped

Everything lives in the `T` object in `src/tuning.ts`, along with the derived stats, which
are pure functions taking the upgrade table as an argument — so `npm test` can check the
curves without booting the game.

- Road 6.2 wide, steer clamped to ±1.5, run speed 11 u/s.
- Ascent = 44 chunks of 12 units ≈ 50 s, then the boss.
- Gates at chunks 4, 11, 19, 27, 35. 68% are two upside options (`+N` vs `×2`, a real
  decision since which is better depends on current crew); 32% pair `×2` against a penalty.
  A gate can never take the crew below 1.
- Draugr from chunk 6, HP `26 × ascentScale × (1 + chunk×0.14)`, and they **charge** at
  6 u/s once within 34 units. Before that they died at maximum range and combat was invisible.
- Brutes past chunk 12, 28% of spawns: twice a grunt's HP, two crew per hit, 1.35× rig.
  52 HP, not the 88 it was written with — see the RNG note below for why that number had
  never actually been played.
- One volley is five axes across the five nearest draugr, or all five into the Jotunn once
  it is armed. Kill *rate*, not damage, is the binding constraint on a crowd.
- Crew cap 12, +2 per Mead Hall level to 26 (= `T.visCrew`, so the number on screen is
  always the truth). Overflow from a gate converts to gold.
- Boss 9000 HP at ascent 1, slams for 2 crew every 3.4 s, stands off at 10.5 units.
- Everything hostile scales `2.02^(ascent-1)`; one weapon tier is `2.15`, so buying one tier
  per ascent roughly keeps pace and costs (`2.35^t`) slowly outrun income.

## The RNG returned half its range (2026-09-07)

Worth reading before touching anything seeded. `hash(a, b)` used **signed** right shifts:

```js
h = (h ^ (h >> 13)) * 1274126177;
return ((h ^ (h >> 16)) >>> 0) / 4294967296;
```

A signed shift sign-extends, so `h ^ (h >> 16)` always cleared the top bit and the function
could never return above 0.5 — measured maximum 0.499999 over 800,000 samples. Every spawn
decision in the game goes through it. Nothing errored, nothing looked broken, and it silently
deleted three mechanics: brutes (`> 0.72`), punishing gates (`> 0.68`) and the good gate
swapping sides (`> 0.5`) had never once fired, and everything placed with
`(hash() - 0.5) * width` came out negative, pinning draugr, crates and shrines to the left
half of the road. The multiply overflowed a double's exact range too, rounding away the low
bits the next xor-shift mixes down; `Math.imul` now.

Two consequences worth remembering:

- **A mechanic that never fires fails as absence.** There is no error and nothing missing on
  screen — the game just plays differently than it reads. Playtesting cannot see it. The only
  thing that catches it is testing the random source itself, which `test/util.test.mjs` now
  does, plus e2e tests asserting the mechanics actually occur in a run.
- **Balance tuned against a broken source is tuned against a different game.** Turning the
  mechanics on made the first ascent unwinnable, and fixing that surfaced two real design
  bugs underneath: the warband shot the nearest draugr rather than the boss it was told to
  fight, and a whole volley landed on one target so kills were capped at 2.4 a second no
  matter how much damage each axe carried.

## Known gaps / next

1. **Balance is modelled, not played.** A greedy campaign sim through the debug seam — buy
   the cheapest useful upgrade, weapon first, no steering — clears ascents 1 to 7 and stalls
   on the eighth with everything bought, which is a reasonable place for the blessings to
   start mattering. It does not spend runes, and it never chooses a gate, so a real player
   should get further. Nobody has played past ascent 3.
2. **No prestige layer yet.** Runes and blessings are the only permanent meta. A voyage
   reset (keep relics, reset ascents, gain a multiplier) is the obvious next system.
3. **No offline income.** Deliberate for v1.
4. Biomes are a palette swap per ascent (Pinewood / Hvitfell / Emberway / The Void) — the
   geometry does not change. Cheap and effective, but it is a difficulty slider with a
   repaint, which CRAFT.md warns is not variety. Per-biome hazards would fix that.
5. Audio is synthesised, with an actual 8-note theme on a slow-attack horn — never random
   pentatonic notes, per the Coreward playtest where he called those "beeps".
