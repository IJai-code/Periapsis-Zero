import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'
import { altitude, createExpedition, FIXED_STEP, HOLD_DOWN, hop, interact, launch, layoutFor, missionScore, nextTarget, REACH, rockField, ROVER, roverFor, scan, scannerRange, SOLID, STEP, stepExpedition, terrainFor, toggleWalk, vehicleFor, VEHICLE, WORLDS } from '../src/sim/expedition.js'
import { CAMPAIGN_ORDER, LANDABLE } from '../src/sim/worlds.js'
import { TERRAIN_RINGS, buildExpeditionTerrain } from '../src/gfx/expeditionTerrain.js'
import { experienceFromHash, landHash } from '../src/sim/experiences.js'
import { TAKEOFF, walkSpeed } from '../src/sim/walk.js'
import { playMission } from './lib/surfaceBot.mjs'

/*
 * The surface game, on every world you can land on: the physics it is built
 * from, that the landing assist gets down everywhere, that a whole mission
 * can be played to the end everywhere (scripts/lib/surfaceBot.mjs plays it the
 * way a careful person would), that nothing solid can be walked or driven
 * through, and the scoring rules the campaign pays out on.
 */
let checks = 0
const check = (name, fn) => { fn(); console.log(`  ✓ ${name}`); checks++ }
const landed = {}

/** Surface gravity, m/s^2, from NASA's fact sheets (Halley from its estimated mass and mean radius). */
const REFERENCE_G = { moon: 1.62, mars: 3.71, phobos: 0.0057, mercury: 3.70, venus: 8.87, io: 1.796, europa: 1.314, ganymede: 1.428, callisto: 1.235, titan: 1.352, pluto: 0.62, halley: 0.00049, deimos: 0.003 }
check('every world\'s gravity comes out of its mass and radius, and matches the published value', () => {
  assert.deepEqual([...LANDABLE].sort(), Object.keys(REFERENCE_G).sort())
  for (const id of LANDABLE) {
    const tol = id === 'halley' || id === 'deimos' ? 0.3 : 0.04
    assert.ok(Math.abs(WORLDS[id].gravity / REFERENCE_G[id] - 1) < tol, `${id}: ${WORLDS[id].gravity} against ${REFERENCE_G[id]}`)
  }
  assert.ok(WORLDS.mars.atmosphere > 0 && WORLDS.venus.atmosphere > 0 && WORLDS.titan.atmosphere > 0)
  assert.equal(WORLDS.moon.atmosphere, 0)
  assert.equal(CAMPAIGN_ORDER.length, 12)
  for (const id of CAMPAIGN_ORDER) assert.ok(WORLDS[id], id)
})

check('the lander is built for each world: thrust to weight at least 2.4, propellant by the square root of gravity', () => {
  for (const id of LANDABLE) {
    const v = vehicleFor(id), g = WORLDS[id].gravity
    assert.ok(v.thrust / ((v.dryMass + v.fuel) * g) >= 2.4 - 1e-9, id)
    assert.ok(v.thrust >= VEHICLE.thrust && v.fuel >= VEHICLE.fuel, id)
  }
  const base = vehicleFor('moon'), up = vehicleFor('moon', { engine: 2, tanks: 3 })
  assert.ok(Math.abs(up.thrust / base.thrust - 1.2) < 1e-9 && Math.abs(up.fuel / base.fuel - 1.45) < 1e-9)
  assert.ok(Math.abs(roverFor({ motor: 1 }).maxSpeed / ROVER.maxSpeed - 1.15) < 1e-9)
  assert.equal(scannerRange({ scanner: 2 }), scannerRange() + 240)
})

for (const id of LANDABLE) {
  check(`${id}: the assist lands on the pad, softly, on finite fuel`, () => {
    const s = createExpedition(id), start = performance.now()
    for (let i = 0; i < 120 * 240 && !s.landed && s.mode !== 'crashed'; i++) stepExpedition(s, {})
    assert.ok(s.landed, `${s.mode}: ${s.message}`)
    assert.ok(s.touchdown.vertical < 1.5, `${s.touchdown.vertical} m/s vertical`)
    assert.ok(s.touchdown.horizontal < s.vehicle.safeHorizontal)
    assert.ok(s.fuel > 0 && s.fuel < s.vehicle.fuel)
    assert.ok(Math.hypot(s.x, s.z) < 12, `${Math.hypot(s.x, s.z).toFixed(1)} m from the pad`)
    assert.equal(altitude(s), 0)
    assert.equal(s.mode, WORLDS[id].hopper ? 'flight' : 'rover', 'on a rover world the rover rolls out and you are in it')
    console.log(`    ${s.time.toFixed(1)} s descent; ${s.touchdown.vertical.toFixed(2)} m/s down; ${(s.vehicle.fuel - s.fuel).toFixed(0)} of ${s.vehicle.fuel.toFixed(0)} kg used; ${(performance.now() - start).toFixed(0)} ms`)
    landed[id] = s
  })
}

