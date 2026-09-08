// Captain Run — a viking crowd-runner.
// Five files, no build step. See NOTES.md in the repo for design decisions.

import * as THREE from 'three';
import { VERSION, CHANGELOG } from './changelog.js';

// ─────────────────────────────────────────────────────────────────────────────
// TUNING — every number that shapes how it feels lives here.
// ─────────────────────────────────────────────────────────────────────────────
const T = {
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
  bruteHP: 88,
  bossHP: 9000,
  gruntGold: 7,
  bruteGold: 18,
  crateIron: 4,
  shrineRune: 1,

  forgeBase: 14,        // iron for the first in-run forge tier
  forgeGrowth: 1.55,

  magnetBase: 3.4,
  deathKeep: 0.6,
};

const TIERS = [
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

const PALETTES = [
  { name: 'PINEWOOD',  sky: ['#8fd4ef', '#dff2ff'], fog: 0xcfe9f6, ground: 0x3d7a3c, road: 0x9a8763, kerb: 0x6d5b3e, tree: 0x2f6f37, tree2: 0x4a3020, rock: 0x8b96a0, mount: 0x6f8fa8, dust: 0xffffff },
  { name: 'HVITFELL',  sky: ['#9dc4dd', '#f2fbff'], fog: 0xeaf5fb, ground: 0xe2edf4, road: 0xc6d2da, kerb: 0x93a3ae, tree: 0x27543a, tree2: 0x3a2718, rock: 0xa8b5be, mount: 0x9fb6c6, dust: 0xffffff },
  { name: 'EMBERWAY',  sky: ['#4a1424', '#d4562a'], fog: 0x8a3320, ground: 0x4d2119, road: 0x6f4436, kerb: 0x4a2d22, tree: 0x7a2a18, tree2: 0x3a1a10, rock: 0x4a2d2a, mount: 0x7a3524, dust: 0xff9d4a },
  { name: 'THE VOID',  sky: ['#140a26', '#4a2a86'], fog: 0x2a1650, ground: 0x261645, road: 0x4c3277, kerb: 0x33205a, tree: 0x6a34b0, tree2: 0x2a1a48, rock: 0x33224f, mount: 0x3d2470, dust: 0xc79bff },
];

// ─────────────────────────────────────────────────────────────────────────────
// SAVE
// ─────────────────────────────────────────────────────────────────────────────
const KEY = 'captainrun.v1';
const DEF_SAVE = {
  v: 1, ascent: 1, gold: 0, runes: 0, best: 1, seenCamp: false,
  up: { weapon: 0, whet: 0, warband: 0, mead: 0, boots: 0, lode: 0, thor: 0, freyja: 0, odin: 0 },
};
let S = load();

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return structuredClone(DEF_SAVE);
    const d = JSON.parse(raw);
    const s = structuredClone(DEF_SAVE);
    if (d && typeof d === 'object') {
      for (const k of ['ascent', 'gold', 'runes', 'best']) if (typeof d[k] === 'number') s[k] = d[k];
      s.seenCamp = !!d.seenCamp;
      if (d.up) for (const k in s.up) if (typeof d.up[k] === 'number') s.up[k] = d.up[k];
    }
    return s;
  } catch (e) { return structuredClone(DEF_SAVE); }
}
function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {} }

// ─────────────────────────────────────────────────────────────────────────────
// SMALL HELPERS
// ─────────────────────────────────────────────────────────────────────────────
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;
// frame-rate independent smoothing (see gamedev-notes CRAFT.md)
const smooth = (rate, dt) => 1 - Math.exp(-rate * dt);

function hash(a, b) {
  let h = (a | 0) * 374761393 + (b | 0) * 668265263;
  h = (h ^ (h >> 13)) * 1274126177;
  return ((h ^ (h >> 16)) >>> 0) / 4294967296;
}
function fmt(n) {
  n = Math.floor(n);
  if (n < 1000) return '' + n;
  if (n < 1e6) return (n / 1e3).toFixed(n < 1e4 ? 1 : 0) + 'K';
  if (n < 1e9) return (n / 1e6).toFixed(n < 1e7 ? 1 : 0) + 'M';
  return (n / 1e9).toFixed(1) + 'B';
}

// derived stats
const scaleFor = (a) => Math.pow(T.ascentScale, a - 1);
function weaponTier() { return clamp(S.up.weapon + run.forgeTier + (S.up.odin > 0 ? S.up.odin : 0), 0, TIERS.length - 1); }
function dmgPerHit() {
  const tier = weaponTier();
  return T.baseDmg * Math.pow(T.tierMul, tier) * (1 + S.up.whet * T.whetMul) * (1 + S.up.thor * 0.10);
}
function squadDPS() { return run.crew * dmgPerHit() / T.atkInterval; }
function maxCrew() { return T.maxCrewBase + S.up.mead * 2; }
function startCrew() { return T.startCrew + S.up.warband; }
function runSpeed() { return T.baseSpeed * (1 + S.up.boots * 0.06); }
function magnetR() { return T.magnetBase * (1 + S.up.lode * 0.25); }
function goldMul() { return 1 + S.up.freyja * 0.12; }

// ─────────────────────────────────────────────────────────────────────────────
// RENDERER / SCENE
// ─────────────────────────────────────────────────────────────────────────────
const host = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearAlpha(0);
host.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xcfe9f6, 58, 176);

const camera = new THREE.PerspectiveCamera(64, window.innerWidth / window.innerHeight, 0.5, 320);
scene.add(camera);

const amb = new THREE.AmbientLight(0xffffff, 0.72);
scene.add(amb);
const hemi = new THREE.HemisphereLight(0xdff2ff, 0x4a3a26, 0.55);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffffff, 2.6);
sun.position.set(-6, 12, -4);
scene.add(sun);
scene.add(sun.target);

