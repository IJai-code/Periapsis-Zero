import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { BackSide } from 'three'

/**
 * The Milky Way, on a sphere pinned to the camera.
 *
 * Following the camera and drawing with depthTest off makes the radius
 * arbitrary — the backdrop can never clip through the far plane or z-fight with
 * anything, no matter how far out the user zooms.
 */
export function Skybox({ map }) {
  const ref = useRef()
  useFrame(({ camera }) => ref.current?.position.copy(camera.position), -2)

  return (
    <mesh ref={ref} renderOrder={-1000} frustumCulled={false}>
      <sphereGeometry args={[400, 64, 40]} />
      <meshBasicMaterial
        key={map.uuid}
        map={map}
        side={BackSide}
        depthWrite={false}
        depthTest={false}
        toneMapped={false}
      />
    </mesh>
  )
}
