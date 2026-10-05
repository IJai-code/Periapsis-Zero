/**
 * The surface game: land, explore, return, on any world the simulator flies to.
 *
 * One engine for every landable world (sim/worlds.js). The physics is the
 * same physics everywhere and only the numbers change: local gravity from the
 * body's mass and radius, drag from its air, a walking gait from sim/walk.js,
 * a rover driven by force against grip and slope. What a mission asks:
 *
 *   1. Descent    from a few hundred metres up, closing on the pad. Landing
 *                 assist can fly it; flying it yourself scores better.
 *   2. Survey     the rover rolls out on landing. Four samples (one rare,
 *                 hidden in a search zone until the scanner finds it), one
 *                 station to deploy well away from the lander, and an anomaly
 *                 to investigate, also found by scanning.
 *   3. Return     back aboard, lift off, and the mission is scored.
 *
 * On the smallest bodies (Phobos, Deimos, Halley) a rover cannot grip, so the
 * lander hops between sites instead. Venus gives you eight minutes before the
 * heat wins. Time warp (hold Shift) runs the same physics faster.
 *
 * Everything here is deterministic and allocation-free on the fixed step, so
 * verify-expeditions can fly every world headless.
 */
import { G0 } from './constants.js'
import { makeNoise, mulberry32 } from '../gfx/noise.js'
import { stepWalk } from './walk.js'
import { WORLDS } from './worlds.js'

/** The landable worlds. Kept under the old name for the code that imports it. */
export const REGIONS = WORLDS
export { WORLDS }

export const FIXED_STEP = 1 / 120
export const REGION_LIMIT = 700
const clamp = (x, a, b) => Math.max(a, Math.min(b, x))
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t) }
/** Scratch for the walk step, so the fixed step allocates nothing. */
const _foot = { east: 0, north: 0, up: 0, height: 0, onGround: true }

/* ------------------------------------------------------------------ *
 * Vehicles
 * ------------------------------------------------------------------ */

/**
 * The survey lander. Its base figures are a Moon lander's; on a heavier
 * world it flies with the engine and tanks that world needs, which is what a
 * real programme would build (thrust to weight 2.4 at landing mass, and
 * propellant in proportion to the square root of gravity, the scaling of the
 * velocity a descent has to kill). Upgrades bought in the campaign add to that.
 */
export const VEHICLE = { dryMass: 3600, fuel: 1500, thrust: 32000, isp: 310, clearance: 2.65, safeVertical: 3, safeHorizontal: 2.5, safeSlope: 0.28 }
export const UPGRADE_STEP = { engine: 0.1, tanks: 0.15, motor: 0.15, battery: 0.3, scanner: 120 }
export function vehicleFor(id, upgrades = {}) {
  const g = WORLDS[id].gravity
  const fuel = VEHICLE.fuel * Math.max(1, Math.sqrt(g / 1.62)) * (1 + UPGRADE_STEP.tanks * (upgrades.tanks ?? 0))
  const thrust = Math.max(VEHICLE.thrust, 2.4 * (VEHICLE.dryMass + fuel) * g) * (1 + UPGRADE_STEP.engine * (upgrades.engine ?? 0))
  return { ...VEHICLE, fuel, thrust }
}

/**
 * The surface rover, and why it is not a car.
 *
 * Six wheels and no differential: it steers by skid. Top speed 3.4 m/s, a
 * fast walk; the Apollo crews' rover managed 3.6 on the Moon and the limit
 * was what the driver could see and stop for. 520 N against 210 kg is 2.48
 * m/s^2 on the flat, and gravity times grip is what a slope takes away.
 */
export const ROVER = { mass: 210, drive: 520, wheelbase: 2.1, track: 1.7, clearance: 0.46, maxSpeed: 3.4, grip: 0.55, drain: 9e-6 }
export function roverFor(upgrades = {}) {
  return { ...ROVER, maxSpeed: ROVER.maxSpeed * (1 + UPGRADE_STEP.motor * (upgrades.motor ?? 0)), drain: ROVER.drain / (1 + UPGRADE_STEP.battery * (upgrades.battery ?? 0)) }
}
export const scannerRange = (upgrades = {}) => 160 + UPGRADE_STEP.scanner * (upgrades.scanner ?? 0)

/* ------------------------------------------------------------------ *
 * Terrain
 * ------------------------------------------------------------------ */

const terrains = new Map()
const hash2 = (x, z, seed) => { const s = Math.sin(x * 127.1 + z * 311.7 + seed * 74.7) * 43758.5453; return s - Math.floor(s) }

/** Two nearest jittered points on a grid of `cell` metres: [d1, d2]. Writes into out. */
function worley(x, z, cell, seed, out) {
  const cx = Math.floor(x / cell), cz = Math.floor(z / cell)
  let d1 = 1e9, d2 = 1e9
  for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
    const gx = cx + i, gz = cz + j
    const px = (gx + hash2(gx, gz, seed)) * cell, pz = (gz + hash2(gz, gx, seed + 9)) * cell
    const d = Math.hypot(x - px, z - pz)
    if (d < d1) { d2 = d1; d1 = d } else if (d < d2) d2 = d
  }
  out[0] = d1; out[1] = d2
  return out
}

/**
 * Features a shader needs to know about, in world metres: Io's lava lake,
 * Titan's methane lake. The terrain is shaped around them and the renderer
 * draws them; the anomaly sits on their shore.
 */
export const FEATURES = {
  io: { lake: { x: -260, z: -330, r: 70 } },
  titan: { lake: { x: 300, z: -420, r: 160 } },
}

