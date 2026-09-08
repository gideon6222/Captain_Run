// Candle Gift - a candle factory runner.
// See NOTES.md for design decisions and CLAUDE.md for the shape of the repo.

import * as THREE from 'three';
import { VERSION, CHANGELOG } from './changelog.js';
/* Extensionless because these are TypeScript. Vite resolves `./util` to
   util.ts; it will not resolve `./util.js` from inside a .js file, since that
   rewrite only happens for TS importers. main.js is the last JS module left
   and each extraction shrinks it - when it goes, these become `.js` like the
   TS files' own imports. */
import { clamp, smooth, hash, fmt, makeRng } from './util';
import { T, WAXES, WORKSHOPS, MOULDS, WRAPS } from './tuning';
import * as TU from './tuning';
import * as CD from './candle';
import * as TR from './tray';
import * as ST from './stack';
import { appraise } from './appraise';
import { load, save as writeSave } from './save';
import { createSfx } from './sfx';
import { attach, toon, box, Layer, OUTLINE_MAT } from './gfx';

// ─────────────────────────────────────────────────────────────────────────────
// SAVE + DERIVED STATS
//
// The numbers live in tuning.ts, the recipe in candle.ts, the trailing stack in
// stack.ts and the payout in appraise.ts - all pure, all unit-tested. What is
// left here is the binding: one live save object and thin wrappers.
// ─────────────────────────────────────────────────────────────────────────────
const S = load();
const save = () => writeSave(S);

const priceMul     = () => TU.priceFor(S.level);
const startCandles = () => TU.startCandles(S.up);
const earnMul      = () => TU.earnMul(S.up);
const magnetR      = () => TU.magnetR(S.up);
const vatLayers    = () => TU.vatLayers(S.up);
const glitterPer   = () => TU.glitterPer(S.up);
const bestMould    = () => TU.bestMould(S.up);
const bestWrap     = () => TU.bestWrap(S.up);
const takeOf       = (base) => TU.obstacleTake(base, S.up);

// ─────────────────────────────────────────────────────────────────────────────
// RENDERER / SCENE
// ─────────────────────────────────────────────────────────────────────────────
const host = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
host.appendChild(renderer.domElement);

/* Bright, high-key, and no fog at all.

   The runway floats in open sky in the reference, and fog on a 2.5D plane only
   ever puts an even wash over the whole picture - a camera twelve units back is
   roughly equidistant from all of it. Depth here comes from the runway
   narrowing in perspective and from clouds drifting below it, not from haze. */
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(64, window.innerWidth / window.innerHeight, 0.5, 460);

const amb = new THREE.AmbientLight(0xffffff, 0.84);
scene.add(amb);
const hemi = new THREE.HemisphereLight(0xffffff, 0xbfa8ff, 0.55);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffffff, 1.45);
sun.position.set(-6, 14, -4);
scene.add(sun);
scene.add(sun.target);

/* The one warm light in the game, and it is off for the entire level.

   The previous build made the candle's flame the only light source and turned
   every workshop down around it. Good technique, wrong game - a factory runway
   is daylight. So the flame moved to where it actually earns its place: the
   gift table, where the finished candles light one at a time while the payout
   counts up. Saving the only dramatic lighting in the game for the one moment
   the player is looking at their work is worth more than having it on for the
   whole level. */
const giftLight = new THREE.PointLight(0xffc46b, 0, 40, 1.6);
scene.add(giftLight);

attach(scene);

// ─────────────────────────────────────────────────────────────────────────────
// LAYERS — one InstancedMesh per kind of thing, rewritten every frame.
// ─────────────────────────────────────────────────────────────────────────────
const M2 = new THREE.Matrix4();
const Q = new THREE.Quaternion(), QT = new THREE.Quaternion(), QT2 = new THREE.Quaternion();
const V = new THREE.Vector3(), V2 = new THREE.Vector3();
const ONE = new THREE.Vector3(1, 1, 1);
const CTMP = new THREE.Color();
const WHITE = new THREE.Color(0xffffff);
const SCENTC = new THREE.Color(0xd8b4ff);

/* One geometry per mould, built once at boot.

   A mould is a real shape - `sides`, `twist` and `bulge` come straight out of
   the tuning table and are baked into vertices here - so the press the player
   unlocked is visible from across the runway rather than being a number on a
   results screen. Built up front because swapping an InstancedMesh's geometry
   mid-run rebuilds its attribute buffers, and doing that on the frame you
   drive through a press is a visible hitch at exactly the wrong moment. */
function mouldGeometry(m) {
  const g = new THREE.CylinderGeometry(0.5, 0.5, 1, m.sides, 1);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const r = Math.hypot(x, z);
    if (r < 1e-5) continue;
    const a = Math.atan2(z, x) + y * m.twist;          // twist along the height
    const lobes = 1 + m.bulge * Math.cos(a * m.sides); // flutes and star points
    pos.setX(i, Math.cos(a) * r * lobes);
    pos.setZ(i, Math.sin(a) * r * lobes);
  }
  pos.needsUpdate = true;
  g.computeVertexNormals();
  return g;
}
const MOULD_GEO = MOULDS.map(mouldGeometry);

/* One band layer per mould shape. Only the one matching the current press is
   ever non-empty, so this costs one draw call and switching press mid-run is
   free. */
const BANDS = T.maxCandles * T.maxLayers;
const C = {
  band: MOULD_GEO.map((g) => new Layer(g, 0xffffff, BANDS, 0.026)),
  /* The gold tip that pokes out of the left edge of the loaf. */
  wick: new Layer(new THREE.ConeGeometry(0.5, 1, 7), 0xffc93c, T.maxCandles, 0.024),
  /* After WRAP a candle is a present: a box and a ribbon across it. */
  ribbon: new Layer(box(1, 1, 1), 0xffffff, T.maxCandles, 0.030),
  bow: new Layer(box(1, 1, 1), 0xffffff, T.maxCandles, 0),
  spark: new Layer(new THREE.OctahedronGeometry(1, 0), 0xffffff, T.maxCandles, 0),
};

/* Additive, unlit and outside the toon system - a flame that takes a shadow
   band across it stops being a light and becomes a cone. Two cones, because a
   single additive one sums to near-white and reads as a pale spike: the orange
   body needs a separate white-hot heart inside it. */
const flameGeo = new THREE.ConeGeometry(0.5, 1, 8);
const flames = new THREE.InstancedMesh(flameGeo, new THREE.MeshBasicMaterial({
  color: 0xff8a26, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false,
}), T.maxCandles);
const flameCores = new THREE.InstancedMesh(flameGeo, new THREE.MeshBasicMaterial({
  color: 0xfff0c8, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false,
}), T.maxCandles);
flames.frustumCulled = flameCores.frustumCulled = false;
flames.count = flameCores.count = 0;
flames.renderOrder = 4; flameCores.renderOrder = 5;
scene.add(flames, flameCores);

// ── the runway and everything on it ──────────────────────────────────────────
const W = {
  /* Loose candles lying on the runway, drawn lying along the track so they
     read as stock waiting to be picked up rather than as part of the tray. */
  looseC:   new Layer(new THREE.CylinderGeometry(0.5, 0.5, 1, 10), 0xffffff, 48, 0.028),
  looseTip: new Layer(new THREE.ConeGeometry(0.24, 0.46, 7), 0xffd429, 48, 0),
  cash:     new Layer(box(1.0, 0.06, 0.52), 0x3fce6a, 40, 0.028),
  cashMark: new Layer(box(0.30, 0.02, 0.30), 0x1c7a3c, 40, 0),
  barrier:  new Layer(box(1.45, 0.66, 0.26), 0xe8324c, 24, 0.050),
  barX:     new Layer(box(0.92, 0.13, 0.09), 0xffffff, 48, 0),
  roller:   new Layer(new THREE.OctahedronGeometry(0.52, 0), 0xc1263c, 40, 0.050),
  rollBar:  new Layer(box(4.6, 0.13, 0.13), 0x8a1a2c, 14, 0),
  saw:      new Layer(new THREE.CylinderGeometry(0.85, 0.85, 0.10, 12), 0xdfe6ef, 14, 0.050),
  sawPost:  new Layer(box(0.20, 2.6, 0.20), 0xb0447a, 14, 0),
  /* The sweeper: a salmon bar with dark blue chevrons that slides across the
     lane. The only obstacle that MOVES, which is why it is the one that makes
     a long loaf feel long - you have to start turning before it is in reach. */
  sweeper:  new Layer(box(3.0, 0.42, 0.50), 0xff8a4c, 10, 0.050),
  sweepMark: new Layer(box(0.20, 0.44, 0.52), 0x2b3f7a, 44, 0),
  /* The skyline: pale stacked-cylinder towers well below the track, like giant
     candle stacks. Straight off the reference, and the only thing that gives
     the sky any depth once a cloud has drifted past. */
  tower:    new Layer(new THREE.CylinderGeometry(1, 1, 1, 10), 0xdff0ff, 96, 0),
  towerTip: new Layer(new THREE.ConeGeometry(0.62, 1.3, 8), 0xffd429, 24, 0),
  stripe:   new Layer(box(T.roadW, 0.06, 0.9), 0xffffff, 60, 0),
  rail:     new Layer(box(0.36, 0.36, 2.4), 0xffffff, 96, 0),
  pillar:   new Layer(new THREE.CylinderGeometry(0.30, 0.34, 3.0, 10), 0xffffff, 60, 0.048),
  pTip:     new Layer(new THREE.ConeGeometry(0.22, 0.5, 8), 0xffd429, 60, 0),
  cloud:    new Layer(new THREE.IcosahedronGeometry(1, 0), 0xffffff, 40, 0),
  bench:    new Layer(box(6.4, 0.5, 2.4), 0xffffff, 2, 0.070),
  benchLeg: new Layer(box(0.36, 1.4, 0.36), 0xd8c0ff, 8, 0),
  shadow:   new Layer(new THREE.CircleGeometry(0.5, 12), 0x000000, 60, 0),
};
W.shadow.mesh.material = new THREE.MeshBasicMaterial({ color: 0x2a1050, transparent: true, opacity: 0.20, depthWrite: false });

// the runway slab itself — one draw call
const road = new THREE.Mesh(box(T.roadW, 1.1, 2400), toon(0x5a27ab));
road.position.y = -0.55;
scene.add(road);
const railL = new THREE.Mesh(box(0.4, 0.52, 2400), toon(0xf0e4ff));
const railR = railL.clone();
railL.position.set(-T.roadW / 2 - 0.1, 0.06, 0);
railR.position.set(T.roadW / 2 + 0.1, 0.06, 0);
scene.add(railL, railR);

