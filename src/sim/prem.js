import { BODIES, G } from './constants.js'
import { SPIN_AXIS, SPIN_RATE } from './atmosphere.js'

/**
 * Earth's interior, as mass — PREM, and the gravity field that follows from it.
 *
 * Everything above the surface in this simulator treats Earth as a point mass:
 * `G * BODIES.earth.mass / r^2`, spherically symmetric, no oblateness. That is
 * exact for a sphere and wrong for a planet by one part in a thousand, and that
 * part in a thousand is the whole of low-orbit mission design. The plane a
 * sequencer waits on, the precession that decides when a parking orbit crosses
 * the Moon's, the walk of periapsis over a two-week loiter — every one of those
 * is the *quadrupole* of Earth's field, not its monopole.
 *
 * So the interior is modelled instead of assumed. PREM (Dziewonski & Anderson,
 * *Phys. Earth Planet. Inter.* 25, 297, 1981) is the reference: a
 * one-dimensional radial profile of density, constrained by ~1,000 normal-mode
 * periods, ~500 body-wave travel-time summaries, Earth's total mass and its
 * moment of inertia, with each shell's density a low-order polynomial in the
 * normalised radius x = r / R.
 *
 * **What that buys, and what it does not.** Integrating the profile gives the
 * enclosed mass M(r) and the polar moment C with nothing fitted. The two
 * numbers a spherically symmetric density can produce are mass and moment of
 * inertia, and both come back: 5.97560e24 kg and 8.0267e37, against the
 * 5.9742e24 and 8.0378e37 the model was published with — 0.023% and 0.14% out,
 * which is what truncating each shell's fit at the fourth power costs, and the
 * ratio C/MR^2 = 0.3309 against the quoted 0.3307. What the profile *cannot*
 * produce is oblateness: a density with no latitude in it has J2 = 0
 * identically, however well it knows the deep interior. The flattening is a
 * response to rotation, so the hydrostatic J2 is derived from the profile's
 * moment of inertia through the Darwin-Radau relation (`hydrostaticJ2`) — that
 * relation exists precisely because C/(MR^2) *is* the interior's whole
 * contribution to the shape — and the observed coefficients, which also carry
 * the part that is not hydrostatic, are the ones the field flies with.
 *
 * **Three limits, stated rather than buried.**
 *
 * PREM is one-dimensional, so there is no longitude anywhere in this module:
 * gravity is a function of r and of the spin-axis coordinate. `localGravity`
 * takes a *body-fixed* position, so a caller holding (r, phi, lambda) has spent
 * the longitude in the rotation into that frame — the lambda of g(r, phi,
 * lambda) is the caller's. There are no tesseral harmonics here: mass anomalies
 * and the geoid's hundred metres of undulation are a different, far larger
 * dataset, and are not pretended.
 *
 * The series is the *external* one. It is not used below the surface, where it
 * does not apply; the interior gets the shell theorem's monopole instead, which
 * for a spherically symmetric body is exact.
 *
 * Two different radii are in play and each is used where it belongs. Zonal
 * coefficients are defined at the *equatorial* radius, 6,378,137 m, because
 * that is where the multipoles are fitted. The rendered and clamped Earth here
 * is a sphere of the *mean* radius, 6,371,000 m — launchsite.js's own
 * deliberate choice, since an ellipsoid for the pad alone would put the stack
 * off the ground it is drawn standing on.
 *
 * The consequence of that, stated rather than hidden, is that `surfaceGravity`
 * is the gravity of the sphere this simulator draws rather than of the datum a
 * surveyor would use, and the gap between them is not a constant offset but a
 * function of latitude: +0.22% at the equator, +0.07% at Kennedy, -0.12% at
 * Baikonur, -0.44% at the pole against the standard gravity formula. All of it
 * is radius — the ellipsoid is 7 km further out at the equator and 14 km closer
 * in at the pole, and g goes as 1/r^2 — and none of it is an error in the
 * field, since the 6,371 km the pad is clamped to is the surface the vehicle
 * is actually standing on here.
 *
 * Nothing here allocates in the frame loop; the acceleration writes into
 * storage the caller owns.
 */

