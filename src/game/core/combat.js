import * as THREE from 'three'
import { LASER } from './ships.js'

/**
 * Guns and what they hit.
 *
 * Bolts are projectiles at 2.2 km/s, not hitscan beams: at a kilometre a
 * bolt takes half a second, so a target crossing your nose has to be led, a
 * pilot who jinks can make you miss, and the lead marker on the HUD is the
 * answer to "where do I aim". Each bolt is swept against every ship as a
 * segment against a sphere, so a fast bolt never steps through a small one.
 *
 * The pool is fixed (typed arrays) and nothing allocates per shot.
 */
export const MAX_BOLTS = 512
export function makeBolts() {
  return {
    n: MAX_BOLTS, x: new Float64Array(MAX_BOLTS), y: new Float64Array(MAX_BOLTS), z: new Float64Array(MAX_BOLTS),
    vx: new Float32Array(MAX_BOLTS), vy: new Float32Array(MAX_BOLTS), vz: new Float32Array(MAX_BOLTS),
    life: new Float32Array(MAX_BOLTS), damage: new Float32Array(MAX_BOLTS), owner: new Int32Array(MAX_BOLTS),
    team: new Array(MAX_BOLTS).fill(null), next: 0,
  }
}

const _f = new THREE.Vector3(), _r = new THREE.Vector3(), _u = new THREE.Vector3(), _o = new THREE.Vector3(), _d = new THREE.Vector3()

/**
 * Fire if the gun is ready. Guns alternate sides; with a target near the
 * nose they gimbal up to 3 degrees toward its lead point, as real fixed-mount
 * cannon on a gimbal do. Returns true if a bolt left.
 */
export function fire(g, e, aimAt = null) {
  if (e.gunCooldown > 0 || !e.alive) return false
  const s = e.stats
  if (!s.guns) return false
  const rate = s.fireRate ?? LASER.rate
  e.gunCooldown = 1 / (rate * Math.max(1, s.guns) / 2)
  const b = g.bolts, i = b.next
  b.next = (b.next + 1) % b.n
  _f.set(0, 0, -1).applyQuaternion(e.q)
  _r.set(1, 0, 0).applyQuaternion(e.q)
  _u.set(0, 1, 0).applyQuaternion(e.q)
  e.gunSide = (e.gunSide + 1) % Math.max(1, s.guns)
  const side = (e.gunSide % 2 ? 1 : -1) * s.radius * 0.45, drop = e.gunSide > 1 ? -s.radius * 0.15 : 0
  _o.copy(e.pos).addScaledVector(_r, side).addScaledVector(_u, drop).addScaledVector(_f, s.radius * 0.6)
  _d.copy(_f)
  if (aimAt) {
    _r.copy(aimAt).sub(_o).normalize()
    if (_r.dot(_f) > Math.cos(0.052)) _d.copy(_r)
  }
  // A little spread, so a long burst is a cone and not a needle.
  _d.x += (Math.random() - 0.5) * LASER.spread; _d.y += (Math.random() - 0.5) * LASER.spread; _d.normalize()
  b.x[i] = _o.x; b.y[i] = _o.y; b.z[i] = _o.z
  b.vx[i] = e.vel.x + _d.x * LASER.speed; b.vy[i] = e.vel.y + _d.y * LASER.speed; b.vz[i] = e.vel.z + _d.z * LASER.speed
  b.life[i] = LASER.life; b.damage[i] = s.damage ?? LASER.damage; b.owner[i] = e.id; b.team[i] = e.team
  g.emit({ type: 'fire', ship: e.id, player: e.kind === 'player' })
  return true
}

/** Step every live bolt, and resolve hits against `ships`. */
export function stepBolts(g, dt) {
  const b = g.bolts, ships = g.ships
  for (let i = 0; i < b.n; i++) {
    if (b.life[i] <= 0) continue
    b.life[i] -= dt
    const x0 = b.x[i], y0 = b.y[i], z0 = b.z[i]
    const dx = b.vx[i] * dt, dy = b.vy[i] * dt, dz = b.vz[i] * dt
    b.x[i] += dx; b.y[i] += dy; b.z[i] += dz
    const len2 = dx * dx + dy * dy + dz * dz
    for (let k = 0; k < ships.length; k++) {
      const e = ships[k]
      if (!e.alive || e.id === b.owner[i] || friendly(b.team[i], e.team)) continue
      // Closest approach of the segment to the ship's centre.
      const ox = e.pos.x - x0, oy = e.pos.y - y0, oz = e.pos.z - z0
      const t = Math.max(0, Math.min(1, (ox * dx + oy * dy + oz * dz) / len2))
      const cx = ox - dx * t, cy = oy - dy * t, cz = oz - dz * t
      if (cx * cx + cy * cy + cz * cz > e.radius * e.radius) continue
      b.life[i] = 0
      damage(g, e, b.damage[i], b.owner[i], b.team[i])
      break
    }
  }
}

/** Teams that do not hit each other: allies and themselves. */
export function friendly(a, b) {
  if (a === b) return true
  if ((a === 'player' && b === 'ally') || (a === 'ally' && b === 'player')) return true
  return false
}

/** Shields, then hull. Events tell the HUD, the sound and the effects. */
export function damage(g, e, amount, byId, byTeam) {
  if (!e.alive) return
  e.hitAt = g.time
  e.lastAttacker = byId
  const toShield = Math.min(e.shield, amount)
  e.shield -= toShield
  e.hull -= amount - toShield
  g.emit({ type: 'hit', ship: e.id, by: byId, shield: toShield > 0, player: e.kind === 'player', byPlayer: byTeam === 'player' })
  if (g.onHit) g.onHit(e, byId, byTeam)
  if (e.hull <= 0) {
    e.hull = 0
    e.alive = false
    g.emit({ type: 'explode', ship: e.id, x: e.pos.x, y: e.pos.y, z: e.pos.z, size: e.radius, player: e.kind === 'player', byPlayer: byTeam === 'player' })
    if (g.onKill) g.onKill(e, byId, byTeam)
  }
}

/**
 * Where to aim to hit `target` from `shooter` with a bolt: the classic
 * intercept, solved exactly for constant velocities. Into `out`; false if
 * there is no solution (target outrunning the bolt).
 */
export function leadPoint(shooter, target, out) {
  const rx = target.pos.x - shooter.pos.x, ry = target.pos.y - shooter.pos.y, rz = target.pos.z - shooter.pos.z
  const vx = target.vel.x - shooter.vel.x, vy = target.vel.y - shooter.vel.y, vz = target.vel.z - shooter.vel.z
  const a = vx * vx + vy * vy + vz * vz - LASER.speed * LASER.speed
  const b = 2 * (rx * vx + ry * vy + rz * vz)
  const c = rx * rx + ry * ry + rz * rz
  const disc = b * b - 4 * a * c
  if (disc < 0) { out.copy(target.pos); return false }
  const t = (-b - Math.sqrt(disc)) / (2 * a)
  const tt = t > 0 ? t : (-b + Math.sqrt(disc)) / (2 * a)
  // Bolts carry the shooter's own velocity, so the aim is in the shooter's frame.
  out.set(target.pos.x + vx * tt, target.pos.y + vy * tt, target.pos.z + vz * tt)
  return tt > 0
}
