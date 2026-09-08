/**
 * The arithmetic behind the manoeuvre-node gizmo.
 *
 * Kept out of the component because all of it is testable without a canvas and
 * none of it is obvious: turning a click on a drawn polyline back into an
 * instant, turning a drag in pixels into metres per second, and sizing a widget
 * that has to stay grabbable whether it is orbiting Earth or sitting 400,000 km
 * away. scripts/verify-gizmo.mjs runs the round trip through the real Line2
 * raycaster rather than a reimplementation of it.
 */
import { Vector3 } from 'three'
import { SAMPLES } from '../sim/predict.js'

/**
 * The six handles, in the frame nodes are written in.
 *
 * Colours are the navball's, because that is where the pilot already reads
 * these directions: prograde/retrograde yellow, normal/antinormal violet,
 * radial cyan. A gizmo that used Blender's red-green-blue axes would be asking
 * the pilot to hold two vocabularies for one set of directions.
 */
export const HANDLES = [
  { id: 'prograde', axis: 'prograde', sign: 1, color: '#f5e663', label: 'Prograde' },
  { id: 'retrograde', axis: 'prograde', sign: -1, color: '#f5e663', label: 'Retrograde' },
  { id: 'normal', axis: 'normal', sign: 1, color: '#c98bff', label: 'Normal' },
  { id: 'antinormal', axis: 'normal', sign: -1, color: '#c98bff', label: 'Antinormal' },
  { id: 'radialOut', axis: 'radial', sign: 1, color: '#5ce1f2', label: 'Radial out' },
  { id: 'radialIn', axis: 'radial', sign: -1, color: '#5ce1f2', label: 'Radial in' },
]

/** Radius of the gizmo's handles from its centre, in screen pixels. */
export const GIZMO_RADIUS_PX = 88
/** Grab radius around a handle, in screen pixels. Larger than it is drawn. */
export const HANDLE_GRAB_PX = 22
/** Grab radius around the centre ball, which scrubs the node in time. */
export const CENTRE_GRAB_PX = 18

/**
 * How far out a handle must project before it can be grabbed, in pixels.
 *
 * An axis pointing at the camera has almost no length on screen. Prograde is
 * the one that does it constantly, because the natural way to look at a
 * trajectory is along it: measured head-on, the prograde and retrograde handles
 * landed 6 and 7 pixels from the node's centre, inside each other's grab radius
 * and inside the centre ball's, so a press meant for the time scrub would take
 * whichever of the two the sort happened to reach first — and the direction to
 * drag in was decided by sub-pixel noise.
 *
 * Below this a handle is drawn as a ghost and refuses to be picked. The number
 * is the centre ball's grab radius plus most of a handle's, so a disabled
 * handle is one that genuinely cannot be told apart from the thing beneath it,
 * and the dead cone it implies is asin(32/88) — about 21 degrees either side of
 * the axis. The way out is to orbit the camera a little, or to type the number
 * into the panel, which is why the panel carries the same three components
 * rather than a summary of them.
 */
export const HANDLE_MIN_SPREAD_PX = 32
/** Pick tolerance either side of the drawn trajectory, in screen pixels. */
export const LINE_GRAB_PX = 14

/**
 * Drag sensitivity, as a fraction of the craft's orbital speed spent across one
 * nominal drag.
 *
 * The alternative — a fixed number of metres per second per pixel — has to be
 * wrong somewhere, because the burns this thing plans span three decades: an
 * RCS trim is 2 m/s and a translunar injection is 3,100. Scaling to the speed
 * the craft is *actually* travelling at makes one setting fit both, and it
 * degrades in the right direction: burns in a slow lunar orbit are smaller
 * burns, and the handle gets correspondingly finer there without being told to.
 *
 * At a 7.66 km/s parking orbit this is 3.8 m/s per pixel, so a 600 px pull is
 * about 2,300 m/s — a TLI in one gesture — and the fine modifier turns the same
 * gesture into 115 m/s.
 */
