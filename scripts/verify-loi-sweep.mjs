/**
 * Three experiments on the capture burn, all flown in the real sequencer.
 *
 * 1. Where the burn should sit relative to periapsis. Straddling it is what
 *    circularisation does at apoapsis and what minimises the gravity loss, but
 *    minimum delta-v and minimum eccentricity are different objectives and it
 *    is not obvious they agree. Swept, not assumed.
 *
 * 2. Whether the closed-loop cutoff earns its keep. The same burn is flown
 *    against a burnout-mass cutoff — the open-loop criterion the mid-course
 *    correction used — with a dispersion applied to the engine. If the two
 *    respond the same way, the closed loop is decoration.
 *
 * 3. Whether the answer depends on the integrator's step size.
 *
 * This is an *instrument*, not a gate: it prints three sweeps and the step
 * ceiling's own contributions and asserts nothing, so it can never go red.
 * Reading it is the point.
 *
 * Both states default to the checked-in fixtures, so it runs with no arguments.
 *
 *   node scripts/verify-loi-sweep.mjs                  both fixtures
 *   node scripts/verify-loi-sweep.mjs a.json o.json    some other pair
 */

import { flight, frame, loadSnapshot, LUNAR_APPROACH_FIXTURE, LUNAR_ORBIT_FIXTURE } from './flight.mjs'
import { WARP } from '../src/sim/warp.js'
import { live, refreshDerived } from '../src/sim/live.js'
import { currentPhase, mission, PROFILE } from '../src/sim/mission.js'
import {
  MU_MOON,
  applyThrust,
  integrateAttitude,
  ship,
  timestepLimit,
  totalMass,
} from '../src/sim/ship.js'
import { BODIES, SHIP, TEST_PARTICLES } from '../src/sim/constants.js'
import { INDEX } from '../src/sim/system.js'

const R = BODIES.moon.radius
const snap = process.argv[2] ?? LUNAR_APPROACH_FIXTURE
const orbitSnap = process.argv[3] ?? LUNAR_ORBIT_FIXTURE
/**
 * Both states are needed and both now have defaults, which is a stronger fix than
 * the check that used to stand here: the usage line named only the first and the
 * second was read without being checked, so a run given one argument got through
 * the first two experiments and then died inside `readFileSync` on `undefined`,
 * which reads as a broken harness rather than a missing argument. An explicit
 * guard would still let a one-argument run through; a default cannot.
 */
const alt = (m) => (m - R) / 1e3

/**
 * Fly one capture from the approach state and report the achieved orbit.
 *
 * @param {object} opts
 *   thrustScale  multiply the burning stage's thrust — an engine dispersion
 *   ispScale     multiply its specific impulse
 *   openLoop     cut off on burnout mass instead, from the impulsive solution
 *   maxDtCap     force a step ceiling, to test convergence
 */
function fly({ thrustScale = 1, ispScale = 1, openLoop = false, maxDtCap = null } = {}) {
  loadSnapshot(snap)

  // Dispersions are applied to the stage table itself, so the sequencer sees a
  // vehicle that simply is not the one it sized the burn against.
  const stage = SHIP.stages[2]
  const thrust0 = stage.thrust
  const isp0 = stage.isp
  stage.thrust = thrust0 * thrustScale
  stage.isp = isp0 * ispScale

  let openLoopTargetMass = null
  let result = null

  // An open-loop run has to actually be open loop. Leaving the turning-point
  // test armed underneath means the closed loop simply fires first whenever it
  // would have done better, which flatters the comparison into a tie.
  const floor0 = PROFILE.loiEccNoiseFloor
  if (openLoop) PROFILE.loiEccNoiseFloor = Infinity

  try {
    for (let i = 0; i < 6_000_000; i++) {
      flight.pilotWarp = mission.warpRequest === null ? WARP.h6 : null
      frame()
      if (maxDtCap !== null && live.maxDt > maxDtCap) {
        live.maxDt = maxDtCap
        live.sim.maxDt = maxDtCap
      }

      const id = currentPhase().id

      if (openLoop) {
        // Freeze the burnout mass from the impulsive solution at the moment the
        // real sequencer would have lit the engine, then cut on mass alone.
        if (id === 'LOI_BURN' && openLoopTargetMass === null) {
          const ve = isp0 * 9.80665 // the *nominal* engine, which is the point
          openLoopTargetMass = mission.loi.startMass * Math.exp(-mission.loi.deltaVEstimate / ve)
        }
        if (id === 'LOI_BURN' && totalMass() <= openLoopTargetMass) {
          ship.throttle = 0
          // Freeze the achieved orbit exactly as the closed loop would report it.
          result = capture('burnout mass')
          break
        }
      }


      if (id === 'LUNAR_ORBIT') {
        result = capture(mission.loi.cutoff)
        break
      }
    }
  } finally {
    stage.thrust = thrust0
    stage.isp = isp0
    PROFILE.loiEccNoiseFloor = floor0
  }
  return result
}

