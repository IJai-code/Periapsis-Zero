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
 * Obliquity tilts the pole out of the ecliptic normal, and *which way* it tilts
 * is the whole of the seasons. The pole leans away from the June solstice
 * direction, which is ecliptic longitude 270 — perpendicular to the line of
 * equinoxes, not along it. This used to tilt toward +X, the equinox direction,
 * which is a quarter of a year out: it put the Sun's declination at +4.55
 * degrees on 1 January 2000 against a true -23.01, so every launch site was lit
 * as though it were early May.
 *
 * In ecliptic coordinates the pole is (0, -sin e, cos e), and system.js folds
 * ecliptic into scene as (x, z, -y), which gives (0, cos e, -sin e). Measured
 * against the state vector's own Sun that yields a declination of -22.94
 * degrees at J2000, against the almanac's -23.01.
 *
 * Earth.jsx applies the matching rotation, and it has to: sharing one definition
 * keeps the air the craft flies through aligned with the planet you can see
 * turning.
 */
export const SPIN_AXIS = [0, Math.cos(BODIES.earth.tilt), -Math.sin(BODIES.earth.tilt)]

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
/**
 * Stagnation-point *radiative* heat flux, W/m^2, by the Tauber-Sutton
 * correlation (Tauber & Sutton, J. Spacecraft & Rockets 28(1), 1991).
 *
 *     q_rad = C R_n^a rho^b f(V)      C = 4.736e4, b = 1.22
 *     a     = 1.072e6 V^-1.88 rho^-0.325,  capped at 1
 *
 * This is the other half of entry heating and at lunar-return speeds it is the
 * larger half. Sutton-Graves gives the convective flux from the boundary layer;
 * this gives what the shock layer *radiates*, which scales as roughly the ninth
 * power of velocity through `f` and therefore switches on abruptly somewhere
 * around 9 km/s. Orbital entry can ignore it. An 11 km/s return cannot.
 *
 * Three things about it are worth stating plainly rather than burying.
 *
 * **The units are mixed, and that is the correlation's own convention, not a
 * slip.** V is in m/s inside the exponent `a` and in km/s inside `f`, rho is in
 * kg/m^3, R_n in metres, and the result is W/cm^2 — converted here to W/m^2 so
 * it can be summed with the convective term. Feeding km/s to the exponent gives
 * a ~ 10^5 and a meaningless answer.
 *
 * **`f(V)` is tabulated, not analytic**, so this is an empirical fit with a
 * validity range: 9 to 16 km/s, and nose radii of roughly 0.3 to 3 m. Our
 * capsule's 6.03 m heat shield is *outside* that range, so the R_n term is an
 * extrapolation — flagged rather than hidden, because the exponent cap at 1 is
 * exactly the paper's acknowledgement that the R_n dependence saturates as the
 * shock layer goes optically thick, and a 6 m radius is well into that regime.
 *
 * **Below 9 km/s it returns zero.** Not because radiation vanishes, but because
 * the fit has nothing to say there and a linear extrapolation off the bottom of
 * a curve this steep would be invention.
 */
const TS_V = Float64Array.from([
  9.0, 9.25, 9.5, 9.75, 10.0, 10.25, 10.5, 10.75, 11.0, 11.5, 12.0, 12.5, 13.0, 13.5, 14.0, 14.5,
  15.0, 15.5, 16.0,
])
const TS_F = Float64Array.from([
  1.5, 4.3, 9.7, 19.5, 35.0, 55.0, 81.0, 115.0, 151.0, 238.0, 359.0, 495.0, 660.0, 850.0, 1065.0,
  1313.0, 1550.0, 1780.0, 2040.0,
])
const TS_LAST = TS_V.length - 1

export function radiativeFlux(rho, v, noseRadius) {
  if (!(rho > 0) || !(v > 0)) return 0
  const vk = v / 1000
  if (vk < TS_V[0]) return 0

  let f
  if (vk >= TS_V[TS_LAST]) {
    f = TS_F[TS_LAST]
  } else {
    let i = 0
    while (i < TS_LAST - 1 && vk >= TS_V[i + 1]) i++
    const t = (vk - TS_V[i]) / (TS_V[i + 1] - TS_V[i])
    f = TS_F[i] + t * (TS_F[i + 1] - TS_F[i])
  }

  // V in m/s here, km/s in the table above — the correlation's own convention.
  let a = 1.072e6 * Math.pow(v, -1.88) * Math.pow(rho, -0.325)
  if (a > 1) a = 1

  // 4.736e4 R_n^a rho^1.22 f, in W/cm^2; x1e4 to W/m^2.
  return 1e4 * 4.736e4 * Math.pow(noseRadius, a) * Math.pow(rho, 1.22) * f
}

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
