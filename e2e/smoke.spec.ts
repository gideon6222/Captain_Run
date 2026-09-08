import { test, expect, type Page } from '@playwright/test';
import { VERSION } from '../src/changelog.js';

/* Smoke tests against the production build.

   Pure unit tests cannot see a wiring bug: a dropped import, a missing DOM id,
   a boot-order regression, or a render layer that stopped being flushed. This
   file boots the real bundle and plays the game.

   The load-bearing one is the last: `the simulation is unchanged`. The level
   layout is seeded on (chunk, level) and everything the tray meets is a
   function of that, so forty simulated seconds produce the same numbers every
   time. That makes a whole-game golden possible, which is a far stronger
   safety net than testing any single function.

   The rest are mostly *design* tests wearing a smoke test's clothes. Several
   assert that a mechanic actually occurs during a real run, which is the only
   thing that catches a mechanic whose condition can never be true - a failure
   mode that produces no error, nothing missing on screen, and a game that
   simply plays differently than it reads. This repo has shipped that bug
   before and it survived the whole life of the first game on this stack. */

const KEY = 'candlegift.v1';

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

/* Run a whole level under a scripted policy, never drawing while it polls: a
   level is hundreds of advance() calls and one rendered frame each would be
   hundreds of software-rasterised frames for nothing. */
async function playLevel(page: Page, mode: 'idle' | 'dodge' | 'greedy') {
  return page.evaluate((m) => {
    const CR = (window as any).__CR;
    for (let i = 0; i < 700 && !CR.run.over; i++) {
      const c = CR.T.laneClamp, z = CR.run.z;
      if (m !== 'idle') {
        const o = CR.obstacles().filter((e: any) => !e.hit && e.z > z && e.z < z + 15)
          .sort((a: any, b: any) => a.z - b.z)[0];
        const n = CR.notes().filter((e: any) => e.z > z).sort((a: any, b: any) => a.z - b.z)[0];
        if (o) CR.steer(Math.abs(o.x + c) > Math.abs(o.x - c) ? -c : c);
        else if (m === 'greedy' && n) CR.steer(Math.max(-c, Math.min(c, n.x)));
      }
      CR.advance(0.1, 0.016, false);
    }
    return { result: CR.result(), state: CR.state() };
  }, mode);
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
});

test('the tray starts as plain cream candles, unpressed and unwrapped', async ({ page }) => {
  await bootFresh(page);
  const s = await state(page);
  expect(s.bands).toBe(1);
  expect(s.colours).toBe(1);
  expect(s.glitter).toBe(0);
  expect(s.mould).toBe(0);
  expect(s.wrap).toBe(0);
  expect(s.count).toBeGreaterThan(0);
});

// ── the trailing tray, which is the mechanic everything rests on ────────────

test('the tray trails behind the leader and lags through a turn', async ({ page }) => {
  /* The property the whole game is built on. If the tray tracked the leader
     exactly it would be a crowd, obstacles would only ever hit the front, and
     a bigger tray would be pure upside with no trade. */
  await bootFresh(page, 6);
  const lag = await page.evaluate(() => {
    const CR = (window as any).__CR;
    CR.run.count = CR.T.maxCandles;
    CR.steer(CR.T.laneClamp);
    /* Sampled while the turn is still travelling down the tray.

       The first version advanced 1.4s, by which time the leader had covered
       sixteen units - twice the length of the tray - so the back had finished
       the same swerve and the two ends read identically. The window has to be
       shorter than the tray is long, which is the whole point of the
       mechanic. */
    CR.advance(0.45, 0.016, false);
    const pts = CR.stackAt();
    return { front: pts[1].x, back: pts[pts.length - 2].x, n: pts.length, clamp: CR.T.laneClamp };
  });
  const max = await page.evaluate(() => (window as any).__CR.T.maxCandles);
  expect(lag.n).toBe(max);
  expect(lag.front, 'the front row has committed to the swerve').toBeGreaterThan(lag.clamp - 0.4);
  expect(lag.back, 'the back of the tray must still be on the old line')
    .toBeLessThan(lag.front - 0.8);
});

