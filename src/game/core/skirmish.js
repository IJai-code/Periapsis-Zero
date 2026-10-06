import * as THREE from 'three'
import { startGame, newSave, loadPlace, pilot, collide, act, tickComms, worldUp, spawnRaiders } from './game.js'
import { makeShip, playerShip, stepShip } from './flight.js'
import { shipStats } from './ships.js'
import { stepAI } from './ai.js'
import { stepBolts, spawnBolt, damage } from './combat.js'
import { followNet, setNet, shipState } from '../net/puppet.js'

/**
 * Skirmish: hold a piece of sky against waves of raiders, as a squadron of
 * four. Alone, three AI wingmates fly with you; with friends (a squadron
 * code), each one who joins takes a wingmate's place.
 *
 * Authority is split the simple way. Every pilot flies their own ship on
 * their own machine and reports their hits on enemies. The host (whoever
 * made the code; you, alone) flies the enemies and the wingmates, keeps the
 * score and the wave, and sends the world a few times a second. Enemy shots
 * travel to everyone, so each pilot's machine decides what hits them.
 *
 * Network messages, on a Realtime room (net/realtime.js):
 *   'p'    a pilot's ship, its shots since the last packet, and its state
 *   'snap' the host's world: wave, score, lives, enemies and wingmates, their shots
 *   'h'    a hit on an enemy, from a pilot to the host
 *   'k'    a kill, from the host to the pilot who made it
 */
export const ARENAS = {
  drift: { name: 'The Drift', place: 'drift', blurb: 'Rocks to hide behind, and the Hollow know every one.' },
  gateway: { name: 'Gateway', place: 'gateway', blurb: 'The Moon below and the Compact watching.' },
  harbor: { name: 'Harbor', place: 'harbor', blurb: 'Four hundred kilometres over the Earth.' },
}
export const SQUAD = 4
export const LIVES = 6
const BOTS = ['Ash', 'Juno', 'Kite']
const SEND = 1 / 8
const SPAWN = new THREE.Vector3(0, 300, 5200)

/** A new skirmish game object, ready to step. `net` is a room or null (solo). */
export function createSkirmish({ name = 'Pilot', suit = 'hearth', hull = 'kestrel', arena = 'drift', net = null, host = true, code = null, me = 'solo', upgrades = { shields: 2, armor: 2, guns: 2, engines: 1 } }) {
  const save = newSave(name, suit)
  save.ship.hull = hull
  save.ship.up = upgrades
  save.story = { active: null, step: 0, done: [], choice: null, offered: [] }
  const g = startGame(save)
  g.player = playerShip(hull, upgrades, 1)
  loadPlace(g, ARENAS[arena].place)
  g.ships = [g.player]
  g.rings = []; g.canisters = []; g.beacons = []; g.jobs = []
  g.story.noAmbient = g.story.noPatrol = g.story.noInterdict = true
  g.mode = 'flight'; g.docked = null
  g.comms = []
  // The host starts in the first slot of the line; each friend in one of the others, by their id.
  const slot = host ? 0 : 1 + ([...me].reduce((n, ch) => n + ch.charCodeAt(0), 0) % (SQUAD - 1))
  place(g, g.player, slot)
  g.skirmish = {
    arena, code, host, net, me, name, suit, hull, slot,
    wave: 0, score: 0, lives: LIVES, state: 'break', breakUntil: g.time + 7, over: null,
    remote: new Map(), puppets: new Map(), out: [], sendAt: 0, seenEv: 0, myKills: 0, deadUntil: 0, wasAlive: true,
    roster: new Map(),
  }
  g.step = stepSkirmish
  g.onHit = (e, byId, byTeam, amount) => onHit(g, e, byId, byTeam, amount)
  g.onKill = (e, byId) => onKill(g, e, byId)
  if (host) syncBots(g)
  if (net) net.onMessage = (ev, p) => receive(g, ev, p)
  g.say('control', host ? `${ARENAS[arena].name}. Hostiles inbound in a few seconds. Form up.` : `Joined the squadron at ${ARENAS[arena].name}.`, 5)
  return g
}

