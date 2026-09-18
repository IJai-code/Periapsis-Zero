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

/**
 * The ISS, from its own dimensions.
 *
 * The catalogue holds sixteen real modules, and they cannot be used: each is
 * modelled about its own origin — Zarya and the ATV are symmetric about theirs,
 * the ELCs anchored at one end — so there is no shared station frame to drop
 * them into, and assembling them would be placing sixteen meshes by eye.
 *
 * Built to scale instead. `size` is the truss, end to end, which is the figure
 * CRAFT.iss carries; everything else is in metres against the real station's
 * 108.5 m of it, so the proportions are the station's own rather than fractions
 * of a bounding box.
 */
const ISS_TRUSS = 108.5
/** Wing pairs, at their real stations outboard along the truss. */
const ISS_ARRAYS = [24.5, 45.0]
const ARRAY = { span: 34.2, chord: 11.6 }

function ISS({ size }) {
  const k = size / ISS_TRUSS
  const m = (v) => v * k

  return (
    <group>
      {/* The truss, in segments, running across the flight axis. */}
      {[-4, -3, -2, -1, 0, 1, 2, 3, 4].map((i) => (
        <mesh key={i} position={[m(i * 12), 0, 0]} castShadow receiveShadow>
          <boxGeometry args={[m(11.4), m(2.2), m(2.2)]} />
          <meshStandardMaterial {...HULL} />
        </mesh>
      ))}

      {/* Pressurised modules, 73 m along the flight axis. */}
      {[-30, -20, -10, 0, 10, 20, 30].map((z) => (
        <mesh key={z} position={[0, m(-3.4), m(z)]} rotation={[Math.PI / 2, 0, 0]} castShadow receiveShadow>
          <cylinderGeometry args={[m(2.1), m(2.1), m(9.6), 14]} />
          <meshStandardMaterial {...HULL} />
        </mesh>
      ))}
      {/* Columbus and Kibo, branching either side of the forward node. */}
      {[-1, 1].map((side) => (
        <mesh
          key={side}
          position={[m(side * 6.5), m(-3.4), m(18)]}
          rotation={[0, 0, Math.PI / 2]}
          castShadow
          receiveShadow
        >
          <cylinderGeometry args={[m(2.0), m(2.0), m(9.0), 14]} />
          <meshStandardMaterial {...HULL} />
        </mesh>
      ))}
      {/* Cupola, under the node it is actually mounted on. */}
      <mesh position={[0, m(-6.0), m(-10)]} rotation={[Math.PI, 0, 0]} castShadow>
        <cylinderGeometry args={[m(1.0), m(1.5), m(1.5), 8]} />
        <meshStandardMaterial {...DARK} />
      </mesh>

      {/* Eight wings in four pairs, each 34.2 m by 11.6. */}
      {ISS_ARRAYS.flatMap((x) =>
        [-1, 1].flatMap((side) =>
          [-1, 1].map((pair) => (
            <mesh
              key={`${x}-${side}-${pair}`}
              position={[m(side * x), 0, m(pair * (ARRAY.chord / 2 + 1.5))]}
              castShadow
            >
              <boxGeometry args={[m(ARRAY.span), m(0.4), m(ARRAY.chord)]} />
              <meshStandardMaterial {...PANEL} />
            </mesh>
          )),
        ),
      )}

      {/* Radiators, on the zenith face where they reject heat to space. */}
      {[-1, 0, 1].map((i) => (
        <mesh key={i} position={[m(i * 13), m(7.5), 0]} rotation={[0, 0, 0]} castShadow>
          <boxGeometry args={[m(11.0), m(0.3), m(23.0)]} />
          <meshStandardMaterial color="#c9ced6" metalness={0.75} roughness={0.2} />
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