/* ---------------------------------------------------------------- *\
 * The density profile
\* ---------------------------------------------------------------- */

/** PREM's own radius, m. The x of every polynomial below is r over this. */
export const PREM_RADIUS = 6371e3

/** Radius the zonal coefficients are referenced to, m — EGM2008's equatorial. */
export const REFERENCE_RADIUS = 6378137

/**
 * The shells, inside out.
 *
 * `rho(x) = a0 + a1 x + a2 x^2 + a3 x^3`, kg/m^3, x = r / PREM_RADIUS — Table I
 * of Dziewonski & Anderson (1981). The published table carries 29 segments
 * because it also fits seismic velocity and attenuation at every discontinuity
 * the inversion resolved; adjacent segments sharing one *density* polynomial are
 * merged here, which changes nothing that is evaluated. The merges are the lower
 * mantle (three identical segments, 3,480-5,701 km) and the two lithosphere
 * segments.
 *
 * This is oceanless PREM: the outermost 15 km is 2.6 g/cm^3, not the
 * 1.02 g/cm^3 water layer of the ocean-included variant. Three kilometres of
 * water is not something to launch from and is 0.02% of the mass.
 */
export const LAYERS = [
  { name: 'inner core', r0: 0, r1: 1221.5e3, a: [13088.5, 0, -8838.1, 0] },
  { name: 'outer core', r0: 1221.5e3, r1: 3480e3, a: [12581.5, -1263.8, -3642.6, -5528.1] },
  { name: 'lower mantle', r0: 3480e3, r1: 5701e3, a: [7956.5, -6476.1, 5528.3, -3080.7] },
  { name: 'D" region', r0: 5701e3, r1: 5771e3, a: [5319.7, -1483.6, 0, 0] },
  { name: 'lower mantle II', r0: 5771e3, r1: 5971e3, a: [11249.4, -8029.8, 0, 0] },
  { name: 'transition zone', r0: 5971e3, r1: 6151e3, a: [7108.9, -3804.5, 0.02, 0] },
  { name: 'upper mantle', r0: 6151e3, r1: 6346.6e3, a: [2691.0, 692.4, 0, 0] },
  { name: 'lower crust', r0: 6346.6e3, r1: 6356e3, a: [2900, 0, 0, 0] },
  { name: 'upper crust', r0: 6356e3, r1: PREM_RADIUS, a: [2600, 0, 0, 0] },
]

/** Index of the shell a radius falls in. Clamped at both ends. */
export function layerAt(r) {
  if (!(r > 0)) return 0
  for (let i = LAYERS.length - 1; i > 0; i--) if (r >= LAYERS[i].r0) return i
  return 0
}

/** Density at radius `r` metres, kg/m^3. Closed form; allocates nothing. */
export function densityAt(r) {
  const x = r / PREM_RADIUS
  const a = LAYERS[layerAt(r)].a
  return a[0] + x * (a[1] + x * (a[2] + x * a[3]))
}

/**
 * One shell's integral of rho * r^k over [r0, r1], in SI.
 *
 * With rho a polynomial in x = r/R the integral is elementary:
 *
 *   integral rho r^k dr  =  sum_j a_j / R^j * [ r^(k+j+1) / (k+j+1) ]
 *
 * so mass, moment of inertia and the mass inside a radius are each a sum over
 * at most nine shells of four terms, with no quadrature and no error budget to
 * argue about.
 */
function shellIntegral(layer, r0, r1, k) {
  const a = layer.a
  let sum = 0
  let rp = 1 // R^-j
  for (let j = 0; j < a.length; j++) {
    if (a[j] !== 0) {
      const p = k + j + 1
      sum += ((a[j] * rp) / p) * (Math.pow(r1, p) - Math.pow(r0, p))
    }
    rp /= PREM_RADIUS
  }
  return sum
}

/** Mass inside radius `r`, kg — four pi times the r^2 integral. */
export function massWithin(r) {
  const top = Math.min(Math.max(r, 0), PREM_RADIUS)
  let sum = 0
  for (const layer of LAYERS) {
    if (layer.r0 >= top) break
    sum += shellIntegral(layer, layer.r0, Math.min(layer.r1, top), 2)
  }
  return 4 * Math.PI * sum
}

