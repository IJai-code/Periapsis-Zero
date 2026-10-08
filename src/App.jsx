import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { ACESFilmicToneMapping } from 'three'
import { boundedRatio } from './gfx/renderBudget.js'
import { Scene } from './components/Scene.jsx'
import { Resolution } from './components/Resolution.jsx'
import { Photograph } from './components/Photograph.jsx'
import { Hud } from './ui/Hud.jsx'
import { useAssets } from './gfx/useAssets.js'
import { releaseDirector, resumeDirector } from './sim/director.js'
import { setUi, uiStore, useUi } from './sim/store.js'
import { QUALITY, chooseDevice, guessDevice } from './sim/device.js'
import { requestedPreset, startPreset } from './sim/presets.js'
import { MissionIntro } from './ui/MissionIntro.jsx'
import { LicenceToast } from './ui/LicenceToast.jsx'
import { TRANSIT } from './gfx/transit.js'
import { introEnd } from './gfx/introFlights.js'
import { requestedProgram, armProgram, program } from './sim/programs.js'
import { resetMission } from './sim/mission.js'
import { isLandable } from './sim/worlds.js'

/** The mission library opens on demand, so it loads on demand (see Hud.jsx). */
const MissionLibrary = lazy(() => import('./ui/MissionLibrary.jsx').then((m) => ({ default: m.MissionLibrary })))
/** A landing, on whatever world is in view: the surface game (ui/Surface.jsx), loaded when first flown. */
const Surface = lazy(() => import('./ui/Surface.jsx').then((m) => ({ default: m.Surface })))

// Survives mode changes, not a page reload. Returning to Simulator must not
// silently replay the preset and overwrite the flight the player left.
let addressApplied = false

/*
 * No question before the first frame.
 *
 * The simulator used to open on a full-screen "What are you flying on?" and
 * draw nothing until it was answered, including for someone who had followed
 * a link straight to a mission. The guess was already good enough to build
 * the scene with (QUALITY is initialised from it), so it is now simply used,
 * remembered, and offered for change in a one-line notice instead of a gate.
 * Runs once, when this chunk loads, before anything renders.
 */
if (!uiStore.get().device) {
  const guess = guessDevice()
  chooseDevice(guess)
  uiStore.set({ device: guess, deviceGuessed: true, panelOpen: false })
}