/** Procedural geology, not measured topography. Heights and renderer share the same 12 m lattice. */
export function terrainFor(id) {
  if (terrains.has(id)) return terrains.get(id)
  const w = WORLDS[id]
  if (!w) throw new Error(`Unknown world: ${id}`)
  const noise = makeNoise(w.seed)
  const cell = [0, 0]
  const craters = [[-730, -1100, 510, 95], [650, -2600, 900, 230], [-2400, 800, 1200, 260], [1700, 1700, 780, 180], [-5100, -4500, 2500, 610]]
  // Smaller craters, many of them, for the old and battered worlds.
  const small = []
  const rand = mulberry32(w.seed + 3)
  for (let i = 0; i < (w.dense ? 90 : 40); i++) {
    // From 600 m out: the survey ring stays drivable, the view stays battered.
    const a = rand() * Math.PI * 2, r = 600 + rand() ** 0.7 * 4800, size = 30 + rand() ** 2.4 * 420
    small.push([Math.cos(a) * r, Math.sin(a) * r, size, size * (0.12 + rand() * 0.08)])
  }
  const mesas = [[-1400, -2200, 650, 720], [1100, -2900, 780, 940], [3000, -1800, 1100, 830], [-3400, -4300, 1200, 1150], [700, -7200, 2400, 1550]]
  const paterae = [[-260, -330, 230, 45], [2200, -1600, 900, 140], [-3000, -2600, 1400, 180]]
  const crater = (x, z, cx, cz, r, depth) => {
    const dx = x - cx, dz = z - cz
    // Past 1.7 radii the rim term is under 1e-9 of the depth.
    if (dx * dx + dz * dz > 2.89 * r * r) return 0
    const q = Math.hypot(dx, dz) / r
    return -depth * Math.max(0, 1 - q * q) + depth * 0.42 * Math.exp(-(((q - 1) / 0.13) ** 2))
  }
  function raw(x, z) {
    const n = noise.fbm(x / 750, 0.31, z / 750, 4)
    let h = 0
    switch (w.style) {
      case 'cratered': {
        h = n * 80 + 220 * noise.fbm(x / 4200, 2, z / 4200, 3)
        for (const [cx, cz, r, d] of craters) h += crater(x, z, cx, cz, r, d)
        for (const [cx, cz, r, d] of small) h += crater(x, z, cx, cz, r, d)
        if (w.scarps) {
          // A lobate scarp: the crust shrank as Mercury cooled, and thrust one
          // side up over the other along a winding front.
          const front = x * 0.8 + z * 0.6 + 160 * noise.noise3(x / 1300, 4, z / 1300) - 1100
          h += 140 * smooth(-90, 90, front)
        }
        break
      }
      case 'small': {
        h = n * 34 + 60 * noise.fbm(x / 2600, 5, z / 2600, 3)
        for (const [cx, cz, r, d] of small) h += crater(x, z, cx, cz, r * 0.8, d * 1.3)
        h += crater(x, z, -2600, -3400, 2400, 520)
        // Grooves: chains of shallow troughs in one direction.
        const u = (x * 0.62 + z * 0.78) / 46 + noise.noise3(x / 900, 6, z / 900) * 0.8
        h -= 5.5 * Math.exp(-(((u - Math.round(u)) / 0.14) ** 2)) * smooth(-0.2, 0.4, noise.noise3(x / 1500, 8, z / 1500))
        break
      }
      case 'mesa': {
        h = n * 65
        for (const [cx, cz, r, high] of mesas) {
          const dx = x - cx, dz = (z - cz) * 1.15, d = Math.hypot(dx, dz)
          if (d > r * 2.4) continue
          // Plan: a butte is what erosion has left of a plateau, so its edge
          // is spurs and alcoves at several scales, not a circle. Noise is
          // sampled on the unit circle so the outline closes on itself.
          const ca = dx / (d || 1), sa = dz / (d || 1), k = cx / 997
          const edge = r * (1 + 0.24 * noise.noise3(ca * 1.4 + k, sa * 1.4, 11) + 0.11 * noise.noise3(ca * 4.2, sa * 4.2 + k, 13) + 0.05 * noise.noise3(x / 70, 17, z / 70))
          const q = d / edge
          // Section: a flat caprock, a cliff of the beds beneath it, and a
          // concave talus apron of what has fallen off.
          const cap = 1 - 0.05 * q * q + 0.015 * noise.noise3(x / 60, 19, z / 60)
          let p = q < 1 ? cap - (cap - 0.4) * smooth(0.7, 1, q) ** 0.75 : 0.4 * Math.max(0, 1 - (q - 1) / 0.8) ** 2.2
          // Resistant beds hold up benches on the cliff. The beds are the same
          // strata in every butte, at the same heights, of uneven thickness.
          const face = smooth(0.6, 0.76, q) * (1 - smooth(1.05, 1.35, q))
          const u = (p * high + h) / 38 + 0.7 * Math.sin((p * high + h) / 91)
          const bench = Math.floor(u) + smooth(0.55, 1, u - Math.floor(u))
          p += face * 0.55 * ((bench - u) * 38 / high)
          // Gullies cut down the face and fan into the talus.
          const g = noise.noise3(ca * r / 110, sa * r / 110, q * 1.6 + k) + 0.35 * noise.noise3(ca * r / 40, sa * r / 40, q * 3 + k)
          p -= face * 0.07 * Math.exp(-((g / 0.22) ** 2)) + (1 - smooth(0.95, 1.7, q)) * smooth(0.8, 1, q) * (8 / high) * Math.exp(-((g / 0.3) ** 2))
          h += high * Math.max(0, p)
        }
        h += 80 * Math.abs(noise.fbm(x / 2000, 2, z / 2000, 3))
        break
      }
      case 'ridged': {
        h = n * 15
        const warp = 70 * noise.noise3(x / 1500, 3, z / 1500)
        const band = Math.sin((x * 0.75 + z * 0.48 + warp) / 230)
        h += 85 * Math.exp(-(((Math.abs(band) - 0.19) / 0.18) ** 2))
        h -= 12 * Math.exp(-((band / 0.07) ** 2))
        break
      }
      case 'grooved': {
        h = n * 30 + 120 * noise.fbm(x / 3800, 2, z / 3800, 3)
        const mask = smooth(-0.1, 0.25, noise.noise3(x / 2600, 7, z / 2600))
        const u = (x * 0.9 - z * 0.42 + 90 * noise.noise3(x / 1100, 1, z / 1100)) / 40
        h += mask * 9 * (Math.abs(Math.sin(u)) * 2 - 1)
        for (const [cx, cz, r, d] of small) if (r < 260) h += crater(x, z, cx, cz, r, d * (1 - mask * 0.6))
        break
      }
      case 'volcanic': {
        h = n * 22 + 60 * noise.fbm(x / 3000, 6, z / 3000, 3)
        for (const [cx, cz, r, depth] of paterae) {
          // A patera: a flat floor dropped inside steep walls.
          const q = Math.hypot(x - cx, z - cz) / (r * (1 + 0.08 * noise.noise3(x / 160, 5, z / 160)))
          h += -depth * (1 - smooth(0.88, 1.04, q)) + depth * 0.25 * Math.exp(-(((q - 1.05) / 0.08) ** 2))
        }
        h += 1900 * Math.exp(-((Math.hypot(x + 3600, z + 5400) / 1900) ** 2)) * (0.85 + 0.15 * noise.noise3(x / 400, 2, z / 400))
        break
      }
      case 'dunes': {
        h = n * 10 + 30 * noise.fbm(x / 3000, 6, z / 3000, 3)
        const u = (x * 0.94 + z * 0.34 + 140 * noise.noise3(x / 1600, 2, z / 1600)) / 165
        const crest = Math.pow(Math.abs(Math.sin(u)), 1.7)
        h += 28 * crest * smooth(-0.35, 0.2, noise.noise3(x / 2200, 9, z / 2200))
        const lake = FEATURES.titan.lake
        const dl = Math.hypot(x - lake.x, z - lake.z) / lake.r
        h = h * smooth(0.9, 2.2, dl) - 6 * (1 - smooth(0.9, 1.2, dl))
        break
      }
      case 'tessera': {
        h = n * 30 + 80 * noise.fbm(x / 3400, 3, z / 3400, 3)
        const high = smooth(-0.15, 0.3, noise.noise3(x / 3000, 1, z / 3000) + (x + z) / 9000)
        const crumple = Math.abs(noise.noise3(x / 70, 3, z / 70)) + Math.abs(noise.noise3(x / 33, 7, z / 33)) * 0.6
        h += high * (70 + 26 * crumple)
        // A pancake dome: viscous lava that piled up and stopped.
        const dd = Math.hypot(x - 1500, z + 2400) / 900
        h += 75 * (1 - smooth(0.85, 1.05, dd))
        break
      }
      case 'cells': {
        h = n * 8
        worley(x + 40 * noise.noise3(x / 300, 1, z / 300), z, 270, w.seed, cell)
        const edge = cell[1] - cell[0]
        h -= 9 * Math.exp(-((edge / 26) ** 2))
        h += 3 * (cell[0] / 270)
        // Water-ice blocks standing out of the nitrogen to the west.
        const block = smooth(-0.1, 0.25, noise.noise3(x / 900, 4, z / 900)) * smooth(2600, 4200, -x)
        h += block * (420 + 260 * Math.abs(noise.noise3(x / 260, 2, z / 260)))
        break
      }
      default:
        h = n * 40
    }
    // The survey clearing is an authored landing zone, blended into the geology.
    const r = Math.hypot(x, z)
    h = h * smooth(110, 480, r) + 0.65 * noise.noise3(x / 38, 7, z / 38) * smooth(12, 90, r)
    // The body's curvature: the horizon is where it is, close on a small moon.
    return h - (x * x + z * z) / (2 * w.radius)
  }
  /** 0..1, a style's own feature for the shader: a lake, a groove band, a cell edge. */
  function mask(x, z) {
    const f = FEATURES[id]
    if (f?.lake) return 1 - smooth(0.92, 1.04, Math.hypot(x - f.lake.x, z - f.lake.z) / f.lake.r)
    if (w.style === 'grooved') return smooth(-0.1, 0.25, noise.noise3(x / 2600, 7, z / 2600))
    if (w.style === 'cells') { worley(x + 40 * noise.noise3(x / 300, 1, z / 300), z, 270, w.seed, cell); return Math.exp(-(((cell[1] - cell[0]) / 30) ** 2)) }
    if (w.style === 'tessera') return smooth(-0.15, 0.3, noise.noise3(x / 3000, 1, z / 3000) + (x + z) / 9000)
    return 0
  }
  function lattice(x, z, step, sample = raw) {
    const a = Math.floor(x / step) * step, b = Math.floor(z / step) * step
    const u = (x - a) / step, v = (z - b) / step
    // On a lattice point (every vertex of the rendered mesh) one sample is the answer.
    if (u === 0 && v === 0) return sample(a, b)
    const h00 = sample(a, b), h10 = sample(a + step, b), h01 = sample(a, b + step), h11 = sample(a + step, b + step)
    return u + v <= 1 ? h00 + u * (h10 - h00) + v * (h01 - h00) : h11 + (1 - u) * (h01 - h11) + (1 - v) * (h10 - h11)
  }
  // Morph the fine surface into the next ring's lattice at its boundary.
  function innerVertex(x, z) {
    const t = smooth(672, 768, Math.max(Math.abs(x), Math.abs(z)))
    return raw(x, z) * (1 - t) + lattice(x, z, 32) * t
  }
  function height(x, z) {
    const r = Math.max(Math.abs(x), Math.abs(z))
    if (r <= 660) return lattice(x, z, 12)
    if (r < 768) return lattice(x, z, 12, innerVertex)
    if (r <= 2688) return lattice(x, z, 32)
    if (r < 3072) { const t = smooth(2688, 3072, r); return lattice(x, z, 32) * (1 - t) + lattice(x, z, 128) * t }
    return lattice(x, z, 128)
  }
  const terrain = { height, mask, slope: (x, z) => Math.hypot((height(x + 1, z) - height(x - 1, z)) / 2, (height(x, z + 1) - height(x, z - 1)) / 2) }
  terrains.set(id, terrain)
  return terrain
}

