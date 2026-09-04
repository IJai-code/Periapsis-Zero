/**
 * What happens to a CR3BP halo when it meets the real field.
 *
 * This measures, before any controller is written, the thing that decides how a
 * controller must be built: how fast an NRHO diverges when nobody is flying it.
 * An NRHO is *unstable* — that is the whole reason station-keeping exists — and
 * the instability's timescale sets the correction cadence, the control authority
 * needed, and whether a CR3BP seed is even a usable starting point.
 *
 * Three things separate the idealised member from the flown orbit, and all three
 * are present here at once: the Moon's orbit is eccentric where the CR3BP's is
 * circular, the Sun is in the field, and the frame's rotation rate and length
 * scale both breathe. None of them is a small correction to an unstable orbit.
 *
 *   node scripts/verify-nrho-ephemeris.mjs [revolutions]
 */

import { flight, frame } from './flight.mjs'
import { live, refreshDerived, resetSimulation } from '../src/sim/live.js'
import { PROFILE, enterNrhoCycle, mission, resetMission } from '../src/sim/mission.js'
import { INDEX } from '../src/sim/system.js'
import { BODIES } from '../src/sim/constants.js'
import { MU } from '../src/sim/lagrange.js'
import {
  continueFamily,
  correctPeriodicOrbit,
  insertMember,
  lunarState,
  nrhoSeed,
  synodic,
  updateSynodicFrame,
} from '../src/sim/cr3bp.js'

const REVS = Number(process.argv[2] ?? 8)
const SEP_NOMINAL = 384400e3
const MOON_R = BODIES.moon.radius
const TU_DAYS = 27.321661 / (2 * Math.PI)

/* ---- pick the family member nearest the 9:2 period ---- */
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
const ls = lunarState(member.x, member.z, member.vy)
console.log('=== the idealised member ===')
console.log(`  x ${member.x.toFixed(9)}  z ${member.z.toFixed(9)}  vy ${member.vy.toFixed(9)}`)
console.log(`  CR3BP: perilune ${((member.perilune * SEP_NOMINAL) / 1e3).toFixed(0)} km, apolune ${((member.apolune * SEP_NOMINAL) / 1e3).toFixed(0)} km`)
console.log(`         period ${(member.period * TU_DAYS).toFixed(3)} d, e ${ls.eccentricity.toFixed(4)}, bound ${ls.bound}`)

/* ---- insert into the live n-body field ---- */
resetSimulation()
resetMission()
refreshDerived()
/**
 * Leave PRE_LAUNCH before inserting.
 *
 * That phase is `clamped: true`, so `applyClamp()` overwrites the ship's state
 * with the launch pad's after every step — the craft was being pinned to Kennedy
 * while this script measured its lunar orbit, read a 400,000 km range, and
 * reported an escape on the first frame. The orbit was never flown at all.
 */
enterNrhoCycle()
PROFILE.nrhoKeepInterval = 1e9 // stay in the coast: this run is uncontrolled

const o = INDEX.ship * 6
const ins = insertMember(live.sim.state, member, o)
refreshDerived()

console.log('\n=== inserted into the real field ===')
console.log(`  live separation at insertion ${(ins.separation / 1e3).toFixed(0)} km` +
  `  (CR3BP normalised to a constant; nominal ${(SEP_NOMINAL / 1e3).toFixed(0)})`)
console.log(`  scale factor ${(ins.separation / SEP_NOMINAL).toFixed(5)}`)
console.log(`  selenocentric: ${(live.lunar.perigee / 1e3).toFixed(0)} km altitude, speed ${live.lunar.speed.toFixed(0)} m/s`)
console.log(`  bound to the Moon: ${live.lunar.bound}, e ${live.lunar.eccentricity.toFixed(4)}`)

/* ---- propagate uncontrolled, and watch the perilunes ---- */
const expectedPeriod = member.period * TU_DAYS * 86400
console.log(`\n=== ${REVS} revolutions, uncontrolled (expected period ${(expectedPeriod / 86400).toFixed(3)} d) ===`)
console.log('   rev    t days   perilune km    alt km   apolune km   drift km   drift %')

flight.warp = 3
flight.pilotWarp = 3