for (const id of LANDABLE) {
  check(`${id}: a whole mission plays through to lift-off with every objective`, () => {
    const start = performance.now()
    const { s, why } = playMission(id)
    assert.equal(s.mode, 'complete', why ?? '')
    const r = s.result
    assert.ok(r.complete && r.anomaly && r.stars >= 2, JSON.stringify(r))
    const minutes = (s.liftAt - s.landedAt) / 60
    assert.ok(minutes < 12, `${minutes.toFixed(1)} min on the surface`)
    console.log(`    ${minutes.toFixed(1)} min on the surface; ${r.total} points, ${r.stars} stars; ${(performance.now() - start).toFixed(0)} ms`)
  })
}

check('the hopper\'s hold-down keeps a hop low: it never climbs away from a body this small', () => {
  for (const id of ['phobos', 'halley', 'deimos']) {
    const s = landed[id]
    assert.ok(hop(s), `${id}: a hop starts`)
    let peak = 0
    for (let i = 0; i < 120 * 300 && !s.landed && s.mode === 'flight'; i++) { stepExpedition(s, {}); peak = Math.max(peak, altitude(s)) }
    assert.ok(s.landed, `${id}: ${s.mode}: ${s.message}`)
    assert.ok(peak < 60, `${id}: climbed to ${peak.toFixed(1)} m`)
  }
  // By hand, C fires it: a pure push down of HOLD_DOWN.
  const s = createExpedition('halley'); s.assist = false; s.vy = 0; s.vx = 0; s.vz = 0
  stepExpedition(s, { down: true })
  const g = WORLDS.halley.gravity * (WORLDS.halley.radius / (WORLDS.halley.radius + altitude(s))) ** 2
  assert.ok(Math.abs(s.vy + (HOLD_DOWN + g) * FIXED_STEP) < 1e-6, `${s.vy}`)
})

check('Venus gives you eight minutes on the surface, then the heat wins', () => {
  const s = landed.venus
  assert.equal(s.survival, 480)
  const keys = {}
  while (s.mode !== 'crashed' && s.time - s.landedAt < 481) stepExpedition(s, keys)
  assert.equal(s.mode, 'crashed')
  assert.ok(s.time - s.landedAt > 479.9, 'not before the eight minutes are up')
  assert.match(s.message, /heat/)
})

check('the descent, in a vacuum or in air, is gravity and thrust and drag, nothing else', () => {
  const s = createExpedition('mars'); s.assist = false; s.vx = 0; s.vy = 0; s.vz = 0
  const h = altitude(s)
  stepExpedition(s, {})
  const g = WORLDS.mars.gravity * (WORLDS.mars.radius / (WORLDS.mars.radius + h)) ** 2
  assert.ok(Math.abs(s.vy + g * FIXED_STEP) < 1e-8)
  for (let i = 0; i < 120 * 60 && s.mode !== 'crashed'; i++) stepExpedition(s, {})
  assert.equal(s.mode, 'crashed', 'engine off is a hard landing')
  assert.equal(s.fuel, s.vehicle.fuel)
  // Venus's air: 65 kg/m^3 is a drag plate. Falling, it settles at the
  // speed where drag (rho A Cd v^2 / 2, A Cd = 12 m^2) holds the weight.
  const v = createExpedition('venus'); v.assist = false; v.vx = 0; v.vz = 0
  for (let i = 0; i < 120 * 8; i++) stepExpedition(v, {})
  const m = v.vehicle.dryMass + v.fuel, rho = WORLDS.venus.air.rho * Math.exp(-altitude(v) / WORLDS.venus.air.scale)
  const terminal = Math.sqrt(2 * m * WORLDS.venus.gravity / (rho * 12))
  assert.ok(Math.abs(-v.vy / terminal - 1) < 0.02, `${(-v.vy).toFixed(2)} against terminal ${terminal.toFixed(2)} m/s`)
})

