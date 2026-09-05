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
export const FRAMING = {
  sun: { distance: BODIES.sun.radius * 4.6, min: BODIES.sun.radius * 1.35, max: 2 * AU },
  earth: { distance: BODIES.earth.radius * 5.2, min: BODIES.earth.radius * 1.25, max: 4e9 },
  moon: { distance: BODIES.moon.radius * 6.0, min: BODIES.moon.radius * 1.3, max: 4e9 },
  ship: { distance: SHIP.visual * 4.5, min: SHIP.visual * 1.1, max: 1e9 },
  chase: { distance: SHIP.visual * 4.5, min: 0, max: 0 },
  pad: { distance: 0, min: 0, max: 0 },
  iss: { distance: CRAFT.iss.visual * 4.4, min: CRAFT.iss.visual * 1.2, max: 1e9 },
  hubble: { distance: CRAFT.hubble.visual * 4.4, min: CRAFT.hubble.visual * 1.25, max: 1e9 },
  /** Free flight roams the system: a metre off a hull out to a few AU. */
  free: { distance: 0, min: 1, max: 1e12 },
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

/** Where the chase camera sits, in the craft's own body frame. Metres. */
export const CHASE_OFFSET = { back: SHIP.visual * 4.2, up: SHIP.visual * 1.3 }

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
