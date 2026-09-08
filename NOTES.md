# Captain Run — notes

Per-game truth. Where this and the shared phone-game-studio pipeline disagree, **this file wins.**

| Topic | Status |
|---|---|
| Stack | Five static files at the repo root, no build step. The shared pipeline is accurate for this game (unlike Coreward, which outgrew it). |
| three.js | 0.166.0 from jsdelivr via importmap. Same URL is in `sw.js` ASSETS. |
| Deploy | Push to `main`, **bump `CACHE` in `sw.js` every time**, close and reopen the app twice on the phone. |
| Debug seam | `?debug` on the URL exposes `window.__CR` — `advance(seconds)`, `state()`, `steer(x)`, and the layer objects. Used to test without a visible tab, since rAF does not fire in a hidden one. |

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

Everything is procedural geometry. No models, no textures, no external assets — which is
forced anyway, because the GitHub connector corrupts binary pushes.

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

Everything lives in the `T` object at the top of `app.js`.

- Road 6.2 wide, steer clamped to ±1.5, run speed 11 u/s.
- Ascent = 44 chunks of 12 units ≈ 50 s, then the boss.
- Gates at chunks 4, 11, 19, 27, 35. 70% are two upside options (`+N` vs `×2`, a real
  decision since which is better depends on current crew); 30% pair `×2` against a penalty.
  A gate can never take the crew below 1.
- Draugr from chunk 6, HP `26 × ascentScale × (1 + chunk×0.14)`, and they **charge** at
  6 u/s once within 34 units. Before that they died at maximum range and combat was invisible.
- Crew cap 12, +2 per Mead Hall level to 26 (= `T.visCrew`, so the number on screen is
  always the truth). Overflow from a gate converts to gold.
- Boss 9000 HP at ascent 1, slams for 2 crew every 3.4 s, stands off at 10.5 units.
- Everything hostile scales `2.02^(ascent-1)`; one weapon tier is `2.15`, so buying one tier
  per ascent roughly keeps pace and costs (`2.35^t`) slowly outrun income.

## Known gaps / next

1. **Balance past ascent 3 is modelled, not played.** In-run forge tiers stay ~4 per run
   regardless of ascent, so permanent tiers are the only thing that outpaces the curve.
   Watch for a wall around ascent 5–7.
2. **No prestige layer yet.** Runes and blessings are the only permanent meta. A voyage
   reset (keep relics, reset ascents, gain a multiplier) is the obvious next system.
3. **No offline income.** Deliberate for v1.
4. Biomes are a palette swap per ascent (Pinewood / Hvitfell / Emberway / The Void) — the
   geometry does not change. Cheap and effective, but it is a difficulty slider with a
   repaint, which CRAFT.md warns is not variety. Per-biome hazards would fix that.
5. Audio is synthesised, with an actual 8-note theme on a slow-attack horn — never random
   pentatonic notes, per the Coreward playtest where he called those "beeps".
