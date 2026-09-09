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

/* Boot WITHOUT freezing, for the handful of tests that are about real elapsed
   time rather than about the simulation. `freeze()` stops the rAF loop, which
   is exactly the thing a pause test needs to observe. */
async function bootLive(page: Page) {
  await page.addInitScript((key) => {
    try {
      localStorage.removeItem(key);
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
}

/* Back to a clean LEVEL ONE, not just a clean run.

   `freeze()` restarts the level in place, and finishing a level increments
   `S.level` - so two policies played back to back are played on two different
   levels. Every layout decision is keyed on `hash(chunk, something + S.level)`,
   so that is not "slightly harder", it is a completely different runway: the
   comparison between the two policies measured the luck of level two. */
async function restart(page: Page) {
  await page.evaluate(() => {
    const CR = (window as any).__CR;
    for (const k of Object.keys(CR.S.up)) CR.S.up[k] = 0;
    CR.S.level = 1; CR.S.coins = 0;
    CR.freeze();
  });
}

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
  await restart(page);
  const gather = await playLevel(page, 'gather');
  await restart(page);
  const weave = await playLevel(page, 'weave');

  expect(weave.result.each,
    `weaving made $${Math.round(weave.result.each)} a candle, gathering $${Math.round(gather.result.each)}`)
    .toBeGreaterThan(gather.result.each * 1.6);
  expect(weave.state.avgColours, 'and it must show up as more colours per candle')
    .toBeGreaterThan(1.5);
  expect(weave.result.stars,
    `weaving rated ${weave.result.stars} stars, gathering ${gather.result.stars}`)
    .toBeGreaterThan(gather.result.stars);
});

/* `par` is the number the end-of-run gauge and the star rating are both drawn
   from, and it is the easiest number in the game to leave behind: it is not
   wrong until a station or a multiplier moves, and then it is silently wrong
   forever. So the four policies get pinned to the ratings they produce.

   These are LEVEL ONE's ratings, which are not the ones par was calibrated
   against - par comes from the mean over six levels, because one level swings a
   policy enormously on layout luck.

   Idle and dodge both rate zero, and that is measured rather than sloppy: with
   a batch that starts at ONE candle there is almost nothing to protect, so a
   bot that only avoids hazards scores what a bot that does nothing scores. The
   early game is about collecting. If this fails, re-measure over six levels and
   re-write the table beside `par` - do not widen the test. */
test('par still separates the ways of playing a level', async ({ page }) => {
  await bootFresh(page);
  const got: Record<string, number> = {};
  for (const mode of ['idle', 'dodge', 'gather', 'weave'] as const) {
    await restart(page);
    got[mode] = (await playLevel(page, mode)).result.stars;
  }
  expect(got, `stars by policy: ${JSON.stringify(got)}`)
    .toEqual({ idle: 0, dodge: 0, gather: 1, weave: 2 });
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

test('reaching the table lights the batch, then measures it against your best',
  async ({ page }) => {
    /* The end of a run is now the reference's: a numeric ruler with your own
       best marked on it, which the batch climbs. No stars, and no level
       advance until the reward is taken - taking it is the player's move. */
    await bootFresh(page);
    await page.evaluate(() => { (window as any).__CR.S.bestValue = 1; });
    const { result } = await playLevel(page, 'gather');
    expect(result.value).toBeGreaterThan(0);

    const lit = await page.evaluate(() => {
      const CR = (window as any).__CR;
      CR.advance(2.2);
      return { flames: CR.flames.count, light: CR.giftLight.intensity, level: CR.S.level };
    });
    expect(lit.flames, 'the finished candles must light on the table').toBeGreaterThan(0);
    expect(lit.light, 'and cast the one warm light in the game').toBeGreaterThan(0);
    expect(lit.level, 'the level does not advance until the reward is taken').toBe(1);

    await expect(page.locator('#ruler')).not.toHaveClass(/hidden/, { timeout: 10_000 });
    await expect(page.locator('#rulerTicks i').first()).toBeVisible();
    await expect(page.locator('#hsBand')).toBeVisible();
  });

test('the reward screen pays what the run was worth, and taking it moves on',
  async ({ page }) => {
    await bootFresh(page);
    const { result: a, state: st } = await playLevel(page, 'weave');
    expect(a.count).toBe(st.count);
    expect(Math.abs(a.each * a.count - a.candles)).toBeLessThan(1e-6);

    await expect(page.locator('#reward')).not.toHaveClass(/hidden/, { timeout: 10_000 });
    await expect(page.locator('#rwdAmt')).not.toHaveText('0');
    await expect(page.locator('#rwdHs'), 'the first run always beats a best of zero')
      .not.toHaveClass(/hidden/);
    /* The reference's multiplier fan is a rewarded-video gamble and there are
       no adverts here, so there is nothing to gamble against. It must stay
       gone: a wheel that always pays the same is a wheel-shaped lie. */
    await expect(page.locator('#fan')).toHaveCount(0);
    await expect(page.locator('#rwdBest')).not.toHaveText('0');

    const label = await page.locator('#claimLbl').textContent();
    expect(label, `claim button read "${label}"`).toMatch(/^CONTINUE/);

    const coinsBefore = await page.evaluate(() => (window as any).__CR.S.coins);
    await page.locator('#btnClaim').click();
    await expect(page.locator('#reward')).toHaveClass(/hidden/);
    const after = await page.evaluate(() => {
      const CR = (window as any).__CR;
      return { coins: CR.S.coins, level: CR.S.level, best: CR.S.bestValue };
    });
    expect(after.coins, 'the claim pays out').toBeGreaterThan(coinsBefore);
    expect(after.level, 'and moves to the next level').toBe(2);
    expect(after.best).toBeGreaterThan(0);
    /* Back to the home screen, over a live runway, which is where the
       reference sits between runs. */
    await expect(page.locator('#home')).not.toHaveClass(/hidden/);
  });

test('the shop scrolls, and the way out is reachable without scrolling', async ({ page }) => {
  /* This was a hard blocker on the phone: `touch-action: none` on body - which
     a browser intersects up the whole ancestor chain - stopped the sheet
     panning, and the window-level steering handler called preventDefault() on
     drags over it. The way out sat below the whole list, so unscrollable meant
     the game could not be continued. */
  await bootFresh(page);
  await page.evaluate(() => {
    const CR = (window as any).__CR;
    CR.S.coins = 9999999; CR.S.best = 9;
  });
  /* The shop is reached from the SHOP button on the home screen now, not by
     finishing a level - and `bootFresh` starts a run, which hides it. */
  await page.evaluate(() => (window as any).__CR.toHome());
  await page.locator('#btnShop').click();
  await expect(page.locator('#shopScreen')).not.toHaveClass(/hidden/, { timeout: 10_000 });

  /* The shop is four shop fronts now and no longer overflows on its own, so
     the patch notes are opened to give the sheet something to scroll. Without a
     sheet that is actually too long this test asserts nothing at all - which is
     exactly how a scroll regression got shipped the first time. */
  await page.locator('#btnNotes').click();
  const sheet = page.locator('#shopScreen .sheet');
  const box = await sheet.evaluate((el) => ({
    scrollH: el.scrollHeight, clientH: el.clientHeight,
    touch: getComputedStyle(el).touchAction,
    bodyTouch: getComputedStyle(document.body).touchAction,
  }));
  expect(box.scrollH, 'the sheet must be longer than the screen, or this proves nothing')
    .toBeGreaterThan(box.clientH + 40);
  expect(box.bodyTouch, 'touch-action on body blocks panning in every scroller under it')
    .not.toBe('none');
  expect(box.touch).toMatch(/pan-y|auto|manipulation/);

  /* And it really scrolls, not just "is scrollable on paper". */
  const moved = await sheet.evaluate((el) => {
    el.scrollTop = 0; el.scrollTop = 120; const got = el.scrollTop; el.scrollTop = 0; return got;
  });
  expect(moved, 'the sheet did not move when scrolled').toBeGreaterThan(0);

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

test('the shop sells SHOPS, and a purchase changes the line', async ({ page }) => {
  /* Progression is buying stations, which is the reference's model. The five
     stat upgrades that used to be here - Bigger Batch, Steady Tray, Long Reach,
     Deeper Vats, Glitter Cannon - appear nowhere in six levels of its footage
     and are gone; this test buys the Scent Shop, which adds a STATION. */
  await bootFresh(page);
  await page.evaluate(() => {
    const CR = (window as any).__CR;
    CR.S.coins = 9999999; CR.S.best = 9;
  });
  await page.evaluate(() => (window as any).__CR.toHome());
  await page.locator('#btnShop').click();
  await expect(page.locator('#shopScreen')).not.toHaveClass(/hidden/, { timeout: 10_000 });

  /* None of the removed stat upgrades may come back by accident. */
  for (const dead of ['stack', 'grip', 'reach', 'vat', 'spark']) {
    await expect(page.locator(`[data-buy="${dead}"]`)).toHaveCount(0);
  }

  expect(await page.evaluate(() => (window as any).__CR.S.up.scent)).toBe(0);
  await page.locator('[data-buy="scent"]').click();
  expect(await page.evaluate(() => (window as any).__CR.S.up.scent)).toBe(1);

  await page.locator('#btnGo').click();
  await expect(page.locator('#shopScreen')).toHaveClass(/hidden/);

  /* And the station it bought really runs. */
  await page.evaluate(() => (window as any).__CR.freeze());
  const kinds = await page.evaluate(() => {
    const CR = (window as any).__CR;
    const seen = new Set<string>();
    for (let i = 0; i < 400; i++) {
      for (const st of CR.stations()) {
        seen.add(CR.KINDS[st.left.kind].n); seen.add(CR.KINDS[st.right.kind].n);
      }
      CR.advance(0.1, 0.016, false);
    }
    return [...seen];
  });
  expect(kinds, `station kinds seen: ${kinds.join(',')}`).toContain('SCENT');
});

// ── rendering ───────────────────────────────────────────────────────────────

test('every render layer flushes what the model holds, lying down and standing up',
  async ({ page }) => {
  /* A reset -> push -> flush pipeline that loses its flush fails completely
     silently. With per-candle moulds this also checks candles are drawn from
     the right band layer: a tray where only some candles are pressed puts them
     in different layers, and the totals must still add up. */
  await bootFresh(page, 22);
  const read = (standing: boolean) => page.evaluate((stand) => {
    const CR = (window as any).__CR;
    CR.run.standing = stand;
    CR.run.standT = stand ? 1 : 0;
    CR.advance(0.02);                    // one drawn frame, so counts are current
    const tray = CR.tray();
    /* A wrapped candle lying down is a present, not a stack of bands - it
       pushes into `ribbon`/`bow` instead - so only unwrapped ones count. */
    let layers = 0, wrapped = 0;
    for (const r of tray) {
      if (r.wrap > 0) wrapped++; else layers += r.layers.length;
    }
    let drawn = 0, outlines = 0;
    CR.C.band.forEach((L: any) => { drawn += L.mesh.count; outlines += L.out.count; });
    return { drawn, outlines, layers, wrapped, wicks: CR.C.wick.mesh.count, count: tray.length };
  }, standing);

  /* LYING DOWN it is one band per wax layer per candle - the loaf is striped
     along its length. */
  const flat = await read(false);
  expect(flat.drawn, 'one instance per band per unwrapped candle, across every mould layer')
    .toBe(flat.layers);
  expect(flat.outlines, 'and an outline hull for each').toBe(flat.drawn);

  /* STANDING it is the same bands, turned through ninety degrees and running UP
     each candle - which is what a dipped candle actually looks like, and the
     reason standing up is the moment the player can finally read every band
     they put on. Both forms have to be asserted or the flush that goes missing
     is the one in the form nobody tested. */
  const up = await read(true);
  expect(up.drawn, 'one band per wax layer, standing as well as lying').toBe(up.layers);
  expect(up.outlines).toBe(up.drawn);
  /* A wick on every candle, because standing they are candles again rather
     than slices of one. */
  expect(up.wicks, 'a wick on every candle when stood up').toBe(up.count);
});

test('draw calls stay in budget with the runway full', async ({ page }) => {
  await bootFresh(page, 26);
  await page.evaluate(() => (window as any).__CR.advance(0.02));
  const s = await state(page);
  /* Measured peak is 92, standing, with every upgrade at 3 - which is every
     station kind active at once and the widest the frame ever gets. 100 is the
     mobile guideline this stack works to, so the headroom is thin and the next
     thing to do is instance the station furniture (arm, post, sign, tank are
     four plain meshes per half, twenty-four across three stations). */
  expect(s.calls, `draw calls were ${s.calls}`).toBeLessThan(100);
  expect(s.calls, 'a collapse to almost nothing means a layer stopped drawing').toBeGreaterThan(12);
});

test('the HUD is three things, and says what the model says', async ({ page }) => {
  /* The reference's HUD is the gear, the level and the money. Everything else
     this game used to draw - a candle counter, a running value, colour chips, a
     progress bar - was ours, and together they were most of why a screenshot of
     this did not look like a screenshot of that. They must stay gone. */
  await bootFresh(page, 24);
  const s = await state(page);
  for (const dead of ['#countN', '#eachN', '#cashN', '#stack', '#prog', '#hint']) {
    await expect(page.locator(dead), `${dead} came back`).toHaveCount(0);
  }
  await expect(page.locator('#level')).toContainText('Level 1');
  await expect(page.locator('#btnPause')).toBeVisible();
  /* The model still knows the tray's palette; the HUD simply stops drawing it.
     Kept as an assertion so removing the readout cannot be mistaken for
     removing the thing it read. */
  const waxes = await page.evaluate(() =>
    (window as any).__CR.trayStats().palette.filter((n: number) => n > 0).length);
  expect(waxes, 'the tray still wears colours, the HUD just does not chart them')
    .toBeGreaterThan(0);
  expect(s.count).toBeGreaterThan(0);
});

test('the build stamp and version are populated', async ({ page }) => {
  /* Reachable from the SHOP button now that there is no between-level sheet.
     The stamp is how a deploy is checked on the phone, so it has to stay
     reachable in two taps. */
  await bootFresh(page);
  await page.evaluate(() => (window as any).__CR.toHome());
  await page.locator('#btnShop').click();
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

// ── pause, settings, and the one destructive control ────────────────────────

test('pause actually stops the simulation, and resume starts it again',
  async ({ page }) => {
    /* The claim worth testing is not "a panel appeared". A pause that only
       hides the game keeps eating runway behind the menu, and a resume that
       hands the simulation the whole length of the pause as one step teleports
       the tray through whatever was in front of it. */
    await bootLive(page);
    /* A level waits for a swipe now, so the harness has to provide one. */
    await page.evaluate(() => (window as any).__CR.startRun());
    await page.waitForTimeout(300);
    const before = (await state(page)).z;
    expect(before, 'the run should be moving before the pause').toBeGreaterThan(0);

    await page.locator('#btnPause').click();
    await expect(page.locator('#pauseScreen')).not.toHaveClass(/hidden/);
    const atPause = (await state(page)).z;
    await page.waitForTimeout(700);
    expect((await state(page)).z, 'nothing may move while paused').toBe(atPause);

    await page.locator('#btnResume').click();
    await expect(page.locator('#pauseScreen')).toHaveClass(/hidden/);
    const justAfter = (await state(page)).z;
    await page.waitForTimeout(300);
    expect((await state(page)).z, 'and the run must actually continue')
      .toBeGreaterThan(justAfter);

    /* There is deliberately no assertion here that resume did not "replay" the
       pause as one long step. `frame()` clamps dt to 0.05 whatever happens, so
       the worst a lost `last` update can cost is half a unit - and half a unit
       is inside the round-trip latency of asking the page for its state, which
       means such a test measures the harness rather than the game. The two
       assertions above are the ones that can actually fail. */
  });

test('the boost cards can actually be bought, and do not start the run',
  async ({ page }) => {
    /* They could not. The steering handler lives on `window` so a drag can start
       anywhere, and `onUI()` decides what is a control rather than the world -
       the two cards were not in its selector, so every tap on CANDLE or CASH
       fell through to `ptDown` and began the level instead of buying anything.
       Same failure as the workshop that would not scroll: a new thing drawn over
       the game has to be told to the input layer. */
    await bootLive(page);
    await page.evaluate(() => { (window as any).__CR.S.coins = 99999; });
    await page.evaluate(() => (window as any).__CR.toHome());

    const coins = () => page.evaluate(() => (window as any).__CR.S.coins);
    const running = () => page.evaluate(() => (window as any).__CR.run.active);
    const before = await coins();

    await page.locator('#boostCandle').click();
    expect(await running(), 'buying a boost must not start the level').toBe(false);
    expect(await coins(), 'and must cost money').toBeLessThan(before);
    await expect(page.locator('#boostCandleC')).toHaveText('ON');

    const mid = await coins();
    await page.locator('#boostCash').click();
    expect(await running()).toBe(false);
    expect(await coins()).toBeLessThan(mid);

    /* And the world underneath still starts the run. */
    await page.mouse.click(190, 300);
    expect(await running(), 'a tap on the runway still starts it').toBe(true);
  });

test('the gear is up over the world and down over a sheet', async ({ page }) => {
  /* The reference shows its settings gear during a run AND on the home screen
     between runs, because both are the world. It comes down only when a
     full-screen sheet already owns the input. */
  await bootLive(page);
  await expect(page.locator('#home')).not.toHaveClass(/hidden/);
  await expect(page.locator('#btnPause'), 'up on the home screen').toBeVisible();

  await page.evaluate(() => (window as any).__CR.startRun());
  await expect(page.locator('#btnPause'), 'and during a run').toBeVisible();

  await page.locator('#btnPause').click();
  await page.locator('#btnResume').click();
  await page.evaluate(() => (window as any).__CR.toHome());
  await page.locator('#btnShop').click();
  await expect(page.locator('#btnPause'), 'down over the shop').toBeHidden({ timeout: 10_000 });
});

test('the settings switches persist and reach the audio graph', async ({ page }) => {
  await bootLive(page);
  await page.locator('#btnPause').click();

  const sound = page.locator('#optSound');
  await expect(sound).toHaveAttribute('aria-checked', 'true');
  await sound.click();
  await expect(sound).toHaveAttribute('aria-checked', 'false');
  await expect(sound).toHaveText('OFF');

  await page.locator('#optSens').fill('130');
  await expect(page.locator('#sensVal')).toHaveText('1.3×');

  /* Written under their OWN key - the whole reason settings are not part of
     the save is that clearing the save must not clear these. */
  const stored = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('candlegift.settings.v1') || 'null'));
  expect(stored).toMatchObject({ sound: false, sens: 1.3 });

  await page.reload();
  await expect(page.locator('#boot')).toHaveClass(/hidden/, { timeout: 20_000 });
  await page.locator('#btnPause').click();
  await expect(page.locator('#optSound')).toHaveAttribute('aria-checked', 'false');
  await expect(page.locator('#sensVal')).toHaveText('1.3×');
});

test('steering sensitivity changes how far the same drag moves the tray',
  async ({ page }) => {
    /* Through real pointer events, because a setting that multiplies a constant
       nobody drives is a setting that can be wired to nothing. */
    await bootLive(page);
    const drag = async () => {
      await page.evaluate(() => { (window as any).__CR.steer(0); });
      const box = (await page.locator('#game').boundingBox())!;
      const y = box.y + box.height * 0.75;
      await page.mouse.move(box.x + box.width * 0.5, y);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width * 0.5 - 60, y, { steps: 6 });
      await page.mouse.up();
      return page.evaluate(() => (window as any).__CR.run.targetX);
    };

    const atOne = await drag();
    await page.locator('#btnPause').click();
    await page.locator('#optSens').fill('50');
    await page.locator('#btnResume').click();
    const atHalf = await drag();

    expect(Math.abs(atOne), 'the drag must move the tray at all').toBeGreaterThan(0.2);
    expect(Math.abs(atHalf), 'and less of it at the low end of the slider')
      .toBeLessThan(Math.abs(atOne) * 0.8);
  });

/* Seed a save exactly ONCE, before the first boot.

   Writing it from the page after load does not work and the reason is the
   thing being tested: `save()` runs on `visibilitychange`, a reload fires
   that, and the outgoing page writes its own live state over whatever the test
   just put there. An init script runs before the game does - and the
   sessionStorage latch keeps it from re-seeding when the wipe reloads. */
async function seedSave(page: Page, data: Record<string, unknown>) {
  await page.addInitScript(({ key, data: d }) => {
    try {
      if (sessionStorage.getItem('e2e-seeded')) return;
      sessionStorage.setItem('e2e-seeded', '1');
      localStorage.setItem(key, JSON.stringify(d));
    } catch (e) { /* private mode */ }
  }, { key: KEY, data });
}

test('clearing the save takes two taps, erases the run, and keeps the settings',
  async ({ page }) => {
    /* No storage freeze here: the point is that a real key is really removed
       and stays removed, which a frozen setter would make vacuously true. */
    page.on('pageerror', (e) => { throw new Error('uncaught page error: ' + e.message); });
    await seedSave(page, {
      v: 1, level: 7, coins: 99999, best: 7, bestValue: 5, stars: 9, seenShop: true,
    });
    await page.addInitScript(() => {
      try {
        localStorage.setItem('candlegift.settings.v1',
          JSON.stringify({ sound: false, music: true, sens: 1.5 }));
      } catch (e) { /* private mode */ }
    });
    await page.goto('/?debug');
    await expect(page.locator('#boot')).toHaveClass(/hidden/, { timeout: 20_000 });
    await expect(page.locator('#level')).toContainText('Level 7');

    await page.locator('#btnPause').click();
    const wipe = page.locator('#btnWipe');
    await expect(wipe).toHaveText('CLEAR SAVE DATA');

    // one tap arms and relabels; it must not erase anything
    await wipe.click();
    await expect(wipe).toHaveText('TAP AGAIN TO ERASE');
    await expect(wipe).toHaveClass(/armed/);
    expect(await page.evaluate((k) => JSON.parse(localStorage.getItem(k) || 'null'), KEY))
      .toMatchObject({ level: 7 });

    // the second tap erases, and the page reloads itself into a fresh game
    await wipe.click();
    await page.waitForFunction(
      () => document.getElementById('level')?.textContent === 'Level 1',
      undefined, { timeout: 20_000 });

    /* The real assertion is not "the key is null" - boot writes a fresh one
       within a frame, so that would be a race. It is that the progress is
       gone and did not come back through the reload's own save(). */
    const after = await page.evaluate((k) => JSON.parse(localStorage.getItem(k) || 'null'), KEY);
    expect(after?.level ?? 1, 'the reload must not restore the erased progress').toBe(1);
    expect(after?.coins ?? 0).toBe(0);

    /* And the preferences survive it, which is the promise the panel makes in
       the sentence under the button. */
    const kept = await page.evaluate(() =>
      JSON.parse(localStorage.getItem('candlegift.settings.v1') || 'null'));
    expect(kept).toMatchObject({ sound: false, sens: 1.5 });
  });

test('dragging over the pause sheet does not steer the tray', async ({ page }) => {
  /* The same failure that made the workshop unscrollable: the steering handler
     lives on `window`, so anything drawn over the game has to be excluded by
     `onUI` or a swipe at a slider drives the run instead. */
  await bootLive(page);
  await page.locator('#btnPause').click();
  const before = await page.evaluate(() => (window as any).__CR.run.targetX);
  const box = (await page.locator('#pauseScreen .sheet').boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.5, box.y + 40);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.5 - 90, box.y + 40, { steps: 6 });
  await page.mouse.up();
  expect(await page.evaluate(() => (window as any).__CR.run.targetX)).toBe(before);
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
    z: 343.1600000000093,
    count: 5,
    avgColours: 2,
    /* Zero glitter and zero wrapped is CORRECT for this run, not a dropped
       station. Pools are half-width and a run that never steers sits exactly
       on the seam, where `p.x < 0 ? left : right` puts every candle in the
       right-hand pool of every station - so it only ever meets half the
       runway. `every station kind actually fires during a real level` is the
       test that covers the other half. */
    avgGlitter: 0,
    pressed: 2,
    wrapped: 4,
    plain: 1,
    worth: 536,
    cash: 1560,
    lost: 3,
    gained: 7,
    dips: 14,
    stations: 2,
    obstacles: 9,
    notes: 1,
    loose: 2,
    over: false,
    coins: 0,
    level: 1,
  });
});
