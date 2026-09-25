import { Suspense, useCallback, useEffect, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { ACESFilmicToneMapping } from 'three'
import { Scene } from './components/Scene.jsx'
import { Hud } from './ui/Hud.jsx'
import { Landing } from './ui/Landing.jsx'
import { useAssets } from './gfx/useAssets.js'
import { releaseDirector, resumeDirector } from './sim/director.js'
import { setUi } from './sim/store.js'
import { requestedPreset, startPreset } from './sim/presets.js'
import { unlockAudio } from './sfx/engine.js'

/**
 * Which half of the product is on screen, from the URL.
 *
 * The hash rather than a router: there are two views, they should be linkable
 * and survive a reload, and adding a routing library to express that would be
 * more moving parts than the thing it expresses. `#flight` is the simulator;
 * anything else is the front door.
 */
const FLIGHT = '#flight'
const isFlight = () => window.location.hash === FLIGHT

export default function App() {
  const assets = useAssets()
  const [flight, setFlight] = useState(isFlight)

  useEffect(() => {
    const onHash = () => setFlight(isFlight())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  /**
   * The camera belongs to the opening shot until the player asks for it.
   *
   * The director would otherwise take it on the first frame — it has a shot for
   * every mission phase and PRE_LAUNCH is one — so it is released while the
   * front door is up and resumed on the way in. Same mechanism a pilot uses to
   * take the camera by hand; the landing page is just another pilot.
   */
  useEffect(() => {
    if (flight) {
      resumeDirector()
    } else {
      releaseDirector()
      setUi({ focus: 'cinematic', paused: false })
    }
  }, [flight])

  /**
   * A preset in the address is flown now, before the frame loop mounts: the store
   * opens paused and the driver waits for the assets, so nothing else has touched
   * the simulation yet. Then the dial is handed over and the flight plays.
   */
  useEffect(() => {
    const preset = requestedPreset()
    if (!preset) return
    const run = startPreset(preset)
    /*
     * The shot `startPreset` resolved, which is the preset's own if it names one
     * and the director's for the phase we arrived in otherwise.
     *
     * Applying it here is the only place it can be applied. The driver seeds its
     * memory of the director's request on the first frame *instead* of applying
     * it, so that a camera chosen before the loop started survives into it — and
     * a preset that left this unset was therefore stuck on the store's `earth`
     * for as long as consecutive phases kept asking for the same thing. Setting
     * it to what the director will ask for anyway is not a fight: the request
     * already equals it, so no cut is triggered and the pilot keeps the camera
     * from the next phase boundary on, exactly as before.
     */
    setUi({ warp: run.warp, paused: false, ...(run.focus ? { focus: run.focus } : {}) })
  }, [])

  const enter = useCallback(() => {
    // The click that lets the browser start audio: the graph is built here.
    unlockAudio()
    window.location.hash = FLIGHT
    setFlight(true)
  }, [])

  return (
    <div className="fixed inset-0 bg-black">
      <Canvas
        /**
         * Uncapped device pixel ratio on the front door, where the frame is a
         * still-ish planet and the budget is spare, and capped at 2 in flight
         * where a 3x retina panel would quadruple the fill cost of a scene that
         * is already drawing an atmosphere shader per pixel.
         */
        /**
         * Shadow maps, for the one light that can usefully have one: the ground
         * beam in `GroundLight.jsx`. Nothing else in the scene casts, and the
         * beam only exists within 220 km of a pad, so this costs a depth pass
         * over four pad draw calls and a hull while standing on the ground and
         * nothing at all anywhere else.
         */
        shadows
        dpr={flight ? [1, 2] : [1, 3]}
        /**
         * One scene unit is one metre, so the camera has to span from a
         * spacecraft hull to an astronomical unit — fourteen decades. The
         * logarithmic depth buffer is what makes that a single camera instead
         * of a cascade, and probe.html measures what it actually delivers here
         * rather than what the encoding promises: 0.18 um at 1 m, 7.3 m at
         * Earth's limb, 297 km at 1 AU, tightest margin 3.4x against the Sun's
         * disc. A linear buffer resolves nothing past 1e4 m.
         *
         * `far` is a depth-density dial, not a visibility boundary. At
         * far/near = 1e14 the projection matrix's (f+n)/(n-f) rounds to exactly
         * -1 in float32 and the far plane stops culling altogether — measured
         * to fail between f/n of 1e7 and 1e9. Nothing is ever clipped for being
         * distant, which for a space scene is the behaviour you want anyway.
         */
        gl={{
          antialias: true,
          logarithmicDepthBuffer: true,
          toneMapping: ACESFilmicToneMapping,
          toneMappingExposure: 1.0,
          powerPreference: 'high-performance',
        }}
        camera={{ position: [3.16e7, 5.95e6, 7.78e6], fov: 45, near: 0.1, far: 1e13 }}
      >
        <Suspense fallback={null}>{assets.ready && <Scene textures={assets.textures} />}</Suspense>
      </Canvas>

      {flight ? (
        assets.ready && <Hud />
      ) : (
        <Landing
          ready={assets.ready}
          progress={assets.progress}
          label={assets.label}
          onEnter={enter}
        />
      )}
    </div>
  )
}
