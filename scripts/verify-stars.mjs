/**
 * The sky, against the catalogue it came from and against physics it did not.
 *
 * A star field is the easiest thing in a renderer to get subtly wrong and never
 * notice: a sign flipped in the equatorial-to-ecliptic rotation mirrors the sky,
 * an obliquity applied twice tilts it by 47 degrees, and both still look like
 * stars. So three separate things are checked here, none of them by eye.
 *
 *   1. the catalogue survived the trip — named stars are where the published
 *      figures put them, after quantising to 16 bits and moving 8.75 years of
 *      proper motion
 *   2. the sky and the planet agree about which way is up. Polaris is 0.74
 *      degrees from the north celestial pole, which *is* Earth's spin axis, so
 *      finding it that far from `SPIN_AXIS` checks the whole chain — the
 *      catalogue's frame, the obliquity, and the scene's ecliptic fold — at once
 *   3. the colours are blackbody colours. The B-V to temperature relation is
 *      checked against stars whose temperature is known by other means, and the
 *      Planck-through-CIE integral against the Kim et al. approximation to the
 *      Planckian locus, which shares no code with it
 *
 *   node scripts/verify-stars.mjs
 */
import fs from 'node:fs'
import { SPIN_AXIS } from '../src/sim/atmosphere.js'
import { live, refreshDerived, resetSimulation } from '../src/sim/live.js'
import {
  blackbodyRGB,
  blackbodyXYZ,
  colourTemperature,
  decodeStars,
  equatorialToScene,
  magnitudeFlux,
  sceneToEquatorial,
} from '../src/gfx/stars.js'

const DEG = Math.PI / 180
const manifest = JSON.parse(fs.readFileSync('public/stars/manifest.json', 'utf8'))
const file = fs.readFileSync(`public/stars/${manifest.file}`)
const buffer = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength)
const view = new DataView(buffer)
const count = Math.floor(buffer.byteLength / manifest.record)

/**
 * Published positions at J2000.0 and magnitudes, from SIMBAD, for stars chosen
 * to cover the sky rather than one corner of it: two poles, both hemispheres,
 * the extremes of colour, and the fastest-moving star there is.
 */
const KNOWN = [
  { name: 'Sirius', hip: 32349, ra: 101.2871, de: -16.7161, v: -1.44, bv: 0.01 },
  { name: 'Canopus', hip: 30438, ra: 95.9879, de: -52.6957, v: -0.62, bv: 0.15 },
  { name: 'Arcturus', hip: 69673, ra: 213.9153, de: 19.1824, v: -0.05, bv: 1.23 },
  { name: 'Vega', hip: 91262, ra: 279.2347, de: 38.7837, v: 0.03, bv: 0.0 },
  { name: 'Rigel', hip: 24436, ra: 78.6345, de: -8.2017, v: 0.18, bv: -0.03 },
  { name: 'Betelgeuse', hip: 27989, ra: 88.7929, de: 7.4071, v: 0.45, bv: 1.5 },
  { name: 'Polaris', hip: 11767, ra: 37.9546, de: 89.2641, v: 1.97, bv: 0.64 },
  { name: 'Barnard', hip: 87937, ra: 269.4521, de: 4.6934, v: 9.54, bv: 1.57 },
]

/* ---- 1. the catalogue survived ---- */

console.log('=== the catalogue, against published positions ===')
console.log('  star           HIP        V      B-V     position error')
let worstArc = 0
let worstMag = 0
let worstBv = 0
const found = new Map()
const dir = new Float64Array(3)
const want = new Float64Array(3)

