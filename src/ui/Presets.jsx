import { PRESETS, presetHref } from '../sim/presets.js'

/**
 * Missions to jump into.
 *
 * Links, not buttons that mutate the flight: the vessel and the pad are chosen
 * when the page loads, so a preset reloads with its own and flies from the pad to
 * its starting point. Choosing the one already running starts it again.
 */
export function Presets() {
  const active = new URLSearchParams(window.location.search).get('preset')

  const open = (event, preset) => {
    event.preventDefault()
    const href = presetHref(preset)
    // The same address again is a same-document navigation, which reloads nothing.
    if (window.location.search + window.location.hash === href) window.location.reload()
    else window.location.assign(href)
  }

  return (
    <div className="panel w-48 rounded-sm p-3.5">
      <div className="rule mb-2.5 border-b border-white/10 pb-2">Missions</div>
      <div className="space-y-0.5">
        {PRESETS.map((preset) => {
          const on = preset.id === active
          return (
            <a
              key={preset.id}
              href={presetHref(preset)}
              onClick={(event) => open(event, preset)}
              aria-current={on ? 'true' : undefined}
              className={`block w-full rounded-[2px] px-1.5 py-1 text-left transition-colors ${
                on ? 'bg-hud/12' : 'hover:bg-white/5'
              }`}
            >
              <div className={`text-[11px] ${on ? 'text-hud' : 'text-white/70'}`}>{preset.title}</div>
              <div className="text-[9px] leading-snug text-white/30">{preset.blurb}</div>
            </a>
          )
        })}
      </div>
      <div className="mt-2 border-t border-white/8 pt-2 text-[9px] leading-relaxed text-white/25">
        Each is flown from the pad when it loads, not restored from a save.
      </div>
    </div>
  )
}
