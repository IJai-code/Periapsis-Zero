import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import { live } from '../sim/live.js'
import { VISUAL_RADIUS } from '../sim/scale.js'
import { BODIES } from '../sim/constants.js'
import { setUi, useUi } from '../sim/store.js'

import { SHIP_VISUAL_LENGTH } from '../sim/scale.js'
import { CRAFT } from '../sim/constants.js'

const IDS = ['sun', 'earth', 'moon', 'ship', 'iss', 'hubble']

const PICK_RADIUS = {
  ...VISUAL_RADIUS,
  ...Object.fromEntries(Object.entries(CRAFT).map(([id, c]) => [id, c.visual ?? SHIP_VISUAL_LENGTH])),
}

/**
 * Click targets and name tags.
 *
 * The pick spheres are invisible and generously oversized — the Moon is a third
 * of a scene unit across and would be almost impossible to hit at system scale
 * otherwise.
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
      // Grow the hit sphere with distance so it stays clickable when zoomed out.
      const d = camera.position.distanceTo(g.position)
      g.scale.setScalar(Math.max(1, d * 0.022))
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
