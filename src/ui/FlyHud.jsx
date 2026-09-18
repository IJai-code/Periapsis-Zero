import { useEffect, useRef } from 'react'
import { live } from '../sim/live.js'
import { useUi } from '../sim/store.js'

const C = 299792458

/**
 * Speed, in whatever unit is legible at the moment.
 *
 * The range is eleven orders of magnitude, so no single unit works: metres per
 * second next to a hull, kilometres per second in orbit, multiples of c out
 * between the planets. The last of those is stated rather than hidden — the
 * camera is a viewpoint and not an object, and a reader who notices the number
 * is past c deserves to see it said plainly instead of silently capped.
 */
function speedText(v) {
  if (v >= 0.1 * C) return `${(v / C).toFixed(v / C < 10 ? 2 : 0)} c`
  if (v >= 1e4) return `${(v / 1e3).toFixed(0)} km/s`
  if (v >= 100) return `${(v / 1e3).toFixed(2)} km/s`
  return `${v.toFixed(1)} m/s`
}

const KEYS = [
  ['W S', 'forward · back'],
  ['A D', 'left · right'],
  ['R F', 'up · down'],
  ['mouse', 'look'],
  ['wheel', 'trim speed'],
  ['shift', 'x5'],
  ['ctrl', 'x0.2'],
]

/**
 * Shown only while free flight is active. Written straight into the DOM on a
 * timer, like the rest of the live readouts — the speed changes every frame and
 * re-rendering a React tree to print one number would cost more than the
 * integration does.
 */
export function FlyHud() {
  const flying = useUi((s) => s.focus === 'fly')
  const root = useRef(null)

  useEffect(() => {
    if (!flying) return
    const speed = root.current?.querySelector('[data-field="speed"]')
    const room = root.current?.querySelector('[data-field="room"]')
    const lock = root.current?.querySelector('[data-field="lock"]')
    const tick = () => {
      if (speed) speed.textContent = speedText(live.flySpeed)
      if (lock) {
        const held = live.flyLocked
        lock.textContent = held
          ? 'Mouse captured · esc to release'
          : 'Click the scene to steer with the mouse'
        lock.style.color = held ? 'color-mix(in oklab, var(--color-hud) 55%, transparent)' : ''
      }
      if (room) {
        const d = live.nearest.distance
        room.textContent = !Number.isFinite(d)
          ? '—'
          : d < 1000
            ? `${d.toFixed(0)} m to ${live.nearest.id}`
            : `${(d / 1e3).toLocaleString('en-US', { maximumFractionDigits: 0 })} km to ${live.nearest.id}`
      }
    }
    tick()
    const id = setInterval(tick, 90)
    return () => clearInterval(id)
  }, [flying])

  if (!flying) return null

  return (
    <div ref={root} className="panel pointer-events-none w-52 rounded-sm p-3.5">
      <div className="rule mb-2.5 flex items-baseline justify-between border-b border-white/10 pb-2">
        <span>Free flight</span>
        <span className="text-white/25">9</span>
      </div>

      <div className="mb-1 flex items-baseline justify-between gap-3">
        <span className="text-[10px] text-white/35">Speed</span>
        <span data-field="speed" className="tabular-nums text-[13px] text-hud">
          —
        </span>
      </div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[10px] text-white/35">Clearance</span>
        <span data-field="room" className="tabular-nums text-[11px] text-white/85">
          —
        </span>
      </div>

      <div className="mt-3 space-y-1 border-t border-white/10 pt-2.5">
        {KEYS.map(([k, what]) => (
          <div key={k} className="flex items-baseline justify-between gap-3">
            <kbd className="rounded-[2px] border border-white/10 px-1 text-[9px] text-white/40">
              {k}
            </kbd>
            <span className="text-[9px] text-white/30">{what}</span>
          </div>
        ))}
      </div>

      {/* Written on the timer like the readouts above: the browser can drop the
          lock at any moment — escape, a tab switch — and a stale line here would
          be telling the pilot they have a mouse they do not have. */}
      <p
        data-field="lock"
        className="mt-2.5 border-t border-white/10 pt-2 text-[9px] leading-relaxed text-white/40"
      >
        Click the scene to steer with the mouse
      </p>

      <p className="mt-2 text-[9px] leading-relaxed text-white/25">
        Speed scales with clearance to the nearest surface, so the same forty
        seconds crosses a hangar or an astronomical unit.
      </p>
    </div>
  )
}
