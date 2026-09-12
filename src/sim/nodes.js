/**
 * Planned manoeuvres.
 *
 * A node is an impulse the pilot intends to make at a stated instant, held in
 * the frame every flight plan is written in — along the velocity, along the
 * orbit normal, and outward. Those three are what a burn *means*: prograde
 * raises the far side, normal turns the plane, radial swings the apsides
 * around. An inertial vector would say the same thing while hiding all of it.
 *
 * Nodes are plans, not commands. Nothing here touches the flight; the
 * projection reads them to draw where they would take the craft, and the
 * sequencer executes them only when it reaches one.
 */
import { Vector3 } from 'three'

/** Planned manoeuvres, ordered by the instant they fire. */
export const nodes = []

let nextId = 1

/**
 * Anything that changes the plan bumps a revision, and React subscribes to it.
 *
 * The alternative was to mirror the plan into the UI store, which would make
 * two owners of one fact. This keeps a single array and tells the view when to
 * look again — the same shape as `useSyncExternalStore`, which is what reads it.
 */
let revision = 0
const watchers = new Set()

export function watchNodes(fn) {
  watchers.add(fn)
  return () => watchers.delete(fn)
}

/** Monotonic, so a snapshot comparison is enough to detect a change. */
export const nodeRevision = () => revision

/** Announce a change to the plan. Called by every mutator here, and by the
 *  sequencer when it marks a node flown. */
export function nodesChanged() {
  revision++
  for (const fn of watchers) fn()
}

/**
 * Which node the gizmo is attached to, if any.
 *
 * Selection lives with the nodes rather than in the UI store because it is a
 * property of the plan — deleting a node has to be able to clear it, and the
 * store cannot know that happened.
 */
let selected = null

export function selectNode(id) {
  const next = id ?? null
  if (next === selected) return
  selected = next
  nodesChanged()
}

export function selectedNode() {
  if (selected === null) return null
  for (const n of nodes) if (n.id === selected) return n
  return null
}

export const selectedNodeId = () => selected

/**
 * @param {number} t absolute simulated time of the impulse, s
 * @param {{prograde?: number, normal?: number, radial?: number}} dv in m/s
 */
export function addNode(t, dv = {}) {
  const node = {
    id: nextId++,
    t,
    prograde: dv.prograde ?? 0,
    normal: dv.normal ?? 0,
    radial: dv.radial ?? 0,
    /** Set once the sequencer has flown it, so it stops being a plan. */
    executed: false,
    /**
     * Set while the pilot is dragging this node through time. The projection
     * records its frame but skips its impulse, so the drawn plan is the path it
     * is sliding along rather than the one it would produce. Transient: never
     * true outside a drag.
     */
    deferred: false,
  }
  nodes.push(node)
  sortNodes()
  nodesChanged()
  return node
}

/**
 * Ordered by firing time, always.
 *
 * The projection walks the list once, in order, splitting its integration at
 * each node in turn — so an out-of-order list would silently drop every node
 * that came before its predecessor. Scrubbing a node's time is the operation
 * that can do that, which is why it re-sorts rather than assuming.
 */
function sortNodes() {
  nodes.sort((a, b) => a.t - b.t)
}

export function removeNode(id) {
  const i = nodes.findIndex((n) => n.id === id)
  if (i < 0) return false
  nodes.splice(i, 1)
  if (selected === id) selected = null
  nodesChanged()
  return true
}

export function clearNodes() {
  if (nodes.length === 0 && selected === null) return
  nodes.length = 0
  selected = null
  nodesChanged()
}

/** Set one component of a node's impulse, m/s. */
export function setNodeDv(node, axis, value) {
  if (!node || node.executed) return
  const v = Number.isFinite(value) ? value : 0
  if (node[axis] === v) return
  node[axis] = v
  nodesChanged()
}

/**
 * Move a node in time.
 *
 * Clamped to stay ahead of the craft: a node in the past is skipped by the
 * projection and never flown by the sequencer, so a scrub that walked one
 * backwards would make it quietly disappear while still being drawn.
 */
export function setNodeTime(node, t, now, lead = 1) {
  if (!node || node.executed) return
  const next = Math.max(now + lead, t)
  if (node.t === next) return
  node.t = next
  sortNodes()
  nodesChanged()
}

/** Hold a node's impulse out of the plan while it is dragged through time. */
export function deferNode(node, on) {
  if (!node || node.deferred === on) return
  node.deferred = on
  nodesChanged()
}

/** Total magnitude of a node's impulse, m/s. */
/** Written out rather than `Math.hypot`, which allocates on every call on this V8. */
export const nodeMagnitude = (n) =>
  Math.sqrt(n.prograde * n.prograde + n.normal * n.normal + n.radial * n.radial)

/** The next node the craft has not yet flown, or null. */
export function pendingNode(now) {
  for (const n of nodes) if (!n.executed && n.t >= now) return n
  return null
}

const _r = new Vector3()
const _v = new Vector3()
const _p = new Vector3()
const _n = new Vector3()
const _o = new Vector3()

/**
 * The orbital frame at a state, written into three output vectors.
 *
 * The basis is orthonormal by construction rather than by assumption:
 *
 *   prograde  = v̂
 *   normal    = normalize(r × v)
 *   radial    = v̂ × normal
 *
 * Taking radial as r̂ directly would be wrong except on a perfectly circular
 * orbit — off one, r̂ has a component along the velocity, so a "pure radial"
 * burn would quietly change the craft's speed as well as its direction.
 *
 * Split out of `resolveNode` because the gizmo has to *draw* this frame and the
 * projection has to record it. Three copies of the cross-product order is
 * exactly the kind of thing that drifts apart and then disagrees about which
 * way "radial in" points.
 *
 * @returns {boolean} false when the state is degenerate and the frame undefined
 */
export function nodeBasis(state, craftOffset, bodyOffset, p, n, o) {
  _r.set(
    state[craftOffset] - state[bodyOffset],
    state[craftOffset + 1] - state[bodyOffset + 1],
    state[craftOffset + 2] - state[bodyOffset + 2],
  )
  _v.set(
    state[craftOffset + 3] - state[bodyOffset + 3],
    state[craftOffset + 4] - state[bodyOffset + 4],
    state[craftOffset + 5] - state[bodyOffset + 5],
  )
  if (_v.lengthSq() === 0 || _r.lengthSq() === 0) return false

  p.copy(_v).normalize()
  n.crossVectors(_r, _v).normalize()
  o.crossVectors(p, n)
  return true
}

/**
 * Resolve a node's impulse into an inertial delta-v, given the craft's state
 * relative to the body it is orbiting.
 *
 * Writes into `out` and allocates nothing.
 */
export function resolveNode(node, state, craftOffset, bodyOffset, out) {
  if (!nodeBasis(state, craftOffset, bodyOffset, _p, _n, _o)) return out.set(0, 0, 0)

  return out
    .set(0, 0, 0)
    .addScaledVector(_p, node.prograde)
    .addScaledVector(_n, node.normal)
    .addScaledVector(_o, node.radial)
}
