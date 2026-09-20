/**
 * How many bytes a call allocates — measured directly.
 *
 * The allocation gates used to read the heap *after* a forced collection: gc(),
 * run the loop, gc(), compare. That measures what was *retained*, and garbage is
 * by definition not retained, so it cannot see the thing the render-loop rule is
 * about. Checked by mutation: a projection made to allocate a fresh object on
 * every sample — some 768,000 objects in the window — passed at 0.02 KB, while
 * one that kept a single object per projection failed at 210 KB. Worse, the
 * blind spot was hiding real garbage: on V8 12.4 `Math.hypot` allocates on every
 * call, and the projection's one hypot per sample cost 1,260 minor collections
 * per 20,000 projections on a gate that reported it clean.
 *
 * So this measures the heap *across* the loop with no collection inside it. A
 * PerformanceObserver counts minor collections; a window that a scavenge lands
 * in is discarded and the next one is made smaller. The answer is the median
 * over clean windows, because the noise runs both ways — code the optimiser
 * emits mid-window reads high, concurrent sweeping finishing mid-window reads
 * low — and a minimum or a mean would let one of them decide.
 *
 * The window has to be long enough to swamp what the measurement itself costs.
 * A no-op read 53 B a call over 64-call windows and 0.5 B over 512: roughly
 * 3 KB of fixed overhead per window at worst, which at 64 calls is louder than
 * most of what is being looked for. Cheap calls use tens of thousands a window;
 * a projection, which takes a millisecond, uses hundreds.
 *
 * ── what a result means ────────────────────────────────────────────────
 *
 * It returns a *sample*, and a sample can fail to exist in two different ways:
 * the process was not started with `--expose-gc`, so the heap cannot be read
 * across the loop at all; or no window came out clean, so every one of them
 * caught a scavenge and the reading would be meaningless. Both used to arrive as
 * something a caller could mistake for a measurement — the first as `null`, the
 * second as `Infinity` — and nine gates handle them nine different ways. Several
 * printed `.bytes.toFixed()` and threw a TypeError; the rest tested `!sample ||
 * sample.bytes < limit`, where a missing measurement is *falsy* and therefore
 * **passes**. That is the exact failure the paragraph above describes: a gate
 * that has quietly gone blind reporting green.
 *
 * So neither state is a number any more. Every result carries `measured`, and
 * `bytes` is NaN when it is false, and the helpers below are the only supported
 * way to turn one into a verdict:
 *
 *   seesAllocation(label, control)          the harness could have seen garbage
 *   allocatesNothing(label, sample, limit)  and it saw under `limit`
 *
 * Both **fail** when the sample does not exist, and say in the label why. A gate
 * that cannot measure must not pass; it must go red and name the cause. The
 * suite supplies `--expose-gc` to every gate that needs it (`GATES` in
 * verify-all.mjs), so a flagless run going red is the misconfiguration surfacing
 * rather than a false accusation — which is the whole point.
 *
 * Verified on 19 September 2026 against the two `verify-horizon` failures that
 * had been reported as a flake. Neither one was here. The two that threw a
 * TypeError were the gate started without `--expose-gc` by hand, which crashed
 * on a null sample rather than skipping as this docstring used to claim; the
 * one that failed inside the suite failed a wall-clock ratio, and was fixed in
 * `costOf()` there. What this file did own is the reason a missing sample was
 * invisible: 235 B, 209 B and a 56 B control reproduce exactly, run to run.
 */
import { PerformanceObserver, constants } from 'node:perf_hooks'

const MINOR = constants.NODE_PERFORMANCE_GC_MINOR
const tick = () => new Promise((resolve) => setImmediate(resolve))

/**
 * A sample that does not exist.
 * @param {string} why  what stopped the measurement, in a sentence a gate can print
 */
export function unmeasured(why) {
  return { bytes: NaN, windows: 0, calls: 0, measured: false, why }
}

/**
 * @param {() => void} fn  the call to measure; should do the same work each time
 * @param {object} [o]
 * @param {number} [o.calls]     calls per window, before any shrinking
 * @param {number} [o.warm]      calls first, so the optimiser has settled
 * @param {number} [o.windows]   clean windows to take the median over
 * @param {number} [o.minCalls]  floor for the shrink; see below
 * @returns {Promise<{bytes: number, windows: number, calls: number, measured: boolean, why: string}>}
 */
