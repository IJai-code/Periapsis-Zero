import { BODIES } from './constants.js'
import { SPIN_AXIS, SPIN_RATE } from './atmosphere.js'
import { requested } from './requested.js'

/**
 * Launch sites, and the body-fixed frame that carries them around with the
 * planet.
 *
 * The site is held to the surface as a *constraint*, not a force: its six state
 * slots are overwritten after each integration step rather than balanced against
 * a modelled pad reaction. A contact force would be by far the stiffest term in
 * the system and would collapse the step size for everything else; overwriting
 * is exact and costs nothing.
 *
 * Two simplifications, taken deliberately. The pad sits at Earth's *mean*
 * radius and latitude is read as geocentric — everything else here is spherical
 * (point-mass gravity, no J2, a spherically symmetric atmosphere, a sphere on
 * screen), so introducing an ellipsoid for the pad alone would lift the vehicle
 * visibly off the rendered surface. And on a procedurally generated Earth there
 * is no real Florida: longitude only picks a spot, while **latitude is
 * physically load-bearing** — it sets the lowest inclination a launch can reach.
 */
export const LAUNCH_SITES = {
  ksc: {
    id: 'ksc',
    name: 'Kennedy LC-39B',
    latitude: 28.58, // degrees north — gives the classic 28.58 deg inclination due east
    longitude: -80.65,
    azimuth: 90, // due east, to collect the planet's rotation
  },
  /**
   * Gagarin's Start. The azimuth is the one Soyuz flies to the station's
   * 51.6 degrees, which is not due east: from 45.92 north, due east would give
   * 45.92 and the range's drop zones do not allow it.
   */
  baikonur: {
    id: 'baikonur',
    name: 'Baikonur 1/5',
    latitude: 45.92,
    longitude: 63.342,
    azimuth: 61.9,
  },
  /**
   * The best-placed pad on Earth for what this mission does: five degrees off
   * the equator is 463 m/s of free eastward speed against Kennedy's 408, and
   * the plane it launches into is nearly the one the Moon lives in.
   */
  kourou: {
    id: 'kourou',
    name: 'Kourou ELA-3',
    latitude: 5.239,
    longitude: -52.768,
    azimuth: 90,
  },
  /**
   * Launching south over open water, the way Vandenberg does, for a near-polar
   * orbit. Deliberately the awkward one: it collects almost none of the
   * planet's rotation and it reaches an inclination a lunar mission has to pay
   * to leave.
   */
  vandenberg: {
    id: 'vandenberg',
    name: 'Vandenberg SLC-6',
    latitude: 34.742,
    longitude: -120.573,
    azimuth: 170,
  },
}

/**
 * Which pad the next flight leaves from.
 *
 * Module state rather than a store field, because two things outside React need
 * it before any component exists: `createSimulation` stands the vehicle on it,
 * and the sequencer steers by its azimuth. Chosen the same way the vessel is —
 * `PERIAPSIS_SITE` under Node, `?site=` in a browser — so a headless run or a
 * shared link can fly from anywhere without editing source.
 */
let active = LAUNCH_SITES[requested('PERIAPSIS_SITE', 'site', LAUNCH_SITES, 'ksc', 'launch site')]

/** The pad the vehicle is standing on. */
export const activeSite = () => active

/**
 * Move the pad. Only meaningful before release: the vehicle is *clamped* to its
 * site, so the caller resets the simulation and the mission after this, which is
 * what puts the stack on the new pad.
 */
export function selectSite(id) {
  const site = LAUNCH_SITES[id]
  if (!site) throw new Error(`unknown launch site "${id}"`)
  active = site
  return site
}

const DEG = Math.PI / 180

/**
 * Body-fixed orthonormal basis.
 *
 * e3 is the spin axis, shared with both the renderer's obliquity and the drag
 * model's wind, so the pad, the visible planet and the air all turn together.
 *
 * e1 is the prime meridian, and it is no longer "any perpendicular". It used to
 * be, on the grounds that longitude is cosmetic — which is true right up until
 * the ground is drawn and lit, at which point longitude decides what time of day
 * it is at the pad. With an arbitrary meridian a launch at a real date arrived
 * at the wrong hour: Kennedy's local noon fell at 03:48 UTC instead of 17:00.
 *
 * So it is anchored where the real one is. At J2000.0 the Greenwich meridian
 * sits at right ascension 280.46062 degrees — Greenwich mean sidereal time,
 * 18.697374558 hours — measured from the vernal equinox in the equatorial
 * plane. The equinox is the intersection of ecliptic and equator, which in the
 * scene frame is +x, and rotating it about the pole by that angle puts Greenwich
 * where Greenwich is.
 *
 * Checked the other way round before it was written: fitting the offset that
 * best matched an almanac's solar elevation gave 100.50 degrees against the
 * 100.46 this derivation implies.
 */
