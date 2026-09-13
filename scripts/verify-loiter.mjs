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
 *
 *   node scripts/verify-loiter.mjs
 */

import { flight, flyMission, frame } from './flight.mjs'
import { live, refreshDerived, resetSimulation } from '../src/sim/live.js'
import { PROFILE, beginCountdown, commitTLI, currentPhase, mission, resetMission } from '../src/sim/mission.js'
import { clearNodes } from '../src/sim/nodes.js'
import { decayTime } from '../src/sim/decay.js'
import { deltaV } from '../src/sim/ship.js'
import { BODIES, G } from '../src/sim/constants.js'
import { SPIN_AXIS } from '../src/sim/atmosphere.js'
import { INDEX } from '../src/sim/system.js'
import { WARP } from '../src/sim/warp.js'
import { LAUNCH_SITES, selectSite } from '../src/sim/launchsite.js'

const MU = G * BODIES.earth.mass
const R = BODIES.earth.radius
const H = 3600
const C = INDEX.ship * 6
const E = INDEX.earth * 6

/** Osculating semi-major axis, eccentricity, and cos i against the spin axis, from the state itself. */
function orbitNow() {
  const s = live.sim.state
  const rx = s[C] - s[E]
  const ry = s[C + 1] - s[E + 1]
  const rz = s[C + 2] - s[E + 2]
  const vx = s[C + 3] - s[E + 3]
  const vy = s[C + 4] - s[E + 4]
  const vz = s[C + 5] - s[E + 5]
  const a = 1 / (2 / Math.hypot(rx, ry, rz) - (vx * vx + vy * vy + vz * vz) / MU)
  const hx = ry * vz - rz * vy
  const hy = rz * vx - rx * vz
  const hz = rx * vy - ry * vx
  const h = Math.hypot(hx, hy, hz)
  return {
    a,
    e: Math.sqrt(Math.max(0, 1 - (h * h) / (MU * a))),
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
function toInjection(site, sampleEvery = 0) {
  freshFlight(site)
  resetMission()
  beginCountdown()
  const rec = { site, commit: 0, orbit: null, dragK: 0, plan: null, samples: [], nodePhases: 0, injectT: null, injectA: 0, end: '', endT: 0 }
  let committed = false
  let next = Infinity
  for (let i = 0; i < 3_000_000; i++) {
    const id = currentPhase().id
    if (!committed && id === 'COAST' && commitTLI()) {
      committed = true
      rec.commit = live.sim.t
      rec.orbit = orbitNow()
      rec.dragK = live.sim.dragK[0]
      rec.plan = { ...mission.tli.loiter }
      next = rec.commit + sampleEvery
    }
    flight.pilotWarp = mission.warpRequest !== null ? null : WARP.m1
    frame()
    const now = currentPhase().id
    if (now !== id && now.startsWith('NODE_')) rec.nodePhases++
    if (sampleEvery && now === 'TLI_ALIGN' && live.sim.t >= next) {
      rec.samples.push([live.sim.t - rec.commit, orbitNow().a])
      next += sampleEvery
    }
    if (now === 'TLI_BURN' && rec.injectT === null) {
      rec.injectT = live.sim.t
      rec.injectA = orbitNow().a
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

PROFILE.loiterRaise = false
const decayed = toInjection('vandenberg', 25 * H)
PROFILE.loiterRaise = true

const lostAfter = decayed.endT - decayed.commit
const lifeError = (decayed.plan.lifetime - lostAfter) / lostAfter
console.log('=== 1. Vandenberg, raise disabled: the orbit against the theory ===')
console.log(`  committed at ${km(decayed.orbit.a - R)} km, e ${decayed.orbit.e.toFixed(5)}; window forecast ${hours(decayed.plan.wait)} h, lifetime ${hours(decayed.plan.lifetime)} h`)
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

console.log('\n=== 2-3. every pad, raise enabled ===')
console.log('  pad                 forecast h   injected h   late by   orbit h   lifetime h   raised   dv m/s')
for (const f of flown) {
  const period = 2 * Math.PI * Math.sqrt(f.orbit.a ** 3 / MU)
  f.period = period
  f.late = f.injectT === null ? NaN : f.injectT - f.commit - f.plan.wait
  console.log(`  ${LAUNCH_SITES[f.site].name.padEnd(18)}  ${hours(f.plan.wait).padStart(9)}   ${f.injectT === null ? '     —' : hours(f.injectT - f.commit).padStart(10)}   ${hours(f.late).padStart(7)}   ${hours(period).padStart(7)}   ${hours(f.plan.lifetime).padStart(10)}   ${String(f.plan.raised).padEnd(6)}   ${(f.plan.dv1 + f.plan.dv2).toFixed(2)}`)
}
const vb = flown.find((f) => f.site === 'vandenberg')
const kept = flown.filter((f) => f.site !== 'vandenberg')
const arriveError = vb.injectA - vb.plan.arrive
console.log(`\n  Vandenberg: committed at ${km(vb.orbit.a - R)} km, loiter orbit ${km(vb.plan.target - R)} km,` +
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
 * What this establishes
 * ---------------------------------------------------------------- */

console.log('\n=== what this establishes ===')
const checks = [
  ["left alone, Vandenberg's parking orbit decays into the planet", decayed.end === 'LOST'],
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
   * the right point of its own orbit, which comes round once a revolution —
   * so the injection is late by up to one parking orbit and never early.
   */
  ['each injection comes after the forecast window, by less than one parking orbit', flown.every((f) => f.late >= 0 && f.late <= f.period)],
  ['pads whose orbits outlast the wait plan nothing and fly nothing extra', kept.every((f) => !f.plan.needed && !f.plan.raised && f.nodePhases === 0)],
  ['Vandenberg plans a raise and flies both burns', vb.plan.raised && vb.nodePhases === 4],
  ['for under 1% of what is left in its tanks', vb.plan.dv1 + vb.plan.dv2 < 0.01 * 5208],
  ['and injects back down in the orbit it committed from, to 2 km', Math.abs(arriveError) < 2000],
  ['Vandenberg flies the whole mission, pad to splashdown', whole === 'SPLASHDOWN' && reached.includes('LUNAR_ORBIT')],
]
let pass = true
for (const [label, ok] of checks) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`)
  if (!ok) pass = false
}
console.log(`\n  ${pass ? 'PASS' : 'FAIL'}`)
process.exit(pass ? 0 : 1)
