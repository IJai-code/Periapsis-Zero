import { useState } from 'react'
import { setDestination, startTransfer, transferBlock, tripCost } from '../core/game.js'
import { PLACES, PLACE_ORDER, STATIONS } from '../core/world.js'
import { storyNext } from '../core/story.js'
import { CHARACTERS } from '../core/story.js'
import { play } from '../audio.js'

/**
 * The map of the Earth-Moon system. Not to scale (the Moon's neighbourhood
 * would be a dot): positions are schematic, distances and times are real.
 */
const SPOT = { harbor: [17, 52], hearth: [70, 50], drift: [72, 30], gateway: [86, 24], shackleton: [88, 78], vesper: [12, 24], arbor: [40, 82], citadel: [62, 88] }

export function MapView({ game: g, touch, onClose }) {
  const [sel, setSel] = useState(g.dest ?? (g.place === 'hearth' ? 'harbor' : 'hearth'))
  const p = PLACES[sel]
  const here = g.place === sel
  const cost = here ? null : tripCost(g, sel)
  const why = g.mode === 'flight' && !here ? transferBlock(g, sel) : null
  const waiting = storyNext(g)
  const objectivePlace = g.objective?.place
  const tank = g.player.stats.tank ?? 1
  const h = (s) => `${Math.floor(s / 3600)} h ${String(Math.floor(s % 3600 / 60)).padStart(2, '0')} min`
  return <div className="map-root" role="dialog" aria-label="Map">
    <header><h1>The system and the deep lanes</h1><button className="map-close" onClick={onClose}>Close{!touch && <kbd className="gk">M</kbd>}</button></header>
    <div className="map-body">
      <div className="map-chart">
        <div className="map-earth" style={{ left: '6%', top: '50%' }}><span>Earth</span></div>
        <div className="map-moon" style={{ left: '88%', top: '52%' }}><span>Moon</span></div>
        <svg className="map-lines" viewBox="0 0 100 100" preserveAspectRatio="none">
          <line x1="6" y1="50" x2="88" y2="52" />
          {sel && !here && <line className="route" x1={SPOT[g.place]?.[0] ?? 50} y1={SPOT[g.place]?.[1] ?? 50} x2={SPOT[sel][0]} y2={SPOT[sel][1]} />}
        </svg>
        {PLACE_ORDER.map((id) => <button key={id} className={`map-place ${sel === id ? 'on' : ''} ${g.place === id ? 'here' : ''} ${objectivePlace === id ? 'goal' : ''}`} style={{ left: `${SPOT[id][0]}%`, top: `${SPOT[id][1]}%` }} onClick={() => { setSel(id); play('click') }}>
          <i />
          <span>{PLACES[id].name}{g.place === id && <em>You are here</em>}{objectivePlace === id && <em className="goal">Objective</em>}</span>
        </button>)}
        <p className="map-scale">Schematic. Earth to Moon is 384,400 km; the deep lanes are a hundred times further.</p>
      </div>
      <aside className="map-info">
        <span className="st-eyebrow">{p.where}</span>
        <h2>{p.name}</h2>
        <p>{p.blurb}</p>
        {Object.values(STATIONS).filter((s) => s.place === sel).map((s) => <p key={s.id} className="map-dock">Dock: {s.name}{s.faction === 'compact' ? ' (Lunar Compact)' : s.faction === 'hollow' ? ' (no flag)' : ''}</p>)}
        {waiting.filter((m) => STATIONS[m.at].place === sel).map((m) => <p key={m.id} className="map-story">Mission: {m.title}, from {CHARACTERS[m.giver].name}</p>)}
        {g.jobs.filter((j) => j.place === sel || STATIONS[j.to].place === sel).map((j) => <p key={j.id} className="map-job">Job: {j.title}</p>)}
        {cost && <dl>
          <div><dt>Distance</dt><dd>{Math.round(cost.D / 1000).toLocaleString()} km</dd></div>
          <div><dt>Ship time</dt><dd>{h(cost.T)} at {(g.player.stats.drive / 9.80665).toFixed(1)} g</dd></div>
          <div><dt>Delta-v</dt><dd>{(cost.dv / 1000).toFixed(1)} km/s</dd></div>
        </dl>}
        {cost && <div className="map-tank"><span>Propellant</span><b><i style={{ width: `${Math.min(100, g.ship.prop / tank * 100)}%` }} /><em style={{ left: `${Math.max(0, (g.ship.prop - cost.dv) / tank * 100)}%`, width: `${Math.min(100, cost.dv / tank * 100)}%` }} /></b></div>}
        {here ? <p className="map-note">You are here.</p> : <>
          <button className="st-primary" onClick={() => { setDestination(g, sel); play('click'); if (g.mode !== 'flight') onClose() }}>{g.dest === sel ? 'Destination set' : 'Set as destination'}</button>
          {g.mode === 'flight' && <button className="st-primary go" disabled={Boolean(why)} onClick={() => { setDestination(g, sel); if (!startTransfer(g, sel)) onClose() }}>{why ?? `Transfer now${touch ? '' : ' (J)'}`}</button>}
          {g.mode === 'docked' && <p className="map-note">Launch first; then transfer with {touch ? 'the action button' : 'J'}.</p>}
        </>}
      </aside>
    </div>
  </div>
}
