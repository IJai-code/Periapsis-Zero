/**
 * How far the projection looks, and how finely it steps.
 *
 * Four things were measured wrong before this, and each one is re-measured
 * here rather than asserted fixed:
 *
 *   1  a node days away was silently dropped — the plan looked 1.5 revolutions
 *      ahead, which from a parking orbit is 132 minutes
 *   2  stretching that window drew low orbit as a ten-sided polygon and left
 *      91 km of error by the second burn
 *   3  its chords cut 183 km below sea level while every sample sat 172 km up
 *   4  a lunar orbit was projected over the craft's *geocentric* period, an
 *      arbitrary 6.2 hours
 *
 * The fix is two separate choices, and the point of this gate is that they are
 * separate. The horizon is an event — one revolution after the last burn, or a
 * surface, or a backstop. The step is the local orbital timescale at the
 * craft's current distance, which is the criterion the flight integrator has
 * always used and the projection never did.
 *
 *   node --expose-gc scripts/verify-horizon.mjs
 */

import { flyMission } from './flight.mjs'
import { SMALLEST_OBJECT, bytesPerCall, knownAllocation } from './allocation.mjs'
import { live, refreshDerived, resetSimulation } from '../src/sim/live.js'
import { BODIES, G } from '../src/sim/constants.js'
import { INDEX } from '../src/sim/system.js'
import { addNode, clearNodes, nodes, resolveNode } from '../src/sim/nodes.js'
import { dominantBody } from '../src/sim/soi.js'
import {
  MAX_STEPS,
  SAMPLES,
  STEPS_PER_LOCAL_PERIOD,
  plan,
  prediction,
  project,
} from '../src/sim/predict.js'
import { Vector3 } from 'three'

const MU = G * BODIES.earth.mass
const RE = BODIES.earth.radius
const C = INDEX.ship * 6
const E = INDEX.earth * 6
const M = INDEX.moon * 6

/**
 * `flyMission` resets the *mission* and not the simulation, so a second flight
 * in one process launches from wherever the first one stopped — and a sequencer
 * running its ascent on a craft already in orbit produces nonsense that looks
 * like a projection bug. Every flight here resets the world first.
 */
const launch = (until) => {
  resetSimulation()
  refreshDerived()
  flyMission(until, { onPhase: () => {} })
  refreshDerived()
}

launch('TLI_ALIGN')
const scratch = live.sim.clone()
const probe = live.sim.clone()
const parking = live.elements.period

/* ---- 1. a parking orbit: one revolution, decided by the projection ---- */
project(live.sim, scratch, 'ship', 'earth', null)
const leo = {
  closed: prediction.closed,
  span: prediction.span,
  steps: prediction.steps,
  count: prediction.count,
  apo: prediction.apoapsis.radius,
  peri: prediction.periapsis.radius,
  apoConic: live.elements.apoapsisRadius,
  periConic: live.elements.periapsisRadius,
}
let leoCost = 0
{
  const t0 = performance.now()
  for (let i = 0; i < 20; i++) project(live.sim, scratch, 'ship', 'earth', null)
  leoCost = (performance.now() - t0) / 20
}
console.log('=== a parking orbit, with nothing asked for ===')
console.log(`  closed             ${leo.closed} after ${(leo.span / 60).toFixed(3)} min` +
  `  (the orbit's own period is ${(parking / 60).toFixed(3)})`)
console.log(`  cost               ${leo.steps} steps, ${leo.count} drawn, ${leoCost.toFixed(2)} ms`)
console.log(`  apsides            ${((leo.peri - RE) / 1e3).toFixed(3)} x ${((leo.apo - RE) / 1e3).toFixed(3)} km` +
  `  — ${(leo.peri - leo.periConic).toFixed(2)} m and ${(leo.apo - leo.apoConic).toFixed(2)} m from the analytic conic`)

/* ---- 2 and 3. the orbit that broke the old scheme ---- */
/**
 * A translunar-sized ellipse, e 0.916: fast and low at perigee, slow and far at
 * apogee. Equal steps and equal samples both fail on it, in different ways.
 */
const burned = live.sim.clone()
burned.resetFrom(live.sim)
{
  const s = burned.state
  const vx = s[C + 3] - s[E + 3]
  const vy = s[C + 4] - s[E + 4]
  const vz = s[C + 5] - s[E + 5]
  const v = Math.sqrt(vx * vx + vy * vy + vz * vz)
  s[C + 3] += (vx / v) * 3000
  s[C + 4] += (vy / v) * 3000
  s[C + 5] += (vz / v) * 3000
}
const bs = burned.state
const r0 = Math.hypot(bs[C] - bs[E], bs[C + 1] - bs[E + 1], bs[C + 2] - bs[E + 2])
const v0 = Math.hypot(bs[C + 3] - bs[E + 3], bs[C + 4] - bs[E + 4], bs[C + 5] - bs[E + 5])
const aT = 1 / (2 / r0 - (v0 * v0) / MU)
const T = 2 * Math.PI * Math.sqrt((aT * aT * aT) / MU)
const eccT = 1 - r0 / aT

