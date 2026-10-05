/**
 * A scripted pilot for the game (src/game/core), for the gates: it flies,
 * docks, transfers, fights, scoops and runs the way a competent player
 * would, with the same controls a player has. If the story cannot be played
 * through by this pilot, a person cannot be expected to either.
 */
import * as THREE from 'three'
import { STEP, stepGame, setDestination, startGame, newSave, dockable, returnFromSurface, cycleTarget, refuel, repair } from '../../src/game/core/game.js'
import { STATIONS } from '../../src/game/core/world.js'
import { leadPoint } from '../../src/game/core/combat.js'
import { hostile } from '../../src/game/core/ai.js'

const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _lead = new THREE.Vector3()

export function createPilot(name = 'Bot', save = null) {
  const g = startGame(save ?? newSave(name))
  const c = { actions: [], throttleRate: 0, throttleSet: null, strafeX: 0, strafeY: 0, pitch: 0, yaw: 0, roll: 0, boost: false, fire: false, aim: null }
  const log = []
  const bot = { g, c, log, steps: 0 }
  const step = (n = 1) => { for (let i = 0; i < n; i++) { stepGame(g, c); bot.steps++ } }
  const until = (cond, seconds, why) => {
    const limit = seconds * 60
    for (let i = 0; i < limit; i++) { if (cond()) return true; if (g.mode === 'dead') throw new Error(`destroyed while ${why} (${g.place})`); step() }
    if (cond()) return true
    throw new Error(`timed out ${why} after ${seconds} s (${g.place}, mode ${g.mode}, objective: ${g.objective?.text})`)
  }
  const clear = () => { c.fire = false; c.boost = false; c.strafeX = c.strafeY = 0 }

  /** Steer the aim toward a point, bending round anything solid in the way. */
  function aimAt(target) {
    const p = g.player
    _v.copy(target).sub(p.pos)
    const d = _v.length()
    _v.divideScalar(d || 1)
    // Look ahead for station hulls and rocks within the next stretch of path.
    const obstacles = [...g.stations.map((s) => ({ at: s.at, r: s.radius + 120 })), ...g.rocks.map((r) => ({ at: r.at, r: r.radius + 80 }))]
    for (const o of obstacles) {
      _w.copy(o.at).sub(p.pos)
      const along = _w.dot(_v)
      if (along < 0 || along > Math.min(d, 2500)) continue
      const off = _w.clone().addScaledVector(_v, -along)
      if (off.length() < o.r && o.at.distanceTo(target) > o.r) {
        // Push sideways, away from the obstacle's centre.
        const side = off.lengthSq() > 1 ? off.normalize().negate() : new THREE.Vector3(0, 1, 0)
        _v.addScaledVector(side, 1.2).normalize()
      }
    }
    c.aim = _v.clone()
    return d
  }

  /** Fly to a point and stop near it (within `within` m, below `slow` m/s). */
  bot.flyTo = (target, within = 60, slow = 400, seconds = 240) => {
    clear()
    until(() => {
      const t = typeof target === 'function' ? target() : target
      if (!t) return true
      const d = aimAt(t)
      const p = g.player, sp = p.vel.length()
      // Throttle for a stop: v = sqrt(2 a d), with margin.
      const vmax = Math.min(p.stats.maxSpeed, Math.sqrt(2 * p.stats.accel * 0.5 * Math.max(0, d - within * 0.5)) + 5)
      c.throttleSet = Math.max(0.04, Math.min(1, vmax / p.stats.maxSpeed))
      c.boost = d > 4000 && p.boost > 0.3
      return d < within && sp < slow
    }, seconds, `flying to ${typeof target === 'function' ? 'a moving point' : target.toArray().map(Math.round)}`)
    clear()
  }

  bot.launch = () => { c.actions.push('launch'); until(() => g.mode === 'flight', 10, 'launching') }

  bot.dock = (id) => {
    const st = STATIONS[id]
    if (g.mode === 'docked' && g.docked === id) { refuel(g); repair(g); return }
    if (g.mode === 'docked') bot.launch()
    if (g.place !== st.place) bot.transfer(st.place)
    bot.flyTo(st.port.at.clone().addScaledVector(st.port.axis, 500), 120, 200)
    bot.flyTo(st.port.at.clone().addScaledVector(st.port.axis, 60), 60, 55)
    c.throttleSet = 0
    until(() => dockable(g), 20, `settling at ${id}'s port`)
    if (g.heat.level >= STATIONS[id].law) bot.loseHeat()
    c.actions.push('dock')
    until(() => g.mode === 'docked', 15, `docking at ${id}`)
    step(2)
    // Fill up and patch up while here, as anyone would.
    refuel(g); repair(g)
    log.push(`docked ${id}`)
  }

  bot.transfer = (dest) => {
    if (g.mode === 'docked') bot.launch()
    if (g.place === dest) return
    for (let attempt = 0; attempt < 4; attempt++) {
      setDestination(g, dest)
      // Clear of hostiles and patrols before the drive will light.
      if (g.prompt?.blocked || g.ships.some((e) => e.alive && hostile(g, e, g.player) && e.pos.distanceTo(g.player.pos) < 3500)) bot.fightAll()
      if (g.heat.level >= 2) bot.loseHeat()
      c.actions.push('transfer')
      step(2)
      if (g.mode !== 'align' && g.mode !== 'transfer') throw new Error(`transfer to ${dest} refused: ${g.prompt?.text}`)
      until(() => g.mode === 'flight', 60, `transferring to ${dest}`)
      if (g.place === dest) { step(5); log.push(`arrived ${dest}`); return }
      log.push('interdicted')
      bot.fightAll()
    }
    throw new Error(`never reached ${dest}`)
  }

  /** Fight every hostile in range until none is left. */
  bot.fightAll = (filter = () => true, seconds = 300, any = false) => {
    clear()
    until(() => {
      const p = g.player
      const foes = g.ships.filter((e) => e.alive && e !== p && (any || hostile(g, e, p)) && filter(e))
      if (!foes.length) return true
      let t = g.byId(g.target)
      if (!t || !t.alive || !foes.includes(t)) { t = foes.sort((a, b) => a.pos.distanceTo(p.pos) - b.pos.distanceTo(p.pos))[0]; g.target = t.id }
      leadPoint(p, t, _lead)
      const d = p.pos.distanceTo(t.pos)
      _v.copy(_lead).sub(p.pos).normalize()
      c.aim = _v.clone()
      const fwd = _w.set(0, 0, -1).applyQuaternion(p.q)
      c.fire = fwd.dot(_v) > Math.cos(0.05) && d < 1600
      // Keep a fighting distance, and keep moving.
      c.throttleSet = d > 900 ? 1 : d > 450 ? 0.55 : 0.25
      c.strafeX = Math.sin(bot.steps / 50) > 0 ? 1 : -1
      c.boost = d > 2500
      return false
    }, seconds, 'fighting')
    clear()
  }
  bot.fightTag = (tag, seconds = 300) => {
    // A mission's ships appear the tick its step begins; give them a moment.
    for (let i = 0; i < 180 && !g.ships.some((e) => e.alive && e.tag === tag); i++) step()
    bot.fightAll((e) => e.tag === tag, seconds, true)
  }

  bot.collect = (tag, seconds = 300) => {
    until(() => {
      const k = g.canisters.filter((x) => !x.taken && (!tag || x.tag === tag)).sort((a, b) => a.at.distanceTo(g.player.pos) - b.at.distanceTo(g.player.pos))[0]
      if (!k) return true
      const d = aimAt(k.at)
      const p = g.player
      c.throttleSet = Math.max(0.1, Math.min(1, Math.sqrt(2 * p.stats.accel * 0.5 * d) / p.stats.maxSpeed)) * 0.9
      // Deal with whoever is actually shooting at you first.
      const onMe = (e) => e.alive && hostile(g, e, p) && e.pos.distanceTo(p.pos) < 1500 && (e.team === 'hollow' || e.ai?.mode === 'attack')
      if (g.ships.some(onMe)) bot.fightAll(onMe, 120)
      return false
    }, seconds, `collecting ${tag}`)
    clear()
  }

  /** Get away from the patrol: burn away from them, then coast cold until they give up. */
  bot.loseHeat = (seconds = 400) => {
    clear()
    let tick = 0
    until(() => {
      if (process.env.CHASE && tick++ % 300 === 0) { const p0 = g.player; const cs = g.ships.filter((e) => e.alive && e.team === 'compact'); console.log(`heat ${g.heat.level} seen ${g.heat.seen} cold ${g.heat.cold} cutters ${cs.length} nearest ${Math.round(Math.min(...cs.map((e) => e.pos.distanceTo(p0.pos))))} speed ${Math.round(p0.vel.length())} sh ${Math.round(p0.shield)} hull ${Math.round(p0.hull)} modes ${cs.map((e) => e.ai.mode).join(',')}`) }
      if (g.heat.level === 0) return true
      const p = g.player
      const cutters = g.ships.filter((e) => e.alive && e.team === 'compact')
      _v.set(0, 0, 0)
      for (const e of cutters) { const away = p.pos.clone().sub(e.pos); const d = away.length(); if (d < 9000) _v.addScaledVector(away.normalize(), 1 / Math.max(d, 200)) }
      // Stay inside the area: bend back toward the centre near its edge.
      if (p.pos.length() > 20000) _v.addScaledVector(p.pos.clone().normalize(), -0.002)
      if (_v.lengthSq() > 0) c.aim = _v.normalize().clone()
      const near = cutters.some((e) => e.pos.distanceTo(p.pos) < 2500)
      c.throttleSet = near ? 1 : g.heat.seen ? 1 : p.ctrl.throttle
      c.boost = near && p.boost > 0.2
      if (!near && !g.heat.seen) { c.aim = null; c.pitch = c.yaw = 0 }
      return false
    }, seconds, 'losing the heat')
    clear()
  }

  bot.surface = (result = { complete: true, stars: 2, total: 2200, science: 220 }) => {
    bot.flyTo(new THREE.Vector3(0, 0, 0), 400, 300)
    c.actions.push('dock')
    until(() => g.mode === 'surface', 10, 'descending')
    returnFromSurface(g, result)
    step(2)
  }

  bot.step = step
  bot.until = until
  bot.target = () => cycleTarget(g)
  return bot
}

export { STEP }
