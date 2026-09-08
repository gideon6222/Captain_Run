import { test, expect, type Page } from '@playwright/test';
import { VERSION } from '../src/changelog.js';

/* Smoke tests against the production build.

   Pure unit tests cannot see a wiring bug: a dropped import, a missing DOM id,
   a boot-order regression, or a render layer that stopped being flushed. This
   file boots the real bundle and plays the game.

   The load-bearing one is the last: `the simulation is unchanged`. Captain Run
   is deterministic given a fresh save - spawning is seeded on (chunk, ascent),
   and combat is a function of that - so forty simulated seconds produce the
   same numbers every time. That makes a whole-game golden test possible, which
   is a much stronger safety net than testing any single function, and it is
   what makes refactoring 1,600 lines into modules safe to attempt at all. */

/* Everything here drives the headless tick seam rather than wall-clock time.
   `?debug` exposes __CR.freeze(), which stops the rAF loop and restarts the
   ascent, and __CR.advance(seconds), which steps the simulation at a fixed
   delta. Freezing first is what makes the numbers reproducible: without it the
   run has already been playing itself for however long the machine took to
   boot the bundle, and every result moves with the machine. */
async function bootFresh(page: Page, seconds = 0) {
  await page.addInitScript(() => {
    try {
      localStorage.removeItem('captainrun.v1');
      /* The game saves as it plays. Freeze the key so a reload inside a test
         cannot inherit state from the run before it. */
      const set = Storage.prototype.setItem;
      Storage.prototype.setItem = function (k: string, v: string) {
        if (k === 'captainrun.v1') return;
        return set.call(this, k, v);
      };
    } catch (e) { /* private mode */ }
  });
  page.on('pageerror', (e) => { throw new Error('uncaught page error: ' + e.message); });
  await page.goto('/?debug');
  await expect(page.locator('#boot')).toHaveClass(/hidden/, { timeout: 20_000 });
  await page.evaluate(() => (window as any).__CR.freeze());
  if (seconds) await page.evaluate((s) => (window as any).__CR.advance(s), seconds);
}

const state = (page: Page) => page.evaluate(() => (window as any).__CR.state());

test('boots without hitting the error overlay', async ({ page }) => {
  await bootFresh(page);
  await expect(page.locator('#err')).toHaveClass(/hidden/);
});

test('creates a WebGL context', async ({ page }) => {
  await bootFresh(page);
  const ok = await page.evaluate(() => {
    const c = document.querySelector('#game canvas') as HTMLCanvasElement | null;
    return !!(c && (c.getContext('webgl2') || c.getContext('webgl')));
  });
  expect(ok, 'three.js should have a live WebGL context').toBe(true);
});

test('the debug seam is present and advances the simulation', async ({ page }) => {
  await bootFresh(page);
  const before = await state(page);
  await page.evaluate(() => (window as any).__CR.advance(10));
  const after = await state(page);
  expect(after.z, 'ten simulated seconds should move the warband').toBeGreaterThan(before.z + 50);
});

/* Every entity layer is a reset -> push -> flush pipeline, and a missing flush
   fails completely silently: the layer's count stays at zero, so the entities
   are invisible while still charging, still costing crew, still being killed.
   That has already happened once in this game, and it was read as a balance
   problem and given a whole tuning pass.

   A subsystem that renders nothing and a subsystem that does not exist look
   identical from outside, so the only way to see it is to compare the render
   count against the model. */