// toon gradient map — four hard bands, the whole art style in six lines
function gradientMap(steps) {
  const data = new Uint8Array(steps.length * 4);
  for (let i = 0; i < steps.length; i++) {
    const v = Math.round(steps[i] * 255);
    data[i * 4] = v; data[i * 4 + 1] = v; data[i * 4 + 2] = v; data[i * 4 + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, steps.length, 1, THREE.RGBAFormat);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}
const GRAD = gradientMap([0.36, 0.62, 0.84, 1.0]);

const matCache = new Map();
function toon(color, opts) {
  const key = color + '|' + (opts ? JSON.stringify(opts) : '');
  let m = matCache.get(key);
  if (!m) {
    m = new THREE.MeshToonMaterial(Object.assign({ color, gradientMap: GRAD }, opts || {}));
    matCache.set(key, m);
  }
  return m;
}
const OUTLINE_MAT = new THREE.MeshBasicMaterial({ color: 0x140a06, side: THREE.BackSide });

// ─────────────────────────────────────────────────────────────────────────────
// PART LAYERS — one InstancedMesh per body part, rewritten every frame.
// This is what lets 26 vikings, 18 draugr and 260 loot chunks cost ~50 draw calls.
// ─────────────────────────────────────────────────────────────────────────────
class Layer {
  // `outline` is a thickness in world units, not a scale factor: the hull is scaled
  // per axis from the geometry's own size so the black edge is the same width
  // everywhere, and scaling (rather than pushing along normals) leaves no corner gaps.
  constructor(geo, color, max, outline) {
    this.max = max;
    this.mesh = new THREE.InstancedMesh(geo, toon(color), max);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    scene.add(this.mesh);
    this.out = null;
    if (outline) {
      this.out = new THREE.InstancedMesh(geo, OUTLINE_MAT, max);
      this.out.frustumCulled = false;
      this.out.count = 0;
      this.out.renderOrder = -1;
      scene.add(this.out);
      this.tmp = new THREE.Matrix4();
      geo.computeBoundingBox();
      const bb = geo.boundingBox;
      const sx = Math.max(0.02, bb.max.x - bb.min.x);
      const sy = Math.max(0.02, bb.max.y - bb.min.y);
      const sz = Math.max(0.02, bb.max.z - bb.min.z);
      this.sv = new THREE.Vector3(1 + 2 * outline / sx, 1 + 2 * outline / sy, 1 + 2 * outline / sz);
    }
    this.n = 0;
    this.tinted = false;
  }
  reset() { this.n = 0; }
  push(m, color) {
    if (this.n >= this.max) return;
    this.mesh.setMatrixAt(this.n, m);
    if (color !== undefined) { this.mesh.setColorAt(this.n, color); this.tinted = true; }
    if (this.out) { this.tmp.copy(m).scale(this.sv); this.out.setMatrixAt(this.n, this.tmp); }
    this.n++;
  }
  flush() {
    this.mesh.count = this.n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.tinted && this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    if (this.out) { this.out.count = this.n; this.out.instanceMatrix.needsUpdate = true; }
  }
}

const box = (x, y, z) => new THREE.BoxGeometry(x, y, z);
const M = new THREE.Matrix4(), M2 = new THREE.Matrix4(), M3 = new THREE.Matrix4();
const MA = new THREE.Matrix4(), MB = new THREE.Matrix4();
const Q = new THREE.Quaternion(), V = new THREE.Vector3(), V2 = new THREE.Vector3();
const ONE = new THREE.Vector3(1, 1, 1);
const CTMP = new THREE.Color();

// ── crew layers ──────────────────────────────────────────────────────────────
const L = {
  leg:    new Layer(box(0.21, 0.52, 0.24), 0x6f4a2a, T.visCrew * 2, 0.060),
  torso:  new Layer(box(0.62, 0.60, 0.44), 0xffffff, T.visCrew, 0.070),
  belt:   new Layer(box(0.68, 0.13, 0.50), 0x2a1a0e, T.visCrew, 0),
  arm:    new Layer(box(0.19, 0.46, 0.21), 0xffffff, T.visCrew * 2, 0),
  head:   new Layer(box(0.40, 0.34, 0.38), 0xf2c79a, T.visCrew, 0.066),
  beard:  new Layer(box(0.38, 0.30, 0.14), 0xffffff, T.visCrew, 0),
  helm:   new Layer(box(0.48, 0.26, 0.44), 0xa9b6c4, T.visCrew, 0.066),
  horn:   new Layer(new THREE.ConeGeometry(0.085, 0.26, 5), 0xf2e8cf, T.visCrew * 2, 0),
  haft:   new Layer(box(0.075, 0.82, 0.075), 0x6b431f, T.visCrew, 0),
  blade:  new Layer(box(0.36, 0.30, 0.09), 0xffffff, T.visCrew, 0.055),
  shield: new Layer(new THREE.CylinderGeometry(0.22, 0.22, 0.08, 8), 0xffffff, T.visCrew, 0.055),
  shadow: new Layer(new THREE.CircleGeometry(0.34, 10), 0x000000, 90, 0),
};
L.shadow.mesh.material = new THREE.MeshBasicMaterial({ color: 0x1a1208, transparent: true, opacity: 0.26, depthWrite: false });

// ── enemy layers (the boss is one of these, scaled up) ───────────────────────
const E = {
  leg:   new Layer(box(0.24, 0.55, 0.26), 0x3c4652, 40, 0.070),
  torso: new Layer(box(0.78, 0.70, 0.46), 0xffffff, 20, 0.075),
  arm:   new Layer(box(0.21, 0.50, 0.22), 0x3c4652, 40, 0),
  head:  new Layer(box(0.36, 0.33, 0.34), 0xffffff, 20, 0.070),
  horn:  new Layer(new THREE.ConeGeometry(0.09, 0.42, 5), 0x776346, 40, 0),
  haft:  new Layer(box(0.10, 0.95, 0.10), 0x5a4530, 20, 0),
  club:  new Layer(box(0.32, 0.36, 0.30), 0x6d7784, 20, 0.070),
};

// ── world / pickup layers ────────────────────────────────────────────────────
const W = {
  loot:   new Layer(box(0.34, 0.16, 0.26), 0xffffff, 420, 0),
  axe:    new Layer(box(0.30, 0.11, 0.09), 0xffffff, 100, 0),
  crate:  new Layer(box(0.9, 0.9, 0.9), 0xffffff, 20, 0.075),
  band:   new Layer(box(1.0, 0.18, 1.0), 0x3a2412, 20, 0),
  shrine: new Layer(new THREE.OctahedronGeometry(0.62, 0), 0xffffff, 12, 0.075),
  step:   new Layer(box(T.roadW, 0.09, 0.55), 0xffffff, 70, 0),
  trunk:  new Layer(box(0.3, 1.3, 0.3), 0xffffff, 80, 0),
  tree:   new Layer(new THREE.ConeGeometry(1.15, 3.4, 6), 0xffffff, 80, 0.090),
  rock:   new Layer(new THREE.IcosahedronGeometry(0.8, 0), 0xffffff, 90, 0.085),
  mount:  new Layer(new THREE.ConeGeometry(30, 42, 5), 0xffffff, 10, 0),
};

// road, kerbs, ground — plain meshes, one draw call each
const road = new THREE.Mesh(box(T.roadW, 1.2, 1600), toon(0x9a8763));
road.position.y = -0.6;
scene.add(road);
const kerbL = new THREE.Mesh(box(0.55, 1.0, 1600), toon(0x6d5b3e));
const kerbR = kerbL.clone();
kerbL.position.set(-T.roadW / 2 - 0.2, -0.32, 0);
kerbR.position.set(T.roadW / 2 + 0.2, -0.32, 0);
scene.add(kerbL, kerbR);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(600, 1600), toon(0x3d7a3c));
ground.rotation.x = -Math.PI / 2;
ground.position.y = -0.95;
scene.add(ground);

// drifting motes
const MOTES = 130;
const moteGeo = new THREE.BufferGeometry();
const motePos = new Float32Array(MOTES * 3);
for (let i = 0; i < MOTES; i++) {
  motePos[i * 3] = (Math.random() - 0.5) * 40;
  motePos[i * 3 + 1] = Math.random() * 14;
  motePos[i * 3 + 2] = Math.random() * 90 - 20;
}
moteGeo.setAttribute('position', new THREE.BufferAttribute(motePos, 3));
const moteMat = new THREE.PointsMaterial({ color: 0xffffff, size: 0.17, transparent: true, opacity: 0.7, depthWrite: false });
const motes = new THREE.Points(moteGeo, moteMat);
motes.frustumCulled = false;
scene.add(motes);

// ─────────────────────────────────────────────────────────────────────────────
// GATES — few enough to be real meshes, with canvas-texture labels
// ─────────────────────────────────────────────────────────────────────────────
const labelCache = new Map();
function labelTex(text, good) {
  const key = text + (good ? '+' : '-');
  if (labelCache.has(key)) return labelCache.get(key);
  const c = document.createElement('canvas');
  c.width = 256; c.height = 128;
  const g = c.getContext('2d');
  g.clearRect(0, 0, 256, 128);
  g.font = 'bold 86px "Segoe UI", system-ui, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineWidth = 14; g.strokeStyle = '#140a06';
  g.strokeText(text, 128, 68);
  g.fillStyle = good ? '#eaffe6' : '#ffe0e0';
  g.fillText(text, 128, 68);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  labelCache.set(key, tex);
  return tex;
}

class GateHalf {
  constructor() {
    this.group = new THREE.Group();
    this.panel = new THREE.Mesh(box(T.roadW / 2 - 0.06, 3.0, 0.16),
      new THREE.MeshBasicMaterial({ color: 0x5ce07a, transparent: true, opacity: 0.34, depthWrite: false }));
    this.panel.position.y = 1.5;
    this.frame = new THREE.Mesh(box(T.roadW / 2 - 0.06, 0.26, 0.34), toon(0x5ce07a));
    this.frame.position.y = 3.08;
    this.post = new THREE.Mesh(box(0.2, 3.3, 0.3), toon(0x2a1a0e));
    this.post.position.set(T.roadW / 4 - 0.03, 1.65, 0);
    this.label = new THREE.Mesh(new THREE.PlaneGeometry(2.3, 1.15),
      new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false }));
    this.label.position.set(0, 1.85, -0.2);
    this.label.rotation.y = Math.PI;
    this.group.add(this.panel, this.frame, this.post, this.label);
    this.group.visible = false;
    scene.add(this.group);
  }
  set(x, z, text, good, showPost) {
    this.group.position.set(x, 0, z);
    this.group.visible = true;
    this.post.visible = !!showPost;   // one divider at the centre, not two overlapping
    const col = good ? 0x4ce07a : 0xff4d5e;
    this.panel.material.color.setHex(col);
    this.frame.material = toon(col);
    this.label.material.map = labelTex(text, good);
    this.label.material.needsUpdate = true;
  }
  hide() { this.group.visible = false; }
}
const gateHalves = [new GateHalf(), new GateHalf(), new GateHalf(), new GateHalf()];

// ─────────────────────────────────────────────────────────────────────────────
// POOLS
// ─────────────────────────────────────────────────────────────────────────────
const loot = [];
for (let i = 0; i < 300; i++) loot.push({ live: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, rot: 0, spin: 0, kind: 0, val: 0, t: 0, col: new THREE.Color() });
const axes = [];
for (let i = 0; i < 100; i++) axes.push({ live: false, x: 0, y: 0, z: 0, tx: 0, ty: 0, tz: 0, t: 0, dur: 1, dmg: 0, target: null, rot: 0, col: new THREE.Color() });
const sparks = [];
for (let i = 0; i < 90; i++) sparks.push({ live: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, t: 0, col: new THREE.Color() });

// crew members
const crewUnits = [];
for (let i = 0; i < T.visCrew; i++) {
  crewUnits.push({
    x: 0, z: 0, tx: 0, tz: 0, phase: Math.random() * 6.28,
    cloak: new THREE.Color().setHSL(0.02 + Math.random() * 0.10, 0.72, 0.40 + Math.random() * 0.1),
    beard: new THREE.Color().setHSL(0.07 + Math.random() * 0.04, 0.5, 0.35 + Math.random() * 0.2),
    shield: new THREE.Color().setHSL(Math.random(), 0.42, 0.44),
  });
}

// entity lists, rebuilt per run
let enemies = [], crates = [], shrines = [], gates = [], scenery = [];
let boss = null;

// ─────────────────────────────────────────────────────────────────────────────
// RUN STATE
// ─────────────────────────────────────────────────────────────────────────────
const run = {
  active: false, z: 0, x: 0, targetX: 0, crew: 3, dist: 0,
  gold: 0, iron: 0, runes: 0, forgeTier: 0, forgeFill: 0,
  atkTimer: 0, chunkSpawned: -1, palette: 0, scale: 1,
  shake: 0, hitStop: 0, time: 0, over: false, bossPhase: false,
  lastChunkWindow: -999,
};

let hintTimer = 0;

