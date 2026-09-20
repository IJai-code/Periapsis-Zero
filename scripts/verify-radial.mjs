/**
 * The short-period radial terms, measured against flight rather than argued about.
 *
 * There are two of them and they are not interchangeable — which is the whole
 * reason this file exists, because substituting one for the other was tried three
 * times. The semi-major axis carries
 *
 *   a_osc - a_mean = -(J2 R^2 / a_mean)(3 sin^2 phi - 1),   sin phi = sin i sin u
 *
 * and the radius carries
 *
 *   r - a_mean = (J2 R^2 / a_mean)( 3/4 sin^2 i - 1/2 + 1/4 sin^2 i cos 2u )
 *
 * Both are first order in J2, both are derived rather than fitted, and both are
 * checked here against one revolution of a flown parking orbit. They look alike
 * and behave nothing alike: over that revolution the axis's short-period content
 * is almost purely **second** harmonic at 9.8 km, while the radius's is almost
 * purely **first** — which is its eccentricity — at 10.0 km, with 1.6 km of
 * second. Feeding the axis's 9.8 km of 2u into a profile that carries 1.6 km of
 * it takes the drag integral from 4% out to 25% out, and that measurement is kept
 * below as a counter-example.
 *
 * The radius form is the one `decay.js` reads its air at, and it is what closed
 * `verify:loiter`'s lifetime error: 191.4 h against 206.5 flown became 204.8 h.
 * What this gate pins:
 *
 *   1. both forms are verified against flight — a change to `meanSemiMajor`,
 *      `zonalPotential` or the harmonics themselves has to keep them verified
 *   2. the radius and the semi-major axis really are different instruments
 *   3. the profile `decay.js` now flies is within one per cent of the flown arc's
 *      drag integral, where reading the air at the bare conic was four per cent out
 *   4. the second harmonic `rates` cannot carry — it is handed no argument of
 *      latitude — is worth under half a per cent, which is why omitting it is a
 *      decision rather than an oversight
 *
 *   node scripts/verify-radial.mjs
 */

import { flight, frame } from './flight.mjs'
import { live, refreshDerived, resetSimulation } from '../src/sim/live.js'
import { beginCountdown, commitTLI, currentPhase, resetMission } from '../src/sim/mission.js'
import { clearNodes } from '../src/sim/nodes.js'
import { WARP } from '../src/sim/warp.js'
import { selectSite, LAUNCH_SITES } from '../src/sim/launchsite.js'
import { SPIN_AXIS, density } from '../src/sim/atmosphere.js'
import { fieldOf, meanEccentricity, meanSemiMajor, zonalPotential } from '../src/sim/prem.js'
import { BODIES, G } from '../src/sim/constants.js'
import { INDEX } from '../src/sim/system.js'

const H = 3600
const C = INDEX.ship * 6
const E = INDEX.earth * 6
const MU = G * BODIES.earth.mass
const R = BODIES.earth.radius
const AX = SPIN_AXIS

/** The pad and hour `verify:loiter` flies its decaying-orbit scenario with. */
const SITE = 'vandenberg'
const HOUR = 144

/* ------------------------------------------------------------------ *
 * Fly to the commitment, then stop touching the vehicle.
 * ---------------------------------------------------------------- */

selectSite(SITE)
resetSimulation()
refreshDerived()
clearNodes()
flight.warp = WARP.d1
flight.lastWarpRequest = null
flight.warpBeforeBurn = null
flight.pilotWarp = null
resetMission()

const target = HOUR * H
for (let i = 0; live.sim.t < target - H && i < 2_000_000; i++) frame()
flight.pilotWarp = WARP.m1
for (let i = 0; live.sim.t < target && i < 2_000_000; i++) frame()
beginCountdown()

let committed = false
for (let i = 0; i < 3_000_000; i++) {
  if (currentPhase().id === 'COAST' && commitTLI()) {
    committed = true
    break
  }
  flight.pilotWarp = null
  frame()
}
if (!committed) {
  console.log('  FAIL  the vehicle never reached a commitment')
  process.exit(1)
}

/* Drag off, so what is measured is the geometry and the field, nothing else. */
live.sim.dragK[0] = 0
refreshDerived()

const field = fieldOf(live.sim)