/* Glitter, and the only particle system in the game.

   Sprinkling is the single most "oddly satisfying" thing in the reference, so
   it gets its own additive point cloud rather than borrowing the pickup layer:
   confetti has to be small, dense, multicoloured and numerous, and instanced
   boxes at that count would cost more than they are worth. */
const GLITTER = 340;
const gGeo = new THREE.BufferGeometry();
const gPos = new Float32Array(GLITTER * 3);
const gCol = new Float32Array(GLITTER * 3);
const glit = [];
for (let i = 0; i < GLITTER; i++) {
  glit.push({ live: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, t: 0, r: 1, g: 1, b: 1 });
}
gGeo.setAttribute('position', new THREE.BufferAttribute(gPos, 3));
gGeo.setAttribute('color', new THREE.BufferAttribute(gCol, 3));
const glitter = new THREE.Points(gGeo, new THREE.PointsMaterial({
  size: 0.21, vertexColors: true, transparent: true, opacity: 0.95,
  depthWrite: false, blending: THREE.AdditiveBlending,
}));
glitter.frustumCulled = false;
scene.add(glitter);

// ─────────────────────────────────────────────────────────────────────────────
// STATIONS — real meshes with pink banner signs, few enough to be objects
// ─────────────────────────────────────────────────────────────────────────────
/* The marbled swirl on a wax pool.

   The reference's pools are not flat colour - they have a lighter marbled
   texture drifting through them, and it is most of what makes the wax read as
   liquid rather than as a painted rectangle. One 128px canvas of soft blobs,
   multiplied over the pool's own colour, reused by every pool in the game. */
let SWIRL = null;
function swirlTex() {
  if (SWIRL) return SWIRL;
  const n = 128;
  const cv = document.createElement('canvas');
  cv.width = cv.height = n;
  const g = cv.getContext('2d');
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, n, n);
  /* Deterministic blobs: this is drawn once at boot and never re-rolled, so a
     seeded stream would buy nothing, but a fixed pattern keeps every build
     looking the same. */
  for (let i = 0; i < 120; i++) {
    const a = (i * 2.399);
    const x = (Math.sin(a * 3.1) * 0.5 + 0.5) * n;
    const y = (Math.cos(a * 2.3) * 0.5 + 0.5) * n;
    const r = 5 + (i % 7) * 3;
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, 'rgba(255,255,255,0.85)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.beginPath(); g.arc(x, y, r, 0, 6.284); g.fill();
  }
  SWIRL = new THREE.CanvasTexture(cv);
  SWIRL.wrapS = SWIRL.wrapT = THREE.RepeatWrapping;
  SWIRL.repeat.set(1, 3);
  SWIRL.needsUpdate = true;
  return SWIRL;
}

const signCache = new Map();

/* The sign is the loudest thing on the runway, because it is the only thing
   telling the player what a station will do while there is still time to steer
   for it. Big white type on a hot-pink pill, exactly as the reference does. */
function signTex(text, sub, accent) {
  const key = text + '|' + sub + '|' + accent;
  let t = signCache.get(key);
  if (t) return t;
  const cv = document.createElement('canvas');
  cv.width = 512; cv.height = 168;
  const g = cv.getContext('2d');
  const round = (x, y, w, h, r) => {
    g.beginPath();
    if (g.roundRect) g.roundRect(x, y, w, h, r);
    else {
      g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r);
      g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r);
      g.arcTo(x, y, x + w, y, r); g.closePath();
    }
  };
  g.fillStyle = '#e8226e'; round(6, 10, 500, 148, 74); g.fill();
  g.strokeStyle = '#9c0b45'; g.lineWidth = 9; round(6, 10, 500, 148, 74); g.stroke();
  g.fillStyle = 'rgba(255,255,255,0.18)'; round(30, 26, 452, 40, 20); g.fill();

  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = '#ffffff';
  g.font = '700 78px Fredoka,"Segoe UI",system-ui,sans-serif';
  g.fillText(text, 256, sub ? 74 : 84);
  if (sub) {
    g.font = '600 38px Fredoka,"Segoe UI",system-ui,sans-serif';
    g.fillStyle = accent || '#ffe6f2';
    g.fillText(sub, 256, 126);
  }
  t = new THREE.CanvasTexture(cv);
  t.needsUpdate = true;
  signCache.set(key, t);
  return t;
}

/* Every station kind in one table: what it is called, what colour it is, what
   it does to ONE candle, and which machine stands over it.

   `apply` takes a single candle's recipe, because a station is a pool on the
   ground and which candles are standing in it is the entire skill. Adding a
   station is adding a row here plus a slot in STATION_SLOTS - which is the
   shape that stops "extra stations" turning into a special case scattered
   through the simulation. */
const KIND_WAX = 0, KIND_GLITTER = 1, KIND_PRESS = 2, KIND_WRAP = 3,
      KIND_ROTATE = 4, KIND_SCENT = 5;
const KINDS = [
  {
    n: 'WAX', liquid: true, accent: '#ffe6f2', machine: 'ladle',
    label: () => 'CANDLE',
    sub: (h) => WAXES[h.wax].n,
    colour: (h) => WAXES[h.wax].col,
    apply: (h, r) => CD.dip(r, h.wax),
  },
  {
    n: 'GLITTER', liquid: false, accent: '#fff0a8', machine: 'bottle',
    label: () => 'GLITTER',
    sub: () => '+SPARKLE',
    colour: () => 0xffd429,
    apply: (h, r) => CD.addGlitter(r, glitterPer()),
  },
  {
    n: 'PRESS', liquid: false, accent: '#d8ffe8', machine: 'ram',
    label: () => 'MOLD',
    sub: (h) => MOULDS[h.mould].n,
    colour: () => 0x8be0ff,
    apply: (h, r) => CD.press(r, h.mould),
  },
  {
    n: 'WRAP', liquid: false, accent: '#ffd8ec', machine: 'gift',
    label: () => 'WRAP',
    sub: (h) => WRAPS[h.wrap].n,
    colour: (h) => WRAPS[h.wrap].col || 0xff3d92,
    apply: (h, r) => CD.wrapIn(r, h.wrap),
  },
  {
    /* Straight off the reference: a white plate with a big curved arrow. It
       turns the whole loaf end for end rather than treating a candle, so its
       `apply` does nothing and `updatePools` handles it once, as a special
       case, when the leader crosses the plate. */
    n: 'ROTATE', liquid: false, accent: '#ffffff', machine: 'arrow',
    label: () => 'ROTATE',
    sub: () => 'TURN IT',
    colour: () => 0xffffff,
    apply: () => false,
  },
  {
    /* The Scent Shop, and the only station you have to buy. That is the
       reference's whole progression model - shops beside the track that add
       stations - so it has to be a station and not a percentage. */
    n: 'SCENT', liquid: true, accent: '#f0e4ff', machine: 'bottle',
    label: () => 'SCENT',
    sub: () => 'PERFUME',
    colour: () => 0xd8b4ff,
    apply: (h, r) => CD.addScent(r),
  },
];

/* A station is a PAIR OF POOLS lying in the runway, side by side, each with a
   sign on a curved arm over it - not a gate you pass through.

   That is the difference between a station that happens to you and one you
   play: a pool is a place, it has length, and the loaf drives through it, so
   the candles that end up in the left pool are the ones that were on the left
   when they got there. */
class Station {
  constructor() {
    this.group = new THREE.Group();

    this.half = [0, 1].map((i) => {
      const side = i ? 1 : -1;
      const x = side * (T.roadW / 4);
      const g = new THREE.Group();
      g.position.x = x;

      /* The reference hangs each sign from a thin dark CURVED ARM rising from
         the track edge and leaning in over the pool, like a street lamp - not
         from a gantry with a post either side. It is most of why its runway
         reads as open sky rather than as a tunnel. */
      const arm = new THREE.Mesh(new THREE.TorusGeometry(1.9, 0.075, 6, 14, Math.PI * 0.62), toon(0x2f3b52));
      arm.position.set(side * (T.roadW / 4 - 0.1), 2.0, 0);
      arm.rotation.z = side > 0 ? Math.PI * 0.42 : Math.PI * 0.58;
      arm.rotation.y = Math.PI / 2;
      const post = new THREE.Mesh(box(0.13, 2.2, 0.13), toon(0x2f3b52));
      post.position.set(side * (T.roadW / 4 + 1.75), 1.1, 0);

      const sign = new THREE.Mesh(new THREE.PlaneGeometry(3.3, 1.05), new THREE.MeshBasicMaterial({
        transparent: true, depthWrite: false,
      }));
      /* Turned to face the camera: a PlaneGeometry faces +z and this camera
         looks along +z, so an unrotated sign shows the player its back. */
      sign.rotation.y = Math.PI;
      sign.position.set(side * 0.2, 3.05, 0);
      sign.renderOrder = 6;

      // the pool itself, sunk into the runway
      const w = T.roadW / 2 - T.poolInset * 2;
      const liquid = new THREE.Mesh(new THREE.PlaneGeometry(w, T.poolLen), new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: true, opacity: 0.95, depthWrite: false, map: swirlTex(),
      }));
      liquid.rotation.x = -Math.PI / 2;
      liquid.position.y = 0.05;

      /* The machine over it. A ladle that tips and pours, a glitter bottle
         that shakes, a ram that slams, a gift box, or ROTATE's arrow plate.
         The reference's single most "satisfying" quality is watching these
         work, so they all animate. */
      const headG = new THREE.Group();
      const bowl = new THREE.Mesh(new THREE.SphereGeometry(0.42, 12, 8), toon(0xffffff));
      const pour = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.16, 1.5, 8), new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: true, opacity: 0.92,
      }));
      pour.position.y = -0.95;
      const gift = new THREE.Mesh(box(1.5, 1.4, 1.5), toon(0xffd429));
      const giftBow = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.16, 6, 10), toon(0xff3d92));
      giftBow.position.y = 0.78; giftBow.rotation.x = Math.PI / 2;
      gift.add(giftBow);
      const plate = new THREE.Mesh(box(T.roadW / 2 - 0.3, 0.18, 2.6), toon(0xffffff));
      const arrowM = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1.1, 4), toon(0xff3d92));
      arrowM.rotation.z = -Math.PI / 2; arrowM.position.y = 0.35;
      plate.add(arrowM);
      headG.add(bowl, pour, gift, plate);
      headG.position.set(side * 0.1, 2.15, -T.poolLen / 2 + 1.4);

      g.add(arm, post, sign, liquid, headG);
      this.group.add(g);
      return { g, arm, post, sign, liquid, headG, bowl, pour, gift, plate };
    });

    this.group.visible = false;
    scene.add(this.group);
  }
  set(st, t) {
    this.group.visible = true;
    this.group.position.set(0, 0, st.z);
    for (let i = 0; i < 2; i++) {
      const h = i ? st.right : st.left;
      const k = KINDS[h.kind];
      const p = this.half[i];
      p.sign.material.map = signTex(k.label(h), k.sub(h), k.accent);
      p.sign.material.needsUpdate = true;

      const col = k.colour(h);
      p.liquid.visible = k.machine !== 'arrow';
      p.liquid.material.color.setHex(col);
      p.liquid.material.opacity = k.liquid ? 0.95 : 0.32;

      const beat = t * 2.2 + i * 0.7 + st.z * 0.11;
      p.bowl.visible = p.pour.visible = (k.machine === 'ladle' || k.machine === 'bottle');
      p.gift.visible = k.machine === 'gift';
      p.plate.visible = k.machine === 'arrow';
      p.headG.visible = k.machine !== 'ram' || true;

      if (k.machine === 'ladle' || k.machine === 'bottle') {
        p.bowl.material = toon(col);
        p.pour.material.color.setHex(col);
        p.headG.position.y = 2.15 + Math.sin(beat) * 0.12;
        p.headG.rotation.z = Math.sin(beat * 0.7) * 0.35;
        p.pour.scale.y = 0.9 + Math.sin(beat * 3) * 0.14;
      } else if (k.machine === 'ram') {
        p.bowl.visible = true; p.pour.visible = false;
        p.bowl.material = toon(0xff3d92);
        const drop = Math.max(0, Math.sin(beat * 1.7));
        p.headG.position.y = 2.5 - drop * 1.7;
        p.headG.rotation.z = 0;
      } else if (k.machine === 'gift') {
        p.headG.position.y = 1.5 + Math.sin(beat) * 0.18;
        p.headG.rotation.z = 0;
        p.headG.rotation.y = beat * 0.4;
      } else {
        p.headG.position.y = 0.12;
        p.headG.rotation.set(0, 0, 0);
        p.plate.rotation.y = Math.sin(beat) * 0.25;
      }
    }
  }
  hide() { this.group.visible = false; }
}
const stationPool = [new Station(), new Station(), new Station()];