/** Integrate the burned state for `T` with a stated step policy. */
function fly(policy) {
  probe.resetFrom(burned)
  let t = 0
  let steps = 0
  while (t < T) {
    const h = Math.min(policy(), T - t)
    probe.step(h)
    t += h
    steps++
  }
  return {
    steps,
    x: probe.state[C] - probe.state[E],
    y: probe.state[C + 1] - probe.state[E + 1],
    z: probe.state[C + 2] - probe.state[E + 2],
  }
}
const radiusNow = () => {
  const s = probe.state
  return Math.hypot(s[C] - s[E], s[C + 1] - s[E + 1], s[C + 2] - s[E + 2])
}
const localPeriod = () => 2 * Math.PI * Math.sqrt(radiusNow() ** 3 / MU)
const reference = fly(() => 0.5)
const gapFrom = (p) => Math.hypot(p.x - reference.x, p.y - reference.y, p.z - reference.z)

project(burned, scratch, 'ship', 'earth', T)
const drawn = {
  steps: prediction.steps,
  count: prediction.count,
  x: prediction.points[(prediction.count - 1) * 3],
  y: prediction.points[(prediction.count - 1) * 3 + 1],
  z: prediction.points[(prediction.count - 1) * 3 + 2],
}
const drawnError = gapFrom(drawn)
const equalSteps = fly(() => T / drawn.steps)
const scaledHalf = fly(() => localPeriod() / (STEPS_PER_LOCAL_PERIOD / 2))
const scaledFull = fly(() => localPeriod() / STEPS_PER_LOCAL_PERIOD)

/** Lowest point of any drawn chord — what the pilot sees, not what was sampled. */
function lowestChord(p, from = 0, to = p.count - 1) {
  let lowest = Infinity
  for (let i = from; i < to; i++) {
    const ax = p.points[i * 3]
    const ay = p.points[i * 3 + 1]
    const az = p.points[i * 3 + 2]
    const bx = p.points[i * 3 + 3] - ax
    const by = p.points[i * 3 + 4] - ay
    const bz = p.points[i * 3 + 5] - az
    const len2 = bx * bx + by * by + bz * bz
    const u = len2 > 0 ? Math.max(0, Math.min(1, -(ax * bx + ay * by + az * bz) / len2)) : 0
    lowest = Math.min(lowest, Math.hypot(ax + bx * u, ay + by * u, az + bz * u))
  }
  return lowest
}
let lowestSample = Infinity
for (let i = 0; i < prediction.count; i++) {
  lowestSample = Math.min(lowestSample, Math.hypot(
    prediction.points[i * 3], prediction.points[i * 3 + 1], prediction.points[i * 3 + 2],
  ))
}
const drawnLow = lowestChord(prediction)

/**
 * The same path drawn the old way: SAMPLES points spread evenly in time. Not a
 * reimplementation of anything — just where equal spacing puts its points.
 */
let evenLow = Infinity
{
  probe.resetFrom(burned)
  const dt = T / (SAMPLES - 1)
  let prev = null
  for (let i = 0; i < SAMPLES; i++) {
    if (i > 0) probe.advance(dt, dt / 4, 4)
    const s = probe.state
    const p = [s[C] - s[E], s[C + 1] - s[E + 1], s[C + 2] - s[E + 2]]
    if (prev) {
      const b = [p[0] - prev[0], p[1] - prev[1], p[2] - prev[2]]
      const len2 = b[0] * b[0] + b[1] * b[1] + b[2] * b[2]
      const u = len2 > 0 ? Math.max(0, Math.min(1, -(prev[0] * b[0] + prev[1] * b[1] + prev[2] * b[2]) / len2)) : 0
      evenLow = Math.min(evenLow, Math.hypot(prev[0] + b[0] * u, prev[1] + b[1] * u, prev[2] + b[2] * u))
    }
    prev = p
  }
}

