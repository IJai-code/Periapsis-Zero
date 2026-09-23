import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { exhaustOpening, hullRadiusBetween, padFor, vehicleFootprint } from './pads.js'
import { stageLength } from './framing.js'

/**
 * The launch complexes, as geometry. Pure three.js, no React: built here so
 * scripts/verify-pad-geometry.mjs can construct every pad under Node and
 * measure it, and so components/LaunchPad.jsx exports nothing but a component.
 * See that file for what each pad is and why it looks the way it does.
 */
const _m = new THREE.Matrix4()
const _q = new THREE.Quaternion()
const _e = new THREE.Euler()
const _p = new THREE.Vector3()
const _s = new THREE.Vector3(1, 1, 1)

/** Move a freshly made geometry into place. Rotation is applied before translation. */
function place(geometry, x, y, z, rx = 0, ry = 0, rz = 0) {
  _e.set(rx, ry, rz)
  _q.setFromEuler(_e)
  _p.set(x, y, z)
  geometry.applyMatrix4(_m.compose(_p, _q, _s))
  return geometry
}

/** A box by its centre. */
const box = (list, w, h, d, x, y, z, rx = 0, ry = 0, rz = 0) =>
  list.push(place(new THREE.BoxGeometry(w, h, d), x, y, z, rx, ry, rz))

/** A box standing on `y0`. Most of a launch complex stands on something. */
const post = (list, w, h, d, x, y0, z) => box(list, w, h, d, x, y0 + h / 2, z)

const sphere = (list, r, x, y, z) => list.push(place(new THREE.SphereGeometry(r, 20, 14), x, y, z))

/**
 * Build a sub-assembly at the origin, then place it as one piece. This is how
 * anything that leans or turns is made: the members are laid out upright and
 * the whole truss is rotated afterward.
 */
function assembly(list, build, x, y, z, rx = 0, ry = 0, rz = 0) {
  const parts = []
  build(parts)
  if (parts.length === 0) return
  const flat = parts.map((g) => (g.index ? g.toNonIndexed() : g))
  const merged = mergeGeometries(flat, false)
  for (const g of parts) g.dispose()
  for (const g of flat) if (!parts.includes(g)) g.dispose()
  if (merged) list.push(place(merged, x, y, z, rx, ry, rz))
}

/**
 * An open lattice tower: four corner columns, horizontal ties on every face
 * at each level, and a diagonal on every face zig-zagging level to level.
 * `w` runs along x, `d` along z; the tower stands on `y0`.
 */
function lattice(list, { x, z, w, d = w, y0, h, bay = 8, member }) {
  const c = member ?? Math.max(0.35, Math.min(w, d) * 0.045)
  const t = c * 0.7
  const hw = w / 2
  const hd = d / 2
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) post(list, c, h, c, x + sx * hw, y0, z + sz * hd)

  const levels = Math.max(1, Math.round(h / bay))
  const step = h / levels
  const lx = Math.hypot(w, step)
  const lz = Math.hypot(d, step)
  const ax = Math.atan2(step, w)
  const az = Math.atan2(step, d)
  for (let i = 1; i <= levels; i++) {
    const y = y0 + i * step
    box(list, w, t, t, x, y, z - hd)
    box(list, w, t, t, x, y, z + hd)
    box(list, t, t, d, x - hw, y, z)
    box(list, t, t, d, x + hw, y, z)

    const dir = i % 2 ? 1 : -1
    const ym = y - step / 2
    box(list, lx, t, t, x, ym, z - hd, 0, 0, ax * dir)
    box(list, lx, t, t, x, ym, z + hd, 0, 0, -ax * dir)
    box(list, t, t, lz, x - hw, ym, z, -az * dir, 0, 0)
    box(list, t, t, lz, x + hw, ym, z, az * dir, 0, 0)
  }
}

/**
 * The raised pad with its flame trench, as one extrusion: a trapezoid in
 * cross-section with a slot cut down to the trench floor, run the length of
 * the pad. Built with the trench along z; the caller turns it for an
 * east-west trench. The base starts a metre under the datum so the slab's
 * underside never shares a plane with the ground.
 */
function mound(list, { top, base, height, trench, length, floor = 0.4 }) {
  const s = new THREE.Shape()
  const tw = trench / 2
  s.moveTo(-base, -1)
  s.lineTo(base, -1)
  s.lineTo(top, height)
  if (tw > 0) {
    s.lineTo(tw, height)
    s.lineTo(tw, floor)
    s.lineTo(-tw, floor)
    s.lineTo(-tw, height)
  }
  s.lineTo(-top, height)
  s.lineTo(-base, -1)
  const g = new THREE.ExtrudeGeometry(s, { depth: length, bevelEnabled: false })
  list.push(place(g, 0, 0, -length / 2))
}

