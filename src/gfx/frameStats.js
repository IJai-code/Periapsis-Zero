/**
 * One sampler for frame times, and the summary a report asks of it.
 *
 * Diagnostics used to run its own `requestAnimationFrame` loop to measure
 * what the browser was delivering — a second frame loop, beside the render
 * loop and the governor, each with its own opinion of the same frames. This
 * ring replaces that: `Resolution` already computes every frame's delta to
 * steer the pixel ratio, so it pushes the same number here — two typed-array
 * writes, nothing allocated — and the report reads the summary when it is
 * rendered, once a second at most. One measurement, one place.
 *
 * The buffer is fixed at 512 samples by design: about eight seconds of a
 * 60 Hz machine, long enough to carry a phase transition's worth of texture
 * and short enough that the p95 answers "how does this machine feel *now*".
 * The array is never resized, never copied on the frame path, and wraps.
 */

const CAPACITY = 512

/**
 * What "slow" and "fast" mean, in milliseconds, for everything that spends a
 * frame's slack.
 *
 * They live here, beside the samples, because more than one thing now asks
 * the same question of them — the resolution governor moves pixels on these
 * thresholds, the detail budget spends tessellation on them, and the sky's
 * progressive march spends tiles on them — and three private copies of a
 * number this load-bearing is three chances to disagree.
 *
 * They sit either side of *one refresh* rather than around some frame rate to
 * aim at, because the signal is `requestAnimationFrame` and that is quantised
 * to the display: a machine that misses every other frame reports 33 ms,
 * never 20. A threshold between the two steps quantities that do not exist,
 * and the first pair tried — 26 and 18.5 — sat inside the gap and parked a
 * Retina Mac at thirty frames a second when it could hold sixty two steps
 * lower down.
 */
export const SLOW_MS = 21
export const FAST_MS = 17.2

const ring = new Float32Array(CAPACITY)
let count = 0
let head = 0

/** Record one frame's wall-clock delta, ms. Ignores nothing: gaps are honest. */
export function pushFrameTime(ms) {
  ring[head] = ms
  head = (head + 1) % CAPACITY
  if (count < CAPACITY) count++
}

/** Frames currently held (0…512). */
export const frameCount = () => count

/**
 * The summary, computed on demand. This sorts — 512 numbers, microseconds —
 * but it is called from UI render paths, never from the frame loop, so the
 * allocation is a report cost and not a sim cost.
 *
 * Samples above `cutMs` are excluded rather than clamped: a tab that slept,
 * a breakpoint, a photograph's settle — a 40-second gap is not a slow frame,
 * it is no frame, and averaging it in would flatter the machine.
 */
export function summarizeFrameTimes(cutMs = 2000) {
  const n = count
  if (n === 0) return null
  const samples = new Float32Array(n)
  let kept = 0
  for (let i = 0; i < n; i++) {
    const v = ring[(head - 1 - i + CAPACITY * 2) % CAPACITY]
    if (v > 0 && v <= cutMs) samples[kept++] = v
  }
  if (kept === 0) return null
  const keptView = samples.subarray(0, kept)
  keptView.sort()
  const at = (q) => keptView[Math.min(kept - 1, Math.floor(q * (kept - 1)))]
  const p50 = at(0.5)
  const p95 = at(0.95)
  return { p50, p95, fps: p50 > 0 ? Math.round(1000 / p50) : 0, kept }
}

/**
 * The mean of the last `n` frames — of however many there are, when fewer
 * have been seen — and 0 when the ring is empty, which a caller must read as
 * "nothing measured yet" and not as "instant frames".
 *
 * Unlike `summarizeFrameTimes` this allocates nothing and does not sort, so
 * it is safe on the frame path — which is where a decision about how much
 * work to do *this* frame has to be made. A short window on purpose: this
 * answers "is there room right now", not "how does this machine feel".
 */
export function recentFrameMean(n = 30) {
  const k = Math.min(n, count)
  if (k === 0) return 0
  let sum = 0
  for (let i = 0; i < k; i++) sum += ring[(head - 1 - i + CAPACITY * 2) % CAPACITY]
  return sum / k
}

/** Forget everything — the tab woke up, the scene changed; start over. */
export function resetFrameTimes() {
  count = 0
  head = 0
}