export async function bytesPerCall(fn, { calls = 4096, warm = 4000, windows = 7, minCalls = 64 } = {}) {
  const gc = globalThis.gc
  if (!gc) return unmeasured('no --expose-gc, so the heap cannot be read across the loop')

  for (let i = 0; i < warm; i++) fn()

  let scavenges = 0
  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) if (entry.detail?.kind === MINOR) scavenges++
  })
  observer.observe({ entryTypes: ['gc'] })

  const samples = []
  const attempts = windows * 4
  const floor = Math.min(minCalls, calls)
  let n = calls
  for (let attempt = 0; attempt < attempts && samples.length < windows; attempt++) {
    gc()
    gc()
    await tick()
    await tick()
    scavenges = 0
    const before = process.memoryUsage().heapUsed
    for (let i = 0; i < n; i++) fn()
    const after = process.memoryUsage().heapUsed
    await tick()
    await tick()
    if (scavenges === 0) samples.push((after - before) / n)
    else n = Math.max(floor, n >> 1)
  }
  observer.disconnect()

  if (samples.length === 0) {
    return unmeasured(
      `no clean window in ${attempts} attempts of ${n} calls: a scavenge landed in every one,` +
        ' so the heap could not be read across the loop',
    )
  }
  samples.sort((a, b) => a - b)
  return {
    bytes: samples[samples.length >> 1],
    windows: samples.length,
    calls: n,
    measured: true,
    why: '',
  }
}

/**
 * The shrink stops at 64 calls rather than going to 1.
 *
 * It used to halve all the way down. A window of one call still carries the
 * handful of kilobytes the measurement itself costs — `process.memoryUsage()`
 * is called either side of the loop and returns a fresh object each time — so a
 * loaded machine that scavenged its way down to a one-call window would report
 * that overhead as the per-call cost and fail a call that allocates nothing.
 * Stopping at 64 keeps the reading about the call; if even that is too short to
 * come out clean, the honest answer is that the measurement failed, not that the
 * code allocates three kilobytes.
 */

/**
 * A call that certainly allocates, measured the same way.
 *
 * Every gate that relies on `bytesPerCall` reading zero should also prove, in
 * its own process, that it could have read something else — otherwise a
 * measurement that has quietly gone blind (an observer that stopped reporting,
 * a flag that went missing) passes everything, which is exactly how the old
 * heap-after-GC gates survived. The object escapes into a ring the size of a
 * few frames, so no engine can optimise it away and nothing is retained for
 * long: it is garbage, the thing being looked for. Any object is at least 12
 * bytes on a pointer-compressed V8.
 */
const _ring = new Array(16).fill(null)
let _slot = 0
export function knownAllocation() {
  return bytesPerCall(
    () => {
      _ring[_slot] = { slot: _slot, half: _slot * 0.5 }
      _slot = (_slot + 1) & 15
    },
    { calls: 20000, warm: 20000 },
  )
}

/** Smallest thing an allocation can be, bytes. The control must read at least this. */
export const SMALLEST_OBJECT = 12

/**
 * A measurement, in words, for a gate's own log.
 *
 * One formatter rather than the nine that grew here: five of them called
 * `.bytes.toFixed()` on a sample that could be absent and four printed
 * 'skipped' or 'n/a' for the same condition, so the same failure to measure read
 * as a number in one gate and as prose in another.
 */
export function sampleText(sample) {
  return sample.measured
    ? `${sample.bytes.toFixed(2)} B over ${sample.windows} windows of ${sample.calls}`
    : `not measured — ${sample.why}`
}

/**
 * The harness proved it can see an allocation.
 *
 * Absence fails: a control that was never taken cannot show the measurement
 * works, and this check exists only to say that it does.
 */
export function seesAllocation(label, control) {
  return [
    control.measured ? label : `${label} — ${control.why}`,
    control.measured && control.bytes >= SMALLEST_OBJECT,
  ]
}

/**
 * And the call under test allocated under `limit` — or nothing was measured.
 *
 * The label grows the reason, so a red gate reads "the mix allocates nothing —
 * no clean window in 28 attempts…" rather than accusing the mix.
 */
export function allocatesNothing(label, sample, limit) {
  return [
    sample.measured ? label : `${label} — ${sample.why}`,
    sample.measured && sample.bytes < limit,
  ]
}
