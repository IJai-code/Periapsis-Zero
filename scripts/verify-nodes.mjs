/**
 * Manoeuvre nodes: does a planned burn take the craft where the arithmetic says?
 *
 * The gate is a transfer with a closed-form answer. From a circular orbit at
 * r1, the prograde impulse that raises the far side to r2 follows from vis-viva
 * alone:
 *
 *   v1  = sqrt(mu / r1)                      speed on the circle
 *   a   = (r1 + r2) / 2                      transfer semi-major axis
 *   v1' = sqrt(mu (2/r1 - 1/a))              speed at periapsis of the transfer
 *   dv  = v1' - v1
 *
 * Nothing in that comes from the simulator. Feeding it in as a node and
 * projecting should produce an apoapsis at r2 — and if the projection or the
 * node basis is wrong, it will not, whatever the line looks like on screen.
 *
 * The other three checks are about the *basis*, which is the part that is easy
 * to get subtly wrong and impossible to see: a pure normal burn must turn the
 * plane without changing the orbit's size, a pure radial burn must swing the
 * apsides without changing the energy much, and a node of zero must change
 * nothing at all.
 *
 *   node --expose-gc scripts/verify-nodes.mjs
 */

import { flight, frame } from './flight.mjs'
import { live, refreshDerived, resetSimulation } from '../src/sim/live.js'
import { beginCountdown, currentPhase, mission, resetMission } from '../src/sim/mission.js'
import { INDEX } from '../src/sim/system.js'
import { BODIES, G } from '../src/sim/constants.js'
import { WARP } from '../src/sim/warp.js'
import { addNode, clearNodes, nodeMagnitude, nodes, resolveNode } from '../src/sim/nodes.js'
import { plan, prediction, project } from '../src/sim/predict.js'
import { SMALLEST_OBJECT, bytesPerCall, knownAllocation } from './allocation.mjs'
import { Vector3 } from 'three'

const MU = G * BODIES.earth.mass
const R = BODIES.earth.radius

resetSimulation()
resetMission()
refreshDerived()
flight.warp = WARP.x1
flight.lastWarpRequest = null
flight.warpBeforeBurn = null
flight.pilotWarp = WARP.x1
beginCountdown()
for (let i = 0; i < 3_000_000; i++) {
  frame()
  if (currentPhase().id === 'TLI_ALIGN') break
}

const scratch = live.sim.clone()
const e = live.elements
const period = e.period

/* Ballistic first, to find periapsis — the node fires there. */
project(live.sim, scratch, 'ship', 'earth', period, prediction)
const r1 = prediction.periapsis.radius
const tBurn = live.sim.t + prediction.periapsis.time

/** Target: a 400 km apoapsis. */
const TARGET_ALT = 400e3
const r2 = R + TARGET_ALT

/**
 * The closed-form answer, from vis-viva.
 *
 * Both terms, not one. The first version took the starting speed as
 * `sqrt(mu/r1)` — the speed on a *circle* through periapsis — while the actual
 * parking orbit is 172 x 185 km and therefore 4 m/s faster there. Asking for
 * the difference against a circle it was not on told it to burn 4 m/s too much
 * and put apoapsis 13 km high, which looked like the projection being wrong and
 * was the test being wrong. Both speeds now come from the same relation.
 */
const aCurrent = e.semiMajor
const vStart = Math.sqrt(MU * (2 / r1 - 1 / aCurrent))
const aTransfer = (r1 + r2) / 2
const vTransfer = Math.sqrt(MU * (2 / r1 - 1 / aTransfer))
const dvHohmann = vTransfer - vStart

console.log('=== a 185 to 400 km transfer ===')
console.log(`  from             ${((r1 - R) / 1e3).toFixed(1)} km periapsis` +
  ` (orbit is ${((prediction.periapsis.radius - R) / 1e3).toFixed(1)} x ${((prediction.apoapsis.radius - R) / 1e3).toFixed(1)} km)`)
console.log(`  to               ${(TARGET_ALT / 1e3).toFixed(0)} km apoapsis`)
console.log(`  vis-viva says    ${dvHohmann.toFixed(2)} m/s prograde, ${(prediction.periapsis.time / 60).toFixed(1)} min from now`)

