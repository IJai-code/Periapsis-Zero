/**
 * The Moon's geocentric state at a real instant.
 *
 * Where the Moon is at boot is where the whole lunar half of the product
 * starts: the phase over the terminator, the target a flight falls toward,
 * the fixture every gate is held to. Mean elements carried forward from
 * J2000 (what this replaced) drift 0.8 deg in longitude and 6,200 km in
 * range by 2026, because the largest things the Sun does to the lunar orbit
 * are periodic and no mean element expresses them: evection (1.27 deg),
 * variation (0.66 deg), the annual equation (0.19 deg).
 *
 * So the placement is a truncated lunar theory instead: the largest periodic
 * terms of the ELP series (Meeus, *Astronomical Algorithms* ch. 47), 23
 * terms in longitude, 14 in distance and 11 in latitude, with the E factor
 * on every term carrying the Sun's anomaly. That is good to a few
 * hundredths of a degree over a century. `verify-clock` holds a seven-term
 * truncation of its own and shares no code with this file; the difference
 * between the two truncations is the residual the gate reports.
 *
 * The output is the sim's own frame, the fixed J2000 ecliptic. The series
 * speaks of the ecliptic and equinox *of date*, and between the two sits the
 * general precession in longitude (1.397 deg per century, larger than the
 * Moon's own disc), so the longitude is reduced to J2000 here. A star chart
 * is a J2000 chart and the elements beside this one are J2000 elements; the
 * almanac comparisons in the gate reduce their own values the same way.
 *
 * Velocity comes from the series by central difference (a half-minute step:
 * the position is a trig polynomial in the lunar rates and the difference is
 * exact to a fraction of a millimetre per second), because an inconsistent
 * position-velocity pair would start the integrator on an orbit the Moon is
 * not on, and the whole point of this file is that it is.
 */

const DEG = Math.PI / 180
const DAY = 86400
const CENTURY = 36525 * DAY

/** General precession in longitude since J2000, degrees (IAU 1976, two terms). */
function precession(T) {
  return 1.396981 * T + 0.0003086 * T * T
}

/*
 * Periodic terms: [D, M, M', F, coefficient, solar].
 *
 * `solar` marks the terms carrying the Sun's mean anomaly, which Meeus
 * scales by E. Arguments are the four fundamental arguments of lunar theory:
 * the Moon's mean elongation D, the Sun's mean anomaly M, the Moon's mean
 * anomaly M', and the argument of latitude F. Coefficients are in units of
 * 1e-6 degrees (longitude, latitude) or 1e-3 km (distance).
 */
const SIGMA_L = [
  [0, 0, 1, 0, 6288774, 0],
  [2, 0, -1, 0, 1274027, 0],
  [2, 0, 0, 0, 658314, 0],
  [0, 0, 2, 0, 213618, 0],
  [0, 1, 0, 0, -185116, 1],
  [0, 0, 0, 2, -114332, 0],
  [2, 0, -2, 0, 58793, 0],
  [2, -1, -1, 0, 57066, 1],
  [2, 0, 1, 0, 53322, 0],
  [2, -1, 0, 0, 45758, 1],
  [0, 1, -1, 0, -40923, 1],
  [1, 0, 0, 0, -34720, 0],
  [0, 1, 1, 0, -30383, 1],
  [2, 0, 0, -2, 15327, 0],
  [0, 0, 1, 2, -12528, 0],
  [0, 0, 1, -2, 10980, 0],
  [4, 0, -1, 0, 10675, 0],
  [0, 0, 3, 0, 10034, 0],
  [4, 0, -2, 0, 8548, 0],
  [2, 1, -1, 0, -7888, 1],
  [2, 1, 0, 0, -6766, 1],
  [1, 0, -1, 0, -5163, 0],
  [1, 1, 0, 0, 4987, 1],
]

