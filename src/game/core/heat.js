import * as THREE from 'three'
import { makeShip } from './flight.js'
import { shipStats } from './ships.js'
import { STATIONS } from './world.js'

/**
 * Heat: the Lunar Compact's interest in you, in five chevrons.
 *
 *   1  a cutter hails you: stop and take a fine, or run and make it 2
 *   2  cutters pursue and shoot; your drive is inhibited while one is close
 *   3  more cutters
 *   4  more again, from further out
 *   5  everything they have
 *
 * It rises for contraband found by a scan, for shooting at patrol ships or
 * civilians, and for running from a hail. It falls a chevron at a time while
 * no patrol ship can see you (6 km), after a wait that grows with the heat.
 * A Compact station will not let you dock while you are at or above its
 * tolerance; the Shackle does not care.
 */
export const SIGHT = 6000
export const COLD_SIGHT = 1800
export const INHIBIT = 8000
const COUNT = [0, 1, 1, 2, 3, 5]
/** How many patrol ships press an attack at once, by heat: the rest hang back and search. */
const ATTACKERS = [0, 0, 1, 2, 3, 5]

export function addHeat(g, level, why) {
  const h = g.heat
  const before = h.level
  h.level = Math.min(5, Math.max(h.level, level))
  h.lastSeen = g.time
  if (h.level > before) {
    g.emit({ type: 'heat', level: h.level, why })
    h.lastKnown = g.player.pos.clone()
    if (h.level >= 2) for (const e of g.ships) if (e.team === 'compact' && e.ai && e.ai.mode !== 'attack' && !e.ai.passive && e.pos.distanceTo(g.player.pos) < SIGHT) { e.ai.mode = 'attack'; e.ai.target = g.player.id }
  }
}
export function clearHeat(g) {
  g.heat.level = 0; g.heat.hail = null; g.heat.kills = 0
  for (const e of g.ships) if (e.team === 'compact' && e.ai && e.ai.pursuer) { e.ai.mode = 'route'; e.ai.points = [e.pos.clone().add(new THREE.Vector3(0, 0, -20000).applyQuaternion(e.q))]; e.ai.leg = 0; e.ai.onEnd = 'despawn'; e.ai.speed = 1 }
}

/** Is any pursuing patrol ship close enough to jam your drive? */
export function inhibited(g) {
  if (g.heat.level < 2) return false
  for (const e of g.ships) if (e.alive && e.team === 'compact' && e.pos.distanceTo(g.player.pos) < INHIBIT) return true
  return false
}

export function stepHeat(g, dt) {
  const h = g.heat, p = g.player
  if (!p.alive || g.mode !== 'flight') return
  // Running cold: engines idle and nothing fired for three seconds. A ship
  // that is not burning is a few hundred kelvin of hull against the sky, and
  // the patrol's sensors lose it past 1.8 km.
  if (p.thrust > 0.06 || p.boosting || p.ctrl.fire) h.hotAt = g.time
  h.cold = g.time - (h.hotAt ?? 0) > 3
  const sight = h.cold ? COLD_SIGHT : SIGHT
  let seen = false, attackers = 0
  // Nearest first, so the ships pressing the attack are the ones closest to you.
  const patrol = g.ships.filter((e) => e.alive && e.team === 'compact').sort((a, b) => a.pos.distanceToSquared(p.pos) - b.pos.distanceToSquared(p.pos))
  for (const e of patrol) {
    const sees = e.pos.distanceTo(p.pos) < sight
    if (sees) seen = true
    if (h.level >= 2 && e.ai && !e.ai.passive) {
      // Hunting: some of those who see you attack; the rest, and those who
      // do not see you, search where you were last seen.
      if (sees && attackers < ATTACKERS[h.level]) { attackers++; e.ai.mode = 'attack'; e.ai.target = p.id }
      else if (e.ai.mode === 'attack' && e.ai.target === p.id || (sees && e.ai.mode !== 'search')) { e.ai.mode = 'search'; e.ai.goal = (h.lastKnown ?? p.pos).clone() }
    }
  }
  if (seen && h.level > 0) { h.lastSeen = g.time; h.lastKnown = (h.lastKnown ?? p.pos.clone()).copy(p.pos) }
  h.seen = seen
  // Cool off.
  if (h.level > 0 && g.time - h.lastSeen > 22 + 8 * h.level) {
    h.level -= 1; h.lastSeen = g.time
    g.emit({ type: 'heat', level: h.level, why: h.level ? 'cooling' : 'lost' })
    if (h.level === 0) clearHeat(g)
  }
  // Reinforcements while hot, arriving from far out, a few seconds apart.
  // A jammed distress call (a story beat) holds the reinforcements back for a while.
  if (h.level >= 1 && !g.story.noPatrol && !(g.story.jamUntil > g.time)) {
    h.spawnIn = (h.spawnIn ?? 0) - dt
    const pursuers = g.ships.filter((e) => e.alive && e.team === 'compact' && e.ai?.pursuer).length
    if (pursuers < COUNT[h.level] && h.spawnIn <= 0) {
      h.spawnIn = 6
      spawnCutter(g, h.level >= 2 ? 'attack' : 'hail')
    }
  }
  // The hail: stop within 600 m of the cutter for four seconds and pay.
  if (h.level === 1) {
    const cutter = g.ships.find((e) => e.alive && e.team === 'compact' && e.ai?.mode === 'hail')
    if (cutter) {
      if (!h.hail) { h.hail = { since: g.time, still: 0 }; g.say('patrol', 'Compact patrol. Cut your engines and hold for inspection.', 5) }
      const close = cutter.pos.distanceTo(p.pos) < 600
      if (close && p.vel.length() < 15) h.hail.still += dt; else h.hail.still = 0
      if (h.hail.still > 4) { fine(g); return }
      if (g.time - h.hail.since > 25 && !close) { g.say('patrol', 'Failure to comply. Pursuit authorised.', 4); addHeat(g, 2, 'ran') }
    }
  }
}

