/* The save. One localStorage key, read once at boot and written on every camp
   visit and run end.

   `load` is defensive on purpose: it starts from a fresh default and copies
   across only fields of the type it expects. A save written by an older build,
   or one a browser handed back half-written, then degrades to defaults for the
   parts it cannot read rather than throwing on boot - and a boot that throws
   on a phone is a game that is simply gone, with no console to ask why. */

import type { Upgrades } from './tuning.js';

export const KEY = 'captainrun.v1';

export interface Save {
  v: number; ascent: number; gold: number; runes: number; best: number;
  seenCamp: boolean; up: Upgrades;
}

export const DEF_SAVE: Save = {
  v: 1, ascent: 1, gold: 0, runes: 0, best: 1, seenCamp: false,
  up: { weapon: 0, whet: 0, warband: 0, mead: 0, boots: 0, lode: 0, thor: 0, freyja: 0, odin: 0 },
};

export function load(): Save {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return structuredClone(DEF_SAVE);
    const d = JSON.parse(raw);
    const s = structuredClone(DEF_SAVE);
    if (d && typeof d === 'object') {
      for (const k of ['ascent', 'gold', 'runes', 'best'] as const) {
        if (typeof d[k] === 'number') s[k] = d[k];
      }
      s.seenCamp = !!d.seenCamp;
      if (d.up) {
        for (const k in s.up) {
          if (typeof d.up[k] === 'number') s.up[k as keyof Upgrades] = d.up[k];
        }
      }
    }
    return s;
  } catch (e) {
    return structuredClone(DEF_SAVE);
  }
}

/* Swallows quota and private-mode failures. A save that cannot be written is
   not worth ending a run over. */
export function save(s: Save) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) { /* full or blocked */ }
}
