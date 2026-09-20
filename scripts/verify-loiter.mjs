/**
 * A parking orbit that lasts until its translunar window.
 *
 * The flight computer waits in low orbit for the Moon's arrival point to cross
 * the parking plane, and that wait was anywhere from under a day to two weeks
 * depending on where the Moon happened to be. A 172 x 185 km orbit does not last
 * two weeks. Vandenberg's decayed into the planet on day 11.4, 7.5 hours before
 * its window, and nothing noticed: the vehicle was flown on from the middle of
 * the Earth, and its injection written up as a delta-v shortfall.
 *
 * So at commitment the flight computer now forecasts the window, integrates the
 * orbit's remaining life, and when the second is shorter plans a raise to the
 * orbit that decays back down into the committed one as the window opens.
 * Everything that decision rests on is checked here against flight:
 *
 *   1. left alone, the orbit decays the way the theory says, to the tolerance
 *      the decision allows for
 *   2. the window comes when the forecast says, within one parking orbit
 *   3. pads whose orbits last plan nothing; Vandenberg plans a raise, flies it,
 *      and injects from the orbit it committed from
 *   4. Vandenberg flies the whole mission, pad to splashdown
 *   5. a window already open at commitment is counted on only if the craft
 *      will come round in time to use it
 *   6. when the pilot changes the orbit during the wait, the plan follows
 *   7. the decay theory holds on eccentric orbits, where the air is all met
 *      at perigee
 *   8. no injection starts from under the 140 km floor: an orbit that would
 *      reach its window lower is raised by the least that clears it, and
 *      ignition waits for a raise that has not flown
 *
 *   node scripts/verify-loiter.mjs
 */

import { flight, flyMission, frame } from './flight.mjs'
import { live, refreshDerived, resetSimulation } from '../src/sim/live.js'
import { PROFILE, WINDOW_STEP, beginCountdown, commitTLI, currentPhase, mission, perigeeMargin, resetMission } from '../src/sim/mission.js'
import { addNode, clearNodes } from '../src/sim/nodes.js'
import { DECAY_FLOOR, decayAfter, decayTime, decayed as decayState } from '../src/sim/decay.js'
import { deltaV, input, ship } from '../src/sim/ship.js'
import { BODIES, G } from '../src/sim/constants.js'
import { SPIN_AXIS } from '../src/sim/atmosphere.js'
import { REFERENCE_RADIUS, ZONAL, fieldOf, meanEccentricity, meanSemiMajor } from '../src/sim/prem.js'
import { INDEX } from '../src/sim/system.js'
import { WARP } from '../src/sim/warp.js'
import { LAUNCH_SITES, selectSite } from '../src/sim/launchsite.js'

const MU = G * BODIES.earth.mass
const R = BODIES.earth.radius
const H = 3600
const C = INDEX.ship * 6
const E = INDEX.earth * 6

/**
 * The orbit from the state itself: osculating semi-major axis, eccentricity, and
 * cos i against the spin axis — plus the **mean** semi-major axis, which is the
 * one every number in this file is now measured against.
 *
 * Since J2 went live the two differ by five to seven kilometres at parking
 * altitude, and in both directions depending on where in the short-period swing
 * the flight happens to be: the four pads commit 3.9, 6.6, 4.9 and 6.7 km away
 * from the mean orbit they are actually flying. Comparing a flown *osculating*
 * quantity against a *mean* theory is comparing an oscillation against its
 * average, which is how this file spent nine checks failing for reasons that had
 * nothing to do with the theory.
 *
 * The eccentricity stays the osculating one, here and in the planner both, for
 * the reason `assessOrbit` gives: at a per cent of the curvature its own J2 term
 * is a few hundred metres of perigee.
 */
function orbitNow() {
  const s = live.sim.state
  const rx = s[C] - s[E]
  const ry = s[C + 1] - s[E + 1]
  const rz = s[C + 2] - s[E + 2]
  const vx = s[C + 3] - s[E + 3]
  const vy = s[C + 4] - s[E + 4]
  const vz = s[C + 5] - s[E + 5]
  const r2 = rx * rx + ry * ry + rz * rz
  const a = 1 / (2 / Math.sqrt(r2) - (vx * vx + vy * vy + vz * vz) / MU)
  const hx = ry * vz - rz * vy
  const hy = rz * vx - rx * vz
  const hz = rx * vy - ry * vx
  const h = Math.hypot(hx, hy, hz)
  const e = Math.sqrt(Math.max(0, 1 - (h * h) / (MU * a)))
  return {
    a,
    e,
    /**
     * In the field the simulation actually has installed, for the reason
     * `assessOrbit` does it: a gate that lifts the oblateness to fly the
     * point-mass world would otherwise read a mean orbit with a J2 term in it
     * that the trajectory does not have, and the two worlds stop being
     * comparable — which is the whole point of having the second one.
     */
    am: meanSemiMajor(rx, ry, rz, vx, vy, vz, r2, fieldOf(live.sim)),
    /**
     * And the mean eccentricity, for the same reason: the planner predicts a
     * decay from mean elements, so a perigee measured from the osculating ones
     * is a different question being answered and reads as error that is not
     * there. The osculating value is kept as `e` because it is what the HUD
     * reports and what the field's two rates are functions of.
     */
    em: meanEccentricity(rx, ry, rz, vx, vy, vz, r2, fieldOf(live.sim)),
    cosI: (hx * SPIN_AXIS[0] + hy * SPIN_AXIS[1] + hz * SPIN_AXIS[2]) / h,
  }
}

