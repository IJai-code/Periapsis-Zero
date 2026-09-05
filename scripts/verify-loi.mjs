/**
 * Fly the lunar orbit insertion and measure what it achieved.
 *
 * The osculating elements at cutoff say what orbit the state vector represents.
 * They are not, on their own, evidence: they are the same formula the cutoff
 * criterion reads, so quoting them back is circular. So the achieved orbit is
 * then flown — several revolutions in the live integrator — and the apoapsis,
 * periapsis and period that come out of that propagation are compared against
 * what the elements claimed at the moment the engine shut down.
 *
 *   node scripts/verify-loi.mjs <approach-snapshot.json> [--save orbit.json]
 */

import { flight, frame, loadSnapshot, saveSnapshot } from './flight.mjs'
import { WARP } from '../src/sim/warp.js'
import { live } from '../src/sim/live.js'
import { currentPhase, mission } from '../src/sim/mission.js'
import { deltaV, ship, totalMass } from '../src/sim/ship.js'
import { BODIES } from '../src/sim/constants.js'

const R_MOON = BODIES.moon.radius
const snap = process.argv[2]
if (!snap) {
  console.error('usage: node scripts/verify-loi.mjs <approach-snapshot.json>')
  process.exit(1)
}
loadSnapshot(snap)

const km = (m) => (m / 1e3).toFixed(2)
const alt = (m) => ((m - R_MOON) / 1e3).toFixed(2)

console.log(`from ${currentPhase().id} at MET ${(mission.t / 3600).toFixed(2)} h\n`)

let last = currentPhase().id
let burnLog = []
let cutoffSnapshot = null
let separations0 = ship.separations
let stagedDuringBurn = false

for (let i = 0; i < 6_000_000; i++) {
  // Outside the SOI the sequencer leaves warp to the pilot.
  flight.pilotWarp = mission.warpRequest === null ? WARP.h6 : null
  frame()

  const id = currentPhase().id
  if (id !== last) {
    const l = live.lunar
    console.log(
      `  ${(last + ' -> ' + id).padEnd(30)} MET ${(mission.t / 3600).toFixed(4)} h  ` +
        `range ${km(l.radius).padStart(9)} km  e ${l.eccentricity.toFixed(5)}  ` +
        `mass ${(totalMass() / 1e3).toFixed(3)} t  point err ${(mission.loi.pointingError * 1e3).toFixed(2)} mrad`,
    )
    if (last === 'LOI_ALIGN' || (last === 'LOI_BURN' && id !== 'STAGING')) {
      // nothing extra
    }
    if (id === 'LUNAR_ORBIT') {
      cutoffSnapshot = {
        e: live.lunar.eccentricity,
        a: live.lunar.semiMajor,
        rp: live.lunar.periapsisRadius,
        ra: live.lunar.apoapsisRadius,
        period: live.lunar.period,
        r: live.lunar.radius,
        v: live.lunar.speed,
      }
    }
    last = id
  }

  if (id === 'LOI_BURN' || id === 'STAGING') {
    if (ship.separations > separations0) stagedDuringBurn = true
    const rel = mission.t - mission.loi.burnStart
    if (burnLog.length === 0 || rel - burnLog[burnLog.length - 1].t > 10) {
      burnLog.push({
        t: rel,
        e: live.lunar.eccentricity,
        r: live.lunar.radius,
        rp: live.lunar.periapsisRadius,
        ra: live.lunar.apoapsisRadius,
        v: live.lunar.speed,
        m: totalMass(),
        phase: id,
        point: mission.loi.pointingError,
      })
    }
  }

  if (id === 'LUNAR_ORBIT' && mission.t - mission.loi.burnStart > mission.loi.burnDuration + 5) break
}

/* ---------------------------------------------------------------- */

