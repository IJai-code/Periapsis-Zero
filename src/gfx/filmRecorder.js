/**
 * The film recorder: the mission intro, captured as it plays.
 *
 * The intro is a pure function of its clock — `introStep` places the camera
 * from the same numbers every time — so a recording of it is not a recording
 * of *a* flight, it is the flight itself, and it can be kept and shared. This
 * composites the WebGL canvas and the film's own titles (the curtain card, the
 * dossier's pages, the letterbox, the hairline) into one hidden 2D canvas and
 * records *that* — the titles are DOM in the product and pixels in the film,
 * because a film's subtitles belong to the film.
 *
 * Capture is explicitly requested, pixel-bounded and paced at 24 fps. R3F's
 * after-effect calls `captureFilmFrame` in the same task as the completed render,
 * before the browser can discard its non-preserved drawing buffer. Encoding
 * has a real cost; no recorder runs for viewers who only want the intro.
 * Background tabs pause with the renderer rather than promising unseen frames.
 *
 * Finished films go to IndexedDB (`filmSave` / `filmLoad` / `filmAll`) so the
 * mission library can show them on their cards after the flight is over — the
 * film comes home with you, and the card is where you find it again.
 */

import { DOSSIERS, INTRO } from './introFlights.js'
import { FILM_BITRATE, FILM_FPS, FILM_FRAME_MS, FILM_MAX_BYTES, FILM_STEPS, filmSize } from './renderBudget.js'

/**
 * The browser's best-supported flavour, or null where there is none.
 *
 * H.264 first, and the order is the whole point. VP8 led this list, which is
 * the one codec here with no hardware encoder on any machine this runs on: it
 * encodes on the CPU, beside a render loop that wants the CPU, and it is the
 * weakest of the three at a given bit rate. H.264 is encoded by a fixed
 * function block on every current Mac, PC and phone, so it costs the flight
 * almost nothing — measured in the page, compositing and handing over a
 * 1080p frame came back under a tenth of a millisecond — and the file it
 * makes opens in everything a person might take a film home to. VP9 is the
 * fallback where mp4 recording is not offered, and VP8 the last resort.
 */
const MIME =
  typeof MediaRecorder === 'undefined'
    ? null
    : (
        [
          'video/mp4;codecs=avc1.42E01E',
          'video/mp4;codecs=avc1',
          'video/mp4',
          'video/webm;codecs=vp9',
          'video/webm;codecs=vp8',
          'video/webm',
        ].find((t) => MediaRecorder.isTypeSupported(t)) ?? null
      )

/** Is there a film to be had on this browser? */
export const filmSupported = () => MIME !== null

/**
 * What the last film was made at, for the checkbox to say so honestly rather
 * than promising a number it may have stepped down from.
 */
export const film = { width: 0, height: 0, step: 0 }

/** The codec's short name, for the same reason. */
export const filmCodec = () =>
  MIME === null ? 'none' : MIME.includes('avc1') || MIME === 'video/mp4' ? 'H.264' : MIME.includes('vp9') ? 'VP9' : 'VP8'

/** The container the file gets — `.webm` everywhere but the mp4-only engines. */
const extension = () => (MIME && MIME.includes('mp4') ? 'mp4' : 'webm')

/* ---------------------------------------------------------------- *
 * The composite: what the film frame looks like
 * ---------------------------------------------------------------- */

const MONO = "'JetBrains Mono', ui-monospace, monospace"
const DISPLAY = "'Cormorant Garamond', Didot, Georgia, serif"
const EMBER = '#d7733e'
const PAPER = '#efe7db'

/** The opening card's length: the title, then the fall into the scene. */
const TITLE = 2.6

function drawTitle(ctx, w, h, preset) {
  ctx.textAlign = 'center'
  ctx.fillStyle = 'rgba(215, 224, 236, 0.5)'
  ctx.font = `500 ${Math.round(h * 0.019)}px ${MONO}`
  ctx.fillText('PERIAPSIS ZERO PRESENTS', w / 2, h * 0.4)
  ctx.fillStyle = PAPER
  ctx.font = `300 ${Math.round(h * 0.075)}px ${DISPLAY}`
  ctx.fillText(preset.title, w / 2, h * 0.5)
  ctx.fillStyle = 'rgba(232, 224, 213, 0.62)'
  ctx.font = `400 ${Math.round(h * 0.024)}px ${MONO}`
  ctx.fillText(preset.blurb, w / 2, h * 0.56)
}

