import { setUi, useUi } from '../sim/store.js'
import { DEVICE_COPY, DEVICE_IDS, chooseDevice } from '../sim/device.js'

/**
 * Re-answer the first question. The scene was built for the old answer — its
 * pixel ratio, its antialiasing, its forest — so a different one reloads the
 * page rather than pretending to retrofit a WebGL context.
 */
function retune(id) {
  if (chooseDevice(id, { built: true })) window.location.reload()
}

const OPTIONS = [
  { key: 'trajectory', label: 'Trajectory + nodes' },
  { key: 'osculating', label: 'Osculating conic' },
  { key: 'trails', label: 'Orbit trails' },
  { key: 'lagrange', label: 'Lagrange points' },
  { key: 'clouds', label: 'Cloud layer' },
  { key: 'atmosphere', label: 'Atmosphere' },
  { key: 'labels', label: 'Labels' },
  { key: 'bloom', label: 'Bloom / vignette' },
  { key: 'broadcast', label: 'Broadcast feed' },
  { key: 'geophysics', label: 'Terra interior' },
]

function Switch({ on }) {
  return (
    <span
      className={`relative h-3 w-5 shrink-0 rounded-full transition-colors ${
        on ? 'bg-hud/50' : 'bg-white/12'
      }`}
    >
      <span
        className={`absolute top-0.5 h-2 w-2 rounded-full transition-all ${
          on ? 'left-2.5 bg-hud shadow-[0_0_6px_currentColor]' : 'left-0.5 bg-white/45'
        }`}
      />
    </span>
  )
}

export function Toggles() {
  const state = useUi()

  return (
    <div className="panel w-48 rounded-sm p-3.5">
      <div className="rule mb-2.5 border-b border-white/10 pb-2">Display</div>

      <div className="space-y-0.5">
        {OPTIONS.map((o) => {
          const on = state[o.key]
          return (
            <button
              key={o.key}
              onClick={() => setUi({ [o.key]: !on })}
              aria-pressed={on}
              className="flex min-h-9 w-full items-center gap-2.5 px-1 py-2 text-left outline-none transition-colors duration-300 hover:bg-hud/[0.06] focus-visible:bg-hud/[0.08] lg:min-h-0 lg:py-1"
            >
              <Switch on={on} />
              <span className={`text-[11px] ${on ? 'text-white/85' : 'text-white/35'}`}>
                {o.label}
              </span>
            </button>
          )
        })}
      </div>
      <div className="mt-2.5 border-t border-white/10 pt-2.5">
        <div className="rule mb-1.5">Tuned for</div>
        <div className="grid grid-cols-3 gap-1">
          {DEVICE_IDS.map((id) => (
            <button
              key={id}
              onClick={() => retune(id)}
              aria-pressed={state.device === id}
              title={DEVICE_COPY[id].note}
              className={`min-h-9 border px-1 py-1.5 text-[9px] tracking-[0.12em] uppercase transition-colors duration-300 outline-none lg:min-h-0 ${
                state.device === id
                  ? 'border-ember/70 text-ember'
                  : 'border-white/10 text-white/40 hover:border-ember/50 hover:text-ember focus-visible:border-ember'
              }`}
            >
              {id === 'desktop' ? 'Computer' : id === 'tablet' ? 'Tablet' : 'Phone'}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