/* ------------------------------------------------------------------ *
 * What is worth finding, and where
 * ------------------------------------------------------------------ */

/**
 * Sites, chosen by measuring the generated ground: four samples close in, a
 * station site well out (seismometers want quiet ground away from the
 * lander), and an anomaly further still. Every site is on gentle ground with
 * a drivable straight line from the pad; verify-expeditions holds that. The
 * last sample is rare and, with the anomaly, starts hidden in a search zone
 * that the scanner narrows down.
 */
const layouts = new Map()
export const SAMPLE_VALUE = { common: 100, rare: 250 }
export function layoutFor(id) {
  if (layouts.has(id)) return layouts.get(id)
  const w = WORLDS[id], t = terrainFor(id), rand = mulberry32(w.seed + 77)
  const gentle = (x, z) => {
    let local = 0
    for (const [dx, dz] of [[0, 0], [6, 0], [-6, 0], [0, 6], [0, -6]]) local = Math.max(local, t.slope(x + dx, z + dz))
    let path = 0
    for (let k = 1; k <= 40; k++) path = Math.max(path, t.slope(x * k / 40, z * k / 40))
    return local < 0.18 && path < 0.3
  }
  const used = []
  const lake = FEATURES[id]?.lake
  const pick = (r0, r1, tries = 300) => {
    let best = null
    // Widen the band if the ground there is all crater wall.
    for (let widen = 0; widen < 4 && !best; widen++) {
      const lo = r0 * (1 - 0.15 * widen), hi = r1 * (1 + 0.25 * widen)
      for (let i = 0; i < tries; i++) {
        const a = rand() * Math.PI * 2, r = lo + rand() * (hi - lo)
        const x = Math.round(Math.cos(a) * r), z = Math.round(Math.sin(a) * r)
        if (used.some((u) => Math.hypot(u.x - x, u.z - z) < 45)) continue
        if (lake && Math.hypot(x - lake.x, z - lake.z) < lake.r + 12) continue
        if (Math.hypot(x, z) > 560) continue
        if (gentle(x, z)) { best = { x, z }; break }
      }
    }
    if (!best) throw new Error(`${id}: no gentle site between ${r0} and ${r1} m`)
    used.push(best)
    return best
  }
  const near = w.hopper ? [40, 130] : [40, 115]
  const samples = w.samples.map((name, i) => ({ kind: 'sample', name, rare: i === 3, value: i === 3 ? SAMPLE_VALUE.rare : SAMPLE_VALUE.common, ...pick(i === 3 ? near[1] : near[0], i === 3 ? near[1] + 110 : near[1]) }))
  const station = { kind: 'station', name: 'Survey station', ...pick(w.hopper ? 140 : 170, w.hopper ? 210 : 240) }
  let anomaly
  if (lake) {
    // On the shore of the lake, on the side facing the pad.
    const a = Math.atan2(-lake.z, -lake.x), x = Math.round(lake.x + Math.cos(a) * (lake.r + 22)), z = Math.round(lake.z + Math.sin(a) * (lake.r + 22))
    anomaly = { kind: 'anomaly', name: w.anomaly.name, note: w.anomaly.note, x, z }
    used.push(anomaly)
  } else anomaly = { kind: 'anomaly', name: w.anomaly.name, note: w.anomaly.note, ...pick(w.hopper ? 170 : 260, w.hopper ? 260 : 380) }
  // Search zones: the rare sample and the anomaly are known only roughly.
  const zone = (p, r) => { const a = rand() * Math.PI * 2, off = r * 0.55 * rand(); return { x: p.x + Math.cos(a) * off, z: p.z + Math.sin(a) * off, r } }
  samples[3].zone = zone(samples[3], 55)
  anomaly.zone = zone(anomaly, 80)
  const layout = { pois: [...samples, station, anomaly] }
  layouts.set(id, layout)
  return layout
}