const SIGMA_R = [
  [0, 0, 1, 0, -20905355, 0],
  [2, 0, -1, 0, -3699111, 0],
  [2, 0, 0, 0, -2955968, 0],
  [0, 0, 2, 0, -569925, 0],
  [0, 1, 0, 0, 48888, 1],
  [0, 0, 0, 2, -3149, 0],
  [2, 0, -2, 0, 246158, 0],
  [2, -1, -1, 0, -152138, 1],
  [2, 0, 1, 0, -170733, 0],
  [2, -1, 0, 0, -204586, 1],
  [0, 1, -1, 0, -129620, 1],
  [1, 0, 0, 0, 108743, 0],
  [0, 1, 1, 0, 104755, 1],
  [2, 0, 0, -2, 10321, 0],
]

const SIGMA_B = [
  [0, 0, 0, 1, 5128122, 0],
  [0, 0, 1, 1, 280602, 0],
  [0, 0, 1, -1, 277693, 0],
  [2, 0, 0, -1, 173237, 0],
  [2, 0, -1, 1, 55413, 0],
  [2, 0, -1, -1, 46271, 0],
  [2, 0, 0, 1, 32573, 0],
  [0, 0, 2, 1, 17198, 0],
  [2, 0, 1, -1, 9266, 0],
  [0, 0, 2, -1, 8822, 0],
  [4, 0, -1, -1, 8216, 0],
]

/**
 * Sum a term table over the four arguments, with E on the solar terms.
 * Longitude and latitude are sine series; the distance is a cosine one
 * (Meeus ch. 47 builds the radius as mean plus cosines of the same
 * arguments), which is the whole difference between an orbit and a mess.
 */
function sumTerms(table, D, M, Mp, F, E, sine) {
  let s = 0
  for (let k = 0; k < table.length; k++) {
    const t = table[k]
    const arg = (t[0] * D + t[1] * M + t[2] * Mp + t[3] * F) * DEG
    const wave = sine ? Math.sin(arg) : Math.cos(arg)
    s += (t[5] ? t[4] * E : t[4]) * wave
  }
  return s
}

/**
 * The geocentric position, fixed J2000 ecliptic, metres.
 * Returned as a fresh array; this is boot-time code, not the frame path.
 */
export function lunarPosition(t) {
  const T = t / CENTURY
  // The four fundamental arguments and the eccentricity factor (Meeus 47.1..47.6).
  const Lp = 218.3164477 + 481267.88123421 * T - 0.0015786 * T * T
  const D = 297.8501921 + 445267.1114034 * T - 0.0018819 * T * T
  const M = 357.5291092 + 35999.0502909 * T - 0.0001536 * T * T
  const Mp = 134.9633964 + 477198.8675055 * T + 0.0087414 * T * T
  const F = 93.272095 + 483202.0175233 * T - 0.0036539 * T * T
  const E = 1 - 0.002516 * T - 0.0000074 * T * T

  const lon = Lp + sumTerms(SIGMA_L, D, M, Mp, F, E, true) * 1e-6 - precession(T)
  const lat = sumTerms(SIGMA_B, D, M, Mp, F, E, true) * 1e-6
  const dist = (385000.56 + sumTerms(SIGMA_R, D, M, Mp, F, E, false) * 1e-3) * 1000

  const l = lon * DEG
  const b = lat * DEG
  const cb = Math.cos(b)
  return [dist * cb * Math.cos(l), dist * cb * Math.sin(l), dist * Math.sin(b)]
}

/**
 * The geocentric state (fixed J2000 ecliptic, metres and m/s) at `t` seconds
 * past J2000.0. Velocity from a central difference over `h` seconds: the
 * series is smooth at this scale and the difference is exact to a fraction
 * of a mm/s, which is an orbit the integrator is happy with.
 */
export function lunarState(t) {
  const h = 30
  const p0 = lunarPosition(t)
  const pa = lunarPosition(t + h)
  const pb = lunarPosition(t - h)
  return {
    pos: p0,
    vel: [(pa[0] - pb[0]) / (2 * h), (pa[1] - pb[1]) / (2 * h), (pa[2] - pb[2]) / (2 * h)],
  }
}
