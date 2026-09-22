import { useEffect, useRef, useState } from 'react'
import { currentPhase } from '../sim/mission.js'
import { commentaryNow } from '../sim/commentary.js'

/**
 * The line that says what is going on.
 *
 * Bottom-left, under the flight-mode hints, because it is something you read
 * once when the phase changes and then stop looking at — which is the opposite
 * of the telemetry, and wants the opposite position.
 *
 * ── why it is on a timer and not on state ─────────────────────────────
 *
 * Several of these lines carry live figures, and a few of them change every
 * second: an altitude during the gravity turn, a g load during entry. Putting
 * them in React state would re-render the tree at whatever rate the fastest one
 * needs. So the text is written straight into the node on a one-second timer,
 * the way `Telemetry` and `FlightStrip` already do it, and React only re-renders
 * when the *phase* changes — which is the only thing that changes the panel's
 * shape.
 *
 * One second rather than a tenth: this is prose, and prose that reflows ten
 * times a second is unreadable. The figures in it are the slow ones for the
 * same reason.
 */
export function Commentary() {
  const [phase, setPhase] = useState(() => currentPhase().id)
  const [has, setHas] = useState(() => commentaryNow() !== null)
  const body = useRef(null)

  useEffect(() => {
    const tick = () => {
      const id = currentPhase().id
      setPhase((p) => (p === id ? p : id))
      const line = commentaryNow()
      setHas(line !== null)
      if (body.current && line !== null) body.current.textContent = line
    }
    tick()
    const t = setInterval(tick, 1000)
    return () => clearInterval(t)
  }, [])

  if (!has) return null

  /*
   * 28rem, not 30. The band between the two rails is not centred on the
   * viewport — at 1024 px the left rail ends at 240 and the right begins at
   * 746, so its midpoint is 493 while the screen's is 512. A viewport-centred
   * element can therefore only be 468 px wide before its right edge reaches the
   * rail, and 30rem is 480. Measured, it overlapped by six pixels.
   */
  return (
    <div className="panel pointer-events-auto max-w-[min(28rem,calc(100vw-2rem))] px-4 py-3">
      <div className="rule mb-2 border-b border-hud/12 pb-1.5">{currentPhase().label}</div>
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
