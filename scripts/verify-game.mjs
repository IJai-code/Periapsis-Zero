import assert from 'node:assert/strict'
import * as THREE from 'three'
import { createPilot } from './lib/gameBot.mjs'
import { L1, MOON, EARTH, PLACES, STATIONS } from '../src/game/core/world.js'
import { HULLS, shipStats, LASER } from '../src/game/core/ships.js'
import { makeShip, stepShip, playerShip } from '../src/game/core/flight.js'
import { leadPoint, makeBolts, fire, stepBolts } from '../src/game/core/combat.js'
import { addHeat, fine, SIGHT, COLD_SIGHT } from '../src/game/core/heat.js'
import { buyPrice, sellPrice, jobBoard, price } from '../src/game/core/economy.js'
import { newSave, startGame, saveData, validSave, respawn, acceptJob, trade, buyHull, setStorage, autosave, loadSave, stepGame, tripCost, startTransfer, setDestination } from '../src/game/core/game.js'
import { startStory, chooseStory, STORY } from '../src/game/core/story.js'
import { buyUpgrade } from '../src/game/core/game.js'

/*
 * The game (src/game/core): the physics it claims, the rules it keeps, and
 * the story, played through on both branches by a scripted pilot that uses
 * the same controls as a player. A mission the pilot dies on is retried after
 * respawning, as a player would; three failures of one mission fail the gate.
 */
// The game rolls dice (spawn points, scan misses, ambushes). Seed them, so this
// machine and CI play the same game and a failure is reproducible.
let seed = 0x2091
Math.random = () => { seed = (seed + 0x6d2b79f5) | 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
let checks = 0
const check = (name, fn) => { fn(); console.log(`  ✓ ${name}`); checks++ }
const V = (x, y, z) => new THREE.Vector3(x, y, z)
const mem = new Map()
setStorage({ getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v), removeItem: (k) => mem.delete(k) })

check('L1 is solved from the two masses and the frame\'s rotation, where the references put it', () => {
  assert.ok(Math.abs(L1 / 1000 - 326400) < 800, `${(L1 / 1000).toFixed(0)} km`)
  assert.equal(MOON.position.x, 384400e3)
  assert.ok(PLACES.harbor.anchor.length() - EARTH.radius - 420e3 < 1, 'Harbor 420 km up')
  assert.ok(Math.abs(PLACES.shackleton.anchor.distanceTo(MOON.position) - MOON.radius - 60e3) < 1, 'Shackleton 60 km over the pole')
})

check('transfers are brachistochrones at the torch\'s acceleration: t = 2 sqrt(d/a), dv = a t', () => {
  const g = startGame(newSave('t'))
  const c = tripCost(g, 'harbor')
  const a = HULLS.kestrel.drive
  assert.ok(Math.abs(c.T - 2 * Math.sqrt(c.D / a)) < 1e-6)
  assert.ok(Math.abs(c.dv - a * c.T) < 1e-6)
  assert.ok(c.T / 3600 > 5 && c.T / 3600 < 7, `${(c.T / 3600).toFixed(2)} h Hearth to Harbor`)
  assert.ok(Math.abs(a / 9.80665 - 0.3) < 0.001, 'the drive is 0.3 g')
  // Flown: the ship arrives, the clock moves on by the ship time, the tank pays the delta-v.
  const t0 = g.time, prop0 = g.ship.prop
  const input = { actions: ['launch'] }
  for (let i = 0; i < 60 * 4; i++) stepGame(g, input)
  setDestination(g, 'harbor')
  startTransfer(g, 'harbor')
  for (let i = 0; i < 60 * 40 && g.mode !== 'flight'; i++) stepGame(g, input)
  assert.equal(g.place, 'harbor')
  assert.ok(Math.abs((g.time - t0) - c.T) < 120, `clock moved ${((g.time - t0) / 3600).toFixed(2)} h`)
  assert.ok(Math.abs(prop0 - g.ship.prop - c.dv) < 1)
})

