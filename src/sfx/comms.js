import { audioContext } from './engine.js'

/**
 * The sound of the loop: the tones, the static, and the voices.
 *
 * Every transmission from Houston to an Apollo spacecraft is bracketed by two
 * short tones, and they are the most recognisable sound in the whole program.
 * They were never meant to be heard. The ground stations that relayed the
 * capsule communicator's voice were keyed remotely, over the same circuit the
 * voice used, and the key was a tone: 2,525 Hz for a quarter of a second to
 * turn the transmitter on, 2,475 Hz to turn it off — Quindar tones, after the
 * company that made the equipment. The public heard them because the public
 * heard the circuit. The spacecraft's own transmissions had none, so they are
 * here only on the ground's lines, which is how every recording has them.
 *
 * Under a transmission, the static of a voice channel: noise band-limited to
 * the 300–3,000 Hz a telephone-grade circuit carries, low enough to sit under
 * the words. At the end of a transmission from the spacecraft, the squelch
 * tail — the burst a receiver lets through as the carrier drops.
 *
 * The words themselves, where the browser has a voice to say them in, through
 * the Web Speech API. That output does not pass through Web Audio, so it cannot
 * be band-limited like the rest; it is chosen per speaker and pitched down a
 * little, and the tones and the static around it do the rest. Where there is
 * no synthesiser, or the voice is switched off, the loop is captions only and
 * the tones still sound.
 *
 * Event-rate throughout: one oscillator per tone, created as a transmission
 * starts and released to the collector when it stops. Nothing here runs per
 * frame.
 */

/** Quindar tones, Hz, and how long each sounds, s. */
export const QUINDAR_ON = 2525
export const QUINDAR_OFF = 2475
export const QUINDAR_SECONDS = 0.25

/** The voice channel's pass band, Hz. */
const BAND_LOW = 300
const BAND_HIGH = 3000

let bus = null
let staticGain = null
let enabled = true
let voice = true

function build(ac) {
  const out = ac.createGain()
  out.gain.value = 1
  out.connect(ac.destination)

  // White noise through the channel's band: a high-pass at the bottom of the
  // band into a low-pass at the top.
  const seconds = 2
  const buffer = ac.createBuffer(1, Math.floor(ac.sampleRate * seconds), ac.sampleRate)
  const data = buffer.getChannelData(0)
  let s = 0x2f6b1d3
  for (let i = 0; i < data.length; i++) {
    s ^= s << 13
    s ^= s >>> 17
    s ^= s << 5
    data[i] = ((s >>> 0) / 4294967296) * 2 - 1
  }
  const noise = ac.createBufferSource()
  noise.buffer = buffer
  noise.loop = true
  const high = ac.createBiquadFilter()
  high.type = 'highpass'
  high.frequency.value = BAND_LOW
  const low = ac.createBiquadFilter()
  low.type = 'lowpass'
  low.frequency.value = BAND_HIGH
  const g = ac.createGain()
  g.gain.value = 0
  noise.connect(high)
  high.connect(low)
  low.connect(g)
  g.connect(out)
  noise.start()
  staticGain = g
  return out
}

function ready() {
  const ac = audioContext()
  if (!ac || ac.state !== 'running') return null
  if (!bus) {
    try {
      bus = build(ac)
    } catch (error) {
      console.error('[periapsis] the radio loop did not build', error)
      bus = null
      return null
    }
  }
  return ac
}

/** One tone, `seconds` long, with 8 ms edges so it does not click. */
function tone(ac, hz, at, seconds = QUINDAR_SECONDS, level = 0.07) {
  const osc = ac.createOscillator()
  osc.type = 'sine'
  osc.frequency.value = hz
  const g = ac.createGain()
  g.gain.setValueAtTime(0, at)
  g.gain.linearRampToValueAtTime(level, at + 0.008)
  g.gain.setValueAtTime(level, at + seconds - 0.008)
  g.gain.linearRampToValueAtTime(0, at + seconds)
  osc.connect(g)
  g.connect(bus)
  osc.start(at)
  osc.stop(at + seconds + 0.02)
}

/** The burst a receiver lets through as a carrier drops away. */
function squelch(ac, at) {
  staticGain.gain.setValueAtTime(0.05, at)
  staticGain.gain.exponentialRampToValueAtTime(0.0005, at + 0.12)
  staticGain.gain.setValueAtTime(0, at + 0.13)
}

