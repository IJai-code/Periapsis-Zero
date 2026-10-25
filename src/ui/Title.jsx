import { useEffect, useMemo, useRef, useState } from 'react'
import { AccountButton } from './Account.jsx'
import { Mark } from './Mark.jsx'
import { logbookLine } from '../sim/logbook.js'
import { LICENCES, earnedLicences } from '../game/core/pilot.js'
import './title.css'

export const FEEDBACK_URL = 'https://github.com/IJai-code/Periapsis-Zero/issues/new?template=feedback.md'
const BASE = import.meta.env.BASE_URL
// The Godot prologue at full quality, published by scripts/godot-build.mjs desktop.
const DESKTOP = 'https://github.com/IJai-code/Periapsis-Zero/releases/download/desktop/'
function readSave() {
  try { const s = JSON.parse(localStorage.getItem('pz-game-v1') ?? 'null'); return s?.version === 1 && s.pilot ? s : null } catch { return null }
}
// Phones and tablets alike: the game needs a keyboard and mouse.
// The desktop download that suits this computer, best guess.
function desktopDownload() {
  const ua = navigator.userAgent
  if (/Windows/i.test(ua)) return { name: 'Windows', file: 'PeriapsisZero-windows.zip' }
  if (/Linux/i.test(ua) && !/Android/i.test(ua)) return { name: 'Linux', file: 'PeriapsisZero-linux.tar.gz' }
  return { name: 'Mac', file: 'PeriapsisZero-mac.zip' }
}
function phone() { return Boolean(window.matchMedia?.('(pointer: coarse)').matches || navigator.maxTouchPoints > 1 && !window.matchMedia?.('(pointer: fine)').matches) }
const TRAINING = [
  { id: 'orbit', title: '01 / Make orbit', text: 'Watch the launch sequence, follow the flight computer and reach a stable Earth orbit.', preset: 'apollo8-launch', vessel: 'apollo8', site: 'ksc', image: 'game/sim-pad.jpg', tag: 'Start here · Earth', action: 'Start orbital training' },
  { id: 'lunar', title: '02 / Cross to the Moon', text: 'Join Apollo 8 at trans-lunar ignition. Follow the burn and learn why the departure window matters.', preset: 'apollo8-tli', vessel: 'apollo8', site: 'ksc', image: 'game/sim-moon.jpg', tag: 'Burn planning · Apollo 8', action: 'Start translunar training' },
  { id: 'rendezvous', title: '03 / Meet another craft', text: 'Eagle brakes toward Columbia. Follow the closing speed and docking sequence above the Moon.', preset: 'apollo11-docking', vessel: 'apollo11', site: 'tranquility', image: 'game/sim-docking.jpg', tag: 'Precision flight · Apollo 11', action: 'Start rendezvous training' },
  { id: 'lander', title: '04 / Leave the surface', text: 'Lift off from Tranquility Base, reach lunar orbit and meet the command module.', preset: 'apollo11-liftoff', vessel: 'apollo11', site: 'tranquility', image: 'game/sim-ascent.jpg', tag: 'Lunar ascent · Apollo 11', action: 'Start lunar ascent training' },
  { id: 'splashdown', title: '05 / Bring them home', text: 'Join the crew before re-entry. Follow the corridor, parachutes and Pacific splashdown.', preset: 'apollo8-reentry', vessel: 'apollo8', site: 'ksc', image: 'game/sim-entry.jpg', tag: 'Atmospheric entry · Apollo 8', action: 'Start homecoming training' },
]
const WORLDS = ['moon', 'mars', 'europa', 'titan', 'io', 'mercury', 'venus', 'ganymede', 'callisto', 'phobos', 'deimos', 'pluto', 'halley']
const worldName = (id) => id === 'moon' ? 'The Moon' : id === 'halley' ? "Halley's Comet" : id[0].toUpperCase() + id.slice(1)

