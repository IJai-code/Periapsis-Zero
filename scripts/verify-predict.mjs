/**
 * The forward projection: is the line where the craft will actually be?
 *
 * The obvious check is circular. Running the same RK4 forward and comparing it
 * to the projection compares a thing to itself and always agrees, however wrong
 * both are. So the projection is checked against a *different* method — the
 * osculating conic the flight model computes analytically from position and
 * velocity — in the regime where that conic is a good model, and against
 * invariants that hold regardless of method.
 *
 * And then against the reason conics were rejected in the first place. A conic
 * conserves specific orbital energy about its attractor exactly, by
 * construction. If the projection's energy about Earth is also constant
 * everywhere, the n-body integration is buying nothing and a conic would have
 * done. It should be flat in low orbit, where nothing else pulls hard, and move
 * visibly on a translunar coast, where something does.
 *
 *   node --expose-gc scripts/verify-predict.mjs [approach-snapshot.json]
 */

import { flight, frame, loadSnapshot } from './flight.mjs'
import { live, refreshDerived, resetSimulation } from '../src/sim/live.js'
import { beginCountdown, currentPhase, mission, resetMission } from '../src/sim/mission.js'
import { INDEX } from '../src/sim/system.js'
import { BODIES, G } from '../src/sim/constants.js'
import { WARP } from '../src/sim/warp.js'
import {
  OPEN_HORIZON,
  SAMPLES,
  packPolyline,
  prediction,
  project,
} from '../src/sim/predict.js'
import { dominantBody } from '../src/sim/soi.js'
import { J2, REFERENCE_RADIUS } from '../src/sim/prem.js'

const MU_EARTH = G * BODIES.earth.mass

/**
 * How far the quadrupole can push a point on this orbit, metres.
 *
 * J2's radial perturbation is of order `3 J2 (R/r)^2` of the monopole's own
 * acceleration, and dividing by the orbit's frequency turns that into a length —
 * 19.5 km in the parking orbit. It is the same length `verify-nodes` judges its
 * tolerances against, read from the same constant the field is built from.
 */
const quadrupoleScale = (r) => (3 * J2 * REFERENCE_RADIUS * REFERENCE_RADIUS) / r

/**
 * The same measurement on a point-mass Earth.
 *
 * Every claim below about a conic was written when Earth *was* a point mass
 * here, and the tolerances were metres because of it. An oblate Earth moves the
 * osculating apsis of a low orbit by kilometres — the whole of what the
 * quadrupole does — so rather than widen a metre into ten kilometres, each
 * claim is checked twice: against a sphere, where it must still hold as tightly
 * as it ever did, and against the real field, where the gap is checked to be a
 * real fraction of the quadrupole's scale and no more than it. Lifting the
 * field is a single assignment — it is one-way state on the integrator.
 */
const onSphere = (fn) => {
  const saved = live.sim.zonal
  live.sim.zonal = null
  const value = fn()
  live.sim.zonal = saved
  return value
}

/** Specific orbital energy about a body: constant on a conic, not otherwise. */
function specificEnergy(state, craft, body, mu) {
  const c = INDEX[craft] * 6
  const b = INDEX[body] * 6
  const r = Math.hypot(state[c] - state[b], state[c + 1] - state[b + 1], state[c + 2] - state[b + 2])
  const v = Math.hypot(
    state[c + 3] - state[b + 3],
    state[c + 4] - state[b + 4],
    state[c + 5] - state[b + 5],
  )
  return (v * v) / 2 - mu / r
}

/**
 * Integrate the same span independently, sampling energy rather than position.
 *
 * Its own fixed ten-second steps, deliberately not the projection's: this is a
 * check on the physics along the path, and borrowing the projection's stepping
 * would make it a check of the projection against itself.
 */
