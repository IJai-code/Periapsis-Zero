/**
 * The score: generative, synthesised, and quiet about it.
 *
 * No sound files — nothing is downloaded and nothing is sampled. A drone, a
 * pad, a sub swell and a shimmer through a ping-pong delay into a synthesised
 * reverb, all built on one AudioContext and driven by mutating AudioParams:
 * the frame path allocates nothing and schedules nothing new per voice. Notes
 * are events, not state, so they are scheduled from the tick and released to
 * the collector once silent; the frame path never touches them.
 *
 * The language is a scale-journey film's: slow harmonic rhythm, sub-bass you
 * feel before you hear, long reverb tails, and swells that arrive with reveals
 * rather than with cuts. Each mission names a root and a mode; the chords are
 * sevenths built from semitone tables and glide into each other with
 * `setTargetAtTime`, so the score never steps — it breathes.
 *
 * ── what this is not ─────────────────────────────────────────────────
 *
 * This simulator had a full audio graph once — engine roar, pad voices,
 * ignition and staging one-shots, Quindar tones, spoken launch control — and
 * all of it came out. This is the music and only the music. A rocket makes no
 * sound here; the film it is in has a score.
 *
 * ── the gesture ──────────────────────────────────────────────────────
 *
 * An AudioContext starts suspended and every browser requires a real user
 * gesture to resume it. That is not worked around: `startScore` is called
 * from the click that starts a film, which is a person asking for a film, and
 * a film has music. Nothing here ever makes a sound the visitor did not ask
 * for, and `SCORE.enabled` turns it off for good.
 */

/** Equal temperament, as ratios. One table, built once. */
const SEMI = new Float64Array(25)
for (let i = 0; i < SEMI.length; i++) SEMI[i] = Math.pow(2, i / 12)

/**
 * Chord tables per mode: semitone stacks cycled slowly. Fifths and ninths,
 * no leading tones — this score does not resolve, it hovers.
 */
const MODES = {
  lydian: [
    [0, 4, 7, 11],
    [2, 6, 9, 14],
    [4, 7, 11, 16],
    [7, 11, 14, 18],
  ],
  aeolian: [
    [0, 3, 7, 10],
    [5, 8, 12, 15],
    [3, 7, 10, 14],
    [7, 10, 14, 17],
  ],
  ionian: [
    [0, 4, 7, 11],
    [5, 9, 12, 16],
    [7, 11, 14, 18],
    [4, 7, 11, 15],
  ],
  dorian: [
    [0, 3, 7, 10],
    [2, 5, 9, 12],
    [7, 10, 14, 17],
    [5, 8, 12, 15],
  ],
}

/** Pentatonic ladder the shimmer plucks from, in semitones over the root. */
const LADDER = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21]

/**
 * Per-mission profiles: the root, the mode, and the mix's lean. Frequencies
 * are C2-anchored (65.41 Hz); a mission's key is its mood — the lunar flights
 * hover in aeolian, the departures in lydian, the return in ionian, and
 * re-entry in dorian with the drone an octave up and restless.
 */
export const SCORES = {
  ascent: { root: 65.41, mode: 'lydian', shimmer: 0.55, pad: 0.85, drone: 0.7, tension: 0 },
  lunar: { root: 73.42, mode: 'aeolian', shimmer: 0.8, pad: 0.95, drone: 0.55, tension: 0 },
  rendezvous: { root: 87.31, mode: 'lydian', shimmer: 0.65, pad: 0.8, drone: 0.5, tension: 0 },
  arrival: { root: 55.0, mode: 'aeolian', shimmer: 0.7, pad: 0.9, drone: 0.75, tension: 0 },
  deep: { root: 61.74, mode: 'lydian', shimmer: 0.9, pad: 1.0, drone: 0.65, tension: 0 },
  vigil: { root: 49.0, mode: 'dorian', shimmer: 0.45, pad: 0.75, drone: 0.85, tension: 0.25 },
  departure: { root: 69.3, mode: 'ionian', shimmer: 0.6, pad: 0.85, drone: 0.6, tension: 0 },
  return: { root: 58.27, mode: 'ionian', shimmer: 0.5, pad: 0.9, drone: 0.7, tension: 0.15 },
  fire: { root: 73.42, mode: 'dorian', shimmer: 0.35, pad: 0.7, drone: 0.95, tension: 0.6 },
}

