import * as THREE from 'three'
import { PLACES, STATIONS, ARRIVAL, RACE_RINGS, driftRocks, BODIES } from './world.js'
import { HULLS, shipStats, UPGRADES } from './ships.js'
import { makeShip, playerShip, stepShip, steerToward, clamp, barrelRoll } from './flight.js'
import { makeBolts, stepBolts, fire, leadPoint } from './combat.js'
import { stepAI, hostile } from './ai.js'
import { followNet } from '../net/puppet.js'
import { addHeat, stepHeat, stepScans, inhibited, dockAllowed, clearHeat } from './heat.js'
import { jobBoard, GOODS, FUEL_PER_KMS, REPAIR_PER_HP, buyPrice, sellPrice } from './economy.js'
import { storyTick, storyEvent, storyObjective, storyFail, storyOnLoad } from './story.js'

/**
 * The game: one object holding everything, stepped at a fixed 60 Hz.
 *
 * What is saved is small (who you are, what you own, where you docked last,
 * the clock, the story and your jobs); everything in the sky is rebuilt from
 * it when a place loads. A save always resumes docked at your last station,
 * the way a safehouse works.
 */
export const STEP = 1 / 60
/** The game clock's zero: 06:00 UTC, 2 April 2091. */
export const EPOCH = Date.UTC(2091, 3, 2, 6, 0)
export const SAVE_KEY = 'pz-game-v1'
export const MAX_JOBS = 3
/** Where a docked ship sits: just outside its station's bay. */
export const BERTH = 20
/** The docking and launch sequences, s: outside to the door, through it, the turntable; lift, then out. */
export const DOCK_T = { approach: 2.6, inside: 2.8, turn: 1.6 }, LAUNCH_T = { lift: 1.1, out: 3.3 }

const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _q = new THREE.Quaternion(), _m4 = new THREE.Matrix4()

/**
 * Where a transfer drops you: 4.2 km out from the place's centre, off the
 * station's port and square to 'up', so looking back at the station the
 * nearest world is the floor of the view rather than a wall beside it.
 */
export function arrivalPoint(g, out) {
  const up = worldUp(g, new THREE.Vector3())
  // In front of the station's port if there is one, else any side square to up.
  const port = g.stations[0]?.port.axis
  const side = port ? port.clone().addScaledVector(up, -port.dot(up)) : new THREE.Vector3(1, 0, 0).cross(up)
  if (side.lengthSq() < 0.1) side.set(0, 0, 1).cross(up)
  side.normalize()
  out.copy(side).multiplyScalar(ARRIVAL.length()).addScaledVector(up, 300)
  // Each pilot has a lane, so pilots arriving at once in the shared sky do not stack.
  const lane = laneOf(g)
  return out.addScaledVector(_lr.copy(side).cross(up).normalize(), lane.x * 240).addScaledVector(up, lane.y * 90)
}
const _lr = new THREE.Vector3()
/** A pilot's lane: a fixed offset, -1..1 each way, chosen once and kept in the save. */
export function laneOf(g) {
  const p = g.pilot ?? (g.pilot = {})
  if (!p.lane) p.lane = { x: Math.round((Math.random() * 2 - 1) * 100) / 100, y: Math.round((Math.random() * 2 - 1) * 100) / 100 }
  return p.lane
}

/** 'Up' at a place: away from the nearest world, so it is below you. */
export function worldUp(g, out) {
  let best = null, bestD = Infinity
  for (const b of BODIES) { const d = b.position.distanceTo(g.anchor) - b.radius; if (d < bestD) { bestD = d; best = b } }
  return out.copy(g.anchor).sub(best.position).normalize()
}

export function newSave(name, suit = 'hearth') {
  return {
    version: 1, pilot: { name: String(name || 'Pilot').slice(0, 24), suit, licences: [], lane: { x: Math.round((Math.random() * 2 - 1) * 100) / 100, y: Math.round((Math.random() * 2 - 1) * 100) / 100 } },
    credits: 2500, debt: 40000,
    ship: { hull: 'kestrel', up: {}, hp: 1, prop: HULLS.kestrel.tank, cargo: {} },
    home: 'hearth', time: 0, heat: 0,
    story: { active: 'arrival', step: 0, done: [], choice: null, offered: [] },
    jobs: [], flags: {},
    stats: { kills: 0, earned: 0, jobs: 0, trips: 0, deaths: 0, fines: 0 },
  }
}

/** Saved data in, a running game out. */
export function startGame(save) {
  const g = {
    ...structuredClone(save),
    mode: 'docked', docked: save.home, place: STATIONS[save.home].place,
    anchor: new THREE.Vector3(), ships: [], bolts: makeBolts(), events: [], comms: [],
    stations: [], rocks: [], rings: [], canisters: [], beacons: [], markers: [],
    heat: { level: 0, lastSeen: 0 }, target: null, dest: null, prompt: null, objective: null,
    transfer: null, anim: null, race: null, surface: null, deadAt: 0, sinceSave: 0, real: 0,
  }
  g.evN = 0
  g.emit = (ev) => { ev.t = g.time; ev.n = ++g.evN; g.events.push(ev); if (g.events.length > 200) g.events.shift(); storyEvent(g, ev); jobsEvent(g, ev) }
  g.say = (who, text, dur = Math.min(9, 2.5 + text.length / 22)) => { g.comms.push({ who, text, dur, at: null }); g.emit({ type: 'comms', who }) }
  g.byId = (id) => { if (id == null) return null; for (const e of g.ships) if (e.id === id) return e; return null }
  g.onKill = (e, byId, byTeam) => onKill(g, e, byId, byTeam)
  g.onHit = (e, byId, byTeam) => onHit(g, e, byId, byTeam)
  g.__autosave = () => autosave(g)
  g.player = playerShip(g.ship.hull, g.ship.up, g.ship.hp)
  loadPlace(g, g.place)
  parkAtPort(g, g.docked)
  storyOnLoad(g)
  return g
}

export function saveData(g) {
  return {
    version: 1, pilot: g.pilot, credits: Math.round(g.credits), debt: g.debt,
    ship: { ...g.ship, hp: g.player.alive ? g.player.hull / g.player.stats.hull : 1 },
    home: g.home, time: g.time, heat: 0,
    story: g.story, jobs: g.jobs, flags: g.flags, stats: g.stats,
  }
}
export function validSave(s) {
  return Boolean(s && s.version === 1 && typeof s.pilot?.name === 'string' && Number.isFinite(s.credits) && HULLS[s.ship?.hull] && STATIONS[s.home] && Number.isFinite(s.time))
}

/* ------------------------------------------------------------------ *
 * Places
 * ------------------------------------------------------------------ */

