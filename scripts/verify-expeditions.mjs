import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'
import { altitude, CAMPAIGN, chapterUnlocked, createExpedition, expeditionRecord, FIXED_STEP, interact, launch, recordSurvey, REGIONS, SITES, stepExpedition, terrainFor, validateRecord, VEHICLE } from '../src/sim/expedition.js'
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
check('survey requires real proximity, paired samples, and return to the landed vehicle', () => {
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
  assert.equal(recordSurvey(s), false)
  Object.assign(s.walker, { x: s.x + 7, z: s.z, ground: true })
  assert.ok(interact(s)); assert.ok(s.delivered); assert.ok(recordSurvey(s))
  assert.equal(chapterUnlocked('europa'), false, 'free-play completion must not unlock story chapters')
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
