import { useMemo, useState, useSyncExternalStore } from 'react'
import { almanacBriefings, skyOf } from '../sim/almanac.js'
import { program } from '../sim/programs.js'
import { live } from '../sim/live.js'
import { INDEX } from '../sim/system.js'
import { uiStore } from '../sim/store.js'
import { beginDef } from './beginDef.js'

/**
 * Tonight's sky, as notices.
 *
 * The Almanac writes briefs from the sky the simulation is actually flying,
 * and it lived inside the setup drawer, which meant the world had to be doing
 * something interesting where nobody could see it. These are the same briefs
 * as cards on the rail, the way a game puts the world's news where the eye
 * already is: each measured at boot from the same state the board quotes,
 * dismissible for the session, and taking one arms the same flight the board
 * would.
 *
 * Dismissing is local and honest. The board keeps all of them, tomorrow's sky
 * writes a different set, and nothing here is a notification about a
 * notification: no sound, no badge, no pulse. Just the sky, offering.
 */
export function Notices() {
  const board = useMemo(() => almanacBriefings(skyOf(live, INDEX)), [])
  const [gone, setGone] = useState(() => new Set())
  /*
   * Re-render when a flight is armed or cleared. Arming always goes through
   * the store (the drawer closes, the camera drops to the pad), which is the
   * cheapest honest signal there is; the cards themselves never tick.
   */
  useSyncExternalStore(
    uiStore.subscribe,
    () => Boolean(program.armed && program.def),
    () => false,
  )
  const armedId = program.armed ? program.def?.id : null
  const cards = board.filter((c) => !gone.has(c.id))
  if (cards.length === 0) return null

  return (
    <div className="panel w-60 rounded-sm p-3.5">
      <div className="rule mb-2.5 border-b border-white/10 pb-2">
        Tonight's sky · {cards.length} brief{cards.length === 1 ? '' : 's'}
      </div>
      <div className="space-y-2.5">
        {cards.map((c) => {
          const armed = armedId === c.id
          return (
            <div key={c.id} className={armed ? 'border-l border-ember pl-2.5' : 'pl-2.5'}>
              <div className="flex items-baseline justify-between gap-2">
                <span className={`text-[12px] ${armed ? 'text-ember' : 'text-white/85'}`}>{c.name}</span>
                <button
                  onClick={() => setGone(new Set([...gone, c.id]))}
                  title="Dismiss for this session"
                  className="control shrink-0 rounded-sm px-1.5 text-[10px] leading-none text-hud/35 outline-none hover:text-ember focus-visible:text-ember"
                >
                  ×
                </button>
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
    </div>
  )
}
