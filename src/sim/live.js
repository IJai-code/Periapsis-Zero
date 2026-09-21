import { Vector3 } from 'three'
import { createSimulation, INDEX, readPosition, simDate } from './system.js'
import { BODIES, CRAFT, ORDER, BODY_ORDER, TEST_PARTICLES, AU } from './constants.js'
import {
  activeStage,
  computeElements,
  computeLunarElements,
  elements,
  lunarElements,
  MU_MOON,
  resetShip,
  timestepLimit,
} from './ship.js'
import { computeLagrange } from './lagrange.js'
import { soiRadius } from './soi.js'
import { RAIL_IDS, RAIL_INDEX, railHelio } from './rails.js'
import { GAMMA_AIR, density, radiativeFlux, speedOfSound } from './atmosphere.js'

/** Sutton-Graves constant in SI, and the capsule's heat-shield curvature. */
const SUTTON_GRAVES = 1.7415e-4
/**
 * Orion's real heat-shield radius of curvature, m.
 *
 * The capsule's *aerodynamic* area is scaled to hold the true ballistic
 * coefficient rather than the true diameter (see constants.js), so its
 * trajectory through the atmosphere is Orion's. The nose radius is quoted as
 * Orion's too, so the flux this reports can be compared with published figures
 * for the vehicle whose trajectory it is being evaluated on.
 */
const NOSE_RADIUS = 6.03
import { BODIES as B } from './constants.js'

/**
 * The live simulation, and the derived values every frame needs.
 *
 * Deliberately a mutable singleton rather than React state: these fields change
 * 60 times a second and nothing that reads them should ever trigger a re-render.
 * The HUD samples this on a timer instead.
 */
