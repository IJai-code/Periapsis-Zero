/**
 * The CR3BP propagator and differential corrector, verified in the idealised
 * model before anything touches the mission.
 *
 * The check that matters is **full-period closure**. The corrector shoots a half
 * period and drives a symmetry condition to zero, which is sufficient for
 * periodicity only if the symmetry argument holds; flying the whole way round
 * and comparing against the initial condition tests that independently. An orbit
 * that satisfied the half-period residual without closing would pass the
 * corrector and fail here, which is the point of doing both.
 *
 * The planar Lyapunov case is the control: its seed comes from the linearised
 * dynamics, and the linearisation is computed by finite-differencing the same
 * acceleration the propagator uses, so no coefficient can be transcribed wrong.
 * If the machinery is sound that orbit closes to integrator precision.
 *
 *   node scripts/verify-cr3bp.mjs
 */

import { BODIES } from '../src/sim/constants.js'
import { COLLINEAR, MU } from '../src/sim/lagrange.js'
import {
  cr3bpDerivative,
  correctPeriodicOrbit,
  closureError,
  orbitExtremes,
} from '../src/sim/cr3bp.js'

const SEP = 384400e3 // nominal, for reporting km — the model itself is normalised
const km = (nd) => ((nd * SEP) / 1e3).toFixed(0)
const L2 = COLLINEAR[1]

console.log('=== the model ===')
console.log(`  MU ${MU.toFixed(9)}   Earth at ${(-MU).toFixed(6)}, Moon at ${(1 - MU).toFixed(6)}`)
console.log(`  L1 ${COLLINEAR[0].toFixed(6)}   L2 ${L2.toFixed(6)}   L3 ${COLLINEAR[2].toFixed(6)}`)
console.log(`  Moon radius, normalised ${(BODIES.moon.radius / SEP).toFixed(6)}`)

/* ---- linearise about L2 by differencing the real acceleration ---- */
const y = new Float64Array(6)
const d = new Float64Array(6)
function accelAt(x, yy, z) {
  y[0] = x
  y[1] = yy
  y[2] = z
  y[3] = 0
  y[4] = 0
  y[5] = 0
  cr3bpDerivative(y, d)
  return [d[3], d[4], d[5]]
}
const h = 1e-6
const Uxx = (accelAt(L2 + h, 0, 0)[0] - accelAt(L2 - h, 0, 0)[0]) / (2 * h)
const Uyy = (accelAt(L2, h, 0)[1] - accelAt(L2, -h, 0)[1]) / (2 * h)
const Uzz = (accelAt(L2, 0, h)[2] - accelAt(L2, 0, -h)[2]) / (2 * h)

// lambda^4 + lambda^2 (Uxx + Uyy - 4) + Uxx Uyy = 0, oscillatory root.
const bq = Uxx + Uyy - 4
const disc = bq * bq - 4 * Uxx * Uyy
const s = (-bq + Math.sqrt(disc)) / 2
const lambda = Math.sqrt(s)
const nu = Math.sqrt(-Uzz)

console.log('\n=== linearisation at L2, from finite differences of the EOM ===')
console.log(`  Uxx ${Uxx.toFixed(6)}   Uyy ${Uyy.toFixed(6)}   Uzz ${Uzz.toFixed(6)}`)
/**
 * Two identities the CR3BP effective potential must satisfy, and neither was
 * put in by hand — both fall out of the finite-differenced acceleration, so
 * agreement is evidence the equations of motion are right rather than merely
 * self-consistent.
 *
 *   Uxx + Uyy + Uzz = 2      1/r is harmonic away from the primaries, so the
 *                            whole Laplacian is the centrifugal term's
 *   Uyy - Uzz = 1            the centrifugal term acts in x and y but not z,
 *                            and on the x-axis the gravitational second
 *                            derivatives in y and z are equal by symmetry
 */
console.log(`  trace Uxx+Uyy+Uzz = ${(Uxx + Uyy + Uzz).toFixed(9)}   (analytically exactly 2)`)
console.log(`  Uyy - Uzz         = ${(Uyy - Uzz).toFixed(9)}   (analytically exactly 1)`)
console.log(`  in-plane frequency  ${lambda.toFixed(6)}  -> period ${((2 * Math.PI) / lambda).toFixed(4)} TU`)
console.log(`  out-of-plane        ${nu.toFixed(6)}  -> period ${((2 * Math.PI) / nu).toFixed(4)} TU`)
console.log(`  they differ by ${(((lambda - nu) / nu) * 100).toFixed(2)}% — which is why a linear seed`)
console.log('  with both components is a Lissajous, not a halo: the halo family exists')
console.log('  only where the nonlinearity brings the two into 1:1 resonance.')

