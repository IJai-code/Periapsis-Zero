import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'

/**
 * The world around the pad: buildings, roads, the people who came to watch.
 * Pure three.js like `padGeometry.js`, so `scripts/verify-surround.mjs` can
 * build every site under Node and measure it.
 *
 * The pad structures stand on a graded, surveyed rectangle. Everything past
 * that rectangle is Florida scrub, Kazakh steppe, Guianan forest or Vandenberg
 * chaparral — see `flora.js` for what grows there — and, at the real
 * complexes, an enormous amount of civilisation: the Vehicle Assembly Building
 * three miles down the crawlerway, the Launch Control Center with its slanted
 * firing-room windows turned to face the pads, the other pad of Complex 39,
 * the propellant spheres, the press site with its countdown clock, the roads
 * and the lots full at dawn.
 *
 * Everything is in the pad's local frame — x east, y up, z north, origin at
 * the site's coordinates on the terrain datum — the same frame `padGeometry`
 * builds in, so this mounts beside `LaunchPad` in the terrain group and cannot
 * drift off the ground. Each structure is given a **skirt** — its base extends
 * `SKIRT` metres below the height sampled at its centre — so it meets the real
 * 130 m-sampled relief by construction. Roads are laid in short segments, each
 * at its own sampled height, so a road follows the ground instead of floating
 * off one end of a slope.
 *
 * Every vertex carries a `style` and a colour. One material draws all of it
 * (see `facade.js`): the style says whether a face is ribbed industrial
 * cladding, an office front with floors of windows, bare concrete, asphalt
 * with its lane markings, gravel, glass, a painted tank or bare steel, and the
 * facade shader draws that detail at whatever scale the pixel can hold.
 */

/** How far below the sampled ground a structure's base reaches, m. */
export const SKIRT = 6

/** Surface styles the facade shader knows. */
export const STYLE = {
  panel: 0,
  office: 1,
  concrete: 2,
  asphalt: 3,
  gravel: 4,
  glass: 5,
  tank: 6,
  steel: 7,
}

const _m = new THREE.Matrix4()
const _q = new THREE.Quaternion()
const _e = new THREE.Euler()
const _p = new THREE.Vector3()
const _s = new THREE.Vector3(1, 1, 1)
const _col = new THREE.Color()

/**
 * A per-structure ledger, filled while the site builds and emptied afterwards.
 * Merged geometry cannot say which building a vertex belongs to — but floating
 * is a per-structure property, so `verify-surround` needs exactly that: for
 * every structure, where its base sits relative to the ground sampled at its
 * own centre. The build is synchronous and single-threaded, so one module-level
 * slot is enough. `r` is how far the footprint reaches, which the flora keeps
 * clear of.
 */
let FOOT = null
const foot = (name, x, z, baseY, r = 20) => FOOT && FOOT.push({ name, x, z, baseY, r })

/** Roads, crawlerways, rail spurs: strips nothing may grow on. */
let STRIPS = null
const strip = (x1, z1, x2, z2, w) => STRIPS && STRIPS.push({ x1, z1, x2, z2, w })

/** Stamp a style and a colour on every vertex of a geometry. */
function paint(geometry, style, colour) {
  const g = geometry.index ? geometry.toNonIndexed() : geometry
  if (g !== geometry) geometry.dispose()
  const n = g.attributes.position.count
  const col = new Float32Array(n * 3)
  _col.set(colour)
  for (let i = 0; i < n; i++) {
    col[i * 3] = _col.r
    col[i * 3 + 1] = _col.g
    col[i * 3 + 2] = _col.b
  }
  g.setAttribute('style', new THREE.BufferAttribute(new Float32Array(n).fill(style), 1))
  g.setAttribute('color', new THREE.BufferAttribute(col, 3))
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2))
  return g
}

function place(geometry, x, y, z, ry = 0, rx = 0, rz = 0) {
  _e.set(rx, ry, rz)
  _q.setFromEuler(_e)
  _p.set(x, y, z)
  geometry.applyMatrix4(_m.compose(_p, _q, _s))
  return geometry
}

const box = (list, w, h, d, x, y, z, ry = 0, style = STYLE.panel, colour = '#b9b5ab') =>
  list.push(paint(place(new THREE.BoxGeometry(w, h, d), x, y, z, ry), style, colour))

