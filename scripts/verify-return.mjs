/**
 * The return leg, measured: departure, corridor trim, entry and splashdown.
 *
 * Flies from a lunar-orbit snapshot to the water and reports what each phase
 * actually achieved, against the figures the design was derived from. Nothing
 * here is read back from the value a phase targeted — the entry corridor is
 * recomputed from the flown state, the peaks are sampled through the entry, and
 * the descent rate is taken relative to the rotating surface rather than in the
 * inertial frame, where Earth's own 400 m/s would swamp it.
 *
 *   node scripts/verify-return.mjs <lunar-orbit-snapshot.json>
 */

import { flight, frame, loadSnapshot } from './flight.mjs'
import { WARP } from '../src/sim/warp.js'
import { live } from '../src/sim/live.js'
import { currentPhase, mission, PROFILE } from '../src/sim/mission.js'
import { INDEX } from '../src/sim/system.js'
import { BODIES, SHIP } from '../src/sim/constants.js'
import { deltaV, ship, totalMass } from '../src/sim/ship.js'

const RE = BODIES.earth.radius
const snap = process.argv[2]
if (!snap) {
  console.error('usage: node scripts/verify-return.mjs <lunar-orbit-snapshot.json>')
  process.exit(2)
}

/** Geocentric state, and the flight-path angle — negative is descending. */
function flightPathAngle() {
  const st = live.sim.state
  const o = INDEX.ship * 6
  const e = INDEX.earth * 6
  const rx = st[o] - st[e]
  const ry = st[o + 1] - st[e + 1]
  const rz = st[o + 2] - st[e + 2]
  const vx = st[o + 3] - st[e + 3]
  const vy = st[o + 4] - st[e + 4]
  const vz = st[o + 5] - st[e + 5]
  const r = Math.hypot(rx, ry, rz)
  const v = Math.hypot(vx, vy, vz)
  const radial = (rx * vx + ry * vy + rz * vz) / r
  return Math.asin(Math.max(-1, Math.min(1, radial / v))) * (180 / Math.PI)
}

/** Speed relative to the co-rotating surface — what a recovery ship measures. */
function surfaceRelativeSpeed() {
  const st = live.sim.state
  const o = INDEX.ship * 6
  const e = INDEX.earth * 6
  const w = live.sim.omega
  const rx = st[o] - st[e]
  const ry = st[o + 1] - st[e + 1]
  const rz = st[o + 2] - st[e + 2]
  return Math.hypot(
    st[o + 3] - st[e + 3] - (w[1] * rz - w[2] * ry),
    st[o + 4] - st[e + 4] - (w[2] * rx - w[0] * rz),
    st[o + 5] - st[e + 5] - (w[0] * ry - w[1] * rx),
  )
}

const warpArg = process.argv.indexOf('--entry-warp')
if (warpArg > 0) PROFILE.entryWarp = Number(process.argv[warpArg + 1])

loadSnapshot(snap)
console.log(`resumed in ${currentPhase().id} at MET ${(mission.t / 3600).toFixed(2)} h`)
console.log(
  `  lunar orbit ${(live.lunar.perigee / 1e3).toFixed(2)} x ${(live.lunar.apogee / 1e3).toFixed(2)} km,` +
    ` ${(totalMass() / 1e3).toFixed(3)} t, ${deltaV().toFixed(1)} m/s aboard`,
)

const rec = {
  teiAlignStart: 0,
  teiWait: 0,
  interfaceFPA: 0,
  interfaceSpeed: 0,
  interfaceTime: 0,
  interfacePerigee: 0,
  drogueMach: 0,
  drogueRel: 0,
  mainRel: 0,
  peakChuteG: 0,
  splashVert: 0,
}
let last = currentPhase().id
let interfaceSeen = false

