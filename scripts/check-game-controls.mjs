import assert from 'node:assert/strict'
import { launch, wait } from './lib/chrome.mjs'
const url = process.env.PZ_URL ?? 'http://127.0.0.1:5174'
const p = await launch({ width: 1280, height: 800 })
const click = async (name) => {
  const r = await p.evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim().startsWith(${JSON.stringify(name)}));if(!b)throw Error(${JSON.stringify(name)});const r=b.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`)
  await p.mouse('mousePressed', r.x, r.y, { clickCount: 1 }); await p.mouse('mouseReleased', r.x, r.y, { clickCount: 1 })
}
const key = (type, code, key, n) => p.send('Input.dispatchKeyEvent', { type, code, key, windowsVirtualKeyCode: n })
try {
  await p.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
  await p.goto(`${url}/#play`, 4000)
  await click('Suit up'); await wait(900); await click('Watch the prologue'); await wait(3500)
  const clock = () => p.evaluate("(()=>{const b=document.querySelector('[role=progressbar]');if(!b)throw Error('Film absent: '+document.body.innerText);return +b.getAttribute('aria-valuenow')})()")
  const before = await clock()
  // Explicit playback pause here. Browser lifecycle suspension is checked
  // against the built site separately: freezing Vite disconnects its HMR
  // socket and Vite correctly reloads rather than preserving a live module.
  await click('Pause film'); await wait(2500)
  const resumed = await clock()
  assert.equal(resumed, before, 'paused time cannot skip the film')
  await click('Resume film')
  await click('Skip to mission'); await wait(300); await click('Board your Kestrel'); await wait(6000)
  await p.key('Escape', 'Escape'); await wait(300)
  const t = await p.evaluate('__game.cine.t'); await wait(1500); assert.equal(await p.evaluate('__game.cine.t'), t)
  await click('Resume'); await wait(200); await p.key('Space', ' '); await wait(300)
  await click('Launch'); await wait(8500)
  assert.equal(await p.evaluate('__game.mode'), 'flight')
  const shots = await p.evaluate("__game.events.filter(e=>e.type==='fire'&&e.player).length")
  await p.mouse('mousePressed', 640, 280, { clickCount: 1 }); await p.mouse('mouseReleased', 640, 280, { clickCount: 1 }); await wait(400)
  const capture = await p.evaluate('({locked:!!document.pointerLockElement,fallback:__pzControls.mouse.fallback})')
  assert.ok(capture.locked || capture.fallback, 'capture or an explicit drag-to-steer fallback')
  if (capture.fallback) {
    const direction = await p.evaluate('__pzControls.aimDir.toArray()')
    await p.mouse('mousePressed', 640, 280); await p.mouse('mouseMoved', 710, 310); await p.mouse('mouseReleased', 710, 310); await wait(400)
    assert.notDeepEqual(await p.evaluate('__pzControls.aimDir.toArray()'), direction, 'fallback drag actually steers')
  }
  assert.equal(await p.evaluate("__game.events.filter(e=>e.type==='fire'&&e.player).length"), shots, 'capture does not fire')
  await key('keyDown', 'KeyW', 'w', 87); await wait(2500)
  const v = await p.evaluate('__game.player.vel.length()')
  assert.equal(await p.evaluate('__game.player.ctrl.throttle'), 1)
  await key('keyUp', 'KeyW', 'w', 87); await wait(6000)
  assert.equal(await p.evaluate('__game.player.ctrl.throttle'), 0)
  assert.ok(await p.evaluate('__game.player.vel.length()') < v)
  await p.key('Escape', 'Escape'); await wait(300); await click('Settings'); await wait(300)
  await p.evaluate("(()=>{const s=document.querySelector('.gm-settings select');s.value='latched';s.dispatchEvent(new Event('change',{bubbles:true}))})()")
  await click('Done'); await wait(300)
  await key('keyDown', 'KeyW', 'w', 87); await wait(700); await key('keyUp', 'KeyW', 'w', 87)
  const throttle = await p.evaluate('__game.player.ctrl.throttle'); await wait(800)
  assert.ok(throttle > 0.2); assert.equal(await p.evaluate('__game.player.ctrl.throttle'), throttle)
  assert.equal(await p.evaluate("localStorage.getItem('pz-throttle-mode')"), 'latched')
  const errors = p.logs().filter(l => /^error/.test(l)); assert.deepEqual(errors, [])
  console.log(JSON.stringify({ pausedFilmClock: { before, resumed }, holdFlightSpeed: v, latchedThrottle: throttle, capture, errors }, null, 2))
} finally { p.close() }
process.exit(0)
