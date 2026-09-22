import { Fragment } from 'react'
import { setUi, useUi, WARP_LEVELS } from '../sim/store.js'
import { resetSimulation } from '../sim/live.js'
import { resetMission } from '../sim/mission.js'

export function TimeControls() {
  const warp = useUi((s) => s.warp)
  const paused = useUi((s) => s.paused)

  return (
    <div className="panel flex max-w-[calc(100vw-1.5rem)] items-center gap-2 overflow-x-auto px-3 py-2 sm:gap-3">
      <button
        onClick={() => setUi((s) => ({ paused: !s.paused }))}
        title="Pause / resume  (space)"
        className={`grid h-9 w-9 shrink-0 place-items-center border transition-colors duration-300 outline-none focus-visible:border-ember sm:h-8 sm:w-8 ${
          paused
            ? 'border-ember bg-ember/18 text-ember'
            : 'border-hud/22 text-hud/80 hover:border-ember hover:text-ember'
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

      <div className="h-7 w-px bg-hud/15" />

      {/* The ladder falls into two halves: rungs you watch an event at, and
          rungs you travel at. The rule marks where one becomes the other. */}
      <div className="flex items-center gap-0.5">
        {WARP_LEVELS.map((level, i) => (
          <Fragment key={level.id}>
            {level.id === 'm1' && <div className="mx-1 h-5 w-px shrink-0 bg-hud/15" />}
          <button
            onClick={() => setUi({ warp: i })}
            title={level.label}
            className={`h-9 min-w-9 shrink-0 border px-1.5 text-[10px] tabular-nums transition-colors duration-300 outline-none focus-visible:border-ember sm:h-8 sm:min-w-8 ${
              i === warp
                ? 'border-ember bg-ember/18 text-ember'
                : i < warp
                  ? 'border-transparent text-hud/55 hover:border-ember/50 hover:text-ember'
                  : 'border-transparent text-[#e8e0d5]/25 hover:border-ember/50 hover:text-ember'
            }`}
          >
            {level.short}
          </button>
          </Fragment>
        ))}
      </div>

      <div className="hidden h-7 w-px bg-hud/15 lg:block" />

      <div className="hidden w-28 shrink-0 px-1 lg:block">
        <div className="rule text-[8px]">Time warp</div>
        <div className="text-[11px] leading-tight text-[#efe7db]/80">
          {paused ? 'held' : WARP_LEVELS[warp].label}
        </div>
      </div>

      <button
        onClick={() => {
          resetSimulation()
          resetMission()
        }}
        title="Return to epoch J2000.0"
        className="h-9 shrink-0 border border-transparent px-2.5 text-[10px] tracking-wider text-hud/45 uppercase transition-colors duration-300 outline-none hover:border-ember/50 hover:text-ember focus-visible:border-ember sm:h-8"
      >
        Reset
      </button>
    </div>
  )
}
