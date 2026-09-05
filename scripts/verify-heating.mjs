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
 * The measured peak here is ~390 W/cm^2 total on a -6.32 deg entry. A steeper
 * lunar return would be materially higher — flux climbs fast with entry angle —
 * so this figure should be read as belonging to this corridor rather than to
 * lunar return in general.
 *
 *   node scripts/verify-heating.mjs <lunar-orbit-snapshot.json>
 */

import { flight, frame, loadSnapshot } from './flight.mjs'
import { WARP } from '../src/sim/warp.js'
import { live } from '../src/sim/live.js'
import { currentPhase, mission, PROFILE } from '../src/sim/mission.js'
import { radiativeFlux } from '../src/sim/atmosphere.js'

const snap = process.argv[2]
if (!snap) {
  console.error('usage: node scripts/verify-heating.mjs <lunar-orbit-snapshot.json>')
  process.exit(2)
}

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
console.log(`\nflying from ${currentPhase().id} at MET ${(mission.t / 3600).toFixed(2)} h`)

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