/**
 * Which mission gets which key. A flight leaving Earth is not the flight
 * coming back into it, and the score is the only place this simulator says so
 * without words.
 */
export const SCORE_FOR = {
  'apollo8-launch': 'ascent',
  'artemis-launch': 'ascent',
  'apollo8-parking': 'ascent',
  'apollo11-liftoff': 'lunar',
  'apollo8-moon-survey': 'lunar',
  'apollo11-docking': 'rendezvous',
  'apollo11-csi': 'rendezvous',
  'apollo11-final-docking': 'rendezvous',
  'apollo8-lunar-orbit': 'arrival',
  'artemis-halo': 'deep',
  'vandenberg-polar': 'vigil',
  'apollo8-tli': 'departure',
  'apollo8-tei': 'return',
  'apollo8-canopies': 'return',
  'apollo8-reentry': 'fire',
}

/** The name of the key a mission is in, defaulting to the wide one. */
export const scoreFor = (presetId) => SCORE_FOR[presetId] ?? 'deep'

/* ---------------------------------------------------------------- *
 * State. Typed where the tick reads it; objects built once.
 * ---------------------------------------------------------------- */

/**
 * The dial, read by the tick and written by the interface.
 *
 * `volume` is deliberately modest. Four voices summing through a convolver
 * with no limiter on the end will clip a master at unity long before it
 * sounds loud, and a score that arrives over a film should sit under it.
 */
export const SCORE = { enabled: true, volume: 0.34, running: false }

let ac = null
let built = null
/** Cue targets the tick eases toward: [drone, pad, sub, shimmer, brightness]. */
const TARGET = new Float64Array(5)
const CURRENT = new Float64Array(5)
let chordAt = 0
let chordIx = 0
let shimmerAt = 0
let profile = SCORES.deep

/** Synthesised impulse response: noise through an exponential decay, stereo. */
function makeImpulse(context, seconds = 2.8, decay = 2.4) {
  const rate = context.sampleRate
  const len = Math.floor(rate * seconds)
  const buf = context.createBuffer(2, len, rate)
  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch)
    let seed = ch === 0 ? 0x9e3779b9 : 0x7f4a7c15
    for (let i = 0; i < len; i++) {
      // xorshift, so the tail is noise but the same noise every build.
      seed ^= seed << 13
      seed ^= seed >>> 17
      seed ^= seed << 5
      data[i] = ((seed & 0xffff) / 32768 - 1) * Math.pow(1 - i / len, decay)
    }
  }
  return buf
}

