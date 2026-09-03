/**
 * Staging in the middle of the capture burn.
 *
 * The nominal insertion happens to fit inside the ICPS with about 18 m/s to
 * spare, so the separation never fires and the interrupt's behaviour is never
 * exercised. A slightly costlier approach or a slightly hungrier mid-course
 * correction would exercise it, so it is forced here by shorting the stage.
 *
 * Two things are checked while the interrupt is running: that the vehicle stays
 * pointed retrograde rather than reverting to the ascent pitch programme, and
 * that the preempted phase's cutoff test keeps being evaluated rather than being
 * suspended for the 2.5 s the interrupt holds.
 *
 *   node scripts/verify-staging.mjs <approach-snapshot.json> [propellant-kg]
 */

import { flight, frame, loadSnapshot } from './flight.mjs'
import { live } from '../src/sim/live.js'
import { currentPhase, mission } from '../src/sim/mission.js'
import { ship, totalMass } from '../src/sim/ship.js'
import { BODIES } from '../src/sim/constants.js'

const R = BODIES.moon.radius
const snap = process.argv[2]
const SHORT = Number(process.argv[3] ?? 3000) // kg left in the ICPS

loadSnapshot(snap)
ship.stageProp[2] = SHORT
ship.mass = totalMass()

console.log(`ICPS shorted to ${SHORT} kg — the capture must cross a separation\n`)

let worstPointing = 0
let worstDuringStaging = 0
let stagingFrames = 0
let separations0 = ship.separations
let sawStaging = false
let last = currentPhase().id
let cutoffE = null

for (let i = 0; i < 6_000_000; i++) {
  flight.pilotWarp = mission.warpRequest === null ? 3 : null
  frame()
  const id = currentPhase().id

  if (id !== last) {
    console.log(
      `  ${(last + ' -> ' + id).padEnd(28)} MET ${(mission.t / 3600).toFixed(4)} h  ` +
        `stage ${ship.stage}  mass ${(totalMass() / 1e3).toFixed(3)} t  ` +
        `e ${live.lunar.eccentricity.toFixed(5)}  point ${(mission.loi.pointingError * 1e3).toFixed(2)} mrad`,
    )
    last = id
  }

  if (mission.loi.ignited && (id === 'LOI_BURN' || id === 'STAGING')) {
    worstPointing = Math.max(worstPointing, mission.loi.pointingError)
    if (id === 'STAGING') {
      sawStaging = true
      stagingFrames++
      worstDuringStaging = Math.max(worstDuringStaging, mission.loi.pointingError)
    }
  }

  if (id === 'LUNAR_ORBIT') {
    cutoffE = live.lunar.eccentricity
    break
  }
}

const l = live.lunar
console.log(`\n  separation during the burn   ${ship.separations > separations0} (STAGING seen: ${sawStaging}, ${stagingFrames} frames)`)
console.log(`  worst pointing error, burn   ${(worstPointing * 1e3).toFixed(3)} mrad`)
console.log(`  worst pointing, while staging ${(worstDuringStaging * 1e3).toFixed(3)} mrad`)
console.log(`  cutoff criterion             ${mission.loi.cutoff}`)
console.log(`  delivered dv                 ${mission.loi.deltaVDelivered.toFixed(2)} m/s over ${mission.loi.burnDuration.toFixed(1)} s`)
console.log(
  `  achieved orbit               ${((l.periapsisRadius - R) / 1e3).toFixed(2)} x ` +
    `${((l.apoapsisRadius - R) / 1e3).toFixed(2)} km   e ${cutoffE.toFixed(5)}   ` +
    `period ${(l.period / 60).toFixed(2)} min`,
)
console.log(`  minimum altitude reached     ${((mission.loi.minRadius - R) / 1e3).toFixed(2)} km`)