function energyTrack(sim, scratch, craft, body, mu, span) {
  const dt = span / (SAMPLES - 1)
  scratch.resetFrom(sim)
  let lo = Infinity
  let hi = -Infinity
  for (let i = 0; i < SAMPLES; i++) {
    if (i > 0) scratch.advance(dt, Math.min(dt, 10), 1e7)
    const e = specificEnergy(scratch.state, craft, body, mu)
    if (e < lo) lo = e
    if (e > hi) hi = e
  }
  /**
   * Absolute change as well as relative, because the relative figure is
   * meaningless when the energy crosses zero — and on a translunar coast it
   * does. A ratio against a mean that is nearly zero reported 2,781%, which
   * says nothing; what it was actually detecting is that the trajectory changes
   * *class* about Earth, from bound to unbound, which no single conic can
   * represent at all.
   */
  return {
    lo,
    hi,
    change: Math.abs(hi - lo),
    crossesZero: lo < 0 && hi > 0,
    spread: Math.abs((hi - lo) / ((hi + lo) / 2)),
  }
}

resetSimulation()
resetMission()
refreshDerived()
flight.warp = WARP.x1
flight.lastWarpRequest = null
flight.warpBeforeBurn = null
flight.pilotWarp = WARP.x1
beginCountdown()

/* Fly to the parking orbit, where the two-body conic is a good model. */
for (let i = 0; i < 3_000_000; i++) {
  frame()
  if (currentPhase().id === 'TLI_ALIGN') break
}
const scratch = live.sim.clone()
const e = live.elements

console.log('=== in the parking orbit ===')
console.log(`  phase            ${currentPhase().id} at MET ${(mission.t / 60).toFixed(1)} min`)
console.log(`  analytic orbit   ${((e.periapsisRadius - BODIES.earth.radius) / 1e3).toFixed(1)}` +
  ` x ${((e.apoapsisRadius - BODIES.earth.radius) / 1e3).toFixed(1)} km, period ${(e.period / 60).toFixed(2)} min`)

const t0 = process.hrtime.bigint()
for (let i = 0; i < 20; i++) project(live.sim, scratch, 'ship', 'earth', e.period)
const perProjection = Number(process.hrtime.bigint() - t0) / 1e6 / 20
const R = BODIES.earth.radius
const apoErr = prediction.apoapsis.index >= 0 ? prediction.apoapsis.radius - e.apoapsisRadius : NaN
const periErr = prediction.periapsis.index >= 0 ? prediction.periapsis.radius - e.periapsisRadius : NaN

console.log(`  projected        ${((prediction.periapsis.radius - R) / 1e3).toFixed(1)}` +
  ` x ${((prediction.apoapsis.radius - R) / 1e3).toFixed(1)} km over ${prediction.count} samples`)
console.log(`  apoapsis error   ${apoErr.toFixed(1)} m against the analytic conic`)
console.log(`  periapsis error  ${periErr.toFixed(1)} m`)

/* Closure: one period of a bound orbit must come back to where it started. */
const gap = Math.hypot(
  prediction.points[(prediction.count - 1) * 3] - prediction.points[0],
  prediction.points[(prediction.count - 1) * 3 + 1] - prediction.points[1],
  prediction.points[(prediction.count - 1) * 3 + 2] - prediction.points[2],
)
/**
 * The same projection, and the same two claims, on a point-mass Earth.
 *
 * Captured here rather than in the verdict because `prediction` is one object
 * every pass writes into — the field-on numbers have to leave it before this
 * runs, which is why `apoErr`, `periErr` and `gap` above are scalars.
 */
const spherePass = onSphere(() => {
  project(live.sim, scratch, 'ship', 'earth', e.period)
  return {
    apo: prediction.apoapsis.radius - e.apoapsisRadius,
    peri: prediction.periapsis.radius - e.periapsisRadius,
    gap: Math.hypot(
      prediction.points[(prediction.count - 1) * 3] - prediction.points[0],
      prediction.points[(prediction.count - 1) * 3 + 1] - prediction.points[1],
      prediction.points[(prediction.count - 1) * 3 + 2] - prediction.points[2],
    ),
  }
})

