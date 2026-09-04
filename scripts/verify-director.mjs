/**
 * The camera director: a shot for every phase, and a cut only when one changes.
 *
 * The failure this guards against is not a wrong camera angle — it is the
 * director behaving like a lock. `focus` is store state, and writing it restarts
 * the rig's fly-to; asking for it every frame would restart that flight every
 * frame and pin the camera immovably, with no error and no crash. So what is
 * asserted is the *rate*: cuts must equal the number of phase transitions that
 * actually change the shot, not the number of frames, and never more.
 *
 * The mission is flown for real rather than the phase table being walked, so
 * consecutive phases that share a shot are exercised too — those must produce no
 * cut at all.
 *
 *   node --expose-gc scripts/verify-director.mjs
 */

import { flight, frame, WARP_RATES } from './flight.mjs'
import { live, refreshDerived, resetSimulation } from '../src/sim/live.js'
import {
  PHASE_IDS,
  beginCountdown,
  commitTLI,
  currentPhase,
  mission,
  resetMission,
} from '../src/sim/mission.js'
import { director, releaseDirector, resumeDirector, updateDirector } from '../src/sim/director.js'
import { uiStore } from '../src/sim/store.js'

/* The module throws at import if a phase has no shot, so reaching here is
   already the first assertion. Restate it for the reader. */
console.log(`=== ${PHASE_IDS.length} phases, all with a shot (the module asserts this at load) ===`)

resetSimulation()
resetMission()
refreshDerived()
flight.warp = 4
flight.lastWarpRequest = null
flight.warpBeforeBurn = null
flight.pilotWarp = null
beginCountdown()

/** Mirror the driver's apply rule exactly. */
let lastShotRequest = null
let applied = 0
function applyDirector() {
  updateDirector()
  if (director.request !== null && director.request !== lastShotRequest) {
    lastShotRequest = director.request
    if (uiStore.get().focus !== director.request) {
      uiStore.set({ focus: director.request })
      applied++
    }
  } else if (director.request === null) {
    lastShotRequest = null
  }
}

const log = []
let lastPhase = currentPhase().id
let lastShot = ''
let committed = false
let frames = 0

const gc = globalThis.gc

for (let i = 0; i < 2_000_000; i++) {
  const id = currentPhase().id
  if (!committed && id === 'COAST') committed = commitTLI()
  flight.pilotWarp = mission.warpRequest !== null ? null : id === 'LUNAR_APPROACH' ? 3 : 1

  frame()
  applyDirector()
  frames++

  const now = currentPhase().id
  if (now !== lastPhase) {
    // A cut is a change of *camera mode*, not of label. Comparing labels — which
    // are unique per phase by design — counts every transition as a cut and
    // hides the thing worth checking: that consecutive phases sharing a shot
    // produce no store write at all.
    log.push({
      phase: now,
      shot: director.request,
      label: director.shot,
      cut: director.request !== lastShot,
      focus: uiStore.get().focus,
    })
    lastShot = director.request
    lastPhase = now
  }
  if (now === 'SPLASHDOWN') break
}

/**
 * Snapshot the write count here, before the override and resume tests.
 *
 * `resumeDirector()` deliberately writes once to take the camera back from the
 * pilot, so counting after it conflates the mission's cuts with the test's own
 * interventions — which is what made this check fail while every part of it was
 * behaving correctly.
 */
const appliedDuringMission = applied

/**
 * Allocation, measured on the director alone.
 *
 * Not across the mission: that span contains the one-shot solvers, which are
 * architecturally exempt and allocate freely, so a heap delta over it says
 * nothing about the per-frame path. And not without a warm-up, because the
 * figure would then be dominated by V8 compiling code that is hot for the first
 * time — a flat cost that divides out to a per-frame "leak" halving every time
 * the run doubles. Both traps were hit before; this measures a settled steady
 * state in a single phase.
 */
for (let i = 0; i < 20000; i++) {
  frame()
  applyDirector()
}
if (gc) {
  gc()
  gc()
}
const heapBefore = process.memoryUsage().heapUsed
const ALLOC_FRAMES = 120000
for (let i = 0; i < ALLOC_FRAMES; i++) {
  frame()
  applyDirector()
}
if (gc) {
  gc()
  gc()
}
const heapAfter = process.memoryUsage().heapUsed

console.log('\n=== the mission, as filmed ===')
console.log('  phase                    camera    shot')
for (const e of log) {
  console.log(
    `  ${e.phase.padEnd(22)}${e.shot.padStart(8)}${(e.cut ? '  cut ' : '  held').padStart(7)}   ${e.label}`,
  )
}

const cuts = log.filter((e) => e.cut).length
const holds = log.length - cuts
console.log(`\n  phase transitions ${log.length}`)
console.log(`  cuts              ${cuts}`)
console.log(`  held through      ${holds}  (consecutive phases sharing a shot)`)
console.log(`  store writes      ${appliedDuringMission}`)
console.log(`  frames            ${frames}`)

/* ---- the pilot takes the camera, and keeps it ---- */
const focusBefore = uiStore.get().focus
uiStore.set({ focus: 'sun' })
for (let i = 0; i < 600; i++) {
  frame()
  applyDirector()
}
const heldByPilot = uiStore.get().focus === 'sun'

/* ---- release and resume ---- */
releaseDirector()
applyDirector()
const releasedRequest = director.request
resumeDirector()
applyDirector()
const resumedRequest = director.request

const delta = heapAfter - heapBefore

console.log('\n=== what this establishes ===')
const checks = [
  ['every phase has a shot (module load did not throw)', true],
  ['the mission reached splashdown', currentPhase().id === 'SPLASHDOWN'],
  ['every phase transition produced a decision', log.length > 20],
  ['some phases held the previous shot rather than cutting', holds > 0],
  /**
   * One write per cut, plus one for the opening shot.
   *
   * PRE_LAUNCH is the phase the mission starts in, so it is never a
   * *transition* and never appears in the log — but it does set the camera once.
   * The invariant is that nothing else writes: any per-frame reassertion would
   * show up here immediately as a count in the hundreds of thousands.
   */
  ['one store write per cut, plus the opening shot', appliedDuringMission === cuts + 1],
  ['cuts are far fewer than frames', cuts < frames / 1000],
  ['a pilot who takes the camera keeps it', heldByPilot],
  ['release hands the camera back', releasedRequest === null],
  ['resume takes it again', resumedRequest !== null],
  ['director allocates nothing per frame', !gc || Math.abs(delta) < 64 * 1024],
]
let pass = true
for (const [label, ok] of checks) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`)
  if (!ok) pass = false
}
console.log(`\n  heap delta ${(delta / 1024).toFixed(2)} KB over ${ALLOC_FRAMES} settled frames` +
  `  (${(delta / ALLOC_FRAMES).toFixed(4)} bytes/frame)`)
console.log(`  ${pass ? 'PASS' : 'FAIL'}`)
process.exit(pass ? 0 : 1)
