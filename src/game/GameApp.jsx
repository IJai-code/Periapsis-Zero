import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { autosave, launch, loadSave, newSave, respawn, returnFromSurface, startGame, deleteSave } from './core/game.js'
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
  const [placeKey, setPlaceKey] = useState('')
  const overlayRef = useRef(overlay)
  overlayRef.current = overlay
  const markers = useRef(null)
  const seen = useRef(0)

  const begin = useCallback((save) => {
    game.current = startGame(save)
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
  useEffect(() => { try { localStorage.setItem(QUALITY_KEY, quality) } catch { /* fine */ } }, [quality])

  const onFrame = useCallback((g, camera) => { if (markers.current) updateMarkers(markers.current, g, camera, controls.current) }, [])

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
      {(overlay === 'pause' || overlay === 'help') && <Pause game={g} touch={touch} help={overlay === 'help'} quality={quality} setQuality={setQuality} controls={controls.current}
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
