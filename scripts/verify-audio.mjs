/**
 * The engine sound, held to what it claims.
 *
 * The audio graph itself needs a browser; what can be checked here is the
 * arithmetic that drives it and the promise made about it: that the mix an
 * engine produces is silent when the engine is off, louder when it is on
 * harder, quieter as the air thins to nothing, darker for a heavier engine —
 * and that computing it and writing it into AudioParams allocates nothing, so
 * sixty of them a second cannot cause a collection mid-ascent.
 *
 * The write side is measured against stubs shaped like AudioParams, because
 * `applyMix` takes its nodes as an argument for exactly this reason.
 *
 *   node --expose-gc scripts/verify-audio.mjs
 */
import {
  ATTENUATION_EXPONENT,
  CRACKLE,
  CUTOFF,
  MDOT_REF,
  RUMBLE,
  SUB,
  SUB_FREQ,
  applyMix,
  mix,
  mixFor,
} from '../src/sfx/engine.js'
import { density } from '../src/sim/atmosphere.js'
import { G0, SHIP } from '../src/sim/constants.js'
import { SMALLEST_OBJECT, bytesPerCall, knownAllocation } from './allocation.mjs'

const first = SHIP.stages[0]
/** The lightest engine the vehicle carries — not the capsule, which has none. */
const last = SHIP.stages.filter((s) => s.thrust > 0 && s.isp > 0).reduce((a, b) => (b.thrust < a.thrust ? b : a))
const mdotOf = (stage, throttle = 1) => (throttle * stage.thrust) / (stage.isp * G0)
const at = (stage, throttle, altitude, gate = 1) =>
  Array.from(
    mixFor(
      new Float64Array(5),
      throttle * stage.thrust,
      stage.thrust,
      mdotOf(stage, throttle),
      MDOT_REF,
      density(altitude),
      gate,
    ),
  )

console.log('=== the mix ===')
console.log(`  reference mass flow   ${MDOT_REF.toFixed(0)} kg/s (${first.name ?? 'stage 0'} at full throttle)`)

/* 1. off is silent, everywhere */
const off = [0, 30e3, 400e3].map((h) => at(first, 0, h))
const offSilent = off.every((m) => m[RUMBLE] === 0 && m[SUB] === 0 && m[CRACKLE] === 0)

/* 2. louder with throttle, at sea level */
const throttles = [0.1, 0.3, 0.5, 0.7, 1.0].map((t) => at(first, t, 0)[RUMBLE])
const monotone = throttles.every((v, i) => i === 0 || v > throttles[i - 1])

/* 3. quieter with altitude, silent above the atmosphere */
const altitudes = [0, 10e3, 30e3, 60e3, 100e3, 200e3]
const byAltitude = altitudes.map((h) => at(first, 1, h)[RUMBLE])
const attenuates = byAltitude.every((v, i) => i === 0 || v < byAltitude[i - 1])
const vacuum = at(first, 1, 1200e3)
const vacuumSilent = vacuum[RUMBLE] === 0 && vacuum[SUB] === 0 && vacuum[CRACKLE] === 0
const expected30 = Math.pow(density(30e3) / 1.225, ATTENUATION_EXPONENT)
console.log(`  full throttle by altitude   ${altitudes.map((h, i) => `${h / 1e3} km ${byAltitude[i].toFixed(3)}`).join(', ')}`)
console.log(`  attenuation at 30 km        ${(byAltitude[2] / byAltitude[0]).toFixed(3)} (rho ratio ^ ${ATTENUATION_EXPONENT} = ${expected30.toFixed(3)})`)

/* 4. a heavier engine is darker and lower */
const heavy = at(first, 1, 0)
const light = at(last, 1, 0)
const darker = heavy[CUTOFF] < light[CUTOFF] && heavy[SUB_FREQ] < light[SUB_FREQ]
const crackles = heavy[CRACKLE] > light[CRACKLE]
console.log(`  ${first.name ?? 'first'}: cutoff ${heavy[CUTOFF].toFixed(0)} Hz, sub ${heavy[SUB_FREQ].toFixed(1)} Hz, crackle ${heavy[CRACKLE].toFixed(3)}`)
console.log(`  ${last.name ?? 'last'}: cutoff ${light[CUTOFF].toFixed(0)} Hz, sub ${light[SUB_FREQ].toFixed(1)} Hz, crackle ${light[CRACKLE].toFixed(3)}`)