test('the tray is more than one candle wide, so its colours can be seen', async ({ page }) => {
  await bootFresh(page, 4);
  const spread = await page.evaluate(() => {
    const CR = (window as any).__CR;
    CR.run.count = 9;
    CR.advance(0.3, 0.016, false);
    const pts = CR.stackAt();
    let min = Infinity, max = -Infinity;
    for (const p of pts) { min = Math.min(min, p.x); max = Math.max(max, p.x); }
    return max - min;
  });
  expect(spread, 'single file hides every candle behind the one in front')
    .toBeGreaterThan(0.5);
});

// ── stations ────────────────────────────────────────────────────────────────

test('a station is two different halves, and you get the one you drive through',
  async ({ page }) => {
    /* Full-width stations gave every tray every treatment regardless of input,
       which measured as an identical per-candle value across every play style.
       The halves are the only place player skill touches quality. */
    await bootFresh(page);
    const both = await page.evaluate(() => {
      const CR = (window as any).__CR;
      const out: any = {};
      for (const side of ['left', 'right']) {
        CR.freeze();
        CR.steer(side === 'left' ? -CR.T.laneClamp : CR.T.laneClamp);
        for (let i = 0; i < 300; i++) {
          CR.advance(0.1, 0.016, false);
          if (CR.state().dipped > 0) break;
        }
        const r = CR.recipe();
        out[side] = { layers: r.layers.slice(), glitter: r.glitter, mould: r.mould, wrap: r.wrap };
      }
      return out;
    });
    expect(JSON.stringify(both.left), 'the two halves must not do the same thing')
      .not.toBe(JSON.stringify(both.right));
  });

test('every station kind actually fires during a real level', async ({ page }) => {
  /* Not "the code exists" - that it happens. The first game on this stack
     shipped three mechanics that had literally never run. */
  await bootFresh(page);
  const seen = await page.evaluate(() => {
    const CR = (window as any).__CR;
    const kinds = new Set<string>();
    for (let i = 0; i < 700 && !CR.run.over; i++) {
      for (const st of CR.stations()) {
        if (st.z > CR.run.z && st.z < CR.run.z + 6) {
          kinds.add(CR.KINDS[st.left.kind].n);
          kinds.add(CR.KINDS[st.right.kind].n);
        }
      }
      CR.advance(0.1, 0.016, false);
    }
    return [...kinds];
  });
  for (const k of ['WAX', 'GLITTER', 'PRESS', 'WRAP']) {
    expect(seen, `no ${k} station appeared in a whole level`).toContain(k);
  }
});

test('driving a full level treats the tray: bands, glitter, a mould and a wrap',
  async ({ page }) => {
    await bootFresh(page);
    const { state: s } = await playLevel(page, 'idle');
    expect(s.bands, 'wax vats must band the candles').toBeGreaterThan(1);
    expect(s.colours).toBeGreaterThan(1);
    expect(s.glitter, 'the glitter station must apply').toBeGreaterThan(0);
    expect(s.mould, 'the press must stamp a real mould').toBeGreaterThan(0);
    expect(s.wrap, 'and the wrap station must wrap').toBeGreaterThan(0);
  });

// ── obstacles and money ─────────────────────────────────────────────────────

test('obstacles take candles, and dodging keeps them', async ({ page }) => {
  /* The single most important design claim in the runner. If a run that never
     touches the screen keeps about as many candles as one that plays well,
     every other system is decoration on a game with no input. Measured at the
     first set of numbers: idling kept fourteen candles and scored three stars. */
  await bootFresh(page);
  const idle = await playLevel(page, 'idle');
  await page.evaluate(() => (window as any).__CR.freeze());
  const dodge = await playLevel(page, 'dodge');

  expect(idle.state.lost, 'standing still must be punished').toBeGreaterThan(5);
  expect(dodge.state.count, `dodging kept ${dodge.state.count}, idling kept ${idle.state.count}`)
    .toBeGreaterThan(idle.state.count * 1.8);
  expect(dodge.result.stars, 'and it must show up in the rating')
    .toBeGreaterThan(idle.result.stars);
});

