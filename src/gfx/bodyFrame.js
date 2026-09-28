import { equatorialToScene } from './stars.js'

/**
 * A body's orientation, from the IAU's own description of it.
 *
 * The Working Group on Cartographic Coordinates and Rotational Elements gives
 * every body a north pole (right ascension α₀, declination δ₀, ICRF) and a
 * prime meridian angle W measured along its equator from the node of that
 * equator on the ICRF equator. The body-fixed frame is then
 *
 *   r_icrf = Rz(α₀ + 90°) · Rx(90° − δ₀) · Rz(W) · r_body
 *
 * and the scene is reached through `equatorialToScene`, the same rotation the
 * Hipparcos sky is drawn with — so a planet's pole points at the stars it
 * points at in the real sky, by construction.
 *
 * A mesh's object space is y-up, so the body frame (x to the prime meridian, z
 * to the north pole, y to 90°E) is folded onto it as (X, Z, −Y), which is a
 * proper rotation: east longitude λ at latitude φ is the object-space point
 * (cos φ cos λ, sin φ, −cos φ sin λ).
 *
 * `out` is a flat array of nine numbers (column-major, three columns: the scene
 * images of the object's x, y and z axes). Allocation-free.
 */
const DEG = Math.PI / 180
const _a = new Float64Array(3)
const _b = new Float64Array(3)

export function bodyAxes(out, raDeg, decDeg, wDeg) {
  const a = (raDeg + 90) * DEG
  const b = (90 - decDeg) * DEG
  const w = wDeg * DEG
  const ca = Math.cos(a)
  const sa = Math.sin(a)
  const cb = Math.cos(b)
  const sb = Math.sin(b)
  const cw = Math.cos(w)
  const sw = Math.sin(w)
  // Body X (prime meridian) in ICRF → object x.
  equatorialToScene(_a, ca * cw - sa * cb * sw, sa * cw + ca * cb * sw, sb * sw)
  out[0] = _a[0]
  out[1] = _a[1]
  out[2] = _a[2]
  // Body Z (north pole) → object y.
  equatorialToScene(_a, sa * sb, -ca * sb, cb)
  out[3] = _a[0]
  out[4] = _a[1]
  out[5] = _a[2]
  // −(body Y) → object z.
  equatorialToScene(_b, -(-ca * sw - sa * cb * cw), -(-sa * sw + ca * cb * cw), -(sb * cw))
  out[6] = _b[0]
  out[7] = _b[1]
  out[8] = _b[2]
  return out
}

/** A pole alone, in scene coordinates: the unit vector α₀, δ₀ points at. */
export function poleDirection(out, raDeg, decDeg) {
  const a = raDeg * DEG
  const d = decDeg * DEG
  return equatorialToScene(out, Math.cos(d) * Math.cos(a), Math.cos(d) * Math.sin(a), Math.sin(d))
}

/**
 * A synchronous moon: its pole is its planet's, and its prime meridian faces
 * the planet — the IAU convention for every tidally locked satellite, which is
 * what makes "the sub-Jovian point" a place on Io. `toParent` need not be
 * normalised or perpendicular to the pole.
 */
export function lockedAxes(out, pole, tx, ty, tz) {
  // X: the direction to the parent, with its component along the pole removed.
  const d = tx * pole[0] + ty * pole[1] + tz * pole[2]
  let x0 = tx - d * pole[0]
  let x1 = ty - d * pole[1]
  let x2 = tz - d * pole[2]
  const n = Math.hypot(x0, x1, x2) || 1
  x0 /= n
  x1 /= n
  x2 /= n
  // Y (90°E) = Z × X; object z is its negative.
  const y0 = pole[1] * x2 - pole[2] * x1
  const y1 = pole[2] * x0 - pole[0] * x2
  const y2 = pole[0] * x1 - pole[1] * x0
  out[0] = x0
  out[1] = x1
  out[2] = x2
  out[3] = pole[0]
  out[4] = pole[1]
  out[5] = pole[2]
  out[6] = -y0
  out[7] = -y1
  out[8] = -y2
  return out
}
