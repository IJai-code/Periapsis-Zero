import { hearing, HEARING_MAX_DELAY } from './engine.js'
import { live } from '../sim/live.js'
import { STAND_OFF } from '../gfx/groundView.js'

/**
 * Where the ear is: the travel time and the spreading of the sound from the
 * vehicle to a camera standing on the ground.
 *
 * Written into `hearing` (see `sfx/engine.js`) once a frame by the audio
 * component, and followed by the graph's delay line and gain. Only a camera
 * that stands in the air on the ground — the pad's remote camera and its
 * tracking camera — hears the vehicle from a distance; a view riding the
 * vehicle hears it as it always did, and the Moon has no air to carry anything.
 *
 * Allocation-free, and it reads its delta from a typed slot rather than an
 * argument: a double handed to a function V8 does not inline is boxed at the
 * call, and this runs every frame.
 */

/** The speed of sound in the ISA sea-level atmosphere, m/s — where every ground camera stands. */
export const SOUND_SPEED = 340.29

/**
 * The range the mix is heard at full level from, m: the ground camera's own
 * stand-off, which is the distance the pad sound was tuned at. Closer is held
 * at full rather than made louder than the mix was ever set for.
 */
export const REFERENCE_RANGE = STAND_OFF

/** `[0]` range last frame, m. `[1]` the smoothed rate it opens at, m/s. `[2]` this frame's delta, s. */
export const listenerState = new Float64Array(3)

/**
 * The listener for this frame. `position` is the camera's, in the same frame
 * as `live.pos`; `focus` the camera mode; `lunar` whether the vessel stands on
 * the Moon. Set `listenerState[2]` to the frame's delta first — zero while
 * paused, so a held frame does not read as a vehicle standing still.
 */
export function listen(position, focus, lunar) {
  if ((focus !== 'ground' && focus !== 'pad') || lunar) {
    hearing[0] = 0
    hearing[1] = 1
    listenerState[0] = 0
    return
  }
  const delta = listenerState[2]
  const p = live.pos.ship
  const dx = p.x - position.x
  const dy = p.y - position.y
  const dz = p.z - position.z
  const r = Math.sqrt(dx * dx + dy * dy + dz * dz)
  // The rate the range opens at, frame to frame, lightly smoothed: the Doppler
  // is in how the delay changes, so the delay has to change smoothly.
  const rate = listenerState[0] > 0 && delta > 0 ? (r - listenerState[0]) / delta : 0
  if (delta > 0) listenerState[1] += (rate - listenerState[1]) * 0.2
  listenerState[0] = r
  /*
   * The retarded delay, r / (c + v): the time since the sound now arriving
   * left the vehicle, for a source receding at v. Its rate of change is
   * v / (c + v), so a delay line driven by it plays at c / (c + v) of the
   * pitch — the Doppler shift of a receding source, exactly. The speed is held
   * above minus half c so a vehicle coming at the camera cannot ask for an
   * infinite delay.
   */
  const v = listenerState[1] > -0.5 * SOUND_SPEED ? listenerState[1] : -0.5 * SOUND_SPEED
  const delay = r / (SOUND_SPEED + v)
  hearing[0] = delay < HEARING_MAX_DELAY ? delay : HEARING_MAX_DELAY
  // Spherical spreading: pressure falls as one over the range.
  hearing[1] = r > REFERENCE_RANGE ? REFERENCE_RANGE / r : 1
}
