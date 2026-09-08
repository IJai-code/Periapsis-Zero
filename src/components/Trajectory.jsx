import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { Html } from '@react-three/drei'
import { Line2, LineGeometry, LineMaterial } from 'three-stdlib'
import { live } from '../sim/live.js'
import { BODIES } from '../sim/constants.js'
import {
  SAMPLES,
  clearProjection,
  dominantBody,
  packPolyline,
  plan,
  prediction,
  project,
} from '../sim/predict.js'
import { nodeRevision, nodes } from '../sim/nodes.js'
import { NodeEditor } from './NodeEditor.jsx'
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

/**
 * Two paths, two colours, and the distinction is the point: cyan is where the
 * craft goes if nothing is commanded, amber is where the planned burns would
 * take it. Both fade along their length so direction of travel reads without
 * an arrowhead.
 */
const BALLISTIC = { head: '#7df9ff', tail: '#1d4a7a' }
const PLANNED = { head: '#ffb35c', tail: '#6b3d0f' }

/** Build a fading polyline. Colours are fixed, so they are written once. */
function makeLine({ head, tail }) {
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

  const colors = geometry.attributes.instanceColorStart.data.array
  const a = new THREE.Color(head)
  const b = new THREE.Color(tail)
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
  return l
}

/**
 * Push new points into a line, and refresh what the line thinks it occupies.
 *
 * The bounds are the part that is easy to leave out. `setPositions` computes a
 * bounding box and sphere once, from the buffer it is handed — which here is a
 * zero-filled placeholder — and writing the real path in afterwards never
 * updates them. Drawing is unaffected, because these lines are marked
 * `frustumCulled = false`; *picking* is not, because `raycast` rejects against
 * the bounding sphere before it looks at a single segment. The trajectory was
 * therefore invisible to the pointer while looking perfectly correct, which is
 * the failure mode that survives longest.
 */
function pushPoints(line, points, count) {
  const attr = line.geometry.attributes.instanceStart.data
  packPolyline(attr.array, points, count, SAMPLES)
  attr.needsUpdate = true
  line.geometry.computeBoundingBox()
  line.geometry.computeBoundingSphere()
}

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
  const lastRev = useRef(-1)
  /** Held between ballistic refreshes so a node-driven replan can reuse them. */
  const reference = useRef('earth')
  const period = useRef(0)

  /**
   * One integrator, kept. `clone()` builds six state-sized buffers, which is
   * fine once and wrong five times a second — hence `resetFrom` on the class.
   */
  const scratch = useMemo(() => live.sim.clone(), [])

  const { line, planLine } = useMemo(
    () => ({ line: makeLine(BALLISTIC), planLine: makeLine(PLANNED) }),
    [],
  )

  useEffect(() => {
    line.material.resolution.set(size.width, size.height)
    planLine.material.resolution.set(size.width, size.height)
  }, [line, planLine, size])
  useEffect(
    () => () => {
      for (const l of [line, planLine]) {
        l.geometry.dispose()
        l.material.dispose()
      }
    },
    [line, planLine],
  )

  useFrame((_, delta) => {
    const g = group.current
    if (!g || !show || cinematic) return

    clock.current += delta
    const ballistic = clock.current >= REFRESH
    /**
     * The plan is redrawn when the plan changes; the ballistic path stays on
     * the clock.
     *
     * They are refreshed on different triggers because they answer different
     * questions. Where the craft is going if nothing is done changes slowly and
     * on its own, so five times a second is generous. Where a burn would take
     * it changes because the pilot is dragging a handle *right now*, and a
     * fifth of a second of lag between the pointer and the amber line is the
     * difference between an instrument and a form field. Nodes are also the
     * cheap half: the ballistic pass is what re-runs `dominantBody` and the
     * apsis scan.
     */
    const replan = ballistic || nodeRevision() !== lastRev.current

    if (ballistic) {
      clock.current = 0
      reference.current = dominantBody(live.sim, 'ship') ?? 'earth'
      /**
       * One revolution when the orbit closes, a fixed horizon when it does not.
       * `bound` is false on an escape, where `period` is Infinity and there is
       * no revolution to draw.
       */
      period.current = live.elements.bound ? live.elements.period : 0
      project(live.sim, scratch, 'ship', reference.current, period.current)
      pushPoints(line, prediction.points, prediction.count)

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

    if (replan) {
      lastRev.current = nodeRevision()
      /**
       * The planned path, when there is one. Projected over half again the
       * ballistic span, because the point of a burn is usually to change the
       * period — drawing the new orbit over the old one's span would cut it off
       * partway round.
       */
      const pending = nodes.some((nd) => !nd.executed && nd.t >= live.sim.t)
      planLine.visible = pending
      if (pending) {
        project(live.sim, scratch, 'ship', reference.current, period.current * 1.5, plan, nodes)
        pushPoints(planLine, plan.points, plan.count)
      } else {
        // Hiding the line is not enough: the editor picks and draws from
        // `plan.applied` and the frames beside it, so they have to stop naming
        // burns that are no longer planned.
        clearProjection(plan)
      }
    }

    g.position.copy(live.pos[prediction.reference])
  }, -2)

  if (!show || cinematic) return null

  return (
    <group ref={group}>
      <primitive object={line} />
      <primitive object={planLine} />
      <group ref={apo} visible={false}>
        <Apsis label="Ap" textRef={apoText} />
      </group>
      <group ref={peri} visible={false}>
        <Apsis label="Pe" textRef={periText} />
      </group>
      {/* Parented to the same body the path is drawn around, so the handles sit
          on the line rather than chasing it across the screen at 30 km/s. */}
      <NodeEditor line={line} host={group} />
    </group>
  )
}
