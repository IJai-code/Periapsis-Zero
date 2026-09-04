import { BODIES } from './constants.js'
import { SPIN_AXIS, SPIN_RATE } from './atmosphere.js'

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
}

const DEG = Math.PI / 180

/**
 * Body-fixed orthonormal basis.
 *
 * e3 is the spin axis, shared with both the renderer's obliquity and the drag
 * model's wind, so the pad, the visible planet and the air all turn together.
 * e1 is any perpendicular — which makes the prime meridian's placement
 * arbitrary, and harmless, because longitude is cosmetic here.
 */
const E3 = SPIN_AXIS
const E1 = (() => {
  // (0,0,1) is never parallel to the spin axis, which lies in the x-y plane.
  const x = -E3[1]
  const y = E3[0]
  const len = Math.hypot(x, y) || 1
  return [x / len, y / len, 0]
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