clearNodes()
addNode(tBurn, { prograde: dvHohmann })
project(live.sim, scratch, 'ship', 'earth', period * 1.6, plan, nodes)

/**
 * Captured here, not read at the end. Later sections re-project with the sim
 * advanced past the node, where a node in the past is correctly skipped — so
 * checking `applied.length` after all of them measured the last projection
 * rather than this one, and reported zero.
 */
const foldedIn = plan.applied.length
const reachedAlt = (plan.apoapsis.radius - R) / 1e3
const errAlt = plan.apoapsis.radius - r2
console.log(`  projection gives ${reachedAlt.toFixed(2)} km apoapsis` +
  `  — ${errAlt >= 0 ? '+' : ''}${(errAlt / 1e3).toFixed(3)} km against the target`)
console.log(`  nodes folded in  ${plan.applied.length} (${plan.applied.join(', ')})`)

/* ---- the basis: what each axis is supposed to do, and only that ---- */
const before = { apo: prediction.apoapsis.radius, peri: prediction.periapsis.radius }

clearNodes()
addNode(tBurn, { normal: 60 })
project(live.sim, scratch, 'ship', 'earth', period, plan, nodes)
const normalApo = plan.apoapsis.radius
const normalPeri = plan.periapsis.radius

/* Inclination change: measure the angle between the orbit normals. */
const shipO = INDEX.ship * 6
const earthO = INDEX.earth * 6
const _dv = new Vector3()
const rr = new Vector3()
const vv = new Vector3()
const hBefore = new Vector3()
const hAfter = new Vector3()
{
  const s = live.sim.state
  rr.set(s[shipO] - s[earthO], s[shipO + 1] - s[earthO + 1], s[shipO + 2] - s[earthO + 2])
  vv.set(s[shipO + 3] - s[earthO + 3], s[shipO + 4] - s[earthO + 4], s[shipO + 5] - s[earthO + 5])
  hBefore.crossVectors(rr, vv).normalize()
  resolveNode(nodes[0], s, shipO, earthO, _dv)
  hAfter.crossVectors(rr, vv.clone().add(_dv)).normalize()
}
const planeTurn = (Math.acos(Math.min(1, hBefore.dot(hAfter))) * 180) / Math.PI

clearNodes()
addNode(tBurn, { radial: 60 })
project(live.sim, scratch, 'ship', 'earth', period, plan, nodes)
const radialApo = plan.apoapsis.radius
const radialPeri = plan.periapsis.radius

/**
 * What a radial impulse at periapsis should do, in closed form.
 *
 * It is perpendicular to the velocity, so it adds no angular momentum at all —
 * h is unchanged — and only `dv^2/2` of energy. What it does change is the
 * *direction* of the eccentricity vector, which swings the apsides around; on
 * an orbit this circular that is a large effect from a small burn.
 *
 *   |v'|^2 = v^2 + dv^2      a' = -mu / (2 eps')      h' = h
 *   e' = sqrt(1 - h'^2 / (mu a'))        r_a' = a'(1 + e')
 */
const RADIAL_DV = 60
const hStart = r1 * vStart
const epsRadial = (vStart * vStart + RADIAL_DV * RADIAL_DV) / 2 - MU / r1
const aRadial = -MU / (2 * epsRadial)
const eRadial = Math.sqrt(Math.max(0, 1 - (hStart * hStart) / (MU * aRadial)))
const radialApoExpected = aRadial * (1 + eRadial)

clearNodes()
addNode(tBurn, { prograde: 0, normal: 0, radial: 0 })
project(live.sim, scratch, 'ship', 'earth', period, plan, nodes)
/**
 * Compared where the two paths *end*, and at their apsides — not sample by
 * sample. The projection now places its samples where the path bends, and
 * folding in a node forces a sample at the burn, so the two runs draw the same
 * curve with points at different places along it. Index against index measured
 * that difference and called it 34 km of disagreement about physics.
 */
