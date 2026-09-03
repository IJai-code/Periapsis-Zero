import { Vector3 } from 'three'
import { BODIES, ORDER } from './constants.js'
import { RK4NBody } from './rk4.js'
import { live } from './live.js'
import { INDEX } from './system.js'

/**
 * Forward trajectory projection and impulsive targeting.
 *
 * In an n-body field there is no closed form for "what lunar altitude does this
 * trajectory reach" — the Moon is pulling on the craft for the whole transfer,
 * which is precisely what a Hohmann solution omits. So the objective function is
 * evaluated by *flying* the trajectory in a scratch integrator and measuring
 * where it actually ends up.
 *
 * The scratch carries only Sun, Earth, Moon and the craft. Dropping the other
 * satellites is not just a saving: the live integrator's step ceiling is set by
 * the *lowest* craft in the fleet, so propagating with the ISS aboard would run
 * the whole four-day projection at a 14-second step sized for low Earth orbit.
 */

const SCRATCH_BODIES = 4 // sun, earth, moon, ship
const SLOTS = SCRATCH_BODIES * 6

const scratch = new RK4NBody(
  [BODIES.sun.mass, BODIES.earth.mass, BODIES.moon.mass, 0],
  new Float64Array(SLOTS),
  ORDER.length,
)

const SHIP = 3 * 6
const MOON = 2 * 6

/** Copy the live state into the scratch, optionally with a velocity impulse. */
function seed(dvx = 0, dvy = 0, dvz = 0) {
  const src = live.sim.state
  for (let i = 0; i < SLOTS; i++) scratch.state[i] = src[i]
  scratch.state[SHIP + 3] += dvx
  scratch.state[SHIP + 4] += dvy
  scratch.state[SHIP + 5] += dvz
  scratch.t = live.sim.t
}

/**
 * Fly forward until the craft's range to the Moon stops falling, and return
 * that minimum.
 *
 * The step is scaled by range over closing speed, so the projection takes long
 * strides across the empty middle of the transfer and tightens automatically as
 * the encounter develops — which is where the answer is actually decided.
 */
function closestApproach(maxSeconds) {
  let best = Infinity
  let elapsed = 0
  let steps = 0

  while (elapsed < maxSeconds && steps < 200000) {
    const dx = scratch.state[SHIP] - scratch.state[MOON]
    const dy = scratch.state[SHIP + 1] - scratch.state[MOON + 1]
    const dz = scratch.state[SHIP + 2] - scratch.state[MOON + 2]
    const range = Math.sqrt(dx * dx + dy * dy + dz * dz)

    if (range < best) best = range
    // Past the encounter once the range has clearly turned; stop before the
    // trajectory wanders somewhere irrelevant.
    else if (range > best * 1.05 && best < 1e9) break

    const vx = scratch.state[SHIP + 3] - scratch.state[MOON + 3]
    const vy = scratch.state[SHIP + 4] - scratch.state[MOON + 4]
    const vz = scratch.state[SHIP + 5] - scratch.state[MOON + 5]
    const closing = Math.sqrt(vx * vx + vy * vy + vz * vz) || 1

    const dt = Math.min(900, Math.max(1, (range / closing) * 0.05))
    scratch.step(dt)
    elapsed += dt
    steps++
  }
  return best
}

/** Projected lunar closest approach for the live state plus an impulse. */
export function projectApproach(dvx = 0, dvy = 0, dvz = 0, maxSeconds = 9 * 86400) {
  seed(dvx, dvy, dvz)
  return closestApproach(maxSeconds)
}

const EARTH = 1 * 6

/**
 * Fly forward until the *geocentric* radius stops falling, and return that
 * minimum — the vacuum perigee of a return trajectory.
 *
 * Two differences from the lunar version above, both forced by the approach
 * speed. The step is scaled harder, because a craft arriving at 11 km/s covers
 * 320 km in the 29 s the lunar scaling would hand out and a perigee sampled
 * that coarsely is worth nothing. And the minimum is refined by fitting a
 * parabola through the three samples that bracket it, which is exact to second
 * order for a smooth minimum and costs three multiplications — without it the
 * answer is biased *high* by half the curvature times a half-step squared,
 * about 1 km even at the tighter step.
 *
 * The craft starts near the Moon, where geocentric range is still rising as it
 * climbs out of the lunar well, so the turn is only believed once the range has
 * actually fallen a long way from where it started.
 */
