import * as THREE from 'three'
import { shipStats } from './ships.js'

/**
 * Local flight, for every ship in the sky: the player's and every AI's use
 * the same function, so an AI can do nothing a player could not.
 *
 * Body axes: right +x, up +y, forward -z (three.js's convention, so a ship
 * and a camera point the same way). Six-axis thrusters, momentum kept.
 *
 * Flight assist (on by default) is a velocity controller: the stick asks for
 * a velocity and the thrusters spend their real acceleration getting there,
 * axis by axis, so a turn at speed slides before it bites. Off, the
 * throttle is thrust and nothing damps the drift: Newton, as it is.
 *
 * Nothing here allocates: scratch vectors are module-level.
 */
const _v = new THREE.Vector3(), _d = new THREE.Vector3(), _a = new THREE.Vector3()
const _q = new THREE.Quaternion(), _qi = new THREE.Quaternion(), _e = new THREE.Euler()
export const FORWARD = new THREE.Vector3(0, 0, -1)
export const UP = new THREE.Vector3(0, 1, 0)
export const RIGHT = new THREE.Vector3(1, 0, 0)

/** Seconds the assist takes to close a velocity error: the stiffness of the ship. */
const ASSIST_TAU = 0.45
const BOOST_DRAIN = 0.3, BOOST_REGEN = 0.16, BOOST_DELAY = 1.2
const SHIELD_DELAY = 3

let nextId = 1
export function makeShip(kind, team, stats, pos, q) {
  return {
    id: nextId++, kind, team, stats, radius: stats.radius,
    pos: pos ? pos.clone() : new THREE.Vector3(), vel: new THREE.Vector3(),
    q: q ? q.clone() : new THREE.Quaternion(), w: new THREE.Vector3(),
    ctrl: { throttle: 0, strafeX: 0, strafeY: 0, pitch: 0, yaw: 0, roll: 0, boost: false, fire: false, fa: true },
    boost: 1, boosting: false, boostAt: -99, shield: stats.shield, hull: stats.hull, hitAt: -99,
    gunHeat: 0, gunCooldown: 0, gunSide: 0, alive: true, ai: null, label: stats.name,
  }
}
export function playerShip(hullId, upgrades, hullFraction = 1) {
  const s = makeShip('player', 'player', shipStats(hullId, upgrades))
  s.hull = s.stats.hull * hullFraction
  return s
}

/** The ship's forward direction (world), into `out`. */
export const forwardOf = (e, out) => out.copy(FORWARD).applyQuaternion(e.q)

/**
 * One fixed step. `time` is the game's running clock (s), for recharge delays.
 */
export function stepShip(e, dt, time) {
  const s = e.stats, c = e.ctrl
  // Rotation: the stick commands a rate; the reaction wheels and RCS reach
  // it at four times the rate per second.
  const ra = 4 * dt
  e.w.x += clamp(c.pitch * s.rates[0] - e.w.x, -s.rates[0] * ra, s.rates[0] * ra)
  e.w.y += clamp(c.yaw * s.rates[1] - e.w.y, -s.rates[1] * ra, s.rates[1] * ra)
  e.w.z += clamp(c.roll * s.rates[2] - e.w.z, -s.rates[2] * ra, s.rates[2] * ra)
  _e.set(e.w.x * dt, e.w.y * dt, e.w.z * dt, 'XYZ')
  _q.setFromEuler(_e)
  e.q.multiply(_q).normalize()

  // Boost: a fuel-free overdrive on a battery that drains and recharges.
  const boosting = c.boost && e.boost > 0.02 && c.throttle > 0.1
  if (boosting) { e.boost = Math.max(0, e.boost - BOOST_DRAIN * dt); e.boostAt = time } else if (time - e.boostAt > BOOST_DELAY) e.boost = Math.min(1, e.boost + BOOST_REGEN * dt)
  e.boosting = boosting
  const kick = boosting ? s.boost : 1
  const cap = s.maxSpeed * kick

  _qi.copy(e.q).invert()
  if (c.fa) {
    // Desired velocity, in the world: forward by throttle, plus strafe.
    _d.set(c.strafeX * s.maxSpeed * 0.45, c.strafeY * s.maxSpeed * 0.45, -c.throttle * cap).applyQuaternion(e.q)
    _v.copy(_d).sub(e.vel).divideScalar(ASSIST_TAU).applyQuaternion(_qi)
    _a.set(clamp(_v.x, -s.lateral, s.lateral), clamp(_v.y, -s.lateral, s.lateral), clamp(_v.z, -s.accel * kick, s.accel * 0.6))
  } else {
    // Assist off: the throttle is thrust and the drift is yours.
    _a.set(c.strafeX * s.lateral, c.strafeY * s.lateral, -c.throttle * s.accel * kick)
  }
  e.thrust = _a.length() / (s.accel * kick)
  _a.applyQuaternion(e.q)
  e.vel.addScaledVector(_a, dt)
  // A hard ceiling, assist or not: the hull's structural limit on what the
  // drive will push it to locally.
  const sp = e.vel.length()
  if (sp > cap * 1.6) e.vel.multiplyScalar(cap * 1.6 / sp)
  e.pos.addScaledVector(e.vel, dt)

  if (time - e.hitAt > SHIELD_DELAY) e.shield = Math.min(s.shield, e.shield + s.shield * (s.recharge ?? 0.06) * dt)
  e.gunCooldown = Math.max(0, e.gunCooldown - dt)
}

/**
 * Steering: the stick that would turn `e` toward world direction `dir`,
 * written into e.ctrl (pitch and yaw), with roll levelling toward `up`.
 * Returns the remaining angle to the target, rad.
 */
export function steerToward(e, dir, up = UP, gain = 3) {
  _qi.copy(e.q).invert()
  _d.copy(dir).applyQuaternion(_qi)
  const yawErr = Math.atan2(-_d.x, -_d.z)
  const pitchErr = Math.atan2(_d.y, Math.hypot(_d.x, _d.z))
  const s = e.stats
  e.ctrl.yaw = clamp((gain * yawErr - 0.5 * e.w.y) / s.rates[1], -1, 1)
  e.ctrl.pitch = clamp((gain * pitchErr - 0.5 * e.w.x) / s.rates[0], -1, 1)
  if (up) {
    // Bank toward level: the world's up, seen from the ship, should be up.
    _v.copy(up).applyQuaternion(_qi)
    const rollErr = Math.atan2(-_v.x, _v.y)
    e.ctrl.roll = clamp((1.5 * rollErr - 0.4 * e.w.z) / s.rates[2], -1, 1)
  }
  return Math.acos(clamp(-_d.z / (_d.length() || 1), -1, 1))
}

export const clamp = (x, a, b) => (x < a ? a : x > b ? b : x)
