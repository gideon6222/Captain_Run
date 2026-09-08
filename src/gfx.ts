/* The look: four-band toon shading, inverted-hull outlines, and one
   InstancedMesh per body part.

   All three exist for the same reason. A phone can push a lot of triangles and
   very few draw calls, so the art style has to be something that survives
   being drawn 26 times in one call. Flat bands and a black edge do; anything
   depending on per-object material state does not. */

import * as THREE from 'three';

/* The one piece of module state, and it is deliberate: there is exactly one
   scene, Layer adds two meshes to it on construction, and threading it through
   thirty constructor calls would be ceremony around a singleton. Call attach()
   once at boot, before any Layer is built. */
let target: THREE.Scene | null = null;
export function attach(scene: THREE.Scene) { target = scene; }

/* Four hard bands, and the whole art style is in the two NearestFilters -
   with linear filtering the steps interpolate and the result is flat Lambert
   with extra steps. Ambient light does the same thing: 0.72 is the ceiling
   here, and raising it washes the bands out completely. */
export function gradientMap(steps: number[]) {
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

export const GRAD = gradientMap([0.36, 0.62, 0.84, 1.0]);

/* Cached by colour: a palette swap rebuilds the world's materials every
   ascent, and an uncached MeshToonMaterial per call means a shader recompile
   and a visible hitch on the first frame of a new biome. */
const matCache = new Map<string, THREE.MeshToonMaterial>();
export function toon(color: number, opts?: THREE.MeshToonMaterialParameters) {
  const key = color + '|' + (opts ? JSON.stringify(opts) : '');
  let m = matCache.get(key);
  if (!m) {
    m = new THREE.MeshToonMaterial(Object.assign({ color, gradientMap: GRAD }, opts || {}));
    matCache.set(key, m);
  }
  return m;
}

export const OUTLINE_MAT = new THREE.MeshBasicMaterial({ color: 0x140a06, side: THREE.BackSide });

export const box = (x: number, y: number, z: number) => new THREE.BoxGeometry(x, y, z);

/* One InstancedMesh per body part, rewritten every frame, rather than one per
   character. 26 vikings, 18 draugr, a boss, 420 loot chunks and all the
   scenery come to roughly 42-55 draw calls.

   Every layer is a reset -> push -> flush pipeline, and a missing flush fails
   completely silently: count stays at whatever it was, so entities are
   invisible while still charging, still costing crew, still being killed. That
   has happened here and it read as a balance problem. e2e/smoke.spec.ts
   asserts mesh.count against the entity list for exactly this reason. */
export class Layer {
  max: number;
  mesh: THREE.InstancedMesh;
  out: THREE.InstancedMesh | null = null;
  tmp?: THREE.Matrix4;
  sv?: THREE.Vector3;
  n = 0;
  tinted = false;

  /* `outline` is a thickness in WORLD UNITS, not a scale factor. The hull is
     scaled per axis from the geometry's own bounding box, so the black edge is
     the same width on a 0.075-wide axe haft and a 30-unit mountain - a flat
     multiplier gives sub-pixel edges on small objects, which was the first
     attempt. Scaling rather than pushing along normals also leaves no gaps at
     box corners, which is most of this game. */
  constructor(geo: THREE.BufferGeometry, color: number, max: number, outline?: number) {
    if (!target) throw new Error('gfx.attach(scene) must be called before any Layer');
    this.max = max;
    this.mesh = new THREE.InstancedMesh(geo, toon(color), max);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    target.add(this.mesh);
    if (outline) {
      this.out = new THREE.InstancedMesh(geo, OUTLINE_MAT, max);
      this.out.frustumCulled = false;
      this.out.count = 0;
      this.out.renderOrder = -1;
      target.add(this.out);
      this.tmp = new THREE.Matrix4();
      geo.computeBoundingBox();
      const bb = geo.boundingBox!;
      const sx = Math.max(0.02, bb.max.x - bb.min.x);
      const sy = Math.max(0.02, bb.max.y - bb.min.y);
      const sz = Math.max(0.02, bb.max.z - bb.min.z);
      this.sv = new THREE.Vector3(1 + 2 * outline / sx, 1 + 2 * outline / sy, 1 + 2 * outline / sz);
    }
  }

  reset() { this.n = 0; }

  push(m: THREE.Matrix4, color?: THREE.Color) {
    if (this.n >= this.max) return;
    this.mesh.setMatrixAt(this.n, m);
    if (color !== undefined) { this.mesh.setColorAt(this.n, color); this.tinted = true; }
    if (this.out) { this.tmp!.copy(m).scale(this.sv!); this.out.setMatrixAt(this.n, this.tmp!); }
    this.n++;
  }

  flush() {
    this.mesh.count = this.n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.tinted && this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    if (this.out) { this.out.count = this.n; this.out.instanceMatrix.needsUpdate = true; }
  }
}
