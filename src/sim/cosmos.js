import * as THREE from 'three'
import { AU } from './constants.js'
import { COSMIC } from './cosmic.js'
import { addEntries } from './catalog.js'
import { equatorialToScene } from '../gfx/stars.js'

/**
 * The sky beyond the planets, at its real distances.
 *
 * Everything here is placed from published astrometry — right ascension and
 * declination (ICRS, J2000), a distance from a parallax or a standard candle —
 * and nothing is placed by eye. The directions are checked against the
 * Hipparcos catalogue the star field is drawn from (`verify-deep-sky`): every
 * named star in this file has to land on a Hipparcos star of its own brightness
 * within an arcminute, so a mistyped digit cannot put Sirius somewhere else.
 *
 * Three frames meet here, and each is defined once:
 *
 *   - **ICRS equatorial**: +x to the equinox, +z to the celestial pole. The
 *     catalogue's frame. `equatorialToScene` (gfx/stars.js) turns it into the
 *     scene's ecliptic frame out of the same obliquity the planet spins on.
 *   - **Galactic** (IAU 1958, as realised by Hipparcos): +x to l = 0, the
 *     direction of the Galactic Centre; +z to the north galactic pole. Related
 *     to ICRS by one fixed rotation, `ICRS_TO_GALACTIC`.
 *   - **Galactocentric**: the Milky Way's own frame, in kiloparsecs, with the
 *     Galaxy's centre at the origin and its disc in the x-y plane. Built from
 *     three measurements — the distance to Sgr A*, where Sgr A* is on the sky,
 *     and how far the Sun sits above the midplane — the way astropy's
 *     `Galactocentric` frame is.
 *
 * Distances are to the object; the Sun's 1e9 m wobble about the barycentre is
 * ignored at these scales (it is 3e-8 pc).
 */

/** The parsec, from its 2015 IAU definition: 648000/pi astronomical units, exactly. */
export const PARSEC = (648000 / Math.PI) * AU
export const KILOPARSEC = 1000 * PARSEC
export const MEGAPARSEC = 1e6 * PARSEC
/** A Julian year of light. */
export const LIGHT_YEAR = 299792458 * 365.25 * 86400
export const SOLAR_RADIUS = 6.957e8 // IAU 2015 nominal

const DEG = Math.PI / 180

/* ---------------------------------------------------------------- *
 * Frames
 * ---------------------------------------------------------------- */

/**
 * ICRS to galactic. The rows are the galactic axes written in ICRS — the
 * Hipparcos catalogue's definition (ESA 1997, vol. 1, §1.5.3), which fixes the
 * north galactic pole at RA 192.85948°, Dec +27.12825° and l = 0 at
 * RA 266.40499°, Dec −28.93617°. `verify-deep-sky` recovers those two points
 * from the matrix, and the galactic coordinates of known objects from their
 * equatorial ones.
 */
export const ICRS_TO_GALACTIC = [
  [-0.0548755604162154, -0.873437090234885, -0.4838350155487132],
  [0.4941094278755837, -0.4448296299600112, 0.7469822444972189],
  [-0.8676661490190047, -0.1980763734312015, 0.4559837761750669],
]

/** Sexagesimal right ascension ("hh mm ss.s") to radians. */
export function hms(s) {
  const [h, m = 0, x = 0] = String(s).trim().split(/\s+/).map(Number)
  return ((h + m / 60 + x / 3600) * 15) * DEG
}

/** Sexagesimal declination ("±dd mm ss") to radians. */
export function dms(s) {
  const t = String(s).trim()
  const neg = t.startsWith('-') || t.startsWith('−')
  const [d, m = 0, x = 0] = t.replace(/^[+\-−]/, '').split(/\s+/).map(Number)
  return (neg ? -1 : 1) * (d + m / 60 + x / 3600) * DEG
}

/** ICRS unit vector of a direction. */
export function icrsUnit(out, ra, dec) {
  const c = Math.cos(dec)
  out[0] = c * Math.cos(ra)
  out[1] = c * Math.sin(ra)
  out[2] = Math.sin(dec)
  return out
}

/** Galactic Cartesian from ICRS (a rotation, so unit vectors stay unit). */
export function icrsToGalactic(out, v) {
  const M = ICRS_TO_GALACTIC
  const x = v[0]
  const y = v[1]
  const z = v[2]
  out[0] = M[0][0] * x + M[0][1] * y + M[0][2] * z
  out[1] = M[1][0] * x + M[1][1] * y + M[1][2] * z
  out[2] = M[2][0] * x + M[2][1] * y + M[2][2] * z
  return out
}

/** ICRS from galactic Cartesian: the transpose. */
export function galacticToIcrs(out, g) {
  const M = ICRS_TO_GALACTIC
  const x = g[0]
  const y = g[1]
  const z = g[2]
  out[0] = M[0][0] * x + M[1][0] * y + M[2][0] * z
  out[1] = M[0][1] * x + M[1][1] * y + M[2][1] * z
  out[2] = M[0][2] * x + M[1][2] * y + M[2][2] * z
  return out
}

/** Galactic longitude and latitude of an ICRS direction, degrees. */
export function galacticLB(v) {
  const g = icrsToGalactic([0, 0, 0], v)
  let l = Math.atan2(g[1], g[0]) / DEG
  if (l < 0) l += 360
  return [l, Math.asin(Math.max(-1, Math.min(1, g[2] / Math.hypot(g[0], g[1], g[2])))) / DEG]
}

/** Scene-frame position (metres from the Sun) of an ICRS direction at a distance. */
export function sceneAt(out, ra, dec, metres) {
  const u = icrsUnit([0, 0, 0], ra, dec)
  const s = equatorialToScene([0, 0, 0], u[0], u[1], u[2])
  return out.set(s[0] * metres, s[1] * metres, s[2] * metres)
}

/* ---------------------------------------------------------------- *
 * The Galaxy's own frame
 * ---------------------------------------------------------------- */

/**
 * Where the Galaxy is, measured.
 *
 *   R0 = 8.178 kpc: the distance to Sgr A*, from the orbit of the star S2
 *     (GRAVITY Collaboration 2019), good to 0.3%.
 *   Sgr A* at l = 359.94423°, b = −0.04616° (Reid & Brunthaler 2004).
 *   zSun = +20.8 pc: the Sun's height above the midplane, from Gaia star
 *     counts (Bennett & Bovy 2019).
 *
 * The frame is built the way astropy's `Galactocentric` is: x from the Sun
 * through Sgr A*, z toward the north galactic pole, and a rotation of
 * asin(zSun/R0) = 0.146° about y so the Sun sits zSun above the plane that
 * contains the centre. The Galaxy turns clockwise seen from the north
 * galactic pole: the Sun moves toward l = 90°, which is +y here.
 */
export const GALAXY = {
  R0: 8.178, // kpc
  zSun: 0.0208, // kpc
  lGC: 359.94423,
  bGC: -0.04616,
}

const _g = new Float64Array(9)
/**
 * Galactocentric basis in galactic Cartesian: rows x, y, z. Heliocentric
 * galactic p (kpc) maps to galactocentric q = B (p − R0 x1).
 */
export const GALACTOCENTRIC = (() => {
  const l = GALAXY.lGC * DEG
  const b = GALAXY.bGC * DEG
  const x1 = [Math.cos(b) * Math.cos(l), Math.cos(b) * Math.sin(l), Math.sin(b)]
  // z1: the galactic pole, orthogonalised against x1.
  const d = x1[2]
  const z1 = [-d * x1[0], -d * x1[1], 1 - d * x1[2]]
  const zn = Math.hypot(z1[0], z1[1], z1[2])
  z1[0] /= zn
  z1[1] /= zn
  z1[2] /= zn
  const th = Math.asin(GALAXY.zSun / GALAXY.R0)
  const c = Math.cos(th)
  const s = Math.sin(th)
  const x = [c * x1[0] + s * z1[0], c * x1[1] + s * z1[1], c * x1[2] + s * z1[2]]
  const z = [c * z1[0] - s * x1[0], c * z1[1] - s * x1[1], c * z1[2] - s * x1[2]]
  const y = [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]]
  _g.set([...x, ...y, ...z])
  return { x, y, z, centre: [GALAXY.R0 * x1[0], GALAXY.R0 * x1[1], GALAXY.R0 * x1[2]] }
})()

