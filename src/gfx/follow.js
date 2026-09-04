/**
 * Camera follow filters, kept out of the rig so they can be measured.
 *
 * The chase camera's job is to sit at a point defined in the *craft's* body
 * frame, which means the point it is chasing moves whenever the craft rotates.
 * During a 180 degree capture flip or a run of entry bank reversals that target
 * moves fast, and how the filter behaves there is the whole question.
 *
 * Two are provided so they can be compared on the same recorded telemetry rather
 * than by eye.
 */

/**
 * First-order exponential lag — what the rig used, and the standard
 * frame-rate-independent form of `lerp` toward a target.
 *
 *     x += (target - x) (1 - exp(-rate dt))
 *
 * It is stable at any timestep and has no state beyond the position, which is
 * its appeal. It also has no memory of *motion*: the output depends only on the
 * current spatial error, so a target moving at constant speed is followed at a
 * constant offset behind, and a target that stops is approached asymptotically
 * from wherever the camera had got to. There is nothing in it that can
 * anticipate.
 */
export function expFollow(out, current, target, rate, dt) {
  const k = 1 - Math.exp(-rate * dt)
  out.x = current.x + (target.x - current.x) * k
  out.y = current.y + (target.y - current.y) * k
  out.z = current.z + (target.z - current.z) * k
  return out
}

/**
 * Critically damped spring, integrated exactly.
 *
 *     x'' = -2 w x' - w^2 (x - target)
 *
 * At damping ratio 1 this is the fastest approach that cannot overshoot, and
 * unlike the exponential lag it carries a velocity — so when the target
 * accelerates the camera is already moving, and when the target stops the camera
 * decelerates into it rather than creeping.
 *
 * Integrated by the closed-form solution rather than by stepping, which matters:
 * with x measured from the target, critical damping gives
 *
 *     x(t) = (A + B t) e^(-w t),   A = x0,  B = v0 + w x0
 *
 * so a single exp per step is both exact for a stationary target and
 * unconditionally stable. An explicit Euler version of the same equation goes
 * unstable at w dt > 2, which for a stiff camera is an ordinary frame.
 *
 * `vel` is state and is mutated. It must persist between frames — a spring whose
 * velocity is discarded each frame is just a worse exponential lag.
 */
export function springFollow(out, current, target, vel, omega, dt) {
  const e = Math.exp(-omega * dt)

  const dx = current.x - target.x
  const dy = current.y - target.y
  const dz = current.z - target.z

  const cx = (vel.x + omega * dx) * dt
  const cy = (vel.y + omega * dy) * dt
  const cz = (vel.z + omega * dz) * dt

  out.x = target.x + (dx + cx) * e
  out.y = target.y + (dy + cy) * e
  out.z = target.z + (dz + cz) * e

  vel.x = (vel.x - omega * cx) * e
  vel.y = (vel.y - omega * cy) * e
  vel.z = (vel.z - omega * cz) * e
  return out
}

/**
 * Convert a settling time to the spring's angular frequency.
 *
 * For critical damping the envelope decays as e^(-w t) with an extra factor of
 * (1 + w t), so the response is within about 2% of the target after w t ~ 6.
 * Quoting a settling time keeps the tuning in units anyone can picture.
 */
export const omegaForSettling = (seconds) => 6 / Math.max(seconds, 1e-6)

/**
 * The equivalent for the exponential filter, so the two can be compared at
 * matched aggression rather than at whatever constants each happened to carry.
 * The lag reaches 98% after about 4 time constants.
 */
export const rateForSettling = (seconds) => 4 / Math.max(seconds, 1e-6)