console.log('\n=== burn profile (selenocentric) ===')
console.log('    t     phase       range      r_p       r_a         e        v      mass   point')
for (const b of burnLog) {
  console.log(
    `  ${b.t.toFixed(1).padStart(6)} ${b.phase.padEnd(11)} ${km(b.r).padStart(8)} ${km(b.rp).padStart(8)} ` +
      `${(Number.isFinite(b.ra) ? km(b.ra) : 'escape').padStart(10)} ${b.e.toFixed(5).padStart(8)} ` +
      `${b.v.toFixed(1).padStart(7)} ${(b.m / 1e3).toFixed(2).padStart(7)} ${(b.point * 1e3).toFixed(2).padStart(6)}`,
  )
}

const loi = mission.loi
console.log('\n=== burn summary ===')
console.log(`  estimated dv      ${loi.deltaVEstimate.toFixed(2)} m/s   estimated duration ${loi.burnEstimate.toFixed(1)} s`)
console.log(`  delivered dv      ${loi.deltaVDelivered.toFixed(2)} m/s   flown duration     ${loi.burnDuration.toFixed(1)} s`)
console.log(`  start mass        ${loi.startMass.toFixed(1)} kg -> ${totalMass().toFixed(1)} kg`)
console.log(`  staged mid-burn   ${stagedDuringBurn}`)
console.log(`  cutoff criterion  ${loi.cutoff}`)
console.log(`  minimum radius    ${km(loi.minRadius)} km = ${alt(loi.minRadius)} km altitude`)
console.log(`  dv remaining      ${deltaV().toFixed(1)} m/s`)

const c = cutoffSnapshot
console.log('\n=== osculating orbit at cutoff ===')
console.log(`  a ${km(c.a)} km   e ${c.e.toFixed(6)}`)
console.log(`  periapsis ${km(c.rp)} km = ${alt(c.rp)} km altitude`)
console.log(`  apoapsis  ${km(c.ra)} km = ${alt(c.ra)} km altitude`)
console.log(`  period    ${c.period.toFixed(1)} s = ${(c.period / 60).toFixed(2)} min`)

/* ---------------------------------------------------------------- *
 * Independent check: fly the achieved orbit and measure it.
 * ---------------------------------------------------------------- */

console.log('\n=== flown orbit, three revolutions in the live integrator ===')
let rMin = Infinity
let rMax = 0
let tMin = 0
let tMax = 0
const t0 = mission.t
const revs = []
let prevR = live.lunar.radius
let climbing = live.lunar.vertical > 0
let lastPeriT = null

flight.pilotWarp = WARP.m1
for (let i = 0; i < 3_000_000; i++) {
  frame()
  const r = live.lunar.radius
  if (r < rMin) {
    rMin = r
    tMin = mission.t
  }
  if (r > rMax) {
    rMax = r
    tMax = mission.t
  }
  // Periapsis passages, for an independent period.
  const nowClimbing = r > prevR
  if (nowClimbing && !climbing) {
    if (lastPeriT !== null) revs.push(mission.t - lastPeriT)
    lastPeriT = mission.t
  }
  climbing = nowClimbing
  prevR = r
  if (revs.length >= 3) break
  if (mission.t - t0 > 6 * c.period) break
}

console.log(`  flown periapsis  ${km(rMin)} km = ${alt(rMin)} km altitude`)
console.log(`  flown apoapsis   ${km(rMax)} km = ${alt(rMax)} km altitude`)
console.log(`  flown periods    ${revs.map((r) => r.toFixed(1)).join(', ')} s`)

const meanPeriod = revs.reduce((a, b) => a + b, 0) / (revs.length || 1)
console.log('\n=== agreement: osculating elements vs independent propagation ===')
console.log(`  periapsis  ${km(c.rp)} vs ${km(rMin)} km   diff ${((rMin - c.rp) / 1e3).toFixed(3)} km`)
console.log(`  apoapsis   ${km(c.ra)} vs ${km(rMax)} km   diff ${((rMax - c.ra) / 1e3).toFixed(3)} km`)
console.log(`  period     ${c.period.toFixed(1)} vs ${meanPeriod.toFixed(1)} s   diff ${(meanPeriod - c.period).toFixed(2)} s`)

const saveIdx = process.argv.indexOf('--save')
if (saveIdx > 0) {
  saveSnapshot(process.argv[saveIdx + 1])
  console.log(`\n  state written to ${process.argv[saveIdx + 1]}`)
}