/**
 * The harness's own dial is module state, and a second flight in the same
 * process inherits the first one's `lastWarpRequest` — which makes the next
 * flight's request compare equal and never take effect. Cleared per flight.
 */
function freshFlight(site) {
  selectSite(site)
  resetSimulation()
  refreshDerived()
  clearNodes()
  flight.warp = WARP.d1
  flight.lastWarpRequest = null
  flight.warpBeforeBurn = null
  flight.pilotWarp = null
}

/** Pad to injection or loss, recording the plan made at commitment and what then happened. */
function toInjection(site, sampleEvery = 0, launchHour = 0) {
  freshFlight(site)
  resetMission()
  /*
   * Hold on the pad until the launch epoch; the clamp is exact and the world
   * turns under it.
   *
   * The last hour is held at a minute a second rather than a day. At a day the
   * hold overshoots by up to a frame's worth of it, so every launch hour inside
   * the same day collapses to one commitment — which made the arrival point at
   * commitment quantise, and with it every scenario in this file that is
   * selected by launch hour. Coarse until it is close, fine after, so the epoch
   * asked for is the epoch flown.
   */
  const target = launchHour * H
  flight.pilotWarp = WARP.d1
  for (let i = 0; live.sim.t < target - H && i < 1_000_000; i++) frame()
  flight.pilotWarp = WARP.m1
  for (let i = 0; live.sim.t < target && i < 1_000_000; i++) frame()
  beginCountdown()
  const rec = { site, commit: 0, orbit: null, dragK: 0, plan: null, samples: [], nodePhases: 0, injectT: null, injectA: 0, injectPeri: 0, end: '', endT: 0 }
  let lastPeri = 0
  let committed = false
  let next = Infinity
  for (let i = 0; i < 3_000_000; i++) {
    const id = currentPhase().id
    if (!committed && id === 'COAST' && commitTLI()) {
      committed = true
      rec.commit = live.sim.t
      /*
       * The mean orbit, because it is the one the planner plans against and so
       * the one this file has to compare it with. `rec.osc` keeps the osculating
       * value, which is what the HUD reports and what the panel's two rates are
       * functions of — the two are different questions.
       */
      const atCommit = orbitNow()
      rec.osc = atCommit.a
      rec.osc_e = atCommit.e
      /*
       * Mean elements on both counts, axis and eccentricity, because that is
       * what the theory is written about — see `assessOrbit`, which pairs them
       * the same way. The osculating values are kept beside them because the
       * comparison is what shows why: the two eccentricities differ by half, and
       * the osculating one swings by a factor of five within a single revolution
       * of an orbit whose perigee does not move 72 m in five of them.
       */
      rec.orbit = { ...atCommit, a: atCommit.am, e: atCommit.em }
      rec.dragK = live.sim.dragK[0]
      rec.plan = { ...mission.tli.loiter }
      rec.outAtCommit = mission.tli.outOfPlane
      next = rec.commit + sampleEvery
    }
    flight.pilotWarp = mission.warpRequest !== null ? null : WARP.m1
    frame()
    const now = currentPhase().id
    if (now === 'TLI_ALIGN') {
      const o = orbitNow()
      /*
       * Mean perigee, for the reason `orbitNow` gives about the axis and for
       * the same size of reason: the osculating eccentricity carries a J2
       * short-period term as large as itself, so `am * (1 - e)` read at an
       * arbitrary instant scatters over fifteen kilometres on an orbit whose
       * perigee is standing still. Comparing that against a mean-element theory
       * is comparing an oscillation with its own average.
       */
      lastPeri = o.am * (1 - o.em)
    }
    if (now !== id && now.startsWith('NODE_')) rec.nodePhases++
    if (sampleEvery && now === 'TLI_ALIGN' && live.sim.t >= next) {
      rec.samples.push([live.sim.t - rec.commit, orbitNow().am])
      next += sampleEvery
    }
    if (now === 'TLI_BURN' && rec.injectT === null) {
      const o = orbitNow()
      rec.injectT = live.sim.t
      rec.injectA = o.am
      rec.injectPeri = lastPeri
    }
    if (now === 'TRANS_LUNAR' || now === 'LOST') {
      rec.end = now
      rec.endT = live.sim.t
      break
    }
  }
  return rec
}

const km = (m) => (m / 1e3).toFixed(2)
const hours = (s) => (s / H).toFixed(2)

/* ---------------------------------------------------------------- *
 * 1. Left alone
 * ---------------------------------------------------------------- */

/**
 * Whichever pad is currently waiting longer than its orbit will last.
 *
 * It used to be Vandenberg, named outright. It is Baikonur now, and nothing
 * about the loiter changed — correcting Earth's obliquity and anchoring the
 * prime meridian moved every pad relative to the Moon, so each one waits a
 * different length of time for its window. A gate that names the site is
 * testing the geometry of the day it was written; what it should test is that
 * the mechanism finds the pad that needs it, whichever that is.
 */
/**
 * The launch hour each shortfall is selected by, and why the hour is a selector
 * rather than a detail.
 *
 * The wait cycles with the Moon over a synodic month and the orbit's life does
 * not, so which launch windows fall inside the orbit's remaining life is a
 * function of the hour. Since the planner plans on *mean* elements the nominal
 * hour on no pad falls short any more — with the J2 short-period term taken out,
 * the four pads' parking orbits last 192, 246, 278 and 406 hours against waits of
 * 119, 146, 66 and 326, and every one of them outlasts its window. The shortfall
 * is still real; it is not at hour zero. To find these hours again, sweep the
 * launch hour and watch `mission.tli.loiter.needed` against `.lifetime` and
 * `.wait` at commitment.
 */
const SHORTFALL_HOUR = 144