/**
 * Why the closure gap is 71 km rather than nothing, worked out rather than
 * observed: the quadrupole shortens the anomalistic period.
 *
 *   n' / n = 1 + (3/2) J2 (R/p)^2 sqrt(1 - e^2)
 *
 * so a projection that runs for exactly one *two-body* period ends with the
 * craft still short of its starting point by that time times its speed — 5.3 s
 * and 41 km here — and the radial swing it sits at adds the rest. The bound
 * below is that sum; what is being asserted is not that the orbit closes, but
 * that it fails to close by exactly the amount the field says it should, which
 * is a much sharper statement than a percentage of the orbit.
 */
const p = e.semiMajor * (1 - Math.pow((e.apoapsisRadius - e.periapsisRadius) / (e.apoapsisRadius + e.periapsisRadius), 2))
const ecc = (e.apoapsisRadius - e.periapsisRadius) / (e.apoapsisRadius + e.periapsisRadius)
const periodShortening = e.period * 1.5 * J2 * (REFERENCE_RADIUS / p) ** 2 * Math.sqrt(1 - ecc * ecc)
const closureBound = e.speed * periodShortening + 2 * quadrupoleScale(e.apoapsisRadius)

console.log(`  cost             ${perProjection.toFixed(2)} ms per projection` +
  `  (${prediction.steps} steps, ${prediction.count} drawn)`)
console.log(`  closure gap      ${(gap / 1e3).toFixed(3)} km after one revolution` +
  `  (${((gap / e.apoapsisRadius) * 100).toFixed(4)}% of the orbit)`)
console.log(`  on a point mass  the same pass is ${(spherePass.apo.toFixed(1))} m off the conic at apoapsis` +
  ` and closes to ${(spherePass.gap).toFixed(1)} m`)
console.log(`  the gap, derived the anomalistic period shortens by ${periodShortening.toFixed(3)} s` +
  ` (${(e.speed * periodShortening / 1e3).toFixed(1)} km along track), and the radial swing adds the rest to ${(closureBound / 1e3).toFixed(1)} km`)

const leoCount = prediction.count
/**
 * Captured here, not read in the verdict. `e` is `live.elements`, a live object
 * the driver refreshes — and this script resets the simulation to the pad
 * before the checks run, so a period read down there is the pad's 29.9 minutes
 * and nothing to do with the orbit just projected.
 */
const leoSpan = prediction.span
const leoPeriod = e.period
const leo = energyTrack(live.sim, scratch, 'ship', 'earth', MU_EARTH, e.period)
console.log(`  energy about Earth  ${(leo.lo / 1e6).toFixed(4)} to ${(leo.hi / 1e6).toFixed(4)} MJ/kg` +
  `,  change ${(leo.change / 1e3).toFixed(2)} kJ/kg — a conic would model this well`)

/* ---- impact: a path into the ground stops at the ground ---- */
const sim = live.sim
const shipOffset = INDEX.ship * 6
const saved = sim.state.slice(shipOffset, shipOffset + 6)
/**
 * Halve the velocity *relative to Earth*, which is the only frame in which
 * "slow it down until it falls" means anything.
 *
 * Halving the raw state instead removes about fifteen kilometres a second of
 * Earth's own heliocentric motion, which does not drop the craft — it strands
 * it, and the projection dutifully drew it climbing to 84,810 km. The state
 * vector is heliocentric and nothing in a bare index says so.
 */