/** Build the sky round a place: its stations, rocks, rings, traffic and patrol. */
export function loadPlace(g, id, deep = null) {
  const place = deep ?? PLACES[id]
  g.place = id
  g.placeDef = place
  g.anchor.copy(place.anchor)
  g.ships = [g.player]
  g.bolts = makeBolts()
  g.stations = Object.values(STATIONS).filter((s) => s.place === id)
  g.rocks = id === 'drift' ? driftRocks() : []
  g.rings = id === 'harbor' ? RACE_RINGS : []
  g.canisters = []
  g.beacons = id === 'shackleton' ? [{ kind: 'descent', at: new THREE.Vector3(0, 0, 0), label: 'Descent corridor' }] : []
  g.markers = []
  g.target = null
  g.race = null
  g.traffic = { next: 2 }
  // The patrol: how much law each place has.
  const patrol = { hearth: 1, harbor: 2, gateway: 2, shackleton: 1, drift: 0 }[id] ?? 0
  for (let i = 0; i < patrol; i++) {
    const st = g.stations[0]
    const e = makeShip('cutter', 'compact', shipStats('cutter'), (st?.at ?? new THREE.Vector3()).clone().add(new THREE.Vector3(Math.cos(i * 2.1) * 2600, 200 * i, Math.sin(i * 2.1) * 2600)))
    e.ai = { mode: 'patrol', center: (st?.at ?? new THREE.Vector3()).clone(), radius: 2400 + 500 * i, home: 'patrol', skill: 0.6 }
    e.label = 'Compact cutter'
    g.ships.push(e)
  }
  if (id === 'drift' && !deep && Math.random() < 0.45 && !g.story.noAmbient) spawnRaiders(g, 2, randomPoint(6000, 9000), 'roam')
  for (const st of g.stations) for (let i = 0; i < 2; i++) spawnTraffic(g, st, i === 0)
  jobsOnLoad(g)
}

function randomPoint(r0, r1) {
  const a = Math.random() * Math.PI * 2, r = r0 + Math.random() * (r1 - r0)
  return new THREE.Vector3(Math.cos(a) * r, (Math.random() - 0.5) * 1200, Math.sin(a) * r)
}

export function spawnRaiders(g, n, at, tag, opts = {}) {
  const out = []
  for (let i = 0; i < n; i++) {
    const p = at.clone().add(new THREE.Vector3((i % 3 - 1) * 140, (i % 2) * 80, Math.floor(i / 3) * 160))
    const e = makeShip(opts.hull ?? 'raider', 'hollow', shipStats(opts.hull ?? 'raider'), p)
    e.label = opts.label ?? 'Hollow raider'
    e.tag = tag
    e.ai = { mode: opts.mode ?? 'patrol', center: at.clone(), radius: 900, home: 'patrol', skill: opts.skill ?? 0.45, range: opts.range ?? 6500, brave: opts.brave }
    _v.copy(g.player.pos).sub(p).normalize()
    e.q.setFromUnitVectors(new THREE.Vector3(0, 0, -1), _v)
    g.ships.push(e)
    out.push(e)
  }
  return out
}

/** A freighter going about its business: out of a station to the dark, or in. */
function spawnTraffic(g, st, outbound) {
  const port = st.port.at.clone(), axis = st.port.axis
  const far = port.clone().addScaledVector(axis, 14000).add(new THREE.Vector3((Math.random() - 0.5) * 9000, (Math.random() - 0.5) * 3000, (Math.random() - 0.5) * 9000))
  const from = outbound ? port.clone().addScaledVector(axis, 300) : far
  const to = outbound ? far : port.clone().addScaledVector(axis, 500)
  const e = makeShip('freighter', 'civil', shipStats('freighter'), from)
  _v.copy(to).sub(from).normalize()
  e.q.setFromUnitVectors(new THREE.Vector3(0, 0, -1), _v)
  e.label = ['Ceres Line hauler', 'Tycho ore barge', 'Harbor courier tender', 'Helios water tanker'][Math.floor(Math.random() * 4)]
  e.ai = { mode: 'route', points: [to], leg: 0, onEnd: 'despawn', speed: 0.6 }
  g.ships.push(e)
}

/* ------------------------------------------------------------------ *
 * Docking, launching, transfers
 * ------------------------------------------------------------------ */

/**
 * How a ship sits in a station's bay: nose out along the port, level with
 * the nearest world below, so the hangar's deck is a floor and the launch
 * leaves with the horizon square.
 */
const _bm = new THREE.Matrix4(), _bu = new THREE.Vector3(), _b0 = new THREE.Vector3()
export function berthQuat(g, st, out) {
  worldUp(g, _bu).addScaledVector(st.port.axis, -_bu.dot(st.port.axis))
  if (_bu.lengthSq() < 1e-3) _bu.set(0, 1, 0).addScaledVector(st.port.axis, -st.port.axis.y)
  _bm.lookAt(_b0, st.port.axis, _bu.normalize())
  return out.setFromRotationMatrix(_bm)
}

function parkAtPort(g, stationId) {
  const st = STATIONS[stationId], p = g.player
  // Held in the berth's clamps at the mouth of the bay.
  p.pos.copy(st.port.at).addScaledVector(st.port.axis, BERTH)
  p.vel.set(0, 0, 0); p.w.set(0, 0, 0); p.thrust = 0; p.boosting = false
  // Nose out of the bay, ready to launch.
  berthQuat(g, st, p.q)
  p.ctrl.throttle = 0
}

/** The station a ship could dock with now, if any: near its port and slow. */
export function dockable(g) {
  const p = g.player
  for (const st of g.stations) {
    const d = p.pos.distanceTo(st.port.at)
    if (d < 350 && p.vel.length() < 70) return st
  }
  return null
}

export function requestDock(g) {
  const st = dockable(g)
  if (!st || g.mode !== 'flight') return false
  if (!dockAllowed(g, st.id)) { g.say('control', `${st.name} control: docking refused while the Compact is after you.`, 4); g.emit({ type: 'denied' }); return false }
  g.mode = 'docking'
  g.anim = { t: 0, dur: DOCK_T.approach + DOCK_T.inside + DOCK_T.turn, st: st.id, from: g.player.pos.clone(), q0: g.player.q.clone() }
  g.emit({ type: 'dock-start', station: st.id })
  return true
}

export function launch(g) {
  if (g.mode !== 'docked') return false
  const st = STATIONS[g.docked]
  parkAtPort(g, g.docked)
  g.mode = 'launch'
  g.anim = { t: 0, dur: LAUNCH_T.lift + LAUNCH_T.out, st: st.id }
  g.docked = null
  g.emit({ type: 'launch', station: st.id })
  return true
}

