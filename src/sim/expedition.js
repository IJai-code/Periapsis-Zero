import { BODIES, G, G0 } from './constants.js'
import { RAILS } from './rails.js'
import { makeNoise } from '../gfx/noise.js'
import { stepWalk } from './walk.js'

export const REGIONS = {
  moon: { id: 'moon', name: 'Moon', site: 'The southern highlands', geology: 'Impact basins · airless regolith', seed: 1107, color: '#85817b', sky: '#030509', accent: '#e1d9c6', atmosphere: 0, parent: 'Earth', parentRadius: 6371000, parentDistance: 384400000 },
  mars: { id: 'mars', name: 'Mars', site: 'The canyon country', geology: 'Layered mesas · basalt and dust', seed: 2209, color: '#a65e39', sky: '#9a705b', accent: '#eea270', atmosphere: 0.018, parent: null },
  europa: { id: 'europa', name: 'Europa', site: 'The fractured plains', geology: 'Double ridges · young surface ice', seed: 3313, color: '#b4b9b5', sky: '#030509', accent: '#bad7de', atmosphere: 0, parent: 'Jupiter', parentRadius: 69911000, parentDistance: 670900000 },
}
for (const region of Object.values(REGIONS)) {
  const body = BODIES[region.id] ?? RAILS.find((b) => b.id === region.id)
  region.radius = body.radius
  region.gravity = G * body.mass / body.radius ** 2
}

export const CAMPAIGN = [
  { id: 'moon', number: '01', title: 'A place to stand', role: 'Flight director', contact: 'Mara Voss', brief: 'Photos from orbit show two kinds of rock at this crater rim. We need to know if the dark rock came from the impact or from the ground underneath. Land, grab one sample of each, then drive the rover out and set up the three instruments.', stakes: 'This is the team\'s first real mission and there is no rescue ship nearby. Land gently, and keep an eye on the rover battery when you are far from the lander.', debrief: 'Two different rocks. The dark one is basalt from the old surface; the pale one was made by the impact. With the instrument readings logged, the next crew knows where to dig.', samples: ['Rim breccia', 'Basalt fragment'] },
  { id: 'mars', number: '02', title: 'The layers below', role: 'Field geologist', contact: 'Elias Chen', brief: 'The canyon walls are layered like a cake, and the layers tell the story of this basin. Sample the lower rock bed and the dusty outcrop above it, then drive the rover out to set up the instruments.', stakes: 'Mars pulls more than twice as hard as the Moon, and the air is too thin to slow you down. Save fuel for the landing, and save rover battery for the drive back.', debrief: 'The two layers are made of different rock, so the basin changed before the dust arrived. The instrument readings will help date that change. Not the full answer yet, but enough to plan the next trip.', samples: ['Lower-bed sediment', 'Oxidized outcrop'] },
  { id: 'europa', number: '03', title: 'Under the ice', role: 'Mission scientist', contact: 'Mara Voss', brief: 'A brown stain runs along a fresh crack in the ice. Sample it and the clean ice next to the ridge, then set up the instruments away from the lander. We are not drilling today, just collecting what has come up to the surface.', stakes: 'Jupiter fills the sky, but the ice under your boots is what matters. Bring both samples and every reading back to the lander.', debrief: 'The brown material is different from the clean ice, and the readings show the ridge is still moving. It is not proof of life, but it is a strong reason to come back with better instruments.', samples: ['Fracture deposit', 'Clean surface ice'] },
]

/**
 * The surface rover, and why it is not a car.
 *
 * Six wheels and no differential: it steers by skid, which is what every
 * machine that has actually driven on another world does, because a
 * differential is mass and this vehicle is 210 kg of it. Top speed is 3.4 m/s,
 * a fast walk. The Apollo crews' rover managed 3.6 m/s on the Moon and the
 * limit was never the motors; it was what the driver could see and stop for.
 *
 * The figures are the vehicle's, not a feel choice. On the Moon 520 N against
 * 210 kg is 2.48 m/s², which reaches top speed in under two seconds. The same
 * motor against a gradient is fought by gravity scaled by the traction factor:
 * it stalls on a 1.21 gradient on Mars (about 50 degrees) and on a 2.77 one on
 * the Moon (about 70). That difference between worlds is the reason to drive
 * on both.
 */
export const ROVER = { mass: 210, drive: 520, wheelbase: 2.1, track: 1.7, clearance: 0.46, maxSpeed: 3.4, grip: 0.55, drain: 9e-6 }

