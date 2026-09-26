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
 * Two details carry it. The frame is drawn from a `requestAnimationFrame` of
 * its own, outside the simulator's frame loop — recording is a spectator and
 * costs the physics nothing — and it reads the WebGL canvas with `drawImage`
 * after the loop has rendered, which is the one place the drawing buffer is
 * guaranteed to still hold the frame without `preserveDrawingBuffer`. And the
 * output is whatever the browser records best: VP9 if it will, VP8 if it must,
 * MP4 on the engines that only do that.
 *
 * Finished films go to IndexedDB (`filmSave` / `filmLoad` / `filmAll`) so the
 * mission library can show them on their cards after the flight is over — the
 * film comes home with you, and the card is where you find it again.
 */

import { DOSSIERS, INTRO } from './introFlights.js'

/** The browser's best-supported flavour, or null where there is none. */
const MIME =
  typeof MediaRecorder === 'undefined'
    ? null
    : (
        [
          'video/webm;codecs=vp9',
          'video/webm;codecs=vp8',
          'video/webm',
          'video/mp4;codecs=avc1',
          'video/mp4',
        ].find((t) => MediaRecorder.isTypeSupported(t)) ?? null
      )

/** Is there a film to be had on this browser? */
export const filmSupported = () => MIME !== null

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
 * Begin recording the flight. `glCanvas` is the R3F canvas; `preset` is the
 * mission's own entry — its id picks the dossier whose pages belong to the
 * film, its title and blurb make the opening card. Returns false where there
 * is nothing to record with, or a film is already running.
 */
export function startFilm(glCanvas, preset) {
  if (!MIME || rec || !glCanvas || !preset) return false
  const scale = Math.min(1, 1280 / (glCanvas.width || 1280))
  const w = Math.max(2, Math.round((glCanvas.width || 1280) * scale)) & ~1
  const h = Math.max(2, Math.round((glCanvas.height || 720) * scale)) & ~1

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  canvas.style.cssText = 'position:fixed;left:-10000px;top:0'
  document.body.appendChild(canvas)
  const ctx = canvas.getContext('2d')

  let recorder
  let requestFrame = null
  try {
    /*
     * Frame pacing belongs to the film, not to the compositor: the stream is
     * opened at zero frames a second and every composited tick calls
     * `requestFrame` itself. A `captureStream(30)` is paced by the browser's
     * frame production, which throttles a backgrounded tab into a stuttering
     * film of a flight that is still flying — and the recorder is exactly the
     * kind of thing people start and then switch away from.
     */
    let stream = canvas.captureStream(0)
    const track = stream.getVideoTracks()[0]
    if (track && typeof track.requestFrame === 'function') {
      requestFrame = () => track.requestFrame()
    } else {
      stream = canvas.captureStream(30)
    }
    recorder = new MediaRecorder(stream, {
      mimeType: MIME,
      videoBitsPerSecond: 3_500_000,
    })
  } catch {
    canvas.remove()
    return false
  }
  const chunks = []
  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size) chunks.push(e.data)
  }
  recorder.start()

  const t0 = performance.now()
  const tick = () => {
    const r = rec
    if (!r) return
    const t = (performance.now() - r.t0) / 1000
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, w, h)
    if (t < TITLE) {
      drawTitle(ctx, w, h, r.preset)
    } else {
      if (r.gl.width) ctx.drawImage(r.gl, 0, 0, w, h)
      drawFilm(ctx, w, h, r.preset)
    }
    if (r.requestFrame) r.requestFrame()
    r.raf = requestAnimationFrame(tick)
  }

  rec = {
    recorder,
    canvas,
    chunks,
    gl: glCanvas,
    t0,
    preset,
    requestFrame,
    raf: requestAnimationFrame(tick),
  }
  return true
}

/** Stop the film and hand it over — a Blob, or null if there is nothing in it. */
export function stopFilm() {
  const r = rec
  if (!r) return Promise.resolve(null)
  rec = null
  cancelAnimationFrame(r.raf)
  return new Promise((resolve) => {
    r.recorder.onstop = () => {
      r.canvas.remove()
      const blob = r.chunks.length ? new Blob(r.chunks, { type: MIME }) : null
      resolve(blob)
    }
    if (r.recorder.state !== 'inactive') r.recorder.stop()
    else r.recorder.onstop?.()
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
      req.onsuccess = () => {
        resolve(req.result)
        open.result.close()
      }
      req.onerror = () => {
        reject(req.error)
        open.result.close()
      }
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
