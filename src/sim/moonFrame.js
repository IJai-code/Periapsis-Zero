import { BODIES, ELEMENTS } from './constants.js'
import { MOON_MEAN } from './moonMean.js'

/**
 * The Moon's body-fixed frame: selenographic, turning with the Moon.
 *
 * +x is the prime meridian, 0° longitude, which faces the *mean* Earth; +z is
 * the north pole; +y is 90° east. A point on the Moon is fixed in this frame, so
 * it is what a site on the lunar surface stands in, the way `launchsite.js`'s
 * body-fixed basis is what a pad on Earth stands in.
 *
 * Until this existed there was no such frame. The Moon was drawn by pointing it
 * at Earth every frame, which is a statement about one hemisphere and not a
 * rotation: nothing on its surface had coordinates, and the Earth it faced never
 * moved in its sky. (It was also facing Earth with the wrong hemisphere: the
 * imagery's near side was a quarter-turn away, and Earth saw longitude 90°E.)
 *
 * ── Cassini's laws ────────────────────────────────────────────────────
 *
 * The Moon's rotation is described by three empirical laws, and with them it
 * takes three numbers the simulator already has:
 *
 * 1. It turns uniformly, once per sidereal month — the same period as its
 *    orbit, which is what tidal locking means.
 * 2. Its equator is tilted a fixed I to the ecliptic.
 * 3. The pole of its equator, the pole of the ecliptic and the pole of its
 *    orbit lie in one plane, with the ecliptic's between the other two — so the
 *    equator's ascending node on the ecliptic is the orbit's *descending* node,
 *    and it regresses with it — once in 18.6 years for the real Moon, 17.9 for
 *    the simulated one.
 *
 * I is the Moon's declared tilt to its own orbit less the orbit's inclination:
 * 6.68° − 5.145° = 1.535°, against a published 1.5424°. And the rotation is
 * phased so the prime meridian points at the mean Earth: from the Moon, Earth's
 * mean ecliptic longitude is the Moon's mean longitude plus 180°, and the
 * equator's node is the orbit's node plus 180°, so the prime meridian stands
 * `L − Ω` along the equator from that node.
 *
 * What this frame does *not* do is follow the Earth. The rotation is uniform and
 * the orbit is not — it is eccentric and inclined — so seen from the Moon the
 * Earth wanders: east and west as the orbital speed runs ahead of and behind the
 * uniform turn, north and south as the orbit's tilt carries it over and under
 * the equator. That is libration, and it comes out of these three laws rather
 * than being written in. `verify-moon-frame` measures it on the simulator's
 * own integrated orbit.
 *
 * The mean orbit is the *simulated* Moon's, measured, and not the real one's
 * (`scripts/measure-moon.mjs`, a year of the integrated system). Locking is to
 * the orbit the body is actually on, and the simulated orbit is not quite the
 * real one: its J2000 elements are mean values used as the osculating state,
 * and the Sun's tide moves the osculating semi-major axis by about a per cent
 * either side of the mean, so it runs a sidereal month of 27.614 d against the
 * real 27.322, with its mean longitude at J2000 216.83° against 218.32°. The
 * first version of this frame used the real Moon's figures and drifted 3.8° a
 * month off the Moon it was turning with.
 */

const DEG = Math.PI / 180

const L0 = MOON_MEAN.longitude
const L_RATE = MOON_MEAN.motion
const NODE0 = MOON_MEAN.node
const NODE_RATE = MOON_MEAN.nodeRate
const I = BODIES.moon.tilt - ELEMENTS.moon.i * DEG
const CI = Math.cos(I)
const SI = Math.sin(I)

/** The equator's inclination to the ecliptic, radians — Cassini's I. */
export const MOON_EQUATOR_TILT = I

/**
 * The spin about the Moon's own pole, rad/s: the mean motion less the node's
 * regression seen through the tilt, L' - Ω'(1 - cos I). The rate a point on
 * the surface is carried round at — 4.58 m/s at the equator.
 */