export function Title({ onPlay, onNew, onSimulator, onSquadron, onLand, training = false }) {
  const save = useMemo(readSave, [])
  const earned = useMemo(() => earnedLicences(), [])
  const isPhone = useMemo(phone, [])
  const download = useMemo(desktopDownload, [])
  const flown = useMemo(() => logbookLine(), [])
  const [tab, setTab] = useState(training ? 'training' : 'career')
  const [confirm, setConfirm] = useState(false)
  useEffect(() => {
    const boot = document.getElementById('boot')
    boot?.classList.add('boot-done')
    const timer = setTimeout(() => boot?.remove(), 700)
    return () => clearTimeout(timer)
  }, [])
  const next = TRAINING.find((t) => !earned.has(t.id)) ?? TRAINING[0]
  const newGame = () => save && !confirm ? setConfirm(true) : onNew()
  if (tab === 'career') return <Landing {...{ save, isPhone, download, flown, confirm, setConfirm, newGame, onPlay, onNew, onSimulator, onSquadron, setTab }} />
  return <main className="tt-root">
    <header className="tt-bar">
      <a className="tt-brand" href="#" aria-label="Periapsis Zero home"><Mark size={26} /><span>PERIAPSIS ZERO<small>FLIGHT OPERATIONS</small></span></a>
      <nav aria-label="Flight operations">
        <button className={tab === 'career' ? 'on' : ''} onClick={() => setTab('career')}>Career</button>
        <button className={tab === 'training' ? 'on' : ''} onClick={() => setTab('training')}>Flight school</button>
        <button className={tab === 'worlds' ? 'on' : ''} onClick={() => setTab('worlds')}>Explore</button>
        <AccountButton />
      </nav>
    </header>
    <div className={`tt-dashboard ${save || earned.size ? '' : 'tt-fresh'}`}>
      {(save || earned.size > 0) && <aside className="tt-pilot">
        <span className="tt-eyebrow">Pilot record / local save</span>
        <h2>{save?.pilot.name ?? 'New pilot'}</h2>
        <p>{save ? 'Your career is safe. Training records and licences belong to this same pilot journey.' : 'A ship. A living. A way home. Start your career or learn the real flight mechanics first.'}</p>
        <dl><div><dt>Credits</dt><dd>₡ {Math.round(save?.credits ?? 0).toLocaleString()}</dd></div><div><dt>Licences</dt><dd>{earned.size} / {LICENCES.length}</dd></div><div><dt>Story missions</dt><dd>{save?.story?.done?.length ?? 0}</dd></div></dl>
        <div className="tt-licence-list">{LICENCES.map((l) => <div key={l.id} className={earned.has(l.id) ? 'earned' : ''}><b>{earned.has(l.id) ? '✓' : '○'}</b><span>{l.name}</span><small>₡ {l.bonus.toLocaleString()}</small></div>)}</div>
        {save && <button className="tt-primary control" onClick={onPlay}>Return to career →</button>}
        <small className="tt-record">{flown ? `Flight log: ${flown}` : 'Progress saves in this browser.'}<br />Training awards unlock suits and one-time career bonuses.</small>
      </aside>}
      <div className="tt-content">
        {tab === 'career' && <>
          <section className="tt-hero" style={{ backgroundImage: `url(${BASE}game/keyart-reach.jpg)` }}>
            <div className="tt-hero-copy"><span className="tt-eyebrow">A mystery in the Reach / 3091</span><h1>Periapsis<br /><em>Zero</em></h1>
              <p className="tt-hook">Every twenty-two minutes the star dies and the same morning comes back. Only you remember. And Rook.</p>
              <p>A tiny solar system on real orbits. Fly the Kestrel between five small worlds, listen for signals, read what the Choir left behind, and find out why the morning keeps coming back. What you learn is all you keep. In your browser, or downloaded at full quality.</p>
              {isPhone ? <><p className="tt-device-note">The game and its prologue need a computer with a keyboard and mouse. Flight school and surface exploration work on this device.</p><button className="tt-primary control" onClick={() => setTab('training')}>Enter flight school →</button></> : <>
                <div className="tt-actions">
                  {/* The game is the Godot build (game/, published to /play/); #reach goes straight in. */}
                  <a className="tt-primary tt-begin control" href={`${BASE}play/index.html#reach`}>Enter the Reach →</a>
                  <a className="tt-secondary control" href={`${DESKTOP}${download.file}`}>Download for {download.name}</a>
                </div>
                <p className="tt-downloads">Plays in the browser, about 100 MB the first time. Or download for <a href={`${DESKTOP}PeriapsisZero-mac.zip`}>Mac</a>, <a href={`${DESKTOP}PeriapsisZero-windows.zip`}>Windows</a> or <a href={`${DESKTOP}PeriapsisZero-linux.tar.gz`}>Linux</a>. <a className="tt-help-link" href="#install" onClick={(e) => { e.preventDefault(); document.getElementById('install')?.scrollIntoView({ behavior: 'smooth' }) }}>How to open the download</a></p>
                <p className="tt-career">{save ? <>Already flying? <button onClick={onPlay}>Continue your career</button> or <button onClick={newGame}>start a new pilot</button>.</> : <>Rather fly and fight? <button onClick={newGame}>Start a career</button> in the original flight game.</>}</p>
                {confirm && <div className="tt-confirm" role="alert"><p>Replace your saved career with a new pilot?</p><button className="tt-primary control" onClick={onNew}>Replace career</button><button className="tt-secondary control" onClick={() => setConfirm(false)}>Keep my pilot</button></div>}
              </>}
            </div>
            <div className="tt-hero-coordinate" aria-hidden>HEARTH VILLAGE<br />HEARTHSTONE / THE REACH</div>
          </section>
          <section className="tt-briefing"><div><span className="tt-eyebrow">The Reach / one loop, five worlds, one song</span><h2>How it goes.</h2><p>You wake by Hearth&rsquo;s campfire. Mara has your launch codes. After that there are no waypoints: only rumours in your ship&rsquo;s log, signals on your scope, and twenty-two minutes before the star (the Lantern) goes out. The road here, the prologue and Act One, is on the game&rsquo;s title screen.</p></div><ol><li><b>01</b><span><strong>Hearthstone</strong>A village of forty round a campfire, a banjo, an observatory, and past the lake an old mine with writing on its far wall.</span></li><li><b>02</b><span><strong>Verdance</strong>Sandstone pillars and waterfalls, and a harmonica on the Travellers frequency that nobody in Hearth plays.</span></li><li><b>03</b><span><strong>Ashfall</strong>The Aster&rsquo;s wreck in a grey crater, Rook&rsquo;s drones sweeping it with searchlights, her captain&rsquo;s recorder still talking.</span></li><li><b>04</b><span><strong>The Phantom</strong>A little moon that is never where you left it, unless you keep its picture.</span></li><li><b>05</b><span><strong>The Wanderer</strong>A comet that dives past the Lantern at twenty and a half minutes. Something on it has been waiting a long time.</span></li></ol></section>
          {!isPhone && <section className="tt-install" id="install" aria-labelledby="install-title">
            <header><span className="tt-eyebrow">Installing the download</span><h2 id="install-title">Opening the game on your computer</h2><p>The desktop builds are not signed yet, so your computer will warn you the first time you open one. It is safe to continue. Here is how, once per download.</p></header>
            <div className="tt-install-grid">
              <article><h3>Mac</h3><ol>
                <li>Open the downloaded zip and drag <b>Periapsis Zero</b> into Applications.</li>
                <li>Open it. When macOS says it could not verify the app, click <b>Done</b>.</li>
                <li>Go to <b>System Settings</b>, then <b>Privacy &amp; Security</b>. Scroll to Security and click <b>Open Anyway</b>, then confirm.</li>
                <li>Open the game again and choose <b>Open</b>.</li>
              </ol><p className="tt-install-alt">No Open Anyway button? In Terminal run <code>xattr -dr com.apple.quarantine "/Applications/Periapsis Zero.app"</code></p></article>
              <article><h3>Windows</h3><ol>
                <li>If your browser flags the download, choose <b>Keep</b>.</li>
                <li>Right-click the zip and choose <b>Extract All</b>.</li>
                <li>Run <b>PeriapsisZero.exe</b>. If Windows shows &ldquo;Windows protected your PC&rdquo;, click <b>More info</b>, then <b>Run anyway</b>.</li>
              </ol></article>
              <article><h3>Linux</h3><ol>
                <li>Extract it: <code>tar -xzf PeriapsisZero-linux.tar.gz</code></li>
                <li>Make it runnable: <code>chmod +x PeriapsisZero.x86_64</code></li>
                <li>Start it: <code>./PeriapsisZero.x86_64</code> (needs a graphics driver with Vulkan).</li>
              </ol></article>
            </div>
            <p className="tt-install-note">You only do this once. From now on the game updates itself: new versions download in the background while you play and start the next time you open it, with your progress kept. Once the developer account is set up and the builds are signed, these steps will no longer be needed: the game will open like any other app.</p>
          </section>}
          <section className="tt-paths" aria-label="Choose your next flight">
            <button className="tt-path control" onClick={() => setTab('training')}><img src={`${BASE}game/sim-pad.jpg`} alt="A Saturn V on the pad at Kennedy, in the simulator" /><span className="tt-eyebrow">Same career / real physics</span><h2>Train to fly</h2><p>Five simulator licences. New suits. ₡ 27,000 in career bonuses.</p><strong>Open flight school →</strong></button>
            <button className="tt-path control" onClick={onSquadron}><img src={`${BASE}game/art-raid.jpg`} alt="Hollow raiders closing on a freighter against a red nebula" /><span className="tt-eyebrow">Combat / separate wave mode</span><h2>Hold the sky</h2><p>Squadron combat with AI wingmates or friends by invitation code.</p><strong>Enter Squadron →</strong></button>
          </section>
        </>}
        {tab === 'training' && <section className="tt-school">
          <header className="tt-section-head"><span className="tt-eyebrow">Flight school / career companion</span><h1>Real flight.<br />Lasting progress.</h1><p>Choose a training scenario below. The simulator flies its historical mission sequence; its milestone records award your licences. Return to the career and claim each bonus in Pilot.</p><div className="tt-actions"><a className="tt-primary control" href={`?preset=${next.preset}&vessel=${next.vessel}&site=${next.site}#flight`}>Next licence: {LICENCES.find((l) => l.id === next.id).name} →</a><button className="tt-secondary control" onClick={onSimulator}>Open simulator sandbox</button></div></header>
          <div className="tt-training-grid">{TRAINING.map((t) => { const l = LICENCES.find((l) => l.id === t.id); return <article key={t.id} className={`tt-training ${earned.has(t.id) ? 'earned' : ''}`}><img src={`${BASE}${t.image}`} alt="" /><div><span className="tt-eyebrow">{earned.has(t.id) ? '✓ Licence earned' : t.tag}</span><h2>{t.title}</h2><p>{t.text}</p><small>{l.earn} Bonus: ₡ {l.bonus.toLocaleString()}.</small><a className="tt-secondary control" href={`?preset=${t.preset}&vessel=${t.vessel}&site=${t.site}#flight`}>{t.action} →</a></div></article> })}</div>
          <p className="tt-training-note">This is a true-scale simulator, not the career’s torch-drive flight model. The flight computer sequences the historical burns. Use Missions for more scenarios, Settings for flight controls, and Career to return. Existing deep links still work.</p>
        </section>}
        {tab === 'worlds' && <section className="tt-explore"><header className="tt-section-head"><span className="tt-eyebrow">Surface expeditions / simulator</span><h1>Thirteen worlds.<br />Different gravity.</h1><p>Land, collect samples, deploy instruments and lift off. Regional procedural terrain and authored survey hardware; not a seamless planetary open world.</p><button className="tt-secondary control" onClick={onSimulator}>Explore the orbital sandbox →</button></header><div className="tt-worlds">{WORLDS.map((w) => <button className="control" key={w} onClick={() => onLand(w)}><img src={`${BASE}stills/world-${w}.webp`} alt="" loading="lazy" /><span>{worldName(w)}<small>Start surface expedition →</small></span></button>)}</div></section>}
        <footer className="tt-foot"><span>Built by Ishaan Jha · NASA Earth and Moon imagery</span><a href={FEEDBACK_URL} target="_blank" rel="noreferrer">Report a problem ↗</a><span>Ships and stations authored in Blender · saves stored locally</span></footer>
      </div>
    </div>
  </main>
}

