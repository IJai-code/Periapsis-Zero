import { useEffect, useMemo, useRef, useState } from 'react'
import { AccountButton } from './Account.jsx'
import { Mark } from './Mark.jsx'
import { logbookLine } from '../sim/logbook.js'
import { LICENCES, earnedLicences } from '../game/core/pilot.js'
import { realtimeConfig } from '../sim/account.js'
import './title.css'

/**
 * The front page. Plain React and pictures, so it paints at once on
 * anything; the game, the squadron and the simulator are separate
 * downloads behind their buttons.
 *
 * Its argument, top to bottom: a game in the real Earth-Moon system; three
 * ways to fly (the story, a squadron, the simulator); one career across
 * them (licences earned in the simulator count in the game); and the
 * simulator itself, which is still being built.
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
  { img: 'shot-story.webp', title: 'People, not quest givers', text: 'Mara runs the docks. Rook holds your debt. Commander Chen knows what you did at Gateway. Then the Ceres Line arrives. Two acts, thirteen missions, one choice that splits them.' },
  { img: 'shot-flight.webp', title: 'Flown, not driven', text: 'Six-axis thrusters and momentum you have to kill. Barrel-roll out of a burst. Turn flight assist off and it is you and Newton.' },
  { img: 'shot-heat.webp', title: 'Wanted', text: 'Carry the wrong cargo past a patrol scan and the Lunar Compact comes for you. Break their sight, run cold, or run for the Shackle.' },
  { img: 'shot-transfer.webp', title: 'The real Earth and Moon', text: 'Hearth at L1, Harbor in low orbit, Gateway over the lunar pole. Every trip is a true torch-drive transfer: burn, flip at the midpoint, brake.' },
]
const WORLDS = ['moon', 'mars', 'europa', 'titan', 'io', 'mercury', 'venus', 'ganymede', 'callisto', 'phobos', 'deimos', 'pluto', 'halley']
const NAMES = { moon: 'The Moon', halley: "Halley's Comet" }
const SIM_NEWS = [
  ['Thirteen worlds to land on', 'From the Moon and Mars to Titan\'s lakes and the nucleus of Halley\'s Comet, each with its own ground.'],
  ['Apollo and Artemis, flown on real orbits', 'Launch, trans-lunar injection, the far side, and home, with the real burns.'],
  ['The Gateway\'s halo orbit', 'The near-rectilinear halo the Gateway flies, kept by hand.'],
  ['Flight school', 'Four wings, from Trainee (the computer flies) to Kármán (you fly, on 84% of the fuel).'],
]

export function Title({ onPlay, onNew, onSimulator, onSquadron, onLand }) {
  const save = useMemo(readSave, [])
  const isPhone = useMemo(phone, [])
  const [confirmNew, setConfirmNew] = useState(false)
  const [flown] = useState(() => logbookLine())
  const earned = useMemo(() => earnedLicences(), [])
  const root = useRef(null)
  // Sections ease in as they scroll into view; once each.
  useEffect(() => {
    const els = root.current?.querySelectorAll('.tt-reveal') ?? []
    if (!('IntersectionObserver' in window)) { els.forEach((e) => e.classList.add('in')); return }
    const io = new IntersectionObserver((list) => list.forEach((x) => { if (x.isIntersecting) { x.target.classList.add('in'); io.unobserve(x.target) } }), { threshold: 0.12 })
    els.forEach((e) => io.observe(e))
    return () => io.disconnect()
  }, [])
  // How many pilots are in the shared sky right now: presence on one room,
  // read without joining it as a pilot. Opened after the page has painted.
  const [flying, setFlying] = useState(null)
  useEffect(() => {
    const cfg = realtimeConfig()
    if (!cfg) return
    let room = null
    const t = setTimeout(() => import('../game/net/realtime.js').then(({ connectRoom }) => {
      room = connectRoom({ url: cfg.url, key: cfg.key, room: 'pz-online', id: `v${Math.random().toString(36).slice(2, 9)}`, track: false })
      room.onPresence = (r) => setFlying(r.size)
    }).catch(() => {}), 1200)
    return () => { clearTimeout(t); room?.close() }
  }, [])
  const land = (id) => (onLand ? onLand(id) : (window.location.hash = `#land/${id}`))
  return <main className="tt-root" ref={root}>
    <div className="tt-art" style={{ backgroundImage: `url(${BASE}game/keyart.webp)` }} />
    <header className="tt-bar">
      <div className="tt-brand"><Mark size={22} /><span>PERIAPSIS ZERO</span></div>
      <nav>
        <button onClick={onSquadron}>Squadron</button>
        <button onClick={onSimulator}>Simulator</button>
        <a href={FEEDBACK_URL} target="_blank" rel="noreferrer">Feedback ↗</a>
        <AccountButton />
      </nav>
    </header>

    <section className="tt-hero">
      <span className="tt-kicker">A shared, real Earth-Moon system{flying > 0 && <em className="tt-live"><i />{flying} {flying === 1 ? 'pilot' : 'pilots'} flying now</em>}</span>
      <h1><span>Periapsis</span><span>Zero</span></h1>
      <p className="tt-tag">2091. You survived a convoy that should never have been found. Now you owe your rescuer forty thousand credits, and someone out there knows why.</p>
      {isPhone ? <div className="tt-phone">
        <strong>The game needs a bigger screen.</strong>
        <p>Flying and reading a job board at once does not fit on a phone: play on a computer or a tablet. The simulator works here, and what you fly in it counts in the game later.</p>
        <button className="tt-play" onClick={onSimulator}><span>Open the simulator</span></button>
      </div> : <div className="tt-actions">
        {save && <button className="tt-play" onClick={onPlay}>
          <span>Continue</span>
          <small>{save.pilot.name} · ₡ {Math.round(save.credits).toLocaleString()}{save.story?.active ? ' · mission in progress' : ''}</small>
        </button>}
        {!confirmNew ? <button className={save ? 'tt-second' : 'tt-play'} onClick={() => (save ? setConfirmNew(true) : onNew())}><span>New game</span><small>{save ? 'A new pilot, from the start' : 'Two acts of story, and an open world after'}</small></button>
          : <div className="tt-confirm"><p>Start over? Your current pilot will be replaced.</p><button className="tt-second" onClick={onNew}>Start a new game</button><button className="tt-link" onClick={() => setConfirmNew(false)}>Keep my pilot</button></div>}
        <button className="tt-second tt-sq" onClick={onSquadron}><span>Squadron</span><small>Waves of raiders. Bots, or friends with a code</small></button>
      </div>}
      <p className="tt-devices">Computer: keyboard and mouse · Tablet: touch controls · Free, nothing to install</p>
      <span className="tt-scroll" aria-hidden>Scroll</span>
    </section>

    <section className="tt-pillars tt-reveal">
      <h2>What makes it different</h2>
      <ol>
        <li><b>01</b><strong>One live sky</strong><span>Every pilot playing flies in the same Earth-Moon system at once. At Hearth you see who else is at Hearth, by name and suit, and hail them.</span></li>
        <li><b>02</b><strong>Real flight, flown</strong><span>The Earth and Moon where they really are, Newtonian ships, and transfers you fly yourself: hold the burn, call the flip, get graded.</span></li>
        <li><b>03</b><strong>One career, two cockpits</strong><span>Licences come from the simulator next door: make orbit, reach the Moon, land, come home, and your game pilot is promoted.</span></li>
        <li><b>04</b><strong>A squadron in a link</strong><span>Share five letters and friends are flying beside you in seconds. No accounts, nothing to install.</span></li>
      </ol>
    </section>

    <section className="tt-ways tt-reveal">
      <h2>Three ways to fly</h2>
      <div>
        <article onClick={save ? onPlay : onNew}>
          <img src={`${BASE}game/shot-hangar.webp`} alt="" loading="lazy" />
          <span className="tt-eyebrow">The game</span>
          <h3>Make a living</h3>
          <p>Pick a suit, walk out to your ship, and work the lanes alongside every other pilot online: couriers, salvage, smuggling, bounties, and a story with a choice in it.</p>
        </article>
        <article onClick={onSquadron}>
          <img src={`${BASE}game/shot-squadron.webp`} alt="" loading="lazy" onError={(e) => { e.currentTarget.src = `${BASE}game/shot-flight.webp` }} />
          <span className="tt-eyebrow">Squadron</span>
          <h3>Hold the sky</h3>
          <p>Four ships against waves of raiders and an ace every third wave. Fly with AI wingmates, or share a five-letter code and friends take their seats.</p>
        </article>
        <article onClick={onSimulator}>
          <img src={`${BASE}stills/world-mars.webp`} alt="" loading="lazy" />
          <span className="tt-eyebrow">The companion</span>
          <h3>The real thing</h3>
          <p>The simulator the game is built on: the whole solar system where it is today, Apollo and Artemis on real orbits, and landings on thirteen worlds. Works on phones.</p>
        </article>
      </div>
    </section>

    <section className="tt-career tt-reveal">
      <div className="tt-career-text">
        <span className="tt-eyebrow">One career, two cockpits</span>
        <h2>Earn your licences in the simulator. Wear them in the game.</h2>
        <p>Make orbit, cross to the Moon, dock, lift off the lunar surface, bring a crew home: each one, flown for real in the simulator, puts a pilot licence in your game pilot's pocket, a suit in their locker and a signing bonus in their account.</p>
        <button className="tt-second" onClick={onSimulator}><span>Earn one now</span><small>Opens the simulator</small></button>
      </div>
      <ol className="tt-licences">
        {LICENCES.map((l, i) => <li key={l.id} className={earned.has(l.id) ? 'on' : ''} style={{ animationDelay: `${i * 0.08}s` }}>
          <b>{earned.has(l.id) ? '✓' : i + 1}</b>
          <span><strong>{l.name}</strong><small>{earned.has(l.id) ? 'Earned' : l.earn.replace(' in the Simulator', '')}</small></span>
          <em>₡ {l.bonus.toLocaleString()}</em>
        </li>)}
      </ol>
    </section>

    <section className="tt-features tt-reveal">
      {FEATURES.map((f) => <article key={f.title}>
        <img src={`${BASE}game/${f.img}`} alt="" loading="lazy" onError={(e) => { e.currentTarget.style.visibility = 'hidden' }} />
        <h2>{f.title}</h2>
        <p>{f.text}</p>
      </article>)}
    </section>

    <section className="tt-how tt-reveal">
      <h2>How to play</h2>
      <div>
        <p><strong>Mouse</strong> aims; the ship follows. <strong>hold W</strong> to fly, release to brake, <strong>Shift</strong> boost, <strong>click</strong> to fire, <strong>double-tap A or D</strong> to barrel-roll.</p>
        <p><strong>F</strong> docks at a station's lit bay; missions and jobs are inside. <strong>M</strong> opens the map; <strong>J</strong> lights the drive.</p>
        <p>A two-minute narrated prologue tells you why you are here. The first mission teaches the ship, one thing at a time. <strong>Esc</strong> pauses; <strong>H</strong> shows every control.</p>
      </div>
    </section>

    <section className="tt-sim tt-reveal">
      <header>
        <span className="tt-eyebrow">The simulator</span>
        <h2>Land anywhere. It is all real.</h2>
        <p>Every planet and moon where it is today, real stars, real orbits. Pick a world and you are on its surface in a lander.</p>
        {flown && <p className="tt-log">Your flight log: {flown}</p>}
      </header>
      <div className="tt-worlds">
        {WORLDS.map((w) => <button key={w} onClick={() => land(w)}>
          <img src={`${BASE}stills/world-${w}.webp`} alt="" loading="lazy" />
          <span>{NAMES[w] ?? w[0].toUpperCase() + w.slice(1)}</span>
        </button>)}
      </div>
      <div className="tt-news">
        <h3>Still flying: the simulator keeps getting updates</h3>
        <ul>{SIM_NEWS.map(([t, d]) => <li key={t}><strong>{t}</strong><span>{d}</span></li>)}</ul>
        <button className="tt-play" onClick={onSimulator}><span>Open the simulator</span><small>Solar system, flight school, landings</small></button>
      </div>
    </section>

    <footer className="tt-foot">
      <span>Built by Ishaan Jha</span>
      <span>Earth and Moon imagery: NASA · ships, stations and pilots built in Blender · detail textures: Poly Haven (CC0)</span>
      <span>Saves live in this browser; sign in to keep them on every device</span>
    </footer>
  </main>
}
