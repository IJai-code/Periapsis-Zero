/**
 * The time-warp ladder, and names for its rungs.
 *
 * Kept out of the store so headless scripts can read it without pulling in
 * React, and so there is one ladder rather than the store's and a copy in the
 * flight harness that could drift apart.
 *
 * **Levels are addressed by name, never by position.** `warp` is stored as an
 * index, and that index is written in some forty places — every phase in the
 * sequencer that asks for a pace, the director's shot table, the powered-flight
 * ceiling, and every verification script. Inserting a rung renumbers all of
 * them silently: before this file existed, adding 2x, 5x and 10x at the bottom
 * would have turned `warpRequest = 3` from six hours a second into ten times
 * real time, everywhere, with nothing to catch it. `WARP.h6` survives the
 * insertion because it does not know where it sits.
 */

/**
 * Simulated seconds per wall-clock second, slowest first.
 *
 * The four rungs below a minute a second are for watching things happen —
 * a staging event, a bank reversal, a chute opening — and the ones above are
 * for getting somewhere. The gap between them used to be the whole ladder:
 * real time, and then straight to sixty times it.
 */
export const WARP_LEVELS = [
  { id: 'x1', label: 'real time', short: '1×', rate: 1 },
  { id: 'x2', label: '2 × real time', short: '2×', rate: 2 },
  { id: 'x5', label: '5 × real time', short: '5×', rate: 5 },
  { id: 'x10', label: '10 × real time', short: '10×', rate: 10 },
  { id: 'm1', label: '1 min / s', short: '1m', rate: 60 },
  { id: 'h1', label: '1 hour / s', short: '1h', rate: 3600 },
  { id: 'h6', label: '6 hours / s', short: '6h', rate: 21600 },
  { id: 'd1', label: '1 day / s', short: '1d', rate: 86400 },
  { id: 'd3', label: '3 days / s', short: '3d', rate: 259200 },
  { id: 'w1', label: '1 week / s', short: '1w', rate: 604800 },
  { id: 'mo1', label: '1 month / s', short: '1mo', rate: 2629800 },
]

/**
 * Name to index. Derived from the array, so a rung cannot be renamed in one
 * place and referenced by the old name in another — the lookup would be
 * undefined and `WARP_LEVELS[undefined]` throws on the next frame rather than
 * quietly running at the wrong pace.
 */
export const WARP = Object.fromEntries(WARP_LEVELS.map((l, i) => [l.id, i]))

/** Rates alone, for harnesses that only need the number. */
export const WARP_RATES = WARP_LEVELS.map((l) => l.rate)

/* Every id must be a usable key, and the ladder must ascend. */
for (let i = 1; i < WARP_LEVELS.length; i++) {
  if (WARP_LEVELS[i].rate <= WARP_LEVELS[i - 1].rate) {
    throw new Error(
      `warp ladder is not ascending at ${WARP_LEVELS[i].id}: ` +
        `${WARP_LEVELS[i].rate} follows ${WARP_LEVELS[i - 1].rate}`,
    )
  }
}