// The front door, framed like the game's own title: Hearth's lake under the
// nebulae, the logo top left, the menu under it in big friendly words, a
// little planet by the line you point at, links at the foot.
function Logo() {
  return <h1 className="lp-logo" aria-label="Periapsis Zero">
    <span className="lp-logo-top" aria-hidden>Periapsis</span>
    <span className="lp-logo-main" aria-hidden>ZER<svg className="lp-planet" viewBox="-120 -80 240 160" aria-hidden>
      <ellipse cx="0" cy="0" rx="104" ry="34" transform="rotate(-18)" fill="none" stroke="#3a2618" strokeWidth="20" />
      <ellipse cx="0" cy="0" rx="104" ry="34" transform="rotate(-18)" fill="none" stroke="#ffb36b" strokeWidth="9" />
      <defs>
        <clipPath id="lp-orbit-far"><rect x="-130" y="-60" width="260" height="60" /></clipPath>
        <clipPath id="lp-orbit-near"><rect x="-130" y="0" width="260" height="60" /></clipPath>
      </defs>
      {/* The far half of its orbit: the ship goes behind the planet, so it is drawn first. */}
      <g transform="rotate(-18)" clipPath="url(#lp-orbit-far)"><circle r="9" fill="#3a2618"><animateMotion dur="9s" repeatCount="indefinite" path="M 104 0 A 104 34 0 1 1 -104 0 A 104 34 0 1 1 104 0" /></circle><circle r="6" fill="#e8853d"><animateMotion dur="9s" repeatCount="indefinite" path="M 104 0 A 104 34 0 1 1 -104 0 A 104 34 0 1 1 104 0" /></circle></g>
      <circle r="66" fill="#3a2618" />
      <circle r="56" fill="#6fa86a" />
      <circle cx="14" cy="12" r="40" fill="#5b9459" />
      <circle cx="-18" cy="-18" r="20" fill="#9fd08e" />
      <circle cx="20" cy="-26" r="8" fill="#fbf1dc" opacity=".8" />
      <path d="M -104 0 A 104 34 0 0 0 104 0" transform="rotate(-18)" fill="none" stroke="#3a2618" strokeWidth="20" />
      <path d="M -104 0 A 104 34 0 0 0 104 0" transform="rotate(-18)" fill="none" stroke="#ffb36b" strokeWidth="9" />
      {/* The near half of its orbit: the ship in front of the planet. */}
      <g transform="rotate(-18)" clipPath="url(#lp-orbit-near)"><circle r="9" fill="#3a2618"><animateMotion dur="9s" repeatCount="indefinite" path="M 104 0 A 104 34 0 1 1 -104 0 A 104 34 0 1 1 104 0" /></circle><circle r="6" fill="#e8853d"><animateMotion dur="9s" repeatCount="indefinite" path="M 104 0 A 104 34 0 1 1 -104 0 A 104 34 0 1 1 104 0" /></circle></g>
    </svg></span>
  </h1>
}

