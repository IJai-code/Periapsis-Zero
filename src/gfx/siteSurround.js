import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'

/**
 * The world around the pad: buildings, roads, trees, the people who came to
 * watch. Pure three.js like `padGeometry.js`, so `scripts/verify-surround.mjs`
 * can build every site under Node and measure it.
 *
 * The pad structures stand on a graded, surveyed rectangle. Everything past
 * that rectangle is Florida marsh, Kazakh steppe, Guianan jungle or Vandenberg
 * chaparral — and, at the real complexes, an enormous amount of civilisation:
 * the Vehicle Assembly Building three miles down the crawlerway, the press
 * site, the causeway with its buses, the parking lots full at dawn. Without
 * any of it a launch reads as a rocket on a bare table. With it the ground
 * camera has something to be a photograph *of*.
 *
 * Everything is in the pad's local frame — x east, y up, z north, origin at
 * the site's coordinates on the terrain datum — the same frame `padGeometry`
 * builds in, so this mounts beside `LaunchPad` in the terrain group and cannot
 * drift off the ground. The one liberty: each structure is given a **skirt**
 * — its base extends `SKIRT` metres below the height sampled at its centre —
 * so it meets the real 130 m-sampled relief by construction rather than by
 * margin. No floating geometry, no terrain clipping, whatever the slope does.
 *
 * Three instanced families (trees, cars, people) carry the mass of the detail
 * in three draw calls; the buildings bake into one merged geometry per
 * material. The frame loop touches none of it.
 */

/** How far below the sampled ground a structure's base reaches, m. */
export const SKIRT = 6

const _m = new THREE.Matrix4()
const _q = new THREE.Quaternion()
const _e = new THREE.Euler()
const _p = new THREE.Vector3()
const _s = new THREE.Vector3(1, 1, 1)

/**
 * A per-structure ledger, filled while the site builds and emptied afterwards.
 * Merged geometry cannot say which building a vertex belongs to — but floating
 * is a per-structure property, so `verify-surround` needs exactly that: for
 * every structure, where its base sits relative to the ground sampled at its
 * own centre. The build is synchronous and single-threaded, so one module-level
 * slot is enough.
 */
let FOOT = null
const foot = (name, x, z, baseY) => FOOT && FOOT.push({ name, x, z, baseY })

function place(geometry, x, y, z, ry = 0) {
  _e.set(0, ry, 0)
  _q.setFromEuler(_e)
  _p.set(x, y, z)
  geometry.applyMatrix4(_m.compose(_p, _q, _s))
  return geometry
}

const box = (list, w, h, d, x, y, z, ry = 0) =>
  list.push(place(new THREE.BoxGeometry(w, h, d), x, y, z, ry))

const cyl = (list, r, h, x, y, z, seg = 12) =>
  list.push(place(new THREE.CylinderGeometry(r, r, h, seg), x, y, z))

/**
 * A building: slab to the skirt line, main mass, a lighter roof cap, and a
 * row of window banding cut in as darker slabs. Four boxes, but read at
 * distance as something with floors.
 */
function building(list, { w, h, d, x, z, y, ry = 0, roof = true, bands = 3, glass }) {
  foot('building', x, z, y - SKIRT)
  box(list, w * 1.06, SKIRT, d * 1.06, x, y - SKIRT / 2, z, ry)
  box(list, w, h, d, x, y + h / 2, z, ry)
  if (roof) box(list, w * 1.04, h * 0.04 + 0.6, d * 1.04, x, y + h, z, ry)
  for (let i = 0; i < bands; i++) {
    const by = y + (h * (i + 0.55)) / bands
    box(list, w * 1.012, h * 0.1, d * 1.012, x, by, z, ry)
  }
  if (glass) {
    // A curtain-wall face: one slab proud of the front, slightly proud again.
    box(list, w * 0.9, h * 0.7, 0.35, x, y + h * 0.5, z + d / 2 + 0.18, ry)
  }
}

/**
 * A lattice-ish tower mast: a tapering column with three cross-arms and a
 * beacon sphere. Reads as a comms or lightning mast at any distance a person
 * can see the pad from.
 */
