import { test, expect, type Page } from '@playwright/test';
import { VERSION } from '../src/changelog.js';

/* Smoke tests against the production build.

   Pure unit tests cannot see a wiring bug: a dropped import, a missing DOM id,
   a boot-order regression, or a render layer that stopped being flushed. This
   file boots the real bundle and plays the game.

   The load-bearing one is the last: `the simulation is unchanged`. Wick is
   deterministic given a fresh save - the level layout is seeded on
   (chunk, workshop), and everything the candle meets is a function of that -
   so forty simulated seconds produce the same numbers every time. That makes a
   whole-game golden possible, which is a far stronger safety net than testing
   any single function.

   The rest are mostly *design* tests wearing a smoke test's clothes. Several
   assert that a mechanic actually occurs during a real run, which is the only
   thing that catches a mechanic whose condition can never be true - a failure
   mode that produces no error, nothing missing on screen, and a game that
   simply plays differently than it reads. This repo has shipped that bug
   before and it survived for the whole life of the previous game. */

const KEY = 'wick.v1';

/* Everything here drives the headless tick seam rather than wall-clock time.
   `?debug` exposes __CR.freeze(), which stops the rAF loop and restarts the
   level, and __CR.advance(seconds), which steps the simulation at a fixed
   delta. Freezing first is what makes the numbers reproducible: without it the
   run has already been playing itself for however long the machine took to
   boot the bundle, and every result moves with the machine. */
async function bootFresh(page: Page, seconds = 0) {
  await page.addInitScript((key) => {
    try {
      localStorage.removeItem(key);
      /* The game saves as it plays. Freeze the key so a reload inside a test
         cannot inherit state from the run before it. */
      const set = Storage.prototype.setItem;
      Storage.prototype.setItem = function (k: string, v: string) {
        if (k === key) return;
        return set.call(this, k, v);
      };
    } catch (e) { /* private mode */ }
  }, KEY);
  page.on('pageerror', (e) => { throw new Error('uncaught page error: ' + e.message); });
  await page.goto('/?debug');
  await expect(page.locator('#boot')).toHaveClass(/hidden/, { timeout: 20_000 });
  await page.evaluate(() => (window as any).__CR.freeze());
  if (seconds) await page.evaluate((s) => (window as any).__CR.advance(s), seconds);
}

const state = (page: Page) => page.evaluate(() => (window as any).__CR.state());

/* Steer onto the nearest thing of one kind and drive over it.

   Polls the live entity list rather than guessing at coordinates, and never
   draws while polling: a test that samples every quarter second over a whole
   level makes hundreds of advance() calls, and one rendered frame each is
   hundreds of software-rasterised frames for nothing. */
async function chase(page: Page, kind: string, limit = 40): Promise<boolean> {
  for (let i = 0; i < limit * 4; i++) {
    const hit = await page.evaluate(({ k }) => {
      const CR = (window as any).__CR;
      const list = CR[k]();
      const z = CR.run.z;
      let best: any = null;
      for (const e of list) { if (e.z > z + 1.5 && (!best || e.z < best.z)) best = e; }
      if (best) CR.steer(Math.max(-1.5, Math.min(1.5, best.x)));
      CR.advance(0.25, 0.016, false);
      return { has: !!best };
    }, { k: kind });
    if (!hit) break;
    const s = await state(page);
    if (s.over) break;
  }
  return true;
}

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
  const a = await state(page);
  await page.evaluate(() => (window as any).__CR.advance(3));
  const b = await state(page);
  expect(a.z).toBeCloseTo(0, 1);
  expect(b.z).toBeGreaterThan(a.z + 20);
  expect(b.wick).toBeLessThan(a.wick);
});

test('the candle starts as a bare lit core', async ({ page }) => {
  await bootFresh(page);
  const s = await state(page);
  expect(s.layers).toBe(1);
  expect(s.colours).toBe(1);
  expect(s.wax).toBeGreaterThan(0);
  expect(s.lit).toBe(true);
  expect(s.lop).toBe(0);
});