/* ------------------------------------------------------------------ *
 * The rock field (shared with the renderer) and collision
 * ------------------------------------------------------------------ */

/**
 * Every rock around a landing site, as the simulation knows it. The renderer
 * draws exactly these (gfx/expeditionTerrain.js buildRocks), so what you see
 * is what blocks. A rock lower than you can step over (or, for the rover's
 * 0.46 m of clearance, drive over) does not block. Nothing that blocks sits on
 * a site or in a lake.
 */
export const ROCK_COUNT = 1300
const ROCK_CELL = 8
const rockFields = new Map()
const rockCellKey = (ix, iz) => (ix + 1024) * 2048 + (iz + 1024)
export function rockField(id) {
  if (rockFields.has(id)) return rockFields.get(id)
  const rand = mulberry32(WORLDS[id].seed + 20), terrain = terrainFor(id), n = ROCK_COUNT
  const pois = layoutFor(id).pois, lake = FEATURES[id]?.lake
  const f = {
    n, x: new Float32Array(n), y: new Float32Array(n), z: new Float32Array(n),
    rx: new Float32Array(n), ry: new Float32Array(n), rz: new Float32Array(n),
    sx: new Float32Array(n), sy: new Float32Array(n), sz: new Float32Array(n),
    tint: new Float32Array(n), radius: new Float32Array(n), height: new Float32Array(n), cells: new Map(),
  }
  const lists = new Map()
  for (let i = 0; i < n; i++) {
    const angle = rand() * Math.PI * 2, r = 18 + 760 * rand() ** 1.4, x = Math.cos(angle) * r, z = Math.sin(angle) * r
    const size = 0.13 + rand() ** 5 * 2.4
    f.x[i] = x; f.z[i] = z; f.y[i] = terrain.height(x, z) + size * 0.12
    f.rx[i] = (rand() - 0.5) * 0.4; f.ry[i] = rand() * 6.28; f.rz[i] = (rand() - 0.5) * 0.4
    f.sx[i] = size * (0.8 + rand() * 0.5); f.sy[i] = size * (0.5 + rand() * 0.35); f.sz[i] = size * (0.8 + rand() * 0.5)
    f.tint[i] = 0.78 + rand() * 0.4
    f.radius[i] = 0.85 * (f.sx[i] + f.sz[i]) / 2
    f.height[i] = f.sy[i] * 1.28 * 0.9 + size * 0.12
    let shrink = pois.some((p) => Math.hypot(x - p.x, z - p.z) < f.radius[i] + 6)
    if (lake && Math.hypot(x - lake.x, z - lake.z) < lake.r + 4) shrink = true
    if (shrink) { f.sx[i] *= 0.12; f.sy[i] *= 0.12; f.sz[i] *= 0.12; f.radius[i] *= 0.12; f.height[i] *= 0.12 }
    const key = rockCellKey(Math.floor(x / ROCK_CELL), Math.floor(z / ROCK_CELL))
    if (!lists.has(key)) lists.set(key, [])
    lists.get(key).push(i)
  }
  for (const [key, list] of lists) f.cells.set(key, Int32Array.from(list))
  rockFields.set(id, f)
  return f
}

/**
 * What the feet and wheels cannot pass through, as circles on the ground: the
 * lander's stage (2.5 m) and footpads, the rover, and rocks taller than a step.
 */
export const SOLID = { landerBody: 2.5, footpad: 0.6, footpadAt: 3.2, rover: 1.25, walker: 0.3, roverSelf: 1.3 }
export const STEP = { walker: 0.35, rover: 0.42 }
const PAD_CORNERS = [-1, 1]

