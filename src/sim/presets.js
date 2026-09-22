import { flight, flyMission } from './fastForward.js'
import { armHaloCaptureInBackground, currentPhase, mission } from './mission.js'
import { ACTIVE_VESSEL } from './vessels.js'
import { activeSite } from './launchsite.js'
import { live } from './live.js'
import { nodes } from './nodes.js'
import { WARP } from './warp.js'

/**
 * Missions to jump into, flown rather than restored.
 *
 * A preset is a link, because the vessel and the pad are fixed when the page
 * loads. On load the flight computer flies the real mission from the pad to the
 * preset's starting point — the harness's own frame loop, in well under a second
 * — and hands the rest to the page. Nothing here is a saved state, so nothing
 * here goes stale the next time the physics moves.
 */
export const PRESETS = [
  {
    id: 'apollo8-lunar-orbit',
    vessel: 'apollo8',
    site: 'ksc',
    title: 'Apollo 8 · lunar orbit',
    blurb: 'Kennedy to the Moon, then the capture burn in real time.',
    until: 'LOI_ALIGN',
  },
  {
    id: 'artemis-halo',
    vessel: 'artemis',
    site: 'ksc',
    title: 'Artemis · halo capture',
    blurb: "Onto the Gateway's orbit in four burns, solved in the background.",
    until: 'LUNAR_APPROACH',
    halo: true,
    // A minute a second while the capture is solved — see `startPreset`.
    warp: WARP.m1,
  },
  {
    id: 'vandenberg-polar',
    vessel: 'apollo8',
    site: 'vandenberg',
    title: 'Vandenberg · polar loiter',
    blurb: 'An orbit that would decay before its window, raised in time.',
    /*
     * The hour is the whole scenario, and without it this preset was a lie.
     *
     * Launched at the epoch itself, Vandenberg's parking orbit waits 104.4 h
     * for its window and has 204.8 h of life: it outlives the wait with a
     * hundred hours to spare, so no raise is ever planned. The predicate below
     * then found no node, fell through to its TLI fallback, and dropped the
     * player into the middle of the trans-lunar injection burn — a vehicle
     * already lighting its third stage, which is not what "a polar loiter"
     * promises and is exactly what it looked like.
     *
     * At +144 h the same pad waits 282.3 h for a window its orbit cannot reach,
     * so the flight computer raises it: two nodes, 10.52 m/s, and the thing the
     * blurb describes actually happens. This is the hour `verify-loiter` flies
     * its own shortfall scenario at, for the same reason.
     */
    launchHour: 144,
    until: loiterRaiseAhead,
    // The raise is minutes away; at the loiter's own 6 h/s it would arrive in the
    // first second, before anyone has found the vehicle on screen.
    warp: WARP.m1,
  },
]

/**
 * Up to ten minutes before the first loiter raise.
 *
 * The TLI fallback stays, because a fast-forward with no stopping condition
 * would run to `maxFrames` and hand back a vehicle wherever that landed. But it
 * is a *guard* and not an outcome: if this preset ever reaches it, the orbit
 * did not need raising and the mission it advertises did not happen. It fires
 * a warning now rather than silently delivering a different flight, which is
 * what it did for as long as the preset launched at the wrong hour.
 */
function loiterRaiseAhead() {
  if (currentPhase().id === 'TLI_BURN') {
    console.warn(
      '[periapsis] the polar-loiter preset reached TLI without a raise being planned — ' +
        'the parking orbit outlived its window, so there was nothing to watch',
    )
    return true
  }
  const first = mission.tli.loiter.node1
  if (!(first > 0)) return false
  for (const n of nodes) if (n.id === first) return !n.executed && live.sim.t >= n.t - 600
  return false
}

export const presetHref = (preset) => `?preset=${preset.id}&vessel=${preset.vessel}&site=${preset.site}#flight`

/** The preset named in this page's address, if there is one this page was loaded to fly. */
export function requestedPreset() {
  if (typeof window === 'undefined') return null
  const id = new URLSearchParams(window.location.search).get('preset')
  if (!id) return null
  const preset = PRESETS.find((p) => p.id === id)
  if (!preset) {
    console.warn(`[periapsis] unknown preset "${id}"; starting on the pad`)
    return null
  }
  if (ACTIVE_VESSEL !== preset.vessel || activeSite().id !== preset.site) {
    console.warn(
      `[periapsis] preset "${id}" is ${preset.vessel} from ${preset.site}, but this page loaded ` +
        `${ACTIVE_VESSEL} from ${activeSite().id}; starting on the pad`,
    )
    return null
  }
  return preset
}

let started = null

/**
 * Fly to the preset's starting point, once per page.
 *
 * Once, because React runs mount effects twice in development, and a second
 * fast-forward would start from wherever the first one stopped.
 *
 * The halo preset then starts its capture search in the worker, and asks for a
 * minute a second while it runs: the plan is solved for the state the craft has
 * when it is asked for, and at the coast's usual 6 h/s the periselene it plans a
 * burn at would arrive before the search finished — the arming would then
 * rightly refuse it.
 */
export function startPreset(preset) {
  if (started) return started
  const begun = performance.now()
  const arrived = flyMission(preset.until, { onPhase: () => {}, launchHour: preset.launchHour ?? 0 })
  started = {
    preset,
    arrived,
    ms: performance.now() - begun,
    phase: currentPhase().id,
    warp: preset.warp ?? flight.warp,
    capture: preset.halo && arrived ? armHaloCaptureInBackground(null) : null,
  }
  return started
}
