/**
 * The sequencer's first *cycle*: coast and maintenance, indefinitely.
 *
 * Every other phase in this mission is a step — it runs once and hands on. A
 * halo orbit is unstable, so holding one is not a step but a loop that never
 * completes, and the state machine had to be shown to survive that rather than
 * assumed to.
 *
 * Two things are checked and they are different questions. That the routing
 * *works*: the pair alternates the expected number of times, phase timers reset
 * each pass, and the cycle counter tracks transitions rather than frames. And
 * that it does not *leak*: a loop running for the life of a mission is exactly
 * where a per-iteration allocation would accumulate unnoticed, in a way a
 * one-shot phase never could. Run under --expose-gc the heap must be flat.
 *
 *   node --expose-gc scripts/verify-nrho-cycle.mjs [cycles]
 */

import { flight, frame } from './flight.mjs'
import { WARP } from '../src/sim/warp.js'
import { live, refreshDerived, resetSimulation } from '../src/sim/live.js'
import {
  currentPhase,
  enterNrhoCycle,
  mission,
  PROFILE,
  resetMission,
} from '../src/sim/mission.js'
import { synodic } from '../src/sim/cr3bp.js'

const wanted = Number(process.argv[2] ?? 40)

// Short intervals: this is a test of the control structure, not of the orbit,
// and 40 cycles at the real six-day cadence would be eight simulated months.
PROFILE.nrhoKeepInterval = 900
PROFILE.nrhoKeepDuration = 60

resetSimulation()
resetMission()
refreshDerived()
flight.warp = WARP.h1
flight.pilotWarp = null
enterNrhoCycle()

console.log(`cycling ${wanted} times at ${PROFILE.nrhoKeepInterval}s coast / ${PROFILE.nrhoKeepDuration}s keep`)
console.log(`  frame: separation ${(synodic.separation / 1e3).toFixed(0)} km, omega ${synodic.omega.toExponential(4)} rad/s\n`)

const seen = []
let last = currentPhase().id
let transitions = 0
let phaseTAtSwitch = []

/**
 * Warm up before measuring, exactly as verify-allocation.mjs does.
 *
 * Without it the reading is dominated by V8 compiling code paths that are hot
 * for the first time — measured here at a flat ~480 KB whether the run covers
 * 72,000 frames or 288,000, which divides out to a per-frame "leak" that
 * conveniently halves every time the run doubles. That is the signature of a
 * constant, and reporting it as bytes-per-frame is how a warm-up cost gets
 * mistaken for a leak. What a cycle must not do is retain something *per
 * iteration*, and only a warmed steady state can show that.
 */
const gc = globalThis.gc
const WARMUP = 8
while (mission.nrho.cycles < WARMUP) {
  flight.pilotWarp = mission.warpRequest === null ? WARP.h1 : null
  frame()
}
const cyclesAtStart = mission.nrho.cycles
if (gc) {
  gc()
  gc()
}
const heapBefore = process.memoryUsage().heapUsed

let frames = 0
for (let i = 0; i < 20_000_000 && mission.nrho.cycles < wanted + WARMUP; i++) {
  flight.pilotWarp = mission.warpRequest === null ? WARP.h1 : null
  frame()
  frames++
  const id = currentPhase().id
  if (id !== last) {
    transitions++
    if (seen.length < 8) seen.push(`${last} -> ${id}`)
    phaseTAtSwitch.push(mission.phaseT)
    last = id
  }
  if (id !== 'NRHO_COAST' && id !== 'NRHO_STATION_KEEP') {
    console.error(`escaped the cycle into ${id} after ${transitions} transitions`)
    process.exit(1)
  }
}

if (gc) {
  gc()
  gc()
}
const heapAfter = process.memoryUsage().heapUsed

console.log('  first transitions:')
for (const t of seen) console.log(`    ${t}`)

const nr = mission.nrho
console.log(`\n  cycles measured         ${nr.cycles - cyclesAtStart}  (after ${WARMUP} warm-up)`)
console.log(`  transitions             ${transitions}   (expect 2 per cycle)`)
console.log(`  frames                  ${frames}`)
console.log(`  simulated               ${(mission.t / 86400).toFixed(2)} days`)
console.log(`  phaseT reset each pass  ${phaseTAtSwitch.every((t) => t < 1) ? 'yes' : 'NO — ' + Math.max(...phaseTAtSwitch).toFixed(1)}`)

console.log('\n  halo diagnostics, synodic frame:')
console.log(`    distance from Moon    ${(nr.synodicR / 1e3).toFixed(0)} km`)
console.log(`    out-of-plane z        ${(nr.synodicZ / 1e3).toFixed(0)} km`)
console.log(`    perilune / apolune    ${(nr.lastPerilune / 1e3).toFixed(0)} / ${(nr.lastApolune / 1e3).toFixed(0)} km  (last completed pass)`)

const delta = heapAfter - heapBefore
console.log('\n  heap before             ' + (heapBefore / 1024).toFixed(1) + ' KB')
console.log('  heap after              ' + (heapAfter / 1024).toFixed(1) + ' KB')
console.log(
  `  retained delta          ${(delta / 1024).toFixed(2)} KB` +
    `  (${(delta / frames).toFixed(4)} bytes/frame, ${(delta / Math.max(1, nr.cycles - cyclesAtStart)).toFixed(0)} bytes/cycle)`,
)
if (!gc) console.log('  (run with --expose-gc for a meaningful heap figure)')

const checks = [
  ['cycled the requested number of times', nr.cycles - cyclesAtStart === wanted],
  ['exactly two transitions per cycle', transitions === wanted * 2],
  ['never escaped the pair', true], // enforced by the exit above
  ['phase timer reset on every transition', phaseTAtSwitch.every((t) => t < 1)],
  // Per *cycle*, which is the quantity a loop can leak. 64 KB is the same
  // ceiling verify-allocation.mjs uses for a whole run.
  ['nothing retained per cycle', !gc || Math.abs(delta) < 64 * 1024],
]
console.log('')
let pass = true
for (const [label, ok] of checks) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`)
  if (!ok) pass = false
}
console.log(`\n  ${pass ? 'PASS' : 'FAIL'}`)
process.exit(pass ? 0 : 1)
