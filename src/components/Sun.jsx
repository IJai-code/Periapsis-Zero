import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { live } from '../sim/live.js'
import { BODIES } from '../sim/constants.js'
import { VISUAL_RADIUS } from '../sim/scale.js'
import { makeSunMaterial, makeCoronaMaterial, CORONA_SHELL } from '../gfx/shaders.js'

const R = VISUAL_RADIUS.sun

/**
 * Luminous intensity of the point light, in candela.
 *
 * three uses physical falloff, so illuminance at the Earth is intensity / r^2.
 * At the scene's 120 units per AU that denominator is 14,400 — hence the very
 * large number. This is the scene's only light source.
 */
const SOLAR_INTENSITY = 42000

/**
 * three unwraps a point light's cube shadow into a single 4x2 atlas, so a
 * mapSize of 2048 already allocates an 8192x4096 depth texture — the practical
 * ceiling. At this distance a solar eclipse's umbra only spans a handful of
 * texels, which is why the PCF blur radius does the rest of the work.
 */
const SHADOW_MAP_SIZE = 2048

export function Sun() {
  const group = useRef()
  const spin = useRef()
  const surface = useMemo(makeSunMaterial, [])
  const corona = useMemo(makeCoronaMaterial, [])

  useFrame((state) => {
    group.current.position.copy(live.pos.sun)
    const t = state.clock.elapsedTime
    surface.uniforms.uTime.value = t
    corona.uniforms.uTime.value = t
    spin.current.rotation.y = (live.sim.t / BODIES.sun.spin) * Math.PI * 2
  }, -2)

  return (
    <group ref={group}>
      <pointLight
        intensity={SOLAR_INTENSITY}
        decay={2}
        distance={0}
        color="#fff4e0"
        castShadow
        shadow-mapSize-width={SHADOW_MAP_SIZE}
        shadow-mapSize-height={SHADOW_MAP_SIZE}
        shadow-camera-near={R * 0.9}
        shadow-camera-far={400}
        shadow-radius={2}
        shadow-bias={-0.0008}
        shadow-normalBias={0.015}
      />

      {/* Photosphere. Never a shadow caster — the light lives inside it. */}
      <mesh ref={spin} material={surface}>
        <sphereGeometry args={[R, 128, 64]} />
      </mesh>

      {/* Corona, and the seed for the bloom pass. */}
      <mesh material={corona} scale={CORONA_SHELL}>
        <sphereGeometry args={[R, 48, 32]} />
      </mesh>
    </group>
  )
}