/**
 * The flame deflector: an inverted V in the trench under the vehicle, its
 * ridge running across the trench so the exhaust is split to both ends. Built
 * for a trench along z: the V is drawn in the z-y plane and extruded across x.
 */
function deflector(list, { trench, height, floor = 0.4 }) {
  const s = new THREE.Shape()
  const half = trench * 1.6
  s.moveTo(-half, floor)
  s.lineTo(half, floor)
  s.lineTo(0, height)
  s.lineTo(-half, floor)
  const depth = trench * 0.94
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false })
  // Shape x -> world -z, extrusion -> world +x, then centred across the trench.
  list.push(place(g, -depth / 2, 0, 0, 0, Math.PI / 2, 0))
}

/**
 * A rectangular frame — the launch platform round its exhaust opening, or a
 * pit's walls. Outer half-sizes `ox` and `oz`, opening half-sizes `ix`, `iz`,
 * standing `h` tall on `y0`.
 */
function frame(list, { ox, oz, ix, iz, y0, h }) {
  const tx = ox - ix
  const tz = oz - iz
  post(list, 2 * ox, h, tz, 0, y0, iz + tz / 2)
  post(list, 2 * ox, h, tz, 0, y0, -(iz + tz / 2))
  post(list, tx, h, 2 * iz, ix + tx / 2, y0, 0)
  post(list, tx, h, 2 * iz, -(ix + tx / 2), y0, 0)
}

/**
 * Hold-downs: four arms bridging the opening from its corners to the base of
 * the vehicle, each with a pedestal at the vehicle end. The vehicle's base
 * ring rests on the pedestals, which is what puts its base at `deck`.
 */
function holdDowns(list, { hole, radius, deck }) {
  const inner = radius * 0.82
  const len = (hole - inner) * Math.SQRT2
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      const mx = ((hole + inner) / 2) * sx
      const mz = ((hole + inner) / 2) * sz
      box(list, len, 1.8, 2.4, mx, deck - 0.9, mz, 0, -Math.atan2(sz, sx), 0)
      post(list, 1.8, 2.2, 1.8, inner * sx, deck - 2.2, inner * sz)
    }
}

/**
 * A swing arm from a tower face to the vehicle at height `y`, running along
 * `axis` ('x' or 'z') from `from` (the tower face) to `to` (the hull).
 *
 * Built in its own hinge frame and kept out of the merged steel, because it
 * moves. An arm is a beam on a vertical hinge at the tower: during the count it
 * swings back through a right angle to lie along the tower face, clear of the
 * vehicle, and a beam welded into one mesh with the tower cannot do that. So
 * the geometry is laid out with the hinge at the origin and the arm reaching
 * along the axis toward the hull, and the hinge's own position is returned
 * beside it for the renderer to stand it at and turn it about.
 */
function arm(list, { axis, from, to, y, width = 2.2 }) {
  const parts = []
  const len = Math.abs(from - to)
  // Toward the vehicle, in the arm's own axis.
  const dir = Math.sign(to - from)
  const along = (d) => (axis === 'z' ? [0, 0, dir * d] : [dir * d, 0, 0])
  const dims = axis === 'z' ? [width, 1.6, len] : [len, 1.6, width]
  box(parts, ...dims, ...along(len / 2))
  // The umbilical carrier at the vehicle end.
  box(parts, CARRIER, CARRIER_HEIGHT, CARRIER, ...along(len - CARRIER / 2))
  list.push({ parts, axis, hinge: axis === 'z' ? [0, y, from] : [from, y, 0] })
}

/** The umbilical carrier at an arm's tip: its width and depth, and its height — the arm's tallest part. */
const CARRIER = 3.2
const CARRIER_HEIGHT = 2.6

/**
 * How far short of the vehicle's skin an arm's carrier stops, m. A drawing
 * decision: close enough to read as mated, far enough not to fight the skin for
 * the same pixels. The real carriers plugged in.
 */
export const ARM_GAP = 0.25