/* ---------------------------------------------------------------- *
 * Voices
 * ---------------------------------------------------------------- */

const synth = typeof window !== 'undefined' && 'speechSynthesis' in window ? window.speechSynthesis : null
let voices = null

/**
 * A voice for each speaker. English voices only, American first; the three
 * speakers get different voices where the browser has three, and different
 * pitches where it has fewer, so the ground, the spacecraft and the narration
 * never sound like one person talking to themselves.
 */
function pickVoices() {
  if (!synth) return null
  const all = synth.getVoices().filter((v) => /^en[-_]/i.test(v.lang))
  if (!all.length) return null
  const us = all.filter((v) => /US/i.test(v.lang))
  const pool = us.length >= 2 ? us : all
  const pick = (i) => pool[i % pool.length]
  return { pao: pick(0), ground: pick(1), crew: pick(2), partner: pick(3) }
}

if (synth) {
  synth.addEventListener?.('voiceschanged', () => {
    voices = pickVoices()
  })
}

const PITCH = { pao: 1.0, ground: 0.92, crew: 0.82, partner: 0.9 }
const RATE = { pao: 1.02, ground: 1.05, crew: 1.08, partner: 1.06 }

/** The utterance being said, and whether the synthesiser has actually begun it. */
let talking = false
let speakingNow = null

function speak(tx) {
  if (!synth || !voice) return
  voices ??= pickVoices()
  // A count line cuts in, on the second, over whatever is still being said.
  if (tx.urgent) synth.cancel()
  const u = new SpeechSynthesisUtterance(tx.text)
  const v = voices?.[tx.who]
  if (v) u.voice = v
  u.lang = v?.lang ?? 'en-US'
  u.pitch = PITCH[tx.who] ?? 1
  u.rate = RATE[tx.who] ?? 1
  u.volume = 0.9
  /*
   * Held by this utterance's own events, not by `speechSynthesis.speaking`,
   * which reports the whole synthesiser: a queued or stalled utterance kept it
   * true, and every caption behind it waited the full four-second grace —
   * measured, the count lost ten, nine and eight that way.
   */
  // Only this utterance's own end clears the flag: a line cancelled by the
  // count reports its end after the next one has begun.
  speakingNow = u
  u.onstart = () => {
    if (speakingNow === u) talking = true
  }
  u.onend = u.onerror = () => {
    if (speakingNow === u) talking = false
  }
  synth.speak(u)
}

/** Whether a line is still being spoken — so a caption is not taken down mid-word. */
export const speaking = () => talking

/* ---------------------------------------------------------------- *
 * The loop's two events
 * ---------------------------------------------------------------- */

/**
 * A transmission begins or ends. `kind` is 'start' or 'end'; `tx` is the
 * scheduler's transmission (`sim/radio.js`).
 */
export function transmit(kind, tx) {
  if (!enabled) return
  const ac = ready()
  if (kind === 'start') {
    let lead = 0
    if (ac) {
      const now = ac.currentTime
      if (tx.who === 'ground') {
        tone(ac, QUINDAR_ON, now)
        lead = QUINDAR_SECONDS
      }
      if (tx.who !== 'pao') staticGain.gain.setTargetAtTime(0.016, now + lead, 0.03)
    }
    // The words after the tone, as on the loop.
    if (lead > 0) setTimeout(() => speak(tx), lead * 1000)
    else speak(tx)
    return
  }
  if (!ac) return
  const now = ac.currentTime
  if (tx.who === 'pao') return
  staticGain.gain.setTargetAtTime(0, now, 0.04)
  if (tx.who === 'ground') tone(ac, QUINDAR_OFF, now + 0.05)
  else squelch(ac, now + 0.02)
}

/** The mute and the voice switch, from the page's toggles. */
export function setComms(on, speech = true) {
  enabled = Boolean(on)
  voice = Boolean(speech)
  if ((!enabled || !voice) && synth) {
    synth.cancel()
    talking = false
  }
  if (!enabled && staticGain) staticGain.gain.value = 0
}

/** Stop whatever is being said: the feed was left, or the page is going. */
export function hushComms() {
  synth?.cancel()
  talking = false
  if (staticGain) staticGain.gain.value = 0
}
