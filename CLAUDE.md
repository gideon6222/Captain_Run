# Captain Run

Viking crowd-runner. Lead a warband up an ascent, pass gates that grow or cut the crowd,
fight draugr and a boss, spend gold at the camp between runs.

Live: **https://gideon6222.github.io/Captain_Run/**
Repo: github.com/gideon6222/Captain_Run
Target: Samsung S26 Ultra, Chrome, portrait, installed to the home screen.

**Read `C:\dev\gamedev-notes` first** — `SKILL.md` (process), `PIPELINE.md` (stack, shipping,
measured limits), `CRAFT.md` (design lessons, including several drawn from this game),
`ASSETS.md`, `PLAYTESTS.md`.

---

## Stack

Migrated off five static files on 2026-09-07. Vite 5 with `base: './'`, three.js pinned to
0.166.0 in its own chunk, `vite-plugin-pwa` generating the service worker, TypeScript for
extracted modules, Playwright against the production build, node unit tests over the pure
layer, a per-chunk bundle size guard, and CI that runs all of it before deploying to Pages.

```bash
npm run dev        # play it locally
npm test           # unit tests over the pure modules (node --test + esbuild)
npm run typecheck  # tsc over src, then over e2e and test
npm run e2e        # Playwright against the real build
npm run size       # bundle size guard, fails in both directions
```

## Files

| File | What it is |
|---|---|
| `index.html` | Shell: all CSS, HUD, camp screen, error overlay, SW registration |
| `src/main.js` | The game. Still ~1,550 lines and shrinking — see "The split" below |
| `src/tuning.ts` | `T`, tiers, palettes, and the derived stats as pure functions |
| `src/util.ts` | `clamp`, `lerp`, `smooth`, `hash`, `fmt` |
| `src/save.ts` | The one localStorage key, and a defensive loader |
| `src/changelog.js` | `VERSION` and the patch notes shown in the camp |
| `public/` | manifest, icon, and the legacy service-worker cleanup script |
| `test/` | `harness.mjs` bundles `pure-entry.ts` with esbuild so node can import TS |
| `e2e/smoke.spec.ts` | Ten tests against the built game, including the whole-game golden |
| `NOTES.md` | Design decisions, tuning as shipped, and what to do next |

## The split

`main.js` is being emptied module by module rather than converted in one pass, because a
big-bang rewrite of live game code has no way to prove it changed nothing. Every extraction
lands as `.ts` and gets unit tests; `main.js` keeps thin wrappers so call sites do not churn.
`tsconfig.json` has `checkJs: false` so the untouched JS does not drown the typecheck.

Imports of the TS modules from `main.js` are **extensionless** (`'./util'`, not `'./util.js'`)
— Vite only rewrites `.js` to `.ts` for TS importers. When `main.js` is gone, they become
`.js` like the TS files' own imports.

The safety net for all of it is `e2e/smoke.spec.ts`. Record before you split, never after.

## Invariants

- **Nothing that affects game state may use `Math.random`.** Decisions keyed on a place go
  through `hash(a, b)` seeded on (chunk, ascent); everything else draws from `rnd`, the
  per-ascent stream from `makeRng`. Cosmetic jitter — crew colours, dust motes, camera
  shake, walk phase — stays on `Math.random` deliberately. The hard part is that "cosmetic"
  is not obvious: loot scatter velocity decides when a coin comes within magnet reach, so it
  decides when gold lands, so it is simulation. Anything that decides *when* is simulation.
  That determinism is what makes the forty-second golden possible, and it is the strongest
  tool this repo has.
- **A signed shift in a hash silently halves its range.** It did here for the game's whole
  life, deleting three mechanics with no error and no visible symptom. `NOTES.md` has the
  full account. Test the random source, not just what it produces.
- **`freeze()` before `advance()` in any harness.** Otherwise the run has been playing itself
  for however long the machine took to boot, and every recorded number moves with the
  machine — a faster build "breaks" the golden.
- **Any `reset → push → flush` render path will eventually lose its flush and fail silently.**
  It already happened here: the enemy layers were never flushed, so every draugr was invisible
  while still charging and still killing crew, and it read as a balance problem. Assert
  `mesh.count` against the entity list length; `e2e` does.
- **Use `requestAnimationFrame` to draw, never to undo.** A flash cleared from a rAF callback
  stuck at full opacity when the tab was hidden. `setTimeout` instead.
- **Seeding or clearing the save needs `Storage.prototype.setItem` frozen first**, or the
  outgoing page writes live state back over it on reload.

## Numbers that are calibrated, not chosen

- **Ambient light 0.72, hemisphere 0.55, directional 2.6.** Toon shading is a four-step
  `gradientMap` with `NearestFilter` on both `minFilter` and `magFilter`; raise ambient and
  the bands wash into flat Lambert.
- **Outlines are inverted hulls sized in world units**, derived per-object from its own
  bounding box — not a fixed scale multiplier, which gives sub-pixel edges on small objects.
- **`bruteHP: 52`** — twice a grunt. 64 wins the first ascent, 70 loses it; the cliff is that
  sharp because damage scales with warband size, so losing crew lengthens every later fight.
- **Draw calls 42–55.** Every character is instanced per body part, not per character, so
  crowd size does not move this. If it climbs, something stopped being instanced.

## Record as you go

Write lessons into `gamedev-notes` **in the same commit as the change that taught them**, not
at the end of a session. Several games run at once; a lesson recorded after this one finishes
is one the next game never got.
