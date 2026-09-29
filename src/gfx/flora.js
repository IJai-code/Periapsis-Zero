import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { mulberry32 } from './noise.js'
import { scrubAt, fbm } from './snoise.js'

/**
 * What grows round a launch pad.
 *
 * Every Earth pad stands in a landscape with a character of its own, and the
 * character is mostly plants. Merritt Island is palmetto scrub and pine
 * flatwoods — saw palmetto knee-high everywhere the ground is dry, cabbage
 * palms standing up out of it, slash pines in open stands, live-oak hammocks
 * where the ground rises a metre. Baikonur is steppe: grass and wormwood and
 * saxaul, and the poplars people planted along the roads. Kourou is the
 * Guianan forest pressing up to the fences, trees forty metres tall. Vandenberg
 * is coastal sage and chaparral on bare hills, with oaks in the gullies.
 *
 * Each species is one small merged mesh built here in metres, its colours in
 * vertex colours and a `sway` weight rising from 0 at the root to 1 at the tip
 * for the wind. Placement is on the terrain's own land-cover field
 * (`snoise.js` — the same noise the ground shader paints), so plants stand in
 * the scrub the ground is drawn as, never in water, on a road or inside a
 * building, and thin out with distance from the pad. The instance counts come
 * from the device tier.
 */

const C = (hex) => new THREE.Color(hex)
const _c = new THREE.Color()

/** Paint a geometry one colour, and give it a sway weight by height. */
function finish(geo, colour, swayFrom = 0, swayTo = 1, top = 1) {
  const g = geo.index ? geo.toNonIndexed() : geo
  const n = g.attributes.position.count
  const col = new Float32Array(n * 3)
  const sway = new Float32Array(n)
  const c = colour instanceof THREE.Color ? colour : C(colour)
  for (let i = 0; i < n; i++) {
    col[i * 3] = c.r
    col[i * 3 + 1] = c.g
    col[i * 3 + 2] = c.b
    const y = g.attributes.position.getY(i)
    sway[i] = swayFrom + (swayTo - swayFrom) * Math.min(1, Math.max(0, y / top))
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3))
  g.setAttribute('sway', new THREE.BufferAttribute(sway, 1))
  g.deleteAttribute('uv')
  return g
}

function placed(geo, x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)),
    new THREE.Vector3(sx, sy, sz),
  )
  return geo.applyMatrix4(m)
}

/**
 * How finely a plant is built, 1 being every part of it.
 *
 * A cabbage palm is 386 triangles and there are 5,760 of them round Kennedy;
 * a slash pine is 654 and there are 4,320. Drawn whole, the plants alone are
 * 8.6 million triangles a frame — and measured from the pad, nine in ten of
 * the ones on screen cover fewer than twelve pixels, where a frond is smaller
 * than a pixel and cannot be seen whether it is drawn or not.
 *
 * So each species can be built at a lower detail — but only by *tessellating*
 * it more coarsely, never by leaving out anything that decides its outline. A
 * crown keeps every blob it had, in the same place and at the same size, and
 * each blob is a twenty-triangle solid instead of an eighty-triangle one; a
 * trunk keeps its height and taper on four sides instead of seven; a frond
 * keeps the span of its fan on three blades instead of five. What does come off
 * is loose decoration that no silhouette depends on: a palm's dead skirt, a
 * pine's bare lower branches, the boots on a trunk.
 *
 * This is the difference between a tree that is cheaper and a tree that is
 * smaller. An earlier cut of this dropped crown blobs by count, and
 * `verify-flora` caught a live oak losing a fifth of its height when it
 * swapped, which would have shown as a pop as the camera walked toward it.
 * `detail = 1` reproduces the full plant exactly, down to the random sequence,
 * so nothing near the camera is ever anything but what it always was.
 * There are two, not more: a crown blob is an icosahedron, which is either
 * subdivided or not — eighty triangles or twenty — and that one cliff is most
 * of the saving. A rung between them saved eight per cent on a pine and cost a
 * third geometry to build and keep, so there is no rung between them.
 *
 * `gfx/flora.js` only builds them; `components/SiteSurround.jsx` decides which
 * one a plant gets, by how large it is on screen.
 */
