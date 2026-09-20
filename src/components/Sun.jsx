import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { live } from '../sim/live.js'
import { BODIES } from '../sim/constants.js'
import { mission } from '../sim/mission.js'
import { activeSite } from '../sim/launchsite.js'
import { SOLAR_INTENSITY, onTheGround } from '../gfx/sunlight.js'
import { makeSunMaterial, makeCoronaMaterial, CORONA_SHELL } from '../gfx/shaders.js'

const R = BODIES.sun.radius

export function Sun() {
  const group = useRef()
  const spin = useRef()
  const lamp = useRef()
  const site = mission.site ?? activeSite()
  const surface = useMemo(makeSunMaterial, [])
  const corona = useMemo(makeCoronaMaterial, [])

  useFrame((state) => {
    group.current.position.copy(live.pos.sun)
    /*
     * Handing over to the ground beam. `GroundLight.jsx` lights the pad with a
     * parallel beam of the same illuminance so that it can cast a shadow, and
     * two lights delivering the same illuminance to the same ground would light
     * it twice — so this one stops. Both ask `onTheGround` rather than one
     * telling the other; see `gfx/sunlight.js`.
     */
    if (lamp.current) lamp.current.intensity = onTheGround(state.camera, site) ? 0 : SOLAR_INTENSITY
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
        * Analytic ray-sphere shadowing is the replacement at planetary scale
        * and is resolution independent. `detectEclipse()` in sim/live.js already
        * computes exactly that umbra geometry for the HUD; promoting it to the
        * shading path is its own change. Until then the blood-moon term keeps
        * lunar eclipses, since it was always analytic.
        *
        * On the ground there is a shadow map, and it belongs to a different
        * light: near a pad this one goes dark and `GroundLight.jsx` lights the
        * site with a parallel beam of the same illuminance, which is a
        * substitution rather than an addition and is exact to a part in three
        * hundred thousand over the ground that is drawn.
        */}
      <pointLight ref={lamp} intensity={SOLAR_INTENSITY} decay={2} distance={0} color="#fff4e0" />

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
