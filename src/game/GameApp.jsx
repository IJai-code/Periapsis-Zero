import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { autosave, launch, loadSave, newSave, respawn, returnFromSurface, startGame, deleteSave, loadPlace, worldUp, spawnRaiders, setDestination, startTransfer, addHeat, requestDock } from './core/game.js'
import * as THREE from 'three'
import { bindDesktop, createControls, isTouch } from './ui/controls.js'
import { duck, engineLevel, pauseSound, play, startSound } from './audio.js'
import { Hud } from './ui/Hud.jsx'
import { Station } from './ui/Station.jsx'
import { MapView } from './ui/MapView.jsx'
import { Comms } from './ui/Comms.jsx'
import { Banners } from './ui/Banners.jsx'
import { Pause } from './ui/Pause.jsx'
import { Touch } from './ui/Touch.jsx'
import { NewPilot } from './ui/NewPilot.jsx'
import { Prologue } from './ui/Prologue.jsx'
import { Log } from './ui/Log.jsx'
import { updateMarkers } from './ui/markers.js'
import { checkpointTier, initialQuality, readChoice, readTier, rememberTier, writeChoice } from './core/quality.js'
import { summarizeFrameTimes } from '../gfx/frameStats.js'
import { createSky, syncSky, hail, closeSky } from './net/sky.js'
import { connectRoom } from './net/realtime.js'
import { realtimeConfig } from '../sim/account.js'
import './ui/game.css'

const GameScene = lazy(() => import('./scene/GameScene.jsx'))
const Surface = lazy(() => import('../ui/Surface.jsx'))

/**
 * The game, at #play. Owns the running game object, the controls, the 3D
 * view and every overlay. React re-renders the interface ten times a second
 * from the game object; the things that move every frame (markers, the
 * reticle, the speed) are written straight to the DOM by the frame loop.
 *
 * Which graphics tier this machine gets, and the evidence behind it, lives in
 * `core/quality.js`: a first guess from what the browser will say about the
 * device, the lesson the opening film's own frames taught, and one measured
 * checkpoint a few seconds into play. This file only carries the answer and
 * hands it to the canvas.
 */