const cyl = (list, r, h, x, y, z, seg = 12, style = STYLE.steel, colour = '#9aa0a4', rTop = r) =>
  list.push(paint(place(new THREE.CylinderGeometry(rTop, r, h, seg), x, y, z), style, colour))

const sphere = (list, r, x, y, z, style = STYLE.tank, colour = '#e8e8e4') =>
  list.push(paint(place(new THREE.SphereGeometry(r, 24, 14), x, y, z), style, colour))

/**
 * A road, laid in segments that each sit on the ground sampled under them, so
 * the road follows the relief rather than floating off one end of a slope.
 */
function road(list, y, x1, z1, x2, z2, w, style = STYLE.asphalt, colour = '#3a3b3d') {
  strip(x1, z1, x2, z2, w + 6)
  const len = Math.hypot(x2 - x1, z2 - z1)
  const n = Math.max(1, Math.ceil(len / 60))
  const ry = Math.atan2(x2 - x1, z2 - z1)
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n
    const x = x1 + (x2 - x1) * t
    const z = z1 + (z2 - z1) * t
    box(list, w, 0.4, len / n + 0.4, x, y(x, z) + 0.12, z, ry, style, colour)
  }
}

/**
 * A building: slab to the skirt line, main mass, a parapet and its roof plant.
 * The floors, windows and cladding are the facade shader's; the geometry is
 * the mass.
 */
function building(list, { w, h, d, x, z, y, ry = 0, style = STYLE.office, colour = '#c9c6bf', roofColour = '#8d8b86' }) {
  foot('building', x, z, y - SKIRT, Math.hypot(w, d) / 2 + 12)
  box(list, w * 1.02, SKIRT, d * 1.02, x, y - SKIRT / 2, z, ry, STYLE.concrete, '#a9a59c')
  box(list, w, h, d, x, y + h / 2, z, ry, style, colour)
  box(list, w + 0.8, 1.2, d + 0.8, x, y + h + 0.6, z, ry, STYLE.concrete, roofColour)
  const ca = Math.cos(ry)
  const sa = Math.sin(ry)
  for (let i = 0; i < 2; i++) {
    const ox = (i - 0.5) * w * 0.35
    const oz = d * 0.15
    box(list, Math.min(8, w * 0.15), 2.4, Math.min(6, d * 0.15), x + ox * ca + oz * sa, y + h + 2.4, z - ox * sa + oz * ca, ry, STYLE.steel, '#8e9296')
  }
}

/** A comms or lightning mast: a tapering column, three platforms, a beacon. */
function mast(list, { x, z, y, h, r = 1.2 }) {
  foot('mast', x, z, y - SKIRT, 12)
  cyl(list, r, h + SKIRT, x, y + h / 2 - SKIRT / 2, z, 8, STYLE.steel, '#b83a2e', r * 0.55)
  for (let i = 1; i <= 3; i++) {
    const t = i / 4
    box(list, r * 6 * (1 - t * 0.4), 0.5, r * 6 * (1 - t * 0.4), x, y + h * t, z, 0, STYLE.steel, '#c8c8c4')
  }
  sphere(list, r * 1.4, x, y + h + r, z, STYLE.tank, '#e04a2f')
}

/** A water tower: legs, bracing, tank, conical roof. The skyline signature of every coastal pad. */
function waterTower(list, { x, z, y, h = 34, r = 9 }) {
  foot('waterTower', x, z, y, r * 2.5)
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4
    cyl(list, 0.7, h, x + Math.cos(a) * r * 0.7, y + h / 2, z + Math.sin(a) * r * 0.7, 6, STYLE.steel, '#9aa3a8')
  }
  for (let k = 1; k < 4; k++) {
    box(list, r * 1.4, 0.35, 0.35, x, y + (h * k) / 4, z + r * 0.7, 0, STYLE.steel, '#9aa3a8')
    box(list, r * 1.4, 0.35, 0.35, x, y + (h * k) / 4, z - r * 0.7, 0, STYLE.steel, '#9aa3a8')
  }
  cyl(list, r, r * 1.15, x, y + h + r * 0.55, z, 20, STYLE.tank, '#dcdcd6')
  list.push(paint(place(new THREE.ConeGeometry(r * 1.04, r * 0.7, 20), x, y + h + r * 1.5, z), STYLE.tank, '#cfcfc9'))
}