function mast(list, { x, z, y, h, r = 1.2 }) {
  foot('mast', x, z, y - SKIRT)
  cyl(list, r, h + SKIRT, x, y + h / 2 - SKIRT / 2, z, 8)
  for (let i = 1; i <= 3; i++) {
    const t = i / 4
    box(list, r * 7 * (1 - t * 0.4), 0.5, r * 7 * (1 - t * 0.4), x, y + h * t, z)
  }
  list.push(place(new THREE.SphereGeometry(r * 1.6, 10, 8), x, y + h + r, z))
}

/** A water tower: legs, tank, conical roof. The skyline signature of every coastal pad. */
function waterTower(list, { x, z, y, h = 34, r = 9 }) {
  foot('waterTower', x, z, y)
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4
    cyl(list, 0.7, h, x + Math.cos(a) * r * 0.7, y + h / 2, z + Math.sin(a) * r * 0.7, 6)
  }
  cyl(list, r, r * 1.15, x, y + h + r * 0.55, z, 16)
  list.push(place(new THREE.ConeGeometry(r * 1.04, r * 0.7, 16), x, y + h + r * 1.5, z))
}

/** A bus/vehicle roofline row along a road: instanced later; here a stand. */
function grandstand(list, { x, z, y, w = 60, d = 14, ry = 0 }) {
  // Raked seating on a skirt, with a roof slab and side walls.
  foot('grandstand', x, z, y - SKIRT)
  box(list, w, SKIRT, d, x, y - SKIRT / 2, z, ry)
  for (let r = 0; r < 4; r++) {
    box(list, w, 1.4, d / 5, x, y + 1.4 * r + 0.7, z + (d / 2) - (d / 10) - r * (d / 5), ry)
  }
  box(list, w * 1.02, 0.8, d * 0.9, x, y + 8.2, z, ry)
  box(list, 1.2, 8, d, x - w / 2, y + 4, z, ry)
  box(list, 1.2, 8, d, x + w / 2, y + 4, z, ry)
}

/** A long shed / integration building: low, wide, with a rounded-ish roof line. */
function hangar(list, { x, z, y, w, h, d, ry = 0 }) {
  building(list, { w, h, d, x, z, y, ry, bands: 1 })
  box(list, w * 1.02, h * 0.12, d * 0.2, x, y + h * 1.06, z, ry)
}

/* ------------------------------------------------------------------ *
 * Per-site worlds
 * ------------------------------------------------------------------ */

/**
 * Kennedy: the whole Merritt Island complex seen from the pad. The VAB is
 * 218 × 160 × 160 m of box with the world's largest doors on one face, and it
 * is genuinely visible from 39B across the marsh. The crawlerway runs from the
 * apron to it as two pale concrete ribbons. The press site and causeway sit
 * off east with their stands and their traffic.
 */
