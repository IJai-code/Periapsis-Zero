import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { boundedRatio, FRAME_PIXELS, PHOTO_PIXELS, FILM_PIXELS, filmSize } from '../src/gfx/renderBudget.js'

let checks = 0
const check = (label, fn) => { fn(); checks++; console.log(`  ✓ ${label}`) }
check('screen and photo area/edge budgets hold on ultrawide, retina, portrait and 8K screens', () => {
  for (const [w, h] of [[3840, 2160], [7680, 4320], [880, 1650], [5120, 1440], [360, 800]]) {
    for (const budget of [FRAME_PIXELS, PHOTO_PIXELS]) {
      const dpr = boundedRatio(w, h, 8, budget, 4096)
      assert.ok(w * h * dpr * dpr <= budget + 1e-6)
      assert.ok(Math.max(w, h) * dpr <= 4096 + 1e-6)
    }
    const size = filmSize(w, h)
    assert.ok(size.width * size.height <= FILM_PIXELS)
    assert.ok(Math.max(size.width, size.height) <= 1280)
    assert.equal(size.width % 2, 0)
    assert.equal(size.height % 2, 0)
    assert.ok(Math.abs(size.width / size.height - w / h) < 0.012)
  }
})

const tracks = []
const canvases = []
let draws = 0
let recorder
let failStart = false
let failStop = false
let fallback = false
const context = new Proxy({}, { get: (_, key) => key === 'drawImage' ? () => draws++ : () => {} })
globalThis.document = {
  hidden: false,
  body: { appendChild() {} },
  createElement() {
    const canvas = { style: {}, removed: false, remove() { this.removed = true }, getContext: () => context,
      captureStream() {
        const track = { stopped: false, requested: 0, stop() { this.stopped = true },
          ...(fallback ? {} : { requestFrame() { this.requested++ } }) }
        tracks.push(track)
        return { getTracks: () => [track], getVideoTracks: () => [track] }
      } }
    canvases.push(canvas)
    return canvas
  },
}
globalThis.MediaRecorder = class {
  static isTypeSupported(type) { return type.includes('vp8') }
  constructor(stream) { this.stream = stream; this.state = 'inactive'; recorder = this }
  start(timeslice) { assert.equal(timeslice, 1000); if (failStart) throw Error('encoder unavailable'); this.state = 'recording' }
  stop() { if (failStop) throw Error('stop unavailable'); this.state = 'inactive'; this.ondataavailable({ data: new Blob(['frame']) }); this.onstop() }
}
const { INTRO } = await import('../src/gfx/introFlights.js')
const { startFilm, captureFilmFrame, stopFilm, filmRunning } = await import('../src/gfx/filmRecorder.js')
const preset = { id: 'apollo8-launch', title: 'test', blurb: 'test' }
INTRO.t = 10
check('recording is explicit, bounded in portrait and paced at 24 fps', () => {
  assert.equal(filmRunning(), false)
  assert.equal(startFilm({ width: 880, height: 1650 }, preset), true)
  assert.equal(startFilm({}, preset), false)
  assert.ok(canvases.at(-1).width * canvases.at(-1).height <= FILM_PIXELS)
  for (let t = 0; t < 1000; t += 16) captureFilmFrame(t)
  assert.equal(draws, 21)
  assert.equal(tracks.at(-1).requested, 21)
  document.hidden = true
  captureFilmFrame(2000)
  assert.equal(draws, 21)
  document.hidden = false
})
const blob = await stopFilm()
check('stop releases capture tracks and canvas, and returns a downloadable film', () => {
  assert.ok(blob.size > 0)
  assert.equal(filmRunning(), false)
  assert.ok(tracks.every((t) => t.stopped))
  assert.ok(canvases.every((c) => c.removed))
})
fallback = true
startFilm({ width: 1920, height: 1080 }, preset)
await stopFilm()
check('fallback capture stops the abandoned zero-rate track as well', () => assert.ok(tracks.every((t) => t.stopped)))
failStart = true
check('encoder start failure cleans up instead of leaking resources', () => {
  assert.equal(startFilm({ width: 1920, height: 1080 }, preset), false)
  assert.equal(filmRunning(), false)
  assert.ok(tracks.every((t) => t.stopped))
  assert.ok(canvases.every((c) => c.removed))
})
failStart = false
startFilm({ width: 1920, height: 1080 }, preset)
recorder.onerror()
check('encoder errors release resources', () => {
  assert.equal(filmRunning(), false)
  assert.ok(tracks.every((t) => t.stopped))
})
startFilm({ width: 1920, height: 1080 }, preset)
recorder.ondataavailable({ data: { size: 30 * 1024 * 1024 } })
check('oversized recordings are stopped and released', () => {
  assert.equal(filmRunning(), false)
  assert.ok(tracks.every((t) => t.stopped))
})
startFilm({ width: 1920, height: 1080 }, preset)
failStop = true
assert.equal(await stopFilm(), null)
check('stop exceptions still release capture resources', () => {
  assert.equal(filmRunning(), false)
  assert.ok(tracks.every((t) => t.stopped))
})
check('photography does not take over the default render loop; library never autoplays all films', () => {
  const photo = readFileSync(new URL('../src/components/Photograph.jsx', import.meta.url), 'utf8')
  assert.ok(photo.includes('addAfterEffect'))
  assert.ok(!photo.includes('}, 2)'))
  const library = readFileSync(new URL('../src/ui/MissionLibrary.jsx', import.meta.url), 'utf8')
  assert.ok(!library.includes('autoPlay'))
  assert.ok(library.includes('preload="none"'))
})
console.log(`\nverify-render-budget: ${checks} checks passed`)