function pushOut(p, cx, cz, radius) {
  const dx = p.x - cx, dz = p.z - cz, d = Math.hypot(dx, dz)
  if (d >= radius) return false
  const nx = d > 1e-9 ? dx / d : 1, nz = d > 1e-9 ? dz / d : 0
  p.x = cx + nx * radius; p.z = cz + nz * radius
  const inward = p.vx * nx + p.vz * nz
  if (inward < 0) { p.vx -= inward * nx; p.vz -= inward * nz }
  return true
}
function collideRocks(s, p, selfRadius, step) {
  const f = rockField(s.id)
  const cx = Math.floor(p.x / ROCK_CELL), cz = Math.floor(p.z / ROCK_CELL)
  for (let ix = cx - 1; ix <= cx + 1; ix++) for (let iz = cz - 1; iz <= cz + 1; iz++) {
    const list = f.cells.get(rockCellKey(ix, iz))
    if (!list) continue
    for (let k = 0; k < list.length; k++) {
      const i = list[k]
      if (f.height[i] <= step) continue
      pushOut(p, f.x[i], f.z[i], f.radius[i] + selfRadius)
    }
  }
}
function collide(s, p, selfRadius, includeRover, step) {
  // Circles overlap, so pushing out of one can push into another; a few
  // passes settle it.
  for (let pass = 0; pass < 4; pass++) {
    collideRocks(s, p, selfRadius, step)
    if (!s.landed) continue
    pushOut(p, s.x, s.z, SOLID.landerBody + selfRadius)
    const c = Math.cos(s.yaw), sn = Math.sin(s.yaw)
    for (const ax of PAD_CORNERS) for (const az of PAD_CORNERS) {
      const lx = ax * SOLID.footpadAt, lz = az * SOLID.footpadAt
      pushOut(p, s.x + lx * c + lz * sn, s.z - lx * sn + lz * c, SOLID.footpad + selfRadius)
    }
    if (includeRover && s.rover) pushOut(p, s.rover.x, s.rover.z, SOLID.rover + selfRadius)
  }
}

/* ------------------------------------------------------------------ *
 * A mission
 * ------------------------------------------------------------------ */

/** The hopper's cold-gas hold-down thruster, m/s^2 downward. */
export const HOLD_DOWN = 0.35

/** How the descent scales with gravity: gentler and lower on a small world. */
export function gravityScale(id) { return clamp(Math.sqrt(WORLDS[id].gravity / 1.62), 0.06, 2.4) }

/**
 * A new mission, starting on final approach: a few hundred metres up and
 * closing on the pad. `options.mode` is 'campaign' or 'free';
 * `options.upgrades` are the campaign's.
 */
export function createExpedition(id = 'moon', options = {}) {
  const w = WORLDS[id]
  if (!w) throw new Error(`Unknown world: ${id}`)
  const opts = typeof options === 'object' && options ? options : { mode: options ? 'campaign' : 'free' }
  const upgrades = opts.upgrades ?? {}
  const vehicle = vehicleFor(id, upgrades), rover = roverFor(upgrades)
  const k = gravityScale(id)
  const alt = 520 * clamp(k, 0.22, 1)
  const dist = alt * 0.85
  const along = [0.35, 0.94]
  const vh = 3 + 15 * Math.min(k, 1)
  const t = terrainFor(id)
  const x = along[0] * dist, z = along[1] * dist
  const pois = layoutFor(id).pois.map((p) => ({ ...p, done: false, found: !p.zone }))
  return {
    id, mode: 'flight', campaign: opts.mode === 'campaign', play: opts.mode ?? 'free', upgrades, vehicle, roverSpec: rover,
    x, y: t.height(x, z) + alt + vehicle.clearance, z,
    vx: -along[0] * vh, vy: -(2 + 9 * Math.min(k, 1.2)), vz: -along[1] * vh,
    yaw: 0, pitch: 0, roll: 0, throttle: 0, fuel: vehicle.fuel, assist: true, assistUsed: false, landed: false, aim: { x: 0, z: 0 }, hopping: false,
    time: 0, landedAt: null, liftAt: null, touchdown: null, steps: 0,
    walker: { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, yaw: 0, pitch: 0, ground: true },
    rover: null, pois, investigating: 0, scan: { at: -99, x: 0, z: 0, range: scannerRange(upgrades) },
    survival: w.survival ?? null, events: [], result: null,
    message: w.hopper ? 'Landing assist is flying you in. Too little gravity here for a rover: you will hop the lander between sites.' : 'Landing assist is flying you in. Steer with W A S D, or press H to fly it yourself.',
  }
}

export function altitude(s) { return Math.max(0, s.y - terrainFor(s.id).height(s.x, s.z) - s.vehicle.clearance) }
export function roverDistance(s) {
  if (!s.rover) return Infinity
  const p = s.mode === 'rover' ? s.rover : s.walker
  return Math.hypot(p.x - s.rover.x, p.z - s.rover.z)
}
/** Where the player is: the walker, the rover, or the lander. */
export function here(s) { return s.mode === 'rover' ? s.rover : s.mode === 'eva' ? s.walker : s }

function note(s, text, points = 0) {
  s.message = text
  s.events.push({ t: s.time, text, points })
  if (s.events.length > 40) s.events.shift()
}

/** What the survey asks for, and how far along it is. */
export function objectives(s) {
  let got = 0, total = 0, station = false, anomaly = false
  for (const p of s.pois) {
    if (p.kind === 'sample') { total++; if (p.done) got++ }
    else if (p.kind === 'station') station = p.done
    else anomaly = p.done
  }
  return { landed: s.landedAt !== null, samples: got, samplesNeeded: 3, samplesTotal: total, station, anomaly, ready: got >= 3 && station }
}

/** Q: the scanner. Reveals hidden finds within range of where you are. */
export function scan(s) {
  if (s.landedAt === null || s.time - s.scan.at < 2.5) return false
  const p = here(s)
  s.scan.at = s.time; s.scan.x = p.x; s.scan.z = p.z
  let found = 0
  for (const poi of s.pois) {
    if (poi.found) continue
    if (Math.hypot(poi.x - p.x, poi.z - p.z) <= s.scan.range) { poi.found = true; found++ }
  }
  note(s, found ? `Scanner: ${found === 1 ? 'found it' : `${found} finds`}. Marked on the radar.` : 'Scanner: nothing in range. Get into the search zone and scan again.')
  return true
}

/** The nearest unfinished, found site within reach. */
export function nearestPoi(s, reach = Infinity) {
  const p = here(s)
  let best = null, bestD = reach
  for (const poi of s.pois) {
    if (poi.done || !poi.found) continue
    const d = Math.hypot(poi.x - p.x, poi.z - p.z)
    if (d < bestD) { best = poi; bestD = d }
  }
  return best ? { poi: best, distance: bestD } : null
}

export const REACH = { rover: 7, eva: 4, hop: 12 }
/**
 * E: whatever is in reach. Collect, deploy, board. On a hopper world the
 * lander itself is the tool, landed within twelve metres of the site.
 */