function perigeeMinimum(maxSeconds) {
  let best = Infinity
  let prev = Infinity
  let prevPrev = Infinity
  let bestDt = 0
  let elapsed = 0
  let steps = 0
  let falling = false
  let startRange = 0

  while (elapsed < maxSeconds && steps < 400000) {
    const dx = scratch.state[SHIP] - scratch.state[EARTH]
    const dy = scratch.state[SHIP + 1] - scratch.state[EARTH + 1]
    const dz = scratch.state[SHIP + 2] - scratch.state[EARTH + 2]
    const range = Math.sqrt(dx * dx + dy * dy + dz * dz)

    if (startRange === 0) startRange = range

    if (range < best) {
      best = range
      falling = true
      /**
       * A turn only counts once the craft is genuinely near Earth.
       *
       * A return projection begins in lunar orbit, where the *geocentric* range
       * wobbles by a couple of thousand km every revolution as the craft swings
       * around the Moon — and on the way out of the lunar well it does it again
       * more slowly. Accepting the first sample that rises took one of those
       * wobbles for perigee and reported 365,000 km, against which the solver
       * dutifully computed a 1,888 m/s "correction" and drained the service
       * module. Requiring the range to have at least halved first puts the test
       * unambiguously past the Moon.
       */
    } else if (falling && best < startRange * 0.5 && range > best) {
      // Turned. The true minimum lies between the last three samples; fit a
      // parabola through them and take its vertex.
      const a = prevPrev
      const b = prev
      const c = range
      const denom = a - 2 * b + c
      if (denom > 0) {
        const shift = (0.5 * (a - c)) / denom // in units of the step, from b
        const refined = b - 0.25 * ((a - c) * shift)
        if (refined > 0 && refined < b) return refined
      }
      return best
    }

    prevPrev = prev
    prev = range

    const vx = scratch.state[SHIP + 3] - scratch.state[EARTH + 3]
    const vy = scratch.state[SHIP + 4] - scratch.state[EARTH + 4]
    const vz = scratch.state[SHIP + 5] - scratch.state[EARTH + 5]
    const closing = Math.sqrt(vx * vx + vy * vy + vz * vz) || 1

    /**
     * The step has to satisfy *both* attractors, not just the one being
     * targeted. A return projection starts in a 100 km lunar orbit, where the
     * geocentric scaling alone asks for 380,000 km over 1 km/s — pinned at the
     * 900 s ceiling, which is eight steps per lunar revolution and tears the
     * craft off the Moon before it has left. The selenocentric term dominates
     * until the craft is clear, and the geocentric one from then on.
     */
    const mx = scratch.state[SHIP] - scratch.state[MOON]
    const my = scratch.state[SHIP + 1] - scratch.state[MOON + 1]
    const mz = scratch.state[SHIP + 2] - scratch.state[MOON + 2]
    const mRange = Math.sqrt(mx * mx + my * my + mz * mz)
    const mvx = scratch.state[SHIP + 3] - scratch.state[MOON + 3]
    const mvy = scratch.state[SHIP + 4] - scratch.state[MOON + 4]
    const mvz = scratch.state[SHIP + 5] - scratch.state[MOON + 5]
    const mClosing = Math.sqrt(mvx * mvx + mvy * mvy + mvz * mvz) || 1

    bestDt = Math.min(
      900,
      Math.max(0.5, (range / closing) * 0.02),
      Math.max(0.5, (mRange / mClosing) * 0.02),
    )
    scratch.step(bestDt)
    elapsed += bestDt
    steps++
  }
  return best
}

/** Projected geocentric perigee for the live state plus an impulse. */
export function projectPerigee(dvx = 0, dvy = 0, dvz = 0, maxSeconds = 8 * 86400) {
  seed(dvx, dvy, dvz)
  return perigeeMinimum(maxSeconds)
}

/* ---------------------------------------------------------------- *
 * LVLH frame and the solver
 * ---------------------------------------------------------------- */

const _r = new Vector3()
const _v = new Vector3()
const _prograde = new Vector3()
const _normal = new Vector3()
const _radial = new Vector3()

