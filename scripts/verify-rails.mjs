/**
 * The seven planets carried analytically, against things known independently.
 *
 * The elements are a table copied into the source, so the risk is not that
 * Kepler's equation is wrong — it is that a sign, a rotation or an epoch is,
 * and every one of those failures looks like a planet sitting somewhere
 * plausible. So nothing here checks the table against itself.
 *
 * The strongest check available is Earth. The integrator carries it as a
 * massive body from J2000 initial conditions built by a different function, in
 * a different frame, and integrates it forward with RK4; the same JPL table has
 * a row for the Earth-Moon barycentre. Running both and comparing is an
 * end-to-end test of the epoch, the frame, the rotation order and the units at
 * once, against a body this simulator computes by a route that shares no code
 * with the one under test.
 *
 *   node --expose-gc scripts/verify-rails.mjs
 */

import { live, refreshDerived, resetSimulation } from '../src/sim/live.js'
import { INDEX } from '../src/sim/system.js'
import { AU, BODIES, ELEMENTS, G } from '../src/sim/constants.js'

const EARTH_A = ELEMENTS.earth.a
import { RAILS, RAIL_COUNT, RAIL_ELEMENTS, FORCE_COUNT, railHelio, updateRails } from '../src/sim/rails.js'
import {
  SMALLEST_OBJECT,
  allocatesNothing,
  bytesPerCall,
  knownAllocation,
  sampleText,
  seesAllocation,
} from './allocation.mjs'

const DAY = 86400
const CENTURY = 36525 * DAY
const DEG = Math.PI / 180

/**
 * Published sidereal periods and mean orbital speeds. Neither is in the table:
 * the table has a mean-longitude *rate* and a semi-major axis, and these are
 * what those two have to agree with and with each other.
 */
const KNOWN = {
  mercury: { days: 87.969, kms: 47.36 },
  venus: { days: 224.701, kms: 35.02 },
  mars: { days: 686.98, kms: 24.07 },
  jupiter: { days: 4332.589, kms: 13.06 },
  saturn: { days: 10759.22, kms: 9.68 },
  uranus: { days: 30685.4, kms: 6.8 },
  neptune: { days: 60189.0, kms: 5.43 },
  /*
   * Pluto: the period is firm (248 yr). No mean-speed column — the published
   * figure 4.743 km/s is 2*pi*a/T, while the series below is the *time*
   * average (the ellipse's perimeter over T, 4.67 km/s), and which convention
   * a given table used is not printed on the table.
   */
  pluto: { days: 90560, kms: null },
  /*
   * Halley: the published period is 75.3 yr, quoted to a tenth because Jupiter
   * moves it 74–79. No mean-speed column: the series below is a small-e
   * expansion and has no authority at e = 0.967. The perihelion this table is
   * anchored to is held against the observed event in verify-cosmos.
   */
  halley: { days: 27500, kms: null },
}

console.log('=== periods: the rate in the table, against Kepler and against the books ===')
console.log('  planet      from dL/dt      from a^3       published     worst error')
let worstPeriod = 0
let worstSpeed = 0
for (const p of RAILS) {
  // Moons orbit their planets, not the Sun — solar Kepler is not their
  // physics. Their radii and periods are held against measured orbits in
  // verify-cosmos, which is where that question is well-posed.
  if (p.parent) continue
  // 360 degrees at the tabulated rate.
  const fromRate = (360 / p.L[1]) * CENTURY
  // And from the semi-major axis, which is an independent entry in the table.
  const a = p.a[0] * AU
  const fromA = 2 * Math.PI * Math.sqrt((a * a * a) / (G * BODIES.sun.mass))
  const known = KNOWN[p.id].days * DAY
  const err = Math.max(Math.abs(fromRate - known), Math.abs(fromA - known)) / known
  worstPeriod = Math.max(worstPeriod, err)

  /*
   * Mean speed is an average over *time*, and on an eccentric orbit that is not
   * the circular 2*pi*a/T — the body spends longer out near apoapsis where it
   * is slow. The series in e is the published figure's own definition, and
   * without it Mercury reads 1.06% fast, which is exactly e^2/4.
   */
  const e0 = p.e[0]
  const speed = ((2 * Math.PI * a) / fromRate) * (1 - e0 * e0 / 4 - (3 * e0 ** 4) / 64) / 1000
  const speedErr = KNOWN[p.id].kms ? Math.abs(speed - KNOWN[p.id].kms) / KNOWN[p.id].kms : 0
  worstSpeed = Math.max(worstSpeed, speedErr)

  console.log(
    `  ${p.name.padEnd(10)}${(fromRate / DAY).toFixed(2).padStart(12)} d` +
      `${(fromA / DAY).toFixed(2).padStart(13)} d${KNOWN[p.id].days.toFixed(2).padStart(14)} d` +
      `${(err * 100).toFixed(3).padStart(14)}%`,
  )
}
console.log(`\n  worst mean-speed error against published: ${(worstSpeed * 100).toFixed(2)}%`)

/* ---- the Earth cross-check ---- */
/**
 * The Earth-Moon barycentre's row from the same table. Not in rails.js, because
 * the integrator owns Earth; it is here so the two can be compared.
 */
