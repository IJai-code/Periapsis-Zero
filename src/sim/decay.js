import { BODIES, G } from './constants.js'
import { density, SPIN_RATE } from './atmosphere.js'
import { EARTH_FIELD } from './prem.js'

/**
 * How long an orbit lasts, from the same air the integrator flies through.
 *
 * The sequencer needs this before it waits anywhere. A 172 x 185 km parking
 * orbit loses 1.6 km of perigee a day, faster as it drops, and the translunar
 * window it waits in can be two weeks away — so whether the vehicle is still in
 * orbit when the window opens has a numerical answer, and it was being answered
 * by where the Moon happened to be.
 *
 * King-Hele's equations for one revolution, taken as they stand, with E the
 * eccentric anomaly measured from perigee:
 *
 *   da/dE = -delta a^2 rho F (1 + e cos E)^3/2 / (1 - e cos E)^1/2
 *   de/dE = -delta a (1 - e^2) rho F [(1 + e cos E) / (1 - e cos E)]^1/2 cos E
 *
 * delta = Cd A / m = 2 dragK, and F = (1 - omega h cos i / v^2)^2 is the part of
 * the planet's rotation lying along the track at each point. Both integrals are
 * taken numerically over the density table itself, divided by the period, and a
 * and e marched together. Nothing is fitted and nothing is approximated about
 * the air: `density` is the table the integrator reads, `dragK` the slot it
 * reads, omega the rate it turns the atmosphere at.
 *
 * Two earlier forms were measured and replaced. Both take the textbook route of
 * treating the air as a single exponential around some height and integrating
 * analytically into Bessel functions. Centred on the mean altitude — the first
 * shipped — it held 0.2-1% on the near-circular parking orbits it was checked
 * against, and misled on anything else: 25% long at 150 x 250 km, 88% at
 * 180 x 447 km, and an orbit that never came down at 180 x 1,636 km. Centred on
 * perigee it did better at high eccentricity and worse near circular, 7-31%
 * long across the range, because no single scale height describes air whose
 * scale height doubles over the first few hundred kilometres. Integrating the
 * table directly removes the approximation instead of moving it: within 0.2% of
 * flown decay on nine orbits from 172 x 185 km to 180 x 1,636 km.
 *
 * Where the air is read, and what reading it in the wrong place cost.
 *
 * The rates above are written about a *mean* orbit — `meanSemiMajor`, the
 * two-body orbit carrying the craft's total energy, which is the quantity drag
 * actually changes and the one that survives J2's short-period swing. The radius
 * the density has to be read at is a different quantity, and this file spent a
 * long time treating them as the same: it sampled `rho` at `a_mean (1 - e cos E)`,
 * which is where the craft would be if J2 did not hold it anywhere else.
 *
 * It holds it higher, on a polar orbit, by about a kilometre and a half. Carrying
 * J2's radial and transverse terms through the linearised radial equation for a
 * near-circular orbit gives
 *
 *   r = a_mean [ 1 + eps ( 3/4 sin^2 i - 1/2 + 1/4 sin^2 i cos 2u ) ]
 *   eps = J2 R^2 / a_mean^2,   u the argument of latitude
 *
 * and the same working gives the mean perturbing potential that goes with it,
 *
 *   <Phi_J> = mu <dr> / a_mean^2
 *
 * — the same offset twice, once as height and once as the potential holding the
 * craft at it, which is why the speed picks up 4 mu <dr> / a^2 rather than 2.
 * Both are first order in J2 and neither has a fitted constant in it.
 *
 * `verify-radial` checks the form against a flown revolution rather than against
 * the algebra: on the parking orbit `verify-loiter` flies, it predicts a mean
 * offset of +1.549 km and a second harmonic of 1.638 km where the flight measures
 * +1.554 and 1.638. The second harmonic is not represented here — `rates` is
 * handed no argument of latitude and could not evaluate it — and the reason that
 * is acceptable is measured too: 1.638 km against a 22.5 km scale height is worth
 * a tenth of a per cent of the integral, where the mean offset is worth seven.
 *
 * What it was worth, flown: the shipped theory forecast 191.37 h against 205.83 h
 * of flight, -7.03%, and its error grew steadily along the decay — -4.38% at 25 h,
 * -6.65% at 200 h. Reading the air at the craft's own radius takes that to +0.89%
 * with the eccentricity left osculating, and to -0.48% once the eccentricity is
 * the mean one as well, with no sample along the way worse than 0.45%.
 *
 * ── two claims this file used to make, both withdrawn ─────────────────
 *
 * The first was that a radius profile taken from the flight itself still left
 * 198.5 h against 206.5 flown, so "whatever closes the rest is not this term".
 * That was a one-revolution density ratio at the top of the decay, 1.0373,
 * extrapolated as though it were constant. It is not constant: the scale height
 * falls from 22.5 km at 172 km of altitude to 9.5 km by 125 km, so a fixed 1.55 km
 * error in the datum is worth 6.6% of the air at the start and 16% at the end.
 * That is exactly the growth the error table showed, and reading it as a floor
 * was the mistake.
 *
 * The second was that the osculating eccentricity beats the mean one. It did,
 * while the datum was wrong: the theory had too much air, a larger eccentricity
 * gives it more, and the smallest of the candidates was closest for a reason that
 * had nothing to do with which is right. With the air read in the right place the
 * pairing that belongs together also measures better — mean axis with mean
 * eccentricity, -0.48%, against +0.89% for the mixed pair.
 *
 * ── and two that stand ────────────────────────────────────────────────
 *
 * Multiplying the rate by I0(A/H), the textbook average of an exponential density
 * over a sinusoidal perigee swing, is still wrong here, and not because the
 * correction is small. This file already samples the profile point by point, and
 * the swing it would be averaging over does not exist: measured under J2..J4 with
 * drag off, the craft's actual perigee passages over five revolutions are 164.803,
 * 164.821, 164.840, 164.858 and 164.875 km — 72 m apart and monotone. The 31 km
 * often quoted for that orbit is the range of the *element* a(1-e) sampled
 * wherever the craft happens to be, which is not where its perigee is, and I0 on
 * that element's range is unbounded: the same element reaches -6365 km on the way
 * down.
 *
 * And the short-period term on the semi-major axis is not the one above and must
 * not be substituted for it. Both are verified against the same flown revolution:
 *
 *   a_osc - a_mean    mean -3.095   |1u| 0.016   |2u| 9.807 km
 *   r     - a_mean    mean +1.554   |1u| 10.010  |2u| 1.638 km
 *
 * The axis's short-period content is second harmonic at 9.8 km; the radius's is
 * first harmonic at 10.0 km, which is its eccentricity, and its second harmonic is
 * 1.6 km. Feeding the axis's 9.8 km of 2u into the radius inflates the density
 * where the craft is high and, at 22.5 km of scale height, is worth a quarter of
 * the integral: it took the same orbit from 3.7% out to 24.7%. `verify-radial`
 * keeps that measurement so the substitution is not made again.
 */

