/**
 * Coast the lunar approach and hold it to the conic it is on.
 *
 * Outside the sphere of influence Earth is the dominant attractor and
 * "periapsis about the Moon" is a number with no trajectory behind it: the
 * osculating elements swing wildly from frame to frame. Inside, they stop being
 * a fiction — and that transition is the thing worth asserting. So the gate
 * records the selenocentric conic at the moment the craft crosses into the
 * sphere of influence, then flies the encounter and checks that the flyby it
 * actually makes is the one that conic predicted.
 *
 *     v_inf = sqrt(v^2 - 2 mu / r)          hyperbolic excess speed
 *     B     = |r x v| / v_inf               impact parameter, the miss distance
 *     gamma = asin(v_r / v)                 flight-path angle, descending when < 0
 *
 * The B-plane claim is the one with teeth: B is measured ~70,000 km out and the
 * periapsis is 80 km above the surface, so a mistake of a fraction of a degree
 * in the approach direction moves the miss distance by kilometres. A flyby
 * predicted at one point and delivered at another is a real statement about the
 * integrator, the ephemeris and the field together.
 *
 * Two things about it were measured rather than assumed, and both are stated in
 * the checks as they came out.
 *
 * The prediction error does **not** go to zero as the conic is read closer in.
 * It falls from 23.2 km (1.28%) at SOI entry to 16.3 km and then stops: the two
 * readings inside 5,000 km agree with each other to 32 m while both sit 16 km
 * from the flyby. That floor is the Sun and the Earth bending the approach —
 * the osculating conic is not the trajectory being flown, and no amount of
 * proximity makes it one. Asserting convergence to zero would be asserting a
 * two-body problem in a three-body field.
 *
 * And gamma is *reported* at each reading rather than bounded, because at a
 * stated range it carries no information the other two do not: (v_inf, B) and
 * (|v|, gamma) are the same pair of numbers in different coordinates. The one
 * independent use of it is as a cross-check on the B-plane construction itself —
 * for a straight-line approach the flight-path angle must be `-acos(B/r)`, so
 * the two independent derivations of the same geometry are asserted to agree.
 *
 * The state is `scripts/fixtures/lunar-approach.json` unless another is given —
 * that file is the post-midcourse approach state, still 130,000 km outside the
 * sphere of influence, which is where this has to start to see the conic stop
 * being a fiction.
 *
 *   node scripts/verify-approach.mjs                    the fixture
 *   node scripts/verify-approach.mjs other-state.json   some other state
 */

import { flight, frame, loadSnapshot, LUNAR_APPROACH_FIXTURE } from './flight.mjs'
import { live } from '../src/sim/live.js'
import { currentPhase, mission } from '../src/sim/mission.js'
import { BODIES, G } from '../src/sim/constants.js'
import { INDEX } from '../src/sim/system.js'

const snap = process.argv[2] ?? LUNAR_APPROACH_FIXTURE
loadSnapshot(snap)

const MU_MOON = G * BODIES.moon.mass
const R_MOON = 1737e3

console.log(`from ${currentPhase().id} at MET ${(mission.t / 3600).toFixed(2)} h\n`)
console.log(
  '   MET      range      SOI    in    r_p(osc)   t_p(osc)      e        maxDt   steps',
)

/** Selenocentric state of the craft, into `out` (six numbers, no allocation). */
const _r = new Float64Array(6)
function relative(out) {
  const st = live.sim.state
  const o = INDEX.ship * 6
  const m = INDEX.moon * 6
  for (let i = 0; i < 6; i++) out[i] = st[o + i] - st[m + i]
  return out
}

/**
 * The osculating conic as the encounter develops, sampled once per range
 * threshold. This is the measurement the script has always been about, turned
 * into a claim: outside the sphere of influence the elements are a fiction,
 * inside they converge on the flyby actually flown.
 */
const THRESHOLDS = [70000e3, 20000e3, 5000e3, 2500e3]
const samples = THRESHOLDS.map((range) => ({ range, taken: false, rp: 0, gamma: 0, vInf: 0, b: 0 }))

const crossing = { r: 0, v: 0, vInf: 0, b: 0, gamma: 0, rp: 0, t: 0, range: 0 }
let haveCrossing = false