/** Can the drive take you to `dest` now? Returns null if so, or the reason. */
export function transferBlock(g, dest) {
  if (!dest || dest === g.place) return 'Pick a destination on the map.'
  if (!PLACES[dest]) return 'Unknown destination.'
  if (g.mode !== 'flight') return 'Not while docked.'
  if (inhibited(g)) return 'Drive inhibited: a patrol ship is close.'
  for (const e of g.ships) if (e.alive && e.team === 'hollow' && e.pos.distanceTo(g.player.pos) < 3500) return 'Drive inhibited: hostiles nearby.'
  const { dv } = tripCost(g, dest)
  if (dv > g.ship.prop) return `Not enough propellant: ${(dv / 1000).toFixed(0)} km/s needed, ${(g.ship.prop / 1000).toFixed(0)} in the tank. Refuel at a station.`
  return null
}

/** Distance, ship time and delta-v from here to a place, for the map. */
export function tripCost(g, dest) {
  const from = (g.deep ?? PLACES[g.place]).anchor
  const D = from.distanceTo(PLACES[dest].anchor), a = g.player.stats.drive, T = 2 * Math.sqrt(D / a)
  return { D, T, dv: a * T }
}

/**
 * The drive: a brachistochrone at the hull's torch acceleration. Burn for
 * half the time toward the destination, flip, burn for the other half to
 * stop. Ship time is real physics; the game compresses it so that a trip
 * is 8 to 26 seconds at your desk, and the game clock moves on by the real
 * duration.
 */
export function startTransfer(g, dest) {
  const why = transferBlock(g, dest)
  if (why) { g.emit({ type: 'denied', why }); return why }
  const from = (g.deep ?? PLACES[g.place]).anchor.clone().add(g.player.pos)
  const to = PLACES[dest].anchor.clone().add(ARRIVAL)
  const a = g.player.stats.drive
  const D = from.distanceTo(to), T = 2 * Math.sqrt(D / a)
  const real = clamp(8 + 3.2 * Math.log2(Math.max(1, T / 1800)), 8, 26)
  g.ship.prop -= a * T
  g.transfer = { from, to, dest, D, T, a, real, t: 0, phase: 'align', dir: to.clone().sub(from).normalize(), fromPlace: g.place }
  g.mode = 'align'
  g.anim = { t: 0, dur: 2.6 }
  g.deep = null
  g.stats.trips++
  // The Hollow lie in wait on the lanes for anyone carrying something worth taking.
  const cargoValue = Object.entries(g.ship.cargo).reduce((n, [k, v]) => n + (GOODS[k]?.base ?? 300) * v, 0)
  if (!g.story.noInterdict && g.story.done.length >= 3 && (cargoValue > 2500 || g.ship.cargo.chips) && Math.random() < 0.18) g.transfer.ambushAt = 0.3 + Math.random() * 0.3
  g.emit({ type: 'transfer', dest, T })
  return null
}

/**
 * The flown burn. A torch drive's thrust line wanders (gimbal drift, uneven
 * propellant draw), and the pilot holds it on the line: any steering input
 * pushes the drift back. At the midpoint the pilot flips the ship; the
 * window is a few percent of the trip either side of halfway, and missing it
 * means the computer flips late. On arrival the flight is rated, and a good
 * burn gives back up to BURN_REFUND of the propellant it cost.
 */
export const BURN_REFUND = 0.12, FLIP_WINDOW = [0.44, 0.535]
function trimBurn(g, tr, dt, input) {
  const k = tr.trim ?? (tr.trim = { x: 0, y: 0, bx: (Math.random() - 0.5) * 0.5, by: (Math.random() - 0.5) * 0.5, err: 0, n: 0 })
  if (tr.phase === 'flipping') return
  k.x += ((Math.random() - 0.5) * 2.2 + k.bx) * dt
  k.y += ((Math.random() - 0.5) * 2.2 + k.by) * dt
  k.x = clamp(k.x - clamp(input?.burnX ?? 0, -1, 1) * 1.4 * dt, -1, 1)
  k.y = clamp(k.y - clamp(input?.burnY ?? 0, -1, 1) * 1.4 * dt, -1, 1)
  k.err += Math.hypot(k.x, k.y) * dt
  k.n += dt
}
/** Flip now, if it is time. */
export function flipBurn(g) {
  const tr = g.transfer
  if (!tr || g.mode !== 'transfer' || tr.phase !== 'burn') return false
  const f = Math.min(1, tr.t)
  if (f < FLIP_WINDOW[0]) { g.emit({ type: 'toast', text: 'Too early to flip: wait for the midpoint.' }); return false }
  tr.phase = 'brake'; tr.flipAt = f
  g.emit({ type: 'flip' })
  return true
}
function rateBurn(g, tr) {
  const k = tr.trim ?? { err: 0, n: 1 }
  const trim = clamp(1 - (k.err / Math.max(1e-6, k.n)) / 0.55, 0, 1)
  const flip = tr.autoFlip ? 0 : clamp(1 - Math.abs((tr.flipAt ?? 0.5) - 0.5) / 0.035, 0, 1)
  const score = 0.6 * trim + 0.4 * flip
  const grade = score >= 0.92 ? 'S' : score >= 0.78 ? 'A' : score >= 0.6 ? 'B' : score >= 0.35 ? 'C' : 'D'
  const back = Math.round(tr.a * tr.T * BURN_REFUND * score)
  g.ship.prop = Math.min(g.player.stats.tank ?? Infinity, g.ship.prop + back)
  g.lastBurn = { grade, score, trim, flip, back, pct: Math.round(BURN_REFUND * score * 100), auto: Boolean(tr.autoFlip) }
  g.emit({ type: 'burn-rated', ...g.lastBurn })
}

