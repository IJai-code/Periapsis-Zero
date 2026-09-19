import { G0, SHIP } from '../sim/constants.js'
import { activeStage, ship } from '../sim/ship.js'
import { live } from '../sim/live.js'
import { density } from '../sim/atmosphere.js'

/**
 * What the vehicle sounds like, synthesised.
 *
 * No samples and no library: a handful of Web Audio nodes built once, and five
 * numbers written into them every frame. The graph is
 *
 *     brown noise -> lowpass  -> rumble gain  --+
 *     white noise -> bandpass -> crackle gain --+--> master -> compressor -> out
 *     two detuned oscillators -> sub gain     --+
 *     staging clunk (one-shot buffers)        --+
 *
 * The rumble is the engine; its level follows thrust and its lowpass corner
 * follows how *big* the engine is, measured as mass flow — an F-1 moving
 * 13 tonnes a second is a wall of low frequency, a J-2 at 250 kg/s is a tone.
 * The sub pair is the throb under it, beating slowly against each other. The
 * crackle is the tearing of a large exhaust that sits over everything else on
 * a big first stage and is nearly absent on an upper one. All of it is scaled
 * by the density of the air the sound would have to travel through, so the
 * ascent goes quiet as the sky goes black, which is also when the vehicle is
 * making the most noise it ever will and nobody can hear it.
 *
 * **The frame loop allocates nothing.** `mixFor` writes five numbers into a
 * Float64Array made at load; `applyMix` hands them to AudioParams by
 * `setTargetAtTime`, whose automation events live in the audio thread's
 * timeline rather than on the JS heap. scripts/verify-audio.mjs measures both
 * at zero bytes a call. The one allocation the engine does make — a
 * BufferSourceNode for a clunk — happens at *staging*, four times in a
 * mission, because Web Audio one-shots are one-use by design.
 *
 * Nothing here touches `window` at module load, so the pure parts import
 * under Node for the gate; the context is made on the first user gesture,
 * which is what browsers require anyway.
 */

/* ---------------------------------------------------------------- *
 * The mix: pure, allocation-free
 * ---------------------------------------------------------------- */

export const RUMBLE = 0
export const CUTOFF = 1
export const SUB = 2
export const SUB_FREQ = 3
export const CRACKLE = 4
/** This frame's five parameters. One array, at load, written in place. */
export const mix = new Float64Array(5)

/** Sea-level density, kg/m^3: the reference the attenuation is against. */
export const RHO0 = 1.225
/**
 * How the level falls with density. Loudness scales far slower than density
 * itself — a straight ratio is inaudible by 15 km — and the point is that the
 * engine is still clearly heard through max-Q and gone by the time the sky is
 * black: at 30 km this gives 0.23, at 60 km 0.05, at 100 km 0.005.
 */
export const ATTENUATION_EXPONENT = 0.35

/**
 * Reference mass flow, kg/s: the first stage at full throttle. "Heaviness" is
 * measured against it, so the vehicle's own biggest engine is the heaviest
 * sound it makes and every later stage is lighter in proportion.
 */
export const MDOT_REF = SHIP.stages[0].thrust / (SHIP.stages[0].isp * G0)

/**
 * The five parameters from the flight state.
 *
 * @param {Float64Array} out    written in place
 * @param {number} thrust       N, this frame
 * @param {number} maxThrust    N, the burning stage at full throttle (0 if none)
 * @param {number} mdot         kg/s, this frame
 * @param {number} mdotRef      kg/s, the vehicle's heaviest engine
 * @param {number} rho          kg/m^3, air at the vehicle
 * @param {number} gate         0..1, an outside mute — paused, or no listener
 */
export function mixFor(out, thrust, maxThrust, mdot, mdotRef, rho, gate = 1) {
  const level = thrust > 0 && maxThrust > 0 ? Math.min(1, thrust / maxThrust) : 0
  const att = rho > 0 ? Math.min(1, Math.pow(rho / RHO0, ATTENUATION_EXPONENT)) * gate : 0
  const heavy = mdot > 0 && mdotRef > 0 ? Math.min(1, Math.sqrt(mdot / mdotRef)) : 0

  out[RUMBLE] = Math.pow(level, 0.6) * att * 0.9
  // A big engine is a lower, darker sound; a small one opens up brighter.
  out[CUTOFF] = 50 + level * (180 - 60 * heavy)
  out[SUB] = level * att * (0.3 + 0.5 * heavy)
  out[SUB_FREQ] = 24 + 24 * (1 - heavy)
  out[CRACKLE] = level * att * 0.22 * (0.35 + 0.65 * heavy)
  return out
}

/** Time constants for the parameter smoothing, seconds. */
const TAU_GAIN = 0.06
const TAU_FREQ = 0.12

