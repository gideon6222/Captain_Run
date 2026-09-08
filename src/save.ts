/* The save. One localStorage key, read once at boot and written on every
   workshop visit and level end.

   `load` is defensive on purpose: it starts from a fresh default and copies
   across only fields of the type it expects. A save written by an older build,
   or one a browser handed back half-written, then degrades to defaults for the
   parts it cannot read rather than throwing on boot - and a boot that throws
   on a phone is a game that is simply gone, with no console to ask why. */

import { DEF_UP, type Upgrades } from './tuning.js';

/* A new key each time the game underneath it changes shape, rather than a
   migration. There is no sensible mapping from a viking warband to a candle,
   nor from a single candle's wax total to a tray of finished gifts - a
   migration would be inventing a save rather than reading one. Old keys are
   left alone; they cost a few hundred bytes and clearing them is the sort of
   destructive tidying that goes wrong on someone's phone. */
export const KEY = 'candlegift.v1';

export interface Save {
  v: number; level: number; coins: number; best: number;
  bestValue: number; stars: number; seenShop: boolean;
  up: Upgrades;
}

export const DEF_SAVE: Save = {
  v: 1, level: 1, coins: 0, best: 1, bestValue: 0, stars: 0, seenShop: false,
  up: { ...DEF_UP },
};

export function load(): Save {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return structuredClone(DEF_SAVE);
    const d = JSON.parse(raw);
    const s = structuredClone(DEF_SAVE);
    if (d && typeof d === 'object') {
      for (const k of ['level', 'coins', 'best', 'bestValue', 'stars'] as const) {
        if (typeof d[k] === 'number' && isFinite(d[k])) s[k] = d[k];
      }
      s.seenShop = !!d.seenShop;
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
