import { useEffect, useRef } from 'react'
import { armContract, CONTRACTS, program } from '../sim/programs.js'
import { resetMission } from '../sim/mission.js'
import { selectSite } from '../sim/launchsite.js'
import { setUi, uiStore } from '../sim/store.js'
import { subscribeUiTick } from './uiClock.js'

/**
 * The contracts board.
 *
 * A job differs from a route in whose idea it was. The routes in the planner
 * answer "where do I want to go?"; the contracts answer "what needs doing?" —
 * and the answer is always the honest work of spaceflight: reach orbit, take
 * the plate, phase toward the station, raise the ellipse, brake into lunar
 * orbit. Nothing here shoots at anybody. The realism is not a limit on the
 * game; it is the game — orbital mechanics is the antagonist, and it plays
 * by rules it publishes.
 *
 * Taking a job rides the same machinery as planning a route: the program is
 * armed, the mission resets to the pad with the contract's own site, and the
 * checklist rides the instruments column, ticked off by the simulation. When
 * every line is ticked the board says so — read live off the armed program,
 * the way the checklist itself is.
 */
export function Contracts() {
  const state = useRef(null)

  useEffect(() => {
    const tick = () => {
      const el = state.current
      if (!el) return
      // The armed contract's progress, written straight to the DOM — the same
      // rule the checklist keeps: the board re-renders on take, the ticks
      // move on the clock.
      const done = program.armed && program.def?.contract
        ? program.objectives.filter((o) => o.done).length
        : -1
      const total = program.armed && program.def?.contract ? program.objectives.length : 0
      el.textContent = done < 0 ? '' : done >= total && total > 0 ? 'COMPLETE' : `${done}/${total}`
      el.dataset.done = done >= total && total > 0 ? 'yes' : 'no'
    }
    tick()
    return subscribeUiTick(tick, 2)
  }, [])

  const take = (def) => {
    const current = uiStore.get().site
    // A contract flies from where it makes sense; the pilot's chosen pad
    // stands if the job is indifferent to it.
    selectSite(def.sites.includes(current) ? current : def.sites[0])
    armContract(def)
    resetMission()
    // The setup drawer closes with the job taken — same hand-off the story
    // makes: the setup is over, the checklist rides the instruments.
    setUi({ paused: false, focus: 'ground', broadcast: false, panelOpen: true, setup: false })
  }

  return (
    <div className="panel w-48 rounded-sm p-3.5">
      <div className="rule mb-2.5 border-b border-white/10 pb-2">Contracts</div>
      <div className="space-y-2.5">
        {CONTRACTS.map((c) => {
          const armed = program.armed && program.def?.id === c.id
          return (
            <div key={c.id} className={armed ? 'border-l border-ember pl-2.5' : 'pl-2.5'}>
              <div className="flex items-baseline justify-between gap-2">
                <span className={`text-[12px] ${armed ? 'text-ember' : 'text-white/85'}`}>{c.name}</span>
                {armed && (
                  <span ref={state} data-done="no" className="font-mono text-[9px] tabular-nums text-hud/50">
                    0/{c.objectives.length}
                  </span>
                )}
              </div>
              <p className="mt-1 text-[10px] leading-snug text-hud/50">{c.brief}</p>
              <button
                onClick={() => take(c)}
                className={`control mt-1.5 w-full border px-2 py-1.5 font-mono text-[9px] tracking-[0.18em] uppercase outline-none transition-colors duration-300 focus-visible:border-ember focus-visible:text-ember ${
                  armed
                    ? 'border-ember/60 text-ember'
                    : 'border-hud/20 text-hud/60 hover:border-ember/70 hover:text-ember'
                }`}
              >
                {armed ? 'On this flight' : 'Take the job'}
              </button>
            </div>
          )
        })}
      </div>
      <p className="mt-3 border-t border-white/10 pt-2 text-[9px] leading-relaxed text-white/30">
        Objectives are measured by the flight model, not by the board. Whatever
        the checklist says, the integrator said first.
      </p>
    </div>
  )
}