for (let i = 0; i < 6_000_000; i++) {
  const id = currentPhase().id
  flight.pilotWarp = mission.warpRequest === null ? WARP.m1 : null
  frame()
  const now = currentPhase().id

  // Peak chute loads, sampled every frame rather than at deployment only.
  if (now === 'DROGUE' || now === 'MAIN_CHUTES') {
    if (live.decelG > rec.peakChuteG) rec.peakChuteG = live.decelG
  }

  // The entry interface, caught on the crossing rather than at a phase edge.
  if (!interfaceSeen && live.elements.altitude <= PROFILE.entryInterface && live.elements.vertical < 0) {
    interfaceSeen = true
    rec.interfaceFPA = flightPathAngle()
    rec.interfaceSpeed = surfaceRelativeSpeed()
    rec.interfaceTime = mission.t
    // The osculating perigee here is a real number, not a fiction: the Moon is
    // 380,000 km astern and Earth is unambiguously in charge of the trajectory.
    rec.interfacePerigee = live.elements.perigee
  }

  if (now !== last) {
    if (now === 'TEI_ALIGN') rec.teiAlignStart = mission.t
    if (last === 'TEI_ALIGN' && now === 'TEI_BURN') {
      rec.teiWait = mission.t - rec.teiAlignStart
    }
    if (now === 'DROGUE') {
      rec.drogueMach = live.mach
      rec.drogueRel = surfaceRelativeSpeed()
    }
    if (now === 'MAIN_CHUTES') rec.mainRel = surfaceRelativeSpeed()
    // Read what SPLASHDOWN.enter() latched: by the time this runs the frame has
    // already applied the surface hold, which zeroes exactly what is wanted.
    if (now === 'SPLASHDOWN') rec.splashVert = mission.entry.splashdownVertical
    last = now
  }
  if (now === 'SPLASHDOWN' && mission.phaseT > 30) break
}

const en = mission.entry
const tei = mission.tei
const ei = mission.ei

console.log('\n=== trans-Earth injection ===')
console.log(`  waited in the window        ${(rec.teiWait / 60).toFixed(1)} min (orbit period ${(PROFILE.lunarDwell / 60).toFixed(1)} min)`)
console.log(`  required v_inf              ${tei.vInfRequired.toFixed(1)} m/s`)
console.log(`  departure out of plane      ${((tei.outOfPlane * 180) / Math.PI).toFixed(2)} deg`)
console.log(`  C3 target / achieved        ${(tei.c3Target / 1e6).toFixed(5)} / ${(tei.c3 / 1e6).toFixed(5)} km2/s2`)
console.log(`  cutoff criterion            ${tei.cutoff}`)
console.log(`  delta-v delivered           ${tei.deltaVDelivered.toFixed(1)} m/s over ${tei.burnDuration.toFixed(1)} s`)
console.log(`  corridor reachable prograde ${tei.corridorReachable}`)
console.log(`  perigee the impulsive solve expected  ${((tei.predictedPerigee - RE) / 1e3).toFixed(0)} km altitude`)
console.log(`  perigee the flown finite burn gave    ${((ei.before - RE) / 1e3).toFixed(0)} km altitude`)
console.log(`  finite-burn error                    ${(((ei.before - tei.predictedPerigee)) / 1e3).toFixed(0)} km`)

console.log('\n=== corridor trim ===')
console.log(`  solved delta-v              ${ei.magnitude.toFixed(2)} m/s in ${ei.iterations} iterations`)
console.log(`  LVLH  prograde ${ei.lvlh.prograde.toFixed(2)}  normal ${ei.lvlh.normal.toFixed(2)}  radial ${ei.lvlh.radial.toFixed(2)}`)
console.log(`  converged / executed        ${ei.converged}`)
console.log(`  perigee predicted           ${((ei.predicted - RE) / 1e3).toFixed(2)} km altitude`)

