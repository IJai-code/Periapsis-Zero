import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { launch, wait } from './lib/chrome.mjs'

const url = process.env.PZ_REVIEW_URL ?? 'http://127.0.0.1:4186'
const out = process.env.PZ_REVIEW_OUT ?? 'docs/remake-review'
mkdirSync(out, { recursive: true })
const report = []
async function click(page, text) {
  for (let i = 0; i < 60; i++) {
    const rect = await page.evaluate(`(() => { const b = [...document.querySelectorAll('button,a')].find(b => b.textContent.replace(/\\s+/g,' ').trim().toLowerCase() === ${JSON.stringify(text)}.replace(/\\s+/g,' ').trim().toLowerCase()); if (!b) return null; b.scrollIntoView({block:'center'}); const r=b.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}; })()`)
    if (rect) { await page.mouse('mousePressed', rect.x, rect.y, { clickCount: 1 }); await page.mouse('mouseReleased', rect.x, rect.y, { clickCount: 1 }); await wait(350); return }
    await wait(200)
  }
  throw new Error(`Control not found: ${text}`)
}
async function text(page, expected) {
  for (let i = 0; i < 100; i++) { if ((await page.evaluate('document.body.innerText')).includes(expected)) return; await wait(200) }
  throw new Error(`Expected page text: ${expected}`)
}
async function shot(page, name) { writeFileSync(`${out}/${name}.png`, await page.shot()) }
async function layout(page) {
  return page.evaluate(`({width:innerWidth,overflow:document.querySelector('.tt-root')?.scrollWidth > innerWidth,buttons:[...document.querySelectorAll('button')].filter(b=>b.getBoundingClientRect().height>0).map(b=>({text:b.textContent.trim(),height:b.getBoundingClientRect().height})).filter(b=>b.height<36)})`)
}
const page = await launch({ width: 1440, height: 900 })
try {
  await page.goto(url)
  await text(page, 'Skip to your career')
  await shot(page, 'hub-desktop')
  assert.equal((await layout(page)).overflow, false)
  await click(page, 'Flight school')
  await text(page, 'Real flight.')
  const links = await page.evaluate("[...document.querySelectorAll('.tt-training a')].map(a=>a.getAttribute('href'))")
  assert.equal(links.length, 5)
  assert.ok(links.every(l => l.includes('preset=') && l.endsWith('#flight')))
  await shot(page, 'school-desktop')
  await click(page, 'Start orbital training →')
  await text(page, 'PERIAPSIS ZERO')
  await wait(6000)
  assert.ok(await page.evaluate("Boolean(document.querySelector('canvas'))"), 'orbital training canvas')
  await shot(page, 'simulator-training')
  await page.goto(url)
  await text(page, 'Skip to your career')
  await click(page, 'Flight school')
  await click(page, 'Explore')
  assert.equal(await page.evaluate("document.querySelectorAll('.tt-worlds button').length"), 13)
  await click(page, 'Career')
  await click(page, 'Skip to your career')
  await text(page, 'Choose your suit')
  await click(page, 'Suit up')
  await text(page, 'Watch the prologue')
  await click(page, 'Watch the prologue')
  await text(page, 'Everything we needed')
  await wait(3000)
  await shot(page, 'earth-after')
  const frames = await page.evaluate(`new Promise(resolve=>{const times=[];let last=performance.now();function frame(now){times.push(now-last);last=now;if(times.length===180){times.sort((a,b)=>a-b);resolve({p50:times[90],p95:times[171]})}else requestAnimationFrame(frame)}requestAnimationFrame(frame)})`)
  report.push({ check: 'Earth prologue frame intervals (headless Chrome, not user hardware)', ...frames })
  await shot(page, 'earth-after-late')
  await click(page, 'Pause film')
  const paused = await page.evaluate("document.querySelector('.film-progress').getAttribute('aria-valuenow')")
  await wait(1200)
  assert.equal(await page.evaluate("document.querySelector('.film-progress').getAttribute('aria-valuenow')"), paused)
  await click(page, 'Resume film')
  await wait(12000)
  await shot(page, 'convoy-after')
  await click(page, 'Skip to mission Space')
  await text(page, 'Board your Kestrel')
  await click(page, 'Board your Kestrel')
  await text(page, 'Flight clearance pending')
  await click(page, 'SkipSpace')
  await text(page, 'BEGIN FLIGHT CHECK')
  await shot(page, 'station-desktop')
  await click(page, 'Begin flight checkEnter')
  await text(page, 'Make the ship move')
  await shot(page, 'flight-desktop')
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', code: 'KeyW', key: 'w', windowsVirtualKeyCode: 87 })
  await wait(2000)
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', code: 'KeyW', key: 'w', windowsVirtualKeyCode: 87 })
  await text(page, 'Learn to stop')
  await text(page, 'Reach the orange checkpoint')
  await shot(page, 'flight-checkpoint')
  await click(page, 'EscMenu')
  await click(page, 'Save career and enter flight school')
  await text(page, 'Real flight.')
  assert.ok(await page.evaluate("JSON.parse(localStorage.getItem('pz-game-v1'))?.pilot?.name"))
  await click(page, 'Return to career →')
  await text(page, 'HEARTH STATION')
  report.push({ check: 'Desktop: hub → prologue → berth → thrust → brake → checkpoint → school → saved career', passed: true })
  const errors = page.logs().filter(l=>/^error:/.test(l))
  assert.deepEqual(errors, [], 'browser errors')
} finally { page.close() }
const mobile = await launch({ width: 390, height: 844 })
try {
  await mobile.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
  await mobile.send('Emulation.setTouchEmulationEnabled', { enabled: true })
  await mobile.goto(url)
  await text(mobile, 'FLIGHT OPERATIONS')
  assert.equal((await layout(mobile)).width, 390)
  await text(mobile, 'Enter flight school')
  assert.equal((await layout(mobile)).overflow, false)
  await shot(mobile, 'hub-mobile')
  await click(mobile, 'Flight school')
  await text(mobile, 'Real flight.')
  await shot(mobile, 'school-mobile')
  assert.equal((await layout(mobile)).overflow, false)
  await click(mobile, 'Explore')
  await shot(mobile, 'worlds-mobile')
  report.push({ check: '390px hub, school and world grid fit without horizontal overflow', passed: true })
  assert.deepEqual(mobile.logs().filter(l=>/^error:/.test(l)), [])
} finally { mobile.close() }
writeFileSync(`${out}/browser-results.json`, JSON.stringify(report, null, 2))
console.log(JSON.stringify(report, null, 2))
