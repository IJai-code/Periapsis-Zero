/**
 * Capturing onto a halo, from a lunar approach this mission actually flies.
 *
 * The other NRHO gates start by *placing* a craft on an orbit. This one flies
 * Apollo 8 off the pad, waits out the window, injects, coasts to the Moon, and
 * then asks whether the vehicle that arrives can join a halo — which for a long
 * time the answer was no.
 *
 * **Why three burns.** A Hohmann-class transfer arrives ahead of the Moon and is
 * overtaken, so the craft's excess velocity points against the Moon's motion and
 * a 1,827 km flyby turns it by only about 100 degrees. Whichever pole the craft
 * passes, it circulates the way the halo over the *opposite* pole does: measured
 * at 178-179 degrees from the halo's angular momentum at both, with 19 Newton
 * solves seeded to 400 m/s in six directions never leaving that branch, and no
 * launch epoch in a month changing it. Matching velocity at perilune costs
 * 3,419-3,451 m/s, which is not a capture but a plane reversal. So this joins
 * the halo where both are slow instead: capture at periselene, rotate at the
 * transfer's apolune, match at one of the reference's own apolune patch points.
 *
 * **Then it is flown twice.** First as impulses applied by this script, which
 * checks the solution and the trajectory it produces but not the delivery: the
 * capture burn alone is 53 s of service module. Then by the flight computer —
 * planned as nodes on the approach, flown as finite burns centred on their
 * instants, with a transfer correction and an insertion solved again against the
 * states the craft actually reaches. Flown that way it spends 581.6 m/s against
 * the 580.2 solved, and is 54.5 km off the reference at the first maintenance
 * pass, which the cycle closes to 4.8 km in four revolutions.
 *
 *   node --expose-gc scripts/verify-nrho-capture.mjs [revolutions to hold]
 */

import { flight, flyMission, frame } from './flight.mjs'
import { WARP } from '../src/sim/warp.js'
import { live, refreshDerived, resetSimulation } from '../src/sim/live.js'
import { armHaloCaptureInBackground, currentPhase, mission, resetMission } from '../src/sim/mission.js'
import { nodeMagnitude, nodes } from '../src/sim/nodes.js'
import { INDEX } from '../src/sim/system.js'
import { BODIES } from '../src/sim/constants.js'
import { deltaV } from '../src/sim/ship.js'
import { continueFamily, correctPeriodicOrbit, nrhoSeed } from '../src/sim/cr3bp.js'
import { referenceStateAt, solveHaloKeeping } from '../src/sim/halo.js'
import { lambert, solveHaloCapture } from '../src/sim/capture.js'

const HOLD = Number(process.argv[2] ?? 4)
const SEP_NOMINAL = 384400e3
const TU_DAYS = 27.321661 / (2 * Math.PI)
const O = INDEX.ship * 6
const M = INDEX.moon * 6
const MOON_R = BODIES.moon.radius
const norm = (a) => Math.hypot(a[0], a[1], a[2])

/* ---------------------------------------------------------------- *
 * A. Lambert, against a worked example
 * ---------------------------------------------------------------- */

/**
 * Vallado's example 7-5, in km and seconds, because the seed for the second
 * burn is only as good as this and a solver that quietly returns nonsense would
 * still converge somewhere.
 */
const worked = lambert([15945.34, 0, 0], [12214.83899, 10249.46731, 0], 76 * 60, 398600.4418)
const lambertError = worked
  ? Math.max(
      Math.hypot(worked.v1[0] - 2.058913, worked.v1[1] - 2.915965, worked.v1[2]),
      Math.hypot(worked.v2[0] + 3.451565, worked.v2[1] - 0.910315, worked.v2[2]),
    ) * 1000
  : Infinity
console.log('=== A. Lambert against Vallado example 7-5 ===')
console.log(`  v1 ${worked ? worked.v1.map((c) => c.toFixed(6)).join(' ') : 'no solution'}  (2.058913 2.915965 0.000000)`)
console.log(`  worst component error ${lambertError.toFixed(3)} m/s`)

/* ---------------------------------------------------------------- *
 * B. The family member, and a flown lunar approach
 * ---------------------------------------------------------------- */

