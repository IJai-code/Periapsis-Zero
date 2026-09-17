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
 * **Burns are impulses here.** The capture burn is about 190 m/s, some 53 s on
 * the service module, so the flown cost will differ from the solved one by the
 * few m/s of a finite burn — the sequencer straddles its burns for exactly that
 * reason, and nothing in this gate does. What is checked is the solution and the
 * trajectory it produces, not the delivery.
 *
 *   node --expose-gc scripts/verify-nrho-capture.mjs [revolutions to hold]
 */

import { flyMission } from './flight.mjs'
import { live, refreshDerived, resetSimulation } from '../src/sim/live.js'
import { currentPhase, resetMission } from '../src/sim/mission.js'
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
]
let pass = true
for (const [label, ok] of checks) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`)
  if (!ok) pass = false
}
console.log(`\n  ${pass ? 'PASS' : 'FAIL'}`)
process.exit(pass ? 0 : 1)
