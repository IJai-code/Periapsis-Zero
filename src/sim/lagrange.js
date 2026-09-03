import { Vector3 } from 'three'
import { BODIES } from './constants.js'
import { MOON_BOOST, POSITION_SCALE } from './scale.js'

/**
 * Earth-Moon libration points, derived live from the integrator's state.
 *
 * Our Moon's orbit is emergent — eccentric, Sun-perturbed, its plane precessing
 * — so the textbook constants do not apply. Over 30 days the live separation
 * runs 362,558 to 406,733 km, which swings L1's distance from Earth by more
 * than 37,000 km. Everything here is therefore rebuilt from r and v each frame.
 *
 * What is *not* rebuilt each frame is the hard part. The normalised collinear
 * roots depend only on the mass ratio, which is constant, so the three quintics
 * are solved once at module load and per-frame work is a scale and a rotation.
 * In the elliptic restricted three-body problem, written in the usual pulsating
 * rotating frame, the equilibria stay at those same normalised positions and
 * simply breathe with the instantaneous separation — so scaling a fixed root by
 * the live separation is the ER3BP result, not an approximation.
 */

/** Mass parameter. Constant, which is what makes the roots precomputable. */
export const MU = BODIES.moon.mass / (BODIES.earth.mass + BODIES.moon.mass)

/**
 * Collinear balance along the Earth-Moon line, normalised so the separation is
 * 1 and the barycentre is 0: Earth sits at -MU, the Moon at 1-MU. Centrifugal
 * term minus the pull of each body.
 *
 * All three collinear points are roots of this one function, separated by the
 * poles at the two bodies — so each gets its own bracket and a bisection that
 * cannot diverge, rather than a Newton iteration that could walk into a pole.
 */
function balance(x) {
  const a = x + MU // distance to Earth, signed
  const b = x - 1 + MU // distance to the Moon, signed
  return x - ((1 - MU) * a) / Math.abs(a) ** 3 - (MU * b) / Math.abs(b) ** 3
}

function bisect(lo, hi, iterations = 200) {
  let flo = balance(lo)
  for (let i = 0; i < iterations; i++) {
    const mid = 0.5 * (lo + hi)
    const fm = balance(mid)
    if (flo < 0 === fm < 0) {
      lo = mid
      flo = fm
    } else {
      hi = mid
    }
  }
  return 0.5 * (lo + hi)
}

const EDGE = 1e-10 // keep the brackets off the poles

/**
 * Normalised x of L1, L2, L3 measured from the barycentre. Distance from Earth
 * is (x + MU) separations. Solved once — these never change.
 */
export const COLLINEAR = [
  bisect(-MU + EDGE, 1 - MU - EDGE), // L1, between the bodies
  bisect(1 - MU + EDGE, 2), // L2, beyond the Moon
  bisect(-2, -MU - EDGE), // L3, beyond Earth
]

/** Rendered positions, in the same rebased scene frame as everything else. */
export const lagrange = {
  points: [new Vector3(), new Vector3(), new Vector3(), new Vector3(), new Vector3()],
  labels: ['L1', 'L2', 'L3', 'L4', 'L5'],
  /** Distance from Earth in metres, for the readout. */
  distance: [0, 0, 0, 0, 0],
  separation: 0,
}

/** DOM nodes for the HUD markers, registered by the overlay, written by the projector. */
export const markerNodes = [null, null, null, null, null]

const _rel = new Vector3()
const _vel = new Vector3()
const _dir = new Vector3()
const _normal = new Vector3()
const _swing = new Vector3()

const SIXTY = Math.PI / 3

/**
 * Refresh all five points.
 *
 * They sit at Moon-scale distances, so they take the same MOON_BOOST the Moon
 * does — scaled any other way they would detach from the body that defines them.
 *
 * @param {Float64Array} state
 * @param {number} earthOffset  Earth's slot in the state vector
 * @param {number} moonOffset   the Moon's slot
 * @param {Vector3} earthScene  Earth's rendered position (already rebased)
 */
export function computeLagrange(state, earthOffset, moonOffset, earthScene) {
  _rel.set(
    state[moonOffset] - state[earthOffset],
    state[moonOffset + 1] - state[earthOffset + 1],
    state[moonOffset + 2] - state[earthOffset + 2],
  )
  _vel.set(
    state[moonOffset + 3] - state[earthOffset + 3],
    state[moonOffset + 4] - state[earthOffset + 4],
    state[moonOffset + 5] - state[earthOffset + 5],
  )

  const r = _rel.length()
  lagrange.separation = r
  if (r === 0) return lagrange

  _dir.copy(_rel).divideScalar(r)

  // The orbit normal comes straight from r x v, so the points inherit the true
  // instantaneous plane — inclination and precession included — for free.
  _normal.crossVectors(_rel, _vel).normalize()

  const scale = MOON_BOOST * POSITION_SCALE

  for (let i = 0; i < 3; i++) {
    const fromEarth = (COLLINEAR[i] + MU) * r // signed: L3 lands on the far side
    lagrange.distance[i] = Math.abs(fromEarth)
    lagrange.points[i].copy(earthScene).addScaledVector(_dir, fromEarth * scale)
  }

  // L4 and L5 are exactly equilateral: the Earth-Moon vector turned +/-60
  // degrees about the orbit normal, +60 giving the leading point.
  _swing.copy(_rel).applyAxisAngle(_normal, SIXTY)
  lagrange.points[3].copy(earthScene).addScaledVector(_swing, scale)
  lagrange.distance[3] = r

  _swing.copy(_rel).applyAxisAngle(_normal, -SIXTY)
  lagrange.points[4].copy(earthScene).addScaledVector(_swing, scale)
  lagrange.distance[4] = r

  return lagrange
}
