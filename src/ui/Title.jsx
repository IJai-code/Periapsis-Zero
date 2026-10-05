import { useMemo, useState } from 'react'
import { AccountButton } from './Account.jsx'
import { Mark } from './Mark.jsx'
import { logbookLine } from '../sim/logbook.js'
import './title.css'

/**
 * The front page: the game's title screen. Plain React and one picture, so it
 * paints at once on anything; the game and the simulator are separate
 * downloads behind their buttons.
 */
export const FEEDBACK_URL = 'https://github.com/IJai-code/Periapsis-Zero/issues/new?template=feedback.md'
const BASE = import.meta.env.BASE_URL
const SAVE_KEY = 'pz-game-v1'

function readSave() {
  try { const s = JSON.parse(localStorage.getItem(SAVE_KEY) ?? 'null'); return s && s.version === 1 && s.pilot ? s : null } catch { return null }
}
/** A phone: too small to fly and read a job board at once. Tablets and computers play. */
function phone() {
  const coarse = window.matchMedia?.('(pointer: coarse)').matches
  return Boolean(coarse && Math.min(window.screen?.width ?? 1e4, window.screen?.height ?? 1e4) < 600)
}

const FEATURES = [
  { img: 'shot-story.webp', title: 'A story with people in it', text: 'Mara runs the docks. Rook holds your debt. Commander Chen wants the Hollow, and he knows what you did at Gateway. Eight missions, one choice that splits them.' },
  { img: 'shot-flight.webp', title: 'Fly it yourself', text: 'Six-axis thrusters and momentum you have to kill. Flight assist holds the velocity you ask for; turn it off and it is you and Newton.' },
  { img: 'shot-heat.webp', title: 'Wanted', text: 'Carry the wrong cargo past a patrol scan and the Lunar Compact comes for you. Break their sight, run cold, or run for the Shackle.' },
  { img: 'shot-transfer.webp', title: 'The real Earth and Moon', text: 'Hearth at L1, Harbor in low orbit, Gateway over the lunar pole. Transfers are true torch-drive brachistochrones: burn, flip at the midpoint, brake.' },
]

export function Title({ onPlay, onNew, onSimulator }) {
  const save = useMemo(readSave, [])
  const isPhone = useMemo(phone, [])
  const [confirmNew, setConfirmNew] = useState(false)
  // A returning simulator pilot is greeted with what they have flown.
  const [flown] = useState(() => logbookLine())
  return <main className="tt-root">
    <div className="tt-art" style={{ backgroundImage: `url(${BASE}game/keyart.webp)` }} />
    <header className="tt-bar">
      <div className="tt-brand"><Mark size={22} /><span>PERIAPSIS ZERO</span></div>
      <nav>
        <button onClick={onSimulator}>Solar system simulator</button>
        <a href={FEEDBACK_URL} target="_blank" rel="noreferrer">Send feedback ↗</a>
        <AccountButton />
      </nav>
    </header>

    <section className="tt-hero">
      <h1>Periapsis<br />Zero</h1>
      <p className="tt-tag">2091. The Moon is the frontier, L1 is the boomtown, and you owe the wrong people forty thousand credits.</p>
      {isPhone ? <div className="tt-phone">
        <strong>The game needs a bigger screen.</strong>
        <p>Periapsis Zero is built for a computer or a tablet: flying and reading a job board at once does not fit on a phone. The simulator works here.</p>
        <button className="tt-play" onClick={onSimulator}>Open the simulator</button>
      </div> : <div className="tt-actions">
        {save && <button className="tt-play" onClick={onPlay}>
          <span>Continue</span>
          <small>{save.pilot.name} · ₡ {Math.round(save.credits).toLocaleString()}{save.story?.active ? ' · mission in progress' : ''}</small>
        </button>}
        {!confirmNew ? <button className={save ? 'tt-second' : 'tt-play'} onClick={() => (save ? setConfirmNew(true) : onNew())}><span>New game</span>{!save && <small>About eight story missions, and an open world after</small>}</button>
          : <div className="tt-confirm"><p>Start over? Your current pilot will be replaced.</p><button className="tt-second" onClick={onNew}>Start a new game</button><button className="tt-link" onClick={() => setConfirmNew(false)}>Keep my pilot</button></div>}
      </div>}
      <p className="tt-devices">Computer: keyboard and mouse · Tablet: touch controls · Free, nothing to install</p>
    </section>

    <section className="tt-features">
      {FEATURES.map((f) => <article key={f.title}>
        <img src={`${BASE}game/${f.img}`} alt="" loading="lazy" onError={(e) => { e.currentTarget.style.visibility = 'hidden' }} />
        <h2>{f.title}</h2>
        <p>{f.text}</p>
      </article>)}
    </section>

    <section className="tt-how">
      <h2>How to play</h2>
      <div>
        <p><strong>Mouse</strong> aims; the ship follows. <strong>W / S</strong> throttle, <strong>Shift</strong> boost, <strong>click</strong> to fire.</p>
        <p><strong>F</strong> docks at a station's lit bay. Missions and jobs are inside. <strong>M</strong> opens the map; <strong>J</strong> transfers.</p>
        <p>The first mission teaches all of it, one thing at a time. <strong>Esc</strong> pauses; <strong>H</strong> shows every control.</p>
      </div>
    </section>

    <section className="tt-sim">
      <div>
        <span className="tt-eyebrow">Also here</span>
        <h2>The real solar system</h2>
        <p>The simulator the game is built on: every planet where it is today, Apollo and Artemis flown on real orbits, and a landing on any of thirteen worlds. It works on phones.</p>
        {flown && <p className="tt-log">Your flight log: {flown}</p>}
        <button className="tt-second" onClick={onSimulator}>Open the simulator</button>
      </div>
      <img src={`${BASE}stills/world-io.webp`} alt="" loading="lazy" />
    </section>

    <footer className="tt-foot">
      <span>Built by Ishaan Jha</span>
      <span>Earth and Moon imagery: NASA · ships and stations built in Blender</span>
      <span>Your game saves in this browser; sign in to keep it everywhere</span>
    </footer>
  </main>
}
