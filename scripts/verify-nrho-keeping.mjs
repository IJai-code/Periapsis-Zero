/**
 * Station-keeping an NRHO: does the control law hold the orbit, and for how much?
 *
 * Two references and two control laws, flown from the same field. The first half
 * is the original test: a CR3BP family member inserted into the real field and
 * held on perilune radius. The second half flies against a reference the real
 * field actually has — `shootHalo` in sim/halo.js — with a law that tracks its
 * whole state, first applied by this script and then flown by the sequencer.
 *
 * Until that last section burns are applied as **impulses**, and that is honest
 * for the orbit in a way it would not be anywhere else in this mission: at a few
 * tenths of a m/s the service module's engine runs well under a second, so there
 * is no arc to straddle and no gravity loss. The injection and capture burns
 * needed closed-loop cutoffs precisely because they were minutes long; these are
 * not. What an impulse hides is the delivery, and the last section flies that.
 *
 * Apolune is the control point because it is where the craft is slowest and a
 * given impulse buys the most change — the Oberth argument run backwards, since
 * what is wanted is a change of shape rather than of energy. Analytically dr_p/dv
 * there is about 92 km per m/s.
 *
 * **What the perilune law showed.** One revolution of lookahead is the most that
 * works: two and three are cheaper per burn and repeatedly fail to converge,
 * because the instability that makes station-keeping necessary — x2 a revolution
 * — amplifies a finite-difference probe by x4 or x8 over that horizon. And held
 * that way the orbit costs 6.1 m/s a revolution against the 0.1-1 m/s a real NRHO
 * plan budgets, because perilune radius is one number and the orbit has six
 * degrees of freedom. Closing that needed a reference found in the real field and
 * a law that tracks all of it. That is the continuation layer, and it now exists.
 *
 * **What the reference shows.** Flown unguided from its start, the craft stays on
 * it for the whole flight — nothing to correct, and so no cost to measure. A
 * station-keeping cost exists only against errors, and this simulation has none
 * of its own: the craft knows its state exactly and every burn is perfect. So the
 * second half supplies them — navigation error in what the controller believes,
 * execution error in what the engine delivers — as a sweep across three levels,
 * rather than one assumed figure. The perilune law is flown from the same start
 * too, and it does not hold this orbit at all: it forces perilune to a constant
 * the real orbit does not keep.
 *
 * **What the sequencer showed.** Flown by `NRHO_STATION_KEEP` itself, the same
 * law found two faults the impulses could not. The pass cut off on last frame's
 * thrust, so the frame after a cutoff relit the engine, and the first correction,
 * 2.1e-6 m/s, delivered 166 m/s and hit the Moon. And a burn cut at a frame
 * boundary is at least a frame of engine, 0.0505 m/s at 1x: with its state known
 * exactly the craft cost 0.05 m/s a revolution and strayed 15 km. Cut once, with
 * its last step held to the cutoff mass, it stays within 0.35 m of the reference,
 * and kicked 10 cm/s off it comes back to 0.28 km for 0.029 m/s a revolution.
 *
 *   node scripts/verify-nrho-keeping.mjs [revolutions]
 */

import { flight, frame } from './flight.mjs'
import { WARP } from '../src/sim/warp.js'
import { live, refreshDerived, resetSimulation } from '../src/sim/live.js'
import { PROFILE, currentPhase, enterNrhoCycle, mission, resetMission } from '../src/sim/mission.js'
import { activeStage, separate, ship, totalMass } from '../src/sim/ship.js'
import { INDEX } from '../src/sim/system.js'
import { BODIES, G0, SHIP } from '../src/sim/constants.js'
import { RK4NBody } from '../src/sim/rk4.js'
import { continueFamily, correctPeriodicOrbit, insertMember, nrhoSeed } from '../src/sim/cr3bp.js'
import { solveStationKeeping } from '../src/sim/targeting.js'
import { referenceStateAt, shootHalo, solveHaloKeeping } from '../src/sim/halo.js'

const REVS = Number(process.argv[2] ?? 12)
const SEP_NOMINAL = 384400e3
const MOON_R = BODIES.moon.radius
const TU_DAYS = 27.321661 / (2 * Math.PI)
const O = INDEX.ship * 6
const M = INDEX.moon * 6
/**
 * Extrema only count on the right side of this range. A burn at apolune can dip
 * the range for a sample, and read as a perilune 71,000 km out it throws the
 * revolution count off by one.
 */
const APSIS_SPLIT = 30000e3

