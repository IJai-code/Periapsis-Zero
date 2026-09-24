import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { live } from '../sim/live.js'
import { BODIES } from '../sim/constants.js'
import { attachBloodMoon } from '../gfx/shaders.js'
import { useActiveTextures } from '../gfx/hdTextures.js'
import { moonClock, moonTurn } from '../sim/moonFrame.js'
import { lunarPhotometry } from '../gfx/lunarPhotometry.js'
import { lunarGround } from '../gfx/moonTerrain.js'

/** The rotation the group is turned by, written in place every frame. */
const _turn = new THREE.Matrix4()

const R = BODIES.moon.radius

const SLOTS = { map: 'moon.color', normalMap: 'moon.normal' }

/**
 * Cut the globe away where real ground is drawn in its place.
 *
 * Near a lunar site the surface is the terrain in LunarSurface.jsx, and the
 * globe underneath it would fight it for depth — worse, bury every crater, since
 * the ground there is shifted to put the site on the sphere and a crater floor
 * is below it. So while the ground is drawn the globe discards every fragment
 * inside its bounds, read off the same map coordinates that place the imagery:
 * the terrain is built on those bounds exactly, and blends to the sphere's
 * height along them.
 */
function cutForGround(material) {
  const previous = material.onBeforeCompile
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer)
    shader.uniforms.uGroundHole = lunarGround.hole
    shader.uniforms.uGroundBounds = { value: lunarGround.bounds }
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uGroundHole;\nuniform vec4 uGroundBounds;')
      .replace(
        '#include <map_fragment>',
        `if ( uGroundHole > 0.5 && vMapUv.x > uGroundBounds.x && vMapUv.x < uGroundBounds.y &&
          vMapUv.y > uGroundBounds.z && vMapUv.y < uGroundBounds.w ) discard;
        #include <map_fragment>`,
      )
  }
  const key = material.customProgramCacheKey
  material.customProgramCacheKey = () => `${key.call(material)}|ground-cut`
  return material
}

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
    // Regolith, not paint — see gfx/lunarPhotometry.js — and cut for the ground.
    return lunarPhotometry(cutForGround(m))
  }, [textures, eclipse])

  // Swapping maps leaves the material — and therefore the blood-moon uniforms
  // wired into it by attachBloodMoon — completely intact.
  useEffect(() => {
    for (const [channel, slot] of Object.entries(SLOTS)) material[channel] = active[slot]
    material.needsUpdate = true
  }, [active, material])

  useFrame(() => {
    group.current.position.copy(live.pos.moon)
    /*
     * Turned by the Moon's own frame (sim/moonFrame.js): uniform rotation, once
     * per sidereal month, facing the *mean* Earth. It used to be pointed at
     * Earth every frame, which is not a rotation at all — nothing on the surface
     * had coordinates and the Earth never moved in the lunar sky — and it
     * pointed the wrong hemisphere: Earth saw longitude 90°E.
     */
    moonClock[0] = live.sim.t
    moonTurn(_turn.elements)
    group.current.quaternion.setFromRotationMatrix(_turn)

    eclipse.sunPosition.value.copy(live.pos.sun)
    eclipse.earthPosition.value.copy(live.pos.earth)
  }, -2)

  return (
    <group ref={group}>
      {/* three's sphere puts a map's centre column — 0° longitude, in both the
          NASA imagery and the generated maps — on its +x, and 90°E on its -z.
          A quarter-turn about the pole carries those onto the group's +z and
          +x, which are the prime meridian and 90°E. */}
      <mesh material={material} rotation={[0, -Math.PI / 2, 0]}>
        {/* 512 x 256: a facet's middle sits 32 m inside the true sphere, where
            128 x 80 left it 520 m in — the height the terrain's edge meets it at. */}
        <sphereGeometry args={[R, 512, 256]} />
      </mesh>
    </group>
  )
}
