import { Quaternion, Vector3 } from 'three'
import { BODIES, G, G0, SHIP } from './constants.js'
import { dragCoefficient } from './atmosphere.js'

/**
 * Flight model for the spacecraft: attitude, throttle, propellant, and the
 * osculating elements the HUD reads.
 *
 * Attitude deliberately lives here rather than inside the integrator's flat
 * state vector. That array's value is that every slot is an identical
 * [x,y,z,vx,vy,vz] block, which is what keeps `derivative()` a tight branchless
 * loop; a seven-wide quaternion block for one body would force special-casing
 * in the hot path. And it costs nothing in fidelity: with no gravity-gradient
 * torque and thrust through the centre of mass, the rotational equation does
 * not depend on position, and the translational one depends on attitude only
 * through the thrust direction — which the zero-order hold already freezes for
 * the duration of a step. Splitting them is exact, not approximate.
 */

const MU_EARTH = G * BODIES.earth.mass
const MU_MOON = G * BODIES.moon.mass

/** Held-key axes, written by the listeners and read once per frame. */
export const input = {
  pitch: 0, // +/- 1, about body X
  yaw: 0, // about body Y
  roll: 0, // about body Z
  throttleUp: false,
  throttleDown: false,
}

export const ship = {
  /** Body -> world. Body +Z is the thrust axis. */
  quaternion: new Quaternion(),
  /** Body-frame angular velocity, rad/s. */
  angularVelocity: new Vector3(),
  /** World-space thrust axis, refreshed once per frame. */
  forward: new Vector3(0, 0, 1),

  throttle: 0, // 0..1
  thrust: 0, // N, this frame
  mass: 0, // kg, refreshed each frame
  assist: true, // RCS stability hold

  /** When true, attitude tracks `targetQuaternion` instead of RCS input. */
  autopilot: false,
  targetQuaternion: new Quaternion(),

  /**
   * Parachute drag area actually developed, Cd·A in m^2, and what it is opening
   * toward. A canopy does not appear at full area: it inflates, and on the
   * mains it is deliberately reefed and let out in stages. Modelled as a
   * first-order opening so the deceleration has a rise time instead of a step.
   */
  chuteCdA: 0,
  chuteTarget: 0,
  chuteTau: 1,

  /**
   * Bank angle of the lift vector about the relative wind, rad.
   *
   * 0 is lift straight up, pi straight down, +-pi/2 purely lateral. This is the
   * capsule's *only* control authority during entry, and it is a rate-limited
   * state rather than a setpoint because a vehicle cannot roll instantly.
   */
  bankAngle: 0,
  bankCommand: 0,
  /** Override for the stage's trimmed L/D; null uses the vehicle's own. */
  liftToDrag: null,

  /** Index of the burning stage. Everything below it has been discarded. */
  stage: 0,
  /** Remaining propellant per stage, kg. */
  stageProp: Float64Array.from(SHIP.stages.map((s) => s.propellant)),
  separations: 0,
}

export const activeStage = () => SHIP.stages[ship.stage] ?? null

/**
 * Current vehicle mass: every stage from the burning one upward, dry structure
 * included. Spent stages contribute nothing once separated, which is the whole
 * point — jettisoning dead weight is a step change in both acceleration and
 * ballistic coefficient.
 */
export function totalMass() {
  let m = 0
  for (let i = ship.stage; i < SHIP.stages.length; i++) {
    m += SHIP.stages[i].dryMass + ship.stageProp[i]
  }
  return m
}

/** Jettison the burning stage. Returns false if this is already the last one. */
export function separate() {
  if (ship.stage >= SHIP.stages.length - 1) return false
  ship.stage += 1
  ship.separations += 1
  ship.mass = totalMass()
  return true
}

/**
 * Remaining delta-v across all stages, by Tsiolkovsky applied stage by stage.
 *
 * It has to be summed per stage rather than computed from one mass ratio: each
 * stage has its own exhaust velocity, and separating drops structure that the
 * stages above never have to accelerate.
 */
export function deltaV() {
  let m = totalMass()
  let total = 0
  for (let i = ship.stage; i < SHIP.stages.length; i++) {
    const prop = ship.stageProp[i]
    const after = m - prop
    if (prop > 0 && after > 0) total += SHIP.stages[i].isp * G0 * Math.log(m / after)
    m = after - SHIP.stages[i].dryMass
  }
  return total
}