test('an obstacle can clip the tail of a tray the leader already cleared',
  async ({ page }) => {
    /* The reason the trail exists at all. Testing the leader alone would make a
       long tray strictly better than a short one - all upside, no trade. */
    await bootFresh(page, 5);
    const clipped = await page.evaluate(() => {
      const CR = (window as any).__CR;
      CR.run.count = CR.T.maxCandles;
      for (let i = 0; i < 600 && !CR.run.over; i++) {
        const o = CR.obstacles().filter((e: any) => !e.hit && e.z > CR.run.z)
          .sort((a: any, b: any) => a.z - b.z)[0];
        if (o) {
          /* Ride the obstacle's line, then swerve off it at the last moment:
             the leader clears it, the tail does not. */
          const late = o.z - CR.run.z < 4;
          CR.steer(late ? (o.x > 0 ? -CR.T.laneClamp : CR.T.laneClamp) : o.x);
        }
        const before = CR.state().count;
        CR.advance(0.1, 0.016, false);
        if (CR.state().count < before) return { hit: true };
      }
      return { hit: false };
    });
    expect(clipped.hit, 'a late swerve must still cost the back of the tray').toBe(true);
  });

test('banknotes are collected and paid out through earning power', async ({ page }) => {
  await bootFresh(page);
  const { result } = await playLevel(page, 'greedy');
  expect(result.cash, 'a run that sweeps the runway must bank cash').toBeGreaterThan(0);
  expect(result.value).toBeGreaterThan(result.candles);
});

test('some banknote lines are guarded by an obstacle', async ({ page }) => {
  /* The risk-reward beat, and the kind of mechanic that quietly never fires:
     it needs two independent spawn rolls to land in the same chunk and a third
     to agree. Count them in a real level instead of trusting the odds. */
  await bootFresh(page);
  const guarded = await page.evaluate(() => {
    const CR = (window as any).__CR;
    const seen = new Set<string>();
    for (let i = 0; i < 600 && !CR.run.over; i++) {
      CR.advance(0.35, 0.016, false);
      for (const o of CR.obstacles()) {
        for (const n of CR.notes()) {
          if (Math.abs(n.x - o.x) < 0.6 && Math.abs(n.z - o.z) < 9) {
            seen.add(Math.round(o.z * 10) + ':' + Math.round(o.x * 10));
          }
        }
      }
    }
    return seen.size;
  });
  expect(guarded, 'a level must put some money behind some danger').toBeGreaterThan(2);
});

test('gates grow the tray and never past what the renderer draws', async ({ page }) => {
  await bootFresh(page);
  const grew = await page.evaluate(() => {
    const CR = (window as any).__CR;
    const start = CR.state().count;
    let peak = start;
    for (let i = 0; i < 700 && !CR.run.over; i++) {
      CR.advance(0.1, 0.016, false);
      peak = Math.max(peak, CR.state().count);
    }
    return { start, peak, max: CR.T.maxCandles };
  });
  expect(grew.peak, 'gates must actually add candles').toBeGreaterThan(grew.start);
  expect(grew.peak, 'and never promise more than are drawn').toBeLessThanOrEqual(grew.max);
});

// ── the gift table and the shop ─────────────────────────────────────────────

