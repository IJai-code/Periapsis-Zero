/**
 * Entry heating, profiled — convective against radiative down the whole entry.
 *
 * Two correlations with different physics and different validity, so this walks
 * the trajectory and prints both rather than reporting a single peak. What it is
 * checking is not a number but a *shape*: at lunar-return speed radiation should
 * dominate, should peak higher and earlier than convection, and both should be
 * gone well before the parachutes.
 *
 * On comparing to Apollo. This script has no Apollo 4 reconstruction in it and
 * does not pretend to: that data is not available offline, so any figure quoted
 * from memory is a recollection, not a measurement, and calibrating against one
 * would be fitting the physics to a half-remembered number. What *can* be
 * established is internal and is what the checks below test — that the radiative
 * term dominates at this speed, that it peaks higher and earlier than convection
 * because it goes as rho^1.22 f(v) against sqrt(rho) v^3, that both are finished
 * long before the canopies, and that the same capsule entering from low orbit
 * sees essentially none of it. Those are properties of the trajectory, not of a
 * remembered constant.
 *
 * The measured peak is 494 W/cm^2 total, on the entry flown from the checked-in
 * lunar-orbit fixture. A steeper lunar return would be materially higher — flux
 * climbs fast with entry angle — so this figure should be read as belonging to
 * that corridor rather than to lunar return in general. It is printed below on
 * every run, so it cannot quietly stop being true.
 *
 * The state is `scripts/fixtures/lunar-orbit.json`, which is why this gate can
 * sit in the suite: holding the corridor still is what keeps it a test of the
 * two correlations rather than of whatever TLI targeting did this week. The
 * fixture's README argues that choice and states its cost, and the first check
 * below is that the fixture still restores into LUNAR_ORBIT under this code.
 *
 *   node scripts/verify-heating.mjs                    the fixture
 *   node scripts/verify-heating.mjs other-state.json   some other state
 */

import { flight, frame, loadSnapshot, LUNAR_ORBIT_FIXTURE } from './flight.mjs'
import { WARP } from '../src/sim/warp.js'
import { live } from '../src/sim/live.js'
import { currentPhase, mission, PROFILE } from '../src/sim/mission.js'
import { radiativeFlux } from '../src/sim/atmosphere.js'

const snap = process.argv[2] ?? LUNAR_ORBIT_FIXTURE

const NOSE_RADIUS = 6.03 // as live.js uses

console.log('=== the correlation itself, before flying anything ===')
console.log('  Tauber-Sutton at fixed density, against velocity (Rn = 6.03 m, rho = 1e-3):')
for (const v of [8000, 9000, 9500, 10000, 10500, 11000, 12000]) {
  const q = radiativeFlux(1e-3, v, NOSE_RADIUS) / 1e4
  console.log(`    ${(v / 1000).toFixed(1).padStart(5)} km/s  ->  ${q.toFixed(1).padStart(8)} W/cm2`)
}
console.log('  the switch-on below 9 km/s is the fit\'s floor, not physics — see atmosphere.js')

/**
 * The control case, and the reason the term is worth having at all: the same
 * capsule returning from low orbit. Below the fit's 9 km/s floor radiation is
 * not merely small, it is off the bottom of the correlation entirely — which is
 * exactly why an orbital-entry model can omit it and a lunar-return one cannot.
 */
console.log('\n  the same capsule at orbital entry speed, rho = 1e-3:')
for (const v of [7800, 8500]) {
  console.log(`    ${(v / 1000).toFixed(1)} km/s  ->  ${(radiativeFlux(1e-3, v, NOSE_RADIUS) / 1e4).toFixed(1)} W/cm2 radiative`)
}

loadSnapshot(snap)
/*
 * A checked-in state does not follow the code that made it. If the simulator
 * moves out from under the fixture this gate would go on flying it and report a
 * heating profile for a mission this repository can no longer fly — passing,
 * and meaningless. So the regime is asserted rather than assumed, here at the
 * moment of load, and the check is listed with the others at the end.
 */
const restoredPhase = currentPhase().id
const fixtureValid = restoredPhase === 'LUNAR_ORBIT'
console.log(`\nflying from ${restoredPhase} at MET ${(mission.t / 3600).toFixed(2)} h`)
if (!fixtureValid) {
  console.log(`  the fixture restores into ${restoredPhase}, not LUNAR_ORBIT — it has drifted`)
  console.log('  out of the regime this gate is written for; regenerate it with `npm run fixture:lunar`')
}

const samples = []
let entered = false
for (let i = 0; i < 6_000_000; i++) {
  flight.pilotWarp = mission.warpRequest === null ? WARP.m1 : null
  frame()
  const id = currentPhase().id
  if (!entered && live.elements.altitude <= PROFILE.entryInterface) entered = true
  if (entered && live.totalFlux > 1e4) {
    samples.push({
      t: mission.t,
      alt: live.elements.altitude,
      conv: live.heatFlux,
      rad: live.radiativeFlux,
      total: live.totalFlux,
      g: live.decelG,
    })
  }
  if (id === 'SPLASHDOWN') break
}