PROFILE.loiterRaise = false
let decayed = null
let decaySite = null
for (const [id, hour] of [['vandenberg', SHORTFALL_HOUR]]) {
  const run = toInjection(id, 25 * H, hour)
  if (run.plan.needed && run.plan.lifetime < run.plan.wait) {
    decayed = run
    decaySite = id
    break
  }
}
PROFILE.loiterRaise = true
if (!decayed) throw new Error('no pad is waiting longer than its orbit lasts')

const lostAfter = decayed.endT - decayed.commit
const lifeError = (decayed.plan.lifetime - lostAfter) / lostAfter
console.log(`=== 1. ${LAUNCH_SITES[decaySite].name} at +${SHORTFALL_HOUR} h, raise disabled: the orbit against the theory ===`)
console.log(`  committed at ${km(decayed.orbit.a - R)} km mean (${km(decayed.osc - R)} km osculating), e ${decayed.osc_e.toFixed(5)} osculating (${decayed.orbit.em.toFixed(5)} mean); window forecast ${hours(decayed.plan.wait)} h, lifetime ${hours(decayed.plan.lifetime)} h`)
console.log('    flown h   semi-major alt km   theory h to there   error')
let worstSample = 0
for (const [t, a] of decayed.samples) {
  const predicted = decayTime(decayed.orbit.a, decayed.orbit.e, a, decayed.dragK, decayed.orbit.cosI)
  const err = (predicted - t) / t
  worstSample = Math.max(worstSample, Math.abs(err))
  console.log(`    ${hours(t).padStart(7)}   ${km(a - R).padStart(12)}        ${hours(predicted).padStart(10)}      ${(err * 100).toFixed(2).padStart(5)}%`)
}
console.log(`  ${decayed.end} after ${hours(lostAfter)} h; theory said ${hours(decayed.plan.lifetime)} h (${(lifeError * 100).toFixed(2)}%)`)

/* ---------------------------------------------------------------- *
 * 2 and 3. With the flight computer deciding
 * ---------------------------------------------------------------- */

const SITES = ['ksc', 'kourou', 'baikonur', 'vandenberg']
const flown = SITES.map((site) => toInjection(site))

console.log('\n=== 2-3. every pad at its nominal hour, raise enabled ===')
console.log('  pad                 forecast h   injected h   late by   orbit h   lifetime h   raised   dv m/s')
for (const f of flown) {
  const period = 2 * Math.PI * Math.sqrt(f.orbit.a ** 3 / MU)
  f.period = period
  f.late = f.injectT === null ? NaN : f.injectT - f.commit - f.plan.wait
  console.log(`  ${LAUNCH_SITES[f.site].name.padEnd(18)}  ${hours(f.plan.wait).padStart(9)}   ${f.injectT === null ? '     —' : hours(f.injectT - f.commit).padStart(10)}   ${hours(f.late).padStart(7)}   ${hours(period).padStart(7)}   ${hours(f.plan.lifetime).padStart(10)}   ${String(f.plan.raised).padEnd(6)}   ${(f.plan.dv1 + f.plan.dv2).toFixed(2)}`)
}

/**
 * And the launch the mechanism is actually for: Vandenberg at the hour its orbit
 * cannot outlast the wait, raise enabled.
 *
 * These used to be one list. They are two now because the planner plans on mean
 * elements and the pads' orbits are longer-lived than the osculating readout ever
 * said, so no pad at its nominal hour plans anything — which is the correct
 * behaviour and is asserted as such below, but it left this section with nothing
 * to test. The four nominal flights are `kept`; the raise is `vb`.
 */
const vb = toInjection(decaySite, 0, SHORTFALL_HOUR)
vb.period = 2 * Math.PI * Math.sqrt(vb.orbit.a ** 3 / MU)
vb.late = vb.injectT === null ? NaN : vb.injectT - vb.commit - vb.plan.wait
const kept = flown
const arriveError = vb.injectA - vb.plan.arrive
console.log(`\n  ${LAUNCH_SITES[vb.site].name} at +${SHORTFALL_HOUR} h: committed at ${km(vb.orbit.a - R)} km mean, loiter orbit ${km(vb.plan.target - R)} km,` +
  ` back down to ${km(vb.injectA - R)} km at ignition (aimed for ${km(vb.plan.arrive - R)}, ${arriveError >= 0 ? '+' : ''}${km(arriveError)} km)`)
console.log(`  raise: ${vb.plan.dv1.toFixed(2)} + ${vb.plan.dv2.toFixed(2)} m/s, ${vb.nodePhases} node phases flown`)

/* ---------------------------------------------------------------- *
 * 4. The whole mission
 * ---------------------------------------------------------------- */

freshFlight('vandenberg')
const reached = []
let atLunarOrbit = NaN
flyMission('SPLASHDOWN', {
  onPhase: (to) => {
    reached.push(to)
    if (to === 'LUNAR_ORBIT') atLunarOrbit = deltaV()
  },
  maxFrames: 5_000_000,
})
const whole = currentPhase().id
console.log(`\n=== 4. Vandenberg, pad to splashdown ===`)
console.log(`  ended in ${whole} at MET ${hours(mission.t)} h; ${atLunarOrbit.toFixed(0)} m/s in hand in lunar orbit`)

/* ---------------------------------------------------------------- *
 * 5. A window already open at commitment
 * ---------------------------------------------------------------- */

/**
 * Two Vandenberg launches that commit with the Moon's arrival point already
 * inside tolerance. At +374.1 h it is on its way out and the craft does not come
 * round before it goes: the first forecast said "now", planned no raise, and the
 * vehicle was lost waiting half a month for the next window. At +150.5 h the
 * pass is caught, and the forecast has to say when.
 */
