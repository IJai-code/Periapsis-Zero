/**
 * One clock for the HUD's readouts, instead of a dozen.
 *
 * Every live figure outside the canvas — telemetry, flight strip, burn panel,
 * the fly HUD, commentary, the broadcast's clocks — used to own a
 * `setInterval` at its own cadence: twelve components polled between 90 and
 * 250 ms, each firing React state updates from its own timer, each timer
 * waking the main thread on its own schedule whether a frame was in flight or
 * not. Individually each is small; together they are a dozen competing
 * alarm clocks going off during the render loop, and on a machine already
 * short of frame time they land on top of it. `verify-alloc` holds the frame
 * path to zero allocation; nothing held the *timeouts*.
 *
 * This replaces them with one subscription on one shared pulse. The cadence
 * each component wants is a *tick selection* now: it asks for a step — a
 * multiple of the 110 ms pulse that all the readout cadences already sat
 * near — and its callback runs only on the steps that are its own. One timer,
 * registered once when the first reader arrives, cleared when the last
 * leaves; a page with no HUD up pays nothing, and no callback ever fires
 * between frames that the render loop did not already yield between.
 *
 * The step is 110 ms because the two fastest readers, `Telemetry` and
 * `BurnPanel`, sat at exactly that; slower readers keep their apparent
 * cadence by taking every second or third step. A 90 ms cadence becomes
 * 110 — one redraw in nine slower, on figures that stream regardless — and
 * twelve timers become one.
 */

/** The pulse, in milliseconds. The fastest readout in the HUD was 110. */
export const UI_PULSE_MS = 110

/**
 * A reader's cadence, in pulse steps: 1 is every pulse (the old 110 ms
 * timers), 2 every second (the old 200–220), 3 every third (the old 250 and
 * the observatory's second is served by whatever step falls near it).
 */
export function subscribeUiTick(fn, every = 1) {
  let started = 0
  const run = () => {
    // The counter is the pulse's own; a slow reader joins mid-cycle and still
    // gets the step it would have had.
    if (started % every === 0) fn()
    started++
  }
  return subscribeUiClock(run)
}

/**
 * The ambience's one AudioParam move rides this clock too — `sfx/ambience.js`
 * glides its low-pass on the same pulse the readouts use. Imported lazily by
 * the pulse below rather than by its callers, so a page with the ambience
 * never enabled pays nothing but an idle listener.
 */
import { tickAmbience } from '../sfx/ambience.js'

/* ---------------------------------------------------------------- *
 * The one timer
 * ---------------------------------------------------------------- */

const readers = new Set()
let timer = null

function subscribeUiClock(fn) {
  readers.add(fn)
  if (timer === null) {
    timer = setInterval(pulse, UI_PULSE_MS)
  }
  return () => {
    readers.delete(fn)
    if (readers.size === 0 && timer !== null) {
      clearInterval(timer)
      timer = null
    }
  }
}

function pulse() {
  // A hidden tab's timers are throttled by the browser anyway; the readers
  // that care check `document.hidden` themselves, as they always did.
  for (const fn of readers) fn()
  // The ambience's filter glide, once per pulse whether anyone else reads
  // or not — the timer exists while any reader does, and the ambience is
  // one more reader of the same clock rather than a clock of its own.
  tickAmbience()
}