check('manual thrust tilts with the stick, burns propellant, and lifts off', () => {
  const s = createExpedition('moon'); s.assist = false; s.vx = 0; s.vy = 0; s.vz = 0
  for (let i = 0; i < 120; i++) stepExpedition(s, { thrust: true, right: true, camYaw: 0 })
  assert.ok(s.vy > 0 && s.vx > 0 && s.fuel < s.vehicle.fuel)
  const turned = createExpedition('moon'); turned.assist = false; turned.vx = 0; turned.vy = 0; turned.vz = 0
  for (let i = 0; i < 120; i++) stepExpedition(turned, { thrust: true, forward: true, camYaw: Math.PI / 2 })
  assert.ok(turned.vx < -0.5 && Math.abs(turned.vz) < 0.2, 'W is away from the camera, wherever it looks')
  const empty = createExpedition('moon'); empty.fuel = 0; empty.assist = false; empty.vy = 0
  stepExpedition(empty, { thrust: true })
  assert.ok(empty.vy < 0 && empty.throttle === 0)
  assert.throws(() => stepExpedition(empty, {}, 1))
})

check('every world\'s layout: three samples, a rare one and the anomaly hidden in search zones, on drivable ground', () => {
  for (const id of LANDABLE) {
    const { pois } = layoutFor(id), t = terrainFor(id)
    const samples = pois.filter((p) => p.kind === 'sample')
    assert.equal(samples.length, 4)
    assert.equal(pois.filter((p) => p.kind === 'station').length, 1)
    assert.equal(pois.filter((p) => p.kind === 'anomaly').length, 1)
    assert.ok(samples.filter((p) => p.zone).length === 1 && pois.find((p) => p.kind === 'anomaly').zone)
    for (const p of pois) {
      const d = Math.hypot(p.x, p.z)
      assert.ok(d > 20 && d < 560, `${id} ${p.kind} at ${d.toFixed(0)} m`)
      assert.ok(t.slope(p.x, p.z) < 0.2, `${id} ${p.kind} on a ${t.slope(p.x, p.z).toFixed(2)} slope`)
      if (p.zone) assert.ok(Math.hypot(p.x - p.zone.x, p.z - p.zone.z) <= p.zone.r, 'the find is inside its zone')
    }
  }
})

check('the scanner finds only what is in range, and hidden finds cannot be collected', () => {
  const s = createExpedition('moon')
  for (let i = 0; i < 120 * 240 && !s.landed; i++) stepExpedition(s, {})
  const hidden = s.pois.find((p) => !p.found && p.kind === 'sample')
  Object.assign(s.rover, { x: hidden.x + 2, z: hidden.z + 1, vx: 0, vz: 0 })
  assert.equal(interact(s), false, 'a hidden find is not collectable, even within reach')
  s.time += 5
  const far = s.pois.filter((p) => !p.found && Math.hypot(p.x - s.rover.x, p.z - s.rover.z) > s.scan.range)
  assert.ok(scan(s))
  assert.ok(hidden.found)
  for (const p of far) assert.equal(p.found, false, 'out of range stays hidden')
  assert.equal(scan(s), false, 'the scanner recharges between pulses')
  assert.ok(interact(s) && hidden.done)
  // And what is out of reach is not collected.
  const next = s.pois.find((p) => p.found && !p.done && p.kind === 'sample')
  Object.assign(s.rover, { x: next.x + REACH.rover + 1, z: next.z })
  assert.equal(interact(s), false)
})

check('the guidance arrow points at the pad, then the nearest work, the anomaly only once the survey is done, then home', () => {
  const out = [0, 0]
  const s = createExpedition('mars')
  assert.equal(nextTarget(s, out), 'pad')
  for (let i = 0; i < 120 * 240 && !s.landed; i++) stepExpedition(s, {})
  const kind = nextTarget(s, out)
  assert.ok(['sample', 'station', 'zone'].includes(kind))
  for (const p of s.pois) if (p.kind !== 'anomaly') { p.found = true; p.done = true }
  assert.equal(nextTarget(s, out), 'zone')
  for (const p of s.pois) p.done = true
  assert.equal(nextTarget(s, out), 'lander')
  assert.deepEqual(out, [s.x, s.z])
})