function startAscent() {
  run.active = true; run.over = false; run.bossPhase = false;
  run.z = 0; run.x = 0; run.targetX = 0;
  run.crew = clamp(startCrew(), 1, maxCrew());
  run.gold = 0; run.iron = 0; run.runes = 0;
  run.forgeTier = 0; run.forgeFill = 0;
  run.atkTimer = 0; run.chunkSpawned = -1; run.time = 0;
  run.scale = scaleFor(S.ascent);
  run.palette = (S.ascent - 1) % PALETTES.length;
  run.lastChunkWindow = -999;
  enemies.length = 0; crates.length = 0; shrines.length = 0; gates.length = 0;
  boss = null;
  for (const l of loot) l.live = false;
  for (const a of axes) a.live = false;
  for (const s of sparks) s.live = false;
  for (let i = 0; i < crewUnits.length; i++) { crewUnits[i].x = 0; crewUnits[i].z = 0; }
  applyPalette(PALETTES[run.palette]);
  hintTimer = S.seenCamp ? 0 : 4.5;
  hintEl.style.opacity = hintTimer > 0 ? '0.95' : '0';
  campEl.classList.add('hidden');
  progWrap.classList.remove('boss');
  progLabel.textContent = 'TO THE JOTUNN';
  toast(PALETTES[run.palette].name, 1.2);
  syncHUD();
}

function applyPalette(p) {
  host.style.background = `linear-gradient(180deg, ${p.sky[0]} 0%, ${p.sky[1]} 62%, ${p.sky[1]} 100%)`;
  scene.fog.color.setHex(p.fog);
  road.material = toon(p.road);
  kerbL.material = toon(p.kerb); kerbR.material = toon(p.kerb);
  ground.material = toon(p.ground);
  W.tree.mesh.material = toon(p.tree);
  W.trunk.mesh.material = toon(p.tree2);
  W.rock.mesh.material = toon(p.rock);
  W.mount.mesh.material = toon(p.mount);
  W.step.mesh.material = toon(p.kerb);
  moteMat.color.setHex(p.dust);
  document.querySelector('meta[name=theme-color]').setAttribute('content', p.sky[0]);
}

// ─────────────────────────────────────────────────────────────────────────────
// SPAWNING — seeded per chunk, so an ascent layout is reproducible
// ─────────────────────────────────────────────────────────────────────────────
function spawnChunk(c) {
  const z = c * T.chunk;
  if (c === T.ascentChunks) { spawnBoss(z + 14); return; }
  if (c > T.ascentChunks || c < 3) return;

  // gates on a fixed cadence — the decision beat of the run
  if (c === 4 || c === 11 || c === 19 || c === 27 || c === 35) { spawnGate(z + 6); return; }

  const r = hash(c, 91 + S.ascent);
  const r2 = hash(c, 402 + S.ascent);
  const r3 = hash(c, 777 + S.ascent);

  // enemies
  const density = clamp(0.16 + c * 0.013, 0, 0.72);
  if (c >= 6 && r < density) {
    const n = 1 + Math.floor(r2 * (c > 24 ? 5 : 3));
    for (let i = 0; i < n; i++) {
      const brute = c > 12 && hash(c, 1000 + i) > 0.72;
      enemies.push(makeEnemy(
        (hash(c, 300 + i) - 0.5) * (T.roadW - 1.4),
        z + 2 + i * 2.6 + hash(c, 500 + i) * 3,
        brute, c));
    }
  }
  // crates
  if (r2 < 0.42) {
    const n = 1 + Math.floor(r3 * 3);
    for (let i = 0; i < n; i++) {
      crates.push({
        x: (hash(c, 700 + i) - 0.5) * (T.roadW - 1.6),
        z: z + 3 + i * 2.2, hp: 1, spin: hash(c, 800 + i) * 6.28, bob: hash(c, 810 + i) * 6.28,
      });
    }
  }
  // rune shrine
  if (r3 < 0.10 && c > 6) {
    shrines.push({ x: (hash(c, 900) - 0.5) * (T.roadW - 1.8), z: z + 6, spin: 0, taken: false });
  }
}

function makeEnemy(x, z, brute, chunk) {
  const hp = (brute ? T.bruteHP : T.gruntHP) * run.scale * (1 + chunk * 0.14);
  return {
    x, z, hp, maxhp: hp, brute, boss: false,
    scale: brute ? 1.35 : 1.0, phase: Math.random() * 6.28,
    power: brute ? 2 : 1, gold: (brute ? T.bruteGold : T.gruntGold) * run.scale,
    hurt: 0, dead: false, tint: brute ? 0x7a5f8c : 0x5a6b7a,
  };
}

function spawnBoss(z) {
  const hp = T.bossHP * run.scale;
  boss = {
    x: 0, z, hp, maxhp: hp, brute: true, boss: true, scale: 3.3,
    phase: 0, power: 2, gold: 90 * run.scale, hurt: 0, dead: false,
    slam: 3.4, tint: 0x4a7fa8, armed: false,
  };
  enemies.push(boss);
}
function armBoss() {
  boss.armed = true;
  run.bossPhase = true;
  progWrap.classList.add('boss');
  progLabel.textContent = 'JOTUNN';
  toast('JOTUNN', 1.5);
  sfx.horn();
  shake(0.6);
}

function spawnGate(z) {
  const r = hash(z | 0, 55 + S.ascent);
  const punish = r > 0.68;
  const add = 3 + Math.floor(hash(z | 0, 66) * 6);
  let a, b;
  if (punish) {
    a = { op: 'mul', v: 2, text: '×2', good: true };
    b = { op: 'sub', v: 2 + Math.floor(hash(z | 0, 77) * 4), good: false };
    b.text = '−' + b.v;
  } else {
    a = { op: 'add', v: add, text: '+' + add, good: true };
    b = { op: 'mul', v: 2, text: '×2', good: true };
  }
  if (hash(z | 0, 88) > 0.5) { const t = a; a = b; b = t; }
  gates.push({ z, taken: false, left: a, right: b });
}

// ─────────────────────────────────────────────────────────────────────────────
// LOOT / FX
// ─────────────────────────────────────────────────────────────────────────────
let lootCursor = 0;
function burst(x, y, z, n, kind, total) {
  const per = total / n;
  for (let i = 0; i < n; i++) {
    const p = loot[lootCursor];
    lootCursor = (lootCursor + 1) % loot.length;
    p.live = true; p.x = x; p.y = y; p.z = z;
    const a = Math.random() * 6.283, s = 1.6 + Math.random() * 3.4;
    p.vx = Math.cos(a) * s * 0.55; p.vz = Math.sin(a) * s * 0.55 - 1.5;
    p.vy = 4.2 + Math.random() * 4.4;
    p.rot = Math.random() * 6.28; p.spin = (Math.random() - 0.5) * 14;
    p.kind = kind; p.val = per; p.t = 0;
    if (kind === 0) p.col.setHSL(0.11, 0.95, 0.52 + Math.random() * 0.12);
    else if (kind === 1) p.col.setHSL(0.56, 0.75, 0.62 + Math.random() * 0.1);
    else p.col.setHSL(0.76, 0.8, 0.62);
  }
}
let sparkCursor = 0;
function sparkle(x, y, z, n, hex) {
  for (let i = 0; i < n; i++) {
    const s = sparks[sparkCursor];
    sparkCursor = (sparkCursor + 1) % sparks.length;
    s.live = true; s.x = x; s.y = y; s.z = z;
    s.vx = (Math.random() - 0.5) * 7; s.vy = 1 + Math.random() * 6; s.vz = (Math.random() - 0.5) * 7;
    s.t = 0; s.col.setHex(hex);
  }
}
function shake(v) { run.shake = Math.min(1.2, run.shake + v); }
function hitStop(ms) { run.hitStop = Math.max(run.hitStop, ms / 1000); }