/** Everything about one sample, geocentric, out of the state itself. */
function read() {
  const s = live.sim.state
  const rx = s[C] - s[E]
  const ry = s[C + 1] - s[E + 1]
  const rz = s[C + 2] - s[E + 2]
  const vx = s[C + 3] - s[E + 3]
  const vy = s[C + 4] - s[E + 4]
  const vz = s[C + 5] - s[E + 5]
  const r2 = rx * rx + ry * ry + rz * rz
  const r = Math.sqrt(r2)
  const v2 = vx * vx + vy * vy + vz * vz
  const hx = ry * vz - rz * vy
  const hy = rz * vx - rx * vz
  const hz = rx * vy - ry * vx
  const hm = Math.hypot(hx, hy, hz)
  const rv = rx * vx + ry * vy + rz * vz
  const k = v2 - MU / r
  const ex = (k * rx - rv * vx) / MU
  const ey = (k * ry - rv * vy) / MU
  const ez = (k * rz - rv * vz) / MU
  const hhx = hx / hm
  const hhy = hy / hm
  const hhz = hz / hm
  /* node: the spin axis crossed with the angular momentum; then the in-plane
   * perpendicular, so `u` is measured from the equator crossing as it is in the
   * potential the form comes from. */
  let nx = AX[1] * hz - AX[2] * hy
  let ny = AX[2] * hx - AX[0] * hz
  let nz = AX[0] * hy - AX[1] * hx
  const nm = Math.hypot(nx, ny, nz)
  nx /= nm
  ny /= nm
  nz /= nm
  const px = hhy * nz - hhz * ny
  const py = hhz * nx - hhx * nz
  const pz = hhx * ny - hhy * nx
  let u = Math.atan2(rx * px + ry * py + rz * pz, rx * nx + ry * ny + rz * nz)
  if (u < 0) u += 2 * Math.PI
  /* where the perigee itself is, so the candidate profile can be phased to the
   * orbit being flown rather than to an arbitrary E = 0 */
  let uPeri = Math.atan2(ex * px + ey * py + ez * pz, ex * nx + ey * ny + ez * nz)
  if (uPeri < 0) uPeri += 2 * Math.PI
  return {
    u,
    uPeri,
    r,
    v: Math.sqrt(v2),
    e: Math.hypot(ex, ey, ez),
    a: 1 / (2 / r - v2 / MU),
    am: meanSemiMajor(rx, ry, rz, vx, vy, vz, r2, field),
    em: meanEccentricity(rx, ry, rz, vx, vy, vz, r2, field),
    sinPhi: (rx * AX[0] + ry * AX[1] + rz * AX[2]) / r,
    phi: zonalPotential(rx, ry, rz, r2, field),
    cosI: hhx * AX[0] + hhy * AX[1] + hhz * AX[2],
  }
}

const first = read()
const aMean = first.am
const k = (field.J[0] * field.radius * field.radius) / aMean
const T = 2 * Math.PI * Math.sqrt((aMean * aMean * aMean) / MU)
const N = 512
const S = [first]
for (let i = 1; i < N; i++) {
  live.sim.advance(T / N, T / N)
  S.push(read())
}

const mean = (f) => S.reduce((s, x) => s + f(x), 0) / S.length

/**
 * The first two harmonics of a quantity as a function of argument of latitude,
 * fitted on the samples' own `u` so that no assumption about even spacing is
 * being made silently. Returns the amplitudes, which are what the claim is about.
 */
function harmonics(f) {
  const a0 = mean(f)
  const c1 = 2 * mean((x) => f(x) * Math.cos(x.u))
  const s1 = 2 * mean((x) => f(x) * Math.sin(x.u))
  const c2 = 2 * mean((x) => f(x) * Math.cos(2 * x.u))
  const s2 = 2 * mean((x) => f(x) * Math.sin(2 * x.u))
  let worst = 0
  for (const x of S) {
    const model =
      a0 + c1 * Math.cos(x.u) + s1 * Math.sin(x.u) + c2 * Math.cos(2 * x.u) + s2 * Math.sin(2 * x.u)
    worst = Math.max(worst, Math.abs(f(x) - model))
  }
  return { a0, one: Math.hypot(c1, s1), two: Math.hypot(c2, s2), worst }
}