/**
 * The instrument packages, and why they are further out than the samples.
 *
 * A sample is a rock you can pick up beside the vehicle. An instrument is a
 * decision about where a measurement should live: a seismometer wants quiet
 * ground away from the lander's pumps, a magnetometer wants distance from the
 * vehicle's own field, and a heat probe wants undisturbed regolith. So they sit
 * 150 to 380 m out. On foot that is a long way: the walking gait tops out at
 * sqrt(g L), 1.21 m/s on the Moon, 1.09 on Europa and 1.83 on Mars (see
 * `sim/walk.js`), so the farthest instrument is more than five minutes' walk
 * from the lander on the Moon. The rover covers it at 3.4. That gap is what
 * the rover is for.
 */
const PACKAGES = [
  { name: 'Seismometer', reading: 'Ambient seismic noise' },
  { name: 'Magnetometer', reading: 'Crustal field strength' },
  { name: 'Heat probe', reading: 'Subsurface gradient' },
]
const place = (spots) => spots.map(([x, z], i) => ({ ...PACKAGES[i], x, z }))

/**
 * Where things are on each world. Every world used to share one layout, which
 * put Europa's magnetometer on a 49 degree ridge wall; these were chosen by
 * measuring the generated ground, and verify-expeditions holds every site to
 * gentle ground and a drivable straight line from the lander.
 */
export const LAYOUTS = {
  moon: { sites: [{ x: -28, z: -42 }, { x: 36, z: -64 }], instruments: place([[-210, 150], [180, -260], [-140, -300]]) },
  mars: { sites: [{ x: 44, z: -30 }, { x: -20, z: -72 }], instruments: place([[-340, 60], [170, -100], [120, 330]]) },
  europa: { sites: [{ x: -50, z: -26 }, { x: 30, z: 58 }], instruments: place([[320, -60], [-220, -270], [220, 270]]) },
}
/** The Moon's layout; every world has the same counts and package names. */
export const SITES = LAYOUTS.moon.sites
export const INSTRUMENTS = LAYOUTS.moon.instruments
export const sitesFor = (id) => (LAYOUTS[id] ?? LAYOUTS.moon).sites
export const instrumentsFor = (id) => (LAYOUTS[id] ?? LAYOUTS.moon).instruments
export const VEHICLE = { dryMass: 3600, fuel: 1500, thrust: 32000, isp: 310, clearance: 2.65, safeVertical: 3, safeHorizontal: 2.5, safeSlope: 0.28 }
export const FIXED_STEP = 1 / 120
/** Scratch for the walk step, so the fixed step allocates nothing. */
const _foot = { east: 0, north: 0, up: 0, height: 0, onGround: true }
export const REGION_LIMIT = 700
const clamp = (x, a, b) => Math.max(a, Math.min(b, x))
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t) }
const terrains = new Map()

