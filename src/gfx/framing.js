/**
 * Where the camera stands for each mode, and how the wheel moves it.
 *
 * Pure data and pure functions, in metres. Split out of CameraRig for two
 * reasons: a non-component export from a component module disables React Fast
 * Refresh for that whole file, and a table nothing outside the component can
 * read is a table nothing can verify. scripts/verify-navigation.mjs reads this
 * one, so the traversal figures quoted are the ones that ship.
 */
import { AU, BODIES, CRAFT, SHIP } from '../sim/constants.js'

/**
 * How the camera frames each body when it locks on, and how close it may get.
 *
 * The multiples are the ones the exaggerated scene already used — they were
 * always written against each body's rendered radius, so they survived the
 * change to true scale by substitution and the framing is unchanged. Only the
 * outer limits are new numbers, because the old ones were bounded by a scene
 * 120 units wide per AU and had no meaning in metres.
 */
/**
 * How long the vehicle actually is, stage by stage.
 *
 * A staged vehicle is not one object, and the code that draws it already knows:
 * Craft.jsx binds both the mesh and its length to `ship.stage`, so Apollo 8 is
 * a 110.6 m Saturn V on the pad and a 3.47 m capsule at splashdown. Every
 * camera that framed it took `SHIP.visual` instead — which vessels.js derives
 * from stage 0, and which therefore stays the pad stack for the whole flight.
 * The comment on that derivation says as much: consumers that care what is on
 * screen should read the active stage. The cameras were the consumers that did
 * not, and the chase camera stood 464 m off that capsule — 134 of its own
 * lengths, against the 4.4 it stands at liftoff.
 *
 * Held as a Float64Array because the chase camera reads it every frame, and an
 * indexed read is the one form this file can be sure costs nothing.
 */
export const STAGE_LENGTH = Float64Array.from(SHIP.stages.map((s) => s.visual))

/** The same, with the index bounded, for callers outside the frame loop. */
export const stageLength = (stage) =>
  STAGE_LENGTH[Math.min(Math.max(stage | 0, 0), STAGE_LENGTH.length - 1)]

/**
 * How much longer the vehicle is drawn while its engine is lit, in hull
 * lengths.
 *
 * Measured off the placeholder rather than chosen: the hull runs from the
 * command module's apex at +0.51 L to the lip of the engine bell at -0.46 L,
 * and the exhaust cone reaches back to -1.16 L. So a lit vehicle is 1.67 L of
 * object against an unlit 0.97 L, and the extra 0.70 points *at* a camera that
 * sits behind the tail. A loaded glTF hull carries no plume, so on a vehicle
 * wearing one this is a framing choice and not a measurement — still the right
 * one, because a burn is the moment the vehicle stops being the only thing to
 * look at.
 */
export const LIT_REACH = 1.72

/** The drawn extent of the vehicle: its stage, and its exhaust if it is lit. */
export const framedLength = (stage, lit) => stageLength(stage) * (lit ? LIT_REACH : 1)

/** Where the chase camera sits, in lengths of whatever is flying. */
export const CHASE_MULTIPLE = { back: 4.2, up: 1.3 }

/**
 * Where a locked camera stands off a vehicle, and how close it may come, in the
 * same units. The far limit is a distance rather than a multiple: it is how far
 * the mode lets you retreat, which is a property of the scene and not of the
 * hull.
 */
export const VEHICLE_MULTIPLE = { distance: 4.5, min: 1.1 }

/**
 * How far back a drawn path fits in frame, in metres.
 *
 * From the path rather than from the body it orbits: what the map is for is
 * seeing the *orbit*, and a 200 km parking orbit and a translunar coast differ
 * by three decades while the body under them does not change at all. The
 * greatest radius the projection drew, opened out by the vertical field of
 * view, with a margin so the apoapsis is not flush against the edge.
 *
 * `floor` keeps a near-circular low orbit from pulling the camera inside the
 * planet it is drawn around.
 *
 * @param {Float64Array} points xyz per sample, relative to the body
 * @param {number} count samples written
 * @param {number} fovDegrees the camera's vertical field of view
 * @param {number} floor closest the camera may sit, m
 */
export function pathFramingDistance(points, count, fovDegrees, floor) {
  let far = 0
  for (let i = 0; i < count; i++) {
    const o = i * 3
    const r = Math.sqrt(points[o] * points[o] + points[o + 1] * points[o + 1] + points[o + 2] * points[o + 2])
    if (r > far) far = r
  }
  const half = Math.tan(((fovDegrees * 0.5) * Math.PI) / 180)
  return Math.max(floor, (far / Math.max(half, 1e-6)) * FRAMING_MARGIN)
}

/** How much wider than the path itself the map frames. */
export const FRAMING_MARGIN = 1.15

