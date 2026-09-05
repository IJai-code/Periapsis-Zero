/**
 * Free-flight camera: how fast it moves, and why that is not a constant.
 *
 * A viewpoint that can sit forty metres off a hull and also cross an
 * astronomical unit has no single sensible speed. Anything comfortable next to
 * the spacecraft takes fifteen hundred years to reach the Sun; anything that
 * crosses the system passes through the whole Earth in under a millisecond. The
 * only speed that works everywhere is one proportional to how much room there
 * is, which is what `live.nearest.distance` measures.
 *
 *   v = gain * d
 *
 * Moving straight at a surface that gives dd/dt = -gain * d, so distance decays
 * exponentially and the *time* to cross a range is logarithmic in its ratio:
 *
 *   t = ln(d0 / d1) / gain
 *
 * At gain 0.5 that is 1.39 s to halve the gap, and 46.9 s to go from one AU to
 * ten metres off a hull — ten decades. The same forty-seven seconds covers the
 * next ten decades too, which is the property that makes the control usable at
 * every scale rather than at one of them.
 *
 * Kept out of the rig so the law can be exercised without a renderer.
 */

/** Fraction of the distance to the nearest surface covered per second. */
export const FLY_GAIN = 0.5

/**
 * Floor, in m/s. Without it the speed goes to zero as the camera touches a
 * surface — and to *negative* inside one, where the nearest-surface distance is
 * signed.
 */
export const FLY_FLOOR = 0.5

/** Held-modifier multipliers: coarse for crossing, fine for inspecting. */
export const FLY_BOOST = 5
export const FLY_FINE = 0.2

/** What the wheel can trim the speed to, either side of nominal. */
export const FLY_TRIM_MIN = 0.05
export const FLY_TRIM_MAX = 20

/**
 * Speed for a given distance to the nearest surface.
 *
 * Deliberately uncapped, including past the speed of light. The camera is a
 * viewpoint, not an object — nothing is being transported and no physics is
 * being claimed. Capping at c would put a hard ceiling of 3e8 m/s on a control
 * whose entire purpose is that it has no fixed scale, and would make crossing
 * an AU take 499 seconds: the molasses this replaces, reintroduced at the far
 * end. The HUD says what the speed is; where that exceeds c it says so.
 *
 * @param {number} nearest  metres to the nearest surface; may be negative
 * @param {number} trim     user's wheel trim, nominally 1
 */
export function flySpeed(nearest, trim = 1) {
  const room = Number.isFinite(nearest) ? Math.max(nearest, 0) : 0
  return Math.max(FLY_FLOOR, room * FLY_GAIN) * trim
}

/**
 * Translation axes, as [code, axis, sign], in the camera's own frame. Three's
 * forward is -Z. W and S are shared with the throttle and yielded by
 * ShipControls while this mode is active.
 */
export const FLY_AXES = [
  ['KeyW', 'z', -1],
  ['KeyS', 'z', 1],
  ['KeyA', 'x', -1],
  ['KeyD', 'x', 1],
  ['KeyR', 'y', 1],
  ['KeyF', 'y', -1],
]

/**
 * Fold a set of held key codes into a direction in the camera's frame.
 *
 * Split out of the rig so it can be checked without a browser. Holding a key
 * down is the one input this project's tooling cannot synthesise — a dispatched
 * KeyboardEvent never reaches the page's listeners, and the automation's key
 * action sends press-and-release inside a single task, so the key is never held
 * across an animation frame. Everything either side of the listener is
 * therefore worth making testable: this, and `flySpeed` above.
 *
 * `out` may be a Vector3 or any {x,y,z}. Opposing keys cancel by summing signs
 * rather than by precedence, so releasing one while the other is still down
 * does the right thing without tracking order.
 */
export function flyAxisInput(keys, out) {
  out.x = 0
  out.y = 0
  out.z = 0
  for (const [code, axis, sign] of FLY_AXES) {
    if (keys.has(code)) out[axis] += sign
  }
  return out
}

/** Held-modifier multiplier. Boost wins if both are down. */
export function flyModifier(keys) {
  if (keys.has('ShiftLeft') || keys.has('ShiftRight')) return FLY_BOOST
  if (keys.has('ControlLeft') || keys.has('ControlRight')) return FLY_FINE
  return 1
}

/** Clamp a wheel-driven trim to its usable band. */
export const clampTrim = (t) => Math.min(Math.max(t, FLY_TRIM_MIN), FLY_TRIM_MAX)

/**
 * How long, in seconds, to fly straight from `from` to `to` metres of surface
 * clearance at this gain — integrated rather than taken from the closed form,
 * because the floor makes the last metre linear and the closed form does not
 * know that.
 */
export function flyTime(from, to, trim = 1, dt = 1 / 60) {
  let d = from
  let t = 0
  const limit = 60 * 60 * 24
  while (d > to && t < limit) {
    d -= flySpeed(d, trim) * dt
    t += dt
  }
  return t
}