export function resetShip() {
  ship.quaternion.identity()
  ship.angularVelocity.set(0, 0, 0)
  ship.forward.set(0, 0, 1)
  ship.throttle = 0
  ship.thrust = 0
  ship.chuteCdA = 0
  ship.chuteTarget = 0
  ship.chuteTau = 1
  ship.bankAngle = 0
  ship.bankCommand = 0
  ship.stage = 0
  ship.separations = 0
  SHIP.stages.forEach((s, i) => (ship.stageProp[i] = s.propellant))
  ship.mass = totalMass()
  input.pitch = 0
  input.yaw = 0
  input.roll = 0
  input.throttleUp = false
  input.throttleDown = false
}

/* ---------------------------------------------------------------- *
 * Attitude
 * ---------------------------------------------------------------- */

const _axis = new Vector3()
const _dq = new Quaternion()
const THROTTLE_RATE = 0.6 // per second, while held

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v)

/**
 * One torque axis: commanded RCS if the pilot is asking, otherwise the
 * stability hold pushing residual rotation back to zero. Either way the result
 * is clamped to the thrusters' actual authority.
 */
function axisTorque(command, omega) {
  if (command !== 0) return command * SHIP.rcsTorque
  if (!ship.assist) return 0
  return clamp(-omega * SHIP.assistGain * SHIP.inertia, -SHIP.rcsTorque, SHIP.rcsTorque)
}

/**
 * Integrate attitude over `dt`.
 *
 * The inertia tensor is isotropic, so Euler's gyroscopic term omega x (I omega)
 * vanishes identically and the rotational equation is exactly omega' = tau / I.
 * The quaternion then advances by the closed-form exponential map for constant
 * angular velocity, which is exact over the step and unit-norm preserving by
 * construction rather than by repeated renormalisation.
 */
/** Slew rate the autopilot is allowed, rad/s — about 8.6 deg/s, TVC-like. */
const AUTOPILOT_SLEW = 0.15

export function integrateAttitude(dt) {
  // Under autopilot the attitude is commanded, not flown: slerp toward the
  // target at a bounded rate, which behaves like a rate-limited thrust-vector
  // control loop and cannot oscillate the way a torque controller can.
  if (ship.autopilot) {
    const angle = ship.quaternion.angleTo(ship.targetQuaternion)
    if (angle > 1e-6) {
      ship.quaternion.slerp(ship.targetQuaternion, Math.min(1, (AUTOPILOT_SLEW * dt) / angle))
    }
    ship.angularVelocity.set(0, 0, 0)
    ship.forward.set(0, 0, 1).applyQuaternion(ship.quaternion)
    return
  }

  const w = ship.angularVelocity
  const invI = 1 / SHIP.inertia

  w.x += axisTorque(input.pitch, w.x) * invI * dt
  w.y += axisTorque(input.yaw, w.y) * invI * dt
  w.z += axisTorque(input.roll, w.z) * invI * dt

  // The hold can overshoot through zero on a long step; snap rather than ring.
  if (ship.assist) {
    if (input.pitch === 0 && Math.abs(w.x) < 1e-4) w.x = 0
    if (input.yaw === 0 && Math.abs(w.y) < 1e-4) w.y = 0
    if (input.roll === 0 && Math.abs(w.z) < 1e-4) w.z = 0
  }

  const rate = w.length()
  if (rate > 1e-12) {
    _axis.copy(w).divideScalar(rate)
    _dq.setFromAxisAngle(_axis, rate * dt)
    ship.quaternion.multiply(_dq).normalize() // body-frame increment: post-multiply
  }

  ship.forward.set(0, 0, 1).applyQuaternion(ship.quaternion)
}

/* ---------------------------------------------------------------- *
 * Propulsion
 * ---------------------------------------------------------------- */