/** Pay up: the fine, the contraband, and the heat. */
export function fine(g) {
  const amount = 1500 * Math.max(1, g.heat.level)
  const contraband = (g.ship.cargo.chips ?? 0)
  g.credits = Math.max(0, g.credits - amount)
  if (contraband) { delete g.ship.cargo.chips; g.flags.seized = (g.flags.seized ?? 0) + contraband }
  g.say('patrol', `Fine of ${amount.toLocaleString()} credits issued${contraband ? ', contraband seized' : ''}. Fly safe.`, 5)
  g.emit({ type: 'fined', amount })
  clearHeat(g)
}

export function spawnCutter(g, mode) {
  const p = g.player
  // From behind you: where you have come from, which is where they would be coming from.
  const back = p.vel.lengthSq() > 100 ? p.vel.clone().normalize().negate() : new THREE.Vector3(0, 0, 1).applyQuaternion(p.q)
  const dir = back.add(new THREE.Vector3(Math.random() - 0.5, (Math.random() - 0.5) * 0.4, Math.random() - 0.5).multiplyScalar(0.8)).normalize()
  const at = p.pos.clone().addScaledVector(dir, 5000 + Math.random() * 2500)
  const e = makeShip('cutter', 'compact', shipStats('cutter'), at)
  e.label = 'Compact cutter'
  e.ai = { mode: mode === 'attack' ? 'search' : mode, goal: (g.heat.lastKnown ?? p.pos).clone(), target: p.id, pursuer: true, home: 'search', skill: 0.5 + 0.08 * g.heat.level }
  g.ships.push(e)
  return e
}

/**
 * Patrol scans. Near a Compact station a patrol ship within 1.5 km for
 * three seconds reads your hold. A jammer makes some scans miss; a Mule's
 * hidden compartment is not read at all.
 */
export function stepScans(g, dt) {
  const p = g.player
  if (g.mode !== 'flight' || g.heat.level > 0 || !p.alive) return
  const chips = g.ship.cargo.chips ?? 0
  for (const e of g.ships) {
    if (!e.alive || e.team !== 'compact' || e.ai?.mode === 'attack') continue
    const d = e.pos.distanceTo(p.pos)
    if (d > 1500) { e.scan = 0; continue }
    e.scan = (e.scan ?? 0) + dt
    if (e.scan > 3 && !e.scanned) {
      e.scanned = true
      g.emit({ type: 'scan', ship: e.id })
      const hiddenCap = p.stats.hidden ?? 0
      const visible = Math.max(0, chips - hiddenCap)
      if (visible > 0 && (e.sure || Math.random() >= (p.stats.scanMiss ?? 0))) {
        g.say('patrol', 'Scan complete. Contraband in your hold. Do not move.', 4)
        addHeat(g, 2, 'contraband')
      } else g.say('patrol', 'Scan complete. You are clear.', 3)
    }
  }
}

/** Does a station let you in at this heat? */
export const dockAllowed = (g, stationId) => g.heat.level < STATIONS[stationId].law