const EMB = {
  id: 'emb',
  name: 'Earth-Moon barycentre',
  mass: 0,
  radius: 0,
  a: [1.00000261, 0.00000562],
  e: [0.01671123, -0.00004392],
  i: [-0.00001531, -0.01294668],
  L: [100.46457166, 35999.37244981],
  peri: [102.93768193, 0.32327364],
  node: [0.0, 0.0],
}

/*
 * Borrow the module's own evaluator by writing this row over Mercury's, in the
 * flat table it actually reads — the objects above are the source the table is
 * built from, not what `updateRails` looks at, and substituting one of those
 * would silently test Mercury against Earth.
 */
const savedRow = RAIL_ELEMENTS.slice(0, 12)
const AU_M = AU
const D = Math.PI / 180
RAIL_ELEMENTS.set(
  [
    EMB.a[0] * AU_M, EMB.a[1] * AU_M,
    EMB.e[0], EMB.e[1],
    EMB.i[0] * D, EMB.i[1] * D,
    EMB.L[0] * D, EMB.L[1] * D,
    EMB.peri[0] * D, EMB.peri[1] * D,
    EMB.node[0] * D, EMB.node[1] * D,
  ],
  0,
)

resetSimulation()
refreshDerived()
const SUN = INDEX.sun * 6
const EARTH = INDEX.earth * 6
const MOON = INDEX.moon * 6
const mE = BODIES.earth.mass
const mM = BODIES.moon.mass

/** The integrated barycentre of Earth and Moon, heliocentric, in the scene frame. */
function integratedEMB(out) {
  const s = live.sim.state
  for (let k = 0; k < 3; k++) {
    out[k] = (mE * s[EARTH + k] + mM * s[MOON + k]) / (mE + mM) - s[SUN + k]
  }
  return out
}

/**
 * The two do not start at the same place, and that is a fact about the
 * simulator rather than about this table.
 *
 * Its Earth is built from elements whose longitude of perihelion agrees with
 * the JPL row to 0.0095 degrees — so the orbit is the same orbit — but whose
 * mean anomaly puts the planet 1.0996 degrees further round it, which is 1.12
 * days of Earth's motion. What the comparison can therefore establish is
 * everything except the phase: same size, same plane, same sense, and a
 * separation that does not *grow*, which is what a wrong frame, a wrong
 * rotation order or a wrong rate would all produce.
 */
const PHASE_DEG = 1.0996

