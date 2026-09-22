import { useEffect, useRef, useSyncExternalStore } from 'react'
import { live } from '../sim/live.js'
import { BODIES } from '../sim/constants.js'
import { MAX_NODE_FRAMES, plan } from '../sim/predict.js'
import {
  clearNodes,
  nodeMagnitude,
  nodes,
  removeNode,
  selectNode,
  selectedNodeId,
  setNodeDv,
  watchNodes,
} from '../sim/nodes.js'
import { setUi } from '../sim/store.js'

/**
 * The flight plan, as a list.
 *
 * A plan is a *sequence* — burn, coast, burn — and the gizmo can only ever show
 * one of them. This is where the sequence lives: every planned burn in the order
 * it fires, what body it is measured against, when it comes, how big it is, and
 * what orbit it leaves behind. The selected one opens in place rather than
 * replacing the list, so editing a burn never costs sight of the rest.
 *
 * Two update rates, deliberately. Structure — which burns exist, which is
 * selected, whether one has been flown — re-renders React, and the subscription
 * snapshot is built from exactly those facts, so dragging a handle at sixty
 * hertz renders nothing. The *values* are written into the DOM on a timer, the
 * way the telemetry panels do it, and a field the pilot is typing into is left
 * alone.
 */

const AXES = [
  { key: 'prograde', label: 'Prograde', color: '#f5e663' },
  { key: 'normal', label: 'Normal', color: '#c98bff' },
  { key: 'radial', label: 'Radial', color: '#5ce1f2' },
]

/** Refresh rate for the live readouts. Fast enough to read as continuous. */
const TICK = 80

/**
 * What React is allowed to notice: ids, order, selection, flown-ness. Nothing
 * else. `useSyncExternalStore` bails out when the snapshot compares equal, so a
 * delta-v changing sixty times a second while a handle is dragged produces no
 * renders at all — which is what keeps the input fields from being torn out
 * from under the cursor.
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

const km = (m) => (m / 1e3).toLocaleString('en-US', { maximumFractionDigits: 0 })

/** Which slot of the planned projection a node's recorded frame sits in. */
function slotOf(node) {
  const i = plan.applied.indexOf(node.id)
  return i >= 0 && i < MAX_NODE_FRAMES ? i : -1
}

/** The body a burn is measured against, as a name. */
function bodyName(node) {
  const slot = slotOf(node)
  return slot < 0 ? '—' : (BODIES[plan.nodeBodies[slot]]?.name ?? '—')
}

/**
 * The orbit a burn leaves behind, about its own body. Read from what the
 * projection recorded at the instant of the impulse — see `nodeApsides`, which
 * exists because a burn's result must not change when a *later* burn is added.
 */
function orbitText(node) {
  const slot = slotOf(node)
  if (slot < 0) return 'beyond the map'
  const surface = BODIES[plan.nodeBodies[slot]]?.radius ?? 0
  const peri = plan.nodeApsides[slot * 2] - surface
  const apo = plan.nodeApsides[slot * 2 + 1]
  if (!Number.isFinite(apo)) return `${km(peri)} km × escape`
  return `${km(peri)} × ${km(apo - surface)} km`
}