const lastOf = (p, k) => p.points[(p.count - 1) * 3 + k]
let zeroGap = Math.hypot(
  lastOf(plan, 0) - lastOf(prediction, 0),
  lastOf(plan, 1) - lastOf(prediction, 1),
  lastOf(plan, 2) - lastOf(prediction, 2),
)
/**
 * Apsides only where both passes actually found one. A projection leaves the
 * radius of an apsis it did not reach at whatever the last one left there, and
 * the planned pass only scans *after* the burn — so within one period it never
 * reaches the next periapsis. Comparing that stale field reported 44 km.
 */
for (const apsis of ['apoapsis', 'periapsis']) {
  if (plan[apsis].index >= 0 && prediction[apsis].index >= 0) {
    zeroGap = Math.max(zeroGap, Math.abs(plan[apsis].radius - prediction[apsis].radius))
  }
}

console.log('\n=== what each axis does ===')
console.log('  burn            apoapsis         periapsis        plane')
console.log(`  none        ${((before.apo - R) / 1e3).toFixed(1).padStart(10)} km` +
  `${((before.peri - R) / 1e3).toFixed(1).padStart(14)} km${'—'.padStart(13)}`)
console.log(`  60 normal   ${((normalApo - R) / 1e3).toFixed(1).padStart(10)} km` +
  `${((normalPeri - R) / 1e3).toFixed(1).padStart(14)} km${`${planeTurn.toFixed(2)}°`.padStart(13)}`)
console.log(`  60 radial   ${((radialApo - R) / 1e3).toFixed(1).padStart(10)} km` +
  `${((radialPeri - R) / 1e3).toFixed(1).padStart(14)} km${'—'.padStart(13)}`)
console.log(`              closed form says apoapsis ${((radialApoExpected - R) / 1e3).toFixed(1)} km` +
  `, semi-major moves ${((aRadial - aCurrent)).toFixed(0)} m`)
console.log(`  zero        ends where the ballistic path ends, to ${zeroGap.toExponential(1)} m, apsides included`)

/* ---- and now let the sequencer actually fly it ---- */
/**
 * The loop the whole thing exists to close.
 *
 * The map says a 62.80 m/s prograde node puts apoapsis at 400 km. If the
 * autopilot flies that node and ends up somewhere else, then the map and the
 * flight computer are describing different vehicles, and it does not matter
 * which of them is right.
 *
 * They will not agree exactly and should not: the projection applies the
 * impulse instantaneously and the vehicle takes a finite time to deliver it,
 * spending part of the burn off the ideal point. That loss is real physics,
 * not disagreement, and the check is sized to admit it.
 */
clearNodes()
project(live.sim, scratch, 'ship', 'earth', period, prediction)
const tBurn2 = live.sim.t + prediction.periapsis.time
const node = addNode(tBurn2, { prograde: dvHohmann })
project(live.sim, scratch, 'ship', 'earth', period * 1.6, plan, nodes)
const drawnApo = plan.apoapsis.radius

let sawAlign = false
let sawBurn = false
let flownApo = 0
for (let i = 0; i < 3_000_000; i++) {
  frame()
  const id = currentPhase().id
  if (id === 'NODE_ALIGN') sawAlign = true
  if (id === 'NODE_BURN') sawBurn = true
  // Once the node is behind us and the coast has resumed, read the orbit.
  if (node.executed && id !== 'NODE_BURN') {
    flownApo = live.elements.apoapsisRadius
    if (live.sim.t > node.t + 600) break
  }
}
const flownErr = flownApo - drawnApo

console.log('\n=== the sequencer flies the node ===')
console.log(`  aligned          ${sawAlign}, burned ${sawBurn}, executed ${node.executed}`)
console.log(`  delivered        ${mission.node.delivered.toFixed(2)} m/s of ${dvHohmann.toFixed(2)} asked`)
console.log(`  map drew         ${((drawnApo - R) / 1e3).toFixed(2)} km apoapsis`)
console.log(`  autopilot flew   ${((flownApo - R) / 1e3).toFixed(2)} km` +
  `  — ${flownErr >= 0 ? '+' : ''}${(flownErr / 1e3).toFixed(2)} km against the map`)
