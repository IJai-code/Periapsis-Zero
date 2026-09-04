/**
 * Station-keeping an NRHO: does the control law hold the orbit, and for how much?
 *
 * Flown twice from the same insertion, uncontrolled and controlled, so the whole
 * difference is the loop. Uncontrolled the orbit is known to diverge x2 per
 * revolution and leave after six; the claim here is that a correction at each
 * apolune holds it indefinitely, for a Delta-v that a real mission would budget.
 *
 * The burn is applied as an **impulse**, and that is honest here in a way it
 * would not be anywhere else in this mission: at a few tenths of a m/s on the
 * service module's 25.7 kN the engine runs well under a second, so there is no
 * arc to straddle and no gravity loss. The injection and capture burns needed
 * closed-loop cutoffs precisely because they were minutes long; this one is not.
 *
 * Apolune is the control point because it is where the craft is slowest and a
 * given impulse buys the most change in perilune — the Oberth argument run
 * backwards, since what is wanted is a change of shape rather than of energy.
 * Analytically dr_p/dv there is about 92 km per m/s, so the ~170 km of drift a
 * revolution accumulates should cost around 1.8 m/s to remove.
 *
 * **Two measured results worth keeping.**
 *
 * One revolution of lookahead is the most that works. Two and three are cheaper
 * per burn and repeatedly fail to converge, letting drift reach 2,000%: the very
 * instability that makes station-keeping necessary — x2 per revolution —
 * amplifies a finite-difference probe by x4 or x8 over that horizon, and the
 * Jacobian stops describing anything. The control horizon is bounded by the
 * Lyapunov time, not by taste.
 *
 * And the cost comes out around 5.8 m/s per revolution against the ~0.1-1 m/s a
 * real NRHO plan budgets. That gap is not the controller. It is that perilune
 * radius is *one scalar* and the orbit has six degrees of freedom: nailing it to
 * 0.2% while the rest of the state drifts means re-doing work every revolution,
 * and the analytic 1.8 m/s minimum shows how much of each burn is that. Closing
 * it needs a reference the real field actually wants — a quasi-periodic orbit
 * found by multiple shooting *in the ephemeris* — and tracking the full state
 * against it rather than a single number. That is the continuation layer proper,
 * and it is not written.
 *
 *   node scripts/verify-nrho-keeping.mjs [revolutions]
 */

import { flight, frame } from './flight.mjs'
import { live, refreshDerived, resetSimulation } from '../src/sim/live.js'
import { PROFILE, enterNrhoCycle, resetMission } from '../src/sim/mission.js'
import { INDEX } from '../src/sim/system.js'
import { BODIES } from '../src/sim/constants.js'
import {
  continueFamily,
  correctPeriodicOrbit,
  insertMember,
  nrhoSeed,
} from '../src/sim/cr3bp.js'
import { solveStationKeeping } from '../src/sim/targeting.js'

const REVS = Number(process.argv[2] ?? 12)
const LOOKAHEAD = Number(process.argv[3] ?? 1)
// null = hold the CR3BP member's perilune; 'flown' = hold whatever the real
// field settles at on the first revolution.
const REF_MODE = process.argv[4] ?? 'cr3bp'
const SEP_NOMINAL = 384400e3
const MOON_R = BODIES.moon.radius
const TU_DAYS = 27.321661 / (2 * Math.PI)

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
  const ins = insertMember(live.sim.state, member, INDEX.ship * 6)
  refreshDerived()
  flight.warp = 3
  flight.pilotWarp = 3
  return ins
}

/** Apply an impulse directly to the live state. */
function applyImpulse(dv) {
  const o = INDEX.ship * 6
  live.sim.state[o + 3] += dv[0]
  live.sim.state[o + 4] += dv[1]
  live.sim.state[o + 5] += dv[2]
}

/**
 * Fly `revs` revolutions, correcting at each apolune when `controlled`.
 * Returns the perilune history and the Delta-v spent.
 */
