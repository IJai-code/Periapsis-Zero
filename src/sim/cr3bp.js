import { Vector3 } from 'three'
import { BODIES } from './constants.js'
import { INDEX } from './system.js'
import { MU } from './lagrange.js'

/**
 * The synodic (co-rotating) Earth-Moon frame, and transforms into and out of it.
 *
 * Halo orbits are periodic in a frame that turns with the Earth-Moon line, and
 * in no other. In the inertial frame this simulation integrates, an NRHO is an
 * unremarkable-looking curve that never closes; in the synodic frame it is a
 * closed loop with a symmetry condition simple enough to shoot at. So the
 * corrector works here, and everything it produces is rotated back before it
 * touches the integrator.
 *
 * **This is not the CR3BP, and the difference is the whole reason a corrector is
 * needed twice.** The circular restricted problem assumes two point masses on a
 * circular orbit and a frame turning at a constant rate. None of that is true
 * here: the Moon's orbit is emergent and its separation runs 362,558–406,733 km,
 * so the frame's rotation rate and length scale both breathe, and the Sun is in
 * the field as well. A halo found under CR3BP assumptions is therefore a *first
 * guess* — the real orbit has to be continued into this ephemeris afterwards.
 * That is exactly how real NRHO design proceeds, and it is why the periodicity
 * residual will never go to zero here.
 *
 * The same honesty the Lagrange solver already carries: those points are solved
 * once as normalised roots and then scaled by the live separation, which is the
 * elliptic result rather than an approximation to the circular one.
 *
 * Every routine writes into preallocated scratch. Nothing here allocates.
 */

/** Mass ratio m_moon / (m_earth + m_moon), shared with the Lagrange solver. */
export { MU }

const _re = new Vector3()
const _rm = new Vector3()
const _ve = new Vector3()
const _vm = new Vector3()
const _rel = new Vector3()
const _relV = new Vector3()
const _h = new Vector3()

/**
 * Live state of the frame. Refreshed from the integrator, never assumed.
 *
 * `omega` is the *instantaneous* rate |r x v| / |r|^2 rather than a mean motion,
 * because the separation this frame is built on is itself varying — using a
 * constant would put the frame's rotation out of step with the bodies defining
 * it, which shows up immediately as a spurious drift in anything held fixed.
 */
export const synodic = {
  xhat: new Vector3(1, 0, 0), // barycentre toward the Moon
  yhat: new Vector3(0, 1, 0), // completes the right-handed triad, along-track
  zhat: new Vector3(0, 0, 1), // orbit normal
  origin: new Vector3(), // barycentre position, inertial
  originVel: new Vector3(), // barycentre velocity, inertial
  separation: 0, // m, Earth to Moon
  omega: 0, // rad/s
}

/** Rebuild the frame from the current planetary state. */
export function updateSynodicFrame(state) {
  const e = INDEX.earth * 6
  const m = INDEX.moon * 6
  _re.set(state[e], state[e + 1], state[e + 2])
  _rm.set(state[m], state[m + 1], state[m + 2])
  _ve.set(state[e + 3], state[e + 4], state[e + 5])
  _vm.set(state[m + 3], state[m + 4], state[m + 5])

  _rel.subVectors(_rm, _re)
  _relV.subVectors(_vm, _ve)
  const sep = _rel.length()
  if (!(sep > 0)) return synodic
  synodic.separation = sep

  synodic.xhat.copy(_rel).divideScalar(sep)
  _h.crossVectors(_rel, _relV)
  const hLen = _h.length()
  if (!(hLen > 0)) return synodic
  synodic.zhat.copy(_h).divideScalar(hLen)
  synodic.yhat.crossVectors(synodic.zhat, synodic.xhat)

  // omega = |r x v| / r^2, the instantaneous angular rate of the Earth-Moon line.
  synodic.omega = hLen / (sep * sep)

  // Barycentre. MU is the Moon's mass fraction, so this is (1-mu) rE + mu rM.
  synodic.origin.copy(_re).multiplyScalar(1 - MU).addScaledVector(_rm, MU)
  synodic.originVel.copy(_ve).multiplyScalar(1 - MU).addScaledVector(_vm, MU)
  return synodic
}

/**
 * Inertial -> synodic, position and velocity together.
 *
 * The velocity term is the one that is easy to get wrong. A point *fixed* in the
 * rotating frame is moving in the inertial one, so the frame's own rotation has
 * to be subtracted:
 *
 *     v_syn = R^T (v - v_origin) - omega x r_syn
 *
 * with omega along z, omega x r = omega(-y, x, 0). Drop that term and anything
 * stationary in the frame appears to be orbiting at 1 km/s.
 */
export function toSynodic(outR, outV, rx, ry, rz, vx, vy, vz) {
  const s = synodic
  _rel.set(rx - s.origin.x, ry - s.origin.y, rz - s.origin.z)
  _relV.set(vx - s.originVel.x, vy - s.originVel.y, vz - s.originVel.z)

  const px = _rel.dot(s.xhat)
  const py = _rel.dot(s.yhat)
  const pz = _rel.dot(s.zhat)
  outR.set(px, py, pz)

  outV.set(
    _relV.dot(s.xhat) + s.omega * py,
    _relV.dot(s.yhat) - s.omega * px,
    _relV.dot(s.zhat),
  )
  return outR
}

/** Synodic -> inertial. The exact inverse of `toSynodic`. */
export function fromSynodic(outR, outV, sx, sy, sz, svx, svy, svz) {
  const s = synodic
  outR
    .copy(s.origin)
    .addScaledVector(s.xhat, sx)
    .addScaledVector(s.yhat, sy)
    .addScaledVector(s.zhat, sz)

  // Add the frame rotation back: v_inertial = v_origin + R(v_syn + omega x r_syn).
  const ax = svx - s.omega * sy
  const ay = svy + s.omega * sx
  const az = svz
  outV
    .copy(s.originVel)
    .addScaledVector(s.xhat, ax)
    .addScaledVector(s.yhat, ay)
    .addScaledVector(s.zhat, az)
  return outR
}

/**
 * The craft's synodic state, refreshed in place.
 *
 * Exported as two preallocated vectors rather than returned in a `{ r, v }`
 * object, which is the whole difference between this being callable per frame
 * and not: an object literal is an allocation, and the first version of this
 * leaked 3.4 bytes a frame — invisible in a one-shot solve and a steady climb
 * inside a station-keeping loop that never ends. Read them, do not retain them.
 */
export const craftR = new Vector3()
export const craftV = new Vector3()

export function craftSynodic(state) {
  const o = INDEX.ship * 6
  updateSynodicFrame(state)
  toSynodic(
    craftR,
    craftV,
    state[o],
    state[o + 1],
    state[o + 2],
    state[o + 3],
    state[o + 4],
    state[o + 5],
  )
}

/**
 * Normalisation to CR3BP units: distances in separations, time in 1/omega.
 *
 * The corrector wants these because the halo family is tabulated in them and
 * because a Jacobian built on metres and metres-per-second is conditioned about
 * 10^9 to 1. Recomputed live rather than fixed, since the separation moves.
 */
export const nondim = {
  length: () => synodic.separation,
  time: () => 1 / synodic.omega,
  velocity: () => synodic.separation * synodic.omega,
}

/** Moon's position in the synodic frame, in normalised units: always (1-MU, 0, 0). */
export const MOON_X = 1 - MU
/** Earth's, likewise: (-MU, 0, 0). */
export const EARTH_X = -MU
export const MOON_RADIUS_ND = () => BODIES.moon.radius / synodic.separation