export const live = {
  sim: createSimulation(),

  /**
   * Absolute display-space positions, in scene units — the old, un-rebased
   * frame. Kept because anything reasoning about the system as a whole (the
   * Lagrange solver, and eventually world-space scattering) wants coordinates
   * that do not shift under the camera.
   */
  abs: Object.fromEntries(BODY_ORDER.map((id) => [id, new Vector3()])),

  /**
   * Rendered positions: absolute minus `origin`. This is what every component
   * binds to, so the whole scene graph is rebased by one subtraction.
   */
  pos: Object.fromEntries(BODY_ORDER.map((id) => [id, new Vector3()])),

  /**
   * Floating origin, in absolute scene units.
   *
   * Pinned to whatever the camera is looking at, so the focused body sits at
   * exactly (0,0,0) and everything nearby has a small magnitude. three already
   * computes modelViewMatrix on the CPU in float64, so this is not about mesh
   * jitter — it is about world-space maths done *inside* shaders, where
   * `cameraPosition` at Earth's 118 units quantises in steps of 42 m. Rebased
   * onto the focus body that becomes about 41 mm.
   */
  origin: new Vector3(),

  /** How far the origin moved this frame. The camera must be shifted to match. */
  originDelta: new Vector3(),

  /**
   * Distance from the camera to the nearest drawn surface, and what that
   * surface belongs to. Metres, negative inside a body.
   *
   * This is what a movement speed should be set from at true scale, where a
   * single constant cannot serve a hull two metres away and a star at an AU.
   */
  nearest: { distance: Infinity, id: null },

  /**
   * Where the rail planets are drawn, rebased onto the floating origin.
   *
   * Filled from the same buffer the integrator pulls with, so what is on screen
   * and what the craft feels are the same seven positions. They move on the
   * integrator's refresh cadence rather than every frame — an hour of Mercury
   * is four hundredths of a degree, which at any zoom that fits its orbit on
   * screen is a fraction of a pixel.
   */
  railPos: Object.fromEntries(RAIL_IDS.map((id) => [id, new Vector3()])),

  /** Free-flight camera speed, m/s. Written by the rig, read by the HUD. */
  flySpeed: 0,
  /** Whether free flight currently holds the pointer. Read by the HUD. */
  flyLocked: false,

  /** Live osculating elements of the craft. Same object, refreshed in place. */
  elements,

  /**
   * The same elements taken about the Moon. Meaningless outside the lunar
   * sphere of influence, where Earth is the dominant attractor and the
   * osculating selenocentric conic is a fiction — `insideLunarSOI` says when to
   * believe it.
   */
  lunar: lunarElements,

  /** Selenocentric range, m, and the sphere-of-influence radius it is judged against. */
  lunarRange: Infinity,
  lunarSOI: 0,
  insideLunarSOI: false,

  /**
   * Integrator step ceiling for this frame, self-tuned from the craft's local
   * circular period. See ship.js — a low orbit needs a far tighter step than
   * the planets do.
   */
  maxDt: 900,

  /** Unit vector from Earth toward the Sun, world space. Drives night + atmosphere. */
  sunDir: new Vector3(1, 0, 0),

  /** Real, unscaled separations in metres — what the HUD reports. */
  metric: {
    sunEarth: 0,
    earthMoon: 0,
    earthSpeed: 0,
    moonSpeed: 0,
  },

  eclipse: null, // null | 'solar' | 'lunar'
  date: simDate(createSimulation()),
  stepsLastFrame: 0,
  /** Simulated seconds advanced last frame. Trails use it to judge resolution. */
  simDtLastFrame: 0,
  /** Dynamic pressure on the ship, Pa, and the peak seen so far. */
  dynamicPressure: 0,
  maxQ: 0,
  /** Mach number against the co-rotating air. Gates parachute deployment. */
  mach: 0,
  /** Ambient static pressure at the ship, Pa. What an exhaust plume expands into. */
  ambientPressure: 0,
  /** Unit vector the relative wind blows *from*, scene frame. The windward side. */
  windDir: new Vector3(0, 0, 1),
  /** Aerodynamic deceleration, in g. The load the vehicle actually feels. */
  decelG: 0,
  /**
   * Stagnation-point convective heat flux, W/m^2, by the Sutton-Graves
   * correlation:  q = k sqrt(rho / Rn) v^3,  k = 1.7415e-4 in SI.
   *
   * A reported diagnostic, not a driver — nothing in the integrator reads it.
   * It is here because the headline number of a lunar-return entry is how hard
   * it heats, and a re-entry that reports only deceleration is missing half of
   * what makes it hard.
   */
  heatFlux: 0,
  /**
   * Stagnation-point *radiative* flux, W/m^2 — Tauber-Sutton.
   *
   * The other half of entry heating, and at 11 km/s the larger half. Kept as its
   * own scalar rather than folded into `heatFlux`, because the two come from
   * different physics with different validity ranges and reporting a single
   * summed number would hide which one is being extrapolated.
   */
  radiativeFlux: 0,
  /** Convective plus radiative. What the shield actually has to survive. */
  totalFlux: 0,
  fps: 0,
}

/**
 * Bounding radius of everything drawn, in metres — bodies by their real radius,
 * craft by half their length.
 *
 * Built once at load so the per-frame loop is arithmetic on a flat table. The
 * ship is the exception: it sheds most of its length as it stages, so its entry
 * is read live. Getting that wrong matters, because this radius is the floor on
 * the free-flight camera's speed — a capsule sized as a 110 m stack would let
 * the camera barrel through it at 55 m/s.
 */
const SURFACE_RADIUS = Object.fromEntries(
  BODY_ORDER.map((id) => [id, BODIES[id]?.radius ?? CRAFT[id].visual / 2]),
)

const radiusOf = (id) =>
  id === 'ship' ? (activeStage()?.visual ?? CRAFT.ship.visual) / 2 : SURFACE_RADIUS[id]

const _rel = new Vector3()
const _axis = new Vector3()
const _perp = new Vector3()
const _newOrigin = new Vector3()

/**
 * @param {string|null} originBody  body to pin the origin to
 * @param {import('three').Vector3|null} originOffset  for free camera: the
 *   orbit target's offset from the current origin
 */