// ─────────────────────────────────────────────────────────────────────────────
// AUDIO — fully synthesised, no binaries reach this repo
// ─────────────────────────────────────────────────────────────────────────────
const sfx = (() => {
  let ac = null, master = null, musicGain = null, noiseBuf = null, delay = null;
  let step = 0, nextTime = 0, timer = null, lastPing = 0;
  const THEME = [0, 3, 5, 7, 5, 3, 0, -2];   // D minor-ish, 8 slow notes

  function init() {
    if (ac) { if (ac.state === 'suspended') ac.resume().catch(() => {}); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ac = new AC();
    master = ac.createGain(); master.gain.value = 0.6;
    const comp = ac.createDynamicsCompressor();
    master.connect(comp); comp.connect(ac.destination);
    musicGain = ac.createGain(); musicGain.gain.value = 0.34; musicGain.connect(master);
    delay = ac.createDelay(1.0); delay.delayTime.value = 0.34;
    const fb = ac.createGain(); fb.gain.value = 0.3;
    delay.connect(fb); fb.connect(delay); delay.connect(musicGain);
    const len = ac.sampleRate * 1.2;
    noiseBuf = ac.createBuffer(1, len, ac.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    // drone bed
    for (const [f, det] of [[73.4, 0], [110, 4], [146.8, -5]]) {
      const o = ac.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = det;
      const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 420;
      const g = ac.createGain(); g.gain.value = 0.055;
      o.connect(lp); lp.connect(g); g.connect(musicGain); o.start();
    }
    if (ac.state === 'suspended') ac.resume().catch(() => {});
    nextTime = ac.currentTime + 0.1;
    timer = setInterval(sched, 120);
  }
  function tone(freq, dur, type, vol, atk, dest) {
    if (!ac) return;
    const o = ac.createOscillator(); o.type = type || 'sine'; o.frequency.value = freq;
    const g = ac.createGain();
    const t = ac.currentTime;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + (atk || 0.005));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(dest || master);
    o.start(t); o.stop(t + dur + 0.02);
    return o;
  }
  function noise(dur, freq, q, vol, type) {
    if (!ac) return;
    const s = ac.createBufferSource(); s.buffer = noiseBuf;
    const f = ac.createBiquadFilter(); f.type = type || 'bandpass'; f.frequency.value = freq; f.Q.value = q || 1;
    const g = ac.createGain();
    const t = ac.currentTime;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(master);
    s.start(t); s.stop(t + dur + 0.02);
  }
  function sched() {
    if (!ac) return;
    const beat = 60 / 116 / 2;   // eighth notes
    while (nextTime < ac.currentTime + 0.3) {
      const s = step % 16;
      const t = nextTime;
      // drum: tom heartbeat
      if (s === 0 || s === 6 || s === 10) drum(t, s === 0 ? 62 : 88, 0.28);
      if (s === 4 || s === 12) drum(t, 150, 0.14);
      // horn theme, one note every 2 beats, only on the second half of the bar cycle
      if (s % 4 === 0) {
        const idx = (Math.floor(step / 4)) % 8;
        const semi = THEME[idx] + (run.bossPhase ? -12 : 0);
        const f = 146.83 * Math.pow(2, semi / 12);
        horn(t, f);
      }
      nextTime += beat; step++;
    }
  }
  function drum(t, f, vol) {
    const o = ac.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(f * 2.2, t);
    o.frequency.exponentialRampToValueAtTime(f, t + 0.09);
    const g = ac.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.32);
    o.connect(g); g.connect(musicGain);
    o.start(t); o.stop(t + 0.36);
  }
  function horn(t, f) {
    const o = ac.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f;
    const o2 = ac.createOscillator(); o2.type = 'sawtooth'; o2.frequency.value = f * 1.005;
    const lp = ac.createBiquadFilter(); lp.type = 'lowpass';
    lp.frequency.setValueAtTime(500, t);
    lp.frequency.linearRampToValueAtTime(1100, t + 0.5);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.075, t + 0.3);       // slow attack: never a beep
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.5);
    o.connect(lp); o2.connect(lp); lp.connect(g); g.connect(musicGain); g.connect(delay);
    o.start(t); o2.start(t); o.stop(t + 1.6); o2.stop(t + 1.6);
  }
  return {
    init,
    throwAxe() { noise(0.09, 2600 + Math.random() * 900, 2, 0.05, 'highpass'); },
    hit() { tone(180 + Math.random() * 120, 0.09, 'square', 0.06); },
    smash() { noise(0.24, 700 + Math.random() * 400, 1.2, 0.2, 'bandpass'); },
    kill() { noise(0.34, 320, 0.9, 0.25); tone(90, 0.3, 'sawtooth', 0.1); },
    ping() {
      if (!ac) return;
      const now = ac.currentTime;
      if (now - lastPing < 0.055) return;
      lastPing = now;
      tone(880 * (0.85 + Math.random() * 0.5), 0.08, 'triangle', 0.045);
    },
    gate(good) {
      if (good) { tone(523, 0.14, 'triangle', 0.11); setTimeout(() => tone(784, 0.2, 'triangle', 0.1), 80); }
      else { tone(200, 0.3, 'sawtooth', 0.11); }
    },
    forge() {
      noise(0.3, 900, 1, 0.22);
      setTimeout(() => { tone(392, 0.5, 'triangle', 0.13, 0.01); tone(587, 0.5, 'triangle', 0.1, 0.01); }, 60);
    },
    hurt() { tone(160, 0.34, 'sawtooth', 0.14, 0.005); },
    horn() { if (!ac) return; horn(ac.currentTime, 98); },
    boom() { noise(0.7, 180, 0.7, 0.34, 'lowpass'); tone(60, 0.8, 'sine', 0.2); },
  };
})();

// ─────────────────────────────────────────────────────────────────────────────
// HUD
// ─────────────────────────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
const hudGold = $('gold'), hudIron = $('iron'), hudRune = $('rune'), hudCrew = $('crewN');
const hudDps = $('dps'), hudWName = $('wName'), wBlade = $('wblade');
const progWrap = $('progWrap'), progFill = $('prog').firstElementChild, progLabel = $('prog').lastElementChild;
const forgeFill = $('forge').firstElementChild, forgeLabel = $('forge').lastElementChild;
const ascentEl = $('ascent'), toastEl = $('toast'), hintEl = $('hint');
const campEl = $('camp'), shopEl = $('shop'), flashEl = $('flash'), vigEl = $('vig');

let toastT = 0;
function toast(msg, dur) { toastEl.textContent = msg; toastEl.style.opacity = '1'; toastT = dur || 1.1; }

let lastHud = {};
function syncHUD() {
  const g = Math.floor(run.gold), i = Math.floor(run.iron), r = Math.floor(run.runes);
  if (lastHud.g !== g) { hudGold.textContent = fmt(g); lastHud.g = g; }
  if (lastHud.i !== i) { hudIron.textContent = fmt(i); lastHud.i = i; }
  if (lastHud.r !== r) { hudRune.textContent = fmt(r); lastHud.r = r; }
  if (lastHud.c !== run.crew) {
    hudCrew.textContent = run.crew;
    // gold when the warband is full, so "CREW FULL +gold" is never a surprise
    hudCrew.style.color = run.crew >= maxCrew() ? '#ffc93c' : '#fff';
    lastHud.c = run.crew;
  }
  const d = Math.floor(squadDPS());
  if (lastHud.d !== d) { hudDps.textContent = fmt(d); lastHud.d = d; }
  const t = weaponTier();
  if (lastHud.t !== t) {
    hudWName.textContent = TIERS[t].n;
    wBlade.setAttribute('fill', '#' + TIERS[t].c.toString(16).padStart(6, '0'));
    lastHud.t = t;
  }
  if (lastHud.a !== S.ascent) { ascentEl.innerHTML = S.ascent + '<small>ASCENT</small>'; lastHud.a = S.ascent; }
  const need = forgeNeed();
  const fpct = Math.round(clamp(run.iron / need, 0, 1) * 100);
  if (lastHud.f !== fpct) {
    forgeFill.style.width = fpct + '%';
    forgeLabel.textContent = 'FORGE ' + Math.floor(run.iron) + '/' + Math.ceil(need);
    lastHud.f = fpct;
  }
  if (run.bossPhase && boss) {
    progFill.style.width = clamp(boss.hp / boss.maxhp, 0, 1) * 100 + '%';
  } else {
    progFill.style.width = clamp(run.z / (T.ascentChunks * T.chunk), 0, 1) * 100 + '%';
  }
}
function forgeNeed() { return T.forgeBase * Math.pow(T.forgeGrowth, run.forgeTier) * run.scale; }

// floating numbers
const popPool = [];
const popsEl = $('pops');
for (let i = 0; i < 16; i++) {
  const d = document.createElement('div');
  d.className = 'pop out';
  d.style.opacity = '0';
  popsEl.appendChild(d);
  popPool.push({ el: d, live: false, x: 0, y: 0, z: 0, t: 0 });
}
let popCursor = 0;
function pop(text, color, x, y, z) {
  const p = popPool[popCursor];
  popCursor = (popCursor + 1) % popPool.length;
  p.live = true; p.t = 0; p.x = x; p.y = y; p.z = z;
  p.el.textContent = text;
  p.el.style.color = color;
}

// ─────────────────────────────────────────────────────────────────────────────
// CAMP (the shop is a place, not a list)
// ─────────────────────────────────────────────────────────────────────────────
const UPGRADES = [
  { g: 'THE FORGE', id: 'weapon', ic: '🪓', name: () => 'Forge: ' + TIERS[clamp(S.up.weapon + 1, 0, 8)].n,
    eff: () => 'Permanent axe tier — ×' + T.tierMul.toFixed(2) + ' damage',
    cost: () => Math.round(80 * Math.pow(2.35, S.up.weapon)), cur: 'gold', max: 8, unlock: 1 },
  { g: 'THE FORGE', id: 'whet', ic: '🪨', name: () => 'Whetstone', eff: () => '+8% damage  (now +' + (S.up.whet * 8) + '%)',
    cost: () => Math.round(40 * Math.pow(1.8, S.up.whet)), cur: 'gold', max: 12, unlock: 1 },

  { g: 'THE LONGHOUSE', id: 'warband', ic: '🛡️', name: () => 'Warband', eff: () => 'Start with ' + (startCrew() + 1) + ' crew',
    cost: () => Math.round(140 * Math.pow(2.2, S.up.warband)), cur: 'gold', max: 6, unlock: 1 },
  { g: 'THE LONGHOUSE', id: 'mead', ic: '🍺', name: () => 'Mead Hall', eff: () => 'Crew limit ' + (maxCrew() + 2),
    cost: () => Math.round(180 * Math.pow(2.3, S.up.mead)), cur: 'gold', max: 7, unlock: 1 },

  { g: 'THE TRAIL', id: 'boots', ic: '🥾', name: () => 'Iron Boots', eff: () => '+6% run speed  (now +' + (S.up.boots * 6) + '%)',
    cost: () => Math.round(120 * Math.pow(1.95, S.up.boots)), cur: 'gold', max: 8, unlock: 2 },
  { g: 'THE TRAIL', id: 'lode', ic: '🧲', name: () => 'Lodestone', eff: () => '+25% pickup reach',
    cost: () => Math.round(150 * Math.pow(2.0, S.up.lode)), cur: 'gold', max: 6, unlock: 2 },

  { g: 'THE RUNESTONE', id: 'thor', ic: '⚡', name: () => 'Blessing of Thor', eff: () => '+10% damage, forever',
    cost: () => Math.round(3 * Math.pow(1.75, S.up.thor)), cur: 'runes', max: 6, unlock: 4 },
  { g: 'THE RUNESTONE', id: 'freyja', ic: '🌾', name: () => 'Blessing of Freyja', eff: () => '+12% gold, forever',
    cost: () => Math.round(3 * Math.pow(1.75, S.up.freyja)), cur: 'runes', max: 6, unlock: 4 },
  { g: 'THE RUNESTONE', id: 'odin', ic: '👁️', name: () => 'Blessing of Odin', eff: () => 'Begin every ascent one axe tier higher',
    cost: () => Math.round(6 * Math.pow(2.4, S.up.odin)), cur: 'runes', max: 3, unlock: 6 },
];