const MU = G * BODIES.earth.mass
const R = BODIES.earth.radius

/**
 * J2 R^2, out of the same field `system.js` installs on the integrator, so the
 * short-period term below describes the planet the trajectory is actually flying
 * around. Hoisted to a module constant because it is read on every step of every
 * march: a double pulled out of an object's array inside `rates` boxes it.
 *
 * Unlike `prem.js`'s mean elements this takes no field argument, so a world with
 * the oblateness lifted would get Earth's term applied to a sphere. Nothing drags
 * in such a world today — `verify:horizon` is the only gate that lifts it, and it
 * lifts it for projections — and the honest repair if one ever does is a field
 * argument threaded through `decayTime`, `decayAfter` and `orbitalLifetime`,
 * not a guess here.
 */
const J2_R2 = EARTH_FIELD.J[0] * EARTH_FIELD.radius * EARTH_FIELD.radius

/**
 * Where lifetime is measured to, m of altitude. Below it the orbit is an entry
 * rather than a decay and lasts minutes; the flown Vandenberg orbit crossed the
 * surface 0.08 h after the theory brought it here.
 */
export const DECAY_FLOOR = 100e3

/** Largest time step, s. The decay is slow at parking altitude and an hour is a small fraction of it. */
const MAX_STEP = 3600
/** Largest change of semi-major axis per step, m — what shortens the step as the decay steepens. */
const ALTITUDE_STEP = 200
const MAX_STEPS = 1_000_000