export function interact(s) {
  if (s.mode === 'crashed' || s.mode === 'complete' || s.mode === 'ascent') return false
  const w = WORLDS[s.id]
  const tool = s.mode === 'rover' ? 'rover' : s.mode === 'eva' ? 'eva' : w.hopper && s.landed ? 'hop' : null
  if (tool) {
    const hit = nearestPoi(s, REACH[tool])
    if (hit && hit.poi.kind !== 'anomaly') {
      hit.poi.done = true
      if (hit.poi.kind === 'sample') note(s, `${hit.poi.name} collected${hit.poi.rare ? ': a rare find' : ''}.`, hit.poi.value)
      else note(s, 'Survey station deployed and recording.', 300)
      return true
    }
  }
  if (s.mode === 'eva') {
    if (s.rover && roverDistance(s) < 4) { s.mode = 'rover'; note(s, 'Back in the rover.'); return true }
    if (Math.hypot(s.walker.x - s.x, s.walker.z - s.z) < 9) return board(s)
  }
  if (s.mode === 'rover' && Math.hypot(s.rover.x - s.x, s.rover.z - s.z) < 12) return board(s)
  return false
}
function board(s) {
  s.mode = 'flight'
  const o = objectives(s)
  note(s, o.ready ? 'Aboard with everything. Press T to lift off.' : `Aboard. Still needed: ${Math.max(0, 3 - o.samples)} sample(s)${o.station ? '' : ' and the station'}. T leaves anyway.`)
  return true
}
/** F: step out of the rover to walk, or back in. */
export function toggleWalk(s) {
  if (s.mode === 'rover') {
    Object.assign(s.walker, { x: s.rover.x + Math.cos(s.rover.yaw) * 1.8, z: s.rover.z - Math.sin(s.rover.yaw) * 1.8, vx: 0, vy: 0, vz: 0, yaw: s.rover.yaw, pitch: 0, ground: true })
    s.walker.y = terrainFor(s.id).height(s.walker.x, s.walker.z)
    s.rover.vx = 0; s.rover.vz = 0; s.rover.speed = 0
    s.mode = 'eva'; note(s, 'On foot. F to get back in the rover.')
    return true
  }
  if (s.mode === 'eva' && s.rover && roverDistance(s) < 6) { s.mode = 'rover'; note(s, 'Back in the rover.'); return true }
  return false
}

/** T: lift off for home. The mission is scored once the climb is under way. */
export function launch(s) {
  if (!s.landed || s.mode !== 'flight' || s.fuel <= 0) return false
  s.landed = false; s.assist = false; s.mode = 'ascent'; s.vy = 0.5; s.y += 0.2; s.liftAt = s.time
  note(s, 'Lift-off. Heading back to orbit.')
  return true
}

/**
 * H on a hopper world, landed: the assist lifts off, climbs, crosses to the
 * next site and sets down seven metres short of it, inside the arm's reach.
 */
export function hop(s) {
  if (!WORLDS[s.id].hopper || !s.landed || s.mode !== 'flight' || s.fuel <= 0) return false
  const out = [0, 0]
  const kind = nextTarget(s, out)
  if (!kind || kind === 'lander') return false
  const dx = out[0] - s.x, dz = out[1] - s.z, d = Math.hypot(dx, dz)
  if (d < 10) return false
  s.aim.x = out[0] - dx / d * 7; s.aim.z = out[1] - dz / d * 7
  s.landed = false; s.assist = true; s.hopping = true; s.vy = 0.4; s.y += 0.1
  note(s, `Hopping ${Math.round(d)} m to the ${kind === 'zone' ? 'search zone' : kind}.`)
  return true
}

/** Deploy the rover beside the lander and put the crew in it. Not on hopper worlds. */
function rollOut(s) {
  const spec = s.roverSpec
  const x = s.x + 11, z = s.z + 5
  s.rover = { x, y: terrainFor(s.id).height(x, z) + spec.clearance, z, vx: 0, vz: 0, yaw: Math.atan2(x - s.x, -(z - s.z)), speed: 0, battery: 1, odometer: 0 }
  s.mode = 'rover'
}

/**
 * Fixed-step SI dynamics. Assist requests thrust; it never writes position.
 * `keys` carries forward/back/left/right (camera-relative in flight), thrust
 * (Space), jump, and camYaw, the camera's heading, so W is "away from me".
 */
export function stepExpedition(s, keys, dt = FIXED_STEP) {
  if (!(dt > 0 && dt <= 1 / 30)) throw new Error('Expedition step outside fixed-step budget')
  if (s.mode === 'crashed' || s.mode === 'complete') return
  const w = WORLDS[s.id], terrain = terrainFor(s.id)
  s.time += dt; s.steps++
  if (s.survival !== null && s.landedAt !== null && s.mode !== 'ascent' && s.time - s.landedAt > s.survival) {
    s.mode = 'crashed'
    note(s, 'The heat won: the electronics failed after eight minutes on the surface, about as long as the Venera landers lasted.')
    return
  }
  if (s.mode === 'eva') return stepWalker(s, keys, dt, w, terrain)
  if (s.mode === 'rover') return stepRover(s, keys, dt, w, terrain)
  stepFlight(s, keys, dt, w, terrain)
}

function stepWalker(s, keys, dt, w, terrain) {
  const p = s.walker
  const f = (keys.forward ? 1 : 0) - (keys.back ? 1 : 0), side = (keys.right ? 1 : 0) - (keys.left ? 1 : 0)
  const wantX = Math.sin(p.yaw) * f + Math.cos(p.yaw) * side
  const wantZ = -Math.cos(p.yaw) * f + Math.sin(p.yaw) * side
  const jump = Boolean(keys.jump) && p.ground
  if (jump) keys.jump = false
  _foot.east = p.vx; _foot.north = p.vz; _foot.up = p.vy; _foot.height = p.y; _foot.onGround = p.ground
  stepWalk(_foot, dt, w.gravity, wantX, wantZ, jump, -Infinity)
  const nx = p.x + _foot.east * dt, nz = p.z + _foot.north * dt
  let moved = false
  if (Math.hypot(nx, nz) < REGION_LIMIT && terrain.height(nx, nz) - _foot.height < 0.45) { p.x = nx; p.z = nz; moved = true }
  p.vx = moved ? _foot.east : 0
  p.vz = moved ? _foot.north : 0
  collide(s, p, SOLID.walker, p.y - terrain.height(p.x, p.z) < 1.5, STEP.walker)
  p.vy = _foot.up; p.y = _foot.height
  const floor = terrain.height(p.x, p.z)
  const stick = p.ground && !jump && p.y - floor < 0.45
  if (p.y <= floor || stick) { p.y = floor; if (p.vy < 0) p.vy = 0; p.ground = true } else p.ground = false
  investigate(s, p, dt)
}

