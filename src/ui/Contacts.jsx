import { useEffect, useRef } from 'react'
import { subscribeUiTick } from './uiClock.js'
import { live } from '../sim/live.js'
import { INDEX } from '../sim/system.js'
import { setUi, useUi } from '../sim/store.js'

/**
 * The contact list: who is out there, how far, and closing or opening.
 *
 * The numbers were available already, in the sense that the state vector had
 * them: a pilot who wanted to know how far Hubble was could fly to it and read
 * the altimeter on arrival. This is the same numbers as a list, measured from
 * the ship the way a contact list is: range and range rate for every tracked
 * object in the sky, written straight to the DOM on the readout pulse like
 * every other live figure here.
 *
 * The rows are fixed in order rather than sorted by range. A list that
 * re-orders itself as the ship moves is a list nobody can aim at, and the
 * order is the one a pilot already thinks in: home, the stations that hang
 * over it, the Moon, and the Sun that lights all of it. Clicking a row sends
 * the camera there, so the list is also the shortest path to looking at
 * something.
 */
const CONTACTS = [
  { id: 'earth', name: 'Terra' },
  { id: 'iss', name: 'ISS' },
  { id: 'hubble', name: 'Hubble' },
  { id: 'moon', name: 'Luna' },
  { id: 'sun', name: 'Sol' },
]

const AU_M = 1.495978707e11

/** Range and range rate from the ship to a body's centre. Closing is positive. */
const out = new Float64Array(2)
function measure(id) {
  const s = live.sim.state
  const o = INDEX.ship * 6
  const t = INDEX[id] * 6
  const dx = s[t] - s[o]
  const dy = s[t + 1] - s[o + 1]
  const dz = s[t + 2] - s[o + 2]
  const r = Math.sqrt(dx * dx + dy * dy + dz * dz)
  out[0] = r
  out[1] =
    r > 0
      ? -((s[t + 3] - s[o + 3]) * dx + (s[t + 4] - s[o + 4]) * dy + (s[t + 5] - s[o + 5]) * dz) / r
      : 0
  return out
}

/* Cislunar in kilometres, the way a flight reads them; anything further is in
   astronomical units, because 149,600,000 km is a number nobody reads. */
function fmtRange(m) {
  const km = m / 1000
  return km < 1e6
    ? `${Math.round(km).toLocaleString('en-US')} km`
    : `${(m / AU_M).toFixed(3)} au`
}

function fmtRate(v) {
  const a = Math.abs(v)
  return `${v < 0 ? '−' : ''}${a >= 1000 ? `${(a / 1000).toFixed(2)} km/s` : `${a.toFixed(0)} m/s`}`
}

export function Contacts() {
  const root = useRef(null)
  const focus = useUi((s) => s.focus)

  useEffect(() => {
    const nodes = []
    for (const c of CONTACTS) {
      const row = root.current?.querySelector(`[data-contact="${c.id}"]`)
      if (row) nodes.push([c, row])
    }
    const tick = () => {
      for (const [c, row] of nodes) {
        const [range, rate] = measure(c.id)
        row.querySelector('[data-range]').textContent = fmtRange(range)
        row.querySelector('[data-rate]').textContent = fmtRate(rate)
      }
    }
    tick()
    // Five rows of two figures: every other pulse is faster than anyone reads.
    return subscribeUiTick(tick, 2)
  }, [])

  return (
    <div ref={root} className="panel w-60 rounded-sm p-3.5">
      <div className="rule mb-2 border-b border-white/10 pb-2">Contacts</div>
      <div className="space-y-1.5">
        {CONTACTS.map((c) => {
          const on = focus === c.id
          return (
            <button
              key={c.id}
              data-contact={c.id}
              onClick={() => setUi({ focus: c.id })}
              title={`Look at ${c.name}`}
              className={`control flex w-full items-baseline gap-2 rounded-sm px-1.5 py-1 text-left outline-none focus-visible:text-ember ${on ? 'text-ember' : 'text-white/80 hover:text-ember'}`}
            >
              <span className="flex-1 truncate text-[11px]">{c.name}</span>
              <span
                data-range
                className="w-[5.75rem] shrink-0 text-right font-mono text-[10px] tabular-nums"
              >
                ·
              </span>
              <span
                data-rate
                className="w-[4.25rem] shrink-0 text-right font-mono text-[9.5px] tabular-nums text-hud/55"
              >
                ·
              </span>
            </button>
          )
        })}
      </div>
      <p className="mt-2.5 border-t border-white/10 pt-2 text-[9px] leading-relaxed text-white/30">
        Range and closing rate from the ship. Click a row to look at it.
      </p>
    </div>
  )
}