function stepTransfer(g, dt, input) {
  const tr = g.transfer, p = g.player
  if (g.mode === 'align') {
    // Turn to the burn direction (in local frame, which is the global frame's axes).
    steerToward(p, tr.dir, null, 3)
    p.ctrl.throttle = 0
    stepShip(p, dt, g.time)
    p.vel.multiplyScalar(0.96)
    g.anim.t += dt
    if (g.anim.t >= g.anim.dur) {
      g.mode = 'transfer'; tr.phase = 'burn'
      // Out of the place and into the dark: nothing local comes along.
      g.place = 'transit'; g.placeDef = { name: 'In transit', where: `Bound for ${PLACES[tr.dest].name}`, region: 1e12 }
      g.ships = [p]; g.stations = []; g.rocks = []; g.rings = []; g.beacons = []; g.canisters = []; g.markers = []; g.target = null
      g.emit({ type: 'burn' })
      p.q.setFromUnitVectors(new THREE.Vector3(0, 0, -1), tr.dir)
    }
    return
  }
  tr.t += dt / tr.real
  const f = Math.min(1, tr.t), tau = f * tr.T
  const s = tau < tr.T / 2 ? 0.5 * tr.a * tau * tau : tr.D - 0.5 * tr.a * (tr.T - tau) ** 2
  g.anchor.copy(tr.from).addScaledVector(tr.dir, s)
  p.pos.set(0, 0, 0); p.vel.copy(tr.dir).multiplyScalar(tau < tr.T / 2 ? tr.a * tau : tr.a * (tr.T - tau))
  g.time += tr.T * dt / tr.real - dt
  trimBurn(g, tr, dt, input)
  g.prompt = tr.phase === 'burn' && f >= FLIP_WINDOW[0] ? { action: 'dock', key: 'F', text: 'Flip' } : null
  // Miss the window and the computer flips for you, late.
  if (tr.phase === 'burn' && f >= FLIP_WINDOW[1]) { tr.phase = 'brake'; tr.flipAt = f; tr.autoFlip = true; g.emit({ type: 'flip' }); g.emit({ type: 'toast', text: 'Computer flip: you missed the window.' }) }
  // The flip: half a turn from the moment it was called, nose to the destination becoming tail to it.
  const flip = tr.flipAt == null ? 0 : clamp((f - tr.flipAt) / 0.05, 0, 1)
  _v.copy(tr.dir)
  p.q.setFromUnitVectors(new THREE.Vector3(0, 0, -1), _v)
  if (flip > 0) { _q.setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI * (flip * flip * (3 - 2 * flip))); p.q.multiply(_q) }
  // The wander, seen: the nose off the line by as much as the drift.
  if (tr.trim && flip === 0) { _q.setFromEuler(new THREE.Euler(tr.trim.y * 0.08, -tr.trim.x * 0.08, 0)); p.q.multiply(_q) }
  if (tr.ambushAt && f >= tr.ambushAt) return interdict(g)
  if (f >= 1) arrive(g)
}

function arrive(g) {
  const tr = g.transfer
  rateBurn(g, tr)
  g.transfer = null
  loadPlace(g, tr.dest)
  const p = g.player
  arrivalPoint(g, p.pos); p.vel.set(0, 0, 0); p.w.set(0, 0, 0)
  const look = g.stations[0]?.at ?? new THREE.Vector3()
  // Arrive the right way up: the nearest world below you, the station ahead.
  _m4.lookAt(p.pos, look, worldUp(g, _w))
  p.q.setFromRotationMatrix(_m4)
  p.ctrl.throttle = 0
  g.mode = 'flight'
  g.dest = null
  g.emit({ type: 'arrive', place: tr.dest })
}

/** Pulled out of the drive by the Hollow, in the dark between places. */
function interdict(g) {
  const tr = g.transfer
  g.transfer = null
  const anchor = g.anchor.clone()
  g.deep = { id: 'deep', name: 'Deep space', where: 'Between places', anchor, region: 25e3 }
  loadPlace(g, 'deep', g.deep)
  const p = g.player
  p.pos.set(0, 0, 0); p.vel.copy(tr.dir).multiplyScalar(120); p.w.set(0, 0, 0)
  g.mode = 'flight'
  g.dest = tr.dest
  // A refund for the trip not taken: the rest of the burn is still in the tank.
  g.ship.prop = Math.min(g.player.stats.tank ?? 1e9, g.ship.prop + tr.a * tr.T * 0.5)
  const n = 2 + Math.floor(Math.random() * 2)
  spawnRaiders(g, n, _v.copy(tr.dir).multiplyScalar(1600).add(new THREE.Vector3(300, 100, 0)), 'ambush', { mode: 'attack', skill: 0.5 })
  for (const e of g.ships) if (e.tag === 'ambush') e.ai.target = p.id
  g.say('hollow', 'Drop your cargo and we let you keep the ship. Maybe.', 4)
  g.emit({ type: 'interdicted' })
}

/* ------------------------------------------------------------------ *
 * The step
 * ------------------------------------------------------------------ */

/**
 * Advance by one fixed step. `input` is the controls object the interface
 * fills (see ui/controls.js): continuous axes, plus `actions`, a list of
 * one-shot commands consumed here.
 */
export function stepGame(g, input, dt = STEP) {
  // Another kind of game (a squadron skirmish) brings its own step.
  if (g.step) return g.step(g, input, dt)
  g.real += dt
  for (const a of input.actions.splice(0)) act(g, a, input)
  if (g.mode === 'docked' || g.mode === 'surface') { g.time += dt; storyTick(g, dt); objective(g); tickComms(g, dt); return }
  if (g.mode === 'dead') { g.time += dt; tickComms(g, dt); return }
  g.time += dt
  const p = g.player
  if (g.mode === 'align' || g.mode === 'transfer') { stepTransfer(g, dt, input); tickComms(g, dt); return }
  if (g.mode === 'docking' || g.mode === 'launch') { stepAnim(g, dt); stepNPCs(g, dt); tickComms(g, dt); return }

  // Flight.
  pilot(g, p, input, dt)
  stepNPCs(g, dt)
  stepShip(p, dt, g.time)
  stepBolts(g, dt)
  collide(g)
  pickups(g)
  stepRace(g)
  stepHeat(g, dt)
  stepScans(g, dt)
  upkeep(g, dt)
  storyTick(g, dt)
  jobsTick(g)
  prompt(g)
  objective(g)
  tickComms(g, dt)
  if (!p.alive && g.mode === 'flight') die(g)
}

export function pilot(g, p, input, dt) {
  const c = p.ctrl
  c.throttle = clamp(c.throttle + (input.throttleRate ?? 0) * dt * 0.8, -0.3, 1)
  if (input.throttleSet != null) { c.throttle = input.throttleSet; input.throttleSet = null }
  c.strafeX = input.strafeX ?? 0
  c.strafeY = input.strafeY ?? 0
  c.boost = Boolean(input.boost)
  if (input.aim) {
    steerToward(p, input.aim, null, 4)
    c.roll = input.roll ?? 0
  } else {
    c.pitch = input.pitch ?? 0; c.yaw = input.yaw ?? 0; c.roll = input.roll ?? 0
  }
  if (input.fire && p.alive) {
    const t = g.byId(g.target)
    let aimAt = null
    if (t && t.alive) { leadPoint(p, t, _w); aimAt = _w }
    fire(g, p, aimAt)
  }
}

export function stepNPCs(g, dt) {
  for (const e of g.ships) {
    if (e === g.player || !e.alive) continue
    // Another player's ship, flown on their machine: follow their reports.
    if (e.puppet) { followNet(e, dt); continue }
    stepAI(g, e, dt)
    stepShip(e, dt, g.time)
  }
}

