import { useCallback } from 'react'
import { BackSide } from 'three'
import { daySky } from '../gfx/skyGlow.js'

/**
 * The Milky Way, on a sphere pinned to the camera.
 *
 * Drawing with depthTest off makes the radius arbitrary — the backdrop can never
 * clip through the far plane or z-fight with anything, no matter how far out the
 * user zooms — but only while the camera is actually *inside* it.
 *
 * It was not. This followed the camera from a `useFrame`, and measured in the
 * running app the sphere sat 500 units from a camera that was not moving, every
 * frame, against a radius of 400: the camera was outside its own sky, seeing the
 * far wall of a ball rather than a backdrop. Whatever the frame ordering that
 * produces it, reading the camera from a callback that runs at some other point
 * in the frame is the part that can be wrong.
 *
 * `onBeforeRender` cannot be. three calls it with the camera that is about to
 * render, and calls it *before* it composes `modelViewMatrix` — so the position
 * set here is the one the draw uses, by construction rather than by timing.
 * `Starfield.jsx` solves the same problem the other way, in its own shader,
 * because it has one.
 *
 * The same hook dims it by the sky over the camera, for the reason
 * `gfx/skyGlow.js` gives: from the ground in daylight the band is not there,
 * and drawn anyway it put a night sky behind a blue one. Three components
 * written directly rather than `setScalar`, which would hand a double to a
 * call.
 */
export function Skybox({ map }) {
  const follow = useCallback(function (renderer, scene, camera) {
    this.position.copy(camera.position)
    this.updateMatrixWorld()
    const c = this.material.color
    const k = daySky.milkyWay
    c.r = k
    c.g = k
    c.b = k
  }, [])

  return (
    <mesh onBeforeRender={follow} renderOrder={-1000} frustumCulled={false}>
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
