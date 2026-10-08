/** Music only. The simulator's supplied ambient bed is the sole recording. */
import { setAmbience } from '../sfx/ambience.js'

const MUSIC = `${import.meta.env.BASE_URL}audio/monume-space-ambient.mp3`
const SETTINGS_KEY = 'pz-game-sound-v1'
let musicEl = null
let paused = false
const state = { music: 0.55, muted: false }
try {
  const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? 'null')
  if (Number.isFinite(saved?.music)) state.music = Math.max(0, Math.min(1, saved.music))
  state.muted = saved?.muted === true
} catch { /* private storage */ }
export const soundSettings = () => ({ ...state })
function persist() { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(state)) } catch { /* private storage */ } }
function volume() { if (musicEl) musicEl.volume = state.muted ? 0 : state.music }

/** Called only after choosing to play; no oscillator, engine, voice or stinger. */
export function startSound() {
  setAmbience(false) // Switching cockpits must never layer two copies of the bed.
  if (!musicEl) {
    musicEl = new Audio(MUSIC)
    musicEl.loop = true
    musicEl.preload = 'none'
  }
  paused = false
  volume()
  musicEl.play().catch(() => { /* a later explicit gesture can retry */ })
}
export function setMusic(v) { state.music = Math.max(0, Math.min(1, v)); persist(); volume() }
export function setMuted(m) { state.muted = Boolean(m); persist(); volume() }
export function pauseSound(p) {
  paused = p
  if (p) musicEl?.pause()
  else musicEl?.play().catch(() => { /* gesture required */ })
}
export function stopSound() { paused = true; musicEl?.pause() }
// Retained event interfaces: visual feedback still works, but creates no audio.
export function duck() {}
export function engineLevel() {}
export function play() {}
export function soundDebug() {
  return { started: Boolean(musicEl), paused, effects: false, music: musicEl ? { time: musicEl.currentTime, paused: musicEl.paused, loop: musicEl.loop, src: musicEl.src.split('/').pop(), ready: musicEl.readyState } : null }
}
if (import.meta.env?.DEV && typeof window !== 'undefined') window.__pzAudio = { soundDebug, play }
