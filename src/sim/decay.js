import { BODIES, G } from './constants.js'
import { density, SPIN_RATE } from './atmosphere.js'

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
 */

const MU = G * BODIES.earth.mass
const R = BODIES.earth.radius

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
  if (e < 1e-9) {
    const rho = density(a - R)
    const wind = 1 - (SPIN_RATE * h * cosI) / (MU / a)
    _rate[0] = -2 * dragK * n * a * a * rho * wind * wind
    _rate[1] = 0
    return
  }
  const x = (a * e) / scaleHeight(a * (1 - e) - R)
  const samples = Math.min(1024, Math.max(16, Math.ceil(24 * Math.sqrt(1 + (x > 0 && x < Infinity ? x : 0)))))
  let ia = 0
  let ie = 0
  for (let j = 0; j < samples; j++) {
    const c = Math.cos((2 * Math.PI * j) / samples)
    const r = a * (1 - e * c)
    const rho = density(r - R)
    if (!(rho > 0)) continue
    const wind = 1 - (SPIN_RATE * h * cosI) / (MU * (2 / r - 1 / a))
    const f = rho * wind * wind * Math.sqrt((1 + e * c) / (1 - e * c))
    ia += f * (1 + e * c)
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