/**
 * Orthonormal manoeuvre frame about the velocity vector.
 *
 * Built from v rather than from r on purpose. The textbook triad pairs the
 * radial and prograde directions directly, but a day after injection the craft
 * is climbing almost straight out and those two are nearly parallel — a basis
 * that would leave the Jacobian badly conditioned exactly where the solve
 * happens. Anchoring on velocity keeps all three axes genuinely independent.
 */
export function lvlhFrame() {
  const s = live.sim.state
  const o = INDEX.ship * 6
  const e = INDEX.earth * 6
  _r.set(s[o] - s[e], s[o + 1] - s[e + 1], s[o + 2] - s[e + 2])
  _v.set(s[o + 3] - s[e + 3], s[o + 4] - s[e + 4], s[o + 5] - s[e + 5])

  _prograde.copy(_v).normalize()
  _normal.crossVectors(_r, _v).normalize()
  _radial.crossVectors(_normal, _prograde).normalize()
  return { prograde: _prograde, normal: _normal, radial: _radial }
}

const _dv = new Vector3()

/** Convert an LVLH triple into a world-frame impulse. */
function toWorld(out, frame, p, n, rad) {
  return out
    .copy(frame.prograde)
    .multiplyScalar(p)
    .addScaledVector(frame.normal, n)
    .addScaledVector(frame.radial, rad)
}

/**
 * Solve for the smallest impulse that puts lunar closest approach at
 * `targetRadius`.
 *
 * Gauss-Newton on a single residual with three free variables. That system is
 * underdetermined — a whole two-parameter family of burns hits the same
 * periapsis — so the step is taken through the *minimum-norm* pseudo-inverse,
 *
 *     Δx = −residual Jᵀ / |J|²
 *
 * which of that family picks the cheapest. Damping is applied when a step
 * overshoots, because the residual is only locally linear in the impulse.
 *
 * This runs once, on command, not per frame: it costs several dozen full
 * trajectory projections and is deliberately not something the render loop
 * touches.
 */
