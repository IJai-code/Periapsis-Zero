import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { ACESFilmicToneMapping } from 'three'
import { boundedRatio } from './gfx/renderBudget.js'
import { Scene } from './components/Scene.jsx'
import { Resolution } from './components/Resolution.jsx'
import { Photograph } from './components/Photograph.jsx'
import { Hud } from './ui/Hud.jsx'
import { useAssets } from './gfx/useAssets.js'
import { releaseDirector, resumeDirector } from './sim/director.js'
import { setUi, useUi } from './sim/store.js'
import { QUALITY, chooseDevice } from './sim/device.js'
import { DevicePrompt } from './ui/DevicePrompt.jsx'
import { requestedPreset, startPreset } from './sim/presets.js'
import { MissionLibrary } from './ui/MissionLibrary.jsx'
import { MissionIntro } from './ui/MissionIntro.jsx'
import { introEnd } from './gfx/introFlights.js'
import { requestedProgram, armProgram, program } from './sim/programs.js'
import { resetMission } from './sim/mission.js'

// Survives mode changes, not a page reload. Returning to Simulator must not
// silently replay the preset and overwrite the flight the player left.
let addressApplied = false

export default function App() {
  const assets = useAssets()
  const [visible, setVisible] = useState(() => !document.hidden)
  const [library, setLibrary] = useState(false)
  const [intro, setIntro] = useState(null)
  const introRef = useRef(null)
  const device = useUi((s) => s.device)
  const graphicsLost = useUi((s) => s.graphicsLost)
  useEffect(() => {
    const update = () => setVisible(!document.hidden)
    document.addEventListener('visibilitychange', update)
    resumeDirector()
    return () => { document.removeEventListener('visibilitychange', update); releaseDirector() }
  }, [])
  const choose = useCallback((id) => { chooseDevice(id); setUi({ device: id, panelOpen: false }) }, [])
  const introDone = useCallback(() => {
    const cur = introRef.current
    introRef.current = null; setIntro(null)
    if (cur) { introEnd(); setUi({ warp: cur.warp, paused: false, focus: cur.focus, broadcast: true }) }
  }, [])
  useEffect(() => {
    if (addressApplied) return
    addressApplied = true
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
  if (!device) return <DevicePrompt onChoose={choose} />
  return <div className="fixed inset-0 bg-black">
    <Canvas frameloop={visible ? 'always' : 'never'} shadows style={{ isolation: 'isolate' }} dpr={boundedRatio(window.innerWidth, window.innerHeight, 1)}
      // Metre-scale historical scene: logarithmic depth and a floating origin
      // span the hull-to-AU range without changing physical scale.
      gl={{ antialias: QUALITY.antialias, logarithmicDepthBuffer: true, toneMapping: ACESFilmicToneMapping, toneMappingExposure: 1.0, powerPreference: 'high-performance' }}
      camera={{ position: [3.16e7, 5.95e6, 7.78e6], fov: 45, near: 0.1, far: 1e13 }}>
      <Resolution /><Photograph />
      <Suspense fallback={null}>{assets.ready && <Scene textures={assets.textures} />}</Suspense>
    </Canvas>
    {assets.ready ? intro ? <MissionIntro preset={intro.preset} finalFocus={intro.focus} onBegin={introDone} onSkip={introDone} /> : <Hud onLibrary={() => setLibrary(true)} /> : <div className="simulator-loading"><span className="eyebrow">Simulator / Historical flight</span><h1>Preparing the solar system.</h1><p>{assets.label} · {Math.round(assets.progress * 100)}%</p><progress max="1" value={assets.progress} /><button className="quiet-button" onClick={() => { window.location.hash = '' }}>← Mode select</button></div>}
    <MissionLibrary open={library} onClose={() => setLibrary(false)} />
    {graphicsLost && <div role="alertdialog" aria-label="Graphics interrupted" className="fixed inset-0 z-[60] flex items-center justify-center bg-black/95 p-8"><div className="max-w-md text-hud"><h2 className="font-display text-3xl">Graphics interrupted</h2><p className="mt-3 text-sm text-hud/65">The browser lost its GPU context. Reload to recreate the drawing buffer.</p><button className="control mt-6 border border-ember px-4 py-2 text-ember" onClick={() => window.location.reload()}>Reload safely</button></div></div>}
  </div>
}