/**
 * Advance throttle and propellant, then write this frame's thrust acceleration
 * into the integrator's preallocated `extAccel` slot.
 *
 * Held constant across all four RK4 stages. That is not a shortcut: RK4
 * integrates a constant acceleration exactly, so a steady burn contributes zero
 * integration error.
 *
 * @param {number} dt      wall-clock seconds this frame
 * @param {number} simDt   simulated seconds this frame (dt * time warp)
 * @param {Float64Array} extAccel the integrator's scratch, slot 0
 */
export function applyThrust(dt, simDt, extAccel) {
  if (input.throttleUp) ship.throttle = clamp(ship.throttle + THROTTLE_RATE * dt, 0, 1)
  if (input.throttleDown) ship.throttle = clamp(ship.throttle - THROTTLE_RATE * dt, 0, 1)

  const stage = activeStage()
  ship.mass = totalMass()

  const remaining = stage ? ship.stageProp[ship.stage] : 0
  ship.thrust = stage && remaining > 0 ? ship.throttle * stage.thrust : 0

  const a = ship.thrust / ship.mass
  extAccel[0] = ship.forward.x * a
  extAccel[1] = ship.forward.y * a
  extAccel[2] = ship.forward.z * a

  if (ship.thrust > 0) {
    // mdot = F / (Isp g0). Mass falls as the burn proceeds, so acceleration
    // climbs for constant thrust — the reason a stage's final seconds pull
    // hardest.
    const burned = (ship.thrust / (stage.isp * G0)) * simDt
    ship.stageProp[ship.stage] = Math.max(0, remaining - burned)

    // Depletion separates automatically, so a continuous burn rolls straight
    // onto the next stage instead of silently coasting on a dead one.
    if (ship.stageProp[ship.stage] <= 0) separate()
  }

  // Drag configuration follows the stage: a streamlined ascent vehicle in
  // continuum flow has a far lower coefficient than the blunt spacecraft that
  // emerges from it into free-molecular flow.
  const d = stage?.drag ?? SHIP.drag

  // Canopies inflate rather than appear. First-order opening on simulated time,
  // so the rise is warp-invariant like everything else in flight.
  if (ship.chuteTarget > ship.chuteCdA) {
    const k = 1 - Math.exp(-simDt / ship.chuteTau)
    ship.chuteCdA += (ship.chuteTarget - ship.chuteCdA) * k
  } else if (ship.chuteTarget < ship.chuteCdA) {
    ship.chuteCdA = ship.chuteTarget
  }

  // The chute's Cd·A adds to the vehicle's own; dragCoefficient() folds in the
  // 1/2m, so the two areas are summed before it rather than after.
  const bodyK = (0.5 * (d.cd * d.area)) / ship.mass
  extAccel.dragK = bodyK + (0.5 * ship.chuteCdA) / ship.mass

  /**
   * Lift follows the *body*, never the canopy.
   *
   * A capsule under parachutes is hanging, not flying: it has no trimmed angle
   * of attack any more and the chute contributes drag only. Deriving liftK from
   * the combined Cd·A would hand the vehicle a lift force ninety times its own
   * once the mains inflate.
   */
  extAccel.liftK = ship.chuteCdA > 0 ? 0 : bodyK * (ship.liftToDrag ?? d.ld ?? 0)
  extAccel.bank = ship.bankAngle
}

/* ---------------------------------------------------------------- *
 * Osculating elements
 * ---------------------------------------------------------------- */

/** Shape of one osculating element set. Allocated twice, at module load, never again. */
const makeElements = () => ({
  altitude: 0, // m above the central body's surface
  radius: 0, // m from the central body's centre
  speed: 0, // m/s, inertial relative to the central body
  vertical: 0, // m/s, positive = climbing
  semiMajor: 0, // negative on a hyperbola
  eccentricity: 0,
  apogee: 0, // m altitude
  perigee: 0, // m altitude
  period: 0, // s
  bound: true, // false once the trajectory is escape

  /** Seconds until the craft reaches apoapsis. Infinity if unbound. */
  timeToApoapsis: Infinity,
  /** Radius of apoapsis, m. Infinity if unbound. */
  apoapsisRadius: 0,
  /** Prograde delta-v that would circularise at apoapsis, m/s. */
  circulariseDeltaV: 0,

  /** Radius of periapsis, m. Defined on a hyperbola too, where a < 0. */
  periapsisRadius: 0,
  /**
   * Seconds to periapsis. On an ellipse this is the *next* passage, in [0, T).
   * On a hyperbola it is signed: negative once periapsis is behind, which is
   * what lets a burn straddling it know which side it is on.
   */
  timeToPeriapsis: Infinity,
  /** Retrograde delta-v that would circularise at periapsis, m/s. */
  captureDeltaV: 0,
})

