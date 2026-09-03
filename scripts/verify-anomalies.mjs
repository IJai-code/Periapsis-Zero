/**
 * Independent check of the apsis clocks in `ship.js`.
 *
 * The elliptic branch was verified against Kepler when it was written; the
 * hyperbolic branch is what a capture burn is scheduled on, and an error there
 * puts periapsis in the future when it is already behind. So both are checked
 * the same way and against something that shares no code with them: a pure
 * two-body RK4 propagation, stepped finely enough that the true apsis passage
 * can be bracketed and refined by parabolic interpolation on the radius.
 *
 *   node scripts/verify-anomalies.mjs
 */

import { RK4NBody } from '../src/sim/rk4.js'
import { BODIES, G } from '../src/sim/constants.js'
import { computeLunarElements, lunarElements } from '../src/sim/ship.js'

const MU = G * BODIES.moon.mass

/**
 * Two bodies: the Moon in slot 0 as the only massive one, the craft in slot 1
 * as a test particle. Nothing pulls on the Moon, so it sits still and the
 * problem is exactly Kepler's, with no third-body contamination to argue about.
 */
function twoBody(rx, ry, rz, vx, vy, vz) {
  const st = new Float64Array(12)
  st[6] = rx
  st[7] = ry
  st[8] = rz
  st[9] = vx
  st[10] = vy
  st[11] = vz
  return new RK4NBody([BODIES.moon.mass, 0], st, 1)
}

/**
 * State on a conic of given periapsis radius and eccentricity, at true anomaly
 * `nu`. Built in the perifocal frame and then tilted, so the test exercises a
 * genuinely three-dimensional state rather than a planar one.
 */
function stateAt(rp, e, nu) {
  const p = rp * (1 + e) // semi-latus rectum
  const r = p / (1 + e * Math.cos(nu))
  const vr = Math.sqrt(MU / p) * e * Math.sin(nu)
  const vt = Math.sqrt(MU / p) * (1 + e * Math.cos(nu))

  // Perifocal, then rotated by 0.4 rad about x and 0.9 rad about z.
  const px = r * Math.cos(nu)
  const py = r * Math.sin(nu)
  const pvx = vr * Math.cos(nu) - vt * Math.sin(nu)
  const pvy = vr * Math.sin(nu) + vt * Math.cos(nu)

  const ci = Math.cos(0.4)
  const si = Math.sin(0.4)
  const co = Math.cos(0.9)
  const so = Math.sin(0.9)
  const rot = (x, y) => [co * x - so * ci * y, so * x + co * ci * y, si * y]

  return [...rot(px, py), ...rot(pvx, pvy)]
}

/** Fly forward and return the time of minimum radius, refined sub-step. */
function findPeriapsis(sim, dt, maxTime) {
  let prev2 = Infinity
  let prev1 = Infinity
  let t = 0
  while (t < maxTime) {
    const r = Math.hypot(
      sim.state[6] - sim.state[0],
      sim.state[7] - sim.state[1],
      sim.state[8] - sim.state[2],
    )
    // A minimum is bracketed once the middle sample is the smallest of three —
    // but only once three *real* samples exist. Testing earlier makes the
    // Infinity seeds look like a bracket and "finds" the starting radius, which
    // on an outbound leg is nowhere near periapsis.
    if (t > 2.5 * dt && prev1 < prev2 && prev1 < r) {
      // Parabolic vertex through (t-2dt, prev2), (t-dt, prev1), (t, r).
      const denom = prev2 - 2 * prev1 + r
      const offset = denom !== 0 ? (0.5 * (prev2 - r)) / denom : 0
      return { time: t - dt + offset * dt, radius: prev1 }
    }
    prev2 = prev1
    prev1 = r
    sim.step(dt)
    t += dt
  }
  return null
}

const rows = []
let worst = 0

for (const [label, rp, e, nus] of [
  ['hyperbolic e=1.5', 1837e3, 1.5, [-2.0, -1.5, -1.0, -0.5, -0.2]],
  ['hyperbolic e=3.0', 1837e3, 3.0, [-1.1, -0.8, -0.5, -0.2]],
  ['hyperbolic e=1.05', 1837e3, 1.05, [-2.4, -2.0, -1.5, -0.8]],
  ['elliptic  e=0.7', 1837e3, 0.7, [1.0, 2.0, 3.0, 4.0, 5.0]],
  ['elliptic  e=0.02', 1837e3, 0.02, [1.0, 2.5, 4.0, 5.5]],
]) {
  for (const nu of nus) {
    const s = stateAt(rp, e, nu)
    const sim = twoBody(...s)

    // Predicted, from the closed form under test.
    computeLunarElements(sim.state, 6, 0)
    const predicted = lunarElements.timeToPeriapsis
    const predictedRp = lunarElements.periapsisRadius

    // Measured, by flying it. Step fine enough that the interpolation is exact
    // to well under the tolerance being claimed.
    const dt = 0.05
    const found = findPeriapsis(sim, dt, Math.abs(predicted) * 4 + 20000)
    if (!found) {
      rows.push([label, nu, predicted, NaN, NaN])
      continue
    }
    const err = found.time - predicted
    const rErr = found.radius - predictedRp
    if (Math.abs(err) > worst) worst = Math.abs(err)
    rows.push([label, nu, predicted, found.time, err, rErr])
  }
}

console.log('  orbit              nu     predicted t_p       flown t_p        error      r_p error')
for (const [label, nu, p, f, err, rErr] of rows) {
  console.log(
    `  ${label.padEnd(18)} ${nu.toFixed(2).padStart(5)}  ${p.toFixed(4).padStart(14)} s ${f.toFixed(4).padStart(15)} s ` +
      `${err.toFixed(5).padStart(11)} s ${(rErr).toFixed(4).padStart(11)} m`,
  )
}
console.log(`\n  worst timing error over ${rows.length} cases: ${worst.toExponential(3)} s`)

/* The signed convention: past periapsis the clock must read negative. */
const past = stateAt(1837e3, 1.5, +0.6)
const simPast = twoBody(...past)
computeLunarElements(simPast.state, 6, 0)
console.log(
  `  outbound hyperbola at nu=+0.6: t_p = ${lunarElements.timeToPeriapsis.toFixed(2)} s ` +
    `(must be negative — periapsis is behind)`,
)
process.exit(worst < 0.01 && lunarElements.timeToPeriapsis < 0 ? 0 : 1)
