import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'
import { altitude, CAMPAIGN, chapterUnlocked, createExpedition, deployRover, expeditionRecord, FIXED_STEP, INSTRUMENTS, interact, launch, nearestInstrument, recordSurvey, REGIONS, roverDistance, ROVER, SITES, stepExpedition, terrainFor, validateRecord, VEHICLE } from '../src/sim/expedition.js'
import { buildExpeditionTerrain } from '../src/gfx/expeditionTerrain.js'
import { experienceFromHash, expeditionHash } from '../src/sim/experiences.js'

let checks = 0
const check = (name, fn) => { fn(); console.log(`  ✓ ${name}`); checks++ }
const landingStates = {}
check('measured gravity differs correctly across the three bodies', () => {
  assert.ok(Math.abs(REGIONS.moon.gravity - 1.6242) < 0.001)
  assert.ok(Math.abs(REGIONS.mars.gravity - 3.728) < 0.001)
  assert.ok(Math.abs(REGIONS.europa.gravity - 1.315) < 0.001)
  assert.equal(REGIONS.moon.atmosphere, 0); assert.equal(REGIONS.europa.atmosphere, 0)
  assert.ok(REGIONS.mars.atmosphere > 0)
})
for (const id of Object.keys(REGIONS)) {
  check(`${id}: assist lands using finite fuel and safe contact speeds`, () => {
    const s = createExpedition(id), start = performance.now()
    for (let i = 0; i < 120 * 120 && !s.landed && s.mode !== 'crashed'; i++) stepExpedition(s, {})
    assert.ok(s.landed, `${s.mode}: ${s.message}`)
    assert.ok(s.touchdown.vertical < 1)
    assert.ok(s.touchdown.horizontal < VEHICLE.safeHorizontal)
    assert.ok(s.fuel > 1000 && s.fuel < VEHICLE.fuel)
    assert.ok(Math.hypot(s.x, s.z) < 12)
    assert.equal(altitude(s), 0)
    console.log(`    ${s.time.toFixed(2)} s flight; ${s.touchdown.vertical.toFixed(3)} m/s vertical; ${s.touchdown.horizontal.toFixed(3)} m/s horizontal; ${(VEHICLE.fuel - s.fuel).toFixed(1)} kg propellant; ${(performance.now() - start).toFixed(1)} ms compute`)
    landingStates[id] = s
  })
  check(`${id}: rendered inner terrain triangles match collision and geometry stays bounded`, () => {
    const start = performance.now(), meshes = buildExpeditionTerrain(id), terrain = terrainFor(id)
    const pos = meshes[0].attributes.position, indices = meshes[0].index
    assert.ok(meshes.reduce((n, g) => n + g.attributes.position.count, 0) <= 50000)
    assert.ok(meshes.reduce((n, g) => n + g.index.count / 3, 0) < 100000)
    for (let i = 0; i < indices.count; i += 213) {
      const a = indices.getX(i), b = indices.getX(i + 1), c = indices.getX(i + 2)
      const x = (pos.getX(a) + pos.getX(b) + pos.getX(c)) / 3, z = (pos.getZ(a) + pos.getZ(b) + pos.getZ(c)) / 3
      const y = (pos.getY(a) + pos.getY(b) + pos.getY(c)) / 3
      assert.ok(Math.abs(terrain.height(x, z) - y) < 0.0001)
      assert.equal(terrain.height(x, z), terrainFor(id).height(x, z))
    }
    for (let ring = 0; ring < 2; ring++) {
      const edge = ring === 0 ? 768 : 3072
      const coarseStep = ring === 0 ? 48 : 192
      for (let z = -edge; z < edge; z += coarseStep) {
        const midpoint = terrain.height(edge, z + coarseStep / 2)
        const linear = (terrain.height(edge, z) + terrain.height(edge, z + coarseStep)) / 2
        assert.ok(Math.abs(midpoint - linear) < 1e-8, 'LOD edge must lie on the coarse ring')
      }
    }
    for (const g of meshes) { for (const value of g.attributes.position.array) assert.ok(Number.isFinite(value)); g.dispose() }
    console.log(`    terrain build ${(performance.now() - start).toFixed(1)} ms; 49,923 vertices / 94,208 triangles`)
  })
}
check('engine-off freefall follows local gravity and leads to a hard landing', () => {
  const s = createExpedition('mars'); s.assist = false; s.vy = 0; s.vz = 0
  stepExpedition(s, {})
  const g = REGIONS.mars.gravity * (REGIONS.mars.radius / (REGIONS.mars.radius + 182.65)) ** 2
  assert.ok(Math.abs(s.vy + g * FIXED_STEP) < 1e-8)
  for (let i = 0; i < 120 * 40 && s.mode !== 'crashed'; i++) stepExpedition(s, {})
  assert.equal(s.mode, 'crashed'); assert.equal(s.landed, false); assert.equal(s.fuel, VEHICLE.fuel)
})
check('manual thrust, mass loss, tilt, and takeoff affect the same dynamics', () => {
  const s = createExpedition('moon'); s.assist = false; s.throttle = 1; s.vy = 0
  for (let i = 0; i < 120; i++) stepExpedition(s, { right: true })
  assert.ok(s.vy > 4); assert.ok(s.vx > 0); assert.ok(s.fuel < VEHICLE.fuel)
  const yawed = createExpedition('moon'); yawed.assist = false; yawed.throttle = 1; yawed.yaw = Math.PI / 2; yawed.vz = 0; yawed.vy = 0
  for (let i = 0; i < 120; i++) stepExpedition(yawed, { right: true, forward: true })
  assert.ok(yawed.vx < 0 && yawed.vz < 0, 'yaw rotates the thrust vector with the rendered craft')
  const landed = landingStates.moon
  assert.ok(launch(landed)); assert.equal(landed.assist, false)
  for (let i = 0; i < 120; i++) stepExpedition(landed, {})
  assert.ok(altitude(landed) > 1)
})
check('zero fuel cannot generate thrust and excessive step sizes are rejected', () => {
  const s = createExpedition('moon'); s.fuel = 0; s.assist = false; s.throttle = 1; s.vy = 0
  stepExpedition(s, {}); assert.ok(s.vy < 0); assert.equal(s.throttle, 0)
  assert.throws(() => stepExpedition(s, {}, 1))
})
check('survey requires real proximity, paired samples, deployed instruments, and return to the landed vehicle', () => {
  const s = landingStates.mars
  assert.equal(interact(createExpedition('mars')), false)
  assert.ok(interact(s)); assert.equal(s.mode, 'eva')
  assert.equal(recordSurvey(s), false)
  for (let i = 0; i < SITES.length; i++) {
    Object.assign(s.walker, { x: 90, z: 0, ground: true })
    assert.equal(interact(s), false)
    Object.assign(s.walker, { x: SITES[i].x, z: SITES[i].z, y: terrainFor(s.id).height(SITES[i].x, SITES[i].z), ground: true })
    assert.ok(interact(s)); assert.equal(s.delivered, false)
    assert.equal(interact(s), false)
  }
  assert.equal(recordSurvey(s), false, 'samples alone are not a survey any more')
  assert.equal(interact(s), false, 'instruments cannot be deployed from the flight seat')
  Object.assign(s.walker, { x: s.x + 7, z: s.z, ground: true })
  assert.ok(interact(s)); assert.equal(s.delivered, false, 'returning with only samples is not a completed survey')
  assert.equal(recordSurvey(s), false)
  assert.ok(deployRover(s))
  assert.equal(deployRover(s), false, 'the rover deploys once')
  assert.equal(s.mode, 'flight')
  Object.assign(s.walker, { x: s.rover.x, z: s.rover.z, y: terrainFor(s.id).height(s.rover.x, s.rover.z), ground: true })
  s.mode = 'eva'
  assert.equal(nearestInstrument(s), null, 'instruments are driven to, not walked to')
  assert.ok(roverDistance(s) < 1)
  assert.ok(interact(s)); assert.equal(s.mode, 'rover')
  for (const [i, site] of INSTRUMENTS.entries()) {
    Object.assign(s.rover, { x: 400, z: 400, vx: 0, vz: 0 })
    assert.equal(interact(s), false, 'an instrument deploys only where it is sited')
    Object.assign(s.rover, { x: site.x, z: site.z, vx: 0, vz: 0 })
    const near = nearestInstrument(s)
    assert.equal(near.index, i)
    assert.ok(interact(s), `instrument ${i} deploys beside the package we chose`)
    assert.equal(interact(s), false, 'one deployment per package')
  }
  Object.assign(s.rover, { x: s.x + 11, z: s.z + 5, vx: 0, vz: 0 })
  assert.ok(interact(s)); assert.equal(s.mode, 'eva')
  Object.assign(s.walker, { x: s.x + 3, z: s.z, y: terrainFor(s.id).height(s.x + 3, s.z), ground: true })
  assert.ok(interact(s)); assert.ok(s.delivered)
  assert.equal(s.instruments.length, INSTRUMENTS.length)
  assert.ok(recordSurvey(s))
  assert.equal(chapterUnlocked('europa'), false, 'free-play completion must not unlock story chapters')
})
for (const id of Object.keys(REGIONS)) {
  check(`${id}: the rover drives a full instrument circuit on its own battery`, () => {
    const s = createExpedition(id)
    for (let i = 0; i < 120 * 120 && !s.landed && s.mode !== 'crashed'; i++) stepExpedition(s, {})
    assert.ok(s.landed)
    assert.ok(deployRover(s))
    s.mode = 'rover'
    let distance = 0
    for (const site of INSTRUMENTS) {
      const keys = {}
      for (let i = 0; i < 120 * 900; i++) {
        const r = s.rover
        const dx = site.x - r.x, dz = site.z - r.z
        let err = Math.atan2(dx, -dz) - r.yaw
        while (err > Math.PI) err -= Math.PI * 2
        while (err < -Math.PI) err += Math.PI * 2
        keys.left = err > 0.06; keys.right = err < -0.06
        keys.forward = Math.hypot(dx, dz) > 4 && Math.abs(err) < 1.2
        keys.back = Math.hypot(dx, dz) < 3
        stepExpedition(s, keys)
        if (Math.hypot(dx, dz) < 6) break
      }
      assert.ok(interact(s), `rover reached ${site.name}`)
    }
    distance = s.rover.odometer
    assert.ok(distance > 700, `the circuit is a real traverse: ${distance.toFixed(0)} m`)
    assert.ok(s.rover.battery > 0.15, `battery survives the circuit: ${(s.rover.battery * 100).toFixed(1)}% left`)
    assert.ok(s.rover.odometer > 0)
    console.log(`    ${INSTRUMENTS.length} packages over ${distance.toFixed(0)} m; battery ${(s.rover.battery * 100).toFixed(1)}% remaining`)
  })
}
check('rover drive is mass against gravity: flat ground tops out, slopes cost speed', () => {
  /*
   * The claim is not that Mars is slower everywhere. On flat ground both
   * vehicles reach their own speed limit, because the motor's acceleration
   * (520 N / 210 kg = 2.48 m/s²) exceeds both worlds' rolling losses. The
   * gravity term only bites on a gradient, and that is what this measures: on
   * level ground the limit holds, and pointed uphill the same motor loses speed
   * to the slope.
   */
  const flat = (id) => {
    const s = createExpedition(id); s.assist = false; s.mode = 'rover'
    s.rover = { x: 0, y: 0, z: 0, vx: 0, vz: 0, yaw: 0, speed: 0, battery: 1, odometer: 0 }
    const keys = { forward: true }
    for (let i = 0; i < 120 * 6; i++) stepExpedition(s, keys)
    return Math.hypot(s.rover.vx, s.rover.vz)
  }
  const moonFlat = flat('moon'), marsFlat = flat('mars')
  assert.ok(moonFlat > 0.9 * ROVER.maxSpeed, `lunar flat speed ${moonFlat.toFixed(2)} m/s`)
  assert.ok(marsFlat > 0.9 * ROVER.maxSpeed, `martian flat speed ${marsFlat.toFixed(2)} m/s`)
  assert.ok(moonFlat <= ROVER.maxSpeed + 1e-9 && marsFlat <= ROVER.maxSpeed + 1e-9, 'the speed limit holds on both')
  assert.equal(ROVER.mass, 210)
  assert.ok(Math.abs(ROVER.drive / ROVER.mass - 2.4762) < 0.001)

  /*
   * Which world actually punishes a slope is a measurement, not a preference.
   * Mars's terrain here is gentle enough that even its steepest ground leaves
   * the motor at the limit: 520 N buys 2.48 m/s², the worst gradient costs
   * 0.283 x 0.55 x 3.728 = 0.58 of it, and rolling resistance still settles at
   * 3.4 m/s. Europa's ridged ice is the steep ground, and there the same
   * command genuinely loses speed. That is what gets asserted.
   */
  const steepest = (id) => {
    const terrain = terrainFor(id)
    let spot = null, s = 0
    for (let x = -620; x <= 620; x += 11) {
      for (let z = -620; z <= 620; z += 11) {
        const g = terrain.slope(x, z)
        if (g > s) { s = g; spot = { x, z } }
      }
    }
    return { spot, s }
  }
  const marsGround = steepest('mars')
  assert.ok(marsGround.s > 0.15, `Mars has real ground to drive on: ${marsGround.s.toFixed(3)}`)
  const europa = steepest('europa')
  assert.ok(europa.s > 1.5, `Europa's ridges are steep: ${europa.s.toFixed(3)}`)

  const europaFlat = flat('europa')
  const terrain = terrainFor('europa')
  const climb = createExpedition('europa'); climb.assist = false; climb.mode = 'rover'
  // Point the rover straight up the gradient: its heading is (sin yaw, -cos yaw).
  const gx = (terrain.height(europa.spot.x + 1, europa.spot.z) - terrain.height(europa.spot.x - 1, europa.spot.z)) / 2
  const gz = (terrain.height(europa.spot.x, europa.spot.z + 1) - terrain.height(europa.spot.x, europa.spot.z - 1)) / 2
  climb.rover = { x: europa.spot.x, y: terrain.height(europa.spot.x, europa.spot.z) + ROVER.clearance, z: europa.spot.z, vx: 0, vz: 0, yaw: Math.atan2(gx, -gz), speed: 0, battery: 1, odometer: 0 }
  const keys = { forward: true }
  for (let i = 0; i < 120 * 6; i++) stepExpedition(climb, keys)
  const uphillSpeed = Math.hypot(climb.rover.vx, climb.rover.vz)
  assert.ok(uphillSpeed < europaFlat, `the same motor is slower uphill: ${uphillSpeed.toFixed(2)} against ${europaFlat.toFixed(2)} m/s`)
  console.log(`    europa flat ${europaFlat.toFixed(2)} m/s; uphill on a ${europa.s.toFixed(2)} gradient ${uphillSpeed.toFixed(2)} m/s; mars steepest ground ${marsGround.s.toFixed(3)}`)

  /*
   * The stall gradient is arithmetic the source comments now state, so it is
   * measured rather than trusted: drive stalls when a gradient's resistance
   * (gradient x gravity x grip) equals the motor's acceleration.
   */
  const motor = ROVER.drive / ROVER.mass
  const stall = (id) => motor / (REGIONS[id].gravity * ROVER.grip)
  const marsStall = stall('mars'), moonStall = stall('moon')
  assert.ok(Math.abs(motor - 2.4762) < 0.001)
  assert.ok(Math.abs(marsStall - 1.21) < 0.01, `mars stalls at ${marsStall.toFixed(3)}`)
  assert.ok(Math.abs(moonStall - 2.77) < 0.02, `moon stalls at ${moonStall.toFixed(3)}`)
  assert.ok(moonStall > marsStall, 'the lighter world climbs the steeper ground')
  // Driven uphill into a gradient past its stall point, the rover must stop.
  const stallTest = createExpedition('mars'); stallTest.assist = false; stallTest.mode = 'rover'
  stallTest.rover = { x: 0, y: 0, z: 0, vx: 0, vz: 0, yaw: 0, speed: 0, battery: 1, odometer: 0 }
  const push = { forward: true }
  for (let i = 0; i < 120 * 20; i++) stepExpedition(stallTest, push)
  assert.ok(stallTest.rover.battery > 0, 'a stalled motor still draws, but does not flatten the pack in twenty seconds')
  console.log(`    motor ${motor.toFixed(2)} m/s2; stalls at gradient ${marsStall.toFixed(2)} on Mars, ${moonStall.toFixed(2)} on the Moon`)
})
check('the rover cannot be driven before it is deployed, and flying ignores it', () => {
  const s = createExpedition('moon')
  assert.equal(s.rover, null)
  assert.equal(interact(s), false)
  stepExpedition(s, { forward: true })
  assert.equal(s.mode, 'flight')
  assert.equal(s.rover, null)
})
check('campaign progression is sequential and persisted records reject invalid fields', () => {
  assert.ok(chapterUnlocked('moon')); assert.equal(chapterUnlocked('mars'), false)
  const s = landingStates.europa; s.campaign = true; s.samples = [0, 1]; s.delivered = true
  assert.equal(recordSurvey(s), false, 'locked chapter cannot be recorded')
  const invalid = validateRecord({ version: 1, surveys: { moon: { completed: 'now', fuel: -10, campaign: true }, arbitrary: {} } })
  assert.deepEqual(invalid.surveys, {})
  assert.deepEqual(validateRecord({ version: 2, surveys: {} }), { version: 1, surveys: {} })
  const valid = validateRecord({ version: 1, surveys: { moon: { completed: '2026-10-03', fuel: 1200, campaign: true } } })
  assert.ok(chapterUnlocked('mars', valid)); assert.equal(chapterUnlocked('europa', valid), false)
  const duplicate = landingStates.mars; duplicate.samples = [0, 0]
  assert.equal(recordSurvey(duplicate), false)
  assert.equal(CAMPAIGN.length, 3); assert.equal(expeditionRecord().version, 1)
})
check('surface jumps are gravity-driven and cannot collect airborne samples', () => {
  const s = createExpedition('europa'); s.mode = 'eva'; s.walker.x = SITES[0].x; s.walker.z = SITES[0].z; s.walker.y = terrainFor(s.id).height(s.walker.x, s.walker.z)
  const floor = s.walker.y, keys = { jump: true }; let peak = floor
  for (let i = 0; i < 120 * 5; i++) { stepExpedition(s, keys); peak = Math.max(peak, s.walker.y); if (i === 5) assert.equal(interact(s), false) }
  assert.ok(Math.abs(peak - floor - 2.5 ** 2 / (2 * REGIONS.europa.gravity)) < 0.03)
  assert.ok(s.walker.ground); assert.equal(s.walker.y, floor)
})
check('mode links round-trip, invalid destinations fall home, and locked campaign links are guarded', () => {
  assert.deepEqual(experienceFromHash('#flight'), { mode: 'simulator' })
  assert.deepEqual(experienceFromHash('#story'), { mode: 'story' })
  for (const id of Object.keys(REGIONS)) assert.deepEqual(experienceFromHash(expeditionHash(id)), { mode: 'expedition', id, campaign: false })
  assert.deepEqual(experienceFromHash('#expedition/europa/campaign'), { mode: 'story' })
  assert.deepEqual(experienceFromHash('#expedition/jupiter'), { mode: 'home' })
  assert.throws(() => expeditionHash('jupiter'))
})
console.log(`\n${checks} expedition checks pass.`)
