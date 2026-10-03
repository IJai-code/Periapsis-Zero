import { useEffect, useMemo, useRef, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { ACESFilmicToneMapping } from 'three'
import { ExpeditionScene } from '../components/ExpeditionScene.jsx'
import { altitude, CAMPAIGN, createExpedition, deployRover, interact, INSTRUMENTS, launch, nearestInstrument, nearestSample, recordSurvey, REGIONS, roverDistance, SITES, VEHICLE } from '../sim/expedition.js'

const BINDINGS = { KeyW: 'forward', KeyS: 'back', KeyA: 'left', KeyD: 'right', KeyQ: 'turnLeft', KeyE: null, KeyZ: 'turnRight', KeyR: 'throttleUp', KeyF: 'throttleDown', ArrowLeft: 'lookLeft', ArrowRight: 'lookRight', ShiftLeft: 'sprint', ShiftRight: 'sprint', Space: 'jump' }
const editable = (target) => target instanceof HTMLElement && (target.matches('input,textarea,select,button') || target.isContentEditable)

export function Expedition({ id, campaign = false, onExit }) {
  const [attempt, setAttempt] = useState(0)
  const session = useMemo(() => createExpedition(id, campaign), [id, campaign, attempt])
  const controls = useRef({})
  const [paused, setPaused] = useState(false)
  const [hidden, setHidden] = useState(document.hidden)
  const [, refresh] = useState(0)
  const [debrief, setDebrief] = useState(false)
  const saved = useRef(false)
  const region = REGIONS[id], chapter = CAMPAIGN.find((c) => c.id === id)
  const update = () => refresh((v) => v + 1)
  const action = () => { if (interact(session)) update() }
  const deploy = () => { if (deployRover(session)) update() }
  const assist = () => { if (!session.landed && session.mode === 'flight') { session.assist = !session.assist; session.message = session.assist ? 'Landing assist engaged. Engines and fuel remain live.' : 'Manual flight. R/F throttle; WASD tilt; Q/Z yaw.'; update() } }
  const retry = () => { controls.current = {}; saved.current = false; setAttempt((v) => v + 1); setPaused(false); setDebrief(false) }
  const pulse = () => {
    if (session.delivered && !saved.current) { saved.current = recordSurvey(session); if (saved.current) setDebrief(true) }
    update()
  }
  useEffect(() => {
    const clear = () => { controls.current = {} }
    const visibility = () => { setHidden(document.hidden); clear() }
    const down = (e) => {
      if (editable(e.target)) return
      if (e.code === 'Escape') { e.preventDefault(); clear(); setPaused((v) => !v); return }
      if (paused || hidden || debrief || e.repeat && ['KeyE', 'KeyH', 'KeyT', 'KeyG'].includes(e.code)) return
      if (e.code === 'KeyE') { e.preventDefault(); action(); return }
      if (e.code === 'KeyH') { assist(); return }
      if (e.code === 'KeyT') { if (launch(session)) update(); return }
      if (e.code === 'KeyG') { deploy(); return }
      const binding = BINDINGS[e.code]
      if (binding) { e.preventDefault(); controls.current[binding] = true }
    }
    const up = (e) => { const binding = BINDINGS[e.code]; if (binding) controls.current[binding] = false }
    window.addEventListener('keydown', down); window.addEventListener('keyup', up); window.addEventListener('blur', clear); document.addEventListener('visibilitychange', visibility)
    return () => { clear(); window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); window.removeEventListener('blur', clear); document.removeEventListener('visibilitychange', visibility) }
  }, [session, paused, hidden, debrief])
  /*
   * The session, for the browser harnesses. Exposed in a production build as
   * well as development, because the smoke test that plays a whole survey runs
   * against `dist` and there is no other way for a script to read the state a
   * player is in. It is read-only in practice: nothing here is a completion
   * flag, and the harness drives the same key state a person does.
   */
  useEffect(() => {
    window.__expedition = { session, controls, INSTRUMENTS, SITES, REGIONS }
    return () => { delete window.__expedition }
  }, [session])

  const driving = session.mode === 'rover'
  const onFoot = session.mode === 'eva'
  const sample = nearestSample(session)
  const package_ = nearestInstrument(session)
  const aboard = session.mode === 'flight'
  const next = sample ? SITES[sample.index] : package_ ? INSTRUMENTS[package_.index] : onFoot ? { x: session.x, z: session.z } : { x: 0, z: 0 }
  const observer = driving ? session.rover : onFoot ? session.walker : session
  const range = Math.hypot(observer.x - next.x, observer.z - next.z)
  const bearing = ((Math.atan2(next.x - observer.x, observer.z - next.z) * 180 / Math.PI) + 360) % 360
  // Mirrors the simulator's own priority: the target you are furthest inside wins.
  const toLander = onFoot ? Math.hypot(session.walker.x - session.x, session.walker.z - session.z) : Infinity
  const toRover = onFoot ? roverDistance(session) : Infinity
  const context = onFoot
    ? sample && sample.distance <= 5 ? `Collect ${chapter.samples[sample.index]}`
      : session.rover && toRover < 4.5 && toRover / 4.5 < toLander / 11 ? 'Drive rover'
        : toLander < 11 ? 'Board lander' : null
    : driving ? package_ && package_.distance <= 6 ? `Deploy ${INSTRUMENTS[package_.index].name}` : null
      : session.landed && aboard ? 'Leave lander' : null
  const samplesDone = session.samples.length === SITES.length
  const readingsDone = session.instruments.length === INSTRUMENTS.length
  const objective = session.delivered ? 'Survey complete'
    : !session.landed ? 'Land inside the survey sector'
      : !session.rover && aboard ? 'Deploy the rover'
        : !samplesDone ? `Collect paired samples · ${session.samples.length}/${SITES.length}`
          : !readingsDone ? `Deploy instruments · ${session.instruments.length}/${INSTRUMENTS.length}`
            : 'Return to the lander'

  return <div className="expedition-screen">
    <Canvas shadows frameloop={hidden ? 'never' : 'always'} dpr={[1, 1.5]} gl={{ antialias: true, toneMapping: ACESFilmicToneMapping, powerPreference: 'high-performance' }} camera={{ position: [0, 220, 230], fov: 55, near: 0.1, far: 90000 }}>
      <ExpeditionScene key={`${id}/${attempt}`} session={session} controls={controls} paused={paused || hidden || debrief} onPulse={pulse} />
    </Canvas>
    <div className="expedition-overlay">
      <header className="expedition-header"><button className="quiet-button" onClick={() => { controls.current = {}; setPaused(true) }}>Ⅱ <span>Menu</span></button><div><span className="eyebrow">{campaign ? `Survey campaign / ${chapter.number}` : 'Free expedition'}</span><h1>{region.name} <span>/ {region.site}</span></h1></div><span className="region-tag">{region.gravity.toFixed(2)} m/s²</span></header>
      <div className="objective-card"><span className="eyebrow">{objective}</span><p>{session.mode === 'crashed' ? session.message : onFoot || driving ? sample ? `${chapter.samples[sample.index]} · ${Math.round(range)} m · ${Math.round(bearing)}°` : package_ ? `${INSTRUMENTS[package_.index].name} · ${Math.round(range)} m · ${Math.round(bearing)}°` : `Lander · ${Math.round(range)} m · ${Math.round(bearing)}°` : session.landed ? session.rover ? 'Survey under way. Drive, sample, deploy.' : 'Contact confirmed. Deploy the rover or leave the lander.' : `Landing zone · ${Math.round(range)} m`}</p><div className="objective-stages"><span className={session.landed ? 'done' : ''}>01 Land</span><span className={samplesDone ? 'done' : ''}>02 Samples</span><span className={readingsDone ? 'done' : ''}>03 Instruments</span><span className={session.delivered ? 'done' : ''}>04 Return</span></div></div>
      <div className="surface-provenance">Procedural survey region <span>Fictional vehicle · real gravity</span></div>
      {(onFoot || driving) && <><div className="eva-reticle" aria-hidden>+</div><div className="surface-heading">Heading <span>{(((driving ? session.rover.yaw : session.walker.yaw) * 180 / Math.PI % 360 + 360) % 360).toFixed(1)}°</span></div></>}
      <footer className="flight-dashboard">
        <div className="flight-message" role="status">{session.message}</div>
        {aboard ? <div className="flight-instruments">
          <Readout name="Radar altitude" value={altitude(session).toFixed(1)} unit="m" />
          <Readout name="Vertical" value={session.vy.toFixed(1)} unit="m/s" warning={session.vy < -VEHICLE.safeVertical && altitude(session) < 20} />
          <Readout name="Ground speed" value={Math.hypot(session.vx, session.vz).toFixed(1)} unit="m/s" />
          <div className="fuel-readout"><span>Propellant</span><strong>{Math.round(session.fuel / VEHICLE.fuel * 100)}<small>%</small></strong><div><i style={{ width: `${session.fuel / VEHICLE.fuel * 100}%` }} /></div></div>
          <div className="throttle-control"><label htmlFor="expedition-throttle">Thrust {Math.round(session.throttle * 100)}%</label><input id="expedition-throttle" type="range" min="0" max="1" step="0.01" value={session.throttle} disabled={session.assist || session.landed} onChange={(e) => { session.throttle = Number(e.target.value); update() }} /></div>
        </div> : driving ? <div className="flight-instruments">
          <Readout name="Ground speed" value={session.rover.speed.toFixed(1)} unit="m/s" />
          <Readout name="Heading" value={(((session.rover.yaw * 180 / Math.PI % 360) + 360) % 360).toFixed(0)} unit="deg" />
          <Readout name="Odometer" value={session.rover.odometer.toFixed(0)} unit="m" />
          <Readout name="Instruments" value={`${session.instruments.length}`} unit={`of ${INSTRUMENTS.length}`} />
          <div className="fuel-readout"><span>Battery</span><strong>{Math.round(session.rover.battery * 100)}<small>%</small></strong><div><i style={{ width: `${session.rover.battery * 100}%` }} /></div></div>
        </div> : <div className="eva-strip"><strong>Surface traverse</strong><span>{session.samples.length}/{SITES.length} samples · {session.instruments.length}/{INSTRUMENTS.length} instruments</span><span>WASD move · Shift run · Space jump · E rover · drag to look</span></div>}
        <div className="flight-actions">
          {aboard && <button className={session.assist ? 'action-button selected' : 'action-button'} onClick={assist} disabled={session.landed}>H / {session.assist ? 'Landing assist' : 'Manual control'}</button>}
          {context && <button className="action-button primary" onClick={action}>E / {context}</button>}
          {session.landed && aboard && !session.rover && <button className="action-button" onClick={deploy}>G / Deploy rover</button>}
          {session.landed && aboard && <button className="action-button" onClick={() => { launch(session); update() }}>T / Take off</button>}
          <span className="keyboard-hint">{aboard ? 'R/F throttle · WASD tilt · Q/Z yaw · drag camera' : driving ? 'W/S drive · A/D steer · E step out · drag camera' : 'E interact · ← → look'} </span>
        </div>
      </footer>
      <div className="touch-pilot" aria-label="Touch movement controls">
        <div className="touch-direction"><Hold name="forward" controls={controls}>↑</Hold><div><Hold name="left" controls={controls}>←</Hold><Hold name="back" controls={controls}>↓</Hold><Hold name="right" controls={controls}>→</Hold></div></div>
        <div>{onFoot ? <><Hold name="lookLeft" controls={controls}>Look ←</Hold><Hold name="lookRight" controls={controls}>Look →</Hold><Hold name="jump" controls={controls}>Jump</Hold></> : driving ? <><Hold name="forward" controls={controls}>Drive</Hold><Hold name="back" controls={controls}>Reverse</Hold></> : <><Hold name="throttleUp" controls={controls}>Thrust +</Hold><Hold name="throttleDown" controls={controls}>Thrust −</Hold></>}</div>
      </div>
    </div>
    <FocusPause active={paused || session.mode === 'crashed' || debrief} />
    {(paused || session.mode === 'crashed' || debrief) && <div className="expedition-modal" role="dialog" aria-modal="true" aria-labelledby="expedition-dialog-title">
      <section><span className="eyebrow">{debrief ? 'Survey delivered' : session.mode === 'crashed' ? 'Flight ended' : 'Expedition paused'}</span><h2 id="expedition-dialog-title">{debrief ? chapter.title : session.mode === 'crashed' ? 'Try another approach.' : 'Take a breath.'}</h2><p>{debrief ? chapter.debrief : session.mode === 'crashed' ? session.message : 'Flight and surface movement are paused. No propellant is being used.'}</p>
        {session.touchdown && <div className="debrief-stats"><span>Contact speed <strong>{session.touchdown.vertical.toFixed(2)} m/s</strong></span><span>Fuel remaining <strong>{Math.round(session.fuel)} kg</strong></span></div>}
        <div className="modal-actions">{session.mode !== 'crashed' && <button autoFocus className="action-button primary" onClick={() => { setPaused(false); setDebrief(false) }}>{debrief ? 'Keep exploring' : 'Resume'}</button>}<button autoFocus={session.mode === 'crashed'} className="action-button" onClick={retry}>Retry approach</button><button className="action-button" onClick={onExit}>{campaign ? 'Campaign' : 'Mode select'}</button></div>
      </section>
    </div>}
  </div>
}
function FocusPause({ active }) {
  useEffect(() => {
    if (!active) return
    const old = document.activeElement
    const timer = requestAnimationFrame(() => document.querySelector('.expedition-modal button')?.focus())
    const trap = (e) => {
      if (e.key !== 'Tab') return
      const buttons = [...document.querySelectorAll('.expedition-modal button:not(:disabled)')]
      const index = buttons.indexOf(document.activeElement)
      e.preventDefault()
      buttons[(index + (e.shiftKey ? -1 : 1) + buttons.length) % buttons.length]?.focus()
    }
    window.addEventListener('keydown', trap)
    return () => { cancelAnimationFrame(timer); window.removeEventListener('keydown', trap); if (old instanceof HTMLElement && old.isConnected) old.focus() }
  }, [active])
  return null
}
function Readout({ name, value, unit, warning }) { return <div className={`flight-readout ${warning ? 'warning' : ''}`}><span>{name}</span><strong>{value}<small>{unit}</small></strong></div> }
function Hold({ name, controls, children }) { return <button aria-label={name} className="hold-button" onPointerDown={(e) => { e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); controls.current[name] = true }} onPointerUp={() => { controls.current[name] = false }} onPointerCancel={() => { controls.current[name] = false }} onLostPointerCapture={() => { controls.current[name] = false }}>{children}</button> }