export function refreshDerived(originBody = null, originOffset = null) {
  const { sim, abs, pos } = live

  // Pass one: absolute scene positions — a straight read now that the scene
  // is in metres, with no display transform in between.
  for (const id of BODY_ORDER) readPosition(sim.state, INDEX[id], abs[id])

  // Pass two: choose the origin, record how far it moved, rebase everything.
  const railOrigin = originBody === null ? undefined : RAIL_INDEX[originBody]
  if (originBody && abs[originBody]) _newOrigin.copy(abs[originBody])
  else if (railOrigin !== undefined) {
    /*
     * A planet on rails can hold the origin too, and has to be able to. Without
     * it, locking onto Saturn leaves the origin back at Earth and the whole
     * scene 1.4e12 m from it — far enough that the depth buffer gives out and
     * the planet renders as nothing at all. Which is exactly what it did.
     */
    const o = railOrigin * 3
    _newOrigin.set(
      abs.sun.x + railHelio[o],
      abs.sun.y + railHelio[o + 1],
      abs.sun.z + railHelio[o + 2],
    )
  } else if (originOffset) _newOrigin.copy(live.origin).add(originOffset)
  else _newOrigin.copy(live.origin)

  live.originDelta.subVectors(_newOrigin, live.origin)
  live.origin.copy(_newOrigin)

  for (const id of BODY_ORDER) pos[id].subVectors(abs[id], live.origin)

  /**
   * And the seven that are not in the state vector: heliocentric offsets from
   * the table, added to where the integrator says the Sun is, then rebased with
   * everything else. Written in place, so this costs three subtractions a body.
   */
  for (let k = 0; k < RAIL_IDS.length; k++) {
    const o = k * 3
    live.railPos[RAIL_IDS[k]].set(
      abs.sun.x + railHelio[o] - live.origin.x,
      abs.sun.y + railHelio[o + 1] - live.origin.y,
      abs.sun.z + railHelio[o + 2] - live.origin.z,
    )
  }

  live.sunDir.copy(pos.sun).sub(pos.earth).normalize()

  const s = sim.state
  const e = INDEX.earth * 6
  const u = INDEX.sun * 6
  const m = INDEX.moon * 6
  live.metric.sunEarth = Math.hypot(s[e] - s[u], s[e + 1] - s[u + 1], s[e + 2] - s[u + 2])
  live.metric.earthMoon = Math.hypot(s[m] - s[e], s[m + 1] - s[e + 1], s[m + 2] - s[e + 2])
  live.metric.earthSpeed = Math.hypot(s[e + 3], s[e + 4], s[e + 5])
  live.metric.moonSpeed = Math.hypot(s[m + 3] - s[e + 3], s[m + 4] - s[e + 4], s[m + 5] - s[e + 5])

  computeElements(sim.state, INDEX.ship * 6, INDEX.earth * 6)
  computeLunarElements(sim.state, INDEX.ship * 6, INDEX.moon * 6)

  // Sphere of influence, from the live separation rather than a constant: the
  // Moon's radius here is emergent and swings some 45,000 km over a month.
  // Defined once, in soi.js, because the projection and the flight computer
  // now ask the same question and must not get a different answer.
  live.lunarSOI = soiRadius(sim.state, 'moon')
  live.lunarRange = live.lunar.radius
  live.insideLunarSOI = live.lunarRange < live.lunarSOI

  // The step ceiling is set by the *fastest* craft in flight, not by the one we
  // happen to be flying — adding a lower satellite would otherwise silently
  // under-resolve it. "Fastest" means about *either* attractor: a craft in low
  // lunar orbit is 400,000 km from Earth, where the geocentric limit is the
  // 900 s planetary default and 7.9 steps per lunar revolution.
  const eo = INDEX.earth * 6
  const mo = INDEX.moon * 6
  let closest = Infinity
  let limit = 900
  for (const id of TEST_PARTICLES) {
    const o = INDEX[id] * 6
    const r = Math.hypot(
      sim.state[o] - sim.state[eo],
      sim.state[o + 1] - sim.state[eo + 1],
      sim.state[o + 2] - sim.state[eo + 2],
    )
    if (r < closest) closest = r
    const rm = Math.hypot(
      sim.state[o] - sim.state[mo],
      sim.state[o + 1] - sim.state[mo + 1],
      sim.state[o + 2] - sim.state[mo + 2],
    )
    const le = timestepLimit(r)
    const lm = timestepLimit(rm, MU_MOON)
    if (le < limit) limit = le
    if (lm < limit) limit = lm
  }
  // Orbital period sets the baseline step, but drag can be far stiffer than
  // gravity low down: a craft at 100 km sheds velocity in seconds, and a step
  // sized for a 92-minute orbit would integrate straight through the entry.
  // Take whichever limit is tighter.
  const rho = density(closest - B.earth.radius)
  if (rho > 0) {
    const o = INDEX.ship * 6
    const speed = Math.hypot(
      sim.state[o + 3] - sim.state[eo + 3],
      sim.state[o + 4] - sim.state[eo + 4],
      sim.state[o + 5] - sim.state[eo + 5],
    )
    let maxDragK = 0
    for (let i = 0; i < sim.dragK.length; i++) maxDragK = Math.max(maxDragK, sim.dragK[i])
    const accel = maxDragK * rho * speed * speed
    // Hold the velocity change per step under about 2 percent.
    if (accel > 0) limit = Math.min(limit, Math.max(0.02, (0.02 * speed) / accel))
  }
  live.maxDt = limit
  sim.maxDt = limit

  // Dynamic pressure, from the same relative wind the drag term uses — so on
  // the pad, where the clamp gives the vehicle exactly the local surface
  // velocity, q reads zero by construction.
  {
    const o = INDEX.ship * 6
    const rx = sim.state[o] - sim.state[eo]
    const ry = sim.state[o + 1] - sim.state[eo + 1]
    const rz = sim.state[o + 2] - sim.state[eo + 2]
    const w = sim.omega
    const vx = sim.state[o + 3] - sim.state[eo + 3] - (w[1] * rz - w[2] * ry)
    const vy = sim.state[o + 4] - sim.state[eo + 4] - (w[2] * rx - w[0] * rz)
    const vz = sim.state[o + 5] - sim.state[eo + 5] - (w[0] * ry - w[1] * rx)
    const alt = Math.hypot(rx, ry, rz) - B.earth.radius
    const rhoLocal = density(alt)
    const vRel2 = vx * vx + vy * vy + vz * vz
    live.dynamicPressure = 0.5 * rhoLocal * vRel2
    if (live.dynamicPressure > live.maxQ) live.maxQ = live.dynamicPressure

    // Everything below is the same relative wind, so a capsule's Mach, load and
    // heating all agree with the drag the integrator actually applied.
    const vRel = Math.sqrt(vRel2)
    const sound = speedOfSound(alt)
    live.mach = vRel / sound
    /*
     * Ambient *static* pressure, off the same density lookup the drag term just
     * used: p = rho a^2 / gamma. It lives here rather than being worked out in
     * the renderer because a plume is a function of it and there are up to five
     * engine bells asking — and because the obvious thing to reach for over
     * there, `dynamicPressure`, reads zero on the pad by construction. See
     * `gfx/plume.js`.
     */
    live.ambientPressure = rhoLocal > 0 ? (rhoLocal * sound * sound) / GAMMA_AIR : 0
    // a = dragK * rho * |v|^2, with dragK = Cd A / 2m — the integrator's own form.
    live.decelG = (sim.dragK[0] * rhoLocal * vRel2) / 9.80665
    /*
     * Which way the air is coming from, as a unit vector in scene coordinates.
     * The same relative wind everything else in this block is built on, so the
     * plasma sheath glows on the face the drag is actually acting on rather
     * than on the one that happens to point at the planet.
     */
    if (vRel > 0) live.windDir.set(-vx / vRel, -vy / vRel, -vz / vRel)
    live.heatFlux =
      rhoLocal > 0 ? SUTTON_GRAVES * Math.sqrt(rhoLocal / NOSE_RADIUS) * vRel * vRel * vRel : 0
    live.radiativeFlux = radiativeFlux(rhoLocal, vRel, NOSE_RADIUS)
    live.totalFlux = live.heatFlux + live.radiativeFlux
  }

  computeLagrange(sim.state, INDEX.earth * 6, INDEX.moon * 6, pos.earth)

  live.date = simDate(sim)
  live.eclipse = detectEclipse()
}