/** A grandstand: raked seating on a skirt, a roof slab and side walls. */
function grandstand(list, { x, z, y, w = 60, d = 14, ry = 0 }) {
  foot('grandstand', x, z, y - SKIRT, w / 2 + 40)
  box(list, w, SKIRT, d, x, y - SKIRT / 2, z, ry, STYLE.concrete, '#a8a49c')
  const ca = Math.cos(ry)
  const sa = Math.sin(ry)
  for (let r = 0; r < 5; r++) {
    const oz = d / 2 - d / 10 - r * (d / 5)
    box(list, w, 1.3, d / 5, x + oz * sa, y + 1.3 * r + 0.65, z + oz * ca, ry, STYLE.concrete, r % 2 ? '#b4b0a8' : '#9e9a92')
  }
  box(list, w * 1.02, 0.8, d * 0.9, x, y + 8.2, z, ry, STYLE.steel, '#d9d6cf')
  box(list, 1.2, 8, d, x - (w / 2) * ca, y + 4, z + (w / 2) * sa, ry, STYLE.concrete, '#a8a49c')
  box(list, 1.2, 8, d, x + (w / 2) * ca, y + 4, z - (w / 2) * sa, ry, STYLE.concrete, '#a8a49c')
}

/** A long shed / integration building, with its big door. */
function hangar(list, { x, z, y, w, h, d, ry = 0, colour = '#c3c0b8' }) {
  building(list, { w, h, d, x, z, y, ry, style: STYLE.panel, colour })
  box(list, w * 0.6, h * 0.8, 0.8, x + (d / 2 + 0.3) * Math.sin(ry), y + h * 0.4, z + (d / 2 + 0.3) * Math.cos(ry), ry, STYLE.steel, '#8f9498')
}

/**
 * A propellant sphere on its legs — the Horton spheres every Complex 39 pad
 * has: liquid oxygen on one side of the pad, liquid hydrogen on the other.
 */
function propellantSphere(list, { x, z, y, r = 10, legs = 8, colour = '#ececea' }) {
  foot('sphere', x, z, y, r * 2)
  const legH = r * 0.9
  for (let i = 0; i < legs; i++) {
    const a = (i / legs) * Math.PI * 2
    cyl(list, 0.45, legH + r * 0.4, x + Math.cos(a) * r * 0.82, y + (legH + r * 0.4) / 2, z + Math.sin(a) * r * 0.82, 6, STYLE.steel, '#a4a8ac')
  }
  sphere(list, r, x, y + legH + r, z, STYLE.tank, colour)
  cyl(list, r * 1.01, 0.8, x, y + legH + r, z, 32, STYLE.steel, '#b8bcbf')
  box(list, 2.4, legH + r * 2, 2.4, x + r * 1.15, y + (legH + r * 2) / 2, z, 0, STYLE.steel, '#7f8589')
}

/** A perimeter fence: posts and panels round a ring, with a gate gap. */
function fence(list, y, radius, gapAt = 0) {
  const n = Math.round((radius * Math.PI * 2) / 24)
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2
    if (Math.abs(((a - gapAt + 3 * Math.PI) % (Math.PI * 2)) - Math.PI) < 0.04) continue
    const a2 = ((i + 1) / n) * Math.PI * 2
    const x = Math.cos(a) * radius
    const z = Math.sin(a) * radius
    const xm = (Math.cos(a) + Math.cos(a2)) * 0.5 * radius
    const zm = (Math.sin(a) + Math.sin(a2)) * 0.5 * radius
    cyl(list, 0.06, 2.4, x, y(x, z) + 1.2, z, 4, STYLE.steel, '#8c8f91')
    box(list, 0.05, 1.9, (radius * Math.PI * 2) / n, xm, y(xm, zm) + 1.2, zm, -a - Math.PI / 2 + Math.PI / n, STYLE.steel, '#9ea2a4')
  }
}