console.log('\n=== the Earth-Moon barycentre, integrated against tabulated ===')
console.log('  after            integrated r        tabulated r       separation    predicted')
const a = [0, 0, 0]
let worstGap = 0
let worstRadius = 0
let worstAgainstPhase = 0
let startAngle = 0
let endAngle = 0
const CHECKS = [0, 30, 120, 365, 365 * 3]
let last = 0
for (const days of CHECKS) {
  while (last < days) {
    const stride = Math.min(1, days - last)
    live.sim.advance(stride * DAY, 900)
    last += stride
  }
  updateRails(live.sim.t)
  integratedEMB(a)
  const b = [railHelio[0], railHelio[1], railHelio[2]]
  const rI = Math.hypot(a[0], a[1], a[2])
  const rT = Math.hypot(b[0], b[1], b[2])
  const gap = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
  worstGap = Math.max(worstGap, gap / AU)
  worstRadius = Math.max(worstRadius, Math.abs(rI - rT) / rT)
  // The angle between them, which is the quantity the phase difference predicts
  // and the one that shows a rate error if there is one.
  const cos = (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (rI * rT)
  const angle = Math.acos(Math.min(1, Math.max(-1, cos))) / DEG
  if (days === 0) startAngle = angle
  endAngle = angle
  // The chord that phase difference subtends at this radius, predicted from the
  // two tables and not fitted to anything measured here.
  const predicted = 2 * rT * Math.sin((PHASE_DEG * DEG) / 2)
  // Judged where it is a test of the pipeline rather than of two mean motions:
  // the gap grows slowly because the two Earths do not have quite the same
  // period, and that growth is measured separately below.
  if (days <= 120) {
    worstAgainstPhase = Math.max(worstAgainstPhase, Math.abs(gap - predicted) / predicted)
  }
  console.log(
    `  ${String(days).padStart(5)} days${(rI / AU).toFixed(6).padStart(15)} AU` +
      `${(rT / AU).toFixed(6).padStart(16)} AU${(gap / 1e9).toFixed(3).padStart(13)} Gm` +
      `${(predicted / 1e9).toFixed(3).padStart(12)} Gm`,
  )
}
RAIL_ELEMENTS.set(savedRow, 0)

/* ---- distances stay on their conics, right across the window ---- */
console.log('\n=== heliocentric distance over 1800-2050 ===')
console.log('  planet         min           max        against a(1-e) .. a(1+e)')
let boundsOk = true
for (let k = 0; k < RAIL_COUNT; k++) {
  const p = RAILS[k]
  if (p.parent) continue // moons: a planetocentric offset, not a solar conic
  let lo = Infinity
  let hi = 0
  for (let year = 1800; year <= 2050; year += 1) {
    updateRails((year - 2000) * 365.25 * DAY)
    const o = k * 3
    const r = Math.hypot(railHelio[o], railHelio[o + 1], railHelio[o + 2]) / AU
    lo = Math.min(lo, r)
    hi = Math.max(hi, r)
  }
  const peri = p.a[0] * (1 - p.e[0])
  const apo = p.a[0] * (1 + p.e[0])
  const ok = lo > peri * 0.99 && hi < apo * 1.01
  if (!ok) boundsOk = false
  console.log(
    `  ${p.name.padEnd(10)}${lo.toFixed(4).padStart(12)}${hi.toFixed(4).padStart(14)} AU` +
      `      ${peri.toFixed(4)} .. ${apo.toFixed(4)}${ok ? '' : '   OUT OF BOUNDS'}`,
  )
}

/* ---- inclinations put them near the ecliptic, and in the right order ---- */
updateRails(0)
let ordered = true
let lastR = 0
for (let k = 0; k < FORCE_COUNT; k++) {
  // The seven planets sit in order of distance; the sky below them does not —
  // Halley crosses five orbits between perihelion and aphelion, and a moon
  // sits on its parent's radius. Order is a claim about the force set.
  const o = k * 3
  const r = Math.hypot(railHelio[o], railHelio[o + 1], railHelio[o + 2])
  if (r <= lastR) ordered = false
  lastR = r
}

/**
 * Out of the ecliptic by no more than the inclination allows. In the scene
 * frame the ecliptic pole is +y, so this is the y component against the radius.
 */
let worstTilt = 0
for (let year = 2000; year < 2050; year += 7) {
  updateRails((year - 2000) * 365.25 * DAY)
  for (let k = 0; k < RAIL_COUNT; k++) {
    if (RAILS[k].parent) continue // moons have no heliocentric inclination
    const o = k * 3
    const r = Math.hypot(railHelio[o], railHelio[o + 1], railHelio[o + 2])
    const tilt = Math.abs(Math.asin(railHelio[o + 1] / r)) / DEG
    worstTilt = Math.max(worstTilt, tilt - RAILS[k].i[0])
  }
}

/* ---- allocation ---- */
const control = await knownAllocation()
const bytes = await bytesPerCall(() => updateRails(1e9), { calls: 20000, warm: 20000 })

console.log('\n=== what this establishes ===')
const checks = [
  ['every period agrees with the books to 0.1%', worstPeriod < 0.001],
  ['and the semi-major axis agrees with the mean-longitude rate', worstPeriod < 0.001],
  ['mean orbital speeds land within 0.5% of published', worstSpeed < 0.005],
  ['the integrated Earth and the tabulated one agree on the distance to 0.1%', worstRadius < 0.001],
  ['their separation is the phase difference between the two tables', worstAgainstPhase < 0.1],
  /*
   * And it creeps rather than runs. A wrong frame, rotation order or rate would
   * put degrees between them within a year; what is actually there is the
   * simulator's year being 67 minutes short of the sidereal one, which is
   * 0.046 deg of phase a year and accounts for all but 0.002 of the 0.048
   * measured. The bound is set from that cause, not from the observation.
   */
  ['and creeps only at the rate the two years differ', Math.abs(endAngle - startAngle) < 0.25],
  ['every planet stays between its own periapsis and apoapsis, 1800-2050', boundsOk],
  ['they come out in order of distance from the Sun', ordered],
  ['none strays further off the ecliptic than its inclination allows', worstTilt < 0.01],
  seesAllocation('the allocation measurement can see an allocation', control),
  allocatesNothing('stepping every planet allocates nothing', bytes, SMALLEST_OBJECT / 2),
]
let pass = true
for (const [label, ok] of checks) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`)
  if (!ok) pass = false
}
console.log(
  `\n  Earth: radii agree to ${(worstRadius * 1e6).toFixed(1)} parts per million, and the` +
    ` separation is within ${(worstAgainstPhase * 100).toFixed(1)}% of the ${PHASE_DEG} deg phase` +
    ` difference over the first four months.`,
)
const simYear =
  (2 * Math.PI * Math.sqrt(EARTH_A ** 3 / (G * (BODIES.sun.mass + BODIES.earth.mass + BODIES.moon.mass)))) /
  DAY
const tableYear = (360 / EMB.L[1]) * 36525
console.log(
  `  The angle between them goes ${startAngle.toFixed(4)} -> ${endAngle.toFixed(4)} deg over three` +
    ` years, ${((endAngle - startAngle) / 3).toFixed(4)} deg a year.`,
)
console.log(
  `  That is the simulator's own year: ${simYear.toFixed(5)} d against a sidereal ${tableYear.toFixed(5)},` +
    ` short by ${((tableYear - simYear) * 24 * 60).toFixed(1)} minutes, which is` +
    ` ${(((tableYear - simYear) / tableYear) * 360).toFixed(4)} deg of phase a year.`,
)
console.log(`  updateRails: ${sampleText(bytes)}`)
console.log(`  ${pass ? 'PASS' : 'FAIL'}`)
process.exit(pass ? 0 : 1)