const eo = INDEX.earth * 6
for (let k = 3; k < 6; k++) {
  const rel = sim.state[shipOffset + k] - sim.state[eo + k]
  sim.state[shipOffset + k] = sim.state[eo + k] + rel * 0.5
}
project(sim, scratch, 'ship', 'earth', e.period)
const stopped = prediction.impact.index
const lastRadius = Math.hypot(
  prediction.points[(prediction.count - 1) * 3],
  prediction.points[(prediction.count - 1) * 3 + 1],
  prediction.points[(prediction.count - 1) * 3 + 2],
)
console.log('\n=== a trajectory that hits the ground ===')
console.log(`  stopped at sample ${stopped} of ${SAMPLES}, ${(prediction.impact.time / 60).toFixed(1)} min ahead`)
console.log(`  final radius      ${(lastRadius / 1e3).toFixed(1)} km against a surface at ${(R / 1e3).toFixed(1)}`)
sim.state.set(saved, shipOffset)
refreshDerived()

/* ---- the translunar case, where the conic stops being a model ---- */
let lunar = null
const snap = process.argv[2]
if (snap) {
  loadSnapshot(snap)
  refreshDerived()
  const body = dominantBody(live.sim, 'ship')
  // The horizon the code actually projects over, not a rounder number.
  lunar = energyTrack(live.sim, scratch, 'ship', 'earth', MU_EARTH, OPEN_HORIZON)
  console.log('\n=== on the way to the Moon ===')
  console.log(`  phase            ${currentPhase().id}, dominant attractor "${body}"`)
  console.log(`  energy about Earth  ${(lunar.lo / 1e6).toFixed(3)} to ${(lunar.hi / 1e6).toFixed(3)} MJ/kg` +
    ` over ${(OPEN_HORIZON / 86400).toFixed(0)} days,  change ${(lunar.change / 1e6).toFixed(3)} MJ/kg`)
  console.log(`  crosses zero:    ${lunar.crossesZero}` +
    ` — ${lunar.crossesZero ? 'the trajectory changes class about Earth, bound to unbound' : 'stays one class'}`)
  console.log(`  a conic holds this constant by construction, so all of it is what one would have missed`)
}

/* ---- the line the component draws from the projection ---- */
const packed = new Float32Array((SAMPLES - 1) * 6)
project(live.sim, scratch, 'ship', 'earth', 5400)
packPolyline(packed, prediction.points, prediction.count, SAMPLES)

let contiguous = true
let maxJoinGap = 0
for (let s = 0; s + 1 < SAMPLES - 1; s++) {
  for (let k = 0; k < 3; k++) {
    const gap = Math.abs(packed[s * 6 + 3 + k] - packed[(s + 1) * 6 + k])
    if (gap > maxJoinGap) maxJoinGap = gap
    if (gap > 1e-3) contiguous = false
  }
}
/**
 * Toleranced to the buffer's own precision, not to the source's.
 *
 * The line buffer is Float32Array — that is what a GPU attribute is — and these
 * are metres from a body's centre, so around 7e6 the spacing between
 * representable values is about 0.8 m. Comparing against the Float64 the
 * projection produced at 1e-6 failed for that reason alone, twice, and said
 * nothing about whether the packing was right. Derived from the magnitude
 * rather than picked, so it stays correct in lunar orbit as well as low Earth
 * orbit.
 */
const f32close = (a, b) => Math.abs(a - b) <= Math.abs(b) * 1.2e-7 + 1e-3

const startsAtCraft = f32close(packed[0], prediction.points[0]) && f32close(packed[1], prediction.points[1])

/* A truncated projection must flatten onto its last point, not the origin. */
const short = new Float32Array((SAMPLES - 1) * 6)
packPolyline(short, prediction.points, 4, SAMPLES)
const tailX = short[(SAMPLES - 2) * 6 + 3]
const tailY = short[(SAMPLES - 2) * 6 + 4]
const collapsed = f32close(tailX, prediction.points[9]) && f32close(tailY, prediction.points[10])

console.log('\n=== the drawn line ===')
console.log(`  segments          ${SAMPLES - 1}, stride 6, interleaved`)
console.log(`  worst join gap    ${maxJoinGap.toExponential(2)} m between a segment's end and the next start`)
console.log(`  truncated tail    ${collapsed ? 'collapses onto the last real sample' : 'LEFT AT THE ORIGIN'}`)