function ksc(out, y) {
  const { solid, glass, green, dark, crowd, car, tree } = out
  // VAB — 5.5 km south-west of the pad, as it really is.
  building(solid, { w: 160, h: 160, d: 218, x: -2600, z: -4100, y: y(-2600, -4100), bands: 2 })
  // The iconic door face and its apron of firedoor ribs.
  box(glass, 130, 139, 3, -2600, y(-2600, -4100) + 76, -4100 + 111)
  for (let i = 0; i < 7; i++) box(solid, 1.4, 139, 4, -2600 - 60 + i * 20, y(-2600, -4100) + 76, -4100 + 113)
  // LCC — the four-storey Launch Control Center beside it.
  building(solid, { w: 92, h: 26, d: 58, x: -2280, z: -3820, y: y(-2280, -3820), glass: true, bands: 4 })
  // The crawlerway: two ribbons of reinforced concrete, 130 m wide overall.
  for (let i = 0; i <= 24; i++) {
    const t = i / 24
    const cx = -2600 * t + 0 * (1 - t) * 0.2
    const cz = -4100 * t
    const w = 44 * (1 - t * 0.15)
    box(solid, w, 1.2, 200, cx - 16, y(cx, cz) + 0.6, cz, Math.atan2(-2600, -4100))
    box(solid, w, 1.2, 200, cx + 16, y(cx, cz) + 0.6, cz, Math.atan2(-2600, -4100))
  }
  // Water towers: the two by the pad, the one by the turn basin.
  waterTower(solid, { x: 620, z: -520, y: y(620, -520) })
  waterTower(solid, { x: -820, z: -940, y: y(-820, -940) })
  // The press site and the causeway: stands, road, parking.
  grandstand(solid, { x: 2900, z: 2500, y: y(2900, 2500), w: 84, ry: Math.PI * 0.82 })
  grandstand(solid, { x: 2740, z: 2760, y: y(2740, 2760), w: 60, ry: Math.PI * 0.82 })
  building(solid, { w: 70, h: 14, d: 34, x: 3040, z: 2120, y: y(3040, 2120), bands: 1, ry: 0.4 })
  // Parking lots — the flat dark rectangles a marsh keeps. Thin, so the cars
  // parked on them sit on the surface rather than in it.
  box(dark, 420, 0.3, 240, 3250, y(3250, 2450) + 0.15, 2450, 0.4)
  box(dark, 300, 0.3, 180, 2500, y(2500, 3050) + 0.15, 3050, 0.4)
  // The road north to the causeway.
  box(dark, 16, 0.35, 2600, 3060, y(3060, 1000) + 0.175, 1000, 0.18)
  // A pair of comms masts on the pad apron, and the perimeter masts.
  mast(solid, { x: 480, z: 620, y: y(480, 620), h: 68, r: 1.6 })
  mast(solid, { x: -520, z: 700, y: y(-520, 700), h: 62, r: 1.5 })
  // Fuel farm: three spherical tanks on the west approach.
  for (let i = 0; i < 3; i++) {
    const x = -1150 - i * 130
    const z = -180
    foot('tank', x, z, y(x, z))
    cyl(solid, 9, 22, x, y(x, z) + 11, z, 12)
    list_sphere(solid, 17, x, y(x, z) + 32, z)
  }
  // Vegetation: palms along the roads, hardwood hammocks in the marsh.
  for (let i = 0; i < 130; i++) {
    const a = (i * 2.399963) % (Math.PI * 2)
    const r = 700 + ((i * 733) % 2600)
    tree.push([Math.cos(a) * r * 1.25 + 300, 0, Math.sin(a) * r, 0.8 + ((i * 37) % 9) / 12])
  }
  // Cars on the lots and the road, buses on the causeway.
  for (let i = 0; i < 150; i++) {
    const lot = i % 3
    const x = (lot === 0 ? 3250 : lot === 1 ? 2500 : 3060) + (((i * 149) % 100) / 100 - 0.5) * (lot === 2 ? 20 : 380)
    const z = (lot === 0 ? 2450 : lot === 1 ? 3050 : 1000) + (((i * 211) % 100) / 100 - 0.5) * (lot === 2 ? 2400 : 220)
    car.push([x, 0, z, ((i * 67) % 100) / 100])
  }
  // The crowd: filling the stands' front apron, facing the pad.
  for (let i = 0; i < 260; i++) {
    const stand = i % 2
    const x = (stand ? 2740 : 2900) + (((i * 173) % 100) / 100 - 0.5) * (stand ? 56 : 80)
    const z = (stand ? 2760 : 2500) - 12 + (((i * 191) % 100) / 100 - 0.5) * 10
    crowd.push([x, 0, z, ((i * 43) % 100) / 100])
  }
  // Marsh hardwood hammocks read as denser green blobs.
  for (let i = 0; i < 40; i++) {
    const a = (i * 1.7) % (Math.PI * 2)
    const r = 1600 + ((i * 421) % 3800)
    tree.push([Math.cos(a) * r, 0, Math.sin(a) * r * 0.9 - 600, 1.15 + ((i * 29) % 7) / 10])
  }
  void green
}

/**
 * Vandenberg: SLC-6 on its mesa, the Pacific behind. A long integration
 * hangar, a water tower, the road up from the valley, and the chaparral.
 */
