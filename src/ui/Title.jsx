import { useEffect, useMemo, useState } from 'react'
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
          <section className="tt-hero" style={{ backgroundImage: `url(${BASE}game/keyart-hero.jpg)` }}>
            <div className="tt-hero-copy"><span className="tt-eyebrow">A story in cislunar space / 3091</span><h1>Periapsis<br /><em>Zero</em></h1>
              <p className="tt-hook">Somebody sold the Aster&rsquo;s route. Six ships went out. You were the only one who came back.</p>
              <p>Walk the convoy, fly escort, survive the ambush, and find out who sold you. A story you play, in your browser or downloaded at full quality.</p>
              {isPhone ? <><p className="tt-device-note">The game and its prologue need a computer with a keyboard and mouse. Flight school and surface exploration work on this device.</p><button className="tt-primary control" onClick={() => setTab('training')}>Enter flight school →</button></> : <>
                <div className="tt-actions">
                  {/* The prologue is the Godot build (game/, published to /play/): the Aster, played. */}
                  <a className="tt-primary tt-begin control" href={`${BASE}play/index.html`}>Begin your journey →</a>
                  <a className="tt-secondary control" href={`${DESKTOP}${download.file}`}>Download for {download.name}</a>
                </div>
                <p className="tt-downloads">Plays in the browser, about 85 MB the first time. Or download for <a href={`${DESKTOP}PeriapsisZero-mac.zip`}>Mac</a>, <a href={`${DESKTOP}PeriapsisZero-windows.zip`}>Windows</a> or <a href={`${DESKTOP}PeriapsisZero-linux.tar.gz`}>Linux</a>. <a className="tt-help-link" href="#install" onClick={(e) => { e.preventDefault(); document.getElementById('install')?.scrollIntoView({ behavior: 'smooth' }) }}>How to open the download</a></p>
                <p className="tt-career">{save ? <>Already flying? <button onClick={onPlay}>Continue your career</button> or <button onClick={newGame}>start a new pilot</button>.</> : <>Played the prologue? <button onClick={newGame}>Start Act One</button>.</>}</p>
                {confirm && <div className="tt-confirm" role="alert"><p>Replace your saved career with a new pilot?</p><button className="tt-primary control" onClick={onNew}>Replace career</button><button className="tt-secondary control" onClick={() => setConfirm(false)}>Keep my pilot</button></div>}
              </>}
            </div>
            <div className="tt-hero-coordinate" aria-hidden>THE KESTREL AND THE ASTER<br />CONVOY ESCORT / HARBOR ORBIT</div>
          </section>
          <section className="tt-briefing"><div><span className="tt-eyebrow">The prologue, Act One and Act Two / hours to play</span><h2>How it starts.</h2><p>A short film sets the scene. Then it is yours: every control is shown the moment you need it. Lock targets, fire missiles, manage your capacitor and warp between grids, with an overview of everything in space.</p></div><ol><li><b>01</b><span><strong>The Aster</strong>Walk the convoy freighter. Meet her captain and her engineer.</span></li><li><b>02</b><span><strong>The ambush</strong>Fly escort, fight the Hollow, lose the Aster, wake up at Hearth owing a loan shark everything.</span></li><li><b>03</b><span><strong>The black box</strong>Warp to the wreck, find the recorder before Rook&rsquo;s people do, and learn who sold you.</span></li><li><b>04</b><span><strong>Down the well</strong>Fly first person through Earth&rsquo;s abandoned pillar country, a drowned city and a waterfall, to the one person who can name Rook&rsquo;s partner.</span></li><li><b>05</b><span><strong>Lowdeck</strong>Act Two. Hearth&rsquo;s neon lower ring at night: hide Renn from the Warden&rsquo;s drones, work a fixer&rsquo;s job board, fly the Rim with Security on your tail, and get the ledger out.</span></li></ol></section>
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