/**
 * Local density scale height, m, read off the table rather than restated. Used
 * only to decide how finely to sample around perigee.
 */
function scaleHeight(alt) {
  const lo = density(alt)
  const hi = density(alt + 100)
  return lo > hi && hi > 0 ? 100 / Math.log(lo / hi) : Infinity
}

/** da/dt and de/dt, written here. One-shot planning, but still no allocation per step. */
const _rate = new Float64Array(2)

/**
 * Revolution-averaged rates.
 *
 * The integrand peaks at perigee, with a width in E of about 1/sqrt(a e / H),
 * so the sample count follows that: a circle meets the same air all the way
 * round and needs one reading, an eccentricity of 0.1 a hundred or so. A
 * trapezoid on a periodic integrand converges quickly once the peak is resolved.
 */
function rates(a, e, dragK, cosI) {
  const n = Math.sqrt(MU / (a * a * a))
  const h = Math.sqrt(MU * a * (1 - e * e))
  const circ = MU / a
  /*
   * Where the craft is, rather than where the conic puts it, and the potential
   * that holds it there. `a` is the energy-mean axis, so the J2 potential is
   * already inside it; taking it back out is what puts the density sample at
   * the right altitude and the speed at the right value. See the header.
   */
  const dr = (J2_R2 / a) * (0.75 * (1 - cosI * cosI) - 0.5)
  const twoPhi = (2 * MU * dr) / (a * a)
  if (e < 1e-9) {
    const r = a + dr
    const rho = density(r - R)
    const v2 = MU * (2 / r - 1 / a) - twoPhi
    const wind = 1 - (SPIN_RATE * h * cosI) / v2
    _rate[0] = -2 * dragK * n * a * a * rho * wind * wind * Math.pow(v2 / circ, 1.5)
    _rate[1] = 0
    return
  }
  const x = (a * e) / scaleHeight(a * (1 - e) + dr - R)
  const samples = Math.min(1024, Math.max(16, Math.ceil(24 * Math.sqrt(1 + (x > 0 && x < Infinity ? x : 0)))))
  let ia = 0
  let ie = 0
  for (let j = 0; j < samples; j++) {
    const c = Math.cos((2 * Math.PI * j) / samples)
    const r = a * (1 - e * c) + dr
    const rho = density(r - R)
    if (!(rho > 0)) continue
    const v2 = MU * (2 / r - 1 / a) - twoPhi
    if (!(v2 > 0)) continue
    /*
     * v^2 a / mu, which is (1 + e cos E) / (1 - e cos E) exactly when `dr` and
     * `twoPhi` are zero — so this is King-Hele's integrand above written in the
     * speed rather than in the conic, and identical to it wherever the field has
     * no oblateness to displace the craft.
     */
    const V = v2 / circ
    const wind = 1 - (SPIN_RATE * h * cosI) / v2
    const f = rho * wind * wind * Math.sqrt(V)
    ia += f * V * (1 - e * c)
    ie += f * c
  }
  const k = (2 * dragK * n) / samples
  _rate[0] = -k * a * a * ia
  _rate[1] = -k * a * (1 - e * e) * ie
}

