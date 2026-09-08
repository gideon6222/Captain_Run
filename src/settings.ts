/* Player settings: sound, music and how far a thumb has to travel to cross the
   runway.

   A SEPARATE localStorage key from the save, and that is the whole reason this
   file exists rather than three more fields on `Save`. The pause screen offers
   "clear save data" next to these switches, and a player who erases their
   progress has not asked to be shouted at by music they turned off three
   sessions ago. Progress and preferences have different lifetimes, so they get
   different keys.

   `load` is defensive in the same way and for the same reason as the save's:
   it starts from the defaults and copies across only what it can read, so a
   key written by an older build degrades to defaults instead of throwing on
   boot. A boot that throws on a phone is a game that is simply gone. */

export const SETTINGS_KEY = 'candlegift.settings.v1';

export interface Settings {
  sound: boolean;
  music: boolean;
  /* A multiplier on the drag-to-steer distance, not a replacement for it. The
     shipped feel is 1.0 and stays the default; this exists because the same
     swipe is a different fraction of the screen on a different phone. */
  sens: number;
}

export const SENS_MIN = 0.5;
export const SENS_MAX = 1.6;

export const DEF_SETTINGS: Settings = { sound: true, music: true, sens: 1 };

export function clampSens(n: number): number {
  if (typeof n !== 'number' || !isFinite(n)) return DEF_SETTINGS.sens;
  return Math.min(SENS_MAX, Math.max(SENS_MIN, n));
}

export function loadSettings(): Settings {
  const s: Settings = { ...DEF_SETTINGS };
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return s;
    const d = JSON.parse(raw);
    if (d && typeof d === 'object') {
      /* Explicitly `=== false`, not falsy. An older key that never held these
         fields must read as ON, which is the default, rather than as OFF -
         `!!undefined` would silently mute the game for anyone upgrading. */
      if (d.sound === false) s.sound = false;
      if (d.music === false) s.music = false;
      if (typeof d.sens === 'number') s.sens = clampSens(d.sens);
    }
  } catch (e) { /* private mode, or a key someone else wrote */ }
  return s;
}

/* Swallows quota and private-mode failures, like the save does: a preference
   that cannot be written is not worth ending a run over. */
export function saveSettings(s: Settings): void {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch (e) { /* blocked */ }
}
