import { OrbitControls } from '@react-three/drei'
import { Driver } from './Driver.jsx'
import { Skybox } from './Skybox.jsx'
import { Sun } from './Sun.jsx'
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
import { CameraRig } from './CameraRig.jsx'
import { Effects } from './Effects.jsx'
import { useUi } from '../sim/store.js'
import { useActiveTextures } from '../gfx/hdTextures.js'
import { DAY, YEAR } from '../sim/constants.js'

const LUNAR_MONTH = 27.321661 * DAY

/**
 * Nominal orbital periods, fixing each trail's sample spacing. Held constant
 * rather than read live, so a burn does not re-seed the trail mid-flight.
 */
const FLEET_TRAILS = [
  { body: 'ship', period: 5545, head: '#b8ff9a', tail: '#0d5c2a' },
  { body: 'iss', period: 5545, head: '#ffd08a', tail: '#5c3a0d' },
  { body: 'hubble', period: 5716, head: '#d6a8ff', tail: '#3d1a5c' },
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
  const active = useActiveTextures(textures)

  return (
    <>
      <Driver />
      <Skybox map={active['sky.sky']} />

      {/* Starlight fill only. Everything you can actually see is lit by the
          point light inside the Sun; without this the night sides clip to pure
          black and lose their silhouette against the Milky Way. */}
      <ambientLight intensity={0.015} />

      <Sun />
      <Earth textures={textures} />
      <Moon textures={textures} />
      <Craft id="ship" />
      <Craft id="iss" />
      <Craft id="hubble" />
      <ShipControls />

      <Trail body="earth" reference="sun" period={YEAR} span={0.98} points={520} visible={trails} />
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
          visible={trails}
        />
      ))}
      <Trail
        body="moon"
        reference="earth"
        period={LUNAR_MONTH}
        span={0.95}
        points={360}
        head="#8ef0ff"
        tail="#0a3573"
        width={1.4}
        visible={trails}
      />

      {!cinematic && <Trajectory />}
      {!cinematic && <Osculating />}
      {!cinematic && <MapOverlay />}
      {!cinematic && <Markers />}
      {!cinematic && <Planets />}

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
      {!cinematic && <LagrangeProjector />}
      <Effects enabled={bloom} />
    </>
  )
}
