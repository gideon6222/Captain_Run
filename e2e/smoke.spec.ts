import { test, expect, type Page } from '@playwright/test';
import { VERSION } from '../src/changelog.js';

/* Smoke tests against the production build.

   Pure unit tests cannot see a wiring bug: a dropped import, a missing DOM id,
   a boot-order regression, or a render layer that stopped being flushed. This
   file boots the real bundle and plays the game.

   The most important test here is `weaving the pools beats holding a line`.
   That is the claim the whole game rests on, it is the one the previous build
   got wrong, and it is invisible to every other kind of test. */

const KEY = 'candlegift.v1';

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

/* Run a whole level under a scripted policy, never drawing while it polls. */
async function playLevel(page: Page, mode: 'idle' | 'dodge' | 'gather' | 'weave') {
  return page.evaluate((m) => {
    const CR = (window as any).__CR;
    let flip = 0;
    for (let i = 0; i < 800 && !CR.run.over; i++) {
      const c = CR.T.laneClamp, z = CR.run.z;
      if (m !== 'idle') {
        const o = CR.obstacles().filter((e: any) => !e.hit && e.z > z && e.z < z + 15)
          .sort((a: any, b: any) => a.z - b.z)[0];
        const st = CR.stations().filter((e: any) => Math.abs(e.z - z) < CR.T.poolLen * 0.75)[0];
        const lc = CR.loose().filter((e: any) => e.z > z).sort((a: any, b: any) => a.z - b.z)[0];
        if (o) CR.steer(Math.abs(o.x + c) > Math.abs(o.x - c) ? -c : c);
        else if (m === 'weave' && st) {
          /* Sweep across the pair so different candles land in each pool - the
             thing the reference's own guide tells players to do. */
          flip++;
          CR.steer(Math.floor(flip / 4) % 2 ? -c * 0.75 : c * 0.75);
        } else if (m !== 'dodge' && lc) CR.steer(Math.max(-c, Math.min(c, lc.x)));
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

test('the tray starts as plain cream candles, each with its own recipe', async ({ page }) => {
  await bootFresh(page);
  const s = await state(page);
  expect(s.count).toBeGreaterThan(0);
  expect(s.avgColours).toBe(1);
  expect(s.plain).toBe(s.count);
  expect(s.pressed).toBe(0);
  expect(s.wrapped).toBe(0);

  /* Separate objects, not one shared reference: with a shared reference the
     first dip would silently colour the whole tray and every test below would
     still pass. */
  const shared = await page.evaluate(() => {
    const t = (window as any).__CR.tray();
    return t.length > 1 && t[0] === t[1];
  });
  expect(shared, 'candles must not share a recipe object').toBe(false);
});

// ── the claim the whole game rests on ───────────────────────────────────────

test('weaving the pools beats holding a line, end to end', async ({ page }) => {
  /* THE test. The reference's strategy guide: "if there are two pools of wax
     side by side, you should swipe left and right quickly to try and dunk all
     of your candles in both of the pools."

     If weaving does not out-earn simply collecting, then steering through a
     station does nothing, every pool is a thing that happens to you, and the
     game is a screensaver. The previous build measured *identical* per-candle
     value across every play style, which is exactly this test failing. */
  await bootFresh(page);
  const gather = await playLevel(page, 'gather');
  await page.evaluate(() => (window as any).__CR.freeze());
  const weave = await playLevel(page, 'weave');

  expect(weave.result.each,
    `weaving made $${Math.round(weave.result.each)} a candle, gathering $${Math.round(gather.result.each)}`)
    .toBeGreaterThan(gather.result.each * 1.6);
  expect(weave.state.avgColours, 'and it must show up as more colours per candle')
    .toBeGreaterThan(1.5);
  expect(weave.result.stars).toBeGreaterThan(gather.result.stars);
});

test('a pool treats the candles standing in it, not the whole tray', async ({ page }) => {
  /* Drive in and out of the first pools and the tray must come out PARTLY
     treated - some candles dipped, some not. A tray that comes out uniform
     means the pool is a gate again. */
  await bootFresh(page, 2);
  const split = await page.evaluate(() => {
    const CR = (window as any).__CR;
    for (let i = 0; i < 800 && !CR.run.over; i++) {
      const st = CR.stations().filter((e: any) => e.z > CR.run.z - CR.T.poolLen)[0];
      if (st) {
        const inIt = Math.abs(st.z - CR.run.z) < CR.T.poolLen * 0.5;
        CR.steer(inIt ? CR.T.laneClamp : -CR.T.laneClamp);
      }
      CR.advance(0.08, 0.016, false);
      const s = CR.state();
      if (s.plain > 0 && s.plain < s.count) return { partial: true, plain: s.plain, count: s.count };
    }
    return { partial: false };
  });
  expect(split.partial,
    'a tray that comes out uniformly treated means the pool is a gate, not a pool').toBe(true);
});

test('every station kind actually fires during a real level', async ({ page }) => {
  await bootFresh(page);
  const seen = await page.evaluate(() => {
    const CR = (window as any).__CR;
    const kinds = new Set<string>();
    for (let i = 0; i < 800 && !CR.run.over; i++) {
      for (const st of CR.stations()) {
        if (st.z > CR.run.z - 4 && st.z < CR.run.z + 40) {
          kinds.add(CR.KINDS[st.left.kind].n);
          kinds.add(CR.KINDS[st.right.kind].n);
        }
      }
      CR.advance(0.1, 0.016, false);
    }
    return [...kinds];
  });
  for (const k of ['WAX', 'GLITTER', 'PRESS', 'WRAP']) {
    expect(seen, `no ${k} pool appeared in a whole level`).toContain(k);
  }
});

test('a full level treats the tray: colours, glitter and moulds', async ({ page }) => {
  await bootFresh(page);
  const { state: s } = await playLevel(page, 'gather');
  expect(s.avgColours, 'wax pools must band the candles').toBeGreaterThan(1.2);
  expect(s.avgGlitter, 'the glitter pool must apply').toBeGreaterThan(0);
  expect(s.pressed, 'the press must stamp some candles').toBeGreaterThan(0);
});

// ── the trailing tray ───────────────────────────────────────────────────────

const fillTray = () => {
  const CR = (window as any).__CR;
  while (CR.run.tray.length < CR.T.maxCandles) {
    CR.run.tray.push({ layers: [0], glitter: 0, mould: 0, wrap: 0 });
  }
};

test('the tray trails behind the leader and lags through a turn', async ({ page }) => {
  await bootFresh(page, 6);
  const lag = await page.evaluate(() => {
    const CR = (window as any).__CR;
    while (CR.run.tray.length < CR.T.maxCandles) {
      CR.run.tray.push({ layers: [0], glitter: 0, mould: 0, wrap: 0 });
    }
    CR.steer(CR.T.laneClamp);
    /* Sampled while the turn is still travelling down the tray - a window
       longer than the tray means both ends have finished the same swerve. */
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

test('an obstacle can clip the tail of a tray the leader already cleared', async ({ page }) => {
  await bootFresh(page, 5);
  const clipped = await page.evaluate(() => {
    const CR = (window as any).__CR;
    while (CR.run.tray.length < CR.T.maxCandles) {
      CR.run.tray.push({ layers: [0], glitter: 0, mould: 0, wrap: 0 });
    }
    for (let i = 0; i < 700 && !CR.run.over; i++) {
      const o = CR.obstacles().filter((e: any) => !e.hit && e.z > CR.run.z)
        .sort((a: any, b: any) => a.z - b.z)[0];
      if (o) {
        const late = o.z - CR.run.z < 4;
        CR.steer(late ? (o.x > 0 ? -CR.T.laneClamp : CR.T.laneClamp) : o.x);
      }
      const before = CR.state().count;
      CR.advance(0.1, 0.016, false);
      if (CR.state().count < before) return true;
    }
    return false;
  });
  expect(clipped, 'a late swerve must still cost the back of the tray').toBe(true);
});

// ── growth, money and obstacles ─────────────────────────────────────────────

test('loose candles grow the tray, and never past what is drawn', async ({ page }) => {
  await bootFresh(page);
  const { state: s } = await playLevel(page, 'gather');
  const max = await page.evaluate(() => (window as any).__CR.T.maxCandles);
  expect(s.gained, 'loose candles are the growth mechanic and must be collected')
    .toBeGreaterThan(4);
  expect(s.count).toBeLessThanOrEqual(max);
});

test('obstacles take candles, and dodging keeps them', async ({ page }) => {
  await bootFresh(page);
  const idle = await playLevel(page, 'idle');
  await page.evaluate(() => (window as any).__CR.freeze());
  const dodge = await playLevel(page, 'dodge');
  expect(idle.state.lost, 'standing still must be punished').toBeGreaterThan(5);
  expect(dodge.state.lost, `dodging lost ${dodge.state.lost}, idling lost ${idle.state.lost}`)
    .toBeLessThan(idle.state.lost);
});

test('banknotes are collected and paid through earning power', async ({ page }) => {
  await bootFresh(page);
  const { result } = await playLevel(page, 'gather');
  expect(result.cash).toBeGreaterThan(0);
  expect(result.value).toBeGreaterThan(result.candles);
});

test('some pickup lines are guarded by an obstacle', async ({ page }) => {
  await bootFresh(page);
  const guarded = await page.evaluate(() => {
    const CR = (window as any).__CR;
    const seen = new Set<string>();
    for (let i = 0; i < 700 && !CR.run.over; i++) {
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
  expect(guarded, 'a level must put some money behind some danger').toBeGreaterThan(1);
});

// ── the gift table and the shop ─────────────────────────────────────────────

test('reaching the table sells the tray, lights it and opens the next level',
  async ({ page }) => {
    await bootFresh(page);
    const { result } = await playLevel(page, 'gather');
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

test('the results screen reports the tray it was actually paid for', async ({ page }) => {
  await bootFresh(page);
  const { result: a, state: s } = await playLevel(page, 'weave');
  expect(a.count).toBe(s.count);
  expect(a.stats.count).toBe(s.count);
  expect(a.stats.pressed).toBe(s.pressed);
  expect(a.stats.wrapped).toBe(s.wrapped);
  expect(Math.abs(a.each * a.count - a.candles)).toBeLessThan(1e-6);
  await expect(page.locator('#rRows .rrow').first()).toContainText('CANDLES');
});

test('the workshop scrolls, and START is reachable without scrolling', async ({ page }) => {
  /* This was a hard blocker on the phone: `touch-action: none` on body - which
     a browser intersects up the whole ancestor chain - stopped the sheet
     panning, and the window-level steering handler called preventDefault() on
     drags over it. START sat below eight upgrades, so unscrollable meant the
     game could not be continued past the first level. */
  await bootFresh(page);
  await page.evaluate(() => {
    const CR = (window as any).__CR;
    CR.S.coins = 9999999; CR.S.best = 9;
  });
  await playLevel(page, 'gather');
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

  await sheet.evaluate((el) => { el.scrollTop = 0; });
  const go = page.locator('#btnGo');
  await expect(go).toBeInViewport();

  const beforeX = await page.evaluate(() => (window as any).__CR.run.targetX);
  await page.mouse.move(190, 500);
  await page.mouse.down();
  await page.mouse.move(340, 500, { steps: 5 });
  await page.mouse.up();
  expect(await page.evaluate(() => (window as any).__CR.run.targetX),
    'a drag over the menu must not steer the tray').toBe(beforeX);

  await go.click({ timeout: 3000 });
  await expect(page.locator('#shopScreen')).toHaveClass(/hidden/);
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
  expect(await page.evaluate(() => (window as any).__CR.S.up.stack)).toBe(before + 1);

  await page.locator('#btnGo').click();
  await expect(page.locator('#shopScreen')).toHaveClass(/hidden/);
  const s = await state(page);
  expect(s.count, 'the next tray starts bigger').toBeGreaterThan(startedWith);
});

// ── rendering ───────────────────────────────────────────────────────────────

test('every render layer flushes what the model holds', async ({ page }) => {
  /* A reset -> push -> flush pipeline that loses its flush fails completely
     silently. With per-candle moulds this also checks candles are drawn from
     the right band layer: a tray where only some candles are pressed puts them
     in different layers, and the totals must still add up. */
  await bootFresh(page, 22);
  const m = await page.evaluate(() => {
    const CR = (window as any).__CR;
    CR.advance(0.02);                    // one drawn frame, so counts are current
    const tray = CR.tray();
    let want = 0;
    for (const r of tray) want += r.layers.length;
    let drawn = 0, outlines = 0;
    CR.C.band.forEach((L: any) => { drawn += L.mesh.count; outlines += L.out.count; });
    return { drawn, outlines, want, wicks: CR.C.wick.mesh.count, count: tray.length };
  });
  expect(m.drawn, 'one instance per band per candle, across every mould layer').toBe(m.want);
  expect(m.outlines, 'and an outline hull for each').toBe(m.want);
  expect(m.wicks).toBe(m.count);
});

test('draw calls stay in budget with the runway full', async ({ page }) => {
  await bootFresh(page, 26);
  await page.evaluate(() => (window as any).__CR.advance(0.02));
  const s = await state(page);
  expect(s.calls, `draw calls were ${s.calls}`).toBeLessThan(90);
  expect(s.calls, 'a collapse to almost nothing means a layer stopped drawing').toBeGreaterThan(12);
});

test('the HUD says what the model says', async ({ page }) => {
  await bootFresh(page, 24);
  const s = await state(page);
  await expect(page.locator('#countN')).toHaveText(String(s.count));
  await expect(page.locator('#level')).toContainText('1');
  /* One chip per wax the tray is actually wearing - the readout that makes
     weaving legible. */
  const waxes = await page.evaluate(() =>
    (window as any).__CR.trayStats().palette.filter((n: number) => n > 0).length);
  await expect(page.locator('#stack i')).toHaveCount(waxes);
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
  /* Drives real pointer events and asks where the tray is in the frame, in
     normalised device coordinates. Every other test steers in WORLD
     coordinates, which is exactly the layer an inverted control scheme hides
     under: the camera looks along +z, so world +x is screen LEFT. The first
     game on this stack shipped inverted for its whole life. */
  await bootFresh(page, 3);
  const ndcOf = () => page.evaluate(() => {
    const CR = (window as any).__CR;
    return new CR.three.Vector3(CR.run.x, 0.5, CR.run.z).project(CR.camera).x;
  });

  await page.mouse.move(190, 620);
  await page.mouse.down();
  await page.mouse.move(340, 620, { steps: 6 });
  await page.evaluate(() => (window as any).__CR.advance(1.4, 0.016, false));
  const right = await ndcOf();
  await page.mouse.up();

  /* Each drag starts from a fresh centred run: two equal-and-opposite drags in
     sequence land back at the middle and pass at ndc ~0 whichever way the
     controls are wired. That cancellation has produced a green run on inverted
     steering once already. */
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

   Thirty simulated seconds of a fresh first level with no steering, and every
   number the simulation produces. Thirty, not forty: a level is about
   thirty-seven seconds of runway, so a longer sample records the shop.

   If a deliberate balance change moves these, re-record them in the same
   commit and say so - but read the diff first. A rendering, layout or build
   change must not touch them at all. */
test('the simulation is unchanged after thirty seconds', async ({ page }) => {
  await bootFresh(page, 30);
  const s = await state(page);
  const { calls, ...sim } = s;

  expect(sim).toEqual({
    z: 342.24000000000916,
    count: 27,
    avgColours: 2.7037,
    avgGlitter: 0.963,
    pressed: 22,
    wrapped: 6,
    plain: 2,
    worth: 4936,
    cash: 1080,
    lost: 7,
    gained: 26,
    dips: 112,
    stations: 2,
    obstacles: 14,
    notes: 3,
    loose: 16,
    over: false,
    coins: 0,
    level: 1,
  });
});
