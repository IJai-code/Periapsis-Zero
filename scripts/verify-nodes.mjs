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

import { flight, frame, restore, snapshot } from './flight.mjs'
import { activeStage, totalMass } from '../src/sim/ship.js'
import { live, refreshDerived, resetSimulation } from '../src/sim/live.js'
import { beginCountdown, currentPhase, mission, resetMission } from '../src/sim/mission.js'
import { INDEX } from '../src/sim/system.js'
import { BODIES, G } from '../src/sim/constants.js'
import { WARP } from '../src/sim/warp.js'
import { addNode, clearNodes, nodeMagnitude, nodes, resolveNode } from '../src/sim/nodes.js'
import { plan, prediction, project } from '../src/sim/predict.js'
import { SMALLEST_OBJECT, bytesPerCall, knownAllocation } from './allocation.mjs'
import { J2, REFERENCE_RADIUS } from '../src/sim/prem.js'
import { Vector3 } from 'three'

const MU = G * BODIES.earth.mass
const R = BODIES.earth.radius

/**
 * How far the quadrupole can move a point, metres — the bound every gate below
 * is now judged against instead of a remembered metre count.
 *
 * J2's radial perturbation is of order `3 J2 (R/r)^2` times the monopole's own
 * acceleration at that radius, and dividing by the orbit's frequency turns that
 * into a length: 19.5 km at 400 km altitude, 22 km on the parking orbit. It is
 * read from the same constant the field is built from, so a J2 typed wrong
 * moves the bound with it rather than being hidden by it.
 *
 * This gate did not have a field to be wrong about when its tolerances were
 * written — a kilometre on the transfer, two on the radial swing — and none of
 * those tolerances survive an oblate Earth, because the osculating apsis of a
 * low orbit swings ten to sixteen kilometres every revolution. The tolerances
 * below are re-derived rather than widened: each two-body claim is checked
 * against a *point-mass* Earth, where it still has to hold exactly, and the gap
 * the real Earth opens up is separately checked to be a real fraction of this
 * scale and no more than it.
 */
const quadrupoleScale = (r) => (3 * J2 * REFERENCE_RADIUS * REFERENCE_RADIUS) / r

/**
 * The same measurement on a point-mass Earth.
 *
 * The field is one-way state on the simulation — `zonal` in rk4.js — so it can
 * be lifted for a single projection and put back. This is what keeps the
 * loosened tolerances meaningful: without it, widening a claim in an oblate
 * world quietly stops testing the projector at all.
 */
const onSphere = (fn) => {
  const saved = live.sim.zonal
  live.sim.zonal = null
  const value = fn()
  live.sim.zonal = saved
  return value
}

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
const errAltSphere = onSphere(() => {
  project(live.sim, scratch, 'ship', 'earth', period * 1.6, plan, nodes)
  return plan.apoapsis.radius - r2
})
console.log(`  projection gives ${reachedAlt.toFixed(2)} km apoapsis` +
  `  — ${errAlt >= 0 ? '+' : ''}${(errAlt / 1e3).toFixed(3)} km against the target`)
console.log(`  the same burn    on a point-mass Earth lands ${(errAltSphere / 1e3).toFixed(3)} km from it;` +
  ` the ${((errAlt - errAltSphere) / 1e3).toFixed(2)} km between them is the quadrupole, whose radial scale at this orbit is ${(quadrupoleScale(r2) / 1e3).toFixed(1)} km`)
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
const radialApoSphere = onSphere(() => {
  project(live.sim, scratch, 'ship', 'earth', period, plan, nodes)
  return plan.apoapsis.radius
})

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
/**
 * A target of its own, not the 400 km one above. By this point the sequencer
 * has already flown the craft to a 400 km apoapsis, so a transfer aimed there
 * is a 0.1 m/s burn that changes nothing — the checks passed while measuring a
 * no-op.
 */
const rHigh = R + 1000e3

/**
 * The two-burn Hohmann, run in a stated field — each pass deriving its own
 * epochs and its own periapsis from its own ballistic projection.
 *
 * That structure is the point. Comparing one flight's numbers against another
 * field's closed form measures the epoch mismatch as much as it measures the
 * oblateness: the node times, the periapsis radius and the burn magnitudes all
 * come out of the projection, so a pass that flies a different gravity has to
 * re-derive them or it is aiming at where the craft would have been. Measured
 * the wrong way, the point-mass pass missed its own closed form by 2.6 km in a
 * field that is not there; measured this way it should reproduce it exactly,
 * which is what makes it a regression test for the pre-field behaviour rather
 * than another tolerance.
 */
