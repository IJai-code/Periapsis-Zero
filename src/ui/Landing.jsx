import { useState, useSyncExternalStore } from 'react'
import { expeditionRecord, REGIONS, subscribeExpeditions } from '../sim/expedition.js'
import { logbookLine } from '../sim/logbook.js'
import { hasProfile, pilotLabel, pilotProfile, saveProfile, subscribePilot } from '../sim/pilot.js'
import { Mark } from './Mark.jsx'

export function Landing({ onEnter, onStory, onExpedition }) {
  const [region, setRegion] = useState('moon')
  const record = useSyncExternalStore(subscribeExpeditions, expeditionRecord, expeditionRecord)
  const pilot = useSyncExternalStore(subscribePilot, pilotProfile, pilotProfile)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [welcome] = useState(() => { const line = logbookLine(); return line ? `Flight log: ${line}` : null })
  const label = pilotLabel()
  const greeted = hasProfile() ? `Welcome back, ${pilot.name}.` : null

  const openProfile = () => { setDraft(pilot.name); setEditing(true) }
  const commit = () => { saveProfile({ name: draft, callsign: pilot.callsign }); setEditing(false) }

  return <main className="front-door">
    <header className="mode-header"><div className="front-brand"><Mark size={24} /><span>PERIAPSIS ZERO</span></div><div className="mode-header-links"><a href="https://github.com/IJai-code/Periapsis-Zero" target="_blank" rel="noreferrer">An independent space game ↗</a><button className="quiet-button" onClick={openProfile}>{label ? `Pilot / ${label}` : 'Add your name'}</button></div></header>
    <section className="front-hero"><span className="eyebrow">Flight. Contact. Discovery.</span><h1>Space is a place.<br /><span>Go there.</span></h1><p>Take the controls, set down on another world,<br className="desktop-break" /> and find out what is beyond the landing site.</p><div className="hero-actions"><button className="action-button primary" onClick={() => onExpedition('moon')}>Fly your first descent <span>↗</span></button><span>Moon · Landing assist on<br />Mouse, keyboard, or touch</span></div></section>
    <section className="mode-choices" aria-label="Choose your experience">
      <article className="mode-choice exploration"><div className="mode-choice-label"><span>01 / Expeditions</span><span>Play freely</span></div><h2>Pick a world.<br />Leave your ship.</h2><p>Land, survey, explore, and take off again. A fictional lander with finite fuel and real gravity.</p><div className="world-picker" aria-label="Expedition destination">{Object.values(REGIONS).map((r) => <button key={r.id} aria-pressed={region === r.id} onClick={() => setRegion(r.id)} className={region === r.id ? 'selected' : ''}>{r.name}{record.surveys[r.id] && <span aria-label="Survey completed"> ✓</span>}</button>)}</div><button className="mode-launch" onClick={() => onExpedition(region)}>Explore {REGIONS[region].name}<span>→</span></button></article>
      <article className="mode-choice"><div className="mode-choice-label"><span>02 / Story</span><span>Survey division</span></div><h2>The ground<br />truth.</h2><p>Three authored flights. A small crew, paired samples, and questions that orbital images cannot answer.</p><div className="mode-detail">Moon → Mars → Europa<br />Chapter progress saved locally</div><button className="mode-launch" onClick={onStory}>Open the campaign<span>→</span></button></article>
      <article className="mode-choice"><div className="mode-choice-label"><span>03 / Simulator</span><span>Historical & sandbox</span></div><h2>The whole system.<br />The real numbers.</h2><p>Apollo and Artemis missions, orbital planning, and a true-scale solar system. Watch the flight computer or take control.</p><div className="mode-detail">N-body flight · measured ephemerides<br />{greeted ?? welcome ?? 'Historical mission library included'}</div><button className="mode-launch" onClick={onEnter}>Enter simulator<span>→</span></button></article>
    </section>
    <footer className="front-footer"><span>Built by Ishaan Jha</span><span>Early playable release · 3 procedural survey regions</span><span>Spacecraft meshes from NASA, public domain</span><span>No account. No download.</span></footer>
    {editing && <div className="pilot-dialog" role="dialog" aria-modal="true" aria-labelledby="pilot-title">
      <section>
        <span className="eyebrow">Pilot</span>
        <h2 id="pilot-title">Sign your logbook.</h2>
        <p>Stored in this browser only. Nothing is sent anywhere, and the game works exactly the same without it.</p>
        <label htmlFor="pilot-name">Name</label>
        <input id="pilot-name" value={draft} maxLength={24} autoFocus placeholder="Who is flying" onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false) }} />
        <div className="modal-actions"><button className="action-button primary" onClick={commit}>Save</button><button className="action-button" onClick={() => setEditing(false)}>Cancel</button>{pilot.name && <button className="action-button" onClick={() => { saveProfile({ name: '', callsign: '' }); setEditing(false) }}>Clear</button>}</div>
      </section>
    </div>}
  </main>
}