function Axis({ node, axis, inputRef }) {
  const bump = (delta) => setNodeDv(node, axis.key, (node[axis.key] ?? 0) + delta)
  return (
    <div className="flex items-center gap-1.5">
      <span
        className="h-1.5 w-1.5 shrink-0 rounded-full"
        style={{ background: axis.color, boxShadow: `0 0 6px ${axis.color}` }}
      />
      <span className="w-14 shrink-0 text-[10px] text-white/45">{axis.label}</span>
      <button
        onClick={() => bump(-1)}
        className="h-5 w-5 rounded-[2px] text-[11px] text-white/40 transition-colors hover:bg-white/8 hover:text-white/80"
        title="−1 m/s"
      >
        −
      </button>
      <input
        ref={inputRef}
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
  const selected = selectedNodeId()
  const pending = nodes.filter((n) => !n.executed)

  /** Per-node DOM handles, rebuilt whenever the list's structure changes. */
  const rows = useRef({})
  rows.current = {}

  useEffect(() => {
    if (pending.length === 0) return undefined
    const id = setInterval(() => {
      for (const node of nodes) {
        const row = rows.current[node.id]
        if (!row) continue
        if (row.clock) {
          row.clock.textContent = node.executed ? 'flown' : `T−${formatClock(node.t - live.sim.t)}`
        }
        if (row.dv) row.dv.textContent = `${nodeMagnitude(node).toFixed(1)} m/s`
        if (row.body) row.body.textContent = bodyName(node)
        if (row.result) row.result.textContent = orbitText(node)
        for (const axis of AXES) {
          const el = row.fields?.[axis.key]
          // Never while it is being typed in: the pilot's half-finished "-1" is
          // more current than the model's 0.
          if (el && document.activeElement !== el) {
            el.value = (node[axis.key] ?? 0).toFixed(1)
          }
        }
      }
    }, TICK)
    return () => clearInterval(id)
  }, [pending.length, selected])

  const open = (node) => {
    selectNode(node.id)
    // The camera follows the burn the same way it follows a body — see the
    // `node` focus in CameraRig. It falls back to the body the plan is drawn
    // around if the burn has no drawn position yet.
    setUi({ focus: 'node' })
  }

  return (
    <div className="panel w-64 rounded-sm p-3.5">
      <div className="rule mb-2.5 flex items-center justify-between border-b border-white/10 pb-2">
        <span>Flight plan</span>
        {pending.length > 0 && (
          <button
            onClick={clearNodes}
            className="text-[9px] tracking-[0.14em] text-white/25 uppercase transition-colors hover:text-rose-300/80"
          >
            clear all
          </button>
        )}
      </div>

      {pending.length === 0 ? (
        <div className="space-y-1.5 text-[10px] leading-relaxed text-white/35">
          <p>
            Click the <span className="text-[#dfe3e6]/80">silver</span> trajectory to plan a
            burn there. Once one exists, click the{' '}
            <span className="text-ember/90">ember</span> path to plan the next on the orbit it
            leaves.
          </p>
          <p>
            Pull a handle to add delta-v. <kbd className="text-white/55">Shift</kbd> for fine,{' '}
            <kbd className="text-white/55">Ctrl</kbd> for coarse. Drag the centre to slide a burn
            along the orbit.
          </p>
        </div>
      ) : (
        <div className="space-y-1">
          {pending.map((node, i) => {
            const isOpen = node.id === selected
            rows.current[node.id] = { fields: {} }
            const row = rows.current[node.id]
            return (
              <div
                key={node.id}
                className={`rounded-[3px] border transition-colors ${
                  isOpen ? 'border-hud/30 bg-white/[0.04]' : 'border-transparent hover:bg-white/5'
                }`}
              >
                <button
                  onClick={() => open(node)}
                  className="flex w-full items-center gap-2 px-1.5 py-1 text-left"
                >
                  <span
                    className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[9px] ${
                      isOpen ? 'bg-hud/70 text-black' : 'bg-white/10 text-white/60'
                    }`}
                  >
                    {i + 1}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[11px] text-white/75">
                      <span ref={(el) => (row.dv = el)}>—</span>
                      <span className="ml-1.5 text-[9px] tracking-[0.12em] text-white/30 uppercase">
                        about <span ref={(el) => (row.body = el)}>—</span>
                      </span>
                    </span>
                  </span>
                  <span
                    ref={(el) => (row.clock = el)}
                    className="shrink-0 font-mono text-[10px] text-hud/70"
                  >
                    —
                  </span>
                </button>

                {isOpen && (
                  <div className="space-y-2 px-1.5 pt-1 pb-2">
                    <div className="space-y-1">
                      {AXES.map((axis) => (
                        <Axis
                          key={axis.key}
                          node={node}
                          axis={axis}
                          inputRef={(el) => (row.fields[axis.key] = el)}
                        />
                      ))}
                    </div>
                    <div className="flex items-baseline justify-between border-t border-white/8 pt-1.5 text-[10px]">
                      <span className="text-white/35">Leaves</span>
                      <span ref={(el) => (row.result = el)} className="font-mono text-amber-200/80">
                        —
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-[9px] text-white/25">the flight computer flies it</span>
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
          })}
        </div>
      )}
    </div>
  )
}