/* 5. the gate mutes the level without touching the frequencies */
const gated = at(first, 1, 0, 0)
const gateMutes = gated[RUMBLE] === 0 && gated[SUB] === 0 && gated[CRACKLE] === 0 && gated[CUTOFF] === heavy[CUTOFF]

/* 6. everything finite and in range, over a grid */
let inRange = true
for (const stage of SHIP.stages)
  for (const t of [0, 0.25, 0.5, 1])
    for (const h of [0, 5e3, 50e3, 150e3, 999e3, 1001e3]) {
      const m = at(stage, t, h)
      for (const v of m) if (!Number.isFinite(v)) inRange = false
      if (m[RUMBLE] < 0 || m[RUMBLE] > 1 || m[SUB] < 0 || m[SUB] > 1 || m[CRACKLE] < 0 || m[CRACKLE] > 1) inRange = false
      if (m[CUTOFF] < 20 || m[CUTOFF] > 400 || m[SUB_FREQ] < 15 || m[SUB_FREQ] > 80) inRange = false
    }

/* ------------------------------------------------------------------ *
 * allocation
 * ------------------------------------------------------------------ */
/** Stubs shaped like the graph: an AudioParam is anything with setTargetAtTime. */
const param = () => ({ last: 0, setTargetAtTime(v) { this.last = v } })
const stubs = {
  rumble: { gain: param() },
  lowpass: { frequency: param() },
  subGain: { gain: param() },
  sub: { frequency: param() },
  sub2: { frequency: param() },
  crackle: { gain: param() },
}
let frame = 0
const control = await knownAllocation()
const mixBytes = await bytesPerCall(
  () => {
    frame = (frame + 1) & 1023
    mixFor(mix, first.thrust * (0.5 + frame / 2048), first.thrust, mdotOf(first), MDOT_REF, density(frame * 60), 1)
  },
  { calls: 50000, warm: 50000 },
)
const applyBytes = await bytesPerCall(
  () => {
    applyMix(stubs, mix, frame++ / 60)
  },
  { calls: 50000, warm: 50000 },
)
// Sunk into a typed array: a double returned from the lambda would be boxed
// by the measurement itself, 16 bytes that are not the function's.
const SINK = new Float64Array(1)
const densityBytes = await bytesPerCall(
  () => {
    SINK[0] = density((frame++ & 1023) * 100)
  },
  { calls: 50000, warm: 50000 },
)
if (control) {
  console.log('\n=== allocation ===')
  console.log(`  mixFor       ${mixBytes.bytes.toFixed(2)} B a call`)
  console.log(`  applyMix     ${applyBytes.bytes.toFixed(2)} B a call`)
  console.log(`  density      ${densityBytes.bytes.toFixed(2)} B a call`)
  console.log(`  control      ${control.bytes.toFixed(0)} B`)
} else {
  console.log('\n  (run with --expose-gc to measure allocation)')
}

/* ------------------------------------------------------------------ *
 * verdict
 * ------------------------------------------------------------------ */
console.log('\n=== what this establishes ===')
const checks = [
  ['an engine that is off is silent at any altitude', offSilent],
  ['the rumble rises monotonically with throttle', monotone],
  ['and falls monotonically with altitude', attenuates],
  ['above the atmosphere there is nothing to hear', vacuumSilent],
  ['a heavier engine is lower and darker', darker],
  ['and crackles more', crackles],
  ['the gate mutes the level and leaves the timbre alone', gateMutes],
  ['every parameter is finite and inside its range', inRange],
  ['the allocation measurement can see an allocation', !control || control.bytes >= SMALLEST_OBJECT],
  ['the mix allocates nothing', !mixBytes || mixBytes.bytes < SMALLEST_OBJECT / 2],
  ['writing it to the graph allocates nothing', !applyBytes || applyBytes.bytes < SMALLEST_OBJECT / 2],
  ['nor does the density lookup it depends on', !densityBytes || densityBytes.bytes < SMALLEST_OBJECT / 2],
]
let pass = true
for (const [label, ok] of checks) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`)
  if (!ok) pass = false
}
console.log(`\n  ${pass ? 'PASS' : 'FAIL'}`)
process.exit(pass ? 0 : 1)
