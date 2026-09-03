/**
 * The ascent must not depend on where the time-warp dial was left.
 *
 * The frame that releases the pad hold opens the throttle inside the sequencer,
 * after that frame's step has already been committed — so a high warp standing
 * at liftoff integrated a full day of full-throttle SLS in one go and the
 * vehicle left on a heliocentric trajectory. Two things now prevent it: the
 * sequencer asks for the powered ceiling before the hold is released, and the
 * driver clamps the step regardless of what the dial says.
 *
 * The second is the one that matters, because the first is a one-shot request
 * the pilot can override — so this also flies a pilot who winds the dial up
 * *during* the count, which the request cannot catch.
 *
 *   node scripts/verify-warp.mjs
 */

import { flight, frame, WARP_RATES } from './flight.mjs'
import { live, refreshDerived, resetSimulation } from '../src/sim/live.js'
import {
  beginCountdown,
  commitTLI,
  currentPhase,
  mission,
  resetMission,
} from '../src/sim/mission.js'
import { deltaV, ship, totalMass } from '../src/sim/ship.js'

/**
 * Fly from the pad to `until`, starting at warp index `startWarp`.
 * @param {number|null} meddleWarp warp the pilot forces during the countdown
 */
function fly(startWarp, until = 'COAST', meddleWarp = null) {
  // A full reset, not just the sequencer's. `resetMission` rewinds the phase
  // table but leaves the integrator and the propellant load exactly where the
  // last run finished them — so a second run in the same process starts in
  // orbit with dry tanks and every case after the first fails identically.
  resetSimulation()
  resetMission()
  refreshDerived()
  flight.warp = startWarp
  flight.frames = 0
  flight.wall = 0
  flight.lastWarpRequest = null
  flight.warpBeforeBurn = null
  flight.pilotWarp = null
  beginCountdown()

  let committed = false
  let meddled = false
  let maxSpeed = 0

  for (let i = 0; i < 400_000; i++) {
    const id = currentPhase().id
    // A pilot reaching for the dial two seconds before release, after the
    // sequencer's one-shot request has already been applied and recorded.
    if (meddleWarp !== null && !meddled && id === 'PRE_LAUNCH' && mission.countdown < 2) {
      flight.warp = meddleWarp
      meddled = true
    }
    if (!committed && id === 'COAST') committed = commitTLI()
    flight.pilotWarp = mission.warpRequest !== null ? null : id === 'LUNAR_APPROACH' ? 3 : 1

    frame()
    maxSpeed = Math.max(maxSpeed, live.elements.speed)
    if (currentPhase().id === until) break
  }

  const e = live.elements
  return {
    phase: currentPhase().id,
    met: mission.t,
    perigee: e.perigee,
    apogee: e.apogee,
    ecc: e.eccentricity,
    speed: e.speed,
    maxSpeed,
    mass: totalMass(),
    dv: deltaV(),
    bound: e.bound,
  }
}

const fmt = (r) =>
  `${r.phase.padEnd(6)} MET ${(r.met / 60).toFixed(2).padStart(7)} min  ` +
  `${(r.perigee / 1e3).toFixed(1).padStart(9)} x ${(r.bound ? (r.apogee / 1e3).toFixed(1) : 'ESCAPE').padStart(9)} km  ` +
  `e ${r.ecc.toFixed(5)}  peak v ${(r.maxSpeed / 1e3).toFixed(4)} km/s  ` +
  `m ${(r.mass / 1e3).toFixed(3)} t  dv ${r.dv.toFixed(1)}`

console.log('=== ascent to a stable orbit, by the warp the dial was left on ===')
console.log('  start                                                                        result')
const results = []
for (const w of [0, 1, 2, 3, 4, 5, 6, 7]) {
  const r = fly(w, 'COAST')
  results.push([`${WARP_RATES[w]}x`, r])
  console.log(`  ${String(WARP_RATES[w] + 'x').padStart(9)}  ${fmt(r)}`)
}

console.log('\n=== and with the pilot winding the dial up during the count ===')
for (const w of [4, 7]) {
  const r = fly(0, 'COAST', w)
  results.push([`meddle ${WARP_RATES[w]}x`, r])
  console.log(`  ${String('->' + WARP_RATES[w] + 'x').padStart(9)}  ${fmt(r)}`)
}

/**
 * One claim, and it is not an equality.
 *
 * Wherever the dial is left, the vehicle must reach a stable parking orbit
 * rather than leaving on a solar trajectory. That is what the step clamp
 * guarantees, and it is the whole requirement.
 *
 * The trajectories are *not* expected to match. Real simulated time passes at
 * whatever warp is standing before the request lands — a single frame at
 * 1 month/s is twelve hours of planetary motion, and two seconds at 1 day/s is
 * two days of it — so the vehicle genuinely launches into a different sky and
 * flies a different, legitimate ascent. Demanding equality here would be
 * demanding that time compression have no effect, which is the opposite of what
 * it is for.
 */
const starts = results.slice(0, 8)
const meddled = results.slice(8)

const ref = starts[0][1]
const stable = (r) => r.bound && r.perigee > 100e3 && r.phase === 'COAST'
const allStable = results.every(([, r]) => stable(r))

console.log(`\n  every run reached a stable parking orbit: ${allStable}`)
const worstPerigee = Math.min(...results.map(([, r]) => r.perigee))
const worstApogee = Math.min(...results.map(([, r]) => r.apogee))
console.log(`  lowest perigee across all runs: ${(worstPerigee / 1e3).toFixed(1)} km (must clear the atmosphere)`)
console.log(`  lowest apogee across all runs:  ${(worstApogee / 1e3).toFixed(1)} km`)
console.log(`  none escaped: ${results.every(([, r]) => r.bound)}`)

// Before the fix this case reached 7,937 km at 13.2 km/s on the liftoff frame
// alone and left the system; a peak speed anywhere near that is the regression.
const worstPeak = Math.max(...results.map(([, r]) => r.maxSpeed))
console.log(`  highest speed reached anywhere: ${(worstPeak / 1e3).toFixed(4)} km/s (orbital is ~8.8)`)

const pass = allStable && worstPeak < 12e3
console.log(`\n  ${pass ? 'PASS' : 'FAIL'}`)
process.exit(pass ? 0 : 1)