export const DETAIL = [1, 0.18]

/** Count a part down with detail, never below what keeps the shape. */
const parts_ = (n, d, min) => Math.max(min, Math.round(n * d))

/**
 * The mean triangle edge of a build, in metres — how coarse it looks close up,
 * and so the only honest thing to measure a swap against.
 *
 * Plant height is not that thing. A shrub is two metres and an oak is ten, so
 * one threshold in pixels of plant puts the shrub's swap at fifty metres and
 * the oak's at a hundred and fifty, when what actually gives a coarse build
 * away is the size of its facets — and the shrub's are the larger of the two at
 * those distances. `SiteSurround` swaps on this instead.
 */
export function facetSize(g) {
  const p = g.attributes.position
  let area = 0
  for (let i = 0; i + 2 < p.count; i += 3) {
    const ax = p.getX(i)
    const ay = p.getY(i)
    const az = p.getZ(i)
    const ux = p.getX(i + 1) - ax
    const uy = p.getY(i + 1) - ay
    const uz = p.getZ(i + 1) - az
    const vx = p.getX(i + 2) - ax
    const vy = p.getY(i + 2) - ay
    const vz = p.getZ(i + 2) - az
    area += 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx)
  }
  const n = Math.max(1, p.count / 3)
  return Math.sqrt((2 * area) / n)
}

