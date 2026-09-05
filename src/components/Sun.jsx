import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { live } from '../sim/live.js'
import { AU, BODIES } from '../sim/constants.js'
import { makeSunMaterial, makeCoronaMaterial, CORONA_SHELL } from '../gfx/shaders.js'

const R = BODIES.sun.radius

/**
 * Luminous intensity of the point light, in candela.
 *
 * three uses physical falloff, so illuminance at a distance r is intensity/r^2.
 * Stated as the illuminance wanted at one AU and multiplied back out, because
 * the scene is in metres now and the bare candela figure — 6.5e22 — carries no
 * meaning anyone can check. The illuminance is the same value the exaggerated
 * scene was tuned to, so the exposure does not move.
 */
const SOLAR_ILLUMINANCE_AT_1AU = 42000 / 120 ** 2
const SOLAR_INTENSITY = SOLAR_ILLUMINANCE_AT_1AU * AU * AU

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
      {/**
        * No shadow map. Not a regression to fix later by tuning — at true scale
        * one cannot exist.
        *
        * three unwraps a point light's cube shadow into a 4x2 atlas, so 2048
        * per face is already an 8192x4096 depth texture and the practical
        * ceiling. A 90-degree cube face reaching Earth spans 2 x 1.5e11 x
        * tan(45) = 3e11 m across those 2048 texels: 146,000 km per texel,
        * against an Earth 12,742 km wide. The planet does not fill a tenth of
        * one texel, and no map size recovers a factor of ten thousand.
        *
        * Analytic ray-sphere shadowing is the replacement and is resolution
        * independent. `detectEclipse()` in sim/live.js already computes exactly
        * that umbra geometry for the HUD; promoting it to the shading path is
        * its own change. Until then the blood-moon term keeps lunar eclipses,
        * since it was always analytic.
        */}
      <pointLight intensity={SOLAR_INTENSITY} decay={2} distance={0} color="#fff4e0" />

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