function capture(cutoff) {
  const l = live.lunar
  return {
    cutoff,
    e: l.eccentricity,
    a: l.semiMajor,
    rp: l.periapsisRadius,
    ra: l.apoapsisRadius,
    period: l.period,
    bound: l.bound,
    dv: mission.loi.deltaVDelivered,
    duration: mission.t - mission.loi.burnStart,
    minRadius: mission.loi.minRadius,
    mass: totalMass(),
  }
}

const row = (label, r) =>
  `  ${label.padEnd(16)} ${r.dv.toFixed(1).padStart(7)} ${r.duration.toFixed(1).padStart(7)} ` +
  `${r.e.toFixed(5).padStart(9)} ${(r.bound ? alt(r.rp).toFixed(2) : '—').padStart(9)} ` +
  `${(r.bound ? alt(r.ra).toFixed(2) : 'ESCAPE').padStart(10)} ${alt(r.minRadius).toFixed(2).padStart(9)} ` +
  `${(r.bound ? (r.period / 60).toFixed(2) : '—').padStart(8)}`

const HEAD =
  '                        dv      burn         e   peri km    apo km   min alt   per min'

/* ---------------------------------------------------------------- *
 * 1. Ignition placement
 * ---------------------------------------------------------------- */

console.log('=== 1. ignition placement: lead fraction of the burn ahead of periapsis ===')
console.log(HEAD)
const nominalLead = PROFILE.loiLeadFraction
for (const f of [0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0]) {
  PROFILE.loiLeadFraction = f
  const r = fly()
  console.log(row(`f = ${f.toFixed(1)}`, r))
}
PROFILE.loiLeadFraction = nominalLead

/* ---------------------------------------------------------------- *
 * 2. Closed loop against open loop, under engine dispersion
 * ---------------------------------------------------------------- */

console.log('\n=== 2. closed loop vs burnout-mass cutoff, under engine dispersion ===')
console.log(HEAD)
for (const [label, thrustScale, ispScale] of [
  ['nominal', 1, 1],
  ['thrust -3%', 0.97, 1],
  ['thrust +3%', 1.03, 1],
  ['Isp -2%', 1, 0.98],
  ['Isp +2%', 1, 1.02],
]) {
  const closed = fly({ thrustScale, ispScale })
  const open = fly({ thrustScale, ispScale, openLoop: true })
  console.log(row(`${label} closed`, closed))
  console.log(row(`${label} open`, open))
}

/* ---------------------------------------------------------------- *
 * 3. Where the step ceiling actually bites
 * ---------------------------------------------------------------- */

/**
 * Not during the burn. Warp is 0 while the engine is lit, so a frame covers
 * 1/60 s and `advance()` takes a single step whatever the ceiling says — the
 * ceiling is inert there. It decides the *coast*, under time warp, where the
 * substep count is ceil(simDt / maxDt) and a frame covers minutes or hours.
 *
 * So this runs at 1 day/s, where a frame is 1440 simulated seconds, and the cap
 * is the only thing standing between that and a single 1440 s step across a
 * two-hour orbit.
 */
console.log('\n=== 3. lunar coast at 1 day/s, 10 revolutions, by step ceiling ===')
console.log('   maxDt   real step  steps/rev       a drift      e drift    peri drift')