export default function GameApp({ onExit, fresh = false, onFresh }) {
  const game = useRef(null)
  const controls = useRef(createControls())
  const [phase, setPhase] = useState(() => (!fresh && loadSave() ? 'loading' : 'new'))
  useEffect(() => { onFresh?.() }, [onFresh])
  const [, setTick] = useState(0)
  const [overlay, setOverlay] = useState(null) // 'map' | 'log' | 'pause' | null
  const [touch] = useState(isTouch)
  const [quality, setQuality] = useState(() => initialQuality())
  const qualityRef = useRef(quality)
  qualityRef.current = quality
  // A choice made here is the player's, and outranks every measurement: it is
  // written under its own key, and the checkpoint below never argues with it.
  const chooseQuality = useCallback((q) => { setQuality(q); qualityRef.current = q; writeChoice(q) }, [])
  const [placeKey, setPlaceKey] = useState('')
  const overlayRef = useRef(overlay)
  overlayRef.current = overlay
  const markers = useRef(null)
  const seen = useRef(0)
  const newPilot = useRef(null)
  // The shared sky (net/sky.js): other pilots, live. Off in settings, or without the online service.
  const sky = useRef(null)
  const online = useRef(null)
  const [skyOn, setSkyOn] = useState(() => { try { return localStorage.getItem('pz-sky') !== 'off' } catch { return true } })

  const begin = useCallback((save, intro = false) => {
    game.current = startGame(save)
    // A new pilot boards their ship before anything else happens.
    if (intro) game.current.cine = { kind: 'board', t: 0 }
    // For the browser checks in scripts/: the running game, in development only.
    if (import.meta.env.DEV) {
      window.__game = game.current
      window.__pzControls = controls.current
      // Staging helpers for screenshots and checks: aim at a local point, or jump to a place.
      window.__pzLook = (x, y, z) => { const g = game.current, p = g.player; p.q.setFromRotationMatrix(new THREE.Matrix4().lookAt(p.pos, new THREE.Vector3(x, y, z), worldUp(g, new THREE.Vector3()))); p.vel.set(0, 0, 0); p.ctrl.throttle = 0 }
      window.__pzGo = (place, x = 0, y = 300, z = 4200) => { const g = game.current; g.mode = 'flight'; g.docked = null; loadPlace(g, place); g.player.pos.set(x, y, z); g.player.vel.set(0, 0, 0) }
      window.__pzV = (x, y, z) => new THREE.Vector3(x, y, z)
      window.__pzRaid = (n = 3, d = 900) => { const g = game.current, p = g.player; const at = new THREE.Vector3(0, 0, -d).applyQuaternion(p.q).add(p.pos); const list = spawnRaiders(g, n, at, 'show', { mode: 'attack' }); for (const e of list) e.ai.target = p.id; g.target = list[0].id; return list.length }
      window.__pzHeat = (n = 2) => addHeat(game.current, n, 'contraband')
      window.__pzDock = () => requestDock(game.current)
      window.__pzTransfer = (dest) => { const g = game.current; setDestination(g, dest); return startTransfer(g, dest) }
    }
    setPlaceKey(`${game.current.place}:${Date.now()}`)
    controls.current.keys.clear()
    controls.current.actions.length = 0
    seen.current = 0
    setPhase('play')
    startSound()
  }, [])

  // Continue straight away when there is a save (the click that brought us here counts as the gesture).
  useEffect(() => { if (phase === 'loading') begin(loadSave()) }, [phase, begin])

  useEffect(() => {
    const cfg = realtimeConfig()
    if (phase !== 'play' || !cfg || !skyOn) return
    let id
    try { id = localStorage.getItem('pz-sky-id') ?? `s${Math.random().toString(36).slice(2, 10)}`; localStorage.setItem('pz-sky-id', id) } catch { id = `s${Math.random().toString(36).slice(2, 10)}` }
    const g = game.current
    sky.current = createSky({ me: id, name: g?.pilot.name ?? 'Pilot', suit: g?.pilot.suit, open: (room, o) => connectRoom({ url: cfg.url, key: cfg.key, room, id, meta: o?.meta }) })
    online.current = connectRoom({ url: cfg.url, key: cfg.key, room: 'pz-online', id, meta: { mode: 'game' } })
    online.current.onPresence = (r) => { if (game.current) game.current.skyOnline = r.size }
    return () => { closeSky(sky.current); sky.current = null; online.current?.close(); online.current = null; if (game.current) game.current.skyOnline = null }
  }, [phase, skyOn])

  // The interface's own keys.
  useEffect(() => {
    if (phase !== 'play') return
    const c = controls.current
    c.wantLock = () => !overlayRef.current && game.current?.mode === 'flight' && !touch
    const onUi = (what) => {
      const g = game.current
      if (!g) return
      if (what === 'lock-failed') { g.emit({ type: 'toast', text: 'Mouse capture is unavailable here. Drag the view to steer; K fires. Arrow keys also steer.' }); return }
      if (what === 'unlocked') { if (g.mode === 'flight' && !overlayRef.current) setOverlay('pause'); return }
      if (what === 'pause') { if (g.cine) { setOverlay((o) => (o ? null : 'pause')); return } setOverlay((o) => (o ? null : 'pause')); return }
      if (what === 'map') { if (g.mode === 'flight' || g.mode === 'docked') { document.exitPointerLock?.(); setOverlay((o) => (o === 'map' ? null : 'map')) } return }
      if (what === 'log') { document.exitPointerLock?.(); setOverlay((o) => (o === 'log' ? null : 'log')); return }
      if (what === 'help') { document.exitPointerLock?.(); setOverlay('help'); return }
      if (what === 'respawn' && g.mode === 'dead') respawn(g)
      if (what === 'hail') hail(g, sky.current)
    }
    // A lazy scene can mount after this effect. Bind to its actual canvas,
    // never to the old film canvas or body (which would capture menu clicks).
    let bound = null, unbind = () => {}
    const attach = () => {
      if (c.canvas?.isConnected && c.canvas !== bound) {
        unbind(); bound = c.canvas; unbind = bindDesktop(c, bound, onUi)
      }
    }
    attach()
    const binding = setInterval(attach, 100)
    // Space skips a cutscene.
    const skip = (e) => { if (e.code === 'Space' && game.current?.cine) { game.current.cine = null; e.preventDefault() } }
    window.addEventListener('keydown', skip)
    return () => { clearInterval(binding); window.removeEventListener('keydown', skip); unbind() }
  }, [phase, touch])

  // Ten times a second: re-render the interface, play sounds for new events, save now and then.
  useEffect(() => {
    if (phase !== 'play') return
    const id = setInterval(() => {
      const g = game.current
      if (!g) return
      setTick((n) => n + 1)
      setPlaceKey((k) => (k.startsWith(`${g.place}:`) ? k : `${g.place}:${Date.now()}`))
      for (const ev of g.events) {
        if (ev.n <= seen.current) continue
        sound(g, ev)
      }
      seen.current = g.evN
      if (sky.current) syncSky(g, sky.current, 0.1)
      duck(g.comms.length > 0)
      engineLevel(g.player.thrust ?? 0, g.player.boosting, g.mode === 'flight')
      if (g.mode === 'flight' && g.sinceSave > 60) autosave(g)
    }, 100)
    return () => clearInterval(id)
  }, [phase])

  useEffect(() => {
    controls.current.keys.clear(); controls.current.actions.length = 0
    controls.current.mouse.down = false
    controls.current.mouse.dx = controls.current.mouse.dy = 0
    pauseSound(overlay === 'pause')
    if (overlay) document.exitPointerLock?.()
  }, [overlay])

  // The one quality decision the game makes about itself, pure policy in
  // core/quality.js and measured here on the same sampler the resolution
  // governor steers by. It fires once, a few seconds in, and it covers the
  // bay, the boarding and the first flight alike, because all three are drawn
  // before the player has any reason to visit Settings about it.
  const perf = useRef({ t0: 0, done: false })
  const onFrame = useCallback((g, camera) => {
    if (markers.current) updateMarkers(markers.current, g, camera, controls.current)
    const pf = perf.current
    if (pf.done) return
    const now = performance.now()
    if (!pf.t0) { pf.t0 = now; return }
    if (now - pf.t0 < 4500) return
    pf.done = true
    // The middle of the shared ring rather than its mean, for the same reason
    // the film reads the middle of its window: the first seconds of the bay pay
    // for a panorama, a halved hangar and a pilot, and one cold decode must not
    // be mistaken for a slow machine. Gaps over two seconds are excluded by the
    // summary itself, so a tab that slept decides nothing.
    const summary = summarizeFrameTimes()
    const middle = summary?.p50 ?? 0
    const d = checkpointTier(qualityRef.current, middle, { explicit: Boolean(readChoice()), learned: readTier(), measured: Boolean(summary) })
    if (d.tier !== qualityRef.current) { setQuality(d.tier); qualityRef.current = d.tier }
    if (d.remember) rememberTier(d.tier)
    if (d.reason === 'slow') g.emit({ type: 'toast', text: `This machine is drawing at about ${Math.round(1000 / middle)} frames a second, so the game has switched to Fast graphics. High is in Menu, Settings.` })
  }, [])

  if (phase === 'new') return <NewPilot onBegin={(name, suit) => { newPilot.current = newSave(name, suit); startSound(); setPhase('prologue') }} onExit={onExit} />
  if (phase === 'prologue') return <Prologue onComplete={(tier) => { deleteSave(); if (tier) { qualityRef.current = tier; setQuality(tier) } begin(newPilot.current, true) }} />
  const g = game.current
  if (!g) return <div className="gm-loading">Loading</div>

  const paused = Boolean(overlay) || g.mode === 'surface'
  const enterSchool = () => { autosave(g); window.location.hash = '#sim' }
  return <div className={`gm-root ${touch ? 'is-touch' : ''}`}>
    {g.mode !== 'surface' && <Suspense fallback={<div className="gm-loading">Loading the Earth-Moon system</div>}>
      <GameScene game={game} controls={controls} quality={quality} placeKey={placeKey} paused={paused} onFrame={onFrame} />
    </Suspense>}
    {g.mode === 'surface' && <Suspense fallback={<div className="gm-loading">Descending</div>}>
      <Surface world="moon" mode="game" title="Shackleton" upgrades={{}} onExit={(result) => { returnFromSurface(g, result ?? null); setTick((n) => n + 1) }} />
    </Suspense>}
    {g.mode !== 'surface' && <>
      <div className="gm-markers" ref={markers} hidden={Boolean(g.cine)} />
      {g.mode !== 'docked' && <Hud game={g} touch={touch} controls={controls.current} onOverlay={setOverlay} />}
      {g.cine && <button className="gm-skip" onClick={() => { g.cine = null; play('click') }}>Skip{!touch && <kbd className="gk">Space</kbd>}</button>}
      {g.mode === 'docked' && !overlay && !g.cine && <Station game={g} touch={touch} onLaunch={() => { launch(g); play('click'); controls.current.canvas?.focus() }} onOverlay={setOverlay} onSchool={enterSchool} />}
      {!g.cine && <Comms game={g} />}
      {g.cine?.kind === 'board' && <div className="boarding-label"><span className="st-eyebrow">Hearth / Berth 09</span><strong>Flight clearance pending</strong><p>Your first job begins with a ship you can trust.</p></div>}
      <Banners game={g} touch={touch} onRespawn={() => respawn(g)} />
      {touch && (g.mode === 'flight' || g.mode === 'transfer') && !overlay && <Touch controls={controls.current} game={g} onOverlay={(o) => (o === 'hail' ? hail(g, sky.current) : setOverlay(o))} />}
      {overlay === 'map' && <MapView game={g} touch={touch} onClose={() => setOverlay(null)} />}
      {overlay === 'log' && <Log game={g} touch={touch} onClose={() => setOverlay(null)} />}
      {(overlay === 'pause' || overlay === 'help') && <Pause game={g} touch={touch} help={overlay === 'help'} quality={quality} setQuality={chooseQuality} controls={controls.current} onSky={setSkyOn} onSchool={enterSchool}
        onResume={() => setOverlay(null)} onQuit={() => { autosave(g); onExit?.() }} />}
      {g.mode === 'flight' && !touch && !controls.current.mouse.locked && !overlay && <div className="gm-takestick">{controls.current.mouse.fallback ? 'Drag the view to steer · K to fire' : 'Click the view to take the stick'}</div>}
    </>}
  </div>
}

