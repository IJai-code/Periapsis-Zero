import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { boundedRatio } from './gfx/renderBudget.js'
import { ACESFilmicToneMapping } from 'three'
import { Scene } from './components/Scene.jsx'
import { Resolution } from './components/Resolution.jsx'
import { Photograph } from './components/Photograph.jsx'
import { Hud } from './ui/Hud.jsx'
import { Landing } from './ui/Landing.jsx'
import { useAssets } from './gfx/useAssets.js'
import { releaseDirector, resumeDirector } from './sim/director.js'
import { setUi, useUi } from './sim/store.js'
import { QUALITY, chooseDevice } from './sim/device.js'
import { DevicePrompt } from './ui/DevicePrompt.jsx'
import { requestedPreset, startPreset } from './sim/presets.js'
import { MissionLibrary } from './ui/MissionLibrary.jsx'
import { Guide, guideShouldOpen } from './ui/Guide.jsx'
import { MissionIntro } from './ui/MissionIntro.jsx'
import { introEnd } from './gfx/introFlights.js'

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
  /**
   * Nothing is built until the visitor has said what it runs on — see
   * sim/device.js. The textures still synthesise behind the question, so
   * answering it costs no time; only the canvas, whose antialiasing and pixel
   * ratio the answer sets, waits for it.
   */
  const device = useUi((s) => s.device)
  const graphicsLost = useUi((s) => s.graphicsLost)
  const choose = useCallback((id) => {
    chooseDevice(id)
    setUi({ device: id, panelOpen: window.innerWidth >= 1024 && id !== 'phone' })
  }, [])
  const [flight, setFlight] = useState(isFlight)
  // The guide opens once per browser; the library opens when asked. Both live
  // here because both steer or span the same shared scene from either half.
  const [guide, setGuide] = useState(guideShouldOpen)
  const [library, setLibrary] = useState(false)
  /** The mission intro, while one is being shown: the preset and where it lands. */
  const [intro, setIntro] = useState(null)
  const introRef = useRef(null)

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
      // The feed is a view of a flight; the front door is not one.
      setUi({ focus: 'cinematic', paused: false, broadcast: false })
    }
  }, [flight])

  /**
   * A preset in the address is flown now, before the frame loop mounts: the store
   * opens paused and the driver waits for the assets, so nothing else has touched
   * the simulation yet. Then the dial is handed over and the flight plays.
   */
  /**
   * The hand-off: the intro settles, the mission takes the screen.
   *
   * The sim was paused through the flight so the sky the camera crossed would
   * hold still; it starts again here, on the exact frame the fast-forward left
   * — T-60 on the pad, or ignition, or a mile from Columbia. The director was
   * never released, and its standing request has not changed since the frame
   * loop mounted, so nothing cuts away from the shot being handed over.
   */
  const introDone = useCallback(() => {
    const cur = introRef.current
    introRef.current = null
    setIntro(null)
    if (cur) {
      introEnd()
      /*
       * And it goes on as a broadcast: the film hands over to the feed of the
       * mission rather than to the flight engineer's panels, which are a key
       * away (B) for anyone who came to fly it.
       */
      setUi({ warp: cur.warp, paused: false, focus: cur.focus, broadcast: true })
    }
  }, [])

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
    /**
     * In flight, a preset gets the film first: the curtain, the dossier's
     * pages, one continuous flight through the real system, and then the
     * mission on the frame the fast-forward left it. The sim stays paused
     * through the flight — the anchors are taken from the live ephemeris and
     * the sky has to hold still while the camera crosses it — and starts on
     * the hand-off above.
     */
    if (isFlight()) {
      introRef.current = { preset, focus: run.focus ?? 'earth', warp: run.warp }
      setIntro(introRef.current)
      setUi({ warp: run.warp, paused: true, focus: 'intro' })
      return
    }
    setUi({ warp: run.warp, paused: false, ...(run.focus ? { focus: run.focus } : {}) })
  }, [])

  const enter = useCallback(() => {
    setGuide(false)
    window.location.hash = FLIGHT
    setFlight(true)
  }, [])

  if (!device) return <DevicePrompt onChoose={choose} />

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
        /*
         * Its own stacking context. The scene's name tags are DOM laid over the
         * canvas, and drei ranks them by distance with z-indexes up to 20 — so
         * in the page's one shared context the nearer tags outranked the HUD's
         * z-10 and printed across the panels: HALLEY'S COMET over the
         * telemetry, URANUS through a row of figures. Isolated, the whole range
         * sorts inside the canvas and the HUD sits on top of all of it.
         */
        style={{ isolation: 'isolate' }}
        dpr={boundedRatio(window.innerWidth, window.innerHeight, 1)}
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
          antialias: QUALITY.antialias,
          logarithmicDepthBuffer: true,
          toneMapping: ACESFilmicToneMapping,
          toneMappingExposure: 1.0,
          powerPreference: 'high-performance',
        }}
        camera={{ position: [3.16e7, 5.95e6, 7.78e6], fov: 45, near: 0.1, far: 1e13 }}
      >
        <Resolution />
        <Photograph />
        <Suspense fallback={null}>{assets.ready && <Scene textures={assets.textures} />}</Suspense>
      </Canvas>

      {flight ? (
        assets.ready &&
        (intro ? (
          <MissionIntro
            preset={intro.preset}
            finalFocus={intro.focus}
            onBegin={introDone}
            onSkip={introDone}
          />
        ) : (
          <Hud />
        ))
      ) : (
        <Landing
          ready={assets.ready}
          progress={assets.progress}
          label={assets.label}
          /* The tour is its own screen: it steers the camera the page is
             laid over, and its captions sat on top of the page's own title,
             buttons and claims. The door steps aside while it runs. */
          hidden={guide && assets.ready}
          onEnter={enter}
          onLibrary={() => setLibrary(true)}
          onTour={() => setGuide(true)}
        />
      )}

      {/* The tour steers the live scene; the library is the drawer of flights.
          Both sit above either half because both are about the whole product. */}
      {!flight && (
        <Guide
          open={guide && assets.ready}
          onClose={() => setGuide(false)}
          onLibrary={() => {
            setGuide(false)
            setLibrary(true)
          }}
        />
      )}
      <MissionLibrary open={library} onClose={() => setLibrary(false)} />
      {graphicsLost && (
        <div role="alertdialog" aria-label="Graphics interrupted" className="fixed inset-0 z-[60] flex items-center justify-center bg-black/95 p-8">
          <div className="max-w-md text-hud">
            <h2 className="font-display text-3xl">Graphics interrupted</h2>
            <p className="mt-3 text-sm text-hud/65">The browser lost its GPU context. The view will resume if it recovers. You can also reload with a smaller drawing buffer; no mission or detail is removed.</p>
            <button className="control mt-6 border border-ember px-4 py-2 text-ember" onClick={() => window.location.reload()}>Reload safely</button>
          </div>
        </div>
      )}
    </div>
  )
}