/** Galactocentric (kpc) of a heliocentric galactic point (kpc). */
export function toGalactocentric(out, p) {
  const G = GALACTOCENTRIC
  const dx = p[0] - G.centre[0]
  const dy = p[1] - G.centre[1]
  const dz = p[2] - G.centre[2]
  out[0] = G.x[0] * dx + G.x[1] * dy + G.x[2] * dz
  out[1] = G.y[0] * dx + G.y[1] * dy + G.y[2] * dz
  out[2] = G.z[0] * dx + G.z[1] * dy + G.z[2] * dz
  return out
}

/** Heliocentric galactic (kpc) of a galactocentric point (kpc). */
export function fromGalactocentric(out, q) {
  const G = GALACTOCENTRIC
  out[0] = G.centre[0] + G.x[0] * q[0] + G.y[0] * q[1] + G.z[0] * q[2]
  out[1] = G.centre[1] + G.x[1] * q[0] + G.y[1] * q[1] + G.z[1] * q[2]
  out[2] = G.centre[2] + G.x[2] * q[0] + G.y[2] * q[1] + G.z[2] * q[2]
  return out
}

/** A galactic Cartesian vector in the scene frame (a rotation). */
function galacticToScene(out, g) {
  const e = galacticToIcrs([0, 0, 0], g)
  return equatorialToScene(out, e[0], e[1], e[2])
}

/**
 * The Milky Way's placement in the scene: the rotation from galactocentric
 * axes to scene axes, and the centre, metres from the Sun. The renderer draws
 * the Galaxy in its own frame and hands the GPU this.
 */
export const MILKY_WAY_FRAME = (() => {
  const G = GALACTOCENTRIC
  const ax = galacticToScene([0, 0, 0], G.x)
  const ay = galacticToScene([0, 0, 0], G.y)
  const az = galacticToScene([0, 0, 0], G.z)
  const c = galacticToScene([0, 0, 0], G.centre)
  return {
    basis: new THREE.Matrix4().makeBasis(
      new THREE.Vector3(...ax),
      new THREE.Vector3(...ay),
      new THREE.Vector3(...az),
    ),
    centre: new THREE.Vector3(c[0], c[1], c[2]).multiplyScalar(KILOPARSEC),
  }
})()

/**
 * The frame of a galaxy seen on the sky: its major axis at position angle PA
 * (north through east), its disc inclined by i to the sky plane. `near` picks
 * which side of the minor axis is the near side where it is known (+1: the
 * side at PA + 90°). Returns a scene-frame basis: x the major axis, z the
 * disc normal, y completing it.
 */
export function skyDiscBasis(ra, dec, pa, inc, near = 1) {
  const r = icrsUnit([0, 0, 0], ra, dec)
  const east = [-Math.sin(ra), Math.cos(ra), 0]
  const north = [-Math.sin(dec) * Math.cos(ra), -Math.sin(dec) * Math.sin(ra), Math.cos(dec)]
  const m = [0, 1, 2].map((k) => Math.cos(pa) * north[k] + Math.sin(pa) * east[k])
  const k2 = [0, 1, 2].map((k) => -Math.sin(pa) * north[k] + Math.cos(pa) * east[k])
  // Face-on the normal points back at us; inclined, it tips over the minor axis.
  const n = [0, 1, 2].map((k) => -Math.cos(inc) * r[k] + near * Math.sin(inc) * k2[k])
  const toScene = (v) => new THREE.Vector3(...equatorialToScene([0, 0, 0], v[0], v[1], v[2]))
  const X = toScene(m).normalize()
  const Z = toScene(n).normalize()
  const Y = new THREE.Vector3().crossVectors(Z, X).normalize()
  return new THREE.Matrix4().makeBasis(X, Y, Z)
}

/* ---------------------------------------------------------------- *
 * The stars that have names
 * ---------------------------------------------------------------- */

/**
 * [id, name, aliases, RA, Dec, distance pc, V, B−V, radius R☉, type, line].
 *
 * Positions: SIMBAD ICRS at J2000. Distances: Hipparcos (van Leeuwen 2007) or
 * Gaia DR3 parallaxes for the near stars; for the supergiants, where a
 * parallax is too small to trust, the published estimate named in the
 * comment. Radii are interferometric where one exists. `V` is the catalogue
 * magnitude the gate checks against Hipparcos; the renderer derives each
 * star's absolute magnitude from it and its distance, so from anywhere else
 * the star is as bright as the inverse-square law says.
 *
 * B−V is null where it misleads — for the coolest dwarfs the colour index
 * saturates — and `teff` is given instead.
 */
