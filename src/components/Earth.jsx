import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { live } from '../sim/live.js'
import { BODIES } from '../sim/constants.js'
import { VISUAL_RADIUS } from '../sim/scale.js'
import { attachNightLights } from '../gfx/shaders.js'
import { ATMOSPHERE_RADIUS, makeVolumetricAtmosphere } from '../gfx/atmosphereShader.js'
import { useUi } from '../sim/store.js'
import { useActiveTextures } from '../gfx/hdTextures.js'

const R = VISUAL_RADIUS.earth

/**
 * Clouds drift eastward relative to the ground. The real effect is a fraction of
 * a percent; this is exaggerated to something you can actually see over a few
 * rotations without it looking like the sky is detached.
 */
const CLOUD_SUPERROTATION = 1.06

/**
 * Which texture slot feeds which material channel. Declared as a table so the
 * procedural and HD sets are bound through exactly the same path — the swap is
 * then a re-run of one loop, not a second code path that can drift.
 */
const SURFACE_SLOTS = {
  map: 'earth.day',
  normalMap: 'earth.normal',
  roughnessMap: 'earth.rough',
  emissiveMap: 'earth.night',
}

export function Earth({ textures }) {
  const group = useRef()

  // `textures` is the procedural baseline and never changes, so the materials
  // below are built once and kept — which is what preserves the onBeforeCompile
  // patches and their live uniform objects across an HD swap.
  const active = useActiveTextures(textures)
  const spin = useRef()
  const cloudSpin = useRef()

  // One shared uniform, written once per frame and read by the surface shader
  // patch and the scattering shell.
  const sunDir = useMemo(() => ({ value: new THREE.Vector3(1, 0, 0) }), [])

  const surface = useMemo(() => {
    const m = new THREE.MeshStandardMaterial({
      map: textures['earth.day'],
      normalMap: textures['earth.normal'],
      normalScale: new THREE.Vector2(1.1, 1.1),
      roughnessMap: textures['earth.rough'],
      roughness: 1, // the map supplies the actual value; this is its multiplier
      metalness: 0,
      emissiveMap: textures['earth.night'],
      emissive: new THREE.Color('#ffd9a0'),
      emissiveIntensity: 2.4,
    })
    attachNightLights(m, sunDir)
    return m
  }, [textures, sunDir])

  const cloudMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        map: textures['earth.clouds'],
        transparent: true,
        opacity: 0.92,
        roughness: 0.95,
        metalness: 0,
        depthWrite: false,
      }),
    [textures],
  )

  const atmosphere = useMemo(() => makeVolumetricAtmosphere(), [])

  // Dev-only handle, so scattering can be tuned live rather than by reload.
  // In an effect rather than the render body: writing to window during render
  // is a side effect, however harmless it looks.
  useEffect(() => {
    if (import.meta.env.DEV) window.__atmos = atmosphere
  }, [atmosphere])

  const showClouds = useUi((s) => s.clouds)
  const showAtmosphere = useUi((s) => s.atmosphere)

  // Rebind the maps whenever the active set changes. needsUpdate forces a
  // program rebuild, which re-runs onBeforeCompile — harmless here because the
  // uniform objects handed to it are the same instances every time.
  useEffect(() => {
    for (const [channel, slot] of Object.entries(SURFACE_SLOTS)) surface[channel] = active[slot]
    surface.needsUpdate = true
  }, [active, surface])

  useEffect(() => {
    cloudMat.map = active['earth.clouds']
    cloudMat.needsUpdate = true
  }, [active, cloudMat])

  useFrame((state) => {
    group.current.position.copy(live.pos.earth)


    sunDir.value.copy(live.sunDir)

    const u = atmosphere.uniforms
    u.uSunDir.value.copy(live.sunDir)
    u.uSceneRadius.value = R
    u.uPlanetCentre.value.copy(group.current.position)
    // Camera position relative to the planet, normalised to planet radii, and
    // differenced here in float64 rather than in the shader. This is the one
    // large-ish quantity the scattering march would otherwise have to handle,
    // and it arrives already small.
    u.uCamToPlanet.value.copy(state.camera.position).sub(group.current.position).divideScalar(R)

    const rotations = live.sim.t / BODIES.earth.spin
    spin.current.rotation.y = rotations * Math.PI * 2
    cloudSpin.current.rotation.y = rotations * CLOUD_SUPERROTATION * Math.PI * 2
  }, -2)

  return (
    <group ref={group}>
      {/* Obliquity is applied outside the spin, so the axis stays fixed in
          inertial space and the seasons come out right over a full orbit. */}
      <group rotation={[0, 0, BODIES.earth.tilt]}>
        <mesh ref={spin} material={surface} castShadow receiveShadow>
          <sphereGeometry args={[R, 160, 96]} />
        </mesh>

        <mesh
          ref={cloudSpin}
          material={cloudMat}
          scale={1.012}
          visible={showClouds}
          receiveShadow
        >
          <sphereGeometry args={[R, 96, 64]} />
        </mesh>
      </group>

      {/* Scattering shell. DoubleSide so it still renders once the camera
          descends inside it, and depth-tested so anything in front occludes
          it without the shader touching the depth buffer. */}
      {showAtmosphere && (
        <mesh material={atmosphere} scale={ATMOSPHERE_RADIUS} renderOrder={2}>
          <sphereGeometry args={[R, 96, 64]} />
        </mesh>
      )}
    </group>
  )
}