/**
 * Polar moment of inertia inside radius `r`, kg m^2.
 *
 * For a sphere, C = (2/3) integral r^2 dm = (8 pi / 3) integral rho r^4 dr. That
 * integral is over the sphere, so it is the moment of the *spherical* interior;
 * the oblateness that separates C from A is the rotational response the
 * Darwin-Radau step below is about.
 */
export function momentWithin(r) {
  const top = Math.min(Math.max(r, 0), PREM_RADIUS)
  let sum = 0
  for (const layer of LAYERS) {
    if (layer.r0 >= top) break
    sum += shellIntegral(layer, layer.r0, Math.min(layer.r1, top), 4)
  }
  return (8 * Math.PI * sum) / 3
}

/** PREM's total mass, kg — integrated from its own density, not copied. */
export const PREM_MASS = massWithin(PREM_RADIUS)

/** PREM's polar moment of inertia, kg m^2. */
export const PREM_INERTIA = momentWithin(PREM_RADIUS)

/** C / (M R^2). 0.4 for a uniform sphere; 0.3307 for the Earth. */
export const INERTIA_FACTOR = PREM_INERTIA / (PREM_MASS * PREM_RADIUS * PREM_RADIUS)

/**
 * Gravity of the interior at radius `r`, m/s^2, by the shell theorem.
 *
 * Outside every shell the field is that of the enclosed mass concentrated at the
 * centre, exactly, so this is right at and below the surface and exact for a
 * spherically symmetric Earth. It is also the only place the profile is read as
 * a *field* rather than as a mass distribution: above the surface the harmonic
 * series applies, below it this is the whole answer.
 *
 * One property of it is worth stating because the gate asserts it — g is not
 * monotonic in r. It climbs inward from the surface as 1/r^2 outruns the mass
 * still overhead, peaks at the core-mantle boundary, and falls through the core
 * to zero at the centre.
 */
export function gravityAt(r) {
  if (!(r > 0)) return 0
  return (G * massWithin(r)) / (r * r)
}

/**
 * The whole model as a chart, sampled into caller-owned arrays.
 *
 * `r`, `rho` and `g` are filled out to `rMax` metres; the density is the profile
 * inside the planet and zero outside it, and g is the shell theorem's answer
 * inside and the *working field* — zonal series and all — outside, which is what
 * makes the seam at the surface meaningful rather than a discontinuity: the
 * curve leaving the surface is the gravity the craft actually falls at, and the
 * curve entering the core is the mass distribution that produces it.
 *
 * Sampled along the equator, since a zonal field's value depends on where on the
 * sphere the point is and a section has to pick somewhere; the equatorial radius
 * is also the radius the harmonics are referenced to, so it is the section where
 * the two halves of the model meet with least explanation needed.
 *
 * The arrays are the caller's so this can be called from a render loop without
 * allocating, and so the gate can sample the same series the panel draws.
 */
export function profileSeries(r, rho, g, rMax) {
  const n = r.length
  const step = rMax / (n - 1)
  for (let i = 0; i < n; i++) r[i] = step * i
  /*
   * Then a vertex *on* every shell boundary.
   *
   * Uniform samples alone draw the steps in this profile as ramps and put the
   * gravity maximum wherever the nearest sample happened to fall — measured, a
   * 97-point series peaked at 10.636 against the model's 10.689, and at 3,517 km
   * against 3,480. Snapping the nearest sample onto each boundary costs four
   * lines and makes both exact, which matters because the panel prints the peak
   * as a number as well as drawing it. The guard is what keeps the array
   * increasing: a snap that would not fit between its neighbours is skipped, so
   * the close pairs (the 9.4 km between the Moho and the base of the upper crust)
   * cannot collide.
   */
  for (const layer of LAYERS) {
    const edge = layer.r1
    if (!(edge > 0) || edge >= rMax) continue
    const k = Math.round(edge / step)
    if (k === 0 || k >= n - 1) continue
    if (r[k - 1] < edge && edge < r[k + 1]) r[k] = edge
  }
  for (let i = 0; i < n; i++) {
    const radius = r[i]
    rho[i] = radius <= PREM_RADIUS ? densityAt(radius) : 0
    g[i] = radius <= PREM_RADIUS ? gravityAt(radius) : -radialGravity(radius, 0, 0)
  }
  return rMax
}

