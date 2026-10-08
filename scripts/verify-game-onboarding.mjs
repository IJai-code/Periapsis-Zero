import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as THREE from 'three'
import { EPOCH, newSave, startGame, saveData } from '../src/game/core/game.js'
import { mission, storyTick, storyObjective, TRAINING_TARGETS, TUTORIAL_VERSION } from '../src/game/core/story.js'
import { FIXED_STEP, createExpedition, stepExpedition, terrainFor, ROVER, WORLDS } from '../src/sim/expedition.js'

let checks = 0
const check = (name, fn) => { fn(); checks++; console.log(`  ✓ ${name}`) }
check('3091 is the game epoch; historical simulator dates are not rewritten', () => {
  assert.equal(new Date(EPOCH).getUTCFullYear(), 3091)
  assert.equal(newSave('Pilot').story.tutorialVersion, TUTORIAL_VERSION)
})
check('old tutorial steps migrate once, preserving learned skills and completed campaigns', () => {
  for (const [old, next] of [[0, 0], [1, 3], [2, 5], [3, 6], [4, 8], [5, 9]]) {
    const s = newSave('Returning'); delete s.story.tutorialVersion; s.story.step = old
    const g = startGame(s)
    assert.equal(g.story.step, next)
    assert.equal(startGame(saveData(g)).story.step, next, 'must not migrate twice')
  }
  const s = newSave('Veteran'); s.story = { active: null, step: 0, done: ['arrival'], choice: 'chen' }
  const g = startGame(s)
  assert.equal(g.story.active, null); assert.deepEqual(g.story.done, ['arrival'])
})
check('movement and braking are separate checks and cannot auto-complete while docked', () => {
  const g = startGame(newSave('Learner')), steps = mission('arrival').steps
  g.story.step = 1; g.player.ctrl.throttle = 1; g.player.vel.set(0, 0, -100)
  assert.equal(steps[1].done(g), false)
  g.mode = 'flight'; assert.equal(steps[1].done(g), true)
  g.story.step = 2; g.player.ctrl.throttle = 0
  assert.equal(steps[2].done(g), false)
  g.player.vel.set(0, 0, -4); assert.equal(steps[2].done(g), true)
  assert.equal(steps[4].done(g), false, 'boost must actually be used')
  g.player.boosting = true; assert.equal(steps[4].done(g), true)
})
check('training arrival uses the displayed radius, rejects near misses and announces each checkpoint once', () => {
  for (const [i, step] of [[0, 3], [1, 5]]) {
    const g = startGame(newSave('Navigator')); g.mode = 'flight'; g.story.step = step
    const t = TRAINING_TARGETS[i]
    assert.equal(storyObjective(g).radius, t.radius)
    assert.equal(storyObjective(g).label, t.label)
    g.player.pos.copy(t.at).add(new THREE.Vector3(t.radius + 1, 0, 0))
    storyTick(g); assert.equal(g.story.step, step, 'outside the zone is not arrival')
    g.player.pos.copy(t.at).add(new THREE.Vector3(t.radius, 0, 0))
    storyTick(g); assert.equal(g.story.step, step + 1, 'boundary counts, no dwell needed')
    assert.match(g.events.at(-1).text, /checkpoint reached/i)
    assert.equal(g.events.filter(e => e.type === 'objective-done').length, 1)
  }
})
check('targeting and firing are separate lessons; a restored weapons lesson rebuilds its drone', () => {
  const g = startGame(newSave('Defender')); g.mode = 'flight'; g.story.step = 7
  storyTick(g)
  const drone = g.ships.find(e => e.tag === 'm:drone')
  assert.ok(drone); assert.equal(drone.stats.guns, 0)
  assert.equal(g.story.step, 7)
  g.target = drone.id; storyTick(g); assert.equal(g.story.step, 8)
  const restored = startGame(saveData(g)); restored.mode = 'flight'; storyTick(restored)
  assert.ok(restored.ships.some(e => e.tag === 'm:drone'))
})
check('rover render forward agrees with SI movement for all headings; D is right and A is left', () => {
  const source = readFileSync('src/components/ExpeditionScene.jsx', 'utf8')
  assert.match(source, /rotation\.set\(Math\.atan2\(ahead - behind, 2\.4\), -r\.yaw/)
  for (const yaw of [0, 0.4, Math.PI / 2, -Math.PI / 2, Math.PI]) {
    const forward = new THREE.Vector3(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), -yaw)
    assert.ok(Math.abs(forward.x - Math.sin(yaw)) < 1e-9)
    assert.ok(Math.abs(forward.z + Math.cos(yaw)) < 1e-9)
  }
  const s = createExpedition('moon'); s.mode = 'rover'; s.landed = false
  s.rover = { x: 0, z: 0, y: ROVER.clearance, vx: 0, vz: 0, speed: 0, yaw: 0, battery: 1, odometer: 0 }
  stepExpedition(s, { right: true }); assert.ok(s.rover.yaw > 0)
  s.rover.yaw = 0; stepExpedition(s, { left: true }); assert.ok(s.rover.yaw < 0)
})
check('sideways rover slip is reduced by bounded traction, not teleported into the new heading', () => {
  const t = terrainFor('moon'), height = t.height
  // Controlled flat patch isolates traction from slope and rocks near the pad.
  t.height = () => 0
  try {
    const s = createExpedition('moon'); s.mode = 'rover'; s.landed = false
    s.rover = { x: 0, z: 0, y: ROVER.clearance, vx: 1, vz: 0, speed: 1, yaw: 0, battery: 1, odometer: 0 }
    stepExpedition(s, {})
    const roll = 1 - FIXED_STEP * 0.55
    assert.ok(Math.abs(s.rover.vx - (1 - WORLDS.moon.gravity * ROVER.grip * FIXED_STEP) * roll) < 1e-9)
    assert.ok(s.rover.vx > 0.9, 'no instantaneous stop')
    for (let i = 0; i < 120 * 2; i++) stepExpedition(s, {})
    assert.ok(Math.abs(s.rover.vx) < 0.001)
  } finally { t.height = height }
})
console.log(`\n${checks} onboarding and rover checks pass.`)
