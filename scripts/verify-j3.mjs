/**
 * J3, against the field the craft actually flies in.
 *
 * `mission.js` carries two closed forms that decide whether a parking orbit will
 * outlive its wait, and both are about the *odd* zonal:
 *
 *   e_J3 = |J3| R sin i / (2 J2 p)                the forced eccentricity
 *   omega_dot = 3/4 n J2 (R/p)^2 (5 cos^2 i - 1)  the apsidal rate it rides on
 *
 * Neither had a gate. `verify-loiter` flies the lifetime they protect and
 * `verify-radial` pins the short-period terms underneath them, but nothing held
 * the forms themselves to the integrator — so a sign slip in `J3_PERIGEE`, or a
 * factor in `perigeeMargin`, would have surfaced only as a mission that quietly
 * failed to survive its wait.
 *
 * ── what it is checked against, and what it is not ────────────────────
 *
 * Against `rk4.js`. The propagator is Cartesian and takes J2, J3 and J4 straight
 * off the position, so the pear-shape asymmetry is already in the force model and
 * there is no argument of perigee inside it to thread — omega lives in the closed
 * forms, which is the only place an element-space quantity can live when the
 * integrator does not work in elements. The honest test is therefore to fly the
 * real field and read the elements back out: two independent derivations of one
 * piece of physics, compared, rather than a tolerance anybody chose.
 *
 * Not against published precession rates. Those are not available offline, and
 * `verify-heating` already sets out why a figure quoted from memory is a
 * recollection and not a measurement. The one outside number here is the
 * critical inclination, and it is not quoted either — it is the root of
 * 5 cos^2 i = 1, computed.
 *
 * ── two things that had to be got right to measure anything ───────────
 *
 * **The angle is omega, not the longitude of perigee.** The first version read
 * the eccentricity vector's angle against a fixed equatorial direction, which is
 * omega + Omega, and the node regresses underneath it at about -5 deg/day. It
 * measured -2.02 deg/day where the closed form says +3.57 and the two looked
 * irreconcilable. Measured from the orbit's own ascending node — `axis x h` —
 * they agree. A sign disagreement is worth this much suspicion of the measurement
 * before it is taken as a disagreement about physics.
 *
 * **The orbit has to have an eccentricity to have an apsis.** Flown circular, the
 * eccentricity vector is the J2 ripple and its direction turns once an orbit, so
 * the "apsidal rate" came out at a few hundred degrees a day at every
 * inclination — the orbital period, aliased. These fly at e = 0.01 and are
 * sampled once per revolution, which removes the short-period content by
 * construction rather than by filtering it.
 *
 *   node scripts/verify-j3.mjs
 */
import { RK4NBody } from '../src/sim/rk4.js'
import { EARTH_FIELD } from '../src/sim/prem.js'
import { J3_PERIGEE, PROFILE, perigeeMargin } from '../src/sim/mission.js'
import { BODIES, G } from '../src/sim/constants.js'
import { SPIN_AXIS } from '../src/sim/atmosphere.js'

const MU = G * BODIES.earth.mass
const RE = EARTH_FIELD.radius
const J2 = EARTH_FIELD.J[0]
const J3 = EARTH_FIELD.J[1]
const AXIS = [SPIN_AXIS[0], SPIN_AXIS[1], SPIN_AXIS[2]]

const A = BODIES.earth.radius + 500e3
const ECC = 0.01
const PERIOD = 2 * Math.PI * Math.sqrt((A * A * A) / MU)
/** Substeps a revolution. 256 and 1024 agree to four figures; 16 is 3x out. */
const SUBSTEPS = 256
/** The field with the odd zonal lifted, for the difference that isolates it. */
const NO_J3 = Float64Array.from([J2, 0, EARTH_FIELD.J[2]])

/** The critical inclination, as the root of 5 cos^2 i = 1 rather than as a number. */
const CRITICAL = Math.acos(Math.sqrt(0.2))

const cross = (u, v) => [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]
const dot = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2]
const unit = (u) => {
  const m = Math.hypot(u[0], u[1], u[2])
  return [u[0] / m, u[1] / m, u[2] / m]
}

/* A triad on the spin axis, so every test orbit is inclined to the field's own
 * equator rather than to the z axis — the two differ here by the axis's tilt. */