function vandenberg(out, y) {
  const { solid, dark, crowd, car, tree, green } = out
  hangar(solid, { x: -420, z: -820, y: y(-420, -820), w: 96, h: 30, d: 52, ry: 0.32 })
  building(solid, { w: 42, h: 18, d: 30, x: 210, z: -620, y: y(210, -620), bands: 2 })
  waterTower(solid, { x: -760, z: 240, y: y(-760, 240), h: 30, r: 8 })
  mast(solid, { x: 560, z: -180, y: y(560, -180), h: 74, r: 1.7 })
  mast(solid, { x: 680, z: 320, y: y(680, 320), h: 58, r: 1.4 })
  building(solid, { w: 64, h: 12, d: 26, x: 470, z: 640, y: y(470, 640), bands: 1 })
  box(dark, 15, 0.35, 2200, 380, y(380, -200) + 0.175, -200, 0.12)
  box(dark, 260, 0.3, 150, 420, y(420, 520) + 0.15, 520, 0.12)
  grandstand(solid, { x: 900, z: -420, y: y(900, -420), w: 44, ry: -0.7 })
  for (let i = 0; i < 70; i++) {
    const a = (i * 2.399963) % (Math.PI * 2)
    const r = 500 + ((i * 617) % 2400)
    tree.push([Math.cos(a) * r, 0, Math.sin(a) * r, 0.5 + ((i * 31) % 8) / 14])
  }
  for (let i = 0; i < 60; i++) {
    const x = 420 + (((i * 137) % 100) / 100 - 0.5) * 240
    const z = 520 + (((i * 223) % 100) / 100 - 0.5) * 130
    car.push([x, 0, z, ((i * 71) % 100) / 100])
  }
  for (let i = 0; i < 120; i++) {
    const x = 900 + (((i * 151) % 100) / 100 - 0.5) * 40
    const z = -420 - 10 + (((i * 181) % 100) / 100 - 0.5) * 8
    crowd.push([x, 0, z, ((i * 47) % 100) / 100])
  }
  void green
}

/**
 * Baikonur: the steppe, the MIK — a quarter-kilometre of assembly building —
 * the rail spur that brought the rocket here, and the town on the horizon.
 */
function baikonur(out, y) {
  const { solid, dark, crowd, car, tree, green } = out
  hangar(solid, { x: -700, z: -1500, y: y(-700, -1500), w: 240, h: 60, d: 100, ry: 0.2 })
  building(solid, { w: 60, h: 20, d: 44, x: -380, z: -1180, y: y(-380, -1180), bands: 2, ry: 0.2 })
  // The rail spur: two dark ribbons with sleepers, running to the pad apron.
  for (let i = 0; i <= 18; i++) {
    const t = i / 18
    const x = -700 * t
    const z = -1500 * t + 260 * (1 - t)
    box(dark, 2.4, 0.7, 130, x - 3.8, y(x, z) + 0.4, z, Math.atan2(-700, -1760))
    box(dark, 2.4, 0.7, 130, x + 3.8, y(x, z) + 0.4, z, Math.atan2(-700, -1760))
    box(solid, 12, 0.5, 3.2, x, y(x, z) + 0.3, z, Math.atan2(-700, -1760))
  }
  waterTower(solid, { x: 380, z: -420, y: y(380, -420), h: 28, r: 8 })
  mast(solid, { x: -260, z: 560, y: y(-260, 560), h: 52, r: 1.3 })
  mast(solid, { x: 320, z: 660, y: y(320, 660), h: 52, r: 1.3 })
  // The town: two rows of low blocks on the north horizon.
  for (let i = 0; i < 9; i++) {
    const x = 900 + i * 210
    const z = -2300 - (i % 3) * 160
    building(solid, { w: 120, h: 22 + (i % 4) * 6, d: 34, x, z, y: y(x, z), bands: 4 })
  }
  grandstand(solid, { x: 840, z: 900, y: y(840, 900), w: 56, ry: 2.5 })
  box(dark, 14, 0.35, 1800, 640, y(640, -300) + 0.175, -300, 0.1)
  for (let i = 0; i < 46; i++) {
    const a = (i * 2.399963) % (Math.PI * 2)
    const r = 700 + ((i * 523) % 3200)
    tree.push([Math.cos(a) * r, 0, Math.sin(a) * r, 0.42 + ((i * 37) % 6) / 16])
  }
  for (let i = 0; i < 80; i++) {
    const x = 640 + (((i * 163) % 100) / 100 - 0.5) * 16
    const z = -300 + (((i * 227) % 100) / 100 - 0.5) * 1700
    car.push([x, 0, z, ((i * 53) % 100) / 100])
  }
  for (let i = 0; i < 140; i++) {
    const x = 840 + (((i * 179) % 100) / 100 - 0.5) * 52
    const z = 900 - 11 + (((i * 197) % 100) / 100 - 0.5) * 10
    crowd.push([x, 0, z, ((i * 59) % 100) / 100])
  }
  void green
}

