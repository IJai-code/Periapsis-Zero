import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { Html } from '@react-three/drei'
import { Line2, LineGeometry, LineMaterial } from 'three-stdlib'
import { live } from '../sim/live.js'
import { BODIES } from '../sim/constants.js'
import { SAMPLES, dominantBody, packPolyline, prediction, project } from '../sim/predict.js'
import { useUi } from '../sim/store.js'

/**
 * Where the craft is going, drawn from the forward projection.
 *
 * The line is the integrated path, not a conic — see sim/predict.js for why
 * that distinction is load-bearing rather than pedantic. Points are stored
 * relative to whichever body dominates, and the whole line is parented to that
 * body, so a low orbit reads as a closed ellipse instead of smearing across the
 * screen as Earth moves 30 km/s underneath it.
 *
 * Refreshed on a wall-clock interval rather than every frame. The projection is
 * 512 RK4 steps of the whole system — about a millisecond — which is cheap
 * enough to run continuously and wasteful enough not to run sixty times a
 * second when the answer changes slowly.
 */

/** Seconds between projections. Fast enough to feel live during a burn. */
const REFRESH = 0.2

/** Trailing fraction of the path drawn dimmer, so direction of travel reads. */
const HEAD = '#7df9ff'
const TAIL = '#1d4a7a'

/**
 * An apsis marker. The number is written imperatively rather than through
 * props: it changes with every projection, five times a second, and re-rendering
 * a React subtree to print two altitudes would cost more than the projection
 * that produced them — the same reason the telemetry panel writes into the DOM
 * on a timer. Props here would also be *stale*, since `prediction` is a mutable
 * singleton and nothing tells React when it changes.
 */
function Apsis({ label, textRef }) {
  return (
    <Html center zIndexRange={[18, 8]} style={{ pointerEvents: 'none' }}>
      <div className="-translate-y-4 whitespace-nowrap font-mono text-[9px] tracking-[0.18em] text-hud/80 uppercase">
        <span className="mr-1 opacity-50">{label}</span>
        <span ref={textRef}>—</span>
      </div>
    </Html>
  )
}

export function Trajectory() {
  const show = useUi((s) => s.trajectory)
  const cinematic = useUi((s) => s.focus === 'cinematic')
  const size = useThree((s) => s.size)
  const group = useRef()
  const apo = useRef()
  const peri = useRef()
  const apoText = useRef()
  const periText = useRef()
  const clock = useRef(0)

  /**
   * One integrator, kept. `clone()` builds six state-sized buffers, which is
   * fine once and wrong five times a second — hence `resetFrom` on the class.
   */
  const scratch = useMemo(() => live.sim.clone(), [])

  const { line } = useMemo(() => {
    const geometry = new LineGeometry()
    geometry.setPositions(new Float32Array(SAMPLES * 3))
    geometry.setColors(new Float32Array(SAMPLES * 4), 4)

    const material = new LineMaterial({
      vertexColors: true,
      transparent: true,
      linewidth: 1.4,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    })

    // The fade is a fixed function of position along the path, so the colours
    // are written once and only the geometry moves.
    const colors = geometry.attributes.instanceColorStart.data.array
    const a = new THREE.Color(HEAD)
    const b = new THREE.Color(TAIL)
    const c = new THREE.Color()
    const rgba = new Float32Array(SAMPLES * 4)
    for (let i = 0; i < SAMPLES; i++) {
      const t = i / (SAMPLES - 1)
      c.copy(a).lerp(b, t)
      rgba[i * 4] = c.r
      rgba[i * 4 + 1] = c.g
      rgba[i * 4 + 2] = c.b
      rgba[i * 4 + 3] = 0.95 - 0.75 * t
    }
    for (let s = 0; s < SAMPLES - 1; s++) {
      colors.set(rgba.subarray(s * 4, s * 4 + 4), s * 8)
      colors.set(rgba.subarray((s + 1) * 4, (s + 1) * 4 + 4), s * 8 + 4)
    }
    geometry.attributes.instanceColorStart.data.needsUpdate = true

    const l = new Line2(geometry, material)
    l.frustumCulled = false // the bounding volume changes every projection
    return { line: l }
  }, [])

  useEffect(() => {
    line.material.resolution.set(size.width, size.height)
  }, [line, size])
  useEffect(
    () => () => {
      line.geometry.dispose()
      line.material.dispose()
    },
    [line],
  )

  useFrame((_, delta) => {
    const g = group.current
    if (!g || !show || cinematic) return

    clock.current += delta
    if (clock.current >= REFRESH) {
      clock.current = 0
      const reference = dominantBody(live.sim, 'ship') ?? 'earth'
      /**
       * One revolution when the orbit closes, a fixed horizon when it does not.
       * `bound` is false on an escape, where `period` is Infinity and there is
       * no revolution to draw.
       */
      const period = live.elements.bound ? live.elements.period : 0
      project(live.sim, scratch, 'ship', reference, period)

      const positions = line.geometry.attributes.instanceStart.data
      packPolyline(positions.array, prediction.points, prediction.count, SAMPLES)
      positions.needsUpdate = true

      const surface = BODIES[prediction.reference].radius
      for (const [ref, text, apsis] of [
        [apo, apoText, prediction.apoapsis],
        [peri, periText, prediction.periapsis],
      ]) {
        const el = ref.current
        if (!el) continue
        el.visible = apsis.index >= 0
        if (apsis.index < 0) continue
        el.position.set(
          prediction.points[apsis.index * 3],
          prediction.points[apsis.index * 3 + 1],
          prediction.points[apsis.index * 3 + 2],
        )
        if (text.current) {
          const alt = (apsis.radius - surface) / 1e3
          text.current.textContent = `${alt.toLocaleString('en-US', {
            maximumFractionDigits: alt < 1000 ? 1 : 0,
          })} km`
        }
      }
    }

    g.position.copy(live.pos[prediction.reference])
  }, -2)

  if (!show || cinematic) return null

  return (
    <group ref={group}>
      <primitive object={line} />
      <group ref={apo} visible={false}>
        <Apsis label="Ap" textRef={apoText} />
      </group>
      <group ref={peri} visible={false}>
        <Apsis label="Pe" textRef={periText} />
      </group>
    </group>
  )
}