const _qa = new THREE.Quaternion(), _qb2 = new THREE.Quaternion(), _up2 = new THREE.Vector3(), _door = new THREE.Vector3()
const smooth = (x) => { const f = clamp(x, 0, 1); return f * f * (3 - 2 * f) }
/**
 * Docking and launching, flown on rails. The bay sits at the berth, its
 * door 45 m out along the port axis (art/game-hangar). Docking: up to a
 * point off the door, in through it nose first, down onto the pad, and the
 * pad turns the ship to face out. Launching: lift off the pad, then out
 * through the door and away.
 */
function stepAnim(g, dt) {
  const a = g.anim, p = g.player, st = STATIONS[a.st]
  a.t += dt
  const berth = _v.copy(st.port.at).addScaledVector(st.port.axis, BERTH)
  berthQuat(g, st, _qb2)
  _up2.set(0, 1, 0).applyQuaternion(_qb2)
  p.vel.set(0, 0, 0)
  p.boosting = false
  if (g.mode === 'docking') {
    // The plume: a braking glow on the way in, cold once inside.
    p.thrust = a.t < DOCK_T.approach ? 0.25 : a.t < DOCK_T.approach + DOCK_T.inside ? 0.06 : 0
    const T = DOCK_T
    // Facing in: the berth's orientation turned half round its up axis.
    _qa.setFromAxisAngle(_up2, Math.PI).multiply(_qb2)
    _door.copy(berth).addScaledVector(st.port.axis, 140).addScaledVector(_up2, 6)
    if (a.t < T.approach) {
      const s = smooth(a.t / T.approach)
      p.pos.lerpVectors(a.from, _door, s)
      p.q.slerpQuaternions(a.q0, _qa, s)
    } else if (a.t < T.approach + T.inside) {
      const s = smooth((a.t - T.approach) / T.inside)
      p.pos.lerpVectors(_door, berth, s)
      p.q.copy(_qa)
    } else {
      // The turntable: half a turn about the deck's up, ending nose out.
      const s = smooth((a.t - T.approach - T.inside) / T.turn)
      p.pos.copy(berth)
      p.q.slerpQuaternions(_qa, _qb2, s)
    }
    if (a.t >= a.dur) {
      g.mode = 'docked'; g.docked = a.st; g.home = a.st; g.anim = null
      parkAtPort(g, a.st)
      g.emit({ type: 'dock', station: a.st })
      storyTick(g)
      autosave(g)
    }
  } else {
    const T = LAUNCH_T
    p.q.copy(_qb2)
    const lift = smooth(a.t / T.lift) * 2.2
    const s = Math.max(0, a.t - T.lift) / T.out
    // Out along the port axis, gathering speed: a quarter of the way in the first half.
    const out = 460 * s * s
    p.thrust = s > 0 ? 0.35 + 0.6 * s : 0.08
    p.pos.copy(berth).addScaledVector(_up2, lift).addScaledVector(st.port.axis, out)
    // Clear of the door, the ship eases into its own lane, so two pilots
    // launching together in the shared sky fan out instead of stacking.
    const lane = laneOf(g), k = smooth((out - 50) / 300)
    _lr.set(1, 0, 0).applyQuaternion(_qb2)
    p.pos.addScaledVector(_lr, lane.x * 80 * k).addScaledVector(_up2, lane.y * 35 * k)
    p.vel.copy(st.port.axis).multiplyScalar(s > 0 ? 920 * s / T.out : 0)
    if (a.t >= a.dur) { g.mode = 'flight'; g.anim = null; p.vel.copy(st.port.axis).multiplyScalar(120); p.ctrl.throttle = 0.15; g.emit({ type: 'undocked', station: a.st }) }
  }
}

/** One-shot commands from the interface. */
export function act(g, a, input) {
  const p = g.player
  switch (a) {
    case 'fa': if (g.mode === 'flight') { p.ctrl.fa = !p.ctrl.fa; g.emit({ type: 'fa', on: p.ctrl.fa }) } break
    case 'stop': input.throttleSet = 0; break
    case 'roll-left': case 'roll-right': if (g.mode === 'flight' && barrelRoll(p, a === 'roll-left' ? 1 : -1, g.time)) g.emit({ type: 'roll' }); break
    case 'dock': if (g.mode === 'transfer') flipBurn(g); else if (g.prompt?.action === 'dock') requestDock(g); else if (g.prompt?.action === 'descend') descend(g); break
    case 'target': cycleTarget(g); break
    case 'transfer': if (g.mode === 'flight') startTransfer(g, g.dest); break
    case 'launch': if (!g.cine) launch(g); break
    case 'respawn': if (g.mode === 'dead') respawn(g); break
  }
}

export function setDestination(g, dest) {
  g.dest = dest === g.place ? null : dest
  g.emit({ type: 'dest', dest: g.dest })
}

/** T: the nearest hostile, then the next, then anything in the sky. */
export function cycleTarget(g) {
  const p = g.player
  const list = g.ships.filter((e) => e !== p && e.alive).sort((a, b) => (hostile(g, a, p) ? 0 : 1) - (hostile(g, b, p) ? 0 : 1) || a.pos.distanceToSquared(p.pos) - b.pos.distanceToSquared(p.pos))
  if (!list.length) { g.target = null; return }
  const i = list.findIndex((e) => e.id === g.target)
  g.target = list[(i + 1) % list.length].id
  g.emit({ type: 'target', id: g.target })
}

/* ------------------------------------------------------------------ *
 * The world pushing back
 * ------------------------------------------------------------------ */

/** Station hulls and rocks are solid. Hitting them hurts, by the speed of impact. */
export function collide(g) {
  for (const e of g.ships) {
    if (!e.alive) continue
    for (const st of g.stations) for (const c of colliders(st)) solid(g, e, c.at, c.r)
    for (const r of g.rocks) if (Math.abs(r.at.x - e.pos.x) < r.radius + 60 && Math.abs(r.at.z - e.pos.z) < r.radius + 60) solid(g, e, r.at, r.radius * 0.92)
  }
}
const COLLIDERS = new Map()
/** A station as a few spheres: the hub, and a ring of them for the torus. */
function colliders(st) {
  if (COLLIDERS.has(st.id)) return COLLIDERS.get(st.id)
  const out = [{ at: st.at.clone(), r: st.model === 'hearth' ? 150 : st.radius * 0.6 }]
  if (st.model === 'hearth') for (let i = 0; i < 24; i++) { const a = i / 24 * Math.PI * 2; out.push({ at: st.at.clone().add(new THREE.Vector3(Math.cos(a) * 380, Math.sin(a) * 380, 0)), r: 55 }) }
  if (st.model === 'shackle') out[0].r = st.radius * 0.85
  COLLIDERS.set(st.id, out)
  return out
}
function solid(g, e, at, r) {
  _v.copy(e.pos).sub(at)
  const d = _v.length(), min = r + e.radius
  if (d >= min || d === 0) return
  _v.divideScalar(d)
  e.pos.copy(at).addScaledVector(_v, min)
  const into = e.vel.dot(_v)
  if (into < 0) {
    e.vel.addScaledVector(_v, -1.6 * into)
    const hurt = (-into - 25) * 2.2
    if (hurt > 0) { e.hitAt = g.time; e.shield = Math.max(0, e.shield - hurt); e.hull -= Math.max(0, hurt - e.shield); g.emit({ type: 'bump', ship: e.id, hard: hurt > 20, player: e.kind === 'player' }); if (e.hull <= 0 && e.alive) { e.alive = false; g.emit({ type: 'explode', ship: e.id, x: e.pos.x, y: e.pos.y, z: e.pos.z, size: e.radius, player: e.kind === 'player' }) } }
  }
}