/* ---- allocation ---- */
const gc = globalThis.gc
resetSimulation()
refreshDerived()
for (let i = 0; i < 200; i++) project(live.sim, scratch, 'ship', 'earth', 5400)
if (gc) {
  gc()
  gc()
}
const before = process.memoryUsage().heapUsed
const N = 2000
for (let i = 0; i < N; i++) project(live.sim, scratch, 'ship', 'earth', 5400)
if (gc) {
  gc()
  gc()
}
const delta = process.memoryUsage().heapUsed - before

console.log('\n=== what this establishes ===')
const checks = [
  ['the projection ran to a full revolution', Math.abs(leoSpan - leoPeriod) < 1e-6 && leoCount > 1],
  // Against the analytic conic, in the regime where the conic is trustworthy.
  ['on a point-mass Earth the apoapsis agrees with the analytic conic to 2 km', Math.abs(spherePass.apo) < 2000],
  /**
   * And on the real one it does not, by design.
   *
   * The osculating conic is fitted to the state *now*; the projection reports the
   * highest point of a revolution flown through a field the conic does not have.
   * The gap is J2's radial swing — 10.4 km of the 19.4 the scale allows here —
   * and it is asserted from both sides, because a gap of zero now would mean the
   * oblateness had stopped being applied rather than that the conic had got
   * better.
   */
  ['while the real Earth carries apoapsis off that conic, by a real fraction of the quadrupole scale',
    Math.abs(apoErr) < quadrupoleScale(e.apoapsisRadius) && Math.abs(apoErr) > quadrupoleScale(e.apoapsisRadius) / 4],
  ['periapsis agrees with the analytic conic to 2 km, on either Earth',
    Math.abs(periErr) < 2000 && Math.abs(spherePass.peri) < 2000],
  ['a bound orbit closes on a point-mass Earth', spherePass.gap / e.apoapsisRadius < 1e-3],
  ['and on the real Earth misses by the period the quadrupole shortens, no more', gap < closureBound],
  ['which is a gap of tens of kilometres, not the metres a sphere would close to', gap > 1e4],
  ['low orbit is nearly conic — energy flat to 0.1%', leo.spread < 1e-3],
  ...(lunar
    ? [
        /**
         * The reason the projection is integrated rather than solved. If this
         * were also flat, an ellipse would have done the job and the scratch
         * integrator would be ceremony.
         */
        /**
         * Stated in joules per kilogram rather than as a percentage: 0.1 MJ/kg
         * is a real change in the orbit, where a percentage of a quantity
         * passing through zero is not a number about anything. Low orbit
         * measures 0.03 kJ/kg over a revolution, so this is four orders away
         * from it either way.
         */
        ['a translunar coast is not conic — energy moves by over 0.1 MJ/kg', lunar.change > 1e5],
        ['and it changes class about Earth, which no conic can', lunar.crossesZero],
      ]
    : []),
  ['a path into the surface stops at the surface', stopped >= 0 && lastRadius <= R * 1.001],
  ['projection allocates nothing', !gc || Math.abs(delta) < 64 * 1024],
  /**
   * Cheap enough to redraw continuously. Five times a second is the map's
   * refresh, so 10 ms would be 5% of a core; the flight integrator's own
   * substepping put it at 154 ms, which is 77%.
   */
  ['a projection costs under 10 ms', perProjection < 10],
  ['the drawn line is contiguous — no gaps between segments', contiguous],
  ['it starts where the craft is', startsAtCraft],
  ['a truncated path collapses onto its last point, not the origin', collapsed],
]
let pass = true
for (const [label, ok] of checks) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`)
  if (!ok) pass = false
}
console.log(`\n  heap delta ${(delta / 1024).toFixed(2)} KB over ${N} projections` +
  ` (${(delta / N).toFixed(1)} bytes each)`)
console.log(`  ${pass ? 'PASS' : 'FAIL'}`)
process.exit(pass ? 0 : 1)