console.log(`  finite-burn loss is expected: the projection is an impulse, the burn is not`)

/* ---- what each burn leaves behind, per burn ---- */
/**
 * A two-burn Hohmann, which is the case the per-node readout exists for: raise
 * at periapsis, circularise at the transfer's apoapsis. Between them the path
 * reaches exactly one apsis and it belongs to neither burn's *result*, so
 * reading each node's orbit off the drawn line cannot work — and both have an
 * exact closed form to check against.
 */
clearNodes()
project(live.sim, scratch, 'ship', 'earth', period, prediction)
const hohmannAt = live.sim.t + prediction.periapsis.time
const rp = prediction.periapsis.radius
/**
 * A target of its own, not the 400 km one above. By this point the sequencer
 * has already flown the craft to a 400 km apoapsis, so a transfer aimed there
 * is a 0.1 m/s burn that changes nothing — the checks passed while measuring a
 * no-op.
 */
const rHigh = R + 1000e3
const vPeri = Math.sqrt(MU * (2 / rp - 1 / live.elements.semiMajor))
const aTr = (rp + rHigh) / 2
const vTransferPeri = Math.sqrt(MU * (2 / rp - 1 / aTr))
const vTransferApo = Math.sqrt(MU * (2 / rHigh - 1 / aTr))
const vCircle = Math.sqrt(MU / rHigh)
const halfTransfer = Math.PI * Math.sqrt((aTr * aTr * aTr) / MU)

addNode(hohmannAt, { prograde: vTransferPeri - vPeri })
addNode(hohmannAt + halfTransfer, { prograde: vCircle - vTransferApo })
project(live.sim, scratch, 'ship', 'earth', null, plan, nodes)

const firstOrbit = [plan.nodeApsides[0], plan.nodeApsides[1]]
const secondOrbit = [plan.nodeApsides[2], plan.nodeApsides[3]]
const bothApplied = plan.applied.length

console.log('\n=== what each burn leaves behind ===')
console.log(`  burn 1  ${(vTransferPeri - vPeri).toFixed(2)} m/s at periapsis` +
  ` — leaves ${((firstOrbit[0] - R) / 1e3).toFixed(1)} x ${((firstOrbit[1] - R) / 1e3).toFixed(1)} km` +
  `, closed form ${((rp - R) / 1e3).toFixed(1)} x ${((rHigh - R) / 1e3).toFixed(1)}`)
console.log(`  burn 2  ${(vCircle - vTransferApo).toFixed(2)} m/s ${(halfTransfer / 60).toFixed(1)} min later` +
  ` — leaves ${((secondOrbit[0] - R) / 1e3).toFixed(1)} x ${((secondOrbit[1] - R) / 1e3).toFixed(1)} km` +
  `, closed form ${((rHigh - R) / 1e3).toFixed(0)} circular`)

/* And an escape, where the far side does not exist. */
clearNodes()
addNode(hohmannAt, { prograde: 3200 })
project(live.sim, scratch, 'ship', 'earth', null, plan, nodes)
const escapeOrbit = [plan.nodeApsides[0], plan.nodeApsides[1]]
console.log(`  3,200 m/s — periapsis ${((escapeOrbit[0] - R) / 1e3).toFixed(0)} km, apoapsis ${escapeOrbit[1]}`)

/* ---- allocation ---- */
clearNodes()
addNode(tBurn, { prograde: dvHohmann })
/**
 * Bytes allocated per projection, measured across the loop — not heap left over
 * after a collection, which is what this gate used to read and which cannot see
 * garbage at all (scripts/allocation.mjs has the mutation that proved it). On
 * that measurement this check passed while the projection was allocating a
 * `Math.hypot` result per sample, some 34 KB a call.
 *
 * The limit is a kilobyte a projection. Anything allocated per *sample* is at
 * least 512 x 12 B = 6 KB and fails with room to spare; what remains, measured
 * between 30 and 240 B depending on the run, is at the edge of what a
 * heap-delta can resolve and is not claimed to be zero.
 */
const control = await knownAllocation()
const perProjection = await bytesPerCall(
  () => project(live.sim, scratch, 'ship', 'earth', period, plan, nodes),
  { calls: 512, warm: 3000, windows: 5 },
)
const PROJECTION_BUDGET = 1024

