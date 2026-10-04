import { setUi, useUi } from '../sim/store.js'
import { Mark } from './Mark.jsx'

/**
 * The menu bar: one row across the top that says what there is to open.
 *
 * Every door in this product existed already and none of them were visible.
 * The story, the Almanac and the contracts board lived inside the setup
 * drawer; the logbook was a button in the bottom bar; the map and the feed
 * were keys. That is a cockpit, and a cockpit is the right shape for a
 * vehicle, but it is also the one thing a new pilot cannot read. The
 * reference is a game's menu bar: the whole product across the top, every
 * destination named, so the first five seconds say what there is to do.
 *
 * The row is the shell and not the flight, so it stays through the boards,
 * the map and the walk (the walk folds the instruments away, not the doors).
 * Each label wears its key where one exists, so a shortcut is taught by the
 * thing it replaces. Flight is the way home: it closes whatever is open and
 * leaves the pilot with the sky.
 */
export function Nav({ onMap, onLogbook, onLibrary }) {
  const map = useUi((s) => s.map)
  const broadcast = useUi((s) => s.broadcast)
  const setup = useUi((s) => s.setup)
  const boards = useUi((s) => s.boards)

  const clean = !boards && !setup && !map && !broadcast
  const board = (id) => () => setUi((s) => ({ boards: s.boards === id ? null : id }))

  /*
   * Plain words, and one door per thing. This row had eleven entries,
   * including two that sounded alike and went to different places
   * ("campaign" left the simulator for the surface story; "flight school"
   * opened the simulator's own career), and a "mode select" that was the way
   * home under another name. The surface campaign is reached from Home, which
   * is now first and says what it is.
   */
  const items = [
    { id: 'home', label: '← home', on: false, go: () => { window.location.hash = '' } },
    {
      id: 'flight',
      label: 'fly',
      on: clean,
      go: () => setUi({ boards: null, setup: false, map: false, broadcast: false }),
    },
    { id: 'library', label: 'missions', on: false, go: onLibrary },
    { id: 'story', label: 'career', on: boards === 'story', go: board('story') },
    { id: 'almanac', label: "today's sky", on: boards === 'almanac', go: board('almanac') },
    { id: 'contracts', label: 'contracts', on: boards === 'contracts', go: board('contracts') },
    { id: 'logbook', label: 'logbook', on: false, go: onLogbook },
    { id: 'map', label: 'map · m', on: map, go: onMap },
    {
      id: 'feed',
      label: 'tv view · b',
      on: broadcast,
      go: () => setUi((s) => ({ broadcast: !s.broadcast, map: false })),
    },
    {
      id: 'setup',
      label: 'settings · s',
      on: setup,
      go: () => setUi((s) => ({ setup: !s.setup, boards: null })),
    },
  ]

  return (
    <div className="pointer-events-auto absolute inset-x-0 top-0 z-30 flex h-10 items-center gap-3 border-b border-hud/15 bg-void/60 px-3 backdrop-blur-[10px]">
      <div className="flex shrink-0 items-center gap-2">
        <Mark size={17} />
        <span className="font-display text-[11px] leading-none tracking-[0.28em] text-hud/85">
          PERIAPSIS ZERO
        </span>
      </div>
      <nav className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto">
        {items.map((it) => (
          <button
            key={it.id}
            onClick={it.go}
            aria-current={it.on ? 'page' : undefined}
            className={`control shrink-0 rounded-sm px-2.5 py-1.5 text-[10px] tracking-[0.16em] uppercase outline-none focus-visible:text-ember ${it.on ? 'lit text-ember' : 'text-hud/60 hover:text-ember'}`}
          >
            {it.label}
          </button>
        ))}
      </nav>
    </div>
  )
}