export function solveImpulse(
  targetRadius,
  { iterations = 40, probe = 0.05, project = projectApproach, tolerance = 1000 } = {},
) {
  const frame = lvlhFrame()
  const x = [0, 0, 0] // prograde, normal, radial impulse, m/s
  const J = [0, 0, 0]

  let approach = project(0, 0, 0)
  let residual = approach - targetRadius
  const history = [{ iteration: 0, approach, residual, dv: 0 }]
  let converged = false

  for (let k = 0; k < iterations && Math.abs(residual) > tolerance; k++) {
    // Numerical Jacobian: one projection per axis.
    for (let axis = 0; axis < 3; axis++) {
      const trial = [x[0], x[1], x[2]]
      trial[axis] += probe
      toWorld(_dv, frame, trial[0], trial[1], trial[2])
      J[axis] = (project(_dv.x, _dv.y, _dv.z) - approach) / probe
    }

    const jj = J[0] * J[0] + J[1] * J[1] + J[2] * J[2]
    if (!(jj > 0) || !Number.isFinite(jj)) break

    // Minimum-norm Gauss-Newton step, damped back if it overshoots.
    let scale = 1
    let accepted = false
    for (let attempt = 0; attempt < 6; attempt++) {
      const trial = [
        x[0] - (scale * residual * J[0]) / jj,
        x[1] - (scale * residual * J[1]) / jj,
        x[2] - (scale * residual * J[2]) / jj,
      ]
      toWorld(_dv, frame, trial[0], trial[1], trial[2])
      const next = project(_dv.x, _dv.y, _dv.z)
      if (Number.isFinite(next) && Math.abs(next - targetRadius) < Math.abs(residual)) {
        x[0] = trial[0]
        x[1] = trial[1]
        x[2] = trial[2]
        approach = next
        residual = next - targetRadius
        accepted = true
        break
      }
      scale *= 0.5
    }
    history.push({
      iteration: k + 1,
      approach,
      residual,
      dv: Math.hypot(x[0], x[1], x[2]),
    })
    if (!accepted) break
    if (Math.abs(residual) <= tolerance) {
      converged = true
      break
    }
  }
  if (Math.abs(residual) <= tolerance) converged = true

  /**
   * Null-space refinement.
   *
   * Gauss-Newton takes the cheapest *step* each iteration, which is not the
   * cheapest *total* — the path wanders, and the accumulated impulse ends up
   * well above the true minimum. Because one residual against three variables
   * leaves a two-dimensional family of burns that all hit the same periapsis,
   * the excess can be walked off afterwards: slide along the component of x
   * that lies in the null space of J, which to first order does not move the
   * residual at all, then re-null whatever second-order drift appears.
   */
  for (let k = 0; k < 12 && Math.abs(residual) < 5 * tolerance; k++) {
    for (let axis = 0; axis < 3; axis++) {
      const trial = [x[0], x[1], x[2]]
      trial[axis] += probe
      toWorld(_dv, frame, trial[0], trial[1], trial[2])
      J[axis] = (project(_dv.x, _dv.y, _dv.z) - approach) / probe
    }
    const jj = J[0] * J[0] + J[1] * J[1] + J[2] * J[2]
    if (!(jj > 0)) break

    // Component of x along J, and the remainder that J cannot see.
    const along = (x[0] * J[0] + x[1] * J[1] + x[2] * J[2]) / jj
    const free = [x[0] - along * J[0], x[1] - along * J[1], x[2] - along * J[2]]
    const freeNorm = Math.hypot(free[0], free[1], free[2])
    if (freeNorm < 1e-3) break

    let improved = false
    for (let step = 0.6; step > 0.02; step *= 0.5) {
      const trial = [x[0] - step * free[0], x[1] - step * free[1], x[2] - step * free[2]]
      toWorld(_dv, frame, trial[0], trial[1], trial[2])
      let next = project(_dv.x, _dv.y, _dv.z)

      // Re-null the residual the slide introduced, along J.
      const corr = (next - targetRadius) / jj
      trial[0] -= corr * J[0]
      trial[1] -= corr * J[1]
      trial[2] -= corr * J[2]
      toWorld(_dv, frame, trial[0], trial[1], trial[2])
      next = project(_dv.x, _dv.y, _dv.z)

      const cheaper = Math.hypot(trial[0], trial[1], trial[2]) < Math.hypot(x[0], x[1], x[2])
      if (Number.isFinite(next) && Math.abs(next - targetRadius) < 2 * tolerance && cheaper) {
        x[0] = trial[0]
        x[1] = trial[1]
        x[2] = trial[2]
        approach = next
        residual = next - targetRadius
        improved = true
        break
      }
    }
    if (!improved) break
    history.push({
      iteration: `refine ${k + 1}`,
      approach,
      residual,
      dv: Math.hypot(x[0], x[1], x[2]),
    })
  }

  toWorld(_dv, frame, x[0], x[1], x[2])
  return {
    lvlh: { prograde: x[0], normal: x[1], radial: x[2] },
    world: [_dv.x, _dv.y, _dv.z],
    magnitude: Math.hypot(x[0], x[1], x[2]),
    approach,
    residual,
    /** False if the solve ran out of iterations — the impulse is then meaningless. */
    converged,
    history,
  }
}


/**
 * The outbound correction: smallest impulse that puts *lunar* closest approach
 * at `targetRadius`. Unchanged in behaviour — the defaults are what the solver
 * always used.
 */
export function solveMidCourse(targetRadius, opts = {}) {
  return solveImpulse(targetRadius, { project: projectApproach, ...opts })
}

/**
 * The return correction: smallest impulse that puts *geocentric* perigee at
 * `targetRadius`, which is the entry corridor.
 *
 * Same machinery, different objective, and it has to be this way round rather
 * than folded into the injection burn. Perigee runs 68.9 km per m/s of
 * transverse velocity at lunar distance, so a +-10 km corridor demands the
 * departure velocity to +-0.145 m/s out of 827 — two parts in ten thousand,
 * which no cutoff on a seven-minute burn can hold. The injection gets the
 * ballpark and this trims it, exactly as Apollo's MCC-5 through -7 did.
 *
 * The tolerance is tighter than the outbound solve's because the target is: a
 * corridor is a few km wide where a lunar periapsis was allowed a few hundred.
 */
export function solveReturnCorridor(targetRadius, opts = {}) {
  return solveImpulse(targetRadius, { project: projectPerigee, tolerance: 200, ...opts })
}
