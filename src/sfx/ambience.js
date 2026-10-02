import { live } from '../sim/live.js'
import { BODIES } from '../sim/constants.js'

/**
 * The ambience: the room the simulator sits in, and it is the user's own
 * recording — `public/audio/monume-space-ambient.mp3`, supplied by the pilot
 * and kept under the name they gave it.
 *
 * ── what this is not ─────────────────────────────────────────────────
 *
 * It is the only audio in the product — a generated soundtrack once played
 * under the mission intros and was removed at the owner's word, and there is
 * no engine audio: the simulator itself makes no sound of its own, because a
 * rocket in vacuum is silent and the product has always said so. This is the
 * *room* — a quiet bed the visitor may put under the flight, started only by
 * their own click, faded in from nothing, and one switch to stop.
 *
 * ── the gesture ──────────────────────────────────────────────────────
 *
 * Browsers gate `AudioContext` behind a user gesture, and this module was
 * not going to fight that with a first-click hijack: `setAmbience(true)`
 * is called from the toggle, which *is* a gesture, so the context is
 * created there and there only. Before that, nothing is downloaded — the
 * fetch happens inside the same call — so a visitor who never asks for
 * sound never pays the 3 MB.
 *
 * ── the space it breathes in ─────────────────────────────────────────
 *
 * A fixed bed would be wallpaper. This one follows the flight through one
 * parameter, the low-pass on the bed's own filter, driven by the same
 * "how high are we" number the HUD reads: on the pad the bed is muffled —
 * air over the complex, a vehicle that would drown it out anyway — and
 * with altitude the filter opens, so the vacuum of orbit is where the
 * bed is heard whole. That is a *convention*, stated rather than
 * smuggled: there is no sound in vacuum, and a simulator that put silence
 * there would be honest and unlistenable. The bed is what the pilot has
 * chosen to sit in the room, and the filter is what makes the room move.
 *
 * The tick mutates two AudioParams — a `setTargetAtTime` on the filter and
 * on nothing else — so the frame path allocates nothing and schedules
 * nothing, the same rule `score.js` keeps.
 */

/** Where the bed's filter sits when the air is thick, Hz. */
const SEA_LEVEL_HZ = 420
/** Where it sits in vacuum, Hz. */
const VACUUM_HZ = 14_000
/** Altitude the filter is fully open by, m — roughly where the sky goes black. */
const OPEN_BY = 140e3
/** Smoothing time constant for the filter's glide, s. */
const GLIDE = 1.2

export const ambience = {
  /** The one AudioContext, created on the enabling gesture. */
  ctx: null,
  source: null,
  filter: null,
  gain: null,
  on: false,
  /** True once the file has been fetched and decoded (or has failed). */
  loaded: false,
  failed: false,
  /** True while the first enable is still fetching and decoding. */
  building: false,
}

