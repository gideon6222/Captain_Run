// Candle Gift - a candle factory runner.
// See NOTES.md for design decisions and CLAUDE.md for the shape of the repo.

import * as THREE from 'three';
import { VERSION, CHANGELOG } from './changelog.js';
/* Extensionless because these are TypeScript. Vite resolves `./util` to
   util.ts; it will not resolve `./util.js` from inside a .js file, since that
   rewrite only happens for TS importers. main.js is the last JS module left
   and each extraction shrinks it - when it goes, these become `.js` like the
   TS files' own imports. */
import { clamp, lerp, smooth, hash, fmt, makeRng } from './util';
import { T, WAXES, WORKSHOPS, MOULDS, WRAPS } from './tuning';
import * as TU from './tuning';
import * as CD from './candle';
import * as TR from './tray';
import * as ST from './stack';
import { appraise } from './appraise';
import { load, save as writeSave, KEY as SAVE_KEY } from './save';
import { loadSettings, saveSettings, clampSens, SENS_MIN, SENS_MAX } from './settings';
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
/* One-way latch, set the moment the player erases their save.

   Without it, clearing is undone by the game itself: `save()` runs on
   `visibilitychange`, a reload fires that in most browsers, and the outgoing
   page writes live state straight back over the key it was just asked to
   delete. The same trap the e2e harness works around by freezing
   `Storage.prototype.setItem`, arrived at from the other direction. */
let wiped = false;
const save = () => { if (!wiped) writeSave(S); };

/* Preferences, on their own key. See `settings.ts` for why they are not part
   of the save. */