/**
 * Live geocentric elements, refreshed in place. A preallocated plain object read
 * by the HUD — nothing here allocates.
 */
export const elements = makeElements()

/**
 * Live *selenocentric* elements — the same maths about the Moon.
 *
 * A separate set rather than a reparameterised one: both are wanted at once on
 * a lunar approach, where the geocentric orbit says where the craft is going
 * and the selenocentric one says whether it has been captured.
 */
export const lunarElements = makeElements()

/**
 * Osculating elements from an inertial state relative to a central body.
 *
 * Scalars throughout — no vector temporaries, therefore no allocation. The
 * eccentricity-*vector* formulation is used rather than classical elements
 * because it has no singularity as e approaches zero, and a near-circular orbit
 * is exactly the case this HUD spends most of its time reporting.
 *
 * @param {object} out          element set to refresh in place
 * @param {number} mu           gravitational parameter of the central body
 * @param {number} bodyRadius   its radius, for the altitude conversions
 */
function computeInto(out, state, shipOffset, centreOffset, mu, bodyRadius) {
  const rx = state[shipOffset] - state[centreOffset]
  const ry = state[shipOffset + 1] - state[centreOffset + 1]
  const rz = state[shipOffset + 2] - state[centreOffset + 2]
  const vx = state[shipOffset + 3] - state[centreOffset + 3]
  const vy = state[shipOffset + 4] - state[centreOffset + 4]
  const vz = state[shipOffset + 5] - state[centreOffset + 5]

  const r = Math.sqrt(rx * rx + ry * ry + rz * rz)
  const v2 = vx * vx + vy * vy + vz * vz
  const v = Math.sqrt(v2)

  out.radius = r
  out.altitude = r - bodyRadius
  out.speed = v
  out.vertical = (rx * vx + ry * vy + rz * vz) / r

  // Specific orbital energy fixes the semi-major axis.
  const energy = v2 / 2 - mu / r
  const bound = energy < 0
  out.bound = bound

  const a = -mu / (2 * energy)
  out.semiMajor = a

  // h = r x v, then e = (v x h) / mu - r-hat
  const hx = ry * vz - rz * vy
  const hy = rz * vx - rx * vz
  const hz = rx * vy - ry * vx

  const ex = (vy * hz - vz * hy) / mu - rx / r
  const ey = (vz * hx - vx * hz) / mu - ry / r
  const ez = (vx * hy - vy * hx) / mu - rz / r
  const e = Math.sqrt(ex * ex + ey * ey + ez * ez)
  out.eccentricity = e

  // a(1 - e) is the periapsis radius on both branches: on a hyperbola a is
  // negative and e > 1, so the two sign flips cancel.
  const rp = a * (1 - e)
  out.periapsisRadius = rp
  out.perigee = rp - bodyRadius
  // On an escape trajectory a is negative and apoapsis does not exist.
  out.apogee = bound ? a * (1 + e) - bodyRadius : Infinity
  out.period = bound ? 2 * Math.PI * Math.sqrt((a * a * a) / mu) : Infinity

  // Retrograde delta-v that would circularise at periapsis — the capture burn.
  // Vis-viva there against the local circular speed. Valid on a hyperbola too.
  const vp = Math.sqrt(mu * (2 / rp - 1 / a))
  out.captureDeltaV = vp - Math.sqrt(mu / rp)

  apsisTiming(out, r, a, e, bound, out.vertical, mu)
  return out
}

/** Osculating elements about Earth. */
export function computeElements(state, shipOffset, earthOffset) {
  return computeInto(elements, state, shipOffset, earthOffset, MU_EARTH, BODIES.earth.radius)
}

/** Osculating elements about the Moon — the frame a capture burn is judged in. */
export function computeLunarElements(state, shipOffset, moonOffset) {
  return computeInto(lunarElements, state, shipOffset, moonOffset, MU_MOON, BODIES.moon.radius)
}

