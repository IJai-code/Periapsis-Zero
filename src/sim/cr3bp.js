import { Vector3 } from 'three'
import { BODIES, G } from './constants.js'
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

/* ---------------------------------------------------------------- *
 * The idealised CR3BP: propagator and differential corrector
 * ---------------------------------------------------------------- */

/**
 * Equations of motion in the normalised rotating frame.
 *
 *   r1 = |(x+mu, y, z)|          distance to Earth, which sits at -mu
 *   r2 = |(x-1+mu, y, z)|        distance to the Moon, at 1-mu
 *
 *   x'' =  2y' + x - (1-mu)(x+mu)/r1^3 - mu(x-1+mu)/r2^3
 *   y'' = -2x' + y - (1-mu)y/r1^3      - mu y/r2^3
 *   z'' =            -(1-mu)z/r1^3     - mu z/r2^3
 *
 * Lengths in Earth-Moon separations, time in 1/omega, so the frame turns at
 * exactly 1 and the Coriolis terms carry no constants. This is the *idealised*
 * problem — circular, two bodies, constant rate — and deliberately not the field
 * the mission integrator solves. A halo is strictly periodic here and in no
 * other model, which is what makes a periodicity residual something a corrector
 * can actually drive to zero.
 *
 * Same normalisation `lagrange.js` already uses, so the libration points it
 * solves are directly usable as reference geometry here.
 */
export function cr3bpDerivative(y, out) {
  const x = y[0]
  const yy = y[1]
  const z = y[2]
  const vx = y[3]
  const vy = y[4]
  const vz = y[5]

  const dx1 = x + MU
  const dx2 = x - 1 + MU
  const r1sq = dx1 * dx1 + yy * yy + z * z
  const r2sq = dx2 * dx2 + yy * yy + z * z
  const a = (1 - MU) / (r1sq * Math.sqrt(r1sq))
  const b = MU / (r2sq * Math.sqrt(r2sq))

  out[0] = vx
  out[1] = vy
  out[2] = vz
  out[3] = 2 * vy + x - a * dx1 - b * dx2
  out[4] = -2 * vx + yy - a * yy - b * yy
  out[5] = -a * z - b * z
}

const _k1 = new Float64Array(6)
const _k2 = new Float64Array(6)
const _k3 = new Float64Array(6)
const _k4 = new Float64Array(6)
const _tmp = new Float64Array(6)

/** One RK4 step of `h`, in place. */
function cr3bpStep(y, h) {
  const h2 = h * 0.5
  const h6 = h / 6
  cr3bpDerivative(y, _k1)
  for (let i = 0; i < 6; i++) _tmp[i] = y[i] + h2 * _k1[i]
  cr3bpDerivative(_tmp, _k2)
  for (let i = 0; i < 6; i++) _tmp[i] = y[i] + h2 * _k2[i]
  cr3bpDerivative(_tmp, _k3)
  for (let i = 0; i < 6; i++) _tmp[i] = y[i] + h * _k3[i]
  cr3bpDerivative(_tmp, _k4)
  for (let i = 0; i < 6; i++) y[i] += h6 * (_k1[i] + 2 * _k2[i] + 2 * _k3[i] + _k4[i])
}

/** Distance to the Moon, for step control. */
function moonRange(y) {
  const dx = y[0] - 1 + MU
  return Math.sqrt(dx * dx + y[1] * y[1] + y[2] * y[2])
}

/**
 * Propagate in place to the **next** crossing of the x-z plane, and return the
 * time taken — or -1 if none arrives.
 *
 * Two details carry this, and the answer is worthless without either.
 *
 * **The step is scaled by distance to the Moon.** A near-rectilinear orbit
 * spends most of its period crawling near apolune and then whips through
 * perilune in a small fraction of it; a step sized for the slow part integrates
 * straight through the fast one.
 *
 * **The crossing is Newton-refined, not merely detected.** Stopping at the first
 * step where `y` changes sign leaves an O(dt) error in *where* the residual is
 * evaluated, and the corrector then differences two such errors and divides by
 * a probe — so step-boundary jitter arrives in the Jacobian amplified by
 * 1/probe, and the finite differences measure the integrator's grid rather than
 * the dynamics. Newton on the crossing time, `dt = -y/vy`, converges
 * quadratically and settles below 1e-14 in three passes.
 */
