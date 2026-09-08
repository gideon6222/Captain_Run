/* Every number that shapes how the game feels, and the arithmetic derived from
   it. Pure: nothing here reads live state, so each function takes the upgrade
   table and whatever run-scoped value it needs as an argument.

   That shape is deliberate. These are the numbers a balance change moves, and
   a function that reads a module-level `S` and `run` cannot be checked without
   booting the whole game. */

import { clamp } from './util.js';

export const T = {
  roadW: 6.2,
  laneClamp: 1.5,
  baseSpeed: 11.0,
  steerSpeed: 9.5,
  chunk: 12,
  ascentChunks: 44,

  startCrew: 3,
  maxCrewBase: 12,
  crewSpacing: 0.47,
  visCrew: 26,

  atkInterval: 0.42,
  atkRange: 22,
  baseDmg: 4.2,
  tierMul: 2.15,
  whetMul: 0.08,

  // everything hostile scales by this to the ascent power
  ascentScale: 2.02,
  gruntHP: 26,
  /* Exactly twice a grunt, and they cost two crew instead of one.

     It was 88 - 3.4x - which was never actually played, because the hash bug
     meant no brute ever spawned. With them spawning, 88 put the first ascent
     on the wrong side of a cliff: enemy HP also scales 1 + chunk*0.14, so a
     chunk-25 brute was ~400 HP against a warband still on tier 2, it survived
     every volley it was in range for, and the run died at chunk 29 every time.
     Measured: 64 wins the first ascent, 70 loses it. Twice a grunt sits well
     clear of that edge and is a number that can be reasoned about. */
  bruteHP: 52,
  bossHP: 9000,
  gruntGold: 7,
  bruteGold: 18,
  crateIron: 4,
  shrineRune: 1,

  /* How often each seeded roll comes up. These lived as bare numbers inside
     the spawn code, compared against a hash that could not exceed 0.5 - so
     every one of them was silently a different odds than it read as, and the
     first three were simply zero. Named and gathered here so the odds are
     visible next to the numbers they interact with. */
  bruteChance: 0.28,      // of enemies past chunk 12
  punishGateChance: 0.32, // gates offering a real loss rather than two gains
  sceneryChance: 0.58,    // of scenery slots that are filled at all
  treeChance: 0.58,       // of those that are a tree rather than a rock

  forgeBase: 14,        // iron for the first in-run forge tier
  forgeGrowth: 1.55,

  magnetBase: 3.4,
  deathKeep: 0.6,
};

export const TIERS = [
  { n: 'RUSTED AXE',  c: 0x9a7a5a },
  { n: 'IRON AXE',    c: 0xc9d6e0 },
  { n: 'EMBER AXE',   c: 0xff8b3d },
  { n: 'RUNED AXE',   c: 0x8be0ff },
  { n: 'FROST AXE',   c: 0xd8f4ff },
  { n: 'STORM AXE',   c: 0xffe14a },
  { n: 'BLOODFANG',   c: 0xff3d5a },
  { n: 'RAGNAROK',    c: 0xb96bff },
  { n: 'GOD-CLEAVER', c: 0xffffff },
];

export interface Palette {
  name: string;
  sky: [string, string];
  fog: number; ground: number; road: number; kerb: number;
  tree: number; tree2: number; rock: number; mount: number; dust: number;
}

export const PALETTES: Palette[] = [
  { name: 'PINEWOOD',  sky: ['#8fd4ef', '#dff2ff'], fog: 0xcfe9f6, ground: 0x3d7a3c, road: 0x9a8763, kerb: 0x6d5b3e, tree: 0x2f6f37, tree2: 0x4a3020, rock: 0x8b96a0, mount: 0x6f8fa8, dust: 0xffffff },
  { name: 'HVITFELL',  sky: ['#9dc4dd', '#f2fbff'], fog: 0xeaf5fb, ground: 0xe2edf4, road: 0xc6d2da, kerb: 0x93a3ae, tree: 0x27543a, tree2: 0x3a2718, rock: 0xa8b5be, mount: 0x9fb6c6, dust: 0xffffff },
  { name: 'EMBERWAY',  sky: ['#4a1424', '#d4562a'], fog: 0x8a3320, ground: 0x4d2119, road: 0x6f4436, kerb: 0x4a2d22, tree: 0x7a2a18, tree2: 0x3a1a10, rock: 0x4a2d2a, mount: 0x7a3524, dust: 0xff9d4a },
  { name: 'THE VOID',  sky: ['#140a26', '#4a2a86'], fog: 0x2a1650, ground: 0x261645, road: 0x4c3277, kerb: 0x33205a, tree: 0x6a34b0, tree2: 0x2a1a48, rock: 0x33224f, mount: 0x3d2470, dust: 0xc79bff },
];

export interface Upgrades {
  weapon: number; whet: number; warband: number; mead: number; boots: number;
  lode: number; thor: number; freyja: number; odin: number;
}

// ── derived stats ────────────────────────────────────────────────────────────

/* Difficulty is exponential in the ascent number and player damage is
   exponential in the weapon tier. The game is the race between those two
   curves, so these two lines are the whole balance. */
export const scaleFor = (ascent: number) => Math.pow(T.ascentScale, ascent - 1);

export const weaponTier = (up: Upgrades, forgeTier: number) =>
  clamp(up.weapon + forgeTier + (up.odin > 0 ? up.odin : 0), 0, TIERS.length - 1);

export function dmgPerHit(up: Upgrades, forgeTier: number) {
  const tier = weaponTier(up, forgeTier);
  return T.baseDmg * Math.pow(T.tierMul, tier) * (1 + up.whet * T.whetMul) * (1 + up.thor * 0.10);
}

export const squadDPS = (up: Upgrades, forgeTier: number, crew: number) =>
  (crew * dmgPerHit(up, forgeTier)) / T.atkInterval;

export const maxCrew = (up: Upgrades) => T.maxCrewBase + up.mead * 2;
export const startCrew = (up: Upgrades) => T.startCrew + up.warband;
export const runSpeed = (up: Upgrades) => T.baseSpeed * (1 + up.boots * 0.06);
export const magnetR = (up: Upgrades) => T.magnetBase * (1 + up.lode * 0.25);
export const goldMul = (up: Upgrades) => 1 + up.freyja * 0.12;
