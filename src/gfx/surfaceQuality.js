/**
 * How much the surface scene draws, decided by the frames themselves.
 *
 * The simulator has had a governor for a long time (components/Resolution.jsx);
 * the expeditions had none. They asked for up to 1.5 device pixels per CSS
 * pixel and a 2048 shadow map on every machine, and on a slow laptop that was
 * a 2160 x 1350 buffer at two or three frames a second: playable on the
 * machine it was built on and not on the ones people actually have.
 *
 * Four tiers, cheapest last. Each step gives up the most expensive thing that
 * changes the picture least: pixels first, then shadow resolution, then
 * shadows, surface relief and reflections, then distant rocks. The tier a machine settles
 * at is remembered in this browser, so a slow machine's second visit starts
 * where its first one ended instead of relearning it at three frames a second.
 *
 * The player can also pin it: "high" holds tier 0, "low" holds tier 3, and
 * "auto" (the default) lets the frames decide.
 */
import { SLOW_MS, FAST_MS } from './frameStats.js'

export const TIERS = [
  { name: 'High', dpr: 1.5, shadow: 2048, shadows: true, relief: true, reflections: true, rocks: 1 },
  { name: 'Medium', dpr: 1, shadow: 1024, shadows: true, relief: true, reflections: true, rocks: 1 },
  { name: 'Low', dpr: 0.8, shadow: 1024, shadows: false, relief: false, reflections: false, rocks: 0.6 },
  { name: 'Lowest', dpr: 0.6, shadow: 512, shadows: false, relief: false, reflections: false, rocks: 0.3 },
]

const MODE_KEY = 'pz-surface-quality'
const TIER_KEY = 'pz-surface-tier'

const read = (key, fallback) => { try { return localStorage.getItem(key) ?? fallback } catch { return fallback } }
const write = (key, value) => { try { localStorage.setItem(key, String(value)) } catch { /* private mode */ } }

const state = {
  mode: ['auto', 'high', 'low'].includes(read(MODE_KEY, 'auto')) ? read(MODE_KEY, 'auto') : 'auto',
  learned: Math.min(TIERS.length - 1, Math.max(0, Number(read(TIER_KEY, 0)) || 0)),
}
const listeners = new Set()
let snapshot = null

function current() {
  return state.mode === 'high' ? 0 : state.mode === 'low' ? TIERS.length - 1 : state.learned
}

/** What the scene should draw now: `{ tier, mode, ...TIERS[tier] }`. Stable between changes. */
export function surfaceQuality() {
  const tier = current()
  if (!snapshot || snapshot.tier !== tier || snapshot.mode !== state.mode) snapshot = { tier, mode: state.mode, ...TIERS[tier] }
  return snapshot
}
export function subscribeSurfaceQuality(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
const emit = () => { for (const fn of listeners) fn() }

export function setSurfaceMode(mode) {
  state.mode = mode
  write(MODE_KEY, mode)
  emit()
}

/** The governor's own move, in auto mode only. */
function setLearned(tier) {
  if (tier === state.learned) return
  state.learned = tier
  write(TIER_KEY, tier)
  emit()
}

/*
 * The decision, fed one frame time at a time by the scene. Allocation-free:
 * a running sum per window, and counters for confirmation and hold-off.
 */
/*
 * Windows end on frames *or* time, whichever comes first: ninety frames is
 * 1.5 s at sixty, but fifteen seconds at six, and a slow machine is exactly
 * the one that cannot wait that long to be rescued.
 */
const WINDOW = 90
const WINDOW_MS = 1500
/** Ignored after any change: the first frames pay for reallocating targets and recompiling. */
const SETTLE = 30
const SETTLE_MS = 700
/** Windows on the fast side before a step back up; failed rungs wait longer each time. */
const UP_AFTER = 4
const gov = { n: 0, sum: 0, settle: SETTLE, settleMs: SETTLE_MS, slow: 0, fast: 0, long: 0, failedAt: -1, holdFor: UP_AFTER }

export function resetSurfaceGovernor() {
  gov.n = 0; gov.sum = 0; gov.settle = SETTLE; gov.settleMs = SETTLE_MS; gov.slow = 0; gov.fast = 0
}
function settle() { gov.settle = SETTLE; gov.settleMs = SETTLE_MS }

export function governSurface(ms) {
  if (state.mode !== 'auto') return
  // One frame longer than a quarter second is a stall (a shader compiling, a
  // tab returning), not the machine's pace. Three in a row *are* its pace:
  // the first version ignored every such frame, so a machine drawing at two
  // frames a second never looked slow to the thing meant to rescue it.
  if (ms > 250) {
    if (++gov.long < 3) return
    ms = Math.min(ms, 1000)
  } else gov.long = 0
  if (gov.settle > 0 && gov.settleMs > 0) { gov.settle--; gov.settleMs -= ms; return }
  gov.sum += ms
  if (++gov.n < WINDOW && gov.sum < WINDOW_MS) return
  const mean = gov.sum / gov.n
  gov.n = 0
  gov.sum = 0
  if (mean > SLOW_MS) { gov.slow++; gov.fast = 0 } else if (mean < FAST_MS) { gov.fast++; gov.slow = 0 } else { gov.slow = 0; gov.fast = 0 }
  // Very slow drops at once; merely slow needs two windows in a row.
  const down = mean > 45 || gov.slow >= 2
  if (down && state.learned < TIERS.length - 1) {
    gov.failedAt = state.learned
    gov.holdFor = Math.min(gov.holdFor * 2, 32)
    gov.slow = 0
    settle()
    setLearned(state.learned + 1)
  } else if (gov.fast >= (state.learned - 1 === gov.failedAt ? gov.holdFor : UP_AFTER) && state.learned > 0) {
    gov.fast = 0
    settle()
    setLearned(state.learned - 1)
  }
}
