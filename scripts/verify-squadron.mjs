import assert from 'node:assert/strict'
import * as THREE from 'three'
import { createSkirmish, SQUAD, LIVES } from '../src/game/core/skirmish.js'
import { stepGame } from '../src/game/core/game.js'
import { makeShip } from '../src/game/core/flight.js'
import { shipStats } from '../src/game/core/ships.js'
import { leadPoint } from '../src/game/core/combat.js'
import { hostile } from '../src/game/core/ai.js'

/*
 * Squadron (src/game/core/skirmish.js): waves, wingmates, the reserve of
 * ships, and two machines in one squadron, joined here by a loopback in
 * place of the Realtime room so the gate needs no network. A live room is
 * the same messages over a websocket (src/game/net/realtime.js).
 */
let seed = 0x5eed
Math.random = () => { seed = (seed + 0x6d2b79f5) | 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
const mem = new Map()
globalThis.localStorage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v), removeItem: (k) => mem.delete(k) }
let checks = 0
const check = (name, fn) => { fn(); console.log(`  ✓ ${name}`); checks++ }
const controls = () => ({ actions: [], throttleRate: 0, throttleSet: null, strafeX: 0, strafeY: 0, pitch: 0, yaw: 0, roll: 0, boost: false, fire: false, aim: null })
const _l = new THREE.Vector3(), _w = new THREE.Vector3()
function fly(g, c, n) {
  const p = g.player
  const foes = g.ships.filter((e) => e.alive && hostile(g, e, p))
  if (g.mode !== 'flight' || !foes.length) { c.fire = false; c.aim = null; c.throttleSet = 0.2; return }
  const t = foes.sort((a, b) => a.pos.distanceTo(p.pos) - b.pos.distanceTo(p.pos))[0]
  leadPoint(p, t, _l)
  const d = p.pos.distanceTo(t.pos)
  c.aim = _l.clone().sub(p.pos).normalize()
  c.fire = _w.set(0, 0, -1).applyQuaternion(p.q).dot(c.aim) > Math.cos(0.05) && d < 1600
  c.throttleSet = d > 900 ? 1 : d > 450 ? 0.55 : 0.25
  c.strafeX = Math.sin(n / 50) > 0 ? 1 : -1
}

check('alone, three wingmates fill the squadron; waves come, grow, and pay', () => {
  const g = createSkirmish({ name: 'Solo' })
  assert.equal(g.ships.filter((e) => e.bot && e.alive).length, SQUAD - 1)
  const c = controls()
  let n = 0
  const sizes = []
  let last = 0
  for (; n < 60 * 60 * 6 && g.skirmish.wave < 3; n++) {
    fly(g, c, n); stepGame(g, c)
    if (g.skirmish.wave !== last) { last = g.skirmish.wave; sizes.push(g.ships.filter((e) => e.alive && e.team === 'hollow').length) }
  }
  assert.ok(g.skirmish.wave >= 3, `reached wave ${g.skirmish.wave}`)
  assert.ok(sizes[2] > sizes[0], `waves grow: ${sizes.join(', ')}`)
  assert.ok(g.skirmish.score >= 500, `score ${g.skirmish.score}`)
})

check('the reserve runs out: every ship lost costs one, and the last ends the run and keeps the best', () => {
  const g = createSkirmish({ name: 'Doomed', arena: 'gateway' })
  const c = controls()
  for (let i = 0; i < LIVES; i++) {
    g.player.hull = 0; g.player.alive = false
    for (let k = 0; k < 60 * 6 && g.skirmish.state !== 'over'; k++) stepGame(g, c)
  }
  assert.equal(g.skirmish.lives, 0)
  assert.equal(g.skirmish.state, 'over')
  assert.ok(JSON.parse(mem.get('pz-skirmish-best')).gateway, 'the run was recorded')
})

/** Two rooms joined in memory: what one broadcasts, the other hears, a step later. */
function loopback() {
  const rooms = []
  const queue = []
  const room = () => { const r = { onMessage: null, broadcast: (ev, p) => queue.push([r, ev, JSON.parse(JSON.stringify(p))]) }; rooms.push(r); return r }
  const flush = () => { for (const [from, ev, p] of queue.splice(0)) for (const r of rooms) if (r !== from) r.onMessage?.(ev, p) }
  return { room, flush }
}

check('a friend who joins takes a wingmate\'s seat, flies in the host\'s world, and their hits count there', () => {
  const hub = loopback()
  const A = createSkirmish({ name: 'Host', net: hub.room(), host: true, code: 'ABCDE', me: 'a' })
  const B = createSkirmish({ name: 'Guest', net: hub.room(), host: false, code: 'ABCDE', me: 'b', hull: 'lance' })
  const ca = controls(), cb = controls()
  const fighting = () => B.ships.some((e) => e.puppet && e.team === 'hollow' && e.alive)
  for (let n = 0; n < 60 * 60 && (n < 60 * 12 || !fighting()); n++) { fly(A, ca, n); fly(B, cb, n); stepGame(A, ca); stepGame(B, cb); hub.flush() }
  assert.equal(A.skirmish.remote.size, 1, 'the host sees the guest')
  assert.equal(A.ships.filter((e) => e.bot && e.alive).length, SQUAD - 2, 'one wingmate made room')
  const seen = A.skirmish.remote.get('b').ship
  assert.ok(seen.pos.distanceTo(B.player.pos) < 120, `the guest is where they are: ${seen.pos.distanceTo(B.player.pos).toFixed(0)} m off`)
  assert.equal(B.skirmish.wave, A.skirmish.wave, 'the guest is on the host\'s wave')
  const enemies = B.ships.filter((e) => e.puppet && e.team === 'hollow' && e.alive)
  assert.ok(enemies.length > 0, 'the guest sees the host\'s raiders')
  // A guest's hit, reported, is damage on the host's raider.
  const target = enemies[0]
  const real = A.byId(target.netId)
  const before = real.hull + real.shield
  B.onHit(target, B.player.id, 'player', 12)
  hub.flush()
  assert.ok(real.hull + real.shield < before, 'the host applied the guest\'s hit')
})

check('a pilot who stops reporting leaves, and a wingmate takes the seat back', () => {
  const hub = loopback()
  const A = createSkirmish({ name: 'Host', net: hub.room(), host: true, code: 'QWERT', me: 'a' })
  const B = createSkirmish({ name: 'Guest', net: hub.room(), host: false, code: 'QWERT', me: 'b' })
  const c = controls()
  for (let n = 0; n < 60 * 3; n++) { stepGame(A, c); stepGame(B, c); hub.flush() }
  assert.equal(A.skirmish.remote.size, 1)
  for (let n = 0; n < 60 * 10; n++) stepGame(A, c)
  assert.equal(A.skirmish.remote.size, 0, 'gone after silence')
  assert.equal(A.ships.filter((e) => e.bot && e.alive).length, SQUAD - 1)
  void makeShip; void shipStats
})

console.log(`\n${checks} squadron checks pass.`)
