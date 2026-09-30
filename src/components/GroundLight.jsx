import { useMemo, useRef, useSyncExternalStore } from 'react'
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
import { shadowRelief, subscribeShadowRelief } from '../gfx/groundBudget.js'
import { GROUND_AIR } from '../gfx/groundLook.js'

/*
 * The sky's share of the light on the ground, as a fraction of the direct beam
 * on a horizontal surface, and how it fades through twilight. A clear sky puts
 * roughly a tenth to a seventh of the Sun's illuminance back onto the ground
 * from every direction; the fraction climbs as the Sun sinks, because the
 * direct beam falls faster than the scattered light does.
 */
const SKY_SHARE = 0.13
/** Meteorological visibility at a coastal pad, m — Koschmieder's extinction is 3.912 / V. */
const VISIBILITY = { ksc: 28e3, kourou: 22e3, baikonur: 60e3, vandenberg: 35e3 }
const _skyV = new THREE.Vector3()
const _sky = new THREE.Color()
const _warm = new THREE.Color(0.95, 0.66, 0.46)
const _blue = new THREE.Color(0.46, 0.64, 1.0)

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
  const sunward = useMemo(() => new THREE.Vector3(), [])
  // Walking every vertex of a pad is a gate's job, not a frame's: once per site.
  const envelope = useMemo(() => padEnvelope(site.id), [site.id])

  /*
   * The shadow map's size is the distress ladder's last rung (`gfx/groundBudget.js`),
   * spent only by the resolution governor, after pixels and tessellation are
   * both spent. The key remounts the light on a change — three fixes a light's
   * shadow map when it is created, so an in-place write would be read by
   * nothing — and relief is a quarter of the depth pass's fill, for a doubling
   * of the ground texel that keeps a pad shadow hard-edged rather than a smear.
   * A change is governor-paced, a few per minute at most.
   */
  const shadowKey = useSyncExternalStore(
    subscribeShadowRelief,
    () => (shadowRelief() ? 'relief' : 'full'),
    () => 'full',
  )

  useFrame(({ camera }) => {
    const l = light.current
    if (!l) return
    const on = onTheGround(camera, site)
    l.visible = on
    if (!on) {
      GROUND_AIR.uSkyIrradiance.value = 0
      GROUND_AIR.uHazeDensity.value = 0
      return
    }
    padScenePoint(pad, site)

    // Local vertical at the pad, and the Sun's height above the horizon on it.
    up.copy(pad).sub(live.pos[site.body ?? 'earth']).normalize()
    /*
     * On the Moon, the Sun's direction from the site itself: `sunDir` is
     * Earth's, and from 384,400 km away the Sun sits up to 0.15° elsewhere in
     * the sky — a shadow's angle, at a low sun, visibly.
     */
    const sun = site.body === 'moon' ? sunward.copy(live.pos.sun).sub(pad).normalize() : live.sunDir
    const sinElevation = sun.dot(up)

    /*
     * The shadow runs along the ground away from the Sun, so the box slides
     * down the *horizontal* part of the sun direction, reversed. At a sun near
     * the zenith that part goes to zero — and so does the offset, because the
     * shadow it would be sliding onto has no length, so the degenerate
     * normalize is multiplied by nothing.
     */
    const extent = shadowExtentFor(envelope.reach, envelope.top, sinElevation)
    const offset = shadowOffsetFor(envelope.reach, extent)
    azimuth.copy(sun).addScaledVector(up, -sinElevation).normalize()
    centre.copy(pad).addScaledVector(azimuth, -offset)

    target.position.copy(centre)
    l.position.copy(centre).addScaledVector(sun, SHADOW_DISTANCE)

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
    const E = illuminanceAt(pad.distanceTo(live.pos.sun))
    l.intensity = E

    /*
     * The sky and the air (see gfx/groundLook.js). Blue overhead with a high
     * Sun, warming as it sinks; the ground's bounce is its albedo times all
     * the light falling on it. On the Moon there is no sky and no air — only
     * the regolith's bounce, which is what lights a shadowed LM leg.
     */
    const s = Math.max(sinElevation, 0)
    const twilight = THREE.MathUtils.smoothstep(sinElevation, -0.1, 0.02)
    _skyV.copy(up).transformDirection(camera.matrixWorldInverse)
    GROUND_AIR.uSkyUpV.value.copy(_skyV)
    if (site.body === 'moon') {
      GROUND_AIR.uSkyColor.value.setRGB(0, 0, 0)
      GROUND_AIR.uBounceColor.value.setRGB(1, 1, 1)
      GROUND_AIR.uSkyIrradiance.value = 0.12 * E * s
      GROUND_AIR.uHazeDensity.value = 0
    } else {
      const skyE = E * (0.02 * twilight + SKY_SHARE * Math.sqrt(s))
      _sky.copy(_blue).lerp(_warm, 1 - THREE.MathUtils.smoothstep(s, 0.0, 0.35))
      GROUND_AIR.uSkyColor.value.copy(_sky)
      const bounce = skyE > 0 ? (0.22 * (E * s + skyE)) / skyE : 0
      GROUND_AIR.uBounceColor.value.setRGB(0.36 * bounce, 0.34 * bounce, 0.24 * bounce)
      GROUND_AIR.uSkyIrradiance.value = skyE
      GROUND_AIR.uHazeColor.value.copy(_sky).multiplyScalar(skyE * 0.9 / Math.PI + 0.004)
      GROUND_AIR.uHazeDensity.value = 3.912 / (VISIBILITY[site.id] ?? 30e3)
    }
  }, -2)

  return (
    <>
      <primitive object={target} />
      <directionalLight
        key={shadowKey}
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
