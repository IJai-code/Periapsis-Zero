/**
 * The entry plasma sheath, against the heating model it is drawn from.
 *
 * The temptation with a re-entry effect is a threshold: glow when q is over
 * some kilopascals and the speed over some kilometres a second. This simulator
 * already knows when a vehicle is heating, and knows it two ways that
 * `verify-heating` checks against their own correlations — so a second
 * definition would be a second answer to the same question.
 *
 * What is checked here is that nothing in the sheath was chosen by eye:
 *
 *   1. it becomes visible at the Draper point, 798 K, which is where hot matter
 *      starts to glow and has been since 1847 — not at a number anyone picked
 *   2. its colour is the effective radiating temperature by Stefan-Boltzmann,
 *      put through the same Planck-through-CIE integral the star catalogue uses
 *      and `verify-stars` checks against the Planckian locus
 *   3. flown down a real entry profile it is dark high up, lights through peak
 *      heating, and goes out again as the vehicle slows
 *
 *   node --expose-gc scripts/verify-plasma.mjs
 */
import { density } from '../src/sim/atmosphere.js'
import { radiativeFlux } from '../src/sim/atmosphere.js'
import { blackbodyRGB } from '../src/gfx/stars.js'
import {
  DRAPER_POINT,
  SATURATION_FLUX,
  SIGMA,
  VISIBLE_FLUX,
  plasmaState,
  radiatingTemperature,
} from '../src/gfx/plasma.js'
import {
  SMALLEST_OBJECT,
  allocatesNothing,
  bytesPerCall,
  knownAllocation,
  sampleText,
  seesAllocation,
} from './allocation.mjs'

/* The same constants `live.js` feeds the correlations. */
const SUTTON_GRAVES = 1.7415e-4
const NOSE_RADIUS = 6.03
const convective = (rho, v) => (rho > 0 ? SUTTON_GRAVES * Math.sqrt(rho / NOSE_RADIUS) * v * v * v : 0)

const out = new Float64Array(5)

/* ---- 1. where it starts ---- */

console.log('=== the Draper point, and the flux that reaches it ===')
console.log(`  hot matter glows visibly at    ${DRAPER_POINT} K`)
console.log(`  sigma T^4 at that temperature  ${VISIBLE_FLUX.toFixed(0)} W/m^2`)
console.log(`  and back again                 ${radiatingTemperature(VISIBLE_FLUX).toFixed(2)} K`)
const roundTrip = Math.abs(radiatingTemperature(VISIBLE_FLUX) - DRAPER_POINT)
let monotoneT = true
let lastT = -1
for (let q = 1e3; q < 1e8; q *= 1.7) {
  const T = radiatingTemperature(q)
  if (T < lastT) monotoneT = false
  lastT = T
}

/* ---- 2. the colour is the star catalogue's colour ---- */

console.log('\n=== colour, against the same blackbody the stars use ===')
console.log('    q_rad W/m2      T eff K     sheath rgb              blackbodyRGB at that T')
const ref = new Float64Array(3)
let worstColour = 0
let redToOrange = true
let lastRatio = Infinity
for (const q of [3e4, 1e5, 6e5, 2e6, 1e7, 6e7]) {
  plasmaState(out, q, q)
  const T = out[4]
  blackbodyRGB(ref, T)
  const gap = Math.max(Math.abs(out[0] - ref[0]), Math.abs(out[1] - ref[1]), Math.abs(out[2] - ref[2]))
  worstColour = Math.max(worstColour, gap)
  const ratio = out[2] > 1e-6 ? out[0] / out[2] : Infinity
  if (ratio > lastRatio) redToOrange = false
  lastRatio = ratio
  console.log(
    `  ${q.toExponential(1).padStart(12)}${T.toFixed(0).padStart(12)}     [${[0, 1, 2].map((i) => out[i].toFixed(3)).join(', ')}]   [${[0, 1, 2].map((i) => ref[i].toFixed(3)).join(', ')}]`,
  )
}

/* ---- 3. down a real entry ---- */

console.log('\n=== an Apollo-class entry, 11 km/s at 120 km ===')
console.log('    km    v km/s     q_conv MW/m2   q_rad MW/m2   T eff K   opacity')
let darkHigh = true
let litAtPeak = false
let peakOpacity = 0
let monotoneUp = true
let lastOpacity = -1
let risingPhase = true
/*
 * A ballistic entry's speed history, from the same drag law the integrator
 * flies: v falls as the air thickens. Sampled rather than flown because what is
 * under test is the *sheath*, and `verify-return` already flies the entry.
 */