/*
 * These hours were re-located after Earth's obliquity was corrected and the
 * prime meridian anchored, which moved every pad relative to the Moon and with
 * it every window. They are scenario selectors, not results: +119.4 h commits
 * with the arrival point 0.01 degrees out and the pass already going, +119.6 h
 * commits 0.08 degrees out and catches one. To find them again, sweep the
 * launch hour and watch `mission.tli.outOfPlane` at commitment against
 * PROFILE.phaseTolerance.
 */
const closing = toInjection('vandenberg', 0, 119.66)
const caught = toInjection('vandenberg', 0, 119.68)
for (const f of [closing, caught]) {
  f.period = 2 * Math.PI * Math.sqrt(f.orbit.a ** 3 / MU)
  f.late = f.injectT === null ? NaN : f.injectT - f.commit - f.plan.wait
}
console.log('\n=== 5. a window already open at commitment ===')
for (const [label, f] of [['closing', closing], ['caught', caught]]) {
  console.log(`  ${label.padEnd(8)} arrival point ${((f.outAtCommit * 180) / Math.PI).toFixed(3)} deg out of plane;` +
    ` forecast ${hours(f.plan.wait)} h, injected ${f.injectT === null ? '-' : hours(f.injectT - f.commit)} h (${f.late.toFixed(0)} s after), raised ${f.plan.raised}, ${f.end}`)
}

/* ---------------------------------------------------------------- *
 * 6. The pilot changes the orbit during the wait
 * ---------------------------------------------------------------- */

/** Pad to commitment, then on to injection with `onFrame` run before every frame. */
function withPilot(site, onFrame, launchHour = 0) {
  freshFlight(site)
  resetMission()
  /*
   * Held on the pad to the launch hour, the same way `toInjection` does it and
   * for the same reason: the pilot's scenarios are selected by the geometry of
   * the wait, and at the nominal hour there is no raise to perturb.
   */
  const target = launchHour * H
  flight.pilotWarp = WARP.d1
  for (let i = 0; live.sim.t < target - H && i < 1_000_000; i++) frame()
  flight.pilotWarp = WARP.m1
  for (let i = 0; live.sim.t < target && i < 1_000_000; i++) frame()
  beginCountdown()
  for (let i = 0; i < 3_000_000 && currentPhase().id !== 'COAST'; i++) {
    flight.pilotWarp = mission.warpRequest !== null ? null : WARP.m1
    frame()
  }
  commitTLI()
  const commit = live.sim.t
  let burns = 0
  let last = currentPhase().id
  for (let i = 0; i < 3_000_000; i++) {
    onFrame(commit)
    flight.pilotWarp = mission.warpRequest !== null ? null : WARP.m1
    frame()
    const id = currentPhase().id
    if (id !== last && id === 'NODE_BURN') burns++
    last = id
    if (id === 'TRANS_LUNAR' || id === 'LOST') break
  }
  return { burns, end: currentPhase().id }
}

/**
 * A 25 m/s retrograde trim six hours into the wait, after the raise has flown.
 * It takes the orbit to roughly 110 x 194 km, and the raise first built for a
 * near-circle then burned from the wrong point: the vehicle replanned correctly
 * and was lost at MET 181.7 h anyway. Burns now sit at the apsides.
 */
let trim = null
let afterTrim = null
const trimmed = withPilot(vb.site, (commit) => {
  if (!trim && live.sim.t > commit + 6 * H) trim = addNode(live.sim.t + 600, { prograde: -25 })
  if (trim?.executed && !afterTrim && currentPhase().id === 'TLI_ALIGN') afterTrim = { ...mission.tli.loiter }
}, SHORTFALL_HOUR)

/**
 * Thrust by hand straight after commitment, before the raise has flown, until
 * 15 m/s has gone. The flight computer does not burn in TLI_ALIGN, so any thrust
 * there is the pilot's; once it stops, the plan is remade from the new orbit.
 */
let hand = 'up'
let handStart = 0
let handDv = 0
let afterHand = null
const byHand = withPilot(vb.site, () => {
  if (hand === 'up') {
    if (handStart === 0) handStart = deltaV()
    input.throttleUp = true
    if (handStart - deltaV() >= 15) {
      input.throttleUp = false
      hand = 'down'
    }
  } else if (hand === 'down') {
    input.throttleDown = true
    if (ship.throttle <= 0) {
      input.throttleDown = false
      hand = 'off'
    }
  } else if (hand === 'off' && ship.thrust === 0 && mission.tli.loiter.replans > 0) {
    handDv = handStart - deltaV()
    afterHand = { ...mission.tli.loiter }
    hand = 'done'
  }
}, SHORTFALL_HOUR)

console.log('\n=== 6. the pilot changes the orbit during the wait ===')
if (afterTrim) {
  console.log(`  25 m/s retrograde after the raise: ${hours(afterTrim.lifetime)} h of life against ${hours(afterTrim.wait)} h to the window;` +
    ` replanned a ${(afterTrim.dv1 + afterTrim.dv2).toFixed(2)} m/s raise in ${afterTrim.node2 >= 0 ? 2 : 1} burn(s); ${trimmed.burns} burns flown in all; ${trimmed.end}`)
} else console.log('  the trim never handed back')
if (afterHand) {
  console.log(`  ${handDv.toFixed(1)} m/s by hand before the raise flew: ${hours(afterHand.lifetime)} h of life, raise ${afterHand.raised ? 'kept' : 'withdrawn'};` +
    ` ${byHand.burns} burns flown; ${byHand.end}`)
} else console.log('  the hand burn was never replanned')