/** How to play: the goal, the first steps, the keys, and the game's words, in plain language. */
function HowToPlay({ onClose }) {
  const close = useRef()
  useEffect(() => {
    const k = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', k)
    // The panel owns the screen: the page behind it does not scroll, and
    // the first thing a keyboard reaches is its way out.
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    close.current?.focus()
    return () => { window.removeEventListener('keydown', k); document.body.style.overflow = overflow }
  }, [onClose])
  return <div className="lp-help" role="dialog" aria-modal="true" aria-labelledby="lp-help-title" onClick={onClose}>
    <div className="lp-help-card" onClick={(e) => e.stopPropagation()}>
      <button ref={close} className="lp-help-x" onClick={onClose} aria-label="Close">×</button>
      <h2 id="lp-help-title">How to play</h2>
      <h3>The goal</h3>
      <p>You are a pilot who crashed on a little world called Hearthstone while escorting a freighter, the Aster. Every twenty-two minutes the star at the middle of this tiny solar system dies and the same morning comes back. Nobody remembers it but you, and Rook, whose drones brought the Aster down. What you learn is the only thing you keep, so each morning you get a little further toward the Engine on the comet, and the choice of what the morning becomes.</p>
      <h3>Your first few minutes</h3>
      <ol>
        <li>Follow the marker to Mara by the fire, look at her and press <kbd>E</kbd>. (A marker always shows where to go next.)</li>
        <li>Mara gives you the launch codes. (Every morning after the first, you wake already in the ship&rsquo;s seat.)</li>
        <li>Ride the lift up the launch tower, and climb into your ship through the hatch underneath (<kbd>E</kbd>).</li>
        <li>Hold <kbd>Space</kbd> to lift off. Look at a world, press <kbd>T</kbd> to lock onto it and <kbd>G</kbd> to fly there by autopilot.</li>
        <li>Near a world, let go of everything and the ship holds still. Hold <kbd>Shift</kbd> to land gently. <kbd>E</kbd> steps out.</li>
        <li>Find out what the Aster carried, take it from her vault on Ashfall, and bring it to the Engine on the comet when its door opens (about 20:30). Rook will be waiting with an offer.</li>
      </ol>
      <h3>Keys</h3>
      <div className="lp-help-keys">
        <p><kbd>W A S D</kbd> walk or fly · <kbd>Mouse</kbd> look and steer · <kbd>Space</kbd> jump (hold for higher) / lift off · <kbd>Shift</kbd> run / sink and land</p>
        <p><kbd>E</kbd> talk, use, read · <kbd>X</kbd> signalscope · <kbd>L</kbd> ship log · <kbd>M</kbd> map · <kbd>T</kbd> lock a world · <kbd>G</kbd> autopilot · <kbd>P</kbd> photograph · <kbd>F</kbd> torch · <kbd>V</kbd> first or third person · <kbd>H</kbd> help in the game · <kbd>Esc</kbd> pause and every key</p>
      </div>
      <h3>Words you will meet</h3>
      <dl>
        <dt>Your ship</dt><dd>the Kestrel, a small two-engine craft parked on the launch tower.</dd>
        <dt>The star</dt><dd>the Lantern. The five worlds go round it. It is dying.</dd>
        <dt>The Reach</dt><dd>this little solar system: Hearthstone (home), Verdance (jungle), Ashfall (a volcanic moon), the Phantom (a moon that moves) and the Wanderer (a comet).</dd>
        <dt>Ship log</dt><dd>your notebook (<kbd>L</kbd>): everything you have learned, and where it points next.</dd>
        <dt>Signalscope</dt><dd>hears beacons, old recordings and the drones (<kbd>X</kbd>). Turn toward the loudest and follow it.</dd>
        <dt>The Founders</dt><dd>Hearth&rsquo;s first settlers, a century ago. They left recorders all over the Reach: look at one and press <kbd>E</kbd> to play it.</dd>
        <dt>Rook</dt><dd>whose drones brought the Aster down. He remembers the mornings too, and he wants the core.</dd>
        <dt>The core</dt><dd>what the Aster carried. Once you take it, it stays with you through every morning.</dd>
        <dt>The Phantom</dt><dd>a moon that jumps when nobody watches it. Lock onto it with <kbd>T</kbd> and it holds still.</dd>
      </dl>
    </div>
  </div>
}

