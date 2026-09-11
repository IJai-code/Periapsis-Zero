import { useEffect, useRef, useSyncExternalStore } from 'react'
import { live } from '../sim/live.js'
import { BODIES } from '../sim/constants.js'
import { plan } from '../sim/predict.js'
import {
  clearNodes,
  nodeMagnitude,
  nodeRevision,
  nodes,
  removeNode,
  selectNode,
  selectedNode,
  selectedNodeId,
  setNodeDv,
  watchNodes,
} from '../sim/nodes.js'
import { HANDLES } from '../gfx/gizmo.js'

/**
 * The numbers behind the gizmo.
 *
 * A pulled handle gets you an orbit that looks right; this is where you make it
 * be right. Every field is the same three components the node is stored in, so
 * there is no second representation to keep in step — typing 62.8 into prograde
 * and dragging the prograde handle to 62.8 are the same edit.
 *
 * Two different update rates, deliberately. Structure — which nodes exist,
 * which is selected, whether one has been flown — re-renders React, and the
 * subscription snapshot is a key built from exactly those facts, so dragging a
 * handle at sixty hertz does not re-render anything. The *values* are written
 * into the DOM on a timer, the same way the telemetry panels do it, and a field
 * the pilot is typing into is left alone.
 */

const AXES = [
  { key: 'prograde', label: 'Prograde', color: '#f5e663', hint: 'raises the far side' },
  { key: 'normal', label: 'Normal', color: '#c98bff', hint: 'turns the plane' },
  { key: 'radial', label: 'Radial', color: '#5ce1f2', hint: 'swings the apsides' },
]

/** Refresh rate for the live readouts. Fast enough to read as continuous. */
const TICK = 80

/**
 * What React is allowed to notice.
 *
 * Ids, selection and flown-ness, and nothing else. `useSyncExternalStore` bails
 * out when the snapshot compares equal, so a delta-v that changes sixty times a
 * second while a handle is being dragged produces no renders at all — which is
 * what keeps the input fields from being torn out from under the cursor.
 */
function structureKey() {
  let key = `${selectedNodeId()}`
  for (const n of nodes) key += `|${n.id}${n.executed ? 'x' : ''}`
  return key
}

