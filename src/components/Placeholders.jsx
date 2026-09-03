import { AdditiveBlending } from 'three'
import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { ship } from '../sim/ship.js'
import { live } from '../sim/live.js'

/**
 * Procedural stand-in hulls, held until real `.glb` files are installed.
 *
 * Built from compound primitives rather than a single blob so each craft is
 * recognisable in silhouette — the feature that actually matters at these
 * distances. All are modelled nose-along +Z, matching the flight model's thrust
 * axis and the orientation convention documented for downloaded models.
 */

const HULL = { color: '#c8d2dc', metalness: 0.6, roughness: 0.35 }
const DARK = { color: '#3a4048', metalness: 0.7, roughness: 0.5 }
const PANEL = { color: '#16233f', metalness: 0.35, roughness: 0.28 }
const GOLD = { color: '#c9a227', metalness: 0.85, roughness: 0.3 }

/** Solar wing: a thin panel on a short boom, mirrored by the sign of `x`. */
function Wing({ x, size, span, chord }) {
  return (
    <group position={[x, 0, 0]}>
      <mesh castShadow>
        <boxGeometry args={[span, size * 0.012, chord]} />
        <meshStandardMaterial {...PANEL} />
      </mesh>
    </group>
  )
}

/** ISS: a long lateral truss, pressurised modules along the flight axis, four wings. */
function ISS({ size: L }) {
  return (
    <group>
      <mesh castShadow receiveShadow>
        <boxGeometry args={[L * 1.7, L * 0.055, L * 0.055]} />
        <meshStandardMaterial {...HULL} />
      </mesh>
      {[-0.34, 0, 0.34].map((z) => (
        <mesh key={z} position={[0, 0, z * L]} rotation={[Math.PI / 2, 0, 0]} castShadow receiveShadow>
          <cylinderGeometry args={[L * 0.1, L * 0.1, L * 0.28, 12]} />
          <meshStandardMaterial {...HULL} />
        </mesh>
      ))}
      {[-0.72, -0.46, 0.46, 0.72].map((x) => (
        <Wing key={x} x={x * L} size={L} span={L * 0.22} chord={L * 0.62} />
      ))}
      {[-0.2, 0.2].map((x) => (
        <mesh key={x} position={[x * L, L * 0.12, 0]} castShadow>
          <boxGeometry args={[L * 0.3, L * 0.01, L * 0.2]} />
          <meshStandardMaterial {...DARK} />
        </mesh>
      ))}
    </group>
  )
}

/** Hubble: a foil-wrapped tube with an open aperture and two wings. */
function Hubble({ size: L }) {
  return (
    <group>
      <mesh rotation={[Math.PI / 2, 0, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[L * 0.26, L * 0.26, L * 0.95, 16]} />
        <meshStandardMaterial {...GOLD} />
      </mesh>
      <mesh position={[0, 0, L * 0.52]} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <cylinderGeometry args={[L * 0.27, L * 0.27, L * 0.12, 16, 1, true]} />
        <meshStandardMaterial {...DARK} side={2} />
      </mesh>
      <mesh position={[0, 0, -L * 0.52]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[L * 0.24, L * 0.24, L * 0.04, 16]} />
        <meshStandardMaterial {...DARK} />
      </mesh>
      {[-0.52, 0.52].map((x) => (
        <Wing key={x} x={x * L} size={L} span={L * 0.5} chord={L * 0.55} />
      ))}
    </group>
  )
}

/** Apollo CSM: conical command module, service barrel, engine bell — plus the plume. */
function Apollo({ size: L }) {
  const flame = useRef()
  useFrame(() => {
    if (!flame.current) return
    const t = ship.thrust > 0 ? ship.throttle : 0
    flame.current.scale.set(1, t * (0.88 + 0.12 * Math.sin(live.sim.t * 47.3)), 1)
    flame.current.visible = t > 0.001
  }, -2)

  return (
    <group>
      <mesh position={[0, 0, L * 0.34]} rotation={[Math.PI / 2, 0, 0]} castShadow receiveShadow>
        <coneGeometry args={[L * 0.22, L * 0.34, 12]} />
        <meshStandardMaterial {...HULL} />
      </mesh>
      <mesh position={[0, 0, -L * 0.02]} rotation={[Math.PI / 2, 0, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[L * 0.22, L * 0.22, L * 0.42, 12]} />
        <meshStandardMaterial color="#8d949c" metalness={0.75} roughness={0.4} />
      </mesh>
      <mesh position={[0, 0, -L * 0.34]} rotation={[-Math.PI / 2, 0, 0]} castShadow>
        <coneGeometry args={[L * 0.19, L * 0.24, 12, 1, true]} />
        <meshStandardMaterial {...DARK} side={2} />
      </mesh>
      <group ref={flame} position={[0, 0, -L * 0.46]}>
        <mesh rotation={[-Math.PI / 2, 0, 0]}>
          <coneGeometry args={[L * 0.15, L * 1.4, 8, 1, true]} />
          <meshBasicMaterial
            color="#9ad8ff"
            transparent
            opacity={0.75}
            blending={AdditiveBlending}
            depthWrite={false}
            toneMapped={false}
          />
        </mesh>
      </group>
    </group>
  )
}

const SHAPES = { iss: ISS, hubble: Hubble, ship: Apollo }

export function Placeholder({ id, size }) {
  const Shape = SHAPES[id] ?? Apollo
  return <Shape size={size} />
}