/* ---- the family member ---- */
const seed = correctPeriodicOrbit(nrhoSeed(5237e3 / SEP_NOMINAL, 70000e3 / SEP_NOMINAL), {
  pin: 'z',
  maxIter: 60,
  damping: 0.5,
})
const run = continueFamily(
  { x: seed.x, z: seed.z, vy: seed.vy },
  { target: 2200e3 / SEP_NOMINAL, steps: 400, ds: 3e-4, dsMax: 2e-3 },
)
const TARGET_DAYS = (2 * 29.530589) / 9
let member = run.members[0]
for (const m of run.members) {
  if (Math.abs(m.period * TU_DAYS - TARGET_DAYS) < Math.abs(member.period * TU_DAYS - TARGET_DAYS)) {
    member = m
  }
}

function setup() {
  resetSimulation()
  resetMission()
  refreshDerived()
  enterNrhoCycle()
  PROFILE.nrhoKeepInterval = 1e9 // the loop here is driven by this script
  flight.warp = WARP.h6
  flight.pilotWarp = WARP.h6
}

/** Seeded, so every run of this gate flies the same errors. */
function generator(seedValue) {
  let s = seedValue
  const uniform = () => {
    s |= 0
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  return { uniform, gauss: () => Math.sqrt(-2 * Math.log(1 - uniform())) * Math.cos(2 * Math.PI * uniform()) }
}

/**
 * Fly REVS revolutions from the live state. At each apolune `control()` returns
 * a burn to apply, `null` for a solve that failed, or nothing for no control;
 * when `reference` is given the craft's distance from it is measured first.
 */
function fly(control, reference = null) {
  const perilunes = []
  const burns = []
  const tracking = []
  const refNow = new Float64Array(6)
  let total = 0
  let failed = 0
  let lost = null
  let prev = live.lunarRange
  let prevPrev = prev

  for (let i = 0; i < 6_000_000; i++) {
    frame()
    const r = live.lunarRange
    if (r < MOON_R) {
      lost = 'impacted the Moon'
      break
    }
    if (r > 200000e3) {
      lost = 'left the lunar vicinity'
      break
    }
    if (prev < prevPrev && prev < r && prev < APSIS_SPLIT) {
      perilunes.push(prev)
      if (perilunes.length >= REVS) break
    }
    if (prev > prevPrev && prev > r && prev > APSIS_SPLIT) {
      if (reference && referenceStateAt(reference, live.sim.t, refNow)) {
        const d = [0, 1, 2, 3, 4, 5].map((k) => live.sim.state[O + k] - live.sim.state[M + k] - refNow[k])
        tracking.push({ position: Math.hypot(d[0], d[1], d[2]), velocity: Math.hypot(d[3], d[4], d[5]) })
      }
      if (control) {
        const dv = control()
        if (dv === null) failed++
        else {
          for (let a = 0; a < 3; a++) live.sim.state[O + 3 + a] += dv[a]
          const mag = Math.hypot(dv[0], dv[1], dv[2])
          total += mag
          burns.push(mag)
        }
        refreshDerived()
      }
    }
    prevPrev = prev
    prev = r
  }
  return { perilunes, burns, tracking, total, failed, lost }
}

const perRev = (f) => f.total / Math.max(1, f.perilunes.length)
const worstOff = (f) => (f.tracking.length ? Math.max(...f.tracking.map((t) => t.position)) : Infinity)
const worstOffV = (f) => (f.tracking.length ? Math.max(...f.tracking.map((t) => t.velocity)) : Infinity)
const outcome = (f) => f.lost ?? `${f.perilunes.length} revolutions`

/** The perilune law: hold perilune radius, one revolution ahead. */
const perilunLaw = (target) => () => {
  const sol = solveStationKeeping(target, 1)
  return sol.converged && sol.magnitude < 20 ? sol.world : null
}

console.log(`=== member: perilune ${((member.perilune * SEP_NOMINAL) / 1e3).toFixed(0)} km, period ${(member.period * TU_DAYS).toFixed(3)} d ===`)

/* ---------------------------------------------------------------- *
 * A. The CR3BP member, held on perilune radius
 * ---------------------------------------------------------------- */

setup()
let ins = insertMember(live.sim.state, member, O)
refreshDerived()
const free = fly(null)

setup()
ins = insertMember(live.sim.state, member, O)
refreshDerived()
const held = fly(perilunLaw(member.perilune * ins.separation))

console.log('\n=== A. the CR3BP member in the real field ===')
console.log(`  unguided: ${outcome(free)}; perilunes km ${free.perilunes.map((p) => (p / 1e3).toFixed(0)).join('  ')}`)
console.log(`  held on perilune radius: ${outcome(held)}, ${held.total.toFixed(3)} m/s = ${perRev(held).toFixed(3)} m/s per revolution, ${held.failed} failed solves`)
console.log(`    burns m/s ${held.burns.map((b) => b.toFixed(2)).join('  ')}`)

/* ---------------------------------------------------------------- *
 * B. A reference the real field has
 * ---------------------------------------------------------------- */

setup()
const shotStart = Date.now()
const reference = shootHalo(live.sim, member, { revolutions: REVS + 3 })
const shotMs = Date.now() - shotStart

/** Re-fly every segment at `step` and return the worst mismatch where each should meet the next. */
function refly(ref, step) {
  const sc = new RK4NBody([BODIES.sun.mass, BODIES.earth.mass, BODIES.moon.mass, 0], new Float64Array(24), 3)
  sc.adoptFieldFrom(ref.field)
  let position = 0
  let velocity = 0
  let perilune = Infinity
  for (let k = 0; k < ref.revolutions; k++) {
    sc.state.set(ref.bodies.subarray(18 * k, 18 * (k + 1)))
    for (let i = 0; i < 6; i++) sc.state[18 + i] = sc.state[12 + i] + ref.states[6 * k + i]
    const n = Math.ceil(ref.span / step)
    for (let s = 0; s < n; s++) {
      sc.stepWithRails(ref.span / n)
      if (k === 0) perilune = Math.min(perilune, Math.hypot(sc.state[18] - sc.state[12], sc.state[19] - sc.state[13], sc.state[20] - sc.state[14]))
    }
    const d = [0, 1, 2, 3, 4, 5].map((i) => sc.state[18 + i] - sc.state[12 + i] - ref.states[6 * (k + 1) + i])
    position = Math.max(position, Math.hypot(d[0], d[1], d[2]))
    velocity = Math.max(velocity, Math.hypot(d[3], d[4], d[5]))
  }
  return { position, velocity, perilune }
}
const recheck = refly(reference, reference.step / 2)

console.log(`\n=== B. a real-field reference, ${reference.revolutions} revolutions (${shotMs} ms) ===`)
console.log(`  seeded ${(reference.seedMismatch.position / 1e3).toFixed(0)} km and ${reference.seedMismatch.velocity.toFixed(2)} m/s apart at worst; converged ${reference.converged} in ${reference.iterations} iterations`)
for (const h of reference.history) console.log(`    iteration ${h.iteration}: ${h.position.toExponential(2)} m, ${h.velocity.toExponential(2)} m/s`)
console.log(`  patch points moved up to ${(reference.moved.position / 1e3).toFixed(0)} km and ${reference.moved.velocity.toFixed(2)} m/s from the member`)
console.log(`  re-flown at ${reference.step / 2} s: segments meet to ${recheck.position.toExponential(2)} m and ${recheck.velocity.toExponential(2)} m/s`)

/* ---------------------------------------------------------------- *
 * C. Flying against it
 * ---------------------------------------------------------------- */

function onReference() {
  setup()
  for (let i = 0; i < 6; i++) live.sim.state[O + i] = live.sim.state[M + i] + reference.states[i]
  refreshDerived()
}

/**
 * The reference law, with errors put in.
 *
 * Navigation error: the controller solves from its estimate, the true state plus
 * Gaussian error of `navPosition` m and `navVelocity` m/s on each axis, while the
 * craft flies on its true state. Execution error: the burn delivered is off by 1%
 * in magnitude and 1 degree in pointing, one sigma each. Neither is a claim about
 * any mission's navigation; the three levels bracket it.
 */
function referenceLaw(navPosition, navVelocity, rng) {
  const estimate = new Float64Array(24)
  return () => {
    estimate.set(live.sim.state.subarray(0, 24))
    for (let a = 0; a < 3; a++) {
      estimate[O + a] += rng.gauss() * navPosition
      estimate[O + 3 + a] += rng.gauss() * navVelocity
    }
    const sol = solveHaloKeeping(reference, live.sim, { state: estimate })
    if (!sol.converged || sol.magnitude >= 20) return null
    const mag = sol.magnitude
    if (!(mag > 0)) return [0, 0, 0]
    const u = [sol.world[0] / mag, sol.world[1] / mag, sol.world[2] / mag]
    const q = Math.abs(u[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]
    let k = [u[1] * q[2] - u[2] * q[1], u[2] * q[0] - u[0] * q[2], u[0] * q[1] - u[1] * q[0]]
    const kn = Math.hypot(k[0], k[1], k[2])
    k = k.map((c) => c / kn)
    const kxu = [k[1] * u[2] - k[2] * u[1], k[2] * u[0] - k[0] * u[2], k[0] * u[1] - k[1] * u[0]]
    const phi = 2 * Math.PI * rng.uniform()
    const axis = [0, 1, 2].map((a) => Math.cos(phi) * k[a] + Math.sin(phi) * kxu[a])
    const angle = (Math.PI / 180) * rng.gauss()
    const scale = mag * (1 + 0.01 * rng.gauss())
    const ax = [axis[1] * u[2] - axis[2] * u[1], axis[2] * u[0] - axis[0] * u[2], axis[0] * u[1] - axis[1] * u[0]]
    return [0, 1, 2].map((a) => scale * (u[a] * Math.cos(angle) + ax[a] * Math.sin(angle)))
  }
}

onReference()
const drift = fly(null, reference)
onReference()
const perilunOnReference = fly(perilunLaw(recheck.perilune), reference)
const levels = [
  { position: 100, velocity: 0.001, label: '0.1 km, 1 mm/s' },
  { position: 1000, velocity: 0.01, label: '1 km, 1 cm/s' },
  { position: 10000, velocity: 0.1, label: '10 km, 10 cm/s' },
]
const noisy = levels.map((level, i) => {
  onReference()
  return { level, ...fly(referenceLaw(level.position, level.velocity, generator(0x2545f491 + i)), reference) }
})

console.log('\n=== C. flying from the reference\'s start ===')
console.log('  law                                          outcome           m/s per rev   total m/s   furthest off: km     m/s')
const row = (label, f, cost = true) =>
  console.log(
    `  ${label.padEnd(44)} ${outcome(f).padEnd(22)} ${cost ? perRev(f).toFixed(3).padStart(9) : '        -'} ${cost ? f.total.toFixed(3).padStart(11) : '          -'} ${(worstOff(f) / 1e3).toFixed(1).padStart(16)} ${worstOffV(f).toFixed(3).padStart(7)}`,
  )
row('none', drift, false)
row('perilune radius, no errors', perilunOnReference)
for (const n of noisy) row(`reference, navigation ${n.level.label}`, n)
console.log('  (each reference-law flight also carries 1% and 1 degree of execution error per burn)')

/* ---------------------------------------------------------------- *
 * D. The sequencer's own cycle
 * ---------------------------------------------------------------- */

/**
 * The reference law as the flight computer flies it, not as this script applies it.
 *
 * What C idealised is real here: `NRHO_COAST` finds apolune from its own range
 * samples, and `NRHO_STATION_KEEP` solves, slews and runs the service module's
 * engine, cutting off on mass. No errors are put in, because what is under test
 * is the delivery: once undisturbed, where the corrections are millionths of a
 * m/s, and once kicked along track, where the first takes several frames of
 * engine.
 */
function flySequencer(kick) {
  setup()
  let engine = 0
  SHIP.stages.forEach((s, i) => {
    if (s.thrust > 0) engine = i
  })
  while (ship.stage < engine) separate()
  mission.lastSeparations = ship.separations
  const v = Math.hypot(reference.states[3], reference.states[4], reference.states[5])
  for (let i = 0; i < 3; i++) {
    live.sim.state[O + i] = live.sim.state[M + i] + reference.states[i]
    live.sim.state[O + 3 + i] = live.sim.state[M + 3 + i] + reference.states[3 + i] * (1 + kick / v)
  }
  refreshDerived()
  enterNrhoCycle(reference)

  const stage = activeStage()
  const startMass = totalMass()
  const refNow = new Float64Array(6)
  const passes = []
  const perilunes = []
  let current = null
  let phase = currentPhase().id
  let lit = false
  let lost = null
  let prev = live.lunarRange
  let prevPrev = prev
  for (let i = 0; i < 6_000_000; i++) {
    const massBefore = totalMass()
    frame()
    const id = currentPhase().id
    const r = live.lunarRange
    if (id === 'LOST' || r < MOON_R) {
      lost = 'impacted the Moon'
      break
    }
    if (r > 200000e3) {
      lost = 'left the lunar vicinity'
      break
    }
    if (id !== phase) {
      if (id === 'NRHO_STATION_KEEP') {
        referenceStateAt(reference, live.sim.t, refNow)
        const d = [0, 1, 2].map((k) => live.sim.state[O + k] - live.sim.state[M + k] - refNow[k])
        current = { off: Math.hypot(d[0], d[1], d[2]), converged: mission.nrho.converged, massBefore, lightings: 0 }
      } else if (current) {
        current.burnt = mission.nrho.burnt
        current.asked = mission.nrho.deltaV
        current.delivered = stage.isp * G0 * Math.log(current.massBefore / totalMass())
        passes.push(current)
        current = null
      }
      phase = id
    }
    if (current) {
      if (ship.thrust > 0 && !lit) current.lightings++
      lit = ship.thrust > 0
    }
    if (prev < prevPrev && prev < r && prev < APSIS_SPLIT) {
      perilunes.push(prev)
      if (perilunes.length >= REVS) break
    }
    prevPrev = prev
    prev = r
  }
  return {
    passes,
    perilunes,
    lost,
    total: stage.isp * G0 * Math.log(startMass / totalMass()),
    booked: mission.nrho.totalDeltaV,
  }
}

const calm = flySequencer(0)
const kicked = flySequencer(0.1)
const furthest = (f) => Math.max(...f.passes.map((p) => p.off))

console.log("\n=== D. the sequencer's own cycle, from the reference's start ===")
for (const [label, f] of [['undisturbed', calm], ['kicked 10 cm/s along track', kicked]]) {
  const burns = f.passes.filter((p) => p.burnt)
  console.log(
    `  ${label}: ${outcome(f)}, ${burns.length} burns in ${f.passes.length} passes, ` +
      `${f.total.toExponential(3)} m/s = ${(f.total / Math.max(1, f.perilunes.length)).toExponential(3)} m/s per revolution, booked ${f.booked.toExponential(3)}`,
  )
  console.log(`    off the reference at each apolune, m: ${f.passes.map((p) => (p.off < 10 ? p.off.toFixed(2) : p.off.toFixed(0))).join('  ')}`)
  console.log(`    burns asked / delivered, m/s: ${burns.map((p) => `${p.asked.toExponential(3)} / ${p.delivered.toExponential(3)}`).join('   ')}`)
}

/* ---------------------------------------------------------------- *
 * What this establishes
 * ---------------------------------------------------------------- */

console.log('\n=== what this establishes ===')
const checks = [
  ['the CR3BP member, unguided, is lost', free.lost !== null || free.perilunes.length < REVS],
  ['held on perilune radius, it is not', held.lost === null && held.perilunes.length >= REVS && held.failed === 0],
  ['at under 10 m/s per revolution', perRev(held) > 0 && perRev(held) < 10],
  ['the real-field reference converges', reference.converged],
  ['its segments meet to 10 cm and 0.1 mm/s', reference.mismatch.position < 0.1 && reference.mismatch.velocity < 1e-4],
  ['and still meet, re-flown at half the step', recheck.position < 1 && recheck.velocity < 1e-3],
  ['flown unguided from its start, the craft stays within 5 km of it throughout', drift.lost === null && drift.perilunes.length >= REVS && worstOff(drift) < 5e3],
  ['held on perilune radius instead, the craft is dragged off it', perilunOnReference.lost !== null || worstOff(perilunOnReference) > 1000e3],
  ['the reference law holds every flight, every solve converging', noisy.every((n) => n.lost === null && n.failed === 0 && n.perilunes.length >= REVS)],
  ['with 1 km and 1 cm/s of navigation error it costs under 0.1 m/s a revolution', perRev(noisy[1]) < 0.1],
  ['and stays within 50 km of the reference', worstOff(noisy[1]) < 50e3],
  ['cost rises with navigation error', perRev(noisy[0]) < perRev(noisy[1]) && perRev(noisy[1]) < perRev(noisy[2])],
  ['and at 10 km and 10 cm/s stays under 1 m/s a revolution', perRev(noisy[2]) < 1],
  ["the sequencer's own cycle holds the reference, every pass solving", [calm, kicked].every((f) => f.lost === null && f.perilunes.length >= REVS && f.passes.every((p) => p.converged))],
  ['every maintenance burn lights once and delivers what it asked, to 1e-6 m/s', [calm, kicked].every((f) => f.passes.every((p) => p.lightings === (p.burnt ? 1 : 0) && Math.abs(p.delivered - (p.burnt ? p.asked : 0)) < 1e-6))],
  ['and books what it delivered', [calm, kicked].every((f) => Math.abs(f.booked - f.total) < 1e-6)],
  ['undisturbed, it is within 5 m of the reference at every apolune', furthest(calm) < 5],
  ['kicked 10 cm/s along track, it is back within 1 km by the last', kicked.passes.at(-1).off < 1e3],
  ['for under 0.06 m/s a revolution', kicked.total / kicked.perilunes.length < 0.06],
]
let pass = true
for (const [label, ok] of checks) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`)
  if (!ok) pass = false
}
console.log(`\n  ${pass ? 'PASS' : 'FAIL'}`)
process.exit(pass ? 0 : 1)