const STAR_ROWS = [
  // The nearest — within five parsecs.
  ['proxima', 'Proxima Centauri', ['proxima', 'alpha centauri c', 'nearest star'], '14 29 42.95', '-62 40 46.2', 1.302, 11.13, 1.82, 0.154, 'M5.5 V', 'The nearest star to the Sun · 4.25 ly · a red dwarf with a planet in its habitable zone'],
  ['alpha-centauri-a', 'Alpha Centauri A', ['rigil kentaurus', 'rigil kent', 'alpha cen a', 'alpha centauri'], '14 39 36.49', '-60 50 02.4', 1.3384, 0.01, 0.71, 1.2234, 'G2 V', '4.37 ly · a star very like the Sun'],
  ['alpha-centauri-b', 'Alpha Centauri B', ['toliman', 'alpha cen b'], '14 39 35.06', '-60 50 15.1', 1.3384, 1.33, 0.88, 0.8632, 'K1 V', '4.37 ly · orbits A every 79.9 years'],
  ['barnards-star', "Barnard's Star", ['barnard', 'barnards star'], '17 57 48.50', '+04 41 36.2', 1.8282, 9.51, 1.57, 0.187, 'M4 V', '5.96 ly · the fastest-moving star on the sky'],
  ['wolf-359', 'Wolf 359', ['wolf 359', 'cn leonis'], '10 56 29.20', '+07 00 53.0', 2.4086, 13.51, null, 0.144, 'M6 V', '7.86 ly · a flare star', 2800],
  ['lalande-21185', 'Lalande 21185', ['lalande', 'gliese 411'], '11 03 20.19', '+35 58 11.6', 2.547, 7.52, 1.44, 0.392, 'M2 V', '8.31 ly · the brightest red dwarf in the northern sky'],
  ['sirius', 'Sirius', ['dog star', 'alpha canis majoris', 'sirius a'], '06 45 08.92', '-16 42 58.0', 2.637, -1.46, 0.0, 1.711, 'A1 V', '8.60 ly · the brightest star in the night sky'],
  ['epsilon-eridani', 'Epsilon Eridani', ['ran', 'eps eridani'], '03 32 55.84', '-09 27 29.7', 3.203, 3.73, 0.88, 0.735, 'K2 V', '10.4 ly · a young Sun with a debris disc'],
  ['lacaille-9352', 'Lacaille 9352', ['gliese 887'], '23 05 52.04', '-35 51 11.0', 3.29, 7.34, 1.48, 0.47, 'M0.5 V', '10.7 ly · a red dwarf with two super-Earths'],
  ['ross-128', 'Ross 128', ['ross 128', 'fi virginis'], '11 47 44.40', '+00 48 16.4', 3.37, 11.13, 1.76, 0.197, 'M4 V', '11.0 ly · a quiet red dwarf with a temperate planet'],
  ['61-cygni-a', '61 Cygni A', ["piazzi's flying star", '61 cygni', '61 cyg'], '21 06 53.94', '+38 44 57.9', 3.4964, 5.21, 1.18, 0.665, 'K5 V', '11.4 ly · the first star whose distance was measured (Bessel, 1838)'],
  ['61-cygni-b', '61 Cygni B', ['61 cyg b'], '21 06 55.26', '+38 44 31.4', 3.4964, 6.03, 1.37, 0.595, 'K7 V', '11.4 ly · 61 Cygni A’s companion'],
  ['procyon', 'Procyon', ['alpha canis minoris', 'procyon a'], '07 39 18.12', '+05 13 30.0', 3.51, 0.34, 0.42, 2.048, 'F5 IV–V', '11.5 ly · the Little Dog’s star'],
  ['epsilon-indi', 'Epsilon Indi', ['eps indi'], '22 03 21.66', '-56 47 09.5', 3.639, 4.69, 1.06, 0.732, 'K5 V', '11.9 ly · with a pair of brown dwarfs'],
  ['tau-ceti', 'Tau Ceti', ['tau cet'], '01 44 04.08', '-15 56 14.9', 3.652, 3.5, 0.72, 0.793, 'G8 V', '11.9 ly · the nearest lone Sun-like star'],
  ['kapteyns-star', "Kapteyn's Star", ['kapteyn'], '05 11 40.59', '-45 01 06.4', 3.93, 8.85, 1.55, 0.29, 'sdM1', '12.8 ly · a halo star passing through the disc'],
  ['gliese-581', 'Gliese 581', ['gl 581', 'gj 581'], '15 19 26.83', '-07 43 20.2', 6.3, 10.56, 1.6, 0.3, 'M3 V', '20.5 ly · a red dwarf with a planetary system'],
  ['trappist-1', 'TRAPPIST-1', ['trappist', '2mass j23062928-0502285'], '23 06 29.28', '-05 02 28.6', 12.43, 18.8, null, 0.119, 'M8 V', '40.7 ly · seven Earth-sized planets', 2566],

  // Bright and named.
  ['altair', 'Altair', ['alpha aquilae'], '19 50 47.00', '+08 52 06.0', 5.13, 0.76, 0.22, 1.79, 'A7 V', '16.7 ly · spins once in 9 hours, flattened by it'],
  ['vega', 'Vega', ['alpha lyrae'], '18 36 56.34', '+38 47 01.3', 7.68, 0.03, 0.0, 2.5, 'A0 V', '25.0 ly · the zero of the magnitude scale'],
  ['fomalhaut', 'Fomalhaut', ['alpha piscis austrini'], '22 57 39.05', '-29 37 20.1', 7.7, 1.16, 0.09, 1.842, 'A3 V', '25.1 ly · ringed by a dust belt'],
  ['pollux', 'Pollux', ['beta geminorum'], '07 45 18.95', '+28 01 34.3', 10.36, 1.14, 1.0, 8.8, 'K0 III', '33.8 ly · the nearest giant star'],
  ['arcturus', 'Arcturus', ['alpha bootis'], '14 15 39.67', '+19 10 56.7', 11.26, -0.05, 1.23, 25.4, 'K1.5 III', '36.7 ly · the brightest star in the northern sky'],
  ['capella', 'Capella', ['alpha aurigae'], '05 16 41.36', '+45 59 52.8', 13.12, 0.08, 0.8, 11.98, 'G3 III', '42.9 ly · two giants 0.74 AU apart'],
  ['castor', 'Castor', ['alpha geminorum'], '07 34 35.87', '+31 53 17.8', 15.6, 1.58, 0.03, 2.4, 'A1 V', '51 ly · six stars in three pairs'],
  ['aldebaran', 'Aldebaran', ['alpha tauri', 'bulls eye'], '04 35 55.24', '+16 30 33.5', 20.0, 0.86, 1.54, 44.2, 'K5 III', '65 ly · the eye of the Bull'],
  ['regulus', 'Regulus', ['alpha leonis'], '10 08 22.31', '+11 58 01.9', 24.3, 1.4, -0.11, 3.5, 'B8 IVn', '79 ly · the heart of the Lion'],
  ['merak', 'Merak', ['beta ursae majoris'], '11 01 50.48', '+56 22 56.7', 24.4, 2.37, -0.02, 3.0, 'A1 V', '79.7 ly · a pointer of the Big Dipper'],
  ['dubhe', 'Dubhe', ['alpha ursae majoris'], '11 03 43.67', '+61 45 03.7', 37.7, 1.79, 1.07, 30, 'K0 III', '123 ly · the other pointer, to Polaris'],
  ['phecda', 'Phecda', ['gamma ursae majoris'], '11 53 49.85', '+53 41 41.1', 25.5, 2.44, 0.0, 3.0, 'A0 V', '83 ly · Big Dipper'],
  ['megrez', 'Megrez', ['delta ursae majoris'], '12 15 25.56', '+57 01 57.4', 24.7, 3.31, 0.08, 1.4, 'A3 V', '80.5 ly · Big Dipper'],
  ['alioth', 'Alioth', ['epsilon ursae majoris'], '12 54 01.75', '+55 57 35.4', 25.3, 1.77, -0.02, 4.1, 'A1 III–IVp', '82.6 ly · Big Dipper'],
  ['mizar', 'Mizar', ['zeta ursae majoris'], '13 23 55.54', '+54 55 31.3', 25.7, 2.23, 0.02, 2.4, 'A2 V', '83 ly · the first double star seen in a telescope'],
  ['alcor', 'Alcor', ['80 ursae majoris'], '13 25 13.54', '+54 59 16.7', 25.0, 3.99, 0.16, 1.8, 'A5 V', '82 ly · Mizar’s naked-eye companion'],
  ['alkaid', 'Alkaid', ['benetnasch', 'eta ursae majoris'], '13 47 32.44', '+49 18 47.8', 31.9, 1.86, -0.19, 3.4, 'B3 V', '104 ly · the end of the Dipper’s handle'],
  ['algol', 'Algol', ['beta persei', 'demon star'], '03 08 10.13', '+40 57 20.3', 27.6, 2.12, -0.05, 2.73, 'B8 V', '90 ly · an eclipsing binary'],
  ['achernar', 'Achernar', ['alpha eridani'], '01 37 42.85', '-57 14 12.3', 42.7, 0.46, -0.16, 9.2, 'B6 Vep', '139 ly · the flattest star known'],
  ['gacrux', 'Gacrux', ['gamma crucis'], '12 31 09.96', '-57 06 47.6', 27.2, 1.64, 1.6, 84, 'M3.5 III', '88.6 ly · the top of the Southern Cross'],
  ['canopus', 'Canopus', ['alpha carinae'], '06 23 57.11', '-52 41 44.4', 94.8, -0.74, 0.15, 71.4, 'A9 II', '310 ly · the second-brightest star'],
  ['spica', 'Spica', ['alpha virginis'], '13 25 11.58', '-11 09 40.8', 76.6, 0.97, -0.23, 7.47, 'B1 III–IV', '250 ly · a hot, close binary'],
  ['bellatrix', 'Bellatrix', ['gamma orionis'], '05 25 07.86', '+06 20 58.9', 77.4, 1.64, -0.22, 5.75, 'B2 III', '250 ly · Orion’s shoulder'],
  ['mimosa', 'Mimosa', ['beta crucis', 'becrux'], '12 47 43.27', '-59 41 19.6', 85.4, 1.25, -0.23, 8.4, 'B0.5 III', '280 ly · the Southern Cross'],
  ['acrux', 'Acrux', ['alpha crucis'], '12 26 35.90', '-63 05 56.7', 98.7, 0.76, -0.24, 7.8, 'B0.5 IV', '321 ly · the foot of the Southern Cross'],
  ['thuban', 'Thuban', ['alpha draconis'], '14 04 23.35', '+64 22 33.1', 94.7, 3.65, -0.05, 3.4, 'A0 III', '309 ly · the pole star when the pyramids were built'],
  ['hadar', 'Hadar', ['agena', 'beta centauri'], '14 03 49.40', '-60 22 22.9', 120, 0.61, -0.23, 9.0, 'B1 III', '390 ly · the pointer to the Southern Cross'],
  ['albireo', 'Albireo', ['beta cygni', 'albireo a'], '19 30 43.28', '+27 57 34.8', 121, 3.18, 1.13, 69, 'K3 II', '395 ly · gold, with a blue companion'],
  ['albireo-b', 'Albireo B', ['beta2 cygni'], '19 30 45.40', '+27 57 55.0', 121, 5.09, -0.1, 2.7, 'B8 Ve', '395 ly · the blue half of the pair'],
  ['polaris', 'Polaris', ['north star', 'pole star', 'alpha ursae minoris'], '02 31 49.09', '+89 15 50.8', 132.6, 1.98, 0.6, 37.5, 'F7 Ib', '433 ly · the North Star, a Cepheid'],
  ['antares', 'Antares', ['alpha scorpii', 'heart of the scorpion'], '16 29 24.46', '-26 25 55.2', 170, 1.06, 1.83, 680, 'M1.5 Iab', '550 ly · a red supergiant 680 times the Sun’s size'],
  // Betelgeuse: Joyce et al. (2020), 168 pc from seismology and evolution models.
  ['betelgeuse', 'Betelgeuse', ['alpha orionis'], '05 55 10.31', '+07 24 25.4', 168, 0.5, 1.85, 764, 'M1–2 Ia–ab', '548 ly · a red supergiant near its end'],
  ['saiph', 'Saiph', ['kappa orionis'], '05 47 45.39', '-09 40 10.6', 198, 2.09, -0.17, 22.2, 'B0.5 Ia', '650 ly · Orion’s knee'],
  ['alnitak', 'Alnitak', ['zeta orionis'], '05 40 45.53', '-01 56 33.3', 226, 1.77, -0.21, 20, 'O9.5 Iab', '740 ly · Orion’s belt, beside the Horsehead'],
  ['rigel', 'Rigel', ['beta orionis'], '05 14 32.27', '-08 12 05.9', 264, 0.13, -0.03, 78.9, 'B8 Ia', '860 ly · a blue supergiant'],
  // Mintaka and Alnilam: their Hipparcos parallaxes are unreliable; these are the Orion OB1b distances.
  ['mintaka', 'Mintaka', ['delta orionis'], '05 32 00.40', '-00 17 56.7', 380, 2.23, -0.22, 16.5, 'O9.5 II', '1,200 ly · Orion’s belt'],
  ['alnilam', 'Alnilam', ['epsilon orionis'], '05 36 12.81', '-01 12 06.9', 606, 1.69, -0.18, 42, 'B0 Ia', '2,000 ly · the middle of Orion’s belt'],
  // Deneb: Schiller & Przybilla (2008), 802 pc from its spectrum.
  ['deneb', 'Deneb', ['alpha cygni'], '20 41 25.92', '+45 16 49.2', 802, 1.25, 0.09, 203, 'A2 Ia', '2,600 ly · one of the most luminous stars seen by eye'],
  // VY CMa: Zhang et al. (2012), 1.17 kpc by maser parallax.
  ['vy-canis-majoris', 'VY Canis Majoris', ['vy cma'], '07 22 58.33', '-25 46 03.2', 1170, 7.96, 2.24, 1420, 'M5e Ia', '3,800 ly · one of the largest stars known'],
  ['eta-carinae', 'Eta Carinae', ['eta car'], '10 45 03.59', '-59 41 04.3', 2300, 6.21, 0.61, 240, 'LBV', '7,500 ly · a star that erupted in the 1840s'],
]

