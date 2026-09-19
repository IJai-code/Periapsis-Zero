import {
  BODIES,
  ELEMENTS,
  ORDER,
  BODY_ORDER,
  MASSIVE_COUNT,
  SHIP,
  SATELLITES,
  TEST_PARTICLES,
  G,
  J2000_MS,
} from './constants.js'
import { RK4NBody } from './rk4.js'
import { OMEGA, dragCoefficient } from './atmosphere.js'
import { RAIL_COUNT, RAIL_MU, RAIL_REFRESH, railHelio, updateRails } from './rails.js'
import { EARTH_FIELD } from './prem.js'
import { activeSite, clampToSite } from './launchsite.js'

const DEG = Math.PI / 180

/**
 * Solve Kepler's equation M = E - e sin E for the eccentric anomaly, by
 * Newton-Raphson. Converges in a handful of iterations at these eccentricities.
 */
function eccentricAnomaly(M, e) {
  let E = e < 0.8 ? M : Math.PI
  for (let k = 0; k < 64; k++) {
    const d = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E))
    E -= d
    if (Math.abs(d) < 1e-14) break
  }
  return E
}

/**
 * Classical orbital elements -> Cartesian state, in the parent's inertial frame.
 * Returns ecliptic coordinates (z = north ecliptic pole), which get folded into
 * three.js's y-up frame by `eclipticToScene` below.
 */
function elementsToState(mu, el) {
  const e = el.e
  const a = el.a
  const i = el.i * DEG
  const O = el.lonAscNode * DEG
  const w = el.argPeri * DEG
  const M = el.meanAnomaly * DEG

  const E = eccentricAnomaly(M, e)
  const cosE = Math.cos(E)
  const sinE = Math.sin(E)
  const beta = Math.sqrt(1 - e * e)

  // Position and velocity in the perifocal frame (x toward periapsis).
  const r = a * (1 - e * cosE)
  const n = Math.sqrt(mu / (a * a * a)) // mean motion
  const px = a * (cosE - e)
  const py = a * beta * sinE
  const vx = (-a * a * n * sinE) / r
  const vy = (a * a * n * beta * cosE) / r

  // Perifocal -> ecliptic: Rz(-O) Rx(-i) Rz(-w)
  const cO = Math.cos(O)
  const sO = Math.sin(O)
  const ci = Math.cos(i)
  const si = Math.sin(i)
  const cw = Math.cos(w)
  const sw = Math.sin(w)

  const m11 = cO * cw - sO * sw * ci
  const m12 = -(cO * sw + sO * cw * ci)
  const m21 = sO * cw + cO * sw * ci
  const m22 = -(sO * sw - cO * cw * ci)
  const m31 = sw * si
  const m32 = cw * si

  return {
    pos: [m11 * px + m12 * py, m21 * px + m22 * py, m31 * px + m32 * py],
    vel: [m11 * vx + m12 * vy, m21 * vx + m22 * vy, m31 * vx + m32 * vy],
  }
}

/**
 * Ecliptic (z = north) -> three.js (y = up), preserving handedness so that
 * orbits still run counter-clockwise seen from the north ecliptic pole.
 */
function eclipticToScene([x, y, z]) {
  return [x, z, -y]
}

/**
 * Build the initial state vector for Sol / Terra / Luna at J2000.0.
 *
 * Constructed hierarchically, the way the elements are actually defined:
 * the Earth-Moon *barycentre* follows the heliocentric elements, and Earth and
 * Moon are then placed either side of it using the geocentric lunar elements.
 * Finally the whole system is shifted into its own barycentric rest frame so
 * the Sun wobbles about the origin instead of the origin drifting away.
 */
export function buildInitialState() {
  const sun = BODIES.sun
  const earth = BODIES.earth
  const moon = BODIES.moon
  const emMass = earth.mass + moon.mass

  const emb = elementsToState(G * (sun.mass + emMass), ELEMENTS.earth)
  const lunar = elementsToState(G * emMass, ELEMENTS.moon)

  const earthShare = -moon.mass / emMass // Earth sits opposite the Moon
  const moonShare = earth.mass / emMass

  const raw = {
    sun: { pos: [0, 0, 0], vel: [0, 0, 0] },
    earth: {
      pos: emb.pos.map((v, k) => v + earthShare * lunar.pos[k]),
      vel: emb.vel.map((v, k) => v + earthShare * lunar.vel[k]),
    },
    moon: {
      pos: emb.pos.map((v, k) => v + moonShare * lunar.pos[k]),
      vel: emb.vel.map((v, k) => v + moonShare * lunar.vel[k]),
    },
  }

  // Shift to the barycentric frame: total momentum zero, barycentre at origin.
  let totalMass = 0
  const cm = [0, 0, 0]
  const cv = [0, 0, 0]
  for (const id of ORDER) {
    const m = BODIES[id].mass
    totalMass += m
    for (let k = 0; k < 3; k++) {
      cm[k] += m * raw[id].pos[k]
      cv[k] += m * raw[id].vel[k]
    }
  }
  for (let k = 0; k < 3; k++) {
    cm[k] /= totalMass
    cv[k] /= totalMass
  }

  const state = new Float64Array(BODY_ORDER.length * 6)
  ORDER.forEach((id, index) => {
    const p = eclipticToScene(raw[id].pos.map((v, k) => v - cm[k]))
    const v = eclipticToScene(raw[id].vel.map((v, k) => v - cv[k]))
    state.set(p, index * 6)
    state.set(v, index * 6 + 3)
  })

  // The vehicle starts on the pad, not in orbit — Phase 5 flies the ascent.
  clampToSite(state, 0, activeSite(), ORDER.indexOf('earth') * 6, BODY_ORDER.indexOf('ship') * 6)
  for (const [id, spec] of Object.entries(SATELLITES)) placeCraft(state, id, spec.orbit)
  return state
}