/** The first-order form under test, evaluated at a sample. */
const form = (x) => -k * (3 * x.sinPhi * x.sinPhi - 1)

let worstSample = 0
for (const x of S) worstSample = Math.max(worstSample, Math.abs(x.a - x.am - form(x)))

const hA = harmonics((x) => x.a - x.am)
const hForm = harmonics(form)
const hR = harmonics((x) => x.r - x.am)

const rMin = Math.min(...S.map((x) => x.r))
const rMax = Math.max(...S.map((x) => x.r))
const aGeo = (rMin + rMax) / 2
const eBar = mean((x) => x.em)
const eMin = Math.min(...S.map((x) => x.e))
const eMax = Math.max(...S.map((x) => x.e))

/* ------------------------------------------------------------------ *
 * The drag integrand, one revolution, five ways.
 *
 * `rates` integrates over eccentric anomaly with the Jacobian and the wind
 * factor; the comparable quantity here is <rho v^3>, time-averaged the same way
 * on both sides. The flown arc is the reference by definition.
 * ---------------------------------------------------------------- */

const n0 = Math.sqrt(MU / (aMean * aMean * aMean))
const flown = mean((x) => density(x.r - R) * x.v ** 3)

/**
 * The ellipse from (a, e), optionally displaced.
 *
 * `axisTerm` displaces the semi-major axis, which is what a substitution of the
 * `a_osc - a_mean` form into the radius amounts to. `radialTerm` displaces the
 * radius itself, which is what `decay.js` does, and carries the potential that
 * goes with it into the speed — the two are the same quantity, `<Phi_J> = mu <dr>
 * / a^2`, so a displaced radius costs twice the obvious amount of speed.
 */
function integrand(a, e, { axisTerm = null, radialTerm = null } = {}) {
  let acc = 0
  for (let j = 0; j < N; j++) {
    const Ea = (2 * Math.PI * j) / N
    const c = Math.cos(Ea)
    const aAt = axisTerm ? a + axisTerm(Ea) : a
    const dr = radialTerm ? radialTerm(Ea) : 0
    const r = aAt * (1 - e * c) + dr
    const v2 = MU * (2 / r - 1 / aAt) - (2 * MU * dr) / (aAt * aAt)
    acc += density(r - R) * v2 ** 1.5 * (1 - e * c)
  }
  return acc / N
}

const uPeri = first.uPeri
const sin2i = 1 - S[0].cosI * S[0].cosI
const daAt = (Ea) => -k * (3 * sin2i * Math.sin(Ea + uPeri) ** 2 - 1)

/**
 * The radius form `decay.js` carries, and the two numbers it is made of. The
 * mean is what the file applies; the second harmonic it cannot, having no
 * argument of latitude, and this gate measures what that costs.
 */
const drMean = k * (0.75 * sin2i - 0.5)
const drTwo = k * 0.25 * sin2i
const drAt = (Ea) => drMean + drTwo * Math.cos(2 * (Ea + uPeri))

const before = integrand(aMean, first.e)
const withAxis = integrand(aMean, first.e, { axisTerm: daAt })
const geoMeanE = integrand(aGeo, eBar)
const meanMeanE = integrand(aMean, eBar)
const shipped = integrand(aMean, eBar, { radialTerm: () => drMean })
const withTwo = integrand(aMean, eBar, { radialTerm: drAt })

const km = (v) => `${(v / 1000).toFixed(3)} km`
const ratio = (v) => (v / flown).toFixed(4)
const sgn = (v) => `${v < 0 ? '-' : '+'}${Math.abs(v / 1000).toFixed(3)}`

console.log(`\n=== the parking orbit, one revolution, drag off ===`)
console.log(`  ${LAUNCH_SITES[SITE].name} at +${HOUR} h, committed at ${(live.sim.t / H).toFixed(3)} h`)
console.log(`  a_mean ${km(aMean)}  e_osc at commitment ${first.e.toFixed(6)}  e_mean ${eBar.toFixed(6)}`)
console.log(`  sin^2 i ${sin2i.toFixed(5)}   J2 R^2 / a_mean ${km(k)}   period ${T.toFixed(1)} s, ${N} samples`)

