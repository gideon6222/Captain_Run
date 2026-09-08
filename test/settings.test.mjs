import test from 'node:test';
import assert from 'node:assert/strict';
import { loadPure } from './harness.mjs';

const P = await loadPure();

/* A tiny in-memory localStorage, so these run under node and so the failure
   modes that matter - a missing key, a key written by an older build, a key
   full of junk, a browser that throws on access - can each be staged. Those
   are the only interesting cases: the happy path is one line. */
function stubStorage(impl) {
  globalThis.localStorage = impl;
}
function memory(initial) {
  let v = initial === undefined ? null : initial;
  return {
    getItem: () => v,
    setItem: (_k, s) => { v = s; },
    removeItem: () => { v = null; },
    read: () => v,
  };
}

test('settings live under their own key, not the save', () => {
  /* The pause screen offers "clear save data" beside the sound switches, and
     that promise only holds if erasing progress cannot touch preferences. */
  assert.notEqual(P.SETTINGS_KEY, P.KEY);
  assert.ok(P.SETTINGS_KEY.length > 0);
});

test('a fresh install gets sound and music on', () => {
  stubStorage(memory(null));
  const s = P.loadSettings();
  assert.deepEqual(s, P.DEF_SETTINGS);
  assert.equal(s.sound, true);
  assert.equal(s.music, true);
});

test('a key from an older build reads as ON, not as muted', () => {
  /* The trap this exists for: `!!d.sound` on a key that predates the field is
     false, which silently mutes the game for everyone upgrading. The loader
     tests for an explicit `false` instead. */
  stubStorage(memory(JSON.stringify({ somethingElse: 1 })));
  const s = P.loadSettings();
  assert.equal(s.sound, true, 'a missing field must not read as off');
  assert.equal(s.music, true);
  assert.equal(s.sens, P.DEF_SETTINGS.sens);
});

test('switches that were turned off stay off', () => {
  stubStorage(memory(JSON.stringify({ sound: false, music: false, sens: 1.3 })));
  const s = P.loadSettings();
  assert.equal(s.sound, false);
  assert.equal(s.music, false);
  assert.equal(s.sens, 1.3);
});

test('a hostile or corrupt key degrades to defaults instead of throwing', () => {
  for (const raw of ['not json', '[]', 'null', '{"sens":"fast"}', '{"sens":null}']) {
    stubStorage(memory(raw));
    const s = P.loadSettings();
    assert.equal(s.sound, true, `raw ${raw}`);
    assert.equal(s.sens, P.DEF_SETTINGS.sens, `raw ${raw}`);
  }
});

test('sensitivity is clamped to what the slider can actually reach', () => {
  assert.equal(P.clampSens(99), P.SENS_MAX);
  assert.equal(P.clampSens(-4), P.SENS_MIN);
  assert.equal(P.clampSens(NaN), P.DEF_SETTINGS.sens);
  assert.equal(P.clampSens(Infinity), P.DEF_SETTINGS.sens);
  assert.equal(P.clampSens(1.2), 1.2);
  /* A stored value outside the range must come back inside it, or the game
     steers at a speed the player has no control to undo. */
  stubStorage(memory(JSON.stringify({ sens: 40 })));
  assert.equal(P.loadSettings().sens, P.SENS_MAX);
});

test('the default is inside the range, and the range is a real range', () => {
  assert.ok(P.SENS_MIN < P.DEF_SETTINGS.sens && P.DEF_SETTINGS.sens < P.SENS_MAX);
  assert.ok(P.SENS_MAX / P.SENS_MIN > 2, 'the slider must be worth having');
});

test('a round trip through storage preserves every field', () => {
  const store = memory(null);
  stubStorage(store);
  const want = { sound: false, music: true, sens: 0.8 };
  P.saveSettings(want);
  assert.deepEqual(P.loadSettings(), want);
});

test('storage that throws does not take the game with it', () => {
  /* Private mode, or site data blocked. Both `load` and `save` are called
     during boot. */
  stubStorage({
    getItem() { throw new Error('blocked'); },
    setItem() { throw new Error('blocked'); },
  });
  assert.deepEqual(P.loadSettings(), P.DEF_SETTINGS);
  assert.doesNotThrow(() => P.saveSettings(P.DEF_SETTINGS));
});