let last = -Infinity
let entered = false
let minRange = Infinity
let minRangeT = 0
let minRangeMaxDt = 0
let maxDtInside = 0

for (let i = 0; i < 4_000_000; i++) {
  // Warp down as the encounter develops, the same ladder shape the other coasts
  // use: resolution costs nothing where nothing is happening.
  const tp = live.lunar.timeToPeriapsis
  flight.pilotWarp = !live.insideLunarSOI ? 3 : tp > 7200 ? 2 : tp > 900 ? 1 : 0
  frame()

  if (live.lunarRange < minRange) {
    minRange = live.lunarRange
    minRangeT = mission.t
    minRangeMaxDt = live.maxDt
  }
  if (live.insideLunarSOI && live.maxDt > maxDtInside) maxDtInside = live.maxDt

  if (!entered && live.insideLunarSOI) {
    entered = true
    relative(_r)
    const r = Math.hypot(_r[0], _r[1], _r[2])
    const v = Math.hypot(_r[3], _r[4], _r[5])
    const vr = (_r[0] * _r[3] + _r[1] * _r[4] + _r[2] * _r[5]) / r
    const cx = _r[1] * _r[5] - _r[2] * _r[4]
    const cy = _r[2] * _r[3] - _r[0] * _r[5]
    const cz = _r[0] * _r[4] - _r[1] * _r[3]
    const h = Math.hypot(cx, cy, cz)
    const vInf2 = v * v - (2 * MU_MOON) / r
    crossing.r = r
    crossing.v = v
    crossing.vInf = vInf2 > 0 ? Math.sqrt(vInf2) : 0
    crossing.b = crossing.vInf > 0 ? h / crossing.vInf : Infinity
    crossing.gamma = Math.asin(Math.max(-1, Math.min(1, vr / v)))
    crossing.rp = live.lunar.periapsisRadius
    crossing.t = mission.t
    crossing.range = live.lunarRange
    haveCrossing = true
    console.log(`  --- entered the lunar SOI at MET ${(mission.t / 3600).toFixed(3)} h ---`)
  }

  // First frame below each threshold, so every sample is at a known range.
  for (const s of samples) {
    if (!s.taken && live.insideLunarSOI && live.lunarRange < s.range) {
      s.taken = true
      s.rp = live.lunar.periapsisRadius
      s.vInf = crossing.vInf
      s.b = crossing.b
      relative(_r)
      const r = Math.hypot(_r[0], _r[1], _r[2])
      const v = Math.hypot(_r[3], _r[4], _r[5])
      s.gamma = Math.asin(
        Math.max(-1, Math.min(1, (_r[0] * _r[3] + _r[1] * _r[4] + _r[2] * _r[5]) / (r * v))),
      )
      s.range = live.lunarRange
    }
  }

  if (mission.t - last > 3600 || (live.insideLunarSOI && mission.t - last > 600)) {
    last = mission.t
    const l = live.lunar
    console.log(
      `  ${(mission.t / 3600).toFixed(2).padStart(7)}h ${(live.lunarRange / 1e3).toFixed(0).padStart(8)} ` +
        `${(live.lunarSOI / 1e3).toFixed(0).padStart(7)} ${String(live.insideLunarSOI).padStart(5)} ` +
        `${(l.periapsisRadius / 1e3).toFixed(1).padStart(10)} ${(l.timeToPeriapsis / 3600).toFixed(3).padStart(10)}h ` +
        `${l.eccentricity.toFixed(4).padStart(8)} ${live.maxDt.toFixed(2).padStart(8)} ${String(live.stepsLastFrame).padStart(6)}`,
    )
  }

  // Stop just after the true closest approach.
  if (entered && live.lunar.vertical > 0 && live.lunarRange > minRange * 1.02) break
}

console.log(
  `\n  true closest approach: ${(minRange / 1e3).toFixed(2)} km radius = ` +
    `${((minRange - R_MOON) / 1e3).toFixed(2)} km altitude, at MET ${(minRangeT / 3600).toFixed(3)} h`,
)

