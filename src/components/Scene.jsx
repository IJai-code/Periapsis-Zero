import { OrbitControls } from '@react-three/drei'
import { Driver } from './Driver.jsx'
import { Cosmos } from './Cosmos.jsx'
import { Starfield } from './Starfield.jsx'
import { Sun } from './Sun.jsx'
import { GroundLight } from './GroundLight.jsx'
import { Earth } from './Earth.jsx'
import { Moon } from './Moon.jsx'
import { Craft } from './Craft.jsx'
import { ShipControls } from './ShipControls.jsx'
import { LagrangeProjector } from './LagrangeProjector.jsx'
import { Trail } from './Trail.jsx'
import { Trajectory } from './Trajectory.jsx'
import { Osculating } from './Osculating.jsx'
import { MapOverlay } from './MapOverlay.jsx'
import { Markers } from './Markers.jsx'
import { Planets } from './Planets.jsx'
import { Terrain } from './Terrain.jsx'
import { LunarSurface } from './LunarSurface.jsx'
import { CameraRig } from './CameraRig.jsx'
import { Effects } from './Effects.jsx'
import { useUi } from '../sim/store.js'
import { COSMIC } from '../sim/cosmic.js'
import { CRAFT, DAY, SHIP, YEAR } from '../sim/constants.js'

const LUNAR_MONTH = 27.321661 * DAY

/**
 * Nominal orbital periods, fixing each trail's sample spacing. Held constant
 * rather than read live, so a burn does not re-seed the trail mid-flight.
 */
const FLEET_TRAILS = [
  // `inSky`: the craft's own trail is the one that comes out of the vehicle
  // the shot is about, so it is the one that survives an ascent. See
  // gfx/instruments.js.
  { body: 'ship', period: 5545, head: '#e8823c', tail: '#4a2410', inSky: true },
  { body: 'iss', period: 5545, head: '#c9b48a', tail: '#3a3223' },
  { body: 'hubble', period: 5716, head: '#b9a3c4', tail: '#332b3a' },
]

export function Scene({ textures }) {
  const bloom = useUi((s) => s.bloom)
  const trails = useUi((s) => s.trails)
  /**
   * The opening shot carries no instrumentation.
   *
   * Name tags and libration-point markers are the flight HUD reaching into the
   * 3D scene, and on the front door they read as chrome over a photograph —
   * "TERRA" labelling a planet the reader can see. Gated on the shot rather
   * than on the `labels` toggle, because it is a property of what is being
   * shown and not a preference to be restored later.
   */
  const cinematic = useUi((s) => s.focus === 'cinematic')
  /**
   * Nor does a person standing on the ground. The eye-level view is the one
   * shot in the simulator that is meant to look like being there, and a
   * predicted orbit drawn up out of the pad, a trail, a floating name tag are
   * all the HUD reaching into it. Unlike the opening shot it keeps the terrain
   * and the planets: it is standing on the one and may see the others.
   */
  /*
   * `walk` joins it. A person on foot is the ground view with the standing
   * observer given feet, and a predicted orbit drawn up out of the pad reads
   * exactly as it does from the observer's spot: as the instrument panel
   * reaching into a photograph.
   */
  const ground = useUi((s) => s.focus === 'ground' || s.focus === 'walk')
  /**
   * Nor does the camera riding with the LM. Its predicted path starts inside
   * the ship and, climbing off the Moon, runs down through the ground ahead:
   * a line through the middle of a shot whose subject is a few metres wide.
   * The map and the Moon views still carry it.
   */
  const lunarChase = useUi((s) => s.focus === 'chase') && Boolean(SHIP.lunar)
  /**
   * Nor the mission intro. The flight is the film's own — trails, name tags,
   * predicted paths and the map overlay are all the instrument panel reaching
   * into it. Unlike the opening shot it keeps the planets and the terrain:
   * crossing those is what the flight is for.
   */
  const intro = useUi((s) => s.focus === 'intro')
  /**
   * Nor the front door's tour, for the same reason as the intro: it is a
   * caption over a shot, and the pilot's instruments in it — an apsis tag, an
   * orbit trail drawn across the caption, a planet's name tag landing on the
   * page's own title — were measured on the page doing exactly that.
   */
  const tour = useUi((s) => s.tour)
  /**
   * Nor the broadcast. A feed from a mission had no predicted path drawn up
   * out of the pad and no name tag on the Moon; what it had is in the caption.
   */
  const broadcast = useUi((s) => s.broadcast)
  const presenting = intro || tour || broadcast
  /**
   * Nor anywhere beyond the planets. A predicted orbit, an apsis tag and a
   * trail are a spacecraft's instruments, and from a star or another galaxy
   * the whole of the solar system is under a pixel — the chrome drawn there is
   * a stray dot on the Milky Way.
   */
  const deep = useUi((s) => COSMIC[s.focus] !== undefined)
  const bare = cinematic || ground || lunarChase || presenting || deep

  return (
    <>
      <Driver />
      {/* The Milky Way is a volume — the sky from inside it, a galaxy from
          outside — with its neighbours and the named stars in three
          dimensions. Every other star is Hipparcos, at infinity. */}
      <Cosmos />
      <Starfield />

      {/* Starlight fill only. Everything you can actually see is lit by the
          point light inside the Sun; without this the night sides clip to pure
          black and lose their silhouette against the Milky Way. */}
      <ambientLight intensity={0.015} />

      <Sun />
      {/* Takes the Sun's place near a pad, so the complex can cast a shadow. */}
      <GroundLight />
      <Earth textures={textures} />
      <Moon textures={textures} />
      <Craft id="ship" />
      <Craft id="iss" />
      <Craft id="hubble" />
      {/* The craft a lunar vessel flies to meet — Columbia, for Eagle. */}
      {CRAFT.target && <Craft id="target" />}
      <ShipControls />

      <Trail body="earth" reference="sun" period={YEAR} span={0.98} points={520} visible={trails && !ground && !lunarChase && !presenting && !deep} />
      {FLEET_TRAILS.map((t) => (
        <Trail
          key={t.body}
          body={t.body}
          reference="earth"
          period={t.period}
          span={0.98}
          points={280}
          head={t.head}
          tail={t.tail}
          inSky={t.inSky}
          width={1.1}
          visible={trails && !ground && !lunarChase && !presenting && !deep}
        />
      ))}
      <Trail
        body="moon"
        reference="earth"
        period={LUNAR_MONTH}
        span={0.95}
        points={360}
        head="#cfc8bd"
        tail="#33302b"
        width={1.4}
        visible={trails && !ground && !lunarChase && !presenting && !deep}
      />

      {!bare && <Trajectory />}
      {!bare && <Osculating />}
      {!cinematic && !presenting && !deep && <MapOverlay />}
      {!bare && <Markers />}
      {!cinematic && <Planets />}
      {!cinematic && <Terrain />}
      {!cinematic && <LunarSurface textures={textures} />}

      {/* Tuned for weight rather than responsiveness: a slower rotate against
          0.05 damping makes the camera feel like it carries momentum, which is
          what keeps free flight stable when there is no body to anchor to.
          Panning is enabled per-mode by the rig — in free flight it moves the
          orbit target, which the floating origin then follows. */}
      <OrbitControls
        makeDefault
        enableDamping
        dampingFactor={0.05}
        rotateSpeed={0.42}
        zoomSpeed={0.7}
        panSpeed={0.45}
      />
      <CameraRig />
      {!bare && <LagrangeProjector />}
      <Effects enabled={bloom} />
    </>
  )
}
