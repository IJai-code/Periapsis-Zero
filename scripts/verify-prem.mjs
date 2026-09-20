/**
 * Earth's interior, and the gravity field it implies — held to the planet.
 *
 * Objective 2 of the brief this engine was built to: a PREM mass model, the
 * zonal harmonics a rotating oblate body carries, and the local gravity of the
 * pad the vehicle leaves from. Three claims, and each is measured against
 * something outside `prem.js` rather than against itself:
 *
 *   1  the profile. Integrating PREM's density polynomials has to reproduce
 *      Earth's mass and its moment of inertia, land the published densities at
 *      the shell boundaries, and put the famous 10.7 m/s^2 peak at the
 *      core-mantle boundary — all of them published figures, not restatements
 *      of this code.
 *   2  the field. `zonalAccel` is checked against a numerical gradient of the
 *      potential it claims to be the gradient of; the integrator's own *inlined*
 *      copy of that arithmetic is checked against it by differencing the
 *      derivative with the field installed and without it; and the two secular
 *      rates the brief names — nodal regression and apsidal drift — are measured
 *      through the integrator and compared with the classical closed forms and
 *      with a real satellite.
 *   3  the pad. Every site's local g is compared with the standard gravity
 *      formula, the plumb line's deflection is checked to vanish at the equator
 *      and the poles and to peak in between, and the vehicle's liftoff
 *      thrust-to-weight is measured against the pad it actually stands on.
 *
 *   node --expose-gc scripts/verify-prem.mjs
 *
 * The orbit measurements zero the Moon's and Sun's masses, because the closed
 * forms being compared are for a J2 Earth alone and a three-body perturbation
 * over six revolutions is 0.3% of the smallest drift here. Everything else runs
 * against the simulation exactly as it is built.
 */
import {
  EARTH_FIELD,
  INERTIA_FACTOR,
  J2,
  J3,
  J4,
  PREM_INERTIA,
  PREM_MASS,
  PREM_RADIUS,
  REFERENCE_RADIUS,
  apsidalRate,
  deflectionOfVertical,
  densityAt,
  gravityAt,
  hydrostaticFlattening,
  hydrostaticJ2,
  massWithin,
  nodalRate,
  profileSeries,
  radialGravity,
  secularRates,
  zonalAccel,
} from '../src/sim/prem.js'
import { computeElements } from '../src/sim/ship.js'
import { createSimulation, INDEX } from '../src/sim/system.js'
import { BODIES, G, G0, SHIP } from '../src/sim/constants.js'
import { LAUNCH_SITES, siteDeflection, siteGravity } from '../src/sim/launchsite.js'
import { SPIN_AXIS } from '../src/sim/atmosphere.js'
import {
  SMALLEST_OBJECT,
  allocatesNothing,
  bytesPerCall,
  knownAllocation,
  sampleText,
  seesAllocation,
} from './allocation.mjs'

const MU = G * BODIES.earth.mass
const R = BODIES.earth.radius
const DEG = 180 / Math.PI
const RAD = Math.PI / 180

/* ---------------------------------------------------------------- *\
 * 1. The profile
\* ---------------------------------------------------------------- */

/** What PREM is published with — the outside reference this is measured against. */
const PUBLISHED_MASS = 5.9742e24
const PUBLISHED_INERTIA = 8.0378e37
const PUBLISHED_FACTOR = 0.330715
/** The peak of g, at the core-mantle boundary: quoted as 10.7 m/s^2. */
const CMB_G = 10.689

const massErr = PREM_MASS / PUBLISHED_MASS - 1
const inertiaErr = PREM_INERTIA / PUBLISHED_INERTIA - 1
const factorErr = INERTIA_FACTOR / PUBLISHED_FACTOR - 1

console.log('=== the profile, integrated ===')
console.log(`  mass              ${PREM_MASS.toExponential(6)} kg — ${(massErr * 100).toFixed(3)}% from the published ${(PUBLISHED_MASS / 1e24).toFixed(4)}e24`)
console.log(`  moment of inertia ${PREM_INERTIA.toExponential(6)} kg m^2 — ${(inertiaErr * 100).toFixed(3)}% from ${(PUBLISHED_INERTIA / 1e37).toFixed(4)}e37`)
console.log(`  C / M R^2         ${INERTIA_FACTOR.toFixed(6)} — ${(factorErr * 100).toFixed(3)}% from the quoted ${PUBLISHED_FACTOR}`)
console.log(`  against the simulator's own mass, ${(PREM_MASS / BODIES.earth.mass - 1).toExponential(3)} high`)

/**
 * The densities PREM is quoted at, at the radii a reader will have seen them.
 *
 * Note the two at 3,480 km. The core-mantle boundary is the biggest density step
 * in the planet — silicate at 5.57 g/cm^3 meeting liquid iron at 9.90 — and
 * reading it as one number, or reading the *outer core* polynomial at the bottom
 * of the mantle, is the mistake this table is laid out to catch. The mantle side
 * is the lower-mantle cubic, the core side is the outer-core cubic, and they
 * differ by 78%.
 */