function hohmann(field) {
  const saved = live.sim.zonal
  live.sim.zonal = field
  clearNodes()
  project(live.sim, scratch, 'ship', 'earth', period, prediction)
  const at = live.sim.t + prediction.periapsis.time
  const peri = prediction.periapsis.radius
  const semi = live.elements.semiMajor
  const vPeri = Math.sqrt(MU * (2 / peri - 1 / semi))
  const aTr = (peri + rHigh) / 2
  const dv1 = Math.sqrt(MU * (2 / peri - 1 / aTr)) - vPeri
  const dv2 = Math.sqrt(MU / rHigh) - Math.sqrt(MU * (2 / rHigh - 1 / aTr))
  const half = Math.PI * Math.sqrt((aTr * aTr * aTr) / MU)
  addNode(at, { prograde: dv1 })
  addNode(at + half, { prograde: dv2 })
  project(live.sim, scratch, 'ship', 'earth', null, plan, nodes)
  live.sim.zonal = saved
  return {
    at,
    peri,
    dv1,
    dv2,
    half,
    applied: plan.applied.length,
    orbits: [plan.nodeApsides[0], plan.nodeApsides[1], plan.nodeApsides[2], plan.nodeApsides[3]],
  }
}

const oblate = hohmann(live.sim.zonal)
const sphere = hohmann(null)
const hohmannAt = oblate.at
const rp = oblate.peri
const vTransferPeri = oblate.dv1 + Math.sqrt(MU * (2 / rp - 1 / live.elements.semiMajor))
const vPeri = Math.sqrt(MU * (2 / rp - 1 / live.elements.semiMajor))
const aTr = (rp + rHigh) / 2
const vCircle = Math.sqrt(MU / rHigh)
const vTransferApo = Math.sqrt(MU * (2 / rHigh - 1 / aTr))
const halfTransfer = oblate.half
const firstOrbit = [oblate.orbits[0], oblate.orbits[1]]
const secondOrbit = [oblate.orbits[2], oblate.orbits[3]]
const sphereOrbits = sphere.orbits
const bothApplied = oblate.applied

const highScale = quadrupoleScale(rHigh)
console.log('\n=== what each burn leaves behind ===')
console.log(`  on a point-mass Earth the same two burns leave ${((sphereOrbits[0] - R) / 1e3).toFixed(1)} x ${((sphereOrbits[1] - R) / 1e3).toFixed(1)}` +
  ` and ${((sphereOrbits[2] - R) / 1e3).toFixed(1)} x ${((sphereOrbits[3] - R) / 1e3).toFixed(1)} km, against the closed forms below`)
console.log(`  burn 1  ${oblate.dv1.toFixed(2)} m/s at periapsis` +
  ` — leaves ${((firstOrbit[0] - R) / 1e3).toFixed(1)} x ${((firstOrbit[1] - R) / 1e3).toFixed(1)} km` +
  `, closed form ${((rp - R) / 1e3).toFixed(1)} x ${((rHigh - R) / 1e3).toFixed(1)}`)
console.log(`  burn 2  ${oblate.dv2.toFixed(2)} m/s ${(halfTransfer / 60).toFixed(1)} min later` +
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

const transferScale = quadrupoleScale(r2)
console.log('\n=== what this establishes ===')
/**
 * A kilometre on a 400 km target — on an Earth that is a point mass.
 *
 * The transfer is n-body over half a revolution against a two-body formula, so
 * exact agreement would mean the projection had stopped modelling something; a
 * kilometre is the room that leaves, and the lofted ascent this replaces would
 * have missed by thousands. On the real, oblate Earth the same burn is short of
 * the target by a large fraction of `quadrupoleScale`, and that is as much a
 * result as the two-body agreement is: the claim being made is now that the
 * field moves the answer by the amount the field can move it, no more and —
 * since a field that had silently stopped being applied would read zero — no
 * less.
 */
const checks = [
  ['a vis-viva transfer reaches its target apoapsis to 1 km on a point-mass Earth', Math.abs(errAltSphere) < 1000],
  ['and on the real Earth it comes up short by a real fraction of the quadrupole scale',
    Math.abs(errAlt) > transferScale / 4 && Math.abs(errAlt) < transferScale],
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
    Math.abs(radialApoSphere - radialApoExpected) < 2000],
  ['which the oblateness also moves, by the same kind of fraction',
    Math.abs(radialApo - radialApoSphere) > transferScale / 4 && Math.abs(radialApo - radialApoSphere) < transferScale],
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
    Math.abs(sphereOrbits[0] - sphere.peri) < 1000 && Math.abs(sphereOrbits[1] - rHigh) < 1000],
  ['the second reports a circle at the target radius',
    Math.abs(sphereOrbits[2] - rHigh) < 1000 && Math.abs(sphereOrbits[3] - rHigh) < 1000],
  ['and the oblateness moves the far side of the transfer by its own scale, not more',
    Math.abs(firstOrbit[1] - sphereOrbits[1]) < highScale],
  /**
   * The mean, and the spread.
   *
   * The second burn arrives at a radius that the oblateness has moved off the
   * two-body 1,000 km by up to its own scale, so the orbit it leaves is not
   * quite circular however exact the impulse is — the *mean* is still the
   * target, and the apsides can be a scale apart on either side of it. Both
   * are asserted, because only together do they say the burn did its job: the
   * mean is a statement about the energy the burn added, the spread about
   * whether it was applied where it was aimed.
   */
  ['and a circularising burn still lands at the target, its apsides inside twice the quadrupole scale',
    Math.abs((secondOrbit[0] + secondOrbit[1]) / 2 - rHigh) < highScale &&
    Math.abs(secondOrbit[1] - secondOrbit[0]) < 2 * highScale],
  ['and a burn to escape reports no far side at all', escapeOrbit[1] === Infinity],
  ['the allocation measurement can see an allocation', !control || control.bytes >= SMALLEST_OBJECT],
  ['projecting with a node allocates under a kilobyte', !perProjection || perProjection.bytes < PROJECTION_BUDGET],
  ['the sequencer preempted the coast to fly the node', sawAlign && sawBurn],
  ['and marked it flown', node.executed],
  ['it delivered what was asked, to 1 m/s', Math.abs(mission.node.delivered - dvHohmann) < 1],
  /**
   * Two kilometres of finite-burn loss, plus the quadrupole's scale.
   *
   * The gap used to be the finite-burn loss alone — an impulse in the projection
   * against twenty-odd seconds of thrust in the flight — and that is still most
   * of what it is. What is added is the other, larger term, and it is not a
   * fudge: the map reports the *highest point of the drawn path* while the
   * flight reads the osculating apogee after the burn, and in an oblate field
   * those two are different quantities that differ by the J2 swing — 10.7 km of
   * it on the transfer above, measured both ways. Both numbers stay right; what
   * the check guards is unchanged, that a node means the same thing to the map
   * and to the autopilot. It would still fail on a node the projector and the
   * sequencer disagreed about, which is the failure it was written for.
   */
  ['the flown orbit matches the one the map drew, to the finite burn plus the J2 swing',
    Math.abs(flownErr) < 2000 + quadrupoleScale(r2)],
]
/**
 * Run after the checks above have been evaluated: the section below restores
 * snapshots and flies burns, which rewrites the live plan and the delivered
 * delta-v that several of those checks read.
 */