/** Canisters scoop up when you pass within 30 m below 120 m/s. */
function pickups(g) {
  const p = g.player
  for (const c of g.canisters) {
    if (c.taken || p.pos.distanceTo(c.at) > 30 + p.radius) continue
    if (p.vel.length() > 120) { if (!c.warned) { c.warned = true; g.emit({ type: 'toast', text: 'Too fast to scoop: under 120 m/s.' }) } continue }
    const free = p.stats.cargo - cargoUsed(g)
    if (free <= 0) { if (!c.warned) { c.warned = true; g.emit({ type: 'toast', text: 'Hold full.' }) } continue }
    c.taken = true
    g.ship.cargo.salvage = (g.ship.cargo.salvage ?? 0) + 1
    g.emit({ type: 'pickup', id: c.id, tag: c.tag })
  }
}
export const cargoUsed = (g) => Object.values(g.ship.cargo).reduce((n, v) => n + v, 0)

/** The Harbor Loop, when a race is on: rings in order, against the clock. */
function stepRace(g) {
  const r = g.race
  if (!r || g.place !== 'harbor') return
  const p = g.player
  const ring = g.rings[r.next]
  _v.copy(p.pos).sub(ring)
  if (_v.length() < 70) {
    if (r.next === 0 && r.start == null) { r.start = g.time; g.emit({ type: 'race-start' }) }
    r.next++
    g.emit({ type: 'ring', n: r.next })
    if (r.next >= g.rings.length) {
      const time = g.time - r.start
      g.emit({ type: 'race-done', time })
      g.race = null
    }
  }
}
export function startRace(g) { g.race = { next: 0, start: null }; g.emit({ type: 'race-ready' }) }

/** Traffic keeps coming; the dead are cleared; the region has an edge. */
function upkeep(g, dt) {
  g.traffic.next -= dt
  if (g.traffic.next <= 0 && g.stations.length) {
    g.traffic.next = 25 + Math.random() * 20
    const civil = g.ships.filter((e) => e.team === 'civil' && e.alive).length
    if (civil < 3) spawnTraffic(g, g.stations[Math.floor(Math.random() * g.stations.length)], Math.random() < 0.5)
  }
  for (let i = g.ships.length - 1; i >= 0; i--) {
    const e = g.ships[i]
    if (!e.alive && e !== g.player && (e.silent || g.time - (e.diedAt ?? (e.diedAt = g.time)) > 2)) g.ships.splice(i, 1)
  }
  const p = g.player, R = (g.placeDef?.region ?? 30e3)
  const d = p.pos.length()
  if (d > R) {
    // The edge of the map: beyond here is the drive's business, not the thrusters'.
    _v.copy(p.pos).divideScalar(d)
    const out = p.vel.dot(_v)
    if (out > 0) p.vel.addScaledVector(_v, -out * Math.min(1, dt * 2))
    if (!g.edgeWarned || g.time - g.edgeWarned > 8) { g.edgeWarned = g.time; g.emit({ type: 'toast', text: 'Edge of the area. Pick a destination on the map (M) and transfer (J).' }) }
  }
  g.sinceSave += dt
}

function prompt(g) {
  const p = g.player
  g.prompt = null
  const st = dockable(g)
  if (st) { g.prompt = { action: 'dock', key: 'F', text: dockAllowed(g, st.id) ? `Dock at ${st.name}` : `${st.name} will not take you while you are hot` }; return }
  for (const b of g.beacons) if (b.kind === 'descent' && p.pos.distanceTo(b.at) < 900) { g.prompt = { action: 'descend', key: 'F', text: 'Descend to the surface' }; return }
  if (g.dest && g.dest !== g.place) {
    const why = transferBlock(g, g.dest)
    g.prompt = { action: 'transfer', key: 'J', text: why ?? `Transfer to ${PLACES[g.dest].name}`, blocked: Boolean(why) }
  }
}

function objective(g) {
  g.objective = storyObjective(g) ?? jobObjective(g)
}

export function tickComms(g, dt) {
  const c = g.comms[0]
  // Nobody talks over a cutscene; the line waits for it.
  if (!c || g.cine) return
  if (c.at == null) c.at = g.real
  if (g.real - c.at > c.dur) g.comms.shift()
}

/* ------------------------------------------------------------------ *
 * Death, and the way back
 * ------------------------------------------------------------------ */

function die(g) {
  g.mode = 'dead'
  g.deadAt = g.real
  g.stats.deaths++
  storyFail(g, 'Your ship was destroyed.')
  for (const j of g.jobs) if (j.type === 'haul' || j.type === 'smuggle') j.failed = 'Cargo lost with the ship.'
  g.jobs = g.jobs.filter((j) => !j.failed)
}

/** Back at your last station, the insurer's cut taken. */
export function respawn(g) {
  const cut = Math.min(g.credits, Math.max(500, Math.round(g.credits * 0.1)))
  g.credits -= cut
  g.ship.cargo = {}
  g.ship.hp = 1
  g.player = playerShip(g.ship.hull, g.ship.up, 1)
  g.heat.level = 0; g.heat.hail = null
  g.deep = null
  loadPlace(g, STATIONS[g.home].place)
  parkAtPort(g, g.home)
  g.mode = 'docked'; g.docked = g.home
  g.emit({ type: 'respawn', cut })
  autosave(g)
}

/* ------------------------------------------------------------------ *
 * The surface: Shackleton's descents hand over to the landing game
 * ------------------------------------------------------------------ */

export function descend(g) {
  if (g.mode !== 'flight' || g.place !== 'shackleton') return false
  g.mode = 'surface'
  g.surface = { started: g.time }
  g.emit({ type: 'descend' })
  return true
}
/** The landing game's result (or null if abandoned), back into the game. */
export function returnFromSurface(g, result) {
  g.mode = 'flight'
  const p = g.player
  p.pos.set(0, 200, 1500); p.vel.set(0, 0, 0)
  // An hour on the surface, in game time.
  g.time += 3600
  g.emit({ type: 'surface-done', result })
  g.surface = null
}

