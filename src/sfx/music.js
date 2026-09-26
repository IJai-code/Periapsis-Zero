/**
 * The cosmic score: generative, synthesised, and quiet about it.
 *
 * No sound files — the same rule as the engine. A drone, a pad, a sub swell and
 * a shimmer through a ping-pong delay into a synthesised reverb, all built on
 * the same AudioContext the engine holds, all driven by mutating AudioParams:
 * the frame path allocates nothing and schedules nothing new per voice, exactly
 * like `applyMix`. Notes are events, not state, so they are scheduled from a
 * lookahead timer outside the frame loop, one `OscillatorNode` per note and
 * released to the GC once silent — the frame path never touches them.
 *
 * The language is the reference film's: slow harmonic rhythm, sub-bass that
 * you feel before you hear, long reverb tails, and swells that arrive with
 * reveals rather than with cuts. Each mission names a root and a mode; the
 * chords are sevenths built from semitone tables and glide into each other
 * with `setTargetAtTime`, so the score never steps, it breathes.
 */

import { audioContext } from './engine.js'

/** Equal temperament, as ratios. One Math.pow table, built once. */
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
export const MUSIC = {
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

/* ---------------------------------------------------------------- *
 * State. Typed where the frame path reads it; objects built once.
 * ---------------------------------------------------------------- */

let built = null
/** Cue targets the tick eases toward: [drone, pad, sub, shimmer, brightness]. */
const TARGET = new Float64Array(5)
const CURRENT = new Float64Array(5)
let chordAt = 0
let chordIx = 0
let shimmerAt = 0
let profile = MUSIC.deep
let running = false

/** Synthesised impulse response: noise through an exponential decay, stereo. */
function makeImpulse(ac, seconds = 2.8, decay = 2.4) {
  const rate = ac.sampleRate
  const len = Math.floor(rate * seconds)
  const buf = ac.createBuffer(2, len, rate)
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

function buildMusic(ac) {
  const master = ac.createGain()
  master.gain.value = 0
  master.connect(ac.destination)

  // The reverb everything shares.
  const verb = ac.createConvolver()
  verb.buffer = makeImpulse(ac)
  const verbGain = ac.createGain()
  verbGain.gain.value = 0.55
  verb.connect(verbGain).connect(master)

  // The drone: two detuned saws under a low, slow filter.
  const droneGain = ac.createGain()
  droneGain.gain.value = 0
  const droneFilter = ac.createBiquadFilter()
  droneFilter.type = 'lowpass'
  droneFilter.frequency.value = 190
  droneFilter.Q.value = 0.6
  const droneOscs = []
  for (let i = 0; i < 2; i++) {
    const osc = ac.createOscillator()
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
  const padGain = ac.createGain()
  padGain.gain.value = 0
  const padFilter = ac.createBiquadFilter()
  padFilter.type = 'lowpass'
  padFilter.frequency.value = 760
  padFilter.Q.value = 0.7
  const padOscs = []
  for (let i = 0; i < 4; i++) {
    const osc = ac.createOscillator()
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
  const sub = ac.createOscillator()
  sub.type = 'sine'
  sub.frequency.value = 32.7
  const subGain = ac.createGain()
  subGain.gain.value = 0
  sub.connect(subGain).connect(master)
  sub.start()

  // The shimmer: a ping-pong pair the note plucks echo through.
  const delayL = ac.createDelay(1.5)
  const delayR = ac.createDelay(1.5)
  delayL.delayTime.value = 0.38
  delayR.delayTime.value = 0.52
  const fbL = ac.createGain()
  const fbR = ac.createGain()
  fbL.gain.value = 0.42
  fbR.gain.value = 0.38
  delayL.connect(fbR).connect(delayR)
  delayR.connect(fbL).connect(delayL)
  const shimmerGain = ac.createGain()
  shimmerGain.gain.value = 0
  delayL.connect(shimmerGain)
  delayR.connect(shimmerGain)
  shimmerGain.connect(master)
  shimmerGain.connect(verb)

  return {
    master,
    verb,
    droneGain,
    droneFilter,
    droneOscs,
    padGain,
    padFilter,
    padOscs,
    sub,
    subGain,
    shimmerGain,
    delayL,
    delayR,
  }
}

/* ---------------------------------------------------------------- *
 * Public: start, cue, tick, stop
 * ---------------------------------------------------------------- */

/**
 * Begin the score. Builds on first use — the AudioContext only exists after
 * the unlock gesture, which is the engine's rule and this module's.
 */
export function startMusic(profileName = 'deep') {
  const ac = audioContext()
  if (!ac) return false
  if (!built) {
    try {
      built = buildMusic(ac)
    } catch {
      built = null
      return false
    }
  }
  profile = MUSIC[profileName] ?? MUSIC.deep
  running = true
  const now = ac.currentTime
  // The drone's pitch is the profile's; the pad starts on the first chord.
  for (const osc of built.droneOscs) osc.frequency.setTargetAtTime(profile.root, now, 2.5)
  built.sub.frequency.setTargetAtTime(profile.root / 2, now, 2.5)
  chordIx = 0
  chordAt = now + 1
  shimmerAt = now + 2
  built.master.gain.setTargetAtTime(0.9, now, 1.8)
  return true
}

/**
 * A cue names a lean: `reveal` swells the sub and brightens the pad, `tension`
 * thickens the drone and stills the shimmer, `hold` settles back. Cues only
 * move the targets — `musicTick` does the easing, so a cue is four numbers and
 * the sound changes over seconds, never in steps.
 */
export function cueMusic(name) {
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
 * The frame path. Mutates AudioParams and advances two event clocks; nothing
 * is created here. `dt` is seconds; `gate` follows the engine's mute.
 */
export function musicTick(dt, gate = 1) {
  if (!built || !running) return
  const ac = built.master.context
  const now = ac.currentTime
  // Ease the current lean toward its target — one pole per parameter.
  const k = 1 - Math.exp(-dt / 3.2)
  for (let i = 0; i < 5; i++) CURRENT[i] += (TARGET[i] - CURRENT[i]) * k
  const mute = gate > 0 ? 1 : 0
  built.droneGain.gain.value = CURRENT[0] * mute
  built.padGain.gain.value = CURRENT[1] * mute
  built.subGain.gain.value = CURRENT[2] * mute
  built.shimmerGain.gain.value = CURRENT[3] * mute
  built.padFilter.frequency.value = CURRENT[4]

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
  // gone when silent. Outside the frame path's allocation budget by design.
  if (now >= shimmerAt && mute > 0 && CURRENT[3] > 0.12) {
    shimmerAt = now + 2.6 + Math.random() * 4.2
    pluck(now + 0.05, LADDER[(Math.random() * LADDER.length) | 0], 0.16 + Math.random() * 0.1)
  }
}

/** One shimmer note: a soft sine pluck into the delay pair. */
function pluck(when, semis, gain) {
  const ac = built.master.context
  const osc = ac.createOscillator()
  const g = ac.createGain()
  osc.type = 'sine'
  osc.frequency.value = profile.root * 4 * SEMI[Math.min(SEMI.length - 1, semis)]
  g.gain.value = 0
  g.gain.setValueAtTime(0, when)
  g.gain.linearRampToValueAtTime(gain, when + 0.06)
  g.gain.exponentialRampToValueAtTime(0.0004, when + 3.2)
  osc.connect(g)
  g.connect(built.delayL)
  g.connect(built.delayR)
  osc.start(when)
  osc.stop(when + 3.4)
}

/** Fade the score out and settle it, ready to be started again. */
export function stopMusic() {
  if (!built) return
  running = false
  const now = built.master.context.currentTime
  built.master.gain.setTargetAtTime(0, now, 1.2)
  TARGET.fill(0)
  CURRENT.fill(0)
}

/** For the HUD and the gate: what the score is doing. */
export function musicState() {
  return { running, profile: profile.mode, chordIx, current: Array.from(CURRENT) }
}