/** Where a pilot starts or comes back: a slot in a line abreast, facing the middle. */
function place(g, e, slot) {
  const up = worldUp(g, new THREE.Vector3())
  e.pos.copy(SPAWN).add(new THREE.Vector3((slot - 1.5) * 90, 0, 0))
  e.vel.set(0, 0, 0)
  e.q.setFromRotationMatrix(new THREE.Matrix4().lookAt(e.pos, new THREE.Vector3(0, 0, 0), up))
}

/* ------------------------------------------------------------------ *
 * The step
 * ------------------------------------------------------------------ */

export function stepSkirmish(g, input, dt) {
  const sk = g.skirmish, p = g.player
  g.real += dt
  g.time += dt
  for (const a of input.actions.splice(0)) if (a !== 'launch' && a !== 'dock' && a !== 'transfer') act(g, a, input)
  if (g.mode === 'dead') {
    if (sk.state !== 'over' && g.real >= sk.deadUntil) comeBack(g)
  } else {
    pilot(g, p, input, dt)
    stepShip(p, dt, g.time)
  }
  for (const e of g.ships) {
    if (e === p || !e.alive) continue
    if (e.puppet) followNet(e, dt)
    else { stepAI(g, e, dt); stepShip(e, dt, g.time) }
  }
  stepBolts(g, dt)
  collide(g)
  if (p.alive === false && g.mode === 'flight') die(g)
  if (sk.host) runWaves(g)
  collectShots(g)
  sk.sendAt -= dt
  if (sk.net && sk.sendAt <= 0) { sk.sendAt = SEND; send(g) }
  // Clear the dead out of the list now and then, as the main game does.
  if (g.ships.length > 40 || Math.random() < dt) g.ships = g.ships.filter((e) => e.alive || e === p)
  objective(g)
  tickComms(g, dt)
}

function die(g) {
  const sk = g.skirmish
  g.mode = 'dead'
  g.deadAt = g.real
  sk.deadUntil = g.real + 5
  g.stats.deaths++
  if (sk.host) loseLife(g, sk.name)
}
function loseLife(g, who) {
  const sk = g.skirmish
  sk.lives = Math.max(0, sk.lives - 1)
  g.say('control', sk.lives ? `${who} is down. ${sk.lives} ${sk.lives === 1 ? 'ship' : 'ships'} left in reserve.` : `${who} is down. That was the last ship.`, 4)
  if (!sk.lives) endRun(g)
}
function comeBack(g) {
  const sk = g.skirmish
  const old = g.player
  g.player = playerShip(sk.hull, g.ship.up, 1)
  g.player.id = old.id
  place(g, g.player, sk.slot)
  g.ships = g.ships.filter((e) => e !== old)
  g.ships.push(g.player)
  g.mode = 'flight'
}
function endRun(g) {
  const sk = g.skirmish
  sk.state = 'over'
  sk.over = { wave: sk.wave, score: sk.score }
  try {
    const best = JSON.parse(globalThis.localStorage?.getItem('pz-skirmish-best') ?? 'null') ?? {}
    if (!best[sk.arena] || sk.score > best[sk.arena].score) { best[sk.arena] = { score: sk.score, wave: sk.wave }; globalThis.localStorage?.setItem('pz-skirmish-best', JSON.stringify(best)) }
  } catch { /* fine */ }
  g.emit({ type: 'skirmish-over', score: sk.score, wave: sk.wave })
}
export function bestRuns() {
  try { return JSON.parse(globalThis.localStorage?.getItem('pz-skirmish-best') ?? 'null') ?? {} } catch { return {} }
}

/* ------------------------------------------------------------------ *
 * Waves and wingmates (the host)
 * ------------------------------------------------------------------ */

const hostiles = (g) => g.ships.filter((e) => e.alive && e.team === 'hollow')