/** A camera pad: the remote cameras every launch is filmed from, on their stands. */
function cameraPad(list, y, x, z, facing) {
  const g = y(x, z)
  box(list, 3, 0.3, 3, x, g + 0.15, z, facing, STYLE.concrete, '#b4b0a6')
  for (let i = 0; i < 3; i++) {
    const a = facing + (i / 3) * Math.PI * 2
    cyl(list, 0.03, 1.5, x + Math.cos(a) * 0.35, g + 1.0, z + Math.sin(a) * 0.35, 4, STYLE.steel, '#2e2e2e')
  }
  box(list, 0.5, 0.45, 0.8, x, g + 1.95, z, facing, STYLE.steel, '#d8d8d2')
}

/** A slanted glazing band, for the LCC's firing rooms. */
function slantedGlass(list, x, y, z, w) {
  const g = new THREE.BoxGeometry(w, 5.5, 0.6)
  place(g, x, y, z, 0, -0.45)
  list.push(paint(g, STYLE.glass, '#1f2a33'))
}

/** The press site's countdown clock: a black board on a frame, and a flagpole beside it. */
function countdownClock(list, x, z, y, ry) {
  foot('clock', x, z, y - SKIRT, 30)
  box(list, 26, SKIRT, 3, x, y - SKIRT / 2, z, ry, STYLE.concrete, '#9e9a92')
  box(list, 24, 5.2, 1.2, x, y + 4.5, z, ry, STYLE.steel, '#121212')
  box(list, 0.5, 4, 0.5, x - 10 * Math.cos(ry), y + 2, z + 10 * Math.sin(ry), ry, STYLE.steel, '#6e7072')
  box(list, 0.5, 4, 0.5, x + 10 * Math.cos(ry), y + 2, z - 10 * Math.sin(ry), ry, STYLE.steel, '#6e7072')
  cyl(list, 0.12, 24, x + 18 * Math.cos(ry), y + 12, z - 18 * Math.sin(ry), 6, STYLE.steel, '#d0d0cc')
}

/* ------------------------------------------------------------------ *
 * Per-site worlds
 * ------------------------------------------------------------------ */

/**
 * Kennedy, Launch Complex 39. The Vehicle Assembly Building is 158 m wide,
 * 218 m long and 160 m high — its high bays under the full height, its low
 * bay 64 m high across the south end — with the four doors 139 m tall on its
 * long faces, an inverted T of stacked panels, and it stands four and a half
 * kilometres south-west of 39B, where the crawlerway runs from its east doors
 * to the pad ramp. The Launch Control Center sits off its south-east corner,
 * its firing rooms behind slanted windows angled up at the pads. The other pad
 * of the complex, 39A, is 2.7 km south-south-east.
 */
