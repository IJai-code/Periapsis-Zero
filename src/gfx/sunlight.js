import { Vector3 } from 'three'
import { AU, BODIES } from '../sim/constants.js'
import { siteDirection } from '../sim/launchsite.js'
import { live } from '../sim/live.js'

/**
 * How the Sun lights the scene, and the one place it stops being a point.
 *
 * Everything in this simulator is lit by a single point light inside the Sun
 * with physical 1/r^2 falloff, which is correct everywhere and useless for
 * shadows. `Sun.jsx` sets out why at length: three unwraps a point light's cube
 * shadow into a 4x2 atlas, so 2048 a face reaching Earth is 146,000 km per
 * texel against a planet 12,742 km wide, and no map size recovers a factor of
 * ten thousand. So there is no shadow map, and the `castShadow` flags on the
 * pads, the hulls and the station have been inert.
 *
 * On the ground that is worth fixing, and the fix is not a second light. Adding
 * a directional light beside the point light would light the pad twice: the
 * point light already delivers the full solar illuminance there. What is right
 * is a **substitution**, and the ground is the one place it is exact.
 *
 * ── why a parallel beam is the same light here ────────────────────────
 *
 * A beam throws away two things, and the honest comparison is against the
 * quantity each one damages rather than against each other.
 *
 * It ignores the Sun's **convergence**. Across the shadow box, 2,400 m wide, the
 * true direction to the Sun differs from its direction at the centre by
 * 1200 / 1.496e11 = 8.0e-9 rad — so a shadow cast from the tallest thing on a
 * pad, 189.5 m, lands 1.5e-6 m from where converging light would put it. A
 * shadow texel is 0.586 m. The error is a part in four hundred thousand of the
 * finest detail the map can hold.
 *
 * It ignores **falloff**. The beam also lights the terrain, which is drawn out to
 * `GROUND_RANGE`, so the relevant span there is 220 km and the illuminance it
 * flattens varies by 2 x 220e3 / 1.496e11 = 3.0e-6 across it.
 *
 * An earlier version of this note compared the convergence angle over the whole
 * 220 km of terrain against a texel's angular size and claimed a factor of a
 * thousand. That was the wrong pairing twice over — the shadow box is 2.4 km, not
 * 220, and what matters is where a shadow *lands* in metres rather than an angle
 * — and the gate caught it at 1.19x. The numbers above are the ones it measures.
 *
 * What is *not* exact is the penumbra. A point light at 1 AU is not a point: the
 * Sun subtends 0.53 degrees, so a tower 190 m tall throws a shadow whose edge is
 * 1.8 m soft at its tip. A directional light throws a hard edge, and three's
 * PCF softening is a filter width in texels rather than an angular diameter, so
 * it does not reproduce that. It is a shadow where there was none, not a correct
 * penumbra, and it is written down here as the former.
 */

/** Illuminance at one astronomical unit, lux. `Sun.jsx`'s point light is this scaled out. */
export const SOLAR_ILLUMINANCE_AT_1AU = 42000 / 120 ** 2

/** Luminous intensity of the point light, candela. Illuminance at r is this over r^2. */
export const SOLAR_INTENSITY = SOLAR_ILLUMINANCE_AT_1AU * AU * AU

/**
 * How close the camera has to be to the pad before the beam takes over, m.
 *
 * The same range `Terrain.jsx` builds its ground at, deliberately: the shadow
 * and the surface it falls on appear together, and there is no band of altitude
 * where one is drawn without the other.
 */
export const GROUND_RANGE = 220e3

/**
 * Half-width of the shadow camera's box, m, and the resolution across it.
 *
 * These two are one decision, and it is a trade with a hard floor under it. What
 * has to fit in the box is not the structures — the widest pad reaches 212 m —
 * but the *shadows*, and a shadow's length is the caster's height over the
 * tangent of the sun's elevation. Kennedy's tower tops out at 189.5 m, so at a
 * 10 degree dawn it throws 1,075 m of shadow and at 5 degrees it throws 2,166.
 *
 * One map cannot hold that and still resolve a lattice member. At 1,200 m and
 * 4,096 texels a texel is 0.586 m on the ground and shadows are complete down to
 * **10.6 degrees of sun elevation** — measured across all four pads by
 * `verify-shadows`, worst case Kennedy. Below that the tip of the tallest
 * shadow leaves the box. Buying the last ten degrees means either a texel of
 * 1.2 m, which stops resolving the tower that is casting, or a second cascade,
 * which is a larger change than this one and is the thing cascades are actually
 * for.
 *
 * The box is also more than `FLAT_RADIUS`, the 400 m Terrain grades flat, so a
 * shadow that runs off the graded apron still lands on the real ground.
 */
export const SHADOW_EXTENT = 1200

/** Shadow map resolution. 4096 across 2 x SHADOW_EXTENT is 0.586 m a texel. */
export const SHADOW_TEXELS = 4096

/** Ground metres a shadow texel covers. Quoted by the gate, not asserted by eye. */
export const SHADOW_TEXEL_METRES = (2 * SHADOW_EXTENT) / SHADOW_TEXELS

/**
 * How far up the sun ray the light sits, m. Only the near and far planes care —
 * a directional light's rays are parallel wherever it is put — so this is chosen
 * to clear the tallest thing on the pad with room, not tuned.
 */
export const SHADOW_DISTANCE = 4000

const R = BODIES.earth.radius
const _up = new Vector3()
const _pad = new Vector3()

/** Where the pad is in the scene right now, which is on a planet that is turning. */
export function padScenePoint(out, site) {
  siteDirection(_up, site, live.sim.t)
  return out.copy(live.pos.earth).addScaledVector(_up, R)
}

/** Illuminance of the point light at a distance, lux — three's own falloff, written out. */
export const illuminanceAt = (distance) => SOLAR_INTENSITY / (distance * distance)

/**
 * The angle the solar direction turns across a patch of ground, and the
 * fractional change in illuminance over it. Both are what the substitution above
 * throws away, and both are exported so a gate can measure them.
 */
export const parallaxOver = (span, distance) => span / distance
export const falloffOver = (span, distance) => (2 * span) / distance

/**
 * Whether the camera is close enough to the pad for the beam to take over.
 *
 * Both `Sun.jsx` and `GroundLight.jsx` ask this, rather than one of them telling
 * the other: two components reading the same pure function of the same state
 * cannot disagree, where a flag written in one frame callback and read in
 * another depends on which order they were registered in. The scratch vector is
 * shared because each caller is done with it before the next one runs.
 */
export function onTheGround(camera, site) {
  padScenePoint(_pad, site)
  return camera.position.distanceToSquared(_pad) < GROUND_RANGE * GROUND_RANGE
}