export function propagateToCrossing(y, { baseStep = 2e-4, maxTime = 20 } = {}) {
  let t = 0

  // Step off the plane first: the initial condition sits on it.
  cr3bpStep(y, baseStep * 0.1)
  t += baseStep * 0.1
  const startSign = Math.sign(y[1])
  if (startSign === 0) return -1

  while (t < maxTime) {
    const h = baseStep * Math.min(1, Math.max(0.02, moonRange(y) / 0.15))
    const prevY = y[1]
    cr3bpStep(y, h)
    t += h
    if (Math.sign(y[1]) !== startSign && prevY !== 0) {
      // Newton on the crossing time. Each pass is an exact RK4 step of the
      // (small, shrinking) correction, so the state stays on the trajectory
      // rather than being interpolated onto a chord.
      for (let k = 0; k < 4; k++) {
        const dt = -y[1] / y[4]
        if (!Number.isFinite(dt) || Math.abs(dt) < 1e-15) break
        cr3bpStep(y, dt)
        t += dt
      }
      return t
    }
  }
  return -1
}

/** Solve A x = b for n <= 4, Gaussian elimination with partial pivoting. */
function solveLinear(A, b, n) {
  for (let col = 0; col < n; col++) {
    let piv = col
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(A[r * n + col]) > Math.abs(A[piv * n + col])) piv = r
    }
    if (Math.abs(A[piv * n + col]) < 1e-14) return false // singular
    if (piv !== col) {
      for (let c = 0; c < n; c++) {
        const t = A[col * n + c]
        A[col * n + c] = A[piv * n + c]
        A[piv * n + c] = t
      }
      const t = b[col]
      b[col] = b[piv]
      b[piv] = t
    }
    for (let r = col + 1; r < n; r++) {
      const f = A[r * n + col] / A[col * n + col]
      if (f === 0) continue
      for (let c = col; c < n; c++) A[r * n + c] -= f * A[col * n + c]
      b[r] -= f * b[col]
    }
  }
  for (let r = n - 1; r >= 0; r--) {
    let s = b[r]
    for (let c = r + 1; c < n; c++) s -= A[r * n + c] * b[c]
    b[r] = s / A[r * n + r]
  }
  return true
}

const _state = new Float64Array(6)
const _J = new Float64Array(9)
const _F = new Float64Array(3)
const _Fp = new Float64Array(3)
const _dx = new Float64Array(3)

/** Load an initial condition: on the x-z plane, crossing it perpendicularly. */
function seedState(out, x, z, vy) {
  out[0] = x
  out[1] = 0
  out[2] = z
  out[3] = 0
  out[4] = vy
  out[5] = 0
}

/**
 * Residual at the next plane crossing: [vx, vz, pin].
 *
 * A halo is symmetric about the x-z plane, so a perpendicular crossing
 * (vx = vz = 0) half a period after another one is *sufficient* for
 * periodicity — the second half of the orbit is the mirror image of the first.
 * That is what makes a half-period shot enough, and why closure over a full
 * period is a genuine independent check rather than a restatement.
 */
function residual(out, x, z, vy, pin, pinTarget) {
  seedState(_state, x, z, vy)
  const t = propagateToCrossing(_state)
  if (t < 0) return -1
  out[0] = _state[3] // vx
  out[1] = _state[5] // vz
  out[2] = (pin === 'x' ? x : z) - pinTarget
  return t
}

/**
 * Differential corrector for a symmetric periodic orbit.
 *
 * Free variables X = [x, z, vy] at the plane crossing, against residuals
 * F = [vx, vz, pin]. Two of the residuals are the physics; the third pins which
 * member of the family is wanted, because periodicity alone leaves a
 * one-parameter family and an unconstrained solve simply slides along it.
 *
 * Pinning makes the system **square**, which is worth doing rather than reaching
 * for the minimum-norm pseudo-inverse the impulse solver uses. Minimum-norm
 * would keep the step closest to the current guess, which is what continuation
 * and station-keeping want later; here the job is to *select* a family member,
 * and saying which one directly is both better conditioned and easier to reason
 * about. The pinned row is exactly [1,0,0] or [0,1,0] by construction, so the
 * 3x3 reduces to a 2x2 in the remaining unknowns without ever forming one.
 *
 * The Jacobian is finite-differenced, one propagation per column. This is a
 * one-shot solver in the sense the architecture means it — tens of propagations
 * on demand, never in a frame — so it allocates as freely as `solveImpulse`
 * does; the propagator underneath it does not, because station-keeping will call
 * it every few days for the life of a mission.
 */