function ksc(out, y) {
  const { solid, crowd, car } = out
  const vx = -2900
  const vz = -4400
  const vy = y(vx, vz)
  foot('vab', vx, vz, vy - SKIRT, 180)
  box(solid, 162, SKIRT, 222, vx, vy - SKIRT / 2, vz, 0, STYLE.concrete, '#a9a59c')
  // High bay block, the north 160 m of the building; the low bay across the south.
  box(solid, 158, 160, 160, vx, vy + 80, vz + 29, 0, STYLE.panel, '#c6c9ca')
  box(solid, 158, 64, 58, vx, vy + 32, vz - 80, 0, STYLE.panel, '#bfc2c3')
  box(solid, 160, 1.6, 162, vx, vy + 160.8, vz + 29, 0, STYLE.concrete, '#8a8c8c')
  // The high bay doors: east and west faces, two each, an inverted T.
  for (const side of [-1, 1]) {
    for (const dz of [-30, 70]) {
      const fx = vx + side * 79.4
      box(solid, 1.4, 139, 23, fx, vy + 69.5, vz + dz, 0, STYLE.panel, '#9ea3a6')
      box(solid, 1.6, 35, 46, fx, vy + 17.5, vz + dz, 0, STYLE.panel, '#a4a9ab')
    }
  }
  // Louvre band high on the walls.
  box(solid, 158.6, 8, 160.6, vx, vy + 146, vz + 29, 0, STYLE.steel, '#9da2a4')
  // The Launch Control Center, and its angled firing-room windows facing the pads.
  const lx = vx + 150
  const lz = vz - 130
  const ly = y(lx, lz)
  building(solid, { w: 115, h: 23, d: 55, x: lx, z: lz, y: ly, style: STYLE.office, colour: '#dedbd4' })
  box(solid, 112, 5.5, 3.2, lx, ly + 17, lz + 29, 0, STYLE.glass, '#23303a')
  slantedGlass(solid, lx, ly + 19.5, lz + 29.8, 112)
  // The crawlerway: two lanes of river gravel, each 12 m, a 15 m median, from
  // the VAB's east doors to the ramp up onto the pad.
  const c0x = vx + 95
  const c0z = vz + 40
  const c1x = -210
  const c1z = -260
  const cang = Math.atan2(c1x - c0x, c1z - c0z)
  for (const off of [-13.5, 13.5]) {
    const ox = Math.cos(cang) * off
    const oz = -Math.sin(cang) * off
    road(solid, y, c0x + ox, c0z + oz, c1x + ox, c1z + oz, 12, STYLE.gravel, '#d9d4c6')
  }
  // The branch to 39A.
  const ax = 1660
  const az = -2100
  const jx = c0x + (c1x - c0x) * 0.45
  const jz = c0z + (c1z - c0z) * 0.45
  const bang = Math.atan2(ax - 220 - jx, az + 180 - jz)
  for (const off of [-13.5, 13.5]) {
    const ox = Math.cos(bang) * off
    const oz = -Math.sin(bang) * off
    road(solid, y, jx + ox, jz + oz, ax - 220 + ox, az + 180 + oz, 12, STYLE.gravel, '#d9d4c6')
  }
  // Pad 39A in the distance: its mound, a service tower and its own spheres.
  const ay = y(ax, az)
  foot('pad39a', ax, az, ay - SKIRT, 160)
  box(solid, 120, SKIRT + 14, 120, ax, ay + 7 - SKIRT / 2, az, 0, STYLE.concrete, '#a6a39b')
  box(solid, 13, 118, 13, ax + 22, ay + 14 + 59, az, 0, STYLE.steel, '#8b2a24')
  box(solid, 40, 7.5, 45, ax, ay + 14 + 3.7, az, 0, STYLE.steel, '#6f6f6d')
  propellantSphere(solid, { x: ax - 380, z: az + 230, y: y(ax - 380, az + 230), r: 11.5 })
  propellantSphere(solid, { x: ax + 330, z: az + 250, y: y(ax + 330, az + 250), r: 12.5 })
  // 39B's own propellant farm: liquid oxygen north-west, liquid hydrogen north-east.
  propellantSphere(solid, { x: -390, z: 280, y: y(-390, 280), r: 11.5 })
  propellantSphere(solid, { x: 360, z: 300, y: y(360, 300), r: 12.5 })
  waterTower(solid, { x: 620, z: -520, y: y(620, -520) })
  building(solid, { w: 36, h: 9, d: 22, x: -470, z: -380, y: y(-470, -380), style: STYLE.office, colour: '#d6d2c8' })
  building(solid, { w: 28, h: 7, d: 18, x: 450, z: -430, y: y(450, -430), style: STYLE.panel, colour: '#cfcbc2' })
  // The perimeter road and fence.
  const ring = 430
  for (let i = 0; i < 48; i++) {
    const a1 = (i / 48) * Math.PI * 2
    const a2 = ((i + 1) / 48) * Math.PI * 2
    road(solid, y, Math.cos(a1) * ring, Math.sin(a1) * ring, Math.cos(a2) * ring, Math.sin(a2) * ring, 7)
  }
  fence(solid, y, 470, Math.atan2(c1z, c1x))
  // Remote camera pads round the pad, where the launch films come from.
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + 0.2
    const r = 150 + (i % 3) * 40
    cameraPad(solid, y, Math.cos(a) * r, Math.sin(a) * r, a + Math.PI)
  }
  // The press site, 5.6 km out, with its countdown clock and grandstands.
  const px = 2900
  const pz = 2500
  grandstand(solid, { x: px, z: pz, y: y(px, pz), w: 84, ry: Math.PI * 0.82 })
  grandstand(solid, { x: px - 160, z: pz + 260, y: y(px - 160, pz + 260), w: 60, ry: Math.PI * 0.82 })
  building(solid, { w: 70, h: 14, d: 34, x: px + 140, z: pz - 380, y: y(px + 140, pz - 380), style: STYLE.office, ry: 0.4 })
  countdownClock(solid, px - 90, pz - 120, y(px - 90, pz - 120), Math.PI * 0.82)
  // Lots and roads.
  road(solid, y, px + 180, pz - 60, px + 540, pz + 90, 150, STYLE.asphalt, '#3e3f41')
  road(solid, y, px - 400, pz + 480, px - 140, pz + 650, 120, STYLE.asphalt, '#3e3f41')
  road(solid, y, px + 160, pz - 600, px + 160, pz + 2400, 16)
  road(solid, y, 0, -430, 60, -1400, 9)
  road(solid, y, 60, -1400, px + 160, pz - 600, 12)
  mast(solid, { x: 480, z: 620, y: y(480, 620), h: 68, r: 1.6 })
  mast(solid, { x: -520, z: 700, y: y(-520, 700), h: 62, r: 1.5 })
  for (let i = 0; i < 220; i++) {
    const lot = i % 3
    const t = ((i * 149) % 100) / 100 - 0.5
    const u = ((i * 211) % 100) / 100 - 0.5
    const x = lot === 0 ? px + 360 + t * 330 : lot === 1 ? px - 270 + t * 250 : px + 160 + t * 12
    const z = lot === 0 ? pz + 15 + u * 120 : lot === 1 ? pz + 565 + u * 100 : pz + 900 + u * 2800
    car.push([x, 0, z, ((i * 67) % 100) / 100])
  }
  for (let i = 0; i < 320; i++) {
    const stand = i % 2
    const x = (stand ? px - 160 : px) + (((i * 173) % 100) / 100 - 0.5) * (stand ? 56 : 80)
    const z = (stand ? pz + 260 : pz) - 12 + (((i * 191) % 100) / 100 - 0.5) * 10
    crowd.push([x, 0, z, ((i * 43) % 100) / 100])
  }
}

