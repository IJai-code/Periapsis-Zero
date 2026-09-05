import { Suspense } from 'react'
import { Canvas } from '@react-three/fiber'
import { ACESFilmicToneMapping } from 'three'
import { Scene } from './components/Scene.jsx'
import { Hud } from './ui/Hud.jsx'
import { Loading } from './ui/Loading.jsx'
import { useAssets } from './gfx/useAssets.js'

export default function App() {
  const assets = useAssets()

  return (
    <div className="fixed inset-0 bg-black">
      <Canvas
        dpr={[1, 2]}
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

      {assets.ready ? <Hud /> : <Loading progress={assets.progress} label={assets.label} />}
    </div>
  )
}
