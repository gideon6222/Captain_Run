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

## Current shape

Five static files, no build step, no local git repo:

| File | What it is |
|---|---|
| `index.html` | Shell: all CSS, HUD, camp screen, error overlay, SW registration |
| `app.js` | **Everything else.** ~1,600 lines: state, save, toon materials, rigs, spawning, the run loop, the camp |
| `sw.js` | Hand-written service worker — bump the cache version or the phone keeps the old build |
| `manifest.webmanifest`, `icon.svg` | PWA install |
| `NOTES.md` | Decisions specific to this game and what to do next |

---

## This game owes a migration

**No game here is a one-off** — every one is meant to be added to indefinitely. Captain Run
predates that rule and is still on the stack the rule replaced. Three things are missing and
each one costs something real:

1. **No local git repo.** No history, no branches, no revert. This is the one that matters
   most: a bad change currently has no undo.
2. **No build, no tests, no CI.** `app.js` is 1,600 lines in one file with no golden tests,
   so a refactor has nothing to check it against and a deploy has no gate.
3. **A hand-written `sw.js`.** Every change needs a manual cache-version bump, and forgetting
   means the phone silently keeps the old build. `vite-plugin-pwa` generates this from the
   real output and removes the whole class of mistake.

The migration is the one Coreward already went through and it is documented — see
`PIPELINE.md` for the stack and Coreward's `CLAUDE.md` for the file layout that came out of
it. Do it **before** the next substantial feature, not after: it gets more expensive with
every line added, and the point of migrating is to protect work that has not happened yet.

Order that worked on Coreward: `git init` and push first, so everything after it is
revertible. Then Vite and the generated service worker. Then split `app.js` into modules with
golden tests recorded *before* the split, so the split is provably behaviour-preserving.

---

## Things about this game specifically

Fuller detail is in `NOTES.md`; these are the ones that bite.

- **Toon shading is a four-step `gradientMap` with `NearestFilter` on both `minFilter` and
  `magFilter`**, and **ambient light is what kills it**. Ambient 0.72, hemisphere 0.55,
  directional 2.6. Turn ambient up and the bands wash into flat Lambert.
- **Outlines are inverted hulls sized in world units**, derived per-object from its own
  bounding box — not a fixed scale multiplier, which gives sub-pixel edges on small objects.
- **Every character is instanced per body part**, not per character. A boss is the same rig at
  3.3× with a different `instanceColor`.
- **Any `reset → push → flush` render path will eventually lose its flush and fail silently.**
  It already happened here: the enemy layers were never flushed, so every draugr was invisible
  while still charging and still killing crew, and it read as a balance problem. **Assert
  `mesh.count` against the entity list length.**
- **Use `requestAnimationFrame` to draw, never to undo.** A flash cleared from a rAF callback
  stuck at full opacity when the tab was hidden. `setTimeout` instead.
- **There is a headless tick seam behind `?debug`** — `frame(now)` computes dt and calls rAF,
  `tick(dt)` does the work. A whole run compresses into `__CR.advance(56)` plus a screenshot.
  Every balance number in this game was set that way. Keep it.
- **Seeding or clearing the save needs `Storage.prototype.setItem` frozen first**, or the
  outgoing page writes live state back over it on reload.

---

## Record as you go

Write lessons into `gamedev-notes` **in the same commit as the change that taught them**, not
at the end of a session. Several games run at once; a lesson recorded after this one finishes
is one the next game never got.
