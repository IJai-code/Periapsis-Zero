import { useState, useSyncExternalStore } from 'react'
import { expeditionRecord, REGIONS, subscribeExpeditions } from '../sim/expedition.js'
import { logbookLine } from '../sim/logbook.js'
import { hasProfile, pilotLabel, pilotProfile, saveProfile, subscribePilot } from '../sim/pilot.js'
import { Mark } from './Mark.jsx'

/**
 * Where players report problems. GitHub's issue form, with a template that
 * asks the three things a bug report needs. Nothing is collected
 * automatically: the site keeps no analytics, so this link is the one way to
 * hear that something is wrong.
 */
export const FEEDBACK_URL = 'https://github.com/IJai-code/Periapsis-Zero/issues/new?template=feedback.md'

/** Frames from the game itself, made by scripts/stills.mjs. */
const STILLS = `${import.meta.env.BASE_URL}stills/`

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
    <header className="mode-header"><div className="front-brand"><Mark size={24} /><span>PERIAPSIS ZERO</span></div><div className="mode-header-links"><a href={FEEDBACK_URL} target="_blank" rel="noreferrer">Send feedback ↗</a><button className="quiet-button" onClick={openProfile}>{label ? `Pilot / ${label}` : 'Add your name'}</button></div></header>
    <section className="front-hero"><span className="eyebrow">A space flight game in your browser</span><h1>Land on the Moon,<br /><span>Mars and Europa.</span></h1><p>Fly the lander down, walk and drive around, collect samples,<br className="desktop-break" /> and take off again. Real gravity, limited fuel.</p><div className="hero-actions"><button className="action-button primary" onClick={() => onExpedition('moon')}>Start on the Moon <span>↗</span></button><span>Takes about 10 minutes · Landing assist is on<br />Mouse and keyboard, or touch</span></div></section>
    <section className="mode-choices" aria-label="Choose your experience">
      <article className="mode-choice exploration"><div className="mode-choice-label"><span>01 / Expeditions</span><span>Free play</span></div><h2>Pick a world<br />and land.</h2><p>Land, explore on foot or by rover, set up instruments and fly home.</p><div className="world-preview" aria-hidden>{Object.values(REGIONS).map((r) => <img key={r.id} src={`${STILLS}${r.id}.webp`} alt="" loading="lazy" decoding="async" className={region === r.id ? 'shown' : ''} />)}</div><div className="world-picker" aria-label="Expedition destination">{Object.values(REGIONS).map((r) => <button key={r.id} aria-pressed={region === r.id} onClick={() => setRegion(r.id)} className={region === r.id ? 'selected' : ''}>{r.name}{record.surveys[r.id] && <span aria-label="Survey completed"> ✓</span>}</button>)}</div><button className="mode-launch" onClick={() => onExpedition(region)}>Explore {REGIONS[region].name}<span>→</span></button></article>
      <article className="mode-choice"><div className="mode-choice-label"><span>02 / Story</span><span>Three missions</span></div><h2>One survey team,<br />three worlds.</h2><p>A short campaign with a briefing before each landing. Finish one mission to unlock the next.</p><div className="story-strip" aria-hidden>{Object.keys(REGIONS).map((id) => <img key={id} src={`${STILLS}${id}.webp`} alt="" loading="lazy" decoding="async" />)}</div><div className="mode-detail">Moon → Mars → Europa<br />Progress is saved in this browser</div><button className="mode-launch" onClick={onStory}>Start the story<span>→</span></button></article>
      <article className="mode-choice"><div className="mode-choice-label"><span>03 / Simulator</span><span>Real missions</span></div><h2>The real<br />solar system.</h2><p>Fly Apollo and Artemis missions with real orbital physics, or sit back and watch the flight computer do it.</p><div className="world-preview" aria-hidden><img src={`${STILLS}simulator.webp`} alt="" loading="lazy" decoding="async" className="shown" /></div><div className="mode-detail">15 historical missions · real planet positions today<br />{greeted ?? welcome ?? 'For space fans: deeper and more technical'}</div><button className="mode-launch" onClick={onEnter}>Open the simulator<span>→</span></button></article>
    </section>
    <footer className="front-footer"><span>Built by Ishaan Jha</span><span>Early release · found a bug? <a href={FEEDBACK_URL} target="_blank" rel="noreferrer">Tell me</a></span><span>Spacecraft models from NASA, public domain</span><span>No account. Nothing to install.</span></footer>
    {editing && <div className="pilot-dialog" role="dialog" aria-modal="true" aria-labelledby="pilot-title">
      <section>
        <span className="eyebrow">Pilot</span>
        <h2 id="pilot-title">What should we call you?</h2>
        <p>Your name is only saved in this browser and is never sent anywhere. It is optional.</p>
        <label htmlFor="pilot-name">Name</label>
        <input id="pilot-name" value={draft} maxLength={24} autoFocus placeholder="Who is flying" onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false) }} />
        <div className="modal-actions"><button className="action-button primary" onClick={commit}>Save</button><button className="action-button" onClick={() => setEditing(false)}>Cancel</button>{pilot.name && <button className="action-button" onClick={() => { saveProfile({ name: '', callsign: '' }); setEditing(false) }}>Clear</button>}</div>
      </section>
    </div>}
  </main>
}