test('reaching the table sells the tray, lights it and opens the next level',
  async ({ page }) => {
    /* Asserts the state that distinguishes outcomes, not the panel that shows
       them all. */
    await bootFresh(page);
    const { result } = await playLevel(page, 'dodge');
    expect(result).not.toBeNull();
    expect(result.value).toBeGreaterThan(0);
    expect(result.stars).toBeGreaterThanOrEqual(0);
    expect(result.stars).toBeLessThanOrEqual(3);

    const lit = await page.evaluate(() => {
      const CR = (window as any).__CR;
      CR.advance(2.2);
      return { flames: CR.flames.count, light: CR.giftLight.intensity, level: CR.S.level };
    });
    expect(lit.flames, 'the finished candles must light on the table').toBeGreaterThan(0);
    expect(lit.light, 'and cast the one warm light in the game').toBeGreaterThan(0);
    expect(lit.level, 'selling advances the level').toBeGreaterThan(1);

    await expect(page.locator('#shopScreen')).not.toHaveClass(/hidden/, { timeout: 10_000 });
    await expect(page.locator('#result')).not.toHaveClass(/hidden/);
    await expect(page.locator('#rTotal')).not.toHaveText('$0');
    await expect(page.locator('#rStars i')).toHaveCount(3);
  });

test('the workshop scrolls, and START is reachable without scrolling', async ({ page }) => {
  /* This was a hard blocker on the phone and not visible anywhere else: with
     `touch-action: none` on body - which a browser intersects up the whole
     ancestor chain - the sheet could not be panned, and the window-level
     steering handler called preventDefault() on any drag that started over it.
     The START button was the last thing after eight upgrades, a changelog and
     a build stamp, so unscrollable meant the game could not be continued past
     the first level.

     Two assertions, because either alone would have missed it: the sheet has
     to actually scroll, AND the control that leaves the screen must not depend
     on reaching the end of the screen. */
  await bootFresh(page);
  await page.evaluate(() => {
    const CR = (window as any).__CR;
    CR.S.coins = 9999999; CR.S.best = 9;
  });
  await playLevel(page, 'dodge');
  await expect(page.locator('#shopScreen')).not.toHaveClass(/hidden/, { timeout: 10_000 });

  const sheet = page.locator('#shopScreen .sheet');
  const box = await sheet.evaluate((el) => ({
    scrollH: el.scrollHeight, clientH: el.clientHeight,
    touch: getComputedStyle(el).touchAction,
    bodyTouch: getComputedStyle(document.body).touchAction,
  }));
  expect(box.scrollH, 'the shop must be longer than the sheet, or this proves nothing')
    .toBeGreaterThan(box.clientH + 40);
  expect(box.bodyTouch, 'touch-action on body blocks panning in every scroller under it')
    .not.toBe('none');
  expect(box.touch).toMatch(/pan-y|auto|manipulation/);

  /* START is visible and clickable with the sheet still at the top. */
  await sheet.evaluate((el) => { el.scrollTop = 0; });
  const go = page.locator('#btnGo');
  await expect(go).toBeInViewport();
  await go.click({ timeout: 3000 });
  await expect(page.locator('#shopScreen')).toHaveClass(/hidden/);

  /* And a real drag over the sheet scrolls it instead of steering the tray. */
  await page.evaluate(() => {
    const CR = (window as any).__CR;
    CR.run.wick = 0;
    CR.S.coins = 9999999;
  });
  await playLevel(page, 'dodge');
  await expect(page.locator('#shopScreen')).not.toHaveClass(/hidden/, { timeout: 10_000 });
  const beforeX = await page.evaluate(() => (window as any).__CR.run.targetX);
  await sheet.evaluate((el) => { el.scrollTop = 200; });
  const scrolled = await sheet.evaluate((el) => el.scrollTop);
  expect(scrolled, 'the sheet must be able to scroll at all').toBeGreaterThan(50);

  await page.mouse.move(190, 500);
  await page.mouse.down();
  await page.mouse.move(340, 500, { steps: 5 });
  await page.mouse.up();
  const afterX = await page.evaluate(() => (window as any).__CR.run.targetX);
  expect(afterX, 'a drag over the menu must not steer the tray').toBe(beforeX);
});

