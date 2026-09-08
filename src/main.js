// Wick - a candle-dipping runner.
// See NOTES.md for design decisions and CLAUDE.md for the shape of the repo.

import * as THREE from 'three';
import { VERSION, CHANGELOG } from './changelog.js';
/* Extensionless because these are TypeScript. Vite resolves `./util` to
   util.ts; it will not resolve `./util.js` from inside a .js file, since that
   rewrite only happens for TS importers. main.js is the last JS module left
   and each extraction shrinks it - when it goes, these become `.js` like the
   TS files' own imports. */
import { clamp, lerp, smooth, hash, fmt, makeRng } from './util';
import { T, WAXES, WORKSHOPS, SCENTS } from './tuning';
import * as TU from './tuning';
import * as CD from './candle';
import { appraise } from './appraise';
import { load, save as writeSave } from './save';
import { createSfx } from './sfx';
import { attach, toon, box, Layer, OUTLINE_MAT } from './gfx';

// ─────────────────────────────────────────────────────────────────────────────
// SAVE + DERIVED STATS
//
// The numbers themselves live in tuning.ts, the candle model in candle.ts and
// the scoring in appraise.ts - all pure and all unit-tested. What is left here
// is the binding: one live save object, and thin wrappers that hand it to
// those pure functions so the call sites below can stay short.
// ─────────────────────────────────────────────────────────────────────────────
const S = load();
const save = () => writeSave(S);

const scaleFor  = (l) => TU.scaleFor(l);
const priceMul  = () => TU.priceFor(S.level);
const startWax  = () => TU.startWax(S.up);
const wickLen   = () => TU.wickLength(S.up, S.scents);
const shaveMul  = () => TU.shaveMul(S.up, S.scents);
const meltMul   = () => TU.meltMul(S.up, S.scents);
const dripMul   = () => TU.dripMul(S.up, S.scents);
const lopMul    = () => TU.lopMul(S.up);
const magnetR   = () => TU.magnetR(S.up);
const valueMul  = () => TU.valueMul(S.up, S.scents);
const maxLayers = () => TU.maxLayers(S.up);
const snuffs    = () => TU.snuffs(S.scents);

// ─────────────────────────────────────────────────────────────────────────────
// RENDERER / SCENE
// ─────────────────────────────────────────────────────────────────────────────
const host = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
host.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x6a4560, 0.014);

const camera = new THREE.PerspectiveCamera(64, window.innerWidth / window.innerHeight, 0.5, 320);

/* Ambient is a *per-workshop* number here, not a constant, and it is low
   everywhere. That is the whole visual idea: the previous game on this stack
   was a daylight mountain and could afford 0.72, but a candle that is not the
   brightest thing on screen is not a candle. Each workshop turns the room
   further down until the Deep Dark is lit by the player and nothing else -
   which is CRAFT.md's "make the framing an upgrade, then make the darkness
   justify it", except the light source is the avatar. */
const amb = new THREE.AmbientLight(0xffffff, 0.42);
scene.add(amb);
const hemi = new THREE.HemisphereLight(0xffd9a8, 0x2a1c30, 0.35);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffe6c4, 1.15);
sun.position.set(-6, 12, -4);
scene.add(sun);
scene.add(sun.target);

/* The flame is a real light, and this is the technique the game is built
   around.

   CRAFT.md already established that fog cannot fade the far edges of a 2.5D
   plane - a camera twenty units back is roughly equidistant from all of it, so
   turning fog up just greys the whole picture. A point light is the thing that
   actually falls off across the ground, and here it is attached to the object
   the player is steering. Every consequence of that is free: the road ahead
   dims when the candle is small, a fat candle lights further, and water
   snuffing the wick does not print a message - it turns the lights off. */
const flameLight = new THREE.PointLight(0xffb861, 0, 34, 1.55);
scene.add(flameLight);

// Toon materials, outline hulls and the instanced Layer live in gfx.ts.
// attach() hands it the scene; every Layer built below adds itself to that one.
attach(scene);

// ─────────────────────────────────────────────────────────────────────────────
// LAYERS — one InstancedMesh per kind of thing, rewritten every frame.
// ─────────────────────────────────────────────────────────────────────────────
const M2 = new THREE.Matrix4(), M3 = new THREE.Matrix4();
const Q = new THREE.Quaternion(), V = new THREE.Vector3(), V2 = new THREE.Vector3();
const ONE = new THREE.Vector3(1, 1, 1);
const CTMP = new THREE.Color();

/* A unit cylinder: radius 0.5 and height 1, so an instance scaled by
   (2r, h, 2r) is exactly a ring of radius r and height h, and the geometry
   never has to be rebuilt when the candle changes shape. Sixteen sides is the
   point where the silhouette stops reading as a polygon at phone size; it was
   ten first and the outline gave it visible flats. */
const CYL = new THREE.CylinderGeometry(0.5, 0.5, 1, 16);

const RINGS = 18;   // maxLayers plus the mould upgrade, plus headroom
const C = {
  ring:  new Layer(CYL, 0xffffff, RINGS, 0.030),
  wick:  new Layer(box(0.05, 1, 0.05), 0x2a1c12, 2, 0),
};

/* Additive, unlit, and outside the toon system entirely - a flame that takes a
   shadow band across it stops being a light source and becomes a cone.

   Two cones, not one. A single additive cone summed to near-white and read as
   a pale spike stuck on the candle rather than as a flame: everything additive
   over a bright core washes out, so the only way to keep a warm edge is to
   have an edge that is not overlapping the core. An orange body with a
   white-hot heart inside it is the whole difference. */
const flameGeo = new THREE.ConeGeometry(0.5, 1, 10);
const flameMesh = new THREE.Mesh(flameGeo, new THREE.MeshBasicMaterial({
  color: 0xff8a26, transparent: true, opacity: 0.78, blending: THREE.AdditiveBlending, depthWrite: false,
}));
flameMesh.renderOrder = 4;
scene.add(flameMesh);
const flameCore = new THREE.Mesh(flameGeo, new THREE.MeshBasicMaterial({
  color: 0xfff0c8, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false,
}));
flameCore.renderOrder = 5;
scene.add(flameCore);

/* Fake bloom, per CRAFT.md: an additive quad with a soft radial texture costs
   one draw call where a post-processing pass costs a pipeline. The camera
   never rolls, so a quad in the XY plane always faces it and no billboarding
   is needed. */
