import { BODIES, G, G0 } from './constants.js'
import { RAILS } from './rails.js'
import { makeNoise } from '../gfx/noise.js'

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
  { id: 'moon', number: '01', title: 'A place to stand', role: 'Flight director', contact: 'Mara Voss', brief: 'The orbital images show two layers at the rim. We need to know whether the dark rock belongs to the impact or the plain underneath. Put the lander down, take both samples, and bring them back.', stakes: 'This is the proving flight for a small survey crew. No rescue vehicle is stationed here. Keep the descent slow enough to leave again.', debrief: 'Two different rocks, one old surface. The dark fragment is basalt; the pale breccia records the impact. Your samples give the next crew somewhere worth investigating.', samples: ['Rim breccia', 'Basalt fragment'] },
  { id: 'mars', number: '02', title: 'The layers below', role: 'Field geologist', contact: 'Elias Chen', brief: 'The canyon walls preserve a sequence that orbit cannot resolve. Survey the exposed lower bed and the dust-covered outcrop. The question is not whether Mars had water; it is what happened here, in this basin.', stakes: 'Mars gives you more gravity and less margin. The atmosphere is too thin to hold this vehicle up. Save propellant for the return to flight.', debrief: 'The lower bed and the upper outcrop do not share a composition. The basin changed before the dust arrived. We have a sequence, not an answer yet. That is enough to plan the next traverse.', samples: ['Lower-bed sediment', 'Oxidized outcrop'] },
  { id: 'europa', number: '03', title: 'Under the ice', role: 'Mission scientist', contact: 'Mara Voss', brief: 'The brown material follows a young fracture. Compare it with the clean ice beside the ridge. Do not drill or claim an ocean sample; we are collecting what reached the surface.', stakes: 'Jupiter dominates the sky, but the ice under your boots is the useful evidence. Bring the paired samples home to the vehicle.', debrief: 'The fracture material differs from the nearby ice. That makes this a candidate for a later instrument package, not proof of life. Your survey has given the team a defensible next step.', samples: ['Fracture deposit', 'Clean surface ice'] },
]
export const SITES = [{ x: -28, z: -42 }, { x: 36, z: -64 }]
export const VEHICLE = { dryMass: 3600, fuel: 1500, thrust: 32000, isp: 310, clearance: 2.65, safeVertical: 3, safeHorizontal: 2.5, safeSlope: 0.28 }
export const FIXED_STEP = 1 / 120
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
  return { id, campaign, mode: 'flight', x: 0, y: 180 + VEHICLE.clearance, z: 180, vx: 0, vy: -6, vz: -4, yaw: 0, pitch: 0, roll: 0, throttle: 0, fuel: VEHICLE.fuel, assist: true, landed: false, samples: [], delivered: false, message: 'Landing assist engaged. It uses your engines and propellant.', time: 0, touchdown: null, walker: { x: 0, y: 0, z: 0, vy: 0, yaw: 0, pitch: 0, ground: true }, steps: 0 }
}
export function altitude(s) { return Math.max(0, s.y - terrainFor(s.id).height(s.x, s.z) - VEHICLE.clearance) }
export function nearestSample(s) {
  if (s.mode !== 'eva') return null
  let hit = null, distance = Infinity
  SITES.forEach((p, i) => { const d = Math.hypot(s.walker.x - p.x, s.walker.z - p.z); if (!s.samples.includes(i) && d < distance) { hit = i; distance = d } })
  return hit === null ? null : { index: hit, distance }
}
export function interact(s) {
  if (s.mode === 'crashed') return false
  if (s.mode === 'flight' && s.landed) {
    Object.assign(s.walker, { x: s.x + 7, z: s.z, y: terrainFor(s.id).height(s.x + 7, s.z), vy: 0, yaw: 0, pitch: 0, ground: true })
    s.mode = 'eva'; s.message = 'On the surface. Follow the survey bearings.'; return true
  }
  if (s.mode === 'eva') {
    const sample = nearestSample(s)
    if (sample && sample.distance <= 5 && s.walker.ground) {
      s.samples.push(sample.index); s.message = `${CAMPAIGN.find((c) => c.id === s.id).samples[sample.index]} secured. Return both samples to the lander.`; return true
    }
    if (s.walker.ground && Math.hypot(s.walker.x - s.x, s.walker.z - s.z) < 11) {
      s.mode = 'flight'
      if (s.samples.length === SITES.length) { s.delivered = true; s.message = 'Survey complete. Samples transferred to the lander.' }
      else s.message = 'Back aboard. The survey needs both samples.'
      return true
    }
  }
  return false
}
export function launch(s) {
  if (!s.landed || s.mode !== 'flight' || s.fuel <= 0) return false
  s.landed = false; s.assist = false; s.throttle = 0.7; s.vy = 0.5; s.y += 0.2; s.message = 'Ascent. Landing assist disengaged; you have the controls.'; return true
}

/** Fixed-step SI dynamics. Assist requests thrust; it never writes position or touchdown. */
export function stepExpedition(s, keys, dt = FIXED_STEP) {
  if (!(dt > 0 && dt <= 1 / 30)) throw new Error('Expedition step outside fixed-step budget')
  if (s.mode === 'crashed') return
  const region = REGIONS[s.id], terrain = terrainFor(s.id)
  s.time += dt; s.steps++
  if (s.mode === 'eva') {
    const w = s.walker
    const f = (keys.forward ? 1 : 0) - (keys.back ? 1 : 0), side = (keys.right ? 1 : 0) - (keys.left ? 1 : 0)
    const length = Math.max(1, Math.hypot(f, side)), speed = keys.sprint ? 5.2 : 2.8
    const dx = (Math.sin(w.yaw) * f + Math.cos(w.yaw) * side) * speed * dt / length
    const dz = (-Math.cos(w.yaw) * f + Math.sin(w.yaw) * side) * speed * dt / length
    if (Math.hypot(w.x + dx, w.z + dz) < REGION_LIMIT) {
      const next = terrain.height(w.x + dx, w.z + dz)
      if (next - w.y < 0.45) { w.x += dx; w.z += dz }
    }
    if (keys.jump && w.ground) { w.vy = 2.5; w.ground = false; keys.jump = false }
    w.vy -= region.gravity * dt; w.y += w.vy * dt
    const floor = terrain.height(w.x, w.z)
    if (w.y <= floor) { w.y = floor; w.vy = 0; w.ground = true }
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
    if (safe) { s.landed = true; s.message = 'Contact. Engines safe. Press E to leave the lander.' }
    else { s.mode = 'crashed'; s.message = 'Hard landing. Reduce vertical and horizontal speed before contact.' }
  }
  if (Math.hypot(s.x, s.z) > REGION_LIMIT || s.y > 6000) { s.mode = 'crashed'; s.message = 'Outside the survey sector. Retry to return to the approach.' }
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
  if (!REGIONS[s.id] || !s.delivered || s.mode !== 'flight' || new Set(s.samples).size !== SITES.length || !SITES.every((_, i) => s.samples.includes(i)) || !s.landed) return false
  if (s.campaign && !chapterUnlocked(s.id)) return false
  const prior = record.surveys[s.id]
  record = { version: 1, surveys: { ...record.surveys, [s.id]: { completed: new Date().toISOString(), fuel: s.fuel, campaign: Boolean(prior?.campaign || s.campaign) } } }
  try { globalThis.localStorage?.setItem(SAVE_KEY, JSON.stringify(record)) } catch { /* Progress still holds in memory. */ }
  listeners.forEach((fn) => fn()); return true
}
