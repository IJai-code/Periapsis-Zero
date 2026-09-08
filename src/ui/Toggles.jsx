import { setUi, useUi } from '../sim/store.js'

const OPTIONS = [
  { key: 'trajectory', label: 'Trajectory + nodes' },
  { key: 'trails', label: 'Orbit trails' },
  { key: 'lagrange', label: 'Lagrange points' },
  { key: 'clouds', label: 'Cloud layer' },
  { key: 'atmosphere', label: 'Atmosphere' },
  { key: 'labels', label: 'Labels' },
  { key: 'bloom', label: 'Bloom / vignette' },
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
      <div className="rule mb-2.5 border-b border-white/10 pb-2">Render</div>

      <div className="space-y-0.5">
        {OPTIONS.map((o) => {
          const on = state[o.key]
          return (
            <button
              key={o.key}
              onClick={() => setUi({ [o.key]: !on })}
              aria-pressed={on}
              className="flex w-full items-center gap-2.5 rounded-[2px] px-1 py-1 text-left transition-colors hover:bg-white/5"
            >
              <Switch on={on} />
              <span className={`text-[11px] ${on ? 'text-white/85' : 'text-white/35'}`}>
                {o.label}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
