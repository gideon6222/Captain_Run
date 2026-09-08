import test from 'node:test';
import assert from 'node:assert/strict';
import { loadPure } from './harness.mjs';

const P = await loadPure();
const { T, TIERS, PALETTES } = P;

const NONE = { weapon: 0, whet: 0, warband: 0, mead: 0, boots: 0, lode: 0, thor: 0, freyja: 0, odin: 0 };
const up = (o) => ({ ...NONE, ...o });

/* These tests are not about arithmetic - the arithmetic is one line each and
   reading it is faster than testing it. They are about the shape of the curves,
   which is what a balance change accidentally breaks: a game that is
   unwinnable at ascent 4, or an upgrade that costs gold and does nothing. */

test('difficulty and damage both compound, and damage compounds harder', () => {
  /* A run is the race between these two curves. Enemies scale 2.02x per
     ascent; one weapon tier is 2.15x. So a tier gained is worth slightly more
     than an ascent climbed - which is what makes the ladder finishable at all,
     and is the single most important relationship in the game. */
  assert.ok(T.tierMul > T.ascentScale,
    'a weapon tier must outpace an ascent, or the ladder is unwinnable');

  const a1 = P.scaleFor(1), a5 = P.scaleFor(5);
  assert.equal(a1, 1, 'ascent 1 is the unscaled baseline');
  assert.ok(a5 > a1 * 15, `ascent 5 should be far harder, got ${a5}x`);
});

test('every upgrade actually does something', () => {
  const base = {
    dps: P.squadDPS(NONE, 0, 10),
    crew: P.maxCrew(NONE), start: P.startCrew(NONE),
    speed: P.runSpeed(NONE), magnet: P.magnetR(NONE), gold: P.goldMul(NONE)
  };
  assert.ok(P.squadDPS(up({ weapon: 1 }), 0, 10) > base.dps, 'weapon');
  assert.ok(P.squadDPS(up({ whet: 1 }), 0, 10) > base.dps, 'whet');
  assert.ok(P.squadDPS(up({ thor: 1 }), 0, 10) > base.dps, 'thor');
  assert.ok(P.maxCrew(up({ mead: 1 })) > base.crew, 'mead');
  assert.ok(P.startCrew(up({ warband: 1 })) > base.start, 'warband');
  assert.ok(P.runSpeed(up({ boots: 1 })) > base.speed, 'boots');
  assert.ok(P.magnetR(up({ lode: 1 })) > base.magnet, 'lode');
  assert.ok(P.goldMul(up({ freyja: 1 })) > base.gold, 'freyja');
  assert.ok(P.weaponTier(up({ odin: 1 }), 0) > P.weaponTier(NONE, 0), 'odin');
});

test('the weapon tier cannot run off the end of the table', () => {
  /* Tier indexes into TIERS for a name and a colour. Unclamped, a stacked
     weapon + forge + odin reads past the end and the axe loses its material -
     which shows up as an invisible weapon, not as an error. */
  const maxed = up({ weapon: 8, odin: 4 });
  assert.equal(P.weaponTier(maxed, 8), TIERS.length - 1);
  assert.ok(TIERS[P.weaponTier(maxed, 8)], 'top tier must exist in the table');
  assert.equal(P.weaponTier(NONE, 0), 0);
});

test('in-run forge tiers are worth as much as bought ones', () => {
  /* The forge is the whole reason to pick up iron mid-run. If a forged tier
     were worth less than a purchased one, iron would be a decoy. */
  assert.equal(P.dmgPerHit(NONE, 2), P.dmgPerHit(up({ weapon: 2 }), 0));
});

test('DPS is linear in the warband', () => {
  /* Crowd size is the thing the player watches. It has to feel like it pays
     off proportionally - twice the warband, twice the damage. */
  assert.ok(Math.abs(P.squadDPS(NONE, 0, 20) - 2 * P.squadDPS(NONE, 0, 10)) < 1e-9);
  assert.equal(P.squadDPS(NONE, 0, 0), 0);
});

test('the palettes are complete', () => {
  /* A palette is applied by field name; a missing one sets a material colour
     to undefined and turns that object black with no error. */
  const keys = ['name', 'sky', 'fog', 'ground', 'road', 'kerb', 'tree', 'tree2', 'rock', 'mount', 'dust'];
  for (const p of PALETTES) {
    for (const k of keys) assert.ok(p[k] !== undefined, `${p.name} is missing ${k}`);
    assert.equal(p.sky.length, 2, `${p.name} sky needs two stops`);
  }
  assert.ok(PALETTES.length >= 4, 'an ascent cycles palettes; fewer than four repeats too soon');
});

test('a fresh run starts small enough to have somewhere to go', () => {
  assert.ok(P.startCrew(NONE) < P.maxCrew(NONE) / 2,
    'the first gate should feel like it doubles the warband');
});
