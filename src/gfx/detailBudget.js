import { sphereLevel } from './sphereDetail.js'

/**
 * The detail budget: the last lever, spent only when nothing else is left.
 *
 * The resolution governor (`components/Resolution.jsx`) moves device pixels —
 * the visible lever — and stops at a floor, because below it the picture goes
 * soft. A machine that is *still* missing frames at the floor has historically
 * had nowhere further to go; the audit records this as its main remaining
 * risk. But the scene has one more cost the governor never touches:
 * tessellation. Every body's surface is an LOD ladder of spheres
 * (`gfx/sphereDetail.js`) chosen so the silhouette error stays under a third
 * of a drawing-buffer pixel. A rung down that ladder is, by construction,
 * sub-pixel geometry error — invisible on every body at every distance the
 * ladder was built for — and it is real GPU work the fragment-bound frame
 * does not need.
 *
 * So the governor, having exhausted pixels, spends tessellation: one step of
 * distress caps the ladder at 256 segments, a second at 128. It is spent only
 * at the pixel floor (sharpness first, exactly as before), it refunds itself
 * the same way it was spent — the governor only relaxes it once the pixels
 * are back at their ceiling *and* the frames are comfortable — and the
 * Diagnostics panel says so, so a lag report carries what the machine did.
 *
 * Nothing here runs per frame: the cap is read as a plain number where the
 * LOD is chosen, and changes only when the governor makes a decision, which
 * is paced by its 90-frame window.
 */

/**
 * Distress step → the highest sphere level a body may refine to. The ladder
 * is [32, 64, 128, 256, 512]; step 0 is no cap, step 2 pins every body at
 * 128 segments. Ordered, bounded, and small on purpose: this is an emergency
 * spend, not a quality dial, and it is deliberately not exposed as a toggle —
 * the honest manual control for "my machine is slow" is the device retune.
 */
export const DETAIL_STEPS = [4, 3, 2]
export const MAX_DETAIL_STEP = DETAIL_STEPS.length - 1

let step = 0
const listeners = new Set()

/** The current distress step — 0 is full detail. */
export const detailStep = () => step

/** Subscribe to step changes; returns the unsubscribe function. */
export function subscribeDetail(l) {
  listeners.add(l)
  return () => listeners.delete(l)
}

/** The governor's decision, applied. Same-store discipline: emit once. */
export function setDetailStep(next) {
  if (next === step || next < 0 || next > MAX_DETAIL_STEP) return
  step = next
  for (const l of listeners) l()
}

/**
 * The LOD level a body may use, given what its silhouette asks for and what
 * the budget allows. The cap is applied *after* `sphereLevel` and its
 * hysteresis, not as its maximum: the hysteresis would otherwise hold a body
 * at a refinement the budget has withdrawn. Cap changes are governor-paced
 * (a few per minute at most), so the chatter the hysteresis guards against
 * lives on a timescale the cap never touches. Pass `current = -1` to force a
 * fresh selection — that is how a cap change re-aims every body at once.
 */
export function cappedLevel(radiusPixels, current, cap) {
  return Math.min(sphereLevel(radiusPixels, current), cap)
}

/**
 * The policy, pure, so the gate can hold it: one governor window in, the next
 * distress step out. Escalation requires the machine to be slow *and* already
 * at the pixel floor — this budget is the last lever, not the first. Relief
 * requires the machine to be fast *and* the pixels back at their ceiling —
 * the refund is paid only out of comfort, so a machine that stabilises at the
 * floor keeps its refundable debt until it genuinely has room.
 *
 * `slowMs` and `fastMs` are the governor's own thresholds, passed rather than
 * restated: one source of truth for what "too slow" means, one for what to do
 * about it.
 */
export function nextDetailStep(currentStep, meanMs, { atFloor, atCeiling, slowMs, fastMs }) {
  if (meanMs > slowMs) return atFloor ? Math.min(MAX_DETAIL_STEP, currentStep + 1) : currentStep
  if (meanMs < fastMs) return currentStep > 0 && atCeiling ? currentStep - 1 : currentStep
  return currentStep
}
