import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { launch, wait } from './lib/chrome.mjs'

const url = process.env.PZ_URL ?? 'http://127.0.0.1:5174'
const out = process.env.PZ_SHOTS ?? '.freebuff/opening'
mkdirSync(out, { recursive: true })
const p = await launch({ width: 1440, height: 900 })
const dev = process.env.PZ_DEV === '1'
const start = Date.now()
const report = { url, chapters: [], frames: {}, audio: [], errors: [] }
const click = async (label) => {
  const point = await p.evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim().startsWith(${JSON.stringify(label)})); if(!b)throw Error('Missing button: '+${JSON.stringify(label)}); const r=b.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`)
  await p.mouse('mousePressed', point.x, point.y, { clickCount: 1 }); await p.mouse('mouseReleased', point.x, point.y, { clickCount: 1 })
}
const text = () => p.evaluate('document.body.innerText')
const shot = async (name) => writeFileSync(`${out}/${name}.jpg`, await p.shot('jpeg', 86))
const frames = () => p.evaluate(`new Promise(resolve=>{const a=[];let prev=performance.now();function f(t){a.push(t-prev);prev=t;if(a.length<180)requestAnimationFrame(f);else{a.sort((a,b)=>a-b);resolve({median:a[90],p95:a[171],samples:a.length})}}requestAnimationFrame(f)})`)
// The film's own verdict about this machine, and the count of frames it has
// actually drawn. The count comes from inside the film's canvas loop, so it is
// the honest measure of what a paused film costs: reading the canvas instead
// would not work, because a WebGL canvas without a preserved drawing buffer
// hands back a black image to anyone who samples it.
const filmState = () => p.evaluate('window.__pzFilm ? {tier:__pzFilm.tier,fast:__pzFilm.fast,dpr:__pzFilm.dpr,pace:__pzFilm.pace,slow:__pzFilm.slow,windows:__pzFilm.windows,frames:__pzFilm.frames} : null')
const drawn = async () => (await filmState())?.frames ?? -1
try {
  await p.goto(`${url}/`, 2000)
  await p.evaluate("localStorage.removeItem('pz-game-v1'); localStorage.removeItem('pz-game-quality'); localStorage.removeItem('pz-throttle-mode'); localStorage.setItem('pz-sky','off')")
  await p.goto(`${url}/#play`, 2500)
  await click('Suit up'); await wait(500); await click('Watch the prologue')
  await wait(7000)
  assert.match(await text(), /PERIAPSIS ZERO \/ PROLOGUE/)
  // The film measures its own frames, but not before its four ships have
  // arrived and two and a half seconds have passed since: on a cold cache that
  // is ten seconds into the film and not five, so this waits for the event
  // rather than assuming when it happens. The hook is development-only, like
  // every other one in this file.
  if (dev) {
    // Sample the film's own verdict for sixteen seconds: long enough for its
    // windows to start closing, and long enough to see one go slow if they do.
    let film = null
    const history = []
    for (let i = 0; i < 32; i++) {
      film = await filmState()
      if (film) history.push({ windows: film.windows, pace: +film.pace.toFixed(1), slow: film.slow })
      if (film?.pace > 0 && i >= 12) break
      await wait(500)
    }
    report.film = film
    report.filmHistory = history
    assert.ok(film, 'the film exposes its own tier and pace in development')
    assert.ok(film.pace > 0 && film.pace < 250, `the film reports a pace of ${film?.pace} ms a frame`)
    // And it is drawing: a count over two seconds, because the cold-cache
    // seconds of a first visit are long frames on any machine and the claim
    // here is that the film is being drawn, not that it is being drawn fast.
    const a = await drawn()
    await wait(2000)
    const b = await drawn()
    report.filmDrawn = { playing: b - a, ms: 2000, tier: film.tier }
    assert.ok(b - a >= 20, `the film draws while it plays (${b - a} frames in 2 s, tier ${film.tier})`)
  }
  await click('Pause film'); await wait(400)
  const at = await p.evaluate("document.querySelector('[role=progressbar]').getAttribute('aria-valuenow')")
  await wait(1500)
  assert.equal(await p.evaluate("document.querySelector('[role=progressbar]').getAttribute('aria-valuenow')"), at)
  // A paused film stops drawing altogether: not one frame in a second and a
  // half, and drawing again the moment it is resumed. The picture it leaves on
  // screen is checked by eye in the paused screenshot this run writes.
  if (dev) {
    const c = await drawn()
    await wait(1500)
    const d = await drawn()
    report.pausedFilm = { frozen: d - c === 0 }
    assert.equal(d - c, 0, 'a paused film draws not one frame')
    await shot('01-earth-paused')
    await click('Mute narrator'); assert.equal(await p.evaluate('document.querySelector("audio").volume'), 0)
    await click('Unmute narrator'); await click('Resume film'); await wait(2000)
    const e = await drawn()
    report.pausedFilm.resumedDrawing = e - d
    assert.ok(e - d >= 20, `and draws again the moment it is resumed (${e - d} frames in 2 s)`)
  } else {
    await wait(1500)
    await shot('01-earth-paused')
    await click('Mute narrator'); assert.equal(await p.evaluate('document.querySelector("audio").volume'), 0)
    await click('Unmute narrator'); await click('Resume film')
  }
  let chapter = ''
  for (let i = 0; i < 145; i++) {
    const state = await p.evaluate(`({brief:!!document.querySelector('.film-brief'),title:document.querySelector('.film-chapter h1')?.textContent,audio:document.querySelector('audio') ? {source:document.querySelector('audio').currentSrc,duration:document.querySelector('audio').duration,time:document.querySelector('audio').currentTime,paused:document.querySelector('audio').paused,error:document.querySelector('audio').error?.code} : null})`)
    if (state.brief) break
    if (state.title && state.title !== chapter) { chapter = state.title; report.chapters.push(chapter); await wait(1000); report.audio.push(await p.evaluate(`(()=>{const a=document.querySelector('audio');return {source:a.currentSrc,duration:a.duration,time:a.currentTime,paused:a.paused,error:a.error?.code}})()`)); await shot(`chapter-${report.chapters.length}`) }
    await wait(1000)
  }
  assert.equal(report.chapters.length, 6, JSON.stringify(report.chapters))
  // The film tunes itself and says nothing about the game: this canvas is two
  // full-screen six-octave Earth shaders and a bloom pass, and the game is
  // hulls in a bay. Whatever pace it measured, storage is untouched.
  report.learned = (await p.evaluate("localStorage.getItem('pz-game-tier')")) ?? null
  assert.equal(report.learned, null, `the film must not decide the game's tier (asked: ${report.film?.pace} ms, windows ${JSON.stringify(report.filmHistory?.slice(-4))})`)
  report.filmSlow = report.film?.slow
  assert.match(await text(), /Your mission/i)
  await shot('07-mission')
  await click('Replay film'); await wait(1000); await click('Skip to mission'); await wait(300)
  assert.match(await text(), /₡ 1,500/)
  await click('Board your Kestrel'); await wait(3500); await shot('08-skywalk')
  // Pause must freeze the boarding camera and actor, not just gameplay.
  await p.key('Escape', 'Escape'); await wait(300)
  if (dev) {
    const t = await p.evaluate('window.__game.cine.t')
    await wait(1200); assert.equal(await p.evaluate('window.__game.cine.t'), t)
  }
  await click('Resume'); await wait(6500); await shot('09-bay')
  await wait(5500); await shot('10-crossing')
  await wait(4500); await shot('11-entry')
  // Boarding runs on rendered time, not wall time: wait for the visible
  // station menu on software GPUs rather than assuming a frame rate.
  for (let i = 0; i < 90 && !await p.evaluate("!!document.querySelector('.st-go')"); i++) await wait(1000)
  assert.match(await text(), /Hearth Station/i)
  await shot('12-station')
  report.frames.bay = await frames()
  report.audioHealth = report.audio.map((a) => ({ ...a, valid: Number.isFinite(a?.duration) && !a?.error }))
  assert.ok(report.audioHealth.every((a) => a.valid), 'all six narration files decode')
  await click('Launch')
  for (let i = 0; i < 60 && !(await text()).includes('Click the view to take the stick'); i++) await wait(1000)
  assert.match(await text(), /Click the view to take the stick/)
  await shot('13-flight')
  if (dev) {
    await p.send('Input.dispatchKeyEvent', { type: 'keyDown', code: 'KeyW', key: 'w', windowsVirtualKeyCode: 87 })
    await wait(2200)
    const flying = await p.evaluate('({speed:__game.player.vel.length(),throttle:__game.player.ctrl.throttle})')
    assert.equal(flying.throttle, 1); assert.ok(flying.speed > 1)
    await p.send('Input.dispatchKeyEvent', { type: 'keyUp', code: 'KeyW', key: 'w', windowsVirtualKeyCode: 87 })
    await wait(6000)
    const braking = await p.evaluate('({speed:__game.player.vel.length(),throttle:__game.player.ctrl.throttle})')
    assert.equal(braking.throttle, 0); assert.ok(braking.speed < flying.speed)
    report.handling = { flying, braking }
  }
  report.frames.flight = await frames()
  await p.key('Escape', 'Escape'); await wait(300); await click('Settings'); await wait(300)
  assert.match(await text(), /Throttle style/)
  await shot('14-settings')
  await p.send('Emulation.setDeviceMetricsOverride', { width: 1024, height: 768, deviceScaleFactor: 1, mobile: false })
  await shot('15-tablet-settings')
  await click('Done'); await wait(300)
  if (dev) {
    await p.evaluate("__game.cine={kind:'board',t:21}; __game.mode='docked'; __game.docked='hearth'")
    await wait(300); await shot('16-cockpit-entry-close')
  }
  report.errors = p.logs().filter((l) => /^error/.test(l))
  assert.deepEqual(report.errors, [])
  report.seconds = (Date.now() - start) / 1000
  console.log(JSON.stringify(report, null, 2))
  writeFileSync(`${out}/results.json`, JSON.stringify(report, null, 2))
} finally { p.close() }
process.exit(0)
