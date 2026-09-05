import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import { live } from '../sim/live.js'
import { BODIES, CRAFT } from '../sim/constants.js'
import { setUi, useUi } from '../sim/store.js'

const IDS = ['sun', 'earth', 'moon', 'ship', 'iss', 'hubble']

/** Each target's own size, in metres — the floor for its hit sphere. */
const PICK_RADIUS = {
  ...Object.fromEntries(Object.entries(BODIES).map(([id, b]) => [id, b.radius])),
  ...Object.fromEntries(Object.entries(CRAFT).map(([id, c]) => [id, c.visual])),
}

/**
 * Angular radius the hit sphere holds once distance makes the target smaller
 * than this, in radians. About 1.1 degrees — a comfortable click target that
 * does not swallow its neighbours.
 *
 * Stated as an angle rather than as a multiple of distance because at true
 * scale the two are no longer interchangeable: a 98 m spacecraft and a 696,000
 * km star are eight orders of magnitude apart, and any rule written against
 * one of them is unusable for the other. An angle is the only thing they share
 * — it is what the user is actually aiming at.
 */
const PICK_ANGLE = 0.02

/**
 * Click targets and name tags.
 *
 * The pick spheres are invisible and grow with distance, because at true scale
 * a spacecraft is a sub-pixel speck from anywhere useful and the Moon is barely
 * better from Earth.
 */
export function Markers() {
  const labels = useUi((s) => s.labels)
  const focus = useUi((s) => s.focus)
  const refs = { sun: useRef(), earth: useRef(), moon: useRef(), ship: useRef(), iss: useRef(), hubble: useRef() }

  useFrame(({ camera }) => {
    for (const id of IDS) {
      const g = refs[id].current
      if (!g) continue
      g.position.copy(live.pos[id])
      // Hold a constant angular size once the target is smaller than that,
      // and never shrink below the object itself.
      const d = camera.position.distanceTo(g.position)
      g.scale.setScalar(Math.max(1, (d * PICK_ANGLE) / PICK_RADIUS[id]))
    }
  }, -2)

  return IDS.map((id) => (
    <group key={id} ref={refs[id]}>
      <mesh
        onClick={(e) => {
          e.stopPropagation()
          setUi({ focus: id })
        }}
        onPointerOver={() => (document.body.style.cursor = 'pointer')}
        onPointerOut={() => (document.body.style.cursor = 'auto')}
      >
        <sphereGeometry args={[PICK_RADIUS[id] * 1.6, 12, 8]} />
        <meshBasicMaterial visible={false} />
      </mesh>

      {labels && (
        <Html
          center
          zIndexRange={[20, 10]}
          style={{ pointerEvents: 'none', transform: 'translateY(-46px)' }}
        >
          <div
            className={`whitespace-nowrap font-mono text-[10px] tracking-[0.22em] uppercase transition-colors ${
              focus === id ? 'text-cyan-300' : 'text-white/45'
            }`}
          >
            <span className="mr-1.5 opacity-60">+</span>
            {(BODIES[id] ?? CRAFT[id]).name}
          </div>
        </Html>
      )}
    </group>
  ))
}