export const DRAG_SPAN_PIXELS = 600
export const DRAG_SPAN_FRACTION = 0.3
/** Below this the gain would collapse; a craft at rest still needs a usable handle. */
export const DRAG_SPEED_FLOOR = 50

export const MODIFIERS = { fine: 0.05, normal: 1, coarse: 8 }

/** Which modifier a keyboard state asks for. */
export function modifierFrom(event) {
  if (event.shiftKey) return MODIFIERS.fine
  if (event.ctrlKey || event.metaKey || event.altKey) return MODIFIERS.coarse
  return MODIFIERS.normal
}

/** Metres per second per pixel of drag. */
export function gainFor(speed, modifier = 1) {
  const v = Math.max(Number.isFinite(speed) ? Math.abs(speed) : 0, DRAG_SPEED_FLOOR)
  return ((v * DRAG_SPAN_FRACTION) / DRAG_SPAN_PIXELS) * modifier
}

const _a = new Vector3()
const _b = new Vector3()

/**
 * Where a world-space direction points on screen, and how long a metre of it is
 * there.
 *
 * Written as a finite difference through the camera's own projection rather
 * than by hand, so it stays correct for whatever the camera is doing —
 * including the logarithmic depth buffer, which changes what `project` returns
 * in z and is irrelevant to the two components used here.
 *
 * The probe length is proportional to the distance being probed. A fixed 1 m
 * step against a node 400,000 km away is a relative displacement of 2.5e-9,
 * which float64 carries to seven digits — survivable, but there is no reason to
 * spend the precision when the derivative is scale-free.
 *
 * @param {{set:Function}} out2 receives the unit screen direction, y down
 * @returns {number} pixels per metre along the axis, or 0 if degenerate
 */
export function screenAxis(out2, worldPos, worldDir, camera, width, height) {
  const distance = _a.copy(worldPos).sub(camera.position).length()
  const probe = Math.max(distance * 1e-3, 1e-6)

  _a.copy(worldPos).project(camera)
  _b.copy(worldPos).addScaledVector(worldDir, probe).project(camera)

  const dx = (_b.x - _a.x) * width * 0.5
  // NDC y runs up, pixels run down.
  const dy = -(_b.y - _a.y) * height * 0.5
  const len = Math.hypot(dx, dy)
  if (!Number.isFinite(len) || len < 1e-12) {
    out2.set(0, 0)
    return 0
  }
  out2.set(dx / len, dy / len)
  return len / probe
}

const _fwd = new Vector3()

/**
 * How far in front of the camera a point is — along the view axis, not from the
 * lens.
 *
 * The distinction is the whole reason this is a function. A perspective camera
 * divides by view-space depth, so that is what sets a point's screen size;
 * radial distance to the camera is longer by 1/cos of the off-axis angle, which
 * is 3% a quarter of the way out from the centre of the frame and 22% in the
 * corner. Sizing a control by radial distance makes it silently swell as it
 * drifts off-axis.
 */
export function viewDepth(worldPos, camera) {
  _fwd.set(0, 0, -1).applyQuaternion(camera.quaternion)
  return _a.copy(worldPos).sub(camera.position).dot(_fwd)
}

/**
 * World size of something that should occupy a fixed number of pixels.
 *
 * The gizmo has no business having a size in metres: it is a control, and a
 * control that shrinks to a pixel when you zoom out is not one. Everything
 * about it — handle spacing, grab radius, the arrows themselves — is specified
 * in pixels and converted here.
 *
 * `depth` is view-space depth, from `viewDepth`.
 */
export function pixelsToWorld(pixels, depth, fovDegrees, viewportHeight) {
  const halfHeight = Math.tan((fovDegrees * 0.5 * Math.PI) / 180) * Math.max(depth, 1e-6)
  return (pixels * 2 * halfHeight) / Math.max(viewportHeight, 1)
}