/** Stars whose catalogue magnitude varies more than the gate's tolerance. */
export const VARIABLE = new Set(['betelgeuse', 'antares', 'eta-carinae', 'vy-canis-majoris', 'algol', 'polaris', 'mira'])

/** The Pleiades, each at the cluster's distance: 136.2 pc (VLBI; Melis et al. 2014). */
const PLEIADES_PC = 136.2
const PLEIADES = [
  ['alcyone', 'Alcyone', ['eta tauri'], '03 47 29.08', '+24 06 18.5', 2.87, -0.09, 9.3, 'B7 IIIe'],
  ['atlas', 'Atlas', ['27 tauri'], '03 49 09.74', '+24 03 12.3', 3.62, -0.08, 5.0, 'B8 III'],
  ['electra', 'Electra', ['17 tauri'], '03 44 52.54', '+24 06 48.0', 3.7, -0.11, 6.1, 'B6 IIIe'],
  ['maia', 'Maia', ['20 tauri'], '03 45 49.61', '+24 22 03.9', 3.87, -0.07, 5.5, 'B8 III'],
  ['merope', 'Merope', ['23 tauri'], '03 46 19.57', '+23 56 54.1', 4.18, -0.06, 4.0, 'B6 IVe'],
  ['taygeta', 'Taygeta', ['19 tauri'], '03 45 12.50', '+24 28 02.2', 4.3, -0.11, 3.3, 'B6 IV'],
  ['pleione', 'Pleione', ['28 tauri'], '03 49 11.22', '+24 08 12.2', 5.05, -0.08, 3.2, 'B8 Vne'],
  ['celaeno', 'Celaeno', ['16 tauri'], '03 44 48.22', '+24 17 22.1', 5.45, -0.04, 2.0, 'B7 IV'],
  ['asterope', 'Asterope', ['21 tauri', 'sterope'], '03 45 54.48', '+24 33 16.2', 5.76, -0.03, 2.0, 'B8 V'],
]

const ly = (pc) => (pc * PARSEC) / LIGHT_YEAR

/** Every named star: position (scene metres from the Sun), and what it looks like. */
export const NAMED_STARS = [
  ...STAR_ROWS.map(([id, name, aliases, ra, dec, pc, v, bv, r, type, line, teff]) => ({
    id, name, aliases, ra: hms(ra), dec: dms(dec), pc, v, bv, radius: r, type, line, teff,
  })),
  ...PLEIADES.map(([id, name, aliases, ra, dec, v, bv, r, type]) => ({
    id,
    name,
    aliases: [...aliases, 'pleiades', 'seven sisters'],
    ra: hms(ra),
    dec: dms(dec),
    pc: PLEIADES_PC,
    v,
    bv,
    radius: r,
    type,
    line: `${Math.round(ly(PLEIADES_PC))} ly · one of the Pleiades`,
    cluster: 'pleiades',
  })),
].map((s) => {
  s.abs = sceneAt(new THREE.Vector3(), s.ra, s.dec, s.pc * PARSEC)
  // Absolute magnitude from the catalogue magnitude and the distance modulus.
  s.absMag = s.v - 5 * Math.log10(s.pc / 10)
  return s
})

/* ---------------------------------------------------------------- *
 * Nebulae, clusters, the Galaxy's centre
 * ---------------------------------------------------------------- */

/**
 * [id, name, aliases, kind, RA, Dec, distance pc, radius pc, look, line].
 * `look` names the shape the volume renderer draws (gfx/deepSky.js); each is
 * a family — an H II region, a planetary nebula, a remnant — seeded per
 * object, so the Orion Nebula is an ionised cavity with a bright core and not
 * a photograph of one.
 */