/* ------------------------------------------------------------------ *
 * Combat consequences
 * ------------------------------------------------------------------ */

function onHit(g, e, byId, byTeam) {
  if (byTeam !== 'player') return
  if (e.team === 'compact') addHeat(g, e.ai?.passive ? 1 : 2, 'assault')
  if (e.team === 'civil') addHeat(g, 1, 'assault')
  // Shoot at someone, and they shoot back.
  if (e.ai && e.team !== 'civil' && e.ai.mode !== 'attack' && e.ai.mode !== 'flee') { e.ai.mode = 'attack'; e.ai.target = g.player.id }
}
function onKill(g, e, byId, byTeam) {
  e.diedAt = g.time
  if (byTeam !== 'player') return
  g.stats.kills++
  // Every two patrol ships destroyed is another chevron, from two: a rampage reaches five.
  if (e.team === 'compact') { g.heat.kills = (g.heat.kills ?? 0) + 1; addHeat(g, Math.min(5, 2 + Math.floor(g.heat.kills / 2)), 'murder') }
  if (e.team === 'civil') { g.heat.kills = (g.heat.kills ?? 0) + 1; addHeat(g, Math.min(5, 2 + Math.floor(g.heat.kills / 2)), 'murder') }
  if (e.team === 'hollow') {
    const bounty = e.stats.bounty ?? 0
    // Bounties are paid on proof at a lawful station; loose ones are credited now.
    if (bounty && !g.jobs.some((j) => j.type === 'bounty')) { g.credits += Math.round(bounty * 0.4); g.stats.earned += Math.round(bounty * 0.4); g.emit({ type: 'paid', amount: Math.round(bounty * 0.4), why: 'bounty' }) }
    // Raiders carry things.
    if (Math.random() < 0.5) g.canisters.push({ id: `drop-${e.id}`, at: e.pos.clone(), tag: 'loot' })
  }
}

/* ------------------------------------------------------------------ *
 * Jobs
 * ------------------------------------------------------------------ */

export function offers(g, station) {
  const taken = new Set([...g.jobs.map((j) => j.id), ...(g.flags.jobsDone ?? [])])
  return jobBoard(station, g.time).filter((j) => !taken.has(j.id))
}

export function acceptJob(g, job) {
  if (g.jobs.length >= MAX_JOBS) return 'You can carry three jobs at once.'
  if (job.n && (job.type === 'haul' || job.type === 'smuggle')) {
    const free = g.player.stats.cargo - cargoUsed(g)
    if (free < job.n) return `Needs ${job.n} free hold; you have ${free}.`
    g.ship.cargo[job.good] = (g.ship.cargo[job.good] ?? 0) + job.n
  }
  g.jobs.push({ ...job, kills: 0, got: 0, at: g.time })
  if (job.type === 'race') g.flags.raceArmed = true
  g.emit({ type: 'job-accepted', id: job.id })
  autosave(g)
  return null
}
export function abandonJob(g, id) {
  const j = g.jobs.find((x) => x.id === id)
  if (!j) return
  if ((j.type === 'haul' || j.type === 'smuggle') && g.ship.cargo[j.good]) g.ship.cargo[j.good] = Math.max(0, g.ship.cargo[j.good] - j.n)
  g.jobs = g.jobs.filter((x) => x.id !== id)
}

function jobsOnLoad(g) {
  for (const j of g.jobs) {
    if (j.place !== g.place) continue
    if (j.type === 'salvage') {
      const left = j.n - j.got
      const c = randomPoint(3000, 7000)
      for (let i = 0; i < left; i++) g.canisters.push({ id: `${j.id}-${i}`, at: c.clone().add(new THREE.Vector3((Math.random() - 0.5) * 1400, (Math.random() - 0.5) * 500, (Math.random() - 0.5) * 1400)), tag: j.id })
      if (Math.random() < 0.6) spawnRaiders(g, 2, c.clone().add(new THREE.Vector3(1500, 300, 0)), 'guard')
      j.zone = c
    }
    if (j.type === 'bounty') {
      const c = randomPoint(5000, 9000)
      spawnRaiders(g, j.n - j.kills, c, j.id, { skill: 0.5 })
      j.zone = c
    }
    if (j.type === 'race') startRace(g)
  }
}

function jobsEvent(g, ev) {
  if (!g.jobs) return
  if (ev.type === 'explode' && ev.byPlayer) {
    const e = g.byId(ev.ship)
    if (e && e.team === 'hollow') for (const j of g.jobs) if (j.type === 'bounty' && j.kills < j.n) { j.kills++; break }
  }
  if (ev.type === 'pickup') for (const j of g.jobs) if (j.type === 'salvage' && ev.tag === j.id) j.got++
  if (ev.type === 'race-done') for (const j of g.jobs) if (j.type === 'race') j.best = Math.min(j.best ?? Infinity, ev.time)
  if (ev.type === 'surface-done') for (const j of g.jobs) if (j.type === 'survey' && ev.result) j.stars = Math.max(j.stars ?? 0, ev.result.stars ?? 0)
  if (ev.type === 'dock') settleJobs(g, ev.station)
}

/** Paid on docking where the job ends, if it is done. */
function settleJobs(g, station) {
  for (const j of [...g.jobs]) {
    if (j.to !== station) continue
    let pay = 0
    const c = g.ship.cargo
    if (j.type === 'courier') pay = j.reward
    if (j.type === 'haul' && (c[j.good] ?? 0) >= j.n) { c[j.good] -= j.n; pay = j.reward }
    if (j.type === 'smuggle' && (c.chips ?? 0) >= j.n) { c.chips -= j.n; pay = j.reward }
    if (j.type === 'salvage' && (c.salvage ?? 0) >= j.n) { c.salvage -= j.n; pay = j.reward }
    if (j.type === 'bounty' && j.kills >= j.n) pay = j.reward
    if (j.type === 'race' && j.best != null && j.best <= j.par) pay = j.best <= 100 ? j.reward * 2 : j.reward
    if (j.type === 'survey' && j.stars) pay = Math.round(j.reward * (0.5 + 0.5 * j.stars))
    if (!pay) continue
    for (const k of Object.keys(c)) if (!c[k]) delete c[k]
    if (g.time > j.deadline) pay = Math.round(pay * 0.5)
    g.credits += pay; g.stats.earned += pay; g.stats.jobs++
    g.jobs = g.jobs.filter((x) => x !== j)
    g.flags.jobsDone = [...(g.flags.jobsDone ?? []).slice(-40), j.id]
    g.emit({ type: 'paid', amount: pay, why: j.title })
  }
}

