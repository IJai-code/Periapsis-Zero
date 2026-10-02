import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { boundedRatio, maxRatio, FRAME_PIXELS, PHOTO_PIXELS, FILM_PIXELS, FILM_EDGE, FILM_FPS, FILM_STEPS, FILM_MAX_BYTES, filmSize } from '../src/gfx/renderBudget.js'

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
    assert.ok(Math.max(size.width, size.height) <= FILM_EDGE)
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
        const track = { stopped: false, requested: 0, kind: 'video', stop() { this.stopped = true },
          ...(fallback ? {} : { requestFrame() { this.requested++ } }) }
        tracks.push(track)
        // A fuller MediaStream than this gate used to model. The recorder now
        // adds the score's audio track and must give it back rather than stop
        // it — that track belongs to the score's graph and outlives the film —
        // so the mock has to be able to tell the two kinds apart.
        const held = [track]
        return {
          getTracks: () => held.slice(),
          getVideoTracks: () => held.filter((t) => t.kind === 'video'),
          getAudioTracks: () => held.filter((t) => t.kind === 'audio'),
          addTrack: (t) => held.push(t),
          removeTrack: (t) => { const i = held.indexOf(t); if (i >= 0) held.splice(i, 1) },
        }
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
check(`recording is explicit, bounded in portrait, probed once and paced at ${FILM_FPS} fps`, () => {
  assert.equal(filmRunning(), false)
  assert.equal(startFilm({ width: 880, height: 1650 }, preset), true)
  assert.equal(startFilm({}, preset), false)
  assert.ok(canvases.at(-1).width * canvases.at(-1).height <= FILM_PIXELS)
  // The size is settled before the first recorded frame: four composites,
  // timed, and then never again — MediaRecorder cannot be resized mid-stream,
  // so a governor that learns during the flight has nothing to do with it.
  assert.equal(draws, 4, 'startFilm must probe the composite cost exactly once')
  draws = 0
  const paced = []
  for (let t = 0; t < 1000; t += 16) { const before = draws; captureFilmFrame(t); if (draws > before) paced.push(t) }
  // Never faster than the film's own rate, and never slower than one missed slot.
  for (let i = 1; i < paced.length; i++) {
    const gap = paced[i] - paced[i - 1]
    assert.ok(gap >= 1000 / FILM_FPS, `frames ${gap} ms apart are faster than ${FILM_FPS} fps`)
    assert.ok(gap < 2000 / FILM_FPS, `frames ${gap} ms apart drop a slot`)
  }
  assert.equal(tracks.at(-1).requested, draws)
  const held = draws
  document.hidden = true
  captureFilmFrame(2000)
  assert.equal(draws, held)
  document.hidden = false
})
check('the codec preference reaches for a hardware encoder before a software one', () => {
  const order = readFileSync(new URL('../src/gfx/filmRecorder.js', import.meta.url), 'utf8')
    .match(/const MIME =[\s\S]*?\]\.find/)[0]
  const at = (needle) => order.indexOf(needle)
  assert.ok(at('avc1') < at('vp9'), 'H.264 is hardware-encoded everywhere this runs; VP8 and VP9 are not')
  assert.ok(at('vp9') < at('vp8'), 'VP9 carries more picture per bit than VP8')
})
check('each film step halves the area, on a small window as well as a large one', () => {
  for (const [w, h] of [[3840, 2160], [1024, 768]]) {
    let previous = Infinity
    for (let step = 0; step <= FILM_STEPS; step++) {
      const size = filmSize(w, h, step)
      const area = size.width * size.height
      if (previous !== Infinity) {
        const ratio = previous / area
        assert.ok(ratio > 1.7 && ratio < 2.4, `${w}x${h} step ${step} changed the area by ${ratio.toFixed(2)}x`)
      }
      previous = area
    }
  }
})
check('the frame ceiling is the panel, not the opening budget', () => {
  // The governor may climb to every pixel a 5K iMac has; the opening guess is
  // where it starts, not where it stops. Bounding both by FRAME_PIXELS held
  // that machine to 27% of its pixels forever.
  for (const [w, h, panel] of [[2560, 1440, 2], [1728, 1117, 2], [3840, 2160, 1]]) {
    assert.equal(maxRatio(w, h, panel), panel)
    assert.ok(boundedRatio(w, h, panel) < panel)
  }
  // The one bound that is real: a buffer edge the driver would refuse.
  assert.ok(maxRatio(5120, 1440, 2) < 2)
  assert.equal(maxRatio(5120, 1440, 2), 8192 / 5120)
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
const overrun = stopFilm.length >= 0 && (() => {
  // One chunk past the cap. The recorder must stop — and hand back the film
  // it already has. Discarding the chunks, which is what it used to do, paid
  // for a runaway file with the very thing the cap exists to avoid.
  recorder.ondataavailable({ data: new Blob(['a'.repeat(64)]) })
  recorder.ondataavailable({ data: { size: FILM_MAX_BYTES + 1 } })
  return true
})()
check('a recording that reaches the size cap is stopped, released and kept', () => {
  assert.ok(overrun)
  assert.equal(filmRunning(), false)
  assert.ok(tracks.every((t) => t.stopped))
  assert.ok(canvases.every((c) => c.removed))
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
  /*
   * Opening the drawer must not start nine films.
   *
   * The rule is about the *grid*, not about video: a card carries a still it
   * can preview under the pointer, and the one film a visitor actually asked
   * to watch is allowed to play, because that is what asking to watch it
   * means. Stated as "no autoPlay anywhere", the check outlawed the deliberate
   * one too — so it is stated as what it defends instead.
   */
  const library = readFileSync(new URL('../src/ui/MissionLibrary.jsx', import.meta.url), 'utf8')
  const players = library.split('<video')
  assert.equal(players.length - 1, 2, 'one card player and one projection room')
  const [card, room] = [players[1], players[2]]
  assert.ok(!card.includes('autoPlay'), 'a card must not start its film on its own')
  assert.ok(!card.includes('preload="auto"'), 'a card must not fetch the whole film to show a still')
  assert.ok(card.includes('muted'), 'a card preview is silent')
  assert.ok(room.includes('autoPlay'), 'a film opened on purpose plays')
  assert.ok(library.indexOf('role="dialog"', library.indexOf('setPlaying')) > 0)
})
console.log(`\nverify-render-budget: ${checks} checks passed`)