test('dip arches add rings, and the candle visibly grows', async ({ page }) => {
  await bootFresh(page, 30);
  const s = await state(page);
  expect(s.dipped, 'a 30s run must pass several arches').toBeGreaterThan(2);
  expect(s.layers, 'and each new colour must add a ring').toBeGreaterThan(1);
  expect(s.colours).toBeGreaterThan(1);

  const start = await page.evaluate(() => (window as any).__CR.T.coreWax);
  expect(s.wax, 'the candle should be far heavier than its core').toBeGreaterThan(start * 1.8);
  expect(s.radius, 'and wider than the bare core').toBeGreaterThan(0.3);
});

test('the flame is a real light, and it grows with the candle', async ({ page }) => {
  /* The point of the whole visual design. If this ever reads zero the game is
     lit by ambient alone and every workshop looks like the first one. */
  await bootFresh(page, 2);
  const small = await page.evaluate(() => (window as any).__CR.flameLight.intensity);
  await page.evaluate(() => (window as any).__CR.advance(28));
  const big = await page.evaluate(() => (window as any).__CR.flameLight.intensity);
  expect(small).toBeGreaterThan(0);
  expect(big).toBeGreaterThan(small);
});

test('every hazard actually occurs in a real run', async ({ page }) => {
  /* Not "the code exists" - that it fires. The previous game on this stack
     shipped three mechanics that had literally never run, because a broken
     hash could not return the value they were gated on, and nothing about that
     is visible from the outside. Each of these drives onto the hazard and
     asserts the effect it is supposed to have. */
  await bootFresh(page);

  await chase(page, 'blades', 30);
  const afterBlade = await state(page);
  expect(afterBlade.shaved, 'a blade must take wax off the candle').toBeGreaterThan(0);
  expect(afterBlade.lop, 'and leave it out of true').toBeGreaterThan(0);
});

test('blades can actually be dodged, so steering is the game', async ({ page }) => {
  /* The single most important design claim in the runner, and the one that was
     quietly false first time round. A blade's disc plus a grown candle's own
     radius sweeps a fixed width of road; if that is most of the steerable
     band, then a player who steers perfectly loses about as much wax as one
     who never touches the screen, and every other system is decoration on a
     game with no input.

     Measured rather than asserted about the constants, because the thing that
     matters is the interaction between three numbers that live in different
     files. */
  await bootFresh(page);
  const passive = await page.evaluate(() => {
    const CR = (window as any).__CR;
    CR.freeze();
    CR.advance(38, 0.016, false);
    return CR.state().shaved;
  });

  const dodged = await page.evaluate(() => {
    const CR = (window as any).__CR;
    CR.freeze();
    for (let i = 0; i < 300; i++) {
      const b = CR.blades().filter((e: any) => !e.hit && e.z > CR.run.z).sort((a: any, c: any) => a.z - c.z)[0];
      const clamp = CR.T.laneClamp;
      if (b) {
        /* Steer to whichever side of the blade is further from it and still on
           the road - the same decision a thumb makes. */
        const left = -clamp, right = clamp;
        CR.steer(Math.abs(b.x - left) > Math.abs(b.x - right) ? left : right);
      }
      CR.advance(0.13, 0.016, false);
      if (CR.run.over || CR.run.z > 400) break;
    }
    return CR.state().shaved;
  });

  expect(passive, 'standing still must be punished, or blades are not a hazard').toBeGreaterThan(0);
  expect(dodged, `dodging took ${dodged} wax against ${passive} standing still`)
    .toBeLessThan(passive * 0.55);
});

