import { BODIES } from './constants.js'

/**
 * Atmospheric density, and the rotating air mass that a craft actually flies
 * through.
 *
 * A single exponential scale height is the usual shortcut and it is wrong by
 * orders of magnitude above about 100 km — precisely the range a satellite
 * lives in. This is the piecewise-exponential model (Vallado, Table 8-4): 28
 * segments from sea level to 1000 km, each with its own base density and local
 * scale height, which tracks the US Standard Atmosphere closely enough for
 * orbit decay and reentry alike.
 *
 *     rho(h) = rho0 * exp(-(h - h0) / H)
 */

/** [base altitude km, base density kg/m^3, scale height km], descending. */
const LAYERS = [
  [1000, 3.019e-15, 268.0],
  [900, 5.245e-15, 181.05],
  [800, 1.17e-14, 124.64],
  [700, 3.614e-14, 88.667],
  [600, 1.454e-13, 71.835],
  [500, 6.967e-13, 63.822],
  [450, 1.585e-12, 60.828],
  [400, 3.725e-12, 58.515],
  [350, 9.518e-12, 53.298],
  [300, 2.418e-11, 53.628],
  [250, 7.248e-11, 45.546],
  [200, 2.789e-10, 37.105],
  [180, 5.464e-10, 29.74],
  [150, 2.07e-9, 22.523],
  [140, 3.845e-9, 16.149],
  [130, 8.484e-9, 12.636],
  [120, 2.438e-8, 9.473],
  [110, 9.661e-8, 7.263],
  [100, 5.297e-7, 5.877],
  [90, 3.396e-6, 5.382],
  [80, 1.905e-5, 5.799],
  [70, 8.77e-5, 6.549],
  [60, 3.206e-4, 7.714],
  [50, 1.057e-3, 8.382],
  [40, 3.972e-3, 7.554],
  [30, 1.774e-2, 6.682],
  [25, 3.899e-2, 6.349],
  [0, 1.225, 7.249],
]

/** Above this there is effectively nothing left to push against. */
export const ATMOSPHERE_TOP = 1000e3 // metres

/**
 * Density at geometric altitude `h` metres. Returns 0 above the table so the
 * drag term vanishes cleanly rather than extrapolating a meaningless tail.
 */
export function density(h) {
  if (h >= ATMOSPHERE_TOP || Number.isNaN(h)) return 0
  const km = h / 1000
  // Descending scan: craft spend almost all their time near the top, so the
  // match is usually found in the first couple of comparisons.
  for (let i = 0; i < LAYERS.length; i++) {
    const layer = LAYERS[i]
    if (km >= layer[0]) return layer[1] * Math.exp(-(km - layer[0]) / layer[2])
  }
  // Below sea level — inside the planet. Clamp to the surface value.
  return LAYERS[LAYERS.length - 1][1]
}

/**
 * Earth's spin axis in the scene frame.
 *
 * Obliquity tilts the pole out of the ecliptic normal. The renderer applies the
 * same tilt as a rotation about +Z, which carries +Y toward +X — so the axis is
 * (sin e, cos e, 0). Sharing one definition keeps the air the craft flies
 * through aligned with the planet you can see turning.
 */
export const SPIN_AXIS = [Math.sin(BODIES.earth.tilt), Math.cos(BODIES.earth.tilt), 0]

/** Sidereal rotation rate, rad/s. */
export const SPIN_RATE = (2 * Math.PI) / BODIES.earth.spin

/** Angular velocity vector, rad/s, in the scene frame. */
export const OMEGA = SPIN_AXIS.map((c) => c * SPIN_RATE)

/**
 * Ballistic coefficient term, m^2/kg.
 *
 * Drag acceleration is -(Cd A / 2m) * rho * |v| * v, and everything in that
 * leading bracket is a property of the vehicle rather than the state — so it is
 * folded into one number per craft and refreshed only when the mass changes.
 */
export function dragCoefficient(cd, area, mass) {
  return (0.5 * cd * area) / mass
}

/**
 * Speed of sound, m/s, from the US Standard Atmosphere temperature profile.
 *
 * The density model above is Vallado's piecewise-*exponential* fit, which
 * carries no temperature — so this is a separate profile rather than something
 * derivable from it. Only the layers a parachute can open in are modelled, to
 * 51 km; above that the answer is returned but is not used for anything, since
 * a capsule at 60 km is at Mach 30 and no gate cares about the exact figure.
 *
 *     a = sqrt(gamma R T),  gamma = 1.4,  R = 287.053 J/(kg K)
 *
 * At 8 km this gives 308 m/s against the standard table's 308.1.
 */
export function speedOfSound(h) {
  const km = h / 1000
  let T
  if (km < 11) T = 288.15 - 6.5 * km
  else if (km < 20) T = 216.65
  else if (km < 32) T = 216.65 + 1.0 * (km - 20)
  else if (km < 47) T = 228.65 + 2.8 * (km - 32)
  else T = 270.65
  return Math.sqrt(1.4 * 287.053 * T)
}
