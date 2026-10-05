import { useState } from 'react'
import { soundSettings, setMusic, setSfx, setMuted } from '../audio.js'
import { CONTROL_LIST } from './keys.jsx'

/** Esc: resume, controls, settings, quit to the title. */
export function Pause({ game: g, touch, help, quality, setQuality, controls, onResume, onQuit }) {
  const [tab, setTab] = useState(help ? 'controls' : 'menu')
  const [snd, setSnd] = useState(soundSettings)
  const [sens, setSens] = useState(controls.settings.sensitivity)
  const [inv, setInv] = useState(controls.settings.invert)
  return <div className="gm-pause" role="dialog" aria-label="Paused">
    <section>
      <span className="st-eyebrow">{g.pilot.name} · paused</span>
      <nav>
        {[['menu', 'Game'], ['controls', 'Controls'], ['settings', 'Settings']].map(([id, l]) => <button key={id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>{l}</button>)}
      </nav>
      {tab === 'menu' && <div className="gm-pause-menu">
        <button className="st-primary" onClick={onResume}>Resume</button>
        <button onClick={() => setTab('controls')}>How to play</button>
        <button onClick={onQuit}>{g.skirmish ? 'Leave the skirmish' : 'Save and quit to title'}</button>
        <p className="st-empty">{g.skirmish ? (g.skirmish.net ? 'A squadron does not pause: the fight goes on while this menu is open.' : 'Paused. Your best wave on each battlefield is kept.') : 'The game saves itself whenever you dock and every minute in flight. Loading puts you back at your last station.'}</p>
        {!g.skirmish && <p className="gm-pause-elsewhere">Also: <a href="#squadron" onClick={() => onQuit()}>Squadron</a>, waves of raiders with bots or friends · <a href="#sim" target="_blank" rel="noreferrer">the Simulator</a>, where pilot licences are earned</p>}
      </div>}
      {tab === 'controls' && <div className="gm-controls">
        <table><thead><tr><th /><th>{touch ? 'Touch' : 'Keyboard and mouse'}</th></tr></thead>
          <tbody>{CONTROL_LIST.map(([what, k, t]) => <tr key={what}><td>{what}</td><td>{touch ? t : k}</td></tr>)}</tbody></table>
        <h3>How it works</h3>
        <ul>
          <li><strong>Missions</strong> come from people at stations: dock and look under Contacts. Jobs are on the job board.</li>
          <li><strong>Travel</strong>: open the map, pick a place, transfer. The drive burns at 0.3 g, flips at the midpoint, and brakes; the game clock moves on by the hours it really takes.</li>
          <li><strong>Docking</strong>: fly to a station's lit bay under 70 m/s and press {touch ? 'the action button' : 'F'}.</li>
          <li><strong>Fighting</strong>: shields soak hits and recharge; hull does not. Aim at the lead marker, not the ship. Bolts take time to arrive.</li>
          <li><strong>Heat</strong>: the Compact chases contraband and violence. Get out of sight, or run cold (no thrust, no boost, no guns) and they lose you beyond 1.8 km.</li>
        </ul>
        <button className="st-primary" onClick={onResume}>Back to flying</button>
      </div>}
      {tab === 'settings' && <div className="gm-settings">
        <label>Music <input type="range" min="0" max="1" step="0.05" value={snd.music} onChange={(e) => { setMusic(+e.target.value); setSnd(soundSettings()) }} /></label>
        <label>Effects <input type="range" min="0" max="1" step="0.05" value={snd.sfx} onChange={(e) => { setSfx(+e.target.value); setSnd(soundSettings()) }} /></label>
        <label className="check"><input type="checkbox" checked={snd.muted} onChange={(e) => { setMuted(e.target.checked); setSnd(soundSettings()) }} /> Mute everything</label>
        {!touch && <label>Mouse sensitivity <input type="range" min="0.3" max="2.5" step="0.05" value={sens} onChange={(e) => { controls.settings.sensitivity = +e.target.value; setSens(+e.target.value) }} /></label>}
        {!touch && <label className="check"><input type="checkbox" checked={inv} onChange={(e) => { controls.settings.invert = e.target.checked; setInv(e.target.checked) }} /> Invert mouse</label>}
        <div className="gm-quality"><span>Graphics</span>{[['high', 'High'], ['low', 'Fast']].map(([q, l]) => <button key={q} className={quality === q ? 'on' : ''} onClick={() => setQuality(q)}>{l}</button>)}</div>
        <button className="st-primary" onClick={onResume}>Done</button>
      </div>}
    </section>
  </div>
}
