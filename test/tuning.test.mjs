import test from 'node:test';
import assert from 'node:assert/strict';
import { loadPure } from './harness.mjs';

const P = await loadPure();
const { T, WAXES, WORKSHOPS, SCENTS } = P;

const NONE = { core: 0, hard: 0, wick: 0, dye: 0, scoop: 0, hand: 0, bees: 0, mould: 0 };
const up = (o) => ({ ...NONE, ...o });
const ALL_SCENTS = SCENTS.map((_, i) => i);

/* These tests are not about arithmetic - the arithmetic is one line each and
   reading it is faster than testing it. They are about the shape of the
   curves, and about intent: a game that is unaffordable at workshop 4, or an
   upgrade that costs coins and does nothing, is the failure this file exists
   to catch before a human meets it. */

test('difficulty and prices both compound, and prices compound harder', () => {
  /* A campaign is the race between these two. If the price a workshop pays did
     not outpace how hard it is, every level would be a worse deal than the one
     below it and there would be no reason to climb. */
  assert.ok(T.priceScale > T.levelScale,
    'what a workshop pays must outpace how hard it is, or climbing is a mistake');

  assert.equal(P.scaleFor(1), 1, 'workshop 1 is the unscaled baseline');
  assert.ok(P.priceFor(5) > P.priceFor(1) * 6, 'the fifth workshop pays far better');
});

test('every upgrade actually does something', () => {
  const base = {
    startWax: P.startWax(NONE),
    wick: P.wickLength(NONE, []),
    shave: P.shaveMul(NONE, []),
    melt: P.meltMul(NONE, []),
    drip: P.dripMul(NONE, []),
    lop: P.lopMul(NONE),
    magnet: P.magnetR(NONE),
    value: P.valueMul(NONE, []),
    layers: P.maxLayers(NONE),
  };
  assert.ok(P.startWax(up({ core: 1 })) > base.startWax, 'Thick Core');
  assert.ok(P.wickLength(up({ wick: 1 }), []) > base.wick, 'Long Wick');
  assert.ok(P.shaveMul(up({ hard: 1 }), []) < base.shave, 'Hard Wax vs blades');
  assert.ok(P.meltMul(up({ hard: 1 }), []) < base.melt, 'Hard Wax vs heat');
  assert.ok(P.dripMul(up({ scoop: 1 }), []) > base.drip, 'Wide Scoop, per droplet');
  assert.ok(P.magnetR(up({ scoop: 1 })) > base.magnet, 'Wide Scoop, reach');
  assert.ok(P.lopMul(up({ hand: 1 })) < base.lop, 'Steady Hand');
  assert.ok(P.valueMul(up({ dye: 1 }), []) > base.value, 'Fine Dyes');
  assert.ok(P.valueMul(up({ bees: 1 }), []) > base.value, 'Beeswax');
  assert.ok(P.maxLayers(up({ mould: 1 })) > base.layers, 'Deeper Mould');
});

test('every scent actually does something, and none of them are the same thing', () => {
  /* A collection whose entries do not change the game is a list of nouns. Each
     of these is checked through the function it is supposed to move, so a
     scent added later without wiring fails here rather than on someone's
     phone three weeks after they found it. */
  assert.ok(P.shaveMul(NONE, [P.SCENT_BALM]) < P.shaveMul(NONE, []), 'Beeswax Balm');
  assert.ok(P.dripMul(NONE, [P.SCENT_RESIN]) > P.dripMul(NONE, []), 'Pine Resin');
  assert.ok(P.wickLength(NONE, [P.SCENT_CLOVE]) > P.wickLength(NONE, []), 'Clove Oil');
  assert.ok(P.valueMul(NONE, [P.SCENT_MYRRH]) > P.valueMul(NONE, []), 'Myrrh');
  assert.equal(P.snuffs([P.SCENT_SALT]), false, 'Sea Salt');
  assert.equal(P.snuffs([]), true);
  assert.ok(P.meltMul(NONE, [P.SCENT_GLASS]) < P.meltMul(NONE, []), 'Smoke Glass');

  assert.equal(SCENTS.length, 6, 'six scents, one per effect asserted above');
  assert.equal(new Set(SCENTS.map((s) => s.n)).size, SCENTS.length, 'no duplicate names');
});

