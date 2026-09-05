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
  }
  nodes.push(node)
  nodes.sort((a, b) => a.t - b.t)
  return node
}

export function removeNode(id) {
  const i = nodes.findIndex((n) => n.id === id)
  if (i >= 0) nodes.splice(i, 1)
  return i >= 0
}

export function clearNodes() {
  nodes.length = 0
}

/** Total magnitude of a node's impulse, m/s. */
export const nodeMagnitude = (n) => Math.hypot(n.prograde, n.normal, n.radial)

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
 * Resolve a node's impulse into an inertial delta-v, given the craft's state
 * relative to the body it is orbiting.
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
 * Writes into `out` and allocates nothing.
 */
export function resolveNode(node, state, craftOffset, bodyOffset, out) {
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
  if (_v.lengthSq() === 0 || _r.lengthSq() === 0) return out.set(0, 0, 0)

  _p.copy(_v).normalize()
  _n.crossVectors(_r, _v).normalize()
  _o.crossVectors(_p, _n)

  return out
    .set(0, 0, 0)
    .addScaledVector(_p, node.prograde)
    .addScaledVector(_n, node.normal)
    .addScaledVector(_o, node.radial)
}