/** Which sound for which event, and how loud for how far. */
export function sound(g, ev) {
  const p = g.player
  const near = (x, y, z) => Math.max(0, 1 - Math.hypot(x - p.pos.x, y - p.pos.y, z - p.pos.z) / 3000)
  switch (ev.type) {
    case 'fire': { if (ev.player) play('fire', 0.7, { player: true }); else { const e = g.byId(ev.ship); if (e) play('fire', near(e.pos.x, e.pos.y, e.pos.z) * 0.6) } break }
    case 'hit': if (ev.player) play(ev.shield ? 'hit-shield' : 'hit-hull', 1); else if (ev.byPlayer) play('hit-shield', 0.35); break
    case 'explode': play('explode', ev.player ? 1 : near(ev.x, ev.y, ev.z) + 0.15); break
    case 'bump': if (ev.player) play('bump', 1); break
    case 'roll': case 'pickup': case 'paid': case 'target': case 'denied': case 'dock-start': case 'dock': case 'launch': case 'burn': case 'flip': case 'arrive': case 'mission-complete': case 'mission-failed': play(ev.type); break
    case 'comms': play('comms'); break
    case 'heat': if (ev.level > 0 && ev.why !== 'cooling') play('heat'); break
    case 'objective-done': play('objective'); break
    case 'wave': play('heat'); break
    case 'wave-clear': play('mission-complete'); break
    case 'skirmish-over': play('mission-failed'); break
    case 'kill-credit': play('paid'); break
  }
}
