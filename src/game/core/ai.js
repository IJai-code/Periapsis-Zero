import * as THREE from 'three'
import { steerToward, clamp, barrelRoll } from './flight.js'
import { fire, leadPoint } from './combat.js'

/**
 * The other pilots. Each AI fills its ship's stick and throttle and pulls
 * the trigger; the physics is the same as yours.
 *
 * Fighters fly the pattern real dogfights settle into: close on the target's
 * lead point, fire when the nose is on it, break off before collision,
 * extend, and come round again. They jink (a strafe that changes every
 * second or two) so a straight burst does not simply follow them in, and a
 * ship whose shield is down and hull failing runs.
 */
const _to = new THREE.Vector3(), _lead = new THREE.Vector3(), _away = new THREE.Vector3(), _f = new THREE.Vector3()

/** Who shoots at whom. Compact ships hunt the player only while hot (heat 2+). */
export function hostile(g, a, b) {
  if (!a.alive || !b.alive || a === b) return false
  const t = a.team, u = b.team
  if (t === 'hollow') return u === 'player' || u === 'ally' || u === 'compact'
  if (t === 'compact') return u === 'hollow' || (u === 'player' && g.heat.level >= 2 && !a.ai?.passive)
  if (t === 'ally') return u === 'hollow' || (u === 'compact' && b.ai?.mode === 'attack' && b.ai.target === g.player.id)
  return false
}

export function pickTarget(g, e, range = 7000) {
  let best = null, bestD = range * range
  for (const o of g.ships) {
    if (!hostile(g, e, o)) continue
    const d = o.pos.distanceToSquared(e.pos)
    // The player is the more interesting target, at equal range.
    const w = o.kind === 'player' ? d * 0.7 : d
    if (w < bestD) { best = o; bestD = w }
  }
  return best
}

export function stepAI(g, e, dt) {
  const ai = e.ai, c = e.ctrl
  if (!ai || !e.alive) return
  ai.t = (ai.t ?? 0) + dt
  // Retarget once a second, or at once if the target died.
  if (ai.mode === 'attack' || ai.mode === 'patrol' || ai.mode === 'escort') {
    ai.retarget = (ai.retarget ?? 0) - dt
    const cur = g.byId(ai.target)
    if (!cur || !cur.alive || ai.retarget <= 0) {
      ai.retarget = 1
      const t = pickTarget(g, e, ai.range ?? 7000)
      if (t) { ai.target = t.id; if (ai.mode !== 'escort') ai.mode = 'attack' }
      else if (ai.mode === 'attack') { ai.mode = ai.home ?? 'patrol'; ai.target = null }
    }
  }
  c.fire = false
  c.boost = false
  switch (ai.mode) {
    case 'attack': return attack(g, e, dt)
    case 'escort': {
      const t = g.byId(ai.target)
      if (t && t.alive && hostile(g, e, t)) return attack(g, e, dt)
      return follow(g, e, g.player, ai.slot ?? 0)
    }
    case 'follow': return follow(g, e, g.byId(ai.lead) ?? g.player, ai.slot ?? 0)
    case 'flee': return flee(g, e, dt)
    case 'route': return route(g, e)
    case 'hail': return hail(g, e)
    case 'hold': c.throttle = 0; c.pitch = c.yaw = c.roll = 0; return
    case 'search': return search(g, e)
    default: return patrol(g, e)
  }
}

function attack(g, e, dt) {
  const ai = e.ai, c = e.ctrl, t = g.byId(ai.target)
  if (!t || !t.alive) { ai.mode = ai.home ?? 'patrol'; return }
  _to.copy(t.pos).sub(e.pos)
  const d = _to.length()
  // Running: shield gone and the hull failing.
  if (e.shield <= 0 && e.hull < e.stats.hull * 0.3 && ai.brave !== true && Math.random() < dt * 0.3) { ai.mode = 'flee'; ai.fleeFrom = t.id; ai.fleeUntil = ai.t + 8; return }
  // Under fire, a good pilot rolls out of the line, as you can.
  if (g.time - e.hitAt < 0.4 && Math.random() < dt * (ai.skill ?? 0.5)) barrelRoll(e, Math.random() < 0.5 ? 1 : -1, g.time)
  if (ai.breakUntil && ai.t < ai.breakUntil) {
    // Extend: away and past, then come round.
    c.throttle = 1; c.boost = d < 600
    steerToward(e, ai.breakDir, null, 2.5)
    return
  }
  leadPoint(e, t, _lead)
  _lead.sub(e.pos).normalize()
  const off = steerToward(e, _lead, null, 3.2)
  if (d < 260 + t.radius * 3) {
    // Too close: break off to one side, hard.
    _away.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize().addScaledVector(_to, -1 / d).normalize()
    ai.breakDir = (ai.breakDir ?? new THREE.Vector3()).copy(_away)
    ai.breakUntil = ai.t + 2.2 + Math.random() * 1.5
    return
  }
  c.throttle = d > 1500 ? 1 : d > 700 ? 0.75 : 0.45
  c.boost = d > 3500
  // Jink: a lateral shuffle that changes every second or two.
  if (!ai.jinkAt || ai.t > ai.jinkAt) { ai.jinkAt = ai.t + 1 + Math.random() * 1.5; ai.jx = (Math.random() - 0.5) * 1.4; ai.jy = (Math.random() - 0.5) * 1.4 }
  c.strafeX = d < 1600 ? ai.jx : 0; c.strafeY = d < 1600 ? ai.jy : 0
  // The trigger: nose on the lead point and in range. Skill sets the tolerance.
  const tol = 0.07 + (1 - (ai.skill ?? 0.5)) * 0.05
  if (off < tol && d < 1600) { c.fire = true; _f.copy(_lead).multiplyScalar(d).add(e.pos); fire(g, e, _f) }
}