function jobsTick(g) {
  for (const j of g.jobs) if (!j.late && g.time > j.deadline) { j.late = true; g.emit({ type: 'toast', text: `${j.title}: past the deadline. Half pay.` }) }
}

/** The next step of the tracked job, for the HUD's objective line. */
function jobObjective(g) {
  const j = g.jobs.find((x) => x.id === g.track) ?? g.jobs[0]
  if (!j) return null
  const to = STATIONS[j.to]
  const goPlace = (place, then) => (g.place !== place ? { text: `${j.title}: transfer to ${PLACES[place].name}`, place } : then)
  const dock = { text: `${j.title}: dock at ${to.name}`, at: to.port.at, place: to.place }
  switch (j.type) {
    case 'courier': case 'haul': case 'smuggle': return goPlace(to.place, dock)
    case 'salvage': return j.got < j.n ? goPlace('drift', { text: `Salvage: ${j.got} of ${j.n} canisters`, at: nearestCanister(g, j.id) }) : goPlace(to.place, dock)
    case 'bounty': return j.kills < j.n ? goPlace('drift', { text: `Bounty: ${j.kills} of ${j.n} raiders`, at: j.zone, ship: nearestTag(g, j.id) }) : goPlace(to.place, dock)
    case 'race': return j.best == null || j.best > j.par ? goPlace('harbor', { text: g.race?.start != null ? `Harbor Loop: ring ${g.race.next + 1} of ${g.rings.length}` : 'Harbor Loop: fly through the first ring to start', at: g.rings[g.race?.next ?? 0] }) : goPlace(to.place, dock)
    case 'survey': return !j.stars ? goPlace('shackleton', { text: 'Survey: fly into the descent corridor and press F', at: new THREE.Vector3() }) : goPlace(to.place, dock)
  }
  return null
}
const nearestCanister = (g, tag) => g.canisters.find((c) => !c.taken && c.tag === tag)?.at ?? null
const nearestTag = (g, tag) => g.ships.find((e) => e.alive && e.tag === tag)?.id ?? null

/* ------------------------------------------------------------------ *
 * The station: trade, refit, repair, refuel
 * ------------------------------------------------------------------ */

export function trade(g, good, n) {
  const st = g.docked
  if (!st) return 'Dock first.'
  if (n > 0) {
    const p = buyPrice(st, good, g.time)
    if (p == null) return 'Not sold here.'
    const free = g.player.stats.cargo - cargoUsed(g)
    n = Math.min(n, free, Math.floor(g.credits / p))
    if (n <= 0) return free <= 0 ? 'Hold full.' : 'Not enough credits.'
    g.credits -= n * p
    g.ship.cargo[good] = (g.ship.cargo[good] ?? 0) + n
  } else {
    const p = sellPrice(st, good, g.time)
    if (p == null) return 'Nobody here will buy that.'
    const have = g.ship.cargo[good] ?? 0
    const reserved = g.jobs.filter((j) => j.good === good).reduce((k, j) => k + j.n, 0)
    const m = Math.min(-n, have - reserved)
    if (m <= 0) return reserved ? 'That cargo belongs to a job.' : 'None to sell.'
    g.credits += m * p
    g.ship.cargo[good] = have - m
    if (!g.ship.cargo[good]) delete g.ship.cargo[good]
    g.stats.earned += m * p
  }
  autosave(g)
  return null
}

export function repairCost(g) { return Math.ceil((g.player.stats.hull - g.player.hull) * REPAIR_PER_HP) }
export function refuelCost(g) { return Math.ceil(((g.player.stats.tank ?? 0) - g.ship.prop) / 1000 * FUEL_PER_KMS) }
export function repair(g) {
  const c = repairCost(g)
  if (c <= 0) return null
  if (g.credits < c) return 'Not enough credits.'
  g.credits -= c; g.player.hull = g.player.stats.hull; g.player.shield = g.player.stats.shield
  autosave(g)
  return null
}
export function refuel(g) {
  const c = refuelCost(g)
  if (c <= 0) return null
  const afford = Math.min(c, g.credits)
  g.ship.prop += afford / FUEL_PER_KMS * 1000
  g.credits -= afford
  autosave(g)
  return afford < c ? 'Part-filled: that is all you could pay for.' : null
}
export function buyUpgrade(g, id) {
  const u = UPGRADES[id], lvl = g.ship.up[id] ?? 0
  if (!u || lvl >= u.costs.length) return 'Fully fitted.'
  if (g.credits < u.costs[lvl]) return 'Not enough credits.'
  g.credits -= u.costs[lvl]
  g.ship.up[id] = lvl + 1
  refit(g)
  autosave(g)
  return null
}
/** Trade the old hull in at half its price, and fly the new one out. */
export function buyHull(g, id) {
  const h = HULLS[id]
  if (!h || id === g.ship.hull) return 'You fly one already.'
  const trade = Math.round(HULLS[g.ship.hull].price * 0.5)
  if (g.credits + trade < h.price) return 'Not enough credits.'
  if (cargoUsed(g) > h.cargo) return 'Empty your hold first: the new hull is smaller.'
  g.credits += trade - h.price
  g.ship.hull = id
  g.ship.up = {}
  g.ship.prop = Math.min(g.ship.prop, h.tank)
  refit(g, true)
  autosave(g)
  return null
}
function refit(g, fresh = false) {
  const p = g.player, frac = fresh ? 1 : p.hull / p.stats.hull
  const s = shipStats(g.ship.hull, g.ship.up)
  p.stats = s; p.radius = s.radius
  p.hull = s.hull * frac; p.shield = s.shield
}

export function payDebt(g, amount) {
  const n = Math.min(amount, g.credits, g.debt)
  if (n <= 0) return 'Nothing to pay.'
  g.credits -= n; g.debt -= n
  g.emit({ type: 'debt', left: g.debt })
  autosave(g)
  return null
}

/* ------------------------------------------------------------------ *
 * Saving
 * ------------------------------------------------------------------ */

let storage = globalThis.localStorage
export function setStorage(s) { storage = s }
export function autosave(g) {
  g.sinceSave = 0
  try { storage?.setItem(SAVE_KEY, JSON.stringify(saveData(g))) } catch { /* in memory only */ }
}
export function loadSave() {
  try { const s = JSON.parse(storage?.getItem(SAVE_KEY) ?? 'null'); return validSave(s) ? s : null } catch { return null }
}
export function deleteSave() { try { storage?.removeItem(SAVE_KEY) } catch { /* fine */ } }

export { fire, addHeat, clearHeat, PLACES, STATIONS }