const seed = correctPeriodicOrbit(nrhoSeed(5237e3 / SEP_NOMINAL, 70000e3 / SEP_NOMINAL), {
  pin: 'z',
  maxIter: 60,
  damping: 0.5,
})
const run = continueFamily(
  { x: seed.x, z: seed.z, vy: seed.vy },
  { target: 2200e3 / SEP_NOMINAL, steps: 400, ds: 3e-4, dsMax: 2e-3 },
)
const TARGET_DAYS = (2 * 29.530589) / 9
let member = run.members[0]
for (const m of run.members) {
  if (Math.abs(m.period * TU_DAYS - TARGET_DAYS) < Math.abs(member.period * TU_DAYS - TARGET_DAYS)) member = m
}

resetSimulation()
resetMission()
refreshDerived()
const flownAt = Date.now()
flyMission('LOI_ALIGN', { onPhase: () => {} })
const flownMs = Date.now() - flownAt
const arrived = currentPhase().id === 'LOI_ALIGN'
const budget = deltaV()
console.log('\n=== B. flown to the Moon ===')
console.log(`  ${currentPhase().id} after ${flownMs} ms of wall clock`)
console.log(`  periselene in ${(live.lunar.timeToPeriapsis / 60).toFixed(1)} min at ${(live.lunar.perigee / 1e3).toFixed(0)} km altitude`)
console.log(`  delta-v left in the stack: ${budget.toFixed(0)} m/s; capture into lunar orbit would spend 819`)

/* ---------------------------------------------------------------- *
 * C. The capture
 * ---------------------------------------------------------------- */

const solvedAt = Date.now()
const capture = solveHaloCapture(live.sim, member, { revolutions: HOLD + 2 })
const solveMs = Date.now() - solvedAt

console.log(`\n=== C. the capture, ${capture.tried.length} cells in ${(solveMs / 1000).toFixed(1)} s ===`)
console.log('  apolune   pole    coast d   capture   plane   insertion    miss km    total m/s')
for (const c of capture.tried) {
  console.log(
    `  ${(c.fraction * 100).toFixed(0).padStart(6)}% ${(c.mirror < 0 ? 'north' : 'south').padStart(7)} ${c.days.toFixed(2).padStart(10)} ` +
      `${c.first.toFixed(1).padStart(9)} ${c.second.toFixed(1).padStart(7)} ${c.third.toFixed(1).padStart(11)} ${(c.miss / 1e3).toFixed(2).padStart(10)} ` +
      `${c.total.toFixed(0).padStart(12)}${c.converged ? '' : '   (did not converge)'}`,
  )
}
if (capture.converged) {
  console.log(
    `\n  best: ${capture.total.toFixed(0)} m/s = ${capture.first.toFixed(0)} + ${capture.second.toFixed(0)} + ${capture.third.toFixed(0)}, ` +
      `${capture.mirror < 0 ? 'northern' : 'southern'} halo, transfer apolune ${(capture.apolune / 1e3).toFixed(0)} km, coast ${capture.days} d`,
  )
} else {
  console.log(`\n  no cell converged: ${capture.reason}`)
}

/* ---------------------------------------------------------------- *
 * D. Flying it, then holding what it arrives on
 * ---------------------------------------------------------------- */

/** Advance the live simulation to `t` in steps no longer than 30 s. */
function advanceTo(t) {
  let guard = 0
  while (live.sim.t < t - 1e-6 && guard++ < 2_000_000) {
    live.sim.advance(Math.min(30, t - live.sim.t), live.maxDt)
  }
  refreshDerived()
}
const relative = (out) => {
  for (let i = 0; i < 6; i++) out[i] = live.sim.state[O + i] - live.sim.state[M + i]
  return out
}

const here = new Float64Array(6)
const want = new Float64Array(6)
const flownBurns = []
let lost = null
if (capture.converged) {
  for (const burn of capture.burns) {
    advanceTo(burn.t)
    for (let i = 0; i < 3; i++) live.sim.state[O + 3 + i] += burn.dv[i]
    refreshDerived()
    relative(here)
    flownBurns.push({ label: burn.label, magnitude: burn.magnitude, range: norm([here[0], here[1], here[2]]) })
    if (live.lunarRange < MOON_R) lost = 'impacted the Moon'
  }
}
relative(here)
const onReference = capture.converged && referenceStateAt(capture.reference, live.sim.t, want)
const arrivalOff = onReference ? norm([here[0] - want[0], here[1] - want[1], here[2] - want[2]]) : Infinity
const arrivalOffV = onReference ? norm([here[3] - want[3], here[4] - want[4], here[5] - want[5]]) : Infinity