function fly(controlled) {
  const ins = setup()
  let reference = member.perilune * ins.separation
  const perilunes = []
  const burns = []
  let totalDv = 0

  let prev = live.lunarRange
  let prevPrev = prev
  let lost = null
  const t0 = live.sim.t

  for (let i = 0; i < 6_000_000; i++) {
    frame()
    const r = live.lunarRange
    const t = live.sim.t - t0

    if (r < MOON_R) {
      lost = 'impacted the Moon'
      break
    }
    if (r > 200000e3) {
      lost = 'left the lunar vicinity'
      break
    }

    // Perilune: a local minimum.
    if (prev < prevPrev && prev < r) {
      perilunes.push({ rev: perilunes.length + 1, t, r: prev })
      // Adopting the first flown perilune as the reference asks the controller
      // to hold the orbit the *real field* wants, rather than dragging it back
      // to one the CR3BP wanted and it does not.
      if (REF_MODE === 'flown' && perilunes.length === 1) reference = prev
      if (perilunes.length >= revs) break
    }

    // Apolune: a local maximum, and the control point.
    if (controlled && prev > prevPrev && prev > r) {
      const sol = solveStationKeeping(reference, LOOKAHEAD)
      if (sol.converged && sol.magnitude < 20) {
        applyImpulse(sol.world)
        totalDv += sol.magnitude
        burns.push({ t, dv: sol.magnitude, predicted: sol.approach })
      } else {
        burns.push({ t, dv: 0, predicted: sol.approach, failed: true })
      }
      refreshDerived()
    }

    prevPrev = prev
    prev = r
  }
  return { perilunes, burns, totalDv, lost, reference }
}

const revs = REVS
console.log(`=== member: perilune ${((member.perilune * SEP_NOMINAL) / 1e3).toFixed(0)} km, period ${(member.period * TU_DAYS).toFixed(3)} d ===`)

console.log('\n=== uncontrolled ===')
const free = fly(false)
console.log(`  reference perilune ${(free.reference / 1e3).toFixed(0)} km`)
for (const p of free.perilunes) {
  console.log(
    `  rev ${String(p.rev).padStart(2)}  t ${(p.t / 86400).toFixed(2).padStart(7)} d` +
      `  perilune ${(p.r / 1e3).toFixed(0).padStart(7)} km` +
      `  drift ${(((p.r - free.reference) / free.reference) * 100).toFixed(1).padStart(7)}%`,
  )
}
console.log(`  outcome: ${free.lost ?? `${free.perilunes.length} revolutions completed`}`)

console.log('\n=== controlled: one correction per apolune ===')
const t0 = Date.now()
const held = fly(true)
const elapsed = Date.now() - t0
console.log(`  reference perilune ${(held.reference / 1e3).toFixed(0)} km   (${elapsed} ms)`)
for (const p of held.perilunes) {
  console.log(
    `  rev ${String(p.rev).padStart(2)}  t ${(p.t / 86400).toFixed(2).padStart(7)} d` +
      `  perilune ${(p.r / 1e3).toFixed(0).padStart(7)} km` +
      `  drift ${(((p.r - held.reference) / held.reference) * 100).toFixed(1).padStart(7)}%`,
  )
}
console.log(`  outcome: ${held.lost ?? `${held.perilunes.length} revolutions completed`}`)

const good = held.burns.filter((b) => !b.failed)
const dvPerRev = held.perilunes.length ? held.totalDv / held.perilunes.length : 0
console.log(`\n  burns: ${good.length} of ${held.burns.length} converged`)
console.log('  burn sequence, m/s: ' + held.burns.map((b) => b.dv.toFixed(2)).join('  '))
console.log(`  total delta-v ${held.totalDv.toFixed(3)} m/s over ${held.perilunes.length} revolutions`)
console.log(`  per revolution ${dvPerRev.toFixed(3)} m/s   (a real NRHO plan budgets ~0.1-1; see the header)`)
if (good.length) {
  const mags = good.map((b) => b.dv)
  console.log(`  largest single burn ${Math.max(...mags).toFixed(3)} m/s, smallest ${Math.min(...mags).toFixed(3)}`)
}

const worstDrift = held.perilunes.length
  ? Math.max(...held.perilunes.map((p) => Math.abs(p.r - held.reference) / held.reference))
  : 1

console.log('\n=== what this establishes ===')
const checks = [
  ['uncontrolled, the orbit is lost', free.lost !== null || free.perilunes.length < revs],
  ['controlled, it is not', held.lost === null && held.perilunes.length >= revs],
  ['perilune held within 25% of reference', worstDrift < 0.25],
  ['every correction converged', good.length === held.burns.length],
  // Bounded, not budgeted. Asserting the real ~1 m/s figure would be asserting a
  // reference this layer does not have; what is established is that the loop
  // holds the orbit at a cost that stays small against the vehicle's margin.
  ['cost bounded under 10 m/s per revolution', dvPerRev > 0 && dvPerRev < 10],
]
let pass = true
for (const [label, ok] of checks) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`)
  if (!ok) pass = false
}
console.log(`\n  worst perilune drift under control: ${(worstDrift * 100).toFixed(1)}%`)
console.log(`  ${pass ? 'PASS' : 'FAIL'}`)
process.exit(pass ? 0 : 1)
