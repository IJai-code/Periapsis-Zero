import { useMemo, useRef } from 'react'
import { Canvas, useFrame, useLoader } from '@react-three/fiber'
import * as THREE from 'three'
import { atmosphereMaterial, cloudMaterial, earthMaterial } from './Sky.jsx'
import { nebulaMaterial } from './nebula.js'

/**
 * Behind Squadron's lobby: the Earth from the old flight game (its day and
 * night maps, cloud, air), turning slowly, lit from the side so the
 * terminator and the city lights both show, in front of the chosen
 * battlefield's nebula and a field of stars.
 */
const BASE = import.meta.env.BASE_URL
const SUN = new THREE.Vector3(-0.85, 0.25, 0.45).normalize()

function Earth() {
  const [day, night, spec, cloudTex] = useLoader(THREE.TextureLoader, [
    `${BASE}game/earth-day.webp`, `${BASE}game/earth-night.webp`, `${BASE}game/earth-spec.webp`, `${BASE}game/earth-clouds.webp`,
  ])
  useMemo(() => { for (const t of [day, night, cloudTex]) t.colorSpace = THREE.SRGBColorSpace }, [day, night, cloudTex])
  const mats = useMemo(() => {
    const e = earthMaterial(day, night, spec, 3)
    const c = cloudMaterial(cloudTex, 3)
    const a = atmosphereMaterial()
    for (const m of [e, c, a]) m.uniforms.uSun.value.copy(SUN)
    return { e, c, a }
  }, [day, night, spec, cloudTex])
  const earth = useRef(), clouds = useRef()
  useFrame((_, dt) => {
    earth.current.rotation.y += dt * 0.03
    clouds.current.rotation.y += dt * 0.034
  })
  return <group position={[4.6, -0.9, -1.2]} rotation={[0.35, 0, 0.12]}>
    <mesh ref={earth} material={mats.e}><sphereGeometry args={[2.6, 96, 64]} /></mesh>
    <mesh ref={clouds} material={mats.c} scale={1.008}><sphereGeometry args={[2.6, 96, 64]} /></mesh>
    <mesh material={mats.a} scale={1.03}><sphereGeometry args={[2.6, 96, 64]} /></mesh>
  </group>
}

function Stars() {
  const geo = useMemo(() => {
    const n = 2600, p = new Float32Array(n * 3), c = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) {
      const v = new THREE.Vector3().randomDirection().multiplyScalar(60)
      p.set([v.x, v.y, v.z], i * 3)
      const b = 0.4 + Math.random() ** 3 * 1.4
      c.set([b, b * (0.92 + Math.random() * 0.08), b * (0.9 + Math.random() * 0.15)], i * 3)
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(p, 3))
    g.setAttribute('color', new THREE.BufferAttribute(c, 3))
    return g
  }, [])
  return <points geometry={geo}><pointsMaterial size={1.6} sizeAttenuation={false} vertexColors transparent depthWrite={false} /></points>
}

function Sky({ kind }) {
  const mat = useMemo(() => nebulaMaterial(kind, 5), [kind])
  const g = useRef()
  useFrame((_, dt) => { g.current.rotation.y += dt * 0.004 })
  return <group ref={g}>
    <mesh material={mat} scale={70} renderOrder={-2}><sphereGeometry args={[1, 64, 32]} /></mesh>
    <Stars />
  </group>
}

export default function LobbyBackdrop({ arena = 'drift' }) {
  return <div className="sq-backdrop" aria-hidden>
    <Canvas camera={{ position: [0, 0, 6], fov: 45 }} dpr={[1, 1.5]} gl={{ antialias: true, powerPreference: 'low-power' }}>
      <Sky kind={arena} />
      <Earth />
    </Canvas>
  </div>
}