/**
 * Shadow geometry.
 *
 * Display space and SI are the same space now, so this is simply the real cone
 * geometry — it used to be evaluated against the exaggerated radii so that what
 * the HUD announced agreed with what the renderer drew, and with the
 * exaggeration gone the two agree by construction. Because the light is a point
 * source the umbra diverges with distance, so the shadow radius grows along the
 * axis.
 */
function detectEclipse() {
  const { sun, earth, moon } = live.pos
  const Re = B.earth.radius
  const Rm = B.moon.radius

  // Lunar: is the Moon inside the cone Earth casts away from the Sun?
  _axis.copy(earth).sub(sun)
  const sunEarth = _axis.length()
  _axis.divideScalar(sunEarth)
  _rel.copy(moon).sub(earth)
  const along = _rel.dot(_axis)
  if (along > 0) {
    _perp.copy(_rel).addScaledVector(_axis, -along)
    if (_perp.length() < Re * ((sunEarth + along) / sunEarth) + Rm) return 'lunar'
  }

  // Solar: does the Moon's shadow reach the Earth's disc?
  _axis.copy(moon).sub(sun)
  const sunMoon = _axis.length()
  _axis.divideScalar(sunMoon)
  _rel.copy(earth).sub(sun)
  const t = _rel.dot(_axis)
  if (t > sunMoon) {
    _perp.copy(_rel).addScaledVector(_axis, -t)
    if (_perp.length() < Re + Rm * (t / sunMoon)) return 'solar'
  }
  return null
}