/**
 * 1 day/s, so a frame is 1440 simulated seconds.
 *
 * This was the literal `4` until the ladder grew rungs in 72a3f56, at which
 * point index 4 became 1 min/s — and, because the name was already imported at
 * the top of this file, the redeclaration made the whole gate a syntax error
 * rather than a wrong measurement. It has not run since. The named rung cannot
 * drift out from under it the way the index did; flight.mjs makes the same
 * argument about its own copy of the ladder.
 */
const SIMDT = 86400 / 60

/**
 * Integrated directly, without the sequencer.
 *
 * This used to call `frame()`, which runs `updateMission` — and the sequencer
 * does not sit in lunar orbit for ten revolutions. It departs: measured, it
 * entered TEI_ALIGN at revolution 1.00 and lit the trans-Earth injection at
 * 1.70, so every row below was reporting the same ~1,000 m/s burn and the
 * eccentricity drift read 1.0 at every ceiling including 5 s. A step-size
 * experiment whose answer does not move with step size is measuring something
 * else, and it was.
 *
 * What replaces it is `frame()` with `updateMission` removed and nothing else:
 * attitude, thrust and the drag coefficients still have to be refreshed every
 * step. Dropping `applyThrust` as well looks harmless at throttle zero and is
 * not — `extAccel` is a live object that holds the *last* acceleration written
 * into it, so a snapshot taken after the capture burn keeps applying that burn
 * forever. That read as semi-major axis going to exactly zero at every ceiling,
 * which is the same shape of wrong answer as before and worth naming: in both
 * cases the number did not move with the step size, and in both cases that was
 * the tell.
 */
for (const cap of [1440, 900, 300, 100, 30, 17.66, 13.86, 5]) {
  loadSnapshot(orbitSnap)
  const a0 = live.lunar.semiMajor
  const e0 = live.lunar.eccentricity
  const rp0 = live.lunar.periapsisRadius
  const period = live.lunar.period
  const t0 = live.sim.t

  ship.throttle = 0
  while (live.sim.t - t0 < 10 * period) {
    integrateAttitude(SIMDT)
    applyThrust(1 / 60, SIMDT, live.sim.extAccel)
    live.sim.dragK[0] = live.sim.extAccel.dragK ?? 0
    live.sim.liftK[0] = live.sim.extAccel.liftK ?? 0
    live.sim.bank[0] = live.sim.extAccel.bank ?? 0
    live.sim.advance(SIMDT, cap)
    refreshDerived()
  }

  const realStep = SIMDT / Math.ceil(SIMDT / cap)
  console.log(
    `  ${String(cap).padStart(7)} ${realStep.toFixed(1).padStart(11)} ${(period / realStep).toFixed(1).padStart(10)} ` +
      `${((live.lunar.semiMajor - a0) / 1e3).toFixed(3).padStart(13)} km ` +
      `${(live.lunar.eccentricity - e0).toExponential(2).padStart(11)} ` +
      `${((live.lunar.periapsisRadius - rp0) / 1e3).toFixed(3).padStart(10)} km`,
  )
}

/* Which body actually sets the ceiling here, craft by craft. */
loadSnapshot(orbitSnap)
console.log('\n  ceiling contributions in this lunar orbit:')
const st = live.sim.state
const eo = INDEX.earth * 6
const mo = INDEX.moon * 6
for (const id of TEST_PARTICLES) {
  const o = INDEX[id] * 6
  const re = Math.hypot(st[o] - st[eo], st[o + 1] - st[eo + 1], st[o + 2] - st[eo + 2])
  const rm = Math.hypot(st[o] - st[mo], st[o + 1] - st[mo + 1], st[o + 2] - st[mo + 2])
  console.log(
    `    ${id.padEnd(8)} geocentric ${(re / 1e3).toFixed(0).padStart(7)} km -> ${timestepLimit(re).toFixed(2).padStart(7)} s   ` +
      `selenocentric ${(rm / 1e3).toFixed(0).padStart(7)} km -> ${timestepLimit(rm, MU_MOON).toFixed(2).padStart(7)} s`,
  )
}
console.log(`    live ceiling actually used: ${live.maxDt.toFixed(2)} s`)