function runWaves(g) {
  const sk = g.skirmish
  if (sk.state === 'over') return
  if (sk.state === 'break') {
    if (g.time >= sk.breakUntil) startWave(g)
    return
  }
  if (!hostiles(g).length) {
    const bonus = 250 * sk.wave
    sk.score += bonus
    sk.state = 'break'
    sk.breakUntil = g.time + 9
    sk.healed = sk.wave
    heal(g)
    syncBots(g)
    g.say('control', `Wave ${sk.wave} cleared. Plus ${bonus}. Shields are back; the next one is coming.`, 4.5)
    g.emit({ type: 'wave-clear', wave: sk.wave })
  }
}

function startWave(g) {
  const sk = g.skirmish
  sk.wave++
  sk.state = 'fight'
  const n = Math.min(12, 3 + Math.round(sk.wave * 1.3))
  const skill = Math.min(0.78, 0.42 + sk.wave * 0.035)
  // From a different side every wave.
  const a = sk.wave * 2.3
  const at = new THREE.Vector3(Math.cos(a) * 6500, (sk.wave % 3 - 1) * 900, Math.sin(a) * 6500)
  const list = spawnRaiders(g, n, at, 'wave', { mode: 'attack', skill, range: 20000 })
  const ceres = sk.wave >= 4
  list.forEach((e, i) => { e.label = ceres && i % 2 ? 'Ceres strike craft' : 'Hollow raider'; e.ai.home = 'attack' })
  if (sk.wave % 3 === 0) {
    const ace = spawnRaiders(g, 1, at.clone().add(new THREE.Vector3(0, 400, 600)), 'wave', { hull: 'warden', mode: 'attack', skill: Math.min(0.8, skill + 0.1), range: 20000, brave: true, label: 'Hollow ace' })[0]
    ace.ai.home = 'attack'
  }
  // Spread their attention over the whole squadron, not just the host.
  const targets = g.ships.filter((e) => e.alive && (e === g.player || e.team === 'ally'))
  hostiles(g).forEach((e, i) => { if (targets.length) e.ai.target = targets[i % targets.length].id })
  g.say('control', `Wave ${sk.wave}: ${n}${sk.wave % 3 === 0 ? ' and an ace' : ''}, bearing ${Math.round((a * 180 / Math.PI) % 360)}.`, 4)
  g.emit({ type: 'wave', wave: sk.wave })
}

function heal(g) {
  const p = g.player
  if (p.alive) { p.shield = p.stats.shield; p.hull = Math.min(p.stats.hull, p.hull + p.stats.hull * 0.35) }
  for (const e of g.ships) if (e.team === 'ally' && !e.puppet && e.alive) { e.shield = e.stats.shield; e.hull = Math.min(e.stats.hull, e.hull + e.stats.hull * 0.35) }
}

/** Wingmates fill the squadron's empty seats; a friend who joins takes one. */
function syncBots(g) {
  const sk = g.skirmish
  const humans = 1 + sk.remote.size
  const want = Math.max(0, SQUAD - humans)
  const bots = g.ships.filter((e) => e.bot && e.alive)
  for (const b of bots.slice(want)) { b.alive = false; b.silent = true }
  for (let i = bots.length; i < want; i++) {
    const name = BOTS[i % BOTS.length]
    const e = makeShip('wing', 'ally', shipStats('wing'), g.player.pos.clone().add(new THREE.Vector3(-120 + i * 120, 60, 260)))
    // Wingmates are good, not heroes: they cover you, and leave you the fight.
    e.ai = { mode: 'escort', slot: i, home: 'escort', skill: 0.5 }
    e.stats = { ...e.stats, damage: e.stats.damage * 0.6 }
    e.label = `Wingmate ${name}`
    e.bot = true
    e.q.copy(g.player.q)
    g.ships.push(e)
  }
}

/* ------------------------------------------------------------------ *
 * Hits, kills and score
 * ------------------------------------------------------------------ */