/**
 * Vandenberg: SLC-6 on its mesa, the Pacific behind. A long integration
 * hangar, a water tower, the road up from the valley, and the chaparral.
 */
function vandenberg(out, y) {
  const { solid, crowd, car } = out
  hangar(solid, { x: -420, z: -820, y: y(-420, -820), w: 96, h: 30, d: 52, ry: 0.32 })
  building(solid, { w: 42, h: 18, d: 30, x: 210, z: -620, y: y(210, -620) })
  waterTower(solid, { x: -760, z: 240, y: y(-760, 240), h: 30, r: 8 })
  mast(solid, { x: 560, z: -180, y: y(560, -180), h: 74, r: 1.7 })
  mast(solid, { x: 680, z: 320, y: y(680, 320), h: 58, r: 1.4 })
  building(solid, { w: 64, h: 12, d: 26, x: 470, z: 640, y: y(470, 640), style: STYLE.panel })
  propellantSphere(solid, { x: -380, z: 300, y: y(-380, 300), r: 9 })
  propellantSphere(solid, { x: 360, z: -330, y: y(360, -330), r: 10 })
  road(solid, y, 250, -1300, 510, 900, 15)
  road(solid, y, 330, 470, 510, 570, 130)
  grandstand(solid, { x: 900, z: -420, y: y(900, -420), w: 44, ry: -0.7 })
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + 0.4
    cameraPad(solid, y, Math.cos(a) * 170, Math.sin(a) * 170, a + Math.PI)
  }
  for (let i = 0; i < 60; i++) {
    const x = 420 + (((i * 137) % 100) / 100 - 0.5) * 240
    const z = 520 + (((i * 223) % 100) / 100 - 0.5) * 110
    car.push([x, 0, z, ((i * 71) % 100) / 100])
  }
  for (let i = 0; i < 120; i++) {
    const x = 900 + (((i * 151) % 100) / 100 - 0.5) * 40
    const z = -420 - 10 + (((i * 181) % 100) / 100 - 0.5) * 8
    crowd.push([x, 0, z, ((i * 47) % 100) / 100])
  }
}