function stepRover(s, keys, dt, w, terrain) {
  const r = s.rover, spec = s.roverSpec
  const throttle = (keys.forward ? 1 : 0) - (keys.back ? 1 : 0)
  const steer = (keys.left ? 1 : 0) - (keys.right ? 1 : 0)
  const drive = r.battery > 0 ? throttle * spec.drive / spec.mass : 0
  r.yaw += steer * dt * 1.5 * Math.min(1, 0.25 + Math.abs(r.speed) / spec.maxSpeed)
  const slopeX = (terrain.height(r.x + 1, r.z) - terrain.height(r.x - 1, r.z)) / 2
  const slopeZ = (terrain.height(r.x, r.z + 1) - terrain.height(r.x, r.z - 1)) / 2
  const fx = Math.sin(r.yaw) * drive - slopeX * w.gravity * spec.grip
  const fz = -Math.cos(r.yaw) * drive - slopeZ * w.gravity * spec.grip
  r.vx += fx * dt; r.vz += fz * dt
  const speed = Math.hypot(r.vx, r.vz)
  if (speed > spec.maxSpeed) { r.vx *= spec.maxSpeed / speed; r.vz *= spec.maxSpeed / speed }
  const roll = Math.max(0, 1 - dt * (r.battery > 0 ? 0.55 : 3.4))
  r.vx *= roll; r.vz *= roll
  const nx = r.x + r.vx * dt, nz = r.z + r.vz * dt
  if (Math.hypot(nx, nz) < REGION_LIMIT) {
    if (terrain.height(nx, nz) - terrain.height(r.x, r.z) < 1.1) { r.x = nx; r.z = nz; r.odometer += Math.hypot(r.vx, r.vz) * dt }
    else { r.vx *= 0.2; r.vz *= 0.2 }
  }
  collide(s, r, SOLID.roverSelf, false, STEP.rover)
  r.speed = Math.hypot(r.vx, r.vz)
  r.battery = Math.max(0, r.battery - spec.drain * (0.4 + r.speed / spec.maxSpeed) * (dt / FIXED_STEP))
  r.y = terrain.height(r.x, r.z) + spec.clearance
  investigate(s, r, dt)
}

/** Holding still within 14 m of the anomaly for four seconds is investigating it. */
function investigate(s, p, dt) {
  let a = null
  for (const q of s.pois) if (q.kind === 'anomaly') a = q
  if (a.done || !a.found) { s.investigating = 0; return }
  const still = Math.hypot(p.vx ?? 0, p.vz ?? 0) < 0.6
  if (Math.hypot(p.x - a.x, p.z - a.z) < 14 && still) {
    s.investigating = Math.min(1, s.investigating + dt / 4)
    if (s.investigating >= 1) { a.done = true; note(s, `${a.name} investigated. ${a.note}`, 500) }
  } else s.investigating = Math.max(0, s.investigating - dt)
}

function stepFlight(s, keys, dt, w, terrain) {
  const v = s.vehicle
  if (s.landed) {
    s.throttle = 0
    if (WORLDS[s.id].hopper) investigate(s, s, dt)
    // Space lifts off again: how a hopper world is crossed, and a short hop
    // anywhere else.
    if (keys.thrust && s.fuel > 0) { s.landed = false; s.assist = false; s.vy = 0.3; s.y += 0.1 } else return
  }
  const mass = v.dryMass + s.fuel, maxA = v.thrust / mass
  const h = altitude(s)
  // Camera-relative steering: W is away from the camera, D is to its right.
  const cy = keys.camYaw ?? 0
  const fw = (keys.forward ? 1 : 0) - (keys.back ? 1 : 0), rt = (keys.right ? 1 : 0) - (keys.left ? 1 : 0)
  const wishX = -Math.sin(cy) * fw + Math.cos(cy) * rt
  const wishZ = -Math.cos(cy) * fw - Math.sin(cy) * rt
  const k = gravityScale(s.id)
  let ax, az, up
  if (s.mode === 'ascent') {
    s.throttle = 1
    ax = 0; az = 0; up = maxA
    if (h > 140 * clamp(k, 0.3, 1) || s.time - s.liftAt > 12) { finish(s); return }
  } else if (s.assist) {
    if (h < 60) s.assistUsed = true
    // Horizontal: a speed toward the pad that shrinks as the ground nears,
    // so touchdown is always near-vertical; vertical: slow to a hover while
    // still far from the pad. Thick air (Venus, Titan) caps the sideways
    // speed the engine can buy, and this is what keeps that from mattering.
    const dx = s.aim.x - s.x, dz = s.aim.z - s.z, dist = Math.hypot(dx, dz)
    const vmaxH = Math.min(15 * clamp(k, 0.3, 1), 0.3 + h * 0.22)
    const toward = dist > 0.5 ? Math.min(dist * 0.12, vmaxH) / dist : 0
    const lat = 1.6 * clamp(k, 0.15, 1.2)
    const far = dist > 18 && h < 45 ? 0.25 : 1
    let wantV = -Math.min(11 * clamp(k, 0.35, 1.4), Math.max(0.6, h * 0.17)) * far
    // A hop climbs to a cruising height for the distance, crosses, then comes down.
    if (s.hopping && dist > 6) wantV = clamp((Math.min(40, 6 + dist * 0.25) - h) * 0.4, -3, 3) * clamp(k * 6, 0.3, 1.5)
    // The assist flies to its aim point (the pad, or the next site on a hop);
    // the stick moves where it aims.
    ax = clamp((dx * toward - s.vx) * 0.9, -lat, lat) + wishX * lat
    az = clamp((dz * toward - s.vz) * 0.9, -lat, lat) + wishZ * lat
    // On a body this small, gravity alone takes minutes to bring you back, so
    // the hopper carries a cold-gas thruster that pushes down, as Philae's did.
    up = Math.max(w.hopper ? -HOLD_DOWN : 0, w.gravity + clamp((wantV - s.vy) * 1.2, -3 * Math.max(k, 0.15), 4 * Math.max(k, 0.15)))
    const need = Math.hypot(ax, up, az)
    s.throttle = clamp(need / maxA, 0, 1)
    const factor = need > maxA ? maxA / need : 1
    ax *= factor; az *= factor; up *= factor
  } else {
    // By hand: Space is the engine, the stick tilts it; on a hopper world C
    // fires the hold-down thruster.
    s.throttle = keys.thrust ? 1 : 0
    const tilt = 0.32, mag = Math.min(1, Math.hypot(wishX, wishZ))
    ax = wishX * tilt * maxA * s.throttle
    az = wishZ * tilt * maxA * s.throttle
    up = Math.sqrt(Math.max(0, 1 - tilt * tilt * mag * mag)) * maxA * s.throttle
    if (w.hopper && keys.down) up -= HOLD_DOWN
  }
  s.pitch = Math.atan2(az, Math.max(up, 0.01)) * 0.6; s.roll = -Math.atan2(ax, Math.max(up, 0.01)) * 0.6
  if (s.fuel <= 0) { ax = 0; az = 0; up = 0; s.throttle = 0 }
  // Drag, from the world's own air: nothing in a vacuum, a drag plate's worth on Venus.
  const rho = w.air ? w.air.rho * Math.exp(-h / w.air.scale) : 0
  const drag = 0.5 * rho * 12 * Math.hypot(s.vx, s.vy, s.vz) / mass
  const burn = s.throttle * v.thrust / (v.isp * G0) * dt
  const fuelFactor = burn > 0 ? Math.min(1, s.fuel / burn) : 1
  s.vx += (ax * fuelFactor - drag * s.vx) * dt
  s.vz += (az * fuelFactor - drag * s.vz) * dt
  const g = w.gravity * (w.radius / (w.radius + Math.max(0, h))) ** 2
  s.vy += (up * fuelFactor - g - drag * s.vy) * dt
  s.fuel = Math.max(0, s.fuel - burn)
  s.x += s.vx * dt; s.y += s.vy * dt; s.z += s.vz * dt
  if (s.mode === 'ascent') return
  const floor = terrain.height(s.x, s.z) + v.clearance
  if (s.y <= floor) {
    const touch = { vertical: Math.abs(s.vy), horizontal: Math.hypot(s.vx, s.vz), slope: terrain.slope(s.x, s.z), fuel: s.fuel, distance: Math.hypot(s.x, s.z), assisted: s.assistUsed }
    const safe = touch.vertical <= v.safeVertical && touch.horizontal <= v.safeHorizontal && touch.slope < v.safeSlope
    s.y = floor; s.vx = 0; s.vy = 0; s.vz = 0; s.throttle = 0
    if (!safe) {
      s.mode = 'crashed'
      note(s, touch.vertical > v.safeVertical ? `Down at ${touch.vertical.toFixed(1)} m/s: too fast. Under ${v.safeVertical} m/s holds.` : touch.slope >= v.safeSlope ? 'The ground was too steep to stand on. Land on level ground.' : 'Too much sideways speed at touchdown.')
      return
    }
    s.landed = true
    s.hopping = false
    if (s.landedAt === null) {
      s.touchdown = touch
      s.landedAt = s.time
      s.scan.at = s.time
      if (w.hopper) note(s, 'Down. Hop to each site (hold Space to lift, W A S D to steer) and press E once landed beside it.')
      else { rollOut(s); note(s, 'Down. The rover is out and you are driving it. Q scans, hold Shift to warp time, E collects.') }
    }
  }
  if (Math.hypot(s.x, s.z) > REGION_LIMIT || h > 6000) { s.mode = 'crashed'; note(s, 'You flew out of the survey area.') }
}

