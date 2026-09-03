import { useSyncExternalStore } from 'react'

/**
 * Minimal external store for UI state.
 *
 * React context does not cross the <Canvas> boundary — R3F renders into its own
 * reconciler root — so HUD controls and scene components need a shared channel
 * that does not depend on the React tree. useSyncExternalStore keeps it correct
 * under concurrent rendering.
 */
function createStore(initial) {
  let state = initial
  const listeners = new Set()
  return {
    get: () => state,
    set(patch) {
      const next = typeof patch === 'function' ? patch(state) : patch
      state = { ...state, ...next }
      listeners.forEach((l) => l())
    },
    subscribe(l) {
      listeners.add(l)
      return () => listeners.delete(l)
    },
  }
}

/** Time-warp ladder, in simulated seconds per wall-clock second. */
export const WARP_LEVELS = [
  { label: 'real time', short: '1×', rate: 1 },
  { label: '1 min / s', short: '1m', rate: 60 },
  { label: '1 hour / s', short: '1h', rate: 3600 },
  { label: '6 hours / s', short: '6h', rate: 21600 },
  { label: '1 day / s', short: '1d', rate: 86400 },
  { label: '3 days / s', short: '3d', rate: 259200 },
  { label: '1 week / s', short: '1w', rate: 604800 },
  { label: '1 month / s', short: '1mo', rate: 2629800 },
]

/**
 * The side panels are sized for a desktop viewport. On anything narrower they
 * would cover most of the scene, so they start collapsed and the user opens
 * them deliberately.
 */
const WIDE_ENOUGH_FOR_PANELS =
  typeof window === 'undefined' || window.innerWidth >= 1024

export const uiStore = createStore({
  focus: 'earth', // 'free' | 'sun' | 'earth' | 'moon'
  warp: 4, // index into WARP_LEVELS
  paused: false,
  trails: true,
  labels: true,
  bloom: true,
  clouds: true,
  atmosphere: true,
  panelOpen: WIDE_ENOUGH_FOR_PANELS,
  assist: true, // RCS stability hold
  lagrange: true,
  /**
   * Which catalogue model is bound to each craft, or null for the procedural
   * placeholder. Loading is driven by assignment rather than a bulk toggle: the
   * catalogue is 140 MB and one entry alone is 63 MB of it.
   */
  modelFor: { ship: null, iss: null, hubble: null },
  modelBusy: {},
  shipPanel: true,

  // High-resolution NASA imagery. Loaded lazily on request; `hd` is the user's
  // intent and `hdStatus` is what the loader has actually managed to do.
  hd: false,
  hdStatus: 'idle', // 'idle' | 'loading' | 'ready' | 'unavailable' | 'error'
  hdLoaded: 0,
  hdTotal: 0,
})

export function useUi(selector = (s) => s) {
  return useSyncExternalStore(
    uiStore.subscribe,
    () => selector(uiStore.get()),
    () => selector(uiStore.get()),
  )
}

export const setUi = uiStore.set
