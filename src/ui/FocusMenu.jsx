import { setUi, useUi } from '../sim/store.js'
import { BODIES, SHIP } from '../sim/constants.js'

const TARGETS = [
  { id: 'free', name: 'Free', hint: 'Unlocked', key: '1' },
  { id: 'fly', name: 'Fly', hint: 'WASD · click to steer', key: '9' },
  { id: 'sun', name: BODIES.sun.name, hint: 'G2V star', key: '2' },
  { id: 'earth', name: BODIES.earth.name, hint: 'Home', key: '3' },
  { id: 'moon', name: BODIES.moon.name, hint: 'Tidally locked', key: '4' },
  { id: 'ship', name: SHIP.name, hint: 'Orbit lock', key: '5' },
  { id: 'chase', name: 'Chase', hint: 'Rides the hull', key: '6' },
  { id: 'ground', name: 'Ground', hint: 'Eye height · 380 m', key: '0' },
  { id: 'iss', name: 'ISS', hint: '400 km · 51.6°', key: '7' },
  { id: 'hubble', name: 'Hubble', hint: '540 km · 28.5°', key: '8' },
]

/** Camera lock. Selecting a target flies the camera in and then follows it. */
export function FocusMenu() {
  const focus = useUi((s) => s.focus)

  return (
    <div className="panel w-56 rounded-sm p-3.5">
      <div className="rule mb-2.5 border-b border-white/10 pb-2">Camera lock</div>
      <div className="space-y-1">
        {TARGETS.map((t) => {
          const active = focus === t.id
          return (
            <button
              key={t.id}
              onClick={() => setUi({ focus: t.id })}
              className={`group flex w-full items-center gap-2.5 rounded-[2px] px-2 py-1.5 text-left transition-colors ${
                active ? 'bg-hud/15 text-hud' : 'text-white/60 hover:bg-white/5 hover:text-white/90'
              }`}
            >
              <span
                className={`h-1.5 w-1.5 shrink-0 rounded-full transition-all ${
                  active ? 'bg-hud shadow-[0_0_8px_1px_currentColor]' : 'bg-white/20'
                }`}
              />
              <span className="flex-1">
                <span className="block text-[12px] leading-tight tracking-wide">{t.name}</span>
                <span className="block text-[9px] leading-tight text-white/30">{t.hint}</span>
              </span>
              <kbd className="shrink-0 rounded-[2px] border border-white/10 px-1 text-[9px] text-white/25">
                {t.key}
              </kbd>
            </button>
          )
        })}
      </div>
      <p className="mt-2.5 border-t border-white/10 pt-2 text-[9px] leading-relaxed text-white/25">
        Drag to orbit, scroll to zoom. Locked targets keep your orbit offset as they
        move. Fly steers instead, at a speed set by how much room there is.
      </p>
    </div>
  )
}