/** Procedural geology, not measured topography. Heights and renderer share the same 12 m lattice. */
export function terrainFor(id) {
  if (terrains.has(id)) return terrains.get(id)
  if (!REGIONS[id]) throw new Error(`Unknown expedition region: ${id}`)
  const noise = makeNoise(REGIONS[id].seed)
  const craters = [[-730, -1100, 510, 95], [650, -2600, 900, 230], [-2400, 800, 1200, 260], [1700, 1700, 780, 180], [-5100, -4500, 2500, 610]]
  const mesas = [[-1400, -2200, 650, 720], [1100, -2900, 780, 940], [3000, -1800, 1100, 830], [-3400, -4300, 1200, 1150], [700, -7200, 2400, 1550]]
  function raw(x, z) {
    const n = noise.fbm(x / 750, 0.31, z / 750, 4)
    let h = n * (id === 'mars' ? 65 : id === 'moon' ? 95 : 15)
    if (id === 'moon') {
      for (const [cx, cz, r, depth] of craters) {
        const q = Math.hypot(x - cx, z - cz) / r
        h += -depth * Math.max(0, 1 - q * q) + depth * 0.42 * Math.exp(-(((q - 1) / 0.13) ** 2))
      }
      h += 240 * noise.fbm(x / 4200, 2, z / 4200, 3)
    } else if (id === 'mars') {
      for (const [cx, cz, r, high] of mesas) {
        const d = Math.hypot(x - cx, (z - cz) * 1.15)
        const edge = r * (1 + 0.09 * noise.noise3(x / 130, 1, z / 130))
        const wall = 1 - smooth(edge * 0.7, edge * 1.17, d)
        h += high * wall + 7 * Math.sin(wall * 52) * wall * (1 - wall)
      }
      h += 80 * Math.abs(noise.fbm(x / 2000, 2, z / 2000, 3))
    } else {
      const warp = 70 * noise.noise3(x / 1500, 3, z / 1500)
      const band = Math.sin((x * 0.75 + z * 0.48 + warp) / 230)
      h += 85 * Math.exp(-(((Math.abs(band) - 0.19) / 0.18) ** 2))
      h -= 12 * Math.exp(-((band / 0.07) ** 2))
    }
    // Survey clearing is an authored landing zone, blended into the geology.
    const r = Math.hypot(x, z)
    h = h * smooth(110, 480, r) + 0.65 * noise.noise3(x / 38, 7, z / 38) * smooth(12, 90, r)
    // Spherical drop keeps distant horizons grounded in the body's scale.
    return h - (x * x + z * z) / (2 * REGIONS[id].radius)
  }
  function lattice(x, z, step, sample = raw) {
    const a = Math.floor(x / step) * step, b = Math.floor(z / step) * step
    const u = (x - a) / step, v = (z - b) / step
    const h00 = sample(a, b), h10 = sample(a + step, b), h01 = sample(a, b + step), h11 = sample(a + step, b + step)
    return u + v <= 1 ? h00 + u * (h10 - h00) + v * (h01 - h00) : h11 + (1 - u) * (h01 - h11) + (1 - v) * (h10 - h11)
  }
  // Morph the fine surface into the next ring's lattice at its boundary.
  // Both sides then meet at identical heights rather than exposing LOD cracks.
  function innerVertex(x, z) {
    const t = smooth(672, 768, Math.max(Math.abs(x), Math.abs(z)))
    return raw(x, z) * (1 - t) + lattice(x, z, 48) * t
  }
  function height(x, z) {
    const r = Math.max(Math.abs(x), Math.abs(z))
    if (r <= 660) return lattice(x, z, 12)
    if (r < 768) return lattice(x, z, 12, innerVertex)
    if (r <= 2688) return lattice(x, z, 48)
    if (r < 3072) { const t = smooth(2688, 3072, r); return lattice(x, z, 48) * (1 - t) + lattice(x, z, 192) * t }
    return lattice(x, z, 192)
  }
  const terrain = { height, slope: (x, z) => Math.hypot((height(x + 1, z) - height(x - 1, z)) / 2, (height(x, z + 1) - height(x, z - 1)) / 2) }
  terrains.set(id, terrain)
  return terrain
}

export function createExpedition(id = 'moon', campaign = false) {
  const region = REGIONS[id]
  if (!region) throw new Error(`Unknown expedition region: ${id}`)
  return { id, campaign, mode: 'flight', x: 0, y: 180 + VEHICLE.clearance, z: 180, vx: 0, vy: -6, vz: -4, yaw: 0, pitch: 0, roll: 0, throttle: 0, fuel: VEHICLE.fuel, assist: true, landed: false, samples: [], delivered: false, message: 'Landing assist is flying the descent for you. Press H to take over.', time: 0, touchdown: null, walker: { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, yaw: 0, pitch: 0, ground: true }, rover: null, instruments: [], steps: 0 }
}
export function altitude(s) { return Math.max(0, s.y - terrainFor(s.id).height(s.x, s.z) - VEHICLE.clearance) }
export function nearestSample(s) {
  if (s.mode !== 'eva') return null
  let hit = null, distance = Infinity
  sitesFor(s.id).forEach((p, i) => { const d = Math.hypot(s.walker.x - p.x, s.walker.z - p.z); if (!s.samples.includes(i) && d < distance) { hit = i; distance = d } })
  return hit === null ? null : { index: hit, distance }
}
export function roverDistance(s) {
  if (!s.rover) return Infinity
  const p = s.mode === 'rover' ? s.rover : s.walker
  return Math.hypot(p.x - s.rover.x, p.z - s.rover.z)
}
export function nearestInstrument(s) {
  if (!s.rover || s.mode !== 'rover') return null
  let hit = null, distance = Infinity
  instrumentsFor(s.id).forEach((p, i) => { const d = Math.hypot(s.rover.x - p.x, s.rover.z - p.z); if (!s.instruments.includes(i) && d < distance) { hit = i; distance = d } })
  return hit === null ? null : { index: hit, distance }
}
/**
 * What the feet and wheels cannot pass through, as circles on the ground.
 *
 * The lander's descent stage and its tanks fit inside 2.5 m of its centre
 * (tanks at 1.9 m out, 0.57 m in radius); each footpad is half a metre across
 * at 3.2 m out on a diagonal, turned with the lander's own yaw. The rover is
 * 2.7 m long and 1.9 m wide, so 1.25 m from its centre covers it. The walker
 * and the rover are given radii of their own, so a body stops at arm's length
 * from a hull rather than with its eyes inside it. Before this, a walker could
 * stroll straight through the lander's legs and stand inside its engine.
 */