/**
 * Kourou: jungle. The Jupiter control centre, the two integration buildings,
 * the Route de l'Europe — and then, everywhere, canopy.
 */
function kourou(out, y) {
  const { solid, glass, dark, crowd, car, tree, green } = out
  building(solid, { w: 88, h: 34, d: 60, x: -620, z: -1100, y: y(-620, -1100), glass: true, bands: 4 })
  hangar(solid, { x: -300, z: -1520, y: y(-300, -1520), w: 130, h: 36, d: 64, ry: -0.18 })
  hangar(solid, { x: -980, z: -760, y: y(-980, -760), w: 110, h: 30, d: 54, ry: 0.5 })
  waterTower(solid, { x: 360, z: -380, y: y(360, -380), h: 26, r: 7 })
  mast(solid, { x: 520, z: -140, y: y(520, -140), h: 66, r: 1.5 })
  mast(solid, { x: -640, z: 420, y: y(-640, 420), h: 58, r: 1.4 })
  box(dark, 14, 0.35, 2400, 240, y(240, -400) + 0.175, -400, 0.14)
  grandstand(solid, { x: 760, z: 720, y: y(760, 720), w: 50, ry: 2.6 })
  // Jungle: three species' worth of canopy, dense and tall.
  for (let i = 0; i < 420; i++) {
    const a = (i * 2.399963) % (Math.PI * 2)
    const r = 420 + ((i * 379) % 4200)
    const x = Math.cos(a) * r * 1.15
    const z = Math.sin(a) * r
    if (Math.abs(x) < 700 && Math.abs(z) < 700) continue
    tree.push([x, 0, z, 1.1 + ((i * 23) % 11) / 8])
  }
  for (let i = 0; i < 70; i++) {
    const x = 240 + (((i * 141) % 100) / 100 - 0.5) * 14
    const z = -400 + (((i * 219) % 100) / 100 - 0.5) * 2300
    car.push([x, 0, z, ((i * 61) % 100) / 100])
  }
  for (let i = 0; i < 110; i++) {
    const x = 760 + (((i * 167) % 100) / 100 - 0.5) * 46
    const z = 720 - 11 + (((i * 187) % 100) / 100 - 0.5) * 10
    crowd.push([x, 0, z, ((i * 41) % 100) / 100])
  }
  void green
  void glass
}

const list_sphere = (list, r, x, y, z) => list.push(place(new THREE.SphereGeometry(r, 14, 10), x, y, z))

const BUILDERS = {
  ksc,
  vandenberg,
  baikonur,
  kourou,
}

/* ------------------------------------------------------------------ *
 * Instance families: the three draw calls that carry the crowds
 * ------------------------------------------------------------------ */

/** A tree: trunk and two canopy blobs, merged so one instance is one tree. */
export function treeGeometry() {
  const parts = [
    place(new THREE.CylinderGeometry(0.55, 0.85, 7, 6), 0, 3.5, 0),
    place(new THREE.SphereGeometry(3.4, 8, 6), 0, 8.2, 0),
    place(new THREE.SphereGeometry(2.3, 8, 6), 1.6, 10.2, -1.1),
  ]
  return mergeGeometries(parts.map((g) => g.toNonIndexed()), false)
}

/** A car seen from the stand: body, cabin, a hint of glass. */
export function carGeometry() {
  const parts = [
    place(new THREE.BoxGeometry(4.4, 1.25, 1.9), 0, 0.95, 0),
    place(new THREE.BoxGeometry(2.3, 0.85, 1.72), -0.25, 1.85, 0),
    place(new THREE.BoxGeometry(2.32, 0.5, 1.74), -0.25, 1.98, 0),
  ]
  return mergeGeometries(parts.map((g) => g.toNonIndexed()), false)
}