test('the results screen reports parts that reconstruct its own total', async ({ page }) => {
  await bootFresh(page);
  const { result: a } = await playLevel(page, 'greedy');
  const craft = a.layerMul * a.contrastMul * a.glitterMul * a.mouldMul * a.wrapMul;
  expect(Math.abs(a.craft - craft)).toBeLessThan(1e-9);
  expect(Math.abs(a.candles - a.each * a.count)).toBeLessThan(1e-6);
});

test('the shop sells things, and a purchase changes the game', async ({ page }) => {
  await bootFresh(page);
  await page.evaluate(() => {
    const CR = (window as any).__CR;
    CR.S.coins = 9999999; CR.S.best = 9; CR.S.seenShop = true;
  });
  const startedWith = await page.evaluate(() => (window as any).__CR.state().count);
  await playLevel(page, 'dodge');
  await expect(page.locator('#shopScreen')).not.toHaveClass(/hidden/, { timeout: 10_000 });

  const before = await page.evaluate(() => (window as any).__CR.S.up.stack);
  await page.locator('[data-buy="stack"]').click();
  const after = await page.evaluate(() => (window as any).__CR.S.up.stack);
  expect(after, 'buying Bigger Batch must raise its level').toBe(before + 1);

  /* And it must reach the game, not just the save. */
  await page.locator('#btnGo').click();
  await expect(page.locator('#shopScreen')).toHaveClass(/hidden/);
  const s = await state(page);
  expect(s.count, 'the next tray starts bigger').toBeGreaterThan(startedWith);
});

// ── rendering ───────────────────────────────────────────────────────────────

test('every render layer flushes what the model holds', async ({ page }) => {
  /* A reset -> push -> flush pipeline that loses its flush fails completely
     silently: the count stays where it was, so entities are invisible while
     still colliding. It has happened in this repo and read as a balance
     problem for a whole session. */
  await bootFresh(page, 22);
  const m = await page.evaluate(() => {
    const CR = (window as any).__CR;
    CR.advance(0.02);                    // one drawn frame, so counts are current
    const r = CR.recipe();
    const band = CR.C.band[r.mould];
    let otherBands = 0;
    CR.C.band.forEach((L: any, i: number) => { if (i !== r.mould) otherBands += L.mesh.count; });
    return {
      bands: band.mesh.count,
      bandOutlines: band.out.count,
      otherBands,
      want: CR.state().count * r.layers.length,
      wicks: CR.C.wick.mesh.count,
      count: CR.state().count,
    };
  });
  expect(m.bands, 'one instance per band per candle').toBe(m.want);
  expect(m.bandOutlines, 'and an outline hull for each').toBe(m.want);
  expect(m.otherBands, 'only the pressed mould may draw anything').toBe(0);
  expect(m.wicks).toBe(m.count);
});

test('draw calls stay in budget with the runway full', async ({ page }) => {
  await bootFresh(page, 26);
  await page.evaluate(() => (window as any).__CR.advance(0.02));
  const s = await state(page);
  expect(s.calls, `draw calls were ${s.calls}`).toBeLessThan(80);
  expect(s.calls, 'a collapse to almost nothing means a layer stopped drawing').toBeGreaterThan(12);
});

test('the HUD says what the model says', async ({ page }) => {
  await bootFresh(page, 24);
  const s = await state(page);
  await expect(page.locator('#countN')).toHaveText(String(s.count));
  await expect(page.locator('#stack i')).toHaveCount(s.bands);
  await expect(page.locator('#level')).toContainText('1');
});

test('the build stamp and version are populated', async ({ page }) => {
  await bootFresh(page);
  await playLevel(page, 'idle');
  await expect(page.locator('#shopScreen')).not.toHaveClass(/hidden/, { timeout: 10_000 });
  await expect(page.locator('#verNum')).toHaveText('v' + VERSION);
  await expect(page.locator('#build')).toContainText('build');
  await expect(page.locator('#build')).not.toContainText('unknown');
});