test('every entity that exists is actually drawn', async ({ page }) => {
  await bootFresh(page, 30);
  const counts = await page.evaluate(() => {
    const CR = (window as any).__CR;
    /* Each of E / L / W is a dict of Layer objects, and a Layer's live
       instance count lives on the InstancedMesh it owns - `layer.mesh.count`,
       which is exactly the number flush() wrote. Reading anything else here
       silently returns zero and turns this whole test into a no-op. */
    const counts = (layers: any) => {
      const out: Record<string, number> = {};
      for (const k in layers) out[k] = layers[k].mesh.count;
      return out;
    };
    return {
      enemies: CR.state().enemies,
      crew: CR.state().crew,
      E: counts(CR.E), L: counts(CR.L), W: counts(CR.W)
    };
  });

  expect(counts.enemies, 'thirty seconds in there should be draugr on the road')
    .toBeGreaterThan(0);

  /* Torsos are one per draugr, so this is the render count measured directly
     against the model - the comparison the balance pass could not make. */
  expect(counts.E.torso,
    'draugr exist in the model but no torso is drawn - the enemy layer is not ' +
    'being flushed').toBeGreaterThan(0);
  expect(counts.E.torso).toBeLessThanOrEqual(counts.enemies);

  /* A per-layer check, because flush() is called in a loop over the dict and a
     layer can also fall out by never being pushed to. Legs and horns are two
     per draugr; a mismatch means one of those layers stopped being written. */
  expect(counts.E.leg, 'legs should be two per drawn draugr').toBe(counts.E.torso * 2);
  expect(counts.E.horn, 'horns should be two per drawn draugr').toBe(counts.E.torso * 2);
  expect(counts.E.head).toBe(counts.E.torso);

  expect(counts.L.torso, 'the warband is not being drawn').toBeGreaterThan(0);
  expect(counts.L.head).toBe(counts.L.torso);
  expect(counts.L.leg).toBe(counts.L.torso * 2);
  /* crew shadows carry the draugr shadows too, so it is the one crew layer
     that is legitimately larger than the crew */
  expect(counts.L.shadow).toBeGreaterThanOrEqual(counts.L.torso);

  expect(counts.W.step, 'the road steps are the whole sense of speed').toBeGreaterThan(0);
  expect(counts.W.tree, 'scenery is not being drawn').toBeGreaterThan(0);
  expect(counts.W.tree).toBe(counts.W.trunk);
});

test('stays inside a sane draw-call budget', async ({ page }) => {
  await bootFresh(page, 40);
  const calls = (await state(page)).calls;
  expect(calls, 'draw calls per frame').toBeGreaterThan(0);
  /* Instanced per body part rather than per character, so crowd size does not
     move this. If it climbs, something stopped being instanced. */
  expect(calls, 'draw calls regressed - something is no longer instanced')
    .toBeLessThanOrEqual(90);
});

/* The property the golden below depends on, asserted directly.

   Two runs of the same forty seconds in the same page must land on identical
   numbers. That was not true until loot scatter and axe flight time were moved
   off Math.random: both decide *when* something lands - when a coin comes
   within magnet reach, when damage arrives - so they moved the result while
   looking like decoration. It made the golden fail about one run in ten, and
   pass every time it was run alone.

   This test says which of the two is broken when they fail together: if this
   one fails, the simulation is not deterministic and the golden's numbers are
   not the golden's fault. */
test('the same forty seconds replays identically', async ({ page }) => {
  await bootFresh(page);
  const [a, b] = await page.evaluate(() => {
    const CR = (window as any).__CR;
    const once = () => { CR.freeze(); CR.advance(40); return CR.state(); };
    return [once(), once()];
  });
  expect(b).toEqual(a);
});

/* THE important one. */
test('the simulation is unchanged after forty seconds', async ({ page }) => {
  await bootFresh(page, 40);
  const s = await state(page);

  /* z is checked as a range rather than a value: it accumulates floating-point
     error over 2,500 steps and lands a few hundredths apart between machines.
     Every other field is discrete and exactly reproducible.

     These numbers were recorded, not designed. If a deliberate balance change
     moves them, re-record them in the same commit and say so in the message -
     but a change to rendering, layout or the build must not touch them. */
  expect({
    crew: s.crew, gold: s.gold, iron: s.iron, tier: s.tier, dps: s.dps,
    enemies: s.enemies, crates: s.crates, gates: s.gates, boss: s.boss, over: s.over
  }).toEqual({
    crew: 12, gold: 731, iron: 36, tier: 3, dps: 1192,
    enemies: 18, crates: 5, gates: 1, boss: null, over: false
  });

  expect(s.z, 'the warband should be about 426 units up the mountain')
    .toBeGreaterThan(425);
  expect(s.z).toBeLessThan(428);
});

/* The first ascent must be winnable with no upgrades and no steering.

   `MOUNTAIN CAMP` is the victory screen and `CARRIED HOME` is the death
   screen, so this distinguishes finishing from dying - which the earlier
   version of this test did not, since both contain "CAMP" and both open the
   same panel. It caught the balance cliff that restoring brutes opened up:
   the run reached chunk 29 and died there every time, and the test still
   passed because a corpse is carried to a camp too. */
