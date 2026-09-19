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
 * And a second claim, which is an equality: the same flight with its burns
 * stepped at 60x and at 1x reaches the same parking orbit. That one is about the
 * length of a frame rather than where the dial was left, and it is flown per
 * vessel in child processes, since a process flies only the vessel it loaded.
 *
 *   node scripts/verify-warp.mjs
 */

import { flight, frame, WARP, WARP_RATES } from './flight.mjs'
import { live, refreshDerived, resetSimulation } from '../src/sim/live.js'
import {
  beginCountdown,
  commitTLI,
  currentPhase,
  mission,
  resetMission,
} from '../src/sim/mission.js'
import { deltaV, ship, totalMass } from '../src/sim/ship.js'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { SHIP } from '../src/sim/constants.js'
import { ACTIVE_VESSEL } from '../src/sim/vessels.js'

/**
 * Child mode: fly the active vessel from the pad to its parking orbit with every
 * burn on the way held at one warp, and print the orbit it reaches.
 *
 * Circularisation is held too, though it asks for 1x: a pilot can turn the dial
 * back up mid-burn to the powered ceiling, and 60x through that burn is the
 * harshest step the parking orbit can be reached at.
 *
 * `--sphere` lifts Earth's oblateness for this flight. The same ascent is then
 * measured in both worlds, which is what keeps the parking-orbit claim below a
 * claim about the *loop* rather than a widened tolerance: the loop drives the
 * craft's osculating apogee to 185 km, and while an osculating apogee has no
 * field in it, the rate at which it moves does.
 */
const PARK = process.argv.indexOf('--park')
if (PARK >= 0) {
  const force = WARP[process.argv[PARK + 1]]
  const sphere = process.argv.includes('--sphere')
  const held = new Set(['PRE_LAUNCH', 'LIFTOFF', 'PITCH_KICK', 'GRAVITY_TURN', 'STAGING', 'MECO', 'CIRCULARISE'])
  resetSimulation()
  // After the reset, which is what installs the field.
  if (sphere) live.sim.zonal = null
  resetMission()
  refreshDerived()
  flight.warp = force
  flight.lastWarpRequest = null
  flight.warpBeforeBurn = null
  flight.pilotWarp = null
  beginCountdown()
  for (let i = 0; i < 2_000_000 && currentPhase().id !== 'COAST'; i++) {
    const id = currentPhase().id
    flight.pilotWarp = mission.warpRequest !== null ? null : WARP.m1
    if (held.has(id)) {
      flight.lastWarpRequest = mission.warpRequest
      flight.warp = force
    }
    frame()
  }
  const e = live.elements
  console.log(JSON.stringify({ vessel: ACTIVE_VESSEL, phase: currentPhase().id, perigee: e.perigee, apogee: e.apogee, target: SHIP.parkingOrbit.altitude }))
  process.exit(0)
}

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
    flight.pilotWarp = mission.warpRequest !== null ? null : id === 'LUNAR_APPROACH' ? WARP.h6 : WARP.m1

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

/* ---------------------------------------------------------------- *
 * The parking orbit does not depend on the step
 * ---------------------------------------------------------------- */

/**
 * The equality the claim above refuses, and a different claim.
 *
 * Here both flights start from the same sky and differ only in how long a frame
 * is while the engines burn. The two burns that reach orbit each end on a test
 * made once a frame of something racing at the end — apoapsis rising to the
 * parking altitude, eccentricity falling to circular — and at 60x a frame is a
 * second of flight. Before the step was limited, Artemis parked at 188.7 x 200.4
 * km at 60x and 174.0 x 185.1 km at 1x: its Core stage, at the 4 g limit, had
 * apoapsis rising 20 km/s over its last frame, and circularising on the same
 * stage at 51.8 m/s^2 raises perigee 174 km/s. With `updateStepCeiling` holding
 * both burns to their cutoffs, the two warps must agree to within the limit's two
 * 50 m tolerances; 200 m is allowed.
 *
 * The ascent is then flown a third and fourth time with Earth's oblateness
 * lifted, because the *other* half of this claim — that the loop parks on its
 * 185 km target — is a claim about the guidance, and the guidance is now
 * steering through an oblate field. On a sphere both vehicles park within 16 m
 * of the target, exactly as they did before the field existed; with the field
 * they land 100 m and 900 m low. That growth is the loop's own cutoff residual:
 * it drives the craft's osculating apogee to 185 km, and while that number has
 * no field in it, the rate at which it moves does — over the last second of a
 * burn the apogee it is chasing swings by metres rather than centimetres. So
 * the target is checked twice, at 200 m on a sphere and at 1.5 km on the real
 * Earth, and the step-agreement claim above is where the sharp tolerance now
 * lives.
 */