if (haveCrossing) {
  const c = crossing
  const rpFromConic = live.lunarSOI > c.range ? c.rp : c.rp
  console.log('\n=== the conic at SOI entry ===')
  console.log(`  selenocentric range        ${(c.r / 1e3).toFixed(1)} km`)
  console.log(`  selenocentric speed        ${(c.v / 1e3).toFixed(4)} km/s`)
  console.log(`  hyperbolic excess, v_inf   ${(c.vInf / 1e3).toFixed(4)} km/s`)
  console.log(`  flight-path angle, gamma   ${((c.gamma * 180) / Math.PI).toFixed(4)} deg`)
  console.log(`  impact parameter, B        ${(c.b / 1e3).toFixed(3)} km`)
  console.log(`  predicted periapsis radius ${(c.rp / 1e3).toFixed(3)} km  (${(c.rp / 1e3 - R_MOON / 1e3).toFixed(1)} km altitude)`)
  console.log(`  delivered closest approach ${(minRange / 1e3).toFixed(3)} km`)
  console.log(
    `  prediction error           ${((minRange - c.rp) / 1e3).toFixed(3)} km` +
      ` (${(((minRange - c.rp) / c.rp) * 100).toFixed(4)}%)`,
  )
  console.log(`  fineness at closest approach ${minRangeMaxDt.toFixed(3)} s; coarsest inside SOI ${maxDtInside.toFixed(2)} s`)

  console.log('\n=== the conic against the flyby, by how far out it was read ===')
  console.log('     at range km   r_p(osc) km   gamma deg   predicted - delivered km      %')
  for (const s of samples) {
    if (!s.taken) {
      console.log(`  ${(s.range / 1e3).toFixed(0).padStart(14)}      not reached`)
      continue
    }
    const err = s.rp - minRange
    console.log(
      `  ${(s.range / 1e3).toFixed(0).padStart(14)}${(s.rp / 1e3).toFixed(3).padStart(14)}` +
        `${((s.gamma * 180) / Math.PI).toFixed(2).padStart(12)}${(err / 1e3).toFixed(3).padStart(26)}` +
        `${((err / minRange) * 100).toFixed(4).padStart(8)}`,
    )
  }

  const near = samples[samples.length - 1]
  const nearErr = near.taken ? Math.abs(near.rp - minRange) : Infinity

  console.log('\n=== what this establishes ===')
  const checks = [
    ['the craft crosses into the lunar SOI', haveCrossing],
    ['the approach is hyperbolic about the Moon', c.vInf > 0],
    ['v_inf is between 0.5 and 1.5 km/s', c.vInf > 500 && c.vInf < 1500],
    ['the flight-path angle at SOI entry is descending', c.gamma < 0],
    ['the B-plane miss is clear of the Moon', c.b > R_MOON + 100e3],
    ['and inside the SOI it was measured at', c.b < live.lunarSOI],
    [
      'the B-plane construction agrees with the flight-path angle to 1 deg',
      Math.abs(Math.abs(c.gamma) - Math.acos(Math.min(1, c.b / c.r))) < Math.PI / 180,
    ],
    ['the conic read at SOI entry predicts the flyby to 2%', Math.abs(c.rp - minRange) < 0.02 * minRange],
    ['every reading inside the SOI predicts it to 1%',
      samples.filter((s) => s.taken && s.range < c.range).every((s) => Math.abs(s.rp - minRange) < 0.01 * minRange)],
    ['the prediction error shrinks as the craft closes', nearErr < Math.abs(c.rp - minRange)],
    [
      'and then converges: the two closest readings agree to 1 km',
      samples.length >= 2 &&
        samples[samples.length - 1].taken &&
        samples[samples.length - 2].taken &&
        Math.abs(samples[samples.length - 1].rp - samples[samples.length - 2].rp) < 1000,
    ],
    ['it is a flyby, not an impact', minRange > R_MOON],
    ['the flyby clears the surface by over 20 km', minRange > R_MOON + 20e3],
    ['the step ceiling stays under 60 s inside the SOI', maxDtInside < 60],
  ]
  let pass = true
  for (const [label, ok] of checks) {
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`)
    if (!ok) pass = false
  }
  console.log(`\n  ${pass ? 'PASS' : 'FAIL'}`)
  process.exit(pass ? 0 : 1)
}

console.log('\n=== what this establishes ===')
console.log('  FAIL  the craft never reached the lunar sphere of influence')
console.log('\n  FAIL')
process.exit(1)
void rpFromConic
