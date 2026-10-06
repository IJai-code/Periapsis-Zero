import * as THREE from 'three'

/**
 * Ships flown on another machine, drawn here: each report sets where the
 * ship was, and between reports it is carried on by its velocity and eased
 * toward that, so a few packets a second look like flight.
 *
 * A state row is [x, y, z, qx, qy, qz, qw, vx, vy, vz, hull, shield, thrust, boost],
 * hull and shield as fractions.
 */
const r1 = (x) => Math.round(x * 10) / 10
const r3 = (x) => Math.round(x * 1000) / 1000
export function shipState(e) {
  return [r1(e.pos.x), r1(e.pos.y), r1(e.pos.z), r3(e.q.x), r3(e.q.y), r3(e.q.z), r3(e.q.w), Math.round(e.vel.x), Math.round(e.vel.y), Math.round(e.vel.z), r3(Math.max(0, e.hull) / e.stats.hull), r3(Math.max(0, e.shield) / e.stats.shield), r3(e.thrust ?? 0), e.boosting ? 1 : 0]
}

/** A puppet's reported state; it eases toward it between packets. */
export function setNet(e, s, now) {
  e.net = e.net ?? { pos: new THREE.Vector3(), q: new THREE.Quaternion(), vel: new THREE.Vector3(), at: 0 }
  e.net.pos.set(s[0], s[1], s[2]); e.net.q.set(s[3], s[4], s[5], s[6]).normalize(); e.net.vel.set(s[7], s[8], s[9]); e.net.at = now
  e.hull = s[10] * e.stats.hull; e.shield = s[11] * e.stats.shield; e.thrust = s[12]; e.boosting = Boolean(s[13])
  if (!e.seen) { e.pos.copy(e.net.pos); e.q.copy(e.net.q); e.seen = true }
}

const _p = new THREE.Vector3()
/** One step of a puppet: where it should be now, eased to. */
export function followNet(e, dt) {
  if (!e.net) return
  if (e.net.at !== e.net.last) { e.net.last = e.net.at; e.net.dt = 0 }
  e.net.dt = (e.net.dt ?? 0) + dt
  _p.copy(e.net.vel).multiplyScalar(Math.min(0.5, e.net.dt)).add(e.net.pos)
  e.pos.lerp(_p, 1 - Math.exp(-dt * 10))
  e.vel.copy(e.net.vel)
  e.q.slerp(e.net.q, 1 - Math.exp(-dt * 12))
}
