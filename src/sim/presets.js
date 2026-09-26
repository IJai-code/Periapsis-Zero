import { flight, flyMission, standOnPad } from './fastForward.js'
import { armHaloCaptureInBackground, currentPhase, mission } from './mission.js'
import { director, updateDirector } from './director.js'
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
    /*
     * The one that starts where a launch starts.
     *
     * Every other preset hands over somewhere in flight, which is the point of
     * them — but it meant nothing here ever showed the thing a visitor comes to
     * see: a vehicle on a pad, beside its tower, with a clock running. This one
     * flies nothing. It stands on Kennedy LC-39B with the count at sixty, puts
     * the camera on the ground at eye height, and lets the last minute run —
     * see `countdown.js` and `gfx/groundView.js`.
     *
     * The hour is not arbitrary and neither was the wide shot it replaces.
     * `director.js` opens PRE_LAUNCH on the planet rather than the pad, and
     * gives its reason: at the J2000 epoch the site is in darkness, so a ground
     * camera's first frame is "a grey cone in the dark with nothing to say
     * where it is". Measured at Kennedy, the Sun sits 4.8 degrees *below* the
     * horizon at the epoch. At +5 h it is 38.0 degrees above it — mid-morning,
     * the tower lit from the side, and the shadow box resolving about 0.15 m a
     * texel at that elevation. The objection was to the lighting, so the fix is
     * the hour rather than the shot.
     */
    id: 'apollo8-launch',
    vessel: 'apollo8',
    site: 'ksc',
    title: 'Apollo 8 · from the pad',
    blurb: 'Kennedy LC-39B in the morning, from T-60, standing on the ground.',
    fromPad: true,
    launchHour: 5,
    focus: 'ground',
    warp: WARP.x1,
  },
  {
    /*
     * Eagle on Tranquility Base, a minute before liftoff, and everything after:
     * the ascent, the coelliptic rendezvous and the docking with Columbia,
     * flown to Apollo 11's own timeline — see sim/lunarMission.js.
     *
     * The hour is the Sun's. Eagle landed at a sun 10.8° up and lifted off 21.6
     * hours later, with the Sun half a degree an hour higher: 21.8°, low in the
     * east, every rock throwing a shadow three times its height. The simulated
     * Moon first puts that sun over the site 305.29 h after the epoch, measured
     * by stepping the integrated system an hour at a time — so the count starts
     * a minute before.
     */
    id: 'apollo11-liftoff',
    vessel: 'apollo11',
    site: 'tranquility',
    title: 'Apollo 11 · lunar liftoff',
    blurb: 'Eagle leaves Tranquility Base to meet Columbia, as flown in July 1969.',
    fromPad: true,
    launchHour: 305.29 - 60 / 3600,
    focus: 'ground',
    warp: WARP.x1,
  },
  {
    /*
     * The same flight, joined three hours and a quarter in: the ascent, CSI, CDH
     * and TPI flown by the sequencer in the fast-forward, and the page handed
     * over as braking begins, a mile and a bit out from Columbia — the part the
     * crew flew by hand, the last half hour to the docking.
     */
    id: 'apollo11-docking',
    vessel: 'apollo11',
    site: 'tranquility',
    title: 'Apollo 11 · docking',
    blurb: 'Three and a quarter hours on: Eagle brakes onto Columbia above the Moon.',
    launchHour: 305.29 - 60 / 3600,
    until: 'LM_BRAKING',
    focus: 'chase',
    warp: WARP.x10,
  },
  {
    /*
     * The capture burn in real time, and it has to *say* real time.
     *
     * Handed over without a pace, this preset inherited whatever the
     * fast-forward was running at when it stopped — six hours a second across
     * the lunar coast — so the burn the blurb promises was over in a couple of
     * frames. The sequencer asks for real time on entering `LOI_ALIGN`, but the
     * driver applies that request only when it *changes*, and a preset handing
     * over is the pilot setting the dial: the standing request was already real
     * time, so nothing changed and nothing was applied. Naming it here is the
     * only place the pace can be set for this flight.
     */
    id: 'apollo8-lunar-orbit',
    vessel: 'apollo8',
    site: 'ksc',
    title: 'Apollo 8 · lunar orbit',
    blurb: 'Kennedy to the Moon, then the capture burn in real time.',
    until: 'LOI_ALIGN',
    warp: WARP.x1,
  },
  {
    id: 'artemis-halo',
    vessel: 'artemis',
    site: 'ksc',
    title: 'Artemis · halo capture',
    blurb: "Onto the Gateway's orbit in four burns, solved in the background.",
    until: 'LUNAR_APPROACH',
    halo: true,
    /*
     * The shot is the Moon, not Earth.
     *
     * The director's `LUNAR_APPROACH` entry is `moon`, and on every other
     * preset the camera change is what applies it. Here it was not: the driver
     * seeds its "last request" from the director on the first frame *without
     * applying it*, so a preset that names no shot keeps the store's default —
     * Earth — and the whole lunar approach plays 300,000 km off screen. See the
     * `focus` derivation in `startPreset`.
     */
    focus: 'moon',
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
  {
    /*
     * The moment the mission stops being about Earth.
     *
     * Handed over as TLI_BURN begins — the phase changes at ignition — so the
     * third stage lights on screen instead of in a fast-forward. The director
     * already shoots TLI_BURN as `chase`, and the burn runs about three and a
     * half minutes at real time, which is the point: it is one of maybe six
     * burns in the whole flight worth watching second by second.
     */
    id: 'apollo8-tli',
    vessel: 'apollo8',
    site: 'ksc',
    title: 'Apollo 8 · trans-lunar injection',
    blurb: 'Parking orbit to the Moon: the third stage lights, in real time.',
    until: 'TLI_BURN',
    warp: WARP.x1,
  },
  {
    /*
     * The burn for home, from behind the Moon.
     *
     * Two and a half days of fast-forward to get there, then TEI at real time:
     * the crew lit it on the far side with no radio contact, which is the most
     * alone a human being has ever been. The hand-over is at ignition, on the
     * `chase` shot the director keeps for TEI_BURN.
     */
    id: 'apollo8-tei',
    vessel: 'apollo8',
    site: 'ksc',
    title: 'Apollo 8 · the burn for home',
    blurb: 'Trans-Earth injection from lunar orbit, in real time.',
    until: 'TEI_BURN',
    warp: WARP.x1,
  },
  {
    /*
     * The whole entry sequence, live: service module separation, the corridor,
     * the fire, the drogues, the canopies, the ocean.
     *
     * Handed over at SM_SEP — minutes before the plasma — so nothing in the
     * return is sampled. Entry at eleven kilometres a second is the fastest
     * thing this simulator flies, and it is over in about twelve minutes.
     */
    id: 'apollo8-reentry',
    vessel: 'apollo8',
    site: 'ksc',
    title: 'Apollo 8 · re-entry',
    blurb: 'The return at 11 km/s: separation, plasma, chutes, splashdown.',
    until: 'SM_SEP',
    warp: WARP.x1,
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
 *
 * ── the shot is derived, not defaulted ────────────────────────────────
 *
 * A preset that names no `focus` used to keep whatever the store opened with —
 * `earth` — and that is not a neutral choice. The driver applies the director's
 * shot only when the request *changes*, and on the first frame it seeds its
 * memory of the request from the director *without applying it*, which is
 * deliberate: a pilot who chose a camera before the loop started keeps it. A
 * preset, though, has chosen nothing; it is a link asking to be shown a
 * particular flight. So the seed handed it the store's `earth` and the director
 * then had nothing to change to — its standing request was already `earth` for
 * phases that shared a shot, and for the three that did not, the change arrived
 * at the *next* phase boundary.
 *
 * Measured on the three presets that name no shot, that meant:
 *
 *   apollo8-lunar-orbit  LOI_ALIGN, 398,081 km out, burning at the Moon on a
 *                        camera locked on Earth — and because `LOI_BURN` is the
 *                        same shot as `LOI_ALIGN`, the request never changed
 *                        and the whole capture was never shown at all.
 *   artemis-halo         LUNAR_APPROACH, camera on Earth, the Moon 300,000 km
 *                        away and the halo capture ahead of it.
 *   vandenberg-polar     TLI_ALIGN — the one of the three where `earth` is the
 *                        right answer, which is why the fault went unnoticed.
 *
 * Asking the director what it wants for the phase we actually arrived in costs
 * one lookup and needs no state: `updateDirector` is a table read keyed on the
 * phase id, and calling it here leaves `director.request` set to the same value
 * the first frame of the loop will compute. A preset that does name a shot
 * still wins, which is what `apollo11-docking` and both ground presets rely on.
 */
export function startPreset(preset) {
  if (started) return started
  const begun = performance.now()
  const arrived = preset.fromPad
    ? standOnPad(preset.launchHour ?? 0)
    : flyMission(preset.until, { onPhase: () => {}, launchHour: preset.launchHour ?? 0 })
  updateDirector()
  started = {
    preset,
    arrived,
    ms: performance.now() - begun,
    phase: currentPhase().id,
    warp: preset.warp ?? flight.warp,
    focus: preset.focus ?? director.request,
    capture: preset.halo && arrived ? armHaloCaptureInBackground(null) : null,
  }
  return started
}
