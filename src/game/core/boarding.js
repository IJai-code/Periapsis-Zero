import * as THREE from 'three'

export const BOARD_T = { outside: 5.2, inside: 5.2, bridge: 2.0, cross: 7.5, climb: 3.2, settle: 2.4 }
export const BOARD_DUR = Object.values(BOARD_T).reduce((a, b) => a + b, 0)
export const BOARD_SEATED = BOARD_DUR - BOARD_T.settle
export const COCKPIT = { kestrel: [0, 1.1, -4.7], lance: [0, 0.72, -3.0], mule: [0, 2.6, -13.2] }
export const KEEL = { kestrel: 2.9, mule: 3.0, lance: 1.2 }
const SKY = { z: -4.25, floor: -2.6, out0: 50, out1: 41.5, in0: 21, in1: 12.8, end: 12 }
const ease = (x) => { const f = Math.min(1, Math.max(0, x)); return f * f * (3 - 2 * f) }
const stroll = (x) => { const f = Math.min(1, Math.max(0, x)), r = 0.2, v = 1 / (1 - r); return f < r ? v * f * f / (2 * r) : f > 1 - r ? 1 - v * (1 - f) ** 2 / (2 * r) : v * (f - r / 2) }
const start = new THREE.Vector3(), end = new THREE.Vector3(), a = new THREE.Vector3(), b = new THREE.Vector3()

export function bridgeEnds(hull, from, to) {
  const [cx, cy, cz] = COCKPIT[hull] ?? COCKPIT.kestrel
  from.set(SKY.end, SKY.floor + 6 - (KEEL[hull] ?? 2.9), SKY.z)
  to.set(cx + (hull === 'mule' ? 2.2 : 1.5), cy - 0.25, cz)
  return from
}
function walk(out, from, to, duration, t, steps) {
  out.pos.lerpVectors(from, to, stroll(t / duration))
  out.heading = Math.atan2(to.x - from.x, to.z - from.z)
  out.walk = t / duration * steps * Math.PI
  out.stride = Math.sin(Math.PI * Math.min(1, t / duration)) ** 0.4
  return out
}
/** All coordinates in metres in the bay frame. Outside-to-inside is a camera cut. */
export function boardPose(hull, time, out) {
  const T = BOARD_T, [cx, cy, cz] = COCKPIT[hull] ?? COCKPIT.kestrel
  const floor = SKY.floor + 6 - (KEEL[hull] ?? 2.9)
  bridgeEnds(hull, start, end)
  out.hidden = false; out.stride = 0; out.walk = 0; out.bridge = 0; out.entry = 0
  let t = Math.max(0, time)
  if (t < T.outside) { out.phase = 'outside'; return walk(out, a.set(SKY.out0, floor, SKY.z), b.set(SKY.out1, floor, SKY.z), T.outside, t, 13) }
  t -= T.outside
  if (t < T.inside) { out.phase = 'inside'; return walk(out, a.set(SKY.in0, floor, SKY.z), b.set(SKY.in1, floor, SKY.z), T.inside, t, 9) }
  t -= T.inside
  if (t < T.bridge) {
    out.phase = 'bridge'; out.pos.set(SKY.in1, floor, SKY.z)
    out.heading = Math.atan2(end.x - start.x, end.z - start.z) * ease(t / T.bridge) + (-Math.PI / 2) * (1 - ease(t / T.bridge))
    out.bridge = ease(t / T.bridge); return out
  }
  t -= T.bridge; out.bridge = 1
  if (t < T.cross) { out.phase = 'cross'; return walk(out, a.set(SKY.in1, floor, SKY.z), end, T.cross, t, 7) }
  t -= T.cross
  if (t < T.climb) {
    out.phase = 'climb'
    const s = ease(t / T.climb)
    // The sit clip drops the hips 0.42m; do not double that displacement.
    out.entry = s
    out.pos.set(end.x + (cx - end.x) * s, end.y + (cy - 0.58 - end.y) * s + Math.sin(Math.PI * s) * 0.12, end.z + (cz - end.z) * s)
    const heading = Math.atan2(end.x - start.x, end.z - start.z)
    out.heading = heading + Math.atan2(Math.sin(Math.PI - heading), Math.cos(Math.PI - heading)) * s
    return out
  }
  t -= T.climb
  out.phase = 'settle'; out.pos.set(cx, cy - 0.58, cz); out.entry = 1; out.heading = Math.PI
  out.hidden = t >= T.settle
  out.bridge = 1 - ease(t / (T.settle * 0.7))
  return out
}
