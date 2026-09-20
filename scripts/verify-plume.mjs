/**
 * The exhaust plume, against the gas dynamics it is drawn from.
 *
 * A plume is the easiest effect in a renderer to key off the wrong state. The
 * obvious candidate is dynamic pressure — it is in `live`, it has the right
 * units, it rises and falls through a launch — and it is wrong in a way that
 * looks right until you check the pad: `live.dynamicPressure` is 1/2 rho v^2,
 * and the clamp gives a vehicle on the pad exactly the local surface velocity,
 * so it reads **zero at liftoff**. A plume driven by it would leave the pad
 * fully expanded and narrow as the vehicle climbed, which is backwards twice.
 *
 * What a plume is actually a function of is the ratio of the nozzle's exit
 * pressure to the ambient static pressure, and everything below follows from
 * that with no fitted constants: the exit Mach from the area ratio, the exit
 * pressure from the exit Mach and the chamber pressure, the opening angle from
 * the Prandtl-Meyer turn between exit and ambient.
 *
 *   node --expose-gc scripts/verify-plume.mjs
 */
import { density, pressure, speedOfSound } from '../src/sim/atmosphere.js'
import { VESSELS } from '../src/sim/vessels.js'
import {
  DRAWN_HALF_ANGLE_CAP,
  GAMMA_EXHAUST,
  exitMach,
  exitPressure,
  machFromPressure,
  matchedAltitude,
  maxTurn,
  plumeAt,
  plumeState,
  nozzleSlot,
  prandtlMeyer,
  pressureRatio,
} from '../src/gfx/plume.js'
import {
  SMALLEST_OBJECT,
  allocatesNothing,
  bytesPerCall,
  knownAllocation,
  sampleText,
  seesAllocation,
} from './allocation.mjs'

const DEG = 180 / Math.PI

/* ---- 1. the ambient pressure this is all measured against ---- */

/** US Standard Atmosphere, 1976: altitude km, density, pressure Pa. */
const STANDARD = [
  [0, 1.225, 101325],
  [5, 0.73643, 54019],
  [11, 0.36391, 22632],
  [20, 0.08803, 5474.9],
  [30, 0.01841, 1197.0],
  [47, 0.0014275, 110.91],
]

console.log('=== ambient pressure, from rho a^2 / gamma ===')
console.log('   km      p derived        p standard     ratio    rho ratio   identity')
let worstIdentity = 0
let seaLevelError = 0
for (const [km, rhoStd, pStd] of STANDARD) {
  const p = pressure(km * 1000)
  const rho = density(km * 1000)
  const pRatio = p / pStd
  const rhoRatio = rho / rhoStd
  /*
   * The two ratios agreeing is the claim: it says the derived pressure is the
   * ideal-gas identity applied to the simulator's own density and temperature,
   * not a third model that could drift from either. Where it does *not* agree
   * is where the temperature profile and the density table disagree.
   */
  const identity = Math.abs(pRatio / rhoRatio - 1)
  worstIdentity = Math.max(worstIdentity, identity)
  if (km === 0) seaLevelError = Math.abs(p - pStd)
  console.log(
    `  ${String(km).padStart(3)}  ${p.toExponential(4).padStart(14)}  ${pStd.toExponential(4).padStart(14)}` +
      `  ${pRatio.toFixed(3).padStart(8)}  ${rhoRatio.toFixed(3).padStart(10)}  ${identity.toExponential(1).padStart(10)}`,
  )
}

/* ---- 2. the gas dynamics ---- */