/** Fetch and decode the bed once. Returns the buffer or null. */
async function loadBuffer(ctx) {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}audio/monume-space-ambient.mp3`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await ctx.decodeAudioData(await res.arrayBuffer())
  } catch {
    ambience.failed = true
    return null
  }
}

/**
 * Turn the ambience on or off.
 *
 * Called from the store toggle's own handler — the click — so every path
 * into `new AudioContext` here is behind a real gesture. The `AudioContext`
 * itself is constructed *synchronously*, before the first `await`: the
 * gesture's grant does not survive an await boundary, and a context built
 * after the fetch would start suspended.
 *
 * Turning it off never destroys the context: the buffer and the graph are
 * kept, the gain goes to zero, and asking again later is instant and free.
 *
 * The await fence matters because the first enable fetches 3 MB. Click on,
 * then click off again before the decode finishes: the second call returns
 * through the `!on` branch and mutes the gain — and when the first call's
 * await resumes, it sees `on === false` and refuses to start the source.
 * Without that check the second click would be swallowed and the bed would
 * play under a toggle reading OFF, with only a page reload to stop it.
 */
export async function setAmbience(on) {
  if (on === ambience.on) return
  ambience.on = on
  if (!on) {
    if (ambience.gain && ambience.ctx) {
      ambience.gain.gain.setTargetAtTime(0, ambience.ctx.currentTime, 0.4)
    }
    return
  }
  if (ambience.failed || ambience.building) return
  if (!ambience.ctx) {
    const Ctx = window.AudioContext ?? window.webkitAudioContext
    if (!Ctx) {
      ambience.failed = true
      ambience.on = false
      return
    }
    ambience.building = true
    try {
      const ctx = new Ctx()
      const gain = ctx.createGain()
      gain.gain.value = 0
      const filter = ctx.createBiquadFilter()
      filter.type = 'lowpass'
      filter.frequency.value = SEA_LEVEL_HZ
      filter.Q.value = 0.4
      const source = ctx.createBufferSource()
      source.loop = true
      source.buffer = await loadBuffer(ctx)
      // The toggle may have moved while the buffer was in flight, or the
      // fetch may have failed. Either way the graph is not wanted: the
      // context is closed below and its nodes go with it.
      if (!source.buffer || !ambience.on) {
        // Nobody wants this graph — the toggle moved or the load failed, and
        // `ambience.ctx` was never assigned. Close the context so the audio
        // hardware is released; the next enabling gesture rebuilds from scratch.
        ctx.close().catch(() => {})
        if (!source.buffer) ambience.on = false
        return
      }
      // filter -> gain -> destination; the filter is what moves, the gain is
      // the switch's own hand.
      source.connect(filter).connect(gain).connect(ctx.destination)
      source.start()
      ambience.ctx = ctx
      ambience.source = source
      ambience.filter = filter
      ambience.gain = gain
      ambience.loaded = true
      // The tab is going away, or the user agent put it in the back-forward
      // cache: stop the source and close the context so the bed does not
      // keep playing in a page nobody can see. The next enable rebuilds the
      // graph from scratch — a new gesture, a new context, and the buffer
      // is cheap the second time because the browser has it cached.
      window.addEventListener('pagehide', disposeAmbience, { once: true })
    } finally {
      ambience.building = false
    }
  }
  if (ambience.ctx.state === 'suspended') await ambience.ctx.resume()
  ambience.gain.gain.setTargetAtTime(0.55, ambience.ctx.currentTime, 1.5)
}

/**
 * The per-frame parameter move — the filter follows the sky.
 *
 * The map is the atmosphere's own scale: the pressure the drag model uses
 * falls exponentially, and the filter's open point is chosen where the
 * sky already reads black. Cheap on purpose: one setTargetAtTime, once a
 * tick — nothing here can ever be a frame cost.
 */
export function tickAmbience() {
  if (!ambience.on || !ambience.filter || !ambience.ctx) return
  const a = live.nearest.id === 'moon' ? OPEN_BY * 2 : live.elements.altitude
  const open = Math.min(1, Math.max(0, a / OPEN_BY))
  // Square the curve so low altitudes stay muffled longer — the pad's
  // muffling should survive the first kilometres of the ascent.
  const hz = SEA_LEVEL_HZ + (VACUUM_HZ - SEA_LEVEL_HZ) * open * open
  ambience.filter.frequency.setTargetAtTime(hz, ambience.ctx.currentTime, GLIDE)
}

/**
 * Stop everything — the page is going away.
 *
 * Registered on `pagehide` the moment a graph exists, which is the caller
 * this comment always claimed: nothing else in the app has a reason to
 * dispose the bed, because turning it off is a fade and not a teardown.
 */
export function disposeAmbience() {
  try {
    ambience.source?.stop()
  } catch {
    /* already stopped */
  }
  ambience.ctx?.close().catch(() => {})
  ambience.ctx = null
  ambience.source = null
  ambience.filter = null
  ambience.gain = null
  ambience.on = false
  ambience.loaded = false
}