check('scoring: what a landing, the finds and the time are worth, and where the stars are', () => {
  const s = createExpedition('moon')
  s.touchdown = { vertical: 0, horizontal: 0, slope: 0, fuel: s.vehicle.fuel, distance: 0, assisted: false }
  s.landedAt = 0; s.time = 180
  assert.equal(missionScore(s).landing, 1000)
  assert.equal(missionScore(s).stars, 0, 'no stars without the survey')
  for (const p of s.pois) if (p.kind !== 'anomaly') p.done = true
  const full = missionScore(s)
  assert.equal(full.finds, 100 * 3 + 250 + 300)
  assert.equal(full.time, 300)
  assert.equal(full.total, 1000 + 850 + 300)
  assert.equal(full.stars, 2, 'two stars without the anomaly, however good')
  s.pois.find((p) => p.kind === 'anomaly').done = true
  assert.equal(missionScore(s).stars, 3)
  assert.equal(missionScore(s).science, Math.round(missionScore(s).total / 10))
  s.touchdown.assisted = true
  assert.equal(missionScore(s).landing, 750, 'assist flying the last 60 m pays three quarters')
  s.time = 60 * 11
  assert.equal(missionScore(s).time, 0, 'no time bonus past ten minutes on the surface')
})

check('rover drive is mass against gravity: flat ground tops out, slopes cost speed, a slope past stall stops it', () => {
  const flat = (id) => {
    const s = createExpedition(id); s.mode = 'rover'; s.landed = true
    s.rover = { x: 0, y: 0, z: 0, vx: 0, vz: 0, yaw: 0, speed: 0, battery: 1, odometer: 0 }
    for (let i = 0; i < 120 * 6; i++) stepExpedition(s, { forward: true })
    return Math.hypot(s.rover.vx, s.rover.vz)
  }
  for (const id of ['moon', 'mars', 'titan']) assert.ok(flat(id) > 0.9 * ROVER.maxSpeed && flat(id) <= ROVER.maxSpeed + 1e-9, id)
  const motor = ROVER.drive / ROVER.mass
  assert.ok(Math.abs(motor - 2.4762) < 0.001)
  assert.ok(Math.abs(motor / (WORLDS.mars.gravity * ROVER.grip) - 1.21) < 0.01, 'Mars stalls at a 1.21 gradient')
  // Pointed up Europa's steepest ridge, the same command is slower.
  const t = terrainFor('europa')
  let spot = null, steep = 0
  for (let x = -620; x <= 620; x += 11) for (let z = -620; z <= 620; z += 11) { const g = t.slope(x, z); if (g > steep) { steep = g; spot = [x, z] } }
  const gx = (t.height(spot[0] + 1, spot[1]) - t.height(spot[0] - 1, spot[1])) / 2
  const gz = (t.height(spot[0], spot[1] + 1) - t.height(spot[0], spot[1] - 1)) / 2
  const climb = createExpedition('europa'); climb.mode = 'rover'
  climb.rover = { x: spot[0], y: t.height(...spot) + ROVER.clearance, z: spot[1], vx: 0, vz: 0, yaw: Math.atan2(gx, -gz), speed: 0, battery: 1, odometer: 0 }
  for (let i = 0; i < 120 * 6; i++) stepExpedition(climb, { forward: true })
  assert.ok(Math.hypot(climb.rover.vx, climb.rover.vz) < flat('europa'))
})

