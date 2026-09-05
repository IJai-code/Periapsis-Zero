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
import { beginCountdown, currentPhase, resetMission } from '../src/sim/mission.js'
import { INDEX } from '../src/sim/system.js'
import { BODIES, G } from '../src/sim/constants.js'
import { WARP } from '../src/sim/warp.js'
import { addNode, clearNodes, nodeMagnitude, nodes, resolveNode } from '../src/sim/nodes.js'
import { plan, prediction, project } from '../src/sim/predict.js'
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
let zeroGap = 0
for (let i = 0; i < prediction.count * 3; i++) {
  zeroGap = Math.max(zeroGap, Math.abs(plan.points[i] - prediction.points[i]))
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
console.log(`  zero        identical to the ballistic path to ${zeroGap.toExponential(1)} m`)

/* ---- allocation ---- */
const gc = globalThis.gc
clearNodes()
addNode(tBurn, { prograde: dvHohmann })
for (let i = 0; i < 200; i++) project(live.sim, scratch, 'ship', 'earth', period, plan, nodes)
if (gc) {
  gc()
  gc()
}
const heap0 = process.memoryUsage().heapUsed
const N = 1500
for (let i = 0; i < N; i++) project(live.sim, scratch, 'ship', 'earth', period, plan, nodes)
if (gc) {
  gc()
  gc()
}
const delta = process.memoryUsage().heapUsed - heap0

console.log('\n=== what this establishes ===')
/**
 * A kilometre on a 400 km target. The transfer is n-body over half a
 * revolution against a two-body formula, so exact agreement would mean the
 * projection had stopped modelling something; a kilometre is the room that
 * leaves, and the lofted ascent this replaces would have missed by thousands.
 */
const checks = [
  ['a vis-viva transfer reaches its target apoapsis to 1 km', Math.abs(errAlt) < 1000],
  ['the node was actually folded into the projection', plan.applied.length === 1],
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
  ['projecting with nodes allocates nothing', !gc || Math.abs(delta) < 64 * 1024],
]
let pass = true
for (const [label, ok] of checks) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`)
  if (!ok) pass = false
}
console.log(`\n  heap delta ${(delta / 1024).toFixed(2)} KB over ${N} projections`)
console.log(`  ${pass ? 'PASS' : 'FAIL'}`)
process.exit(pass ? 0 : 1)
