/**
 * Guided entry against ballistic, from the same trajectory.
 *
 * The only difference between the two runs is `PROFILE.entryLiftToDrag`: 0 flies
 * the capsule as a passive ballistic object, 0.3 gives it Apollo's trimmed
 * lift-to-drag and lets the autopilot point it. Everything upstream — the
 * departure, the corridor trim, the entry state — is identical, so the whole
 * difference in the numbers below is attributable to the control loop.
 *
 * What is being checked is not just a lower peak. A lifting entry that merely
 * clipped the peak by staying high would skip; one that dug in would be worse
 * than ballistic. The claim is specifically that the load is held on a
 * *plateau* near the target, that the vehicle neither skips nor overshoots, and
 * that cross-range stays bounded through bank reversals.
 *
 * The no-skip condition is stated as *altitude regained* rather than as "the
 * vertical rate is never positive", which is what it said first. A reversing
 * entry cannot satisfy the sign form: the bank sign is reversed by rolling, and
 * rolling from +bank to -bank sweeps the lift vector through full-up, so the
 * vertical rate must go positive for a few seconds — here +72 m/s out of an
 * 11 km/s entry, at the moment of the reversal. The magnitude of the regained
 * altitude separates the two, and it is falsifiable on this corridor: hold the
 * roll rate down to 0.05 rad/s and the same entry regains 48 km, climbing back
 * out of the atmosphere. At the flying roll rate it regains nothing.
 *
 * The state is the checked-in lunar-orbit fixture unless another is given, the
 * same default `verify-heating` and `verify-allocation` take, so the gate can
 * sit in the suite with no arguments.
 *
 *   node scripts/verify-entry-guidance.mjs                    the fixture
 *   node scripts/verify-entry-guidance.mjs other-state.json   some other state
 */

import { flight, frame, loadSnapshot, LUNAR_ORBIT_FIXTURE } from './flight.mjs'
import { WARP } from '../src/sim/warp.js'
import { live } from '../src/sim/live.js'
import { currentPhase, mission, PROFILE } from '../src/sim/mission.js'
import { ship } from '../src/sim/ship.js'

const snap = process.argv[2] ?? LUNAR_ORBIT_FIXTURE

function fly(ld) {
  loadSnapshot(snap)
  // restore() clears the return and entry blocks, so both runs start clean.
  PROFILE.entryLiftToDrag = ld
  const trace = []
  let peakG = 0
  let peakGAlt = 0
  let minAltAfterPeak = Infinity
  let maxClimb = -Infinity
  let minAltEver = Infinity
  let regain = 0
  let sawEntry = false

  for (let i = 0; i < 6_000_000; i++) {
    flight.pilotWarp = mission.warpRequest === null ? WARP.m1 : null
    frame()
    const id = currentPhase().id
    if (id === 'RE_ENTRY' || id === 'DROGUE' || id === 'MAIN_CHUTES') {
      sawEntry = true
      // Aerodynamic load only: chute-opening transients are a separate event
      // and are reported by verify-return.mjs.
      if (id === 'RE_ENTRY' && live.decelG > peakG) {
        peakG = live.decelG
        peakGAlt = live.elements.altitude
      }
      // A skip shows up as the altitude rate turning positive while still fast.
      // Reported, not asserted — see the header.
      if (live.elements.speed > 7500 && live.elements.vertical > maxClimb) {
        maxClimb = live.elements.vertical
      }
      /**
       * And the asserted form: how far the vehicle climbs back *up* once it is
       * deep in the atmosphere. Zero for a monotone descent, however much the
       * bank rolls.
       */
      const alt = live.elements.altitude
      if (alt < minAltEver) minAltEver = alt
      if (minAltEver < 95e3 && alt - 95e3 > regain) regain = alt - 95e3
      if (peakG > 1 && live.elements.altitude < minAltAfterPeak) {
        minAltAfterPeak = live.elements.altitude
      }
      if (id === 'RE_ENTRY' && trace.length < 100000) {
        trace.push({
          t: mission.t,
          alt: live.elements.altitude,
          v: live.elements.speed,
          g: live.decelG,
          hdot: live.elements.vertical,
          bank: (ship.bankAngle * 180) / Math.PI,
          flux: live.totalFlux,
        })
      }
    }
    if (id === 'SPLASHDOWN') break
  }

  const en = mission.entry
  /**
   * Time actually spent within a band of the target — summed, not spanned.
   * Taking last-minus-first counts the excursion *between* two crossings, so a
   * ballistic entry that passes through 6.5 g on the way up to 12 and again on
   * the way down scores 90 s of "plateau" while never holding anything.
   */
  let dwell = 0
  for (let i = 1; i < trace.length; i++) {
    if (Math.abs(trace[i].g - PROFILE.entryTargetG) < 1.0) dwell += trace[i].t - trace[i - 1].t
  }

  /**
   * Exposure duration, which is the mechanism behind the integrated load.
   *
   * Measured two ways because they answer different questions: how long the
   * entry phase itself lasted, and how long the shield was above a meaningful
   * flux. Quoting the integrated load without either would leave the *reason*
   * for it inferred rather than shown.
   */
  const entryDuration = trace.length ? trace[trace.length - 1].t - trace[0].t : 0
  let hotTime = 0
  for (let i = 1; i < trace.length; i++) {
    if (trace[i].flux > 50e4) hotTime += trace[i].t - trace[i - 1].t // above 50 W/cm2
  }

  return {
    ld,
    entryDuration,
    hotTime,
    reached: currentPhase().id,
    peakG,
    peakGAlt,
    minAltAfterPeak,
    maxClimb,
    regain,
    peakQ: en.peakQ,
    peakTotalFlux: en.peakTotalFlux,
    heatLoadProxy: trace.reduce((a, s, i) => (i ? a + s.flux * (s.t - trace[i - 1].t) : 0), 0),
    reversals: en.bankReversals,
    peakCross: en.peakCrossRange,
    splashVert: en.splashdownVertical,
    dwell,
    maxClimb,
    sawEntry,
    trace,
  }
}

