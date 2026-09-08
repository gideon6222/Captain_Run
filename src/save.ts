/* The save. One localStorage key, read once at boot and written on every
   workshop visit and run end.

   `load` is defensive on purpose: it starts from a fresh default and copies
   across only fields of the type it expects. A save written by an older build,
   or one a browser handed back half-written, then degrades to defaults for the
   parts it cannot read rather than throwing on boot - and a boot that throws
   on a phone is a game that is simply gone, with no console to ask why. */

import type { Upgrades } from './tuning.js';
import { SCENTS } from './tuning.js';

/* A new key rather than a migration. The viking game this repo used to hold
   wrote `captainrun.v1`, and there is no sensible mapping from a warband to a
   candle - a migration would be inventing a save rather than reading one.
   The old key is left alone; it costs 339 bytes and clearing it is the sort of
   destructive tidying that goes wrong on someone's phone. */
export const KEY = 'wick.v1';

export interface Save {
  v: number; level: number; coins: number; best: number;
  bestValue: number; seenShop: boolean;
  scents: number[]; up: Upgrades;
}

export const DEF_SAVE: Save = {
  v: 1, level: 1, coins: 0, best: 1, bestValue: 0, seenShop: false,
  scents: [],
  up: { core: 0, hard: 0, wick: 0, dye: 0, scoop: 0, hand: 0, bees: 0, mould: 0 },
};

export function load(): Save {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return structuredClone(DEF_SAVE);
    const d = JSON.parse(raw);
    const s = structuredClone(DEF_SAVE);
    if (d && typeof d === 'object') {
      for (const k of ['level', 'coins', 'best', 'bestValue'] as const) {
        if (typeof d[k] === 'number') s[k] = d[k];
      }
      s.seenShop = !!d.seenShop;
      /* Filtered rather than trusted: a scent id that is not a scent would
         index SCENTS as undefined and take down the shop render on boot, which
         is the one screen the player cannot get past. */
      if (Array.isArray(d.scents)) {
        s.scents = d.scents.filter(
          (n: unknown) => typeof n === 'number' && n >= 0 && n < SCENTS.length,
        );
      }
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