console.log(`\n=== 1. the derived form against the flight ===`)
console.log(`  worst sample      ${worstSample.toFixed(1)} m, across a ${(2 * k * 1.96 / 1000).toFixed(1)} km swing`)
console.log(`  measured  a_osc - a_mean   mean ${sgn(hA.a0)}   |1u| ${km(hA.one)}   |2u| ${km(hA.two)}`)
console.log(`  the form                   mean ${sgn(hForm.a0)}   |1u| ${km(hForm.one)}   |2u| ${km(hForm.two)}`)

console.log(`\n=== 2. and what the radius carries, which is not that ===`)
console.log(`  r - a_mean                 mean ${sgn(hR.a0)}   |1u| ${km(hR.one)}   |2u| ${km(hR.two)}`)
console.log(`  r over the revolution      ${km(rMin)} .. ${km(rMax)}, fit ${km(aGeo)} at e ${((rMax - rMin) / (rMax + rMin)).toFixed(6)}`)
console.log(`  osculating eccentricity    ${eMin.toFixed(6)} .. ${eMax.toFixed(6)}  (${(eMax / eMin).toFixed(1)}x, commitment ${first.e.toFixed(6)})`)

console.log(`\n=== 3. the radius form, and what it is made of ===`)
console.log(`  derived   mean ${sgn(drMean)}   |2u| ${km(drTwo)}`)
console.log(`  measured  mean ${sgn(hR.a0)}   |2u| ${km(hR.two)}`)

console.log(`\n=== 4. the drag integrand, ratio to the flown arc ===`)
console.log(`  as shipped (a_mean + dr, e_mean)        ${ratio(shipped)}`)
console.log(`  and with the second harmonic as well    ${ratio(withTwo)}`)
console.log(`  before the radius term, (a_mean, e_osc) ${ratio(before)}`)
console.log(`  a_mean displaced by the *axis* form     ${ratio(withAxis)}`)
console.log(`  radius-fit axis with the mean e         ${ratio(geoMeanE)}`)
console.log(`  a_mean with the mean e                  ${ratio(meanMeanE)}`)

const checks = [
  ['a revolution of the flown arc was flown', S.length === N],
  ['the derived radial form matches flight, sample by sample', worstSample < 250],
  ['and its mean is the form\'s, to a metre per kilometre', Math.abs(hA.a0 - hForm.a0) < 150],
  ['and the swing is the second harmonic the form predicts', Math.abs(hA.two - hForm.two) < 300],
  ['the semi-major axis\'s short-period term is second harmonic', hA.two > 8 * hA.one],
  ['the radius\'s is first harmonic instead', hR.one > 5 * hR.two],
  ['so the radius carries far less 2u than the semi-major axis does', hR.two < hA.two / 3],
  ['and no *osculating* eccentricity represents it, swinging 5x a revolution', eMax / eMin > 3],
  ['while the mean one does, to a part in a hundred', Math.abs(hR.one / aMean / eBar - 1) < 0.01],
  // The radius form itself, against the same flown revolution.
  ['the radius form\'s mean is the flight\'s, to ten metres', Math.abs(drMean - hR.a0) < 10],
  ['and its second harmonic is the flight\'s, to ten metres', Math.abs(drTwo - hR.two) < 10],
  ['the profile decay.js now flies is within one per cent of the arc', Math.abs(shipped / flown - 1) < 0.01],
  /*
   * The second harmonic is the part `rates` cannot carry, and this is the
   * measurement that says omitting it is allowed rather than merely convenient.
   */
  ['and the second harmonic it cannot carry is worth under half a per cent', Math.abs(withTwo / shipped - 1) < 0.005],
  ['reading the air at the conic instead was four per cent out', Math.abs(before / flown - 1) > 0.03],
  ['displacing by the *axis* form instead is twenty per cent out', withAxis / flown > 1.2],
  ['while the mean eccentricity alone brackets it — one axis over, the other under', meanMeanE > flown && geoMeanE < flown],
]
let pass = true
for (const [label, ok] of checks) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`)
  if (!ok) pass = false
}
console.log(`\n  ${pass ? 'PASS' : 'FAIL'}`)
process.exit(pass ? 0 : 1)