/**
 * The secular rates a zonal field puts on an orbit, from the elements alone.
 *
 * Both are the closed forms beside the field that produces them, and both are
 * degrees a day — the unit a pilot reads them in. A near-circular low orbit
 * comes out at about -5 degrees a day of node and +3.7 of apsis, which are the
 * two numbers that make an oblateness visible: over a single day the ground
 * track under-shoots by five degrees of longitude, and over a fortnight the
 * perigee walks right round the planet.
 */
export function secularRates(semiMajor, eccentricity, inclinationRad) {
  const day = 86400
  const toDeg = 180 / Math.PI
  return {
    node: nodalRate(semiMajor, eccentricity, inclinationRad) * day * toDeg,
    apsis: apsidalRate(semiMajor, eccentricity, inclinationRad) * day * toDeg,
  }
}

/* ---------------------------------------------------------------- *\
 * Rotation, and the J2 it implies
\* ---------------------------------------------------------------- */

/**
 * The geodynamical constant q = omega^2 R_e^3 / GM, dimensionless.
 *
 * Everything about the shape of a rotating fluid body is measured against it:
 * the ratio of centrifugal to gravitational acceleration at the equator, 1/289,
 * and the one quantity in the flattening problem known to nine figures. Built
 * from the spin rate the atmosphere and the pad already share, PREM's own mass,
 * and the equatorial radius.
 */
export const ROTATION_PARAMETER =
  (SPIN_RATE * SPIN_RATE * REFERENCE_RADIUS * REFERENCE_RADIUS * REFERENCE_RADIUS) /
  (G * BODIES.earth.mass)

/**
 * Darwin-Radau hydrostatic flattening, from C/(M R^2) and q.
 *
 *   f = (5/2 q) / (1 + (25/4) (1 - (3/2) h)^2),   h = C / (M R^2)
 *
 * The classical approximation that replaces Clairaut's differential equation
 * with an algebraic relation; good to about a per cent for a body as centrally
 * condensed as Earth. It needs only the moment of inertia — exactly what a
 * radial density profile can give and nothing more — and the rotation rate.
 * Used the other way round it is how an orbiter's measured J2 becomes a
 * statement about the interior, which is why 0.3307 is quoted at all.
 */
export function hydrostaticFlattening() {
  const h = INERTIA_FACTOR
  const c = 1 - 1.5 * h
  return (2.5 * ROTATION_PARAMETER) / (1 + 6.25 * c * c)
}

/**
 * J2 implied by that flattening, through the surface equipotential relation
 *
 *   f = (3/2) J2 + (1/2) q      ->      J2 = (2/3) f - (1/3) q
 *
 * which is the same relation read either way: the equipotential bulge is half
 * centrifugal and two thirds quadrupole. The result sits *below* the observed J2
 * by well under a per cent, and that residual is the interesting part rather
 * than an error — it is the non-hydrostatic share of Earth's oblateness, excess
 * equatorial bulge left from mantle convection that rotating-fluid theory cannot
 * make. The gate pins both the agreement and its sign.
 */
export function hydrostaticJ2() {
  return (2 / 3) * hydrostaticFlattening() - ROTATION_PARAMETER / 3
}

/* ---------------------------------------------------------------- *\
 * The zonal harmonics
\* ---------------------------------------------------------------- */