console.log('\n=== D. flown, as impulses ===')
for (const b of flownBurns) console.log(`  ${b.label.padEnd(10)} ${b.magnitude.toFixed(1).padStart(7)} m/s at ${(b.range / 1e3).toFixed(0).padStart(6)} km from the Moon`)
console.log(`  arrives ${(arrivalOff / 1e3).toFixed(3)} km and ${arrivalOffV.toFixed(3)} m/s from the reference`)

/** Hold it at each of the reference's own apolune patch points. */
const keeps = []
let held = 0
if (capture.converged && !lost) {
  const epochs = capture.reference.epochs
  for (let k = 1; k < epochs.length && keeps.length < HOLD; k++) {
    advanceTo(epochs[k])
    if (live.lunarRange < MOON_R) {
      lost = 'impacted the Moon'
      break
    }
    if (live.lunarRange > 200000e3) {
      lost = 'left the lunar vicinity'
      break
    }
    relative(here)
    referenceStateAt(capture.reference, live.sim.t, want)
    const off = norm([here[0] - want[0], here[1] - want[1], here[2] - want[2]])
    const solution = solveHaloKeeping(capture.reference, live.sim)
    if (solution.converged && solution.magnitude < 20) {
      for (let i = 0; i < 3; i++) live.sim.state[O + 3 + i] += solution.world[i]
      refreshDerived()
      held++
    }
    keeps.push({ off, magnitude: solution.converged ? solution.magnitude : NaN, converged: solution.converged })
  }
}
const keepTotal = keeps.reduce((s, k) => s + (Number.isFinite(k.magnitude) ? k.magnitude : 0), 0)
console.log('\n=== E. holding it ===')
for (const [i, k] of keeps.entries()) {
  console.log(`  revolution ${i + 1}: ${(k.off / 1e3).toFixed(2).padStart(8)} km off, corrected ${k.converged ? k.magnitude.toFixed(3) + ' m/s' : 'SOLVE FAILED'}`)
}
console.log(`  ${lost ?? `${keeps.length} revolutions held`}, ${keepTotal.toFixed(3)} m/s in all`)

/* ---------------------------------------------------------------- *
 * F. The same capture, flown by the flight computer
 * ---------------------------------------------------------------- */

/**
 * Everything above is impulses applied by this script. Here the sequencer flies
 * it: the first two burns are planned as nodes on the approach and flown by the
 * node phases, finite and centred on their instants, and the third is solved
 * again at arrival from the state those two actually produced.
 */
resetSimulation()
resetMission()
refreshDerived()
flyMission('LUNAR_APPROACH', { onPhase: () => {} })
// The page's own entry point. Under Node there is no Worker, so it solves in
// place and resolves at once, but through the same staleness checks and the same
// loading-state bookkeeping the page reads.
const armed = await armHaloCaptureInBackground(member, { revolutions: HOLD + 2 })
const loadingSettled = !mission.capture.solving && mission.capture.progress === 1 && mission.capture.error === ''
const budgetBefore = deltaV()
console.log('\n=== F. flown by the flight computer ===')
console.log(
  `  armed on the approach: ${armed.converged ? `${armed.total.toFixed(0)} m/s solved in ${(mission.capture.ms / 1000).toFixed(1)} s` : 'no solution — ' + armed.reason}`,
)

