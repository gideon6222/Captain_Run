import test from 'node:test';
import assert from 'node:assert/strict';
import { loadPure } from './harness.mjs';

const P = await loadPure();
const { T, WAXES, WORKSHOPS, MOULDS, WRAPS, DEF_UP } = P;

const NONE = { ...DEF_UP };
const up = (o) => ({ ...NONE, ...o });

/* Not about arithmetic - the arithmetic is one line each and reading it is
   faster than testing it. These are about the shape of the curves and about
   intent: a workshop that is unaffordable, or an upgrade that costs coins and
   does nothing, is the failure this file exists to catch before a human meets
   it. */

test('difficulty and prices both compound, and prices compound harder', () => {
  assert.ok(T.priceScale > T.levelScale,
    'what a workshop pays must outpace how hard it is, or climbing is a mistake');
  assert.equal(P.scaleFor(1), 1, 'workshop 1 is the unscaled baseline');
  assert.ok(P.priceFor(5) > P.priceFor(1) * 6, 'the fifth workshop pays far better');
});

test('every upgrade actually does something', () => {
  assert.ok(P.startCandles(up({ stack: 1 })) > P.startCandles(NONE), 'Bigger Batch');
  assert.ok(P.earnMul(up({ earn: 1 })) > P.earnMul(NONE), 'Earning Power');
  assert.ok(P.takeMul(up({ grip: 1 })) < P.takeMul(NONE), 'Steady Tray');
  assert.ok(P.magnetR(up({ reach: 1 })) > P.magnetR(NONE), 'Long Reach');
  assert.ok(P.bestMould(up({ press: 1 })) > P.bestMould(NONE), 'Press');
  assert.ok(P.bestWrap(up({ wrap: 1 })) > P.bestWrap(NONE), 'Wrapping');
  assert.ok(P.vatLayers(up({ vat: 3 })) > P.vatLayers(NONE), 'Deep Vats');
  assert.ok(P.glitterPer(up({ spark: 3 })) > P.glitterPer(NONE), 'Glitter Cannon');
});

test('an obstacle always costs at least one candle', () => {
  /* An obstacle that can be upgraded down to costing nothing is scenery, and
     the player stops looking at it - which makes every later level worse. */
  for (let g = 0; g < 40; g++) {
    const take = P.obstacleTake(T.barrierTake, up({ grip: g }));
    assert.ok(take >= 1, `grip ${g} reduced a barrier to ${take}`);
  }
});

test('the press and wrap upgrades cannot point past the tables they index', () => {
  assert.equal(P.bestMould(up({ press: 999 })), MOULDS.length - 1);
  assert.equal(P.bestWrap(up({ wrap: 999 })), WRAPS.length - 1);
  assert.ok(MOULDS[P.bestMould(up({ press: 999 }))], 'and still resolve to a real mould');
  assert.ok(WRAPS[P.bestWrap(up({ wrap: 999 }))]);
});

test('a station always does something, from the very first level', () => {
  /* The press used to stamp PLAIN onto plain candles on level 1 and print
     "ALREADY PLAIN" - a station with a gantry and a sign that was a dead beat
     until an upgrade several levels later. A station that can do nothing
     teaches the player to stop reading the signs. */
  assert.ok(P.bestMould(NONE) >= 1, 'the level-1 press must beat an unpressed candle');
  assert.ok(P.bestWrap(NONE) >= 1, 'and the level-1 wrap station must beat bare');
  assert.ok(MOULDS[P.bestMould(NONE)].mul > MOULDS[0].mul);
  assert.ok(WRAPS[P.bestWrap(NONE)].mul > WRAPS[0].mul);
});

test('the press and wrap ladders are climbable, and the shop knows where they stop', () => {
  /* If MAX_PRESS and the table disagree, the shop either sells an upgrade that
     changes nothing or stops one rung short of the best mould in the game. */
  assert.equal(P.bestMould(up({ press: P.MAX_PRESS })), MOULDS.length - 1);
  assert.equal(P.bestWrap(up({ wrap: P.MAX_WRAP })), WRAPS.length - 1);
  for (let i = 0; i < P.MAX_PRESS; i++) {
    assert.ok(P.bestMould(up({ press: i + 1 })) > P.bestMould(up({ press: i })),
      `press level ${i} -> ${i + 1} must change the mould`);
  }
  for (let i = 0; i < P.MAX_WRAP; i++) {
    assert.ok(P.bestWrap(up({ wrap: i + 1 })) > P.bestWrap(up({ wrap: i })),
      `wrap level ${i} -> ${i + 1} must change the wrapping`);
  }
});

test('a full tray is a whole number of rows, so no row is ever short', () => {
  assert.equal(T.maxCandles % T.rowWidth, 0,
    'a ragged back row reads as candles having fallen off when they have not');
});