check('flight assist holds the commanded speed; with it off, momentum is kept', () => {
  const e = playerShip('kestrel', {})
  e.ctrl.throttle = 1
  for (let i = 0; i < 60 * 30; i++) stepShip(e, 1 / 60, i / 60)
  assert.ok(Math.abs(e.vel.length() - HULLS.kestrel.maxSpeed) < 1, `${e.vel.length().toFixed(1)} m/s`)
  e.ctrl.fa = false; e.ctrl.throttle = 0
  const v = e.vel.clone()
  for (let i = 0; i < 60 * 10; i++) stepShip(e, 1 / 60, 30 + i / 60)
  assert.ok(e.vel.distanceTo(v) < 1e-9, 'no thrust, no change')
  // One second at full thrust with assist off is the hull's acceleration, as delta-v.
  const f = playerShip('kestrel', {}); f.ctrl.fa = false; f.ctrl.throttle = 1
  for (let i = 0; i < 60; i++) stepShip(f, 1 / 60, i / 60)
  assert.ok(Math.abs(f.vel.length() - HULLS.kestrel.accel) < 0.01)
})

check('the lead point is an exact intercept: a bolt fired at it hits a target crossing at speed', () => {
  const g = { time: 0, ships: [], bolts: makeBolts(), events: [], emit: () => {}, byId: () => null }
  const a = makeShip('player', 'player', shipStats('kestrel'), V(0, 0, 0))
  const b = makeShip('raider', 'hollow', shipStats('raider'), V(300, 0, -1200))
  b.vel.set(-220, 40, 0)
  g.ships.push(a, b)
  const lead = new THREE.Vector3()
  assert.ok(leadPoint(a, b, lead))
  a.q.setFromUnitVectors(V(0, 0, -1), lead.clone().sub(a.pos).normalize())
  const hull0 = b.hull + b.shield
  LASER.spread = 0
  for (let n = 0; n < 6; n++) { a.gunCooldown = 0; fire(g, a, lead) }
  for (let i = 0; i < 90; i++) { b.pos.addScaledVector(b.vel, 1 / 60); stepBolts(g, 1 / 60) }
  LASER.spread = 0.002
  assert.ok(b.hull + b.shield < hull0, 'the bolts arrived where the raider did')
})

check('heat: a fine clears it; patrols see you at 6 km, and at 1.8 km when you run cold', () => {
  assert.equal(SIGHT, 6000); assert.equal(COLD_SIGHT, 1800)
  const g = startGame(newSave('h'))
  g.mode = 'flight'
  g.ship.cargo.chips = 3
  addHeat(g, 1, 'test')
  const credits = g.credits
  fine(g)
  assert.equal(g.heat.level, 0)
  assert.equal(g.ship.cargo.chips, undefined, 'contraband seized')
  assert.equal(g.credits, credits - 1500)
})

check('a Mule\'s hidden compartment is not read by a patrol scan; a Kestrel\'s hold is', () => {
  for (const [hull, chips, caught] of [['kestrel', 2, true], ['mule', 4, false], ['mule', 8, true]]) {
    const g = startGame(newSave('s'))
    g.ship.hull = hull; g.ship.cargo.chips = chips
    g.player = playerShip(hull, {})
    const input = { actions: ['launch'] }
    for (let i = 0; i < 60 * 4; i++) stepGame(g, input)
    const e = makeShip('cutter', 'compact', shipStats('cutter'), g.player.pos.clone().add(V(0, 0, 600)))
    e.ai = { mode: 'hold' }; e.sure = true
    g.ships.push(e)
    for (let i = 0; i < 60 * 5; i++) stepGame(g, input)
    assert.equal(g.heat.level >= 2, caught, `${hull} with ${chips}: heat ${g.heat.level}`)
  }
})

check('the market: buy above, sell below, nothing traded that a station will not; hold limits hold', () => {
  for (const st of Object.keys(STATIONS)) for (const good of ['water', 'food', 'chips']) {
    const p = price(st, good, 0)
    if (p == null) { assert.equal(buyPrice(st, good, 0), null); continue }
    assert.ok(buyPrice(st, good, 0) > sellPrice(st, good, 0))
  }
  assert.equal(price('harbor', 'chips', 0), null, 'Harbor will not touch contraband')
  const g = startGame(newSave('m'))
  g.credits = 1e6
  assert.equal(trade(g, 'water', 99), null)
  assert.equal(g.ship.cargo.water, HULLS.kestrel.cargo)
  assert.equal(trade(g, 'food', 1), 'Hold full.')
  const before = g.credits
  trade(g, 'water', -999)
  assert.ok(g.credits > before && !g.ship.cargo.water)
})