export const SOLID = { landerBody: 2.5, footpad: 0.6, footpadAt: 3.2, rover: 1.25, walker: 0.3, roverSelf: 1.3 }

/** Push (p.x, p.z) out of one circle, and cancel the velocity carrying it in. */
function pushOut(p, cx, cz, radius) {
  const dx = p.x - cx, dz = p.z - cz, d = Math.hypot(dx, dz)
  if (d >= radius) return false
  const nx = d > 1e-9 ? dx / d : 1, nz = d > 1e-9 ? dz / d : 0
  p.x = cx + nx * radius; p.z = cz + nz * radius
  const inward = p.vx * nx + p.vz * nz
  if (inward < 0) { p.vx -= inward * nx; p.vz -= inward * nz }
  return true
}

/** Keep a body (walker or rover) out of the landed vehicle, and the walker out of the rover. */
function collide(s, p, selfRadius, includeRover) {
  if (!s.landed) return
  // The stage's circle and the footpads' overlap, so pushing out of one can
  // push into another; a few passes settle it (measured: one pass left the
  // rover 3.79 m from a 3.8 m boundary).
  for (let pass = 0; pass < 4; pass++) collideOnce(s, p, selfRadius, includeRover)
}
function collideOnce(s, p, selfRadius, includeRover) {
  pushOut(p, s.x, s.z, SOLID.landerBody + selfRadius)
  const c = Math.cos(s.yaw), sn = Math.sin(s.yaw)
  for (const lx of [-SOLID.footpadAt, SOLID.footpadAt]) for (const lz of [-SOLID.footpadAt, SOLID.footpadAt]) {
    pushOut(p, s.x + lx * c + lz * sn, s.z - lx * sn + lz * c, SOLID.footpad + selfRadius)
  }
  if (includeRover && s.rover) pushOut(p, s.rover.x, s.rover.z, SOLID.rover + selfRadius)
}

/**
 * Where the player should go next, as one rule the arrow and the beacon share.
 *
 * Writes the target's x, z into `out` and returns what it is: 'pad' during the
 * descent, 'sample' and 'instrument' with their index in `TARGET.index`,
 * 'rover' when the instruments are next and the player is on foot (they are
 * too far to walk to, which is the rover's reason to exist), 'lander' when
 * everything is aboard or the rover still has to be unloaded, and null when
 * there is nowhere to go. Allocation-free, so the scene can ask every frame.
 */
export const TARGET = { kind: null, index: -1 }
function aim(out, kind, x, z, index = -1) { out[0] = x; out[1] = z; TARGET.kind = kind; TARGET.index = index; return kind }
export function nextTarget(s, out) {
  TARGET.index = -1
  if (s.mode === 'crashed') return aim(out, null, 0, 0)
  if (s.mode === 'flight') return s.landed ? aim(out, null, s.x, s.z) : aim(out, 'pad', 0, 0)
  const p = s.mode === 'rover' ? s.rover : s.walker
  const sites = sitesFor(s.id), instruments = instrumentsFor(s.id)
  const samplesLeft = s.samples.length < SITES.length
  const instrumentsLeft = s.instruments.length < INSTRUMENTS.length
  if (s.mode === 'eva' && samplesLeft || s.mode === 'rover' && samplesLeft && !instrumentsLeft) {
    let best = -1, bestD = Infinity
    for (let i = 0; i < SITES.length; i++) {
      if (s.samples.includes(i)) continue
      const d = Math.hypot(p.x - sites[i].x, p.z - sites[i].z)
      if (d < bestD) { bestD = d; best = i }
    }
    return aim(out, 'sample', sites[best].x, sites[best].z, best)
  }
  if (instrumentsLeft) {
    if (s.mode === 'eva') return s.rover ? aim(out, 'rover', s.rover.x, s.rover.z) : aim(out, 'lander', s.x, s.z)
    let best = -1, bestD = Infinity
    for (let i = 0; i < INSTRUMENTS.length; i++) {
      if (s.instruments.includes(i)) continue
      const d = Math.hypot(p.x - instruments[i].x, p.z - instruments[i].z)
      if (d < bestD) { bestD = d; best = i }
    }
    return aim(out, 'instrument', instruments[best].x, instruments[best].z, best)
  }
  return aim(out, 'lander', s.x, s.z)
}