const DEEP_ROWS = [
  ['orion-nebula', 'Orion Nebula', ['m42', 'messier 42', 'great orion nebula', 'ngc 1976'], 'nebula', '05 35 17.3', '-05 23 28', 414, 4.0, 'hii-blister', 'The nearest big star nursery · 1,350 ly'],
  ['horsehead-nebula', 'Horsehead Nebula', ['barnard 33', 'b33', 'ic 434'], 'nebula', '05 40 59.0', '-02 27 30', 400, 1.6, 'dark-pillar', 'A dark cloud against glowing hydrogen · 1,300 ly'],
  ['crab-nebula', 'Crab Nebula', ['m1', 'messier 1', 'ngc 1952'], 'nebula', '05 34 31.94', '+22 00 52.2', 2000, 1.7, 'remnant-crab', 'The wreck of the supernova of 1054 · 6,500 ly'],
  ['ring-nebula', 'Ring Nebula', ['m57', 'messier 57', 'ngc 6720'], 'nebula', '18 53 35.08', '+33 01 45.0', 787, 0.35, 'planetary-ring', 'A dying star’s shed shell · 2,570 ly'],
  ['helix-nebula', 'Helix Nebula', ['ngc 7293', 'eye of god'], 'nebula', '22 29 38.55', '-20 50 13.6', 201, 0.8, 'planetary-helix', 'The nearest bright planetary nebula · 655 ly'],
  ['eagle-nebula', 'Eagle Nebula', ['m16', 'messier 16', 'pillars of creation', 'ngc 6611'], 'nebula', '18 18 48.0', '-13 49 00', 1740, 9.0, 'hii-pillars', 'The Pillars of Creation · 5,700 ly'],
  ['lagoon-nebula', 'Lagoon Nebula', ['m8', 'messier 8', 'ngc 6523'], 'nebula', '18 03 37.0', '-24 23 12', 1250, 14, 'hii-lagoon', 'A nursery cut by a dark lane · 4,100 ly'],
  ['carina-nebula', 'Carina Nebula', ['ngc 3372', 'great nebula in carina'], 'nebula', '10 45 08.5', '-59 52 04', 2300, 38, 'hii-carina', 'Home of Eta Carinae · 7,500 ly'],
  ['rosette-nebula', 'Rosette Nebula', ['ngc 2237', 'caldwell 49'], 'nebula', '06 33 45.0', '+04 59 54', 1600, 17, 'hii-shell', 'A shell blown by the cluster inside it · 5,200 ly'],
  ['north-america-nebula', 'North America Nebula', ['ngc 7000'], 'nebula', '20 59 17.1', '+44 31 44', 795, 14, 'hii-lagoon', 'Shaped like its name · 2,600 ly'],
  ['veil-nebula', 'Veil Nebula', ['cygnus loop', 'ngc 6960', 'ngc 6992'], 'nebula', '20 51 00.0', '+30 40 00', 735, 19, 'remnant-shell', 'A supernova shell 10,000 years old · 2,400 ly'],
  ['pleiades', 'Pleiades', ['m45', 'messier 45', 'seven sisters', 'subaru'], 'cluster', '03 47 24.0', '+24 07 00', 136.2, 4.0, 'open-reflection', 'A young cluster in a passing dust cloud · 444 ly'],
  ['hyades', 'Hyades', ['melotte 25', 'caldwell 41'], 'cluster', '04 26 54.0', '+15 52 00', 47.0, 5.0, 'open', 'The nearest open cluster · 153 ly'],
  // Globulars: Baumgardt et al. (2019) distances.
  ['omega-centauri', 'Omega Centauri', ['ngc 5139', 'omega cen'], 'cluster', '13 26 47.28', '-47 28 46.1', 5430, 28, 'globular-big', 'Ten million stars · 17,700 ly'],
  ['hercules-cluster', 'Hercules Cluster', ['m13', 'messier 13', 'great globular cluster in hercules'], 'cluster', '16 41 41.24', '+36 27 35.5', 7420, 18, 'globular', 'The northern sky’s great globular · 24,000 ly'],
  ['47-tucanae', '47 Tucanae', ['ngc 104', '47 tuc'], 'cluster', '00 24 05.67', '-72 04 52.6', 4520, 20, 'globular', 'Beside the Small Magellanic Cloud · 14,700 ly'],
  // The Galaxy's centre: GRAVITY (2019) — the distance above is R0.
  ['sagittarius-a', 'Sagittarius A*', ['sgr a', 'sgr a*', 'black hole', 'galactic center', 'galactic centre', 'center of the galaxy', 'centre of the milky way'], 'region', '17 45 40.04', '-29 00 28.1', 8178, 0.0003, 'black-hole', '4.15 million Suns in a black hole · 26,700 ly'],
]

export const DEEP_SKY = DEEP_ROWS.map(([id, name, aliases, kind, ra, dec, pc, rpc, look, line]) => ({
  id,
  name,
  aliases,
  kind,
  ra: hms(ra),
  dec: dms(dec),
  pc,
  radiusPc: rpc,
  look,
  line,
  abs: sceneAt(new THREE.Vector3(), hms(ra), dms(dec), pc * PARSEC),
}))

/* ---------------------------------------------------------------- *
 * Star clusters: the glow and the stars
 * ---------------------------------------------------------------- */

/**
 * A globular cluster is a Plummer sphere of old stars: its unresolved light
 * is drawn as a volume (the galaxy renderer's cored profile, scaled to the
 * cluster's integrated magnitude), and its brightest members — red giants and
 * the horizontal branch — as stars. Integrated M_V and half-light radius from
 * the Harris catalogue (2010 edition); a Plummer sphere's projected
 * half-light radius is its scale length.
 */
const GLOBULAR_ROWS = [
  ['omega-centauri', -10.26, 7.9, 1],
  ['hercules-cluster', -8.55, 3.65, 2],
  ['47-tucanae', -9.42, 4.17, 3],
]