for (let i = 0; i < count; i++) {
  const o = i * manifest.record
  const x = view.getInt16(o, true) / 32767
  const y = view.getInt16(o + 2, true) / 32767
  const z = view.getInt16(o + 4, true) / 32767
  const v = view.getInt16(o + 6, true) / 100
  const raw = view.getInt16(o + 8, true)
  for (const k of KNOWN) {
    // Matched on the sky rather than on an index, because the file carries no
    // HIP number: nothing downstream needs one, and a catalogue key that is
    // never read is a key that can rot.
    const a = k.ra * DEG
    const d = k.de * DEG
    want[0] = Math.cos(d) * Math.cos(a)
    want[1] = Math.cos(d) * Math.sin(a)
    want[2] = Math.sin(d)
    const len = Math.hypot(x, y, z) || 1
    const dot = (x * want[0] + y * want[1] + z * want[2]) / len
    if (dot > Math.cos(30 / 3600 / (180 / Math.PI)) && Math.abs(v - k.v) < 0.1) {
      const arc = (Math.acos(Math.min(1, dot)) / DEG) * 3600
      found.set(k.name, { x: x / len, y: y / len, z: z / len, v, bv: raw / 1000, arc })
    }
  }
}

for (const k of KNOWN) {
  const f = found.get(k.name)
  if (!f) {
    console.log(`  ${k.name.padEnd(13)} ${String(k.hip).padStart(6)}   NOT FOUND`)
    continue
  }
  worstArc = Math.max(worstArc, f.arc)
  worstMag = Math.max(worstMag, Math.abs(f.v - k.v))
  worstBv = Math.max(worstBv, Math.abs(f.bv - k.bv))
  console.log(
    `  ${k.name.padEnd(13)} ${String(k.hip).padStart(6)}  ${f.v.toFixed(2).padStart(6)}  ${f.bv.toFixed(3).padStart(7)}     ${f.arc.toFixed(1).padStart(5)}"`,
  )
}

/* ---- 2. the sky and the planet agree which way is up ---- */

console.log('\n=== the frame, against the planet ===')
const polaris = found.get('Polaris')
let polarisOff = Infinity
if (polaris) {
  equatorialToScene(dir, polaris.x, polaris.y, polaris.z)
  const dot = dir[0] * SPIN_AXIS[0] + dir[1] * SPIN_AXIS[1] + dir[2] * SPIN_AXIS[2]
  polarisOff = Math.acos(Math.min(1, dot)) / DEG
}
// The vernal equinox is the one direction the equatorial and ecliptic frames
// share, so it must come through the rotation untouched.
equatorialToScene(dir, 1, 0, 0)
const equinoxOff = Math.hypot(dir[0] - 1, dir[1], dir[2])
// And the north ecliptic pole is +Y in the scene, by the fold's construction.
equatorialToScene(dir, 0, -Math.sin(23.4392911 * DEG), Math.cos(23.4392911 * DEG))
const eclipticPole = Math.acos(Math.min(1, dir[1])) / DEG

console.log(`  Polaris sits ${polarisOff.toFixed(3)} deg off the spin axis; the real one is 0.736 deg off the pole`)
console.log(`  the vernal equinox comes through the rotation ${equinoxOff.toExponential(2)} from scene +X`)
console.log(`  the north ecliptic pole lands ${eclipticPole.toFixed(4)} deg from scene +Y`)

/* ---- and the sky against the ephemeris, which is a different instrument ---- */

/**
 * Everything above is internal: the catalogue against itself, and the rotation
 * against the constant it is built from. This is the one check that crosses
 * between the sky and the solar system.
 *
 * The simulator knows where the Sun is because it integrates Earth's orbit. The
 * almanac knows because it fits a series to observations. Bringing the
 * simulator's own `sunDir` back through the rotation gives a right ascension and
 * declination that can be compared with the almanac's, and the two share no
 * code — so a sky rotated the wrong way, or rotated twice, shows up here as the
 * Sun sitting in the wrong constellation.
 */
resetSimulation()
refreshDerived()
const eq = new Float64Array(3)
sceneToEquatorial(eq, live.sunDir.x, live.sunDir.y, live.sunDir.z)
let sunRA = (Math.atan2(eq[1], eq[0]) / DEG + 360) % 360
const sunDec = Math.asin(Math.max(-1, Math.min(1, eq[2]))) / DEG

