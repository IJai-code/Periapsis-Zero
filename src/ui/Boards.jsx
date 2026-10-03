import { useEffect } from 'react'
import { setUi, useUi } from '../sim/store.js'
import { Story } from './Story.jsx'
import { Briefings } from './Briefings.jsx'
import { Contracts } from './Contracts.jsx'

/**
 * The board window.
 *
 * The boards were written for a moment between flights: read, choose, take
 * the job, and the drawer they lived in closed itself. That is right for the
 * things a pilot sets and wrong for the things a pilot reads, so the three
 * boards that are read rather than set (the story, the Almanac, the contracts)
 * have a window of their own now, over the live scene rather than away from
 * it. The sky keeps moving behind the board you are reading, which is the one
 * thing a board about the sky should have.
 *
 * A window and not a page: the flight does not pause behind it, and Esc, the
 * close label or Flight puts it away. Beginning a flight closes it too, from
 * the same path that closes the drawer, because beginning a flight is the
 * moment the reading ends.
 */
const TABS = [
  { id: 'story', label: 'flight school' },
  { id: 'almanac', label: 'almanac' },
  { id: 'contracts', label: 'contracts' },
]

export function Boards() {
  const tab = useUi((s) => s.boards)

  /* Esc closes the window, and only while it is up: a key that is live when
     nothing is open is a key that eats clicks from the flight. */
  useEffect(() => {
    if (!tab) return
    const onKey = (e) => {
      if (e.key === 'Escape') setUi({ boards: null })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [tab])

  if (!tab) return null

  return (
    <div className="pointer-events-auto absolute top-[3.75rem] left-1/2 z-20 flex w-[21rem] max-w-[calc(100vw-2rem)] -translate-x-1/2 flex-col items-stretch gap-2">
      <div className="panel flex items-center gap-1 rounded-sm px-2 py-1.5">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setUi({ boards: t.id })}
            className={`control rounded-sm px-2.5 py-1.5 text-[9px] tracking-[0.2em] uppercase outline-none focus-visible:text-ember ${
              tab === t.id ? 'lit text-ember' : 'text-hud/45 hover:text-ember'
            }`}
          >
            {t.label}
          </button>
        ))}
        <button
          onClick={() => setUi({ boards: null })}
          title="Back to flying (Esc)"
          className="control ml-auto rounded-sm px-2.5 py-1.5 text-[9px] tracking-[0.2em] text-hud/35 uppercase outline-none hover:text-ember focus-visible:text-ember"
        >
          close · esc
        </button>
      </div>
      {/* The boards keep their own panel and their own width; the container
          only stretches them to the window, the same trick the setup drawer
          plays with the same three components. */}
      <div className="max-h-[calc(100vh-13rem)] overflow-y-auto [&>div]:w-full">
        {tab === 'story' ? <Story /> : tab === 'almanac' ? <Briefings /> : <Contracts />}
      </div>
    </div>
  )
}