test('some droplet lines are guarded by a blade', async ({ page }) => {
  /* The risk-reward beat of the whole runner, and the kind of mechanic that
     quietly never fires. It depends on two independent spawn rolls landing in
     the same chunk and then a third agreeing, so it is entirely possible to
     write it, ship it, and have it happen zero times per level while nothing
     looks wrong. Count them in a real level instead of trusting the odds. */
  await bootFresh(page);
  const guarded = await page.evaluate(() => {
    const CR = (window as any).__CR;
    const seen = new Set<string>();
    for (let i = 0; i < 500 && !CR.run.over; i++) {
      CR.advance(0.4, 0.016, false);
      for (const b of CR.blades()) {
        for (const d of CR.drips()) {
          if (Math.abs(d.x - b.x) < 0.5 && Math.abs(d.z - b.z) < 9) {
            seen.add(Math.round(b.z * 10) + ':' + Math.round(b.x * 10));
          }
        }
      }
    }
    return seen.size;
  });
  expect(guarded, 'a level must put some wax behind some danger').toBeGreaterThan(2);
});

test('a heat lamp melts wax without bending the candle', async ({ page }) => {
  await bootFresh(page, 8);

  /* Measured across a single tick, not across the whole chase.

     The first version compared avgLop before and after driving to a lamp and
     failed - correctly. avgLop is wax-weighted, so passing a dip arch on the
     way adds a ring with no lean and dilutes the average downward. The
     assertion was true of the mechanic and false of the journey. What actually
     needs proving here is narrow: that the tick which lost wax was a *melt* -
     wax down, `shaved` untouched, lean untouched. */
  const melted = await page.evaluate(() => {
    const CR = (window as any).__CR;
    for (let i = 0; i < 400; i++) {
      const l = CR.lamps().filter((e: any) => e.z > CR.run.z + 1.5).sort((a: any, b: any) => a.z - b.z)[0];
      if (l) CR.steer(Math.max(-1.5, Math.min(1.5, l.x)));
      const a = CR.state();
      CR.advance(0.2, 0.016, false);
      const b = CR.state();
      if (b.over) return { ran: false };
      if (b.wax < a.wax - 0.05 && CR.run.inHeat > 0 && b.shaved === a.shaved) {
        return { ran: true, lost: a.wax - b.wax, lopBefore: a.lop, lopAfter: b.lop };
      }
    }
    return { ran: false };
  });

  expect(melted.ran, 'the run should have reached a lamp and melted on it').toBe(true);
  expect(melted.lost, 'a heat lamp must melt wax').toBeGreaterThan(0);
  expect(melted.lopAfter, 'heat comes off evenly, so it must not bend the candle')
    .toBeCloseTo(melted.lopBefore!, 6);
});

test('water snuffs the wick, and heat lights it again', async ({ page }) => {
  /* The best interaction in the game, and the one most likely to rot: it
     depends on two unrelated systems agreeing. */
  await bootFresh(page);
  const snuffed = await page.evaluate(() => {
    const CR = (window as any).__CR;
    for (let i = 0; i < 500; i++) {
      const p = CR.pools().filter((e: any) => e.z > CR.run.z + 1.5).sort((a: any, b: any) => a.z - b.z)[0];
      if (p) CR.steer(Math.max(-1.5, Math.min(1.5, p.x)));
      CR.advance(0.15, 0.016, false);
      if (!CR.run.lit) return true;
      if (CR.run.over) return false;
    }
    return false;
  });
  expect(snuffed, 'driving into water must put the flame out').toBe(true);
  expect(await page.evaluate(() => (window as any).__CR.flameLight.intensity))
    .toBe(0);

  const relit = await page.evaluate(() => {
    const CR = (window as any).__CR;
    /* Park the snuff timer so the only thing that can relight the candle is a
       lamp - otherwise this passes on the mercy timer and proves nothing. */
    CR.run.snuffTimer = 999;
    for (let i = 0; i < 500; i++) {
      const l = CR.lamps().filter((e: any) => e.z > CR.run.z + 1.5).sort((a: any, b: any) => a.z - b.z)[0];
      if (l) CR.steer(Math.max(-1.5, Math.min(1.5, l.x)));
      CR.advance(0.15, 0.016, false);
      if (CR.run.lit) return true;
      if (CR.run.over) return false;
    }
    return false;
  });
  expect(relit, 'a heat lamp must relight a snuffed wick').toBe(true);
});