const SET = loadSettings();

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
/* THE STANDING FORM: A ROW, NOT A STACK.

   ROTATE stands every candle upright ON THE SPOT, so the batch becomes a line
   of individual candles marching down the track, each one keeping its own place
   on the recorded path. It does NOT pile them into a tower.

   The first pass did stack them - candle `i` at height `i` - because a row of
   upright candles packed tightly and seen from behind reads as a column, and
   that is what the reference's footage looks like at a glance. It is wrong, and
   it costs the game the thing standing up is FOR: a candle at head height
   cannot be dipped by a pool on the ground or stamped by a press, and the whole
   batch is treated as one object again. A row can be stamped one at a time,
   which is what the press at 19s in the walkthrough is doing to four candles
   standing beside it.

   Spacing along the path does NOT change when the batch stands up. It was
   tighter for a while, and that split the game in two: the simulation lays the
   candles out at `trailGap` to decide what a pool dips and what an obstacle
   clips, and the renderer was drawing them somewhere else. Standing changes
   which way a candle points, nothing else - so every candle still sits at its
   own point on the trail, and weaving survives ROTATE. */

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
  /* Loose candles are GOLD with a pale tip, not cream with a gold tip - which
     is what this had, exactly inverted from every screenshot of the reference.
     Gold reads as "pick this up" against a white runway; cream is the colour of
     the candles you already own. */
  looseC:   new Layer(new THREE.CylinderGeometry(0.5, 0.5, 1, 10), 0xffffff, 48, 0.028),
  looseTip: new Layer(new THREE.ConeGeometry(0.24, 0.46, 7), 0xfff4d8, 48, 0),
  /* Money is a price TAG - a rounded green tag with a punched hole at one end,
     lying flat on the track. */
  cash:     new Layer(box(1.15, 0.09, 0.60), 0x1fa84d, 40, 0.030),
  cashMark: new Layer(new THREE.CylinderGeometry(0.10, 0.10, 0.16, 8), 0xffffff, 40, 0),
  /* THE THREE OBSTACLES, drawn from the reference's own screenshots rather
     than inherited from the game this repo used to hold. Colours read off
     those screenshots: everything hazardous is CORAL, in the same family, so
     "this hurts" is one colour the player learns once.

     1. The hazard panel - a tall coral slab with a darker rim and white
        crosses, standing across part of the track.
     2. The spiked axle - a pale post at the track EDGE with a shaft reaching
        part way across, carrying a row of coral diamonds that turn. Anchoring
        it to a rail is not decoration: it is what guarantees the gap is on the
        other side.
     3. The sweeper - a thin salmon bar lying diagonally, with a big dark navy
        arrowhead at its outer end showing which way it is going and a couple
        of short dashes trailing behind it. The one that moves. */
  /* The hazard wall is a ROW OF PYRAMIDS on a low base, not a flat panel. Seen
     close in the store screenshots it is a stack of square panels each with a
     four-sided pyramid pushed out of it; seen at speed in the video it is a
     zigzag red wall with white crosses on it. A flat slab with an X was the
     third thing this build guessed at and the second it got wrong. */
  barrier:  new Layer(box(2.0, 0.52, 0.42), 0xf04a3c, 24, 0.055),
  barSpike: new Layer(new THREE.ConeGeometry(0.46, 0.78, 4), 0xf4665a, 72, 0.050),
  barX:     new Layer(box(0.62, 0.13, 0.09), 0xffffff, 96, 0),
  /* The diamonds OVERLAP along the axle - spaced 0.92 against a 0.74 radius -
     because a row of separated diamonds reads as beads on a string and a row
     that interlocks reads as one spiked drum, which is the thing in the
     reference. */
  spike:    new Layer(new THREE.OctahedronGeometry(0.74, 0), 0xf4665a, 44, 0.050),
  axle:     new Layer(new THREE.CylinderGeometry(0.12, 0.12, 1, 8), 0xcfc4da, 12, 0),
  axlePost: new Layer(box(0.40, 3.4, 0.40), 0x8f8299, 12, 0.045),
  sweeper:  new Layer(box(3.4, 0.30, 0.34), 0xff7a5c, 10, 0.045),
  sweepTip: new Layer(new THREE.ConeGeometry(0.44, 0.9, 4), 0x1e3a6e, 12, 0),
  sweepDash: new Layer(box(0.46, 0.13, 0.15), 0xff9c82, 44, 0),
  /* The skyline: pale stacked-cylinder towers well below the track, like giant
     candle stacks. Straight off the reference, and the only thing that gives
     the sky any depth once a cloud has drifted past. */
  /* Rings on the surface of the wax. THIS is what makes a pool read as liquid
     rather than as a coloured slab: not the texture on it but the fact that it
     ANSWERS. One ring where the ladle pours, one under every candle standing in
     it, and one that expands from each dip. A photoreal normal map would give
     the surface relief and still leave it dead. */
  ripple:   new Layer(new THREE.TorusGeometry(0.5, 0.055, 5, 16), 0xffffff, 90, 0),
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
W.ripple.mesh.material = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, depthWrite: false });

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

      /* A VAT, not a decal. The reference's wax stands proud of the track with
         a visible side wall and a thick marbled top - you can see the depth of
         it from the side, and that is most of why its stations read as
         machinery holding real liquid. A flat plane on the road surface reads
         as paint, which is what this was. */
      const w = T.roadW / 2 - T.poolInset * 2;
      const tank = new THREE.Group();
      const wall = new THREE.Mesh(box(w + 0.34, 0.40, T.poolLen + 0.34), toon(0xffffff));
      wall.position.y = 0.18;
      const liquid = new THREE.Mesh(box(w, 0.34, T.poolLen), new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: true, opacity: 0.98, map: swirlTex(),
      }));
      liquid.position.y = 0.24;
      /* The ring where the pour lands. It is the one thing that says the ladle
         above is actually connected to the wax below. */
      const splash = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.10, 6, 14),
        new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 }));
      splash.rotation.x = -Math.PI / 2;
      splash.position.set(0, 0.42, -T.poolLen / 2 + 1.4);
      tank.add(wall, liquid, splash);

      /* The machine over it. A ladle that tips and pours, a glitter bottle
         that shakes, a ram that slams, a gift box, or ROTATE's arrow plate.
         The reference's single most "satisfying" quality is watching these
         work, so they all animate. */
      const headG = new THREE.Group();
      /* A big chrome ladle on a stick, and a THICK stream out of it. The
         reference's ladle is most of a lane wide and the pour is a rope of wax,
         not a trickle - at 0.42 and 0.13 this read as a lollipop. */
      /* Chrome, not wax-coloured: the reference's ladle is a pale metal sphere
         and only the stream out of it is the colour of what it is pouring. A
         bowl painted the same colour as the pool below it reads as a ball
         resting on the track. */
      const bowl = new THREE.Mesh(new THREE.SphereGeometry(0.62, 14, 9), toon(0xeef3f8));
      const pour = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.30, 3.0, 10), new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: true, opacity: 0.95,
      }));
      pour.position.y = -1.85;
      const gift = new THREE.Mesh(box(1.5, 1.4, 1.5), toon(0xffd429));
      const giftBow = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.16, 6, 10), toon(0xff3d92));
      giftBow.position.y = 0.78; giftBow.rotation.x = Math.PI / 2;
      gift.add(giftBow);
      /* THE DIE. One mesh per mould shape, and only the one being pressed is
         shown - so the machine standing over the track is visibly the shape the
         candles come out as. The reference's press is a fat fluted column with
         a yellow flower on its face, and the flower is the cross-section you
         get. A press that stamps an invisible shape is a multiplier with a
         gantry over it, which is what this was. */
      const dies = MOULD_GEO.map((geo) => {
        const d = new THREE.Mesh(geo, toon(0xff3d92));
        d.scale.set(2.4, 2.0, 2.4);
        const face = new THREE.Mesh(geo, toon(0xffd429));
        face.scale.set(0.62, 0.30, 0.62);
        face.position.y = -0.72;
        d.add(face);
        d.visible = false;
        return d;
      });
      const plate = new THREE.Mesh(box(T.roadW / 2 - 0.3, 0.18, 2.6), toon(0xffffff));
      const arrowM = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1.1, 4), toon(0xff3d92));
      arrowM.rotation.z = -Math.PI / 2; arrowM.position.y = 0.35;
      plate.add(arrowM);
      headG.add(bowl, pour, gift, plate, ...dies);
      headG.position.set(side * 0.1, 2.15, -T.poolLen / 2 + 1.4);

      g.add(arm, post, sign, tank, headG);
      this.group.add(g);
      return { g, arm, post, sign, tank, wall, liquid, splash, headG, bowl, pour, gift, plate, dies };
    });

    this.group.visible = false;
    scene.add(this.group);
  }
  set(st, t, px = 0, pz = -999) {
    this.group.visible = true;
    this.group.position.set(0, 0, st.z);
    /* How far the batch is through this station, 0 before and 1 after. Used to
       aim the pour: a ladle that tips at nothing while the candles go by
       underneath is the difference between a machine and a decoration. */
    const through = clamp((pz - (st.z - T.poolLen / 2)) / T.poolLen, 0, 1);
    const busy = through > 0.02 && through < 0.98;
    for (let i = 0; i < 2; i++) {
      const h = i ? st.right : st.left;
      const k = KINDS[h.kind];
      const p = this.half[i];
      /* Which side of the runway this half is on. `set()` is a different scope
         from the constructor, where the halves were built. */
      const side = i ? 1 : -1;
      p.sign.material.map = signTex(k.label(h), k.sub(h), k.accent);
      p.sign.material.needsUpdate = true;

      const col = k.colour(h);
      p.tank.visible = k.machine !== 'arrow';
      p.liquid.material.color.setHex(col);
      p.liquid.material.opacity = k.liquid ? 0.98 : 0.30;
      /* Only a wax or scent station is a tank of liquid. Glitter, the press and
         the gift box get a shallow mat instead, or the runway grows a bathtub
         under a machine that never pours anything into it. */
      p.wall.visible = k.liquid;
      /* A DARKER shade of the same wax, so the rim of the tank reads against
         the surface it holds. At the same colour the whole thing flattens into
         a carpet, which is what a full-width flat plane already looked like. */
      CTMP.setHex(col).multiplyScalar(0.62);
      p.wall.material = toon(CTMP.getHex());
      p.liquid.scale.y = k.liquid ? 1 : 0.12;
      p.liquid.position.y = k.liquid ? 0.24 : 0.03;
      const beat = t * 2.2 + i * 0.7 + st.z * 0.11;
      p.splash.visible = k.liquid;
      p.splash.material.color.setHex(col);
      const sp = 1 + Math.sin(beat * 4.1) * 0.18;
      p.splash.scale.set(sp, sp, 1);
      /* Under the ladle, wherever it has gone. */
      p.splash.position.set(p.headG.position.x, 0.42, p.headG.position.z);

      p.bowl.visible = p.pour.visible = (k.machine === 'ladle' || k.machine === 'bottle');
      p.gift.visible = k.machine === 'gift';
      if (k.machine !== 'ram') for (const d of p.dies) d.visible = false;
      p.plate.visible = k.machine === 'arrow';
      p.headG.visible = k.machine !== 'ram' || true;

      if (k.machine === 'ladle' || k.machine === 'bottle') {
        p.bowl.material = toon(k.machine === 'bottle' ? col : 0xeef3f8);
        p.pour.material.color.setHex(col);
        /* THE LADLE FOLLOWS THE CANDLES. It slides across its own half to sit
           over wherever the batch is, and rides down the pool with it, so the
           stream lands on the wax the player is actually dragging through -
           which is the whole read of "it is pouring on my candles". */
        const half = T.roadW / 4;
        const want = clamp(px - side * half, -half + 0.6, half - 0.6);
        p.headG.position.x = busy ? lerp(p.headG.position.x, want, 0.18) : side * 0.1;
        p.headG.position.z = busy
          ? lerp(p.headG.position.z, (through - 0.5) * T.poolLen * 0.75, 0.12)
          : -T.poolLen / 2 + 1.4;
        p.headG.position.y = 2.90 + Math.sin(beat) * 0.14;
        /* Tipped further, so it reads as pouring rather than as hovering. */
        p.headG.rotation.z = 0.30 + Math.sin(beat * 0.7) * 0.42;
        p.pour.scale.y = 0.9 + Math.sin(beat * 3) * 0.16;
        p.pour.scale.x = p.pour.scale.z = 1 + Math.sin(beat * 4.1) * 0.12;
      } else if (k.machine === 'ram') {
        p.bowl.visible = false; p.pour.visible = false;
        for (let d = 0; d < p.dies.length; d++) p.dies[d].visible = (d === h.mould);
        /* Slams to the deck and holds a beat at the bottom, rather than
           bobbing: a press that never reaches the wax is a press that is not
           pressing anything. */
        const drop = Math.pow(Math.max(0, Math.sin(beat * 1.7)), 0.55);
        p.headG.position.y = 3.0 - drop * 2.3;
        p.headG.rotation.z = 0;
        p.headG.rotation.y = beat * 0.25;
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
  /* 0 lying flat, 1 stood up. Animated, because the moment the batch rears up
     is the most dramatic thing in a run and snapping it wastes it. */
  standing: false, standT: 0,
};
const count = () => run.tray.length;
let lastResult = null;
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
  /* A level is BUILT here and STARTED by the first swipe. The reference sits on
     its home screen with the runway live behind it - the shop button, the two
     boost cards and the swipe arrow are over a world that is already there -
     and the run begins the moment you touch the screen. */
  run.active = false; run.over = false; run.gift = false;
  run.z = 0; run.x = 0; run.targetX = 0; run.time = 0;
  run.tray = TR.newTray(startCandles());
  ST.seedTrail(run.trail, 0, 0);
  run.cash = 0; run.lost = 0; run.gained = 0; run.dips = 0;
  run.chunkSpawned = -1;
  run.scale = TU.scaleFor(S.level);
  run.workshop = (S.level - 1) % WORKSHOPS.length;
  run.shake = 0; run.hitStop = 0; run.giftT = 0;
  run.standing = false; run.standT = 0;
  run.lastCloudWindow = -999;
  run.lastSkyWindow = -999;
  stationSeq = 0;
  stations.length = 0; obstacles.length = 0;
  notes.length = 0; loose.length = 0; props.length = 0;
  for (const g of glit) g.live = false;
  giftLight.intensity = 0;
  applyWorkshop(WORKSHOPS[run.workshop]);
  shopScreenEl.classList.add('hidden');
  rewardEl.classList.add('hidden');
  rulerEl.classList.add('hidden');
  toast(WORKSHOPS[run.workshop].name, 1.4);
  lastHud = {};
  syncHUD();
  openHome();
}

/* The home screen: not a sheet over a frozen game, a layer over a live one. */
function openHome() {
  homeEl.classList.remove('hidden');
  renderBoosts();
  syncPauseBtn();
}
function startRun() {
  if (run.active || run.over) return;
  homeEl.classList.add('hidden');
  run.active = true;
  last = performance.now();
  applyBoosts();
  syncPauseBtn();
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
    /* Anchored at one rail and reaching PART WAY across, the way the reference
       draws it - a post at the edge with the axle over the track. `x` and `w`
       are then just the centre and half-width of what it covers, so the shared
       collision test needs to know nothing about any of this. */
    const side = hash(c, 700 + S.level) > 0.5 ? 1 : -1;
    /* How far in it reaches. Capped well short of the far rail: at up to 4.05
       the axle covered all but a sliver of the runway, so clearing it meant
       committing the whole loaf to the far edge and back, and the seconds that
       costs come straight out of the next pool. Measured, that alone took the
       weaving bot from 39,134 to 31,247 without costing it a single extra
       candle - the damage was to what it had time to do, not to what it had. */
    const reach = T.laneClamp * (0.70 + hash(c, 702 + S.level) * 0.40);
    obstacles.push({
      kind: 'roller', side, reach,
      x: side * (T.roadW / 2 - reach / 2), w: reach / 2,
      z: z + 5 + hash(c, 705) * 3, hit: false, spin: hash(c, 710) * 6.28,
    });
  }
  /* Nothing took over the slot the saw used to fill, and that is deliberate.
     Backfilling it with a third barrier kept the runway equally dangerous and
     cost the game its point: measured, the extra hazard pulled the weaving bot
     down from 3 stars to 2 and from 39,134 to 32,469, because every second
     spent dodging is a second not spent in a pool. **Removing an obstacle kind
     means removing its share of the danger, not redistributing it.** */
  void r3;
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
        /* Which way it happens to be lying. Cosmetic, but drawn from hash so it
           does not change under the camera. */
        lie: (hash(c, 970 + i) - 0.5) * 1.5,
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
/* Rings spreading on the wax. A ring is (place, age, colour); it grows and
   fades over its life and is then reused. Cosmetic, so `Math.random` is fine
   for the jitter - none of it decides when anything happens. */
const RIPPLES = 40;
const ripples = [];
for (let i = 0; i < RIPPLES; i++) ripples.push({ live: false, x: 0, z: 0, t: 0, life: 1, r0: 0.3, col: 0xffffff });
let rippleCursor = 0;
function ripple(x, z, col, life = 0.9, r0 = 0.28) {
  const p = ripples[rippleCursor];
  rippleCursor = (rippleCursor + 1) % RIPPLES;
  p.live = true; p.x = x; p.z = z; p.t = 0; p.life = life; p.r0 = r0; p.col = col;
}
function updateRipples(dt) {
  for (const p of ripples) {
    if (!p.live) continue;
    p.t += dt;
    if (p.t >= p.life) p.live = false;
  }
}
function writeRipples() {
  for (const p of ripples) {
    if (!p.live) continue;
    const k = p.t / p.life;
    const r = p.r0 + k * 1.5;
    QT2.setFromAxisAngle(V.set(1, 0, 0), -Math.PI / 2);
    M2.compose(V2.set(p.x, 0.44, p.z), QT2, V.set(r, r, 1 - k * 0.6));
    W.ripple.push(M2, CTMP.setHex(p.col).lerp(WHITE, 0.45 + k * 0.4));
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
const hudCoins = $('coins');
const levelEl = $('level'), toastEl = $('toast');
const shopScreenEl = $('shopScreen'), shopEl = $('shop'), flashEl = $('flash');
const homeEl = $('home'), rulerEl = $('ruler'), rewardEl = $('reward');

let toastT = 0;
function toast(msg, dur) { toastEl.textContent = msg; toastEl.style.opacity = '1'; toastT = dur || 1.1; }

let lastHud = {};
/* THREE THINGS. The reference's HUD is the settings gear, the level and the
   money, and nothing else - no candle count, no running value, no colour chips,
   no progress bar. Every one of those was ours, and together they were most of
   why a screenshot of this game did not look like a screenshot of that one.

   What it uses instead is the floating green +N$ over the tray, which is
   `pop()` and already here. */
function syncHUD() {
  if (lastHud.c !== S.coins) { hudCoins.textContent = fmt(S.coins); lastHud.c = S.coins; }
  if (lastHud.l !== S.level) { levelEl.textContent = 'Level ' + S.level; lastHud.l = S.level; }
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
/* THE TWO BOOST CARDS on the home screen, straight off the reference: a pink
   CANDLE card reading EXTRA +1 and a green CASH card reading BONUS x1.5, each
   with a coin price. They are bought BEFORE a run and last one run, which is a
   different thing from an upgrade and the reason the shop is not a stat list.

   The reference offers them free for a rewarded video. There are no ads here,
   so they cost coins. */
const BOOSTS = {
  candle: { n: () => 3 + S.up.earn, cost: () => 300 + S.level * 60 },
  cash:   { n: () => 1.5,           cost: () => 300 + S.level * 60 },
};
let boost = { candle: false, cash: false };

function renderBoosts() {
  $('boostCandleN').textContent = String(BOOSTS.candle.n());
  $('boostCashN').textContent = BOOSTS.cash.n().toFixed(1);
  for (const k of ['candle', 'cash']) {
    const btn = $('boost' + k[0].toUpperCase() + k.slice(1));
    const cost = BOOSTS[k].cost();
    $('boost' + k[0].toUpperCase() + k.slice(1) + 'C').textContent = boost[k] ? 'ON' : fmt(cost);
    /* Greyed only when already bought, never when merely unaffordable. The
       reference keeps both cards bright with a price on them; a card that dims
       the moment you are short reads as broken rather than as expensive. */
    btn.disabled = boost[k];
  }
}
function buyBoost(k) {
  if (boost[k]) return;
  const cost = BOOSTS[k].cost();
  if (S.coins < cost) { sfx.deny(); return; }
  S.coins -= cost; boost[k] = true;
  sfx.buy(); save(); renderBoosts(); syncHUD();
}
/* Applied at the moment the run starts, so buying a candle boost visibly adds
   candles to the slab sitting on the runway in front of you. */
function applyBoosts() {
  if (boost.candle) TR.grow(run.tray, BOOSTS.candle.n(), T.maxCandles);
  syncHUD();
}
const boostMul = () => (boost.cash ? BOOSTS.cash.n() : 1);

$('boostCandle').addEventListener('click', () => buyBoost('candle'));
$('boostCash').addEventListener('click', () => buyBoost('cash'));
$('btnShop').addEventListener('click', () => openShop());

/* THE SHOP IS SHOPS. Four of them, all named in the reference, all of which add
   or improve a STATION on the line rather than nudging a stat.

   Bigger Batch, Steady Tray, Long Reach, Deeper Vats and the Glitter Cannon
   used to live here. None of the five appears anywhere in six levels of
   footage; they were invented for this build, and a list of stat upgrades is
   the single most un-reference-like screen the game had. The count axis is now
   the CANDLE boost card, which is what the reference uses. */
const UPGRADES = [
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
];

function openShop() {
  renderShop();
  showBuildInfo();
  shopScreenEl.classList.remove('hidden');
  S.seenShop = true;
  save();
  syncPauseBtn();
}

/* Drawn as SHOP FRONTS with a green plus, the way the reference draws the
   panels beside its track, rather than as rows in a stat list. */
function renderShop() {
  $('sCoins').textContent = fmt(S.coins);
  $('sBest').textContent = fmt(S.bestValue);
  let html = '';
  for (const u of UPGRADES) {
    const lvl = S.up[u.id];
    const locked = S.best < u.unlock;
    const maxed = lvl >= u.max;
    const cost = u.cost();
    const afford = S.coins >= cost && !maxed && !locked;
    let btn;
    if (locked) btn = `<button class="plusbtn no" disabled>LV ${u.unlock}</button>`;
    else if (maxed) btn = `<button class="plusbtn max" disabled>MAX</button>`;
    else btn = `<button class="plusbtn ${afford ? '' : 'no'}" data-buy="${u.id}">${fmt(cost)}</button>`;
    html += `<div class="front ${locked ? 'locked' : ''}">
      <div class="fic">${u.ic}</div>
      <div class="fbody">
        <div class="fname">${locked ? '???' : u.name()}</div>
        <div class="feff">${locked ? 'Sealed until level ' + u.unlock : u.eff()}</div>
      </div>${btn}</div>`;
  }
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

// ─────────────────────────────────────────────────────────────────────────────
// PAUSE — settings, and the one destructive control in the game
// ─────────────────────────────────────────────────────────────────────────────
/* Pausing stops `frame` calling `tick` at all rather than setting some
   `run.active = false`. That freezes the whole frame - simulation, camera,
   particles, the HUD - and leaves the last rendered image on the canvas, which
   is what a player expects to see behind a pause menu. Going through
   `run.active` would have stopped the runner and left the camera drifting and
   the confetti falling. */
let paused = false;
const pauseScreenEl = $('pauseScreen'), pauseBtn = $('btnPause');

/* The gear is up whenever the player is looking at the world - during a run and
   on the home screen between them, which is where the reference puts it. It
   comes down only when a full-screen sheet already owns the input. */
function canPause() {
  return shopScreenEl.classList.contains('hidden') && rewardEl.classList.contains('hidden');
}

function openPause() {
  if (paused || !canPause()) return;
  paused = true;
  disarmWipe();
  syncSettingsUI();
  $('pauseSub').textContent = `LEVEL ${S.level}  ·  ${count()} CANDLES`;
  homeEl.classList.add('hidden');
  pauseScreenEl.classList.remove('hidden');
  save();
}

function closePause() {
  if (!paused) return;
  paused = false;
  disarmWipe();
  pauseScreenEl.classList.add('hidden');
  if (!run.active && !run.over) openHome();
  /* The clock has been running while the panel was open; without this the
     first frame after RESUME is one long step and the tray teleports. */
  last = performance.now();
}

/* Shown only while a run is actually happening. A pause button on the results
   screen is a button that does nothing, which is worse than no button. */
function syncPauseBtn() {
  pauseBtn.classList.toggle('hidden', !canPause());
}

pauseBtn.addEventListener('click', () => { sfx.init(); openPause(); });
$('btnResume').addEventListener('click', closePause);
/* Tapping the dimmed game behind the sheet resumes, which is what every phone
   game does and what a thumb tries first. */
pauseScreenEl.addEventListener('click', (e) => { if (e.target === pauseScreenEl) closePause(); });
window.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' && e.key !== 'p' && e.key !== 'P') return;
  if (paused) closePause(); else openPause();
});

// -- the settings themselves --------------------------------------------------
function applySettings() {
  sfx.setSound(SET.sound);
  sfx.setMusic(SET.music);
  saveSettings(SET);
}

function syncSettingsUI() {
  for (const [id, on] of [['optSound', SET.sound], ['optMusic', SET.music]]) {
    const b = $(id);
    b.setAttribute('aria-checked', on ? 'true' : 'false');
    b.textContent = on ? 'ON' : 'OFF';
  }
  $('optSens').value = String(Math.round(SET.sens * 100));
  $('sensVal').innerHTML = SET.sens.toFixed(1) + '&times;';
}

$('optSound').addEventListener('click', () => {
  SET.sound = !SET.sound; applySettings(); syncSettingsUI();
  if (SET.sound) sfx.coin();     // so the switch proves itself
});
$('optMusic').addEventListener('click', () => {
  SET.music = !SET.music; applySettings(); syncSettingsUI();
});
/* The slider's range comes from `settings.ts`, so the bounds the clamp
   enforces and the bounds the thumb can reach cannot drift apart. */
$('optSens').min = String(Math.round(SENS_MIN * 100));
$('optSens').max = String(Math.round(SENS_MAX * 100));
$('optSens').addEventListener('input', (e) => {
  SET.sens = clampSens(Number(e.target.value) / 100);
  applySettings(); syncSettingsUI();
});

// -- clearing the save --------------------------------------------------------
/* Two taps, because there is no undo. The first arms the button and relabels
   it; the second erases. Arming times out, so a stray tap cannot leave a live
   trigger sitting under the player's thumb for the rest of the run. */
let wipeArmed = false, wipeTimer = 0;
function disarmWipe() {
  wipeArmed = false;
  clearTimeout(wipeTimer);
  const b = $('btnWipe');
  b.classList.remove('armed');
  b.textContent = 'CLEAR SAVE DATA';
  $('wipeNote').textContent = 'Erases every level, upgrade and coin. Settings are kept.';
}

$('btnWipe').addEventListener('click', () => {
  const b = $('btnWipe');
  if (!wipeArmed) {
    wipeArmed = true;
    b.classList.add('armed');
    b.textContent = 'TAP AGAIN TO ERASE';
    $('wipeNote').textContent = 'This cannot be undone.';
    sfx.deny();
    clearTimeout(wipeTimer);
    wipeTimer = setTimeout(disarmWipe, 4000);
    return;
  }
  clearTimeout(wipeTimer);
  wiped = true;                       // stop every later save() writing it back
  try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* private mode */ }
  b.textContent = 'ERASED';
  $('wipeNote').textContent = 'Starting over…';
  /* Reload rather than reset in place: boot is the one code path that is
     already known to build a correct virgin game, and half a dozen `S.x = 0`
     assignments is a second one to keep in step with it. */
  setTimeout(() => location.reload(), 400);
});

applySettings();

$('btnGo').addEventListener('click', () => {
  sfx.init();
  shopScreenEl.classList.add('hidden');
  renderBoosts();
  syncPauseBtn();
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
  syncPauseBtn();
  const a = appraise(run.tray, {
    cash: run.cash, earnMul: earnMul() * boostMul(), priceMul: priceMul(),
  });
  lastResult = a;
  sfx.sell(a.value > S.bestValue);
  confetti(run.z + 4, 170);
  flash(0.4);

  showRuler(a);
  setTimeout(() => showReward(a), 2900);
}

/* THE RULER. An absolute money scale with your own best marked on it, which the
   finished batch climbs - not a fraction of a target and not a star rating.

   That is the reference's whole end-of-run question, and it is a better one:
   "did you beat your best" needs no explaining, moves every level, and cannot
   be gamed by a designer picking a soft par. `par` survives only as the scale's
   spacing, because a ruler still needs to know how big a step is. */
function showRuler(a) {
  const best = S.bestValue;
  /* Headroom above whichever is higher. Without the floor the very first run -
     which has no best to sit under - fills the column to the brim and the scale
     it is being measured against is entirely hidden behind it. */
  const top = Math.max(a.value * 1.45, best * 1.3, T.par * priceMul() * 0.9);
  const stepRaw = top / 9;
  const mag = Math.pow(10, Math.floor(Math.log10(Math.max(1, stepRaw))));
  const step = Math.max(mag, Math.round(stepRaw / mag) * mag);
  const pos = (v) => clamp(v / top, 0, 1) * 100;

  let ticks = '';
  for (let v = step; v <= top; v += step) {
    ticks += `<i style="bottom:${pos(v).toFixed(2)}%">${fmt(Math.round(v))}</i>`;
  }
  $('rulerTicks').innerHTML = ticks;

  const band = $('hsBand');
  band.style.display = best > 0 ? '' : 'none';
  band.style.bottom = pos(best).toFixed(2) + '%';

  const stack = $('rStack');
  stack.style.height = '0%';
  $('rStackN').textContent = '0';
  rulerEl.classList.remove('hidden');

  /* Counted up rather than snapped, because the moment is watching it climb
     past the yellow band. */
  setTimeout(() => { stack.style.height = pos(a.value).toFixed(2) + '%'; }, 80);
  const t0 = performance.now();
  const tick = () => {
    const k = clamp((performance.now() - t0) / 1500, 0, 1);
    $('rStackN').textContent = fmt(Math.round(a.value * (1 - Math.pow(1 - k, 3))));
    if (k < 1 && !rulerEl.classList.contains('hidden')) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

/* THE REWARD SCREEN.

   The reference puts a five-wedge multiplier fan here and gates the spin behind
   a rewarded video. There are no adverts in this game, so there is nothing to
   gamble against: a wheel that always lands the same is a wheel-shaped lie, and
   dressing a fixed payout as a gamble is the one bit of the reference worth not
   copying. What is left is what the screen was actually for - the thing you
   made, what it was worth, and whether it beat your best. */
function showReward(a) {
  const beat = a.value > S.bestValue;

  $('rwdAmt').textContent = fmt(Math.round(a.value));
  $('rwdHs').classList.toggle('hidden', !beat);
  $('rwdBest').textContent = fmt(Math.round(Math.max(S.bestValue, a.value)));
  /* The product: the richest candle in the batch, drawn the way the reference
     draws it - one big silhouette with a white outline. `TR.bestCandle` returns
     a VALUE, not a recipe, so the recipe has to be picked here. */
  let b = null, bv = -1;
  for (const r of run.tray) {
    const v = CD.candleValue(r);
    if (v > bv) { bv = v; b = r; }
  }
  const col = b ? WAXES[CD.topWax(b)].col : 0xfff0d0;
  const tall = clamp(60 + (b ? b.layers.length : 1) * 16, 60, 165);
  $('rwdProd').innerHTML =
    `<i style="height:${tall}px;background:#${col.toString(16).padStart(6, '0')}"></i>`;

  rewardEl.classList.remove('hidden');
  const paid = Math.round(a.value);
  $('claimLbl').textContent = 'CONTINUE  ' + fmt(paid);
  $('btnClaim').onclick = () => takeReward(a, paid);
}

function takeReward(a, paid) {
  rewardEl.classList.add('hidden');
  rulerEl.classList.add('hidden');
  S.coins += paid;
  S.bestValue = Math.max(S.bestValue, a.value);
  S.level++;
  S.best = Math.max(S.best, S.level);
  boost.candle = false; boost.cash = false;
  save();
  sfx.buy();
  startLevel();
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
/* Every control that sits over the world has to be listed here, and the list is
   the bug: the two boost cards on the home screen were not, so a tap on CANDLE
   or CASH fell through to `ptDown`, which starts the run - the cards could not
   be bought at all. `.uibtn` covers the gear, `.modal` the sheets; anything
   else drawn over the game needs adding, so the safest selector is the one that
   names the home layer itself. */
const onUI = (e) => !!(e.target && e.target.closest
  && e.target.closest('.modal, .uibtn, #home button'));

function ptDown(e) {
  /* Audio still needs the gesture even when the tap was on a menu - Chrome
     refuses to build an AudioContext outside one. */
  sfx.init();
  if (onUI(e)) { dragId = null; return; }
  /* A touch on the world is what starts a run. The home screen is a layer over
     a live world, not a sheet in front of a frozen one, so there is no START
     button to find - the first swipe both begins the level and steers it. */
  if (!run.active && !run.over) startRun();
  const t = e.changedTouches ? e.changedTouches[0] : e;
  dragId = t.identifier !== undefined ? t.identifier : 'mouse';
  dragX = t.clientX; dragStartX = run.targetX;
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
    run.targetX = clamp(dragStartX - dx * 8.0 * SET.sens, -T.laneClamp, T.laneClamp);
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
      /* IT STANDS THE BATCH UP. That is what the name means and what the
         reference does with it - flat slab at 15.5s in the walkthrough, tower
         at 15.8s, with the plate still behind it. It used to turn the tray end
         for end here, which is a thing the player cannot see happening and the
         single biggest reason the stations read as power-ups rather than as
         machinery. */
      run.standing = !run.standing;
      if (!run.standing) TR.rotate(run.tray);
      popAt(run.standing ? 'STAND UP' : 'LAY DOWN', '#ffffff', st.z);
      emit(run.x, 0.8, st.z, 26, 0xffffff, 2.4, 6);
      sfx.press(); shake(0.5); flash(0.2);
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
  if (k.n === 'WAX') {
    emit(x, 0.5, z, 6, k.colour(h), 0.7, 4);
    ripple(x, z, k.colour(h));
    sfx.dip();
  }
  else if (k.n === 'GLITTER') { confetti(z, 12); sfx.sparkle(); }
  else if (k.n === 'PRESS') { emit(x, 0.6, z, 5, 0xb9f0ff, 0.7, 4); sfx.press(); shake(0.12); }
  else { emit(x, 0.7, z, 5, k.colour(h), 0.7, 4); sfx.wrap(); }
}

/* Obstacles test every candle, which is the reason the trail exists: checking
   the leader alone would make a long tray strictly better than a short one. */
function updateObstacles(dt, n) {
  for (let i = obstacles.length - 1; i >= 0; i--) {
    const o = obstacles[i];
    o.spin += dt * (o.kind === 'roller' ? 3.2 : 2.4);
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
    const base = o.kind === 'roller' ? T.rollerTake
      : o.kind === 'sweeper' ? T.sweeperTake : T.barrierTake;
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

  /* `standT` eases 0 to 1 as the batch rises onto its ends. It is the ONLY
     thing the standing form changes, and nothing outside the renderer and the
     camera reads it - so a harness that never draws still gets an identical
     simulation. */
  const t = run.standT;
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
    const bob = Math.sin(run.time * 5 - i * 0.4) * 0.03;

    /* THE STANDING FORM: one disc per candle, stacked in height, still at its
       own place on the recorded path. One disc rather than one per wax layer,
       because that is what the reference's tower is - a stripe per candle - and
       it is what makes weaving legible from the side: a batch that took two
       pools comes out banded, a batch that took one comes out plain. */
    if (t > 0.02) {
      /* Upright, and the bands run UP the candle - which is what a dipped
         candle actually looks like, and what the loaf could only show along its
         length. Standing is therefore also the moment the player can finally
         read every band they put on. */
      const m = MOULDS[r.mould];
      /* Turned a little further each candle so a TWIST or STAR mould reads as a
         rank of stamped shapes rather than a row of identical lumps. */
      QT.setFromAxisAngle(V.set(0, 1, 0), i * (0.15 + m.twist * 0.30));
      const upH = len * 0.92;                 // the candle's length becomes its height
      for (let b = 0; b < r.layers.length; b++) {
        const y = (xs[b] + bh * 0) * t;
        M2.compose(V2.set(p.x, y * 0 + (xs[b]) * t + (rad[b] + bob) * (1 - t), p.z), QT,
          V.set(rad[b] * 2, bh, rad[b] * 2));
        CTMP.setHex(WAXES[r.layers[b]].col);
        if (r.glitter > 0) CTMP.lerp(WHITE, 0.10 * r.glitter);
        if (r.scent > 0) CTMP.lerp(SCENTC, 0.16);
        band.push(M2, CTMP);
      }
      void upH;

      /* Wrapped: a ribbon round the middle of the candle and a bow on top of
         it, per candle, which is what the reference ties at WRAP. */
      if (wrapped) {
        const w = WRAPS[r.wrap];
        M2.compose(V2.set(p.x, len * 0.42 * t, p.z), QT.identity(),
          V.set(rad[0] * 2.3, len * 0.16, rad[0] * 2.3));
        C.ribbon.push(M2, CTMP.setHex(w.col));
        M2.compose(V2.set(p.x, len * 0.42 * t + len * 0.11, p.z), QT.identity(),
          V.set(rad[0] * 1.9, len * 0.10, rad[0] * 0.7));
        C.bow.push(M2, CTMP.setHex(w.bow));
      }

      /* The wick is on top of EVERY candle now, because every candle is a
         candle again rather than a slice of one. */
      M2.compose(V2.set(p.x, len * t + T.wickH * 0.4, p.z), QT2.identity(),
        V.set(rad[0] * 1.4, T.wickH * 1.5, rad[0] * 1.4));
      C.wick.push(M2);

      if (r.glitter > 0 && i % 2 === 0) {
        M2.compose(V2.set(p.x + rad[0] * 1.15, len * 0.6 * t, p.z), QT.identity(),
          V.set(0.10, 0.10, 0.10));
        C.spark.push(M2, CTMP.setHex(0xffffff));
      }
    } else {
      QT.setFromAxisAngle(V.set(0, 0, 1), Math.PI / 2);
      if (wrapped) {
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
      if (r.glitter > 0 && (i % 2 === 0)) {
        const sx = p.x + ((i * 37) % 13 - 6) * 0.13;
        M2.compose(V2.set(sx, rad[0] * 2 + 0.05 + bob, p.z), QT.identity(),
          V.set(0.09, 0.09, 0.09));
        C.spark.push(M2, CTMP.setHex(0xffffff));
      }
    }

    QT2.setFromAxisAngle(V.set(1, 0, 0), -Math.PI / 2);
    M2.compose(V2.set(p.x, 0.03, p.z), QT2,
      V.set(lerp(len * 1.05, rad[0] * 2.6, t), T.trailGap * 1.6, 1));
    W.shadow.push(M2);

    if (lit && i < Math.floor(run.giftT * 11)) {
      const fs = 0.3 + Math.sin(run.time * 19 + i) * 0.03;
      /* Standing, the flame sits on top of the candle; lying, it sits at the
         wick end of the loaf. */
      const ty = t > 0.5
        ? len * t + T.wickH * 0.9
        : (wrapped ? rad[0] * 2.1 : rad[0] * 2) + 0.2;
      const fx = t > 0.5 ? p.x : p.x + len / 2 - 0.2;
      M2.compose(V2.set(fx, ty + fs, p.z), QT2.identity(), V.set(fs, fs * 2.0, fs));
      flames.setMatrixAt(fN, M2);
      M2.compose(V2.set(fx, ty + fs * 0.8, p.z), QT2.identity(),
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
  for (const k in W) if (k !== 'shadow' && k !== 'ripple') W[k].reset();
  W.ripple.reset();

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
    /* Rotated about X so the cylinder lies ALONG the runway, then turned about
       Y by its own fixed angle: the reference scatters them at every angle, and
       a dozen identical capsules all pointing the same way reads as a printed
       pattern rather than as stock lying where it fell. */
    QT.setFromAxisAngle(V.set(1, 0, 0), Math.PI / 2)
      .premultiply(QT2.setFromAxisAngle(V.set(0, 1, 0), c.lie));
    M2.compose(V2.set(c.x, y, c.z), QT, V.set(0.5, 1.15, 0.5));
    W.looseC.push(M2, CTMP.setHex(0xffc61a));
    M2.compose(V2.set(c.x + Math.sin(c.lie) * 0.72, y, c.z + Math.cos(c.lie) * 0.72),
      QT, V.set(0.9, 0.9, 0.9));
    W.looseTip.push(M2);
  }

  for (const b of notes) {
    const y = 0.85 + Math.sin(b.bob) * 0.14;
    QT.setFromAxisAngle(V.set(0, 1, 0), b.bob * 0.4);
    M2.compose(V2.set(b.x, y, b.z), QT, ONE);
    W.cash.push(M2);
    // the punched hole, at the left end of the tag
    M2.compose(V2.set(b.x - Math.cos(b.bob * 0.4) * 0.42, y + 0.02,
      b.z + Math.sin(b.bob * 0.4) * 0.42), QT, ONE);
    W.cashMark.push(M2);
  }

  for (const o of obstacles) {
    if (o.hit) continue;
    if (o.kind === 'barrier') {
      // the low base
      M2.compose(V2.set(o.x, 0.26, o.z), QT.identity(), ONE);
      W.barrier.push(M2);
      /* Three pyramids across it, and a white cross on each: the crosses are
         what makes it read as "do not" rather than as scenery, and they are on
         the pyramids in the reference rather than on the base. */
      for (let i = -1; i <= 1; i++) {
        const px = o.x + i * 0.62;
        M2.compose(V2.set(px, 0.86, o.z), QT.identity(), ONE);
        W.barSpike.push(M2);
        for (let k = 0; k < 2; k++) {
          QT.setFromAxisAngle(V.set(0, 0, 1), k ? 0.86 : -0.86);
          M2.compose(V2.set(px, 0.80, o.z - 0.30), QT, ONE);
          W.barX.push(M2);
        }
      }
    } else if (o.kind === 'roller') {
      // the post, standing outside the rail on the anchored side
      const px = o.side * (T.roadW / 2 + 0.55);
      M2.compose(V2.set(px, 1.7, o.z), QT.identity(), ONE);
      W.axlePost.push(M2);
      // the shaft, laid along x from the post to the inner end of the reach
      const inner = o.side * (T.roadW / 2 - o.reach);
      QT.setFromAxisAngle(V.set(0, 0, 1), Math.PI / 2);
      M2.compose(V2.set((px + inner) / 2, 1.0, o.z), QT, V.set(1, Math.abs(px - inner), 1));
      W.axle.push(M2);
      // and the diamonds threaded on it, turning together
      const n = Math.max(2, Math.round(o.reach / 0.92));
      for (let k = 0; k < n; k++) {
        const t = (k + 0.5) / n;
        QT.setFromAxisAngle(V.set(1, 0, 0), o.spin + k * 0.4);
        M2.compose(V2.set(o.side * (T.roadW / 2) - o.side * o.reach * t, 1.0, o.z), QT, ONE);
        W.spike.push(M2);
      }
    } else {
      /* Angled about Y, so it is a diagonal bar rather than a wall - the
         difference between "you cannot pass" and "there is a way round it".
         The arrowhead points the way it is currently sliding, which is the one
         thing a player needs from it and the reason the reference draws it. */
      const a = 0.42 * o.dir;
      const vx = Math.cos(o.phase + run.z * 0.26 * o.dir) * o.dir;
      const way = vx >= 0 ? 1 : -1;
      QT.setFromAxisAngle(V.set(0, 1, 0), a);
      M2.compose(V2.set(o.x, 0.32, o.z), QT, ONE);
      W.sweeper.push(M2);

      /* The navy arrowhead, at the leading end. A cone points +y, so it is
         rolled about z to point along x and then yawed with the bar, or it
         points along the track while the bar it is stuck to points across it. */
      QT2.setFromAxisAngle(V.set(0, 0, 1), -way * Math.PI / 2)
        .premultiply(Q.setFromAxisAngle(V.set(0, 1, 0), a));
      M2.compose(V2.set(o.x + way * 1.95 * Math.cos(a), 0.32, o.z - way * 1.95 * Math.sin(a)),
        QT2, ONE);
      W.sweepTip.push(M2);

      // and two short dashes trailing it
      for (let k = 1; k <= 2; k++) {
        const t = -way * (1.3 + k * 0.62);
        M2.compose(V2.set(o.x + t * Math.cos(a) + way * 0.5, 0.32, o.z - t * Math.sin(a)),
          QT, ONE);
        W.sweepDash.push(M2);
      }
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

  for (const k in W) if (k !== 'ripple') W[k].flush();
}

function writeStations() {
  let i = 0;
  for (const st of stations) {
    if (i >= stationPool.length) continue;
    if (st.z < run.z - T.poolLen || st.z > run.z + 120) continue;
    /* The leader's x and how far it is through the pool, so the ladle can pour
       ON the candles rather than at a fixed spot in the wax. */
    stationPool[i].set(st, run.time, run.x, run.z);
    i++;
  }
  for (let k = i; k < stationPool.length; k++) stationPool[k].hide();
}

function writeRipplesFlush() { W.ripple.flush(); }

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
  /* `last` is updated BEFORE the bail-out, so resuming does not hand the
     simulation the whole length of the pause as one step. The clamp above
     would have caught it, but only by throwing the time away silently. */
  if (paused) return;
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
  /* Eased over about half a second. Nothing else reads `standT`, so a harness
     that never draws still gets identical simulation. */
  run.standT = clamp(run.standT + (run.standing ? dt * 2.2 : -dt * 3), 0, 1);
  updateGlitter(dt);
  updateRipples(dt);
  /* The wax FLOWS. One shared texture scrolled once a frame, which costs
     nothing and does more for "this is liquid" than any map could: a still
     surface is a painted floor however it is shaded. */
  if (SWIRL) { SWIRL.offset.y = (SWIRL.offset.y - dt * 0.22) % 1; }

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
    /* A standing batch is as tall as it is long, so the camera lifts and pulls
       back with `standT` as well as with the tail. Without this the tower's top
       leaves the frame the moment ROTATE fires, which is exactly the moment the
       player wants to look at it. */
    /* A standing rank is taller than a lying loaf but nothing like as tall as
       the stacked tower this used to build, so the camera only needs a nudge.
       Pulling back as far as a nine-unit tower did put the whole runway in the
       distance and made the candles unreadable. */
    const up = run.standT * 2.2;
    camPos.set(run.x * 0.55, 4.6 + tail * 0.20 + up,
      run.z - 12.8 - tail * 0.60 - up * 1.4);
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
  writeRipples();
  writeRipplesFlush();
  writeGlitter();
  updatePops(dt);

  if (toastT > 0) { toastT -= dt; if (toastT <= 0) toastEl.style.opacity = '0'; }
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
      /* Starts the run as well as building the level. A level now waits for a
         swipe, and a harness has no thumb - without this every advance() in
         every test would tick a stationary game and every number would be the
         opening tray. */
      freeze: () => { harnessFrozen = true; startLevel(); startRun(); },
      startRun,
      /* Back to the between-run state, which is where the SHOP button lives.
         `freeze()` deliberately starts the run - a harness has no thumb - and
         that hides the home screen, so a test that wants the shop needs a way
         back to it. */
      toHome: () => { startLevel(); },

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
  /* No sheet on boot. `startLevel()` has already put the home screen up over a
     live runway, which is where the reference sits between runs. */
  requestAnimationFrame(frame);
}
boot();