const SEED = unit(cross(Math.abs(AXIS[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0], AXIS))
const ACROSS = unit(cross(AXIS, SEED))

/** A craft at perigee of an orbit of this inclination, in a field of these J. */
function launch(inc, J) {
  const rp = A * (1 - ECC)
  const vp = Math.sqrt((MU * (1 + ECC)) / rp)
  const dir = ACROSS.map((c, k) => c * Math.cos(inc) + AXIS[k] * Math.sin(inc))
  const sim = new RK4NBody(
    [BODIES.earth.mass, 0],
    Float64Array.from([
      0, 0, 0, 0, 0, 0,
      SEED[0] * rp, SEED[1] * rp, SEED[2] * rp,
      dir[0] * vp, dir[1] * vp, dir[2] * vp,
    ]),
    1,
  )
  sim.zonal = { body: 0, mu: MU, radius: RE, J, axis: EARTH_FIELD.axis }
  return sim
}

/** The osculating eccentricity vector and the orbit normal, from the raw state. */
function elements(sim) {
  const s = sim.state
  const r = [s[6], s[7], s[8]]
  const v = [s[9], s[10], s[11]]
  const rm = Math.hypot(r[0], r[1], r[2])
  const c = dot(v, v) / MU - 1 / rm
  const rv = dot(r, v) / MU
  return {
    e: [c * r[0] - rv * v[0], c * r[1] - rv * v[1], c * r[2] - rv * v[2]],
    h: unit(cross(r, v)),
  }
}

/**
 * Fly, sampling once a revolution. Returns the total turn of the argument of
 * perigee in radians and the eccentricity magnitude at every sample.
 */
function fly(inc, days, J) {
  const sim = launch(inc, J)
  const revs = Math.round((days * 86400) / PERIOD)
  const mags = new Float64Array(revs)
  let last = null
  let turn = 0
  for (let k = 0; k < revs; k++) {
    sim.advance(PERIOD, PERIOD / SUBSTEPS)
    const { e, h } = elements(sim)
    mags[k] = Math.hypot(e[0], e[1], e[2])
    /* omega is measured in the orbit plane from the ascending node, which is
     * where the equator's normal crosses the orbit's: axis x h. */
    const node = unit(cross(AXIS, h))
    const inPlane = unit(cross(h, node))
    const th = Math.atan2(dot(e, inPlane), dot(e, node))
    if (last !== null) {
      let d = th - last
      while (d > Math.PI) d -= 2 * Math.PI
      while (d < -Math.PI) d += 2 * Math.PI
      turn += d
    }
    last = th
  }
  return { turn, mags, days }
}

/** The closed form `mission.js` flies on, in degrees a day. */
function apsidalDegPerDay(inc) {
  const p = A * (1 - ECC * ECC)
  const n = Math.sqrt(MU / (A * A * A))
  const rad = ((0.75 * n * J2 * RE * RE) / (p * p)) * (5 * Math.cos(inc) ** 2 - 1)
  return (rad * 86400 * 180) / Math.PI
}

/* ---------------------------------------------------------------- *
 * 1. The apsidal rate, closed form against integration
 * ---------------------------------------------------------------- */

console.log('\n=== the apsidal rate, deg/day ===')
console.log('  inclination      closed form      integrated        error')
let worstAbs = 0
let worstRel = 0
const rates = []
for (const deg of [28.5, 51.6, 63.4349, 75, 98]) {
  const inc = (deg * Math.PI) / 180
  const { turn } = fly(inc, 20, EARTH_FIELD.J)
  const got = (turn * 180) / Math.PI / 20
  const want = apsidalDegPerDay(inc)
  const err = Math.abs(got - want)
  worstAbs = Math.max(worstAbs, err)
  /* Relative error only where the rate is large enough for one to mean
   * anything — at the critical inclination the denominator is zero. */
  if (Math.abs(want) > 1) worstRel = Math.max(worstRel, err / Math.abs(want))
  rates.push({ deg, want, got })
  console.log(
    `  ${deg.toFixed(4).padStart(9)}${want.toFixed(4).padStart(16)}${got.toFixed(4).padStart(16)}${err.toFixed(4).padStart(13)}`,
  )
}

const critical = fly(CRITICAL, 20, EARTH_FIELD.J)
const criticalRate = Math.abs((critical.turn * 180) / Math.PI / 20)
const smallestElsewhere = Math.min(...rates.filter((r) => Math.abs(r.deg - 63.4349) > 1).map((r) => Math.abs(r.got)))

console.log('\n=== the critical inclination ===')
console.log(`  root of 5 cos^2 i = 1        ${((CRITICAL * 180) / Math.PI).toFixed(4)} deg`)
console.log(`  the apsis turns there        ${criticalRate.toFixed(4)} deg/day`)
console.log(`  smallest rate anywhere else  ${smallestElsewhere.toFixed(4)} deg/day`)
console.log(`  and the sign flips across it: ${rates[1].got.toFixed(2)} below, ${rates[3].got.toFixed(2)} above`)

/* ---------------------------------------------------------------- *
 * 2. The forced eccentricity, isolated by difference
 * ---------------------------------------------------------------- *
 *
 * J3's contribution to e is far smaller than J2's, so it is not read off a
 * single flight. Two are flown from the same state in the same field but for
 * J3, and their difference is J3's work and nothing else. Each runs long enough
 * to cover an apsidal cycle, because the forced term goes round with perigee and
 * a shorter run would sample part of a wave and call it an amplitude.
 */

console.log('\n=== the forced eccentricity, J3 on minus J3 off ===')
console.log('  inclination    days     predicted      isolated      ratio')
let worstForced = 0
for (const [deg, days] of [[28.5, 40], [51.6, 120], [75, 150], [98, 110]]) {
  const inc = (deg * Math.PI) / 180
  const on = fly(inc, days, EARTH_FIELD.J)
  const off = fly(inc, days, NO_J3)
  let lo = on.mags[0] - off.mags[0]
  let hi = lo
  for (let k = 1; k < on.mags.length; k++) {
    const d = on.mags[k] - off.mags[k]
    if (d < lo) lo = d
    if (d > hi) hi = d
  }
  const isolated = 0.5 * (hi - lo)
  const predicted = (J3_PERIGEE * Math.sin(inc)) / (A * (1 - ECC * ECC))
  const ratio = isolated / predicted
  worstForced = Math.max(worstForced, Math.abs(ratio - 1))
  console.log(
    `  ${deg.toFixed(1).padStart(9)}${String(days).padStart(9)}${predicted.toExponential(3).padStart(15)}${isolated.toExponential(3).padStart(14)}${ratio.toFixed(3).padStart(11)}`,
  )
}

/* ---------------------------------------------------------------- *
 * 3. The margin the mission actually spends
 * ---------------------------------------------------------------- */

const inc = (51.6 * Math.PI) / 180
const cosI = Math.cos(inc)
const p = A * (1 - ECC * ECC)
const n = Math.sqrt(MU / (A * A * A))
const rate = Math.abs(((0.75 * n * J2 * RE * RE) / (p * p)) * (5 * cosI * cosI - 1))
const halfTurn = Math.PI / rate

console.log('\n=== perigeeMargin, over the intervals it is asked about ===')
console.log('   interval h       margin m    of the floor')
const margins = []
for (const hours of [1, 12, 48, 120, 215, 480]) {
  const m = perigeeMargin(A, ECC, cosI, hours * 3600)
  margins.push(m)
  console.log(
    `  ${String(hours).padStart(10)}${m.toFixed(1).padStart(15)}${((100 * m) / PROFILE.injectionFloor).toFixed(1).padStart(14)}%`,
  )
}
const atHalf = perigeeMargin(A, ECC, cosI, halfTurn)
const wellPast = perigeeMargin(A, ECC, cosI, halfTurn * 3)
console.log(`  perigee turns half round in ${(halfTurn / 3600 / 24).toFixed(1)} days; the margin there is ${atHalf.toFixed(0)} m`)

console.log('\n=== what this establishes ===')
const checks = [
  // The rate, against the integrator rather than against a remembered figure.
  ['the closed-form apsidal rate matches the integrated field', worstAbs < 0.5],
  ['and to a tenth, where the rate is large enough for that to mean anything', worstRel < 0.12],
  ['the apsis all but stands still at the critical inclination', criticalRate < 0.2 && criticalRate < smallestElsewhere / 10],
  ['the critical inclination is computed, not quoted', Math.abs(5 * Math.cos(CRITICAL) ** 2 - 1) < 1e-12],
  ['and the apsis turns the other way across it', rates[1].got > 0 && rates[3].got < 0],
  // The forced term, which is what J3_PERIGEE encodes.
  ['J3 alone forces the eccentricity the closed form predicts', worstForced < 0.1],
  ['and J3_PERIGEE is the amplitude that form is built from', Math.abs(J3_PERIGEE - (Math.abs(J3) * RE) / (2 * J2)) < 1e-9],
  ['which is a length, and the eccentricity is that length over the semi-latus rectum', J3_PERIGEE > 1e3 && J3_PERIGEE < 1e5],
  // The margin's shape, which is what the mission spends.
  ['the margin is a rounding error over an hour', margins[0] < PROFILE.injectionFloor * 0.005],
  ['and a real allowance over a wait', margins[4] > PROFILE.injectionFloor * 0.02],
  ['it grows with the interval rather than jumping', margins.every((m, i) => i === 0 || m >= margins[i - 1] - 1e-9)],
  ['and saturates past half a turn instead of coming back down', Math.abs(wellPast - atHalf) < 1e-6],
]
let pass = true
for (const [label, ok] of checks) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`)
  if (!ok) pass = false
}
console.log(`\n  worst apsidal error ${worstAbs.toFixed(3)} deg/day (${(worstRel * 100).toFixed(1)}% where measurable);` +
  ` worst forced-eccentricity error ${(worstForced * 100).toFixed(1)}%`)
console.log(`  ${pass ? 'PASS' : 'FAIL'}`)
process.exit(pass ? 0 : 1)
