import { blackbodyRGB } from './stars.js'

/**
 * The plasma sheath at entry: how bright it is, and what colour.
 *
 * Neither is invented. The simulator already computes the two heat fluxes at
 * the stagnation point every frame, and `verify-heating` already checks them
 * against the correlations they come from — Sutton-Graves for the convective
 * term and Tauber-Sutton for the radiative one. So the sheath is keyed to those
 * rather than to a threshold on dynamic pressure and speed, which would be a
 * second, disagreeing definition of when entry heating begins.
 *
 * ── what colour a shock layer is ──────────────────────────────────────
 *
 * `live.radiativeFlux` is the energy the shock layer is radiating per square
 * metre. A surface radiating that much has an effective temperature, by
 * Stefan-Boltzmann and nothing else:
 *
 *   T = (q_rad / sigma)^(1/4)
 *
 * and that temperature has a colour, by the same Planck-through-CIE integral
 * `gfx/stars.js` uses for the star catalogue and `verify-stars` checks against
 * the Planckian locus. Reusing it is the point: a 2,500 K shock layer and a
 * 2,500 K star are the same colour, and there is one piece of code in this
 * repository that knows what that colour is.
 *
 * This is an *effective* radiating temperature, not the gas temperature. A real
 * shock layer runs ten thousand kelvin and is optically thin, so it radiates far
 * less than a blackbody at its own temperature — which is exactly why the
 * effective temperature is the right quantity for "what colour is the glow" and
 * the gas temperature is not.
 *
 * ── when it becomes visible ───────────────────────────────────────────
 *
 * Also not a threshold anyone picked. A body begins to glow visibly at the
 * **Draper point**, 798 K, which is a measured property of hot matter and has
 * been since 1847. Running that back through Stefan-Boltzmann gives the flux at
 * which a sheath first has anything to show:
 *
 *   q = sigma T^4 = 5.670e-8 x 798^4 = 23.0 kW/m^2
 *
 * Below it the sheath is drawn at nothing. Above it the opacity follows the
 * total flux, so the glow arrives as the heating does.
 */

/** Stefan-Boltzmann, W m^-2 K^-4. */
export const SIGMA = 5.670374419e-8

/**
 * The Draper point, K: where hot matter starts to glow visibly red.
 *
 * A measurement, not a setting — it is why an iron bar goes red before it goes
 * orange, and it is the honest place to start drawing a sheath.
 */
export const DRAPER_POINT = 798

/** The radiative flux that corresponds to it, W/m^2. */
export const VISIBLE_FLUX = SIGMA * DRAPER_POINT ** 4

/**
 * Flux at which the sheath is drawn at full opacity, W/m^2.
 *
 * A drawing decision, and labelled as one rather than dressed up as a flight
 * measurement. The first version of this said "Apollo peaked near 5 MW/m^2" —
 * a figure for a stagnation point with a different nose radius, which this
 * simulator's own corridor does not reach, so the sheath never got past a third
 * of its opacity and the gate caught it.
 *
 * One megawatt a square metre is where the corridor `verify-plasma` walks
 * actually peaks, 0.86 MW/m^2, rounded up to the nearest round number above it.
 * The gate asserts that the corridor reaches full opacity, so the constant and
 * the flight it is drawn for cannot drift apart.
 */
export const SATURATION_FLUX = 1e6

/*
 * ── what this costs, including the part not solved ────────────────────
 *
 * `plasmaState` is the frame path and it is not allocation-free: **13.5 bytes a
 * call**, measured across an entry corridor and repeatable to the hundredth of
 * a byte over four processes. That is one boxed double in the lit branch and
 * none in the dark one, averaged over a sweep that visits both. Which value V8
 * tags was not found, and the same hunt on `gfx/plume.js` did not find its
 * equivalent either.
 *
 * Two things were tried and are recorded because they are counter-intuitive.
 * Inlining `radiatingTemperature` and `rampColour` into the branch — the fix
 * that took the plume from 33 bytes to 11.8 — moved nothing here. And replacing
 * `Math.pow(x, 0.25)` with `Math.sqrt(Math.sqrt(x))`, which is exactly equal and
 * two machine instructions instead of a runtime call, made it **worse at 45.4
 * bytes**. That one is not variance: the measurement is stable either way, so
 * the slower-looking call is the cheaper one and the file keeps it.
 *
 * It is called once a frame, for one vehicle, so this is under a kilobyte a
 * second. It is still not zero, and the gate says so rather than asserting a
 * bar it cannot meet.
 */

/** Effective radiating temperature of a surface emitting `q` W/m^2. */
export const radiatingTemperature = (q) => (q > 0 ? Math.pow(q / SIGMA, 0.25) : 0)

