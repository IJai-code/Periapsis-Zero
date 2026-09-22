import { useCallback, useEffect, useRef, useState } from 'react'
import { currentPhase } from '../sim/mission.js'
import { TERMINAL, commentaryNow } from '../sim/commentary.js'

/**
 * The line that says what is going on.
 *
 * Bottom-centre, above the controls, because it is something you read once when
 * the phase changes and then stop looking at — and because the bottom-*left*
 * corner, where this started, is under a control bar that is centred and 670 px
 * wide, so a line beginning at the left margin lost its last two sentences.
 *
 * ── why it is on a timer and not on state ─────────────────────────────
 *
 * Several of these lines carry live figures — an altitude during the gravity
 * turn, a g load during entry, a countdown on the pad — and a few change every
 * second. Putting them in React state would re-render the tree at whatever rate
 * the fastest one needs. So the text is written straight into the node on a
 * timer, the way `Telemetry` and `FlightStrip` already do it, and React
 * re-renders only when the *phase* changes, which is the only thing that
 * changes the panel's shape.
 *
 * A fifth of a second, not a whole one. Prose that reflows ten times a second
 * is unreadable, but the pad countdown is the one line where the number is the
 * point, and at one second it visibly stepped.
 *
 * ── going away ────────────────────────────────────────────────────────
 *
 * Two ways, because a panel that cannot be got rid of is furniture rather than
 * information.
 *
 * It can be dismissed, and a dismissal lasts until the phase changes — the next
 * thing that happens is new, so it gets to speak again. And a *terminal* phase
 * retires itself: after splashdown the line sat there for the rest of the
 * session announcing that the mission was over, which is the interface failing
 * to notice that it is. It holds long enough to be read, then goes.
 */

/** How long a terminal phase's line stays before it retires itself, ms. */
const TERMINAL_DWELL = 25_000

export function Commentary() {
  const [phase, setPhase] = useState(() => currentPhase().id)
  const [has, setHas] = useState(() => commentaryNow() !== null)
  const [dismissed, setDismissed] = useState(false)
  const [retired, setRetired] = useState(false)
  const body = useRef(null)
  /** When the current terminal phase was entered, or null if it is not one. */
  const endedAt = useRef(null)

  useEffect(() => {
    const tick = () => {
      const id = currentPhase().id
      setPhase((prev) => {
        if (prev === id) return prev
        // A new phase is new information: it un-dismisses and un-retires.
        setDismissed(false)
        setRetired(false)
        endedAt.current = TERMINAL.has(id) ? performance.now() : null
        return id
      })
      if (endedAt.current !== null && performance.now() - endedAt.current > TERMINAL_DWELL) {
        setRetired(true)
      }
      const line = commentaryNow()
      setHas(line !== null)
      if (body.current && line !== null) body.current.textContent = line
    }
    // The phase at mount may already be terminal — a page loaded straight into
    // a finished flight — so the clock starts here rather than only on a change.
    endedAt.current = TERMINAL.has(currentPhase().id) ? performance.now() : null
    tick()
    const t = setInterval(tick, 200)
    return () => clearInterval(t)
  }, [])

  const dismiss = useCallback(() => setDismissed(true), [])

  if (!has || dismissed || retired) return null

  /*
   * 28rem, not 30. The band between the two rails is not centred on the
   * viewport — at 1024 px the left rail ends at 240 and the right begins at
   * 746, so its midpoint is 493 while the screen's is 512. A viewport-centred
   * element can therefore only be 468 px wide before its right edge reaches the
   * rail, and 30rem is 480. Measured, it overlapped by six pixels.
   */
  return (
    <div className="panel pointer-events-auto max-w-[min(28rem,calc(100vw-2rem))] px-4 py-3">
      <div className="mb-2 flex items-baseline justify-between gap-3 border-b border-hud/12 pb-1.5">
        <span className="rule">{currentPhase().label}</span>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss commentary"
          className="-my-1 -mr-1 px-2 py-1 font-mono text-[11px] leading-none text-hud/35 outline-none transition-colors hover:text-ember focus-visible:text-ember"
        >
          ×
        </button>
      </div>
      {/*
        `font-sans` and a generous measure: this is the one thing in the
        interface written to be read as a sentence rather than scanned as a
        figure, and the mono face the rest of the panel uses is the wrong tool
        for it. The key is the phase id, so React replaces the node on a phase
        change and the browser does not animate one sentence into another.
      */}
      <p
        key={phase}
        ref={body}
        className="font-sans text-[11.5px] leading-[1.65] text-[#e8e0d5]/70"
      />
    </div>
  )
}
