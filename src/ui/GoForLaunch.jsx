import { useEffect, useState } from 'react'
import { subscribeUiTick } from './uiClock.js'
import { beginCountdown, currentPhase, mission } from '../sim/mission.js'
import { SHIP } from '../sim/constants.js'

/**
 * The one control a held vehicle is waiting for, where the eye already is.
 *
 * "Begin flight" lands on a vehicle held on its pad, and the only way to let it
 * go was a button in the vehicle panel on the right-hand rail — the fourth
 * panel down, 996 px below the top of the rail at a 713 px window, so below the
 * fold on every laptop. The commentary meanwhile said "T-10 s ... held down",
 * which reads as a count that has stalled. This puts the go at the foot of the
 * frame, above the commentary, for exactly as long as the vehicle is held and
 * the count has not been started; the rail keeps its own copy.
 *
 * Polled, like the rail's copy: the held state lives in the sequencer, which is
 * not React state, and a quarter of a second is well inside a click.
 */
export function GoForLaunch() {
  const [held, setHeld] = useState(false)

  useEffect(() => {
    const tick = () => setHeld(Boolean(currentPhase().held) && !mission.running)
    tick()
    return subscribeUiTick(tick, 2)
  }, [])

  if (!held) return null
  return (
    <button
      type="button"
      // No argument: the event is not an options object, and this is the same
      // count the rail's button starts.
      onClick={() => beginCountdown()}
      className="control panel pointer-events-auto flex items-center gap-3 px-5 py-2.5 font-mono text-[10.5px] tracking-[0.24em] text-ember uppercase outline-none transition-colors duration-300 hover:bg-ember/15 focus-visible:bg-ember/15"
    >
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-ember shadow-[0_0_8px_1px_currentColor]" />
      {SHIP.lunar ? 'Start the count for liftoff' : 'Start the countdown'} ▸
    </button>
  )
}
