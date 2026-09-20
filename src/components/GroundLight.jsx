import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { live } from '../sim/live.js'
import { mission } from '../sim/mission.js'
import { activeSite } from '../sim/launchsite.js'
import {
  GROUND_RANGE,
  SHADOW_DISTANCE,
  SHADOW_EXTENT,
  SHADOW_TEXELS,
  SHADOW_TEXEL_METRES,
  illuminanceAt,
  onTheGround,
  padScenePoint,
} from '../gfx/sunlight.js'

/**
 * The Sun as a parallel beam, near the ground, so the pad can cast a shadow.
 *
 * This does not *add* light. `Sun.jsx` drops its point light to zero over the
 * same range and by the same test, so the pad is lit once — by whichever of the
 * two is the useful description at that distance. The substitution is exact to a
 * part in three hundred thousand over the ground that is drawn, and `sunlight.js`
 * carries the arithmetic.
 *
 * The three things that make a directional light's shadow work, none of which
 * are its defaults:
 *
 * **The target has to be in the scene.** three takes the light's direction from
 * `light.matrixWorld` and `light.target.matrixWorld`, and an `Object3D` that is
 * not in the graph never has its world matrix updated — the light keeps pointing
 * wherever it pointed when it was created. It is rendered as a `primitive` below
 * for exactly that reason.
 *
 * **The shadow camera has to be sized.** Its default is an orthographic box
 * 10 units across. The vehicle alone is 110 m and its shadow at a low sun runs
 * further than that again, so the box is `SHADOW_EXTENT` — the radius Terrain
 * grades flat around the pad, which is the ground a shadow can land on.
 *
 * **The bias has to come from somewhere.** Shadow acne is the depth map's own
 * quantisation showing through, so the offset that hides it is the size of a
 * texel on the ground and not a number found by turning a knob:
 * `SHADOW_TEXEL_METRES`, which is 0.39 m here and is computed from the extent
 * and the map size rather than typed in beside them.
 */
export function GroundLight() {
  const light = useRef()
  const site = mission.site ?? activeSite()
  const target = useMemo(() => new THREE.Object3D(), [])
  const pad = useMemo(() => new THREE.Vector3(), [])

  useFrame(({ camera }) => {
    const l = light.current
    if (!l) return
    const on = onTheGround(camera, site)
    l.visible = on
    if (!on) return
    padScenePoint(pad, site)
    target.position.copy(pad)
    l.position.copy(pad).addScaledVector(live.sunDir, SHADOW_DISTANCE)
    // The same falloff the point light it replaces would have delivered here.
    l.intensity = illuminanceAt(pad.distanceTo(live.pos.sun))
  }, -2)

  return (
    <>
      <primitive object={target} />
      <directionalLight
        ref={light}
        visible={false}
        color="#fff4e0"
        target={target}
        castShadow
        shadow-mapSize={[SHADOW_TEXELS, SHADOW_TEXELS]}
        shadow-camera-left={-SHADOW_EXTENT}
        shadow-camera-right={SHADOW_EXTENT}
        shadow-camera-top={SHADOW_EXTENT}
        shadow-camera-bottom={-SHADOW_EXTENT}
        shadow-camera-near={1}
        shadow-camera-far={SHADOW_DISTANCE * 2}
        shadow-normalBias={SHADOW_TEXEL_METRES}
      />
    </>
  )
}

/** Re-exported so `Scene.jsx` reads one number rather than two files. */
export { GROUND_RANGE }
