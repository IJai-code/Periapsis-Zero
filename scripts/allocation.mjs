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
 * Requires --expose-gc; returns null without it, and callers skip the gate.
 */
import { PerformanceObserver, constants } from 'node:perf_hooks'

const MINOR = constants.NODE_PERFORMANCE_GC_MINOR
const tick = () => new Promise((resolve) => setImmediate(resolve))

/**
 * @param {() => void} fn  the call to measure; should do the same work each time
 * @param {object} [o]
 * @param {number} [o.calls]     calls per window, before any shrinking
 * @param {number} [o.warm]      calls first, so the optimiser has settled
 * @param {number} [o.windows]   clean windows to take the median over
 * @returns {Promise<{bytes: number, windows: number, calls: number} | null>}
 */
export async function bytesPerCall(fn, { calls = 4096, warm = 4000, windows = 7 } = {}) {
  const gc = globalThis.gc
  if (!gc) return null

  for (let i = 0; i < warm; i++) fn()

  let scavenges = 0
  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) if (entry.detail?.kind === MINOR) scavenges++
  })
  observer.observe({ entryTypes: ['gc'] })

  const samples = []
  let n = calls
  for (let attempt = 0; attempt < windows * 4 && samples.length < windows; attempt++) {
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
    else n = Math.max(1, n >> 1)
  }
  observer.disconnect()

  if (samples.length === 0) return { bytes: Infinity, windows: 0, calls: n }
  samples.sort((a, b) => a - b)
  return { bytes: samples[samples.length >> 1], windows: samples.length, calls: n }
}

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