/**
 * How far from the vehicle's axis an arm at height `y` on a pad whose deck is
 * at `deck` ends: the vehicle as
 * drawn anywhere across the carrier's own height, and the gap. The first
 * version ended every arm at the vehicle's *reach* — its widest point anywhere
 * — which on a Saturn V is the S-IC, so the arms at the S-IVB, the adapter and
 * the command module stopped 2 to 3 m short of anything.
 */
export function armReach(deck, y) {
  const h = y - deck
  return hullRadiusBetween(h - CARRIER_HEIGHT / 2, h + CARRIER_HEIGHT / 2) + ARM_GAP
}

/** A propellant storage sphere on its stub, the one thing every pad has. */
function storageSphere(list, r, x, z) {
  post(list, r * 0.5, 4, r * 0.5, x, 0.3, z)
  sphere(list, r, x, 4.3 + r * 0.9, z)
}

/**
 * Coordinates relative to the trench: `at(across, along)` gives [x, z] for a
 * point `across` the trench and `along` it, so a style can be written once and
 * turned with the trench.
 */
const axisFor = (pad) => (pad.trenchAxis === 'ew' ? 'x' : 'z')
const atFor = (pad) => (pad.trenchAxis === 'ew' ? (a, b) => [b, a] : (a, b) => [a, b])
/** Box dimensions with `across` and `along` extents, turned the same way. */
const dimsFor = (pad) => (pad.trenchAxis === 'ew' ? (a, h, b) => [b, h, a] : (a, h, b) => [a, h, b])

/* ------------------------------------------------------------------ *
 * Common ground: apron, mound, trench, launch platform, hold-downs.
 * ------------------------------------------------------------------ */
function commonWorks(K, pad, foot) {
  const { radius, reach, length: L } = foot
  const ns = pad.trenchAxis !== 'ew'
  const hole = exhaustOpening(foot)
  // The launch platform is long enough along the trench to carry a tower.
  const along = hole + 34
  const across = hole + 12

  // Apron: the graded concrete the whole complex stands on, top 0.3 above datum.
  post(K.concrete, pad.apron * 2, 3.3, pad.apron * 2, 0, -3, 0)

  if (pad.mound > 0) {
    const top = across + 8
    const parts = []
    mound(parts, {
      top,
      base: top + pad.mound * 2.4,
      height: pad.mound,
      trench: pad.trench,
      length: 2 * (along + 10),
    })
    if (pad.trench > 0) deflector(parts, { trench: pad.trench, height: pad.mound * 0.8 })
    // Trench floor and walls read dark: scorched.
    const turn = ns ? 0 : Math.PI / 2
    K.concrete.push(place(parts[0], 0, 0, 0, 0, turn, 0))
    if (parts[1]) K.dark.push(place(parts[1], 0, 0, 0, 0, turn, 0))
  }

  // Launch platform on the mound, with its exhaust opening.
  const [ox, oz] = ns ? [across, along] : [along, across]
  frame(K.steel, { ox, oz, ix: hole, iz: hole, y0: pad.mound, h: pad.platform })
  holdDowns(K.steel, { hole, radius, deck: pad.deck })

  return { hole, along, across, L }
}

/* ------------------------------------------------------------------ *
 * Kennedy: the launch umbilical tower on the mobile launcher.
 * ------------------------------------------------------------------ */
function umbilical(K, pad, foot, g) {
  const { hole, L } = g
  const at = atFor(pad)
  const dims = dimsFor(pad)
  const axis = axisFor(pad)
  const tw = 12
  const towerAlong = hole + 9 + tw / 2
  const T = pad.towerScale * L
  const [tx, tz] = at(0, towerAlong)

  lattice(K.steel, { x: tx, z: tz, w: tw, d: tw, y0: pad.deck, h: T, bay: 9 })
  // Elevator and stair core, a closed shaft behind the lattice.
  const [ex, ez] = at(0, towerAlong + tw / 2 + 2.2)
  post(K.dark, 4.2, T * 0.95, 4.2, ex, pad.deck, ez)

  // Hammerhead crane and its boom, reaching out over the vehicle.
  box(K.steel, 9, 6, 9, tx, pad.deck + T + 3, tz)
  const boomLen = towerAlong + hole * 0.6
  const [bx, bz] = at(0, towerAlong - boomLen / 2 + 4)
  box(K.steel, ...dims(3, 2.6, boomLen), bx, pad.deck + T + 7, bz)
  // Lightning mast.
  post(K.white, 1.0, T * 0.22, 1.0, tx, pad.deck + T + 6, tz)

  // Swing arms, from the tower face to the hull.
  // Arms stop at the vehicle as it is drawn at their own height — see
  // armReach, and why beside SLS's boosters that is still their reach.
  const face = towerAlong - tw / 2
  for (let i = 0; i < pad.arms; i++) {
    const y = pad.deck + L * (0.1 + (0.8 * i) / Math.max(1, pad.arms - 1))
    arm(K.arms, { axis, from: face, to: armReach(pad.deck, y), y })
  }

  // Propellant farm and support buildings out on the apron.
  const a = pad.apron
  storageSphere(K.white, 10, -a * 0.72, a * 0.72)
  storageSphere(K.white, 8, a * 0.72, -a * 0.7)
  post(K.concrete, 26, 7, 14, a * 0.6, 0.3, a * 0.55)
  post(K.concrete, 16, 5, 10, -a * 0.65, 0.3, -a * 0.6)
}