// The almanac's low-precision solar position at J2000.0, the same series
// `verify-solar` checks the sky's lighting against.
const L = 280.46 * DEG
const g = 357.528 * DEG
const lambda = L + 1.915 * DEG * Math.sin(g) + 0.02 * DEG * Math.sin(2 * g)
const eps = 23.439 * DEG
let wantRA = (Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda)) / DEG + 360) % 360
const wantDec = Math.asin(Math.sin(eps) * Math.sin(lambda)) / DEG
const raGap = Math.abs(((sunRA - wantRA + 540) % 360) - 180)
const decGap = Math.abs(sunDec - wantDec)

console.log('\n=== the sky against the ephemeris ===')
console.log(`  the simulator's Sun at J2000.0   RA ${sunRA.toFixed(3)} deg   Dec ${sunDec.toFixed(3)} deg`)
console.log(`  the almanac's                    RA ${wantRA.toFixed(3)} deg   Dec ${wantDec.toFixed(3)} deg`)
console.log(`  apart by ${raGap.toFixed(3)} deg of right ascension and ${decGap.toFixed(3)} of declination`)

/* ---- 3. the colours are blackbody colours ---- */

console.log('\n=== B-V to temperature, against stars measured another way ===')
/** Effective temperatures from spectroscopy and interferometry, not from B-V. */
const TEMPS = [
  { name: 'the Sun', bv: 0.65, T: 5772, tol: 60 },
  { name: 'Vega', bv: 0.0, T: 9602, tol: 700 },
  { name: 'Arcturus', bv: 1.23, T: 4286, tol: 400 },
  { name: 'Betelgeuse', bv: 1.5, T: 3600, tol: 400 },
]
let tempOk = true
for (const t of TEMPS) {
  const got = colourTemperature(t.bv)
  const err = Math.abs(got - t.T)
  if (err > t.tol) tempOk = false
  console.log(
    `  ${t.name.padEnd(12)} B-V ${t.bv.toFixed(2)}  ->  ${got.toFixed(0).padStart(6)} K   measured ${String(t.T).padStart(5)} K   ${((err / t.T) * 100).toFixed(1)}%`,
  )
}

/**
 * The Planckian locus by Kim et al. (2002), a cubic in 1/T fitted to the CIE
 * tables — an approximation of the same curve the integral above computes from
 * first principles, and sharing nothing with it.
 */
function kimLocus(T) {
  const t = 1 / T
  const x =
    T < 4000
      ? -0.2661239e9 * t ** 3 - 0.2343589e6 * t ** 2 + 0.8776956e3 * t + 0.17991
      : -3.0258469e9 * t ** 3 + 2.1070379e6 * t ** 2 + 0.2226347e3 * t + 0.24039
  const y =
    T < 2222
      ? -1.1063814 * x ** 3 - 1.3481102 * x ** 2 + 2.18555832 * x - 0.20219683
      : T < 4000
        ? -0.9549476 * x ** 3 - 1.37418593 * x ** 2 + 2.09137015 * x - 0.16748867
        : 3.081758 * x ** 3 - 5.8733867 * x ** 2 + 3.75112997 * x - 0.37001483
  return [x, y]
}

console.log('\n=== Planck through the CIE observer, against the Planckian locus ===')
console.log('       T K      integrated x, y        Kim et al. x, y      error')
const xyz = new Float64Array(3)
const rgb = new Float64Array(3)
let worstLocus = 0
for (const T of [2000, 3000, 4000, 5772, 6500, 10000, 20000, 25000]) {
  blackbodyXYZ(xyz, T)
  const s = xyz[0] + xyz[1] + xyz[2]
  const x = xyz[0] / s
  const y = xyz[1] / s
  const [kx, ky] = kimLocus(T)
  const err = Math.hypot(x - kx, y - ky)
  worstLocus = Math.max(worstLocus, err)
  console.log(
    `  ${String(T).padStart(7)}   ${x.toFixed(4)}, ${y.toFixed(4)}      ${kx.toFixed(4)}, ${ky.toFixed(4)}     ${err.toFixed(4)}`,
  )
}