export default function App() {
  const assets = useAssets()
  const [visible, setVisible] = useState(() => !document.hidden)
  const [library, setLibrary] = useState(false)
  const [intro, setIntro] = useState(null)
  const introRef = useRef(null)
  const graphicsLost = useUi((s) => s.graphicsLost)
  const surface = useUi((s) => s.surface)
  /* Back from the surface: the simulator resumes looking at the world just left. */
  const leaveSurface = useCallback(() => {
    const cur = uiStore.get().surface
    if (!cur) return
    setUi({ surface: null, focus: cur.world })
    if (/^#land\//.test(window.location.hash)) history.replaceState(null, '', '#flight')
  }, [])
  useEffect(() => {
    const update = () => setVisible(!document.hidden)
    document.addEventListener('visibilitychange', update)
    resumeDirector()
    return () => { document.removeEventListener('visibilitychange', update); releaseDirector() }
  }, [])
  const introDone = useCallback(() => {
    const cur = introRef.current
    introRef.current = null; setIntro(null)
    if (cur) { introEnd(); setUi({ warp: cur.warp, paused: false, focus: cur.focus, broadcast: true }) }
  }, [])
  /*
   * Skipping is a cut, not a flight.
   *
   * The curtain holds the camera wherever the intro was going to start from,
   * which for a mission at the Moon is about an astronomical unit out, and
   * handing over by changing the focus planned an ordinary move from there.
   * Measured on Apollo 11's liftoff: after Skip the screen showed empty stars
   * for ten seconds while the camera crossed 147 million km to Tranquility
   * Base. Someone who presses Skip has said they do not want the journey, so
   * the move arrives in one frame, the way a shared link does.
   */
  const introSkipped = useCallback(() => {
    TRANSIT.arrive = true
    introDone()
  }, [introDone])
  useEffect(() => {
    if (addressApplied) return
    addressApplied = true
    if (/^#land\//.test(window.location.hash)) return
    const preset = requestedPreset()
    if (preset) {
      const run = startPreset(preset)
      introRef.current = { preset, focus: run.focus ?? 'earth', warp: run.warp }
      setIntro(introRef.current)
      setUi({ warp: run.warp, paused: true, focus: 'intro' })
    } else {
      const def = requestedProgram()
      if (def && !program.armed) { armProgram(def, def.wings[0] ?? 'trainee'); resetMission(); setUi({ paused: false, focus: 'ground' }) }
    }
  }, [])
  // #land/<world>: straight onto the surface of that world, on arrival or
  // whenever the address changes to one.
  useEffect(() => {
    const land = (event) => {
      const id = window.location.hash.match(/^#land\/([a-z]+)$/)?.[1]
      if (id && isLandable(id) && uiStore.get().surface?.world !== id) setUi({ focus: id, surface: { world: id, mode: 'free' } })
      // Arriving anywhere else, or Back out of a landing's address, leaves the
      // surface: a landing belongs to the page that started it.
      else if (!id && uiStore.get().surface && (!event || uiStore.get().surface.mode === 'free')) setUi({ surface: null })
    }
    land()
    window.addEventListener('hashchange', land)
    return () => { window.removeEventListener('hashchange', land); setUi({ surface: null }) }
  }, [])
  return <div className="fixed inset-0 bg-black">
    <Canvas frameloop={visible && !surface ? 'always' : 'never'} shadows style={{ isolation: 'isolate' }} dpr={boundedRatio(window.innerWidth, window.innerHeight, 1)}
      // Metre-scale historical scene: logarithmic depth and a floating origin
      // span the hull-to-AU range without changing physical scale.
      gl={{ antialias: QUALITY.antialias, logarithmicDepthBuffer: true, toneMapping: ACESFilmicToneMapping, toneMappingExposure: 1.0, powerPreference: 'high-performance' }}
      camera={{ position: [3.16e7, 5.95e6, 7.78e6], fov: 45, near: 0.1, far: 1e13 }}>
      <Resolution /><Photograph />
      <Suspense fallback={null}>{assets.ready && <Scene textures={assets.textures} />}</Suspense>
    </Canvas>
    <LicenceToast />
    {/* A landing does not wait for the solar system's imagery. Textures feed
        Scene alone, and Scene does not draw while a surface expedition holds
        the screen, so gating the landing behind them only made a phone wait
        on megabytes it was never going to look at. */}
    {surface ? null : assets.ready ? intro ? <MissionIntro preset={intro.preset} finalFocus={intro.focus} onBegin={introDone} onSkip={introSkipped} /> : <Hud onLibrary={() => setLibrary(true)} /> : <div className="simulator-loading" role="status" aria-live="polite"><span className="eyebrow">Simulator</span><h1>Preparing the solar system.</h1><p>{assets.label} · {Math.round(assets.progress * 100)}%</p><progress max="1" value={assets.progress} aria-label="Loading the solar system" /><button className="quiet-button" onClick={() => { window.location.hash = '' }}>← Home</button></div>}
    {library && <Suspense fallback={null}><MissionLibrary open onClose={() => setLibrary(false)} /></Suspense>}
    {surface && <Suspense fallback={<div className="simulator-loading" role="status" aria-live="polite"><span className="eyebrow">Descent</span><h1>Preparing the surface.</h1></div>}><Surface key={`${surface.world}/${surface.mode}`} world={surface.world} mode={surface.mode} upgrades={surface.upgrades} onExit={leaveSurface} /></Suspense>}
    {graphicsLost && <div role="alertdialog" aria-label="Graphics interrupted" className="fixed inset-0 z-[60] flex items-center justify-center bg-black/95 p-8"><div className="max-w-md text-hud"><h2 className="font-display text-3xl">Graphics interrupted</h2><p className="mt-3 text-sm text-hud/65">The browser lost its GPU context. Reload to recreate the drawing buffer.</p><button className="control mt-6 border border-ember px-4 py-2 text-ember" onClick={() => window.location.reload()}>Reload safely</button></div></div>}
  </div>
}