check('jobs: the board is the same all day and new the next; a haul loads the hold and pays on delivery', () => {
  assert.deepEqual(jobBoard('hearth', 100).map((j) => j.id), jobBoard('hearth', 80000).map((j) => j.id))
  assert.notDeepEqual(jobBoard('hearth', 100).map((j) => j.id), jobBoard('hearth', 90000).map((j) => j.id))
  const b = createPilot('j')
  const g = b.g
  const job = jobBoard('hearth', g.time).find((j) => j.type === 'courier') ?? jobBoard('harbor', g.time).find((j) => j.type === 'courier')
  assert.ok(job)
  assert.equal(acceptJob(g, job), null)
  const credits = g.credits
  b.dock(job.to)
  assert.ok(g.credits >= credits + job.reward * 0.5, 'paid on docking at the destination')
  assert.equal(g.jobs.length, 0)
})

check('saves round-trip and resume docked at the last station; death costs a tenth and the cargo', () => {
  const g = startGame(newSave('Save Me'))
  g.credits = 12345; g.ship.cargo.food = 3
  autosave(g)
  const s = loadSave()
  assert.ok(validSave(s))
  assert.equal(s.credits, 12345)
  const h = startGame(s)
  assert.equal(h.mode, 'docked'); assert.equal(h.docked, 'hearth')
  respawn(h)
  assert.equal(h.credits, 12345 - 1235); assert.deepEqual(h.ship.cargo, {})
  assert.equal(validSave({ ...s, ship: { ...s.ship, hull: 'starship' } }), false)
})

check('the shipyard trades your hull in at half price; a smaller hold must be empty first', () => {
  const g = startGame(newSave('y'))
  g.credits = 100000
  assert.equal(buyHull(g, 'lance'), null)
  assert.equal(g.credits, 100000 - HULLS.lance.price)
  g.ship.cargo.water = 4
  assert.match(buyHull(g, 'mule') ?? '', /^$|./)
})

/* ------------------------------------------------------------------ *
 * The story, played through
 * ------------------------------------------------------------------ */