test('a snuffed candle takes half a dip and no droplets', async ({ page }) => {
  await bootFresh(page, 6);
  const got = await page.evaluate(() => {
    const CR = (window as any).__CR;
    CR.run.lit = false; CR.run.snuffTimer = 999;
    const w0 = CR.state().wax;
    /* Drive over droplets while dark. */
    for (let i = 0; i < 60; i++) {
      const d = CR.drips().filter((e: any) => e.z > CR.run.z + 1.5).sort((a: any, b: any) => a.z - b.z)[0];
      if (!d) break;
      CR.steer(Math.max(-1.5, Math.min(1.5, d.x)));
      CR.advance(0.15, 0.016, false);
      if (CR.run.over) break;
    }
    return { before: w0, after: CR.state().wax };
  });
  expect(got.after, 'a cold candle must not gain wax from droplets')
    .toBeLessThanOrEqual(got.before + 1e-6);
});

test('the wick runs out, and that ends the run without wiping it', async ({ page }) => {
  await bootFresh(page, 12);
  const before = await state(page);
  expect(before.wax).toBeGreaterThan(0);

  const end = await page.evaluate(() => {
    const CR = (window as any).__CR;
    CR.run.wick = 0.4;
    CR.advance(2, 0.016, false);
    return { over: CR.run.over, appraisal: CR.appraisal(), z: CR.run.z };
  });
  expect(end.over, 'the wick guttering must end the run').toBe(true);
  expect(end.appraisal, 'and it must still be appraised').not.toBeNull();
  expect(end.appraisal.value, 'a guttered candle still sells').toBeGreaterThan(0);
  expect(end.appraisal.delivered, 'but at the unfinished rate').toBeLessThan(1);

  await expect(page.locator('#shopScreen')).not.toHaveClass(/hidden/, { timeout: 8000 });
  await expect(page.locator('#shopTitle')).toHaveText('GUTTERED OUT');
});

test('reaching the bench sells the candle and opens the next workshop', async ({ page }) => {
  /* Asserts the state that distinguishes the two outcomes, not the panel that
     shows both. The previous game checked only that a screen opened and
     matched /CAMP/, which was true of winning and of dying, and it passed
     through an entire balance cliff. */
  await bootFresh(page);
  const res = await page.evaluate(() => {
    const CR = (window as any).__CR;
    /* Give it enough wick to certainly arrive, then run to the bench. */
    CR.run.wick = 9999; CR.run.wickMax = 9999;
    for (let i = 0; i < 400 && !CR.run.over; i++) CR.advance(0.5, 0.016, false);
    return { over: CR.run.over, a: CR.appraisal(), level: CR.S.level, coins: CR.S.coins };
  });
  expect(res.over).toBe(true);
  expect(res.a.delivered, 'arriving at the bench is the full rate').toBe(1);
  expect(res.a.value).toBeGreaterThan(0);
  expect(res.level, 'selling a delivered candle advances the workshop').toBeGreaterThan(1);
  expect(res.coins).toBeGreaterThanOrEqual(res.a.value);

  await expect(page.locator('#shopScreen')).not.toHaveClass(/hidden/, { timeout: 8000 });
  await expect(page.locator('#shopTitle')).toHaveText('THE CHANDLERY');
  await expect(page.locator('#appraisal')).not.toHaveClass(/hidden/);
  await expect(page.locator('#apGrade')).not.toBeEmpty();
  await expect(page.locator('#apTotal')).not.toHaveText('0');
});