const ANCHORS = [
  ['centre', 0, 13088.5],
  ['inner core, at the ICB', 1221.5e3 - 1, 12763.6],
  ['outer core, at the ICB', 1221.5e3 + 1, 12166.3],
  ['outer core, at the CMB', 3480e3 - 1, 9903.4],
  ['lower mantle, at the CMB', 3480e3 + 1, 5566.4],
  ['top of D"', 5701e3 + 1, 3992.1],
  ['crust, at the Moho', 6346.6e3 + 1, 2900],
  ['upper crust', 6356e3 + 1, 2600],
  ['surface', 6371e3, 2600],
]
console.log('\n=== the shells ===')
console.log('  boundary                    r (km)   rho (kg/m^3)     quoted')
let densitiesMatch = true
for (const [name, r, quoted] of ANCHORS) {
  const rho = densityAt(r)
  const ok = Math.abs(rho - quoted) < 0.5
  if (!ok) densitiesMatch = false
  console.log(`  ${name.padEnd(24)} ${(r / 1e3).toFixed(1).padStart(7)} ${rho.toFixed(1).padStart(14)} ${quoted.toFixed(1).padStart(10)}${ok ? '' : '   <-- MISMATCH'}`)
}

/**
 * The seams, and the one property they must all have.
 *
 * PREM resolves each seismic discontinuity as a first-order change, so most
 * seams jump; what none of them may do is jump *upward*, because a profile whose
 * density increases outward is gravitationally unstable and no inversion ever
 * returns one. That is the invariant worth asserting — it catches a shell
 * coefficient entered in the wrong shell, which is exactly the failure a
 * hand-checked table invites (the outer-core cubic read at the bottom of the
 * mantle reports 9,903 where 5,566 is right).
 */
const SEAMS = [
  ['inner core / outer core', 1221.5e3],
  ['outer core / lower mantle', 3480e3],
  ['lower mantle / D"', 5701e3],
  ['D" / lower mantle II', 5771e3],
  ['upper mantle / transition zone', 5971e3],
  ['upper mantle / LVZ', 6151e3],
  ['crust / mantle (Moho)', 6346.6e3],
  ['upper crust / lower crust', 6356e3],
]
console.log('\n=== the seams ===')
console.log('  seam                        r (km)   below      above     step')
let seamsFall = true
let continuousOnly = 0
const steps = []
for (const [name, r] of SEAMS) {
  const below = densityAt(r - 1)
  const above = densityAt(r + 1)
  const step = below - above
  steps.push([name, step])
  if (step < -0.5) seamsFall = false
  if (Math.abs(step) < 0.5) continuousOnly++
  console.log(`  ${name.padEnd(24)} ${(r / 1e3).toFixed(1).padStart(7)} ${below.toFixed(1).padStart(9)} ${above.toFixed(1).padStart(10)} ${step.toFixed(1).padStart(10)}`)
}
const biggest = steps.reduce((a, b) => (Math.abs(a[1]) >= Math.abs(b[1]) ? a : b))
const icbStep = steps[0][1]
console.log(`  the biggest step is ${Math.abs(biggest[1]).toFixed(0)} kg/m^3 at the ${biggest[0]}; the one seam that closes is D"/lower-mantle-II at ${continuousOnly ? '5771 km' : 'nowhere'}`)

/* g(r), and its shape. */
let peak = 0
let peakAt = 0
for (let r = 1e4; r <= PREM_RADIUS; r += 1e3) {
  const v = gravityAt(r)
  if (v > peak) {
    peak = v
    peakAt = r
  }
}
/**
 * And the law g(r) has to obey if it is really the field of this density:
 *
 *   dg/dr = 4 pi G rho(r) - 2 G M(r) / r^3
 *
 * which is what differentiating G M(r)/r^2 gives once dM/dr = 4 pi r^2 rho. It is
 * the interior's equivalent of the gradient check on the harmonics: a statement
 * about the profile and the field together that neither produces alone, and one
 * that would fail if a shell's coefficients were paired with another shell's
 * radius range. Measured with a central difference of `gravityAt`; the three
 * kilometres either side of a density step are skipped, because no difference
 * straddling a discontinuity can be taken at all.
 *
 * The sign of it is why g is not monotone in r. Outward of the core-mantle
 * boundary the mantle's 5.6 g/cm^3 is well under two thirds of the mean density
 * inside, so g falls; inside, the outer core's 9.9 to 12.2 is over it, so g
 * climbs — which is where the 10.7 m/s^2 peak above comes from.
 */
