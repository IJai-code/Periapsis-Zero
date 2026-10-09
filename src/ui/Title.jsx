import { useEffect, useMemo, useState } from 'react'
import { AccountButton } from './Account.jsx'
import { Mark } from './Mark.jsx'
import { logbookLine } from '../sim/logbook.js'
import { LICENCES, earnedLicences } from '../game/core/pilot.js'
import './title.css'

export const FEEDBACK_URL = 'https://github.com/IJai-code/Periapsis-Zero/issues/new?template=feedback.md'
const BASE = import.meta.env.BASE_URL
function readSave() {
  try { const s = JSON.parse(localStorage.getItem('pz-game-v1') ?? 'null'); return s?.version === 1 && s.pilot ? s : null } catch { return null }
}
function phone() { return Boolean(window.matchMedia?.('(pointer: coarse)').matches && Math.min(window.screen.width, window.screen.height) < 600) }
const TRAINING = [
  { id: 'orbit', title: '01 / Make orbit', text: 'Watch the launch sequence, follow the flight computer and reach a stable Earth orbit.', preset: 'apollo8-launch', vessel: 'apollo8', site: 'ksc', image: 'game/shot-transfer.webp', tag: 'Start here · Earth', action: 'Start orbital training' },
  { id: 'lunar', title: '02 / Cross to the Moon', text: 'Join Apollo 8 at trans-lunar ignition. Follow the burn and learn why the departure window matters.', preset: 'apollo8-tli', vessel: 'apollo8', site: 'ksc', image: 'game/shot-flight.webp', tag: 'Burn planning · Apollo 8', action: 'Start translunar training' },
  { id: 'rendezvous', title: '03 / Meet another craft', text: 'Eagle brakes toward Columbia. Follow the closing speed and docking sequence above the Moon.', preset: 'apollo11-docking', vessel: 'apollo11', site: 'tranquility', image: 'game/shot-hangar.webp', tag: 'Precision flight · Apollo 11', action: 'Start rendezvous training' },
  { id: 'lander', title: '04 / Leave the surface', text: 'Lift off from Tranquility Base, reach lunar orbit and meet the command module.', preset: 'apollo11-liftoff', vessel: 'apollo11', site: 'tranquility', image: 'stills/world-moon.webp', tag: 'Lunar ascent · Apollo 11', action: 'Start lunar ascent training' },
  { id: 'splashdown', title: '05 / Bring them home', text: 'Join the crew before re-entry. Follow the corridor, parachutes and Pacific splashdown.', preset: 'apollo8-reentry', vessel: 'apollo8', site: 'ksc', image: 'game/shot-story.webp', tag: 'Atmospheric entry · Apollo 8', action: 'Start homecoming training' },
]
const WORLDS = ['moon', 'mars', 'europa', 'titan', 'io', 'mercury', 'venus', 'ganymede', 'callisto', 'phobos', 'deimos', 'pluto', 'halley']
const worldName = (id) => id === 'moon' ? 'The Moon' : id === 'halley' ? "Halley's Comet" : id[0].toUpperCase() + id.slice(1)

export function Title({ onPlay, onNew, onSimulator, onSquadron, onLand, training = false }) {
  const save = useMemo(readSave, [])
  const earned = useMemo(() => earnedLicences(), [])
  const isPhone = useMemo(phone, [])
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
    <div className="tt-dashboard">
      <aside className="tt-pilot">
        <span className="tt-eyebrow">Pilot record / local save</span>
        <h2>{save?.pilot.name ?? 'New pilot'}</h2>
        <p>{save ? 'Your career is safe. Training records and licences belong to this same pilot journey.' : 'A ship. A living. A way home. Start your career or learn the real flight mechanics first.'}</p>
        <dl><div><dt>Credits</dt><dd>₡ {Math.round(save?.credits ?? 0).toLocaleString()}</dd></div><div><dt>Licences</dt><dd>{earned.size} / {LICENCES.length}</dd></div><div><dt>Story missions</dt><dd>{save?.story?.done?.length ?? 0}</dd></div></dl>
        <div className="tt-licence-list">{LICENCES.map((l) => <div key={l.id} className={earned.has(l.id) ? 'earned' : ''}><b>{earned.has(l.id) ? '✓' : '○'}</b><span>{l.name}</span><small>₡ {l.bonus.toLocaleString()}</small></div>)}</div>
        {save && <button className="tt-primary control" onClick={onPlay}>Return to career →</button>}
        <small className="tt-record">{flown ? `Flight log: ${flown}` : 'Progress saves in this browser.'}<br />Training awards unlock suits and one-time career bonuses.</small>
      </aside>
      <div className="tt-content">
        {tab === 'career' && <>
          <section className="tt-hero" style={{ backgroundImage: `url(${BASE}game/keyart.webp)` }}>
            <div className="tt-hero-copy"><span className="tt-eyebrow">Earth-Moon frontier / 3091</span><h1>Periapsis<br /><em>Zero</em></h1>
              <p>You survived the ambush. A debt, a dead convoy, and one true story about who sold the Aster. Learn your ship, take the work, and fly the deep lanes to the end of it.</p>
              {isPhone ? <><p className="tt-device-note">Career flight needs a computer or tablet. Flight school and surface exploration work on this phone.</p><button className="tt-primary control" onClick={() => setTab('training')}>Enter flight school →</button></> : <div className="tt-actions">
                {save && <button className="tt-primary control" onClick={onPlay}>Continue career →</button>}
                <button className={`${save ? 'tt-secondary' : 'tt-primary'} control`} onClick={newGame}>{save ? 'New pilot' : 'Start your career →'}</button>
                {confirm && <div className="tt-confirm" role="alert"><p>Replace your saved career with a new pilot?</p><button className="tt-primary control" onClick={onNew}>Replace career</button><button className="tt-secondary control" onClick={() => setConfirm(false)}>Keep my pilot</button></div>}
              </div>}
              <small>Free to play · Keyboard & mouse / tablet touch · Music only</small>
            </div>
            <div className="tt-hero-coordinate" aria-hidden>HEARTH STATION<br />EARTH-MOON L1 / BERTH 09</div>
          </section>
          <section className="tt-briefing"><div><span className="tt-eyebrow">Your first flight</span><h2>Know what you are doing.</h2><p>The opening film is captioned and skippable. Mara then guides one action at a time. Your first flight is protected from random interdictions.</p></div><ol><li><b>01</b><span><strong>Clear the berth</strong>Launch at Hearth and test thrust and brakes.</span></li><li><b>02</b><span><strong>Follow the marker</strong>Steer toward the orange diamond and finish the flight checks.</span></li><li><b>03</b><span><strong>Dock. Get paid.</strong>Return to the lit bay. Choose story work or a paid contract.</span></li></ol></section>
          <section className="tt-paths" aria-label="Choose your next flight">
            <button className="tt-path control" onClick={() => setTab('training')}><img src={`${BASE}game/shot-transfer.webp`} alt="Earth beneath an orbital flight" /><span className="tt-eyebrow">Same career / real physics</span><h2>Train to fly</h2><p>Five simulator licences. New suits. ₡ 27,000 in career bonuses.</p><strong>Open flight school →</strong></button>
            <button className="tt-path control" onClick={onSquadron}><img src={`${BASE}game/shot-flight.webp`} alt="A ship flying through the Earth-Moon system" /><span className="tt-eyebrow">Combat / separate wave mode</span><h2>Hold the sky</h2><p>Squadron combat with AI wingmates or friends by invitation code.</p><strong>Enter Squadron →</strong></button>
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