function follow(g, e, lead, slot) {
  const c = e.ctrl
  if (!lead || !lead.alive) { c.throttle = 0; return }
  // Formation: a slot behind and beside the lead, in the lead's frame.
  _to.set((slot % 2 ? 1 : -1) * (60 + 40 * Math.floor(slot / 2)), 15, 90 + 30 * slot).applyQuaternion(lead.q).add(lead.pos).sub(e.pos)
  const d = _to.length()
  if (d > 30) {
    steerToward(e, _to.normalize(), null, 2.5)
    c.throttle = clamp(d / 600 + lead.vel.length() / e.stats.maxSpeed, 0, 1)
    c.boost = d > 1500
  } else {
    _f.set(0, 0, -1).applyQuaternion(lead.q)
    steerToward(e, _f, null, 2)
    c.throttle = clamp(lead.vel.length() / e.stats.maxSpeed, 0, 1)
  }
  c.strafeX = c.strafeY = 0
}

function flee(g, e) {
  const ai = e.ai, c = e.ctrl
  const from = g.byId(ai.fleeFrom)
  if (ai.goal) _to.copy(ai.goal).sub(e.pos)
  else if (from) _to.copy(e.pos).sub(from.pos)
  else _to.set(0, 0, -1).applyQuaternion(e.q)
  steerToward(e, _to.normalize(), null, 2.5)
  c.throttle = 1; c.boost = true
  c.strafeX = Math.sin(ai.t * 1.7) * 0.6; c.strafeY = Math.cos(ai.t * 1.3) * 0.4
  if (!ai.goal && ai.fleeUntil && ai.t > ai.fleeUntil) { ai.mode = 'attack'; ai.fleeUntil = null }
}

/** Fly a list of waypoints in order (traffic, patrol beats); at the end, `ai.onEnd`. */
function route(g, e) {
  const ai = e.ai, c = e.ctrl
  const wp = ai.points[ai.leg]
  if (!wp) { c.throttle = 0; if (ai.onEnd === 'despawn') { e.alive = false; e.silent = true } else if (ai.onEnd === 'loop') ai.leg = 0; return }
  _to.copy(wp).sub(e.pos)
  const d = _to.length()
  if (d < Math.max(80, e.radius * 3)) { ai.leg++; return }
  steerToward(e, _to.normalize(), ai.level === false ? null : undefined, 1.6)
  c.throttle = clamp(d / 1500, 0.15, ai.speed ?? 0.5)
  c.strafeX = c.strafeY = 0
}

function patrol(g, e) {
  const ai = e.ai
  if (!ai.points) {
    // A slow circuit round where it was put.
    const p = ai.center ?? e.pos.clone()
    ai.center = p
    const R = ai.radius ?? 2000
    ai.points = [0, 1, 2, 3, 4, 5].map((k) => new THREE.Vector3(p.x + Math.cos(k * 1.047) * R, p.y + (k % 2 ? 150 : -150), p.z + Math.sin(k * 1.047) * R))
    ai.leg = 0; ai.onEnd = 'loop'; ai.speed = 0.35
  }
  route(g, e)
}

/** Fly to where the target was last seen, then quarter the area round it. */
function search(g, e) {
  const ai = e.ai, c = e.ctrl
  if (!ai.goal) { ai.mode = 'patrol'; return }
  _to.copy(ai.goal).sub(e.pos)
  const d = _to.length()
  if (d < 300) { ai.goal.add(_away.set(Math.random() - 0.5, (Math.random() - 0.5) * 0.3, Math.random() - 0.5).normalize().multiplyScalar(1500)); return }
  steerToward(e, _to.normalize(), null, 2.2)
  c.throttle = d > 2000 ? 1 : 0.6
  c.boost = d > 4000
  c.strafeX = c.strafeY = 0
}

/** A cutter that has ordered you to stop: it closes and matches you. */
function hail(g, e) {
  const c = e.ctrl, p = g.player
  _to.copy(p.pos).sub(e.pos)
  const d = _to.length()
  steerToward(e, _to.normalize(), null, 2.5)
  c.throttle = d > 400 ? clamp(d / 1200, 0.3, 1) : clamp(p.vel.length() / e.stats.maxSpeed, 0, 0.3)
  c.boost = d > 2500
  c.strafeX = c.strafeY = 0
}