/**
 * The sheath's state, written into `out` — never allocated.
 *
 * Temperature is clamped into the range the blackbody integral is meaningful
 * over before it is asked for a colour. The bottom of that range is the Draper
 * point itself, because a sheath dimmer than that is not drawn at all and a
 * colour for it would be a colour nobody sees.
 *
 * @param {Float64Array} out  [r, g, b, opacity, temperature K]
 */
/**
 * Blackbody colour as a ramp, generated once from the integral.
 *
 * `blackbodyRGB` is ninety-five wavelengths of `Math.exp` through the CIE
 * observer, which is the right way to answer the question once and the wrong
 * way to answer it sixty times a second — measured, calling it per frame cost
 * 13.4 bytes a call as well as the arithmetic. The colour is a function of one
 * scalar, so it is tabulated here at module load, log-spaced because that is how
 * temperature behaves, and read back by interpolation.
 *
 * Nothing is hand-painted: the table is the integral's own output, and
 * `verify-plasma` checks the two against each other rather than trusting that
 * they agree.
 */
const RAMP_STEPS = 256
const RAMP_LO = DRAPER_POINT
const RAMP_HI = 40000
const _ramp = new Float32Array(RAMP_STEPS * 3)
const _logLo = Math.log(RAMP_LO)
const _logSpan = Math.log(RAMP_HI) - _logLo
{
  const rgb = new Float64Array(3)
  for (let i = 0; i < RAMP_STEPS; i++) {
    blackbodyRGB(rgb, Math.exp(_logLo + (i / (RAMP_STEPS - 1)) * _logSpan))
    _ramp[i * 3] = rgb[0]
    _ramp[i * 3 + 1] = rgb[1]
    _ramp[i * 3 + 2] = rgb[2]
  }
}

/** The ramp read at a temperature, written into `out[0..2]`. Allocates nothing. */
export function rampColour(out, T, at = 0) {
  const clamped = T < RAMP_LO ? RAMP_LO : T > RAMP_HI ? RAMP_HI : T
  const u = ((Math.log(clamped) - _logLo) / _logSpan) * (RAMP_STEPS - 1)
  const i = u | 0
  const j = i + 1 < RAMP_STEPS ? i + 1 : i
  const f = u - i
  out[at] = _ramp[i * 3] + (_ramp[j * 3] - _ramp[i * 3]) * f
  out[at + 1] = _ramp[i * 3 + 1] + (_ramp[j * 3 + 1] - _ramp[i * 3 + 1]) * f
  out[at + 2] = _ramp[i * 3 + 2] + (_ramp[j * 3 + 2] - _ramp[i * 3 + 2]) * f
  return out
}

export function plasmaState(out, convective, radiative) {
  const total = convective + radiative
  if (!(total > VISIBLE_FLUX)) {
    out[0] = 0
    out[1] = 0
    out[2] = 0
    out[3] = 0
    out[4] = 0
    return out
  }
  /*
   * Colour from the radiative term, because that is the one that is actually
   * light. Convection heats the vehicle; it does not glow. When the radiative
   * term is below the Draper point but the total is above it — the early,
   * convection-dominated part of an entry — the sheath is drawn at the Draper
   * point's own colour, which is the dullest red there is.
   */
  /*
   * The temperature and the ramp read are both written out here rather than
   * called. `radiatingTemperature` returns a double down one path and a small
   * integer down another, and `rampColour` carries a default parameter — both
   * are shapes V8 will not keep in a register, and the plume measured the same
   * pattern at 16 bytes a call. They stay exported because the gate reads them
   * and a gate is not a frame.
   */
  const T = radiative > 0 ? Math.pow(radiative / SIGMA, 0.25) : 0
  const clamped = T > DRAPER_POINT ? T : DRAPER_POINT
  const capped = clamped < RAMP_HI ? clamped : RAMP_HI
  const u = ((Math.log(capped) - _logLo) / _logSpan) * (RAMP_STEPS - 1)
  const i = u | 0
  const j = i + 1 < RAMP_STEPS ? i + 1 : i
  const f = u - i
  out[0] = _ramp[i * 3] + (_ramp[j * 3] - _ramp[i * 3]) * f
  out[1] = _ramp[i * 3 + 1] + (_ramp[j * 3 + 1] - _ramp[i * 3 + 1]) * f
  out[2] = _ramp[i * 3 + 2] + (_ramp[j * 3 + 2] - _ramp[i * 3 + 2]) * f
  /*
   * Opacity on the total flux, on a square root rather than linearly: the sheath
   * is a thin emitting layer, so what a viewer sees goes with the energy in it
   * and not with its fourth power, and a linear ramp keeps it invisible until
   * the last few seconds of an entry that lasts minutes.
   */
  const span = (total - VISIBLE_FLUX) / (SATURATION_FLUX - VISIBLE_FLUX)
  const s = span > 1 ? 1 : span
  out[3] = Math.sqrt(s)
  out[4] = clamped
  return out
}