/* ------------------------------------------------------------------ *
 * Scoring
 * ------------------------------------------------------------------ */

/**
 * The mission's score, out of about 3,000. Landing: on the pad (400), soft
 * (300) and with fuel to spare (300), at three quarters if the assist flew
 * the last 60 m. Finds: 100 a sample, 250 the rare one, 300 the station, 500
 * the anomaly. Time: up to 300 for a survey done inside ten minutes on the
 * surface. Stars: one for a complete survey, two from 1,800, three from 2,500
 * with the anomaly. Science, to spend in the campaign, is a tenth of it.
 */
export function missionScore(s) {
  const t = s.touchdown
  const landing = t ? Math.round(((400 * Math.max(0, 1 - t.distance / 60)) + 300 * Math.max(0, 1 - t.vertical / s.vehicle.safeVertical) + 300 * t.fuel / s.vehicle.fuel) * (t.assisted ? 0.75 : 1)) : 0
  const finds = s.pois.reduce((n, p) => n + (p.done ? (p.kind === 'sample' ? p.value : p.kind === 'station' ? 300 : 500) : 0), 0)
  const minutes = s.landedAt === null ? 99 : (s.time - s.landedAt) / 60
  const o = objectives(s)
  const time = o.ready ? Math.round(300 * clamp(1 - (minutes - 3) / 7, 0, 1)) : 0
  const total = landing + finds + time
  const stars = !o.ready ? 0 : total >= 2500 && o.anomaly ? 3 : total >= 1800 ? 2 : 1
  return { landing, finds, time, total, stars, science: Math.round(total / 10), complete: o.ready, anomaly: o.anomaly, samples: o.samples }
}
function finish(s) {
  s.mode = 'complete'
  s.result = missionScore(s)
  note(s, s.result.complete ? 'Survey complete. Back in orbit.' : 'Back in orbit, with the survey unfinished.')
}

/* ------------------------------------------------------------------ *
 * Navigation: where to go next
 * ------------------------------------------------------------------ */

/**
 * Where the player should go next, as one rule the arrow, the beacon and the
 * radar share. Writes x, z into `out`; returns the kind ('pad', 'sample',
 * 'station', 'anomaly', 'zone', 'lander') or null. Allocation-free.
 */
export const TARGET = { kind: null, poi: null }
function aim(out, kind, x, z, poi = null) { out[0] = x; out[1] = z; TARGET.kind = kind; TARGET.poi = poi; return kind }
export function nextTarget(s, out) {
  TARGET.poi = null
  if (s.mode === 'crashed' || s.mode === 'complete' || s.mode === 'ascent') return aim(out, null, 0, 0)
  if (s.landedAt === null) return aim(out, 'pad', 0, 0)
  const p = here(s)
  const o = objectives(s)
  let best = null, bestD = Infinity
  for (const poi of s.pois) {
    if (poi.done) continue
    // The anomaly is a bonus: offered once the survey's own work is done.
    if (poi.kind === 'anomaly' && !o.ready) continue
    const x = poi.found ? poi.x : poi.zone.x, z = poi.found ? poi.z : poi.zone.z
    const d = Math.hypot(x - p.x, z - p.z)
    if (d < bestD) { best = poi; bestD = d }
  }
  if (best) return aim(out, best.found ? best.kind : 'zone', best.found ? best.x : best.zone.x, best.found ? best.z : best.zone.z, best)
  return aim(out, 'lander', s.x, s.z)
}