export function correctPeriodicOrbit(
  guess,
  { pin = 'z', maxIter = 40, probe = 1e-8, tol = 1e-11, damping = 1 } = {},
) {
  let { x, z, vy } = guess
  const pinTarget = pin === 'x' ? x : z
  const history = []
  let converged = false
  let halfPeriod = 0

  for (let iter = 0; iter < maxIter; iter++) {
    halfPeriod = residual(_F, x, z, vy, pin, pinTarget)
    if (halfPeriod < 0) break
    const err = Math.hypot(_F[0], _F[1])
    history.push({ iter, err, x, z, vy, halfPeriod })
    if (err < tol) {
      converged = true
      break
    }

    // One propagation per column. Central differences would cost twice as much
    // for accuracy the shot does not have; the crossing is resolved to 1e-14, so
    // a forward difference at 1e-8 has six clean digits.
    const vars = [x, z, vy]
    for (let c = 0; c < 3; c++) {
      const saved = vars[c]
      vars[c] += probe
      if (residual(_Fp, vars[0], vars[1], vars[2], pin, pinTarget) < 0) break
      for (let r = 0; r < 3; r++) _J[r * 3 + c] = (_Fp[r] - _F[r]) / probe
      vars[c] = saved
    }

    _dx[0] = -_F[0]
    _dx[1] = -_F[1]
    _dx[2] = -_F[2]
    if (!solveLinear(_J, _dx, 3)) break

    x += damping * _dx[0]
    z += damping * _dx[1]
    vy += damping * _dx[2]
  }

  return { x, z, vy, halfPeriod, period: halfPeriod * 2, converged, history }
}

/**
 * Independent check: fly a full period and see whether the state returns.
 *
 * Deliberately not the corrector's own residual. That measures a *half* period
 * against a symmetry assumption; this integrates the whole way round and
 * compares against the initial condition, so an orbit that satisfied the
 * symmetry condition without actually closing would fail here.
 */
export function closureError(x, z, vy, period, opts = {}) {
  seedState(_state, x, z, vy)
  const step = opts.baseStep ?? 2e-4
  let t = 0
  while (t < period) {
    const h = Math.min(step * Math.min(1, Math.max(0.02, moonRange(_state) / 0.15)), period - t)
    if (h <= 0) break
    cr3bpStep(_state, h)
    t += h
  }
  return {
    position: Math.hypot(_state[0] - x, _state[1], _state[2] - z),
    velocity: Math.hypot(_state[3], _state[4] - vy, _state[5]),
    state: Array.from(_state),
  }
}

/**
 * Walk an orbit for `period` and report its extremes relative to the Moon.
 *
 * Which NRHO an orbit *is* gets quoted by its perilune and its period, so this
 * is the measurement that identifies a family member. Uses the same RK4 and the
 * same Moon-scaled step as everything else here — a near-rectilinear orbit
 * spends almost all its period near apolune and a few percent of it whipping
 * through perilune, so the extreme that names the orbit is precisely the one a
 * uniform step resolves worst.
 */
export function orbitExtremes(x, z, vy, period, { baseStep = 2e-4 } = {}) {
  seedState(_state, x, z, vy)
  let minR = Infinity
  let maxR = 0
  let maxZ = 0
  let t = 0
  while (t < period) {
    const r = moonRange(_state)
    if (r < minR) minR = r
    if (r > maxR) maxR = r
    if (Math.abs(_state[2]) > Math.abs(maxZ)) maxZ = _state[2]
    const step = baseStep * Math.min(1, Math.max(0.02, r / 0.15))
    const hStep = Math.min(step, period - t)
    if (hStep <= 0) break
    cr3bpStep(_state, hStep)
    t += hStep
  }
  return { perilune: minR, apolune: maxR, maxZ }
}

/* ---------------------------------------------------------------- *
 * Family continuation
 * ---------------------------------------------------------------- */