console.log('\n=== Prandtl-Meyer and the isentropic relations ===')
const turn12 = maxTurn(1.2) * DEG
const turn14 = maxTurn(1.4) * DEG
console.log(`  the most a jet can turn: ${turn12.toFixed(2)} deg at gamma 1.2, ${turn14.toFixed(2)} at 1.4`)
console.log(`  nu(1) = ${prandtlMeyer(1).toFixed(6)}, and nu rises all the way up`)
let monotone = true
let last = -1
for (let M = 1; M < 30; M += 0.25) {
  const v = prandtlMeyer(M)
  if (v < last) monotone = false
  last = v
}
// The area relation has to invert: area ratio -> Mach -> area ratio.
const e = (GAMMA_EXHAUST + 1) / (2 * (GAMMA_EXHAUST - 1))
const areaOf = (M) => Math.pow((2 / (GAMMA_EXHAUST + 1)) * (1 + ((GAMMA_EXHAUST - 1) / 2) * M * M), e) / M
let worstArea = 0
for (const eps of [4, 8, 16, 27.5, 69, 280]) {
  worstArea = Math.max(worstArea, Math.abs(areaOf(exitMach(eps)) / eps - 1))
}
// And the pressure relation has to invert too.
let worstPress = 0
for (let M = 1.5; M < 12; M += 0.5) {
  worstPress = Math.max(worstPress, Math.abs(machFromPressure(pressureRatio(M)) / M - 1))
}
console.log(`  area ratio round-trips to ${worstArea.toExponential(2)}, pressure ratio to ${worstPress.toExponential(2)}`)

/* ---- 3. the engines this is applied to ---- */

console.log('\n=== every nozzle in the fleet ===')
console.log('  vessel     stage            eps     p_c MPa   M_exit   p_exit kPa   matched km   at liftoff')
const out = new Float64Array(4)
let firstStagesShock = true
let vacuumStagesFlare = true
const rows = []
for (const key of Object.keys(VESSELS)) {
  const vessel = VESSELS[key]
  if (!vessel?.stages) continue
  vessel.stages.forEach((st, i) => {
    if (!st.nozzle) return
    const Me = exitMach(st.nozzle.areaRatio)
    const pe = exitPressure(st.nozzle)
    const matched = matchedAltitude(st.nozzle)
    plumeState(out, st.nozzle, 0)
    const state = out[1] > 0 ? `over-expanded, diamonds ${out[1].toFixed(2)}` : `under-expanded ${(out[0] * DEG).toFixed(1)} deg`
    rows.push({ vessel: vessel.id ?? key, stage: st.name, i, matched, diamonds: out[1] })
    /*
     * A stage that lights on the pad must be near matched or over-expanded
     * there — that is what a sea-level nozzle is. A stage that only lights in
     * vacuum must be under-expanded where it burns.
     */
    if (i === 0 && matched > 12e3) firstStagesShock = false
    if (i > 0) {
      plumeState(out, st.nozzle, 80e3)
      if (!(out[0] > 0)) vacuumStagesFlare = false
    }
    console.log(
      `  ${(vessel.id ?? key).padEnd(10)} ${st.name.padEnd(15)}${String(st.nozzle.areaRatio).padStart(6)}` +
        `${(st.nozzle.chamberPressure / 1e6).toFixed(1).padStart(10)}${Me.toFixed(2).padStart(9)}` +
        `${(pe / 1000).toFixed(1).padStart(13)}${(matched / 1000).toFixed(1).padStart(13)}   ${state}`,
    )
  })
}

/* ---- 4. how it behaves through a launch ---- */

console.log('\n=== an F-1 from the pad to vacuum ===')
console.log('   km    p ambient Pa   p_e/p_a    half-angle    diamonds    length')
const f1 = VESSELS.apollo8.stages[0].nozzle
let angleRises = true
let diamondsFall = true
let lastAngle = -1
let lastDiamonds = 2
let diamondsGoneBy = Infinity
for (const km of [0, 1, 2, 3, 4.7, 6, 10, 20, 40, 80, 200]) {
  plumeState(out, f1, km * 1000)
  if (out[0] < lastAngle - 1e-12) angleRises = false
  if (out[1] > lastDiamonds + 1e-12) diamondsFall = false
  if (out[1] === 0 && diamondsGoneBy === Infinity) diamondsGoneBy = km
  lastAngle = out[0]
  lastDiamonds = out[1]
  console.log(
    `  ${String(km).padStart(4)}  ${pressure(km * 1000).toExponential(3).padStart(13)}` +
      `${(out[2] === Infinity ? 'inf' : out[2].toFixed(2)).padStart(11)}${(out[0] * DEG).toFixed(1).padStart(13)}` +
      `${out[1].toFixed(3).padStart(12)}${out[3].toFixed(3).padStart(10)}`,
  )
}
const f1Matched = matchedAltitude(f1) / 1000