/* ---- control case: a small planar Lyapunov orbit around L2 ---- */
const A = 0.001
const vySeed = (-A * (s + Uxx)) / 2
console.log('\n=== control: planar Lyapunov orbit at L2 ===')
console.log(`  seed  x ${(L2 + A).toFixed(9)}  z 0  vy ${vySeed.toFixed(9)}   (amplitude ${km(A)} km)`)

const lyap = correctPeriodicOrbit({ x: L2 + A, z: 0, vy: vySeed }, { pin: 'x' })
console.log(`  converged ${lyap.converged} in ${lyap.history.length} iterations`)
for (const s2 of lyap.history.slice(0, 6)) {
  console.log(`    iter ${String(s2.iter).padStart(2)}  |[vx,vz]| ${s2.err.toExponential(3)}  vy ${s2.vy.toFixed(9)}`)
}
console.log(`  period ${lyap.period.toFixed(6)} TU  (linear prediction ${((2 * Math.PI) / lambda).toFixed(6)})`)

const lc = closureError(lyap.x, lyap.z, lyap.vy, lyap.period)
console.log(`  full-period closure:  position ${lc.position.toExponential(3)} (${(lc.position * SEP).toFixed(3)} m)`)
console.log(`                        velocity ${lc.velocity.toExponential(3)}`)

/* ---- the halo family: scan for a seed that converges ---- */
console.log('\n=== halo / NRHO seeds, scanned ===')
console.log('  perilune km      vy seed    converged   iters    period TU   perilune km')
const found = []
for (const rp of [0.008, 0.012, 0.016, 0.02, 0.03]) {
  for (const vyGuess of [0.5, 0.7, 0.9, 1.1, 1.3, 1.5]) {
    const sol = correctPeriodicOrbit(
      { x: 1 - MU, z: -rp, vy: vyGuess },
      { pin: 'z', maxIter: 40 },
    )
    if (!sol.converged) continue
    const ext = orbitExtremes(sol.x, sol.z, sol.vy, sol.period)
    const minR = ext.perilune
    found.push({ rp, vyGuess, sol, minR, ext })
    console.log(
      `  ${km(rp).padStart(11)}${vyGuess.toFixed(2).padStart(12)}` +
        `${String(sol.converged).padStart(12)}${String(sol.history.length).padStart(8)}` +
        `${sol.period.toFixed(4).padStart(13)}${km(minR).padStart(14)}`,
    )
  }
}
if (!found.length) console.log('  none converged')

/* ---- closure on the best halo found ---- */
let haloOk = false
if (found.length) {
  const best = found[0]
  const hc = closureError(best.sol.x, best.sol.z, best.sol.vy, best.sol.period)
  console.log('\n=== closure on the first converged halo ===')
  console.log(`  x ${best.sol.x.toFixed(9)}  z ${best.sol.z.toFixed(9)}  vy ${best.sol.vy.toFixed(9)}`)
    // One time unit is 1/omega; a sidereal month is 2*pi of them.
  const TU_DAYS = 27.321661 / (2 * Math.PI)
  console.log(`  period ${best.sol.period.toFixed(6)} TU = ${(best.sol.period * TU_DAYS).toFixed(2)} days`)
  console.log(`  perilune ${km(best.ext.perilune)} km   apolune ${km(best.ext.apolune)} km   max |z| ${km(Math.abs(best.ext.maxZ))} km`)
  console.log(`  position error ${hc.position.toExponential(3)} (${(hc.position * SEP / 1e3).toFixed(3)} km)`)
  console.log(`  velocity error ${hc.velocity.toExponential(3)}`)
  haloOk = hc.position < 1e-6
}

console.log('\n=== what this establishes ===')
const checks = [
  ['Laplacian identity Uxx+Uyy+Uzz = 2', Math.abs(Uxx + Uyy + Uzz - 2) < 1e-6],
  ['centrifugal identity Uyy-Uzz = 1', Math.abs(Uyy - Uzz - 1) < 1e-6],
  ['linearisation recovers distinct in/out-of-plane frequencies', Math.abs(lambda - nu) > 1e-3],
  ['planar Lyapunov corrector converged', lyap.converged],
  ['Lyapunov period matches the linear prediction within 5%',
   Math.abs(lyap.period - (2 * Math.PI) / lambda) / ((2 * Math.PI) / lambda) < 0.05],
  ['planar orbit closes over a full period', lc.position < 1e-8],
  ['at least one out-of-plane family member converged', found.length > 0],
  ['that member closes over a full period', haloOk],
]
let pass = true
for (const [label, ok] of checks) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`)
  if (!ok) pass = false
}
console.log(`\n  ${pass ? 'PASS' : 'FAIL'}`)
process.exit(pass ? 0 : 1)
