import { OrbitControls } from '@react-three/drei'
import { Driver } from './Driver.jsx'
import { Skybox } from './Skybox.jsx'
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
import { Audio } from './Audio.jsx'
import { useUi } from '../sim/store.js'
import { useActiveTextures } from '../gfx/hdTextures.js'
import { CRAFT, DAY, SHIP, YEAR } from '../sim/constants.js'

const LUNAR_MONTH = 27.321661 * DAY

/**
 * Nominal orbital periods, fixing each trail's sample spacing. Held constant
 * rather than read live, so a burn does not re-seed the trail mid-flight.
 */
const FLEET_TRAILS = [
  { body: 'ship', period: 5545, head: '#e8823c', tail: '#4a2410' },
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
  const ground = useUi((s) => s.focus === 'ground')
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
  const bare = cinematic || ground || lunarChase || intro
  const active = useActiveTextures(textures)

  return (
    <>
      <Driver />
      <Audio />
      <Skybox map={active['sky.sky']} />
      {/* The Milky Way underneath is painted, because its band is unresolved
          starlight no catalogue lists. Every individual star is Hipparcos. */}
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

      <Trail body="earth" reference="sun" period={YEAR} span={0.98} points={520} visible={trails && !ground && !lunarChase && !intro} />
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
          width={1.1}
          visible={trails && !ground && !lunarChase && !intro}
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
        visible={trails && !ground && !lunarChase && !intro}
      />

      {!bare && <Trajectory />}
      {!bare && <Osculating />}
      {!cinematic && !intro && <MapOverlay />}
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
