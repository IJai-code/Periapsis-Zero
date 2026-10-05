import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { autosave, launch, loadSave, newSave, respawn, returnFromSurface, startGame, deleteSave, loadPlace, worldUp, spawnRaiders, setDestination, startTransfer, addHeat } from './core/game.js'
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
import { Log } from './ui/Log.jsx'
import { updateMarkers } from './ui/markers.js'
import './ui/game.css'

const GameScene = lazy(() => import('./scene/GameScene.jsx'))
const Surface = lazy(() => import('../ui/Surface.jsx'))

/**
 * The game, at #play. Owns the running game object, the controls, the 3D
 * view and every overlay. React re-renders the interface ten times a second
 * from the game object; the things that move every frame (markers, the
 * reticle, the speed) are written straight to the DOM by the frame loop.
 */
const QUALITY_KEY = 'pz-game-quality'
export default function GameApp({ onExit, fresh = false, onFresh }) {
  const game = useRef(null)
  const controls = useRef(createControls())
  const [phase, setPhase] = useState(() => (!fresh && loadSave() ? 'loading' : 'new'))
  useEffect(() => { onFresh?.() }, [onFresh])
  const [, setTick] = useState(0)
  const [overlay, setOverlay] = useState(null) // 'map' | 'log' | 'pause' | null
  const [touch] = useState(isTouch)
  const [quality, setQuality] = useState(() => { try { return localStorage.getItem(QUALITY_KEY) ?? 'high' } catch { return 'high' } })
  const chooseQuality = useCallback((q) => { setQuality(q); try { localStorage.setItem(QUALITY_KEY, q) } catch { /* fine */ } }, [])
  const [placeKey, setPlaceKey] = useState('')
  const overlayRef = useRef(overlay)
  overlayRef.current = overlay
  const markers = useRef(null)
  const seen = useRef(0)

  const begin = useCallback((save) => {
    game.current = startGame(save)
    // For the browser checks in scripts/: the running game, in development only.
    if (import.meta.env.DEV) {
      window.__game = game.current
      // Staging helpers for screenshots and checks: aim at a local point, or jump to a place.
      window.__pzLook = (x, y, z) => { const g = game.current, p = g.player; p.q.setFromRotationMatrix(new THREE.Matrix4().lookAt(p.pos, new THREE.Vector3(x, y, z), worldUp(g, new THREE.Vector3()))); p.vel.set(0, 0, 0); p.ctrl.throttle = 0 }
      window.__pzGo = (place, x = 0, y = 300, z = 4200) => { const g = game.current; g.mode = 'flight'; g.docked = null; loadPlace(g, place); g.player.pos.set(x, y, z); g.player.vel.set(0, 0, 0) }
      window.__pzV = (x, y, z) => new THREE.Vector3(x, y, z)
      window.__pzRaid = (n = 3, d = 900) => { const g = game.current, p = g.player; const at = new THREE.Vector3(0, 0, -d).applyQuaternion(p.q).add(p.pos); const list = spawnRaiders(g, n, at, 'show', { mode: 'attack' }); for (const e of list) e.ai.target = p.id; g.target = list[0].id; return list.length }
      window.__pzHeat = (n = 2) => addHeat(game.current, n, 'contraband')
      window.__pzTransfer = (dest) => { const g = game.current; setDestination(g, dest); return startTransfer(g, dest) }
    }
    setPlaceKey(`${game.current.place}:${Date.now()}`)
    setPhase('play')
    startSound()
  }, [])

  // Continue straight away when there is a save (the click that brought us here counts as the gesture).
  useEffect(() => { if (phase === 'loading') begin(loadSave()) }, [phase, begin])

  // The interface's own keys.
  useEffect(() => {
    if (phase !== 'play') return
    const c = controls.current
    c.wantLock = () => !overlayRef.current && game.current?.mode === 'flight' && !touch
    const onUi = (what) => {
      const g = game.current
      if (!g) return
      if (what === 'unlocked') { if (g.mode === 'flight' && !overlayRef.current) setOverlay('pause'); return }
      if (what === 'pause') { setOverlay((o) => (o ? null : 'pause')); return }
      if (what === 'map') { if (g.mode === 'flight' || g.mode === 'docked') { document.exitPointerLock?.(); setOverlay((o) => (o === 'map' ? null : 'map')) } return }
      if (what === 'log') { document.exitPointerLock?.(); setOverlay((o) => (o === 'log' ? null : 'log')); return }
      if (what === 'help') { document.exitPointerLock?.(); setOverlay('help'); return }
      if (what === 'respawn' && g.mode === 'dead') respawn(g)
    }
    const canvas = c.canvas ?? document.querySelector('canvas')
    return bindDesktop(c, canvas ?? document.body, onUi)
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
      duck(g.comms.length > 0)
      engineLevel(g.player.thrust ?? 0, g.player.boosting, g.mode === 'flight')
      if (g.mode === 'flight' && g.sinceSave > 60) autosave(g)
    }, 100)
    return () => clearInterval(id)
  }, [phase])

  useEffect(() => { pauseSound(overlay === 'pause') }, [overlay])

  // Automatic quality: if the first seconds of flight run slower than about
  // 25 frames a second, drop to the fast settings (lower resolution, no
  // bloom, fewer stars), once, and say so. A choice made in settings wins.
  const perf = useRef({ t0: 0, frames: 0, done: false })
  const onFrame = useCallback((g, camera) => {
    if (markers.current) updateMarkers(markers.current, g, camera, controls.current)
    const pf = perf.current
    if (pf.done || g.mode !== 'flight') return
    const now = performance.now()
    if (!pf.t0) { pf.t0 = now; return }
    pf.frames++
    if (now - pf.t0 > 4000) {
      pf.done = true
      const fps = pf.frames / ((now - pf.t0) / 1000)
      let chosen = null
      try { chosen = localStorage.getItem(QUALITY_KEY) } catch { /* none */ }
      if (fps < 25 && !chosen) { setQuality('low'); g.emit({ type: 'toast', text: 'Switched to fast graphics for this machine. Change it in Menu, Settings.' }) }
    }
  }, [])

  if (phase === 'new') return <NewPilot onBegin={(name) => { deleteSave(); begin(newSave(name)) }} onExit={onExit} />
  const g = game.current
  if (!g) return <div className="gm-loading">Loading</div>

  const paused = overlay === 'pause' || overlay === 'help' || g.mode === 'surface'
  return <div className={`gm-root ${touch ? 'is-touch' : ''}`}>
    {g.mode !== 'surface' && <Suspense fallback={<div className="gm-loading">Loading the Earth-Moon system</div>}>
      <GameScene game={game} controls={controls} quality={quality} placeKey={placeKey} paused={paused} onFrame={onFrame} />
    </Suspense>}
    {g.mode === 'surface' && <Suspense fallback={<div className="gm-loading">Descending</div>}>
      <Surface world="moon" mode="game" title="Shackleton" upgrades={{}} onExit={(result) => { returnFromSurface(g, result ?? null); setTick((n) => n + 1) }} />
    </Suspense>}
    {g.mode !== 'surface' && <>
      <div className="gm-markers" ref={markers} />
      {g.mode !== 'docked' && <Hud game={g} touch={touch} controls={controls.current} onOverlay={setOverlay} />}
      {g.mode === 'docked' && !overlay && <Station game={g} touch={touch} onLaunch={() => { launch(g); play('click') }} onOverlay={setOverlay} />}
      <Comms game={g} />
      <Banners game={g} touch={touch} onRespawn={() => respawn(g)} />
      {touch && g.mode === 'flight' && !overlay && <Touch controls={controls.current} game={g} onOverlay={setOverlay} />}
      {overlay === 'map' && <MapView game={g} touch={touch} onClose={() => setOverlay(null)} />}
      {overlay === 'log' && <Log game={g} touch={touch} onClose={() => setOverlay(null)} />}
      {(overlay === 'pause' || overlay === 'help') && <Pause game={g} touch={touch} help={overlay === 'help'} quality={quality} setQuality={chooseQuality} controls={controls.current}
        onResume={() => setOverlay(null)} onQuit={() => { autosave(g); onExit?.() }} />}
      {g.mode === 'flight' && !touch && !controls.current.mouse.locked && !overlay && <div className="gm-takestick">Click the view to take the stick</div>}
    </>}
  </div>
}

/** Which sound for which event, and how loud for how far. */
function sound(g, ev) {
  const p = g.player
  const near = (x, y, z) => Math.max(0, 1 - Math.hypot(x - p.pos.x, y - p.pos.y, z - p.pos.z) / 3000)
  switch (ev.type) {
    case 'fire': { if (ev.player) play('fire', 0.7, { player: true }); else { const e = g.byId(ev.ship); if (e) play('fire', near(e.pos.x, e.pos.y, e.pos.z) * 0.6) } break }
    case 'hit': if (ev.player) play(ev.shield ? 'hit-shield' : 'hit-hull', 1); else if (ev.byPlayer) play('hit-shield', 0.35); break
    case 'explode': play('explode', ev.player ? 1 : near(ev.x, ev.y, ev.z) + 0.15); break
    case 'bump': if (ev.player) play('bump', 1); break
    case 'pickup': case 'paid': case 'target': case 'denied': case 'dock-start': case 'dock': case 'launch': case 'burn': case 'flip': case 'arrive': case 'mission-complete': case 'mission-failed': play(ev.type); break
    case 'comms': play('comms'); break
    case 'heat': if (ev.level > 0 && ev.why !== 'cooling') play('heat'); break
    case 'objective-done': play('objective'); break
  }
}