console.log('\n=== an ellipse of e 0.916, one revolution ===')
console.log(`  orbit              ${((r0 - RE) / 1e3).toFixed(0)} x ${((2 * aT - r0 - RE) / 1e3).toFixed(0)} km, ${(T / 86400).toFixed(2)} d`)
console.log(`  the projection     ${drawn.steps} steps, ${drawn.count} drawn, ${drawnError.toFixed(1)} m off a 0.5 s integration`)
console.log(`  equal steps, same count        ${(gapFrom(equalSteps) / 1e3).toFixed(1)} km off`)
console.log(`  local period / ${(STEPS_PER_LOCAL_PERIOD / 2).toString().padEnd(4)}           ${gapFrom(scaledHalf).toFixed(1)} m off in ${scaledHalf.steps} steps`)
console.log(`  local period / ${STEPS_PER_LOCAL_PERIOD.toString().padEnd(4)}           ${gapFrom(scaledFull).toFixed(1)} m off in ${scaledFull.steps} steps` +
  `  — ${(gapFrom(scaledHalf) / Math.max(gapFrom(scaledFull), 1e-9)).toFixed(1)}x better for 2x the steps`)
console.log(`  lowest sample      ${((lowestSample - RE) / 1e3).toFixed(1)} km altitude`)
console.log(`  lowest drawn chord ${((drawnLow - RE) / 1e3).toFixed(1)} km` +
  `   — spread evenly in time instead: ${((evenLow - RE) / 1e3).toFixed(1)} km`)

/* ---- 4. a plan with a burn days past the first ---- */
clearNodes()
const tA = live.sim.t + 600
const tB = live.sim.t + 3 * 86400
addNode(tA, { prograde: 3000 })
addNode(tB, { prograde: -50 })
project(live.sim, scratch, 'ship', 'earth', null, plan, nodes)
const twoNode = {
  applied: plan.applied.slice(),
  steps: plan.steps,
  count: plan.count,
  span: plan.span,
  truncated: plan.truncated,
  at: new Vector3(plan.nodeFrames[12], plan.nodeFrames[13], plan.nodeFrames[14]),
}
let twoNodeCost = 0
{
  const t0 = performance.now()
  for (let i = 0; i < 10; i++) project(live.sim, scratch, 'ship', 'earth', null, plan, nodes)
  twoNodeCost = (performance.now() - t0) / 10
}

/** The same two impulses, integrated independently at two-second steps. */
const chunk = (seconds, h) => {
  let left = seconds
  while (left > 0) {
    const s = Math.min(left, 1800)
    probe.advance(s, h, 1e6)
    left -= s
  }
}
const dv = new Vector3()
probe.resetFrom(live.sim)
chunk(tA - live.sim.t, 2)
resolveNode(nodes[0], probe.state, C, E, dv)
probe.state[C + 3] += dv.x
probe.state[C + 4] += dv.y
probe.state[C + 5] += dv.z
chunk(tB - tA, 2)
const trueAtB = new Vector3(
  probe.state[C] - probe.state[E],
  probe.state[C + 1] - probe.state[E + 1],
  probe.state[C + 2] - probe.state[E + 2],
)

console.log('\n=== a burn ten minutes out and another three days later ===')
console.log(`  folded in          ${JSON.stringify(twoNode.applied)} of ${JSON.stringify(nodes.map((n) => n.id))}` +
  `  over ${(twoNode.span / 86400).toFixed(2)} days`)
console.log(`  cost               ${twoNode.steps} steps, ${twoNode.count} drawn, ${twoNodeCost.toFixed(2)} ms, truncated ${twoNode.truncated}`)
console.log(`  second burn lands  ${(twoNode.at.distanceTo(trueAtB) / 1e3).toFixed(3)} km from an independent 2 s integration`)

/* ---- 5, 6. lunar orbit: whose revolution, and whose surface ---- */
launch('LUNAR_ORBIT')
clearNodes()
const lunarBody = dominantBody(live.sim, 'ship')
project(live.sim, scratch, 'ship', lunarBody, null)
const lunar = {
  body: lunarBody,
  closed: prediction.closed,
  span: prediction.span,
  steps: prediction.steps,
  period: live.lunar.period,
  geocentric: live.elements.period,
  bound: live.elements.bound,
}
addNode(live.sim.t + 120, { prograde: -400 })
project(live.sim, scratch, 'ship', lunarBody, null, plan, nodes)
const crash = { body: plan.impact.body, index: plan.impact.index, count: plan.count }
const endRadius = Math.hypot(
  plan.points[(plan.count - 1) * 3] - 0,
  plan.points[(plan.count - 1) * 3 + 1],
  plan.points[(plan.count - 1) * 3 + 2],
)
console.log('\n=== in lunar orbit ===')
console.log(`  drawn about        ${lunar.body}, closed ${lunar.closed} after ${(lunar.span / 60).toFixed(1)} min`)
console.log(`  its lunar period   ${(lunar.period / 60).toFixed(1)} min` +
  `   — its *geocentric* period, which the old horizon used, is ${(lunar.geocentric / 3600).toFixed(1)} h`)