// ─────────────────────────────────────────────────────────────────────────────
// GATES — the count axis, two halves with big +N / x2 labels
// ─────────────────────────────────────────────────────────────────────────────
/* There are no +N / x2 gates in this game.

   They were carried over from the viking crowd-runner this repo used to hold,
   and they are not in the reference: its runway grows the tray with loose
   candles lying on the ground, which is a thing you steer *over* rather than a
   sign you steer *past*. Two multiplier gates plus eight station gantries was
   also simply too much signage to read at speed. */

// ─────────────────────────────────────────────────────────────────────────────
// STATE
// ─────────────────────────────────────────────────────────────────────────────
let stations = [], obstacles = [], notes = [], loose = [], props = [], clouds = [], towers = [];

const run = {
  active: false, over: false, gift: false,
  z: 0, x: 0, targetX: 0, time: 0,
  /* The tray holds one recipe per candle - see candle.ts for why that is the
     whole game - and the trail says where each of them is. */
  tray: TR.newTray(6),
  trail: ST.newTrail(),
  cash: 0, lost: 0, gained: 0, dips: 0, chunkSpawned: -1,
  workshop: 0, scale: 1, shake: 0, hitStop: 0,
  lastCloudWindow: -999, lastSkyWindow: -999, giftT: 0,
};
const count = () => run.tray.length;
let lastResult = null;
let hintTimer = 0;
let stationSeq = 0;

/* Every random draw that can change the outcome comes from here, not
   Math.random. Cosmetic jitter - confetti scatter, cloud shapes, camera shake -
   is Math.random deliberately.

   The trap is that "cosmetic" is not obvious: a loose candle's position decides
   when it comes within magnet reach, which decides how many candles are on the
   tray when the next barrier arrives. Anything that decides *when* is
   simulation. */
let rnd = makeRng(1);
const stackPos = [];
const BENCH_Z = T.levelChunks * T.chunk + 16;

function startLevel() {
  rnd = makeRng(1000 + S.level);
  run.active = true; run.over = false; run.gift = false;
  run.z = 0; run.x = 0; run.targetX = 0; run.time = 0;
  run.tray = TR.newTray(startCandles());
  ST.seedTrail(run.trail, 0, 0);
  run.cash = 0; run.lost = 0; run.gained = 0; run.dips = 0;
  run.chunkSpawned = -1;
  run.scale = TU.scaleFor(S.level);
  run.workshop = (S.level - 1) % WORKSHOPS.length;
  run.shake = 0; run.hitStop = 0; run.giftT = 0;
  run.lastCloudWindow = -999;
  run.lastSkyWindow = -999;
  stationSeq = 0;
  stations.length = 0; obstacles.length = 0;
  notes.length = 0; loose.length = 0; props.length = 0;
  for (const g of glit) g.live = false;
  giftLight.intensity = 0;
  applyWorkshop(WORKSHOPS[run.workshop]);
  hintTimer = S.seenShop ? 0 : 4.0;
  hintEl.style.opacity = hintTimer > 0 ? '0.95' : '0';
  shopScreenEl.classList.add('hidden');
  resultEl.classList.add('hidden');
  toast(WORKSHOPS[run.workshop].name, 1.4);
  lastHud = {};
  syncHUD();
}

/* The green plus on a shop front, as one texture rather than two crossed
   boxes. Cached forever: there is one of it. */
let plusCache = null;
function plusTex() {
  if (plusCache) return plusCache;
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const g = cv.getContext('2d');
  g.fillStyle = '#ffffff';
  g.fillRect(14, 27, 36, 10);
  g.fillRect(27, 14, 10, 36);
  plusCache = new THREE.CanvasTexture(cv);
  return plusCache;
}

/* The shop area past the finish line: panels either side of the track with a
   pink pill sign and a green plus button, which is how the reference sells
   progression - you drive between shop fronts and buy the one you want. Ours
   opens the workshop sheet instead of being clicked in 3D, so these are the
   scene-setting half of it; the sheet is the half you can press.

   Static meshes rather than a Layer: there are three of them, they never move,
   and they are frustum-culled out of every frame except the last few seconds of
   a run. */
const shopArea = new THREE.Group();
[['SCENT SHOP', '$4,000', 1], ['ONLINE SHOP', '$1,000', -1], ['LUXURY SHOP', '$9,000', 1]]
  .forEach(([name, price, side], i) => {
    const g = new THREE.Group();
    g.position.set(side * (T.roadW / 2 + 3.0), 0, BENCH_Z + 6 + i * 7.5);

    /* Four meshes each, and that is a budget rather than a style: these are
       plain Meshes, not a Layer, so every one of them is its own draw call and
       three shop fronts at seven meshes apiece put the frame over 85 calls the
       moment they came into frustum. A crossed pair of bars for the plus and an
       outline hull are exactly the kind of detail that is invisible at this
       distance and costs the same as the panel itself. */
    const panel = new THREE.Mesh(box(4.6, 4.2, 0.6), toon(0xfff4fb));
    panel.position.y = 2.1;

    const sign = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 1.35), new THREE.MeshBasicMaterial({
      map: signTex(name, price, '#ffe6f2'), transparent: true, depthWrite: false,
    }));
    /* Faces +z like every PlaneGeometry, and the camera looks along +z. */
    sign.rotation.y = Math.PI;
    sign.position.set(0, 3.1, -0.4);
    sign.renderOrder = 6;

    // the green plus, which is the reference's buy button
    const pad = new THREE.Mesh(box(1.6, 1.6, 0.3), toon(0x3fce6a));
    pad.position.set(0, 1.4, -0.35);
    const plus = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.1), new THREE.MeshBasicMaterial({
      map: plusTex(), transparent: true, depthWrite: false,
    }));
    plus.rotation.y = Math.PI;
    plus.position.set(0, 1.4, -0.52);
    plus.renderOrder = 6;

    g.add(panel, sign, pad, plus);
    shopArea.add(g);
  });
scene.add(shopArea);

function applyWorkshop(p) {
  host.style.background = `linear-gradient(180deg, ${p.sky[0]} 0%, ${p.sky[1]} 74%, ${p.sky[1]} 100%)`;
  road.material = toon(p.road);
  railL.material = railR.material = toon(p.rail);
  W.stripe.mesh.material = toon(p.stripe);
  W.rail.mesh.material = toon(p.rail);
  W.pillar.mesh.material = toon(p.prop);
  W.bench.mesh.material = toon(p.rail);
  W.cloud.mesh.material = new THREE.MeshBasicMaterial({ color: p.cloud, transparent: true, opacity: 0.9 });
  document.querySelector('meta[name=theme-color]').setAttribute('content', p.sky[0]);
}

// ─────────────────────────────────────────────────────────────────────────────
// SPAWNING — seeded per chunk, so a level layout is reproducible
// ─────────────────────────────────────────────────────────────────────────────

/* The station running order along the runway.

   Eight gantries, each a pair of pools, and the pairing is fixed rather than
   rolled. Wax early and often, because banding is what the player is weaving
   for; glitter and the press through the middle; and wrapping late, twice.
   Fixed because a wrap pool in chunk 4 would treat candles before there is
   anything worth wrapping, and offered twice because losing the biggest
   multiplier in the game to one mistimed swerve is out of proportion. */
const STATION_SLOTS = [
  { c: 4,  a: KIND_WAX,     b: KIND_WAX },
  { c: 8,  a: KIND_WAX,     b: KIND_GLITTER },
  { c: 11, a: KIND_ROTATE,  b: KIND_WAX },
  { c: 14, a: KIND_WAX,     b: KIND_WAX },
  { c: 17, a: KIND_GLITTER, b: KIND_PRESS },
  { c: 20, a: KIND_WAX,     b: KIND_SCENT },
  { c: 23, a: KIND_WAX,     b: KIND_WAX },
  { c: 26, a: KIND_PRESS,   b: KIND_ROTATE },
  { c: 29, a: KIND_WRAP,    b: KIND_GLITTER },
  { c: 32, a: KIND_WAX,     b: KIND_WRAP },
];
const slotFor = (c) => STATION_SLOTS.find((x) => x.c === c) || null;

/* Build one pool. Two wax pools side by side are never the same colour - a
   choice between two identical things is not a choice, and the reference's own
   advice ("dunk all of your candles in both") only means anything if they
   differ. */