let worstLaw = 0
for (let r = 2e5; r <= PREM_RADIUS - 1e3; r += 1e3) {
  let nearSeam = false
  for (const [, s] of SEAMS) if (Math.abs(r - s) < 3e3) nearSeam = true
  if (nearSeam) continue
  const h = 500
  const numeric = (gravityAt(r + h) - gravityAt(r - h)) / (2 * h)
  const analytic = 4 * Math.PI * G * densityAt(r) - (2 * G * massWithin(r)) / (r * r * r)
  worstLaw = Math.max(worstLaw, Math.abs(numeric - analytic))
}
let massMonotone = true
let running = 0
for (let r = 1e5; r <= PREM_RADIUS; r += 1e5) {
  const next = massWithin(r)
  if (next < running) massMonotone = false
  running = next
}
const sphereG = MU / (R * R)
console.log('\n=== g(r) ===')
console.log(`  peak              ${peak.toFixed(5)} m/s^2 at ${(peakAt / 1e3).toFixed(0)} km (the core-mantle boundary is at 3480)`)
console.log(`  at the surface    ${gravityAt(PREM_RADIUS).toFixed(5)} m/s^2, against ${sphereG.toFixed(5)} for the same mass as a point`)
console.log(`  at the centre     ${gravityAt(0).toFixed(5)}`)
console.log(`  at 2,000 km       ${gravityAt(2000e3).toFixed(5)} m/s^2, rising inward of the peak`)
console.log(`  dg/dr             worst departure from 4 pi G rho - 2 G M / r^3 is ${worstLaw.toExponential(2)} m/s^2 per m, against a scale of ${(4 * Math.PI * G * 5500).toExponential(2)}`)

/* ---------------------------------------------------------------- *\
 * 2. The field
\* ---------------------------------------------------------------- */

const P2 = (u) => 1.5 * u * u - 0.5
const P3 = (u) => 0.5 * (5 * u * u * u - 3 * u)
const P4 = (u) => 0.125 * (35 * u ** 4 - 30 * u * u + 3)

/**
 * The potential the doc comment claims: U = (mu/r)[1 - sum J_n (R/r)^n P_n(u)],
 * whose gradient is the acceleration. Written independently of `zonalAccel` and
 * of its quartic A/B forms, so an error in either shows up as a disagreement
 * rather than as a shared mistake.
 */
function potential(x, y, z) {
  const r = Math.hypot(x, y, z)
  const u = (x * SPIN_AXIS[0] + y * SPIN_AXIS[1] + z * SPIN_AXIS[2]) / r
  const s = REFERENCE_RADIUS / r
  return (MU / r) * (1 - J2 * s * s * P2(u) - J3 * s * s * s * P3(u) - J4 * s ** 4 * P4(u))
}

const _a = new Float64Array(3)
/**
 * `zonalAccel` against a central difference of `potential`.
 *
 * The monopole's own gradient is subtracted out of the numerical one, because
 * `zonalAccel` returns the perturbation alone. Samples sit on and off the
 * equator and at four radii, since J3 is odd in u and a symmetric test would
 * not see its sign.
 */
const SAMPLES = [
  [6778e3, 0, 0],
  [0, 6778e3, 0],
  [0, 0, 6778e3],
  [4790e3, 3400e3, -2800e3],
  [-6100e3, 1200e3, 1900e3],
  [300e3, -6800e3, 900e3],
  [2000e3, 2000e3, 6000e3],
  [42164e3, -1e6, 500e3],
]
let worstGradient = 0
let worstGradientAt = ''
for (const p of SAMPLES) {
  const r = Math.hypot(p[0], p[1], p[2])
  zonalAccel(_a, p[0], p[1], p[2], r * r, EARTH_FIELD)
  const k = MU / (r * r * r)
  for (let axis = 0; axis < 3; axis++) {
    const h = 25 // metres — the series is smooth at this scale
    const lo = p.slice()
    const hi = p.slice()
    lo[axis] -= h
    hi[axis] += h
    const numeric = (potential(hi[0], hi[1], hi[2]) - potential(lo[0], lo[1], lo[2])) / (2 * h) + k * p[axis]
    const off = Math.abs(numeric - _a[axis])
    if (off > worstGradient) {
      worstGradient = off
      worstGradientAt = `${(p[0] / 1e3).toFixed(0)}, ${(p[1] / 1e3).toFixed(0)}, ${(p[2] / 1e3).toFixed(0)} km`
    }
  }
}
console.log('\n=== the field ===')
console.log(`  gradient          worst disagreement ${worstGradient.toExponential(2)} m/s^2, at (${worstGradientAt})`)

const sim = createSimulation()
// Isolate the quadrupole: the closed forms below are for a J2 Earth alone.
sim.rails = null
sim.masses[INDEX.moon] = 0
sim.masses[INDEX.sun] = 0
const o = INDEX.ship * 6
const c = INDEX.earth * 6

/** The body-fixed basis: e3 the spin axis, e1 the prime meridian, e2 = e3 x e1. */
const E1 = [1, 0, 0]
const E2 = [SPIN_AXIS[1] * E1[2] - SPIN_AXIS[2] * E1[1], SPIN_AXIS[2] * E1[0] - SPIN_AXIS[0] * E1[2], SPIN_AXIS[0] * E1[1] - SPIN_AXIS[1] * E1[0]]

/**
 * Put the craft on an orbit with a stated semi-major axis, eccentricity,
 * inclination and argument of periapsis, at periapsis.
 *
 * Periapsis rather than a generic point, because the speed at a stated radius
 * then has one answer: vis-viva at r = a(1-e) is sqrt(mu (1+e) / (a (1-e))), which
 * is what the closed forms for the secular rates were linearised about. The
 * argument is deliberately not zero — placed *on* the node line, every sample
 * would be a node crossing and the drift would be measured as zero.
 */