test('a fresh first ascent is won, not merely survived', async ({ page }) => {
  await bootFresh(page, 75);
  await expect(page.locator('#camp'),
    'seventy-five simulated seconds should finish an ascent').not.toHaveClass(/hidden/);
  await expect(page.locator('#campTitle'),
    'the warband died on the first ascent with no upgrades - the difficulty ' +
    'curve starts above the player').toHaveText('MOUNTAIN CAMP');
  await expect(page.locator('#err')).toHaveClass(/hidden/);
});

/* Regression on the whole class of bug the hash fix uncovered: a mechanic that
   is written, tuned and shipped but whose spawn condition can never be true.
   It fails as absence, so nothing errors and playtesting reads it as balance.

   These assert the mechanics appear in an actual run, not that the odds are
   right - the odds are checked against the source in test/util.test.mjs. */
test('brutes and punishing gates actually occur in a run', async ({ page }) => {
  await bootFresh(page);
  /* Sampled every half second across four ascents rather than once at the end.
     Draugr are short-lived - a single snapshot of a run that has already been
     won sees an empty road and proves nothing. */
  const seen = await page.evaluate(() => {
    const CR = (window as any).__CR;
    const ids = new Set<any>();
    let brutes = 0, enemies = 0, punish = 0, gates = 0;
    for (let a = 1; a <= 4; a++) {
      CR.S.ascent = a;
      CR.freeze();
      for (let i = 0; i < 130; i++) {
        CR.advance(0.5);
        for (const e of CR.enemies()) {
          if (e.boss || ids.has(e)) continue;
          ids.add(e);
          enemies++;
          if (e.brute) brutes++;
        }
        for (const g of CR.gates()) {
          if (ids.has(g)) continue;
          ids.add(g);
          gates++;
          /* a punishing gate is the only kind with a losing option */
          if (!g.left.good || !g.right.good) punish++;
        }
      }
    }
    return { brutes, enemies, punish, gates };
  });

  expect(seen.enemies, 'no draugr spawned in four ascents').toBeGreaterThan(50);
  expect(seen.brutes,
    'no brute spawned in four ascents - their spawn roll can never fire')
    .toBeGreaterThan(0);
  expect(seen.gates, 'no gates appeared').toBeGreaterThan(4);
  expect(seen.punish,
    'every gate offered two good options, so no gate is a decision - the ' +
    'punishing roll can never fire').toBeGreaterThan(0);
});

test('the good gate is not always on the same side', async ({ page }) => {
  await bootFresh(page);
  /* Read off the gates a run actually meets rather than sampling the hash, so
     this covers the swap as it is applied. If every good option lands on one
     side the player never has to read a gate, which was true for the whole of
     the game's life. */
  const sides = await page.evaluate(() => {
    const CR = (window as any).__CR;
    const seen = new Set<any>();
    const out: string[] = [];
    for (let a = 1; a <= 4; a++) {
      CR.S.ascent = a;
      CR.freeze();
      for (let i = 0; i < 130; i++) {
        CR.advance(0.5);
        for (const g of CR.gates()) {
          if (seen.has(g)) continue;
          seen.add(g);
          out.push(g.left.good ? 'L' : 'R');
        }
      }
    }
    return out;
  });
  expect(sides.length, 'no gates were seen at all').toBeGreaterThan(4);
  expect(new Set(sides).size,
    'the good option was on the same side of every gate in four ascents')
    .toBe(2);
});

test('the build stamp and version are populated', async ({ page }) => {
  await bootFresh(page, 75);
  /* Compared against the source of truth, not a shape. index.html ships
     `v0.0.0` as a placeholder, and that matches any sane version regex - so a
     pattern test would pass on a screen where nothing was ever populated. */
  await expect(page.locator('#verNum')).toHaveText('v' + VERSION);
  const stamp = await page.locator('#build').innerText();
  expect(stamp).toMatch(/^build [0-9a-f]{7}\+?\s+·/);
  expect(stamp, 'an unbuilt stamp means the Vite define pipeline broke').not.toContain('dev');
});
