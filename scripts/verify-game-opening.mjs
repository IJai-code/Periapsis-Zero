import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as THREE from 'three'
import { advancePrologue, FIRST_MISSION, PROLOGUE, PROLOGUE_SECONDS, prologueAt } from '../src/game/core/prologue.js'
import { BOARD_T, BOARD_DUR, BOARD_SEATED, COCKPIT, boardPose, bridgeEnds } from '../src/game/core/boarding.js'
import { createControls, resolveInput } from '../src/game/ui/controls.js'
import { playerShip, stepShip } from '../src/game/core/flight.js'
import { pilot, startGame, newSave } from '../src/game/core/game.js'

let checks = 0
const check = (name, fn) => { fn(); checks++; console.log(`  ✓ ${name}`) }
check('the six-shot film runs exactly 120 seconds with no missing chapter or caption', () => {
  assert.equal(PROLOGUE_SECONDS, 120)
  assert.equal(PROLOGUE[0].start, 0)
  for (let i = 0; i < PROLOGUE.length; i++) {
    const c = PROLOGUE[i]
    assert.equal(c.start, i ? PROLOGUE[i - 1].end : 0)
    assert.ok(c.end > c.start)
    assert.equal(c.captions[0][0], 0)
    for (const [at, text] of c.captions) { assert.ok(at >= 0 && at < c.end - c.start); assert.ok(text.length > 15); assert.ok(!text.includes('—')) }
    assert.equal(prologueAt(c.start).chapter.id, c.id)
    const audio = readFileSync(`public/audio/prologue/${c.audio}.m4a`)
    assert.equal(audio.toString('ascii', 4, 8), 'ftyp')
    assert.ok(audio.length > 10000 && audio.length < 180000)
  }
  assert.equal(PROLOGUE.at(-1).end, 120)
  assert.equal(prologueAt(119.9).complete, false); assert.equal(prologueAt(120).complete, true)
  assert.equal(prologueAt(-4).progress, 0); assert.equal(prologueAt(Infinity).progress, 0)
  assert.match(FIRST_MISSION.premise, /Aster/); assert.equal(FIRST_MISSION.steps.length, 3)
})
check('pause and hidden tabs never consume the opening film', () => {
  assert.equal(advancePrologue(18, 20, true, false), 18)
  assert.equal(advancePrologue(18, 20, false, true), 18)
  assert.equal(advancePrologue(18, 2, false, false), 20)
  assert.equal(advancePrologue(119, 5, false, false), 120)
})
check('boarding is continuous after its explicit outside-to-inside cut, at a walk, on every player hull', () => {
  const pose = { pos: new THREE.Vector3() }, previous = new THREE.Vector3(), a = new THREE.Vector3(), b = new THREE.Vector3()
  assert.ok(BOARD_DUR > 20 && BOARD_DUR < 35)
  for (const hull of Object.keys(COCKPIT)) {
    const phases = new Set()
    for (let t = 0; t < BOARD_DUR + 0.01; t += 1 / 120) {
      boardPose(hull, t, pose); phases.add(pose.phase)
      if (t > 0 && Math.abs(t - BOARD_T.outside) > 1 / 60) assert.ok(pose.pos.distanceTo(previous) < 3 / 120, `${hull} at ${t}: ${pose.pos.distanceTo(previous) * 120} m/s`)
      assert.ok(Number.isFinite(pose.heading)); assert.ok(pose.bridge >= 0 && pose.bridge <= 1)
      previous.copy(pose.pos)
    }
    assert.equal(phases.size, 6)
    bridgeEnds(hull, a, b)
    const crossEnd = BOARD_SEATED - BOARD_T.climb
    boardPose(hull, crossEnd - 1e-7, pose)
    assert.ok(pose.pos.distanceTo(b) < 0.001)
    boardPose(hull, BOARD_DUR - 0.01, pose); assert.equal(pose.hidden, false); assert.equal(pose.bridge, 0)
    boardPose(hull, BOARD_DUR + 0.01, pose); assert.equal(pose.hidden, true)
  }
})
check('simple controls request flight only while W is held; assist-off release coasts; latched controls remain available', () => {
  const c = createControls(), ship = playerShip('kestrel', {}), cam = new THREE.PerspectiveCamera()
  c.keys.add('KeyW'); resolveInput(c, ship, cam, true); assert.equal(c.throttleSet, 1)
  c.keys.clear(); resolveInput(c, ship, cam, true); assert.equal(c.throttleSet, 0)
  ship.ctrl.fa = false; resolveInput(c, ship, cam, true); assert.equal(c.throttleSet, 0)
  c.keys.add('KeyS'); resolveInput(c, ship, cam, true); assert.equal(c.throttleSet, -0.3)
  c.settings.throttle = 'latched'; c.throttleSet = null; c.keys.clear(); c.keys.add('KeyW')
  resolveInput(c, ship, cam, true); assert.equal(c.throttleRate, 1); assert.equal(c.throttleSet, null)
  c.settings.throttle = 'hold'; c.throttleSet = null
  resolveInput(c, ship, cam, false); assert.equal(c.throttleSet, null)
  c.touch.enabled = true; c.throttleSet = 0.7; resolveInput(c, ship, cam, true); assert.equal(c.throttleSet, 0.7, 'tablet throttle survives idle stick')
  c.touch.enabled = false
  c.mouse.fallback = true; c.mouse.down = true; c.mouse.dx = 20
  resolveInput(c, ship, cam, true); assert.equal(c.aiming, true); assert.equal(c.fire, false)
  c.keys.add('KeyK'); resolveInput(c, ship, cam, true); assert.equal(c.fire, true)
  c.keys.add('ArrowRight'); resolveInput(c, ship, cam, true)
  assert.equal(c.aiming, false); assert.equal(c.aim, null); assert.equal(c.yaw, -1, 'arrow steering works after pointer capture or fallback')
})
check('manual coasting preserves high-speed momentum after boost ends; braking spends finite acceleration', () => {
  const s = playerShip('kestrel', {}); s.ctrl.fa = false; s.vel.set(400, -80, -1500)
  const v = s.vel.clone()
  for (let i = 0; i < 600; i++) stepShip(s, 1 / 60, i / 60)
  assert.ok(s.vel.distanceTo(v) < 1e-8, 'no hidden velocity cap')
  s.ctrl.fa = true; s.ctrl.throttle = 0
  stepShip(s, 1 / 60, 11)
  assert.ok(s.vel.length() > 1400, 'no instantaneous stop')
  assert.ok(s.vel.distanceTo(v) <= Math.hypot(s.stats.lateral, s.stats.lateral, s.stats.accel * 0.6) / 60 + 1e-8)
  const g = startGame(newSave('Holding'))
  pilot(g, g.player, { throttleSet: 0 }, 1 / 60); assert.equal(g.player.ctrl.throttle, 0)
})
console.log(`\n${checks} opening/controls/physics checks pass.`)
