import { useState } from 'react'
import { setUi, useUi } from '../sim/store.js'
import { Mark } from './Mark.jsx'
import { LANDABLE, WORLDS } from '../sim/worlds.js'

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
export function Nav({ onMap, onLogbook, onLibrary, campaign = false }) {
  const map = useUi((s) => s.map)
  const broadcast = useUi((s) => s.broadcast)
  const setup = useUi((s) => s.setup)
  const boards = useUi((s) => s.boards)
  const [more, setMore] = useState(false)
  // Where the Land menu opens: under its button (the row scrolls, so it is measured, not nested).
  const [landAt, setLandAt] = useState(null)

  const clean = !boards && !setup && !map && !broadcast
  const board = (id) => () => { setMore(false); setUi((s) => ({ boards: s.boards === id ? null : id })) }

  /*
   * Two modes, one menu bar. The campaign shows only the ways out; free flight
   * shows the six things people use, and keeps the rest one click away under
   * More, instead of eleven words in a row.
   */
  const items = campaign ? [
    { id: 'home', label: '← home', on: false, go: () => { window.location.hash = '' } },
    { id: 'campaign', label: 'campaign', on: true, go: () => setUi({ boards: null, map: false }) },
    { id: 'free', label: 'free simulator', on: false, go: () => { window.location.hash = '#flight' } },
  ] : [
    { id: 'home', label: '← home', on: false, go: () => { window.location.hash = '' } },
    { id: 'campaign', label: 'campaign', on: false, go: () => { window.location.hash = '#campaign' } },
    { id: 'land', label: 'land ▾', on: Boolean(landAt), go: (e) => { setMore(false); const r = e.currentTarget.getBoundingClientRect(); setLandAt((v) => v ? null : r.left) } },
    { id: 'flight', label: 'fly', on: clean, go: () => setUi({ boards: null, setup: false, map: false, broadcast: false }) },
    { id: 'library', label: 'missions', on: false, go: onLibrary },
    { id: 'map', label: 'map · m', on: map, go: onMap },
    { id: 'logbook', label: 'logbook', on: false, go: onLogbook },
    { id: 'setup', label: 'settings · s', on: setup, go: () => setUi((s) => ({ setup: !s.setup, boards: null })) },
  ]
  const extra = [
    { id: 'almanac', label: "Today's sky", go: board('almanac') },
    { id: 'contracts', label: 'Contracts', go: board('contracts') },
    { id: 'story', label: 'Career', go: board('story') },
    { id: 'feed', label: 'TV view · B', go: () => { setMore(false); setUi((s) => ({ broadcast: !s.broadcast, map: false })) } },
  ]

  return (
    <div className="pointer-events-auto absolute inset-x-0 top-0 z-30 flex h-10 items-center gap-3 border-b border-hud/15 bg-void/60 px-3 backdrop-blur-[10px]">
      <div className="flex shrink-0 items-center gap-2">
        <Mark size={17} />
        <span className="font-display text-[11px] leading-none tracking-[0.28em] text-hud/85">PERIAPSIS ZERO</span>
      </div>
      <nav className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto">
        {items.map((it) => (
          <button key={it.id} onClick={it.go} aria-current={it.on ? 'page' : undefined}
            className={`control shrink-0 rounded-sm px-2.5 py-1.5 text-[10px] tracking-[0.16em] uppercase outline-none focus-visible:text-ember ${it.on ? 'lit text-ember' : 'text-hud/65 hover:text-ember'}`}>
            {it.label}
          </button>
        ))}
        {!campaign && <div className="relative shrink-0">
          <button onClick={() => { setLandAt(null); setMore((m) => !m) }} aria-expanded={more} className={`control rounded-sm px-2.5 py-1.5 text-[10px] tracking-[0.16em] uppercase outline-none ${more || boards || broadcast ? 'text-ember' : 'text-hud/65 hover:text-ember'}`}>more ▾</button>
        </div>}
      </nav>
      {landAt !== null && <div className="fixed top-10 z-40 grid max-h-[70vh] grid-cols-2 gap-0.5 overflow-y-auto rounded-sm border border-hud/15 bg-void/95 p-1" style={{ left: `min(${Math.round(landAt)}px, calc(100vw - 300px))`, width: 290 }} role="menu" aria-label="Land on a world">
        {LANDABLE.map((id) => <button key={id} role="menuitem" onClick={() => { setLandAt(null); setUi({ focus: id, map: false, boards: null, surface: { world: id, mode: 'free' } }) }} className="control px-3 py-2 text-left text-[11px] tracking-[0.12em] text-hud/80 uppercase hover:text-ember">{WORLDS[id].name}</button>)}
      </div>}
      {more && <div className="fixed top-10 z-40 flex flex-col rounded-sm border border-hud/15 bg-void/95 p-1" style={{ left: 'min(560px, 60vw)' }} role="menu">
        {extra.map((it) => <button key={it.id} role="menuitem" onClick={it.go} className="control px-4 py-2 text-left text-[11px] tracking-[0.12em] text-hud/80 uppercase hover:text-ember">{it.label}</button>)}
      </div>}
    </div>
  )
}