/* ---- a node inside a warped coast ---- */
/**
 * The same 5 m/s node, placed at each point of a 360 s frame cycle inside a
 * coast warped to 6 h/s.
 *
 * The preemption is tested once a frame and looks for a window 60 s wide, so a
 * node here used to be caught only when a frame boundary happened to land in
 * that minute — one placement in six. The other five were skipped outright:
 * the sequencer flew on through injection to lunar approach with the burn
 * never made, and the plan still drawing it. The one that was caught lit 332 s
 * late, because the frame that entered NODE_ALIGN had already committed to its
 * full step. The step ceiling is what this is checking.
 */
clearNodes()
for (let i = 0; i < 3; i++) frame()
const coastState = `phase ${currentPhase().id}, request ${mission.warpRequest}, dial ${flight.warp}, ` +
  `Moon ${((mission.tli.outOfPlane * 180) / Math.PI).toFixed(1)} deg out of plane, active node ${mission.node.active?.id ?? 'none'}`
const coast = snapshot()
const warped = []
for (let offset = 7200; offset < 7560; offset += 60) {
  restore(coast)
  clearNodes()
  /**
   * The pilot's dial at 6 h/s: this flight never commits to the Moon, so it is
   * in COAST, where time is the pilot's. That is the case a pilot makes by
   * planning a burn and warping toward it. NODE_ALIGN still takes the dial
   * down to 1x when it preempts, and hands it back after the burn. The same
   * frame meeting a node under the *sequencer's* 6 h/s is what verify-loiter's
   * raise burns fly through during TLI_ALIGN.
   */
  flight.warp = WARP.h6
  flight.pilotWarp = WARP.h6
  const tNode = live.sim.t + offset
  const n = addNode(tNode, { prograde: 5 })
  let last = currentPhase().id
  let burnAt = NaN
  let burnEnd = NaN
  let frames = 0
  for (let i = 0; i < 200_000 && !n.executed; i++) {
    const before = live.sim.t
    frame()
    frames++
    const id = currentPhase().id
    if (id !== last) {
      if (id === 'NODE_BURN') burnAt = before
      if (last === 'NODE_BURN') burnEnd = live.sim.t
      last = id
    }
  }
  warped.push({ offset, frames, executed: n.executed, late: (burnAt + burnEnd) / 2 - tNode, delivered: mission.node.delivered })
}
clearNodes()
/** One frame of full thrust at 1x: the finest a delivered-delta-v cutoff can resolve. */
const frameDv = activeStage().thrust / totalMass() / 60

console.log('\n=== a node inside a 6 h/s coast ===')
console.log(`  coast inherited: ${coastState}`)
console.log('  a 5 m/s node at each point of a 360 s frame cycle, pilot dial at 6 h/s:')
for (const w of warped) {
  console.log(`    +${w.offset} s   flown ${String(w.executed).padEnd(5)} after ${String(w.frames).padStart(4)} frames   burn midpoint ${w.late.toFixed(3)} s from the node   delivered ${w.delivered.toFixed(3)} m/s`)
}

checks.push(
  ['a node inside a 6 h/s coast is flown wherever the frames fall',
    warped.length === 6 && warped.every((w) => w.executed)],
  ['on time, to two frames at 1x', warped.every((w) => Math.abs(w.late) < 2 / 60)],
  ['delivering what was asked, to one frame of thrust', warped.every((w) => Math.abs(w.delivered - 5) <= frameDv)],
)

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