/**
 * Write a mix into the graph. `t` is the context's current time. Takes the
 * node bundle rather than reading the module's own, so the gate can feed it
 * stubs and measure that it allocates nothing.
 */
export function applyMix(n, m, t) {
  n.rumble.gain.setTargetAtTime(m[RUMBLE], t, TAU_GAIN)
  n.lowpass.frequency.setTargetAtTime(m[CUTOFF], t, TAU_FREQ)
  n.subGain.gain.setTargetAtTime(m[SUB], t, TAU_GAIN)
  n.sub.frequency.setTargetAtTime(m[SUB_FREQ], t, TAU_FREQ)
  // Detuned by a fiftieth: a beat of about half a hertz, the throb.
  n.sub2.frequency.setTargetAtTime(m[SUB_FREQ] * 1.021, t, TAU_FREQ)
  n.crackle.gain.setTargetAtTime(m[CRACKLE], t, TAU_GAIN * 0.7)
}

/* ---------------------------------------------------------------- *
 * The graph
 * ---------------------------------------------------------------- */

let ctx = null
let nodes = null
let enabled = true
let suspendTimer = null
let lastSeparations = 0
/** Whether the last mix written was silence, so an idle coast writes nothing. */
let wroteSilence = false

/** Deterministic noise, so two loads sound the same. Park-Miller. */
function makeRandom(seed) {
  let s = seed
  return () => {
    s = (s * 16807) % 2147483647
    return s / 2147483647
  }
}

/** White noise, `seconds` long. */
function whiteNoise(ac, seconds, seed) {
  const n = Math.floor(ac.sampleRate * seconds)
  const buffer = ac.createBuffer(1, n, ac.sampleRate)
  const data = buffer.getChannelData(0)
  const rnd = makeRandom(seed)
  for (let i = 0; i < n; i++) data[i] = rnd() * 2 - 1
  return buffer
}

/**
 * Brown noise: white through a leaky integrator, then normalised. The 1/f^2
 * slope is what a very large low-frequency source sounds like at a distance.
 */
function brownNoise(ac, seconds, seed) {
  const n = Math.floor(ac.sampleRate * seconds)
  const buffer = ac.createBuffer(1, n, ac.sampleRate)
  const data = buffer.getChannelData(0)
  const rnd = makeRandom(seed)
  let acc = 0
  let peak = 1e-6
  for (let i = 0; i < n; i++) {
    acc = acc * 0.998 + (rnd() * 2 - 1) * 0.02
    data[i] = acc
    if (Math.abs(acc) > peak) peak = Math.abs(acc)
  }
  for (let i = 0; i < n; i++) data[i] /= peak
  return buffer
}

/**
 * The staging clunk, rendered once: a short burst of noise for the pyros,
 * four decaying partials for the ringing of a large structure, and a thump
 * beneath — a big object let go of.
 */
function renderClunk(ac) {
  const seconds = 0.7
  const n = Math.floor(ac.sampleRate * seconds)
  const buffer = ac.createBuffer(1, n, ac.sampleRate)
  const data = buffer.getChannelData(0)
  const rnd = makeRandom(7)
  const partials = [
    [92, 0.9, 6],
    [187, 0.55, 8],
    [311, 0.4, 11],
    [540, 0.25, 16],
  ]
  let peak = 1e-6
  for (let i = 0; i < n; i++) {
    const t = i / ac.sampleRate
    let v = 0
    for (let k = 0; k < partials.length; k++) {
      const [f, a, decay] = partials[k]
      v += a * Math.sin(2 * Math.PI * f * t) * Math.exp(-decay * t)
    }
    v += 0.9 * Math.sin(2 * Math.PI * 46 * t) * Math.exp(-9 * t)
    if (t < 0.03) v += (rnd() * 2 - 1) * (1 - t / 0.03) * 1.4
    // No click on release.
    const tail = t > seconds - 0.05 ? (seconds - t) / 0.05 : 1
    data[i] = v * tail
    if (Math.abs(data[i]) > peak) peak = Math.abs(data[i])
  }
  for (let i = 0; i < n; i++) data[i] = (data[i] / peak) * 0.95
  return buffer
}