function haloTexture() {
  const s = 64;
  const cv = document.createElement('canvas');
  cv.width = cv.height = s;
  const g = cv.getContext('2d');
  const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grad.addColorStop(0, 'rgba(255,214,140,1)');
  grad.addColorStop(0.35, 'rgba(255,160,60,0.42)');
  grad.addColorStop(1, 'rgba(255,120,30,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, s, s);
  const t = new THREE.CanvasTexture(cv);
  t.needsUpdate = true;
  return t;
}
const halo = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({
  map: haloTexture(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
}));
halo.renderOrder = 3;
scene.add(halo);

// ── world, hazards and pickups ───────────────────────────────────────────────
const W = {
  drip:   new Layer(new THREE.OctahedronGeometry(0.22, 0), 0xffffff, 90, 0.030),
  blade:  new Layer(new THREE.CylinderGeometry(T.bladeR, T.bladeR, 0.07, 12), 0xc9d6e0, 16, 0.045),
  post:   new Layer(box(0.16, 1.5, 0.16), 0x4a3a2a, 16, 0),
  lamp:   new Layer(new THREE.CylinderGeometry(0.34, 0.5, 0.62, 8), 0xff7a30, 12, 0.055),
  lampleg:new Layer(box(0.12, 0.9, 0.12), 0x33261c, 12, 0),
  pool:   new Layer(new THREE.CircleGeometry(0.5, 14), 0x5fc8e8, 12, 0),
  flask:  new Layer(new THREE.OctahedronGeometry(0.42, 0), 0xffffff, 4, 0.055),
  step:   new Layer(box(T.roadW, 0.09, 0.55), 0xffffff, 70, 0),
  taper:  new Layer(CYL, 0xffffff, 80, 0.055),
  tip:    new Layer(new THREE.ConeGeometry(0.2, 0.5, 6), 0xffd88a, 80, 0),
  block:  new Layer(box(0.9, 0.7, 0.9), 0xffffff, 60, 0.060),
  far:    new Layer(new THREE.CylinderGeometry(6, 7.5, 34, 6), 0xffffff, 10, 0),
  bench:  new Layer(box(4.6, 0.36, 1.5), 0x6b4a2c, 2, 0.075),
  benchleg: new Layer(box(0.3, 1.1, 0.3), 0x4a3320, 8, 0),
  shadow: new Layer(new THREE.CircleGeometry(0.5, 12), 0x000000, 60, 0),
};
W.shadow.mesh.material = new THREE.MeshBasicMaterial({ color: 0x0a0510, transparent: true, opacity: 0.34, depthWrite: false });
W.pool.mesh.material = new THREE.MeshBasicMaterial({ color: 0x5fc8e8, transparent: true, opacity: 0.55, depthWrite: false });

// road, kerbs, ground — plain meshes, one draw call each
const road = new THREE.Mesh(box(T.roadW, 1.2, 1600), toon(0x8a6a4c));
road.position.y = -0.6;
scene.add(road);
const kerbL = new THREE.Mesh(box(0.55, 1.0, 1600), toon(0x5d452e));
const kerbR = kerbL.clone();
kerbL.position.set(-T.roadW / 2 - 0.2, -0.32, 0);
kerbR.position.set(T.roadW / 2 + 0.2, -0.32, 0);
scene.add(kerbL, kerbR);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(600, 1600), toon(0x4a3426));
ground.rotation.x = -Math.PI / 2;
ground.position.y = -0.95;
scene.add(ground);

// drifting motes — soot and pollen, cosmetic, deliberately on Math.random
const MOTES = 130;
const moteGeo = new THREE.BufferGeometry();
const motePos = new Float32Array(MOTES * 3);
for (let i = 0; i < MOTES; i++) {
  motePos[i * 3] = (Math.random() - 0.5) * 40;
  motePos[i * 3 + 1] = Math.random() * 14;
  motePos[i * 3 + 2] = Math.random() * 90 - 20;
}
moteGeo.setAttribute('position', new THREE.BufferAttribute(motePos, 3));
const moteMat = new THREE.PointsMaterial({ color: 0xffdba8, size: 0.17, transparent: true, opacity: 0.7, depthWrite: false });
const motes = new THREE.Points(moteGeo, moteMat);
motes.frustumCulled = false;
scene.add(motes);

// ─────────────────────────────────────────────────────────────────────────────
// DIP ARCHES — few enough to be real meshes, with canvas-texture labels
// ─────────────────────────────────────────────────────────────────────────────
const labelCache = new Map();

/* The label is drawn big and sits ON the curtain, not above it.

   The first version was a 2.4-unit plane floating over the arch with a heavy
   dark outline, and at the distance you actually read an arch - about
   twenty-four units, which is the only distance that matters, because by the
   time it is close you have already committed - it came to roughly fifty
   pixels of mostly outline. It was legible in a debugger and invisible on a
   phone. Measure a label at the range the decision is made, not at the range
   it is convenient to screenshot. */
function labelTex(text, sub, hex) {
  const key = text + '|' + sub + '|' + hex;
  let t = labelCache.get(key);
  if (t) return t;
  const cv = document.createElement('canvas');
  cv.width = 512; cv.height = 256;
  const g = cv.getContext('2d');
  g.clearRect(0, 0, 512, 256);
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineJoin = 'round';

  g.font = '800 132px "Segoe UI",system-ui,sans-serif';
  g.lineWidth = 14; g.strokeStyle = '#150a04';
  g.strokeText(text, 256, 88);
  g.fillStyle = '#fff8e6';
  g.fillText(text, 256, 88);

  g.font = '800 62px "Segoe UI",system-ui,sans-serif';
  g.lineWidth = 10;
  g.strokeText(sub, 256, 190);
  g.fillStyle = '#' + hex.toString(16).padStart(6, '0');
  g.fillText(sub, 256, 190);

  t = new THREE.CanvasTexture(cv);
  t.needsUpdate = true;
  labelCache.set(key, t);
  return t;
}

class ArchHalf {
  constructor() {
    this.group = new THREE.Group();
    /* A curtain of wax rather than a gate: you are dipping the candle, so the
       thing you pass through should look like a surface of liquid colour.

       Opaque enough to be its own colour. At 0.34 the curtain took most of its
       brightness from whatever was behind it, so in the dark workshops - the
       ones where reading the dip matters most, because the whole screen is
       nearly black - indigo and amber both arrived as the same muddy brown. A
       gate whose colour is a function of the background is not labelled. */
    this.sheet = new THREE.Mesh(new THREE.PlaneGeometry(T.roadW / 2 - 0.06, 3.0), new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0.72, side: THREE.DoubleSide, depthWrite: false,
    }));
    this.sheet.position.y = 1.5;
    this.frame = new THREE.Mesh(box(0.16, 3.2, 0.16), toon(0x3a2a1c));
    this.frame.position.y = 1.6;
    /* DoubleSide, and this is the whole reason the label was invisible for a
       while. A PlaneGeometry faces +z, this camera sits at a *lower* z than
       everything it looks at, so the player only ever sees a label's back face
       - and FrontSide culls it. Every property worth inspecting said the label
       was fine: visible, positioned, textured, renderOrder above the curtain.
       The fault was in a default nobody set. When something renders as
       nothing, enumerate what you did *not* configure. */
    this.label = new THREE.Mesh(new THREE.PlaneGeometry(3.3, 1.65), new THREE.MeshBasicMaterial({
      transparent: true, depthWrite: false, depthTest: false,
    }));
    this.label.position.set(0, 1.85, 0.02);
    /* Turned to face the camera. A PlaneGeometry faces +z and this camera
       looks along +z, so an unrotated label shows the player its back - which
       is culled by FrontSide, and, once that was noticed and papered over with
       DoubleSide, rendered the text mirrored. Both symptoms, one cause. */
    this.label.rotation.y = Math.PI;
    this.label.renderOrder = 5;
    this.group.add(this.sheet, this.frame, this.label);
    this.group.visible = false;
    scene.add(this.group);
  }
  set(x, z, waxId, amt, leftSide) {
    const w = WAXES[waxId];
    this.group.visible = true;
    this.group.position.set(x, 0, z);
    this.sheet.material.color.setHex(w.col);
    this.frame.position.x = leftSide ? -(T.roadW / 4) + 0.08 : (T.roadW / 4) - 0.08;
    this.label.material.map = labelTex('+' + amt, w.n, w.col);
    this.label.material.needsUpdate = true;
  }
  hide() { this.group.visible = false; }
}
const archHalves = [new ArchHalf(), new ArchHalf(), new ArchHalf(), new ArchHalf()];

// ─────────────────────────────────────────────────────────────────────────────
// POOLS
// ─────────────────────────────────────────────────────────────────────────────
const sparks = [];
for (let i = 0; i < 110; i++) sparks.push({ live: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, t: 0, col: new THREE.Color() });

// entity lists, rebuilt per run
let drips = [], blades = [], lamps = [], pools = [], flasks = [], arches = [], scenery = [];