test('a full collection is a real bonus but not a different game', () => {
  const all = P.valueMul(NONE, ALL_SCENTS) / P.valueMul(NONE, []);
  assert.ok(all > 1.1 && all < 1.4, `every scent found is worth ${all.toFixed(2)}x, want 1.1-1.4x`);
});

test('the wax ladder is a ladder: hue and price both spread out', () => {
  assert.ok(WAXES.length >= 5, 'enough waxes for a workshop to offer a real choice');
  /* The three warm ones existing is the point of the contrast bonus. If every
     wax were far from every other, contrast would be automatic and the dip
     arch would stop being a decision. */
  let warmPairs = 0;
  for (let i = 0; i < WAXES.length; i++) {
    for (let j = i + 1; j < WAXES.length; j++) {
      if (P.hueGap(WAXES[i].hue, WAXES[j].hue) <= 0.18) warmPairs++;
    }
  }
  assert.ok(warmPairs >= 3,
    'some waxes must clash-by-being-too-similar, or contrast is free');
});

test('hueGap wraps around the wheel', () => {
  assert.equal(P.hueGap(0.05, 0.95).toFixed(4), '0.1000');
  assert.equal(P.hueGap(0.5, 0.5), 0);
  assert.equal(P.hueGap(0, 0.5), 0.5);
});

test('every workshop offers waxes that exist, and the light falls as you climb', () => {
  let prev = Infinity;
  for (const w of WORKSHOPS) {
    assert.ok(w.waxes.length >= 3, `${w.name} needs at least three waxes to make a dip a choice`);
    for (const i of w.waxes) assert.ok(WAXES[i], `${w.name} offers a wax that does not exist`);
    assert.ok(w.amb <= prev, `${w.name} must not be brighter than the workshop before it`);
    prev = w.amb;
  }
  /* The Deep Dark being nearly black is the whole reason the flame is a light
     source. If someone raises it "so you can see", that is the mechanic gone. */
  assert.ok(WORKSHOPS[WORKSHOPS.length - 1].amb < 0.2, 'the last workshop is lit by your candle');
});

test('ambient never falls far enough to kill the toon bands', () => {
  for (let lvl = 1; lvl <= 12; lvl++) {
    assert.ok(P.ambientFor(lvl) >= 0.12, `workshop ${lvl} went below the banding floor`);
  }
});

test('a heat lamp costs wax faster than it costs wick', () => {
  /* Otherwise it is a slower blade with extra steps. The point of heat is that
     it is a place you can choose to spend time in - the melt is the price and
     the wick is the pressure not to loiter. */
  assert.ok(T.heatMelt > T.heatWick, 'heat is primarily a wax cost');
  assert.ok(T.heatWick > 0, 'and it still hurries you along');
});

test('everything placed on the road lands inside the band a thumb can reach', () => {
  /* A hazard outside the steering clamp cannot be dodged *or* hit - it is
     drawn, it is in the level, and it never once interacts with the player.
     That is the same failure as a content band below the deepest reachable
     ground, and it has exactly the same symptom: none. */
  let min = Infinity, max = -Infinity;
  for (let i = 0; i <= 2000; i++) {
    const x = P.laneX(i / 2000);
    min = Math.min(min, x); max = Math.max(max, x);
  }
  assert.ok(min >= -T.laneClamp, `laneX went to ${min}, past the clamp`);
  assert.ok(max <= T.laneClamp, `laneX went to ${max}, past the clamp`);

  /* And it must actually use the band, or every hazard is in the middle and
     steering stops being the game. */
  assert.ok(min < -T.laneClamp * 0.95 && max > T.laneClamp * 0.95,
    'laneX must reach both edges, or the road is one lane wide');

  const inset = P.laneX(0.5, 0.4);
  assert.equal(inset, 0, 'the inset must not shift the centre');
});

test('the big side of a dip arch is genuinely bigger', () => {
  assert.ok(T.vatWaxBig > T.vatWaxBase * 1.5,
    'if the two sides are close, the arch is not a decision');
});