/** Lower the rover onto the surface beside the lander. It does not drive itself. */
export function deployRover(s) {
  if (s.mode !== 'flight' || !s.landed || s.rover) return false
  /*
   * Parked clear of the lander's own boarding radius, on purpose. Dropped any
   * nearer, stepping out of the vehicle put the crew straight back aboard the
   * lander instead of standing beside the rover, because the lander claims a
   * larger share of a shorter walk. Twelve metres out leaves a stretch of open
   * ground between the two, so E does what the player is looking at.
   */
  const x = s.x + 11, z = s.z + 5
  s.rover = { x, y: terrainFor(s.id).height(x, z) + ROVER.clearance, z, vx: 0, vz: 0, yaw: Math.atan2(-x, -z), speed: 0, battery: 1, odometer: 0 }
  s.message = 'Rover unloaded. Walk up to it and press E to drive.'
  return true
}
export function interact(s) {
  if (s.mode === 'crashed') return false
  if (s.mode === 'flight' && s.landed) {
    const x = s.x + 7, z = s.z
    Object.assign(s.walker, { x, z, y: terrainFor(s.id).height(x, z), vx: 0, vy: 0, vz: 0, yaw: 0, pitch: 0, ground: true })
    s.mode = 'eva'; s.message = 'You are outside. Follow the beacon to the first sample.'; return true
  }
  if (s.mode === 'eva') {
    const sample = nearestSample(s)
    if (sample && sample.distance <= 5 && s.walker.ground) {
      s.samples.push(sample.index); s.message = `${CAMPAIGN.find((c) => c.id === s.id).samples[sample.index]} collected.`; return true
    }
    /*
     * Two things can be boarded, and the rover parks well inside the lander's
     * own boarding radius. Asking the lander first made the vehicle unreachable
     * whenever the rover was down; asking the rover first stranded the crew
     * beside their own lander. Comparing raw distances did not settle it
     * either, because standing at the rover is nearer the rover by definition.
     *
     * So the comparison is the distance as a fraction of each one's own reach.
     * A 7 m walk from a lander that claims you at 11 m is two thirds of the
     * way in; 2 m from a rover that claims you at 4.5 is not even halfway. The
     * larger structure therefore wins from anywhere that is genuinely inside
     * it, and the vehicle wins from right beside it, which is how a person
     * reads the two objects in front of them.
     */
    const toLander = Math.hypot(s.walker.x - s.x, s.walker.z - s.z)
    const toRover = roverDistance(s)
    const landerShare = toLander / 11
    const roverShare = toRover / 4.5
    if (s.rover && s.walker.ground && toRover < 4.5 && roverShare < landerShare) {
      s.mode = 'rover'; s.message = 'Driving. W/S to go, A/D to steer, E to get out.'; return true
    }
    if (s.walker.ground && toLander < 11) {
      s.mode = 'flight'
      const complete = s.samples.length === SITES.length && s.instruments.length === INSTRUMENTS.length
      if (complete) { s.delivered = true; s.message = 'Survey complete. Press T when you are ready to take off.' }
      else s.message = `Back aboard. Still needed: ${SITES.length - s.samples.length} sample(s) and ${INSTRUMENTS.length - s.instruments.length} instrument(s).`
      return true
    }
  }
  if (s.mode === 'rover') {
    const site = nearestInstrument(s)
    if (site && site.distance <= 6) {
      s.instruments.push(site.index)
      s.message = `${INSTRUMENTS[site.index].name} set up and recording.`
      return true
    }
    if (Math.hypot(s.rover.x - s.x, s.rover.z - s.z) < 13) {
      Object.assign(s.walker, { x: s.rover.x, z: s.rover.z, vx: 0, vy: 0, vz: 0, yaw: s.rover.yaw, pitch: 0, ground: true })
      s.walker.y = terrainFor(s.id).height(s.walker.x, s.walker.z)
      s.rover.vx = 0; s.rover.vz = 0; s.rover.speed = 0
      s.mode = 'eva'; s.message = 'Out of the rover.'; return true
    }
  }
  return false
}
export function launch(s) {
  if (!s.landed || s.mode !== 'flight' || s.fuel <= 0) return false
  s.landed = false; s.assist = false; s.throttle = 0.7; s.vy = 0.5; s.y += 0.2; s.message = 'Lifting off. You have the controls: R/F for thrust, WASD to tilt.'; return true
}

