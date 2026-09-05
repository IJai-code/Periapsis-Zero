import { useSyncExternalStore } from 'react'
import { WARP, WARP_LEVELS } from './warp.js'

/* Re-exported so UI modules keep one import for store state and the ladder. */
export { WARP, WARP_LEVELS }

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

/**
 * The side panels are sized for a desktop viewport. On anything narrower they
 * would cover most of the scene, so they start collapsed and the user opens
 * them deliberately.
 */
const WIDE_ENOUGH_FOR_PANELS =
  typeof window === 'undefined' || window.innerWidth >= 1024

export const uiStore = createStore({
  focus: 'earth', // 'free' | 'fly' | 'sun' | 'earth' | 'moon' | ...
  /**
   * Opens paused, at real time.
   *
   * It used to open at one day a second so the system would visibly be moving
   * the moment the page loaded. What that actually gives a new arrival is Earth
   * completing a rotation every second and every body sliding across the frame
   * before they have worked out what they are looking at. A still frame is a
   * better first impression than a fast one, and the time controls are the most
   * legible thing on screen.
   */
  warp: WARP.x1,
  paused: true,
  trails: true,
  /** The forward projection of where the craft is going. */
  trajectory: true,
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
  modelFor: {
    /**
     * Hubble wears its own mesh out of the box: the catalogue has one, it is
     * 1.6 MB, and defaulting a telescope to a procedural cone when its actual
     * geometry is sitting there was never a decision, only an oversight.
     *
     * The other two stay null because nothing in the catalogue is them. There
     * is no SLS and no Orion among the 48 models — the nearest are Saturn V and
     * the Apollo CSM, which are a different vehicle — and the ISS exists only
     * as loose modules rather than an assembled station. Binding a craft to a
     * mesh of something else would be worse than a placeholder, because a
     * placeholder does not claim to be anything.
     */
    ship: null,
    iss: null,
    hubble: 'hubble',
  },
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
