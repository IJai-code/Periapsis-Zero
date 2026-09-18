import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import { AdditiveBlending, DoubleSide } from 'three'
import { live } from '../sim/live.js'
import { RAILS } from '../sim/rails.js'
import { setUi, useUi } from '../sim/store.js'

/**
 * The seven planets the integrator does not carry.
 *
 * Drawn at their real size, which from anywhere useful is nothing at all:
 * Jupiter at five astronomical units subtends four hundredths of an arcsecond,
 * so its disc is a ten-thousandth of a pixel. Exaggerating it is not an option
 * in a simulator whose first claim is that nothing is exaggerated to fit.
 *
 * So each planet also carries a beacon — a small additive point held at a
 * constant angular size. That is not a cheat about how *large* a planet is, it
 * is a statement about how *bright* one is: Jupiter is plainly visible from
 * Earth to the naked eye, and it is visible as a point, for exactly this
 * reason. Fly close and the beacon is swallowed by the disc, which by then is
 * the real one.
 */

/** Angular radius the beacon holds, radians. About five arcminutes. */
const BEACON_ANGLE = 0.0015
/** And the click target, which has to be comfortable rather than truthful. */
const PICK_ANGLE = 0.02

export function Planets() {
  const labels = useUi((s) => s.labels)
  const focus = useUi((s) => s.focus)
  const groups = useRef({})

  useFrame(({ camera }) => {
    for (let k = 0; k < RAILS.length; k++) {
      const p = RAILS[k]
      const g = groups.current[p.id]
      if (!g) continue
      g.position.copy(live.railPos[p.id])
      const d = camera.position.distanceTo(g.position)
      // The disc stays true; only the beacon and the hit sphere scale, and each
      // is a child with its own scale so the two do not fight.
      const beacon = g.children[1]
      const pick = g.children[2]
      if (beacon) beacon.scale.setScalar(Math.max(1, (d * BEACON_ANGLE) / p.radius))
      if (pick) pick.scale.setScalar(Math.max(1, (d * PICK_ANGLE) / p.radius))
    }
  }, -2)

  return RAILS.map((p) => (
    <group key={p.id} ref={(el) => (groups.current[p.id] = el)}>
      {/* The planet itself, at its own radius, lit by the Sun like everything else. */}
      <mesh castShadow receiveShadow>
        <sphereGeometry args={[p.radius, 32, 16]} />
        <meshStandardMaterial color={p.colour} roughness={0.92} metalness={0.02} />
        {p.ring && (
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <ringGeometry args={[p.radius * p.ring[0], p.radius * p.ring[1], 64]} />
            <meshStandardMaterial
              color={p.colour}
              side={DoubleSide}
              transparent
              opacity={0.55}
              roughness={0.9}
            />
          </mesh>
        )}
      </mesh>

      <mesh>
        <sphereGeometry args={[p.radius, 8, 6]} />
        <meshBasicMaterial
          color={p.colour}
          transparent
          opacity={0.8}
          blending={AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>

      <mesh
        onClick={(e) => {
          e.stopPropagation()
          setUi({ focus: p.id })
        }}
        onPointerOver={() => (document.body.style.cursor = 'pointer')}
        onPointerOut={() => (document.body.style.cursor = 'auto')}
      >
        <sphereGeometry args={[p.radius, 12, 8]} />
        <meshBasicMaterial visible={false} />
      </mesh>

      {labels && (
        <Html center zIndexRange={[19, 9]} style={{ pointerEvents: 'none', transform: 'translateY(-34px)' }}>
          <div
            className={`whitespace-nowrap font-mono text-[9px] tracking-[0.22em] uppercase transition-colors ${
              focus === p.id ? 'text-cyan-300' : 'text-white/35'
            }`}
          >
            <span className="mr-1.5 opacity-50">+</span>
            {p.name}
          </div>
        </Html>
      )}
    </group>
  ))
}