/* ---------------------------------------------------------------- *
 * 7. Eccentric orbits
 * ---------------------------------------------------------------- */

/**
 * A parking orbit is nearly circular, but a pilot can commit from anything, and
 * an eccentric orbit meets nearly all its air at perigee. That is where the first
 * theory — the air as one exponential about the mean altitude — went wrong: 25%
 * long at 150 x 250 km and 280% at 180 x 870 km. Flown here in the integrator
 * alone, with the S-IVB's drag at Vandenberg's insertion mass on a bare coast.
 *
 * Flown twice, in two fields, because on an eccentric orbit the theory's limit is
 * no longer the theory. `rates` is a function of (a, e, dragK, cos i) and carries
 * no argument of perigee, so it cannot carry **J3**, whose long-period term forces
 * an eccentricity that turns with perigee:
 *
 *   e_J3 = J3 R sin i / (2 J2 p)
 *
 * — 5.7e-4 at 30 degrees, which is 3.7 km of perigee, on an orbit meeting its air
 * at 150 km where the scale height is 16. With the odd zonal lifted the same
 * theory, unchanged, reads 0.10% on a near-circle and 1.39% at e = 0.0064 where
 * the full field gives 1.11% and 7.75%. So the tight check is made in the field
 * the theory is a theory of, and what J3 adds is measured beside it rather than
 * absorbed into a tolerance.
 *
 * @param {number|null} oddZonal null lifts J3, leaving J2 and J4.
 */
/** The S-IVB's drag at Vandenberg's insertion mass. */
const ECCENTRIC_DRAG = (0.5 * 2.2 * 30) / 95_100

/** Put the craft on a peri x apo orbit tilted 30 degrees to the spin axis. */
function placeEccentric(periKm, apoKm, dragK) {
  const u = [-SPIN_AXIS[1], SPIN_AXIS[0], 0]
  const un = Math.hypot(u[0], u[1], u[2])
  u[0] /= un
  u[1] /= un
  const w = [SPIN_AXIS[1] * u[2] - SPIN_AXIS[2] * u[1], SPIN_AXIS[2] * u[0] - SPIN_AXIS[0] * u[2], SPIN_AXIS[0] * u[1] - SPIN_AXIS[1] * u[0]]
  const tilt = Math.PI / 6
  const normal = [0, 1, 2].map((k) => Math.cos(tilt) * SPIN_AXIS[k] + Math.sin(tilt) * w[k])
  const q = [normal[1] * u[2] - normal[2] * u[1], normal[2] * u[0] - normal[0] * u[2], normal[0] * u[1] - normal[1] * u[0]]
  const rp = R + periKm * 1e3
  const a0 = R + 0.5 * (periKm + apoKm) * 1e3
  const vp = Math.sqrt(MU * (2 / rp - 1 / a0))
  const s = live.sim.state
  for (let k = 0; k < 3; k++) {
    s[C + k] = s[E + k] + rp * u[k]
    s[C + 3 + k] = s[E + 3 + k] + vp * q[k]
  }
  live.sim.dragK[0] = dragK
  refreshDerived()
}

function eccentricDecay(periKm, apoKm, flyHours, oddZonal) {
  resetSimulation()
  refreshDerived()
  if (oddZonal === null) live.sim.zonal = { ...live.sim.zonal, J: [ZONAL[0], 0, ZONAL[2]] }
  const K = ECCENTRIC_DRAG
  placeEccentric(periKm, apoKm, K)
  /**
   * Mean elements on both sides, for the reason `orbitNow` gives: at these
   * perigees the J2 short-period term on the semi-major axis is several
   * kilometres, so a comparison of flown *osculating* altitude against a theory
   * written about the mean orbit is a comparison of an oscillation with its own
   * average. It read as a 60% error on the 150 x 250 km case and 1,191% on the
   * 180 x 870 km one, both of which are the swing rather than the physics.
   *
   * The eccentricity is the mean one too, and that is the same argument a second
   * time: J3 aside, the osculating value carries a J2 short-period term as big as
   * itself, and feeding it to a mean-element theory read as 22% and 26% here.
   */
  const start = orbitNow()
  let t = 0
  let next = 50 * H
  let worst = 0
  let drift = 0
  let down = null
  while (t < flyHours * H) {
    live.sim.advance(600, live.maxDt)
    refreshDerived()
    t += 600
    const now = orbitNow()
    const reached = now.am - R < DECAY_FLOOR
    if (t >= next || reached) {
      const predicted = decayTime(start.am, start.em, now.am, K, start.cosI)
      worst = Math.max(worst, Math.abs((predicted - t) / t))
      // And the same comparison the other way round: where the theory says the
      // orbit is at this moment, against where it is.
      decayAfter(start.am, start.em, t, K, start.cosI)
      drift = Math.max(drift, Math.abs(decayState[0] - now.am))
      next += 50 * H
    }
    if (reached) {
      down = t
      break
    }
  }
  return { periKm, apoKm, e: start.e, em: start.em, cosI: start.cosI, am: start.am, worst, drift, down, flown: t }
}

/**
 * And the term itself, measured rather than inferred from the residual: how far
 * the mean eccentricity of an undisturbed orbit wanders over one turn of perigee,
 * with the odd zonal in the field and with it lifted.
 */
