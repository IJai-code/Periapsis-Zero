import { setUi, useUi, WARP_LEVELS } from '../sim/store.js'
import { resetSimulation } from '../sim/live.js'
import { resetMission } from '../sim/mission.js'

export function TimeControls() {
  const warp = useUi((s) => s.warp)
  const paused = useUi((s) => s.paused)

  return (
    <div className="panel flex max-w-[calc(100vw-1.5rem)] items-center gap-2 overflow-x-auto rounded-sm px-3 py-2 sm:gap-3">
      <button
        onClick={() => setUi((s) => ({ paused: !s.paused }))}
        title="Pause / resume  (space)"
        className={`grid h-8 w-8 shrink-0 place-items-center rounded-[2px] transition-colors ${
          paused ? 'bg-amber-400/20 text-amber-300' : 'bg-hud/15 text-hud hover:bg-hud/25'
        }`}
      >
        {paused ? (
          <svg width="11" height="12" viewBox="0 0 11 12" fill="currentColor">
            <path d="M0 0l11 6-11 6z" />
          </svg>
        ) : (
          <svg width="10" height="12" viewBox="0 0 10 12" fill="currentColor">
            <rect width="3.2" height="12" /> <rect x="6.8" width="3.2" height="12" />
          </svg>
        )}
      </button>

      <div className="h-7 w-px bg-white/10" />

      <div className="flex items-center gap-0.5">
        {WARP_LEVELS.map((level, i) => (
          <button
            key={level.short}
            onClick={() => setUi({ warp: i })}
            title={level.label}
            className={`h-8 min-w-8 shrink-0 rounded-[2px] px-1.5 text-[10px] tabular-nums transition-colors ${
              i === warp
                ? 'bg-hud/20 text-hud'
                : i < warp
                  ? 'text-hud-dim/70 hover:bg-white/5'
                  : 'text-white/25 hover:bg-white/5 hover:text-white/60'
            }`}
          >
            {level.short}
          </button>
        ))}
      </div>

      <div className="hidden h-7 w-px bg-white/10 lg:block" />

      <div className="hidden w-28 shrink-0 px-1 lg:block">
        <div className="rule text-[8px]">Time warp</div>
        <div className="text-[11px] leading-tight text-white/80">
          {paused ? 'held' : WARP_LEVELS[warp].label}
        </div>
      </div>

      <button
        onClick={() => {
          resetSimulation()
          resetMission()
        }}
        title="Return to epoch J2000.0"
        className="h-8 shrink-0 rounded-[2px] px-2.5 text-[10px] tracking-wider text-white/40 uppercase transition-colors hover:bg-white/5 hover:text-white/80"
      >
        Reset
      </button>
    </div>
  )
}