const E3 = SPIN_AXIS
/** Greenwich mean sidereal time at J2000.0, in radians of right ascension. */
const GMST_J2000 = 280.46061837 * DEG
const E1 = (() => {
  // The equinox, and the equatorial direction 90 degrees east of it.
  const eq = [1, 0, 0]
  const perp = [
    E3[1] * eq[2] - E3[2] * eq[1],
    E3[2] * eq[0] - E3[0] * eq[2],
    E3[0] * eq[1] - E3[1] * eq[0],
  ]
  const c = Math.cos(GMST_J2000)
  const s = Math.sin(GMST_J2000)
  const v = [eq[0] * c + perp[0] * s, eq[1] * c + perp[1] * s, eq[2] * c + perp[2] * s]
  const len = Math.hypot(v[0], v[1], v[2]) || 1
  return [v[0] / len, v[1] / len, v[2] / len]
})()
const E2 = [
  E3[1] * E1[2] - E3[2] * E1[1],
  E3[2] * E1[0] - E3[0] * E1[2],
  E3[0] * E1[1] - E3[1] * E1[0],
]

/**
 * Write a site's barycentric state into the vector.
 *
 * Position is the site rotated to time t and added to Earth; velocity is
 * Earth's plus omega x r. Using the same omega the drag model uses means the
 * relative wind on the pad is exactly zero, so dynamic pressure reads 0 before
 * release by construction rather than by tuning.
 */
export function clampToSite(state, t, site, earthOffset, shipOffset) {
  const phi = site.latitude * DEG
  const theta = site.longitude * DEG + SPIN_RATE * t
  const R = BODIES.earth.radius

  const cosPhi = Math.cos(phi)
  const sinPhi = Math.sin(phi)
  const cosT = Math.cos(theta)
  const sinT = Math.sin(theta)

  for (let k = 0; k < 3; k++) {
    const rk = R * (cosPhi * (cosT * E1[k] + sinT * E2[k]) + sinPhi * E3[k])
    state[shipOffset + k] = state[earthOffset + k] + rk
  }

  // v = omega x r, with omega along e3.
  const rx = state[shipOffset] - state[earthOffset]
  const ry = state[shipOffset + 1] - state[earthOffset + 1]
  const rz = state[shipOffset + 2] - state[earthOffset + 2]
  state[shipOffset + 3] = state[earthOffset + 3] + SPIN_RATE * (E3[1] * rz - E3[2] * ry)
  state[shipOffset + 4] = state[earthOffset + 4] + SPIN_RATE * (E3[2] * rx - E3[0] * rz)
  state[shipOffset + 5] = state[earthOffset + 5] + SPIN_RATE * (E3[0] * ry - E3[1] * rx)
}

/**
 * Unit vector from Earth's centre to a site at time `t`, in the body-fixed frame
 * the clamp and the drag model share.
 *
 * Split out of `clampToSite` because a ground camera needs the *direction*
 * without the state write — and needs it to be the same direction, or the pad
 * would drift relative to the vehicle standing on it.
 */
export function siteDirection(out, site, t) {
  const phi = site.latitude * DEG
  const theta = site.longitude * DEG + SPIN_RATE * t
  const cosPhi = Math.cos(phi)
  const sinPhi = Math.sin(phi)
  const cosT = Math.cos(theta)
  const sinT = Math.sin(theta)
  out.set(
    cosPhi * (cosT * E1[0] + sinT * E2[0]) + sinPhi * E3[0],
    cosPhi * (cosT * E1[1] + sinT * E2[1]) + sinPhi * E3[1],
    cosPhi * (cosT * E1[2] + sinT * E2[2]) + sinPhi * E3[2],
  )
  return out
}

/** Inclination reachable from a site at a given launch azimuth. */
export function inclinationFor(site, azimuthDeg = site.azimuth) {
  return (
    (Math.acos(Math.cos(site.latitude * DEG) * Math.sin(azimuthDeg * DEG)) * 180) / Math.PI
  )
}

/** Eastward velocity the planet's rotation contributes for free, m/s. */
export function rotationBonus(site) {
  return SPIN_RATE * BODIES.earth.radius * Math.cos(site.latitude * DEG)
}