export const FRAMING = {
  sun: { distance: BODIES.sun.radius * 4.6, min: BODIES.sun.radius * 1.35, max: 2 * AU },
  earth: { distance: BODIES.earth.radius * 5.2, min: BODIES.earth.radius * 1.25, max: 4e9 },
  moon: { distance: BODIES.moon.radius * 6.0, min: BODIES.moon.radius * 1.3, max: 4e9 },
  /**
   * The ship as it stands on the pad. What the rig actually uses is
   * `VEHICLE_MULTIPLE` against the stage flying now, because this entry is only
   * the first of five and the last of them is 3% of its length.
   */
  ship: {
    distance: STAGE_LENGTH[0] * VEHICLE_MULTIPLE.distance,
    min: STAGE_LENGTH[0] * VEHICLE_MULTIPLE.min,
    max: 1e9,
  },
  chase: { distance: STAGE_LENGTH[0] * VEHICLE_MULTIPLE.distance, min: 0, max: 0 },
  pad: { distance: 0, min: 0, max: 0 },
  iss: { distance: CRAFT.iss.visual * 4.4, min: CRAFT.iss.visual * 1.2, max: 1e9 },
  hubble: { distance: CRAFT.hubble.visual * 4.4, min: CRAFT.hubble.visual * 1.25, max: 1e9 },
  /** Free flight roams the system: a metre off a hull out to a few AU. */
  free: { distance: 0, min: 1, max: 1e12 },
  /**
   * A planned burn. `distance` is computed per node from how far it sits from
   * the body it is measured against — a burn in low orbit wants a different
   * framing from one at the Moon — so the entry only carries the limits.
   */
  node: { distance: 0, min: 1, max: 4e9 },
  /**
   * The opening shot. Driven entirely by the rig on a fixed path, so there is
   * no orbit radius for these to bound either.
   */
  cinematic: { distance: 0, min: 0, max: 0 },
  /**
   * Fly has no orbit radius to bound — the rig integrates the camera directly
   * and OrbitControls is switched off — so there is nothing for min and max to
   * clamp. Present so the table stays exhaustive over the focus modes.
   */
  fly: { distance: 0, min: 0, max: 0 },
}

/**
 * The chase offset in metres for the vehicle as it stands on the pad, which is
 * what a replay of recorded attitude is measured against. In flight the rig
 * scales `CHASE_MULTIPLE` by the stage on screen instead.
 */
export const CHASE_OFFSET = {
  back: STAGE_LENGTH[0] * CHASE_MULTIPLE.back,
  up: STAGE_LENGTH[0] * CHASE_MULTIPLE.up,
}

/**
 * How many wheel detents it should take to cross a mode's whole zoom range.
 *
 * The tunable is the *count*, not the speed, because OrbitControls' zoom is
 * multiplicative — `radius *= 0.95^zoomSpeed` per tick — so one speed constant
 * gives wildly different traversals for ranges of different width. At the
 * shipped 0.7 it took 173 detents to cross Earth's range and 770 to cross free
 * flight's twelve decades, which is where "zoomed out and stuck" comes from.
 * Deriving the speed per mode from its own range makes every mode take the same
 * number of turns of the wheel.
 *
 *   radius ratio r over n detents at speed z:   r = (1 / 0.95^z)^n
 *   so                                          z = ln(r) / (n * -ln 0.95)
 */
export const ZOOM_DETENTS = 60

/** OrbitControls hard-codes 0.95 as the base of its per-tick factor. */
export const LN_ZOOM_BASE = -Math.log(0.95)

export const zoomSpeedFor = (min, max) =>
  min > 0 && max > min ? Math.log(max / min) / (ZOOM_DETENTS * LN_ZOOM_BASE) : 1

/** Detents actually needed to cross a range at a given speed — the inverse. */
export const detentsToCross = (min, max, speed) =>
  min > 0 && max > min ? Math.log(max / min) / (speed * LN_ZOOM_BASE) : 0

/**
 * One mouse detent, in the `deltaY` a browser reports for it.
 *
 * OrbitControls reads only the *sign* of `deltaY`, so every wheel event is a
 * full tick however small the scroll was. That is fine for a mouse, which emits
 * one event per physical detent, and wrong for a trackpad, which emits a stream
 * of small ones — a single flick would cross six decades. Converting deltaY to
 * detents and scaling `zoomSpeed` per event makes the two devices agree on what
 * a given amount of physical scrolling does.
 */
export const DETENT_DELTA = 100

export function detentsIn(e) {
  const raw = Math.abs(e.deltaY)
  // deltaMode 1 is lines, 2 is pages; browsers pick one per device.
  const detents = e.deltaMode === 1 ? raw / 3 : e.deltaMode === 2 ? raw : raw / DETENT_DELTA
  // A trackpad's smallest tick should still do something, and one violent
  // scroll event should not cross the range.
  return Math.min(Math.max(detents, 0.05), 4)
}