function place(a, e, inclinationDeg, argpDeg) {
  const inc = inclinationDeg * RAD
  const argp = argpDeg * RAD
  const rp = a * (1 - e)
  // In-plane basis: the node direction n = e1, and the direction in the orbit
  // plane ninety degrees along the motion, tilted off the equator by i.
  const mx = Math.cos(inc) * E2[0] + Math.sin(inc) * SPIN_AXIS[0]
  const my = Math.cos(inc) * E2[1] + Math.sin(inc) * SPIN_AXIS[1]
  const mz = Math.cos(inc) * E2[2] + Math.sin(inc) * SPIN_AXIS[2]
  const rhat = [Math.cos(argp) * E1[0] + Math.sin(argp) * mx, Math.cos(argp) * E1[1] + Math.sin(argp) * my, Math.cos(argp) * E1[2] + Math.sin(argp) * mz]
  const vhat = [-Math.sin(argp) * E1[0] + Math.cos(argp) * mx, -Math.sin(argp) * E1[1] + Math.cos(argp) * my, -Math.sin(argp) * E1[2] + Math.cos(argp) * mz]
  const v = Math.sqrt((MU * (1 + e)) / rp)
  const s = sim.state
  for (let k = 0; k < 3; k++) {
    s[o + k] = s[c + k] + rhat[k] * rp
    s[o + 3 + k] = s[c + 3 + k] + vhat[k] * v
  }
  return { a, e, inc }
}


/**
 * The perturbation the *integrator* applies, differenced out of its own
 * derivative: the same state with the field installed and with it removed. The
 * inlined copy in `rk4.js` can drift from the reference, and this is the
 * measurement that notices — the position, not a second reading of the formula.
 */
let integratorGap = 0
let bodiesStill = true
{
  const n = sim.state.length
  const withField = new Float64Array(n)
  const without = new Float64Array(n)
  sim.derivative(sim.state, withField)
  const saved = sim.zonal
  sim.zonal = null
  sim.derivative(sim.state, without)
  sim.zonal = saved
  const rx = sim.state[o] - sim.state[c]
  const ry = sim.state[o + 1] - sim.state[c + 1]
  const rz = sim.state[o + 2] - sim.state[c + 2]
  zonalAccel(_a, rx, ry, rz, rx * rx + ry * ry + rz * rz, EARTH_FIELD)
  for (let k = 0; k < 3; k++) integratorGap = Math.max(integratorGap, Math.abs(withField[o + 3 + k] - without[o + 3 + k] - _a[k]))
  // One-way: the field perturbs the craft and leaves the planet's own
  // acceleration bit-identical, which is what keeps every figure ever measured
  // about the three-body solution a figure about three point masses.
  for (let b = 0; b < sim.massiveCount; b++) for (let k = 0; k < 6; k++) if (withField[b * 6 + k] !== without[b * 6 + k]) bodiesStill = false
}
console.log(`  the integrator    differs from that reference by ${integratorGap.toExponential(2)} m/s^2`)
console.log(`  and the massive bodies' accelerations are ${bodiesStill ? 'bit-identical' : 'CHANGED'} with the field installed`)

/** The node direction and the in-plane angle from it, for a state. */
const _frame = { raan: 0, ang: 0 }
function frame(rx, ry, rz, vx, vy, vz) {
  const hx = ry * vz - rz * vy
  const hy = rz * vx - rx * vz
  const hz = rx * vy - ry * vx
  // Ascending node direction: the pole crossed with the orbit normal.
  let nx = SPIN_AXIS[1] * hz - SPIN_AXIS[2] * hy
  let ny = SPIN_AXIS[2] * hx - SPIN_AXIS[0] * hz
  let nz = SPIN_AXIS[0] * hy - SPIN_AXIS[1] * hx
  const nl = Math.hypot(nx, ny, nz)
  nx /= nl
  ny /= nl
  nz /= nl
  const rl = Math.hypot(rx, ry, rz)
  const hl = Math.hypot(hx, hy, hz)
  // In-plane direction perpendicular to the node, along the motion.
  const px = (hy * nz - hz * ny) / hl
  const py = (hz * nx - hx * nz) / hl
  const pz = (hx * ny - hy * nx) / hl
  _frame.raan = Math.atan2(nx * E2[0] + ny * E2[1] + nz * E2[2], nx)
  _frame.ang = Math.atan2((rx * px + ry * py + rz * pz) / rl, (rx * nx + ry * ny + rz * nz) / rl)
  return _frame
}