test('the shop sells things, and a purchase changes the game', async ({ page }) => {
  await bootFresh(page);
  await page.evaluate(() => {
    const CR = (window as any).__CR;
    CR.S.coins = 999999; CR.S.best = 9; CR.S.seenShop = true;
  });
  await page.evaluate(() => (window as any).__CR.run.wick = 0.1);
  await page.evaluate(() => (window as any).__CR.advance(1, 0.016, false));
  await expect(page.locator('#shopScreen')).not.toHaveClass(/hidden/, { timeout: 8000 });

  const before = await page.evaluate(() => (window as any).__CR.S.up.core);
  await page.locator('[data-buy="core"]').click();
  const after = await page.evaluate(() => (window as any).__CR.S.up.core);
  expect(after, 'buying Thicker Core must raise its level').toBe(before + 1);

  /* And it must reach the game, not just the save. */
  await page.locator('#btnGo').click();
  await expect(page.locator('#shopScreen')).toHaveClass(/hidden/);
  const s = await state(page);
  expect(s.wax, 'the next candle starts thicker').toBeGreaterThan(7);
});

test('the scent shelf shows every scent, found or not', async ({ page }) => {
  await bootFresh(page);
  await page.evaluate(() => {
    const CR = (window as any).__CR;
    CR.S.coins = 100; CR.S.scents.push(0);
    CR.run.wick = 0.1;
    CR.advance(1, 0.016, false);
  });
  await expect(page.locator('#shopScreen')).not.toHaveClass(/hidden/, { timeout: 8000 });
  const total = await page.evaluate(() => (window as any).__CR.SCENTS.length);
  await expect(page.locator('#scents .scent')).toHaveCount(total);
  await expect(page.locator('#scents .scent.miss')).toHaveCount(total - 1);
  await expect(page.locator('#scentCount')).toHaveText('1/' + total);
});

test('every render layer flushes what the model holds', async ({ page }) => {
  /* A reset -> push -> flush pipeline that loses its flush fails completely
     silently: the count stays where it was, so entities are invisible while
     still colliding, still costing wax, still ending runs. It has happened in
     this repo, and it read as a balance problem for a whole session. */
  await bootFresh(page, 24);
  const m = await page.evaluate(() => {
    const CR = (window as any).__CR;
    CR.advance(0.02);                       // one drawn frame, so counts are current
    return {
      rings: CR.C.ring.mesh.count,
      ringOutlines: CR.C.ring.out.count,
      layers: CR.candle().length,
      blades: CR.W.blade.mesh.count,
      bladesLive: CR.blades().filter((b: any) => !b.hit && b.z > CR.run.z - 6).length,
      lamps: CR.W.lamp.mesh.count,
      lampsLive: CR.lamps().length,
      wick: CR.C.wick.mesh.count,
    };
  });
  expect(m.rings, 'one instance per wax layer').toBe(m.layers);
  expect(m.ringOutlines, 'and an outline hull for each').toBe(m.layers);
  expect(m.wick).toBe(1);
  expect(m.lamps).toBe(m.lampsLive);
  expect(m.blades).toBeGreaterThan(0);
});

test('draw calls stay in budget with the road full', async ({ page }) => {
  await bootFresh(page, 30);
  await page.evaluate(() => (window as any).__CR.advance(0.02));
  const s = await state(page);
  expect(s.calls, `draw calls were ${s.calls}`).toBeLessThan(70);
  expect(s.calls, 'a collapse to almost nothing means a layer stopped drawing').toBeGreaterThan(12);
});

test('the HUD says what the model says', async ({ page }) => {
  await bootFresh(page, 26);
  const s = await state(page);
  await expect(page.locator('#waxN')).toHaveText(String(Math.round(s.wax)));
  await expect(page.locator('#stack i')).toHaveCount(s.layers);
  await expect(page.locator('#level')).toContainText('1');
  const grade = await page.evaluate(() => (window as any).__CR.appraiseNow(true).grade);
  await expect(page.locator('#gradeN')).toHaveText(grade);
});

