import * as THREE from 'three'

/**
 * Input: keyboard and mouse, or touch, into one controls object the game
 * reads each step (core/game.js `stepGame`).
 *
 * Mouse flight: with the pointer captured, the mouse moves an aim point and
 * the camera looks along it; the ship turns to follow at its own rate, so a
 * heavy hull lags the cursor and a light one snaps to it. The aim is where
 * the guns go. Without the pointer (or on touch), a stick commands turn rates
 * directly and the camera rides behind the ship.
 */
export const KEYS = {
  thrustUp: ['KeyW'], thrustDown: ['KeyS'], left: ['KeyA'], right: ['KeyD'], up: ['Space'], down: ['KeyC'],
  rollLeft: ['KeyQ'], rollRight: ['KeyE'], boost: ['ShiftLeft', 'ShiftRight'],
  pitchUp: ['ArrowUp'], pitchDown: ['ArrowDown'], yawLeft: ['ArrowLeft'], yawRight: ['ArrowRight'], fire: ['KeyK'],
}
/** One-shot keys: game actions go to the core, the rest to the interface. */
const ACTIONS = { KeyZ: 'fa', KeyX: 'stop', KeyF: 'dock', KeyT: 'target', KeyJ: 'transfer', KeyL: 'launch', Enter: 'launch' }
const ROLL_TAP = { KeyA: 'roll-left', KeyQ: 'roll-left', KeyD: 'roll-right', KeyE: 'roll-right' }
const UI = { KeyM: 'map', Tab: 'log', KeyH: 'help', Escape: 'pause', KeyP: 'pause', KeyR: 'respawn' }

export function createControls() {
  return {
    actions: [], throttleRate: 0, throttleSet: null, strafeX: 0, strafeY: 0, pitch: 0, yaw: 0, roll: 0, boost: false, fire: false, aim: null,
    keys: new Set(), mouse: { dx: 0, dy: 0, locked: false, down: false }, aimDir: new THREE.Vector3(0, 0, -1), aiming: false,
    touch: { active: false, x: 0, y: 0, fire: false, boost: false },
    settings: { sensitivity: 1, invert: false },
  }
}

const has = (c, list) => list.some((k) => c.keys.has(k))

/** Keyboard and mouse. `onUi` hears the interface's keys; returns a cleanup. */
export function bindDesktop(c, canvas, onUi) {
  const typing = (e) => /input|textarea|select/i.test(e.target?.tagName ?? '')
  const down = (e) => {
    if (typing(e)) return
    if (UI[e.code]) { if (e.code === 'Tab') e.preventDefault(); onUi(UI[e.code], e); return }
    if (e.repeat) { c.keys.add(e.code); return }
    c.keys.add(e.code)
    // A double tap of a strafe or roll key is a barrel roll that way.
    const roll = ROLL_TAP[e.code]
    if (roll) { const now = performance.now(); if (c.lastTap?.code === e.code && now - c.lastTap.at < 280) { c.actions.push(roll); c.lastTap = null } else c.lastTap = { code: e.code, at: now } }
    if (ACTIONS[e.code]) c.actions.push(ACTIONS[e.code])
    if (e.code === 'Space') e.preventDefault()
  }
  const up = (e) => { c.keys.delete(e.code) }
  const blur = () => { c.keys.clear(); c.mouse.down = false }
  const move = (e) => { if (c.mouse.locked) { c.mouse.dx += e.movementX; c.mouse.dy += e.movementY } }
  const mdown = (e) => {
    if (e.button === 0) { c.mouse.down = true; if (!c.mouse.locked && c.wantLock?.()) canvas.requestPointerLock?.() }
    if (e.button === 2) c.actions.push('target')
  }
  const mup = (e) => { if (e.button === 0) c.mouse.down = false }
  const lock = () => { c.mouse.locked = document.pointerLockElement === canvas; if (!c.mouse.locked) { c.mouse.down = false; onUi('unlocked') } }
  const menu = (e) => e.preventDefault()
  window.addEventListener('keydown', down)
  window.addEventListener('keyup', up)
  window.addEventListener('blur', blur)
  document.addEventListener('mousemove', move)
  canvas.addEventListener('mousedown', mdown)
  window.addEventListener('mouseup', mup)
  canvas.addEventListener('contextmenu', menu)
  document.addEventListener('pointerlockchange', lock)
  return () => {
    window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); window.removeEventListener('blur', blur)
    document.removeEventListener('mousemove', move); canvas.removeEventListener('mousedown', mdown); window.removeEventListener('mouseup', mup)
    canvas.removeEventListener('contextmenu', menu); document.removeEventListener('pointerlockchange', lock)
    if (document.pointerLockElement === canvas) document.exitPointerLock?.()
  }
}