const _J2 = new Float64Array(6) // 2x3: rows [d(vx)/dX, d(vz)/dX]
const _F2 = new Float64Array(2)
const _F2p = new Float64Array(2)
const _tan = new Float64Array(3)
const _prevTan = new Float64Array(3)

/** Physics residual only — [vx, vz] at the crossing. Returns the half period. */
function residual2(out, x, z, vy) {
  seedState(_state, x, z, vy)
  const t = propagateToCrossing(_state)
  if (t < 0) return -1
  out[0] = _state[3]
  out[1] = _state[5]
  return t
}

/** Finite-difference the 2x3 Jacobian at X. Returns the half period, or -1. */
function jacobian2(x, z, vy, probe) {
  const t = residual2(_F2, x, z, vy)
  if (t < 0) return -1
  const vars = [x, z, vy]
  for (let c = 0; c < 3; c++) {
    const saved = vars[c]
    vars[c] += probe
    if (residual2(_F2p, vars[0], vars[1], vars[2]) < 0) return -1
    _J2[c] = (_F2p[0] - _F2[0]) / probe
    _J2[3 + c] = (_F2p[1] - _F2[1]) / probe
    vars[c] = saved
  }
  return t
}

/**
 * The family direction, as the null space of the 2x3 Jacobian.
 *
 * Periodicity imposes two conditions on three unknowns, so the solutions form a
 * one-parameter family and its tangent is whatever direction J cannot see. For
 * a 2x3 matrix that null space is one-dimensional and is simply the **cross
 * product of the two rows** — no decomposition, no library, exact. Stepping
 * along it is a predictor that stays on the manifold to first order, which is
 * why the corrector afterwards has almost nothing to do.
 */
function familyTangent(out) {
  const a0 = _J2[0]
  const a1 = _J2[1]
  const a2 = _J2[2]
  const b0 = _J2[3]
  const b1 = _J2[4]
  const b2 = _J2[5]
  out[0] = a1 * b2 - a2 * b1
  out[1] = a2 * b0 - a0 * b2
  out[2] = a0 * b1 - a1 * b0
  const n = Math.hypot(out[0], out[1], out[2])
  if (!(n > 0)) return false
  out[0] /= n
  out[1] /= n
  out[2] /= n
  return true
}

/**
 * Minimum-norm correction back onto the family.
 *
 *     dX = -J^T (J J^T)^-1 F
 *
 * The *right* pseudo-inverse, which is the one an underdetermined system takes.
 * The left form -(J^T J)^-1 J^T is for overdetermined least squares and is
 * simply undefined here: J^T J is 3x3 of rank 2, singular.
 *
 * Minimum-norm is the correct choice for continuation specifically. The square
 * pinned system is better for *finding* a member from an arbitrary guess, but
 * during continuation the predictor has already chosen where on the family to
 * go, and what is wanted from the corrector is the least motion that restores
 * periodicity — anything larger risks sliding along the family and, near a fold
 * where the pinned parameter stops being monotonic, jumping to a different
 * branch entirely.
 *
 * J J^T is 2x2, so the inverse is closed form.
 */
function correctMinNorm(x, z, vy, { maxIter = 20, probe = 1e-8, tol = 1e-11 } = {}) {
  let halfPeriod = -1
  for (let iter = 0; iter < maxIter; iter++) {
    halfPeriod = jacobian2(x, z, vy, probe)
    if (halfPeriod < 0) return null
    const err = Math.hypot(_F2[0], _F2[1])
    if (err < tol) return { x, z, vy, halfPeriod, err, iter }

    const a0 = _J2[0]
    const a1 = _J2[1]
    const a2 = _J2[2]
    const b0 = _J2[3]
    const b1 = _J2[4]
    const b2 = _J2[5]
    const g00 = a0 * a0 + a1 * a1 + a2 * a2
    const g01 = a0 * b0 + a1 * b1 + a2 * b2
    const g11 = b0 * b0 + b1 * b1 + b2 * b2
    const det = g00 * g11 - g01 * g01
    if (!(Math.abs(det) > 1e-30)) return null

    // w = (J J^T)^-1 F
    const w0 = (g11 * _F2[0] - g01 * _F2[1]) / det
    const w1 = (-g01 * _F2[0] + g00 * _F2[1]) / det
    // dX = -J^T w
    x -= a0 * w0 + b0 * w1
    z -= a1 * w0 + b1 * w1
    vy -= a2 * w0 + b2 * w1
  }
  return null
}

