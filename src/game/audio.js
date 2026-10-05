/**
 * The game's sound.
 *
 * Music is the owner's track (public/audio/lexin-space-ambient-sci-fi.mp3),
 * looped under the game, ducked while someone is talking, with its own
 * volume. Effects are short and synthesised here (no samples to download):
 * guns, hits, blasts, the drive, docking clamps, alarms and the mission
 * stings. Both start only from a click (browsers require it), and both have
 * a switch. The simulator's own rule, that it makes no sound of its own,
 * is the simulator's: this module is only ever loaded by the game.
 */
const MUSIC = `${import.meta.env.BASE_URL}audio/lexin-space-ambient-sci-fi.mp3`
const SETTINGS_KEY = 'pz-game-sound-v1'

let ctx = null, master = null, musicGain = null, sfxGain = null, musicEl = null, noise = null
let engine = null
const state = { music: 0.55, sfx: 0.7, muted: false, started: false }
try { Object.assign(state, JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}')) } catch { /* defaults */ }
export const soundSettings = () => ({ music: state.music, sfx: state.sfx, muted: state.muted })
function persist() { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify({ music: state.music, sfx: state.sfx, muted: state.muted })) } catch { /* fine */ } }

/** Call from a click: builds the graph and starts the music. */
export function startSound() {
  if (state.started) { ctx?.resume?.(); return }
  const AC = window.AudioContext || window.webkitAudioContext
  if (!AC) return
  ctx = new AC()
  master = ctx.createGain(); master.gain.value = state.muted ? 0 : 1; master.connect(ctx.destination)
  musicGain = ctx.createGain(); musicGain.gain.value = 0; musicGain.connect(master)
  sfxGain = ctx.createGain(); sfxGain.gain.value = state.sfx; sfxGain.connect(master)
  musicEl = new Audio(MUSIC)
  musicEl.loop = true
  musicEl.crossOrigin = 'anonymous'
  ctx.createMediaElementSource(musicEl).connect(musicGain)
  musicEl.play().catch(() => {})
  musicGain.gain.setTargetAtTime(state.music, ctx.currentTime, 2.5)
  // White noise, once, for every hiss and blast.
  noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate)
  const d = noise.getChannelData(0)
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
  // The engine: a low hum and a hiss that rise with thrust.
  const hum = ctx.createOscillator(); hum.type = 'sawtooth'; hum.frequency.value = 42
  const hiss = ctx.createBufferSource(); hiss.buffer = noise; hiss.loop = true
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 300
  const eg = ctx.createGain(); eg.gain.value = 0
  hum.connect(lp); hiss.connect(lp); lp.connect(eg); eg.connect(sfxGain)
  hum.start(); hiss.start()
  engine = { hum, lp, eg }
  state.started = true
  // Safari will not let a context or a track start outside a gesture; the
  // first key or click in the game wakes both, whatever started them.
  const wake = () => { ctx?.resume?.(); if (musicEl?.paused) musicEl.play().catch(() => {}) }
  window.addEventListener('pointerdown', wake, { once: true, capture: true })
  window.addEventListener('keydown', wake, { once: true, capture: true })
}
export function setMusic(v) { state.music = v; persist(); if (musicGain) musicGain.gain.setTargetAtTime(v, ctx.currentTime, 0.3) }
export function setSfx(v) { state.sfx = v; persist(); if (sfxGain) sfxGain.gain.setTargetAtTime(v, ctx.currentTime, 0.1) }
export function setMuted(m) { state.muted = m; persist(); if (master) master.gain.setTargetAtTime(m ? 0 : 1, ctx.currentTime, 0.1) }
export function pauseSound(p) { if (!ctx) return; if (p) ctx.suspend(); else ctx.resume() }

/** Music dips while someone is on the comms. */
export function duck(on) { if (musicGain) musicGain.gain.setTargetAtTime(on ? state.music * 0.45 : state.music, ctx.currentTime, 0.4) }

/** Engine sound from the player's thrust (0..1+) and boost. */
export function engineLevel(thrust, boosting, flying) {
  if (!engine) return
  const t = ctx.currentTime
  const lvl = flying ? Math.min(1, thrust) * (boosting ? 1.4 : 1) : 0
  engine.eg.gain.setTargetAtTime(0.02 + lvl * 0.09, t, 0.15)
  engine.lp.frequency.setTargetAtTime(220 + lvl * 900, t, 0.2)
  engine.hum.frequency.setTargetAtTime(38 + lvl * 26, t, 0.3)
}

/* ------------------------------------------------------------------ *
 * Effects
 * ------------------------------------------------------------------ */