const TAU = Math.PI * 2

/**
 * Time to apoapsis and to periapsis, and the burn that would circularise at
 * apoapsis.
 *
 * Solved through the anomalies rather than by watching for the vertical speed
 * to change sign: a finite burn has to *straddle* its apsis, so the sequencer
 * needs to know how long it has left while still approaching, not to be told it
 * has arrived.
 *
 * Elliptic branch:
 *
 *   cos E = (1 - r/a) / e        eccentric anomaly
 *   M = E - e sin E              Kepler's equation, forward
 *   t = (pi - M) / n             apoapsis sits at M = pi
 *
 * Hyperbolic branch — the same identity with the circular functions replaced by
 * their hyperbolic counterparts, and |a| for the negative semi-major axis:
 *
 *   cosh H = (r/|a| + 1) / e     hyperbolic anomaly
 *   M = e sinh H - H             Kepler's equation for a hyperbola
 *   t = -M / n,  n = sqrt(mu/|a|^3)
 *
 * On both branches the *branch of the anomaly* is recovered from the sign of
 * the radial velocity: acos and acosh are both even, so neither can tell an
 * inbound leg from an outbound one on its own. Getting that wrong on the
 * elliptic branch made the apoapsis clock right for half of every orbit and
 * wrong for the other half; on a capture hyperbola it would put periapsis in
 * the future when it is already behind, which is not a recoverable error.
 */
function apsisTiming(out, r, a, e, bound, radialVelocity, mu) {
  if (!bound) {
    out.timeToApoapsis = Infinity
    out.apoapsisRadius = Infinity
    out.circulariseDeltaV = 0

    // Hyperbolic time to periapsis, signed: negative once periapsis is behind.
    const A = -a // positive
    let coshH = (r / A + 1) / e
    if (coshH < 1) coshH = 1
    const H = Math.sign(radialVelocity) * Math.acosh(coshH)
    const M = e * Math.sinh(H) - H
    const n = Math.sqrt(mu / (A * A * A))
    out.timeToPeriapsis = -M / n
    return
  }

  const ra = a * (1 + e)
  out.apoapsisRadius = ra

  // Vis-viva at apoapsis against the circular speed there.
  const vApo = Math.sqrt(mu * (2 / ra - 1 / a))
  out.circulariseDeltaV = Math.sqrt(mu / ra) - vApo

  const n = Math.sqrt(mu / (a * a * a))

  if (e < 1e-8) {
    // Already circular: every point is an apsis, so "now" is the honest answer.
    out.timeToApoapsis = 0
    out.timeToPeriapsis = 0
    return
  }

  let cosE = (1 - r / a) / e
  cosE = cosE > 1 ? 1 : cosE < -1 ? -1 : cosE
  let E = Math.acos(cosE)
  if (radialVelocity < 0) E = TAU - E // inbound leg

  const M = E - e * Math.sin(E)
  let dM = Math.PI - M
  if (dM < 0) dM += TAU
  out.timeToApoapsis = dM / n
  // Periapsis sits at M = 0, so the next one is a full revolution minus M.
  out.timeToPeriapsis = (TAU - M) / n
}

/**
 * Integrator step ceiling, self-tuned from the craft's *local* circular period
 * about a given attractor.
 *
 * A 400 km orbit closes in 92 minutes, 426 times faster than the Moon, so the
 * 900 s ceiling that suits the planets would leave a low orbit with eight steps
 * per revolution. Deriving the limit from the current radius keeps roughly 400
 * steps per orbit wherever the craft is, and relaxes automatically as it climbs.
 *
 * The attractor has to be an argument rather than always Earth. A craft in a
 * 100 km lunar orbit is 400,000 km from Earth, so the geocentric form returns
 * the 900 s planetary ceiling — against a two-hour orbit, which is 7.9 steps per
 * revolution: the same failure this function exists to prevent, one body over.
 * Callers take the tightest limit over every attractor the craft is near.
 */
export function timestepLimit(radius, mu = MU_EARTH) {
  const period = 2 * Math.PI * Math.sqrt((radius * radius * radius) / mu)
  return clamp(period / 400, 0.5, 900)
}

export { MU_EARTH, MU_MOON }