/** Fixed-step SI dynamics. Assist requests thrust; it never writes position or touchdown. */
export function stepExpedition(s, keys, dt = FIXED_STEP) {
  if (!(dt > 0 && dt <= 1 / 30)) throw new Error('Expedition step outside fixed-step budget')
  if (s.mode === 'crashed') return
  const region = REGIONS[s.id], terrain = terrainFor(s.id)
  s.time += dt; s.steps++
  if (s.mode === 'eva') {
    /*
     * On foot, by the simulator's own walking physics.
     *
     * This used to move the walker at a fixed 2.8 m/s (5.2 with Shift) and
     * jump at 2.5 m/s on every world, while the simulator's walk mode derives
     * the same things from a human body and the local gravity. On the Moon
     * the two disagreed by more than a factor of two: a walking gait vaults
     * over a straight leg and stays on the ground only while v^2/L < g, so the
     * fastest walk there is sqrt(g L) = 1.21 m/s, which is why the Apollo
     * crews hopped. Both modes now step `sim/walk.js`, so there is one answer.
     *
     * What that brings with it: speed is capped by the gait limit, the feet
     * accelerate only as hard as friction allows (a sixth of the grip on the
     * Moon), there is no steering in the air, and a jump leaves the ground at
     * the 2.80 m/s a standing jump gives a person on Earth. There is no run:
     * nothing in the walk model supports one faster than the gait limit, and a
     * Shift key that went faster would be the old contradiction back.
     */
    const w = s.walker
    const f = (keys.forward ? 1 : 0) - (keys.back ? 1 : 0), side = (keys.right ? 1 : 0) - (keys.left ? 1 : 0)
    const wantX = Math.sin(w.yaw) * f + Math.cos(w.yaw) * side
    const wantZ = -Math.cos(w.yaw) * f + Math.sin(w.yaw) * side
    const jump = Boolean(keys.jump) && w.ground
    if (jump) keys.jump = false
    // The walk model's axes are east and north; here they are x and z. It is
    // symmetric in the two, so the mapping is direct.
    _foot.east = w.vx; _foot.north = w.vz; _foot.up = w.vy; _foot.height = w.y; _foot.onGround = w.ground
    stepWalk(_foot, dt, region.gravity, wantX, wantZ, jump, -Infinity)
    const nx = w.x + _foot.east * dt, nz = w.z + _foot.north * dt
    let moved = false
    if (Math.hypot(nx, nz) < REGION_LIMIT) {
      const next = terrain.height(nx, nz)
      // A ledge higher than 0.45 m stops the feet, as it did before.
      if (next - _foot.height < 0.45) { w.x = nx; w.z = nz; moved = true }
    }
    // Walking into a ledge or the sector edge ends the stride; momentum does
    // not carry through a wall.
    w.vx = moved ? _foot.east : 0
    w.vz = moved ? _foot.north : 0
    // Solid hardware. A lunar jump clears the rover (2.4 m against its 1.8),
    // so the rover only stops a walker who is near the ground; the lander is
    // six metres tall and stops everyone.
    collide(s, w, SOLID.walker, w.y - terrain.height(w.x, w.z) < 1.5)
    w.vy = _foot.up; w.y = _foot.height
    const floor = terrain.height(w.x, w.z)
    /*
     * Walking downhill keeps the feet on the ground.
     *
     * Without this, every step down a slope left the walker a few millimetres
     * above the new floor, which counts as airborne, and airborne feet cannot
     * push. Measured on Europa's ridged plain the walker stalled at 0.77 m/s
     * of its 1.09 limit, skipping down the slope one fixed step at a time. A
     * walker that was on the ground and did not jump stays on it across a
     * drop of up to 0.45 m, the same height the feet can step *up*; anything
     * deeper is a ledge, and the walker goes over it ballistically.
     */
    const stick = w.ground && !jump && w.y - floor < 0.45
    if (w.y <= floor || stick) { w.y = floor; if (w.vy < 0) w.vy = 0; w.ground = true } else w.ground = false
    return
  }
  if (s.mode === 'rover') {
    const r = s.rover
    // Drive is a force, not a speed. Thrust against the vehicle's mass decides
    // the acceleration, and the terrain's own gradient decides how much of it
    // the slope steals: drive/mass is 2.48 m/s², so a gradient g resists with
    // g * gravity * grip, and the two worlds stall at different angles for no
    // reason other than that one pulls harder.
    const throttle = (keys.forward ? 1 : 0) - (keys.back ? 1 : 0)
    const steer = (keys.left ? 1 : 0) - (keys.right ? 1 : 0)
    const drive = throttle * ROVER.drive / ROVER.mass
    r.yaw += steer * dt * 1.5 * Math.min(1, 0.25 + Math.abs(r.speed) / ROVER.maxSpeed)
    const slopeX = (terrain.height(r.x + 1, r.z) - terrain.height(r.x - 1, r.z)) / 2
    const slopeZ = (terrain.height(r.x, r.z + 1) - terrain.height(r.x, r.z - 1)) / 2
    const fx = Math.sin(r.yaw) * drive - slopeX * region.gravity * ROVER.grip
    const fz = -Math.cos(r.yaw) * drive - slopeZ * region.gravity * ROVER.grip
    r.vx += fx * dt; r.vz += fz * dt
    // Rolling resistance and the battery's limit, applied to the ground track.
    const speed = Math.hypot(r.vx, r.vz)
    if (speed > ROVER.maxSpeed) { r.vx *= ROVER.maxSpeed / speed; r.vz *= ROVER.maxSpeed / speed }
    const roll = Math.max(0, 1 - dt * (r.battery > 0 ? 0.55 : 3.4))
    r.vx *= roll; r.vz *= roll
    const nx = r.x + r.vx * dt, nz = r.z + r.vz * dt
    if (Math.hypot(nx, nz) < REGION_LIMIT) {
      const step = terrain.height(nx, nz) - terrain.height(r.x, r.z)
      if (step < 1.1) { r.x = nx; r.z = nz; r.odometer += Math.hypot(r.vx, r.vz) * dt }
      else { r.vx *= 0.2; r.vz *= 0.2 }
    }
    collide(s, r, SOLID.roverSelf, false)
    r.speed = Math.hypot(r.vx, r.vz)
    r.battery = Math.max(0, r.battery - ROVER.drain * (0.4 + r.speed / ROVER.maxSpeed))
    r.y = terrain.height(r.x, r.z) + ROVER.clearance
    return
  }
  if (s.landed) { s.throttle = 0; return }
  const mass = VEHICLE.dryMass + s.fuel, maxA = VEHICLE.thrust / mass
  let ax, az, up
  if (s.assist) {
    const h = altitude(s)
    const wantV = -Math.min(11, Math.max(0.7, h * 0.17))
    ax = clamp(-s.x * 0.035 - s.vx * 0.7, -1.5, 1.5)
    az = clamp(-s.z * 0.08 - s.vz * 0.9, -2.5, 2.5)
    up = Math.max(0, region.gravity + clamp((wantV - s.vy) * 1.2, -3, 4))
    const need = Math.hypot(ax, up, az)
    s.throttle = clamp(need / maxA, 0, 1)
    const factor = need > maxA ? maxA / need : 1
    ax *= factor; az *= factor; up *= factor
    s.pitch = Math.atan2(az, Math.max(up, 0.01)); s.roll = -Math.atan2(ax, Math.max(up, 0.01))
  } else {
    s.throttle = clamp(s.throttle + ((keys.throttleUp ? 1 : 0) - (keys.throttleDown ? 1 : 0)) * dt * 0.42, 0, 1)
    const targetPitch = ((keys.back ? 1 : 0) - (keys.forward ? 1 : 0)) * 0.35
    const targetRoll = ((keys.left ? 1 : 0) - (keys.right ? 1 : 0)) * 0.35
    s.pitch += (targetPitch - s.pitch) * Math.min(1, dt * 3)
    s.roll += (targetRoll - s.roll) * Math.min(1, dt * 3)
    s.yaw += ((keys.turnLeft ? 1 : 0) - (keys.turnRight ? 1 : 0)) * dt * 0.6
    const a = s.throttle * maxA
    const bodyX = -Math.sin(s.roll) * a, bodyZ = Math.cos(s.roll) * Math.sin(s.pitch) * a
    ax = bodyX * Math.cos(s.yaw) + bodyZ * Math.sin(s.yaw)
    az = -bodyX * Math.sin(s.yaw) + bodyZ * Math.cos(s.yaw)
    up = Math.cos(s.pitch) * Math.cos(s.roll) * a
  }
  if (s.fuel <= 0) { ax = 0; az = 0; up = 0; s.throttle = 0 }
  // Density falls with Mars's scale height. No drag in a vacuum.
  const rho = region.atmosphere * Math.exp(-altitude(s) / 11100)
  const drag = 0.5 * rho * 12 * Math.hypot(s.vx, s.vy, s.vz) / mass
  const burn = s.throttle * VEHICLE.thrust / (VEHICLE.isp * G0) * dt
  const fuelFactor = burn > 0 ? Math.min(1, s.fuel / burn) : 1
  s.vx += (ax * fuelFactor - drag * s.vx) * dt
  s.vz += (az * fuelFactor - drag * s.vz) * dt
  const g = region.gravity * (region.radius / (region.radius + Math.max(0, s.y))) ** 2
  s.vy += (up * fuelFactor - g - drag * s.vy) * dt
  s.fuel = Math.max(0, s.fuel - burn)
  s.x += s.vx * dt; s.y += s.vy * dt; s.z += s.vz * dt
  const floor = terrain.height(s.x, s.z) + VEHICLE.clearance
  if (s.y <= floor) {
    s.touchdown = { vertical: Math.abs(s.vy), horizontal: Math.hypot(s.vx, s.vz), slope: terrain.slope(s.x, s.z), fuel: s.fuel }
    const safe = s.touchdown.vertical <= VEHICLE.safeVertical && s.touchdown.horizontal <= VEHICLE.safeHorizontal && s.touchdown.slope < VEHICLE.safeSlope
    s.y = floor; s.vx = 0; s.vy = 0; s.vz = 0; s.throttle = 0
    if (safe) { s.landed = true; s.message = 'Landed. Press E to step outside, or G to unload the rover.' }
    else { s.mode = 'crashed'; s.message = 'You hit the ground too fast. Slow down more before touching down.' }
  }
  if (Math.hypot(s.x, s.z) > REGION_LIMIT || s.y > 6000) { s.mode = 'crashed'; s.message = 'You flew out of the survey area. Retry to start the approach again.' }
}