console.log(`  400 m/s retrograde ends on ${crash.body} at ${((endRadius - BODIES.moon.radius) / 1e3).toFixed(2)} km altitude`)

/* ---- 7. a plan too big to draw says so ---- */
clearNodes()
addNode(live.sim.t + 30 * 86400, { prograde: 10 })
const t0 = performance.now()
project(live.sim, scratch, 'ship', lunarBody, null, plan, nodes)
const budgetCost = performance.now() - t0
const budget = { truncated: plan.truncated, steps: plan.steps, applied: plan.applied.length, count: plan.count }
console.log('\n=== a burn a month away ===')
console.log(`  truncated ${budget.truncated} at ${budget.steps} steps (cap ${MAX_STEPS}), ${budget.count} drawn, ${budgetCost.toFixed(1)} ms`)

/* ---- allocation ---- */
clearNodes()
launch('TLI_ALIGN')
const bare = await bytesPerCall(() => project(live.sim, scratch, 'ship', 'earth', null), { calls: 256, warm: 2000, windows: 5 })
addNode(live.sim.t + 600, { prograde: 60 })
const planned = await bytesPerCall(() => project(live.sim, scratch, 'ship', 'earth', null, plan, nodes), { calls: 256, warm: 2000, windows: 5 })
const control = await knownAllocation()
console.log('\n=== allocation ===')
console.log(`  ballistic ${bare.bytes.toFixed(0)} B, planned ${planned.bytes.toFixed(0)} B per projection` +
  `  (a known allocation measures ${control ? control.bytes.toFixed(0) : 'n/a'} B)`)

/* ---- verdict ---- */
console.log('\n=== what this establishes ===')
const checks = [
  ['a bound orbit ends after exactly one revolution',
    leo.closed && Math.abs(leo.span - parking) / parking < 1e-4],
  /**
   * Ten metres on a 6,550 km orbit. What is being measured here is not the
   * integration — it is the gap between an n-body projection and a two-body
   * conic, which verify-predict measures at 1.3 m at apoapsis and gates at two
   * kilometres. A metre was tighter than that difference actually is.
   */
  ['its apsides still match the analytic conic to ten metres',
    Math.abs(leo.apo - leo.apoConic) < 10 && Math.abs(leo.peri - leo.periConic) < 10],
  ['and it costs no more than the old fixed grid did', leoCost < 2 && leo.count <= SAMPLES],
  /**
   * A hundred metres on a 143,500 km apogee, four days of integration: the
   * convergence sweep below puts this divisor near ten, and a hundred leaves
   * room for the state it starts from to differ run to run.
   */
  ['an eccentric orbit projects to within 100 m of a 0.5 s integration', drawnError < 100],
  ['where equal steps of the same count are a thousand times worse',
    gapFrom(equalSteps) > drawnError * 1000],
  // Fourth order: halving the step should cut the error by about sixteen.
  ['the step rule converges at fourth order',
    gapFrom(scaledHalf) / Math.max(gapFrom(scaledFull), 1e-9) > 8],
  ['no drawn chord dips below the surface', drawnLow > RE],
  ['where spreading the same count evenly in time does', evenLow < RE],
  ['a burn three days out is folded into the plan', twoNode.applied.length === 2],
  ['and lands within a kilometre of an independent integration',
    twoNode.at.distanceTo(trueAtB) < 1000],
  ['a plan spanning days still redraws inside a frame', twoNodeCost < 8],
  ['a lunar orbit is projected about the Moon', lunar.body === 'moon'],
  ['for one lunar revolution, not the geocentric one',
    lunar.closed && Math.abs(lunar.span - lunar.period) / lunar.period < 0.05],
  ['and the two are nothing like each other',
    Math.abs(lunar.geocentric - lunar.period) / lunar.period > 1],
  ['a plan into the Moon stops at the Moon', crash.body === 'moon' &&
    Math.abs(endRadius - BODIES.moon.radius) < 1e3],
  ['a plan too big for the budget says so instead of hanging',
    budget.truncated && budget.applied === 0 && budget.steps <= MAX_STEPS],
  ['and still returns inside a frame', budgetCost < 16],
  ['projecting allocates under a kilobyte', bare.bytes < 1024 && planned.bytes < 1024],
  ['and the measurement can see one when there is one', !control || control.bytes >= SMALLEST_OBJECT],
]
let pass = true
for (const [label, ok] of checks) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`)
  if (!ok) pass = false
}
console.log(`\n  ${pass ? 'PASS' : 'FAIL'}`)
process.exit(pass ? 0 : 1)