/** Seeded uniform numbers (mulberry32), so a cluster is the same cluster every load. */
function rng(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** A point of a Plummer sphere of scale a, by inverting its enclosed mass. */
function plummerPoint(r01, a, out) {
  const m = Math.min(r01(), 0.995)
  const r = a / Math.sqrt(Math.pow(m, -2 / 3) - 1)
  const u = 2 * r01() - 1
  const ph = 2 * Math.PI * r01()
  const s = Math.sqrt(1 - u * u)
  return out.set(r * s * Math.cos(ph), r * s * Math.sin(ph), r * u)
}

/** Volumes for the globulars' unresolved light, in the galaxies' format. */
export const GLOBULAR_VOLUMES = GLOBULAR_ROWS.map(([id, absV, rh]) => {
  const o = DEEP_ROWS.find((r) => r[0] === id)
  const ra = hms(o[4])
  const dec = dms(o[5])
  return {
    id: `${id}:glow`,
    name: o[1],
    ra,
    dec,
    kpc: o[6] / 1000,
    radiusKpc: (rh * 6) / 1000,
    pa: 0,
    inc: 0,
    absV,
    model: { type: 'dsph', re: rh / 1000, q: 1, seed: id.length * 13 },
    abs: sceneAt(new THREE.Vector3(), ra, dec, o[6] * PARSEC),
    basis: skyDiscBasis(ra, dec, 0, 0, 1),
  }
})

/**
 * Member stars drawn one by one: for each globular its brightest few
 * thousand — the red giant branch (M_V −2.5 to +0.5, ~4,300 K) and the
 * horizontal branch (M_V ≈ +0.5, 7,000–12,000 K for these blue-HB clusters)
 * — and for the Pleiades and the Hyades their fainter members down the main
 * sequence, from a Salpeter-like luminosity function. Positions are Plummer
 * draws about the cluster centre; the stars are real kinds of star in real
 * numbers, placed by chance.
 */
export const CLUSTER_MEMBERS = (() => {
  const out = []
  const v = new THREE.Vector3()
  const add = (centre, count, a, seed, draw) => {
    const r01 = rng(seed)
    for (let i = 0; i < count; i++) {
      plummerPoint(r01, a, v)
      const [absMag, teff] = draw(r01)
      out.push({ abs: centre.clone().add(v), absMag, teff })
    }
  }
  for (const [id, , rh, seed] of GLOBULAR_ROWS) {
    const o = DEEP_SKY.find((d) => d.id === id)
    add(o.abs, 5200, rh * PARSEC, seed * 7919, (r) => {
      const k = r()
      if (k < 0.62) return [-2.5 + 3.0 * Math.pow(r(), 0.45), 4000 + 800 * r()] // red giant branch
      if (k < 0.9) return [0.3 + 0.5 * r(), 7000 + 5000 * r()] // horizontal branch
      return [0.8 + 1.4 * r(), 4700 + 900 * r()] // subgiants
    })
  }
  const pleiades = DEEP_SKY.find((d) => d.id === 'pleiades')
  add(pleiades.abs, 700, 1.4 * PARSEC, 45, (r) => {
    const M = 1.2 + 9 * Math.pow(r(), 0.55)
    return [M, Math.max(3000, 11000 - 800 * M)]
  })
  const hyades = DEEP_SKY.find((d) => d.id === 'hyades')
  add(hyades.abs, 320, 2.6 * PARSEC, 25, (r) => {
    const M = 0.5 + 10 * Math.pow(r(), 0.55)
    return [M, Math.max(3000, 9500 - 650 * M)]
  })
  return out
})()

/** Sgr A*'s mass (GRAVITY 2019) and its Schwarzschild radius, 2GM/c². */
export const SGR_A_MASS = 4.152e6 * 1.98847e30
export const SGR_A_RS = (2 * 6.6743e-11 * SGR_A_MASS) / 299792458 ** 2

/**
 * The black hole's frame for the renderer: +y is the accretion disc's axis.
 * Sgr A*'s is not known; it is taken as the Galaxy's own north tipped 12°,
 * and the camera settles 25° above the disc so the lifted image of its far
 * side reads over the shadow.
 */
export const SGR_A_FRAME = (() => {
  const e = MILKY_WAY_FRAME.basis.elements
  const X = new THREE.Vector3(e[0], e[1], e[2])
  const Y = new THREE.Vector3(e[4], e[5], e[6])
  const Z = new THREE.Vector3(e[8], e[9], e[10])
  const up = Z.clone().multiplyScalar(Math.cos(0.21)).addScaledVector(X, Math.sin(0.21)).normalize()
  const x = Y.clone().addScaledVector(up, -Y.dot(up)).normalize()
  const z = new THREE.Vector3().crossVectors(x, up).normalize()
  const view = z.clone().multiplyScalar(Math.cos(25 * DEG)).addScaledVector(up, Math.sin(25 * DEG)).normalize()
  return { basis: new THREE.Matrix4().makeBasis(x, up, z), view }
})()

/* ---------------------------------------------------------------- *
 * Galaxies
 * ---------------------------------------------------------------- */

/**
 * [id, name, aliases, RA, Dec, distance kpc, radius kpc, PA°, inclination°,
 *  absolute V, model, line].
 *
 * Distances: Cepheid and tip-of-the-red-giant-branch measurements (the LMC's
 * from eclipsing binaries, Pietrzyński et al. 2019, to 1%). Orientations are
 * the published kinematic PA and inclination. `model` is the structural
 * family the renderer draws and its parameters: the Milky Way's are measured
 * from inside (gfx/galaxyModel.js), the others follow their own photometry
 * (scale length, bulge, arms, bar), and the fine structure — which knot is
 * where — is seeded rather than copied.
 */
const GALAXY_ROWS = [
  ['andromeda', 'Andromeda Galaxy', ['m31', 'messier 31', 'andromeda', 'ngc 224'], '00 42 44.3', '+41 16 09', 765, 30, 38, 77, -21.5,
    { type: 'spiral', Rd: 5.3, hz: 0.45, bulge: 0.5, rb: 2.0, arms: 2, pitch: 8, armW: 0.9, ring: 10, ringW: 1.6, dust: 2.0, hii: 0.5, seed: 31 },
    'Our nearest large neighbour · 2.5 million ly'],
  ['m32', 'M32', ['messier 32', 'ngc 221'], '00 42 41.8', '+40 51 55', 763, 1.0, 170, 40, -16.4,
    { type: 'elliptical', re: 0.11, q: 0.8, seed: 32 }, 'A compact elliptical beside Andromeda'],
  ['m110', 'M110', ['messier 110', 'ngc 205'], '00 40 22.1', '+41 41 07', 824, 2.5, 170, 60, -16.5,
    { type: 'elliptical', re: 0.55, q: 0.5, seed: 110 }, 'Andromeda’s dwarf elliptical'],
  ['triangulum', 'Triangulum Galaxy', ['m33', 'messier 33', 'triangulum', 'ngc 598', 'pinwheel of triangulum'], '01 33 50.02', '+30 39 36.7', 840, 9, 23, 55, -18.8,
    { type: 'spiral', Rd: 1.6, hz: 0.25, bulge: 0.03, rb: 0.3, arms: 2, pitch: 24, armW: 0.55, dust: 0.5, hii: 1.4, flocculent: 0.7, seed: 33 },
    'The third spiral of the Local Group · 2.7 million ly'],
  ['lmc', 'Large Magellanic Cloud', ['lmc', 'magellanic cloud', 'large magellanic'], '05 23 34.5', '-69 45 22', 49.59, 8, 150, 26, -18.1,
    { type: 'magellanic', Rd: 1.5, hz: 0.4, bar: 1.7, barAngle: 20, arms: 1, pitch: 20, armW: 0.6, dust: 0.4, hii: 1.3, seed: 51 },
    'A satellite of the Milky Way · 162,000 ly'],
  ['smc', 'Small Magellanic Cloud', ['smc', 'small magellanic'], '00 52 44.8', '-72 49 43', 62.44, 3.5, 45, 65, -16.8,
    { type: 'irregular', Rd: 0.9, hz: 1.2, dust: 0.2, hii: 0.9, seed: 52 }, 'The LMC’s smaller companion · 204,000 ly'],
  ['sagittarius-dwarf', 'Sagittarius Dwarf', ['sgr dsph', 'sagittarius dwarf spheroidal'], '18 55 19.5', '-30 32 43', 26, 3.0, 104, 60, -13.5,
    { type: 'dsph', re: 1.5, q: 0.35, seed: 61 }, 'Being torn apart by the Milky Way, behind its centre'],
  ['fornax-dwarf', 'Fornax Dwarf', ['fornax dsph'], '02 39 59.3', '-34 26 57', 147, 1.8, 41, 45, -13.4,
    { type: 'dsph', re: 0.71, q: 0.7, seed: 62 }, 'A dwarf spheroidal with its own globular clusters'],
  ['sculptor-dwarf', 'Sculptor Dwarf', ['sculptor dsph'], '01 00 09.4', '-33 42 33', 86, 1.0, 99, 45, -10.8,
    { type: 'dsph', re: 0.28, q: 0.68, seed: 63 }, 'A faint, old satellite'],
  ['draco-dwarf', 'Draco Dwarf', ['draco dsph'], '17 20 12.4', '+57 54 55', 76, 0.8, 89, 45, -8.8,
    { type: 'dsph', re: 0.22, q: 0.69, seed: 64 }, 'Dominated by dark matter'],
  ['leo-i', 'Leo I', ['leo i dwarf'], '10 08 28.1', '+12 18 23', 254, 0.9, 79, 45, -12.0,
    { type: 'dsph', re: 0.25, q: 0.7, seed: 65 }, 'A distant satellite behind Regulus’ glare'],
  ['ngc-6822', "Barnard's Galaxy", ['ngc 6822', 'barnards galaxy'], '19 44 56.6', '-14 47 21', 459, 2.0, 5, 60, -15.2,
    { type: 'irregular', Rd: 0.6, hz: 0.5, dust: 0.3, hii: 1.1, seed: 66 }, 'A barred irregular of the Local Group'],
  ['ic-1613', 'IC 1613', [], '01 04 47.8', '+02 07 04', 755, 2.5, 58, 40, -15.2,
    { type: 'irregular', Rd: 0.9, hz: 0.5, dust: 0.1, hii: 0.7, seed: 67 }, 'A quiet dwarf irregular'],
  // Beyond the Local Group.
  ['m81', "Bode's Galaxy", ['m81', 'messier 81', 'bodes galaxy', 'ngc 3031'], '09 55 33.2', '+69 03 55', 3630, 18, 157, 59, -21.1,
    { type: 'spiral', Rd: 3.2, hz: 0.35, bulge: 0.35, rb: 0.9, arms: 2, pitch: 14, armW: 0.7, dust: 0.9, hii: 0.7, seed: 81 },
    'A grand-design spiral · 11.8 million ly'],
  ['m82', 'Cigar Galaxy', ['m82', 'messier 82', 'cigar galaxy', 'ngc 3034'], '09 55 52.7', '+69 40 46', 3530, 6, 65, 80, -19.9,
    { type: 'starburst', Rd: 1.1, hz: 0.25, bulge: 0.1, rb: 0.3, dust: 1.8, hii: 1.4, wind: 1.0, seed: 82 },
    'Bursting with new stars, blowing a wind · 11.5 million ly'],
  // Oriented by its dust disc (PA 115°, inclined 73°); the elliptical round it is nearly round.
  ['centaurus-a', 'Centaurus A', ['ngc 5128', 'cen a'], '13 25 27.6', '-43 01 09', 3800, 16, 115, 73, -21.0,
    { type: 'lenticular-dust', re: 5.0, q: 0.85, dustPA: 115, dustInc: 73, dustR: 5.0, jets: 1, seed: 128 },
    'An elliptical that swallowed a spiral · 12 million ly'],
  ['whirlpool', 'Whirlpool Galaxy', ['m51', 'messier 51', 'whirlpool', 'ngc 5194'], '13 29 52.7', '+47 11 43', 8580, 15, 163, 22, -21.2,
    { type: 'spiral', Rd: 2.8, hz: 0.3, bulge: 0.15, rb: 0.6, arms: 2, pitch: 18, armW: 0.6, dust: 1.1, hii: 1.1, seed: 51 },
    'The spiral Lord Rosse drew in 1845 · 28 million ly'],
  ['ngc-5195', 'NGC 5195', ['m51b', 'whirlpool companion'], '13 29 59.6', '+47 15 58', 8580, 6, 79, 45, -19.7,
    { type: 'elliptical', re: 1.6, q: 0.8, dustLane: 0.6, seed: 5195 }, 'The Whirlpool’s companion'],
  ['pinwheel', 'Pinwheel Galaxy', ['m101', 'messier 101', 'pinwheel', 'ngc 5457'], '14 03 12.6', '+54 20 57', 6400, 28, 39, 18, -21.6,
    { type: 'spiral', Rd: 5.2, hz: 0.3, bulge: 0.05, rb: 0.5, arms: 4, pitch: 26, armW: 0.9, dust: 0.7, hii: 1.5, flocculent: 0.4, seed: 101 },
    'A lopsided giant spiral · 21 million ly'],
  ['southern-pinwheel', 'Southern Pinwheel', ['m83', 'messier 83', 'ngc 5236'], '13 37 00.9', '-29 51 56.7', 4660, 12, 45, 24, -20.9,
    { type: 'spiral', Rd: 2.4, hz: 0.3, bulge: 0.12, rb: 0.5, bar: 2.5, barAngle: 45, arms: 2, pitch: 15, armW: 0.6, dust: 1.2, hii: 1.3, seed: 83 },
    'A barred grand-design spiral · 15 million ly'],
  ['sculptor-galaxy', 'Sculptor Galaxy', ['ngc 253', 'silver coin'], '00 47 33.1', '-25 17 18', 3500, 14, 52, 76, -21.0,
    { type: 'spiral', Rd: 2.9, hz: 0.35, bulge: 0.12, rb: 0.5, bar: 1.8, barAngle: 20, arms: 2, pitch: 12, armW: 0.6, dust: 1.6, hii: 1.0, flocculent: 0.5, seed: 253 },
    'A dusty starburst spiral · 11 million ly'],
  ['sombrero', 'Sombrero Galaxy', ['m104', 'messier 104', 'sombrero', 'ngc 4594'], '12 39 59.4', '-11 37 23', 9550, 15, 90, 84, -22.2,
    { type: 'sombrero', Rd: 4.0, hz: 0.25, bulge: 0.8, rb: 2.5, ring: 8.5, ringW: 1.2, dust: 2.2, hii: 0.2, seed: 104 },
    'A bulge wrapped in a ring of dust · 31 million ly'],
  ['m87', 'M87', ['virgo a', 'messier 87', 'ngc 4486', 'm87 black hole'], '12 30 49.42', '+12 23 28.0', 16400, 40, 0, 0, -22.6,
    { type: 'elliptical', re: 7.7, q: 0.95, jet: 290, seed: 87 },
    'The giant at the heart of the Virgo Cluster · 53 million ly'],
]

export const GALAXIES = GALAXY_ROWS.map(([id, name, aliases, ra, dec, kpc, rkpc, pa, inc, absV, model, line]) => {
  const a = hms(ra)
  const d = dms(dec)
  return {
    id,
    name,
    aliases,
    ra: a,
    dec: d,
    kpc,
    radiusKpc: rkpc,
    pa,
    inc,
    absV,
    model,
    line,
    abs: sceneAt(new THREE.Vector3(), a, d, kpc * KILOPARSEC),
    basis: skyDiscBasis(a, d, pa * DEG, inc * DEG, 1),
  }
})

/* ---------------------------------------------------------------- *
 * Clusters of galaxies, and the largest structures
 * ---------------------------------------------------------------- */

/**
 * [id, name, aliases, RA, Dec, distance Mpc, radius Mpc, members, line].
 * Distances from redshift at H0 = 70 km/s/Mpc beyond the Local Group's
 * neighbourhood, where peculiar velocities stop mattering; Virgo's from
 * Cepheids and surface brightness fluctuations (Mei et al. 2007).
 */
const CLUSTER_ROWS = [
  ['virgo-cluster', 'Virgo Cluster', ['virgo', 'virgo cluster'], '12 27 00', '+12 43 00', 16.5, 2.2, 1500, 'Some 1,500 galaxies round M87 · 54 million ly'],
  ['fornax-cluster', 'Fornax Cluster', ['fornax cluster'], '03 38 29', '-35 27 03', 19.0, 1.2, 350, 'A compact southern cluster · 62 million ly'],
  ['norma-cluster', 'Norma Cluster', ['abell 3627', 'great attractor'], '16 15 03', '-60 54 26', 67, 2.5, 600, 'The Great Attractor, behind the Milky Way’s disc · 220 million ly'],
  ['perseus-cluster', 'Perseus Cluster', ['abell 426', 'perseus pisces'], '03 19 47.2', '+41 30 47', 77, 2.5, 1000, 'The heart of the Perseus–Pisces chain · 250 million ly'],
  ['coma-cluster', 'Coma Cluster', ['abell 1656', 'coma'], '12 59 48.7', '+27 58 50', 99, 3.0, 3000, 'Thousands of galaxies, where dark matter was first inferred · 320 million ly'],
  ['shapley-supercluster', 'Shapley Supercluster', ['shapley'], '13 25 00', '-31 00 00', 200, 12, 4000, 'The largest concentration of galaxies nearby · 650 million ly'],
]

export const GALAXY_CLUSTERS = CLUSTER_ROWS.map(([id, name, aliases, ra, dec, mpc, rmpc, members, line]) => ({
  id,
  name,
  aliases,
  ra: hms(ra),
  dec: dms(dec),
  mpc,
  radiusMpc: rmpc,
  members,
  line,
  abs: sceneAt(new THREE.Vector3(), hms(ra), dms(dec), mpc * MEGAPARSEC),
}))

/**
 * The comoving distance to the surface of last scattering, which is where the
 * cosmic microwave background was emitted: 13.9 Gpc for Planck 2018's flat
 * ΛCDM. The particle horizon — the edge of the observable universe — is a
 * little further, 14.3 Gpc.
 */
export const CMB_DISTANCE = 13.9e3 * MEGAPARSEC
export const HORIZON_DISTANCE = 14.3e3 * MEGAPARSEC

/* ---------------------------------------------------------------- *
 * Registration
 * ---------------------------------------------------------------- */

const fmtLy = (pc) => {
  const y = ly(pc)
  if (y < 100) return `${y.toFixed(1)} light-years`
  if (y < 1e5) return `${Math.round(y).toLocaleString('en-US')} light-years`
  if (y < 1e9) return `${(y / 1e6).toPrecision(3)} million light-years`
  return `${(y / 1e9).toPrecision(3)} billion light-years`
}

/**
 * A camera target: the radius it is framed from, and the direction it is seen
 * from when the camera settles on it (`view`, a unit vector from the object
 * toward the camera). By default that is from the Sun's side — a galaxy or a
 * nebula looks the way every photograph of it looks, because every photograph
 * of it was taken from here — turned a little so the approach is not dead on.
 */
const _up = new THREE.Vector3(0, 1, 0)
function place(id, abs, radius, frame, extra = {}) {
  const view = extra.view ?? (abs.lengthSq() > 0 ? abs.clone().negate().normalize().applyAxisAngle(_up, 0.28) : new THREE.Vector3(0.45, 0.35, 1).normalize())
  COSMIC[id] = { abs, radius, frame, min: extra.min ?? 1.05, maxDistance: extra.max, ...extra, view }
}

let registered = false

/**
 * Put everything above on the map and in the search. Idempotent; called once
 * at module load, and again harmlessly under hot reload.
 */
export function registerCosmos() {
  if (registered) return
  registered = true

  for (const s of NAMED_STARS) {
    // A star fills about a third of the frame; a named pair is framed as a pair.
    place(s.id, s.abs, s.radius * SOLAR_RADIUS, 8, { star: s })
  }
  // Alpha Centauri as a system: A and B 22 AU apart on the sky at J2000,
  // framed about their barycentre (masses 1.08 and 0.91 M☉), Proxima 13,000 AU off.
  const A = NAMED_STARS.find((s) => s.id === 'alpha-centauri-a')
  const B = NAMED_STARS.find((s) => s.id === 'alpha-centauri-b')
  const bary = A.abs.clone().lerp(B.abs, 0.91 / (1.08 + 0.91))
  place('alpha-centauri', bary, 14 * AU, 3.2, { system: ['alpha-centauri-a', 'alpha-centauri-b'] })

  for (const o of DEEP_SKY) {
    const r = o.radiusPc * PARSEC
    if (o.look === 'black-hole') place(o.id, o.abs, SGR_A_RS, 26, { deep: o, min: 2.2, max: 1e6, view: SGR_A_FRAME.view })
    else place(o.id, o.abs, r, o.kind === 'cluster' ? 3 : 2.6, { deep: o, min: 0.05 })
  }
  for (const g of GALAXIES) place(g.id, g.abs, g.radiusKpc * KILOPARSEC, 2.6, { galaxy: g, min: 0.02 })
  for (const c of GALAXY_CLUSTERS) place(c.id, c.abs, c.radiusMpc * MEGAPARSEC, 2.8, { cluster: c, min: 0.02 })

  // Regions: the Galaxy itself, its neighbourhood, and the largest scales.
  const mw = MILKY_WAY_FRAME.centre
  // The Galaxy from 35° off its north pole, leaning toward the Sun's side, so
  // the bar, the arms and where we are all read at once.
  const e = MILKY_WAY_FRAME.basis.elements
  const pole = new THREE.Vector3(e[8], e[9], e[10])
  const toSun = mw.clone().negate()
  toSun.addScaledVector(pole, -toSun.dot(pole)).normalize()
  const mwView = pole.clone().multiplyScalar(Math.cos(35 * DEG)).addScaledVector(toSun, Math.sin(35 * DEG)).normalize()
  place('milky-way', mw.clone(), 16 * KILOPARSEC, 2.7, { region: 'milky-way', min: 0.02, view: mwView })
  const m31 = GALAXIES.find((g) => g.id === 'andromeda').abs
  // The Local Group's barycentre sits between the two giants, closer to Andromeda,
  // the heavier: about 0.55 of the way out on the usual mass ratio.
  place('local-group', mw.clone().lerp(m31, 0.55), 0.45 * MEGAPARSEC, 2.3, { region: 'local-group', min: 0.02 })
  place('laniakea', GALAXY_CLUSTERS.find((c) => c.id === 'norma-cluster').abs.clone().multiplyScalar(0.5), 80 * MEGAPARSEC, 2.4, { region: 'laniakea', min: 0.02 })
  place('observable-universe', new THREE.Vector3(), HORIZON_DISTANCE, 2.6, { region: 'universe', min: 0.01 })
  place('oort-cloud', new THREE.Vector3(), 50000 * AU, 2.6, { region: 'oort', min: 0.01 })
  // The heliosphere side-on, nose and tail both in view: the interstellar wind
  // arrives from ecliptic longitude 255.7°, latitude 5.1°.
  const noseLon = 255.7 * DEG
  const helioView = new THREE.Vector3(Math.sin(noseLon), 0.45, Math.cos(noseLon)).normalize()
  place('heliosphere', new THREE.Vector3(), 120 * AU, 4.2, { region: 'heliosphere', min: 0.05, view: helioView })

  const entries = []
  for (const s of NAMED_STARS) {
    entries.push({
      id: s.id,
      name: s.name,
      aliases: s.aliases,
      kind: 'star',
      hint: `${s.type} · ${s.line}`,
      focus: s.id,
      // A star that belongs to a named cluster answers to the cluster's name
      // too, and must not outrank it: someone typing "Seven Sisters" wants the
      // Pleiades, not Alcyone. Typing "Alcyone" still reaches Alcyone, whose
      // own name no cluster shares.
      weight: s.cluster ? 4 : s.v < 1.5 || s.pc < 4 ? 8 : 6,
    })
  }
  entries.push({
    id: 'alpha-centauri',
    name: 'Alpha Centauri',
    aliases: ['alpha cen', 'rigil kentaurus', 'nearest star system', 'alpha centauri system'],
    kind: 'star',
    hint: 'The nearest star system · 4.37 light-years · A and B, with Proxima',
    focus: 'alpha-centauri',
    weight: 9,
  })
  for (const o of DEEP_SKY) {
    entries.push({ id: o.id, name: o.name, aliases: o.aliases, kind: o.kind, hint: o.line, focus: o.id, weight: 7 })
  }
  for (const g of GALAXIES) {
    entries.push({ id: g.id, name: g.name, aliases: g.aliases, kind: 'galaxy', hint: g.line, focus: g.id, weight: g.absV < -20 || g.kpc < 100 ? 8 : 5 })
  }
  for (const c of GALAXY_CLUSTERS) {
    entries.push({ id: c.id, name: c.name, aliases: c.aliases, kind: 'region', hint: c.line, focus: c.id, weight: 6 })
  }
  entries.push(
    { id: 'milky-way', name: 'Milky Way', aliases: ['our galaxy', 'the galaxy', 'galaxy', 'home galaxy', 'milky way galaxy'], kind: 'galaxy', hint: 'Our galaxy, seen from outside · 100,000 light-years across', focus: 'milky-way', weight: 10 },
    { id: 'local-group', name: 'Local Group', aliases: ['local group of galaxies'], kind: 'region', hint: 'The Milky Way, Andromeda and some eighty dwarfs', focus: 'local-group', weight: 7 },
    { id: 'laniakea', name: 'Laniakea Supercluster', aliases: ['laniakea', 'supercluster', 'our supercluster'], kind: 'region', hint: 'The supercluster we live in · 500 million light-years across', focus: 'laniakea', weight: 7 },
    { id: 'observable-universe', name: 'Observable Universe', aliases: ['universe', 'cosmos', 'cmb', 'cosmic microwave background', 'big bang', 'edge of the universe', 'cosmic web'], kind: 'region', hint: 'Out to the cosmic microwave background · 46 billion light-years', focus: 'observable-universe', weight: 8 },
    { id: 'oort-cloud', name: 'Oort Cloud', aliases: ['oort', 'comet cloud'], kind: 'region', hint: 'A shell of comets out to a light-year', focus: 'oort-cloud', weight: 6 },
    { id: 'heliosphere', name: 'Heliosphere', aliases: ['heliopause', 'termination shock', 'solar wind bubble', 'interstellar space'], kind: 'region', hint: 'The solar wind’s bubble · 120 AU', focus: 'heliosphere', weight: 6 },
  )
  addEntries(entries)
}

registerCosmos()

export { fmtLy }