/**
 * The secular rates, measured where they are well conditioned: at periapsis.
 *
 * At periapsis, the in-plane angle from the node line *is* the argument of
 * periapsis — no eccentricity vector involved. That distinction is not cosmetic.
 * Taking it from the eccentricity vector instead was tried first and reported
 * the apsidal drift 2.2% low at e 0.05 and 62% low at e 0.01, because at low
 * eccentricity that vector is dominated by J2's short-period wobble rather than
 * by the orbit, and the contamination falls off as 1/e. The *position* at
 * periapsis has no such problem: r is quadratic in time about it, so passing
 * through the radial velocity's zero by linear interpolation locates it to
 * metres, and the angle is what the orbit actually has. Same orbits, same
 * integrator, measured 1.26% low instead of 2.2% with J2 alone installed and
 * 0.19% with the real field.
 *
 * Nothing here is read off a fitted conic, so what is measured is the orbit the
 * craft is flying. `place` puts periapsis 25 degrees off the node deliberately —
 * on the node line, the node and periapsis angles would be degenerate.
 */
function measure(a, e, inclinationDeg, revolutions, h, field) {
  sim.zonal = field
  place(a, e, inclinationDeg, 25)
  const passages = []
  const limit = Math.ceil((2 * Math.PI * Math.sqrt((a * a * a) / MU) * (revolutions + 2)) / h)
  let t = 0
  let pr = null
  for (let i = 0; i < limit && passages.length <= revolutions; i++) {
    const s = sim.state
    const rx = s[o] - s[c]
    const ry = s[o + 1] - s[c + 1]
    const rz = s[o + 2] - s[c + 2]
    const vx = s[o + 3] - s[c + 3]
    const vy = s[o + 4] - s[c + 4]
    const vz = s[o + 5] - s[c + 5]
    const rv = rx * vx + ry * vy + rz * vz
    if (pr !== null && pr.rv < 0 && rv >= 0) {
      const f = pr.rv / (pr.rv - rv)
      const fr = frame(
        pr.x + (rx - pr.x) * f,
        pr.y + (ry - pr.y) * f,
        pr.z + (rz - pr.z) * f,
        pr.vx + (vx - pr.vx) * f,
        pr.vy + (vy - pr.vy) * f,
        pr.vz + (vz - pr.vz) * f,
      )
      passages.push({ t: t - h + f * h, raan: fr.raan, ang: fr.ang })
    }
    pr = { rv, x: rx, y: ry, z: rz, vx, vy, vz }
    sim.step(h)
    t += h
  }
  let raanTotal = 0
  let argpTotal = 0
  for (let i = 1; i < passages.length; i++) {
    // The node barely moves between revolutions, so its difference belongs in
    // (-pi, pi]; periapsis passes once a revolution, so its difference belongs
    // in [pi, 3pi) — one full turn is the baseline being removed below.
    let d = passages[i].raan - passages[i - 1].raan
    while (d > Math.PI) d -= 2 * Math.PI
    while (d < -Math.PI) d += 2 * Math.PI
    raanTotal += d
    let b = passages[i].ang - passages[i - 1].ang
    while (b < Math.PI) b += 2 * Math.PI
    argpTotal += b
  }
  const dt = passages[passages.length - 1].t - passages[0].t
  const turns = passages.length - 1
  return { hours: dt / 3600, turns, raan: raanTotal / dt, argp: (argpTotal - 2 * Math.PI * turns) / dt }
}

/** The field as `system.js` installs it, and the same field with J3 and J4 cut. */
const FIELD = { ...EARTH_FIELD, body: INDEX.earth }
const J2_ONLY = { ...FIELD, J: Float64Array.from([J2, 0, 0]) }

const A = 6778e3
const ECC = 0.05
const INC = 51.64
const measured = measure(A, ECC, INC, 8, 2, FIELD)
const withoutJ34 = measure(A, ECC, INC, 8, 2, J2_ONLY)
const expectedNode = nodalRate(A, ECC, INC * RAD)
const expectedApsis = apsidalRate(A, ECC, INC * RAD)
const nodeErr = measured.raan / expectedNode - 1
const apsisErr = measured.argp / expectedApsis - 1
const pearShift = measured.argp / withoutJ34.argp - 1
console.log('\n=== the two rates the brief names, measured through the integrator ===')
console.log(`  orbit             6,778 km, e 0.05, i 51.64 deg; ${measured.turns} revolutions in ${measured.hours.toFixed(2)} h at a 2 s step`)
console.log(`  nodal regression  ${(measured.raan * 86400 * DEG).toFixed(4)} deg/day measured, ${(expectedNode * 86400 * DEG).toFixed(4)} from -(3/2) J2 n (R/p)^2 cos i — ${(nodeErr * 100).toFixed(2)}%`)
console.log(`  apsidal drift     ${(measured.argp * 86400 * DEG).toFixed(4)} deg/day measured, ${(expectedApsis * 86400 * DEG).toFixed(4)} from (3/4) J2 n (R/p)^2 (5cos^2 i - 1) — ${(apsisErr * 100).toFixed(2)}%`)
console.log(`  with J3 and J4    the same orbit on a J2-only field drifts ${(withoutJ34.argp * 86400 * DEG).toFixed(4)} deg/day, so the pear shape and the fourth harmonic move it ${(pearShift * 100).toFixed(2)}%`)
console.log(`                    and the node by ${((measured.raan / withoutJ34.raan - 1) * 100).toFixed(3)}%, which is why they are not decoration`)
console.log(`  against J2 alone  the closed forms are ${(((withoutJ34.raan / expectedNode) - 1) * 100).toFixed(2)}% and ${(((withoutJ34.argp / expectedApsis) - 1) * 100).toFixed(2)}% out — the second-order terms the first-order forms drop`)