/* ------------------------------------------------------------------ *
 * Baikonur: the apron over the pit, the tulip, two service masts.
 * ------------------------------------------------------------------ */
function tulip(K, pad, foot, g) {
  const { hole, L } = g
  const { reach } = foot
  const pit = pad.pit
  const T = pad.towerScale * L

  // The pit: dark floor well below, concrete walls up to the apron.
  post(K.dark, pit * 2, 0.4, pit * 2, 0, -2.6, 0)
  frame(K.concrete, { ox: pit + 7, oz: pit + 7, ix: pit, iz: pit, y0: -2.6, h: 2.9 })
  // Bridges from the pit walls carry the launch ring.
  const ring = hole + 3
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2
    const len = pit - ring + 4
    const r = ring + len / 2 - 2
    box(K.steel, len, 2.4, 4, Math.cos(a) * r, pad.deck - 1.2, Math.sin(a) * r, 0, -a, 0)
  }
  const ringGeo = new THREE.CylinderGeometry(ring, ring, pad.platform, 32, 1, true)
  K.steel.push(place(ringGeo, 0, pad.deck - pad.platform / 2, 0))

  // The tulip: four counterweighted trusses round the base, leaning out a
  // little, each with its counterweight block outboard.
  const petal = L * 0.26
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4
    assembly(
      K.steel,
      (parts) => {
        lattice(parts, { x: reach + 6, z: 0, w: 4.2, d: 4.2, y0: 0, h: petal, bay: 6 })
        box(parts, 6, 7, 6, reach + 12, 4, 0)
        box(parts, 5, 1.6, 2.4, reach + 3.3, petal * 0.92, 0)
      },
      0,
      pad.deck,
      0,
      0,
      a,
      -0.12,
    )
  }

  // Service masts either side, with their access arms.
  for (const side of [-1, 1]) {
    const x = side * (reach + 30)
    lattice(K.steel, { x, z: 0, w: 6.5, d: 6.5, y0: pad.deck, h: T, bay: 7 })
    for (let i = 0; i < 4; i++) {
      const y = pad.deck + L * (0.18 + 0.12 * i)
      arm(K.arms, { axis: 'x', from: x - side * 3.25, to: side * armReach(pad.deck, y), y })
    }
  }

  // Low, wide buildings — the cosmodrome is horizontal — and the oxidiser store.
  const a = pad.apron
  storageSphere(K.white, 7, -a * 0.62, -a * 0.66)
  post(K.concrete, 40, 6, 16, -a * 0.6, 0.3, a * 0.62)
  post(K.concrete, 24, 5, 24, a * 0.62, 0.3, a * 0.55)
  post(K.concrete, 30, 4, 12, a * 0.55, 0.3, -a * 0.68)
}

/* ------------------------------------------------------------------ *
 * Kourou: the enclosed mobile gantry, rolled back; umbilical mast; masts.
 * ------------------------------------------------------------------ */