function formatClock(seconds) {
  const s = Math.max(0, Math.round(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const r = s % 60
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`
    : `${m}:${String(r).padStart(2, '0')}`
}

function Axis({ node, axis, valueRef }) {
  const bump = (delta) => setNodeDv(node, axis.key, (node[axis.key] ?? 0) + delta)
  return (
    <div className="flex items-center gap-1.5">
      <span
        className="h-1.5 w-1.5 shrink-0 rounded-full"
        style={{ background: axis.color, boxShadow: `0 0 6px ${axis.color}` }}
      />
      <span className="w-16 shrink-0 text-[10px] text-white/45">{axis.label}</span>
      <button
        onClick={() => bump(-1)}
        className="h-5 w-5 rounded-[2px] text-[11px] text-white/40 transition-colors hover:bg-white/8 hover:text-white/80"
        title="−1 m/s"
      >
        −
      </button>
      <input
        ref={valueRef}
        type="number"
        step="0.1"
        defaultValue={(node[axis.key] ?? 0).toFixed(1)}
        onChange={(e) => setNodeDv(node, axis.key, parseFloat(e.target.value))}
        className="w-16 rounded-[2px] border border-white/10 bg-black/40 px-1 py-0.5 text-right font-mono text-[11px] text-white/85 outline-none focus:border-hud/50"
      />
      <button
        onClick={() => bump(1)}
        className="h-5 w-5 rounded-[2px] text-[11px] text-white/40 transition-colors hover:bg-white/8 hover:text-white/80"
        title="+1 m/s"
      >
        +
      </button>
    </div>
  )
}

export function NodePanel() {
  useSyncExternalStore(watchNodes, structureKey, structureKey)
  const node = selectedNode()

  const fields = useRef({})
  const clock = useRef()
  const frame = useRef()
  const total = useRef()
  const result = useRef()

  useEffect(() => {
    if (!node) return undefined
    const id = setInterval(() => {
      if (clock.current) {
        clock.current.textContent = node.executed
          ? 'flown'
          : `T−${formatClock(node.t - live.sim.t)}`
      }
      if (total.current) total.current.textContent = `${nodeMagnitude(node).toFixed(1)} m/s`

      for (const axis of AXES) {
        const el = fields.current[axis.key]
        // Never while it is being typed in: the pilot's half-finished "-1" is
        // more current than the model's 0.
        if (el && document.activeElement !== el) {
          el.value = (node[axis.key] ?? 0).toFixed(1)
        }
      }

      const slot = plan.applied.indexOf(node.id)
      if (frame.current) {
        /**
         * Which body "prograde" means here. It changes as the node is dragged
         * across a sphere of influence, and the axes change with it — this is
         * what says so, rather than the gizmo quietly swinging round.
         */
        const body = slot >= 0 ? BODIES[plan.nodeBodies[slot]] : null
        frame.current.textContent = body ? `about ${body.name}` : ''
      }
      if (result.current) {
        if (slot < 0) {
          result.current.textContent = '—'
        } else {
          // About the body the last burn left the craft orbiting, not the one
          // the line is drawn around: after a capture burn, distances from
          // Earth describe no orbit at all.
          const about = BODIES[plan.apsisBody]
          const surface = about?.radius ?? 0
          const km = (r) => ((r - surface) / 1e3).toLocaleString('en-US', {
            maximumFractionDigits: 0,
          })
          result.current.textContent =
            plan.apoapsis.index < 0 || plan.periapsis.index < 0
              ? `escape · ${about?.name ?? ''}`
              : `${km(plan.periapsis.radius)} × ${km(plan.apoapsis.radius)} km · ${about?.name ?? ''}`
        }
      }
    }, TICK)
    return () => clearInterval(id)
  }, [node])

  const pending = nodes.filter((n) => !n.executed)

  return (
    <div className="panel w-64 rounded-sm p-3.5">
      <div className="rule mb-2.5 flex items-center justify-between border-b border-white/10 pb-2">
        <span>Manoeuvre</span>
        {pending.length > 1 && (
          <button
            onClick={clearNodes}
            className="text-[9px] tracking-[0.14em] text-white/25 uppercase transition-colors hover:text-white/60"
          >
            clear all
          </button>
        )}
      </div>

      {!node ? (
        <div className="space-y-1.5 text-[10px] leading-relaxed text-white/35">
          <p>
            Click the <span className="text-hud/70">cyan</span> trajectory to plan a burn there.
          </p>
          <p>
            Pull a handle to add delta-v. <kbd className="text-white/55">Shift</kbd> for fine,{' '}
            <kbd className="text-white/55">Ctrl</kbd> for coarse. Drag the centre to slide the
            burn along the orbit.
          </p>
          {pending.length > 0 && (
            <div className="mt-2 space-y-0.5 border-t border-white/8 pt-2">
              {pending.map((n) => (
                <button
                  key={n.id}
                  onClick={() => selectNode(n.id)}
                  className="flex w-full items-center justify-between rounded-[2px] px-1 py-0.5 text-left transition-colors hover:bg-white/6"
                >
                  <span className="text-white/55">Node {n.id}</span>
                  <span className="font-mono text-amber-200/70">
                    {nodeMagnitude(n).toFixed(1)} m/s
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-2.5">
          <div className="flex items-baseline justify-between font-mono text-[11px]">
            <span className="text-white/40">
              Node {node.id}
              <span ref={frame} className="ml-1.5 text-[9px] tracking-[0.12em] text-white/30 uppercase" />
            </span>
            <span ref={clock} className="text-hud/80">
              —
            </span>
          </div>

          <div className="space-y-1">
            {AXES.map((axis) => (
              <Axis
                key={axis.key}
                node={node}
                axis={axis}
                valueRef={(el) => (fields.current[axis.key] = el)}
              />
            ))}
          </div>

          <div className="space-y-1 border-t border-white/8 pt-2 text-[10px]">
            <div className="flex justify-between">
              <span className="text-white/35">Total</span>
              <span ref={total} className="font-mono text-white/85">
                —
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-white/35">Resulting orbit</span>
              <span ref={result} className="font-mono text-amber-200/80">
                —
              </span>
            </div>
          </div>

          <div className="flex items-center justify-between border-t border-white/8 pt-2">
            <span className="text-[9px] text-white/25">
              {node.executed ? 'flown' : 'the flight computer flies it'}
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => selectNode(null)}
                className="text-[9px] tracking-[0.14em] text-white/30 uppercase transition-colors hover:text-white/70"
              >
                close
              </button>
              <button
                onClick={() => removeNode(node.id)}
                className="text-[9px] tracking-[0.14em] text-rose-300/50 uppercase transition-colors hover:text-rose-300/90"
              >
                delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