/** And the number a real satellite flies at. */
const ISS_A = R + 410e3
const ISS_I = 51.64
const issRate = nodalRate(ISS_A, 0.0004, ISS_I * RAD) * 86400 * DEG
console.log(`  the station       ${issRate.toFixed(3)} deg/day at 410 km and ${ISS_I} deg; the figure quoted for the ISS is -5.0`)
const issOk = issRate < -4.8 && issRate > -5.2

/* ---------------------------------------------------------------- *\
 * 3. Rotation, and the pad
\* ---------------------------------------------------------------- */

const hf = hydrostaticFlattening()
const hJ2 = hydrostaticJ2()
console.log('\n=== the shape, from the interior ===')
console.log(`  Darwin-Radau f    ${hf.toExponential(6)} — 1/f = ${(1 / hf).toFixed(3)} against the planet's 298.257`)
console.log(`  hydrostatic J2    ${hJ2.toExponential(6)} against the observed ${J2.toExponential(6)} — ${((hJ2 / J2 - 1) * 100).toFixed(3)}%`)
console.log(`  the residual      ${((J2 - hJ2) * 1e6).toFixed(4)}e-6 of the bulge is not hydrostatic`)
console.log(`  deflection        0 deg ${(deflectionOfVertical(0) * DEG).toFixed(4)}, 45 deg ${(deflectionOfVertical(45) * DEG).toFixed(4)}, 90 deg ${(deflectionOfVertical(90) * DEG).toFixed(4)}`)

/**
 * The standard gravity formula, the datum a surveyor would use:
 *
 *   g(phi) = 9.780327 (1 + 0.0053024 sin^2 phi - 0.0000058 sin^2 2 phi)
 *
 * This simulator draws a sphere of the mean radius on purpose, so its pad
 * gravity is the gravity *of that sphere* and the two are not expected to agree
 * exactly. What is checked is that they agree to a quarter of a per cent, which
 * would fail if the interior or the quadrupole were wrong by an amount that
 * matters to a launch.
 */
const standardGravity = (latDeg) => {
  const s = Math.sin(latDeg * RAD)
  return 9.780327 * (1 + 0.0053024 * s * s - 0.0000058 * Math.sin(2 * latDeg * RAD) ** 2)
}

const LIFTOFF_MASS = SHIP.stages.reduce((m, s) => m + s.dryMass + s.propellant, 0)
const LIFTOFF_TW = SHIP.stages[0].thrust / (LIFTOFF_MASS * G0)
const kscTw = LIFTOFF_TW * (G0 / siteGravity(LAUNCH_SITES.ksc))

console.log('\n=== the pads ===')
console.log('  site         latitude    g (m/s^2)     standard    difference      T/W   plumb line')
let padsAgree = true
for (const site of Object.values(LAUNCH_SITES)) {
  const pad = siteGravity(site)
  const ref = standardGravity(site.latitude)
  const diff = pad / ref - 1
  if (Math.abs(diff) > 2.5e-3) padsAgree = false
  console.log(
    `  ${site.id.padEnd(12)} ${site.latitude.toFixed(3).padStart(7)} ${pad.toFixed(5).padStart(12)} ${ref.toFixed(5).padStart(12)} ${(diff * 100).toFixed(3).padStart(11)}% ${(LIFTOFF_TW * (G0 / pad)).toFixed(4).padStart(8)} ${(siteDeflection(site) * DEG).toFixed(4).padStart(9)} deg`,
  )
}
const heaviest = Object.values(LAUNCH_SITES).reduce((a, b) => (siteGravity(a) >= siteGravity(b) ? a : b))
const lightest = Object.values(LAUNCH_SITES).reduce((a, b) => (siteGravity(a) <= siteGravity(b) ? a : b))

/* The stack on its pad, as `createSimulation` leaves it, and the field there. */
const padSim = createSimulation()
const po = INDEX.ship * 6
const pc = INDEX.earth * 6
const prx = padSim.state[po] - padSim.state[pc]
const pry = padSim.state[po + 1] - padSim.state[pc + 1]
const prz = padSim.state[po + 2] - padSim.state[pc + 2]
const padRadius = Math.hypot(prx, pry, prz)
const padRadial = radialGravity(prx, pry, prz)
const padLatitude = Math.asin((prx * SPIN_AXIS[0] + pry * SPIN_AXIS[1] + prz * SPIN_AXIS[2]) / padRadius) * DEG
console.log('\n=== the stack on its pad ===')
console.log(`  clamped at        ${(padRadius - R).toFixed(3)} m above the drawn surface, at latitude ${padLatitude.toFixed(3)} deg`)
console.log(`  radial g          ${(-padRadial).toFixed(5)} m/s^2, of which the quadrupole and above is ${((padRadial + MU / (padRadius * padRadius)) * 1e3).toFixed(4)}e-3`)
const padOnSphere = Math.abs(padRadius - R) < 1