/**
 * The observed zonal coefficients, dimensionless, un-normalised, as they appear
 * in
 *
 *   U(r) = (mu/r) [ 1 - sum_n J_n (R/r)^n P_n(sin phi) ]
 *
 * EGM96 (Lemoine et al., NASA/TP-1998-206861) — the field a satellite actually
 * flies through. J2 is the oblateness; J3 is the north-south asymmetry, the pear
 * shape, which is what makes an eccentric orbit's perigee *walk* as well as
 * rotate; J4 is the first correction to the oblate form and is what separates a
 * real nodal rate from the pure J2 expression by a part in a thousand.
 *
 * The monopole is deliberately *not* PREM's own mass: `mu` below is
 * `G * BODIES.earth.mass`, the number the guidance, the targeting solver and the
 * decay model all use, so the field cannot disagree with the flight computer
 * about how hard Earth pulls. That PREM's independently integrated mass comes
 * back 0.057% above it is a result the gate checks, not an input. That residual
 * has three parts and none of them is arithmetic: 0.023% is the truncated
 * polynomial fit, 0.034% is that this simulator's Earth is the modern
 * 5.97219e24 and the model was fitted to 5.9742e24 in 1981, and 0.026% is the
 * water — this is oceanless PREM, whose outer 15 km is rock at 2.6 g/cm^3 where
 * the planet it describes has three kilometres of sea.
 */
export const J2 = 1.08262668e-3
export const J3 = -2.53241052e-6
export const J4 = -1.61962159e-6

/** The three coefficients in the order the acceleration wants them. */
export const ZONAL = Float64Array.from([J2, J3, J4])

/**
 * A body's non-spherical field, as the integrator wants it.
 *
 * `mu` and `radius` are the field's own; `J` the coefficients; `axis` the spin
 * axis, because a zonal field is symmetric about that and nothing else. A plain
 * descriptor rather than an Earth-shaped object, so the integrator stays a
 * solver: hand it this and it flies an oblate field, leave it null and it flies
 * a point mass.
 */
export const EARTH_FIELD = {
  mu: G * BODIES.earth.mass,
  radius: REFERENCE_RADIUS,
  J: ZONAL,
  axis: Float64Array.from(SPIN_AXIS),
}

/* ---------------------------------------------------------------- *\
 * Mean elements
 *\ ---------------------------------------------------------------- */

/**
 * The zonal field's perturbing potential energy at a point, m^2/s^2.
 *
 * `-nabla` of this is `zonalAccel`, which the gate measures rather than assumes.
 * It is worth having in its own right because it is the other half of the
 * oscculating-to-mean conversion below.
 */
export function zonalPotential(x, y, z, r2, field) {
  const r = Math.sqrt(r2)
  const along = x * field.axis[0] + y * field.axis[1] + z * field.axis[2]
  const u = along / r
  const u2 = u * u
  const s = field.radius / r
  const s2 = s * s
  const J = field.J
  // P2, P3, P4 in u^2 form, the same quartics zonalAccel carries.
  const P2 = 0.5 * (3 * u2 - 1)
  const P3 = 0.5 * u * (5 * u2 - 3)
  const P4 = 0.125 * (u2 * (35 * u2 - 30) + 3)
  return (field.mu / r) * (J[0] * s2 * P2 + J[1] * s2 * s * P3 + J[2] * s2 * s2 * P4)
}

/**
 * The **mean** semi-major axis of a state: the two-body orbit with the same
 * total energy, m. Out-of-place; the flight computer calls it once a commitment.
 *
 * The osculating element the HUD reports is the wrong number to plan a fortnight
 * of drag against, and this is the reason. J2 puts a short-period term of order
 * J2 a on the semi-major axis — about +/-10 km at parking altitude, which is
 * larger than everything drag does to it in a day. That term is a *phase*, not
 * an error: it swings with the argument of latitude, so the same physical orbit
 * reads 178.7 km at one instant and 184.0 km a quarter of a revolution later,
 * and whichever one a commitment happens to land on becomes the altitude the
 * vehicle is believed to be parked at. Measured on Baikonur's: the planner
 * committed at 178.69 km osculating, the flight's mean orbit was 184.0 km, and
 * the lifetime it forecast — 319.8 h, from the drag theory that is otherwise
 * right to a fifth of a per cent — was out by a factor of two.
 *
 * No Poisson series is needed, and none is fitted. The field is conservative, so
 * the *total* energy is the constant of the motion:
 *
 *   E = v^2/2 - mu/r + Phi_J(r, u)
 *
 * and an orbit with no oblateness at all but the same E is the mean orbit, by
 * construction. Inverting it is one potential evaluation:
 *
 *   a_mean = -mu / 2E
 *
 * Checked against flight rather than against a textbook: the analytic value
 * tracks the revolution-averaged osculating semi-major axis of a flown parking
 * orbit to half a kilometre over twenty-eight hours, where the osculating value
 * it replaces was five kilometres out and swinging.
 *
 * A note on what this is not. It is not Brouwer's mean element, which subtracts
 * the short-period terms of a first-order series and needs a different constant
 * of integration per element; it is the energy-equivalent two-body orbit. They
 * agree to first order in J2, which is the order at which the short-period
 * problem exists, and this one is exact for the field the craft actually flies
 * rather than for the series that approximates it.
 */