function openCamp(title, sub) {
  $('campTitle').textContent = title;
  $('campSub').textContent = sub;
  renderShop();
  showBuildInfo();
  campEl.classList.remove('hidden');
  S.seenCamp = true;
  save();
}
function renderShop() {
  $('cGold').textContent = fmt(S.gold);
  $('cRune').textContent = fmt(S.runes);
  let html = '';
  let group = '';
  for (const u of UPGRADES) {
    if (u.g !== group) { if (group) html += '</div>'; group = u.g; html += `<div class="counter"><h3>${u.g}</h3>`; }
    const lvl = S.up[u.id];
    const locked = S.best < u.unlock;
    const maxed = lvl >= u.max;
    const cost = u.cost();
    const bal = u.cur === 'gold' ? S.gold : S.runes;
    const afford = bal >= cost && !maxed && !locked;
    const pip = u.cur === 'gold' ? 'g' : 'r';
    let btn;
    if (locked) btn = `<span class="lockmsg">ASCENT ${u.unlock}</span>`;
    else if (maxed) btn = `<button class="buy max" disabled>MAX</button>`;
    else btn = `<button class="buy ${afford ? '' : 'no'}" data-buy="${u.id}"><i class="pip ${pip}" style="display:inline-block;vertical-align:-2px;margin-right:4px"></i>${fmt(cost)}</button>`;
    html += `<div class="up ${locked ? 'locked' : ''}">
      <div class="upic">${u.ic}</div>
      <div class="upinfo"><div class="upname out">${locked ? '???' : u.name()}</div>
      <div class="upeff">${locked ? 'Sealed until you reach Ascent ' + u.unlock : u.eff() + '   ·  Lv ' + lvl + '/' + u.max}</div></div>
      ${btn}</div>`;
  }
  html += '</div>';
  shopEl.innerHTML = html;
  shopEl.querySelectorAll('[data-buy]').forEach((b) => {
    b.addEventListener('click', () => buy(b.getAttribute('data-buy')));
  });
}
function buy(id) {
  const u = UPGRADES.find((x) => x.id === id);
  if (!u) return;
  const lvl = S.up[id];
  if (lvl >= u.max || S.best < u.unlock) return;
  const cost = u.cost();
  if (u.cur === 'gold') { if (S.gold < cost) { sfx.hurt(); return; } S.gold -= cost; }
  else { if (S.runes < cost) { sfx.hurt(); return; } S.runes -= cost; }
  S.up[id]++;
  sfx.forge();
  save();
  renderShop();
  lastHud = {};
  syncHUD();
}
$('btnGo').addEventListener('click', () => {
  sfx.init();
  campEl.classList.add('hidden');
  startAscent();
});

// ── version, patch notes and build stamp ─────────────────────────────────────
// Rendered once: a changelog does not change while the game is running, and
// rebuilding it every time the camp opens is pure churn.
let notesBuilt = false;
function showBuildInfo() {
  $('verNum').textContent = 'v' + VERSION;
  const sha = typeof __BUILD_SHA__ === 'string' ? __BUILD_SHA__ : 'dev';
  let when = 'unbuilt';
  if (typeof __BUILD_TIME__ === 'string') {
    const d = new Date(__BUILD_TIME__);
    when = isNaN(d.getTime()) ? __BUILD_TIME__
      : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  }
  $('build').textContent = 'build ' + sha + '  ·  ' + when;
  if (notesBuilt) return;
  notesBuilt = true;
  $('notes').innerHTML = CHANGELOG.map((r) =>
    '<div class="rel"><div class="relhead"><span class="v">v' + r.version + '</span>  ' +
    r.title + '  <span class="d">' + r.date + '</span></div><ul>' +
    r.notes.map((n) => '<li>' + n + '</li>').join('') + '</ul></div>'
  ).join('');
  $('btnNotes').onclick = () => {
    const hidden = $('notes').classList.toggle('hidden');
    $('btnNotes').textContent = hidden ? "WHAT'S NEW" : 'HIDE';
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// RUN END
// ─────────────────────────────────────────────────────────────────────────────
function finishAscent(won) {
  run.active = false; run.over = true;
  const keep = won ? 1 : T.deathKeep;
  const earned = Math.floor(run.gold * keep + run.iron * 2 * keep);
  S.gold += earned;
  S.runes += Math.floor(run.runes * keep);
  if (won) {
    S.ascent++;
    S.best = Math.max(S.best, S.ascent);
    sfx.boom();
    flash(0.75);
  }
  save();
  setTimeout(() => {
    openCamp(won ? 'MOUNTAIN CAMP' : 'CARRIED HOME',
      won ? `ASCENT ${S.ascent - 1} CLEARED  ·  +${fmt(earned)} GOLD`
          : `THE CREW FELL  ·  KEPT ${Math.round(keep * 100)}%  ·  +${fmt(earned)} GOLD`);
  }, won ? 900 : 700);
}

function flash(a) {
  flashEl.style.transition = 'none';
  flashEl.style.opacity = String(a);
  // setTimeout, not rAF: a backgrounded tab would leave the white overlay stuck on
  setTimeout(() => { flashEl.style.transition = 'opacity .45s'; flashEl.style.opacity = '0'; }, 20);
}

// ─────────────────────────────────────────────────────────────────────────────
// INPUT — one thumb, drag anywhere
// ─────────────────────────────────────────────────────────────────────────────
let dragId = null, dragX = 0, dragStartX = 0;
function ptDown(e) {
  sfx.init();
  const t = e.changedTouches ? e.changedTouches[0] : e;
  dragId = t.identifier !== undefined ? t.identifier : 'mouse';
  dragX = t.clientX; dragStartX = run.targetX;
  if (hintTimer > 0) { hintTimer = 0.01; }
}
function ptMove(e) {
  if (dragId === null) return;
  const list = e.changedTouches ? e.changedTouches : [e];
  for (const t of list) {
    const id = t.identifier !== undefined ? t.identifier : 'mouse';
    if (id !== dragId) continue;
    const dx = (t.clientX - dragX) / window.innerWidth;
    run.targetX = clamp(dragStartX + dx * 9.5, -T.laneClamp, T.laneClamp);
  }
  e.preventDefault();
}
function ptUp() { dragId = null; }
const opts = { passive: false };
window.addEventListener('touchstart', ptDown, opts);
window.addEventListener('touchmove', ptMove, opts);
window.addEventListener('touchend', ptUp);
window.addEventListener('touchcancel', ptUp);
window.addEventListener('mousedown', ptDown);
window.addEventListener('mousemove', ptMove);
window.addEventListener('mouseup', ptUp);

window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  frameCamera();
});
function frameCamera() {
  // solve fov so the road always fits the portrait frame with margin
  const depth = 13.2;
  const wantHalf = T.roadW / 2 + 0.35;
  const tan = wantHalf / (camera.aspect * depth);
  camera.fov = clamp(2 * Math.atan(tan) * 180 / Math.PI, 42, 76);
  camera.updateProjectionMatrix();
}
frameCamera();
document.addEventListener('visibilitychange', () => { if (document.hidden) save(); });

// ─────────────────────────────────────────────────────────────────────────────
// SIMULATION
// ─────────────────────────────────────────────────────────────────────────────
function step(dt) {
  run.time += dt;

  // forward + steering. The boss fight is a standing arena, so stop advancing.
  const held = run.bossPhase && boss && !boss.dead && (boss.z - run.z) < 13.5;
  if (!held) run.z += runSpeed() * dt;
  run.x += (run.targetX - run.x) * smooth(T.steerSpeed, dt);

  // spawn chunks ahead
  const aheadChunk = Math.floor((run.z + 90) / T.chunk);
  while (run.chunkSpawned < aheadChunk) { run.chunkSpawned++; spawnChunk(run.chunkSpawned); }

  updateCrew(dt);
  updateCombat(dt);
  updateEnemies(dt);
  updatePickups(dt);
  updateGates(dt);
  updateLoot(dt);
  updateSparks(dt);
}

// crew formation
function crewTarget(i, out) {
  if (i === 0) { out.x = 0; out.z = 0.85; return; }   // the captain leads
  const per = 6;
  const k = i - 1;
  const row = Math.floor(k / per);
  const col = (k % per) - (per - 1) / 2;
  out.x = col * T.crewSpacing + (row % 2 ? T.crewSpacing / 2 : 0);
  out.z = -row * 0.72;
}
const tmpT = { x: 0, z: 0 };
function updateCrew(dt) {
  const n = Math.min(run.crew, T.visCrew);
  for (let i = 0; i < n; i++) {
    const u = crewUnits[i];
    crewTarget(i, tmpT);
    const k = smooth(7.5, dt);
    u.x += (tmpT.x - u.x) * k;
    u.z += (tmpT.z - u.z) * k;
  }
}

function nearestEnemy(fromZ) {
  let best = null, bd = 1e9;
  for (const e of enemies) {
    if (e.dead) continue;
    const d = e.z - fromZ;
    if (d < -1.5 || d > T.atkRange) continue;
    if (d < bd) { bd = d; best = e; }
  }
  return best;
}