/**
 * Walk the family, predictor along the tangent and minimum-norm corrector.
 *
 * `direction` is evaluated on the first step to pick which way along the tangent
 * decreases perilune, and thereafter the sign is carried by requiring the new
 * tangent to agree with the previous one. Without that continuity the tangent's
 * sign — an arbitrary property of a cross product — flips at will and the walk
 * reverses into orbits it has already visited.
 *
 * The step adapts: a corrector failure halves it and retries, a clean solve
 * grows it slowly. That is what carries the walk through the region where the
 * family turns sharply, which for the halo family is exactly where it becomes
 * near-rectilinear.
 */
export function continueFamily(start, { target, steps = 400, ds = 2e-3, dsMin = 1e-6, dsMax = 1e-2 } = {}) {
  let { x, z, vy } = start
  const members = []

  let cur = correctMinNorm(x, z, vy)
  if (!cur) return { members, reason: 'seed did not correct' }
  ;({ x, z, vy } = cur)
  let ext = orbitExtremes(x, z, vy, cur.halfPeriod * 2)
  members.push({ x, z, vy, period: cur.halfPeriod * 2, ...ext })

  _prevTan[0] = 0
  _prevTan[1] = 0
  _prevTan[2] = 0
  let step = ds

  for (let i = 0; i < steps; i++) {
    if (jacobian2(x, z, vy, 1e-8) < 0) return { members, reason: 'jacobian failed' }
    if (!familyTangent(_tan)) return { members, reason: 'tangent degenerate' }

    // Keep walking the same way: agree with the previous tangent, or on the
    // first step pick whichever sign reduces perilune.
    const dot = _tan[0] * _prevTan[0] + _tan[1] * _prevTan[1] + _tan[2] * _prevTan[2]
    if (_prevTan[0] === 0 && _prevTan[1] === 0 && _prevTan[2] === 0) {
      const probeFwd = correctMinNorm(x + step * _tan[0], z + step * _tan[1], vy + step * _tan[2])
      if (probeFwd) {
        const e = orbitExtremes(probeFwd.x, probeFwd.z, probeFwd.vy, probeFwd.halfPeriod * 2)
        if (e.perilune > ext.perilune) {
          _tan[0] = -_tan[0]
          _tan[1] = -_tan[1]
          _tan[2] = -_tan[2]
        }
      }
    } else if (dot < 0) {
      _tan[0] = -_tan[0]
      _tan[1] = -_tan[1]
      _tan[2] = -_tan[2]
    }

    const next = correctMinNorm(x + step * _tan[0], z + step * _tan[1], vy + step * _tan[2])
    if (!next) {
      step *= 0.5
      if (step < dsMin) return { members, reason: 'step underflow' }
      continue
    }

    _prevTan[0] = _tan[0]
    _prevTan[1] = _tan[1]
    _prevTan[2] = _tan[2]
    ;({ x, z, vy } = next)
    ext = orbitExtremes(x, z, vy, next.halfPeriod * 2)
    members.push({ x, z, vy, period: next.halfPeriod * 2, ...ext })
    step = Math.min(dsMax, step * 1.1)

    if (target && ext.perilune <= target) return { members, reason: 'reached target' }
  }
  return { members, reason: 'steps exhausted' }
}

/**
 * Classify a crossing state by its two-body energy **about the Moon**.
 *
 * This is the check whose absence let a wrong answer pass every other test. The
 * corrector finds *periodic orbits*, and periodicity is not identity: a large
 * orbit that merely swings past the Moon satisfies the same symmetry condition
 * an NRHO does, closes over a full period to 1e-13, and is not a halo at all.
 * The first family this module found had 2,207 m/s at perilune against a 940 m/s
 * lunar escape speed — hyperbolic about the Moon, and only visible as wrong once
 * something asked.
 *
 * At a polar perilune the rotating-frame velocity relates simply to the inertial
 * one: omega x r for the craft and for the Moon differ only by the craft's
 * in-plane offset, so v_rel = vy + (x - (1-mu)).
 */