function env(g, t, a, peak, dur) { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + dur) }
function tone(type, f0, f1, dur, vol, at = 0) {
  const t = ctx.currentTime + at
  const o = ctx.createOscillator(), g = ctx.createGain()
  o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur)
  env(g, t, 0.005, vol, dur)
  o.connect(g); g.connect(sfxGain); o.start(t); o.stop(t + dur + 0.05)
}
function hiss(f0, f1, q, dur, vol, at = 0, type = 'bandpass') {
  const t = ctx.currentTime + at
  const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain()
  s.buffer = noise; f.type = type; f.Q.value = q
  f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur)
  env(g, t, 0.01, vol, dur)
  s.connect(f); f.connect(g); g.connect(sfxGain); s.start(t, Math.random()); s.stop(t + dur + 0.05)
}

/** A sound for a game event; `near` is 0..1 by distance (1 = here). */
export function play(type, near = 1, extra = {}) {
  if (!ctx || !state.started || near < 0.03) return
  const v = Math.min(1, near)
  switch (type) {
    case 'fire': tone('square', extra.player ? 980 : 760, 180, 0.09, 0.05 * v); hiss(4000, 1200, 1.2, 0.06, 0.03 * v); break
    case 'hit-shield': tone('sine', 1500, 600, 0.12, 0.05 * v); hiss(6000, 3000, 3, 0.1, 0.04 * v); break
    case 'hit-hull': hiss(1800, 300, 0.8, 0.18, 0.12 * v); tone('triangle', 140, 60, 0.15, 0.08 * v); break
    case 'explode': hiss(1200, 60, 0.6, 1.6, 0.3 * v, 0, 'lowpass'); tone('sine', 90, 30, 1.2, 0.25 * v); break
    case 'bump': tone('triangle', 110, 50, 0.25, 0.18 * v); hiss(900, 200, 1, 0.2, 0.08 * v); break
    case 'pickup': tone('sine', 660, 990, 0.12, 0.08); tone('sine', 990, 1320, 0.12, 0.06, 0.08); break
    case 'paid': [784, 988, 1175].forEach((f, i) => tone('triangle', f, f, 0.18, 0.06, i * 0.07)); break
    case 'target': tone('square', 1800, 1800, 0.03, 0.03); break
    case 'comms': hiss(3000, 2500, 4, 0.12, 0.04); tone('sine', 1200, 1200, 0.05, 0.03, 0.1); break
    case 'denied': tone('square', 220, 200, 0.18, 0.06); tone('square', 180, 160, 0.2, 0.06, 0.2); break
    case 'heat': for (let i = 0; i < 3; i++) { tone('square', 880, 880, 0.12, 0.05, i * 0.25); tone('square', 660, 660, 0.12, 0.05, i * 0.25 + 0.12) } break
    case 'dock-start': hiss(800, 300, 1, 1.4, 0.06); break
    case 'dock': tone('triangle', 90, 45, 0.4, 0.2); hiss(2500, 600, 1, 0.3, 0.1, 0.05); tone('triangle', 70, 40, 0.3, 0.15, 0.35); break
    case 'launch': hiss(400, 2500, 0.8, 1.5, 0.08); tone('sawtooth', 50, 90, 1.5, 0.05); break
    case 'burn': hiss(200, 900, 0.6, 2.5, 0.12, 0, 'lowpass'); tone('sawtooth', 35, 60, 2.5, 0.08); break
    case 'flip': hiss(600, 2400, 1, 1.2, 0.07); break
    case 'arrive': hiss(900, 120, 0.6, 1.8, 0.1, 0, 'lowpass'); break
    case 'boost': hiss(500, 3000, 0.7, 0.6, 0.06); break
    case 'mission-complete': [523, 659, 784, 1047].forEach((f, i) => tone('triangle', f, f, 0.5, 0.07, i * 0.12)); break
    case 'mission-failed': [392, 311, 262].forEach((f, i) => tone('triangle', f, f * 0.98, 0.5, 0.07, i * 0.18)); break
    case 'objective': tone('sine', 880, 880, 0.12, 0.05); tone('sine', 1320, 1320, 0.16, 0.05, 0.1); break
    case 'click': tone('square', 1400, 1400, 0.02, 0.02); break
  }
}

/** For checks: is sound running, and how far into the track is the music. */
export function soundDebug() {
  return { started: state.started, ctx: ctx?.state ?? null, music: musicEl ? { time: musicEl.currentTime, paused: musicEl.paused, loop: musicEl.loop, src: musicEl.src.split('/').pop(), ready: musicEl.readyState } : null, musicGain: musicGain?.gain.value ?? null, sfxGain: sfxGain?.gain.value ?? null }
}
if (import.meta.env?.DEV && typeof window !== 'undefined') window.__pzAudio = { soundDebug, play }