/**
 * Put a craft in a circular orbit about Earth, in the already-shifted scene
 * frame. Written straight onto Earth's barycentric state, so the orbit is
 * geocentric while the integration stays barycentric.
 *
 * The plane is built from an explicit orbit normal tilted out of the ecliptic,
 * which makes the inclination exact by construction and the direction prograde:
 * with u, v orthonormal and n = u x v, motion from u toward v circulates
 * counter-clockwise about n. `phase` then rotates the pair within that plane,
 * which moves the craft along its orbit without disturbing either the
 * inclination or the circularity.
 */
function placeCraft(state, id, { altitude, inclination, phase = 0 }) {
  const earth = ORDER.indexOf('earth') * 6
  const slot = BODY_ORDER.indexOf(id) * 6

  const mu = G * BODIES.earth.mass
  const r = BODIES.earth.radius + altitude
  const speed = Math.sqrt(mu / r) // circular
  const i = inclination * DEG

  const n = [Math.sin(i), Math.cos(i), 0] // orbit normal, out of the ecliptic
  const u = [Math.cos(i), -Math.sin(i), 0] // unit, perpendicular to n
  const v = [
    n[1] * u[2] - n[2] * u[1],
    n[2] * u[0] - n[0] * u[2],
    n[0] * u[1] - n[1] * u[0],
  ] // n x u

  const c = Math.cos(phase * DEG)
  const sn = Math.sin(phase * DEG)
  for (let k = 0; k < 3; k++) {
    const pk = u[k] * c + v[k] * sn
    const vk = v[k] * c - u[k] * sn
    state[slot + k] = state[earth + k] + r * pk
    state[slot + 3 + k] = state[earth + 3 + k] + speed * vk
  }
}

export function createSimulation() {
  // Test particles carry zero mass; the integrator never reads it, but keeping
  // the array the same length as the state vector keeps the indexing uniform.
  const masses = BODY_ORDER.map((id) => BODIES[id]?.mass ?? 0)
  const sim = new RK4NBody(masses, buildInitialState(), MASSIVE_COUNT)
  sim.epochMs = J2000_MS
  // A craft can genuinely fly into a planet, unlike the planets themselves.
  // Softening only the test-particle tier keeps the 1/r^2 singularity from
  // producing NaN without touching the planetary solution.
  sim.testSoftening2 = Math.pow(BODIES.earth.radius * 0.25, 2)

  // Earth carries the atmosphere, and the air co-rotates with it.
  sim.dragBody = ORDER.indexOf('earth')
  sim.dragBodyRadius = BODIES.earth.radius
  sim.omega.set(OMEGA)

  /**
   * And Earth is not a sphere. Its oblateness rides on the field the craft
   * feels, one-way, from the same model the pad's local gravity is read from:
   * PREM's layered density, with the zonal coefficients the actual planet
   * carries. Installed here rather than built into the integrator, like the
   * rails, so the solver stays a solver.
   *
   * Nothing about the massive bodies changes when this is set — see rk4.js —
   * which is what keeps every figure ever measured about the planetary solution
   * a figure about three point masses and nothing else.
   */
  sim.zonal = { ...EARTH_FIELD, body: ORDER.indexOf('earth') }

  /**
   * The rest of the solar system, pulling on the craft without being pulled.
   *
   * Installed here rather than built into the integrator, so the integrator
   * stays a closed n-body solver and a test that wants the three-body solution
   * alone can have it by leaving this off.
   */
  sim.rails = {
    count: RAIL_COUNT,
    mu: RAIL_MU,
    helio: railHelio,
    sunOffset: ORDER.indexOf('sun') * 6,
    refreshAfter: RAIL_REFRESH,
    refresh: updateRails,
  }
  updateRails(0)

  // Satellite ballistic coefficients are fixed. The ship's changes as it burns
  // propellant and sheds stages, so it is refreshed every frame instead.
  TEST_PARTICLES.forEach((id, slot) => {
    const spec = SATELLITES[id]
    if (spec?.mass) sim.dragK[slot] = dragCoefficient(spec.drag.cd, spec.drag.area, spec.mass)
  })

  return sim
}

/** Simulated instant as a real calendar date. */
export function simDate(sim) {
  return new Date(J2000_MS + sim.t * 1000)
}

export const INDEX = Object.fromEntries(BODY_ORDER.map((id, i) => [id, i]))

/**
 * A body's position, straight out of the state vector.
 *
 * This is the whole of what used to be `scale.js`'s `toScene()`. The renderer
 * works in metres now — one scene unit is one metre, so the integrator's
 * coordinates *are* the world coordinates and there is nothing left to
 * transform. `origin`, when given, is the floating-origin offset to subtract.
 *
 * Keeping it as a named function rather than inlining the three reads is
 * deliberate: it is the single place the scene learns where something is, and
 * the last time that mapping carried a factor nobody was checking, the ship
 * spent every lunar phase rendered nine times further from Earth than the Moon.
 */
export function readPosition(state, index, out, origin = null) {
  const o = index * 6
  out.set(state[o], state[o + 1], state[o + 2])
  if (origin) out.sub(origin)
  return out
}
