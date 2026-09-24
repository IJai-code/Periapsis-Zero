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
 * The largest half-width the shadow box is allowed to take, m.
 *
 * What has to fit in the box is not the structures — the widest pad reaches
 * 212 m — but the *shadows*, and a shadow's length is the caster's height over
 * the tangent of the sun's elevation. Kennedy's tower tops out at 189.5 m, so at
 * a 10 degree dawn it throws 1,013 m of shadow and at 5 degrees it throws 2,166.
 *
 * This used to be the box's fixed size, and that is the thing that changed.
 *
 * ── why the box is not centred on the pad ─────────────────────────────
 *
 * It was, and that was costing a factor of two for nothing. Shadows do not
 * surround a pad; they fall in one direction, away from the Sun, which is a
 * direction this simulator already knows every frame. A box centred on the pad
 * has to be `reach + cast` wide to hold them; one slid half a shadow's length
 * down the sun azimuth only has to be `reach + cast/2` — the same geometry in
 * half the width, so every texel is worth twice the ground.
 *
 * ── and why it is sized per frame rather than once ────────────────────
 *
 * Because `cast` is a function of the sun's elevation, and sizing for the worst
 * elevation means paying for it at every other one. Sized to the shadow being
 * cast, the same 4,096 texels give:
 *
 *   sun 23.7 deg and above    0.195 m a texel
 *   sun 10.6 deg              0.337 m      (where the fixed box gave 0.586)
 *   sun  7.0 deg              0.467 m
 *   sun  5.3 deg              the cap, 0.586 m — and below it the tip leaves
 *
 * So the old figure, 0.586 m, is the worst case now rather than the only case,
 * and the elevation at which shadows stop being whole goes from **10.6 degrees
 * to 5.3**. `verify-shadows` measures all of it, across the four pads.
 *
 * Cascades would do better still — sharp near *and* far at once, where this is
 * sharp only when the sun is high — and `verify-csm` carries that measurement:
 * three cascades split at 473/1021/2200 m give 0.195/0.421/0.908 m a texel. What
 * they cost is three 4096-square maps instead of one. three allocates a shadow
 * map as an RGBA8 render target with a depth buffer, so that is 300-400 MB of
 * GPU memory on a public web page against 100-134 MB now, and every lit material
 * in the scene has to be patched or it is silently lit N times over. That is the
 * trade, and it was not taken.
 *
 * The cap is also more than `FLAT_RADIUS`, the 400 m Terrain grades flat, so a
 * shadow that runs off the graded apron still lands on the real ground.
 */
const CAP = 1200

/**
 * The cap, under its public name.
 *
 * Two names for one literal, and the second one is not redundant. `CAP` is what
 * `shadowExtentFor` reads, and it has to be the module-local binding rather than
 * the exported one: measured, reading `SHADOW_EXTENT` inside that function costs
 * **16.62 bytes a call** and reading `CAP` costs **0.83**, on identical
 * arithmetic, repeatably. An `export const` is a module cell that V8 will not
 * fold into the function the way it folds a plain local, so the returned value
 * stops being a raw double and gets boxed.
 *
 * Several likelier-looking culprits were tried first and were all wrong: the
 * mixed Smi/double return that the plume hit, `Math.min` in place of the
 * ternary, and nudging the cap off an integer. Those measured 31.86 B — worse
 * than the thing being fixed. The literal appears once and the export is an
 * alias of it, so nothing can drift.
 */
export const SHADOW_EXTENT = CAP

/** Shadow map resolution. 4096 across 2 x SHADOW_EXTENT is 0.586 m a texel. */
export const SHADOW_TEXELS = 4096

/**
 * Ground metres a texel covers at the cap — the *worst* the box ever resolves.
 *
 * Kept under its old name and its old value because that is what it still means:
 * the figure to quote when saying what this shadow map is guaranteed to do. What
 * it no longer is, is the only value — `shadowTexel` is the live one.
 */
export const SHADOW_TEXEL_METRES = (2 * SHADOW_EXTENT) / SHADOW_TEXELS

/** Ground metres a texel covers for a given half-extent. */
export const shadowTexel = (extent) => (2 * extent) / SHADOW_TEXELS

/**
 * The half-width the box needs for a pad's own geometry at this sun elevation.
 *
 * `sinElevation` is the sine of the Sun's angle above the local horizontal,
 * which is `sunDir . up` at the pad and needs no trigonometry to obtain. A sun
 * at or below the horizon casts no shadow worth sizing for, so it takes the cap
 * rather than dividing by nothing.
 */
export function shadowExtentFor(reach, top, sinElevation) {
  if (!(sinElevation > 0)) return CAP
  const cosEl = Math.sqrt(1 - sinElevation * sinElevation)
  const want = reach + 0.5 * ((top * cosEl) / sinElevation)
  return want < CAP ? want : CAP
}

/**
 * How far the box's centre slides from the pad, along the ground, away from the
 * Sun. It is whatever width is left once the structures are held — half the
 * shadow when that fits, and as much of it as the cap allows when it does not.
 */
export const shadowOffsetFor = (reach, extent) => extent - reach

/**
 * The lowest sun elevation at which a pad's longest shadow is still whole, rad.
 *
 * The inverse of the sizing above at the cap, so the two cannot disagree: at the
 * cap the box holds 2 (SHADOW_EXTENT - reach) of shadow, and this is the
 * elevation that casts exactly that.
 */
export function shadowFloorFor(reach, top) {
  return Math.atan2(top, 2 * (SHADOW_EXTENT - reach))
}

/**
 * How far up the sun ray the light sits, m. Only the near and far planes care —
 * a directional light's rays are parallel wherever it is put — so this is chosen
 * to clear the tallest thing on the pad with room, not tuned.
 */
export const SHADOW_DISTANCE = 4000

const R = BODIES.earth.radius
const R_MOON = BODIES.moon.radius
const _up = new Vector3()
const _pad = new Vector3()

/** Where the pad is in the scene right now, which is on a planet that is turning — or a moon. */
export function padScenePoint(out, site) {
  siteDirection(_up, site, live.sim.t)
  if (site.body === 'moon') return out.copy(live.pos.moon).addScaledVector(_up, R_MOON)
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
