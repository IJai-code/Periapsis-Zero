import { SPIN_AXIS } from '../sim/atmosphere.js'

/**
 * Turning a catalogue into a sky: where a star goes, and what colour it is.
 *
 * `scripts/fetch-stars.mjs` stores Hipparcos as ICRS equatorial unit vectors and
 * two numbers per star — the V magnitude and the B-V colour index. Everything
 * that turns those into pixels is here, and none of it is a look-up table of
 * pretty colours: the temperature comes from a published relation, the colour
 * from Planck's law through the CIE observer, and the brightness from the
 * definition of a magnitude.
 */

/* ---------------------------------------------------------------- *\
 * Where a star goes
\* ---------------------------------------------------------------- */

/**
 * ICRS equatorial to scene, out of `SPIN_AXIS` and nothing else.
 *
 * The catalogue is equatorial: +x to the vernal equinox, +z to the north
 * celestial pole. The scene is ecliptic, folded (x, z, -y), and Earth leans by
 * the obliquity — which this repository keeps in one place. Composing the two
 * rotations gives
 *
 *   X =  x
 *   Y = -y sin(eps) + z cos(eps)
 *   Z = -y cos(eps) - z sin(eps)
 *
 * and `SPIN_AXIS` is `[0, cos(eps), -sin(eps)]`, so the obliquity is read out of
 * it rather than restated. That is not a convenience: substituting the north
 * celestial pole `(0, 0, 1)` gives exactly `SPIN_AXIS` back, so a sky built this
 * way cannot disagree with the planet it is drawn around. `verify-stars` checks
 * that by looking for Polaris three quarters of a degree off the spin axis,
 * which is where Polaris is.
 */
const COS_EPS = SPIN_AXIS[1]
const SIN_EPS = -SPIN_AXIS[2]

export function equatorialToScene(out, x, y, z) {
  out[0] = x
  out[1] = -y * SIN_EPS + z * COS_EPS
  out[2] = -y * COS_EPS - z * SIN_EPS
  return out
}

/**
 * And back, which is the transpose because a rotation's inverse is. Used to ask
 * the sky where something in the scene is: `verify-stars` takes the simulator's
 * own direction to the Sun, brings it here, and checks the right ascension and
 * declination against the almanac — so the catalogue and the ephemeris have to
 * agree about which way the sky is turned, not merely each be self-consistent.
 */
export function sceneToEquatorial(out, X, Y, Z) {
  out[0] = X
  out[1] = -Y * SIN_EPS - Z * COS_EPS
  out[2] = Y * COS_EPS - Z * SIN_EPS
  return out
}

/* ---------------------------------------------------------------- *\
 * What colour a star is
\* ---------------------------------------------------------------- */

/**
 * Effective temperature from the B-V colour index, K.
 *
 * Ballesteros (2012), which treats the star as a blackbody seen through the
 * Johnson B and V bands and inverts the ratio analytically:
 *
 *   T = 4600 ( 1 / (0.92 (B-V) + 1.70) + 1 / (0.92 (B-V) + 0.62) )
 *
 * Checked against stars whose temperature is known independently rather than
 * taken on trust: the Sun's B-V of 0.65 returns 5778 K against a measured
 * 5772 K, which is a tenth of a per cent. It is weaker at the ends — Vega's
 * 0.00 returns 10,125 K against 9,602 K, and a B-V of 1.50 returns 3,671 K
 * where Betelgeuse measures about 3,600 — and `verify-stars` records all three
 * rather than only the flattering one.
 */
export const colourTemperature = (bv) =>
  4600 * (1 / (0.92 * bv + 1.7) + 1 / (0.92 * bv + 0.62))

/** A star with no measured B-V is drawn at the Sun's temperature. */
export const DEFAULT_TEMPERATURE = colourTemperature(0.65)

const PLANCK_C1 = 3.741771852e-16 // 2 pi h c^2, W m^2
const PLANCK_C2 = 1.438776877e-2 // h c / k, m K

/** Spectral radiance of a blackbody at wavelength `lambda` metres. */
const planck = (lambda, T) =>
  PLANCK_C1 / (lambda ** 5 * (Math.exp(PLANCK_C2 / (lambda * T)) - 1))

/**
 * The CIE 1931 colour matching functions, as the piecewise-Gaussian fits of
 * Wyman, Sloan & Shirley (2013). Each lobe is a Gaussian with a different width
 * either side of its peak, which is what lets three of them carry x-bar's shape
 * including its small negative lobe. Maximum error against the tabulated
 * functions is about one per cent of the peak, which is far below the
 * quantisation the colours are stored at.
 */
const gauss = (x, mu, s1, s2) => {
  const t = (x - mu) / (x < mu ? s1 : s2)
  return Math.exp(-0.5 * t * t)
}
const xBar = (l) =>
  1.056 * gauss(l, 599.8, 37.9, 31.0) +
  0.362 * gauss(l, 442.0, 16.0, 26.7) -
  0.065 * gauss(l, 501.1, 20.4, 26.2)
const yBar = (l) => 0.821 * gauss(l, 568.8, 46.9, 40.5) + 0.286 * gauss(l, 530.9, 16.3, 31.1)
const zBar = (l) => 1.217 * gauss(l, 437.0, 11.8, 36.0) + 0.681 * gauss(l, 459.0, 26.0, 13.8)