function eccentricitySwing(periKm, apoKm, days, oddZonal) {
  resetSimulation()
  refreshDerived()
  if (oddZonal === null) live.sim.zonal = { ...live.sim.zonal, J: [ZONAL[0], 0, ZONAL[2]] }
  placeEccentric(periKm, apoKm, 0)
  let lo = Infinity
  let hi = -Infinity
  for (let t = 0; t < days * 24 * H; t += 1800) {
    live.sim.advance(1800, 60)
    const e = orbitNow().em
    lo = Math.min(lo, e)
    hi = Math.max(hi, e)
  }
  return (hi - lo) / 2
}

const eccentric = [
  eccentricDecay(150, 250, 600, null),
  eccentricDecay(180, 870, 500, null),
]
const withOdd = [eccentricDecay(150, 250, 600, ZONAL[1]), eccentricDecay(180, 870, 500, ZONAL[1])]
const eccWorst = Math.max(...eccentric.map((r) => r.worst))
/*
 * The orbit that comes down is checked on the clock; the one that does not is
 * checked on the altitude it is tracked to, because 500 h of a 180 x 870 km orbit
 * is 4.4 km of decay and a per cent of that clock is 40 m of altitude. Quoting a
 * time error there says more about how little the orbit moves than about the
 * theory.
 */

const swingWith = eccentricitySwing(150, 250, 30, ZONAL[1])
const swingWithout = eccentricitySwing(150, 250, 30, null)
const sinI = Math.sqrt(Math.max(0, 1 - eccentric[0].cosI ** 2))
const forcedJ3 =
  Math.abs(ZONAL[1] * REFERENCE_RADIUS * sinI) /
  (2 * ZONAL[0] * eccentric[0].am * (1 - eccentric[0].em ** 2))

console.log('\n=== 7. eccentric orbits, the integrator against the theory ===')
for (let i = 0; i < eccentric.length; i++) {
  const r = eccentric[i]
  const o = withOdd[i]
  console.log(
    `  ${r.periKm} x ${r.apoKm} km (e ${r.em.toFixed(4)} mean): J2+J4 ${r.down ? `down at ${hours(r.down)} h` : `flown ${hours(r.flown)} h`},` +
      ` worst ${(r.worst * 100).toFixed(2)}% and ${(r.drift / 1e3).toFixed(3)} km of axis; with J3 ${(o.worst * 100).toFixed(2)}%`,
  )
}
console.log(
  `  the odd zonal itself: e wanders +-${swingWith.toExponential(3)} over 30 days against +-${swingWithout.toExponential(3)} without it;` +
    ` J3 R sin i / 2 J2 p predicts ${forcedJ3.toExponential(3)}, which is ${((forcedJ3 * eccentric[0].am) / 1e3).toFixed(2)} km of perigee`,
)

/* ---------------------------------------------------------------- *
 * 8. The injection floor
 * ---------------------------------------------------------------- */

const FLOOR = R + PROFILE.injectionFloor

/** Perigee at ignition, as the theory has it from the orbit at commitment, against flight. */
const periError = (f) => {
  decayAfter(f.orbit.a, f.orbit.e, f.injectT - f.commit, f.dragK, f.orbit.cosI)
  return decayState[0] * (1 - decayState[1]) - f.injectPeri
}

/**
 * And what bounds that error, per pad: the perigee J3 forces and the theory
 * cannot carry. `mission.js` keeps the floor above the same quantity, so this
 * checks the bound the flight computer is relying on rather than a number chosen
 * to fit four flights. It is a different number at each pad and at each launch
 * hour, being the part of the forced eccentricity that *turns* inside that wait:
 * 1.55, 1.06, 4.27 and 2.22 km here, against errors of 0.93, 0.10, 2.92 and 1.85.
 */
const perigeeBound = (f) =>
  perigeeMargin(f.orbit.a, f.orbit.e, f.orbit.cosI, f.injectT - f.commit)

/**
 * A raise for height as well as life: a launch that lasts its wait, so the
 * lifetime rule alone plans nothing, but would reach the window with its perigee
 * under the floor. The floor makes that a raise, the least one that clears it.
 *
 * Kennedy at +96 h, found by the same sweep the shortfall hour came from: the
 * wait is 214.9 h against the 235.9 h its orbit has, so the lifetime rule plans
 * nothing, and 215 h of drag out of that orbit arrives at 133.6 km — six and a
 * half kilometres under a hard floor of 140. Its predecessors were Kourou at
 * +623.5 h, Vandenberg at +104 h and Vandenberg at +288 h; each moved when the
 * physics under it did, most recently when `decay.js` began reading its air at
 * the craft's own radius and every pad's orbit turned out to last longer than
 * the theory had been saying. To find it again, sweep the launch hour and watch
 * `mission.tli.loiter.reason` for 'floor' with `.lifetime` above `.wait`.
 */
const low = toInjection('ksc', 0, 96)

/**
 * And a floor that holds. Vandenberg at +150.5 h commits inside a window whose
 * pass comes minutes later; here 15 m/s is first taken off its velocity — a trim
 * before commitment — which drops perigee under the floor on the far side. The
 * raise that fixes it is at apogee, an orbit away, so ignition has to let this
 * window go.
 */