const SAVE_KEY = 'pz-expeditions-v1'
export function validateRecord(value) {
  const out = { version: 1, surveys: {} }
  if (value?.version !== 1 || !value.surveys || typeof value.surveys !== 'object') return out
  for (const id of Object.keys(REGIONS)) {
    const v = value.surveys[id]
    if (v && typeof v.completed === 'string' && Number.isFinite(Date.parse(v.completed)) && Number.isFinite(v.fuel) && v.fuel >= 0 && v.fuel <= VEHICLE.fuel && typeof v.campaign === 'boolean') out.surveys[id] = { completed: v.completed, fuel: v.fuel, campaign: v.campaign }
  }
  return out
}
let record
try { record = validateRecord(JSON.parse(globalThis.localStorage?.getItem(SAVE_KEY) ?? 'null')) } catch { record = validateRecord(null) }
const listeners = new Set()
export const expeditionRecord = () => record
export const subscribeExpeditions = (fn) => { listeners.add(fn); return () => listeners.delete(fn) }
export const chapterUnlocked = (id, r = record) => { const i = CAMPAIGN.findIndex((c) => c.id === id); return i >= 0 && (i === 0 || Boolean(r.surveys[CAMPAIGN[i - 1].id]?.campaign)) }
export function recordSurvey(s) {
  if (!REGIONS[s.id] || !s.delivered || s.mode !== 'flight' || new Set(s.samples).size !== SITES.length || !SITES.every((_, i) => s.samples.includes(i)) || new Set(s.instruments).size !== INSTRUMENTS.length || !INSTRUMENTS.every((_, i) => s.instruments.includes(i)) || !s.landed) return false
  if (s.campaign && !chapterUnlocked(s.id)) return false
  const prior = record.surveys[s.id]
  record = { version: 1, surveys: { ...record.surveys, [s.id]: { completed: new Date().toISOString(), fuel: s.fuel, campaign: Boolean(prior?.campaign || s.campaign) } } }
  try { globalThis.localStorage?.setItem(SAVE_KEY, JSON.stringify(record)) } catch { /* Progress still holds in memory. */ }
  listeners.forEach((fn) => fn()); return true
}