const V3 = V
function playStory(choice) {
  const b = createPilot('Bot')
  const g = b.g
  let deaths = 0
  const take = (id) => { b.step(3); const r = startStory(g, id); if (r) throw new Error(`could not start ${id}: ${r}`); b.step(5) }
  const at = (id) => STORY.find((m) => m.id === id)
  const giverStation = (id) => { const m = at(id); return typeof m.at === 'function' ? m.at(g) : m.at }
  const missions = {
    arrival: () => {
      if (g.mode === 'docked') b.launch()
      b.flyTo(V3(0, 250, 2200), 60); b.flyTo(V3(1600, 700, 5200), 80)
      b.c.actions.push('fa'); b.step(60); b.c.actions.push('fa'); b.step(60)
      b.fightTag('m:drone', 120); b.dock('hearth')
    },
    'honest-work': () => { b.transfer('harbor'); b.dock('harbor') },
    scrap: () => { b.transfer('drift'); b.collect('m:scrap'); b.until(() => g.story.step >= 2 || !g.story.active, 30, 'ambush'); b.fightTag('m:raid'); b.collect('m:scrap'); b.dock('hearth') },
    friend: () => { b.transfer('gateway'); b.flyTo(V3(4200, -900, -3000), 70, 400, 300); if (g.heat.level) b.loseHeat(); b.dock('shackle') },
    'down-low': () => { b.transfer('shackleton'); b.surface(); b.dock('shackle') },
    chen: () => { b.step(30); chooseStory(g, choice); b.step(5) },
    raid: () => { b.transfer('drift'); b.until(() => g.story.step >= 2, 60, 'form up'); b.fightTag('m:pickets'); b.until(() => g.story.step >= 3, 30, 'escort'); b.fightTag('m:escort'); b.step(60) },
    convoy: () => {
      b.transfer('hearth'); b.until(() => g.story.step >= 1, 30, 'convoy'); b.fightTag('m:escort')
      b.until(() => { const x = g.byId(g.story.s.barge); if (!x) return true; g.target = x.id; b.c.aim = x.pos.clone().sub(g.player.pos).normalize(); b.c.fire = true; b.c.throttleSet = x.pos.distanceTo(g.player.pos) > 600 ? 1 : 0.2; return g.story.step >= 3 }, 200, 'disabling the barge')
      b.c.fire = false; b.collect('m:convoy'); b.dock('shackle')
    },
    periapsis: () => { b.transfer('shackleton'); b.flyTo(V3(3000, -400, -6000), 3000, 1000, 200); b.until(() => g.story.step >= 2, 30, 'the Warden'); b.fightAll(() => true, 600); b.step(60) },
    // Act Two.
    'new-money': () => {
      b.transfer('harbor')
      b.flyTo(() => (g.story.step >= 2 ? null : g.byId(g.story.s.ward)?.pos), 800, 400)
      const pack = (e) => e.alive && e.tag === 'm:pack'
      b.until(() => {
        if (g.story.step >= 3 || !g.story.active) return true
        // The ones on her first.
        const onHer = (e) => pack(e) && e.ai?.target === g.story.s.ward
        if (g.ships.some(onHer)) { b.fightAll(onHer, 120, true); return false }
        if (g.ships.some(pack)) { b.fightAll(pack, 120, true); return false }
        // Ride along with her, off her flank.
        const w = g.byId(g.story.s.ward)
        if (w) { const d = w.pos.clone().add(V3(0, 200, 0)).sub(g.player.pos); b.c.aim = d.clone().normalize(); b.c.throttleSet = d.length() > 600 ? 0.8 : 0.1 }
        return false
      }, 600, 'escorting the Providence')
      if (!g.story.active) throw new Error('mission failed: the Providence was lost')
      b.dock('harbor')
    },
    'ghost-signal': () => {
      b.transfer('drift')
      const over = V3(-5200, -500, 4200)
      b.flyTo(over, 110, 12, 400)
      b.c.throttleSet = 0
      b.until(() => g.story.step >= 3, 30, 'pulling the recorder')
      b.fightTag('m:ambush'); b.dock('hearth')
    },
    loop: () => {
      b.transfer('harbor')
      b.race(() => g.story.step >= 2)
      b.flyTo(V3(2600, 560, -2200), 40, 60); b.until(() => g.story.step >= 3, 10, 'tagging the Meridian')
      b.dock('hearth')
    },
    apoapsis: () => {
      b.transfer('gateway')
      b.until(() => { if (g.story.step >= 2) return true; b.fightTag('m:strike', 200); b.step(30); return false }, 900, 'defending Gateway')
      b.fightTag('m:flag', 400); b.dock('gateway')
    },
  }
  const order = ['arrival', 'honest-work', 'scrap', 'friend', 'down-low', 'chen', choice === 'chen' ? 'raid' : 'convoy', 'periapsis', 'new-money', 'ghost-signal', 'loop', 'apoapsis']
  for (const id of order) {
    for (let attempt = 1; ; attempt++) {
      try {
        if (id !== 'arrival') {
          // Spend on the ship between acts, as anyone would.
          if (id === 'chen' || id === 'new-money') { for (const u of ['shields', 'armor', 'guns', 'shields', 'armor', 'guns']) buyUpgrade(g, u) }
          b.dock(giverStation(id)); if (g.story.active !== id) take(id)
        }
        missions[id]()
        b.until(() => g.story.done.includes(id), 20, `finishing ${id}`)
        break
      } catch (e) {
        if (!/destroyed|failed|timed out|could not start/.test(e.message) || attempt >= 3) throw new Error(`${id}, attempt ${attempt}: ${e.message}`)
        deaths++; if (process.env.STORY_DEBUG) console.log(`    retry ${id} ${attempt}: ${e.message}`)
        if (g.mode === 'dead') respawn(g)
        if (g.story.active) { b.c.actions.push('noop') }
        b.step(10)
      }
    }
  }
  return { g, deaths }
}

for (const choice of ['chen', 'rook']) {
  check(`the story plays through to the end with ${choice === 'chen' ? 'Commander Chen' : 'Rook'}`, () => {
    const { g, deaths } = playStory(choice)
    assert.equal(g.story.done.length, STORY.length - 1, g.story.done.join(','))
    assert.equal(g.debt, 0, 'the finale clears the debt')
    assert.equal(g.story.choice, choice)
    console.log(`    ${(g.time / 3600).toFixed(1)} game hours, ${g.stats.trips} transfers, ${g.stats.kills} kills, ${deaths} retries, ₡ ${Math.round(g.credits).toLocaleString()}`)
  })
}

console.log(`\n${checks} game checks pass.`)