/**
 * Baikonur: the steppe, the MIK — a quarter-kilometre of assembly building —
 * the rail spur that brought the rocket here, and the town on the horizon.
 */
function baikonur(out, y) {
  const { solid, crowd, car } = out
  hangar(solid, { x: -700, z: -1500, y: y(-700, -1500), w: 240, h: 60, d: 100, ry: 0.2, colour: '#cfcac0' })
  building(solid, { w: 60, h: 20, d: 44, x: -380, z: -1180, y: y(-380, -1180), ry: 0.2 })
  // The rail spur: two rails on a ballast bed, laid on the ground, to the pad apron.
  const r0x = -700
  const r0z = -1240
  const ang = Math.atan2(0 - r0x, -120 - r0z)
  road(solid, y, r0x, r0z, 0, -120, 4.2, STYLE.gravel, '#8c857a')
  for (const off of [-0.76, 0.76]) {
    const ox = Math.cos(ang) * off
    const oz = -Math.sin(ang) * off
    road(solid, y, r0x + ox, r0z + oz, ox, -120 + oz, 0.14, STYLE.steel, '#4a4644')
  }
  waterTower(solid, { x: 380, z: -420, y: y(380, -420), h: 28, r: 8 })
  mast(solid, { x: -260, z: 560, y: y(-260, 560), h: 52, r: 1.3 })
  mast(solid, { x: 320, z: 660, y: y(320, 660), h: 52, r: 1.3 })
  propellantSphere(solid, { x: 420, z: 250, y: y(420, 250), r: 9, colour: '#dedad2' })
  // The town: rows of low blocks on the north horizon.
  for (let i = 0; i < 12; i++) {
    const x = 900 + (i % 6) * 210
    const z = -2300 - Math.floor(i / 6) * 260 - (i % 3) * 60
    building(solid, { w: 120, h: 18 + (i % 4) * 6, d: 34, x, z, y: y(x, z), colour: i % 2 ? '#d8cfbf' : '#cfc3ae' })
  }
  grandstand(solid, { x: 840, z: 900, y: y(840, 900), w: 56, ry: 2.5 })
  road(solid, y, 600, -1200, 680, 600, 14)
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
}

/**
 * Kourou: the Jupiter control centre, the integration buildings, the Route de
 * l'Europe — and then, everywhere, forest.
 */
function kourou(out, y) {
  const { solid, crowd, car } = out
  building(solid, { w: 88, h: 34, d: 60, x: -620, z: -1100, y: y(-620, -1100), colour: '#e2e0da' })
  hangar(solid, { x: -300, z: -1520, y: y(-300, -1520), w: 130, h: 36, d: 64, ry: -0.18, colour: '#dcdad4' })
  hangar(solid, { x: -980, z: -760, y: y(-980, -760), w: 110, h: 30, d: 54, ry: 0.5, colour: '#dcdad4' })
  waterTower(solid, { x: 360, z: -380, y: y(360, -380), h: 26, r: 7 })
  mast(solid, { x: 520, z: -140, y: y(520, -140), h: 66, r: 1.5 })
  mast(solid, { x: -640, z: 420, y: y(-640, 420), h: 58, r: 1.4 })
  propellantSphere(solid, { x: -420, z: 260, y: y(-420, 260), r: 9 })
  road(solid, y, 150, -1600, 330, 800, 14)
  grandstand(solid, { x: 760, z: 720, y: y(760, 720), w: 50, ry: 2.6 })
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + 0.1
    cameraPad(solid, y, Math.cos(a) * 180, Math.sin(a) * 180, a + Math.PI)
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
}

const BUILDERS = { ksc, vandenberg, baikonur, kourou }

/* ------------------------------------------------------------------ *
 * Instance families: cars and people
 * ------------------------------------------------------------------ */