function drawFilm(ctx, w, h, preset) {
  const bar = Math.round(h * 0.07)
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, w, bar)
  ctx.fillRect(0, h - bar, w, bar)

  // The progress hairline, riding the top bar's inner edge.
  ctx.fillStyle = 'rgba(215, 115, 62, 0.8)'
  ctx.fillRect(0, bar, Math.round(w * Math.min(1, INTRO.s)), Math.max(1, Math.round(h * 0.0015)))

  // The dossier's page, lower third between the bars.
  const beats = DOSSIERS[preset.id]?.beats ?? []
  const page = INTRO.beat >= 0 ? beats[INTRO.beat] : null
  if (page) {
    ctx.textAlign = 'center'
    ctx.fillStyle = 'rgba(215, 115, 62, 0.92)'
    ctx.font = `500 ${Math.round(h * 0.017)}px ${MONO}`
    ctx.fillText(page.eyebrow.toUpperCase(), w / 2, h - bar - h * 0.115)
    ctx.fillStyle = 'rgba(239, 231, 219, 0.94)'
    ctx.font = `300 ${Math.round(h * 0.042)}px ${DISPLAY}`
    ctx.fillText(page.line, w / 2, h - bar - h * 0.055)
  }
}

/* ---------------------------------------------------------------- *
 * The recorder
 * ---------------------------------------------------------------- */

let rec = null

/**
 * What one composited frame costs on this machine, at this size.
 *
 * `drawImage` from a WebGL canvas is queued, so timing the call alone times
 * the queueing and returns almost zero however expensive the copy is. One
 * one-pixel read after it forces the copy to complete, which is the work the
 * frame actually pays for. That read is itself a synchronisation the real
 * recorder never performs, so this over-states the cost — deliberately, since
 * the direction to be wrong in is the cautious one.
 */
function compositeCost(ctx, gl, w, h) {
  ctx.drawImage(gl, 0, 0, w, h)
  ctx.getImageData(0, 0, 1, 1)
  const began = performance.now()
  const takes = 3
  for (let i = 0; i < takes; i++) {
    ctx.drawImage(gl, 0, 0, w, h)
    ctx.getImageData(0, 0, 1, 1)
  }
  return (performance.now() - began) / takes
}

/**
 * Begin recording the flight. `glCanvas` is the R3F canvas; `preset` is the
 * mission's own entry — its id picks the dossier whose pages belong to the
 * film, its title and blurb make the opening card. Returns false where there
 * is nothing to record with, or a film is already running.
 */
export function startFilm(glCanvas, preset, step = 0) {
  if (!MIME || rec || !glCanvas || !preset) return false
  const { width: w, height: h } = filmSize(glCanvas.width || 1280, glCanvas.height || 720, step)

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  canvas.style.cssText = 'position:fixed;left:-10000px;top:0'
  document.body.appendChild(canvas)
  const ctx = canvas.getContext('2d')

  if (!ctx) { canvas.remove(); return false }
  /*
   * The downscale is a resample, so say so. A 2D context defaults to `low`
   * smoothing, which on a 2:1 reduction of a star field means most stars land
   * between taps and the rest alias — the single cheapest thing that was
   * making these films look like a screen recording of a screen recording.
   */
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'

  /*
   * Settle the size before a frame is recorded, not during one.
   *
   * MediaRecorder cannot change its frame size mid-stream, so a governor that
   * reacts while the flight is under way has nothing useful to do with what
   * it learns. Measuring here costs four composites — under a frame, before
   * the film exists — and the answer holds for the whole recording.
   */
  if (glCanvas.width && step < FILM_STEPS) {
    const cost = compositeCost(ctx, glCanvas, w, h)
    if (cost > FILM_FRAME_MS) {
      canvas.remove()
      return startFilm(glCanvas, preset, step + 1)
    }
  }
  let recorder
  let stream
  let requestFrame = null
  try {
    stream = canvas.captureStream(0)
    const track = stream.getVideoTracks()[0]
    if (track && typeof track.requestFrame === 'function') {
      requestFrame = () => track.requestFrame()
    } else {
      stream.getTracks().forEach((t) => t.stop())
      stream = canvas.captureStream(FILM_FPS)
    }
    /*
     * The films are silent, deliberately: the simulator makes no sound of
     * its own and the one piece of music in the product is the visitor's own
     * ambience, which belongs to the room and not to any one film. A silent
     * film of a real flight is what the archive has too.
     */
    recorder = new MediaRecorder(stream, {
      mimeType: MIME,
      videoBitsPerSecond: FILM_BITRATE,
    })
  } catch {
    stream?.getTracks().forEach((t) => t.stop())
    canvas.remove()
    return false
  }
  const chunks = []
  const r = { recorder, stream, canvas, ctx, chunks, gl: glCanvas, preset, requestFrame, step,
    last: -Infinity, bytes: 0, failed: false, capped: false, finish: null, cleaned: false }
  film.width = w
  film.height = h
  film.step = step
  recorder.ondataavailable = (e) => {
    if (!e.data?.size || r.failed) return
    r.bytes += e.data.size
    chunks.push(e.data)
    /*
     * Reaching the cap ends the recording and *keeps* what is in it. It used
     * to mark the film failed, which discarded every chunk already written —
     * so the one outcome the cap protected against, a runaway file, was paid
     * for with the outcome it was supposed to prevent: no film at all. A film
     * that stops early is a film; nothing is not.
     */
    if (r.bytes > FILM_MAX_BYTES) { r.capped = true; stopFilm() }
  }
  recorder.onerror = () => { r.failed = true; stopFilm() }
  recorder.onstop = () => {
    if (r.cleaned) return
    r.cleaned = true
    if (rec === r)    rec = null
    /* Every track on this stream is the recorder's own — video only, since
       the films carry no audio — and stops with it. */
    stream.getTracks().forEach((t) => t.stop())
    canvas.remove()
    const blob = !r.failed && chunks.length ? new Blob(chunks, { type: MIME }) : null
    chunks.length = 0
    r.finish?.(blob)
  }
  rec = r
  try { recorder.start(1000) } catch {
    r.failed = true
    recorder.onstop()
    return false
  }
  return true
}