function onHit(g, e, byId, byTeam, amount) {
  const sk = g.skirmish
  // A pilot's machine reports its hits on the host's enemies.
  if (e.puppet && e.team === 'hollow' && byTeam === 'player' && byId === g.player.id && sk.net) sk.net.broadcast('h', { e: e.netId, d: amount, by: sk.me })
}
function onKill(g, e, byId) {
  const sk = g.skirmish
  if (e.team !== 'hollow' || !sk.host) return
  sk.score += e.kind === 'warden' ? 600 : 100
  if (byId === g.player.id) { sk.myKills++; g.stats.kills++ }
  const remote = [...sk.remote.values()].find((r) => r.ship.id === byId)
  if (remote && sk.net) sk.net.broadcast('k', { to: remote.id, score: e.kind === 'warden' ? 600 : 100 })
}

/* ------------------------------------------------------------------ *
 * The network
 * ------------------------------------------------------------------ */

const r1 = (x) => Math.round(x * 10) / 10

/** Shots this machine is the authority for, gathered from this step's events. */
function collectShots(g) {
  const sk = g.skirmish
  if (!sk.net) return
  const b = g.bolts
  for (const ev of g.events) {
    if (ev.n <= sk.seenEv || ev.type !== 'fire') continue
    const e = g.byId(ev.ship)
    if (!e || e.puppet || (e !== g.player && !sk.host)) continue
    const i = ev.bolt
    sk.out.push([e === g.player ? 0 : 1, r1(b.x[i]), r1(b.y[i]), r1(b.z[i]), Math.round(b.vx[i]), Math.round(b.vy[i]), Math.round(b.vz[i]), r1(b.damage[i]), b.team[i] === 'hollow' ? 1 : 0])
  }
  sk.seenEv = g.evN
}


function send(g) {
  const sk = g.skirmish, p = g.player
  const shots = sk.out.splice(0, 40)
  const me = { id: sk.me, n: sk.name, su: sk.suit, hu: sk.hull, a: g.mode !== 'dead' ? 1 : 0, s: shipState(p), k: sk.myKills }
  if (sk.host) {
    const world = g.ships.filter((e) => e.alive && !e.puppet && e !== p).map((e) => [e.id, e.kind, e.team, e.label, ...shipState(e)])
    sk.net.broadcast('snap', { me, w: sk.wave, sc: sk.score, l: sk.lives, st: sk.state, bu: Math.max(0, sk.breakUntil - g.time), hl: sk.healed ?? 0, e: world, f: shots, ar: sk.arena })
  } else sk.net.broadcast('p', { me, f: shots })
}

function receive(g, ev, msg) {
  const sk = g.skirmish
  if (!msg) return
  if (ev === 'p' || ev === 'snap') {
    pilotFrom(g, msg.me)
    for (const f of msg.f ?? []) {
      // A pilot's shots are pictures here (their own machine reports hits);
      // the host's enemy shots are real, and can hit you.
      const real = f[8] === 1 && !sk.host
      spawnBolt(g, f[1], f[2], f[3], f[4], f[5], f[6], real ? f[7] : 0, -1, f[8] ? 'hollow' : 'ally')
    }
  }
  if (ev === 'snap' && !sk.host) { sk.lastSnap = g.real; worldFrom(g, msg) }
  if (ev === 'h' && sk.host) {
    const e = g.byId(msg.e)
    const r = sk.remote.get(msg.by)
    if (e && e.alive) damage(g, e, Math.min(40, Number(msg.d) || 0), r?.ship.id ?? -1, 'player')
  }
  // The host flew again: follow them into the new run.
  if (ev === 'start' && !sk.host) sk.restart = msg.arena ?? sk.arena
  if (ev === 'k' && msg.to === sk.me) { sk.myKills++; g.stats.kills++; g.emit({ type: 'kill-credit' }) }
}

