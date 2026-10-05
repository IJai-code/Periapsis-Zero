import { useState, useSyncExternalStore } from 'react'
import { hasProfile, pilotLabel, pilotProfile, saveProfile, subscribePilot } from '../sim/pilot.js'
import { LANDABLE, WORLDS } from '../sim/worlds.js'
import { campaignState, completedCount, nextWorld, subscribeCampaign, totalStars } from '../sim/campaign.js'
import { logbookLine } from '../sim/logbook.js'
import { Mark } from './Mark.jsx'
import { AccountButton } from './Account.jsx'
import './home.css'

/**
 * Where players report problems: GitHub's issue form with a template. The
 * site keeps no analytics, so this is how we hear that something is wrong.
 * Linked once, in the header.
 */
export const FEEDBACK_URL = 'https://github.com/IJai-code/Periapsis-Zero/issues/new?template=feedback.md'

/** Renders of each world, path traced in Blender from the game's own assets (art/story). */
const STILLS = `${import.meta.env.BASE_URL}stills/`

/** One line a world, for the gallery. */
const HOOK = {
  moon: 'Where it starts.', mars: 'Layered canyons and an old lake.', phobos: 'Mars fills half the sky.', mercury: 'Ice beside the Sun.',
  venus: 'Eight minutes before the heat wins.', io: 'Lava lakes and sulfur.', europa: 'An ocean under the ice.', ganymede: 'The magnetic moon.',
  callisto: 'The oldest ground there is.', titan: 'Methane lakes under orange skies.', pluto: 'Glaciers of nitrogen.', halley: 'Ride a comet.', deimos: 'A moon you could jump off.',
}

export function Landing({ onCampaign, onSimulator, onLand }) {
  const pilot = useSyncExternalStore(subscribePilot, pilotProfile, pilotProfile)
  const campaign = useSyncExternalStore(subscribeCampaign, campaignState, campaignState)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  // A returning visitor is greeted with what they have flown.
  const [flown] = useState(() => logbookLine())
  const label = pilotLabel()
  const done = completedCount(campaign)
  const next = nextWorld(campaign)
  const started = done > 0 || Object.keys(campaign.worlds).length > 0

  const openProfile = () => { setDraft(pilot.name); setEditing(true) }
  const commit = () => { saveProfile({ name: draft, callsign: pilot.callsign }); setEditing(false) }

  return <main className="home">
    <header className="home-bar">
      <div className="home-brand"><Mark size={24} /><span>PERIAPSIS ZERO</span></div>
      <nav className="home-links">
        <a href={FEEDBACK_URL} target="_blank" rel="noreferrer">Send feedback ↗</a>
        <AccountButton />
        <button className="home-link" onClick={openProfile}>{label ? `Pilot · ${label}` : 'Add your name'}</button>
      </nav>
    </header>

    <section className="home-hero">
      <span className="home-eyebrow">A space game on the real solar system</span>
      <h1>Land anywhere in the solar system.</h1>
      <p>Thirteen worlds at their real gravity, in their real places today. Fly the campaign to choose where humanity builds its first station beyond the Moon, or take the simulator and go anywhere.</p>
      <div className="home-modes">
        <button className="home-mode primary" onClick={onCampaign}>
          <span className="home-mode-label">{started ? 'Continue the campaign' : 'Play the campaign'}</span>
          <strong>Station Zero</strong>
          <span className="home-mode-detail">{started ? `${done} of 12 worlds · ${totalStars(campaign)} ★${next ? ` · next: ${WORLDS[next].name}` : ''}` : '12 worlds · about 5 minutes each · assist on'}</span>
        </button>
        <button className="home-mode" onClick={onSimulator}>
          <span className="home-mode-label">Free play</span>
          <strong>The simulator</strong>
          <span className="home-mode-detail">Real orbits · Apollo and Artemis missions · land on any world in view</span>
        </button>
      </div>
      <p className="home-hint">{hasProfile() ? `Welcome back, ${pilot.name}. ` : ''}{flown ? `Flight log: ${flown}` : 'Keyboard and mouse, or touch. Nothing to install.'}</p>
    </section>

    <section className="home-worlds" aria-labelledby="worlds-title">
      <div className="home-section-head">
        <h2 id="worlds-title">Or land right now</h2>
        <p>Every world below is a real place in the simulator. Pick one and you start on final approach.</p>
      </div>
      <ul>
        {LANDABLE.map((id) => {
          const w = WORLDS[id], stars = campaign.worlds[id]?.stars ?? 0
          return <li key={id}>
            <button className="home-world" onClick={() => onLand(id)}>
              <img src={`${STILLS}world-${id}.webp`} alt="" loading="lazy" decoding="async" onError={(e) => { e.currentTarget.style.visibility = 'hidden' }} />
              <span className="home-world-text">
                <strong>{w.name}</strong>
                <span>{HOOK[id]}</span>
                <small>{w.gravity < 0.1 ? w.gravity.toFixed(4) : w.gravity.toFixed(2)} m/s²{w.air ? ' · air' : ''}{stars ? ` · ${'★'.repeat(stars)}` : ''}</small>
              </span>
            </button>
          </li>
        })}
      </ul>
    </section>

    <section className="home-how" aria-labelledby="how-title">
      <h2 id="how-title">How a mission goes</h2>
      <ol>
        <li><strong>Land.</strong> Fly the lander onto the pad. Assist can do it; doing it yourself scores more.</li>
        <li><strong>Survey.</strong> Drive the rover to samples, scan for hidden finds, set up a station. Hold Shift to warp time.</li>
        <li><strong>Lift off.</strong> Get scored, earn science, upgrade the lander and rover, and unlock the next world.</li>
      </ol>
    </section>

    <footer className="home-foot">
      <span>Built by Ishaan Jha</span>
      <span>Spacecraft in the simulator: NASA, public domain · surfaces and vehicles built in Blender</span>
      <span>Progress saves in this browser · sign in to keep it everywhere</span>
    </footer>

    {editing && <div className="pilot-dialog" role="dialog" aria-modal="true" aria-labelledby="pilot-title">
      <section>
        <span className="eyebrow">Pilot</span>
        <h2 id="pilot-title">What should we call you?</h2>
        <p>Your name is only saved in this browser and is never sent anywhere unless you sign in. It is optional.</p>
        <label htmlFor="pilot-name">Name</label>
        <input id="pilot-name" value={draft} maxLength={24} autoFocus placeholder="Who is flying" onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false) }} />
        <div className="modal-actions"><button className="action-button primary" onClick={commit}>Save</button><button className="action-button" onClick={() => setEditing(false)}>Cancel</button>{pilot.name && <button className="action-button" onClick={() => { saveProfile({ name: '', callsign: '' }); setEditing(false) }}>Clear</button>}</div>
      </section>
    </div>}
  </main>
}