function heldFlight() {
  /*
   * +119.68 h: a window 1.44 h out, which is less than one revolution, so a
   * raise planned at commitment cannot fly both its burns before the craft has
   * to inject. The -15 m/s below is what makes the raise necessary in the first
   * place.
   */
  freshFlight('vandenberg')
  resetMission()
  flight.pilotWarp = WARP.d1
  const heldTarget = 119.68 * H
  for (let i = 0; live.sim.t < heldTarget - H && i < 1_000_000; i++) frame()
  flight.pilotWarp = WARP.m1
  for (let i = 0; live.sim.t < heldTarget && i < 1_000_000; i++) frame()
  beginCountdown()
  for (let i = 0; i < 3_000_000 && currentPhase().id !== 'COAST'; i++) {
    flight.pilotWarp = mission.warpRequest !== null ? null : WARP.m1
    frame()
  }
  const s = live.sim.state
  const vx = s[C + 3] - s[E + 3]
  const vy = s[C + 4] - s[E + 4]
  const vz = s[C + 5] - s[E + 5]
  const v = Math.hypot(vx, vy, vz)
  s[C + 3] -= (15 * vx) / v
  s[C + 4] -= (15 * vy) / v
  s[C + 5] -= (15 * vz) / v
  refreshDerived()
  commitTLI()
  const plan = { ...mission.tli.loiter }
  const commit = live.sim.t
  let heldAt = null
  let lastPeri = live.elements.periapsisRadius
  let injectPeri = null
  let burns = 0
  let last = currentPhase().id
  for (let i = 0; i < 3_000_000; i++) {
    flight.pilotWarp = mission.warpRequest !== null ? null : WARP.m1
    frame()
    const id = currentPhase().id
    if (id !== last && id === 'NODE_BURN') burns++
    last = id
    if (id === 'TLI_ALIGN') {
      lastPeri = live.elements.periapsisRadius
      if (heldAt === null && mission.tli.alignment <= PROFILE.phaseTolerance && lastPeri < FLOOR) heldAt = live.sim.t - commit
    }
    if (id === 'TLI_BURN' && injectPeri === null) injectPeri = lastPeri
    if (id === 'TRANS_LUNAR' || id === 'LOST') break
  }
  return { plan, heldAt, injectPeri, burns, end: currentPhase().id, injectedAfter: live.sim.t - commit }
}
const held = heldFlight()

console.log('\n=== 8. the injection floor ===')
for (const f of kept) console.log(`  ${LAUNCH_SITES[f.site].name.padEnd(18)} perigee at ignition ${km(f.injectPeri - R)} km, theory ${km(f.injectPeri + periError(f) - R)} km, error ${km(periError(f))} against a bound of ${km(perigeeBound(f))} km`)
console.log(`  ${LAUNCH_SITES[low.site].name} +96 h: forecast ${hours(low.plan.wait)} h, lifetime ${hours(low.plan.lifetime)} h, perigee at ignition unraised ${km(low.plan.periapsisAtIgnition - R)} km;` +
  ` raised for ${low.plan.reason} with ${(low.plan.dv1 + low.plan.dv2).toFixed(2)} m/s in ${low.plan.node2 >= 0 ? 2 : 1} burn(s); injected from ${km(low.injectPeri - R)} km; ${low.end}`)
console.log(`  Vandenberg +150.5 h trimmed: raised for ${held.plan.reason}, forecast ${hours(held.plan.wait)} h;` +
  ` ${held.heldAt === null ? 'never held' : `held a window at ${hours(held.heldAt)} h`}; ${held.burns} burns; injected from ${held.injectPeri === null ? '-' : km(held.injectPeri - R)} km after ${hours(held.injectedAfter)} h; ${held.end}`)

/* ---------------------------------------------------------------- *
 * What this establishes
 * ---------------------------------------------------------------- */