let axeCursor = 0;
function updateCombat(dt) {
  run.atkTimer -= dt;
  if (run.atkTimer > 0) return;
  run.atkTimer = T.atkInterval;
  const target = nearestEnemy(run.z);
  if (!target) return;
  const volley = Math.min(run.crew, 5);
  const dmgEach = (run.crew * dmgPerHit()) / volley;
  const n = Math.min(run.crew, T.visCrew);
  for (let i = 0; i < volley; i++) {
    const u = crewUnits[Math.floor(Math.random() * n)];
    const a = axes[axeCursor];
    axeCursor = (axeCursor + 1) % axes.length;
    a.live = true;
    a.x = run.x + u.x; a.y = 1.1; a.z = run.z + u.z;
    a.target = target;
    a.t = 0; a.dur = 0.16 + Math.random() * 0.05;
    a.dmg = dmgEach;
    a.rot = 0;
    a.col.setHex(TIERS[weaponTier()].c);
  }
  sfx.throwAxe();
}

function damage(e, d) {
  if (e.dead) return;
  e.hp -= d;
  e.hurt = 0.12;
  if (e.hp <= 0) {
    e.dead = true;
    const y = e.boss ? 3 : 1;
    burst(e.x, y, e.z, e.boss ? 90 : (e.brute ? 18 : 10), 0, e.gold * goldMul());
    if (e.brute || e.boss) burst(e.x, y, e.z, e.boss ? 26 : 6, 1, (e.boss ? 5 : 1.5) * T.crateIron * run.scale);
    sparkle(e.x, y, e.z, e.boss ? 40 : 12, 0xffd070);
    sfx.kill();
    if (e.boss) {
      shake(1.1); hitStop(140); sfx.boom();
      pop('JOTUNN SLAIN', '#ffd24a', e.x, 4, e.z);
      finishAscent(true);
    } else {
      shake(e.brute ? 0.3 : 0.14);
      hitStop(e.brute ? 60 : 28);
    }
  } else {
    sfx.hit();
  }
}

function loseCrew(k, atX, atZ) {
  if (k <= 0 || run.over) return;
  run.crew = Math.max(0, run.crew - k);
  pop('−' + k, '#ff6b78', atX, 2, atZ);
  sparkle(atX, 1.2, atZ, 14, 0xff4d5e);
  shake(0.5); hitStop(70);
  sfx.hurt();
  vigEl.style.opacity = '0.9';
  setTimeout(() => { vigEl.style.opacity = '0'; }, 190);
  if (run.crew <= 0) finishAscent(false);
}

function updateEnemies(dt) {
  for (let i = enemies.length - 1; i >= 0; i--) {
    const e = enemies[i];
    if (e.hurt > 0) e.hurt -= dt;
    if (e.dead) { enemies.splice(i, 1); if (e === boss) boss = null; continue; }
    e.phase += dt * 6;
    if (e.boss) {
      // asleep until you are nearly on top of it
      if (!e.armed) {
        if (e.z - run.z < 30) armBoss(); else continue;
      }
      e.x += (run.x - e.x) * smooth(0.9, dt);
      if (e.z - run.z > 10.5) e.z -= 2.4 * dt;
      e.slam -= dt;
      if (e.slam <= 0) {
        e.slam = 3.4;
        shake(0.8); hitStop(90);
        sfx.boom();
        if (e.z - run.z < 15) loseCrew(e.power, run.x, run.z + 1.5);
      }
    } else {
      const gap = e.z - run.z;
      if (gap < 34) e.z -= (e.brute ? 4.0 : 6.0) * dt;
      e.x += clamp(run.x - e.x, -1, 1) * (gap < 34 ? 2.2 : 0.6) * dt;
      if (e.z < run.z + 0.7) {
        e.dead = true;
        loseCrew(e.power, e.x, e.z);
        continue;
      }
    }
    if (e.z < run.z - 30) { e.dead = true; }
  }
}

function updatePickups(dt) {
  const magnet = magnetR();
  for (let i = crates.length - 1; i >= 0; i--) {
    const c = crates[i];
    c.spin += dt * 1.6; c.bob += dt * 3;
    const dz = c.z - run.z, dx = c.x - run.x;
    if (dz < 0.9 && dz > -2.5 && Math.abs(dx) < 1.6) {
      burst(c.x, 0.9, c.z, 14, 1, T.crateIron * run.scale);
      burst(c.x, 0.9, c.z, 8, 0, 10 * run.scale * goldMul());
      sparkle(c.x, 0.9, c.z, 10, 0xd0e8ff);
      sfx.smash(); shake(0.13);
      crates.splice(i, 1);
      continue;
    }
    if (dz < -6) crates.splice(i, 1);
  }
  for (let i = shrines.length - 1; i >= 0; i--) {
    const s = shrines[i];
    s.spin += dt * 1.4;
    const dz = s.z - run.z;
    if (dz < 0.9 && Math.abs(s.x - run.x) < 1.8) {
      burst(s.x, 1.2, s.z, 5, 2, T.shrineRune);
      sparkle(s.x, 1.2, s.z, 18, 0xc17bff);
      sfx.gate(true); shake(0.2);
      shrines.splice(i, 1);
      continue;
    }
    if (dz < -6) shrines.splice(i, 1);
  }
}

function updateGates(dt) {
  for (let i = gates.length - 1; i >= 0; i--) {
    const g = gates[i];
    if (!g.taken && g.z < run.z + 0.4) {
      g.taken = true;
      const pick = run.x < 0 ? g.left : g.right;
      applyGate(pick, g.z);
    }
    if (g.z < run.z - 8) gates.splice(i, 1);
  }
}
function applyGate(op, z) {
  const before = run.crew;
  let n = run.crew;
  if (op.op === 'add') n += op.v;
  else if (op.op === 'mul') n *= op.v;
  else if (op.op === 'sub') n -= op.v;
  else if (op.op === 'div') n = Math.ceil(n / op.v);
  n = Math.round(n);
  const cap = maxCrew();
  if (n > cap) {
    const over = n - cap;
    n = cap;
    const bonus = over * 30 * run.scale * goldMul();
    run.gold += bonus;
    pop('CREW FULL +' + fmt(bonus), '#ffd24a', run.x, 3.1, z);
  }
  n = Math.max(1, n);   // a gate costs, it never wipes the run
  run.crew = n;
  const diff = n - before;
  if (diff > 0) {
    pop(op.text + '  CREW', '#8bff9c', run.x, 2.6, z);
    sparkle(run.x, 1.4, z, 16, 0x7dff9b);
    sfx.gate(true);
    flash(0.14);
  } else if (diff < 0) {
    pop(op.text + '  CREW', '#ff6b78', run.x, 2.6, z);
    sparkle(run.x, 1.4, z, 14, 0xff4d5e);
    sfx.gate(false);
    shake(0.35);
  }
  if (run.crew <= 0) finishAscent(false);
  syncHUD();
}

function updateLoot(dt) {
  const mag = magnetR();
  const mag2 = mag * mag;
  for (const p of loot) {
    if (!p.live) continue;
    p.t += dt;
    p.rot += p.spin * dt;
    if (p.t < 0.26) {
      p.vy -= 26 * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      if (p.y < 0.2) { p.y = 0.2; p.vy *= -0.35; p.vx *= 0.6; p.vz *= 0.6; }
    } else {
      const dx = run.x - p.x, dy = 1.0 - p.y, dz = run.z - p.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < mag2 || p.t > 0.6) {
        const d = Math.max(0.25, Math.sqrt(d2));
        const sp = 9 + p.t * 30;
        p.x += dx / d * sp * dt; p.y += dy / d * sp * dt; p.z += dz / d * sp * dt;
        if (d < 0.75) { collect(p); continue; }
      } else {
        p.vy -= 26 * dt;
        p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
        if (p.y < 0.2) { p.y = 0.2; p.vy *= -0.35; p.vx *= 0.6; p.vz *= 0.6; }
      }
    }
    if (p.z < run.z - 14 || p.t > 6) p.live = false;
  }
}
function collect(p) {
  p.live = false;
  if (p.kind === 0) { run.gold += p.val; }
  else if (p.kind === 1) { run.iron += p.val; feedForge(); }
  else {
    const before = Math.floor(run.runes);
    run.runes += p.val;
    if (Math.floor(run.runes) > before) pop('+1 RUNE', '#d2a4ff', run.x, 2.4, run.z + 1);
  }
  sfx.ping();
}
function feedForge() {
  let need = forgeNeed();
  while (run.iron >= need && weaponTier() < TIERS.length - 1) {
    run.iron -= need;
    run.forgeTier++;
    const t = weaponTier();
    toast(TIERS[t].n + ' FORGED', 1.3);
    pop(TIERS[t].n, '#9be6ff', run.x, 3.0, run.z + 2);
    sparkle(run.x, 1.6, run.z + 1, 22, TIERS[t].c);
    sfx.forge();
    flash(0.22); shake(0.3); hitStop(70);
    need = forgeNeed();
  }
}