test('the wax ladder is a ladder, and some of it clashes on purpose', () => {
  assert.ok(WAXES.length >= 5, 'enough waxes for a vat to offer a real choice');
  assert.equal(WAXES[0].price, 1, 'cream is the baseline');
  for (let i = 1; i < WAXES.length; i++) {
    assert.ok(WAXES[i].price > 1, `${WAXES[i].n} should beat plain cream`);
  }
  /* If every wax read as different from every other, contrast would be free
     and the vat would stop being a decision. */
  let dull = 0;
  for (let i = 0; i < WAXES.length; i++) {
    for (let j = i + 1; j < WAXES.length; j++) {
      if (!P.reads2(WAXES[i], WAXES[j])) dull++;
    }
  }
  assert.ok(dull >= 1, 'some pair of waxes must fail to read as two colours');
});

test('hueGap wraps around the wheel', () => {
  assert.equal(P.hueGap(0.05, 0.95).toFixed(4), '0.1000');
  assert.equal(P.hueGap(0.5, 0.5), 0);
  assert.equal(P.hueGap(0, 0.5), 0.5);
});

test('the runway always separates from the sky it floats in', () => {
  /* The second workshop shipped as a pink road under a pink sky and the track
     dissolved into the backdrop at about twenty units - which is exactly the
     distance the player steers by. Hue alone does not save it; the gap has to
     be in lightness. */
  for (const w of WORKSHOPS) {
    const road = P.lightnessOf(w.road);
    for (const s of w.sky) {
      const gap = Math.abs(P.hexLightness(s) - road);
      assert.ok(gap > 0.25,
        `${w.name}: road and sky ${s} are only ${gap.toFixed(2)} apart in lightness`);
    }
    /* And the rails have to read against the road they edge. */
    assert.ok(P.lightnessOf(w.rail) - road > 0.25, `${w.name}: rails vanish into the road`);
  }
});

test('no workshop offers the core colour at a pool', () => {
  /* A candle's core is wax 0, and a dip refuses a colour the candle already
     wears - so a wax-0 pool is a station a third of the tray drives through
     and gets nothing from. It reads on screen only as a tray that stubbornly
     stays beige, which is the hardest kind of dead mechanic to notice. */
  for (const w of WORKSHOPS) {
    assert.ok(!w.waxes.includes(0), `${w.name} offers the core colour as a pool`);
  }
});

test('every workshop offers waxes that exist and stays bright', () => {
  for (const w of WORKSHOPS) {
    assert.ok(w.waxes.length >= 3, `${w.name} needs three waxes to make a pool pair a choice`);
    for (const i of w.waxes) assert.ok(WAXES[i], `${w.name} offers a wax that does not exist`);
    assert.equal(w.sky.length, 2, `${w.name} needs a two-stop sky`);
    for (const s of w.sky) assert.match(s, /^#[0-9a-f]{6}$/i, `${w.name} sky must be a hex colour`);
  }
  assert.equal(new Set(WORKSHOPS.map((w) => w.name)).size, WORKSHOPS.length);
});

test('everything placed on the runway lands inside the band a thumb can reach', () => {
  /* A hazard outside the steering clamp cannot be dodged *or* hit - it is
     drawn, it is in the level, and it never once interacts with the player. */
  let min = Infinity, max = -Infinity;
  for (let i = 0; i <= 2000; i++) {
    const x = P.laneX(i / 2000);
    min = Math.min(min, x); max = Math.max(max, x);
  }
  assert.ok(min >= -T.laneClamp, `laneX went to ${min}, past the clamp`);
  assert.ok(max <= T.laneClamp, `laneX went to ${max}, past the clamp`);
  assert.ok(min < -T.laneClamp * 0.95 && max > T.laneClamp * 0.95,
    'laneX must reach both edges, or the runway is one lane wide');
  assert.equal(P.laneX(0.5, 0.4), 0, 'the inset must not shift the centre');
});

test('the runway is wider than the band the player steers in', () => {
  /* The shoulders are what the play space reads against. If they vanish, the
     track is exactly as wide as the game and stops looking like a place. */
  assert.ok(T.roadW / 2 > T.laneClamp, 'the road mesh must be wider than laneClamp');
});

test('a full stack still fits in the trail buffer', () => {
  /* The buffer is what remembers where the leader has been. If the longest
     stack asks for a position further back than the buffer can hold, the tail
     silently bunches up at the oldest sample - which looks like the stack
     collapsing for no reason. */
  const needed = T.trailGap * T.maxCandles;
  assert.ok(T.trailSamples * 0.02 > needed * 1.5,
    `buffer holds ~${(T.trailSamples * 0.02).toFixed(0)} units, longest stack needs ${needed.toFixed(0)}`);
});
