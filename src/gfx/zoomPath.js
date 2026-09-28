/**
 * Getting from one view to another across fourteen decades of scale.
 *
 * A camera that locks onto Neptune from low Earth orbit has to cross 4.3e12 m to
 * end 1.4e8 m from a planet, having started 3e7 m from another one. Every
 * straight-line interpolation of that is wrong in the same way: a linear dolly
 * spends the whole move at a speed nobody can read — the camera left Earth at
 * 3.6e12 m/s in the old 1.2 s lock — and an eased one only moves where the
 * blur happens. What a viewer can follow is *relative* motion: the scene has to
 * change by about the same fraction of itself every moment.
 *
 * That is the problem van Wijk and Nuij solved for zooming user interfaces
 * ("Smooth and efficient zooming and panning", IEEE InfoVis 2003), and their
 * answer is exact and closed-form: treat the view as a centre `u` and a width
 * `w`, give the metric ds² = (du² + dw²/ρ²... ) the right form, and the geodesic
 * between two views zooms out, pans while wide, and zooms back in, spending its
 * time evenly over the *perceived* change. ρ ≈ 1.42 was the value their users
 * preferred; √2 is what the metric's own optimum reduces to.
 *
 * Here `u` runs along the chord from the old look point to the new one, and `w`
 * is the width of the view at the look point — the camera's distance times
 * `2 tan(fov/2)`. The path is re-planned every frame against where both ends are
 * *now*, at the same fraction of its length, so a destination that moves — a
 * planet under time warp, a vehicle at 7.8 km/s — is followed rather than
 * missed, and the move still ends exactly on it.
 *
 * Numerically: `r = ln(−b + √(b² + 1))` is `−asinh(b)`, which is how it is
 * computed. The literal form cancels catastrophically once `b` reaches 1e8 —
 * every interplanetary move here — and returns the log of zero.
 */

/** The curvature of the path: how readily it trades a zoom out for a shorter pan. */
export const RHO = 1.42

/**
 * Plan a move from a view of width `w0` to one of width `w1`, `u1` apart.
 * Writes into and returns `plan`; allocates nothing.
 */
export function planZoomPan(plan, w0, w1, u1, rho = RHO) {
  plan.w0 = w0
  plan.w1 = w1
  plan.u1 = u1
  plan.rho = rho
  // A pure zoom — or near enough that the pan is below a part in a million of
  // the view — has no geodesic in the general form (b diverges). It is a
  // log-linear dolly, the same thing in the limit.
  if (!(u1 > 1e-6 * Math.min(w0, w1))) {
    plan.pure = true
    plan.r0 = 0
    plan.r1 = 0
    plan.S = Math.abs(Math.log(w1 / w0)) / rho
    return plan
  }
  const rho2 = rho * rho
  const rho4 = rho2 * rho2
  const b0 = (w1 * w1 - w0 * w0 + rho4 * u1 * u1) / (2 * w0 * rho2 * u1)
  const b1 = (w1 * w1 - w0 * w0 - rho4 * u1 * u1) / (2 * w1 * rho2 * u1)
  plan.pure = false
  plan.r0 = -Math.asinh(b0)
  plan.r1 = -Math.asinh(b1)
  plan.S = (plan.r1 - plan.r0) / rho
  return plan
}

/**
 * The view at path length `s` along a plan: `out.f` the fraction of the chord
 * covered, `out.w` the width. Allocates nothing.
 */
export function zoomPanAt(plan, s, out) {
  const { w0, rho } = plan
  if (plan.pure) {
    const S = plan.S
    out.f = S > 0 ? s / S : 1
    out.w = S > 0 ? w0 * Math.exp((plan.w1 >= w0 ? 1 : -1) * rho * s) : w0
    return out
  }
  const r0 = plan.r0
  const x = rho * s + r0
  const u = (w0 / (rho * rho)) * (Math.cosh(r0) * Math.tanh(x) - Math.sinh(r0))
  out.f = u / plan.u1
  out.w = (w0 * Math.cosh(r0)) / Math.cosh(x)
  return out
}

/**
 * How long a move of path length S should take, seconds.
 *
 * Proportional to S — the metric already measures how much the view changes —
 * at a pace chosen so that the Earth-to-Moon lock takes a little under three
 * seconds, and clamped at both ends: under a second is a jolt however short the
 * path, and past nine the viewer is waiting rather than watching.
 */
export const PACE = 2.1
export const flightSeconds = (S, min = 0.9, max = 9) => Math.min(max, Math.max(min, S / PACE))

/** Smootherstep: zero velocity and zero acceleration at both ends. */
export const smoother = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * t * (t * (t * 6 - 15) + 10))