function updateSparks(dt) {
  for (const s of sparks) {
    if (!s.live) continue;
    s.t += dt;
    s.vy -= 22 * dt;
    s.x += s.vx * dt; s.y += s.vy * dt; s.z += s.vz * dt;
    if (s.t > 0.55 || s.y < 0) s.live = false;
  }
}
function updateAxes(dt) {
  for (const a of axes) {
    if (!a.live) continue;
    a.t += dt;
    a.rot += dt * 34;
    const e = a.target;
    if (!e || e.dead) { a.live = false; continue; }
    const k = clamp(a.t / a.dur, 0, 1);
    a.x = lerp(a.x, e.x, smooth(26, dt));
    a.z = lerp(a.z, e.z, smooth(26, dt));
    a.y = lerp(a.y, (e.boss ? 2.6 : 1.0), smooth(20, dt));
    if (k >= 1) {
      a.live = false;
      damage(e, a.dmg);
      sparkle(e.x, e.boss ? 2.6 : 1.1, e.z, 4, 0xffe08a);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// RENDER — write every instance matrix, then flush
// ─────────────────────────────────────────────────────────────────────────────
function buildScenery() {
  const c0 = Math.floor(run.z / T.chunk) - 2;
  if (c0 === run.lastChunkWindow) return;
  run.lastChunkWindow = c0;
  scenery.length = 0;
  for (let c = c0; c < c0 + 17; c++) {
    for (let side = 0; side < 2; side++) {
      const sgn = side ? 1 : -1;
      for (let k = 0; k < 3; k++) {
        const h = hash(c * 7 + k, 31 + side * 13);
        if (h < 0.42) continue;
        const z = c * T.chunk + k * 4 + hash(c, k + side * 5) * 3.4;
        const x = sgn * (T.roadW / 2 + 1.1 + hash(c, k + 40 + side) * 7);
        const tree = hash(c, k + 60 + side) > 0.42;
        scenery.push({ x, z, tree, s: 0.65 + hash(c, k + 70 + side) * 0.8, r: hash(c, k + 80 + side) * 6.28 });
      }
    }
  }
}

function writeCrew() {
  const n = Math.min(run.crew, T.visCrew);
  const t = run.time;
  for (const k in L) L[k].reset();
  for (let i = 0; i < n; i++) {
    const u = crewUnits[i];
    const cap = i === 0;
    const sc = (cap ? 0.98 : 0.78 + ((i * 37) % 11) * 0.012);
    const ph = u.phase + t * 13;
    const bob = Math.abs(Math.sin(ph)) * 0.11;
    const px = run.x + u.x, pz = run.z + u.z;

    // root
    Q.setFromAxisAngle(V.set(0, 1, 0), Math.sin(ph * 0.5) * 0.06);
    M.compose(V2.set(px, bob, pz), Q, V.set(sc, sc, sc));

    // legs
    for (let s = 0; s < 2; s++) {
      const sw = Math.sin(ph + s * Math.PI) * 0.62;
      M2.makeTranslation(s ? 0.15 : -0.15, 0.52, 0);
      Q.setFromAxisAngle(V.set(1, 0, 0), sw);
      M3.makeRotationFromQuaternion(Q);
      M2.multiply(M3);
      M3.makeTranslation(0, -0.26, 0);
      M2.multiply(M3);
      L.leg.push(M3.multiplyMatrices(M, M2));
    }
    // torso + belt
    M2.makeTranslation(0, 0.88, 0);
    L.torso.push(M3.multiplyMatrices(M, M2), u.cloak);
    M2.makeTranslation(0, 0.60, 0);
    L.belt.push(M3.multiplyMatrices(M, M2));
    // arms (opposite phase to legs), right arm carries the axe
    let armR = null;
    for (let s = 0; s < 2; s++) {
      const sw = Math.sin(ph + (s ? 0 : Math.PI)) * 0.5 - 0.15;
      M2.makeTranslation(s ? 0.40 : -0.40, 1.08, 0);
      Q.setFromAxisAngle(V.set(1, 0, 0), sw);
      M3.makeRotationFromQuaternion(Q);
      M2.multiply(M3);
      M3.makeTranslation(0, -0.23, 0);
      M2.multiply(M3);
      M3.multiplyMatrices(M, M2);
      L.arm.push(M3, u.cloak);
      if (s) armR = MA.copy(M3);
    }
    // head, beard, helmet, horns
    M2.makeTranslation(0, 1.38, 0);
    L.head.push(M3.multiplyMatrices(M, M2));
    M2.makeTranslation(0, 1.30, 0.15);
    L.beard.push(M3.multiplyMatrices(M, M2), u.beard);
    M2.makeTranslation(0, 1.60, 0);
    L.helm.push(M3.multiplyMatrices(M, M2));
    for (let s = 0; s < 2; s++) {
      Q.setFromAxisAngle(V.set(0, 0, 1), s ? -0.5 : 0.5);
      M2.compose(V2.set(s ? 0.24 : -0.24, 1.78, 0), Q, ONE);
      L.horn.push(M3.multiplyMatrices(M, M2));
    }
    // axe in the right hand
    if (armR) {
      Q.setFromAxisAngle(V.set(0, 0, 1), 0.35);
      M2.compose(V2.set(0.03, -0.16, 0.06), Q, ONE);
      M3.multiplyMatrices(armR, M2);
      L.haft.push(M3);
      M2.makeTranslation(0, 0.46, 0);
      L.blade.push(MB.multiplyMatrices(M3, M2), CTMP.setHex(TIERS[weaponTier()].c));
    }
    // shield on the back
    Q.setFromAxisAngle(V.set(1, 0, 0), Math.PI / 2);
    M2.compose(V2.set(0, 0.92, -0.32), Q, ONE);
    L.shield.push(M3.multiplyMatrices(M, M2), u.shield);
    // blob shadow
    Q.setFromAxisAngle(V.set(1, 0, 0), -Math.PI / 2);
    M2.compose(V2.set(px, 0.075, pz), Q, V.set(sc, sc, sc));
    L.shadow.push(M2);
  }
}

function writeEnemies() {
  for (const k in E) E[k].reset();
  const t = run.time;
  for (const e of enemies) {
    if (e.dead) continue;
    const sc = e.scale;
    const ph = e.phase;
    const bob = Math.abs(Math.sin(ph)) * 0.09 * sc;
    const hurt = e.hurt > 0 ? 1 : 0;
    CTMP.setHex(e.tint);
    if (hurt) CTMP.setHex(0xffffff);
    Q.setFromAxisAngle(V.set(0, 1, 0), Math.PI);
    M.compose(V2.set(e.x, bob, e.z), Q, V.set(sc, sc, sc));

    for (let s = 0; s < 2; s++) {
      const sw = Math.sin(ph + s * Math.PI) * 0.4;
      M2.makeTranslation(s ? 0.17 : -0.17, 0.55, 0);
      Q.setFromAxisAngle(V.set(1, 0, 0), sw);
      M3.makeRotationFromQuaternion(Q);
      M2.multiply(M3);
      M3.makeTranslation(0, -0.28, 0);
      M2.multiply(M3);
      E.leg.push(M3.multiplyMatrices(M, M2));
    }
    M2.makeTranslation(0, 0.93, 0);
    E.torso.push(M3.multiplyMatrices(M, M2), CTMP);
    let armR = null;
    for (let s = 0; s < 2; s++) {
      const sw = Math.sin(ph + (s ? 0 : Math.PI)) * 0.35 - 0.2;
      M2.makeTranslation(s ? 0.50 : -0.50, 1.16, 0);
      Q.setFromAxisAngle(V.set(1, 0, 0), sw);
      M3.makeRotationFromQuaternion(Q);
      M2.multiply(M3);
      M3.makeTranslation(0, -0.25, 0);
      M2.multiply(M3);
      M3.multiplyMatrices(M, M2);
      E.arm.push(M3);
      if (s) armR = MA.copy(M3);
    }
    M2.makeTranslation(0, 1.44, 0);
    E.head.push(M3.multiplyMatrices(M, M2), hurt ? CTMP.setHex(0xffffff) : CTMP.setHex(0xdcd6c2));
    for (let s = 0; s < 2; s++) {
      Q.setFromAxisAngle(V.set(0, 0, 1), s ? -0.85 : 0.85);
      M2.compose(V2.set(s ? 0.30 : -0.30, 1.60, 0), Q, ONE);
      E.horn.push(M3.multiplyMatrices(M, M2));
    }
    if (armR) {
      Q.setFromAxisAngle(V.set(0, 0, 1), -0.4);
      M2.compose(V2.set(0, -0.2, 0.05), Q, ONE);
      M3.multiplyMatrices(armR, M2);
      E.haft.push(M3);
      M2.makeTranslation(0, 0.55, 0);
      E.club.push(MB.multiplyMatrices(M3, M2));
    }
    // shadow shares the crew layer
    Q.setFromAxisAngle(V.set(1, 0, 0), -Math.PI / 2);
    M2.compose(V2.set(e.x, 0.075, e.z), Q, V.set(sc * 1.2, sc * 1.2, sc * 1.2));
    L.shadow.push(M2);
  }
}

function writeWorld() {
  for (const k in W) W[k].reset();

  // steps on the road, the main sense of speed
  const s0 = Math.floor((run.z - 14) / 2.6);
  for (let i = 0; i < 60; i++) {
    const z = (s0 + i) * 2.6;
    M2.makeTranslation(0, 0.03, z);
    W.step.push(M2);
  }
  // scenery
  buildScenery();
  for (const s of scenery) {
    if (s.tree) {
      M2.compose(V2.set(s.x, 0.65 * s.s, s.z), Q.setFromAxisAngle(V.set(0, 1, 0), s.r), V.set(s.s, s.s, s.s));
      W.trunk.push(M2);
      M2.compose(V2.set(s.x, 2.4 * s.s, s.z), Q.setFromAxisAngle(V.set(0, 1, 0), s.r), V.set(s.s, s.s, s.s));
      W.tree.push(M2);
    } else {
      M2.compose(V2.set(s.x, 0.1, s.z), Q.setFromAxisAngle(V.set(0.3, 1, 0.2).normalize(), s.r), V.set(s.s, s.s * 0.8, s.s));
      W.rock.push(M2);
    }
  }
  // far mountains — fixed relative to the player, so they parallax
  for (let i = 0; i < 6; i++) {
    const x = (i - 2.5) * 46 + ((run.z * 0.02) % 46);
    M2.compose(V2.set(x, 4, run.z + 145 + (i % 2) * 34), Q.setFromAxisAngle(V.set(0, 1, 0), i), V.set(1, 0.8 + (i % 3) * 0.2, 1));
    W.mount.push(M2);
  }
  // crates
  for (const c of crates) {
    const y = 0.5 + Math.sin(c.bob) * 0.06;
    M2.compose(V2.set(c.x, y, c.z), Q.setFromAxisAngle(V.set(0, 1, 0), c.spin * 0.3), ONE);
    W.crate.push(M2, CTMP.setHex(0xb07a3a));
    M2.compose(V2.set(c.x, y, c.z), Q.setFromAxisAngle(V.set(0, 1, 0), c.spin * 0.3), V.set(1.04, 0.34, 1.04));
    W.band.push(M2);
    Q.setFromAxisAngle(V.set(1, 0, 0), -Math.PI / 2);
    M2.compose(V2.set(c.x, 0.075, c.z), Q, ONE);
    L.shadow.push(M2);
  }
  // shrines
  for (const s of shrines) {
    const y = 1.15 + Math.sin(run.time * 2.4 + s.z) * 0.16;
    M2.compose(V2.set(s.x, y, s.z), Q.setFromAxisAngle(V.set(0.2, 1, 0).normalize(), s.spin), ONE);
    W.shrine.push(M2, CTMP.setHex(0xa855f7));
  }
  // loot
  for (const p of loot) {
    if (!p.live) continue;
    M2.compose(V2.set(p.x, p.y, p.z), Q.setFromAxisAngle(V.set(0.4, 1, 0.2).normalize(), p.rot), ONE);
    W.loot.push(M2, p.col);
  }
  // thrown axes
  for (const a of axes) {
    if (!a.live) continue;
    M2.compose(V2.set(a.x, a.y, a.z), Q.setFromAxisAngle(V.set(0, 0, 1), a.rot), ONE);
    W.axe.push(M2, a.col);
  }
  // sparks reuse the loot layer at a small scale
  for (const s of sparks) {
    if (!s.live) continue;
    const k = 1 - s.t / 0.55;
    M2.compose(V2.set(s.x, s.y, s.z), Q.setFromAxisAngle(V.set(1, 1, 0).normalize(), s.t * 12), V.set(k * 0.8, k * 0.8, k * 0.8));
    W.loot.push(M2, s.col);
  }
  for (const k in W) W[k].flush();
}

function writeGates() {
  let gi = 0;
  for (const g of gates) {
    if (g.taken || gi >= gateHalves.length - 1) continue;
    const half = T.roadW / 4;
    gateHalves[gi].set(-half, g.z, g.left.text, g.left.good, true);
    gateHalves[gi + 1].set(half, g.z, g.right.text, g.right.good, false);
    gi += 2;
  }
  for (let i = gi; i < gateHalves.length; i++) gateHalves[i].hide();
}

function updatePops(dt) {
  for (const p of popPool) {
    if (!p.live) continue;
    p.t += dt;
    if (p.t > 1.0) { p.live = false; p.el.style.opacity = '0'; continue; }
    V.set(p.x, p.y + p.t * 1.6, p.z).project(camera);
    const sx = (V.x * 0.5 + 0.5) * window.innerWidth;
    const sy = (-V.y * 0.5 + 0.5) * window.innerHeight;
    p.el.style.transform = `translate3d(${sx.toFixed(0)}px, ${sy.toFixed(0)}px, 0) translate(-50%,-50%) scale(${(1 + (1 - p.t) * 0.5).toFixed(2)})`;
    p.el.style.opacity = String(clamp(1.6 - p.t * 1.6, 0, 1));
  }
}

function updateWorldObjects() {
  road.position.z = run.z + 400;
  kerbL.position.z = kerbR.position.z = run.z + 400;
  ground.position.z = run.z + 400;
  const pa = motes.geometry.attributes.position;
  for (let i = 0; i < MOTES; i++) {
    let z = pa.array[i * 3 + 2];
    let y = pa.array[i * 3 + 1];
    y -= 0.6 * lastDt;
    if (y < 0 || z < run.z - 20) {
      y = 12 + Math.random() * 4;
      pa.array[i * 3] = run.x + (Math.random() - 0.5) * 44;
      z = run.z + 20 + Math.random() * 70;
    }
    pa.array[i * 3 + 1] = y;
    pa.array[i * 3 + 2] = z;
  }
  pa.needsUpdate = true;
}

// ─────────────────────────────────────────────────────────────────────────────
// LOOP
// ─────────────────────────────────────────────────────────────────────────────
let last = performance.now(), lastDt = 0.016;
const camPos = new THREE.Vector3(0, 6, -9);
const camLook = new THREE.Vector3();

/* Set by the headless harness only. See `freeze` in boot(). */
let harnessFrozen = false;

function frame(now) {
  requestAnimationFrame(frame);
  let dt = (now - last) / 1000;
  last = now;
  if (dt > 0.05) dt = 0.05;
  if (!harnessFrozen) tick(dt);
}

/* `draw` exists only for the headless harness. Everything above the final line
   builds the frame - instance matrices, camera, HUD - and none of it reads
   back from the renderer, so skipping the rasterisation leaves the simulation
   bit-for-bit identical. See the note on `advance` in boot() for why. */
function tick(dt, draw = true) {
  lastDt = dt;

  if (run.hitStop > 0) {
    run.hitStop -= dt;
  } else if (run.active && !run.over) {
    step(dt);
    updateAxes(dt);
  } else {
    updateLoot(dt); updateSparks(dt); updateAxes(dt);
  }

  // camera
  const tx = run.x * 0.62;
  camPos.set(tx, 8.1, run.z - 12.4);
  camera.position.lerp(camPos, smooth(9, dt));
  if (run.shake > 0) {
    run.shake = Math.max(0, run.shake - dt * 2.6);
    const s = run.shake * run.shake * 0.55;
    camera.position.x += (Math.random() - 0.5) * s;
    camera.position.y += (Math.random() - 0.5) * s;
  }
  camLook.set(run.x * 0.4, 1.3, run.z + 8.5);
  camera.lookAt(camLook);
  sun.position.set(camera.position.x - 8, camera.position.y + 14, camera.position.z - 6);
  sun.target.position.set(run.x, 0, run.z);
  sun.target.updateMatrixWorld();

  updateWorldObjects();
  writeCrew();
  writeEnemies();
  writeWorld();                        // pushes crate shadows into L.shadow, so flush L after it
  for (const k in L) L[k].flush();
  for (const k in E) E[k].flush();
  writeGates();
  updatePops(dt);

  if (toastT > 0) { toastT -= dt; if (toastT <= 0) toastEl.style.opacity = '0'; }
  if (hintTimer > 0) { hintTimer -= dt; if (hintTimer <= 0) hintEl.style.opacity = '0'; }
  syncHUD();

  if (draw) renderer.render(scene, camera);
}

// ─────────────────────────────────────────────────────────────────────────────
// BOOT
// ─────────────────────────────────────────────────────────────────────────────
function boot() {
  const b = $('boot');
  if (b) b.classList.add('hidden');
  S.best = Math.max(S.best, S.ascent);
  startAscent();
  // rAF does not fire in a hidden tab; this seam lets a harness drive frames.
  if (location.search.indexOf('debug') >= 0) {
    window.__CR = {
      run, S, tick,

      /* Hand the clock to the harness.

         Real rAF frames run between page load and the first advance(), and how
         many of them depends on how fast this particular machine boots the
         bundle - which quietly makes every recorded number a function of the
         test runner's mood. It cost an afternoon: the golden was recorded on a
         slow build, and making the build faster then "broke" it, because the
         run had simply had less free time to accumulate before the harness
         took over.

         freeze() stops the rAF tick and restarts the ascent, so advance(n) is
         exactly n seconds from a clean start, every time, on any machine. */
      freeze: () => { harnessFrozen = true; startAscent(); },

      /* Only the last frame of a run is drawn.

         Measured: a tick costs 0.28 ms with a real GPU and ~17 ms on the
         software rasteriser a headless browser falls back to, and forty
         simulated seconds is 2,500 ticks. Drawing every one of them is the
         difference between 0.7 s and a test timeout. Nothing in
         renderer.render() feeds back into game state, so dropping the
         intermediate frames changes no number the harness reads - and drawing
         the last one keeps renderer.info.render.calls and every InstancedMesh
         count honest afterwards. */
      advance: (secs, step) => {
        const d = step || 0.016;
        const n = Math.max(1, Math.round(secs / d));
        for (let i = 0; i < n; i++) tick(d, i === n - 1);
      },
      state: () => ({ z: run.z, crew: run.crew, gold: Math.floor(run.gold), iron: Math.floor(run.iron),
        tier: weaponTier(), dps: Math.floor(squadDPS()), enemies: enemies.length, crates: crates.length,
        gates: gates.length, boss: boss ? Math.round(boss.hp) : null, over: run.over, calls: renderer.info.render.calls }),
      steer: (x) => { run.targetX = x; },
      three: THREE, scene, renderer, L, E, W, OUTLINE_MAT,
    };
  }
  if (S.seenCamp) {
    // returning player lands in the camp so they can spend first
    run.active = false;
    openCamp('MOUNTAIN CAMP', `ASCENT ${S.ascent}  ·  BEST ${S.best}`);
  }
  requestAnimationFrame(frame);
}
boot();