/**
 * Distance from `point` to the nearest surface in the scene.
 *
 * Closed form, because the scene is spheres: for each one the surface distance
 * is |point - centre| - radius, and the nearest is the smallest. Six of those
 * is cheaper than a raycast and allocates nothing.
 *
 * Deliberately not a raycast. A ray measures distance *along a direction*, and
 * the case that matters most is the one it cannot see: flying parallel to a
 * surface a couple of hundred metres up, looking at the horizon, the forward
 * ray hits nothing and reports infinity — so a speed derived from it would put
 * the camera at interplanetary velocity just above the ground. Distance to a
 * centre minus a radius has no direction in it at all.
 *
 * Also deliberately not the focused body's radius: the nearest surface is
 * frequently not the thing the camera is locked to. Skimming the Moon while
 * focused on Earth would otherwise take its speed from Earth's 6,371 km.
 *
 * `point` must be in rendered coordinates — the same rebased frame as
 * `live.pos` — which is where the camera already lives.
 *
 * @param {import('three').Vector3} point
 * @returns {number} metres to the nearest surface; negative inside a body
 */
export function updateNearestSurface(point) {
  let best = Infinity
  let which = null
  for (const id of BODY_ORDER) {
    const p = live.pos[id]
    const d = Math.hypot(point.x - p.x, point.y - p.y, point.z - p.z) - radiusOf(id)
    if (d < best) {
      best = d
      which = id
    }
  }
  live.nearest.distance = best
  live.nearest.id = which
  return best
}

export function resetSimulation() {
  live.sim = createSimulation()
  resetShip()
  live.maxQ = 0
  refreshDerived()
}

export { INDEX, BODIES, AU }
refreshDerived()