export function lunarState(x, z, vy) {
  const rx = x - (1 - MU)
  const r = Math.hypot(rx, z)
  const vRel = vy + rx
  const v2 = vRel * vRel
  const energy = v2 / 2 - MU / r
  const bound = energy < 0
  const a = bound ? -MU / (2 * energy) : Infinity
  return {
    radius: r,
    speed: Math.abs(vRel),
    escapeSpeed: Math.sqrt((2 * MU) / r),
    energy,
    bound,
    semiMajor: a,
    eccentricity: bound ? 1 - r / a : NaN,
  }
}

/**
 * A physically constructed NRHO seed.
 *
 * Built from what an NRHO *is* rather than from a series expansion: a near-polar,
 * highly eccentric lunar orbit whose perilune sits on the x-z plane. Perilune
 * radius and apolune radius give the two-body speed there, and at a polar
 * perilune the rotating-frame vy equals that speed exactly, because the frame's
 * omega x r term is identical for craft and Moon when the craft sits directly
 * over the Moon.
 *
 * This is why Richardson's third-order expansion is not needed here. That series
 * exists to seed halos near the libration point, where the linear solution is a
 * Lissajous and the 1:1 resonance is a nonlinear effect. An NRHO is at the other
 * end of the family entirely — so close to the Moon that a Keplerian
 * approximation is a *better* starting point than a libration-point expansion.
 */
export function nrhoSeed(perilune, apolune) {
  const a = (perilune + apolune) / 2
  const vp = Math.sqrt(MU * (2 / perilune - 1 / a))
  return { x: 1 - MU, z: -perilune, vy: vp }
}

/**
 * Place a CR3BP family member into the live inertial state.
 *
 * The bridge between the two models, and it carries an assumption worth naming:
 * the CR3BP is normalised to a *constant* separation, and the real one runs
 * 362,558-406,733 km. Dimensionalising against the instantaneous separation
 * therefore scales the orbit by whatever the Moon's distance happens to be at
 * insertion — the pulsating-frame reading, and the same one the Lagrange solver
 * already takes when it scales fixed normalised roots by the live separation.
 *
 * An orbit inserted at perigee of the lunar orbit is a slightly different
 * physical orbit from the same member inserted at apogee. That is not an error
 * in the transfer; it is the CR3BP having one fewer degree of freedom than the
 * system it approximates, and it is precisely what the ephemeris continuation
 * layer exists to absorb.
 */
/** Sum of the primaries' gravitational parameters — the CR3BP's mass unit. */
const MU_SYSTEM = G * (BODIES.earth.mass + BODIES.moon.mass)

export function insertMember(state, member, shipOffset, { separation = null } = {}) {
  updateSynodicFrame(state)
  const sep = separation ?? synodic.separation

  /**
   * The velocity unit is Keplerian, *not* `synodic.omega`.
   *
   * The CR3BP ties its time unit to its length unit through Kepler's third law:
   * one time unit is 1/omega for a body circling at exactly one length unit. So
   * converting a normalised velocity needs the omega that *belongs to this
   * separation*, sqrt(mu_system / sep^3), and not the frame's instantaneous
   * rotation rate.
   *
   * Those differ by 2% here and it is not a rounding matter. Position scales as
   * sep and velocity must scale as sep^-1/2 to keep the orbit's shape; the
   * instantaneous rate near lunar apogee is 2% below the circular value, so
   * dimensionalising with it stretched the orbit and slowed it at once.
   * Measured: a member with e = 0.9332 arrived as e = 0.8534, its apolune fell
   * from 74,000 km to 42,000, and it left the lunar vicinity before completing
   * one revolution. The seed was fine; the units were not.
   */
  const omegaKep = Math.sqrt(MU_SYSTEM / (sep * sep * sep))
  const vu = sep * omegaKep

  fromSynodic(
    craftR,
    craftV,
    member.x * sep,
    0,
    member.z * sep,
    0,
    member.vy * vu,
    0,
  )

  state[shipOffset] = craftR.x
  state[shipOffset + 1] = craftR.y
  state[shipOffset + 2] = craftR.z
  state[shipOffset + 3] = craftV.x
  state[shipOffset + 4] = craftV.y
  state[shipOffset + 5] = craftV.z
  return { separation: sep, velocityUnit: vu }
}