function makeHalf(kind, c, salt, avoid) {
  /* The Scent Shop has to be bought before its station appears on the runway -
     that is the reference's progression model, where money buys stations
     rather than percentages. Until then the slot falls back to a wax pool, so
     the gantry is never half empty. */
  if (kind === KIND_SCENT && !TU.hasScent(S.up)) kind = KIND_WAX;
  const h = { kind, wax: 0, mould: 0, wrap: 0, id: ++stationSeq };
  if (kind === KIND_WAX) {
    const pal = WORKSHOPS[run.workshop].waxes;
    let i = Math.floor(hash(c, salt + S.level) * pal.length) % pal.length;
    for (let k = 0; k < pal.length && pal[i] === avoid; k++) i = (i + 1) % pal.length;
    h.wax = pal[i];
  } else if (kind === KIND_PRESS) {
    h.mould = bestMould();
  } else if (kind === KIND_WRAP) {
    h.wrap = bestWrap();
  }
  return h;
}

function spawnStation(c, z) {
  const slot = slotFor(c);
  if (!slot) return;
  let left = makeHalf(slot.a, c, 210, -1);
  let right = makeHalf(slot.b, c, 340, slot.a === KIND_WAX ? left.wax : -1);
  /* The better-looking side is not always the same side. */
  if (hash(c, 455 + S.level) > 0.5) { const t = left; left = right; right = t; }
  stations.push({ z, left, right, touched: false });
}