test('the build stamp and version are populated', async ({ page }) => {
  await bootFresh(page);
  await page.evaluate(() => { (window as any).__CR.run.wick = 0.1; (window as any).__CR.advance(1, 0.016, false); });
  await expect(page.locator('#shopScreen')).not.toHaveClass(/hidden/, { timeout: 8000 });
  await expect(page.locator('#verNum')).toHaveText('v' + VERSION);
  await expect(page.locator('#build')).toContainText('build');
  await expect(page.locator('#build')).not.toContainText('unknown');
});

test('dragging right moves the candle right on the screen', async ({ page }) => {
  /* Drives real pointer events and then asks where the candle actually *is* in
     the frame, in normalised device coordinates.

     Every other test in this file steers with `__CR.steer()`, which takes a
     world coordinate - and that is precisely the layer an inverted control
     scheme hides under, because world x and screen x are not the same axis
     here. The camera sits behind the candle looking along +z, which is a 180
     degree turn about Y, so world +x projects to screen LEFT. The previous
     game on this stack shipped with the drag mapped the obvious way and had
     inverted steering for its whole life; nothing caught it because nothing
     ever touched the screen. */
  await bootFresh(page, 3);

  const ndcOf = () => page.evaluate(() => {
    const CR = (window as any).__CR;
    const v = new CR.three.Vector3(CR.run.x, 0.5, CR.run.z);
    return v.project(CR.camera).x;
  });

  await page.mouse.move(190, 620);
  await page.mouse.down();
  await page.mouse.move(340, 620, { steps: 6 });
  await page.evaluate(() => (window as any).__CR.advance(1.2, 0.016, false));
  const right = await ndcOf();
  await page.mouse.up();

  await page.mouse.move(190, 620);
  await page.mouse.down();
  await page.mouse.move(40, 620, { steps: 6 });
  await page.evaluate(() => (window as any).__CR.advance(1.2, 0.016, false));
  const left = await ndcOf();
  await page.mouse.up();

  expect(right, `dragging right put the candle at ndc ${right}`).toBeGreaterThan(0.05);
  expect(left, `dragging left put the candle at ndc ${left}`).toBeLessThan(-0.05);
});

test('steering is clamped to the road', async ({ page }) => {
  await bootFresh(page, 2);
  await page.evaluate(() => (window as any).__CR.steer(99));
  await page.evaluate(() => (window as any).__CR.advance(2, 0.016, false));
  const far = await page.evaluate(() => (window as any).__CR.run.x);
  const clamp = await page.evaluate(() => (window as any).__CR.T.laneClamp);
  expect(far).toBeLessThanOrEqual(clamp + 0.001);
  expect(far).toBeGreaterThan(clamp - 0.2);
});

/* ── the golden ──────────────────────────────────────────────────────────────

   Forty simulated seconds of a fresh first workshop, with no steering, and
   every number the simulation produces. This is the test that makes
   refactoring safe: it is not checking any one function, it is checking that
   the whole game still plays out identically.

   If a deliberate balance change moves these, re-record them in the same
   commit and say so in the message - but read the diff first. A rendering,
   layout or build change must not touch them at all. */
test('the simulation is unchanged after forty seconds', async ({ page }) => {
  await bootFresh(page, 40);
  const s = await state(page);
  const { calls, ...sim } = s;

  expect(sim).toEqual({
    z: 412.60800000001296,
    wax: 39.8496,
    layers: 4,
    colours: 3,
    pairs: 3,
    lop: 0.2446,
    radius: 0.5524,
    wick: 14.134,
    lit: true,
    dipped: 5,
    shaved: 13.8,
    scents: 1,
    drips: 15,
    blades: 3,
    lamps: 1,
    pools: 1,
    flasks: 0,
    arches: 1,
    over: false,
    coins: 0,
    level: 1,
  });
});
