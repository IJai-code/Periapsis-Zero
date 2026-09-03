import { Suspense } from 'react'
import { Canvas } from '@react-three/fiber'
import { ACESFilmicToneMapping, PCFShadowMap } from 'three'
import { Scene } from './components/Scene.jsx'
import { Hud } from './ui/Hud.jsx'
import { Loading } from './ui/Loading.jsx'
import { useAssets } from './gfx/useAssets.js'

export default function App() {
  const assets = useAssets()

  return (
    <div className="fixed inset-0 bg-black">
      <Canvas
        // PCF rather than PCFSoft: three only implements soft filtering for 2D
        // shadow maps, so a point light under PCFSoft falls through to a single
        // hard sample and its shadows come out stair-stepped. PCF gives point
        // lights a 9-tap kernel scaled by shadow.radius — which is also the more
        // honest result, since the Sun is an extended source and real eclipses
        // have a penumbra many times wider than the umbra.
        shadows={{ type: PCFShadowMap }}
        dpr={[1, 2]}
        // The scene spans four orders of magnitude, from a 0.3-unit moon to a
        // 120-unit orbit viewed from 500 units out. A logarithmic depth buffer
        // is what keeps the near plane low enough to fly up to the Moon without
        // the far geometry falling apart.
        gl={{
          antialias: true,
          logarithmicDepthBuffer: true,
          toneMapping: ACESFilmicToneMapping,
          toneMappingExposure: 1.0,
          powerPreference: 'high-performance',
        }}
        camera={{ position: [138, 26, 34], fov: 45, near: 0.002, far: 4000 }}
      >
        <Suspense fallback={null}>{assets.ready && <Scene textures={assets.textures} />}</Suspense>
      </Canvas>

      {assets.ready ? <Hud /> : <Loading progress={assets.progress} label={assets.label} />}
    </div>
  )
}
