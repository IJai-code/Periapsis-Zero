/**
 * Which body a craft is *about*.
 *
 * Every question of the form "prograde relative to what?" and "what orbit is
 * this?" has to pick a centre first, and the answer here is Laplace's sphere of
 * influence: a craft belongs to the smallest sphere that contains it,
 *
 *   r_SOI = d (m / M)^(2/5)
 *
 * where d is the body's distance from the one it orbits and m/M their mass
 * ratio. The radius is taken from the *live* separation rather than a constant,
 * the way live.js has always done it for the Moon: the Moon's orbit here is
 * emergent, and its sphere breathes by several thousand kilometres over a month.
 *
 * The criterion this replaces was "largest raw pull", m/r². It sounds like the
 * same idea and is not. The Sun pulls harder than Earth on anything more than
 * about 259,000 km out — but it pulls on Earth almost exactly as hard, so what
 * the craft actually feels relative to Earth is only the *difference*, which is
 * tiny. Flown along the real translunar coast, from TLI to ninety minutes before
 * periselene, raw pull called the craft heliocentric for 67.7% of the trip (from
 * 255,235 km out) and handed it to the Moon only 28,269 km from it. Laplace's
 * radius keeps it on Earth for 87.8% and hands over at 65,978 km, 17 km inside
 * the sphere. All of it is printed by scripts/verify-frames.mjs, not quoted.
 *
 * Nothing here allocates: it runs inside the projection, once per node. That is
 * why the lengths are written out as square roots rather than `Math.hypot`,
 * which on this V8 (12.4, Node 22) allocates on every call — 4,497 minor
 * collections over forty million calls, against 2 for the same length taken
 * with `Math.sqrt`. scripts/allocation.mjs measures it.
 */
import { BODIES, ORDER } from './constants.js'
import { INDEX } from './system.js'

/** Laplace's exponent. From equating the perturbation-to-central-force ratios. */
const SOI_EXPONENT = 0.4

/**
 * Per massive body, in state order: its own offset, its parent's offset (-1 for
 * the root), and (m / m_parent)^(2/5). Built once from the declared hierarchy,
 * so the per-call work is arithmetic on flat arrays.
 */
const OFFSET = new Int32Array(ORDER.length)
const PARENT_OFFSET = new Int32Array(ORDER.length)
const RATIO = new Float64Array(ORDER.length)
let ROOT = null

for (let k = 0; k < ORDER.length; k++) {
  const body = BODIES[ORDER[k]]
  if (INDEX[body.id] !== k) throw new Error(`soi: ${body.id} is not at state slot ${k}`)
  OFFSET[k] = k * 6
  if (body.parent) {
    if (!BODIES[body.parent]) throw new Error(`soi: ${body.id} orbits unknown body ${body.parent}`)
    PARENT_OFFSET[k] = INDEX[body.parent] * 6
    RATIO[k] = Math.pow(body.mass / BODIES[body.parent].mass, SOI_EXPONENT)
  } else {
    if (ROOT) throw new Error(`soi: both ${ROOT} and ${body.id} claim to orbit nothing`)
    PARENT_OFFSET[k] = -1
    RATIO[k] = Infinity
    ROOT = body.id
  }
}

/** Sphere-of-influence radius of a massive body in this state, m. Infinity for the root. */
export function soiRadius(state, id) {
  const k = INDEX[id]
  const p = PARENT_OFFSET[k]
  if (p < 0) return Infinity
  const o = OFFSET[k]
  const dx = state[o] - state[p]
  const dy = state[o + 1] - state[p + 1]
  const dz = state[o + 2] - state[p + 2]
  return Math.sqrt(dx * dx + dy * dy + dz * dz) * RATIO[k]
}

/**
 * The body whose sphere of influence the craft lies deepest inside.
 *
 * "Deepest" is the smallest sphere that contains it, which is the innermost
 * level of the hierarchy — the Moon's sphere sits wholly inside Earth's, so a
 * craft inside both belongs to the Moon. The root contains everything and is
 * the answer only when nothing smaller does.
 *
 * @param {{state: Float64Array}} sim  any integrator: the live one, or a scratch
 *   copy coasted to the instant being asked about
 * @param {string} craft  state-vector id
 */
export function dominantBody(sim, craft) {
  const s = sim.state
  const c = INDEX[craft] * 6
  let best = ROOT
  let smallest = Infinity
  for (let k = 0; k < ORDER.length; k++) {
    const p = PARENT_OFFSET[k]
    if (p < 0) continue
    const o = OFFSET[k]
    const bx = s[o] - s[p]
    const by = s[o + 1] - s[p + 1]
    const bz = s[o + 2] - s[p + 2]
    const radius = Math.sqrt(bx * bx + by * by + bz * bz) * RATIO[k]
    if (radius >= smallest) continue
    const cx = s[c] - s[o]
    const cy = s[c + 1] - s[o + 1]
    const cz = s[c + 2] - s[o + 2]
    if (cx * cx + cy * cy + cz * cz < radius * radius) {
      best = ORDER[k]
      smallest = radius
    }
  }
  return best
}