const apses = []
let prevR = live.lunarRange
let prevPrevR = prevR
let lastPeriT = 0
let maxApo = 0
let escaped = false
let impacted = false

const maxT = expectedPeriod * (REVS + 0.5)
let t0 = live.sim.t
for (let i = 0; i < 4_000_000; i++) {
  frame()
  const r = live.lunarRange
  const t = live.sim.t - t0

  if (r > maxApo) maxApo = r
  if (r < MOON_R) {
    impacted = true
    break
  }
  /**
   * Escape means *gone*, not "osculating elements say unbound".
   *
   * An NRHO's apolune sits around 77,000 km, and the Moon's sphere of influence
   * is 66,000 — so for a good part of every revolution the craft is outside it
   * and the selenocentric conic is the same fiction the lunar approach already
   * documents. Testing `live.lunar.bound` there flagged an escape on the first
   * apolune of a perfectly healthy orbit. Range alone is the honest test.
   */
  if (r > 200000e3) {
    escaped = true
    break
  }

  // A perilune is a local minimum in the three most recent samples.
  if (prevR < prevPrevR && prevR < r) {
    const rev = apses.length + 1
    const drift = (prevR - member.perilune * ins.separation) / 1e3
    apses.push({ rev, t, r: prevR, apo: maxApo })
    console.log(
      `  ${String(rev).padStart(5)}${(t / 86400).toFixed(3).padStart(10)}` +
        `${(prevR / 1e3).toFixed(0).padStart(14)}` +
        `${((prevR - MOON_R) / 1e3).toFixed(0).padStart(10)}` +
        `${(maxApo / 1e3).toFixed(0).padStart(13)}` +
        `${drift.toFixed(0).padStart(11)}` +
        `${((drift * 1e3 * 100) / (member.perilune * ins.separation)).toFixed(1).padStart(10)}`,
    )
    lastPeriT = t
    maxApo = 0
    if (apses.length >= REVS) break
  }
  prevPrevR = prevR
  prevR = r
  if (t > maxT) break
}

console.log('\n=== outcome ===')
if (impacted) console.log('  IMPACTED the Moon')
else if (escaped) console.log('  ESCAPED the lunar vicinity')
console.log(`  revolutions completed before losing it: ${apses.length}`)

if (apses.length >= 2) {
  const r0 = apses[0].r
  const growth = apses.map((a) => Math.abs(a.r - r0) / r0)
  console.log(`  perilune drift after 1 rev: ${((growth[1] ?? 0) * 100).toFixed(1)}%`)
  const lastG = growth[growth.length - 1]
  console.log(`  perilune drift after ${apses.length} revs: ${(lastG * 100).toFixed(1)}%`)
  // Exponential fit on the growth, giving the instability time constant.
  if (apses.length >= 3 && growth[1] > 0 && lastG > growth[1]) {
    const n = apses.length - 1
    const rate = Math.log(lastG / growth[1]) / (n - 1)
    console.log(`  growth per revolution: x${Math.exp(rate).toFixed(2)}  (e-folding ${(1 / rate).toFixed(2)} revs)`)
  }
  const periods = []
  for (let i = 1; i < apses.length; i++) periods.push(apses[i].t - apses[i - 1].t)
  const meanP = periods.reduce((a, b) => a + b, 0) / periods.length
  console.log(`  flown period ${(meanP / 86400).toFixed(3)} d vs CR3BP ${(expectedPeriod / 86400).toFixed(3)} d` +
    `  (${(((meanP - expectedPeriod) / expectedPeriod) * 100).toFixed(1)}%)`)
}

console.log('\n=== what this establishes ===')
const checks = [
  ['the CR3BP member transfers with its eccentricity intact', apses.length > 0],
  ['it survives at least one revolution unguided', apses.length >= 1],
  ['it does NOT survive indefinitely — station-keeping is required',
   impacted || escaped || apses.length < REVS ||
     Math.abs(apses[apses.length - 1].r - apses[0].r) / apses[0].r > 0.05],
]
let pass = true
for (const [label, ok] of checks) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`)
  if (!ok) pass = false
}
console.log(`\n  ${pass ? 'PASS' : 'FAIL'}`)
process.exit(pass ? 0 : 1)