console.log('\n=== what this establishes ===')
/**
 * A kilometre on a 400 km target. The transfer is n-body over half a
 * revolution against a two-body formula, so exact agreement would mean the
 * projection had stopped modelling something; a kilometre is the room that
 * leaves, and the lofted ascent this replaces would have missed by thousands.
 */
const checks = [
  ['a vis-viva transfer reaches its target apoapsis to 1 km', Math.abs(errAlt) < 1000],
  ['the node was actually folded into the projection', foldedIn === 1],
  // Normal turns the plane and leaves the orbit's size alone.
  ['a normal burn turns the plane', planeTurn > 0.1],
  ['and barely moves the apsides', Math.abs(normalApo - before.apo) < 5000 &&
    Math.abs(normalPeri - before.peri) < 5000],
  // Radial swings the apsides around without adding much energy.
  ['a radial burn moves the apsides', Math.abs(radialApo - before.apo) > 1000],
  /**
   * Against the closed form, not against a guess at what "not much" means. The
   * first version compared the sum of the apsides before and after and failed —
   * because a radial burn at a near-circular orbit genuinely moves apoapsis by
   * 45 km, and because the periapsis it was reading was the *pre-burn* one.
   */
  ['and lands where the eccentricity change says it should',
    Math.abs(radialApo - radialApoExpected) < 2000],
  ['adding almost no energy: semi-major axis moves under a kilometre',
    Math.abs(aRadial - aCurrent) < 1000],
  /**
   * Relative to the orbit, because splitting the integration at the node is
   * two RK4 steps where the ballistic pass takes one, and the truncation error
   * differs in the last bits. Measured at 0.38 mm on a 6,550 km orbit — six
   * parts in a hundred billion — which is a rounding difference and not an
   * impulse.
   */
  ['a zero node changes nothing', zeroGap / r1 < 1e-9],
  ['a node carries its own magnitude', Math.abs(nodeMagnitude(nodes[0]) - dvHohmann) < 1e-9],
  ['both burns of a two-burn plan are folded in', bothApplied === 2],
  /**
   * A kilometre, the same allowance the transfer itself gets: these are
   * osculating two-body values taken inside an n-body integration, so they
   * cannot agree exactly and it would be suspicious if they did.
   */
  ['the first burn reports the transfer orbit it puts the craft on',
    Math.abs(firstOrbit[0] - rp) < 1000 && Math.abs(firstOrbit[1] - rHigh) < 1000],
  ['the second reports a circle at the target radius',
    Math.abs(secondOrbit[0] - rHigh) < 1000 && Math.abs(secondOrbit[1] - rHigh) < 1000],
  ['and a burn to escape reports no far side at all', escapeOrbit[1] === Infinity],
  ['the allocation measurement can see an allocation', !control || control.bytes >= SMALLEST_OBJECT],
  ['projecting with a node allocates under a kilobyte', !perProjection || perProjection.bytes < PROJECTION_BUDGET],
  ['the sequencer preempted the coast to fly the node', sawAlign && sawBurn],
  ['and marked it flown', node.executed],
  ['it delivered what was asked, to 1 m/s', Math.abs(mission.node.delivered - dvHohmann) < 1],
  /**
   * Two kilometres on a 400 km target. The gap is the finite-burn loss — an
   * impulse in the projection against 20-odd seconds of thrust in the flight —
   * and it is the quantity that would grow if the two ever stopped agreeing
   * about what a node means.
   */
  ['the flown orbit matches the one the map drew, to 2 km', Math.abs(flownErr) < 2000],
]
let pass = true
for (const [label, ok] of checks) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`)
  if (!ok) pass = false
}
if (perProjection) {
  console.log(`\n  allocation: ${perProjection.bytes.toFixed(0)} B per projection (budget ${PROJECTION_BUDGET}),` +
    ` control object ${control.bytes.toFixed(0)} B`)
}
console.log(`  ${pass ? 'PASS' : 'FAIL'}`)
process.exit(pass ? 0 : 1)
