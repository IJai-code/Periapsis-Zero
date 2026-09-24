/**
 * Two-body tools for planning: Kepler propagation and Lambert's problem, in
 * universal variables so they hold on either side of a parabola.
 *
 * Planning, not flying. Everything here predicts where a craft *would* be on a
 * point-mass orbit, so that a burn can be chosen; the burn itself is then flown
 * by the integrator, in the full field, and the next plan starts from where the
 * craft actually is. Near the Moon over the hours a rendezvous takes, the
 * point-mass prediction is off by Earth's tide — about 2.5e-5 m/s², metres over
 * an orbit and less between two craft a few kilometres apart — which is what
 * the midcourse corrections and the closing phase are for.
 *
 * Vectors are plain arrays of three numbers. These are not on the frame path:
 * they run a handful of times per burn, and allocate.
 */

const TWO_PI = 2 * Math.PI

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const norm = (a) => Math.hypot(a[0], a[1], a[2])
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]

/** Stumpff's functions C(z) and S(z), with series near zero where the closed forms cancel. */
export function stumpffC(z) {
  if (z > 1e-6) return (1 - Math.cos(Math.sqrt(z))) / z
  if (z < -1e-6) return (Math.cosh(Math.sqrt(-z)) - 1) / -z
  return 1 / 2 - z / 24 + (z * z) / 720
}
export function stumpffS(z) {
  if (z > 1e-6) {
    const s = Math.sqrt(z)
    return (s - Math.sin(s)) / (s * s * s)
  }
  if (z < -1e-6) {
    const s = Math.sqrt(-z)
    return (Math.sinh(s) - s) / (s * s * s)
  }
  return 1 / 6 - z / 120 + (z * z) / 5040
}

/**
 * Where a craft at (r0, v0) is after `dt` seconds on a point-mass orbit of
 * parameter `mu`. Returns { r, v }. Newton on the universal anomaly, from the
 * standard starting guess; converges in a few iterations for anything bound.
 */
export function propagate(r0, v0, dt, mu) {
  const rn = norm(r0)
  const vr0 = dot(r0, v0) / rn
  const alpha = 2 / rn - dot(v0, v0) / mu
  const sqmu = Math.sqrt(mu)
  let x = sqmu * Math.abs(alpha) * dt
  if (!(Math.abs(alpha) > 1e-12)) x = (sqmu * dt) / rn
  for (let k = 0; k < 60; k++) {
    const z = alpha * x * x
    const C = stumpffC(z)
    const S = stumpffS(z)
    const F = ((rn * vr0) / sqmu) * x * x * C + (1 - alpha * rn) * x * x * x * S + rn * x - sqmu * dt
    const dF = ((rn * vr0) / sqmu) * x * (1 - alpha * x * x * S) + (1 - alpha * rn) * x * x * C + rn
    const step = F / dF
    x -= step
    if (Math.abs(step) < 1e-10) break
  }
  const z = alpha * x * x
  const C = stumpffC(z)
  const S = stumpffS(z)
  const f = 1 - ((x * x) / rn) * C
  const g = dt - (x * x * x * S) / sqmu
  const r = [f * r0[0] + g * v0[0], f * r0[1] + g * v0[1], f * r0[2] + g * v0[2]]
  const rm = norm(r)
  const fd = (sqmu / (rm * rn)) * (alpha * x * x * x * S - x)
  const gd = 1 - ((x * x) / rm) * C
  const v = [fd * r0[0] + gd * v0[0], fd * r0[1] + gd * v0[1], fd * r0[2] + gd * v0[2]]
  return { r, v }
}

/**
 * Lambert's problem: the velocities that carry a craft from r1 to r2 in `tof`
 * seconds, the short way round in the sense of `normal` (the plane's angular
 * momentum direction). Returns { v1, v2 }, or null if it did not converge.
 * Universal variables, bisection-guarded Newton on z (Curtis, ch. 5).
 */
export function lambert(r1, r2, tof, mu, normal) {
  const n1 = norm(r1)
  const n2 = norm(r2)
  const c12 = cross(r1, r2)
  let cosd = dot(r1, r2) / (n1 * n2)
  cosd = Math.max(-1, Math.min(1, cosd))
  let dtheta = Math.acos(cosd)
  if (dot(c12, normal) < 0) dtheta = TWO_PI - dtheta
  const A = Math.sin(dtheta) * Math.sqrt((n1 * n2) / (1 - Math.cos(dtheta)))
  const y = (z) => n1 + n2 + (A * (z * stumpffS(z) - 1)) / Math.sqrt(stumpffC(z))
  const time = (z) => {
    const yz = y(z)
    if (yz < 0) return NaN
    return (Math.pow(yz / stumpffC(z), 1.5) * stumpffS(z) + A * Math.sqrt(yz)) / Math.sqrt(mu)
  }
  // Bracket z so the time of flight is spanned: from where y is just positive,
  // up to the first full revolution, (2π)².
  let lo = -4 * Math.PI * Math.PI
  while (!(time(lo) >= 0) && lo < 0) lo += 0.1
  let hi = 4 * Math.PI * Math.PI - 1e-6
  if (!(time(lo) <= tof && time(hi) >= tof)) {
    // Outside the single-revolution range this solver is written for.
    return null
  }
  let z = 0.5 * (lo + hi)
  for (let k = 0; k < 200; k++) {
    const t = time(z)
    if (!Number.isFinite(t)) {
      lo = z
      z = 0.5 * (lo + hi)
      continue
    }
    if (Math.abs(t - tof) < 1e-11 * tof) break
    if (t < tof) lo = z
    else hi = z
    z = 0.5 * (lo + hi)
  }
  const yz = y(z)
  const f = 1 - yz / n1
  const g = A * Math.sqrt(yz / mu)
  const gd = 1 - yz / n2
  const v1 = [(r2[0] - f * r1[0]) / g, (r2[1] - f * r1[1]) / g, (r2[2] - f * r1[2]) / g]
  const v2 = [(gd * r2[0] - r1[0]) / g, (gd * r2[1] - r1[1]) / g, (gd * r2[2] - r1[2]) / g]
  return { v1, v2 }
}

/** Semi-major axis, eccentricity, periapsis and apoapsis radius of (r, v). */
export function orbitOf(r, v, mu) {
  const rn = norm(r)
  const e2 = dot(v, v) / 2 - mu / rn
  const a = -mu / (2 * e2)
  const h = cross(r, v)
  const hn = norm(h)
  const ev = cross(v, h).map((c, k) => c / mu - r[k] / rn)
  const e = norm(ev)
  return { a, e, periapsis: a * (1 - e), apoapsis: a * (1 + e), h, hn, ev, period: TWO_PI * Math.sqrt((a * a * a) / mu) }
}

export const vec = { dot, norm, cross }