/** A frond: a fan of blades, radiating from its base, drooping at the tip. */
function frond(length, width, droop, colour, blades = 5) {
  const pos = []
  for (let b = 0; b < blades; b++) {
    const a = ((b / (blades - 1)) - 0.5) * 1.3
    const tipX = Math.sin(a) * width
    const tipZ = length
    const midZ = length * 0.55
    // Two triangles per blade: base to mid, mid to drooping tip.
    pos.push(0, 0, 0, tipX * 0.5 + 0.06, -droop * 0.15, midZ, tipX * 0.5 - 0.06, -droop * 0.15, midZ)
    pos.push(tipX * 0.5 + 0.06, -droop * 0.15, midZ, tipX, -droop, tipZ, tipX * 0.5 - 0.06, -droop * 0.15, midZ)
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.computeVertexNormals()
  return finish(g, colour, 0, 1, 1)
}

/**
 * A lump of foliage: an icosahedron flattened and roughened, so a crown is not
 * a ball.
 *
 * The roughening draws the same number of randoms whatever the subdivision —
 * `LUMP_DRAWS`, the full build's vertex count — so a plant's blobs sit in
 * exactly the same places, at the same sizes, at every detail level, and the
 * full build is the one that always was. Without that, a coarser lump would
 * consume fewer draws, every lump after it in the crown would move, and a tree
 * would change shape as the camera walked toward it.
 */
const LUMP_DRAWS = 240
/**
 * An icosahedron's faces cut inside the sphere its vertices sit on, and the
 * subdivided one's do so much less — so the same radius draws a visibly
 * smaller blob once subdivision comes off, and a crown would shrink as the
 * camera walked away from it. By Cauchy's theorem the mean outline of a convex
 * solid is its surface area over four, so matching surface area matches the
 * average silhouette from every direction: sqrt(11.666 / 9.574).
 */
const COARSE_FIT = 1.1038
function lump(r, flat, colour, rand, sub = 1) {
  const g = new THREE.IcosahedronGeometry(sub < 1 ? r * COARSE_FIT : r, sub)
  const p = g.attributes.position
  for (let i = 0; i < LUMP_DRAWS; i++) {
    const k = 0.78 + rand() * 0.42
    if (i < p.count) p.setXYZ(i, p.getX(i) * k, p.getY(i) * k * flat, p.getZ(i) * k)
  }
  g.computeVertexNormals()
  return g
}

/* ------------------------------------------------------------------ *
 * Species
 * ------------------------------------------------------------------ */

/** Cabbage palm, Sabal palmetto: Florida's state tree, 6–15 m, a rough ball of fans. */
export function palm(d = 1) {
  const rand = mulberry32(11)
  const h = 9
  const parts = []
  const trunk = new THREE.CylinderGeometry(0.17, 0.24, h, parts_(7, d, 4), parts_(4, d, 1), true)
  placed(trunk, 0, h / 2, 0)
  parts.push(finish(trunk, '#6d6353', 0, 0.6, h))
  // Old frond bases — the "boots" that make a cabbage palm's trunk look woven.
  for (let i = 0; i < parts_(5, d, 0); i++) {
    const boot = new THREE.CylinderGeometry(0.3, 0.22, 0.6, parts_(7, d, 4), 1, true)
    placed(boot, 0, h - 1.4 - i * 0.55, 0)
    parts.push(finish(boot, '#5e5243', 0.5, 0.6, h))
  }
  for (let i = 0; i < 20; i++) {
    const yaw = (i / 20) * Math.PI * 2 + rand() * 0.4
    const pitch = -0.25 + rand() * 1.2
    const f = frond(1.9 + rand() * 0.6, 1.2, 0.5 + rand() * 0.6, rand() < 0.15 ? '#8a7a4c' : rand() < 0.5 ? '#3f5a2a' : '#4b6630', parts_(5, d, 3))
    f.applyMatrix4(new THREE.Matrix4().makeRotationX(-pitch))
    f.applyMatrix4(new THREE.Matrix4().makeRotationY(yaw))
    f.translate(0, h, 0)
    // Sway: the whole crown moves with the top of the trunk.
    f.attributes.sway.array.fill(1)
    parts.push(f)
  }
  // Dead fronds hanging in a skirt below the crown.
  const skirt = parts_(6, d, 0)
  for (let i = 0; i < skirt; i++) {
    const f = frond(1.5, 0.8, 0.2, '#7d6a48', parts_(5, d, 3))
    f.applyMatrix4(new THREE.Matrix4().makeRotationX(Math.PI * 0.62))
    f.applyMatrix4(new THREE.Matrix4().makeRotationY((i / skirt) * Math.PI * 2))
    f.translate(0, h - 0.3, 0)
    f.attributes.sway.array.fill(0.95)
    parts.push(f)
  }
  return mergeGeometries(parts, false)
}

/** Slash pine: a tall bare trunk and a flat-topped crown of clumps high up. */
export function pine(d = 1) {
  const rand = mulberry32(23)
  const h = 18
  const parts = []
  const trunk = new THREE.CylinderGeometry(0.14, 0.32, h, parts_(7, d, 4), parts_(5, d, 1), true)
  placed(trunk, 0, h / 2, 0)
  parts.push(finish(trunk, '#6b5341', 0, 0.8, h))
  for (let i = 0; i < 7; i++) {
    const a = rand() * Math.PI * 2
    const r = rand() * 1.8
    const y = h - 3.4 + rand() * 3.6
    const l = lump(1.4 + rand() * 0.9, 0.55, null, rand, d < 0.5 ? 0 : 1)
    placed(l, Math.cos(a) * r, y, Math.sin(a) * r)
    parts.push(finish(l, rand() < 0.5 ? '#2f4424' : '#38502a', 0.85, 1, h))
  }
  // A couple of dead lower branches.
  for (let i = 0; i < parts_(3, d, 0); i++) {
    const b = new THREE.CylinderGeometry(0.03, 0.06, 2.2, 4, 1, true)
    placed(b, 0.9, h * (0.45 + i * 0.1), 0, 0, (i * 2.1), Math.PI / 2.6)
    parts.push(finish(b, '#5a4838', 0.4, 0.6, h))
  }
  return mergeGeometries(parts, false)
}

/** Live oak: a short trunk, broad limbs, a wide dark dome of leaves. */
export function oak(d = 1) {
  const rand = mulberry32(37)
  const parts = []
  const trunk = new THREE.CylinderGeometry(0.35, 0.55, 3.2, parts_(8, d, 4), parts_(2, d, 1), true)
  placed(trunk, 0, 1.6, 0)
  parts.push(finish(trunk, '#5b4a3a', 0, 0.3, 10))
  const limbs = 4
  for (let i = 0; i < limbs; i++) {
    const limb = new THREE.CylinderGeometry(0.12, 0.25, 4.5, parts_(6, d, 3), 1, true)
    const a = (i / limbs) * Math.PI * 2 + 0.4
    placed(limb, Math.cos(a) * 1.4, 4.2, Math.sin(a) * 1.4, Math.sin(a) * 0.9, 0, -Math.cos(a) * 0.9)
    parts.push(finish(limb, '#56463a', 0.3, 0.6, 10))
  }
  for (let i = 0; i < 9; i++) {
    const a = rand() * Math.PI * 2
    const r = 1.5 + rand() * 3.6
    const l = lump(2.4 + rand() * 1.4, 0.62, null, rand, d < 0.5 ? 0 : 1)
    placed(l, Math.cos(a) * r, 5.4 + rand() * 2.2, Math.sin(a) * r)
    parts.push(finish(l, rand() < 0.5 ? '#2c3d22' : '#34472a', 0.7, 1, 10))
  }
  return mergeGeometries(parts, false)
}

/** Saw palmetto: knee-to-chest-high fans straight off the ground, in clumps. */
export function palmetto(d = 1) {
  const rand = mulberry32(53)
  const parts = []
  for (let i = 0; i < 9; i++) {
    const yaw = rand() * Math.PI * 2
    const pitch = 0.35 + rand() * 0.8
    const f = frond(0.9 + rand() * 0.5, 0.9, 0.15 + rand() * 0.2, rand() < 0.2 ? '#7b7a4a' : rand() < 0.6 ? '#5a6a38' : '#4e6034', parts_(5, d, 3))
    f.applyMatrix4(new THREE.Matrix4().makeRotationX(-pitch))
    f.applyMatrix4(new THREE.Matrix4().makeRotationY(yaw))
    f.translate((rand() - 0.5) * 0.6, 0.15, (rand() - 0.5) * 0.6)
    parts.push(f)
  }
  return mergeGeometries(parts, false)
}

/** A tussock of grass: a dozen blades, some bent. */
export function tuft(d = 1) {
  const rand = mulberry32(71)
  const pos = []
  for (let i = 0; i < 12; i++) {
    const a = rand() * Math.PI * 2
    const lean = 0.1 + rand() * 0.45
    const h = 0.35 + rand() * 0.45
    const w = 0.025
    const bx = Math.cos(a) * 0.06
    const bz = Math.sin(a) * 0.06
    const tx = bx + Math.cos(a) * lean * h
    const tz = bz + Math.sin(a) * lean * h
    const px = -Math.sin(a) * w
    const pz = Math.cos(a) * w
    pos.push(bx - px, 0, bz - pz, bx + px, 0, bz + pz, tx, h, tz)
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.computeVertexNormals()
  const f = finish(g, '#7a8248', 0, 1, 0.8)
  // Brighter tips: dry grass tops out paler than it roots.
  const col = f.attributes.color
  for (let i = 0; i < col.count; i++) {
    const y = f.attributes.position.getY(i)
    _c.setRGB(col.getX(i), col.getY(i), col.getZ(i)).lerp(C('#b8b27a'), Math.min(1, y / 0.8) * 0.6)
    col.setXYZ(i, _c.r, _c.g, _c.b)
  }
  return f
}

/** Rainforest emergent: forty metres of buttressed trunk under a broad crown. */
export function jungleTree(d = 1) {
  const rand = mulberry32(89)
  const h = 30
  const parts = []
  const trunk = new THREE.CylinderGeometry(0.4, 0.9, h, parts_(8, d, 4), parts_(4, d, 1), true)
  placed(trunk, 0, h / 2, 0)
  parts.push(finish(trunk, '#6e6458', 0, 0.7, h))
  for (let i = 0; i < 10; i++) {
    const a = rand() * Math.PI * 2
    const r = rand() * 6
    const l = lump(3.2 + rand() * 2.2, 0.5, null, rand, d < 0.5 ? 0 : 1)
    placed(l, Math.cos(a) * r, h - 2 + rand() * 4, Math.sin(a) * r)
    parts.push(finish(l, rand() < 0.4 ? '#23401e' : rand() < 0.7 ? '#2e4d23' : '#3b5a2a', 0.85, 1, h))
  }
  // The understorey mass round the trunk.
  for (let i = 0; i < 5; i++) {
    const a = rand() * Math.PI * 2
    const l = lump(3 + rand() * 1.5, 0.8, null, rand, d < 0.5 ? 0 : 1)
    placed(l, Math.cos(a) * 3, 6 + rand() * 8, Math.sin(a) * 3)
    parts.push(finish(l, '#284622', 0.3, 0.6, h))
  }
  return mergeGeometries(parts, false)
}

/** Lombardy poplar: the column of green lining every Soviet road. */
export function poplar(d = 1) {
  const rand = mulberry32(97)
  const parts = []
  const trunk = new THREE.CylinderGeometry(0.15, 0.3, 4, parts_(6, d, 3), 1, true)
  placed(trunk, 0, 2, 0)
  parts.push(finish(trunk, '#6a6052', 0, 0.2, 18))
  for (let i = 0; i < 6; i++) {
    const l = lump(1.6 + rand() * 0.4, 1.9, null, rand, d < 0.5 ? 0 : 1)
    placed(l, (rand() - 0.5) * 0.8, 5 + i * 2.1, (rand() - 0.5) * 0.8)
    parts.push(finish(l, rand() < 0.5 ? '#3d5530' : '#46603a', 0.4, 1, 18))
  }
  return mergeGeometries(parts, false)
}

/** A low rounded shrub: coastal sage, saxaul, coyote brush. */
export function shrub(d = 1) {
  const rand = mulberry32(101)
  const parts = []
  for (let i = 0; i < 4; i++) {
    const a = rand() * Math.PI * 2
    const l = lump(0.8 + rand() * 0.5, 0.7, null, rand, d < 0.5 ? 0 : 1)
    placed(l, Math.cos(a) * 0.5, 0.7 + rand() * 0.4, Math.sin(a) * 0.5)
    parts.push(finish(l, rand() < 0.5 ? '#4f5a36' : '#5c6440', 0.2, 1, 2))
  }
  return mergeGeometries(parts, false)
}

/* ------------------------------------------------------------------ *
 * Where they grow
 * ------------------------------------------------------------------ */

/**
 * Per site: which species, how many of the tier's budget each takes, where
 * each prefers (scrub or open ground), and how far out they go.
 */
const MIXES = {
  ksc: [
    { species: 'palmetto', share: 0.34, cover: 'scrub', reach: 3200, size: [0.7, 1.4] },
    { species: 'palm', share: 0.16, cover: 'any', reach: 5200, size: [0.65, 1.35] },
    { species: 'pine', share: 0.12, cover: 'open', reach: 5200, size: [0.7, 1.3] },
    { species: 'oak', share: 0.08, cover: 'scrub', reach: 5200, size: [0.7, 1.3], clump: true },
    { species: 'tuft', share: 0.3, cover: 'any', reach: 320, size: [0.6, 1.4] },
  ],
  baikonur: [
    { species: 'tuft', share: 0.45, cover: 'any', reach: 320, size: [0.6, 1.5] },
    { species: 'shrub', share: 0.4, cover: 'scrub', reach: 3500, size: [0.4, 1.0] },
    { species: 'poplar', share: 0.15, cover: 'open', reach: 4500, size: [0.8, 1.2], clump: true },
  ],
  kourou: [
    { species: 'jungleTree', share: 0.55, cover: 'any', reach: 6000, size: [0.6, 1.4], forest: true },
    { species: 'palm', share: 0.15, cover: 'open', reach: 3000, size: [0.8, 1.5] },
    { species: 'shrub', share: 0.15, cover: 'scrub', reach: 2000, size: [0.8, 1.6] },
    { species: 'tuft', share: 0.2, cover: 'any', reach: 320, size: [0.8, 1.6] },
  ],
  vandenberg: [
    { species: 'shrub', share: 0.5, cover: 'scrub', reach: 3500, size: [0.6, 1.5] },
    { species: 'oak', share: 0.15, cover: 'scrub', reach: 4500, size: [0.5, 1.0], clump: true },
    { species: 'pine', share: 0.1, cover: 'open', reach: 4500, size: [0.6, 1.0], clump: true },
    { species: 'tuft', share: 0.3, cover: 'any', reach: 320, size: [0.7, 1.4] },
  ],
}

export const SPECIES = { palm, pine, oak, palmetto, tuft, jungleTree, poplar, shrub }

/**
 * Scatter a site's plants. `groundAt(x, z)` is the terrain height; `wetAt`
 * says whether the ground there is water; `keepOut` is a list of
 * `{x, z, r}` discs and `{x1, z1, x2, z2, w}` strips (buildings and roads);
 * `clearRadius` is the graded complex round the pad.
 *
 * Returns `{ species: Float32Array[x, y, z, yaw, scale, tint] }`.
 */
export function scatterFlora(siteId, { budget, groundAt, wetAt = () => false, keepOut = [], clearRadius = 420, eye = null }) {
  const mix = MIXES[siteId]
  if (!mix) return {}
  const rand = mulberry32(0x5eed ^ siteId.length * 977)
  const blocked = (x, z) => {
    for (const k of keepOut) {
      if (k.r !== undefined) {
        if ((x - k.x) ** 2 + (z - k.z) ** 2 < k.r * k.r) return true
      } else {
        const dx = k.x2 - k.x1
        const dz = k.z2 - k.z1
        const l2 = dx * dx + dz * dz || 1
        const t = Math.max(0, Math.min(1, ((x - k.x1) * dx + (z - k.z1) * dz) / l2))
        const px = k.x1 + dx * t - x
        const pz = k.z1 + dz * t - z
        if (px * px + pz * pz < (k.w / 2) ** 2) return true
      }
    }
    return false
  }
  const out = {}
  for (const m of mix) {
    const want = Math.max(20, Math.round(budget * m.share))
    const data = new Float32Array(want * 6)
    let n = 0
    let tries = 0
    const grass = m.species === 'tuft'
    // Grass gathers round the observer, where a blade can be seen; everything
    // else round the pad.
    const cx = grass && eye ? eye.x : 0
    const cz = grass && eye ? eye.z : 0
    while (n < want && tries < want * 40) {
      tries++
      let r
      if (grass) {
        // Log-uniform in radius: as many tufts in each doubling of distance,
        // which is roughly as many per unit of screen at every depth.
        r = 1.2 * Math.pow(m.reach / 1.2, rand())
      } else {
        // Area-uniform, then thinned with distance so the budget is spent
        // where it is seen.
        r = clearRadius + Math.sqrt(rand()) * (m.reach - clearRadius)
        const far = (r - clearRadius) / Math.max(1, m.reach - clearRadius)
        if (rand() < far * 0.65) continue
      }
      const a = rand() * Math.PI * 2
      const x = cx + Math.cos(a) * r
      const z = cz + Math.sin(a) * r
      const fromPad = Math.hypot(x, z)
      if (!grass && fromPad < clearRadius) continue
      if (grass && fromPad < 150) continue
      const cover = grass ? 0.5 : scrubAt(x, z)
      if (m.cover === 'scrub' && rand() > cover * 1.3) continue
      if (m.cover === 'open' && rand() < cover * 0.8) continue
      if (m.clump && fbm(x, 7, z, 1 / 350, 2, 0.5) < 0.05) continue
      if (wetAt(x, z) || blocked(x, z)) continue
      const o = n * 6
      data[o] = x
      data[o + 1] = groundAt(x, z)
      data[o + 2] = z
      data[o + 3] = rand() * Math.PI * 2
      // Inside the graded complex the grass is mown.
      const mown = grass && fromPad < clearRadius ? 0.45 : 1
      data[o + 4] = (m.size[0] + rand() * (m.size[1] - m.size[0])) * mown
      data[o + 5] = rand()
      n++
    }
    out[m.species] = data.subarray(0, n * 6)
  }
  return out
}