check('on foot: every world tops out at the gait limit sqrt(gL), and the feet push only as hard as friction allows', () => {
  for (const id of ['moon', 'mars', 'europa', 'titan']) {
    const s = createExpedition(id); s.mode = 'eva'
    const t = terrainFor(id)
    let start = null
    for (let x = -300; x <= 300 && !start; x += 24) {
      for (let z = 300; z >= -300 && !start; z -= 24) {
        let ok = true
        for (let d = 0; d <= 20 && ok; d += 1) ok = Math.abs(t.height(x, z - d) - t.height(x, z - d + 1)) < 0.2
        if (ok) start = [x, z]
      }
    }
    Object.assign(s.walker, { x: start[0], z: start[1], y: t.height(...start), vx: 0, vy: 0, vz: 0, yaw: 0, ground: true })
    let fastest = 0
    for (let i = 0; i < 120 * 6; i++) { stepExpedition(s, { forward: true }); fastest = Math.max(fastest, Math.hypot(s.walker.vx, s.walker.vz)) }
    const limit = walkSpeed(WORLDS[id].gravity)
    assert.ok(fastest <= limit + 1e-9 && fastest > limit * 0.98, `${id}: ${fastest.toFixed(3)} of ${limit.toFixed(3)} m/s`)
  }
  const s = createExpedition('moon'); s.mode = 'eva'
  const t = terrainFor('moon')
  Object.assign(s.walker, { x: 0, z: 200, y: t.height(0, 200), vx: 0, vy: 0, vz: 0, yaw: 0, ground: true })
  stepExpedition(s, { forward: true })
  assert.ok(Math.abs(Math.hypot(s.walker.vx, s.walker.vz) - 0.6 * WORLDS.moon.gravity * FIXED_STEP) < 1e-9)
  // A jump is the walk model's take-off speed against local gravity.
  const j = createExpedition('europa'); j.mode = 'eva'
  const te = terrainFor('europa')
  Object.assign(j.walker, { x: 30, z: 30, y: te.height(30, 30), vx: 0, vy: 0, vz: 0, yaw: 0, ground: true })
  const floor = j.walker.y, keys = { jump: true }
  let peak = floor
  for (let i = 0; i < 120 * 5; i++) { stepExpedition(j, keys); peak = Math.max(peak, j.walker.y) }
  assert.ok(Math.abs(peak - floor - TAKEOFF ** 2 / (2 * WORLDS.europa.gravity)) < 0.05)
})

check('solid: the lander, its footpads and the rover cannot be walked or driven through', () => {
  for (const id of ['moon', 'mars']) {
    const s = createExpedition(id), t = terrainFor(id)
    Object.assign(s, { x: 0, z: 0, y: t.height(0, 0) + VEHICLE.clearance, vx: 0, vy: 0, vz: 0, landed: true, yaw: 0.4 })
    s.mode = 'eva'
    Object.assign(s.walker, { x: 12, z: 0, y: t.height(12, 0), vx: 0, vy: 0, vz: 0, yaw: -Math.PI / 2, ground: true })
    let closest = Infinity
    for (let i = 0; i < 120 * 40; i++) { stepExpedition(s, { forward: true }); closest = Math.min(closest, Math.hypot(s.walker.x - s.x, s.walker.z - s.z)) }
    assert.ok(closest >= SOLID.landerBody + SOLID.walker - 1e-6, `${id}: walker reached ${closest.toFixed(2)} m`)
    s.mode = 'rover'
    s.rover = { x: 20, z: 0, y: t.height(20, 0) + ROVER.clearance, vx: 0, vz: 0, yaw: -Math.PI / 2, speed: 0, battery: 1, odometer: 0 }
    let roverClosest = Infinity
    for (let i = 0; i < 120 * 30; i++) { stepExpedition(s, { forward: true }); roverClosest = Math.min(roverClosest, Math.hypot(s.rover.x - s.x, s.rover.z - s.z)) }
    assert.ok(roverClosest >= SOLID.landerBody + SOLID.roverSelf - 1e-6, `${id}: rover reached ${roverClosest.toFixed(2)} m`)
    // F steps out beside the rover; walking at the rover stops at its edge.
    assert.ok(toggleWalk(s))
    s.walker.yaw = Math.atan2(s.rover.x - s.walker.x, -(s.rover.z - s.walker.z))
    let toRover = Infinity
    for (let i = 0; i < 120 * 10; i++) { stepExpedition(s, { forward: true }); toRover = Math.min(toRover, Math.hypot(s.walker.x - s.rover.x, s.walker.z - s.rover.z)) }
    assert.ok(toRover >= SOLID.rover + SOLID.walker - 1e-6)
  }
})