/**
 * And what the geophysics panel makes of those elements, which is the one place
 * they matter.
 *
 * Held to its pad the stack sits a few kilometres off the centre, and that state
 * reads as a *bound* orbit: a semi-major axis of a thousand kilometres with its
 * periapsis inside the planet. Every test the panel had passed it, and its two
 * closed forms came back at three and a half million degrees a day — one carries
 * the mean motion, and both carry (R/p)^2. The guard is that the orbit has to be
 * outside the planet, and the numbers it has to reject are these.
 */
const padElements = computeElements(padSim.state, po, pc)
const padLooksBound = padElements.bound && padElements.semiMajor > 0 && padElements.periapsisRadius > 0
const padIsNotAnOrbit = !(padElements.semiMajor > R && padElements.periapsisRadius > R)
console.log(`  elements          a ${(padElements.semiMajor / 1e3).toFixed(1)} km, periapsis ${(padElements.periapsisRadius / 1e3).toFixed(1)} km — ${padLooksBound ? 'bound to the naive test' : 'unbound'}, ${padIsNotAnOrbit ? 'so not an orbit' : 'WHICH IS AN ORBIT'}`)

/* ---------------------------------------------------------------- *\
 * 4. Allocation
\* ---------------------------------------------------------------- */

const SINK = new Float64Array(3)
const control = await knownAllocation()
const fieldBytes = await bytesPerCall(
  () => {
    zonalAccel(SINK, 4790e3, 3400e3, -2800e3, 4790e3 * 4790e3 + 3400e3 * 3400e3 + 2800e3 * 2800e3, EARTH_FIELD)
  },
  { calls: 20000, warm: 20000 },
)
const gravityBytes = await bytesPerCall(
  () => {
    SINK[0] = radialGravity(4790e3, 3400e3, -2800e3)
  },
  { calls: 20000, warm: 20000 },
)
console.log('\n=== allocation ===')
console.log(`  zonalAccel        ${sampleText(fieldBytes)}`)
console.log(`  radialGravity     ${sampleText(gravityBytes)}`)
console.log(`  a known one       ${sampleText(control)}`)

/**
 * And the series the geophysics panel draws, plus the elements it reads.
 *
 * The panel is the only place this model is visible, so what it puts on screen
 * is checked here rather than by eye: the profile must be the same model the
 * field is built from, at every sample, and the inclination the HUD reports must
 * be the one the orbit was given — the two rates in the panel are functions of
 * nothing else, so a wrong angle there would be a wrong perturbation printed
 * with four significant figures.
 */
const R_MAX = PREM_RADIUS * 1.06
const SERIES = 97
const sr = new Float64Array(SERIES)
const srho = new Float64Array(SERIES)
const sg = new Float64Array(SERIES)
profileSeries(sr, srho, sg, R_MAX)
let seriesMatches = Math.abs(sr[0]) < 1e-9 && Math.abs(sr[SERIES - 1] - R_MAX) < 1e-6
let rhoPeak = 0
let gPeakAt = 0
let gPeak = 0
for (let i = 0; i < SERIES; i++) {
  if (i > 0 && !(sr[i] > sr[i - 1])) seriesMatches = false
  if (sr[i] > PREM_RADIUS) {
    if (srho[i] !== 0) seriesMatches = false
    if (Math.abs(sg[i] - Math.abs(radialGravity(sr[i], 0, 0))) > 1e-12) seriesMatches = false
  } else {
    if (Math.abs(srho[i] - densityAt(sr[i])) > 1e-12) seriesMatches = false
    if (Math.abs(sg[i] - gravityAt(sr[i])) > 1e-12) seriesMatches = false
  }
  if (srho[i] > rhoPeak) rhoPeak = srho[i]
  if (sg[i] > gPeak) {
    gPeak = sg[i]
    gPeakAt = sr[i]
  }
}
const rates = secularRates(A, ECC, INC * RAD)
console.log('\n=== what the panel draws ===')
console.log(`  the series        ${SERIES} samples to ${(R_MAX / 1e3).toFixed(0)} km; peak density ${(rhoPeak / 1e3).toFixed(2)} g/cm^3, peak g ${gPeak.toFixed(3)} at ${(gPeakAt / 1e3).toFixed(0)} km`)
console.log(`  the craft's orbit ${(A / 1e3).toFixed(0)} km at ${INC} deg: the node walks ${rates.node.toFixed(3)} deg/day and the apsides ${rates.apsis.toFixed(3)}`)

/** The inclination the HUD reports, against the one the orbit was given. */
place(A, ECC, INC, 25)
const shown = computeElements(sim.state, o, c)
const shownDeg = shown.inclination * DEG
let inclinationOk = Math.abs(shownDeg - INC) < 0.01
// And a retrograde orbit reads above 90 degrees rather than negative.
let retrogradeOk = true
for (const test of [97, 145]) {
  place(A, ECC, test, 25)
  const got = computeElements(sim.state, o, c).inclination * DEG
  if (Math.abs(got - test) > 0.01) retrogradeOk = false
}
console.log(`  inclination       ${shownDeg.toFixed(4)} deg reported against ${INC} given; a retrograde orbit reports ${(computeElements(sim.state, o, c).inclination * DEG).toFixed(2)}`)