/**
 * The Line2 raycaster's pick tolerance, given a grab radius in pixels.
 *
 * It tests `screenGap < (linewidth + threshold) / 2`, so the threshold is the
 * slack *added to the drawn width* — a trajectory drawn 1.4 px wide would
 * otherwise only be grabbable within 0.7 px of its centre, which on a trackpad
 * is not grabbable at all.
 */
export function lineThreshold(linewidth, grabPixels = LINE_GRAB_PX) {
  return Math.max(0, grabPixels * 2 - linewidth)
}

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x)

/**
 * How far along segment `i` of a projection a point lies, as a fraction.
 *
 * `points` is reference-relative, so the caller has to subtract the trajectory
 * group's world position first — the polyline is parented to the body it orbits
 * and is not in world coordinates.
 */
export function paramOnSegment(points, i, x, y, z) {
  const o = i * 3
  const ax = points[o]
  const ay = points[o + 1]
  const az = points[o + 2]
  const bx = points[o + 3] - ax
  const by = points[o + 4] - ay
  const bz = points[o + 5] - az
  const len2 = bx * bx + by * by + bz * bz
  if (len2 <= 0) return 0
  return clamp01(((x - ax) * bx + (y - ay) * by + (z - az) * bz) / len2)
}

/**
 * The instant a hit on the drawn polyline corresponds to, in seconds from now.
 *
 * Sub-sample, not snapped. Samples are uniform in time by construction — the
 * projection writes `times[i] = i * dt` — so the interpolation is exact rather
 * than an approximation of an uneven spacing. Snapping to the nearer sample
 * instead would quantise a node to 10.8 s on a low orbit, which is about 80 km
 * of arc, and a burn placed 80 km from the apsis it was aimed at is a
 * measurably different orbit.
 */
export function epochOnSegment(projection, segment, param) {
  const last = Math.max(0, Math.min(projection.count, SAMPLES) - 2)
  const i = Math.max(0, Math.min(segment, last))
  const dt = projection.span / (SAMPLES - 1)
  return (i + clamp01(param)) * dt
}

/**
 * How close two candidates must be on screen before continuity decides, px.
 *
 * Beyond this the pointer is plainly nearer one of them and that is the answer;
 * within it the drawn line is crossing itself and the pixel says nothing.
 */
export const CROSSING_PX = 3

/**
 * Which of several polyline hits a pointer at (px, py) means.
 *
 * Two rules, in order, and the order is the whole lesson. *Which pixel is
 * nearest* comes first, because that is what the pilot is pointing at.
 * *Which continues the gesture* comes second, and only among candidates the
 * pointer cannot distinguish — that is, at a genuine screen crossing, where a
 * trajectory seen near edge-on lays the far side of the orbit over the near
 * side and the pixel alone would teleport the node across half a revolution.
 *
 * Continuity first was the first attempt and it was wrong in a way that looked
 * almost right: a scrub tracked the pointer but lagged behind it, settling on
 * whichever end of the tolerance band lay nearest to where the node already
 * was. Dragged from sample 32 to sample 96 it stopped at 82 and stayed there,
 * because every step preferred the trailing edge of its own grab radius.
 *
 * @param {Float64Array} epochs candidate times, seconds from now
 * @param {Float64Array} gaps   how far each sits from the pointer, px
 * @param {number} count        candidates written
 * @param {number|null} previous where the gesture already is, or null
 * @returns {number} index of the chosen candidate, or -1
 */
export function chooseEpoch(epochs, gaps, count, previous = null) {
  let best = -1
  let nearest = Infinity
  for (let i = 0; i < count; i++) {
    if (gaps[i] < nearest) {
      nearest = gaps[i]
      best = i
    }
  }
  if (best < 0 || previous === null) return best

  let winner = best
  let closest = Math.abs(epochs[best] - previous)
  for (let i = 0; i < count; i++) {
    if (gaps[i] > nearest + CROSSING_PX) continue
    const d = Math.abs(epochs[i] - previous)
    if (d < closest) {
      closest = d
      winner = i
    }
  }
  return winner
}