const route = []
const passes = []
let phase = currentPhase().id
let sequencerLost = null
let firstOff = Infinity
let captured = false
const nodeFlown = (id) => {
  const node = nodes.find((n) => n.id === id)
  return Boolean(node && node.executed)
}
const ORDER = ['capture', 'plane', 'correction', 'insertion']
for (let i = 0; i < 8_000_000 && mission.nrho.cycles < HOLD; i++) {
  flight.pilotWarp = mission.warpRequest !== null ? null : WARP.h6
  frame()
  const id = currentPhase().id
  if (id !== phase) {
    if (route.length < 14) route.push(id)
    if (id === 'NRHO_STATION_KEEP' && mission.nrho.reference) {
      relative(here)
      if (referenceStateAt(mission.nrho.reference, live.sim.t, want)) {
        const off = norm([here[0] - want[0], here[1] - want[1], here[2] - want[2]])
        passes.push({ off, magnitude: mission.nrho.deltaV, converged: mission.nrho.converged })
        if (passes.length === 1) firstOff = off
      }
    }
    phase = id
  }
  if (id === 'LOST') {
    sequencerLost = 'the vehicle was lost'
    break
  }
  // Only once it is captured: on the approach the craft is still 190,000 km out
  // and would trip an escape test that means nothing until it is in orbit.
  if (captured && live.lunarRange > 200000e3) {
    sequencerLost = 'left the lunar vicinity'
    break
  }
  if (!captured) captured = nodeFlown(mission.capture.nodes.capture)
}
const spent = budgetBefore - deltaV()
const planned = ORDER.map((key) => nodes.find((n) => n.id === mission.capture.nodes[key]))
console.log(`  route: ${route.join(' -> ')}`)
console.log(
  `  burns: ${ORDER.map((key, i) => `${key} ${planned[i] ? nodeMagnitude(planned[i]).toFixed(1) : '-'}`).join(', ')} m/s; ${planned.filter((n) => n && n.executed).length} of 4 flown`,
)
console.log(`  propellant spent through the capture and ${mission.nrho.cycles} revolutions: ${spent.toFixed(1)} m/s against ${armed.converged ? armed.total.toFixed(1) : '-'} solved`)
console.log(`  first maintenance pass ${(firstOff / 1e3).toFixed(1)} km off the reference`)
for (const [i, pass] of passes.entries()) {
  console.log(`    pass ${i + 1}: ${(pass.off / 1e3).toFixed(1).padStart(8)} km off, corrected ${pass.converged ? pass.magnitude.toFixed(3) + ' m/s' : 'SOLVE FAILED'}`)
}
console.log(`  ${sequencerLost ?? `${mission.nrho.cycles} maintenance cycles, ${mission.nrho.totalDeltaV.toFixed(3)} m/s`}`)

/* ---------------------------------------------------------------- *
 * What this establishes
 * ---------------------------------------------------------------- */

console.log('\n=== what this establishes ===')
const worst = keeps.length ? Math.max(...keeps.map((k) => k.off)) : Infinity
const checks = [
  ['Lambert reproduces a worked example to 1 cm/s', lambertError < 0.01],
  ['the mission reaches its lunar approach', arrived],
  ['a capture onto the halo is found', capture.converged],
  ['its three burns total under 600 m/s', capture.converged && capture.total < 600],
  ['which is less than the 819 m/s capture into lunar orbit it replaces', capture.converged && capture.total < 819],
  ['and fits in the propellant the vehicle arrives with', capture.converged && capture.total < budget],
  ['the second burn arrives where it aimed, within 5 km', capture.converged && capture.miss < 5e3],
  ['flown, the craft reaches the reference within 10 km', arrivalOff < 10e3],
  ['and within 1 m/s of its velocity', arrivalOffV < 1],
  [`it then holds the reference for ${HOLD} revolutions`, !lost && keeps.length >= HOLD && keeps.every((k) => k.converged)],
  ['never straying 100 km from it', worst < 100e3],
  ['the flight computer plans the same capture from the approach', armed.converged],
  ["through the page's background entry point, its loading state settling", loadingSettled],
  ['and flies them as planned nodes, with a correction of its own', planned.every((n) => n && n.executed)],
  [
    'for the cost it solved plus that correction, within 5%',
    armed.converged && Math.abs(spent - (armed.total + mission.capture.correction)) < 0.05 * armed.total,
  ],
  ['under 600 m/s in all', spent < 600],
  ['arriving on the reference and entering the maintenance cycle', !sequencerLost && mission.nrho.cycles >= HOLD],
  ['within 100 km of it at the first pass', firstOff < 100e3],
  ['and every pass solving', passes.length > 0 && passes.every((p) => p.converged)],
  // Not "converging to zero": the law settles a few km from the reference, 4.8 km
  // for Apollo 8 and 3.5-4.0 for Artemis, which arrives closer and so levels off
  // sooner. A ratio of first pass to last failed Artemis for arriving well.
  ['within 10 km of the reference by the last pass', passes.length >= 4 && passes[passes.length - 1].off < 10e3],
  ['and never further from it than at the first', passes.length > 0 && passes.every((p) => p.off <= passes[0].off)],
]
let pass = true
for (const [label, ok] of checks) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`)
  if (!ok) pass = false
}
console.log(`\n  ${pass ? 'PASS' : 'FAIL'}`)
process.exit(pass ? 0 : 1)