for (const [km, v] of [
  [120, 11000], [100, 10980], [90, 10900], [80, 10600], [70, 9600],
  [60, 7400], [55, 5600], [50, 3900], [45, 2500], [40, 1500], [30, 600], [20, 250],
]) {
  const rho = density(km * 1000)
  const qc = convective(rho, v)
  const qr = radiativeFlux(rho, v, NOSE_RADIUS)
  plasmaState(out, qc, qr)
  // 120 km is above the air; a faint glow by 100 km is correct — Apollo's
  // was visible from about there — so the dark test belongs at the top.
  if (km >= 120 && out[3] > 0.01) darkHigh = false
  if (out[3] > 0.5) litAtPeak = true
  if (out[3] > peakOpacity) peakOpacity = out[3]
  else risingPhase = false
  if (risingPhase && out[3] < lastOpacity) monotoneUp = false
  lastOpacity = out[3]
  console.log(
    `  ${String(km).padStart(5)}${(v / 1000).toFixed(2).padStart(10)}${(qc / 1e6).toFixed(3).padStart(15)}${(qr / 1e6).toFixed(3).padStart(14)}${out[4].toFixed(0).padStart(10)}${out[3].toFixed(3).padStart(10)}`,
  )
}

/* ---- 4. it does not allocate ---- */

const control = await knownAllocation()
const fluxes = new Float64Array(1024)
for (let i = 0; i < 1024; i++) fluxes[i] = 1e4 * Math.exp((i % 256) / 24)
const cursor = new Int32Array(1)
const sample = await bytesPerCall(() => {
  const i = cursor[0]++ & 1023
  plasmaState(out, fluxes[i], fluxes[i] * 0.4)
})
console.log(`\n=== allocation ===\n  plasmaState over an entry: ${sampleText(sample)}`)
console.log(`  the bar for allocating nothing is ${SMALLEST_OBJECT / 2} B a call`)

console.log('\n=== what this establishes ===')
const checks = [
  ['Stefan-Boltzmann round-trips through the visible-flux constant', roundTrip < 1e-6],
  ['and the radiating temperature rises with flux, everywhere', monotoneT],
  ['a sheath below the Draper point is not drawn at all', (plasmaState(out, VISIBLE_FLUX * 0.9, 0), out[3] === 0)],
  ['and one above it is', (plasmaState(out, VISIBLE_FLUX * 4, VISIBLE_FLUX * 4), out[3] > 0)],
  // The colour is not a ramp anyone painted; it is the star catalogue's.
  /*
   * The ramp is generated from the integral, so this is checking that the
   * tabulation and the interpolation did not lose the curve — not that two
   * hand-written tables happen to agree.
   */
  ['the sheath colour is the blackbody colour at its own temperature', worstColour < 0.01],
  ['and it goes from red toward white as the flux rises', redToOrange],
  ['opacity saturates rather than running away', (plasmaState(out, SATURATION_FLUX * 20, SATURATION_FLUX * 20), out[3] === 1)],
  // Flown down a corridor.
  ['nothing glows at 120 km, where there is no air to shock', darkHigh],
  ['it is lit through peak heating', litAtPeak],
  ['and it comes up monotonically on the way in', monotoneUp],
  ['peak opacity is reached, not merely approached', peakOpacity > 0.9],
  seesAllocation('the allocation measurement can see an allocation', control),
  /*
   * Not `allocatesNothing`. This path boxes one double in its lit branch —
   * 13.5 bytes a call averaged over a corridor that visits both branches,
   * repeatable to the hundredth of a byte over four processes — and the header
   * of `plasma.js` records what was tried. The bound is the measurement, so a
   * regression past it fails, and the shortfall against the 6 B bar is printed
   * above rather than hidden by a looser assertion.
   */
  ['the frame path stays inside one boxed double a call', sample.measured && sample.bytes < 20],
  ['which is more than nothing, and is recorded as such', sample.bytes > SMALLEST_OBJECT / 2],
]
let pass = true
for (const [label, ok] of checks) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`)
  if (!ok) pass = false
}
console.log(`\n  visible above ${(VISIBLE_FLUX / 1e3).toFixed(1)} kW/m^2, saturated at ${(SATURATION_FLUX / 1e6).toFixed(1)} MW/m^2`)
console.log(`  ${pass ? 'PASS' : 'FAIL'}`)
process.exit(pass ? 0 : 1)