/**
 * Seconds for the semi-major axis to fall from `a0` to `aEnd`.
 *
 * Midpoint steps, sized so neither an hour nor 200 m of altitude passes in one,
 * and the last one interpolated onto `aEnd`. Infinity above the air, or past
 * `horizon` — which is how a search that only needs "longer than this" avoids
 * marching a high orbit through years of nothing.
 */
export function decayTime(a0, e0, aEnd, dragK, cosI, horizon = Infinity) {
  if (!(a0 > aEnd)) return 0
  if (!(dragK > 0)) return Infinity
  let a = a0
  let e = e0
  let t = 0
  for (let n = 0; n < MAX_STEPS; n++) {
    rates(a, e, dragK, cosI)
    const da = _rate[0]
    if (!(da < 0)) return Infinity
    const dt = Math.min(MAX_STEP, ALTITUDE_STEP / -da)
    rates(a + 0.5 * dt * da, Math.max(0, e + 0.5 * dt * _rate[1]), dragK, cosI)
    const next = a + dt * _rate[0]
    if (next <= aEnd) return t + (a - aEnd) / -_rate[0]
    a = next
    e = Math.max(0, e + dt * _rate[1])
    t += dt
    if (t > horizon) return Infinity
  }
  return Infinity
}

/** Semi-major axis and eccentricity after `decayAfter`, m and dimensionless. */
export const decayed = new Float64Array(2)

/**
 * March an orbit forward `time` seconds and write where it gets to into
 * `decayed`. False if it reaches the decay floor first, in which case
 * `decayed` holds the orbit at the floor.
 *
 * The same march as `decayTime`, stopped on the clock rather than on the
 * altitude — so it answers "what will perigee be when the window opens", which
 * a lifetime alone cannot: an orbit can outlast its wait and still arrive at
 * ignition very low.
 */
export function decayAfter(a0, e0, time, dragK, cosI) {
  let a = a0
  let e = e0
  let t = 0
  const floor = R + DECAY_FLOOR
  for (let n = 0; n < MAX_STEPS && t < time && dragK > 0; n++) {
    rates(a, e, dragK, cosI)
    const da = _rate[0]
    if (!(da < 0)) break
    const dt = Math.min(MAX_STEP, ALTITUDE_STEP / -da, time - t)
    rates(a + 0.5 * dt * da, Math.max(0, e + 0.5 * dt * _rate[1]), dragK, cosI)
    a += dt * _rate[0]
    e = Math.max(0, e + dt * _rate[1])
    t += dt
    if (a <= floor) {
      decayed[0] = a
      decayed[1] = e
      return false
    }
  }
  decayed[0] = a
  decayed[1] = e
  return true
}

/** Seconds until an orbit reaches the decay floor. */
export const orbitalLifetime = (a, e, dragK, cosI) => decayTime(a, e, R + DECAY_FLOOR, dragK, cosI)

/**
 * The circular orbit that decays down to `aEnd` in exactly `time` seconds.
 *
 * Decay time grows monotonically with altitude, so this is a bisection. The
 * bracket doubles upward from `aEnd` until it contains the answer, and each
 * probe stops marching as soon as it has passed `time`.
 */
export function circularOrbitDecayingTo(aEnd, time, dragK, cosI) {
  if (!(time > 0)) return aEnd
  let lo = aEnd
  let hi = aEnd + 10e3
  while (decayTime(hi, 0, aEnd, dragK, cosI, time) <= time) {
    lo = hi
    hi = aEnd + 2 * (hi - aEnd)
    if (hi - R > 1000e3) return hi
  }
  for (let k = 0; k < 60 && hi - lo > 1; k++) {
    const mid = 0.5 * (lo + hi)
    if (decayTime(mid, 0, aEnd, dragK, cosI, time) > time) hi = mid
    else lo = mid
  }
  return 0.5 * (lo + hi)
}
