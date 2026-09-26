import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import { AdditiveBlending, DoubleSide, Vector3 } from 'three'
import { live } from '../sim/live.js'
import { RAILS } from '../sim/rails.js'
import { setUi, useUi } from '../sim/store.js'
import { daySky } from '../gfx/skyGlow.js'

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

/** The beacon's own opacity, before any sky has had its say. */
const BEACON_OPACITY = 0.8

/**
 * The brightest any planet gets from Earth: Venus near greatest brilliancy, a
 * little under magnitude −4.9. A beacon is a statement about brightness, so it
 * obeys the sky the stars do (`gfx/skyGlow.js`) — and with no photometry per
 * planet here, it obeys it conservatively: a sky that hides −4.9 hides all
 * seven, and the beacons come in across the magnitude below that as the sky
 * darkens. In twilight that can show a fainter planet a little early; in
 * daylight, which is what it is for, it is exact.
 */
const BRIGHTEST_PLANET = -4.9
/** And the click target, which has to be comfortable rather than truthful. */
const PICK_ANGLE = 0.02

/*
 * A comet's tail. Three nested additive cones, apex at the nucleus, opening
 * away from the Sun — which is the whole physics of a tail in one sentence:
 * the tail points anti-sunward whatever the comet's heading. The length
 * breathes with solar distance (a comet's tail grows near perihelion), and
 * all three cones sit under one group so the frame loop rotates one object.
 */
const TAIL_LAYERS = [
  { r: 8e9, h: 6e10, opacity: 0.14 },
  { r: 4.5e9, h: 3.2e10, opacity: 0.2 },
  { r: 2e9, h: 1.4e10, opacity: 0.3 },
]
const _dir = new Vector3()
const _up = new Vector3(0, 1, 0)

function CometTail({ onRef }) {
  return (
    <group ref={onRef}>
      {TAIL_LAYERS.map(({ r, h, opacity }, i) => (
        // translated so the apex sits at the nucleus and the cone opens out.
        <mesh key={i} position={[0, -h / 2, 0]} rotation={[Math.PI, 0, 0]}>
          <coneGeometry args={[r, h, 12, 1, true]} />
          <meshBasicMaterial
            color="#b9c6c9"
            transparent
            opacity={opacity}
            blending={AdditiveBlending}
            depthWrite={false}
            side={DoubleSide}
            toneMapped={false}
          />
        </mesh>
      ))}
    </group>
  )
}

export function Planets() {
  const labels = useUi((s) => s.labels)
  const focus = useUi((s) => s.focus)
  const groups = useRef({})
  /** Every body's parts register under their own names — nothing is indexed. */
  const reg = (id, key) => (el) => {
    const entry = (groups.current[id] ??= {})
    entry[key] = el
  }

  /*
   * The parts are named, not indexed. They used to be `g.children[1]` and
   * `g.children[2]`, which broke the day a ring or a tail changed the child
   * order — the beacon silently started scaling a planet's ring instead, which
   * is exactly the kind of fault that looks like the scene going strange
   * rather than like a bug. Each body's ref map names what it holds.
   */
  useFrame(({ camera }) => {
    let seen = daySky.limitMagnitude - BRIGHTEST_PLANET
    seen = seen > 0 ? (seen < 1 ? seen : 1) : 0
    for (let k = 0; k < RAILS.length; k++) {
      const p = RAILS[k]
      const entry = groups.current[p.id]
      if (!entry) continue
      const { g, beacon, pick, tail } = entry
      g.position.copy(live.railPos[p.id])
      const d = camera.position.distanceTo(g.position)
      // The disc stays true; only the beacon and the hit sphere scale, and each
      // is a child with its own scale so the two do not fight.
      if (beacon) {
        beacon.scale.setScalar(Math.max(1, (d * BEACON_ANGLE) / p.radius))
        beacon.material.opacity = BEACON_OPACITY * seen
        beacon.visible = seen > 0
      }
      if (pick) pick.scale.setScalar(Math.max(1, (d * PICK_ANGLE) / p.radius))
      // The tail points anti-sunward and breathes with solar distance.
      if (tail) {
        _dir.subVectors(g.position, live.pos.sun)
        const sunDist = _dir.length() || 1
        _dir.divideScalar(sunDist)
        tail.quaternion.setFromUnitVectors(_up, _dir)
        tail.scale.setScalar(Math.min(1.6, Math.max(0.35, 1.5e11 / sunDist)))
      }
    }
  }, -2)

  return RAILS.map((p) => (
    <group
      key={p.id}
      ref={reg(p.id, 'g')}
    >
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

      <mesh ref={reg(p.id, 'beacon')}>
        <sphereGeometry args={[p.radius, 8, 6]} />
        <meshBasicMaterial
          color={p.colour}
          transparent
          opacity={BEACON_OPACITY}
          blending={AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>

      <mesh
        ref={reg(p.id, 'pick')}
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

      {p.comet && <CometTail onRef={reg(p.id, 'tail')} />}

      {labels && focus !== 'ground' && (
        <Html center zIndexRange={[19, 9]} style={{ pointerEvents: 'none', transform: 'translateY(-34px)' }}>
          <div
            className={`whitespace-nowrap font-mono text-[9px] tracking-[0.22em] uppercase transition-colors ${
              focus === p.id ? 'text-ember' : 'text-white/35'
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
