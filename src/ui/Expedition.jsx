import { useEffect, useMemo, useRef, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { ACESFilmicToneMapping } from 'three'
import { ExpeditionScene } from '../components/ExpeditionScene.jsx'
import { altitude, CAMPAIGN, createExpedition, deployRover, interact, INSTRUMENTS, launch, nearestInstrument, nearestSample, nextTarget, recordSurvey, REGIONS, roverDistance, SITES, TARGET, VEHICLE } from '../sim/expedition.js'

const BINDINGS = { KeyW: 'forward', KeyS: 'back', KeyA: 'left', KeyD: 'right', KeyQ: 'turnLeft', KeyE: null, KeyZ: 'turnRight', KeyR: 'throttleUp', KeyF: 'throttleDown', ArrowLeft: 'lookLeft', ArrowRight: 'lookRight', Space: 'jump' }
const HOWTO_KEY = 'pz-expedition-howto-v1'
const editable = (target) => target instanceof HTMLElement && (target.matches('input,textarea,select,button') || target.isContentEditable)

export function Expedition({ id, campaign = false, onExit }) {
  const [attempt, setAttempt] = useState(0)
  const session = useMemo(() => createExpedition(id, campaign), [id, campaign, attempt])
  const controls = useRef({})
  const [paused, setPaused] = useState(false)
  const [hidden, setHidden] = useState(document.hidden)
  const [, refresh] = useState(0)
  const [debrief, setDebrief] = useState(false)
  /*
   * How to play, shown once. The controls used to be a 9-pixel line in the
   * bottom corner and the goal a heading in degrees; a new player had to work
   * out the whole loop by trial. This card says it in four steps the first
   * time, and the pause menu keeps a way back to it.
   */
  const [howTo, setHowTo] = useState(() => { try { return !localStorage.getItem(HOWTO_KEY) } catch { return false } })
  // A phone has no E key: on touch the buttons and the how-to name what to tap.
  const [touch] = useState(() => typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches)
  const keyed = (letter) => (touch ? '' : `${letter} / `)
  const closeHowTo = () => { try { localStorage.setItem(HOWTO_KEY, '1') } catch { /* private mode: shows again next time */ } setHowTo(false) }
  const saved = useRef(false)
  const region = REGIONS[id], chapter = CAMPAIGN.find((c) => c.id === id)
  const update = () => refresh((v) => v + 1)
  const action = () => { if (interact(session)) update() }
  const deploy = () => { if (deployRover(session)) update() }
  const assist = () => { if (!session.landed && session.mode === 'flight') { session.assist = !session.assist; session.message = session.assist ? 'Landing assist is flying the descent for you. Press H to take over.' : 'You are flying. R/F for thrust, WASD to tilt, Q/Z to turn.'; update() } }
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
      if (howTo) { if (e.code === 'Enter' || e.code === 'Space') { e.preventDefault(); closeHowTo() } return }
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
  }, [session, paused, hidden, debrief, howTo])
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
  const goal = new Float64Array(2)
  const kind = nextTarget(session, goal)
  const next = { x: goal[0], z: goal[1] }
  const observer = driving ? session.rover : onFoot ? session.walker : session
  const range = Math.hypot(observer.x - next.x, observer.z - next.z)
  const bearing = ((Math.atan2(next.x - observer.x, observer.z - next.z) * 180 / Math.PI) + 360) % 360
  // Where the target is relative to the way you are facing: 0 is straight
  // ahead, positive is to the right. This drives the arrow; a bare compass
  // bearing asked players to do the subtraction themselves.
  const facing = driving ? session.rover.yaw : onFoot ? session.walker.yaw : session.yaw
  const turn = ((bearing - facing * 180 / Math.PI) % 360 + 540) % 360 - 180
  const guide = Math.abs(turn) < 12 ? 'ahead' : Math.abs(turn) > 150 ? 'behind you' : turn > 0 ? 'to your right' : 'to your left'
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
  // The heading names what the arrow points at, so the two never disagree
  // (driving out before the samples points at an instrument, and says so).
  const objective = session.delivered ? 'Survey complete'
    : !session.landed ? 'Land on the marked pad'
      : !session.rover && aboard ? 'Unload the rover (G) or step out (E)'
        : kind === 'instrument' ? `Set up instruments · ${session.instruments.length} of ${INSTRUMENTS.length}`
          : kind === 'rover' ? 'Get in the rover'
            : kind === 'lander' && samplesDone && !session.rover ? 'Back to the lander for the rover'
              : !samplesDone ? `Collect samples · ${session.samples.length} of ${SITES.length}`
                : !readingsDone ? `Set up instruments · ${session.instruments.length} of ${INSTRUMENTS.length}`
                  : 'Go back to the lander'
  const stages = [['Land', session.landed], ['Samples', samplesDone], ['Instruments', readingsDone], ['Return', session.delivered]]
  const current = kind === 'instrument' ? 2 : stages.findIndex(([, done]) => !done)

  return <div className="expedition-screen">
    <Canvas shadows frameloop={hidden ? 'never' : 'always'} dpr={[1, 1.5]} gl={{ antialias: true, toneMapping: ACESFilmicToneMapping, powerPreference: 'high-performance' }} camera={{ position: [0, 220, 230], fov: 55, near: 0.1, far: 90000 }}>
      <ExpeditionScene key={`${id}/${attempt}`} session={session} controls={controls} paused={paused || hidden || debrief || howTo} onPulse={pulse} />
    </Canvas>
    <div className="expedition-overlay">
      <header className="expedition-header"><button className="quiet-button" onClick={() => { controls.current = {}; setPaused(true) }}>Ⅱ <span>Menu</span></button><div><span className="eyebrow">{campaign ? `Survey campaign / ${chapter.number}` : 'Free expedition'}</span><h1>{region.name} <span>/ {region.site}</span></h1></div><span className="region-tag">{region.gravity.toFixed(2)} m/s²</span></header>
      <div className="objective-card"><span className="eyebrow">{objective}</span>{(onFoot || driving) && session.mode !== 'crashed' ? <div className="objective-target">
        <span className="objective-arrow" style={{ transform: `rotate(${turn}deg)` }} aria-hidden>↑</span>
        <p><strong>{kind === 'sample' ? chapter.samples[TARGET.index] : kind === 'instrument' ? INSTRUMENTS[TARGET.index].name : kind === 'rover' ? 'Rover: the instruments are too far to walk' : 'Lander'}</strong><br />{Math.round(range)} m {guide}</p>
      </div> : <p>{session.mode === 'crashed' ? session.message : session.landed ? session.rover ? 'Walk or drive to the beacons.' : 'You are down. Step outside or unload the rover.' : `Pad is ${Math.round(range)} m away. Keep your descent slow.`}</p>}<ol className="objective-stages">{stages.map(([name, done], i) => <li key={name} className={done ? 'done' : i === current ? 'now' : ''} aria-current={i === current ? 'step' : undefined}>{done ? '✓' : `0${i + 1}`} {name}</li>)}</ol></div>
      <div className="surface-provenance">Generated terrain <span>Real {region.name} gravity</span></div>
      {(onFoot || driving) && <div className="eva-reticle" aria-hidden>+</div>}
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
        </div> : <div className="eva-strip"><strong>On foot</strong><span>{session.samples.length} of {SITES.length} samples · {session.instruments.length} of {INSTRUMENTS.length} instruments</span><span>W/A/S/D walk · Space jump · drag to look around</span></div>}
        <div className="flight-actions">
          {aboard && <button className={session.assist ? 'action-button selected' : 'action-button'} onClick={assist} disabled={session.landed}>{keyed('H')}{session.assist ? 'Landing assist' : 'Manual control'}</button>}
          {context && <button className="action-button primary" onClick={action}>{keyed('E')}{context}</button>}
          {session.landed && aboard && !session.rover && <button className="action-button" onClick={deploy}>{keyed('G')}Deploy rover</button>}
          {session.landed && aboard && <button className="action-button" onClick={() => { launch(session); update() }}>{keyed('T')}Take off</button>}
          <span className="keyboard-hint">{aboard ? session.assist && !session.landed ? 'H to fly it yourself · drag to look around' : 'R/F thrust · W/A/S/D tilt · Q/Z turn · drag to look' : driving ? 'W/S go · A/D steer · E get out · drag to look' : 'E use · ← → turn · Esc menu'} </span>
        </div>
      </footer>
      <div className="touch-pilot" aria-label="Touch movement controls">
        <div className="touch-direction"><Hold name="forward" controls={controls}>↑</Hold><div><Hold name="left" controls={controls}>←</Hold><Hold name="back" controls={controls}>↓</Hold><Hold name="right" controls={controls}>→</Hold></div></div>
        <div>{onFoot ? <><Hold name="lookLeft" controls={controls}>Look ←</Hold><Hold name="lookRight" controls={controls}>Look →</Hold><Hold name="jump" controls={controls}>Jump</Hold></> : driving ? <><Hold name="forward" controls={controls}>Drive</Hold><Hold name="back" controls={controls}>Reverse</Hold></> : <><Hold name="throttleUp" controls={controls}>Thrust +</Hold><Hold name="throttleDown" controls={controls}>Thrust −</Hold></>}</div>
      </div>
    </div>
    {howTo && <div className="expedition-modal howto" role="dialog" aria-modal="true" aria-labelledby="howto-title">
      <section>
        <span className="eyebrow">How to play</span>
        <h2 id="howto-title">Land, explore, fly home.</h2>
        {touch ? <ol className="howto-steps">
          <li><strong>Land.</strong> Landing assist flies the descent for you. Tap <em>Landing assist</em> to fly it yourself with <em>Thrust +</em>, <em>Thrust −</em> and the arrows. Touch down slowly.</li>
          <li><strong>Get out.</strong> Tap <em>Leave lander</em> to step outside, or <em>Deploy rover</em> and then <em>Drive rover</em>.</li>
          <li><strong>Follow the beacons.</strong> The arrow at the top left points to your next target. Walk or drive up to it and tap the orange button: two samples, then three instruments (the instruments are far, so take the rover).</li>
          <li><strong>Go home.</strong> Back at the lander, tap <em>Board lander</em> and then <em>Take off</em>.</li>
        </ol> : <ol className="howto-steps">
          <li><strong>Land.</strong> Landing assist flies the descent for you. Press <kbd>H</kbd> to take over: <kbd>R</kbd>/<kbd>F</kbd> thrust, <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> tilt. Touch down slowly.</li>
          <li><strong>Get out.</strong> Press <kbd>E</kbd> to step outside, or <kbd>G</kbd> to unload the rover and <kbd>E</kbd> to drive it.</li>
          <li><strong>Follow the beacons.</strong> The arrow at the top left points to your next target. Walk or drive up to it and press <kbd>E</kbd>: two samples, then three instruments (the instruments are far, so take the rover).</li>
          <li><strong>Go home.</strong> Return to the lander, press <kbd>E</kbd> to climb in and <kbd>T</kbd> to take off.</li>
        </ol>}
        <p className="howto-note">Gravity is real for each world, so a jump on the Moon floats and walking is slow. {touch ? <>Tap <em>Menu</em> to pause.</> : <><kbd>Esc</kbd> pauses at any time.</>}</p>
        <div className="modal-actions"><button autoFocus className="action-button primary" onClick={closeHowTo}>Start</button></div>
      </section>
    </div>}
    <FocusPause active={paused || session.mode === 'crashed' || debrief || howTo} />
    {(paused || session.mode === 'crashed' || debrief) && <div className="expedition-modal" role="dialog" aria-modal="true" aria-labelledby="expedition-dialog-title">
      <section><span className="eyebrow">{debrief ? 'Survey complete' : session.mode === 'crashed' ? 'Crashed' : 'Paused'}</span><h2 id="expedition-dialog-title">{debrief ? chapter.title : session.mode === 'crashed' ? 'That landing did not hold.' : 'Paused'}</h2><p>{debrief ? chapter.debrief : session.mode === 'crashed' ? session.message : 'Everything is stopped, including your fuel.'}</p>
        {session.touchdown && <div className="debrief-stats"><span>Contact speed <strong>{session.touchdown.vertical.toFixed(2)} m/s</strong></span><span>Fuel remaining <strong>{Math.round(session.fuel)} kg</strong></span></div>}
        <div className="modal-actions">{session.mode !== 'crashed' && <button autoFocus className="action-button primary" onClick={() => { setPaused(false); setDebrief(false) }}>{debrief ? 'Keep exploring' : 'Resume'}</button>}<button autoFocus={session.mode === 'crashed'} className="action-button" onClick={retry}>Try again</button>{!debrief && session.mode !== 'crashed' && <button className="action-button" onClick={() => { setPaused(false); setHowTo(true) }}>How to play</button>}<button className="action-button" onClick={onExit}>{campaign ? 'Back to the story' : 'Home'}</button></div>
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