/** CIE XYZ of a blackbody, normalised so Y = 1. Out-of-place; called once a star. */
export function blackbodyXYZ(out, T) {
  let X = 0
  let Y = 0
  let Z = 0
  // 360-830 nm at 5 nm, which is the range the fits are stated over.
  for (let nm = 360; nm <= 830; nm += 5) {
    const L = planck(nm * 1e-9, T)
    X += L * xBar(nm)
    Y += L * yBar(nm)
    Z += L * zBar(nm)
  }
  const inv = Y > 0 ? 1 / Y : 0
  out[0] = X * inv
  out[1] = 1
  out[2] = Z * inv
  return out
}

const _xyz = new Float64Array(3)

/**
 * Linear sRGB of a blackbody, scaled so the brightest channel is 1.
 *
 * The D65 sRGB primaries do not enclose the Planckian locus, so a cool star's
 * red is outside the gamut and comes back with a negative blue. Those are
 * clamped, which is the only honest thing a three-primary display can do, and
 * `verify-stars` measures how far out of gamut the ends actually go rather than
 * leaving the clamp silent. Brightness is *not* in here — that comes from the
 * magnitude — so this is chromaticity alone.
 */
export function blackbodyRGB(out, T) {
  const xyz = blackbodyXYZ(_xyz, T)
  const X = xyz[0]
  const Y = xyz[1]
  const Z = xyz[2]
  let r = 3.2406 * X - 1.5372 * Y - 0.4986 * Z
  let g = -0.9689 * X + 1.8758 * Y + 0.0415 * Z
  let b = 0.0557 * X - 0.204 * Y + 1.057 * Z
  r = r > 0 ? r : 0
  g = g > 0 ? g : 0
  b = b > 0 ? b : 0
  const peak = Math.max(r, g, b)
  const inv = peak > 0 ? 1 / peak : 0
  out[0] = r * inv
  out[1] = g * inv
  out[2] = b * inv
  return out
}

/* ---------------------------------------------------------------- *\
 * How bright a star is
\* ---------------------------------------------------------------- */

/**
 * The magnitude the renderer treats as unit brightness.
 *
 * Magnitudes are a ratio scale with no zero, so something has to be chosen, and
 * the choice is declared rather than tuned: V = 0 is Vega's own magnitude, the
 * definition the scale was built on. Sirius at -1.44 comes out 3.8x brighter
 * than that and a sixth-magnitude star 1/250th, which is the real dynamic range
 * of the naked-eye sky and is what the bloom pass then has to cope with.
 */
export const REFERENCE_MAGNITUDE = 0

/** Relative flux of a star, from the definition of a magnitude. */
export const magnitudeFlux = (vmag) => Math.pow(10, -0.4 * (vmag - REFERENCE_MAGNITUDE))

/**
 * Faintest star drawn. Hipparcos runs to V = 14, which is four magnitudes past
 * anything an unaided eye resolves; what the faint end contributes here is the
 * unresolved wash that reads as the Milky Way, so it is kept, and the cut exists
 * so the whole catalogue can be traded for a prefix of it on a slow machine.
 */
export const MAGNITUDE_LIMIT = 11

/**
 * Decode the packed catalogue into the attributes a point cloud wants.
 *
 * One pass, three typed arrays out, no per-star objects: at 118,000 stars the
 * garbage from an array of `{x, y, z}` is several megabytes, and this runs while
 * the scene is being built.
 *
 * @param {ArrayBuffer} buffer  the file `fetch-stars.mjs` wrote
 * @param {number} limit        faintest V magnitude to keep
 */
export function decodeStars(buffer, limit = MAGNITUDE_LIMIT) {
  const view = new DataView(buffer)
  const total = Math.floor(buffer.byteLength / 10)

  // Records are sorted brightest first, so the cut is a prefix: find its end.
  let n = total
  for (let i = 0; i < total; i++) {
    if (view.getInt16(i * 10 + 6, true) / 100 > limit) {
      n = i
      break
    }
  }

  const position = new Float32Array(n * 3)
  const colour = new Float32Array(n * 3)
  const flux = new Float32Array(n)
  const dir = new Float64Array(3)
  const rgb = new Float64Array(3)

  /*
   * Colour is a function of one stored integer, and that integer takes a few
   * thousand distinct values across 118,000 stars — so the Planck integral runs
   * a few thousand times rather than 118,000, out of a cache keyed on the raw
   * B-V. The integral is 95 wavelengths of `exp`.
   */
  const cache = new Map()

  for (let i = 0; i < n; i++) {
    const o = i * 10
    equatorialToScene(
      dir,
      view.getInt16(o, true) / 32767,
      view.getInt16(o + 2, true) / 32767,
      view.getInt16(o + 4, true) / 32767,
    )
    const len = Math.hypot(dir[0], dir[1], dir[2]) || 1
    position[i * 3] = dir[0] / len
    position[i * 3 + 1] = dir[1] / len
    position[i * 3 + 2] = dir[2] / len

    flux[i] = magnitudeFlux(view.getInt16(o + 6, true) / 100)

    const raw = view.getInt16(o + 8, true)
    let c = cache.get(raw)
    if (c === undefined) {
      const T = raw === -32768 ? DEFAULT_TEMPERATURE : colourTemperature(raw / 1000)
      blackbodyRGB(rgb, Math.min(40000, Math.max(1500, T)))
      c = [rgb[0], rgb[1], rgb[2]]
      cache.set(raw, c)
    }
    colour[i * 3] = c[0]
    colour[i * 3 + 1] = c[1]
    colour[i * 3 + 2] = c[2]
  }

  return { count: n, total, position, colour, flux }
}
