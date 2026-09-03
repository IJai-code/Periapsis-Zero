import { setUi, uiStore, useUi } from '../sim/store.js'
import { loadHdTextures } from '../gfx/hdTextures.js'

const OPTIONS = [
  { key: 'trails', label: 'Orbit trails' },
  { key: 'lagrange', label: 'Lagrange points' },
  { key: 'clouds', label: 'Cloud layer' },
  { key: 'atmosphere', label: 'Atmosphere' },
  { key: 'labels', label: 'Labels' },
  { key: 'bloom', label: 'Bloom / vignette' },
]

/**
 * Shared lazy-asset toggle.
 *
 * Both asset families behave identically — fetch on first request, flip on if
 * anything turned up, cache so every later toggle is instant — so they share one
 * state machine rather than two that could drift.
 *
 * `enabled` flips immediately so the switch reflects intent while the fetch is
 * in flight, and flips back if the folder turns out to be empty.
 */
async function requestAssets({ flag, statusKey, loadedKey, totalKey, load }) {
  const state = uiStore.get()
  if (state[statusKey] === 'loading') return
  if (state[flag]) return setUi({ [flag]: false })
  if (state[statusKey] === 'ready') return setUi({ [flag]: true })

  setUi({ [flag]: true, [statusKey]: 'loading', [loadedKey]: 0, [totalKey]: 0 })
  try {
    const { found } = await load((loaded, total) => setUi({ [loadedKey]: loaded, [totalKey]: total }))
    setUi(found > 0 ? { [statusKey]: 'ready' } : { [flag]: false, [statusKey]: 'unavailable' })
  } catch (err) {
    console.error('[spxsim] asset load failed', err)
    setUi({ [flag]: false, [statusKey]: 'error' })
  }
}


const FAMILIES = {
  textures: {
    label: 'HD textures',
    idle: 'NASA imagery · loads on demand',
    active: 'NASA imagery active',
    empty: 'none found in /textures',
    flag: 'hd',
    statusKey: 'hdStatus',
    loadedKey: 'hdLoaded',
    totalKey: 'hdTotal',
    unit: 'maps',
    load: (p) => loadHdTextures(p),
  },
}

function Switch({ on, pulse }) {
  return (
    <span
      className={`relative h-3 w-5 shrink-0 rounded-full transition-colors ${
        on ? 'bg-hud/50' : 'bg-white/12'
      } ${pulse ? 'animate-pulse' : ''}`}
    >
      <span
        className={`absolute top-0.5 h-2 w-2 rounded-full transition-all ${
          on ? 'left-2.5 bg-hud shadow-[0_0_6px_currentColor]' : 'left-0.5 bg-white/45'
        }`}
      />
    </span>
  )
}

function AssetRow({ family }) {
  const f = FAMILIES[family]
  const state = useUi()
  const on = state[f.flag]
  const status = state[f.statusKey]
  const loading = status === 'loading'

  const note =
    status === 'unavailable'
      ? f.empty
      : status === 'error'
        ? 'load failed — see console'
        : loading
          ? `${state[f.loadedKey]} / ${state[f.totalKey] || '…'} ${f.unit}`
          : on
            ? f.active
            : f.idle
  const warn = status === 'unavailable' || status === 'error'

  return (
    <div>
      <button
        onClick={() => requestAssets(f)}
        disabled={loading}
        aria-pressed={on}
        className="flex w-full items-center gap-2.5 rounded-[2px] px-1 py-1 text-left transition-colors hover:bg-white/5 disabled:cursor-progress"
      >
        <Switch on={on} pulse={loading} />
        <span className="min-w-0 flex-1">
          <span className={`block text-[11px] leading-tight ${on ? 'text-white/85' : 'text-white/35'}`}>
            {loading ? 'Downloading…' : f.label}
          </span>
          <span
            className={`block truncate text-[9px] leading-tight ${warn ? 'text-amber-300/70' : 'text-white/25'}`}
          >
            {note}
          </span>
        </span>
      </button>
      {loading && (
        <div className="mt-1 ml-[30px] h-px overflow-hidden bg-white/10">
          <div
            className="h-full bg-hud transition-[width] duration-200"
            style={{ width: state[f.totalKey] ? `${(state[f.loadedKey] / state[f.totalKey]) * 100}%` : '10%' }}
          />
        </div>
      )}
    </div>
  )
}

export function Toggles() {
  const state = useUi()

  return (
    <div className="panel w-48 rounded-sm p-3.5">
      <div className="rule mb-2.5 border-b border-white/10 pb-2">Render</div>

      <div className="mb-2 border-b border-white/10 pb-2">
        <AssetRow family="textures" />
      </div>

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