function gantry(K, pad, foot, g) {
  const { hole, L } = g
  const { reach } = foot
  const at = atFor(pad)
  const dims = dimsFor(pad)
  const axis = axisFor(pad)

  // Umbilical mast beside the vehicle.
  const mw = 7
  const mastAlong = hole + 9 + mw / 2
  const [mx, mz] = at(0, mastAlong)
  lattice(K.steel, { x: mx, z: mz, w: mw, d: mw, y0: pad.deck, h: L * 0.72, bay: 7 })
  for (let i = 0; i < 3; i++) {
    const y = pad.deck + L * (0.2 + 0.22 * i)
    arm(K.arms, { axis, from: mastAlong - mw / 2, to: armReach(pad.deck, y), y })
  }

  // The gantry, on the far side of the trench from the mast, rolled back.
  const gw = 2 * reach + 34
  const gd = 2 * reach + 30
  const gh = pad.towerScale * L
  const gantryAlong = -(hole + 44 + gd / 2)
  const [gx, gz] = at(0, gantryAlong)
  for (const sa of [-1, 1])
    for (const sb of [-1, 1]) {
      const [px, pz] = at(sa * (gw / 2 - 3), gantryAlong + sb * (gd / 2 - 3))
      post(K.concrete, 6, 9, 6, px, 0.3, pz)
    }
  post(K.steel, ...dims(gw, gh, gd), gx, 9.3, gz)
  // The doors on the face toward the pad, read as a dark strip.
  const [dx, dz] = at(0, gantryAlong + gd / 2 + 0.6)
  post(K.dark, ...dims(gw * 0.35, gh * 0.9, 1.2), dx, 9.3, dz)
  // Rails the gantry rides, out to the pad.
  const railLen = hole + 44 + gd
  const [rx0, rz0] = at(gw / 2 - 3, -railLen / 2 + hole)
  const [rx1, rz1] = at(-(gw / 2 - 3), -railLen / 2 + hole)
  box(K.dark, ...dims(1.4, 0.6, railLen), rx0, 0.6, rz0)
  box(K.dark, ...dims(1.4, 0.6, railLen), rx1, 0.6, rz1)

  // Lightning masts at the apron's corners.
  const a = pad.apron * 0.78
  const mh = pad.mastScale * L
  for (let i = 0; i < pad.masts; i++) {
    const x = (i & 1 ? 1 : -1) * a
    const z = (i & 2 ? 1 : -1) * a
    post(K.white, 1.4, mh, 1.4, x, 0.3, z)
    box(K.white, 7, 0.6, 0.6, x, mh + 0.3, z)
    box(K.white, 0.6, 0.6, 7, x, mh + 0.3, z)
  }

  storageSphere(K.white, 9, -pad.apron * 0.62, -pad.apron * 0.7)
  post(K.concrete, 30, 8, 18, pad.apron * 0.6, 0.3, pad.apron * 0.62)
}

/* ------------------------------------------------------------------ *
 * Vandenberg: mobile service tower, payload changeout room, access tower.
 * ------------------------------------------------------------------ */
function service(K, pad, foot, g) {
  const { hole, L } = g
  const { reach } = foot
  const at = atFor(pad)
  const dims = dimsFor(pad)
  const axis = axisFor(pad)

  // Open access tower with its arms.
  const tw = 10
  const towerAlong = hole + 8 + tw / 2
  const [tx, tz] = at(0, towerAlong)
  const T = L * 0.8
  lattice(K.steel, { x: tx, z: tz, w: tw, d: tw, y0: pad.deck, h: T, bay: 8 })
  post(K.white, 0.9, T * 0.2, 0.9, tx, pad.deck + T, tz)
  for (let i = 0; i < pad.arms; i++) {
    const y = pad.deck + L * (0.12 + (0.72 * i) / Math.max(1, pad.arms - 1))
    arm(K.arms, { axis, from: towerAlong - tw / 2, to: armReach(pad.deck, y), y })
  }

  // The service tower, enclosed, on the other side.
  const sw = 2 * reach + 22
  const sd = 2 * reach + 14
  const sh = pad.towerScale * L
  const mstAlong = -(hole + 16 + sd / 2)
  const [sx, sz] = at(0, mstAlong)
  for (const sa of [-1, 1])
    for (const sb of [-1, 1]) {
      const [px, pz] = at(sa * (sw / 2 - 3), mstAlong + sb * (sd / 2 - 3))
      post(K.concrete, 6, 7, 6, px, 0.3, pz)
    }
  post(K.steel, ...dims(sw, sh, sd), sx, 7.3, sz)
  // Payload changeout room, beside it.
  const [cx, cz] = at(sw / 2 + 12, mstAlong)
  post(K.steel, ...dims(22, sh * 0.62, sd * 0.8), cx, 0.3, cz)

  storageSphere(K.white, 9, pad.apron * 0.7, pad.apron * 0.68)
  post(K.concrete, 24, 6, 14, -pad.apron * 0.66, 0.3, pad.apron * 0.6)
  post(K.concrete, 18, 5, 12, -pad.apron * 0.6, 0.3, -pad.apron * 0.66)
}

const STYLES = { umbilical, tulip, gantry, service }

