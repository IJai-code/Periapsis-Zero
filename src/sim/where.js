import { live } from './live.js'
import { RAIL_INDEX } from './rails.js'
import { COSMIC } from './cosmic.js'

export { COSMIC }

/**
 * Where anything the camera can go to is, in one call.
 *
 * Three kinds of thing are drawn, and they live in three places: the
 * integrated bodies and craft in the state vector (`live.abs`), the planets and
 * moons on rails in the rails buffer (heliocentric, added to the Sun), and the
 * sky beyond the solar system — stars at their real distances, the galaxy,
 * its neighbours — at fixed barycentric positions registered in `COSMIC` by
 * `sim/cosmos.js`. Everything that steers a camera asks here rather than
 * knowing which of the three a name belongs to.
 *
 * `absoluteOf` answers in the absolute barycentric frame; `rebasedOf` in the
 * floating origin's, which is what the scene graph is drawn in. Both write into
 * `out` and return it, or return null for a name nothing knows. Neither
 * allocates.
 */

export function absoluteOf(id, out) {
  const a = live.abs[id]
  if (a !== undefined) return out.copy(a)
  // Where it is *drawn*: moons run on the frame clock, not the rails refresh.
  const r = live.railPos[id]
  if (r !== undefined) return out.copy(r).add(live.origin)
  const c = COSMIC[id]
  if (c !== undefined) return out.copy(c.abs)
  return null
}

export function rebasedOf(id, out) {
  const p = live.pos[id]
  if (p !== undefined) return out.copy(p)
  const r = live.railPos[id]
  if (r !== undefined) return out.copy(r)
  const c = COSMIC[id]
  if (c !== undefined) return out.copy(c.abs).sub(live.origin)
  return null
}

/** Whether a name is somewhere. */
export const isPlace = (id) =>
  live.abs[id] !== undefined || RAIL_INDEX[id] !== undefined || COSMIC[id] !== undefined