export function meanSemiMajor(x, y, z, vx, vy, vz, r2, field = EARTH_FIELD) {
  const r = Math.sqrt(r2)
  const energy =
    0.5 * (vx * vx + vy * vy + vz * vz) - field.mu / r + zonalPotential(x, y, z, r2, field)
  return -field.mu / (2 * energy)
}

/**
 * The zonal perturbation of a body's field, written into `out` as three SI
 * accelerations.
 *
 * For the potential above, the acceleration at a point p measured from the
 * body's centre, in any frame whose spin axis is `axis`, is
 *
 *   a = sum_n J_n (mu R^n / r^(n+3)) [ A_n(u) p_perp + r B_n(u) axis ]
 *   A_n(u) = (n+1) P_n(u) + u P_n'(u)
 *   B_n(u) = (2n+1) u P_n(u) - n P_(n-1)(u)
 *
 * with u the spin-axis direction cosine, p_perp the part of p across the axis,
 * and P_n the Legendre polynomials. A and B are written out as quartics rather
 * than evaluated through a polynomial library: they are small, they are in the
 * innermost loop of the integrator, and writing them out is what keeps this
 * callable four times a step, per craft, without allocating.
 *
 * Checked two ways in the gate — against a numerical gradient of the potential,
 * which catches a coefficient or a sign, and against the classical secular rates
 * for nodal regression and apsidal drift, which catches everything together.
 *
 * `r2` is the squared separation, passed in already floored against the
 * integrator's test-particle softening so a craft flown into the planet decays
 * toward the centre instead of diverging. It is the same value the monopole
 * used, so both terms agree about where the craft is.
 */
export function zonalAccel(out, x, y, z, r2, field) {
  const axis = field.axis
  const J = field.J
  const r = Math.sqrt(r2)
  const inv = 1 / r

  // Component along the spin axis, and the part of p across it.
  const zc = x * axis[0] + y * axis[1] + z * axis[2]
  const u = zc * inv
  const u2 = u * u
  const px = x - zc * axis[0]
  const py = y - zc * axis[1]
  const pz = z - zc * axis[2]

  // A_n and B_n, one degree at a time, as polynomials in u.
  const A2 = 1.5 * (5 * u2 - 1)
  const B2 = 1.5 * u * (5 * u2 - 3)
  const A3 = 2.5 * u * (7 * u2 - 3)
  const B3 = 0.5 * (u2 * (35 * u2 - 30) + 3)
  const A4 = (15 / 8) * (u2 * (21 * u2 - 14) + 1)
  const B4 = (5 / 8) * u * (u2 * (63 * u2 - 70) + 15)

  // mu / r^3, then the (R/r)^n running power the series needs.
  const k = field.mu / (r2 * r)
  const s = field.radius * inv
  const s2 = s * s

  /*
   * The three degrees are written out rather than looped through a helper.
   * A closure per call would allocate, and a loop over the coefficients would
   * put the polynomial evaluation behind a call in the innermost loop of the
   * integrator — the one place this codebase has measured that cost before.
   * The three differ only in A, B and the power of R/r, which is the point of
   * writing them at all: no table, no index, no branch.
   */
  const c2 = k * J[0] * s2
  const c3 = k * J[1] * s2 * s
  const c4 = k * J[2] * s2 * s2

  out[0] = c2 * (A2 * px + r * B2 * axis[0]) + c3 * (A3 * px + r * B3 * axis[0]) + c4 * (A4 * px + r * B4 * axis[0])
  out[1] = c2 * (A2 * py + r * B2 * axis[1]) + c3 * (A3 * py + r * B3 * axis[1]) + c4 * (A4 * py + r * B4 * axis[1])
  out[2] = c2 * (A2 * pz + r * B2 * axis[2]) + c3 * (A3 * pz + r * B3 * axis[2]) + c4 * (A4 * pz + r * B4 * axis[2])
  return out
}