console.log('\n=== what this establishes ===')
const checks = [
  ["the integrated profile reproduces Earth's mass to a tenth of a per cent", Math.abs(massErr) < 1e-3],
  ['and its moment of inertia to half a per cent', Math.abs(inertiaErr) < 5e-3],
  ['giving C/MR^2 within 0.1% of the quoted 0.3307', Math.abs(factorErr) < 1e-3],
  ['every shell boundary carries its published density', densitiesMatch],
  ['no seam increases the density outward — the profile is stable everywhere', seamsFall],
  ['the core-mantle boundary is the biggest step, at 4,337 kg/m^3', Math.abs(biggest[1] - 4336.99) < 1],
  ['the inner core steps by 597 where the outer core meets it', Math.abs(icbStep - 597.28) < 1],
  ['and exactly one seam closes: 5771 km, where the two mantle fits agree', continuousOnly === 1],
  ['g peaks at the core-mantle boundary, at the quoted 10.7 m/s^2', Math.abs(peakAt - 3480e3) < 2e3 && Math.abs(peak - CMB_G) < 0.02],
  ['and g obeys dg/dr = 4 pi G rho - 2 G M / r^3 at every radius between the steps', worstLaw < 1e-9],
  ['the enclosed mass never decreases with radius', massMonotone],
  ['the zonal perturbation is the gradient of the potential it claims', worstGradient < 1e-6],
  ['and the integrator applies that same perturbation to the craft', integratorGap < 1e-9],
  ["while the massive bodies' accelerations are untouched by it", bodiesStill],
  ['nodal regression matches -(3/2) J2 n (R/p)^2 cos i to a per cent', Math.abs(nodeErr) < 0.01],
  ['apsidal drift matches (3/4) J2 n (R/p)^2 (5cos^2 i - 1) to a per cent', Math.abs(apsisErr) < 0.01],
  ['and J3 and J4, installed, move it by the per cent they should', pearShift < -0.005 && pearShift > -0.02],
  ['it is retrograde — the node walks backwards', measured.raan < 0],
  ['and the drift has the sign the inclination decides: below 63.4 deg it advances', measured.argp > 0],
  ["and the station's orbit precesses at the -5.0 deg/day the real one does", issOk],
  ["Darwin-Radau turns the interior's C/MR^2 into a flattening of 1/298", Math.abs(1 / hf - 298.257) < 0.5],
  ['whose J2 lands within 1% of the observed J2, and below it', hJ2 < J2 && hJ2 / J2 > 0.99],
  ['the deflection of the vertical is largest at 45 degrees, leaning equatorward', deflectionOfVertical(45) * DEG > 0.09 && deflectionOfVertical(45) * DEG < 0.11],
  ['and falls away either side of it to nearly nothing at the poles', Math.abs(deflectionOfVertical(90)) < 1e-6 && deflectionOfVertical(30) < deflectionOfVertical(45) && deflectionOfVertical(60) < deflectionOfVertical(45)],
  ['while the equator keeps a residual two thousandths of a degree wide, which is J3', deflectionOfVertical(0) * DEG > 1e-4 && deflectionOfVertical(0) * DEG < 4e-4],
  ["every pad's gravity is within a quarter per cent of the standard formula", padsAgree],
  ['at equal radius the equator is the heavier one, as an oblate body is', siteGravity(heaviest) > siteGravity(lightest)],
  ['the stack is clamped to the surface its gravity is read at', padOnSphere && Math.abs(padLatitude - 28.58) < 0.01],
  ['and the elements there pass the naive bound test but are not an orbit', padLooksBound && padIsNotAnOrbit],
  ["and the vehicle's liftoff thrust-to-weight is 1.16 on its own pad", kscTw > 1.16 && kscTw < 1.17],
  ['the panel\'s profile series is the same model the field is built from, at every sample', seriesMatches],
  ['and peaks at the core-mantle boundary with density and gravity both', Math.abs(gPeakAt - 3480e3) < 1e3 && Math.abs(rhoPeak - 13088.5) < 0.5],
  ['the inclination the HUD reports is the one the orbit was given, prograde', inclinationOk],
  ['and a retrograde orbit reads over ninety degrees, not negative', retrogradeOk],
  ['the panel\'s two rates are the closed forms, in degrees a day', Math.abs(rates.node + 5.0234) < 0.05 && Math.abs(rates.apsis - 3.7466) < 0.05],
  seesAllocation('the allocation measurement can see an allocation', control),
  allocatesNothing('the zonal field allocates nothing', fieldBytes, SMALLEST_OBJECT / 2),
  allocatesNothing("nor the pad's own gravity", gravityBytes, SMALLEST_OBJECT / 2),
]
let pass = true
for (const [label, ok] of checks) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`)
  if (!ok) pass = false
}
console.log(`\n  ${pass ? 'PASS' : 'FAIL'}`)
process.exit(pass ? 0 : 1)