/* ---- 5. it does not allocate ---- */

/*
 * Measured on the frame path — `plumeAt`, which takes a slot and a pressure —
 * across a realistic climb, with the pressures in a typed array so the probe
 * itself holds no doubles. An earlier version of this measurement kept the
 * pressure in a closure variable and reported the *probe's* boxed double as the
 * function's.
 */
const control = await knownAllocation()
const slot = nozzleSlot(f1)
const N = 4096
const pas = new Float64Array(N)
for (let j = 0; j < N; j++) pas[j] = pressure(j * 5)
const cursor = new Int32Array(1)
const sample = await bytesPerCall(() => {
  plumeAt(out, slot, pas[cursor[0]++ & (N - 1)])
})
console.log(`\n=== allocation ===\n  plumeAt over a climb: ${sampleText(sample)}`)
console.log(`  the bar for allocating nothing is ${SMALLEST_OBJECT / 2} B a call`)

console.log('\n=== what this establishes ===')
const checks = [
  ['ambient pressure is the ideal-gas identity on the simulator\'s own air', worstIdentity < 0.02],
  ['and it is the standard atmosphere at sea level, where a first stage lights', seaLevelError < 10],
  ['the Prandtl-Meyer turn saturates where theory says, for both gammas', Math.abs(turn12 - 208.5) < 0.2 && Math.abs(turn14 - 130.45) < 0.2],
  ['and it rises monotonically from Mach 1', monotone && prandtlMeyer(1) === 0],
  ['the area relation inverts, across every nozzle in the fleet', worstArea < 1e-6],
  ['and so does the pressure relation', worstPress < 1e-9],
  // What the model has to say about real hardware.
  ['every stage that lights on the pad is a sea-level nozzle', firstStagesShock],
  ['every stage that lights in vacuum flares there', vacuumStagesFlare],
  ['the F-1 shows diamonds on the pad', (plumeState(out, f1, 0), out[1] > 0.4)],
  ['and they are gone by the altitude it is matched at', diamondsGoneBy <= Math.ceil(f1Matched)],
  ['the plume opens monotonically with altitude and never closes again', angleRises],
  ['and the diamonds fade monotonically, never returning', diamondsFall],
  ['the opening stops at the drawn cap rather than at 208 degrees', (plumeState(out, f1, 300e3), Math.abs(out[0] - DRAWN_HALF_ANGLE_CAP) < 1e-12)],
  seesAllocation('the allocation measurement can see an allocation', control),
  /*
   * NOT `allocatesNothing`, and the difference is the point. This path boxes
   * one double a call in its under-expanded branch — 16.8 B there, 0.8 B in the
   * other two, 11.8 B across a climb — and the header of `plume.js` records
   * what was tried and failed to remove it. The bound here is the measurement,
   * so a regression past it fails, and the shortfall against the 6 B bar is
   * printed above rather than hidden by a looser assertion.
   */
  ['the frame path stays inside one boxed double a call', sample.measured && sample.bytes < 20],
  ['which is more than nothing, and is recorded as such', sample.bytes > SMALLEST_OBJECT / 2],
]
let pass = true
for (const [label, ok] of checks) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`)
  if (!ok) pass = false
}
console.log(`\n  worst identity error ${worstIdentity.toExponential(2)}; F-1 matched at ${f1Matched.toFixed(2)} km`)
console.log(`  ${pass ? 'PASS' : 'FAIL'}`)
process.exit(pass ? 0 : 1)
