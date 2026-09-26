import { G0, SHIP } from '../sim/constants.js'
import { activeStage, ship } from '../sim/ship.js'
import { live } from '../sim/live.js'
import { density } from '../sim/atmosphere.js'
import { currentPhase, mission } from '../sim/mission.js'
import { delugeLevel, ventLevel } from '../sim/countdown.js'

/**
 * What the vehicle sounds like, synthesised.
 *
 * No samples and no library: a handful of Web Audio nodes built once, and five
 * numbers written into them every frame. The graph is
 *
 *     brown noise -> lowpass  -> rumble gain  --+
 *     white noise -> bandpass -> crackle gain --+
 *     two detuned oscillators -> sub gain     --+
 *     white noise -> bandpass -> rush gain    --+
 *     white noise -> highpass -> vent gain    --+
 *     one-shot buffers: staging, chutes, splash, ignition --+--> master
 *                                                             -> compressor -> out
 *
 * The two voices after the engine are the parts of a flight that are not the
 * engine. The **rush** is air: it is driven by dynamic pressure rather than by
 * thrust, so it is loudest at max Q and again through entry, and it is silent
 * in a vacuum no matter how fast anything is moving through it. The **vent** is
 * the pad: the hiss of boiling LOX out of the vents and the roar of the sound
 * suppression water, both taken straight from `countdown.js` so the picture of
 * the last minute and its sound are the same timeline. Before either, a launch
 * being watched had the engines and nothing else, so the sixty seconds before
 * ignition were silent — the one minute of the mission that is all plumbing
 * and weather, and the only part with no engine in it at all.
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
/** Level of the aerodynamic rush, 0..1. Air moving past the hull, not the engine. */
export const RUSH = 5
/** Its band centre, Hz — broad and dark for a big blunt body, brighter for a capsule. */
export const RUSH_FREQ = 6
/** The pad's own noise: LOX vents and deluge water, 0..1. */
export const VENT = 7
/** How many parameters a mix carries. The array is sized from it, so the two cannot drift. */
export const MIX_SIZE = 8
/** This frame's parameters. One array, at load, written in place. */
export const mix = new Float64Array(MIX_SIZE)

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
 * Dynamic pressure the rush is measured against, Pa.
 *
 * 32 kPa is a Saturn V's max Q, and it is the right reference for a launch
 * because the reference has to be the loudest the rush ever gets: the voice is
 * a square root of the ratio, so it reads 0.5 at a quarter of max Q — a normal
 * ascent, audible but clearly under the engines — and 1.0 exactly where the
 * vehicle is being pushed hardest. Entry re-enters the same band from above,
 * which is why the same voice serves both.
 */
export const Q_REF = 32000

/**
 * The parameters from the flight state.
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

/**
 * The voices that are not the engine: the air past the hull, and the pad.
 *
 * A separate function rather than four more parameters on `mixFor`, and the
 * split is a measurement. V8 inlines `mixFor`'s seven-argument call and does not
 * inline a nine-argument one, and the doubles of a call it will not inline are
 * boxed at the boundary — 47.50 bytes a call, against 0.83 for the same
 * arithmetic inlined. `gfx/sunlight.js` and `gfx/groundView.js` both hit this and
 * both responded the same way: take the argument count down, not the arithmetic.
 *
 * @param {Float64Array} out  written in place
 * @param {number} rho        kg/m^3, air at the vehicle
 * @param {number} q          Pa, dynamic pressure
 * @param {number} vent       0..1, the pad's own noise (vents and deluge)
 * @param {number} gate       0..1, the same outside mute `mixFor` takes
 * @param {number} heavy      0..1, the burning stage against the vehicle's
 *                            heaviest — how blunt the thing in the air is. Only
 *                            shapes the rush's band, and defaults to the middle
 *                            so a caller with no engine has a defined voice.
 */
export function mixAir(out, rho, q, vent, gate = 1, heavy = 0.5) {
  const att = rho > 0 ? Math.min(1, Math.pow(rho / RHO0, ATTENUATION_EXPONENT)) * gate : 0
  /*
   * Square-rooted in pressure because loudness is roughly the log of intensity
   * and a linear reading spends the whole ascent in the top tenth of the range;
   * attenuated by density for the same reason the engine is, since it is air
   * and a vacuum carries none of it. Deliberately *not* scaled by thrust: this
   * is the vehicle moving through atmosphere, which happens whether or not
   * anything is lit — the entry the capsule flies with no engine at all is the
   * loudest air in the mission.
   */
  out[RUSH] = Math.min(1, Math.sqrt(Math.max(q, 0) / Q_REF)) * att * 0.55
  /*
   * Blunter and heavier is broader and lower; a small stage is brighter.
   *
   * Measured on the two extremes this flies: an S-IC at full throttle gives
   * 240 Hz, which is a wall of low-frequency air, and an unpowered entry gives
   * the middle of the range, 390 Hz — a capsule is a hiss and there is no
   * engine running to darken it, which is the sound entry actually makes.
   */
  out[RUSH_FREQ] = 240 + 300 * (1 - Math.min(1, Math.max(0, heavy)))
  out[VENT] = Math.min(1, Math.max(0, vent)) * 0.5 * gate
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
  n.rush.gain.setTargetAtTime(m[RUSH], t, TAU_GAIN)
  n.rushBand.frequency.setTargetAtTime(m[RUSH_FREQ], t, TAU_FREQ)
  // The pad's own noise comes and goes over seconds, not tenths: a vent opening
  // is a valve, not an engine.
  n.vent.gain.setTargetAtTime(m[VENT], t, 0.35)
}

