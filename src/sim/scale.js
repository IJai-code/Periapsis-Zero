/**
 * Display scaling.
 *
 * A true-to-scale solar system is unwatchable: at one screen-width per AU the
 * Earth is a third of a pixel and the Moon's whole orbit fits inside it. So the
 * renderer applies three independent exaggerations, all of them declared here
 * so it is obvious what is honest and what is not:
 *
 *   POSITION   orbital radii, linear — preserves the shape of every orbit
 *   RADIUS     body radii, per-body — makes the bodies visible
 *   MOON_BOOST the Moon's *offset from Earth* only — separates the pair
 *
 * The physics never sees any of this. Only `toScene()` does.
 */
import { AU, BODIES, TEST_PARTICLES } from './constants.js'

/** Scene units per AU. Sets the overall size of the system on screen. */
export const AU_IN_SCENE = 120

/** metres -> scene units, for orbital position. */
export const POSITION_SCALE = AU_IN_SCENE / AU

/**
 * The Moon's geocentric offset is stretched by this factor. At true scale the
 * Moon sits 0.3 scene units from Earth's centre — inside an Earth drawn at any
 * visible size. 24x lifts it clear while keeping the orbit's shape, phase and
 * inclination exactly right.
 */
export const MOON_BOOST = 24

/**
 * Rendered radii, in scene units. Chosen by eye rather than derived, because
 * one exaggeration factor cannot serve a star and a moon at the same time.
 */
export const VISUAL_RADIUS = {
  sun: 4.6,
  earth: 1.15,
  moon: 0.31,
}

/** How far the exaggeration goes, per body — surfaced in the HUD. */
export const RADIUS_EXAGGERATION = Object.fromEntries(
  Object.keys(VISUAL_RADIUS).map((id) => [
    id,
    VISUAL_RADIUS[id] / (BODIES[id].radius * POSITION_SCALE),
  ]),
)

/**
 * Every craft in Earth orbit. Their geocentric offsets share one scaling rule,
 * so adding a satellite cannot accidentally miss it — which is precisely what
 * happened when this was matched on a single hard-coded id.
 */
const EARTH_ORBIT_CRAFT = new Set(TEST_PARTICLES)

/**
 * A craft's geocentric offset is scaled by exactly the factor Earth's *radius*
 * is exaggerated by, not by the raw position scale.
 *
 * This is not cosmetic. At raw POSITION_SCALE a 400 km orbit sits 3.2e-4 scene
 * units above Earth's centre while the planet renders at 1.15 — the craft would
 * be buried some three thousand times deeper than the surface it is supposed to
 * be orbiting. Matching the radius exaggeration puts it at 0.0722 units, i.e.
 * 6.3% of an Earth radius above the surface, which is the true ratio. Low orbit
 * then visually hugs the globe, exactly as it should.
 *
 * Note this is a different factor from MOON_BOOST, and deliberately so: the
 * Moon is pushed out to be legible, the ship is scaled to stay honest.
 */
export const ORBIT_ALTITUDE_SCALE = RADIUS_EXAGGERATION.earth

/** Rendered size of the craft, in scene units. */
export const SHIP_VISUAL_LENGTH = 0.022

/**
 * Map a body's SI position to its scene position.
 * @param {string} id           body id
 * @param {Float64Array} state  flat [x,y,z,vx,vy,vz] per body
 * @param {number} index        this body's slot in the state vector
 * @param {number} earthIndex   Earth's slot, for the Moon's boosted offset
 * @param {import('three').Vector3} out
 * @param {import('three').Vector3|null} origin  floating-origin offset to
 *   subtract, in scene units. Omitted, the result is absolute — which is what
 *   the trail seeder wants, since it runs against a cloned simulation where the
 *   live origin has no meaning.
 */
export function toScene(id, state, index, earthIndex, out, origin = null) {
  const o = index * 6
  if (EARTH_ORBIT_CRAFT.has(id)) {
    const e = earthIndex * 6
    out.set(
      (state[e] + (state[o] - state[e]) * ORBIT_ALTITUDE_SCALE) * POSITION_SCALE,
      (state[e + 1] + (state[o + 1] - state[e + 1]) * ORBIT_ALTITUDE_SCALE) * POSITION_SCALE,
      (state[e + 2] + (state[o + 2] - state[e + 2]) * ORBIT_ALTITUDE_SCALE) * POSITION_SCALE,
    )
  } else if (id === 'moon') {
    const e = earthIndex * 6
    out.set(
      (state[e] + (state[o] - state[e]) * MOON_BOOST) * POSITION_SCALE,
      (state[e + 1] + (state[o + 1] - state[e + 1]) * MOON_BOOST) * POSITION_SCALE,
      (state[e + 2] + (state[o + 2] - state[e + 2]) * MOON_BOOST) * POSITION_SCALE,
    )
  } else {
    out.set(state[o] * POSITION_SCALE, state[o + 1] * POSITION_SCALE, state[o + 2] * POSITION_SCALE)
  }
  if (origin) out.sub(origin)
  return out
}
