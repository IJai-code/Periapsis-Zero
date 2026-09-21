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
  shadowExtentFor,
  shadowOffsetFor,
  shadowTexel,
} from '../gfx/sunlight.js'
import { padEnvelope } from '../gfx/padGeometry.js'

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
 * further than that again — so the box is sized every frame to the shadow that
 * is actually being cast, and slid down the sun azimuth to sit on it rather than
 * on the pad. `sunlight.js` carries why that is worth a factor of two and what
 * it measures out at; the numbers are `verify-shadows`'.
 *
 * **The bias has to come from somewhere.** Shadow acne is the depth map's own
 * quantisation showing through, so the offset that hides it is the size of a
 * texel on the ground and not a number found by turning a knob. Since the box
 * now breathes, so does the texel, and so does the bias — a bias fixed at the
 * cap's 0.586 m would be eight times too large at a high sun, which is how a
 * shadow detaches from the thing casting it.
 *
 * None of this allocates. The four scratch vectors are made once, the pad's
 * envelope is measured once per site, and the per-frame work is arithmetic and
 * writes into objects that already exist.
 */
export function GroundLight() {
  const light = useRef()
  const site = mission.site ?? activeSite()
  const target = useMemo(() => new THREE.Object3D(), [])
  const pad = useMemo(() => new THREE.Vector3(), [])
  const up = useMemo(() => new THREE.Vector3(), [])
  const azimuth = useMemo(() => new THREE.Vector3(), [])
  const centre = useMemo(() => new THREE.Vector3(), [])
  // Walking every vertex of a pad is a gate's job, not a frame's: once per site.
  const envelope = useMemo(() => padEnvelope(site.id), [site.id])

  useFrame(({ camera }) => {
    const l = light.current
    if (!l) return
    const on = onTheGround(camera, site)
    l.visible = on
    if (!on) return
    padScenePoint(pad, site)

    // Local vertical at the pad, and the Sun's height above the horizon on it.
    up.copy(pad).sub(live.pos.earth).normalize()
    const sinElevation = live.sunDir.dot(up)

    /*
     * The shadow runs along the ground away from the Sun, so the box slides
     * down the *horizontal* part of the sun direction, reversed. At a sun near
     * the zenith that part goes to zero — and so does the offset, because the
     * shadow it would be sliding onto has no length, so the degenerate
     * normalize is multiplied by nothing.
     */
    const extent = shadowExtentFor(envelope.reach, envelope.top, sinElevation)
    const offset = shadowOffsetFor(envelope.reach, extent)
    azimuth.copy(live.sunDir).addScaledVector(up, -sinElevation).normalize()
    centre.copy(pad).addScaledVector(azimuth, -offset)

    target.position.copy(centre)
    l.position.copy(centre).addScaledVector(live.sunDir, SHADOW_DISTANCE)

    const shadow = l.shadow
    const cam = shadow.camera
    cam.left = -extent
    cam.right = extent
    cam.top = extent
    cam.bottom = -extent
    cam.updateProjectionMatrix()
    shadow.normalBias = shadowTexel(extent)

    // The same falloff the point light it replaces would have delivered here.
    // Unchanged, and deliberately so: the box moved, the light did not.
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