console.log('\n=== what this establishes ===')
const checks = [
  [`left alone, ${LAUNCH_SITES[decaySite].name}'s parking orbit decays into the planet`,
   decayed.end === 'LOST'],
  ['and the forecast saw it: a lifetime shorter than the wait', decayed.plan.needed && decayed.plan.lifetime < decayed.plan.wait],
  /**
   * The decision discounts every lifetime by `lifetimeTolerance`. That is only
   * safe while the theory really is that good, so the tolerance is checked
   * here against a flight rather than trusted: measured 0.03% at the end of
   * the decay and 1.05% at worst along it.
   */
  ["the theory puts the orbit's end within the tolerance the decision allows", Math.abs(lifeError) < PROFILE.lifetimeTolerance],
  ['and every flown point of the decay along the way', decayed.samples.length >= 8 && worstSample < PROFILE.lifetimeTolerance],
  ['with the flight computer deciding, every pad injects', flown.every((f) => f.end === 'TRANS_LUNAR')],
  /**
   * The forecast is of the *plane* window. Ignition also needs the craft at
   * the right point of its own orbit, which comes round once a revolution — so
   * the injection is late by up to one parking orbit.
   *
   * Early by up to one march step, and not a second, because that is the
   * forecast's own resolution: it carries the plane forward through half-hour
   * samples and interpolates the crossing between two of them. Measured at
   * worst 468 s, a quarter of a step, since the plane stopped being held still.
   * The minute this used to allow was satisfiable only by accident, while a
   * frozen plane happened to put the forecast's error on the late side.
   */
  ['each injection lands within a march step of its window, and inside one parking orbit after it',
    flown.every((f) => f.late >= -WINDOW_STEP && f.late <= f.period)],
  /*
   * Two claims, because at the nominal hour three pads plan nothing and one
   * plans 0.06 m/s. Kourou's is not a spurious raise: its orbit outlasts its
   * wait comfortably and arrives at the window 0.46 km above a hard 140 km
   * floor, inside the margin `mission.js` derives from J3 — so the floor rule
   * firing there is the mechanism working, and what this section has to assert
   * is that the *lifetime* rule does not fire on an orbit that lasts, and that
   * a pad which plans nothing then flies nothing.
   */
  ['no pad whose orbit outlasts its wait plans a raise for life',
    kept.every((f) => f.plan.reason !== 'lifetime')],
  ['and a pad that plans nothing flies nothing extra',
    kept.filter((f) => !f.plan.needed).length >= 3 &&
      kept.filter((f) => !f.plan.needed).every((f) => !f.plan.raised && f.nodePhases === 0)],
  [`${LAUNCH_SITES[vb.site].name} plans a raise and flies both burns`,
   vb.plan.raised && vb.nodePhases === 4],
  ['for under 1% of what is left in its tanks', vb.plan.dv1 + vb.plan.dv2 < 0.01 * 5208],
  ['and injects back down in the orbit it committed from, to 2 km', Math.abs(arriveError) < 2000],
  ['Vandenberg flies the whole mission, pad to splashdown', whole === 'SPLASHDOWN' && reached.includes('LUNAR_ORBIT')],
  ['a window open at commitment but closing before the craft comes round is not counted on',
    Math.abs(closing.outAtCommit) <= PROFILE.phaseTolerance && closing.plan.wait > 100 * H],
  ['so that launch raises for the next window and injects, where it was lost',
    closing.plan.raised && closing.end === 'TRANS_LUNAR' && closing.late >= -60 && closing.late <= closing.period],
  /*
   * An unterminated block comment opened on the line above this pair and was
   * closed by the one below it, which is valid JavaScript and deleted both of
   * them: the array went on holding twenty entries, the label of the first was
   * printed against the expression of the last, and the gate reported PASS for a
   * check it was no longer making. Nothing warns about that, so it is written
   * down here.
   */
  ['a window open at commitment that will be caught is forecast to the pass, to a minute',
    /*
     * The wait is allowed up to two hours rather than the sub-hour this used to
     * assert. The craft commits at a discrete point in its coast, so the wait
     * quantises; with the pads where they now are the shortest catchable wait at
     * Vandenberg is 1.44 h and no launch hour produces less. What the check is
     * for is unchanged and is the second clause: that the forecast names the
     * injection to within a minute of when it happens.
     */
    Math.abs(caught.outAtCommit) <= PROFILE.phaseTolerance && caught.plan.wait < 2 * H && Math.abs(caught.late) < 60 && caught.end === 'TRANS_LUNAR'],
  ['a trim that leaves the orbit short of its window is planned around',
    afterTrim !== null && afterTrim.replans === 1 && afterTrim.lifetime < afterTrim.wait && afterTrim.raised],
  ['and the trimmed vehicle still injects', trimmed.end === 'TRANS_LUNAR'],
  ['thrust by hand that makes the raise unnecessary withdraws it before it flies',
    afterHand !== null && afterHand.replans === 1 && !afterHand.raised && byHand.burns === 0 && byHand.end === 'TRANS_LUNAR'],
  /*
   * In the field the theory is a theory of: J2 and J4, no odd zonal. Same
   * tolerance as the parking orbits, on an orbit that actually comes down.
   */
  ['the decay theory holds on eccentric orbits, to the same tolerance',
    eccentric[0].down !== null && eccentric[0].worst < PROFILE.lifetimeTolerance],
  /*
   * The 180 x 870 km orbit loses 4.4 km of axis in 500 hours, so a per cent of
   * its clock is 40 m of altitude and a time error there is mostly a statement
   * about how little it moves. It is held on the altitude instead: 500 hours of
   * march, half a kilometre.
   */
  ['and tracks an orbit that barely decays at all to half a kilometre over 500 h',
    eccentric[1].drift < 500],
  /*
   * And the term that decides how much looser the full field is. Both halves are
   * asserted: that J3 moves the eccentricity by what the closed form says, and
   * that lifting it is what takes the theory back inside its tolerance. If a
   * future change makes the second true without the first, the explanation has
   * stopped being the explanation.
   */
  ['J3 forces the eccentricity by what J3 R sin i / 2 J2 p says, to a fifth',
    Math.abs(swingWith / forcedJ3 - 1) < 0.2 && swingWithout < swingWith / 4],
  ['and it is what puts the eccentric cases outside it, not the drag theory',
    withOdd.every((r, i) => r.worst > eccentric[i].worst) &&
      withOdd[0].worst > PROFILE.lifetimeTolerance],
  /*
   * Perigee at ignition, against the perigee J3 forces and `rates` cannot carry
   * — the same bound `mission.js` keeps the floor above, printed beside each
   * pad's error in section 8. A flat kilometre stood here until the two errors
   * that were cancelling under it were found.
   */
  ['perigee at ignition is predicted to within the perigee J3 forces',
    kept.every((f) => Math.abs(periError(f)) < perigeeBound(f))],
  ['an orbit that lasts its wait but would inject under the floor is raised for height',
    low.plan.reason === 'floor' && low.plan.raised && low.plan.periapsisAtIgnition < FLOOR && low.plan.lifetime > low.plan.wait],
  /**
   * Within 5 km of the floor, so the raise is the least one and not merely a
   * sufficient one: sized as if it left a circle, the Baikonur raise this
   * section first flew arrived at 152 km.
   */
  ['and injects just above the floor, for a few metres a second',
    low.end === 'TRANS_LUNAR' && low.injectPeri >= FLOOR &&
      low.injectPeri < FLOOR + perigeeBound(low) + 5e3 && low.plan.dv1 + low.plan.dv2 < 5],
  ['a raise that cannot fly before the window holds ignition rather than inject low',
    held.plan.needed && held.heldAt !== null && held.injectPeri !== null && held.injectPeri >= FLOOR && held.end === 'TRANS_LUNAR'],
]
let pass = true
for (const [label, ok] of checks) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`)
  if (!ok) pass = false
}
console.log(`\n  ${pass ? 'PASS' : 'FAIL'}`)
process.exit(pass ? 0 : 1)