console.log('\n=== entry interface (122 km) ===')
console.log(`  velocity, surface-relative  ${(rec.interfaceSpeed / 1e3).toFixed(3)} km/s`)
console.log(`  flight-path angle           ${rec.interfaceFPA.toFixed(3)} deg   (Apollo corridor -6.5 +- 0.5)`)
console.log(`  vacuum perigee flown        ${(rec.interfacePerigee / 1e3).toFixed(2)} km altitude` +
  `  vs ${(PROFILE.entryPerigee / 1e3).toFixed(0)} km targeted` +
  `  (miss ${((rec.interfacePerigee - PROFILE.entryPerigee) / 1e3).toFixed(2)} km)`)

console.log('\n=== entry loads ===')
console.log(`  peak deceleration           ${en.peakG.toFixed(2)} g at ${(en.peakGAltitude / 1e3).toFixed(1)} km`)
console.log(`  peak dynamic pressure       ${(en.peakQ / 1e3).toFixed(1)} kPa`)
console.log(`  peak convective flux        ${(en.peakHeatFlux / 1e4).toFixed(0)} W/cm2   (Sutton-Graves)`)
console.log(`  peak radiative flux         ${(en.peakRadFlux / 1e4).toFixed(0)} W/cm2   (Tauber-Sutton)`)
console.log(`  peak total flux             ${(en.peakTotalFlux / 1e4).toFixed(0)} W/cm2 at ${(en.peakTotalAltitude / 1e3).toFixed(1)} km`)
console.log(`  radiative / convective      ${(en.peakRadFlux / en.peakHeatFlux).toFixed(2)}x`)

console.log('\n=== descent ===')
console.log(`  drogues at                  ${(en.drogueAltitude / 1e3).toFixed(2)} km, Mach ${rec.drogueMach.toFixed(2)}, ${rec.drogueRel.toFixed(0)} m/s`)
console.log(`  mains at                    ${(en.mainAltitude / 1e3).toFixed(2)} km, ${rec.mainRel.toFixed(0)} m/s`)
console.log(`  peak load under canopy      ${rec.peakChuteG.toFixed(2)} g`)
console.log(`  splashdown descent rate     ${rec.splashVert.toFixed(2)} m/s`)
console.log(`  mission elapsed             ${(mission.t / 86400).toFixed(3)} days`)
console.log(`  delta-v remaining           ${deltaV().toFixed(1)} m/s, capsule ${(totalMass() / 1e3).toFixed(3)} t`)

/* ---- what must hold ---- */
const checks = [
  ['reached splashdown', currentPhase().id === 'SPLASHDOWN'],
  ['entry corridor -7.0 .. -5.5 deg', rec.interfaceFPA > -7.0 && rec.interfaceFPA < -5.5],
  ['vacuum perigee within 10 km of target',
   Math.abs(rec.interfacePerigee - PROFILE.entryPerigee) < 10e3],
  ['entry speed 10.5 .. 11.5 km/s', rec.interfaceSpeed > 10.5e3 && rec.interfaceSpeed < 11.5e3],
  // The capsule now flies lifting, so this is the guided band rather than the
  // ballistic one. The ballistic case is still reachable and is measured
  // side-by-side in verify-entry-guidance.mjs, where it comes out at 12.17 g.
  ['peak deceleration held near the 6.5 g target', en.peakG > 4 && en.peakG < 9],
  ['guidance was active', en.guided],
  ['no chute-opening spike over 15 g', rec.peakChuteG < 15],
  ['descent rate under 10 m/s', rec.splashVert > 0 && rec.splashVert < 10],
  ['service module discarded', ship.stage === SHIP.stages.length - 1],
  ['trim stayed within its cap', ei.magnitude <= PROFILE.eiMaxDeltaV],
  // At lunar-return speed radiation should dominate: this is the whole reason
  // a convective-only figure understates the shield's problem. If it came out
  // below convective, the correlation is being fed something wrong.
  ['radiative flux exceeds convective', en.peakRadFlux > en.peakHeatFlux],
]
console.log('')
let pass = true
for (const [label, ok] of checks) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`)
  if (!ok) pass = false
}
console.log(`\n  ${pass ? 'PASS' : 'FAIL'}`)
process.exit(pass ? 0 : 1)