// ─────────────────────────────────────────────────────────────────────────────
// RUN STATE
// ─────────────────────────────────────────────────────────────────────────────
const run = {
  active: false, z: 0, x: 0, targetX: 0,
  candle: CD.newCandle(T.coreWax),
  wick: 0, wickMax: 1, lit: true, snuffTimer: 0,
  inHeat: 0,            // seconds of continuous heat, for the sizzle and tint
  chunkSpawned: -1, workshop: 0, scale: 1, time: 0,
  shake: 0, hitStop: 0, over: false, bench: false, benchZ: 0,
  spin: 0, lastChunkWindow: -999, dipped: 0, shaved: 0, scentsFound: 0,
};
let lastAppraisal = null;

let hintTimer = 0;

/* Every random draw that can change the outcome of a run comes from here, not
   Math.random. Purely cosmetic jitter - spark scatter, dust motes, camera
   shake, the flame flicker and the candle's idle spin - is still Math.random
   and should stay that way.

   The trap is that "cosmetic" is not obvious, and this game has a sharper
   version of it than the last one: a droplet's position decides when it comes
   within magnet reach, which decides how much wax is on the candle when it
   meets the next blade. Anything that decides *when* is simulation. */
let rnd = makeRng(1);

function startLevel() {
  rnd = makeRng(1000 + S.level);
  run.active = true; run.over = false; run.bench = false;
  run.z = 0; run.x = 0; run.targetX = 0;
  run.candle = CD.newCandle(startWax());
  run.wickMax = wickLen();
  run.wick = run.wickMax;
  run.lit = true; run.snuffTimer = 0; run.inHeat = 0;
  run.chunkSpawned = -1; run.time = 0; run.spin = 0;
  run.dipped = 0; run.shaved = 0; run.scentsFound = 0;
  run.scale = scaleFor(S.level);
  run.workshop = (S.level - 1) % WORKSHOPS.length;
  run.lastChunkWindow = -999;
  run.benchZ = T.levelChunks * T.chunk + 10;
  drips.length = 0; blades.length = 0; lamps.length = 0;
  pools.length = 0; flasks.length = 0; arches.length = 0;
  for (const s of sparks) s.live = false;
  applyWorkshop(WORKSHOPS[run.workshop]);
  hintTimer = S.seenShop ? 0 : 4.5;
  hintEl.style.opacity = hintTimer > 0 ? '0.95' : '0';
  shopScreenEl.classList.add('hidden');
  progLabel.textContent = 'TO THE BENCH';
  toast(WORKSHOPS[run.workshop].name, 1.4);
  lastHud = {};
  syncHUD();
}

function applyWorkshop(p) {
  host.style.background = `linear-gradient(180deg, ${p.sky[0]} 0%, ${p.sky[1]} 58%, ${p.sky[1]} 100%)`;
  scene.fog.color.setHex(p.fog);
  amb.intensity = TU.ambientFor(S.level);
  /* The directional falls with the ambient, or a dark workshop still has a
     bright key light raking across it and reads as night-for-day. */
  sun.intensity = 0.38 + amb.intensity * 1.25;
  hemi.intensity = 0.14 + amb.intensity * 0.42;
  road.material = toon(p.road);
  kerbL.material = toon(p.kerb); kerbR.material = toon(p.kerb);
  ground.material = toon(p.ground);
  W.taper.mesh.material = toon(p.prop);
  W.block.mesh.material = toon(p.prop2);
  W.far.mesh.material = toon(p.far);
  W.step.mesh.material = toon(p.kerb);
  moteMat.color.setHex(p.dust);
  document.querySelector('meta[name=theme-color]').setAttribute('content', p.sky[1]);
}

// ─────────────────────────────────────────────────────────────────────────────
// SPAWNING — seeded per chunk, so a level layout is reproducible
// ─────────────────────────────────────────────────────────────────────────────

/* Which two waxes an arch offers, and how much of each.

   Always two *upside* options, never a good side and a bad side, because which
   one is better genuinely depends on the candle you are currently wearing: a
   big dip of the colour you already have outside just fattens a ring, while a
   small dip of something that contrasts with it earns a multiplier. CRAFT.md's
   "two upside gates beat a good gate and a bad gate" - the punishing version
   lives in the traps, where it belongs. */
function spawnArch(z, c) {
  const pal = WORKSHOPS[run.workshop].waxes;
  const i = Math.floor(hash(c, 210 + S.level) * pal.length) % pal.length;
  let j = Math.floor(hash(c, 340 + S.level) * (pal.length - 1)) % (pal.length - 1);
  if (j >= i) j++;                                    // never the same wax twice
  let a = { wax: pal[i], amt: Math.round(T.vatWaxBig) };
  let b = { wax: pal[j], amt: Math.round(T.vatWaxBase) };
  /* The bigger side is not always the same side, and it is not always the
     cheaper wax either. Both were bugs in the previous game caused by a hash
     that could never exceed a half. */
  if (hash(c, 455 + S.level) > 0.5) { const t = a; a = b; b = t; }
  arches.push({ z, taken: false, left: a, right: b });
}