export const MOON_SPIN_RATE = L_RATE - NODE_RATE * (1 - CI)

/*
 * The time, in a slot rather than an argument: the renderer calls this every
 * frame and the clamp every step, and a double handed to a function V8 does
 * not inline is boxed at the call.
 */
export const moonClock = new Float64Array(1)

/**
 * The frame's axes at `moonClock[0]`, in the scene's ecliptic frame, written
 * into `out` as nine numbers: +x, then +y, then +z. Allocation-free.
 *
 * The rotation is the classical one — node, inclination, spin, R = Rz(Ω + π)
 * Rx(I) Rz(L − Ω) — worked in the ecliptic frame with z north and then carried
 * into the scene's, where y is north and z points to longitude −90°.
 */
export function moonAxes(out) {
  const t = moonClock[0]
  const node = NODE0 + NODE_RATE * t
  const a = node + Math.PI
  const w = L0 + L_RATE * t - node
  const ca = Math.cos(a)
  const sa = Math.sin(a)
  const cw = Math.cos(w)
  const sw = Math.sin(w)
  // +x: the prime meridian.
  out[0] = ca * cw - sa * CI * sw
  out[1] = SI * sw
  out[2] = -(sa * cw + ca * CI * sw)
  // +y: 90° east.
  out[3] = -ca * sw - sa * CI * cw
  out[4] = SI * cw
  out[5] = -(-sa * sw + ca * CI * cw)
  // +z: the north pole.
  out[6] = sa * SI
  out[7] = CI
  out[8] = ca * SI
  return out
}

/**
 * The rotation the drawn Moon is turned by, written into the first eleven of a
 * column-major 4x4's elements — a three Matrix4's, in `Moon.jsx`. three keeps a
 * sphere's pole on +y, so the drawn body's axes are the frame's with the pole
 * moved there: its x is the frame's +y (90° east), its y the frame's +z (north),
 * its z the frame's +x (the prime meridian). A proper rotation, since z × x = y.
 * Reads `moonClock[0]`; allocation-free.
 */
const _axes = new Float64Array(9)
export function moonTurn(e) {
  moonAxes(_axes)
  e[0] = _axes[3]
  e[1] = _axes[4]
  e[2] = _axes[5]
  e[4] = _axes[6]
  e[5] = _axes[7]
  e[6] = _axes[8]
  e[8] = _axes[0]
  e[9] = _axes[1]
  e[10] = _axes[2]
  return e
}

/**
 * The unit vector from the Moon's centre to a selenographic point, at time `t`,
 * in the scene frame. For gates and set-up, not the frame path: it takes
 * degrees and a time as arguments.
 */
export function selenographic(out, latitudeDeg, longitudeDeg, t) {
  const axes = new Float64Array(9)
  moonClock[0] = t
  moonAxes(axes)
  const phi = latitudeDeg * DEG
  const lam = longitudeDeg * DEG
  const x = Math.cos(phi) * Math.cos(lam)
  const y = Math.cos(phi) * Math.sin(lam)
  const z = Math.sin(phi)
  out[0] = x * axes[0] + y * axes[3] + z * axes[6]
  out[1] = x * axes[1] + y * axes[4] + z * axes[7]
  out[2] = x * axes[2] + y * axes[5] + z * axes[8]
  return out
}

/**
 * Where a scene direction from the Moon's centre lands on the Moon, as
 * selenographic latitude and longitude in degrees, at time `t`. For gates.
 */
export function toSelenographic(dx, dy, dz, t) {
  const axes = new Float64Array(9)
  moonClock[0] = t
  moonAxes(axes)
  const n = Math.hypot(dx, dy, dz)
  const x = (dx * axes[0] + dy * axes[1] + dz * axes[2]) / n
  const y = (dx * axes[3] + dy * axes[4] + dz * axes[5]) / n
  const z = (dx * axes[6] + dy * axes[7] + dz * axes[8]) / n
  return { latitude: Math.asin(Math.max(-1, Math.min(1, z))) / DEG, longitude: Math.atan2(y, x) / DEG }
}