/** Another pilot's ship, as they last reported it. */
function pilotFrom(g, m) {
  const sk = g.skirmish
  if (!m?.id || m.id === sk.me) return
  let r = sk.remote.get(m.id)
  if (!r || !r.ship.alive && m.a) {
    if (r) g.ships = g.ships.filter((e) => e !== r.ship)
    const ship = makeShip(m.hu ?? 'kestrel', 'ally', shipStats(m.hu ?? 'kestrel'), new THREE.Vector3(m.s[0], m.s[1], m.s[2]))
    ship.puppet = true; ship.remote = true; ship.label = m.n; ship.suit = m.su
    const fresh = !r
    r = { id: m.id, ship, name: m.n, alive: true, at: g.real }
    sk.remote.set(m.id, r)
    g.ships.push(ship)
    if (fresh) { g.say('control', `${m.n} has joined the squadron.`, 3); if (sk.host) syncBots(g) }
  }
  r.at = g.real
  r.kills = m.k
  r.hull = m.s[10]
  setNet(r.ship, m.s, g.real)
  if (r.alive && !m.a) { r.alive = false; r.ship.alive = false; g.emit({ type: 'explode', ship: r.ship.id, x: r.ship.pos.x, y: r.ship.pos.y, z: r.ship.pos.z, size: r.ship.radius }); if (sk.host) loseLife(g, m.n) }
  if (!r.alive && m.a) r.alive = true
}

/** The host's world, on a pilot's machine: enemies and wingmates as puppets. */
function worldFrom(g, m) {
  const sk = g.skirmish
  sk.wave = m.w; sk.score = m.sc; sk.lives = m.l; sk.breakUntil = g.time + (m.bu ?? 0)
  if (m.hl && m.hl !== sk.healed) { sk.healed = m.hl; heal(g) }
  if (m.st === 'over' && sk.state !== 'over') { sk.state = 'over'; sk.over = { wave: m.w, score: m.sc }; g.emit({ type: 'skirmish-over', score: m.sc, wave: m.w }) } else if (m.st !== 'over') sk.state = m.st
  const seen = new Set()
  for (const row of m.e ?? []) {
    const [id, kind, team, label] = row
    seen.add(id)
    let e = sk.puppets.get(id)
    if (!e) {
      e = makeShip(kind, team, shipStats(kind), new THREE.Vector3(row[4], row[5], row[6]))
      e.puppet = true; e.netId = id; e.label = label
      sk.puppets.set(id, e)
      g.ships.push(e)
    }
    setNet(e, row.slice(4), g.real)
  }
  for (const [id, e] of sk.puppets) {
    if (seen.has(id)) continue
    if (e.alive && e.team === 'hollow') g.emit({ type: 'explode', ship: e.id, x: e.pos.x, y: e.pos.y, z: e.pos.z, size: e.radius })
    e.alive = false
    sk.puppets.delete(id)
  }
}

/** Pilots who stop reporting have left. */
export function pruneRemote(g) {
  const sk = g.skirmish
  for (const [id, r] of sk.remote) if (g.real - r.at > 6) { r.ship.alive = false; sk.remote.delete(id); g.say('control', `${r.name} has left the squadron.`, 3); if (sk.host) syncBots(g) }
}

function objective(g) {
  const sk = g.skirmish
  if (Math.random() < 0.02) pruneRemote(g)
  // A squadron whose host has gone quiet is over.
  if (!sk.host && sk.state !== 'over' && g.real - (sk.lastSnap ?? g.real) > 10) { sk.state = 'over'; sk.over = { wave: sk.wave, score: sk.score, why: 'The host left the squadron.' }; g.emit({ type: 'skirmish-over' }) }
  if (!sk.host && sk.lastSnap == null) sk.lastSnap = g.real
  const left = g.ships.filter((e) => e.alive && e.team === 'hollow').length
  const text = sk.state === 'over' ? 'The squadron is out of ships.' : sk.state === 'break' ? `Wave ${sk.wave + 1} in ${Math.max(0, Math.ceil(sk.breakUntil - g.time))} s. Form up, and use [boost] to reposition.` : `Wave ${sk.wave}: destroy ${left} ${left === 1 ? 'hostile' : 'hostiles'}. [target] picks the next; [barrel] dodges.`
  const t = g.target != null ? g.byId(g.target) : null
  g.objective = { text, mission: 'Skirmish', ship: t?.alive ? t.id : g.ships.find((e) => e.alive && e.team === 'hollow')?.id ?? null }
  g.prompt = null
}