function spawnChunk(c) {
  const z = c * T.chunk;
  if (c > T.levelChunks || c < 2) return;

  if (slotFor(c)) { spawnStation(c, z + 6); return; }

  const r1 = hash(c, 91 + S.level);
  const r2 = hash(c, 402 + S.level);
  const r3 = hash(c, 777 + S.level);
  const r4 = hash(c, 913 + S.level);
  const r5 = hash(c, 611 + S.level);

  /* The pickup line is decided before the obstacles, so one can be planted on
     it. That is the only place where the reward and the danger are in the same
     spot, and it is what turns steering from "avoid things" into a decision. */
  const hasCash = r4 < T.cashChance;
  const cashX = TU.laneX(hash(c, 905 + S.level));
  const guarded = hasCash && hash(c, 907 + S.level) < T.guardedCash;

  const dens = clamp(0.7 + c * 0.012, 0, 1.5) * clamp(0.8 + S.level * 0.07, 0, 1.7);

  if (c >= 3 && r1 < T.barrierChance * dens) {
    const n = 1 + Math.floor(hash(c, 120 + S.level) * 2.2);
    for (let i = 0; i < n; i++) {
      obstacles.push({
        kind: 'barrier',
        x: (i === 0 && guarded) ? cashX : TU.laneX(hash(c, 300 + i)),
        z: z + 2 + i * 3.6, hit: false, spin: 0, w: 0.78,
      });
    }
  }
  if (c >= 6 && r2 < T.rollerChance * dens) {
    obstacles.push({
      kind: 'roller', x: TU.laneX(hash(c, 700 + S.level)),
      z: z + 5 + hash(c, 705) * 3, hit: false, spin: hash(c, 710) * 6.28, w: 1.55,
    });
  }
  if (c >= 9 && r3 < T.sawChance * dens) {
    obstacles.push({
      kind: 'saw', x: TU.laneX(hash(c, 800 + S.level)),
      z: z + 4 + hash(c, 805) * 4, hit: false, spin: 0, w: 0.9,
    });
  }
  /* The sweeper slides, and its position is a function of `run.z` rather than
     of elapsed time. The same thing at a constant speed - and unlike a clock it
     is reproducible, so the golden still holds. Anything that decides *when* is
     simulation, and a moving obstacle decides when more than anything else on
     the runway does. */
  if (c >= 12 && hash(c, 860 + S.level) < T.sweeperChance * dens) {
    obstacles.push({
      /* `w` is the collision half-width and it is DELIBERATELY under the
         drawn half-width of 1.5: a bar this wide swinging this far leaves a
         gap of 1.5 units at its worst, and the standard tolerance of 0.34 on
         top of a true half-width closed that gap entirely. A moving obstacle
         with no gap is not an obstacle, it is a tax. */
      kind: 'sweeper', x: 0, z: z + 4 + hash(c, 865) * 5, hit: false, spin: 0,
      w: 1.15, amp: T.laneClamp * 0.55, phase: hash(c, 870) * 6.28,
      dir: hash(c, 875) > 0.5 ? 1 : -1,
    });
  }

  /* Loose candles lying on the runway. This is how the tray grows - straight
     off the reference screenshot, which has finished candles scattered across
     the track. */
  if (r5 < T.looseChance) {
    const n = 2 + Math.floor(hash(c, 940) * 4);
    const lx = TU.laneX(hash(c, 945 + S.level));
    const sweep = (hash(c, 950) - 0.5) * 3.0;
    for (let i = 0; i < n; i++) {
      const t = n > 1 ? i / (n - 1) : 0.5;
      loose.push({
        x: clamp(lx + sweep * (t - 0.5) * 2, -T.laneClamp, T.laneClamp),
        z: z + 2 + t * 8.0, spin: hash(c, 955 + i) * 6.28,
      });
    }
  }

  if (hasCash) {
    const n = 1 + Math.floor(hash(c, 900) * 2);
    for (let i = 0; i < n; i++) {
      notes.push({ x: cashX, z: z + 3 + i * 4.5, bob: hash(c, 920 + i) * 6.28 });
    }
  }

  // roadside pillars with a flame finial, purely to give the sky some scale
  for (let side = 0; side < 2; side++) {
    if (hash(c, 480 + side) < 0.45) continue;
    props.push({
      x: (side ? 1 : -1) * (T.roadW / 2 + 1.5),
      z: z + hash(c, 490 + side) * 9,
      s: 0.8 + hash(c, 495 + side) * 0.9,
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// FX
// ─────────────────────────────────────────────────────────────────────────────
let glitCursor = 0;
function spawnGlit(x, y, z, vx, vy, vz, r, g, b) {
  const p = glit[glitCursor];
  glitCursor = (glitCursor + 1) % glit.length;
  p.live = true; p.t = 0;
  p.x = x; p.y = y; p.z = z;
  p.vx = vx; p.vy = vy; p.vz = vz;
  p.r = r; p.g = g; p.b = b;
}
function emit(x, y, z, n, hex, spread, up) {
  CTMP.setHex(hex);
  for (let i = 0; i < n; i++) {
    spawnGlit(
      x + (Math.random() - 0.5) * spread, y, z + (Math.random() - 0.5) * spread,
      (Math.random() - 0.5) * 5, up * (0.5 + Math.random()), (Math.random() - 0.5) * 5,
      CTMP.r, CTMP.g, CTMP.b);
  }
}
/* Confetti falls from above the sign, which is what makes a glitter station
   read as sprinkling rather than exploding. */
function confetti(z, n) {
  for (let i = 0; i < n; i++) {
    CTMP.setHSL(Math.random(), 0.92, 0.66);
    spawnGlit(
      (Math.random() - 0.5) * T.roadW, 4.6 + Math.random() * 2.6, z + (Math.random() - 0.5) * 7,
      (Math.random() - 0.5) * 1.4, -1.2 - Math.random(), (Math.random() - 0.5) * 1.4,
      CTMP.r, CTMP.g, CTMP.b);
  }
}
const splash = (z, hex, n) => emit(run.x, 0.9, z, n, hex, 2.4, 6);

function shake(v) { run.shake = Math.min(1.2, run.shake + v); }
function hitStop(ms) { run.hitStop = Math.max(run.hitStop, ms / 1000); }

/* The theme drops an octave when the tray is nearly empty, which is the one
   moment the player has lost something and needs telling without a caption. */
const sfx = createSfx({ isStruggling: () => run.active && count() <= 2 });

// ─────────────────────────────────────────────────────────────────────────────
// HUD
// ─────────────────────────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
const hudCoins = $('coins'), hudCount = $('countN'), hudCash = $('cashN'), hudEach = $('eachN');
const stackEl = $('stack');
const progFill = $('prog').firstElementChild;
const levelEl = $('level'), toastEl = $('toast'), hintEl = $('hint');
const shopScreenEl = $('shopScreen'), shopEl = $('shop'), flashEl = $('flash');
const resultEl = $('result');

let toastT = 0;
function toast(msg, dur) { toastEl.textContent = msg; toastEl.style.opacity = '1'; toastT = dur || 1.1; }

let lastHud = {};
function syncHUD() {
  const n = count();
  if (lastHud.n !== n) { hudCount.textContent = n; lastHud.n = n; }
  if (lastHud.c !== S.coins) { hudCoins.textContent = fmt(S.coins); lastHud.c = S.coins; }
  if (lastHud.l !== S.level) { levelEl.innerHTML = S.level + '<small>LEVEL</small>'; lastHud.l = S.level; }
  const cash = Math.floor(run.cash);
  if (lastHud.k !== cash) { hudCash.textContent = '$' + fmt(cash); lastHud.k = cash; }

  /* What the tray is worth right now, not what one candle is worth.

     With per-candle recipes there is no single "each" any more - half the tray
     can be twice the other half - so the running readout is the total, which
     is the number the player is actually growing. */
  const worth = Math.round(TR.trayValue(run.tray) * priceMul() * earnMul());
  if (lastHud.e !== worth) { hudEach.textContent = '$' + fmt(worth); lastHud.e = worth; }

  /* The colour chips are the tray's palette: one chip per wax that any candle
     is wearing, its height showing how much of the tray carries it. That is
     the readout that makes weaving legible - dunk half the tray in aqua and
     half in pink and you get two half-height chips, not one. */
  const pal = TR.statsOf(run.tray, WAXES.length).palette;
  const sig = pal.join(',');
  if (lastHud.s !== sig) {
    let html = '';
    for (let i = pal.length - 1; i >= 0; i--) {
      if (!pal[i]) continue;
      const h = clamp(4 + (pal[i] / Math.max(1, n)) * 14, 4, 18);
      html += `<i style="background:#${WAXES[i].col.toString(16).padStart(6, '0')};height:${h.toFixed(0)}px"></i>`;
    }
    stackEl.innerHTML = html;
    lastHud.s = sig;
  }
  progFill.style.width = clamp(run.z / BENCH_Z, 0, 1) * 100 + '%';
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
const popAt = (text, color, z) => pop(text, color, run.x, 2.9, z);

// ─────────────────────────────────────────────────────────────────────────────
// THE WORKSHOP — stat upgrades between levels, as the reference does it
// ─────────────────────────────────────────────────────────────────────────────
/* The shop, and it is a list of SHOPS rather than a list of stats.

   The reference ends a run by driving between panels beside the track - SCENT
   SHOP $4,000, ONLINE SHOP $1,000, LUXURY SHOP - each with a green plus. The
   observed names and both observed prices are used as-is; the rest follow the
   same shape. THE SCENT SHOP is the important one, because it buys a whole new
   station rather than a number, which is what "extra stations like the
   boutique" means in that game's reviews. */
const UPGRADES = [
  { g: 'THE LINE', id: 'stack', ic: '🕯️', name: () => 'Bigger Batch',
    eff: () => 'Start every level with ' + (startCandles() + 2) + ' candles',
    cost: () => Math.round(90 * Math.pow(1.95, S.up.stack)), max: 10, unlock: 1 },
  { g: 'THE LINE', id: 'grip', ic: '🛡️', name: () => 'Steady Tray',
    eff: () => 'A barrier takes ' + TU.obstacleTake(T.barrierTake, { ...S.up, grip: S.up.grip + 1 }) +
               ' candles, not ' + takeOf(T.barrierTake),
    cost: () => Math.round(150 * Math.pow(2.1, S.up.grip)), max: 8, unlock: 1 },
  { g: 'THE LINE', id: 'reach', ic: '🧲', name: () => 'Long Reach',
    eff: () => 'Sweep loose candles and money in from further out',
    cost: () => Math.round(110 * Math.pow(2.0, S.up.reach)), max: 8, unlock: 1 },

  { g: 'THE SHOPS', id: 'earn', ic: '💻', name: () => 'Online Shop',
    eff: () => 'Every sale pays +' + Math.round((S.up.earn + 1) * 14) + '%',
    cost: () => Math.round(1000 * Math.pow(2.1, S.up.earn)), max: 10, unlock: 1 },
  { g: 'THE SHOPS', id: 'scent', ic: '🌸', name: () => 'Scent Shop',
    eff: () => S.up.scent > 0
      ? 'A SCENT station runs on every level'
      : 'Adds a SCENT station to the line — x' + (1 + T.scentValue).toFixed(2) + ' a candle',
    cost: () => 4000, max: 1, unlock: 2 },
  { g: 'THE SHOPS', id: 'press', ic: '⭐',
    name: () => 'Boutique: ' + MOULDS[TU.bestMould({ ...S.up, press: S.up.press + 1 })].n,
    eff: () => S.up.press >= TU.MAX_PRESS
      ? 'The finest mould on the line'
      : 'x' + MOULDS[TU.bestMould({ ...S.up, press: S.up.press + 1 })].mul.toFixed(2) +
        ' a candle, and a new shape',
    cost: () => Math.round(2500 * Math.pow(3.0, S.up.press)), max: TU.MAX_PRESS, unlock: 2 },
  { g: 'THE SHOPS', id: 'wrap', ic: '🎀',
    name: () => 'Luxury Shop: ' + WRAPS[TU.bestWrap({ ...S.up, wrap: S.up.wrap + 1 })].n,
    eff: () => S.up.wrap >= TU.MAX_WRAP
      ? 'The finest wrapping in the boutique'
      : 'x' + WRAPS[TU.bestWrap({ ...S.up, wrap: S.up.wrap + 1 })].mul.toFixed(2) +
        ' a candle at the wrap station',
    cost: () => Math.round(3500 * Math.pow(3.1, S.up.wrap)), max: TU.MAX_WRAP, unlock: 3 },

  { g: 'THE STATIONS', id: 'vat', ic: '🎨', name: () => 'Deeper Vats',
    eff: () => 'A wax pool lays ' + TU.vatLayers({ ...S.up, vat: S.up.vat + 1 }) + ' band(s) in one pass',
    cost: () => Math.round(260 * Math.pow(2.4, S.up.vat)), max: 9, unlock: 2 },
  { g: 'THE STATIONS', id: 'spark', ic: '✨', name: () => 'Glitter Cannon',
    eff: () => 'Glitter applies ' + TU.glitterPer({ ...S.up, spark: S.up.spark + 1 }) + ' coat(s)',
    cost: () => Math.round(240 * Math.pow(2.35, S.up.spark)), max: 9, unlock: 2 },
];

function openShop(title, sub) {
  $('shopTitle').textContent = title;
  $('shopSub').textContent = sub;
  renderShop();
  showBuildInfo();
  shopScreenEl.classList.remove('hidden');
  S.seenShop = true;
  save();
}

function renderShop() {
  $('sCoins').textContent = fmt(S.coins);
  $('sBest').textContent = fmt(S.bestValue);
  $('sStars').textContent = fmt(S.stars);
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
    if (locked) btn = `<span class="lockmsg">LEVEL ${u.unlock}</span>`;
    else if (maxed) btn = `<button class="buy max" disabled>MAX</button>`;
    else btn = `<button class="buy ${afford ? '' : 'no'}" data-buy="${u.id}">$${fmt(cost)}</button>`;
    html += `<div class="up ${locked ? 'locked' : ''}">
      <div class="upic">${u.ic}</div>
      <div class="upinfo"><div class="upname out">${locked ? '???' : u.name()}</div>
      <div class="upeff">${locked ? 'Sealed until Level ' + u.unlock : u.eff() + '   ·  Lv ' + lvl + '/' + u.max}</div></div>
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
  if (S.up[id] >= u.max || S.best < u.unlock) return;
  const cost = u.cost();
  if (S.coins < cost) { sfx.deny(); return; }
  S.coins -= cost;
  S.up[id]++;
  sfx.buy();
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
// THE GIFT TABLE
// ─────────────────────────────────────────────────────────────────────────────
function finishLevel() {
  if (run.over) return;
  run.active = false; run.over = true; run.gift = true; run.giftT = 0;
  const a = appraise(run.tray, {
    cash: run.cash, earnMul: earnMul(), priceMul: priceMul(),
  });
  lastResult = a;
  S.coins += a.value;
  S.bestValue = Math.max(S.bestValue, a.value);
  S.stars += a.stars;
  S.level++;
  S.best = Math.max(S.best, S.level);
  save();
  sfx.sell(a.stars > 0);
  confetti(run.z + 4, 170);
  flash(0.4);

  setTimeout(() => {
    renderResult(a);
    openShop('THE WORKSHOP', `LEVEL ${S.level - 1} DELIVERED`);
  }, 2600);
}

/* The results panel reports the TRAY, because there is no longer one recipe to
   describe. Averages and counts, so a player who wove well can see that in
   "3.4 colours each" and "24 of 27 wrapped" rather than being told a single
   multiplier that was never true of every candle. */
function renderResult(a) {
  const st = a.stats;
  const rows = [
    ['CANDLES', st.count + ' delivered', '$' + fmt(Math.round(a.each)) + ' avg'],
    ['COLOURS', st.avgColours.toFixed(1) + ' per candle', ''],
    ['GLITTER', st.avgGlitter.toFixed(1) + ' coats each', ''],
    ['MOLDED', st.pressed + ' of ' + st.count, ''],
    ['WRAPPED', st.wrapped + ' of ' + st.count, ''],
  ];
  if (st.scented > 0) rows.push(['SCENTED', st.scented + ' of ' + st.count, '']);
  if (st.plain > 0) rows.push(['UNTOUCHED', st.plain + ' plain candle' + (st.plain === 1 ? '' : 's'), '']);
  if (a.cash > 0) rows.push(['PICKED UP', 'banknotes', '$' + fmt(Math.round(a.cash))]);
  /* The gauge, which is the reference's end-of-run moment: a numeric scale
     with the run's value rising up it. Calibrated on `par` so the ticks mean
     the same thing at every level - the same tray always fills it the same
     amount, however much money that level happens to pay. */
  const target = T.par * priceMul();
  const full = target * T.gaugeMax;
  const frac = clamp(a.value / full, 0, 1);
  const ticks = [];
  for (let i = 1; i <= T.gaugeTicks; i++) {
    const f = i / (T.gaugeTicks + 1);
    ticks.push(`<i style="bottom:${(f * 100).toFixed(1)}%">${fmt(Math.round(full * f))}</i>`);
  }
  $('gaugeTicks').innerHTML = ticks.join('');
  /* Set from zero on the next frame so the bar animates up rather than
     appearing already full. */
  $('gaugeFill').style.height = '0%';
  $('gaugeMark').style.bottom = '0%';
  setTimeout(() => {
    $('gaugeFill').style.height = (frac * 100).toFixed(1) + '%';
    $('gaugeMark').style.bottom = (frac * 100).toFixed(1) + '%';
  }, 60);

  $('rStars').innerHTML = [0, 1, 2].map((i) => `<i class="${i < a.stars ? 'on' : ''}">★</i>`).join('');
  $('rRows').innerHTML = rows.map((x) =>
    `<div class="rrow"><span class="rk">${x[0]}</span><span class="rd">${x[1]}</span><span class="rv">${x[2]}</span></div>`
  ).join('');
  $('rTotal').textContent = '$' + fmt(a.value);
  resultEl.classList.remove('hidden');
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
/* Whether a pointer event landed on the UI rather than on the game.

   The steering handlers live on `window` so a drag can start anywhere on the
   screen, which is right during a run and wrong over a menu: `ptMove` calls
   preventDefault() on every drag it owns, so a swipe meant to scroll the shop
   was being eaten by the steering. Combined with touch-action on body it made
   the upgrade list unscrollable, and the START button sits below it. */
const onUI = (e) => !!(e.target && e.target.closest && e.target.closest('.modal'));

function ptDown(e) {
  /* Audio still needs the gesture even when the tap was on a menu - Chrome
     refuses to build an AudioContext outside one. */
  sfx.init();
  if (onUI(e)) { dragId = null; return; }
  const t = e.changedTouches ? e.changedTouches[0] : e;
  dragId = t.identifier !== undefined ? t.identifier : 'mouse';
  dragX = t.clientX; dragStartX = run.targetX;
  if (hintTimer > 0) hintTimer = 0.01;
}
function ptMove(e) {
  if (dragId === null || onUI(e)) return;
  const list = e.changedTouches ? e.changedTouches : [e];
  for (const t of list) {
    const id = t.identifier !== undefined ? t.identifier : 'mouse';
    if (id !== dragId) continue;
    const dx = (t.clientX - dragX) / window.innerWidth;
    /* Minus, not plus, and this is the single most important sign in the game.

       The camera sits at a *lower* z than everything it looks at, because the
       stack runs toward +z and the camera has to be behind it. That is a 180
       degree rotation about Y, which mirrors the x axis: measured by projecting
       a point, world +2 lands at NDC -0.31. World +x is screen LEFT.

       Mapping a rightward drag to increasing x - the obvious thing, and what
       the first game on this stack shipped - inverts the controls, and it
       survived there for that game's whole life because every test drove the
       steering seam in world coordinates. `dragging right moves the stack
       right` in e2e drives real pointer events for exactly that reason. */
    run.targetX = clamp(dragStartX - dx * 8.0, -T.laneClamp, T.laneClamp);
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
  const depth = 14.0;
  const wantHalf = T.roadW / 2 + 0.5;
  const tan = wantHalf / (camera.aspect * depth);
  camera.fov = clamp(2 * Math.atan(tan) * 180 / Math.PI, 42, 78);
  camera.updateProjectionMatrix();
}
frameCamera();
document.addEventListener('visibilitychange', () => { if (document.hidden) save(); });

// ─────────────────────────────────────────────────────────────────────────────
// SIMULATION
// ─────────────────────────────────────────────────────────────────────────────
function step(dt) {
  run.time += dt;
  run.z += T.baseSpeed * dt;
  /* Clamped here, not only in the touch handler: an invariant about where the
     player can be belongs in the simulation that owns the position. */
  run.targetX = clamp(run.targetX, -T.laneClamp, T.laneClamp);
  run.x += (run.targetX - run.x) * smooth(T.steerSpeed, dt);
  ST.push(run.trail, run.x, run.z);

  const ahead = Math.floor((run.z + 100) / T.chunk);
  while (run.chunkSpawned < ahead) { run.chunkSpawned++; spawnChunk(run.chunkSpawned); }

  /* One layout per tick, shared by everything that needs to know where the
     candles are. Recomputing it per system would be three times the work and,
     worse, would let two systems disagree about where a candle is within the
     same frame. */
  const n = ST.layout(run.trail, count(), stackPos);

  updatePools(n);
  updateObstacles(dt, n);
  updateLoose(dt);
  updateNotes(dt);

  if (run.z >= BENCH_Z) finishLevel();
}

/* Pools treat CANDLES, not the tray.

   Each candle is tested against each pool it is standing in, and gets that
   pool's effect. That is the entire skill of the game: because the tray trails
   along the path the leader drove, sweeping left and right through a pair of
   pools puts some candles in one and some in the other - which the reference's
   own guide tells players to do, and which the shared-tray model this replaced
   made impossible.

   `mark` stops a candle being treated twice by the same pool while it is
   standing in it. Without it the glitter pool would max every candle the
   instant it touched them and lingering would be free. */
function updatePools(n) {
  const half = T.roadW / 2;
  for (let i = stations.length - 1; i >= 0; i--) {
    const st = stations[i];
    if (st.z < run.z - (ST.backFor(count() - 1) + T.poolLen)) { stations.splice(i, 1); continue; }
    if (Math.abs(st.z - run.z) > T.poolLen + 30) continue;

    const z0 = st.z - T.poolLen / 2, z1 = st.z + T.poolLen / 2;

    /* ROTATE is not a pool: it turns the whole loaf, once, as the leader
       crosses the plate. Handled here rather than in `apply` because it acts
       on the tray and not on a candle. */
    for (const h of [st.left, st.right]) {
      if (h.kind !== KIND_ROTATE || h.done) continue;
      const onIt = Math.abs(run.z - st.z) < 1.2 &&
        ((h === st.left && run.x < 0) || (h === st.right && run.x >= 0));
      if (!onIt) continue;
      h.done = true;
      TR.rotate(run.tray);
      popAt('ROTATE', '#ffffff', st.z);
      emit(run.x, 0.8, st.z, 22, 0xffffff, 2.2, 5);
      sfx.press(); shake(0.4); flash(0.16);
    }

    for (let k = 0; k < n; k++) {
      const p = stackPos[k];
      if (p.z < z0 || p.z > z1) continue;
      if (Math.abs(p.x) > half) continue;
      const h = p.x < 0 ? st.left : st.right;
      const r = run.tray[k];
      if (!r || r.mark === h.id) continue;
      r.mark = h.id;
      if (KINDS[h.kind].apply(h, r)) {
        run.dips++;
        if (!st.touched) {
          st.touched = true;
          popAt(KINDS[h.kind].label(h), '#' + KINDS[h.kind].colour(h).toString(16).padStart(6, '0'), st.z);
        }
        stationFx(h, p.x, p.z);
      }
    }
  }
  syncHUD();
}

/* Feedback per candle, rate-limited: twenty-seven candles crossing a pool in
   the same second would otherwise fire twenty-seven splashes and twenty-seven
   sounds, which is a wall of noise rather than a sense of the line working. */
let lastFx = -99;
function stationFx(h, x, z) {
  const k = KINDS[h.kind];
  if (run.time - lastFx < 0.09) return;
  lastFx = run.time;
  if (k.n === 'WAX') { emit(x, 0.5, z, 6, k.colour(h), 0.7, 4); sfx.dip(); }
  else if (k.n === 'GLITTER') { confetti(z, 12); sfx.sparkle(); }
  else if (k.n === 'PRESS') { emit(x, 0.6, z, 5, 0xb9f0ff, 0.7, 4); sfx.press(); shake(0.12); }
  else { emit(x, 0.7, z, 5, k.colour(h), 0.7, 4); sfx.wrap(); }
}

/* Obstacles test every candle, which is the reason the trail exists: checking
   the leader alone would make a long tray strictly better than a short one. */
function updateObstacles(dt, n) {
  for (let i = obstacles.length - 1; i >= 0; i--) {
    const o = obstacles[i];
    o.spin += dt * (o.kind === 'saw' ? 9 : 2.4);
    /* Set BEFORE the culling returns below, because the renderer reads o.x and
       a sweeper that only moved while it was collidable would visibly jump the
       moment it stopped being one. */
    if (o.kind === 'sweeper') o.x = o.amp * Math.sin(o.phase + run.z * 0.26 * o.dir);
    /* Kept alive exactly as long as the tail still has to clear them. */
    if (o.z < run.z - (ST.backFor(count() - 1) + 3)) { obstacles.splice(i, 1); continue; }
    if (o.hit || o.z > run.z + 4) continue;

    let struck = false;
    for (let k = 0; k < n; k++) {
      const p = stackPos[k];
      if (Math.abs(p.z - o.z) < 0.85 && Math.abs(p.x - o.x) < o.w + 0.34) { struck = true; break; }
    }
    if (!struck) continue;

    o.hit = true;
    const base = o.kind === 'barrier' ? T.barrierTake
      : o.kind === 'roller' ? T.rollerTake
      : o.kind === 'sweeper' ? T.sweeperTake : T.sawTake;
    const lost = TR.shrink(run.tray, takeOf(base));
    run.lost += lost;
    if (lost > 0) {
      pop('-' + lost, '#ff6b78', o.x, 2.2, o.z);
      emit(o.x, 1.0, o.z, 20, 0xffd0d8, 1.8, 5);
      sfx.smash(); shake(0.55); hitStop(80);
      vigFlash();
    } else {
      pop('EMPTY TRAY', '#ffb26b', o.x, 2.2, o.z);
      sfx.smash(); shake(0.2);
    }
    syncHUD();
  }
}

/* Loose candles on the runway: the growth mechanic. They join the BACK of the
   tray, bare, and have to be taken through the pools like everything else. */
function updateLoose(dt) {
  const mag = magnetR();
  for (let i = loose.length - 1; i >= 0; i--) {
    const c = loose[i];
    c.spin += dt * 2.2;
    const dz = c.z - run.z, dx = c.x - run.x;
    if (dz < -8) { loose.splice(i, 1); continue; }
    if (dz > 16) continue;
    const d2 = dx * dx + dz * dz;
    if (d2 < mag * mag) {
      const k = smooth(11, dt);
      c.x += (run.x - c.x) * k;
      c.z += (run.z - c.z) * k;
      if (d2 < 0.7) {
        loose.splice(i, 1);
        const got = TR.grow(run.tray, T.looseWorth);
        if (got > 0) {
          run.gained += got;
          emit(run.x, 1.0, run.z, 8, 0xfff0d0, 0.9, 5);
          sfx.gate();
        } else {
          /* Full tray. Say so, or a pickup that does nothing reads as a bug. */
          pop('TRAY FULL', '#ffe08a', run.x, 2.6, run.z);
          sfx.coin();
        }
        syncHUD();
      }
    }
  }
}

let vigT = null;
function vigFlash() {
  const v = $('vig');
  v.style.opacity = '0.8';
  clearTimeout(vigT);
  vigT = setTimeout(() => { v.style.opacity = '0'; }, 190);
}

function updateNotes(dt) {
  const mag = magnetR();
  for (let i = notes.length - 1; i >= 0; i--) {
    const b = notes[i];
    b.bob += dt * 3;
    const dz = b.z - run.z, dx = b.x - run.x;
    if (dz < -8) { notes.splice(i, 1); continue; }
    if (dz > 16) continue;
    const d2 = dx * dx + dz * dz;
    if (d2 < mag * mag) {
      const k = smooth(10, dt);
      b.x += (run.x - b.x) * k;
      b.z += (run.z - b.z) * k;
      if (d2 < 0.6) {
        notes.splice(i, 1);
        run.cash += T.cashPickup * priceMul();
        sfx.coin();
        syncHUD();
      }
    }
  }
}

function updateGlitter(dt) {
  for (const g of glit) {
    if (!g.live) continue;
    g.t += dt;
    g.vy -= 9 * dt;
    g.x += g.vx * dt; g.y += g.vy * dt; g.z += g.vz * dt;
    if (g.t > 1.7 || g.y < -1.5) g.live = false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// RENDER
// ─────────────────────────────────────────────────────────────────────────────
function buildClouds() {
  const c0 = Math.floor(run.z / 40) - 1;
  if (c0 === run.lastCloudWindow) return;
  run.lastCloudWindow = c0;
  clouds.length = 0;
  for (let c = c0; c < c0 + 8; c++) {
    for (let k = 0; k < 2; k++) {
      const side = hash(c, 700 + k) > 0.5 ? 1 : -1;
      clouds.push({
        x: side * (11 + hash(c, 710 + k) * 26),
        y: -7 - hash(c, 720 + k) * 9,
        z: c * 40 + hash(c, 730 + k) * 40,
        s: 1.8 + hash(c, 740 + k) * 2.6,
      });
    }
  }
}

/* Stacked-cylinder towers, well below the track and far to the sides. Rebuilt
   in windows like the clouds, because the alternative is holding a whole
   level of scenery for the sake of the eight towers on screen. Cosmetic, so it
   may draw from hash() without being part of the simulation - but hash keeps it
   stable as the camera moves back and forth, which Math.random would not. */
function buildSkyline() {
  const c0 = Math.floor(run.z / 60) - 1;
  if (c0 === run.lastSkyWindow) return;
  run.lastSkyWindow = c0;
  towers.length = 0;
  for (let c = c0; c < c0 + 6; c++) {
    for (let k = 0; k < 3; k++) {
      const side = hash(c, 3100 + k) > 0.5 ? 1 : -1;
      towers.push({
        x: side * (15 + hash(c, 3110 + k) * 24),
        y: -13 - hash(c, 3115 + k) * 7,
        z: c * 60 + hash(c, 3120 + k) * 60,
        s: 1.5 + hash(c, 3130 + k) * 1.5,
        n: 2 + Math.floor(hash(c, 3140 + k) * 3.4),
      });
    }
  }
}

/* The stack: one instance per band per candle, all in the layer whose geometry
   matches the pressed mould. */
/* The tray, drawn as ONE LONG LOAF lying along the runway.

   Each candle lies ACROSS the lane with its bands running along its length and
   its gold tip poking out of the left edge of the loaf, packed tight against
   its neighbours. That silhouette is the reference's, and it is what makes the
   per-candle colours readable: you look down the top faces of thirty candles
   receding away, so a tray that wove through two pools is visibly striped in
   two colours and one that held a line is not.

   Two builds drew upright candles instead. Upright, three abreast, the tray
   was a hedge - you saw the front row and nothing else. */
function writeStack() {
  for (const L of C.band) L.reset();
  C.wick.reset(); C.ribbon.reset(); C.bow.reset(); C.spark.reset();
  let fN = 0;

  const n = ST.layout(run.trail, count(), stackPos);
  const lit = run.gift;

  for (let i = 0; i < n; i++) {
    const r = run.tray[i];
    if (!r) continue;
    const p = stackPos[i];
    const band = C.band[r.mould];
    const rad = CD.radii(r), xs = CD.bandYs(r);
    const bh = CD.bandHeight(r), len = CD.candleHeight(r);
    const wrapped = r.wrap > 0;

    /* Lying down: the band cylinders run along X. A gentle bob keeps a long
       loaf from reading as one rigid object; keyed on index and time, never
       random, so it does not jitter. */
    const bob = Math.sin(run.time * 5 - i * 0.4) * 0.03;
    QT.setFromAxisAngle(V.set(0, 0, 1), Math.PI / 2);

    if (wrapped) {
      /* After WRAP the candle is a wrapped present, which is exactly what the
         reference's loaf turns into at its gift station. */
      const w = WRAPS[r.wrap];
      const bw = len * 0.92, bh2 = rad[0] * 2.1;
      M2.compose(V2.set(p.x, bh2 * 0.5 + bob, p.z), QT.identity(), V.set(bw, bh2, T.trailGap * 0.94));
      C.ribbon.push(M2, CTMP.setHex(w.col));
      M2.compose(V2.set(p.x, bh2 + 0.06 + bob, p.z), QT.identity(), V.set(bw * 0.18, 0.16, T.trailGap * 1.02));
      C.bow.push(M2, CTMP.setHex(w.bow));
    } else {
      for (let b = 0; b < r.layers.length; b++) {
        const off = xs[b] - len / 2;
        M2.compose(V2.set(p.x + off, rad[b] + bob, p.z), QT, V.set(rad[b] * 2, bh, rad[b] * 2));
        CTMP.setHex(WAXES[r.layers[b]].col);
        if (r.glitter > 0) CTMP.lerp(WHITE, 0.10 * r.glitter);
        if (r.scent > 0) CTMP.lerp(SCENTC, 0.16);
        band.push(M2, CTMP);
      }
      /* The gold tip, poking out of the left edge of the loaf AS THE PLAYER
         SEES IT. World +x is screen left here - the camera looks along +z, so
         it is turned 180 degrees about Y - which is why this is a plus. */
      QT2.setFromAxisAngle(V.set(0, 0, 1), -Math.PI / 2);
      M2.compose(V2.set(p.x + len / 2 + T.wickH * 0.5, rad[0] + bob, p.z), QT2,
        V.set(rad[0] * 1.5, T.wickH, rad[0] * 1.5));
      C.wick.push(M2);
    }

    /* Glitter reads as specks sitting on the top of the loaf, not only as a
       lightened colour - the reference's sparkle is visibly ON the wax. */
    if (r.glitter > 0 && (i % 2 === 0)) {
      const sx = p.x + ((i * 37) % 13 - 6) * 0.13;
      M2.compose(V2.set(sx, rad[0] * 2 + 0.05 + bob, p.z), QT.identity(),
        V.set(0.09, 0.09, 0.09));
      C.spark.push(M2, CTMP.setHex(0xffffff));
    }

    QT2.setFromAxisAngle(V.set(1, 0, 0), -Math.PI / 2);
    M2.compose(V2.set(p.x, 0.03, p.z), QT2, V.set(len * 1.05, T.trailGap * 1.6, 1));
    W.shadow.push(M2);

    if (lit && i < Math.floor(run.giftT * 11)) {
      const fs = 0.3 + Math.sin(run.time * 19 + i) * 0.03;
      const ty = (wrapped ? rad[0] * 2.1 : rad[0] * 2) + 0.2;
      M2.compose(V2.set(p.x + len / 2 - 0.2, ty + fs, p.z), QT2.identity(), V.set(fs, fs * 2.0, fs));
      flames.setMatrixAt(fN, M2);
      M2.compose(V2.set(p.x + len / 2 - 0.2, ty + fs * 0.8, p.z), QT2.identity(),
        V.set(fs * 0.55, fs * 1.1, fs * 0.55));
      flameCores.setMatrixAt(fN, M2);
      fN++;
    }
  }

  for (const L of C.band) L.flush();
  C.wick.flush(); C.ribbon.flush(); C.bow.flush(); C.spark.flush();
  flames.count = flameCores.count = fN;
  flames.instanceMatrix.needsUpdate = true;
  flameCores.instanceMatrix.needsUpdate = true;
  if (fN > 0) {
    giftLight.position.set(run.x, 2.0, run.z + 1.0);
    giftLight.intensity = 6 + fN * 2.6;
  } else {
    giftLight.intensity = 0;
  }
}

function writeWorld() {
  for (const k in W) if (k !== 'shadow') W[k].reset();

  // lane stripes, the main sense of speed, and the rails beside them
  const s0 = Math.floor((run.z - 16) / 3.2);
  for (let i = 0; i < 44; i++) {
    const z = (s0 + i) * 3.2;
    M2.makeTranslation(0, 0.02, z);
    W.stripe.push(M2);
    for (let s = 0; s < 2; s++) {
      M2.makeTranslation((s ? 1 : -1) * (T.roadW / 2 + 0.1), 0.36, z);
      W.rail.push(M2);
    }
  }

  buildSkyline();
  for (const t of towers) {
    let y = t.y;
    for (let k = 0; k < t.n; k++) {
      /* Each drum a little narrower than the one under it, which is what makes
         a plain cylinder stack read as a candle rather than as a chimney. */
      const r = t.s * (1 - k * 0.13), h = t.s * (1.5 + (k % 2) * 0.5);
      M2.compose(V2.set(t.x, y + h / 2, t.z), QT.identity(), V.set(r, h, r));
      W.tower.push(M2);
      y += h;
    }
    M2.compose(V2.set(t.x, y + t.s * 0.5, t.z), QT.identity(), V.set(t.s, t.s, t.s));
    W.towerTip.push(M2);
  }

  buildClouds();
  for (const c of clouds) {
    M2.compose(V2.set(c.x, c.y, c.z), QT.identity(), V.set(c.s, c.s * 0.62, c.s));
    W.cloud.push(M2);
  }

  for (const p of props) {
    M2.compose(V2.set(p.x, 1.5 * p.s, p.z), QT.identity(), V.set(p.s, p.s, p.s));
    W.pillar.push(M2);
    M2.compose(V2.set(p.x, 3.2 * p.s, p.z), QT.identity(), V.set(p.s, p.s, p.s));
    W.pTip.push(M2);
  }

  /* Loose candles lying on the runway, drawn with the plain mould so they read
     as unfinished stock rather than as something already decorated. */
  for (const c of loose) {
    const y = 0.34 + Math.sin(c.spin) * 0.05;
    /* Rotated about X so the cylinder lies ALONG the runway; the flame tip then
       sits at +z of the body rather than beside it. */
    QT.setFromAxisAngle(V.set(1, 0, 0), Math.PI / 2);
    M2.compose(V2.set(c.x, y, c.z), QT, V.set(0.5, 1.15, 0.5));
    W.looseC.push(M2, CTMP.setHex(0xfff0d0));
    M2.compose(V2.set(c.x, y, c.z + 0.72), QT, V.set(0.9, 0.9, 0.9));
    W.looseTip.push(M2);
  }

  for (const b of notes) {
    const y = 0.85 + Math.sin(b.bob) * 0.14;
    QT.setFromAxisAngle(V.set(0, 1, 0), b.bob * 0.4);
    M2.compose(V2.set(b.x, y, b.z), QT, ONE);
    W.cash.push(M2);
    M2.compose(V2.set(b.x, y + 0.05, b.z), QT, ONE);
    W.cashMark.push(M2);
  }

  for (const o of obstacles) {
    if (o.hit) continue;
    if (o.kind === 'barrier') {
      M2.compose(V2.set(o.x, 0.46, o.z), QT.identity(), ONE);
      W.barrier.push(M2);
      for (let k = 0; k < 2; k++) {
        QT.setFromAxisAngle(V.set(0, 0, 1), k ? 0.92 : -0.92);
        M2.compose(V2.set(o.x, 0.46, o.z - 0.15), QT, ONE);
        W.barX.push(M2);
      }
    } else if (o.kind === 'roller') {
      M2.compose(V2.set(o.x, 0.55, o.z), QT.identity(), ONE);
      W.rollBar.push(M2);
      for (let k = -1; k <= 1; k++) {
        QT.setFromAxisAngle(V.set(0, 0, 1), o.spin);
        M2.compose(V2.set(o.x + k * 0.95, 0.55, o.z), QT, ONE);
        W.roller.push(M2);
      }
    } else if (o.kind === 'sweeper') {
      /* Angled about Y, so it is a diagonal bar rather than a wall - the
         difference between "you cannot pass" and "there is a way round it". */
      const a = 0.30 * o.dir;
      QT.setFromAxisAngle(V.set(0, 1, 0), a);
      M2.compose(V2.set(o.x, 0.55, o.z), QT, ONE);
      W.sweeper.push(M2);
      for (let k = 0; k < 4; k++) {
        const t = (k - 1.5) * 0.66;
        M2.compose(V2.set(o.x + t * Math.cos(a), 0.55, o.z - t * Math.sin(a)), QT, ONE);
        W.sweepMark.push(M2);
      }
    } else {
      QT.setFromAxisAngle(V.set(0, 0, 1), Math.PI / 2)
        .premultiply(new THREE.Quaternion().setFromAxisAngle(V.set(1, 0, 0), o.spin));
      M2.compose(V2.set(o.x, 1.0, o.z), QT, ONE);
      W.saw.push(M2);
      M2.compose(V2.set(o.x, 1.3, o.z + 0.32), QT.identity(), ONE);
      W.sawPost.push(M2);
    }
  }

  /* The display counter, moved WELL past the finish line. It used to sit two
     units beyond it, which put a six-metre white slab directly between the
     end-of-run camera and the thing it was framing: the shot was mostly table
     corner. The rule this is an instance of - a prop placed relative to where
     the player STOPS has to clear where the camera goes when they stop. */
  if (BENCH_Z - run.z < 150) {
    M2.compose(V2.set(0, 1.25, BENCH_Z + 15), QT.identity(), V.set(1.5, 1, 1.6));
    W.bench.push(M2);
    for (let i = 0; i < 4; i++) {
      M2.compose(V2.set((i % 2 ? 1 : -1) * 4.2, 0.65, BENCH_Z + (i < 2 ? 14 : 16)), QT.identity(), ONE);
      W.benchLeg.push(M2);
    }
  }

  for (const k in W) W[k].flush();
}

function writeStations() {
  let i = 0;
  for (const st of stations) {
    if (i >= stationPool.length) continue;
    if (st.z < run.z - T.poolLen || st.z > run.z + 120) continue;
    stationPool[i].set(st, run.time);
    i++;
  }
  for (let k = i; k < stationPool.length; k++) stationPool[k].hide();
}

function writeGlitter() {
  let n = 0;
  for (const g of glit) {
    if (!g.live) continue;
    gPos[n * 3] = g.x; gPos[n * 3 + 1] = g.y; gPos[n * 3 + 2] = g.z;
    gCol[n * 3] = g.r; gCol[n * 3 + 1] = g.g; gCol[n * 3 + 2] = g.b;
    n++;
  }
  gGeo.setDrawRange(0, n);
  gGeo.attributes.position.needsUpdate = true;
  gGeo.attributes.color.needsUpdate = true;
}

function updatePops(dt) {
  for (const p of popPool) {
    if (!p.live) continue;
    p.t += dt;
    if (p.t > 1.0) { p.live = false; p.el.style.opacity = '0'; continue; }
    V.set(p.x, p.y + p.t * 1.7, p.z).project(camera);
    const sx = (V.x * 0.5 + 0.5) * window.innerWidth;
    const sy = (-V.y * 0.5 + 0.5) * window.innerHeight;
    p.el.style.transform = `translate3d(${sx.toFixed(0)}px, ${sy.toFixed(0)}px, 0) translate(-50%,-50%) scale(${(1 + (1 - p.t) * 0.5).toFixed(2)})`;
    p.el.style.opacity = String(clamp(1.6 - p.t * 1.6, 0, 1));
  }
}

function updateWorldObjects() {
  road.position.z = run.z + 600;
  railL.position.z = railR.position.z = run.z + 600;
}

// ─────────────────────────────────────────────────────────────────────────────
// LOOP
// ─────────────────────────────────────────────────────────────────────────────
let last = performance.now(), lastDt = 0.016;
const camPos = new THREE.Vector3();
const camLook = new THREE.Vector3();
let harnessFrozen = false;

function frame(now) {
  requestAnimationFrame(frame);
  let dt = (now - last) / 1000;
  last = now;
  if (dt > 0.05) dt = 0.05;
  if (!harnessFrozen) tick(dt);
}

/* `draw` exists only for the headless harness. Everything above the final line
   builds the frame - instance matrices, camera, HUD - and none of it reads back
   from the renderer, so skipping the rasterisation leaves the simulation
   bit-for-bit identical. */
function tick(dt, draw = true) {
  lastDt = dt;

  if (run.hitStop > 0) {
    run.hitStop -= dt;
  } else if (run.active && !run.over) {
    step(dt);
  }
  if (run.gift) { run.giftT += dt; run.time += dt; }
  updateGlitter(dt);

  /* At the table the camera swings around in front of the stack, so the player
     is looking at the row of candles they made, lit, rather than at the back of
     their own tray. */
  const done = run.gift;
  if (done) {
    /* Swing out and back far enough to hold the WHOLE tray in frame.

       The tray is nine rows deep at a full stack, so a close orbit puts the
       camera inside it and the player sees three candles at the moment they
       are supposed to be admiring twenty-seven. The pull-back scales with how
       many rows there actually are. */
    /* Stay BEHIND the loaf and swing out to one side, rather than getting in
       front of it. In front means the camera crosses the finish line, and
       everything the level put beyond the finish line - the counter, the shop
       fronts - ends up between the lens and the candles. Behind, the loaf
       recedes away from the camera and the shops are the backdrop. */
    const k = clamp(run.giftT * 0.5, 0, 1);
    const depth = clamp(ST.backFor(count() - 1), 2, 14);
    const mid = run.z - depth * 0.5;
    camPos.set(run.x + 8.5 * k, 4.4 + depth * 0.18, mid - (11.0 + depth * 0.5));
  } else {
    /* The camera opens up as the stack lengthens.

       The stack trails *behind* the leader and the camera sits behind that, so
       a fixed offset puts the tail a couple of units from the lens: at nine
       candles the back half of the tray filled the bottom third of the screen
       and the runway ahead - the part you steer by - was squeezed into a strip.
       Pulling back and rising with the stack keeps the whole tray in frame,
       and it doubles as feedback, because growing the batch visibly widens the
       shot. Clamped, or a full tray would put the camera in orbit. */
    const tail = clamp(ST.backFor(count() - 1), 0, 16);
    /* Low and flat, not high and looking down.

       The bands run horizontally around each candle, so they are only legible
       from the side. A high camera sees the tops, the newest band covers the
       lens, and a three-colour tray reads as one colour - which is exactly
       what the first pass did. */
    camPos.set(run.x * 0.55, 4.6 + tail * 0.20, run.z - 12.8 - tail * 0.60);
  }
  camera.position.lerp(camPos, smooth(done ? 2.2 : 9, dt));
  if (run.shake > 0) {
    run.shake = Math.max(0, run.shake - dt * 2.6);
    const s = run.shake * run.shake * 0.5;
    camera.position.x += (Math.random() - 0.5) * s;
    camera.position.y += (Math.random() - 0.5) * s;
  }
  const giftMid = run.z - clamp(ST.backFor(count() - 1), 0, 14) * 0.2;
  camLook.set(done ? run.x * 0.7 : run.x * 0.35, done ? 1.4 : 2.7,
    done ? giftMid : run.z + 12.0);
  camera.lookAt(camLook);
  sun.position.set(camera.position.x - 8, camera.position.y + 16, camera.position.z - 6);
  sun.target.position.set(run.x, 0, run.z);
  sun.target.updateMatrixWorld();

  updateWorldObjects();
  W.shadow.reset();
  writeStack();       // pushes stack shadows into W.shadow
  writeWorld();       // ...so W is flushed after it
  writeStations();
  writeGlitter();
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
  if (location.search.indexOf('debug') >= 0) {
    window.__CR = {
      run, S, tick,

      /* Hand the clock to the harness. Real rAF frames run between page load
         and the first advance(), and how many depends on how fast this machine
         boots the bundle - which quietly makes every recorded number a function
         of the test runner's mood. freeze() stops the rAF tick and restarts the
         level, so advance(n) is exactly n seconds from a clean start on any
         machine. */
      freeze: () => { harnessFrozen = true; startLevel(); },

      /* Only the last frame of a run is drawn. Measured on this stack: a tick
         costs 0.28 ms with a real GPU and ~17 ms on the software rasteriser a
         headless browser falls back to. Nothing in renderer.render() feeds back
         into game state, so dropping the intermediate frames changes no number
         the harness reads - and drawing the last one keeps
         renderer.info.render.calls and every InstancedMesh count honest. */
      advance: (secs, stepDt, draw = true) => {
        const d = stepDt || 0.016;
        const n = Math.max(1, Math.round(secs / d));
        for (let i = 0; i < n; i++) tick(d, draw && i === n - 1);
      },
      state: () => {
        const st = TR.statsOf(run.tray, WAXES.length);
        return {
          z: run.z, count: count(),
          avgColours: +st.avgColours.toFixed(4),
          avgGlitter: +st.avgGlitter.toFixed(4),
          pressed: st.pressed, wrapped: st.wrapped, plain: st.plain,
          worth: Math.round(TR.trayValue(run.tray)),
          cash: Math.round(run.cash), lost: run.lost, gained: run.gained, dips: run.dips,
          stations: stations.length, obstacles: obstacles.length,
          notes: notes.length, loose: loose.length,
          over: run.over, coins: S.coins, level: S.level,
          calls: renderer.info.render.calls,
        };
      },
      steer: (x) => { run.targetX = x; },
      T, WAXES, MOULDS, WRAPS, KINDS,
      tray: () => run.tray,
      trayStats: () => TR.statsOf(run.tray, WAXES.length),
      result: () => lastResult,
      appraiseNow: () => appraise(run.tray, {
        cash: run.cash, earnMul: earnMul(), priceMul: priceMul(),
      }),
      /* The live stack positions, which is what an obstacle actually tests
         against. Exposed because "did the tail get clipped" is otherwise
         invisible from outside. */
      stackAt: () => {
        const n = ST.layout(run.trail, count(), stackPos);
        return stackPos.slice(0, n).map((p) => ({ x: p.x, z: p.z }));
      },
      stations: () => stations, loose: () => loose,
      obstacles: () => obstacles, notes: () => notes,
      three: THREE, scene, camera, renderer, C, W, flames, giftLight, OUTLINE_MAT,
    };
  }
  if (S.seenShop) {
    run.active = false;
    resultEl.classList.add('hidden');
    openShop('THE WORKSHOP', `LEVEL ${S.level}  ·  BEST $${fmt(S.bestValue)}`);
  }
  requestAnimationFrame(frame);
}
boot();