/** A car seen from the stand: body, cabin, glass, wheels. */
export function carGeometry() {
  const parts = [
    place(new THREE.BoxGeometry(4.4, 0.9, 1.85), 0, 0.75, 0),
    place(new THREE.BoxGeometry(2.3, 0.75, 1.7), -0.25, 1.55, 0),
    place(new THREE.BoxGeometry(2.32, 0.5, 1.72), -0.25, 1.62, 0),
    place(new THREE.CylinderGeometry(0.34, 0.34, 1.9, 10), 1.35, 0.34, 0, 0, Math.PI / 2),
    place(new THREE.CylinderGeometry(0.34, 0.34, 1.9, 10), -1.35, 0.34, 0, 0, Math.PI / 2),
  ]
  return mergeGeometries(parts.map((g) => g.toNonIndexed()), false)
}

/** A person at 1.75 m: legs, torso, arms, head. Small, but there are hundreds. */
export function personGeometry() {
  const parts = [
    place(new THREE.BoxGeometry(0.2, 0.85, 0.24), -0.12, 0.425, 0),
    place(new THREE.BoxGeometry(0.2, 0.85, 0.24), 0.12, 0.425, 0),
    place(new THREE.BoxGeometry(0.5, 0.64, 0.28), 0, 1.18, 0),
    place(new THREE.BoxGeometry(0.12, 0.6, 0.14), -0.32, 1.12, 0),
    place(new THREE.BoxGeometry(0.12, 0.6, 0.14), 0.32, 1.12, 0),
    place(new THREE.SphereGeometry(0.12, 8, 6), 0, 1.63, 0),
  ]
  return mergeGeometries(parts.map((g) => g.toNonIndexed()), false)
}

/** Kept for the gate's sake: trees are `flora.js` now. */
export function treeGeometry() {
  return mergeGeometries([place(new THREE.CylinderGeometry(0.55, 0.85, 7, 6), 0, 3.5, 0).toNonIndexed()], false)
}

/* ------------------------------------------------------------------ *
 * The build
 * ------------------------------------------------------------------ */

/**
 * A nearest-vertex sampler over Terrain's built mesh: bucket the vertices into
 * `cell`-metre cells once, then each query reads the closest vertex in the
 * 3 × 3 cell neighbourhood. Terrain's grid is 130 m-sampled, so nearest-vertex
 * is exact at the fidelity the mesh itself has. `values`, when given, is a
 * per-vertex array to answer with instead of the height — the water flag, for
 * the flora.
 *
 * Positions are the mesh's own buffer — the pad frame, x east, y up, z north —
 * so a query in the surround's coordinates answers in the surround's
 * coordinates. Mirroring happens in the shared group, once.
 */
export function makeGroundSampler(positions, cell = 512, values = null) {
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
            bestY = values ? values[i] : positions[i * 3 + 1]
          }
        }
      }
    }
    return bestY
  }
}

/**
 * Build one site's surroundings.
 *
 * `groundAt(x, z)` returns the terrain height in the pad frame at that point —
 * the same height Terrain.jsx draws. Returns the merged structure geometry
 * (one draw, styled per vertex), the instance lists (cars, people), the foot
 * ledger, and `keepOut` — the discs and strips the flora must not grow in.
 */
export function buildSurround(siteId, groundAt = () => 0) {
  const footLedger = (FOOT = [])
  const strips = (STRIPS = [])
  const solid = []
  const crowd = []
  const car = []

  const y = (x, z) => groundAt(x, z)
  const build = BUILDERS[siteId]
  // Lunar sites have LunarSurface and their own detail; only the four Earth
  // complexes get a world around the pad.
  if (!build) {
    FOOT = null
    STRIPS = null
    return { solid: null, glass: null, green: null, dark: null, instances: { tree: [], car: [], crowd: [] }, foot: [], keepOut: [] }
  }
  build({ solid, crowd, car }, y)
  FOOT = null
  STRIPS = null

  const merged = solid.length ? mergeGeometries(solid, false) : null
  for (const g of solid) g.dispose()

  return {
    solid: merged,
    glass: null,
    green: null,
    dark: null,
    // Instance lists as flat [x, y, z, w] where y is the ground under them.
    instances: {
      tree: [],
      car: car.map(([x, , z, w]) => [x, y(x, z), z, w]),
      crowd: crowd.map(([x, , z, w]) => [x, y(x, z), z, w]),
    },
    foot: footLedger,
    keepOut: [...footLedger.map((f) => ({ x: f.x, z: f.z, r: f.r })), ...strips],
  }
}