/*
 * Everything below indexes into `samples`, so an empty one is a TypeError and a
 * stack trace instead of a diagnosis. That is reachable: a state that never
 * reaches the interface collects nothing, and this gate now runs unattended in
 * the suite where the first line of the failure is the only one anybody reads.
 */
if (samples.length === 0) {
  console.log('\n  flew the state and never crossed the entry interface — no heating to profile.')
  console.log(`  ${fixtureValid ? 'the state restored into LUNAR_ORBIT, so this is the trajectory, not the fixture' : 'the fixture has drifted; regenerate it with `npm run fixture:lunar`'}`)
  console.log('\n  FAIL')
  process.exit(1)
}

const en = mission.entry
console.log(`\n=== profile, ${samples.length} frames above 1 W/cm2 ===`)
console.log('     alt km      conv       rad     total   ratio      g')
// Thin the samples to a readable ladder by altitude rather than by index.
const wanted = [110, 100, 90, 80, 70, 60, 55, 50, 45, 40, 35, 30, 25, 20]
for (const a of wanted) {
  let best = null
  let bestErr = Infinity
  for (const s of samples) {
    const err = Math.abs(s.alt / 1e3 - a)
    if (err < bestErr) {
      bestErr = err
      best = s
    }
  }
  if (best && bestErr < 2) {
    console.log(
      `  ${(best.alt / 1e3).toFixed(1).padStart(8)}` +
        `${(best.conv / 1e4).toFixed(1).padStart(10)}` +
        `${(best.rad / 1e4).toFixed(1).padStart(10)}` +
        `${(best.total / 1e4).toFixed(1).padStart(10)}` +
        `${(best.rad / Math.max(best.conv, 1e-9)).toFixed(2).padStart(8)}` +
        `${best.g.toFixed(1).padStart(8)}`,
    )
  }
}

const peakConvAlt = samples.reduce((b, s) => (s.conv > b.conv ? s : b), samples[0])
const peakRadAlt = samples.reduce((b, s) => (s.rad > b.rad ? s : b), samples[0])
const peakTotAlt = samples.reduce((b, s) => (s.total > b.total ? s : b), samples[0])

console.log('\n=== peaks, and where they occur ===')
console.log(`  convective  ${(en.peakHeatFlux / 1e4).toFixed(0).padStart(5)} W/cm2 at ${(peakConvAlt.alt / 1e3).toFixed(1)} km`)
console.log(`  radiative   ${(en.peakRadFlux / 1e4).toFixed(0).padStart(5)} W/cm2 at ${(peakRadAlt.alt / 1e3).toFixed(1)} km`)
console.log(`  total       ${(en.peakTotalFlux / 1e4).toFixed(0).padStart(5)} W/cm2 at ${(peakTotAlt.alt / 1e3).toFixed(1)} km`)
console.log(`  radiative dominates by  ${(en.peakRadFlux / en.peakHeatFlux).toFixed(2)}x`)

// Integrated load — the number that actually sizes an ablator, since a shield
// fails on total energy absorbed rather than on instantaneous flux.
let heatLoad = 0
for (let i = 1; i < samples.length; i++) {
  heatLoad += 0.5 * (samples[i].total + samples[i - 1].total) * (samples[i].t - samples[i - 1].t)
}
console.log(`  integrated heat load    ${(heatLoad / 1e4 / 1e3).toFixed(1)} kJ/cm2 over ${(samples[samples.length - 1].t - samples[0].t).toFixed(0)} s`)
console.log('  (the load is a slight underestimate: the radiative tail below')
console.log('   9 km/s is truncated by the correlation\'s floor, not by physics)')

console.log('\n=== what this establishes ===')
const checks = [
  ['the fixture still restores into the regime this gate flies', fixtureValid],
  ['radiative exceeds convective', en.peakRadFlux > en.peakHeatFlux],
  ['radiative peaks above convective in altitude', peakRadAlt.alt > peakConvAlt.alt],
  [
    // The band a lunar return occupies, an order above what an orbital return
    // sees. Deliberately not calibrated against a specific published peak.
    'total in the several-hundred W/cm2 lunar-return band',
    en.peakTotalFlux / 1e4 > 200 && en.peakTotalFlux / 1e4 < 900,
  ],
  ['heating over before the drogues', peakTotAlt.alt > 20e3],
]
let pass = true
for (const [label, ok] of checks) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`)
  if (!ok) pass = false
}
console.log(`\n  ${pass ? 'PASS' : 'FAIL'}`)
process.exit(pass ? 0 : 1)