console.log('flying the same entry twice, ballistic then guided\n')
const ball = fly(0)
const lift = fly(0.3)

const row = (label, a, b, fmt) =>
  console.log(`  ${label.padEnd(30)}${fmt(a).padStart(14)}${fmt(b).padStart(14)}`)
const f2 = (x) => x.toFixed(2)
const f0 = (x) => x.toFixed(0)

console.log('                                     ballistic        guided')
row('lift-to-drag', ball.ld, lift.ld, f2)
row('peak deceleration, g', ball.peakG, lift.peakG, f2)
row('  at altitude, km', ball.peakGAlt / 1e3, lift.peakGAlt / 1e3, f2)
row('peak dynamic pressure, kPa', ball.peakQ / 1e3, lift.peakQ / 1e3, f2)
row('peak total flux, W/cm2', ball.peakTotalFlux / 1e4, lift.peakTotalFlux / 1e4, f0)
row('integrated flux, kJ/cm2', ball.heatLoadProxy / 1e7, lift.heatLoadProxy / 1e7, f2)
row('seconds within 1 g of target', ball.dwell, lift.dwell, f0)
row('entry phase duration, s', ball.entryDuration, lift.entryDuration, f0)
row('seconds above 50 W/cm2', ball.hotTime, lift.hotTime, f0)
row('bank reversals', ball.reversals, lift.reversals, f0)
row('peak climb while above 7.5 km/s, m/s', ball.maxClimb, lift.maxClimb, f0)
row('altitude regained below 95 km, m', ball.regain, lift.regain, f0)
row('peak cross-range, km', ball.peakCross / 1e3, lift.peakCross / 1e3, f2)
row('splashdown descent, m/s', ball.splashVert, lift.splashVert, f2)

console.log('\n=== guided profile ===')
console.log('     t+s    alt km     v km/s       g     hdot    bank deg')
const t0 = lift.trace.length ? lift.trace[0].t : 0
let lastPrint = -1e9
for (const s of lift.trace) {
  if (s.t - lastPrint < 10) continue
  lastPrint = s.t
  console.log(
    `  ${(s.t - t0).toFixed(0).padStart(6)}${(s.alt / 1e3).toFixed(1).padStart(10)}` +
      `${(s.v / 1e3).toFixed(3).padStart(11)}${s.g.toFixed(2).padStart(8)}` +
      `${s.hdot.toFixed(0).padStart(9)}${s.bank.toFixed(0).padStart(12)}`,
  )
}

console.log('\n=== what this establishes ===')
const checks = [
  ['both entries reach splashdown', ball.reached === 'SPLASHDOWN' && lift.reached === 'SPLASHDOWN'],
  ['guided peak is below ballistic', lift.peakG < ball.peakG],
  ['guided peak within 1.5 g of the target', Math.abs(lift.peakG - PROFILE.entryTargetG) < 1.5],
  ['load actually held on a plateau (>20 s in band)', lift.dwell > 20],
  ['no skip: no altitude regained below 95 km', lift.regain === 0],
  ['cross-range bounded under 150 km', Math.abs(lift.peakCross) < 150e3],
  ['bank reversals happened', lift.reversals > 0],
  ['descent rate still under 10 m/s', lift.splashVert > 0 && lift.splashVert < 10],
  // The stated mechanism for the higher integrated load: longer exposure. If
  // the guided entry were not in fact hotter for longer, the explanation in the
  // README would be wrong even though the integral is right.
  ['guided entry is exposed longer', lift.hotTime > ball.hotTime],
  /**
   * And the trade-off itself, which is the README's headline claim about
   * lifting entry and was previously only *reported*.
   *
   * Asserted on direction rather than on the 15% this trajectory happens to
   * produce. The physics is that trading peak rate for exposure costs total
   * energy; the magnitude belongs to one corridor and one set of gains, and
   * pinning it would turn a legitimate retune into a failure.
   */
  ['lower peak rate is paid for in total energy',
   lift.peakTotalFlux < ball.peakTotalFlux && lift.heatLoadProxy > ball.heatLoadProxy],
]
let pass = true
for (const [label, ok] of checks) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`)
  if (!ok) pass = false
}
console.log(`\n  ${pass ? 'PASS' : 'FAIL'}`)
process.exit(pass ? 0 : 1)