function build(ac) {
  const master = ac.createGain()
  master.gain.value = 0
  const compressor = ac.createDynamicsCompressor()
  compressor.threshold.value = -14
  compressor.knee.value = 12
  compressor.ratio.value = 6
  compressor.attack.value = 0.01
  compressor.release.value = 0.2
  master.connect(compressor)
  compressor.connect(ac.destination)

  const brown = ac.createBufferSource()
  brown.buffer = brownNoise(ac, 4, 12345)
  brown.loop = true
  const lowpass = ac.createBiquadFilter()
  lowpass.type = 'lowpass'
  lowpass.frequency.value = 50
  lowpass.Q.value = 0.9
  const rumble = ac.createGain()
  rumble.gain.value = 0
  brown.connect(lowpass)
  lowpass.connect(rumble)
  rumble.connect(master)

  const white = ac.createBufferSource()
  white.buffer = whiteNoise(ac, 3, 54321)
  white.loop = true
  const bandpass = ac.createBiquadFilter()
  bandpass.type = 'bandpass'
  bandpass.frequency.value = 1300
  bandpass.Q.value = 0.6
  const crackle = ac.createGain()
  crackle.gain.value = 0
  white.connect(bandpass)
  bandpass.connect(crackle)
  crackle.connect(master)

  const sub = ac.createOscillator()
  sub.type = 'sine'
  sub.frequency.value = 30
  const sub2 = ac.createOscillator()
  sub2.type = 'triangle'
  sub2.frequency.value = 30.6
  const subGain = ac.createGain()
  subGain.gain.value = 0
  sub.connect(subGain)
  sub2.connect(subGain)
  subGain.connect(master)

  const clunk = ac.createGain()
  clunk.gain.value = 0.85
  clunk.connect(master)

  brown.start()
  white.start()
  sub.start()
  sub2.start()

  return { master, rumble, lowpass, crackle, sub, sub2, subGain, clunk, clunkBuffer: renderClunk(ac) }
}

/* ---------------------------------------------------------------- *
 * Control
 * ---------------------------------------------------------------- */

function applyEnabled() {
  if (!ctx) return
  clearTimeout(suspendTimer)
  suspendTimer = null
  if (enabled) {
    if (ctx.state === 'suspended') ctx.resume().catch(() => {})
    nodes.master.gain.setTargetAtTime(1, ctx.currentTime, 0.1)
  } else {
    nodes.master.gain.setTargetAtTime(0, ctx.currentTime, 0.04)
    // Let the fade finish, then stop the clock: a muted graph should cost nothing.
    suspendTimer = setTimeout(() => {
      suspendTimer = null
      if (!enabled && ctx && ctx.state === 'running') ctx.suspend().catch(() => {})
    }, 400)
  }
}

/**
 * Create the context and the graph, or resume them. Must be called from a
 * user gesture the first time — a click on "Begin flight", or the first
 * pointer or key in the flight view — because browsers will not start audio
 * from anywhere else. Safe to call repeatedly. Returns false where there is
 * no Web Audio at all.
 */
export function unlockAudio() {
  if (typeof window === 'undefined') return false
  const AC = window.AudioContext || window.webkitAudioContext
  if (!AC) return false
  if (!ctx) {
    try {
      ctx = new AC({ latencyHint: 'interactive' })
      nodes = build(ctx)
      lastSeparations = ship.separations
    } catch {
      ctx = null
      nodes = null
      return false
    }
  }
  applyEnabled()
  return true
}

/** The mute. Mirrors the `audio` toggle in the store. */
export function setAudioEnabled(on) {
  enabled = Boolean(on)
  applyEnabled()
}

/** 'none' before the first gesture, else the context's own state. For the HUD and the gate. */
export const audioState = () => (ctx ? ctx.state : 'none')

/** The one-shot. Event-rate: this allocates a source node, by design of the API. */
export function playStaging() {
  if (!ctx || !nodes || !enabled || ctx.state !== 'running') return
  const src = ctx.createBufferSource()
  src.buffer = nodes.clunkBuffer
  src.connect(nodes.clunk)
  src.start()
}

/**
 * Once a frame, after the physics. Reads the flight state, writes the graph.
 *
 * Staging is detected here from the separation count rather than announced
 * by the propulsion model, so the engine has no hook in sim/ — a reset drops
 * the count to zero, which is *not* a separation and plays nothing.
 *
 * @param {number} gate  0..1; 0 while paused, so a held frame is silent
 */
export function updateAudio(gate = 1) {
  const seps = ship.separations
  if (seps !== lastSeparations) {
    if (seps > lastSeparations) playStaging()
    lastSeparations = seps
  }
  if (!ctx || !nodes || !enabled) return

  const stage = activeStage()
  const maxThrust = stage !== null ? stage.thrust : 0
  const mdot = stage !== null && ship.thrust > 0 ? ship.thrust / (stage.isp * G0) : 0
  const rho = density(live.elements.altitude)
  mixFor(mix, ship.thrust, maxThrust, mdot, MDOT_REF, rho, gate)

  // Most of a mission is silence — every coast, the whole front door — and
  // there is no point handing the audio thread six events a frame to say so
  // twice. One silent write lands the fade; the next is skipped.
  const silent = mix[RUMBLE] === 0 && mix[SUB] === 0 && mix[CRACKLE] === 0
  if (silent && wroteSilence) return
  wroteSilence = silent
  applyMix(nodes, mix, ctx.currentTime)
}