/* ---------------------------------------------------------------- *\
 * Local gravity
\* ---------------------------------------------------------------- */

/**
 * Gravitational acceleration at a body-fixed point, m/s^2, into `out`.
 *
 * The point is relative to Earth's centre and already in the body-fixed frame,
 * so a caller holding a latitude and a longitude has spent both in getting
 * here — which is the only way a longitude reaches a one-dimensional model.
 *
 * Above the surface this is the full field: monopole, J2, J3, J4. Below it the
 * harmonic series is meaningless and the shell theorem's answer is the right
 * one, so the interior gets `gravityAt` alone.
 */
export function localGravity(out, x, y, z) {
  const r2 = x * x + y * y + z * z
  const r = Math.sqrt(r2)
  if (!(r > 0)) {
    out[0] = 0
    out[1] = 0
    out[2] = 0
    return out
  }
  if (r < PREM_RADIUS) {
    const g = gravityAt(r) / r
    out[0] = -g * x
    out[1] = -g * y
    out[2] = -g * z
    return out
  }
  const k = EARTH_FIELD.mu / (r2 * r)
  zonalAccel(_zonal, x, y, z, r2, EARTH_FIELD)
  out[0] = -k * x + _zonal[0]
  out[1] = -k * y + _zonal[1]
  out[2] = -k * z + _zonal[2]
  return out
}

/** Scratch for the harmonic term, so `localGravity` allocates nothing. */
const _zonal = new Float64Array(3)

/**
 * The *radial* part of that field, m/s^2, positive outward.
 *
 * The scalar the ascent guidance needs. Its vertical-acceleration loop holds
 * `g_eff = g - v_h^2/r` against the climb rate, and until this existed it read
 * `mu/r^2` — a point mass — while the integrator underneath it flew the craft
 * through the oblate field. One line of arithmetic apart, and the difference is
 * real: at 185 km the quadrupole's radial share is 0.014 m/s^2, which a 1.57
 * thrust-to-weight vehicle is being steered by.
 *
 * Radial rather than full, because that is the component the loop commands:
 * the tangential part leans the plumb line, which is `deflectionOfVertical`,
 * and is not what a vertical-acceleration control law is asking for.
 */
export function radialGravity(x, y, z) {
  const r = Math.sqrt(x * x + y * y + z * z)
  if (!(r > 0)) return 0
  localGravity(_g, x, y, z)
  return (_g[0] * x + _g[1] * y + _g[2] * z) / r
}

/**
 * The centrifugal acceleration at the same point, m/s^2, into `out`.
 *
 *   a = omega x (omega x p) = omega^2 p_perp, outward
 *
 * Kept separate from `localGravity` because the two answer different questions.
 * An *orbit* feels gravity alone: a satellite is in free fall, and the
 * centrifugal term does not appear in its equation of motion. A *pad*, and a
 * barometer, feel the sum, because weight is what is left after subtracting the
 * rotation. Both functions are here and which to add is the caller's decision.
 */
export function centrifugal(out, x, y, z) {
  const axis = SPIN_AXIS
  const zc = x * axis[0] + y * axis[1] + z * axis[2]
  const w2 = SPIN_RATE * SPIN_RATE
  out[0] = w2 * (x - zc * axis[0])
  out[1] = w2 * (y - zc * axis[1])
  out[2] = w2 * (z - zc * axis[2])
  return out
}

/**
 * A body-fixed point on the mean sphere at a latitude, into `out` (metres).
 *
 * The meridian is arbitrary in a zonal field — nothing in the field depends on
 * it — so the one drawn is the axis-equinox meridian. What is not arbitrary is
 * that the point is at the *mean* radius the simulator draws and clamps to.
 */