const self = fileURLToPath(import.meta.url)
const parked = {}
for (const vessel of ['apollo8', 'artemis']) {
  for (const warp of ['m1', 'x1']) {
    const out = execFileSync(process.execPath, [self, '--park', warp], {
      env: { ...process.env, PERIAPSIS_VESSEL: vessel },
      encoding: 'utf8',
    })
    parked[`${vessel} ${warp}`] = JSON.parse(out.trim().split('\n').at(-1))
  }
}
console.log('\n=== the parking orbit, with the burns stepped at 60x and at 1x ===')
let parkOk = true
let onTarget = true
for (const vessel of ['apollo8', 'artemis']) {
  const coarse = parked[`${vessel} m1`]
  const fine = parked[`${vessel} x1`]
  const dPeri = Math.abs(coarse.perigee - fine.perigee)
  const dApo = Math.abs(coarse.apogee - fine.apogee)
  const reached = [coarse, fine].every((r) => Math.abs(r.apogee - r.target) < 2000)
  const ok = coarse.phase === 'COAST' && fine.phase === 'COAST' && dPeri < 200 && dApo < 200 && reached
  parkOk = parkOk && ok
  for (const r of [coarse, fine]) if (Math.abs(r.apogee - r.target) > 1500) onTarget = false
  console.log(
    `  ${vessel.padEnd(8)} 60x ${(coarse.perigee / 1e3).toFixed(2)} x ${(coarse.apogee / 1e3).toFixed(2)} km` +
      `   1x ${(fine.perigee / 1e3).toFixed(2)} x ${(fine.apogee / 1e3).toFixed(2)} km` +
      `   apart by ${(dPeri / 1e3).toFixed(3)} and ${(dApo / 1e3).toFixed(3)} km   ${ok ? 'same orbit' : 'DIFFERENT ORBIT'}`,
  )
}
console.log(`  the parking orbit is the same at either step, apoapsis on target: ${parkOk}`)

/* The same four ascents on a point-mass Earth, for the target half. */
const spherical = {}
for (const vessel of ['apollo8', 'artemis']) {
  const out = execFileSync(process.execPath, [self, '--park', 'x1', '--sphere'], {
    env: { ...process.env, PERIAPSIS_VESSEL: vessel },
    encoding: 'utf8',
  })
  spherical[vessel] = JSON.parse(out.trim().split('\n').at(-1))
}
let sphereOnTarget = true
let worstSphere = 0
for (const vessel of ['apollo8', 'artemis']) {
  const r = spherical[vessel]
  const err = Math.abs(r.apogee - r.target)
  worstSphere = Math.max(worstSphere, err)
  if (err > 200) sphereOnTarget = false
  console.log(`  ${vessel.padEnd(8)} on a point mass parks at ${(r.perigee / 1e3).toFixed(2)} x ${(r.apogee / 1e3).toFixed(2)} km — ${err.toFixed(0)} m from the target`)
}

const pass = allStable && worstPeak < 12e3 && parkOk && onTarget && sphereOnTarget
console.log(`\n  ${pass ? 'PASS' : 'FAIL'}`)
process.exit(pass ? 0 : 1)