console.log('\n=== and what those come out as, on screen ===')
let blueMonotone = true
let lastRatio = Infinity
for (const T of [3000, 4000, 5772, 8000, 12000, 20000]) {
  blackbodyRGB(rgb, T)
  const ratio = rgb[2] > 0 ? rgb[0] / rgb[2] : Infinity
  if (ratio > lastRatio) blueMonotone = false
  lastRatio = ratio
  console.log(
    `  ${String(T).padStart(6)} K   rgb ${rgb[0].toFixed(3)} ${rgb[1].toFixed(3)} ${rgb[2].toFixed(3)}   red/blue ${ratio === Infinity ? 'inf' : ratio.toFixed(2)}`,
  )
}

/* ---- and the decode the renderer actually runs ---- */

console.log('\n=== the decode ===')
const t0 = Date.now()
const decoded = decodeStars(buffer, 11)
const ms = Date.now() - t0
let unit = 0
for (let i = 0; i < decoded.count; i++) {
  const d = Math.hypot(
    decoded.position[i * 3],
    decoded.position[i * 3 + 1],
    decoded.position[i * 3 + 2],
  )
  unit = Math.max(unit, Math.abs(d - 1))
}
const sorted = manifest.brighterThan
console.log(`  ${decoded.count} of ${decoded.total} stars kept at V < 11, decoded in ${ms} ms`)
console.log(`  every direction is a unit vector to ${unit.toExponential(2)}`)
console.log(`  naked eye V < 6.5: ${sorted['6.5']}, brighter than first magnitude: ${sorted['1']}`)
console.log(
  `  Sirius is ${magnitudeFlux(-1.44).toFixed(2)}x unit flux, a sixth-magnitude star ${magnitudeFlux(6).toExponential(2)}x`,
)

console.log('\n=== what this establishes ===')
const checks = [
  ['every named star is in the catalogue', found.size === KNOWN.length],
  ['and within 30 arcseconds of its published position', worstArc < 30],
  ['with its published magnitude and colour index', worstMag < 0.02 && worstBv < 0.02],
  // The whole chain: catalogue frame, obliquity, ecliptic fold.
  ['Polaris sits on the spin axis, where the pole star is', Math.abs(polarisOff - 0.736) < 0.05],
  ['the vernal equinox is fixed by the rotation', equinoxOff < 1e-9],
  ['and the ecliptic pole lands on scene +Y', eclipticPole < 0.01],
  ['B-V returns the temperatures those stars are measured at', tempOk],
  ['the Planck integral lands on the Planckian locus, to 0.01 in x, y', worstLocus < 0.01],
  ['hotter is bluer, all the way up', blueMonotone],
  ['the decode returns unit vectors', unit < 1e-4],
  ['and it is fast enough to run while the scene builds', ms < 2000],
  ['the naked-eye count is what a whole-sky catalogue gives', sorted['6.5'] > 8000 && sorted['6.5'] < 10000],
  /*
   * The tolerance is the offset `verify-rails` measures independently: the
   * simulator's Earth starts 1.0996 degrees further round its orbit than the JPL
   * table puts it, which lands on the sky as very nearly the same angle. So this
   * fails if the sky is rotated wrongly and not merely because Earth is where it
   * has always been — the same bound, and the same reason, as `verify-solar`.
   */
  ['the simulator\'s own Sun lands where the almanac puts it in the sky', raGap < 1.5 && decGap < 0.5],
]
let pass = true
for (const [label, ok] of checks) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`)
  if (!ok) pass = false
}
console.log(`\n  worst position error ${worstArc.toFixed(1)}", worst locus error ${worstLocus.toFixed(4)}`)
console.log(`  ${pass ? 'PASS' : 'FAIL'}`)
process.exit(pass ? 0 : 1)
