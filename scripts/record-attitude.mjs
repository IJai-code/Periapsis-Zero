/**
 * Record the craft's attitude and position through the phases where the camera
 * is asked to work hardest, so the filters can be compared on real motion.
 *
 * Synthetic profiles would be easier and would prove less. What makes the
 * capture flip and the entry reversals interesting is not that the attitude
 * changes but *how* — the flip is a rate-limited slew at 0.15 rad/s against a
 * target that is itself drifting, and the reversals are a controller responding
 * to cross-range it can only correct by rolling. Neither is a step or a ramp.
 *
 * Writes one JSON file so the replay can iterate without re-flying six minutes
 * of mission.
 *
 *   node scripts/record-attitude.mjs <out.json>
 */

import { writeFileSync } from 'node:fs'
import { flight, frame } from './flight.mjs'
import { WARP } from '../src/sim/warp.js'
import { live, refreshDerived, resetSimulation } from '../src/sim/live.js'
import { beginCountdown, commitTLI, currentPhase, mission, resetMission } from '../src/sim/mission.js'
import { ship } from '../src/sim/ship.js'

const out = process.argv[2]
if (!out) {
  console.error('usage: node scripts/record-attitude.mjs <out.json>')
  process.exit(2)
}

/** The phases worth filming badly. */
const WATCH = new Set(['LOI_ALIGN', 'LOI_BURN', 'RE_ENTRY', 'DROGUE', 'MAIN_CHUTES'])

resetSimulation()
resetMission()
refreshDerived()
flight.warp = WARP.d1
flight.lastWarpRequest = null
flight.warpBeforeBurn = null
flight.pilotWarp = null
beginCountdown()

const segments = {}
let committed = false
let frames = 0

for (let i = 0; i < 2_000_000; i++) {
  const id = currentPhase().id
  if (!committed && id === 'COAST') committed = commitTLI()
  flight.pilotWarp = mission.warpRequest !== null ? null : id === 'LUNAR_APPROACH' ? WARP.h6 : WARP.m1

  frame()
  frames++

  const now = currentPhase().id
  if (WATCH.has(now)) {
    const seg = (segments[now] ??= { dt: [], q: [], p: [] })
    seg.dt.push(live.simDtLastFrame)
    seg.q.push(ship.quaternion.x, ship.quaternion.y, ship.quaternion.z, ship.quaternion.w)
    // Absolute scene position: origin-independent, which is what a replay wants.
    seg.p.push(live.abs.ship.x, live.abs.ship.y, live.abs.ship.z)
  }
  if (now === 'SPLASHDOWN') break
}

let total = 0
console.log('recorded:')
for (const [name, seg] of Object.entries(segments)) {
  const n = seg.dt.length
  const span = seg.dt.reduce((a, b) => a + b, 0)
  total += n
  console.log(`  ${name.padEnd(14)} ${String(n).padStart(7)} frames, ${span.toFixed(1)} s of flight`)
}
console.log(`  ${String(total).padStart(22)} samples over ${frames} mission frames`)

writeFileSync(out, JSON.stringify(segments))
console.log(`  written to ${out}`)