const _q = new THREE.Quaternion(), _f = new THREE.Vector3(), _r = new THREE.Vector3(), _u = new THREE.Vector3()

/**
 * Turn the raw state into this frame's commands. `ship` is the player's
 * ship; `camUp` and `camRight` are the camera's axes, which the mouse moves
 * the aim around.
 */
export function resolveInput(c, ship, camera, flying) {
  c.throttleRate = (has(c, KEYS.thrustUp) ? 1 : 0) - (has(c, KEYS.thrustDown) ? 1 : 0)
  c.strafeX = (has(c, KEYS.right) ? 1 : 0) - (has(c, KEYS.left) ? 1 : 0)
  c.strafeY = (has(c, KEYS.up) ? 1 : 0) - (has(c, KEYS.down) ? 1 : 0)
  c.roll = (has(c, KEYS.rollLeft) ? 1 : 0) - (has(c, KEYS.rollRight) ? 1 : 0)
  c.boost = has(c, KEYS.boost) || c.touch.boost
  c.fire = flying && (c.mouse.down || has(c, KEYS.fire) || c.touch.fire)
  _f.set(0, 0, -1).applyQuaternion(ship.q)
  if (c.mouse.locked && flying) {
    // The aim point moves with the mouse, round the camera's own axes.
    const s = 0.0022 * c.settings.sensitivity
    _u.set(0, 1, 0).applyQuaternion(camera.quaternion)
    _r.set(1, 0, 0).applyQuaternion(camera.quaternion)
    _q.setFromAxisAngle(_u, -c.mouse.dx * s); c.aimDir.applyQuaternion(_q)
    _q.setFromAxisAngle(_r, -c.mouse.dy * s * (c.settings.invert ? -1 : 1)); c.aimDir.applyQuaternion(_q)
    // Never let the aim run more than 70 degrees off the nose: the ship
    // could not follow and the camera would lose it.
    const off = c.aimDir.angleTo(_f)
    if (off > 1.22) c.aimDir.lerp(_f, 1 - 1.22 / off).normalize()
    c.aimDir.normalize()
    c.aim = c.aimDir
    c.aiming = true
  } else {
    c.aimDir.copy(_f)
    c.aim = null
    c.aiming = false
    const kx = (has(c, KEYS.yawRight) ? 1 : 0) - (has(c, KEYS.yawLeft) ? 1 : 0)
    const ky = (has(c, KEYS.pitchUp) ? 1 : 0) - (has(c, KEYS.pitchDown) ? 1 : 0)
    // Positive yaw turns left and positive pitch lifts the nose (flight.js).
    c.yaw = -(c.touch.active ? c.touch.x : kx)
    c.pitch = c.touch.active ? c.touch.y : ky
  }
  // On a burn, any steering holds the thrust line: keys, the mouse, or the stick.
  c.burnX = (has(c, KEYS.right) || has(c, KEYS.yawRight) ? 1 : 0) - (has(c, KEYS.left) || has(c, KEYS.yawLeft) ? 1 : 0) + c.mouse.dx * 0.06 + (c.touch.active ? c.touch.x : 0)
  c.burnY = (has(c, KEYS.thrustUp) || has(c, KEYS.pitchUp) ? 1 : 0) - (has(c, KEYS.thrustDown) || has(c, KEYS.pitchDown) ? 1 : 0) - c.mouse.dy * 0.06 * (c.settings.invert ? -1 : 1) + (c.touch.active ? c.touch.y : 0)
  c.mouse.dx = 0; c.mouse.dy = 0
}

/** Is this a phone? Small screen, coarse pointer. Tablets and computers play. */
export function isPhone() {
  const coarse = window.matchMedia?.('(pointer: coarse)').matches
  const small = Math.min(window.screen?.width ?? 1e4, window.screen?.height ?? 1e4) < 600
  return Boolean(coarse && small)
}
export const isTouch = () => Boolean(window.matchMedia?.('(pointer: coarse)').matches || navigator.maxTouchPoints > 1 && !window.matchMedia?.('(pointer: fine)').matches)