function build(context) {
  const master = context.createGain()
  master.gain.value = 0
  master.connect(context.destination)

  /*
   * The second tap: a stream the film recorder can take.
   *
   * A film of a flight with a score on it is a film; the same film silent is
   * a screen recording. The graph is tapped rather than re-rendered, so what
   * is written into the video is exactly what was heard.
   */
  const tap = typeof context.createMediaStreamDestination === 'function' ? context.createMediaStreamDestination() : null
  if (tap) master.connect(tap)

  // The reverb everything shares.
  const verb = context.createConvolver()
  verb.buffer = makeImpulse(context)
  const verbGain = context.createGain()
  verbGain.gain.value = 0.55
  verb.connect(verbGain).connect(master)

  // The drone: two detuned saws under a low, slow filter.
  const droneGain = context.createGain()
  droneGain.gain.value = 0
  const droneFilter = context.createBiquadFilter()
  droneFilter.type = 'lowpass'
  droneFilter.frequency.value = 190
  droneFilter.Q.value = 0.6
  const droneOscs = []
  for (let i = 0; i < 2; i++) {
    const osc = context.createOscillator()
    osc.type = 'sawtooth'
    osc.frequency.value = 65
    osc.detune.value = i === 0 ? -6 : 7
    osc.connect(droneFilter)
    osc.start()
    droneOscs.push(osc)
  }
  droneFilter.connect(droneGain).connect(master)
  droneGain.connect(verb)

  // The pad: four triangle voices, one per chord tone, gliding between chords.
  const padGain = context.createGain()
  padGain.gain.value = 0
  const padFilter = context.createBiquadFilter()
  padFilter.type = 'lowpass'
  padFilter.frequency.value = 760
  padFilter.Q.value = 0.7
  const padOscs = []
  for (let i = 0; i < 4; i++) {
    const osc = context.createOscillator()
    osc.type = 'triangle'
    osc.frequency.value = 130
    osc.detune.value = (i - 1.5) * 4
    osc.connect(padFilter)
    osc.start()
    padOscs.push(osc)
  }
  padFilter.connect(padGain).connect(master)
  padGain.connect(verb)

  // The sub swell: felt more than heard, one octave under the drone.
  const sub = context.createOscillator()
  sub.type = 'sine'
  sub.frequency.value = 32.7
  const subGain = context.createGain()
  subGain.gain.value = 0
  sub.connect(subGain).connect(master)
  sub.start()

  // The shimmer: a ping-pong pair the note plucks echo through.
  const delayL = context.createDelay(1.5)
  const delayR = context.createDelay(1.5)
  delayL.delayTime.value = 0.38
  delayR.delayTime.value = 0.52
  const fbL = context.createGain()
  const fbR = context.createGain()
  fbL.gain.value = 0.42
  fbR.gain.value = 0.38
  delayL.connect(fbR).connect(delayR)
  delayR.connect(fbL).connect(delayL)
  const shimmerGain = context.createGain()
  shimmerGain.gain.value = 0
  delayL.connect(shimmerGain)
  delayR.connect(shimmerGain)
  shimmerGain.connect(master)
  shimmerGain.connect(verb)

  return { master, tap, verb, droneGain, droneFilter, droneOscs, padGain, padFilter, padOscs, sub, subGain, shimmerGain, delayL, delayR }
}

/* ---------------------------------------------------------------- *
 * Public: start, cue, tick, stop
 * ---------------------------------------------------------------- */

/**
 * Begin the score, in `key`. Must be called from a user gesture: the context
 * is created here and resumed here, and nothing else in this module will ever
 * create one. Returns false where there is no audio to be had, or where the
 * visitor has the score switched off.
 */
export function startScore(key = 'deep') {
  if (!SCORE.enabled) return false
  const Ctx = typeof window !== 'undefined' && (window.AudioContext ?? window.webkitAudioContext)
  if (!Ctx) return false
  try {
    ac ??= new Ctx()
    built ??= build(ac)
  } catch {
    ac = null
    built = null
    return false
  }
  // Suspended until a gesture resumes it; this call is inside one.
  if (ac.state === 'suspended') ac.resume().catch(() => {})
  profile = SCORES[key] ?? SCORES.deep
  SCORE.running = true
  const now = ac.currentTime
  for (const osc of built.droneOscs) osc.frequency.setTargetAtTime(profile.root, now, 2.5)
  built.sub.frequency.setTargetAtTime(profile.root / 2, now, 2.5)
  chordIx = 0
  chordAt = now + 1
  shimmerAt = now + 2
  cueScore('hold')
  built.master.gain.cancelScheduledValues(now)
  built.master.gain.setTargetAtTime(SCORE.volume, now, 2.2)
  return true
}

/**
 * A cue names a lean: `reveal` swells the sub and brightens the pad,
 * `tension` thickens the drone and stills the shimmer, `hold` settles back.
 * Cues only move the targets — `tickScore` does the easing, so a cue is five
 * numbers and the sound changes over seconds, never in steps.
 */
export function cueScore(name) {
  const t = TARGET
  if (name === 'reveal') {
    t[0] = 0.7 * profile.drone
    t[1] = 0.95 * profile.pad
    t[2] = 0.5
    t[3] = 1 * profile.shimmer
    t[4] = 1150
  } else if (name === 'tension') {
    t[0] = 1.15 * (0.6 + profile.tension)
    t[1] = 0.6 * profile.pad
    t[2] = 0.22
    t[3] = 0.18
    t[4] = 520
  } else if (name === 'swell') {
    t[0] = 0.85 * profile.drone
    t[1] = 0.8 * profile.pad
    t[2] = 0.65
    t[3] = 0.75 * profile.shimmer
    t[4] = 980
  } else {
    // 'hold' and anything unknown: the resting lean.
    t[0] = 0.55 * profile.drone
    t[1] = 0.7 * profile.pad
    t[2] = 0.18
    t[3] = 0.55 * profile.shimmer
    t[4] = 760
  }
}

