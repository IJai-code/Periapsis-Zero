import { useEffect, useRef } from 'react'
import { live } from '../sim/live.js'

/**
 * The four figures you actually fly on, in one strip under the wordmark.
 *
 * They existed already, scattered: altitude and orbital velocity were two rows
 * inside a 264 px panel on the right, dynamic pressure was two rows below them,
 * and all of it lived behind the panel toggle. A pilot watching an ascent was
 * reading a list. A strip is the right shape for values that are only ever
 * glanced at, and putting it beside the wordmark means the things that change
 * fastest are where the eye already is.
 *
 * The full panels keep their rows. This is not a move, it is a summary — the
 * same `live` fields read twice costs four property reads a tick.
 *
 * ── why the numbers do not twitch ─────────────────────────────────────
 *
 * Two reasons, and they are separate problems.
 *
 * **Width.** Proportional digits are not the same width, so `1` replacing `0`
 * shortens the string and everything after it slides left — sixty times a
 * second, on four figures at once. That is most of what reads as a jittery
 * readout, and it is a font feature rather than a layout bug: `tabular-nums`,
 * set on the mono face in `index.css` so nothing can forget it. Each value also
 * gets a fixed minimum width, because tabular figures keep the *digits* aligned
 * and do not stop a string gaining a digit.
 *
 * **Rate.** These are written straight into the DOM on a 110 ms timer rather
 * than through React state. Re-rendering the tree at 60 Hz to print four
 * numbers would cost more than the physics does, and a figure updated ten times
 * a second is already faster than anyone can read one.
 */

const FIELDS = [
  {
    key: 'alt',
    label: 'Altitude',
    width: '7.5ch',
    get: () => {
      const a = live.elements.altitude
      // Metres below a kilometre: on the pad, "0.00 km" says nothing.
      return a < 1000 ? `${a.toFixed(0)} m` : `${(a / 1000).toFixed(1)} km`
    },
  },
  {
    key: 'vel',
    label: 'Velocity',
    width: '8ch',
    get: () => `${(live.elements.speed / 1000).toFixed(3)} km/s`,
  },
  {
    /*
     * Pascals, and it reads zero on the pad by construction — the vehicle is
     * not moving through the air, so there is no dynamic pressure on it. That
     * is the correct reading and not a broken one, which is worth knowing
     * before anybody "fixes" it.
     */
    key: 'q',
    label: 'Dynamic pressure',
    width: '8ch',
    get: () => {
      const q = live.dynamicPressure
      return q >= 1000 ? `${(q / 1000).toFixed(1)} kPa` : `${q.toFixed(0)} Pa`
    },
  },
  {
    key: 'g',
    label: 'Load',
    width: '5.5ch',
    get: () => `${live.decelG.toFixed(2)} g`,
  },
]

export function FlightStrip() {
  const root = useRef(null)

  useEffect(() => {
    const nodes = []
    for (const f of FIELDS) {
      const el = root.current?.querySelector(`[data-strip="${f.key}"]`)
      if (el) nodes.push([f, el])
    }
    const tick = () => {
      for (const [f, el] of nodes) el.textContent = f.get()
    }
    tick()
    const id = setInterval(tick, 110)
    return () => clearInterval(id)
  }, [])

  return (
    <div
      ref={root}
      className="panel pointer-events-none flex w-fit max-w-[calc(100vw-2rem)] items-stretch overflow-x-auto"
    >
      {FIELDS.map((f, i) => (
        <div
          key={f.key}
          /*
           * The separator is a real left border on every cell but the first,
           * rather than a stack of sibling divs — one rule per boundary, and no
           * trailing hairline to trim off the end.
           */
          className={`px-3.5 py-2 sm:px-4 ${i > 0 ? 'border-l border-hud/15' : ''}`}
        >
          <div className="rule text-[8px] whitespace-nowrap">{f.label}</div>
          <div
            data-strip={f.key}
            style={{ minWidth: f.width }}
            className="mt-1 font-mono text-[12px] leading-none text-[#f0e7da]/90 tabular-nums"
          >
            —
          </div>
        </div>
      ))}
    </div>
  )
}
