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
import { PROFILE, beginCountdown, commitTLI, currentPhase, mission, resetMission } from '../src/sim/mission.js'
import { addNode, clearNodes } from '../src/sim/nodes.js'
import { DECAY_FLOOR, decayAfter, decayTime, decayed as decayState } from '../src/sim/decay.js'
import { deltaV, input, ship } from '../src/sim/ship.js'
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
function toInjection(site, sampleEvery = 0, launchHour = 0) {
  freshFlight(site)
  resetMission()
  // Hold on the pad until the launch epoch; the clamp is exact and the world turns under it.
  flight.pilotWarp = WARP.d1
  for (let i = 0; live.sim.t < launchHour * H && i < 1_000_000; i++) frame()
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
      rec.orbit = orbitNow()
      rec.dragK = live.sim.dragK[0]
      rec.plan = { ...mission.tli.loiter }
      rec.outAtCommit = mission.tli.outOfPlane
      next = rec.commit + sampleEvery
    }
    flight.pilotWarp = mission.warpRequest !== null ? null : WARP.m1
    frame()
    const now = currentPhase().id
    if (now === 'TLI_ALIGN') lastPeri = live.elements.periapsisRadius
    if (now !== id && now.startsWith('NODE_')) rec.nodePhases++
    if (sampleEvery && now === 'TLI_ALIGN' && live.sim.t >= next) {
      rec.samples.push([live.sim.t - rec.commit, orbitNow().a])
      next += sampleEvery
    }
    if (now === 'TLI_BURN' && rec.injectT === null) {
      rec.injectT = live.sim.t
      rec.injectA = orbitNow().a
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
 * 5. A window already open at commitment
 * ---------------------------------------------------------------- */

/**
 * Two Vandenberg launches that commit with the Moon's arrival point already
 * inside tolerance. At +374.1 h it is on its way out and the craft does not come
 * round before it goes: the first forecast said "now", planned no raise, and the
 * vehicle was lost waiting half a month for the next window. At +150.5 h the
 * pass is caught, and the forecast has to say when.
 */
const closing = toInjection('vandenberg', 0, 374.1)
const caught = toInjection('vandenberg', 0, 150.5)
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
function withPilot(site, onFrame) {
  freshFlight(site)
  resetMission()
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
const trimmed = withPilot('vandenberg', (commit) => {
  if (!trim && live.sim.t > commit + 6 * H) trim = addNode(live.sim.t + 600, { prograde: -25 })
  if (trim?.executed && !afterTrim && currentPhase().id === 'TLI_ALIGN') afterTrim = { ...mission.tli.loiter }
})

/**
 * Thrust by hand straight after commitment, before the raise has flown, until
 * 15 m/s has gone. The flight computer does not burn in TLI_ALIGN, so any thrust
 * there is the pilot's; once it stops, the plan is remade from the new orbit.
 */
let hand = 'up'
let handStart = 0
let handDv = 0
let afterHand = null
const byHand = withPilot('vandenberg', () => {
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
})

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
 */
function eccentricDecay(periKm, apoKm, flyHours) {
  resetSimulation()
  refreshDerived()
  const K = (0.5 * 2.2 * 30) / 95_100
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
  live.sim.dragK[0] = K
  refreshDerived()
  const start = orbitNow()
  let t = 0
  let next = 50 * H
  let worst = 0
  let down = null
  while (t < flyHours * H) {
    live.sim.advance(600, live.maxDt)
    refreshDerived()
    t += 600
    const now = orbitNow()
    const reached = now.a - R < DECAY_FLOOR
    if (t >= next || reached) {
      const predicted = decayTime(start.a, start.e, now.a, K, start.cosI)
      worst = Math.max(worst, Math.abs((predicted - t) / t))
      next += 50 * H
    }
    if (reached) {
      down = t
      break
    }
  }
  return { periKm, apoKm, e: start.e, worst, down, flown: t }
}
const eccentric = [eccentricDecay(150, 250, 600), eccentricDecay(180, 870, 500)]
const eccWorst = Math.max(...eccentric.map((r) => r.worst))
console.log('\n=== 7. eccentric orbits, the integrator against the theory ===')
for (const r of eccentric) {
  console.log(`  ${r.periKm} x ${r.apoKm} km (e ${r.e.toFixed(4)}): ${r.down ? `down at ${hours(r.down)} h` : `flown ${hours(r.flown)} h`}, worst sample ${(r.worst * 100).toFixed(2)}%`)
}

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
 * A raise for height as well as life: a launch that lasts its wait, so the
 * lifetime rule alone plans nothing, but would reach the window with its perigee
 * under the floor. The floor makes that a raise, the least one that clears it.
 *
 * Kourou at +623.5 h, chosen from the month's floor raises as the one furthest
 * from both boundaries: 13 h of life to spare, and an unraised perigee at
 * ignition of 134 km. The launch this section first flew, Baikonur at +563.3 h,
 * was 8 h clear of the lifetime rule; when the ascent's cutoffs were stepped and
 * the parking orbits came down by up to 0.8 km it went over, and raised for
 * lifetime instead.
 */
const low = toInjection('kourou', 0, 623.5)

/**
 * And a floor that holds. Vandenberg at +150.5 h commits inside a window whose
 * pass comes minutes later; here 15 m/s is first taken off its velocity — a trim
 * before commitment — which drops perigee under the floor on the far side. The
 * raise that fixes it is at apogee, an orbit away, so ignition has to let this
 * window go.
 */
function heldFlight() {
  freshFlight('vandenberg')
  resetMission()
  flight.pilotWarp = WARP.d1
  for (let i = 0; live.sim.t < 150.5 * H && i < 1_000_000; i++) frame()
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
for (const f of kept) console.log(`  ${LAUNCH_SITES[f.site].name.padEnd(18)} perigee at ignition ${km(f.injectPeri - R)} km, theory ${km(f.injectPeri + periError(f) - R)} km`)
console.log(`  Kourou +623.5 h: forecast ${hours(low.plan.wait)} h, lifetime ${hours(low.plan.lifetime)} h, perigee at ignition unraised ${km(low.plan.periapsisAtIgnition - R)} km;` +
  ` raised for ${low.plan.reason} with ${(low.plan.dv1 + low.plan.dv2).toFixed(2)} m/s in ${low.plan.node2 >= 0 ? 2 : 1} burn(s); injected from ${km(low.injectPeri - R)} km; ${low.end}`)
console.log(`  Vandenberg +150.5 h trimmed: raised for ${held.plan.reason}, forecast ${hours(held.plan.wait)} h;` +
  ` ${held.heldAt === null ? 'never held' : `held a window at ${hours(held.heldAt)} h`}; ${held.burns} burns; injected from ${held.injectPeri === null ? '-' : km(held.injectPeri - R)} km after ${hours(held.injectedAfter)} h; ${held.end}`)

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
  ['each injection comes after the forecast window, by less than one parking orbit', flown.every((f) => f.late >= -60 && f.late <= f.period)],
  ['pads whose orbits outlast the wait plan nothing and fly nothing extra', kept.every((f) => !f.plan.needed && !f.plan.raised && f.nodePhases === 0)],
  ['Vandenberg plans a raise and flies both burns', vb.plan.raised && vb.nodePhases === 4],
  ['for under 1% of what is left in its tanks', vb.plan.dv1 + vb.plan.dv2 < 0.01 * 5208],
  ['and injects back down in the orbit it committed from, to 2 km', Math.abs(arriveError) < 2000],
  ['Vandenberg flies the whole mission, pad to splashdown', whole === 'SPLASHDOWN' && reached.includes('LUNAR_ORBIT')],
  ['a window open at commitment but closing before the craft comes round is not counted on',
    Math.abs(closing.outAtCommit) <= PROFILE.phaseTolerance && closing.plan.wait > 100 * H],
  ['so that launch raises for the next window and injects, where it was lost',
    closing.plan.raised && closing.end === 'TRANS_LUNAR' && closing.late >= -60 && closing.late <= closing.period],
  ['a window open at commitment that will be caught is forecast to the pass, to a minute',
    Math.abs(caught.outAtCommit) <= PROFILE.phaseTolerance && caught.plan.wait < H && Math.abs(caught.late) < 60 && caught.end === 'TRANS_LUNAR'],
  ['a trim that leaves the orbit short of its window is planned around',
    afterTrim !== null && afterTrim.replans === 1 && afterTrim.lifetime < afterTrim.wait && afterTrim.raised],
  ['and the trimmed vehicle still injects', trimmed.end === 'TRANS_LUNAR'],
  ['thrust by hand that makes the raise unnecessary withdraws it before it flies',
    afterHand !== null && afterHand.replans === 1 && !afterHand.raised && byHand.burns === 0 && byHand.end === 'TRANS_LUNAR'],
  ['the decay theory holds on eccentric orbits, to the same tolerance',
    eccentric[0].down !== null && eccWorst < PROFILE.lifetimeTolerance],
  ['perigee at ignition is predicted to a kilometre', kept.every((f) => Math.abs(periError(f)) < 1000)],
  ['an orbit that lasts its wait but would inject under the floor is raised for height',
    low.plan.reason === 'floor' && low.plan.raised && low.plan.periapsisAtIgnition < FLOOR && low.plan.lifetime > low.plan.wait],
  /**
   * Within 5 km of the floor, so the raise is the least one and not merely a
   * sufficient one: sized as if it left a circle, the Baikonur raise this
   * section first flew arrived at 152 km.
   */
  ['and injects just above the floor, for a few metres a second',
    low.end === 'TRANS_LUNAR' && low.injectPeri >= FLOOR && low.injectPeri < FLOOR + 5e3 && low.plan.dv1 + low.plan.dv2 < 5],
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