/** Every member of a site's pad, merged by material. */
export function buildPad(siteId) {
  const pad = padFor(siteId)
  const foot = vehicleFootprint()
  const K = { steel: [], concrete: [], dark: [], white: [], arms: [] }
  const g = commonWorks(K, pad, foot)
  ;(STYLES[pad.style] ?? umbilical)(K, pad, foot, g)

  /*
   * The arms, one geometry each in its hinge frame. Merged per arm rather than
   * all together, because each turns about its own hinge — and kept apart from
   * the four material meshes below so that set stays exactly what it was.
   */
  const arms = []
  for (const a of K.arms) {
    const flat = a.parts.map((p) => (p.index ? p.toNonIndexed() : p))
    const merged = mergeGeometries(flat, false)
    for (const p of a.parts) p.dispose()
    for (const p of flat) if (!a.parts.includes(p)) p.dispose()
    if (!merged) continue
    merged.computeBoundingSphere()
    arms.push({ geometry: merged, hinge: a.hinge, axis: a.axis })
  }

  const out = []
  for (const key of ['steel', 'concrete', 'dark', 'white']) {
    if (K[key].length === 0) continue
    /*
     * Extrusions are non-indexed and everything else is indexed, and
     * mergeGeometries refuses a mixed list outright. Flatten them all: the
     * pad is a few thousand triangles, so the shared vertices an index would
     * save are not worth having two code paths for.
     */
    const flat = K[key].map((g) => (g.index ? g.toNonIndexed() : g))
    const merged = mergeGeometries(flat, false)
    for (const part of K[key]) part.dispose()
    for (const part of flat) if (!K[key].includes(part)) part.dispose()
    if (!merged) continue
    merged.computeBoundingSphere()
    out.push({ key, geometry: merged })
  }
  /*
   * Where the exhaust leaves the pad, for the steam. A trench runs the length
   * of the mound and opens at both ends, so on a trenched pad the steam comes
   * out of those two mouths; a pad built over a pit (Baikonur) has no mouth and
   * the steam rises out of the opening under the vehicle instead.
   */
  const exhaust =
    pad.trench > 0
      ? { axis: pad.trenchAxis === 'ew' ? 'x' : 'z', half: g.along + 10, width: pad.trench, floor: 0.4 }
      : { axis: null, half: g.hole, width: g.hole * 2, floor: Math.max(0.4, pad.deck - 4) }
  return { pad, meshes: out, arms, exhaust, hole: g.hole }
}

/**
 * Where a point on an arm is when the arm has swung through `angle` radians.
 *
 * About the vertical through its hinge — the rotation the renderer applies with
 * `rotation.y`, written out so a gate can check the swept arm against the
 * vehicle without a scene graph. Positive angles turn the same way three's
 * right-handed y rotation does.
 */
export function swingPoint(out, hinge, x, y, z, angle) {
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  out[0] = hinge[0] + x * c + z * s
  out[1] = hinge[1] + y
  out[2] = hinge[2] - x * s + z * c
  return out
}

/** How far an arm swings to clear the vehicle: a right angle, back along the tower face. */
export const ARM_SWING = Math.PI / 2


/**
 * How far a site's pad reaches out, and how tall the tallest thing on it is.
 *
 * Both are what the shadow box has to be sized against, and both were being
 * recomputed by walking every vertex of every merged mesh — fine in a gate that
 * does it once, impossible in a frame callback. So it is done once per site and
 * kept, and `GroundLight.jsx` and `verify-shadows` read the same answer rather
 * than each deriving its own and drifting.
 *
 * `top` is the taller of the structures and the vehicle standing on the deck,
 * because the longest shadow belongs to whichever that is — on three of the four
 * pads it is the vehicle.
 */
const _envelopes = new Map()
export function padEnvelope(siteId) {
  const held = _envelopes.get(siteId)
  if (held !== undefined) return held
  const pad = padFor(siteId)
  const { meshes } = buildPad(siteId)
  let reach = 0
  let high = 0
  for (const m of meshes) {
    const pos = m.geometry.getAttribute('position')
    for (let i = 0; i < pos.count; i++) {
      const r = Math.hypot(pos.getX(i), pos.getZ(i))
      if (r > reach) reach = r
      const y = pos.getY(i)
      if (y > high) high = y
    }
  }
  const deckTop = pad.deck + stageLength(0)
  const envelope = { reach, top: high > deckTop ? high : deckTop }
  _envelopes.set(siteId, envelope)
  return envelope
}
