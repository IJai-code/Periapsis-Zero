/**
 * The shadow rung: the ground beam's map, under the same distress ladder as
 * everything else.
 *
 * `sunlight.js` fixes the ground beam's shadow map at 4,096 texels — the box
 * needs them at a low sun, where a 2,166 m shadow has to stay under a metre
 * of quantisation. That is the right *ceiling*, and it stays the ceiling: but
 * it is also the one always-on per-frame cost in the scene that the
 * resolution governor could never reach. Pixels, tessellation — both had a
 * lever and a floor; the shadow pass ran at full size on a machine that had
 * already spent every other rung and was still missing frames.
 *
 * So the ladder grows a last rung, spent only after tessellation is spent
 * (pixels first, then geometry, then the shadow — the order the eye loses
 * least first). `relief` halves the map to 2,048: the depth pass is a quarter
 * of the fill, the box's texel doubles from 0.53 m to 1.07 m at the widest
 * box, and a pad shadow remains a hard-edged broadcast shadow rather than a
 * smear — the 4,096 number exists to keep a metre-wide I-beam's shadow from
 * aliasing at a dawn sun, and 2,048 keeps it from dissolving. It refunds
 * exactly as the other levers do, out of comfort, at the pixel ceiling.
 *
 * Nothing here runs per frame: the flag is read where the light is built and
 * where `GroundLight` sizes nothing — the pass's cost is the map's area, and
 * the flag changes at most a few times a minute, governor-paced.
 */

let relief = false
const listeners = new Set()

/** Whether the shadow rung is spent. */
export const shadowRelief = () => relief

/** Subscribe to relief changes; returns the unsubscribe function. */
export function subscribeShadowRelief(l) {
  listeners.add(l)
  return () => listeners.delete(l)
}

/** The governor's decision, applied. No-op writes tell nobody. */
export function setShadowRelief(next) {
  const v = Boolean(next)
  if (v === relief) return
  relief = v
  for (const l of listeners) l()
}
