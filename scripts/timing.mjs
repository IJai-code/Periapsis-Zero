/**
 * What a call costs, in milliseconds — warmed, and judged by its median.
 *
 * A timing figure is worth exactly as much as its measurement is repeatable, and
 * the naive version of one is not: a mean over N calls taken at the first
 * opportunity includes the JIT tier-up of the path being measured, and *when*
 * that tier-up lands inside the timed window depends on when the background
 * compile thread runs, which is not deterministic. Measured on 19 September
 * 2026, same machine, back to back, on `verify-horizon`'s two-node plan: the
 * same work read 2.16 ms on one run and 5.84 ms on the next, while the
 * parking-orbit cost beside it sat still at 0.80 against 0.82. The ratio that
 * gate judges read 2.69 on one run and 7.16 on the next against a bar of 4 —
 * which had been reported as a flake three times, and was not one.
 *
 * So: warm the path first, time several short loops, and take the median. The
 * median is what `scripts/allocation.mjs` does over its clean windows and for
 * the same reason — the noise runs both ways, and a mean or a minimum lets one
 * unlucky sample decide. A tier-up landing in one of seven loops cannot move
 * this; one landing in a single ten-call mean moves it by 2.7x.
 *
 * No `gc()` runs inside a timed window, unlike the allocation harness, which
 * forces one *between* its windows. A collection inside one loop is exactly the
 * kind of single-sample accident the median discards, and forcing one would only
 * add what it is trying to remove.
 *
 * ── absolute or relative ──────────────────────────────────────────────
 *
 * Which of those two a check should assert depends on what it is claiming, and
 * the suite has both. Where the claim is that one operation costs about what
 * another does, the measurement is a *ratio* against a baseline loop measured on
 * the same machine, because the machine cancels and a wall clock does not —
 * `verify-horizon`'s two plan costs are judged that way. Where the claim is a
 * real-time budget — "10 ms is 5% of a core at the map's 5 Hz refresh" — an
 * absolute bound is the honest form, and `verify-predict` keeps one. The
 * mistake to avoid is an absolute bound presented as a relative one, or a ratio
 * whose denominator was measured cold.
 *
 * ── where the suite reads a clock ─────────────────────────────────────
 *
 * Audited on 19 September 2026, and this is the whole list:
 *
 *   verify-horizon   3 asserted figures: the parking-orbit cost, and the
 *                    two-node and capped-plan costs as ratios against it
 *   verify-predict   'a projection costs under 10 ms' — absolute, and kept that
 *                    way because a frame budget is what it asserts. It was a
 *                    mean of twenty calls that were the first the process ever
 *                    made down the path: 1.20-1.24 ms over ten fresh processes,
 *                    which is a 3% spread against a 10 ms bar, so it was never
 *                    at risk. Warmed it reads 0.55 ms — the same effect that
 *                    made `verify-horizon` flake, 2.2x of it, sitting in a
 *                    figure that had ten times the headroom to hide it.
 *   verify-all       Date.now() around each gate, printed in the summary and
 *                    asserted nowhere: a slow gate reads as `20 s`, not as fail
 *   verify-nrho-capture / -family / -keeping
 *                    Date.now() around a solve, printed and never asserted
 *
 * Everything else in the suite asserts physics rather than time. The two
 * asserted ones both go through `costOf` below.
 */

/**
 * @param {() => void} run     the call to measure; should do the same work each time
 * @param {object} [o]
 * @param {number} [o.loops]   timed loops to take the median over
 * @param {number} [o.calls]   calls in each loop
 * @param {number} [o.warm]    calls before any of it is timed, so the optimiser
 *                             has settled.
 *
 * Five is enough, and that was measured rather than assumed, because the usual
 * advice is ten to a hundred. Raising this default to fifty moves nothing:
 * `verify-horizon`'s two ratios read 3.06-3.12 and 7.56-7.71 at five, against
 * 3.02-3.11 and 7.69-7.75 at fifty, and `verify-predict` reads 0.55-0.57 at five
 * against 0.55-0.58 at fifty. Both are inside their own run-to-run spread either
 * way, so the extra forty-five calls are gate time that buys no stability. What
 * mattered was the *median*, not the warm-up count.
 * @returns {number} milliseconds a call, the median of `loops` loops
 */
export function costOf(run, { loops = 7, calls = 10, warm = 5 } = {}) {
  for (let i = 0; i < warm; i++) run()
  const runs = new Float64Array(loops)
  for (let r = 0; r < loops; r++) {
    const t0 = performance.now()
    for (let i = 0; i < calls; i++) run()
    runs[r] = (performance.now() - t0) / calls
  }
  // Typed arrays sort numerically, so this is a plain ascending sort of a
  // preallocated buffer — no comparator closure, no array of objects.
  runs.sort()
  return runs[loops >> 1]
}
