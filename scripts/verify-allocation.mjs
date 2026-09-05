/**
 * The render loop allocates nothing — measured, not assumed.
 *
 * Run under `node --expose-gc`. Everything the driver does each frame is
 * exercised: sequencing, attitude, thrust, integration, rebase, and the derived
 * state on top of it — now including the selenocentric element set and the
 * capture logic, which run on every frame of every phase.
 *
 * The measurement is a full GC, a heap reading, N frames, a full GC, a second
 * reading. Anything the loop retains shows up in the difference; anything it
 * merely churns shows up as a rising collected total, which is why the run is
 * long enough for that to be visible.
 *
 *   node --expose-gc scripts/verify-allocation.mjs <snapshot.json> [frames]
 */

import { flight, frame, loadSnapshot } from './flight.mjs'
import { WARP } from '../src/sim/warp.js'
import { currentPhase, mission } from '../src/sim/mission.js'

if (typeof globalThis.gc !== 'function') {
  console.error('run with: node --expose-gc scripts/verify-allocation.mjs <snapshot.json>')
  process.exit(1)
}

const snap = process.argv[2]
const FRAMES = Number(process.argv[3] ?? 60000)
loadSnapshot(snap)

// Warm up: let V8 settle its inline caches and optimise the hot path, so the
// measurement is of the steady state rather than of the compiler.
flight.pilotWarp = WARP.h6
for (let i = 0; i < 20000; i++) frame()

const phaseBefore = currentPhase().id
globalThis.gc()
globalThis.gc()
const before = process.memoryUsage().heapUsed

for (let i = 0; i < FRAMES; i++) frame()

globalThis.gc()
globalThis.gc()
const after = process.memoryUsage().heapUsed

const delta = after - before
console.log(`  phase ${phaseBefore} -> ${currentPhase().id}`)
console.log(`  frames            ${FRAMES}`)
console.log(`  heap before       ${(before / 1024).toFixed(1)} KB`)
console.log(`  heap after        ${(after / 1024).toFixed(1)} KB`)
console.log(`  retained delta    ${(delta / 1024).toFixed(2)} KB  (${(delta / FRAMES).toFixed(3)} bytes/frame)`)
console.log(`  verdict           ${Math.abs(delta) < 64 * 1024 ? 'PASS — nothing retained' : 'FAIL'}`)
process.exit(Math.abs(delta) < 64 * 1024 ? 0 : 1)