function spawnChunk(c) {
  const z = c * T.chunk;
  if (c > T.levelChunks || c < 2) return;

  /* Arches on a fixed cadence: they are the decision beat of the run and a
     player has to be able to feel them coming. */
  if (c % 6 === 4) { spawnArch(z + 6, c); return; }

  const r1 = hash(c, 91 + S.level);
  const r2 = hash(c, 402 + S.level);
  const r3 = hash(c, 777 + S.level);
  const r4 = hash(c, 913 + S.level);

  /* The droplet line is decided before the blades are placed, so a blade can
     be planted on it. That is the only place in the level where the wax and
     the danger are in the same spot, and it is what turns steering from
     "avoid things" into a decision worth making. */
  const hasDrips = r4 < T.dripChance;
  const dripCx = TU.laneX(hash(c, 905));
  const guarded = hasDrips && hash(c, 907 + S.level) < T.guardedDrips;

  /* Hazard density climbs with the chunk and with the workshop, and the three
     hazards are drawn independently so a chunk can hold more than one. */
  const dens = clamp(0.55 + c * 0.014, 0, 1.35) * clamp(0.8 + S.level * 0.08, 0, 1.6);

  if (c >= 3 && r1 < T.bladeChance * dens) {
    const n = 1 + Math.floor(hash(c, 120) * 2.4);
    for (let i = 0; i < n; i++) {
      blades.push({
        x: (i === 0 && guarded) ? dripCx : TU.laneX(hash(c, 300 + i)),
        z: z + 2 + i * 3.4 + hash(c, 500 + i) * 2,
        spin: hash(c, 610 + i) * 6.28, hit: false,
      });
    }
  }
  if (c >= 5 && r2 < T.lampChance * dens) {
    lamps.push({
      x: TU.laneX(hash(c, 700)),
      z: z + 5 + hash(c, 705) * 3, r: 1.45,
    });
  }
  if (c >= 7 && r3 < T.waterChance * dens) {
    pools.push({
      x: TU.laneX(hash(c, 800)),
      z: z + 4 + hash(c, 805) * 4, r: 1.25, used: false,
    });
  }

  /* Droplets, the steady income. Placed in a short arc across the road so
     collecting a line of them is a steering line rather than a single point. */
  if (hasDrips) {
    const n = 2 + Math.floor(hash(c, 900) * 3);
    const cx = dripCx;
    const sweep = (hash(c, 910) - 0.5) * 2.4;
    for (let i = 0; i < n; i++) {
      const t = n > 1 ? i / (n - 1) : 0.5;
      drips.push({
        x: clamp(cx + sweep * (t - 0.5) * 2, -T.laneClamp, T.laneClamp),
        z: z + 2 + t * 7.5,
        bob: hash(c, 920 + i) * 6.28, taken: false,
      });
    }
  }

  /* A scent flask, and it is always placed inside a hazard.

     "Gate an upgrade behind a place, not a price" - the strongest version of
     that rule is when reaching the thing costs you the thing it protects you
     from. Every flask sits on top of a blade or in a heat lamp, so the only
     way to a permanent perk is through the hazard it answers. It is also the
     only reward in the game that can be missed forever, which is what makes it
     worth looking for rather than something you will pick up eventually. */
  if (c >= 6 && hash(c, 5000 + S.level) < T.scentChance) {
    const missing = [];
    for (let i = 0; i < SCENTS.length; i++) if (S.scents.indexOf(i) < 0) missing.push(i);
    if (missing.length) {
      const id = missing[Math.floor(hash(c, 5100 + S.level) * missing.length) % missing.length];
      const host = blades.length ? blades[blades.length - 1] : (lamps.length ? lamps[lamps.length - 1] : null);
      flasks.push({
        x: host ? host.x : TU.laneX(hash(c, 5200)),
        z: host ? host.z : z + 6,
        id, spin: 0, taken: false,
      });
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// FX
// ─────────────────────────────────────────────────────────────────────────────
let sparkCursor = 0;
function sparkle(x, y, z, n, hex) {
  for (let i = 0; i < n; i++) {
    const s = sparks[sparkCursor];
    sparkCursor = (sparkCursor + 1) % sparks.length;
    s.live = true; s.x = x; s.y = y; s.z = z;
    s.vx = (Math.random() - 0.5) * 6; s.vy = 1 + Math.random() * 5.5; s.vz = (Math.random() - 0.5) * 6;
    s.t = 0; s.col.setHex(hex);
  }
}
function shake(v) { run.shake = Math.min(1.2, run.shake + v); }
function hitStop(ms) { run.hitStop = Math.max(run.hitStop, ms / 1000); }

// ─────────────────────────────────────────────────────────────────────────────
// AUDIO — see sfx.ts. Built on the first gesture; the theme drops an octave
// while the wick is out, which is why it reads the run rather than being told.
// ─────────────────────────────────────────────────────────────────────────────
const sfx = createSfx({ isDark: () => !run.lit });

// ─────────────────────────────────────────────────────────────────────────────
// HUD
// ─────────────────────────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
const hudCoins = $('coins'), hudWax = $('waxN'), hudGrade = $('gradeN');
const stackEl = $('stack');
const progFill = $('prog').firstElementChild, progLabel = $('prog').lastElementChild;
const wickFill = $('wick').firstElementChild, wickLabel = $('wick').lastElementChild;
const levelEl = $('level'), toastEl = $('toast'), hintEl = $('hint');
const shopScreenEl = $('shopScreen'), shopEl = $('shop'), flashEl = $('flash'), vigEl = $('vig');
const darkEl = $('dark');

let toastT = 0;
function toast(msg, dur) { toastEl.textContent = msg; toastEl.style.opacity = '1'; toastT = dur || 1.1; }

let lastHud = {};
function syncHUD() {
  const wax = Math.round(CD.totalWax(run.candle));
  if (lastHud.w !== wax) { hudWax.textContent = wax; lastHud.w = wax; }
  if (lastHud.c !== S.coins) { hudCoins.textContent = fmt(S.coins); lastHud.c = S.coins; }
  if (lastHud.l !== S.level) { levelEl.innerHTML = S.level + '<small>WORKSHOP</small>'; lastHud.l = S.level; }

  /* The running grade. A results screen at the end is a verdict; a grade that
     moves while you play is a thing you can steer by, and it is the only way
     the contrast bonus is legible before the run is over. */
  const g = appraise(run.candle, { delivered: true, valueMul: valueMul(), priceMul: priceMul() });
  if (lastHud.g !== g.grade) { hudGrade.textContent = g.grade; lastHud.g = g.grade; }

  /* The layer stack, mirrored as chips. This is the HUD saying exactly what
     the candle says, which is the point: the player should be able to read
     either one and never need the other. */
  const sig = run.candle.map((l) => l.wax + ':' + Math.round(l.amt)).join(',');
  if (lastHud.s !== sig) {
    let html = '';
    for (let i = run.candle.length - 1; i >= 0; i--) {
      const l = run.candle[i];
      const h = clamp(4 + l.amt * 0.9, 5, 22);
      html += `<i style="background:#${WAXES[l.wax].col.toString(16).padStart(6, '0')};height:${h.toFixed(0)}px"></i>`;
    }
    stackEl.innerHTML = html;
    lastHud.s = sig;
  }

  const wpct = Math.round(clamp(run.wick / run.wickMax, 0, 1) * 100);
  if (lastHud.k !== wpct) {
    wickFill.style.width = wpct + '%';
    wickLabel.textContent = 'WICK ' + Math.ceil(run.wick) + 's';
    /* Colour, not just length: a bar that is only shrinking is something you
       notice after it matters. */
    wickFill.style.background = wpct < 20 ? 'linear-gradient(#ff8a8a,#c01f30)'
      : wpct < 45 ? 'linear-gradient(#ffd36a,#e08a10)' : 'linear-gradient(#ffe6a8,#e0a040)';
    lastHud.k = wpct;
  }
  progFill.style.width = clamp(run.z / run.benchZ, 0, 1) * 100 + '%';
}

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
// THE WORKSHOP (the shop is a place, not a list)
// ─────────────────────────────────────────────────────────────────────────────
const UPGRADES = [
  { g: 'THE VAT', id: 'core', ic: '🕯️', name: () => 'Thicker Core',
    eff: () => 'Start every candle with ' + (startWax() + 3) + ' wax',
    cost: () => Math.round(70 * Math.pow(2.05, S.up.core)), max: 8, unlock: 1 },
  { g: 'THE VAT', id: 'mould', ic: '🧊', name: () => 'Deeper Mould',
    eff: () => 'Hold ' + (maxLayers() + 1) + ' layers before they merge',
    cost: () => Math.round(260 * Math.pow(2.6, S.up.mould)), max: 5, unlock: 2 },

  /* Every effect line names what the NEXT level buys, not what the current one
     already did. "now -0%" on an unbought upgrade is a shop telling the player
     about nothing. */
  { g: 'THE BENCH', id: 'hard', ic: '🛡️', name: () => 'Hardened Wax',
    eff: () => 'Blades take −' + Math.round((1 - Math.pow(0.88, S.up.hard + 1)) * 100) +
               '%, heat −' + Math.round((1 - Math.pow(0.92, S.up.hard + 1)) * 100) + '%',
    cost: () => Math.round(95 * Math.pow(1.9, S.up.hard)), max: 10, unlock: 1 },
  { g: 'THE BENCH', id: 'hand', ic: '🤚', name: () => 'Steady Hand',
    eff: () => 'Knocks bend the candle −' + Math.round((1 - Math.pow(0.86, S.up.hand + 1)) * 100) + '%',
    cost: () => Math.round(120 * Math.pow(2.0, S.up.hand)), max: 8, unlock: 2 },
  { g: 'THE BENCH', id: 'wick', ic: '🧵', name: () => 'Longer Wick',
    eff: () => 'Burns ' + Math.round(TU.wickLength({ ...S.up, wick: S.up.wick + 1 }, S.scents)) +
               's, up from ' + Math.round(wickLen()) + 's',
    cost: () => Math.round(110 * Math.pow(1.95, S.up.wick)), max: 10, unlock: 1 },

  { g: 'THE DIPPING ROOM', id: 'scoop', ic: '🥄', name: () => 'Wider Scoop',
    eff: () => 'Reach further for droplets, and carry more per drop',
    cost: () => Math.round(130 * Math.pow(2.05, S.up.scoop)), max: 8, unlock: 2 },
  { g: 'THE DIPPING ROOM', id: 'dye', ic: '🎨', name: () => 'Fine Dyes',
    eff: () => 'Every candle appraises +' + Math.round((S.up.dye + 1) * 9) + '% higher',
    cost: () => Math.round(180 * Math.pow(2.2, S.up.dye)), max: 10, unlock: 3 },
  { g: 'THE DIPPING ROOM', id: 'bees', ic: '🍯', name: () => 'Beeswax Blend',
    eff: () => 'Every candle appraises +' + Math.round((S.up.bees + 1) * 13) + '% higher',
    cost: () => Math.round(320 * Math.pow(2.45, S.up.bees)), max: 8, unlock: 4 },
];

function openShop(title, sub) {
  $('shopTitle').textContent = title;
  $('shopSub').textContent = sub;
  renderShop();
  renderScents();
  showBuildInfo();
  shopScreenEl.classList.remove('hidden');
  S.seenShop = true;
  save();
}

function renderShop() {
  $('sCoins').textContent = fmt(S.coins);
  $('sBest').textContent = fmt(S.bestValue);
  let html = '';
  let group = '';
  for (const u of UPGRADES) {
    if (u.g !== group) { if (group) html += '</div>'; group = u.g; html += `<div class="counter"><h3>${u.g}</h3>`; }
    const lvl = S.up[u.id];
    const locked = S.best < u.unlock;
    const maxed = lvl >= u.max;
    const cost = u.cost();
    const afford = S.coins >= cost && !maxed && !locked;
    let btn;
    if (locked) btn = `<span class="lockmsg">WORKSHOP ${u.unlock}</span>`;
    else if (maxed) btn = `<button class="buy max" disabled>MAX</button>`;
    else btn = `<button class="buy ${afford ? '' : 'no'}" data-buy="${u.id}"><i class="pip g" style="display:inline-block;vertical-align:-2px;margin-right:4px"></i>${fmt(cost)}</button>`;
    html += `<div class="up ${locked ? 'locked' : ''}">
      <div class="upic">${u.ic}</div>
      <div class="upinfo"><div class="upname out">${locked ? '???' : u.name()}</div>
      <div class="upeff">${locked ? 'Sealed until Workshop ' + u.unlock : u.eff() + '   ·  Lv ' + lvl + '/' + u.max}</div></div>
      ${btn}</div>`;
  }
  html += '</div>';
  shopEl.innerHTML = html;
  shopEl.querySelectorAll('[data-buy]').forEach((b) => {
    b.addEventListener('click', () => buy(b.getAttribute('data-buy')));
  });
}

/* The shelf is a place to look at what you have, and - just as importantly -
   at the gaps. An empty slot that says where the scent is found is a reason to
   go back to a workshop you have already beaten; a hidden one is nothing at
   all, which is the same argument as showing a sealed shop row. */
function renderScents() {
  let html = '';
  for (let i = 0; i < SCENTS.length; i++) {
    const got = S.scents.indexOf(i) >= 0;
    html += `<div class="scent ${got ? '' : 'miss'}">
      <div class="sic">${got ? SCENTS[i].ic : '?'}</div>
      <div><div class="sname out">${got ? SCENTS[i].n : 'UNDISCOVERED'}</div>
      <div class="seff">${got ? SCENTS[i].eff : 'Found in the world, never sold'}</div></div></div>`;
  }
  $('scents').innerHTML = html;
  $('scentCount').textContent = S.scents.length + '/' + SCENTS.length;
}

function buy(id) {
  const u = UPGRADES.find((x) => x.id === id);
  if (!u) return;
  if (S.up[id] >= u.max || S.best < u.unlock) return;
  const cost = u.cost();
  if (S.coins < cost) { sfx.sell(false); return; }
  S.coins -= cost;
  S.up[id]++;
  sfx.relight();
  save();
  renderShop();
  lastHud = {};
  syncHUD();
}

$('btnGo').addEventListener('click', () => {
  sfx.init();
  shopScreenEl.classList.add('hidden');
  startLevel();
});

// ── version, patch notes and build stamp ─────────────────────────────────────
// Rendered once: a changelog does not change while the game is running, and
// rebuilding it every time the shop opens is pure churn.
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
// RUN END — the appraisal
// ─────────────────────────────────────────────────────────────────────────────
function finishRun(delivered) {
  if (run.over) return;
  run.active = false; run.over = true;
  const a = appraise(run.candle, { delivered, valueMul: valueMul(), priceMul: priceMul() });
  lastAppraisal = a;
  S.coins += a.value;
  S.bestValue = Math.max(S.bestValue, a.value);

  /* Reaching the bench advances the workshop; guttering out does not. That is
     the only gate on progression in the game, and it is a soft one - you keep
     the coins either way, so a failed run still buys the upgrade that fixes
     the reason it failed. */
  if (delivered) {
    S.level++;
    S.best = Math.max(S.best, S.level);
  }
  save();
  sfx.sell(delivered);
  if (delivered) flash(0.5);

  setTimeout(() => {
    renderAppraisal(a, delivered);
    openShop(delivered ? 'THE CHANDLERY' : 'GUTTERED OUT',
      delivered ? `WORKSHOP ${S.level - 1} SOLD` : 'THE WICK WENT FIRST');
  }, delivered ? 1500 : 900);
}

/* The results panel names each part and what earned it.

   CRAFT.md: a number beats a bar when the player needs to understand
   causation. Four labelled lines is the difference between "I got 840" and "I
   got 840 because I only managed two colours", and the second is the one that
   changes how the next run is played. */
function renderAppraisal(a, delivered) {
  const rows = [
    ['WAX', Math.round(a.wax) + ' units', Math.round(a.bulk) + 'c'],
    ['LAYERS', a.colours + ' colour' + (a.colours === 1 ? '' : 's'), '×' + (1 + a.layerMul).toFixed(2)],
    ['CONTRAST', a.pairs + ' pair' + (a.pairs === 1 ? '' : 's'), '×' + (1 + a.contrastMul).toFixed(2)],
    ['TRUE', Math.round(a.purity * 100) + '% straight', '×' + a.purity.toFixed(2)],
  ];
  if (!delivered) rows.push(['UNFINISHED', 'the wick guttered', '×' + a.delivered.toFixed(2)]);
  $('apGrade').textContent = a.grade;
  $('apGrade').className = 'apgrade out g' + a.grade.charAt(0);
  $('apRows').innerHTML = rows.map((r) =>
    `<div class="aprow"><span class="apk">${r[0]}</span><span class="apd">${r[1]}</span><span class="apv">${r[2]}</span></div>`
  ).join('');
  $('apTotal').textContent = fmt(a.value);
  $('appraisal').classList.remove('hidden');
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
    /* Minus, not plus, and this is the single most important sign in the game.

       The camera sits at a *lower* z than everything it looks at, because the
       candle runs toward +z and the camera has to be behind it. That is a 180
       degree rotation about Y, which mirrors the x axis: measured by
       projecting a point, world +2 lands at NDC -0.31 and world -2 at +0.31.
       World +x is screen LEFT.

       So mapping a rightward drag to increasing x - the obvious thing, and
       what the previous game on this stack shipped - inverts the controls. It
       was never caught there because that game was never played with a thumb;
       every check on it drove `steer()` in world coordinates, which is exactly
       the layer this bug hides under. `dragging right moves the candle right`
       in e2e drives real pointer events for that reason. */
    run.targetX = clamp(dragStartX - dx * 9.5, -T.laneClamp, T.laneClamp);
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
  const depth = 13.0;
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
  run.spin += dt * 0.7;

  run.z += T.baseSpeed * dt;
  /* Clamped here rather than only in the touch handler.

     It lived in ptMove alone, which made the road's width an *input* rule: the
     debug seam, and anything added later that nudges the candle - a knockback,
     an autopilot, a wind gust - would have walked straight off the road with
     nothing to stop it. An invariant about where the player can be belongs in
     the simulation that owns the position. */
  run.targetX = clamp(run.targetX, -T.laneClamp, T.laneClamp);
  run.x += (run.targetX - run.x) * smooth(T.steerSpeed, dt);

  const aheadChunk = Math.floor((run.z + 90) / T.chunk);
  while (run.chunkSpawned < aheadChunk) { run.chunkSpawned++; spawnChunk(run.chunkSpawned); }

  updateArches();
  updateDrips(dt);
  updateBlades(dt);
  updateLamps(dt);
  updatePools();
  updateFlasks(dt);
  updateWick(dt);
  updateSparks(dt);

  if (run.z >= run.benchZ) finishRun(true);
}

const candleR = () => CD.candleRadius(run.candle);

function updateWick(dt) {
  if (!run.lit) {
    run.snuffTimer -= dt;
    if (run.snuffTimer <= 0) relight(false);
    return;
  }
  run.wick -= T.wickBurn * dt;
  if (run.inHeat > 0) run.wick -= T.heatWick * dt;
  if (run.wick <= 0) { run.wick = 0; finishRun(false); }
}

function relight(fromLamp) {
  if (run.lit) return;
  run.lit = true;
  sfx.relight();
  sparkle(run.x, CD.candleHeight(run.candle) + 0.4, run.z, 18, 0xffc861);
  pop('LIT', '#ffd88a', run.x, CD.candleHeight(run.candle) + 1.1, run.z);
  if (fromLamp) flash(0.12);
}

function updateArches() {
  for (let i = arches.length - 1; i >= 0; i--) {
    const g = arches[i];
    if (!g.taken && g.z < run.z + 0.4) {
      g.taken = true;
      dip(run.x < 0 ? g.left : g.right, g.z);
    }
    if (g.z < run.z - 8) arches.splice(i, 1);
  }
}

function dip(pick, z) {
  /* A dip in the dark is a poor dip: the wax will not take evenly on a cold
     candle. Half, not nothing - a trap that voids the next arch entirely would
     make being snuffed feel like a lost run rather than a setback. */
  const amt = pick.amt * (run.lit ? 1 : 0.5);
  const before = run.candle.length;
  CD.addWax(run.candle, pick.wax, amt, maxLayers());
  run.dipped++;
  const w = WAXES[pick.wax];
  const hex = '#' + w.col.toString(16).padStart(6, '0');
  pop((run.lit ? '+' : '+') + Math.round(amt) + ' ' + w.n, hex, run.x, 2.6, z);
  sparkle(run.x, 1.2, z, 18, w.col);
  sfx.dip();
  shake(0.12);
  if (run.candle.length > before) flash(0.10);
  if (!run.lit) toast('COLD DIP · HALF TOOK', 1.0);
  syncHUD();
}

function updateDrips(dt) {
  const mag = magnetR() + candleR();
  const mag2 = mag * mag;
  for (let i = drips.length - 1; i >= 0; i--) {
    const d = drips[i];
    d.bob += dt * 3;
    const dz = d.z - run.z, dx = d.x - run.x;
    if (dz < -6) { drips.splice(i, 1); continue; }
    if (dz > 14) continue;
    const d2 = dx * dx + dz * dz;
    if (d2 < mag2) {
      /* Magneted in rather than collected on touch, so a near miss still
         rewards the steer that nearly made it. */
      const k = smooth(9, dt);
      d.x += (run.x - d.x) * k;
      d.z += (run.z - d.z) * k;
      if (d2 < 0.55) {
        drips.splice(i, 1);
        if (!run.lit) continue;      // a cold candle sheds wax rather than taking it
        /* Droplets thicken the ring you are already wearing; they never start
           a new one.

           They used to carry a colour of their own, and the first golden run
           came out with seven rings from five dips - so the road was quietly
           authoring the candle's design and the arch, which is the only real
           decision in the game, was diluted to one voice among many. Now the
           arches decide *what* the candle is and droplets decide *how much of
           it*, which is the same split as a run resource against a persistent
           one and it keeps both legible. */
        CD.addWax(run.candle, CD.outer(run.candle).wax, T.dripWax * dripMul(), maxLayers());
        sfx.drip();
        syncHUD();
      }
    }
  }
}

function updateBlades(dt) {
  for (let i = blades.length - 1; i >= 0; i--) {
    const b = blades[i];
    b.spin += dt * 7.5;
    const dz = b.z - run.z;
    if (dz < -6) { blades.splice(i, 1); continue; }
    if (b.hit || dz > 0.8 || dz < -0.8) continue;
    if (Math.abs(b.x - run.x) < T.bladeR + candleR()) {
      b.hit = true;
      const took = CD.shave(run.candle, T.bladeShave * run.scale * shaveMul(), T.bladeLop * lopMul());
      run.shaved += took;
      if (took > 0.01) {
        pop('−' + took.toFixed(0) + ' WAX', '#ff6b78', run.x, 2.2, b.z);
        sparkle(b.x, 1.0, b.z, 16, 0xffe6c4);
        sfx.scrape();
        shake(0.55); hitStop(70);
        vigEl.style.opacity = '0.85';
        setTimeout(() => { vigEl.style.opacity = '0'; }, 190);
      } else {
        /* Nothing left to take. Say so, or a blade that costs nothing looks
           like a blade that missed. */
        pop('BARE CORE', '#ffb26b', run.x, 2.2, b.z);
        sfx.scrape(); shake(0.2);
      }
      syncHUD();
    }
  }
}

function updateLamps(dt) {
  let inside = false;
  for (let i = lamps.length - 1; i >= 0; i--) {
    const l = lamps[i];
    if (l.z < run.z - 8) { lamps.splice(i, 1); continue; }
    const dz = l.z - run.z, dx = l.x - run.x;
    const rr = l.r + candleR();
    if (dz * dz + dz * 0 + dx * dx < rr * rr && Math.abs(dz) < rr) {
      inside = true;
      /* Heat relights a snuffed wick, and that is the best interaction in the
         game: the hazard you spend the run avoiding becomes the thing you need
         the moment water takes your flame. The price is paid in the same
         breath - you are melting while you stand in it. */
      if (!run.lit) relight(true);
      const lost = CD.melt(run.candle, T.heatMelt * run.scale * meltMul() * dt);
      if (lost > 0) sfx.sizzle();
    }
  }
  if (inside) {
    run.inHeat += dt;
    if (run.inHeat > 0.25 && Math.floor(run.inHeat * 4) !== Math.floor((run.inHeat - dt) * 4)) {
      sparkle(run.x, 0.6 + Math.random() * 1.2, run.z, 2, 0xff9d4a);
      syncHUD();
    }
  } else {
    run.inHeat = 0;
  }
}

function updatePools() {
  for (let i = pools.length - 1; i >= 0; i--) {
    const p = pools[i];
    if (p.z < run.z - 8) { pools.splice(i, 1); continue; }
    if (p.used) continue;
    const dz = p.z - run.z, dx = p.x - run.x;
    const rr = p.r + candleR();
    if (Math.abs(dz) < rr && Math.abs(dx) < rr) {
      p.used = true;
      if (!run.lit) continue;
      if (snuffs()) {
        run.lit = false;
        run.snuffTimer = 5.0;
        sfx.douse();
        shake(0.7); hitStop(110);
        pop('SNUFFED', '#8fd3ff', run.x, 2.4, p.z);
        toast('SNUFFED · FIND HEAT', 1.4);
      } else {
        /* Sea Salt found: the trap becomes a scare. Still worth drawing and
           still worth hearing, because a hazard that does literally nothing
           trains the player to stop looking at it. */
        sfx.douse();
        shake(0.25);
        pop('GUTTERS', '#8fd3ff', run.x, 2.4, p.z);
      }
    }
  }
}

function updateFlasks(dt) {
  for (let i = flasks.length - 1; i >= 0; i--) {
    const f = flasks[i];
    f.spin += dt * 2.2;
    if (f.z < run.z - 8) { flasks.splice(i, 1); continue; }
    const dz = f.z - run.z, dx = f.x - run.x;
    if (Math.abs(dz) < 1.0 + candleR() && Math.abs(dx) < 0.9 + candleR()) {
      flasks.splice(i, 1);
      if (S.scents.indexOf(f.id) >= 0) continue;
      S.scents.push(f.id);
      run.scentsFound++;
      save();
      sfx.scent();
      flash(0.35); shake(0.4); hitStop(120);
      pop(SCENTS[f.id].n, '#ffd88a', run.x, 3.0, f.z);
      toast(SCENTS[f.id].ic + '  ' + SCENTS[f.id].n, 2.2);
      sparkle(run.x, 1.6, run.z, 30, 0xffd88a);
    }
  }
}

function updateSparks(dt) {
  for (const s of sparks) {
    if (!s.live) continue;
    s.t += dt;
    s.vy -= 20 * dt;
    s.x += s.vx * dt; s.y += s.vy * dt; s.z += s.vz * dt;
    if (s.t > 0.6 || s.y < 0) s.live = false;
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
        if (h < 1 - T.sceneryChance) continue;
        const z = c * T.chunk + k * 4 + hash(c, k + side * 5) * 3.4;
        const x = sgn * (T.roadW / 2 + 1.2 + hash(c, k + 40 + side) * 7);
        /* The roadside is other candles - a chandler's yard of finished
           tapers - so the scenery is the same primitive as the player and
           costs nothing extra to draw. */
        const taper = hash(c, k + 60 + side) > 0.36;
        scenery.push({ x, z, taper, s: 0.6 + hash(c, k + 70 + side) * 1.5, r: hash(c, k + 80 + side) * 6.28 });
      }
    }
  }
}

/* The candle: one instance per ring, innermost first.

   Every ring alternates which way it leans, so a candle that has taken knocks
   zigzags rather than tipping uniformly - a uniform tilt reads as the camera
   being crooked, and a zigzag reads unmistakably as damage. */
function writeCandle() {
  C.ring.reset(); C.wick.reset();
  const c = run.candle;
  const r = CD.radii(c), h = CD.heights(c), l = CD.leans(c);
  const wob = Math.sin(run.time * 2.1) * 0.02;
  for (let i = 0; i < c.length; i++) {
    const dir = i % 2 ? 1 : -1;
    const px = run.x + l[i] * dir;
    Q.setFromAxisAngle(V.set(0, 1, 0), run.spin);
    M2.compose(V2.set(px, h[i] / 2, run.z), Q, V.set(r[i] * 2, h[i], r[i] * 2));
    C.ring.push(M2, CTMP.setHex(WAXES[c[i].wax].col));
  }
  // the wick, standing on the core
  const top = h[0];
  const wickH = 0.30 + 0.34 * clamp(run.wick / run.wickMax, 0, 1);
  M2.compose(V2.set(run.x + wob, top + wickH / 2, run.z), Q.identity(), V.set(1, wickH, 1));
  C.wick.push(M2);

  // ground shadow, scaled to the widest ring
  const rad = r[c.length - 1];
  Q.setFromAxisAngle(V.set(1, 0, 0), -Math.PI / 2);
  M2.compose(V2.set(run.x, 0.03, run.z), Q, V.set(rad * 2.4, rad * 2.4, 1));
  W.shadow.push(M2);

  // flame, halo and the light that makes the whole scene
  const fy = top + wickH + 0.16;
  if (run.lit) {
    const flick = 0.86 + Math.sin(run.time * 21) * 0.07 + Math.random() * 0.07;
    /* Generous, because the flame has to be the brightest and most obviously
       alive thing on screen - it is the light source, the timer and the thing
       water takes away. Sized from the first pass it was a sliver on a phone
       and read as a detail on top of the candle rather than as the point of
       it. CRAFT.md: the most valuable thing on screen must be the brightest. */
    const fs = (0.52 + rad * 0.48) * flick;
    flameMesh.visible = true;
    flameMesh.position.set(run.x + wob, fy + fs * 0.72, run.z);
    flameMesh.scale.set(fs * 1.05, fs * 1.7, fs * 1.05);
    flameCore.visible = true;
    flameCore.position.set(run.x + wob, fy + fs * 0.52, run.z);
    flameCore.scale.set(fs * 0.56, fs * 1.06, fs * 0.56);
    halo.visible = true;
    halo.position.set(run.x + wob, fy + fs * 0.6, run.z - 0.05);
    const hs = 4.8 + rad * 7.0;
    halo.scale.set(hs * flick, hs * flick, 1);
    flameLight.position.set(run.x, fy + 0.35, run.z);
    /* Intensity tracks the candle's size, so a run that has gone badly is a
       run you can also see less of. That is a real cost with no number
       attached to it, and it is the one the player feels first. */
    flameLight.intensity = (7.5 + rad * 22) * flick;
    flameLight.distance = 18 + rad * 26;
  } else {
    flameMesh.visible = false;
    flameCore.visible = false;
    halo.visible = false;
    flameLight.intensity = 0;
  }
  C.ring.flush(); C.wick.flush();
}

function writeWorld() {
  for (const k in W) if (k !== 'shadow') W[k].reset();

  // steps on the road, the main sense of speed
  const s0 = Math.floor((run.z - 14) / 2.6);
  for (let i = 0; i < 60; i++) {
    M2.makeTranslation(0, 0.03, (s0 + i) * 2.6);
    W.step.push(M2);
  }

  buildScenery();
  for (const s of scenery) {
    if (s.taper) {
      const hh = 1.2 * s.s;
      M2.compose(V2.set(s.x, hh / 2, s.z), Q.setFromAxisAngle(V.set(0, 1, 0), s.r), V.set(0.5 * s.s, hh, 0.5 * s.s));
      W.taper.push(M2);
      M2.compose(V2.set(s.x, hh + 0.2 * s.s, s.z), Q.identity(), V.set(s.s * 0.7, s.s * 0.7, s.s * 0.7));
      W.tip.push(M2);
    } else {
      M2.compose(V2.set(s.x, 0.35 * s.s, s.z), Q.setFromAxisAngle(V.set(0, 1, 0), s.r), V.set(s.s, s.s, s.s));
      W.block.push(M2);
    }
  }

  // far silhouettes — fixed relative to the player, so they parallax
  for (let i = 0; i < 6; i++) {
    const x = (i - 2.5) * 46 + ((run.z * 0.02) % 46);
    M2.compose(V2.set(x, 8, run.z + 150 + (i % 2) * 34), Q.identity(), V.set(1, 0.7 + (i % 3) * 0.35, 1));
    W.far.push(M2);
  }

  /* Droplets wear the colour of the candle's current outside, because that is
     what they will become the instant they are collected. It also turns the
     road into a running readout of what you are wearing: cross an arch and the
     trail ahead changes colour. */
  const dripCol = WAXES[CD.outer(run.candle).wax].col;
  for (const d of drips) {
    const y = 0.75 + Math.sin(d.bob) * 0.12;
    M2.compose(V2.set(d.x, y, d.z), Q.setFromAxisAngle(V.set(0.4, 1, 0.2).normalize(), d.bob * 0.5), ONE);
    W.drip.push(M2, CTMP.setHex(dripCol));
  }

  for (const b of blades) {
    if (b.hit) continue;
    M2.compose(V2.set(b.x, 0.85, b.z), Q.setFromAxisAngle(V.set(0, 0, 1), Math.PI / 2).premultiply(
      new THREE.Quaternion().setFromAxisAngle(V.set(1, 0, 0), b.spin)), ONE);
    W.blade.push(M2);
    M2.compose(V2.set(b.x, 0.75, b.z), Q.identity(), ONE);
    W.post.push(M2);
  }

  for (const l of lamps) {
    const pulse = 1 + Math.sin(run.time * 5 + l.z) * 0.06;
    M2.compose(V2.set(l.x, 1.25, l.z), Q.identity(), V.set(pulse, pulse, pulse));
    W.lamp.push(M2);
    M2.compose(V2.set(l.x, 0.45, l.z), Q.identity(), ONE);
    W.lampleg.push(M2);
  }

  for (const p of pools) {
    if (p.used) continue;
    Q.setFromAxisAngle(V.set(1, 0, 0), -Math.PI / 2);
    const s = p.r * 2 * (1 + Math.sin(run.time * 3 + p.z) * 0.03);
    M2.compose(V2.set(p.x, 0.06, p.z), Q, V.set(s, s, 1));
    W.pool.push(M2);
  }

  for (const f of flasks) {
    const y = 1.7 + Math.sin(run.time * 2.6 + f.z) * 0.18;
    M2.compose(V2.set(f.x, y, f.z), Q.setFromAxisAngle(V.set(0.2, 1, 0).normalize(), f.spin), ONE);
    W.flask.push(M2, CTMP.setHex(0xffd88a));
  }

  // the chandler's bench at the end of the road
  if (run.benchZ - run.z < 120) {
    M2.compose(V2.set(0, 1.1, run.benchZ + 1.2), Q.identity(), ONE);
    W.bench.push(M2);
    for (let i = 0; i < 4; i++) {
      M2.compose(V2.set((i % 2 ? 1 : -1) * 2.0, 0.55, run.benchZ + (i < 2 ? 0.7 : 1.7)), Q.identity(), ONE);
      W.benchleg.push(M2);
    }
  }

  // sparks reuse the droplet layer at a small scale
  for (const s of sparks) {
    if (!s.live) continue;
    const k = 1 - s.t / 0.6;
    M2.compose(V2.set(s.x, s.y, s.z), Q.setFromAxisAngle(V.set(1, 1, 0).normalize(), s.t * 12), V.set(k, k, k));
    W.drip.push(M2, s.col);
  }

  for (const k in W) W[k].flush();
}

function writeArches() {
  let gi = 0;
  for (const g of arches) {
    if (g.taken || gi >= archHalves.length - 1) continue;
    const half = T.roadW / 4;
    archHalves[gi].set(-half, g.z, g.left.wax, Math.round(g.left.amt), true);
    archHalves[gi + 1].set(half, g.z, g.right.wax, Math.round(g.right.amt), false);
    gi += 2;
  }
  for (let i = gi; i < archHalves.length; i++) archHalves[i].hide();
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

  /* Being snuffed is told by the screen going dark rather than by a caption.
     The overlay is a slow fade in and a fast fade out, because arriving in the
     dark should feel like something closing and relighting should feel
     instant. */
  darkEl.style.opacity = run.lit ? '0' : '0.55';
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
  } else {
    updateSparks(dt);
    run.spin += dt * 0.9;
  }

  /* The bench close-up. The camera pushes in on the candle rather than cutting
     to a panel, so the thing being appraised is the thing you were steering
     two seconds ago. */
  const done = run.over;
  const tx = run.x * 0.62;
  if (done) {
    camPos.set(run.x * 0.3, 2.4 + CD.candleHeight(run.candle) * 0.5, run.z - 4.6);
  } else {
    camPos.set(tx, 7.6, run.z - 11.9);
  }
  camera.position.lerp(camPos, smooth(done ? 2.6 : 9, dt));
  if (run.shake > 0) {
    run.shake = Math.max(0, run.shake - dt * 2.6);
    const s = run.shake * run.shake * 0.55;
    camera.position.x += (Math.random() - 0.5) * s;
    camera.position.y += (Math.random() - 0.5) * s;
  }
  /* The look target sits well ahead of and above the candle.

     Aimed just in front of it, the horizon rode high, the candle sat low in
     frame and the bottom third of a portrait screen was empty road. On a phone
     that third is the most valuable space there is - it is where the thumb
     lives - so the framing has to spend it on the road you are about to steer
     through, not on the road you have already left. */
  camLook.set(done ? run.x : run.x * 0.4, done ? CD.candleHeight(run.candle) * 0.55 : 2.3, done ? run.z : run.z + 10.5);
  camera.lookAt(camLook);
  sun.position.set(camera.position.x - 8, camera.position.y + 14, camera.position.z - 6);
  sun.target.position.set(run.x, 0, run.z);
  sun.target.updateMatrixWorld();

  updateWorldObjects();
  W.shadow.reset();
  writeCandle();          // pushes the candle shadow into W.shadow
  writeWorld();           // ...so W is flushed after it
  writeArches();
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
  S.best = Math.max(S.best, S.level);
  startLevel();
  // rAF does not fire in a hidden tab; this seam lets a harness drive frames.
  if (location.search.indexOf('debug') >= 0) {
    window.__CR = {
      run, S, tick,

      /* Hand the clock to the harness.

         Real rAF frames run between page load and the first advance(), and how
         many of them depends on how fast this particular machine boots the
         bundle - which quietly makes every recorded number a function of the
         test runner's mood. It cost an afternoon on the previous game: the
         golden was recorded on a slow build, and making the build faster then
         "broke" it, because the run had simply had less free time to
         accumulate before the harness took over.

         freeze() stops the rAF tick and restarts the level, so advance(n) is
         exactly n seconds from a clean start, every time, on any machine. */
      freeze: () => { harnessFrozen = true; startLevel(); },

      /* Only the last frame of a run is drawn.

         Measured on the previous game on this stack: a tick costs 0.28 ms with
         a real GPU and ~17 ms on the software rasteriser a headless browser
         falls back to, and forty simulated seconds is 2,500 ticks. Drawing
         every one of them is the difference between 0.7 s and a test timeout.
         Nothing in renderer.render() feeds back into game state, so dropping
         the intermediate frames changes no number the harness reads - and
         drawing the last one keeps renderer.info.render.calls and every
         InstancedMesh count honest afterwards. */
      advance: (secs, step, draw = true) => {
        const d = step || 0.016;
        const n = Math.max(1, Math.round(secs / d));
        for (let i = 0; i < n; i++) tick(d, draw && i === n - 1);
      },
      state: () => ({
        z: run.z, wax: +CD.totalWax(run.candle).toFixed(4), layers: run.candle.length,
        colours: CD.colourCount(run.candle), pairs: CD.contrastPairs(run.candle),
        lop: +CD.avgLop(run.candle).toFixed(4), radius: +CD.candleRadius(run.candle).toFixed(4),
        wick: +run.wick.toFixed(3), lit: run.lit,
        dipped: run.dipped, shaved: +run.shaved.toFixed(3), scents: S.scents.length,
        drips: drips.length, blades: blades.length, lamps: lamps.length,
        pools: pools.length, flasks: flasks.length, arches: arches.length,
        over: run.over, coins: S.coins, level: S.level,
        calls: renderer.info.render.calls,
      }),
      steer: (x) => { run.targetX = x; },
      /* Live entity lists, the candle itself and the tuning table. Every
         balance number in this game is meant to be found by editing T here,
         replaying a level through advance(), and reading the curve back - not
         by playing it forty times. Keep them exposed. */
      T, WAXES, SCENTS,
      candle: () => run.candle,
      appraisal: () => lastAppraisal,
      appraiseNow: (delivered = true) =>
        appraise(run.candle, { delivered, valueMul: valueMul(), priceMul: priceMul() }),
      drips: () => drips, blades: () => blades, lamps: () => lamps,
      pools: () => pools, flasks: () => flasks, arches: () => arches,
      three: THREE, scene, camera, renderer, C, W, flameLight, OUTLINE_MAT,
    };
  }
  if (S.seenShop) {
    // returning player lands in the workshop so they can spend first
    run.active = false;
    $('appraisal').classList.add('hidden');
    openShop('THE CHANDLERY', `WORKSHOP ${S.level}  ·  BEST ${S.best}`);
  }
  requestAnimationFrame(frame);
}
boot();