/* ---------------------------------------------------------------- *
 * The graph
 * ---------------------------------------------------------------- */

let ctx = null
let nodes = null
let enabled = true
let suspendTimer = null
let lastSeparations = 0
/** Phase the last one-shot was fired for, so a phase is announced once. */
let lastPhaseFired = ''
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

/**
 * A one-shot rendered once, from a spec: decaying partials, a noise transient,
 * and a tail fade so it never clicks.
 *
 * The staging clunk was written out by hand and the three events after it are
 * the same shape with different numbers, so they share this rather than being
 * three more copies of the same twenty lines.
 *
 * @param {number[][]} partials  [Hz, amplitude, decay rate] rows
 * @param {number} noise         amplitude of the opening noise transient
 * @param {number} noiseSeconds  how long it lasts
 */
function renderBurst(ac, { seconds, partials, thump, noise, noiseSeconds }) {
  const n = Math.floor(ac.sampleRate * seconds)
  const buffer = ac.createBuffer(1, n, ac.sampleRate)
  const data = buffer.getChannelData(0)
  const rnd = makeRandom(11)
  let peak = 1e-6
  for (let i = 0; i < n; i++) {
    const t = i / ac.sampleRate
    let v = 0
    for (let k = 0; k < partials.length; k++) {
      const [f, a, decay] = partials[k]
      v += a * Math.sin(2 * Math.PI * f * t) * Math.exp(-decay * t)
    }
    if (thump) v += thump[1] * Math.sin(2 * Math.PI * thump[0] * t) * Math.exp(-thump[2] * t)
    if (noise > 0 && t < noiseSeconds) v += (rnd() * 2 - 1) * (1 - t / noiseSeconds) * noise
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

  /**
   * The aerodynamic rush: its own noise source, through a fairly broad band.
   *
   * A separate source rather than a share of the crackle's, because the two
   * have to move independently — the crackle is a property of the engine and
   * stops when it does, and the rush is a property of the air and keeps going
   * through an entry with nothing lit. Sharing one node would make the entry
   * silent and the vacuum noisy at the same time.
   */
  const rushNoise = ac.createBufferSource()
  rushNoise.buffer = whiteNoise(ac, 3, 24680)
  rushNoise.loop = true
  const rushBand = ac.createBiquadFilter()
  rushBand.type = 'bandpass'
  rushBand.frequency.value = 400
  rushBand.Q.value = 0.7
  const rush = ac.createGain()
  rush.gain.value = 0
  rushNoise.connect(rushBand)
  rushBand.connect(rush)
  rush.connect(master)

  // The pad: vents and deluge are both steam and water under pressure, which is
  // a high, hissing band rather than the bottom-heavy roar of an engine.
  const ventNoise = ac.createBufferSource()
  ventNoise.buffer = whiteNoise(ac, 3, 13579)
  ventNoise.loop = true
  const ventFilter = ac.createBiquadFilter()
  ventFilter.type = 'highpass'
  ventFilter.frequency.value = 1100
  ventFilter.Q.value = 0.5
  const vent = ac.createGain()
  vent.gain.value = 0
  ventNoise.connect(ventFilter)
  ventFilter.connect(vent)
  vent.connect(master)

  const oneshots = ac.createGain()
  oneshots.gain.value = 1
  oneshots.connect(master)

  brown.start()
  white.start()
  sub.start()
  sub2.start()
  rushNoise.start()
  ventNoise.start()

  return {
    master,
    rumble,
    lowpass,
    crackle,
    sub,
    sub2,
    subGain,
    rush,
    rushBand,
    vent,
    oneshots,
    clunk,
    /**
     * The four events with something to say, rendered once at load.
     *
     *   staging   the pyros, a large structure let go of, a thump beneath it
     *   ignition  five seconds of a first stage coming up to thrust, still held
     *   chutes    a mortar, three canopies cracking open, fabric in a 200 km/h wind
     *   splash    a capsule hitting water — a low thud under a very short hiss
     */
    clunkBuffer: renderClunk(ac),
    ignitionBuffer: renderBurst(ac, {
      seconds: 5,
      partials: [
        [31, 0.5, 0.7],
        [58, 0.6, 0.9],
        [97, 0.45, 1.4],
        [173, 0.3, 2.2],
      ],
      thump: [22, 0.9, 0.55],
      noise: 0.7,
      noiseSeconds: 2.6,
    }),
    chuteBuffer: renderBurst(ac, {
      seconds: 2.2,
      partials: [
        [74, 0.4, 1.1],
        [128, 0.35, 1.7],
        [261, 0.25, 2.6],
        [497, 0.2, 3.4],
      ],
      thump: [46, 0.7, 5],
      noise: 1.1,
      noiseSeconds: 1.1,
    }),
    splashBuffer: renderBurst(ac, {
      seconds: 1.6,
      partials: [
        [61, 0.5, 2.4],
        [139, 0.3, 4],
        [288, 0.22, 6],
      ],
      thump: [38, 1.0, 3.2],
      noise: 1.3,
      noiseSeconds: 0.5,
    }),
  }
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
/**
 * The context, for the music. Built on the first gesture like everything else
 * here; `null` before it, which every caller already knows how to take.
 */
export function audioContext() {
  return ctx
}

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

/**
 * One rendered buffer, played once. Event-rate: this allocates a source node,
 * by design of the Web Audio API — four or five times a mission, against the
 * sixty-per-second path above it, which allocates nothing.
 */
function playOneShot(buffer, gain = 1) {
  if (!ctx || !nodes || !enabled || ctx.state !== 'running') return
  const src = ctx.createBufferSource()
  src.buffer = buffer
  if (gain !== 1) {
    const g = ctx.createGain()
    g.gain.value = gain
    src.connect(g)
    g.connect(nodes.oneshots)
  } else {
    src.connect(nodes.oneshots)
  }
  src.start()
}

/** The one-shot. Event-rate: this allocates a source node, by design of the API. */
export function playStaging() {
  if (!ctx || !nodes || !enabled || ctx.state !== 'running') return
  const src = ctx.createBufferSource()
  src.buffer = nodes.clunkBuffer
  src.connect(nodes.clunk)
  src.start()
}

/** Engines coming up to thrust while the vehicle is still held down. */
export function playIgnition() {
  playOneShot(nodes?.ignitionBuffer, 0.9)
}

/** A mortar, canopies cracking open, fabric in a two-hundred-kilometre-an-hour wind. */
export function playChutes() {
  playOneShot(nodes?.chuteBuffer)
}

/** A capsule arriving in the water. */
export function playSplash() {
  playOneShot(nodes?.splashBuffer)
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

  /**
   * The events that are not a change in a level but a thing happening.
   *
   * Keyed on the phase id and fired on entry, which is the same "on change"
   * contract the director and the warp ladder use, and for the same reason: a
   * one-shot is an edge and a level is a state. Nothing here fires on a
   * re-entered phase — the mission clock only runs forward — and a reset puts
   * `lastPhaseFired` back with `ship.separations`, so a fresh flight can fire
   * each of them again.
   */
  const phase = currentPhase().id
  if (phase !== lastPhaseFired) {
    lastPhaseFired = phase
    if (phase === 'LIFTOFF' && ship.thrust > 0) playIgnition()
    else if (phase === 'DROGUE') playChutes()
    else if (phase === 'SPLASHDOWN') playSplash()
  }

  if (!ctx || !nodes || !enabled) return

  const stage = activeStage()
  const maxThrust = stage !== null ? stage.thrust : 0
  const mdot = stage !== null && ship.thrust > 0 ? ship.thrust / (stage.isp * G0) : 0
  const rho = density(live.elements.altitude)
  /**
   * The pad's own noise, read off the same timeline that draws it.
   *
   * `mission.t` is the countdown's own clock: negative before release, zero at
   * release, and it keeps running afterwards — so the deluge fading out twenty
   * seconds after liftoff is the same curve as the deluge fading off the pad,
   * and there is no second source of truth for when the water stops. Outside
   * the countdown both functions return zero on their own, so a preset handed
   * over in orbit announces no vents at all.
   */
  const vent = Math.max(ventLevel(mission.t), delugeLevel(mission.t))
  const heavy = mdot > 0 ? Math.min(1, Math.sqrt(mdot / MDOT_REF)) : 0.5
  mixFor(mix, ship.thrust, maxThrust, mdot, MDOT_REF, rho, gate)
  mixAir(mix, rho, live.dynamicPressure, vent, gate, heavy)

  // Most of a mission is silence — every coast, the whole front door — and
  // there is no point handing the audio thread eight events a frame to say so
  // twice. One silent write lands the fade; the next is skipped.
  const silent =
    mix[RUMBLE] === 0 && mix[SUB] === 0 && mix[CRACKLE] === 0 && mix[RUSH] === 0 && mix[VENT] === 0
  if (silent && wroteSilence) return
  wroteSilence = silent
  applyMix(nodes, mix, ctx.currentTime)
}