function Landing({ save, isPhone, download, flown, confirm, setConfirm, newGame, onPlay, onNew, onSimulator, onSquadron, setTab }) {
  const toInstall = (e) => { e.preventDefault(); document.getElementById('install')?.scrollIntoView({ behavior: 'smooth' }) }
  const [help, setHelp] = useState(false)
  return <main className="tt-root lp-root">
    {help && <HowToPlay onClose={() => setHelp(false)} />}
    <section className="lp-hero" style={{ backgroundImage: `url(${BASE}game/landing-lake.jpg)` }}>
      <nav className="lp-top" aria-label="More">
        <button className="lp-top-help" onClick={() => setHelp(true)}>How to play</button>
        <AccountButton />
      </nav>
      <div className="lp-left">
        <Logo />
        <p className="lp-tag">Every twenty-two minutes the star dies and the same morning comes back. Only you remember. And Rook.</p>
        <p className="lp-goal">Fly a little ship between five tiny worlds on real orbits, and reach the Engine before Rook does.</p>
        <ul className="lp-menu">
          {/* One game on the front page: the Reach. The older projects are a
              line at the bottom ("More from this project"). */}
          {isPhone
            ? <li className="lp-note">The game needs a keyboard and mouse. Come back on a computer, or try the orbital simulator below.</li>
            : <>
              {/* The game is the Godot build (game/, published to /play/); #reach goes straight in. */}
              <li><a href={`${BASE}play/index.html#reach`}>Play in your browser</a></li>
              <li><a href={`${DESKTOP}${download.file}`}>Download for {download.name}</a></li>
            </>}
        </ul>
      </div>
      <div className="lp-links">
        {!isPhone && <p>Free in your browser, about 105 MB the first time · also for <a href={`${DESKTOP}PeriapsisZero-mac.zip`}>Mac</a>, <a href={`${DESKTOP}PeriapsisZero-windows.zip`}>Windows</a> and <a href={`${DESKTOP}PeriapsisZero-linux.tar.gz`}>Linux</a> · <a href="#install" onClick={toInstall}>how to open the download</a></p>}
        <p className="lp-more">More from this project: <button onClick={onSimulator}>the orbital simulator</button> · <button onClick={() => setTab('training')}>Apollo flight school</button> · <button onClick={onSquadron}>Squadron</button> · {save ? <>your career in the original flight game (<button onClick={onPlay}>continue</button>)</> : <button onClick={newGame}>the original flight game</button>}{flown ? ` · Flight log: ${flown}` : ''}</p>
        {confirm && <p className="lp-confirm" role="alert">Replace your saved career with a new pilot? <button onClick={onNew}>Replace it</button> <button onClick={() => setConfirm(false)}>Keep my pilot</button></p>}
      </div>
      <div className="lp-version">Periapsis Zero · The Reach · early build</div>
    </section>
    <section className="lp-worlds" aria-labelledby="lp-worlds-title">
      <h2 id="lp-worlds-title">Five small worlds, one loop</h2>
      <p className="lp-lede">You wake by Hearth&rsquo;s campfire. After that there are no waypoints: only rumours in your ship&rsquo;s log, signals on your scope, and twenty-two minutes before the star (the Lantern) goes out.</p>
      <ol>
        <li><strong>Hearthstone</strong>A village in a crater: houses on stilts, a lake and a pier, a waterfall, an observatory, and your ship on top of the launch tower. Isa&rsquo;s ring course for the Kestrel runs round its walls, and every morning stones fall from the dying star.</li>
        <li><strong>Verdance</strong>Sandstone pillars and waterfalls, and a harmonica on the Travellers frequency that nobody in Hearth plays.</li>
        <li><strong>Ashfall</strong>The Aster&rsquo;s wreck in a grey crater, drones sweeping it with searchlights, her captain&rsquo;s recorder still talking.</li>
        <li><strong>The Phantom</strong>A little moon that is never where you left it, unless you keep its picture.</li>
        <li><strong>The Wanderer</strong>A comet that dives past the Lantern at twenty and a half minutes. Something on it has been waiting a long time.</li>
      </ol>
    </section>
    {!isPhone && <section className="lp-install" id="install" aria-labelledby="install-title">
      <h2 id="install-title">Opening the download</h2>
      <p className="lp-lede">The desktop builds aren&rsquo;t signed yet, so your computer will warn you the first time. It&rsquo;s safe to continue; you only do this once, and after that the game updates itself.</p>
      <div className="lp-install-grid">
        <article><h3>Mac</h3><ol>
          <li>Open the zip and drag <b>Periapsis Zero</b> into Applications.</li>
          <li>Open it. When macOS says it could not verify the app, click <b>Done</b>.</li>
          <li>In <b>System Settings › Privacy &amp; Security</b>, click <b>Open Anyway</b>, then confirm.</li>
        </ol><p className="lp-small">No Open Anyway button? In Terminal: <code>xattr -dr com.apple.quarantine &quot;/Applications/Periapsis Zero.app&quot;</code></p></article>
        <article><h3>Windows</h3><ol>
          <li>If your browser flags the download, choose <b>Keep</b>.</li>
          <li>Right-click the zip and choose <b>Extract All</b>.</li>
          <li>Run <b>PeriapsisZero.exe</b>. If Windows protects your PC, click <b>More info</b>, then <b>Run anyway</b>.</li>
        </ol></article>
        <article><h3>Linux</h3><ol>
          <li><code>tar -xzf PeriapsisZero-linux.tar.gz</code></li>
          <li><code>chmod +x PeriapsisZero.x86_64</code></li>
          <li><code>./PeriapsisZero.x86_64</code> (needs Vulkan).</li>
        </ol></article>
      </div>
    </section>}
    <footer className="lp-foot"><span>Made by Ishaan Jha · models built in Blender, game in Godot · NASA imagery for the simulator</span><a href={FEEDBACK_URL} target="_blank" rel="noreferrer">Report a problem ↗</a></footer>
  </main>
}