/**
 * The tick. Mutates AudioParams and advances two event clocks; nothing is
 * created here but a shimmer note, which is an event and not part of the
 * graph. `dt` is seconds.
 */
export function tickScore(dt) {
  if (!built || !SCORE.running) return
  const now = ac.currentTime
  // Ease the current lean toward its target — one pole per parameter.
  const k = 1 - Math.exp(-Math.max(0, Math.min(dt, 0.25)) / 3.2)
  for (let i = 0; i < 5; i++) CURRENT[i] += (TARGET[i] - CURRENT[i]) * k
  const level = SCORE.enabled ? SCORE.volume : 0
  built.droneGain.gain.value = CURRENT[0]
  built.padGain.gain.value = CURRENT[1]
  built.subGain.gain.value = CURRENT[2]
  built.shimmerGain.gain.value = CURRENT[3]
  built.padFilter.frequency.value = CURRENT[4]
  // The dial can move while the score is running; follow it smoothly rather
  // than stepping, because a step in a gain is a click.
  built.master.gain.setTargetAtTime(level, now, 0.25)

  // Chords glide on their own slow clock.
  if (now >= chordAt) {
    const table = MODES[profile.mode]
    const chord = table[chordIx % table.length]
    chordIx++
    chordAt = now + 17 + (chordIx % 3) * 4
    for (let i = 0; i < 4; i++) {
      const semis = chord[i]
      const f = profile.root * 2 * SEMI[Math.min(SEMI.length - 1, Math.max(0, semis))]
      built.padOscs[i].frequency.setTargetAtTime(f, now, 5.5)
    }
  }

  // Shimmer notes are the only events: one oscillator each, scheduled ahead,
  // gone when silent.
  if (now >= shimmerAt && level > 0 && CURRENT[3] > 0.12) {
    shimmerAt = now + 2.6 + Math.random() * 4.2
    pluck(now + 0.05, LADDER[(Math.random() * LADDER.length) | 0], 0.16 + Math.random() * 0.1)
  }
}

/** One shimmer note: a soft sine pluck into the delay pair. */
function pluck(when, semis, gain) {
  const osc = ac.createOscillator()
  const g = ac.createGain()
  osc.type = 'sine'
  osc.frequency.value = profile.root * 4 * SEMI[Math.min(SEMI.length - 1, semis)]
  g.gain.setValueAtTime(0, when)
  g.gain.linearRampToValueAtTime(gain, when + 0.06)
  g.gain.exponentialRampToValueAtTime(0.0004, when + 3.2)
  osc.connect(g)
  g.connect(built.delayL)
  g.connect(built.delayR)
  osc.start(when)
  osc.stop(when + 3.4)
}

/**
 * Fade the score out and settle it, ready to be started again.
 *
 * The graph is kept: its oscillators are already running and rebuilding them
 * would mean another impulse response and another four seconds of silence
 * before the next film had a score. A gain at zero costs nothing to hold.
 */
export function stopScore(seconds = 1.6) {
  if (!built) return
  SCORE.running = false
  const now = ac.currentTime
  built.master.gain.cancelScheduledValues(now)
  built.master.gain.setTargetAtTime(0, now, Math.max(0.05, seconds / 3))
  TARGET.fill(0)
  CURRENT.fill(0)
}

/** The audio track a film should carry, or null where there is none. */
export const scoreTrack = () => built?.tap?.stream.getAudioTracks()[0] ?? null

/** For the interface and the gate: what the score is doing. */
export const scoreState = () => ({
  running: SCORE.running,
  mode: profile.mode,
  root: profile.root,
  chordIx,
  current: Array.from(CURRENT),
})