check('rocks: no walker or rover passes through a boulder on any world, pebbles do not block, and no site is under one', () => {
  for (const id of LANDABLE) {
    const f = rockField(id), t = terrainFor(id)
    let i = -1, best = 0
    for (let k = 0; k < f.n; k++) if (f.height[k] > STEP.rover && f.radius[k] > best && Math.hypot(f.x[k], f.z[k]) > 40 && Math.hypot(f.x[k], f.z[k]) < 600) { best = f.radius[k]; i = k }
    assert.ok(i >= 0, `${id} has boulders`)
    const s = createExpedition(id); s.mode = 'eva'
    const x0 = f.x[i] - f.radius[i] - 6
    Object.assign(s.walker, { x: x0, z: f.z[i], y: t.height(x0, f.z[i]), ground: true, yaw: Math.PI / 2, vx: 0, vz: 0 })
    for (let n = 0; n < 120 * 30; n++) stepExpedition(s, { forward: true })
    assert.ok(Math.hypot(s.walker.x - f.x[i], s.walker.z - f.z[i]) >= f.radius[i] + SOLID.walker - 0.02, `${id}: walked into a boulder`)
    s.mode = 'rover'
    const x1 = f.x[i] - f.radius[i] - 12
    s.rover = { x: x1, y: t.height(x1, f.z[i]) + ROVER.clearance, z: f.z[i], vx: 0, vz: 0, yaw: Math.PI / 2, speed: 0, battery: 1, odometer: 0 }
    for (let n = 0; n < 120 * 20; n++) stepExpedition(s, { forward: true })
    assert.ok(Math.hypot(s.rover.x - f.x[i], s.rover.z - f.z[i]) >= f.radius[i] + SOLID.roverSelf - 0.02, `${id}: drove into a boulder`)
    for (const p of layoutFor(id).pois) {
      for (let k = 0; k < f.n; k++) {
        if (f.height[k] <= STEP.walker) continue
        assert.ok(Math.hypot(f.x[k] - p.x, f.z[k] - p.z) > f.radius[k] + 1, `${id}: a boulder sits on the ${p.kind}`)
      }
    }
  }
})

check('rendered terrain is the collision surface, its rings meet without cracks, and it stays inside budget', () => {
  for (const id of LANDABLE) {
    const start = performance.now(), meshes = buildExpeditionTerrain(id), terrain = terrainFor(id)
    const pos = meshes[0].attributes.position, indices = meshes[0].index
    const vertices = meshes.reduce((n, g) => n + g.attributes.position.count, 0)
    assert.ok(vertices <= 95000, `${vertices} vertices`)
    for (let i = 0; i < indices.count; i += 213) {
      const a = indices.getX(i), b = indices.getX(i + 1), c = indices.getX(i + 2)
      const x = (pos.getX(a) + pos.getX(b) + pos.getX(c)) / 3, z = (pos.getZ(a) + pos.getZ(b) + pos.getZ(c)) / 3
      const y = (pos.getY(a) + pos.getY(b) + pos.getY(c)) / 3
      assert.ok(Math.abs(terrain.height(x, z) - y) < 0.0001)
    }
    for (let ring = 1; ring < TERRAIN_RINGS.length; ring++) {
      const edge = TERRAIN_RINGS[ring].hole, coarse = TERRAIN_RINGS[ring].step
      for (let z = -edge; z < edge; z += coarse) {
        const mid = terrain.height(edge, z + coarse / 2), linear = (terrain.height(edge, z) + terrain.height(edge, z + coarse)) / 2
        assert.ok(Math.abs(mid - linear) < 1e-8, `${id}: ring ${ring} edge must lie on the coarse ring`)
      }
    }
    for (const g of meshes) { for (const value of g.attributes.position.array) assert.ok(Number.isFinite(value)); g.dispose() }
    if (id === 'mars') console.log(`    ${vertices.toLocaleString()} vertices; Mars builds in ${(performance.now() - start).toFixed(0)} ms`)
  }
})

check('links: #land/<world> lands there, #campaign and old #story are the campaign, old expedition links still land, junk goes home', () => {
  assert.deepEqual(experienceFromHash('#flight'), { mode: 'simulator' })
  assert.deepEqual(experienceFromHash('#campaign'), { mode: 'campaign' })
  assert.deepEqual(experienceFromHash('#story'), { mode: 'campaign' })
  for (const id of LANDABLE) assert.deepEqual(experienceFromHash(landHash(id)), { mode: 'land', id })
  assert.deepEqual(experienceFromHash('#expedition/mars'), { mode: 'land', id: 'mars' })
  assert.deepEqual(experienceFromHash('#expedition/europa/campaign'), { mode: 'campaign' })
  assert.deepEqual(experienceFromHash('#land/jupiter'), { mode: 'home' })
  assert.deepEqual(experienceFromHash('#nonsense'), { mode: 'home' })
  assert.throws(() => landHash('jupiter'))
  assert.equal(launch(createExpedition('moon')), false, 'no lift-off before landing')
})

console.log(`\n${checks} surface checks pass.`)