/** A person at 1.75 m: legs, torso, head. Small, but there are hundreds. */
export function personGeometry() {
  const parts = [
    place(new THREE.BoxGeometry(0.52, 0.85, 0.3), 0, 0.425, 0),
    place(new THREE.BoxGeometry(0.5, 0.68, 0.28), 0, 1.18, 0),
    place(new THREE.SphereGeometry(0.125, 8, 6), 0, 1.63, 0),
  ]
  return mergeGeometries(parts.map((g) => g.toNonIndexed()), false)
}

/* ------------------------------------------------------------------ *
 * The build
 * ------------------------------------------------------------------ */

/**
 * Build one site's surroundings.
 *
 * `groundAt(x, z)` returns the terrain height in the pad frame at that point —
 * the same height Terrain.jsx draws. Every structure is sunk `SKIRT` below the
 * height sampled at its own centre, which is what makes floating impossible:
 * the base always crosses the surface, however the relief runs under it.
 *
 * Returns merged geometries per material key plus the three instance lists
 * (position + a per-instance random 0..1 in `w` for colour and scale jitter).
 * No THREE.InstancedMesh here — the component owns those, so this stays pure
 * and Node-buildable.
 */
export function makeGroundSampler(positions, cell = 512) {
  /**
   * A nearest-vertex height sampler over Terrain's built mesh: bucket the
   * vertices into `cell`-metre cells once, then each query reads the closest
   * vertex in the 3 × 3 cell neighbourhood. Terrain's grid is 130 m-sampled,
   * so nearest-vertex is exact at the fidelity the mesh itself has.
   *
   * Positions are the mesh's own buffer — the pad frame, x east, y up,
   * z north — so a query in the surround's coordinates answers in the
   * surround's coordinates. Mirroring happens in the shared group, once.
   */
  const buckets = new Map()
  const n = positions.length / 3
  for (let i = 0; i < n; i++) {
    const key = (Math.floor(positions[i * 3] / cell) << 16) ^ (Math.floor(positions[i * 3 + 2] / cell) & 0xffff)
    let b = buckets.get(key)
    if (!b) buckets.set(key, (b = []))
    b.push(i)
  }
  return (x, z) => {
    const cx = Math.floor(x / cell)
    const cz = Math.floor(z / cell)
    let best = Infinity
    let bestY = 0
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const b = buckets.get(((cx + dx) << 16) ^ ((cz + dz) & 0xffff))
        if (!b) continue
        for (let k = 0; k < b.length; k++) {
          const i = b[k]
          const ex = positions[i * 3] - x
          const ez = positions[i * 3 + 2] - z
          const d = ex * ex + ez * ez
          if (d < best) {
            best = d
            bestY = positions[i * 3 + 1]
          }
        }
      }
    }
    return bestY
  }
}

export function buildSurround(siteId, groundAt = () => 0) {
  const footLedger = (FOOT = [])
  const solid = []
  const glass = []
  const green = []
  const dark = []
  const crowd = []
  const car = []
  const tree = []

  const y = (x, z) => groundAt(x, z)
  const build = BUILDERS[siteId]
  // Lunar sites have LunarSurface and their own detail; only the four Earth
  // complexes get a world around the pad.
  if (!build) {
    FOOT = null
    return { solid: null, glass: null, green: null, dark: null, instances: { tree: [], car: [], crowd: [] }, foot: [] }
  }
  build({ solid, glass, green, dark, crowd, car, tree }, y)
  FOOT = null

  const merge = (list) => {
    if (list.length === 0) return null
    const flat = list.map((g) => (g.index ? g.toNonIndexed() : g))
    const merged = mergeGeometries(flat, false)
    for (const g of list) g.dispose()
    for (const g of flat) if (!list.includes(g)) g.dispose()
    return merged
  }

  return {
    solid: merge(solid),
    glass: merge(glass),
    green: merge(green),
    dark: merge(dark),
    // Instance lists as flat [x, y, z, w] where y is *relative to ground*: the
    // component adds groundAt at instance time so trees and people follow the
    // relief the way the buildings' skirts do.
    instances: {
      tree: tree.map(([x, , z, w]) => [x, y(x, z), z, w]),
      car: car.map(([x, , z, w]) => [x, y(x, z), z, w]),
      crowd: crowd.map(([x, , z, w]) => [x, y(x, z), z, w]),
    },
    foot: footLedger,
  }
}
