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
 * King-Hele's theory for a near-circular orbit, semi-major axis and
 * eccentricity marched together:
 *
 *   da/dt = -B rho(a) sqrt(mu a)  F [I0(x) + 2e I1(x)]
 *   de/dt = -B rho(a) sqrt(mu/a)  F [I1(x) + e/2 (I0(x) + I2(x))]
 *
 * with B = Cd A / m = 2 dragK, x = a e / H for the local scale height H, I_n the
 * modified Bessel functions, and F = (1 - omega a cos i / v)^2 for an atmosphere
 * that turns with the planet. Nothing here is fitted. `density` is the table
 * the integrator reads, `dragK` the slot it reads, omega the rate it rotates the
 * air at, and cos i is taken against the same spin axis.
 *
 * Why not something simpler, measured against flown decay on all four pads:
 * circular at the semi-major axis reads 1.5-3.1% long, always long, because
 * density is weighted toward perigee and an eccentricity of 0.001 is 6.4 km of
 * altitude against a 22.5 km scale height. Holding e at its starting value
 * fixes the start and over-corrects the end, since drag circularises the orbit
 * while it lowers it. Marching both agrees to 0.2-1.0% over 34 samples, and the
 * one orbit flown all the way down — Vandenberg's, lost at 274.58 h — it puts
 * at 274.5 h.
 *
 * Valid while x stays small, which is to say near-circular: first-order in e,
 * and the parking orbits it is used on sit at x of about 0.3.
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
 * Local density scale height, m, read off the table rather than restated.
 * A second copy of the layer heights would be one edit away from disagreeing
 * with the air the vehicle actually flies through.
 */
function scaleHeight(alt) {
  const lo = density(alt)
  const hi = density(alt + 100)
  return lo > hi && hi > 0 ? 100 / Math.log(lo / hi) : Infinity
}

/** da/dt and de/dt, written here. One-shot planning, but still no allocation per step. */
const _rate = new Float64Array(2)

function rates(a, e, dragK, cosI) {
  const alt = a - R
  const rho = density(alt)
  if (!(rho > 0)) {
    _rate[0] = 0
    _rate[1] = 0
    return
  }
  const wind = 1 - (SPIN_RATE * a * cosI) / Math.sqrt(MU / a)
  const x = (a * e) / scaleHeight(alt)

  // I0, I1, I2 by their series. Sixteen terms is exact to machine precision
  // well past any x a near-circular orbit reaches.
  const q = 0.5 * x
  const q2 = q * q
  let t0 = 1
  let t1 = q
  let t2 = 0.5 * q2
  let i0 = 0
  let i1 = 0
  let i2 = 0
  for (let k = 0; k < 16; k++) {
    i0 += t0
    i1 += t1
    i2 += t2
    t0 *= q2 / ((k + 1) * (k + 1))
    t1 *= q2 / ((k + 1) * (k + 2))
    t2 *= q2 / ((k + 1) * (k + 3))
  }

  const b = 2 * dragK * rho * wind * wind
  _rate[0] = -b * Math.sqrt(MU * a) * (i0 + 2 * e * i1)
  _rate[1] = -b * Math.sqrt(MU / a) * (i1 + 0.5 * e * (i0 + i2))
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