/** Called after the scene/composer render, not in a second rAF chain. */
export function captureFilmFrame(now = performance.now()) {
  const r = rec
  if (!r || document.hidden || now - r.last < 1000 / FILM_FPS) return
  r.last = now
  const { ctx, canvas, preset } = r
  const w = canvas.width
  const h = canvas.height
  try {
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, w, h)
    if (INTRO.t < TITLE) drawTitle(ctx, w, h, preset)
    else {
      if (r.gl.width) ctx.drawImage(r.gl, 0, 0, w, h)
      drawFilm(ctx, w, h, preset)
    }
    r.requestFrame?.()
  } catch { r.failed = true; stopFilm() }
}

/** Stop the film and hand it over — a Blob, or null if there is nothing in it. */
export function stopFilm() {
  const r = rec
  if (!r) return Promise.resolve(null)
  rec = null
  return new Promise((resolve) => {
    r.finish = resolve
    try {
      if (r.recorder.state !== 'inactive') r.recorder.stop()
      else r.recorder.onstop()
    } catch { r.failed = true; r.recorder.onstop() }
  })
}

/** Is a film being made right now? */
export const filmRunning = () => rec !== null

/* ---------------------------------------------------------------- *
 * The shelf: films keep, in IndexedDB
 * ---------------------------------------------------------------- */

const DB = 'periapsis-films'
const STORE = 'films'

function withStore(mode, fn) {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('no shelf here'))
    const open = indexedDB.open(DB, 1)
    open.onupgradeneeded = () => {
      if (!open.result.objectStoreNames.contains(STORE)) open.result.createObjectStore(STORE)
    }
    open.onerror = () => reject(open.error)
    open.onsuccess = () => {
      const tx = open.result.transaction(STORE, mode)
      const req = fn(tx.objectStore(STORE))
      let result
      req.onsuccess = () => { result = req.result }
      tx.oncomplete = () => { open.result.close(); resolve(result) }
      tx.onabort = tx.onerror = () => { open.result.close(); reject(tx.error ?? req.error) }
    }
  })
}

/** Keep a finished film. */
export function filmSave(presetId, blob) {
  return withStore('readwrite', (store) =>
    store.put({ id: presetId, blob, at: Date.now(), mime: MIME, ext: extension() }, presetId),
  ).catch(() => null)
}

/** The film a previous flight left here, if any. */
export function filmLoad(presetId) {
  return withStore('readonly', (store) => store.get(presetId))
    .then((entry) => entry?.blob ?? null)
    .catch(() => null)
}

/** Take a film home: one download, then the address is given back. */
export function filmDownload(entry, presetId) {
  const blob = entry?.blob ?? entry
  if (!blob) return
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `periapsis-zero-${presetId}.${entry?.ext ?? (blob.type.includes('mp4') ? 'mp4' : 'webm')}`
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 30_000)
}

/** Every film on the shelf, keyed by preset. */
export function filmAll() {
  return withStore('readonly', (store) => store.getAll())
    .then((list) => Object.fromEntries((list ?? []).map((e) => [e.id, e])))
    .catch(() => ({}))
}