function spherePoint(out, latitudeDeg, radius) {
  const axis = SPIN_AXIS
  const phi = (latitudeDeg * Math.PI) / 180
  // A unit vector perpendicular to the spin axis. SPIN_AXIS is (0, cos e,
  // -sin e), so (1, 0, 0) is already perpendicular and needs no construction.
  const cos = Math.cos(phi)
  const sin = Math.sin(phi)
  out[0] = radius * cos
  out[1] = radius * sin * axis[1]
  out[2] = radius * sin * axis[2]
  return out
}

const _p = new Float64Array(3)
const _g = new Float64Array(3)
const _c = new Float64Array(3)

/**
 * Apparent gravity on the mean sphere at a latitude, m/s^2.
 *
 * Gravity plus the centrifugal term at the point where a pad at that latitude
 * sits — the number a pad's local g actually is, and the reference an
 * accelerometer on the stack reads before release. Evaluated on the mean sphere
 * the simulator draws rather than on the ellipsoid, which is why it sits about
 * 0.2% below the geodetic figure (see the header).
 */
export function surfaceGravity(latitudeDeg) {
  spherePoint(_p, latitudeDeg, BODIES.earth.radius)
  localGravity(_g, _p[0], _p[1], _p[2])
  centrifugal(_c, _p[0], _p[1], _p[2])
  return Math.hypot(_g[0] + _c[0], _g[1] + _c[1], _g[2] + _c[2])
}

/**
 * Deflection of the vertical at a latitude: how far the local plumb line leans
 * off the geocentric radius, radians.
 *
 * A rotating oblate body's surface gravity does not point at its centre. The
 * quadrupole's *tangential* component pulls toward the equator and its size goes
 * as sin(2 phi): zero at the equator and the poles by symmetry, largest at 45
 * degrees, where it reaches about 0.1 degrees. Small enough to leave the pad's
 * up-vector alone — the clamp and the drawn sphere are both radial, and 0.1
 * degrees of a 110 m stack is 19 cm at the nose — and large enough to be worth
 * reporting, since it is the same oblateness seen sideways.
 */
export function deflectionOfVertical(latitudeDeg) {
  const axis = SPIN_AXIS
  const phi = (latitudeDeg * Math.PI) / 180
  spherePoint(_p, latitudeDeg, BODIES.earth.radius)
  localGravity(_g, _p[0], _p[1], _p[2])

  const r = BODIES.earth.radius
  const radial = (_g[0] * _p[0] + _g[1] * _p[1] + _g[2] * _p[2]) / r
  // Unit vector along the meridian, toward the pole: d/dphi of p / r.
  const northx = -Math.sin(phi)
  const northy = Math.cos(phi) * axis[1]
  const northz = Math.cos(phi) * axis[2]
  const tangential = _g[0] * northx + _g[1] * northy + _g[2] * northz
  // Positive means the plumb line leans poleward, so report the equatorward
  // convention: the angle from the radius, positive south.
  return -Math.atan2(tangential, -radial)
}

/**
 * Secular nodal regression of a Keplerian orbit under J2 alone, rad/s.
 *
 *   dOmega/dt = -(3/2) J2 n (R/p)^2 cos i,    n = sqrt(mu/a^3), p = a(1-e^2)
 *
 * Written beside the field that produces it so the gate compares the closed form
 * with what the integrator actually does, rather than with a second
 * transcription of the same formula.
 */
export function nodalRate(semiMajor, eccentricity, inclinationRad) {
  const n = Math.sqrt(EARTH_FIELD.mu / (semiMajor * semiMajor * semiMajor))
  const p = semiMajor * (1 - eccentricity * eccentricity)
  const r = REFERENCE_RADIUS / p
  return -1.5 * J2 * n * r * r * Math.cos(inclinationRad)
}

/** Secular drift of the argument of periapsis under J2 alone, rad/s. */
export function apsidalRate(semiMajor, eccentricity, inclinationRad) {
  const n = Math.sqrt(EARTH_FIELD.mu / (semiMajor * semiMajor * semiMajor))
  const p = semiMajor * (1 - eccentricity * eccentricity)
  const r = REFERENCE_RADIUS / p
  const c = Math.cos(inclinationRad)
  return 0.75 * J2 * n * r * r * (5 * c * c - 1)
}