// ── controls ────────────────────────────────────────────────────────────────

test('steering is clamped to the runway', async ({ page }) => {
  await bootFresh(page, 2);
  await page.evaluate(() => (window as any).__CR.steer(99));
  await page.evaluate(() => (window as any).__CR.advance(2, 0.016, false));
  const far = await page.evaluate(() => (window as any).__CR.run.x);
  const clamp = await page.evaluate(() => (window as any).__CR.T.laneClamp);
  expect(far).toBeLessThanOrEqual(clamp + 0.001);
  expect(far).toBeGreaterThan(clamp - 0.2);
});

test('dragging right moves the tray right on the screen', async ({ page }) => {
  /* Drives real pointer events and then asks where the tray actually *is* in
     the frame, in normalised device coordinates.

     Every other test steers with `__CR.steer()`, which takes a world
     coordinate - and that is precisely the layer an inverted control scheme
     hides under, because world x and screen x are not the same axis here. The
     camera sits behind the tray looking along +z, which is a 180 degree turn
     about Y, so world +x projects to screen LEFT. The first game on this stack
     shipped with the drag mapped the obvious way and had inverted steering for
     its whole life; nothing caught it because nothing ever touched the
     screen. */
  await bootFresh(page, 3);

  const ndcOf = () => page.evaluate(() => {
    const CR = (window as any).__CR;
    const v = new CR.three.Vector3(CR.run.x, 0.5, CR.run.z);
    return v.project(CR.camera).x;
  });

  /* Each drag starts from a fresh centred run.

     Doing both in sequence looks tidier and is worthless: the second drag
     starts from wherever the first one left the tray, so two equal-and-
     opposite drags land back at the middle and the test passes at ndc ~0 no
     matter which way the controls are wired. That exact cancellation has
     already produced a green run on inverted steering once. */
  await page.mouse.move(190, 620);
  await page.mouse.down();
  await page.mouse.move(340, 620, { steps: 6 });
  await page.evaluate(() => (window as any).__CR.advance(1.4, 0.016, false));
  const right = await ndcOf();
  await page.mouse.up();

  await page.evaluate(() => (window as any).__CR.freeze());
  await page.evaluate(() => (window as any).__CR.advance(3, 0.016, false));
  await page.mouse.move(190, 620);
  await page.mouse.down();
  await page.mouse.move(40, 620, { steps: 6 });
  await page.evaluate(() => (window as any).__CR.advance(1.4, 0.016, false));
  const left = await ndcOf();
  await page.mouse.up();

  expect(right, `dragging right put the tray at ndc ${right}`).toBeGreaterThan(0.05);
  expect(left, `dragging left put the tray at ndc ${left}`).toBeLessThan(-0.05);
});

/* ── the golden ──────────────────────────────────────────────────────────────

   Thirty simulated seconds of a fresh first level, with no steering, and every
   number the simulation produces. This is the test that makes refactoring
   safe: it is not checking any one function, it is checking that the whole
   game still plays out identically.

   If a deliberate balance change moves these, re-record them in the same
   commit and say so in the message - but read the diff first. A rendering,
   layout or build change must not touch them at all. */
test('the simulation is unchanged after thirty seconds', async ({ page }) => {
  /* Thirty, not forty: a level is about thirty-seven seconds of runway, so a
     forty-second sample lands after the tray has already been sold and records
     the shop rather than the run. */
  await bootFresh(page, 30);
  const s = await state(page);
  const { calls, ...sim } = s;

  expect(sim).toEqual({
    z: 341.136000000009,
    count: 24,
    bands: 4,
    colours: 3,
    pairs: 3,
    glitter: 1,
    mould: 1,
    wrap: 0,
    cash: 1680,
    lost: 11,
    dipped: 6,
    stations: 2,
    gates: 1,
    obstacles: 12,
    notes: 5,
    over: false,
    coins: 0,
    level: 1,
  });
});
