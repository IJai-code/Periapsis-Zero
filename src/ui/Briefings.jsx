import { useMemo } from 'react'
import { almanacBriefings, skyOf } from '../sim/almanac.js'
import { program } from '../sim/programs.js'
import { live } from '../sim/live.js'
import { INDEX } from '../sim/system.js'
import { beginDef } from './beginDef.js'

/**
 * The Almanac board.
 *
 * The numbers in these briefs were measured by the simulation at the moment
 * the page opened: the station gap, tonight's lunar distance, an eclipse if
 * one is in the sky. Generated once at mount and stable for the session
 * (the sky does not re-write a brief mid-flight), each one arms like any
 * program and rides the same checklist. Read again tomorrow and the board
 * is different, because the sky is.
 */
export function Briefings() {
  const board = useMemo(() => almanacBriefings(skyOf(live, INDEX)), [])
  const armedId = program.armed ? program.def?.id : null

  return (
    <div className="panel w-48 rounded-sm p-3.5">
      <div className="rule mb-2.5 border-b border-white/10 pb-2">The Almanac</div>
      <p className="mb-2.5 text-[10px] leading-snug text-hud/45">
        Missions the sky wrote tonight: measured from the state the sim is
        flying right now. Tomorrow's board is a different board.
      </p>
      <div className="space-y-2.5">
        {board.map((c) => {
          const armed = armedId === c.id
          return (
            <div key={c.id} className={armed ? 'border-l border-ember pl-2.5' : 'pl-2.5'}>
              <div className="flex items-baseline justify-between gap-2">
                <span className={`text-[12px] ${armed ? 'text-ember' : 'text-white/85'}`}>{c.name}</span>
                <span className="font-mono text-[9px] text-ion/70">tonight</span>
              </div>
              <p className="mt-1 text-[10px] leading-snug text-hud/50">{c.brief}</p>
              <button
                onClick={() => beginDef(c)}
                className={`control mt-1.5 w-full border px-2 py-1.5 font-mono text-[9px] tracking-[0.18em] uppercase outline-none transition-colors duration-300 focus-visible:border-ember focus-visible:text-ember ${
                  armed
                    ? 'border-ember/60 text-ember'
                    : 'border-hud/20 text-hud/60 hover:border-ember/70 hover:text-ember'
                }`}
              >
                {armed ? 'On this flight' : 'Take the brief'}
              </button>
            </div>
          )
        })}
      </div>
      <p className="mt-3 border-t border-white/10 pt-2 text-[9px] leading-relaxed text-white/30">
        The numbers are the integrator's own, quoted at boot. Objectives are
        measured by the flight, the same as every job on every board.
      </p>
    </div>
  )
}
