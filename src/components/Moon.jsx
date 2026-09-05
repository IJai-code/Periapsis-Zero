import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { live } from '../sim/live.js'
import { BODIES } from '../sim/constants.js'
import { attachBloodMoon } from '../gfx/shaders.js'
import { useActiveTextures } from '../gfx/hdTextures.js'

const R = BODIES.moon.radius

const SLOTS = { map: 'moon.color', normalMap: 'moon.normal' }

export function Moon({ textures }) {
  const group = useRef()
  const active = useActiveTextures(textures)

  /**
   * Uniforms for the blood-moon term, created here so the same objects can be
   * handed to the compiled program and then mutated in place each frame —
   * assigning into `shader.uniforms` only shares the reference, so writing
   * `.value` is what actually reaches the GPU.
   *
   * The two radii are the real ones. They used to be display constants,
   * because the shadow the shader reasoned about had to match the exaggerated
   * geometry the renderer drew rather than the true-scale one the integrator
   * worked in; with the exaggeration gone there is only one set of radii left.
   */
  const eclipse = useMemo(
    () => ({
      sunPosition: { value: new THREE.Vector3() },
      earthPosition: { value: new THREE.Vector3() },
      earthRadius: { value: BODIES.earth.radius },
      sunRadius: { value: BODIES.sun.radius },
      coreColor: { value: new THREE.Color('#8c1c05') },
      edgeColor: { value: new THREE.Color('#e0632a') },
      intensity: { value: 0.85 },
    }),
    [],
  )

  const material = useMemo(() => {
    const m = new THREE.MeshStandardMaterial({
      map: textures['moon.color'],
      normalMap: textures['moon.normal'],
      normalScale: new THREE.Vector2(1.35, 1.35),
      roughness: 0.96,
      metalness: 0,
    })
    attachBloodMoon(m, eclipse)
    return m
  }, [textures, eclipse])

  // Swapping maps leaves the material — and therefore the blood-moon uniforms
  // wired into it by attachBloodMoon — completely intact.
  useEffect(() => {
    for (const [channel, slot] of Object.entries(SLOTS)) material[channel] = active[slot]
    material.needsUpdate = true
  }, [active, material])

  useFrame(() => {
    group.current.position.copy(live.pos.moon)
    // Tidal lock, stated directly: the same hemisphere always faces Earth. That
    // is also a real rotation — once per orbit relative to the stars.
    group.current.lookAt(live.pos.earth)

    eclipse.sunPosition.value.copy(live.pos.sun)
    eclipse.earthPosition.value.copy(live.pos.earth)
  }, -2)

  return (
    <group ref={group}>
      {/* lookAt aims +Z at Earth; the generated maria sit on the mesh's -Z
          hemisphere, so the mesh is turned to present that face. */}
      <mesh material={material} rotation={[0, Math.PI, 0]}>
        <sphereGeometry args={[R, 128, 80]} />
      </mesh>
    </group>
  )
}
