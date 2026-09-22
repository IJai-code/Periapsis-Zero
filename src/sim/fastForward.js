/**
 * Flying the mission without drawing it.
 *
 * `frame()` is one frame of `Driver.jsx`'s loop — the same ordering, the same
 * clamped delta, the same warp ladder and powered-warp cap — with no renderer
 * attached. Every mission figure in the README was measured with it.
 *
 * It lived in `scripts/flight.mjs` until a page needed it too. A preset flies the
 * real sequencer to its starting point in a few hundred milliseconds with exactly
 * this code, rather than restoring a snapshot that goes stale the next time the
 * physics moves; a third copy of the frame ordering would have been one more
 * place for it to drift. The harness re-exports all of it, and keeps only what
 * needs a filesystem.
 *
 * The ordering is load-bearing and mirrors the driver's comment: sequencer,
 * attitude, thrust, integrate, clamp, rebase. Anything else reads stale state.
 */

import { live, refreshDerived } from './live.js'
import { activeStage, applyThrust, deltaV, integrateAttitude, ship, totalMass } from './ship.js'
import {
  applyClamp,
  applySplashdownHold,
  beginCountdown,
  commitTLI,
  currentPhase,
  isClamped,
  isSplashed,
  mission,
  resetMission,
  stepCeiling,
  updateMission,
  updateStepCeiling,
} from './mission.js'
import { WARP, WARP_RATES } from './warp.js'

/** Driver.jsx: warp ceiling while the engines are lit. */
const POWERED_WARP_CAP = WARP.m1

const FRAME = 1 / 60 // s, wall clock — a 60 Hz display

export const flight = {
  /**
   * The store's own default, so the harness inherits the app's starting
   * conditions rather than a safer set of its own.
   *
   * It used to start at 0 to work around the powered-warp cap being evaluated
   * from the previous frame's thrust, which let the ignition frame integrate a
   * full day of full-throttle SLS. That is fixed at the source now — the
   * sequencer asks for the powered ceiling before the hold is released, and the
   * driver clamps the step regardless — so starting here is the honest test of
   * both.
   */
  warp: WARP.d1,
  frames: 0,
  wall: 0, // wall-clock seconds the run would have taken
  lastWarpRequest: null,
  warpBeforeBurn: null,
  /** Set by the caller to drive warp when the sequencer is not asking. */
  pilotWarp: null,
}

/**
 * One frame, byte-for-byte the ordering in `Driver.jsx`.
 * @param {number} delta wall-clock seconds
 */
export function frame(delta = FRAME) {
  const dt = Math.min(delta, 1 / 20)

  if (mission.warpRequest !== null && mission.warpRequest !== flight.lastWarpRequest) {
    flight.lastWarpRequest = mission.warpRequest
    flight.warp = mission.warpRequest
  } else if (mission.warpRequest === null) {
    flight.lastWarpRequest = null
    if (flight.pilotWarp !== null) flight.warp = flight.pilotWarp
  }

  const rate = WARP_RATES[flight.warp]
  // Never step past the moment a planned burn has to start turning — the same
  // two lines as Driver.jsx, for the reason given there.
  updateStepCeiling(live.sim.t)
  let simDt = Math.min(dt * rate, stepCeiling[0])
  live.simDtLastFrame = simDt

  const phaseBefore = mission.index

  updateMission(dt, simDt)

  // Commanded throttle, not last frame's realised thrust — see Driver.jsx.
  const stage = activeStage()
  const burning = ship.throttle > 0 && stage !== null && ship.stageProp[ship.stage] > 0

  if (burning) {
    if (flight.warp > POWERED_WARP_CAP) {
      flight.warpBeforeBurn = flight.warp
      flight.warp = POWERED_WARP_CAP
    }
  } else if (flight.warpBeforeBurn !== null) {
    const restore = flight.warpBeforeBurn
    flight.warpBeforeBurn = null
    // Only while nobody else is driving the dial — see Driver.jsx.
    if (mission.warpRequest === null && flight.warp <= POWERED_WARP_CAP) {
      flight.warp = restore
    }
  }

  // This frame's step is already committed, so clamp it directly and wind the
  // mission clock back by what was removed.
  const poweredStep = WARP_RATES[POWERED_WARP_CAP] * dt
  if (burning && simDt > poweredStep) {
    if (mission.index === phaseBefore) {
      mission.t -= simDt - poweredStep
      mission.phaseT -= simDt - poweredStep
    }
    simDt = poweredStep
    live.simDtLastFrame = simDt
  }

  integrateAttitude(simDt)

  applyThrust(dt, simDt, live.sim.extAccel)
  live.sim.dragK[0] = live.sim.extAccel.dragK ?? 0
  live.sim.liftK[0] = live.sim.extAccel.liftK ?? 0
  live.sim.bank[0] = live.sim.extAccel.bank ?? 0

  live.stepsLastFrame = live.sim.advance(simDt, live.maxDt)
  if (isClamped()) applyClamp()
  if (isSplashed()) applySplashdownHold()
  refreshDerived()

  flight.frames++
  flight.wall += dt
}

/* ---------------------------------------------------------------- *
 * Driving
 * ---------------------------------------------------------------- */

/**
 * Fly until `predicate` returns true, logging every phase change.
 * @returns {boolean} whether the predicate tripped before the frame budget ran out
 */
export function flyUntil(predicate, { maxFrames = 5_000_000, onPhase = null, onFrame = null } = {}) {
  let last = currentPhase().id
  for (let i = 0; i < maxFrames; i++) {
    frame()
    const id = currentPhase().id
    if (id !== last) {
      onPhase?.(id, last)
      last = id
    }
    onFrame?.(i)
    if (predicate()) return true
  }
  return false
}

const pad = (s, n) => String(s).padEnd(n)

export function logPhase(id, from) {
  const e = live.elements
  console.log(
    `  ${pad(from + ' -> ' + id, 34)} MET ${(mission.t / 60).toFixed(1).padStart(8)} min` +
      `  alt ${(e.altitude / 1e3).toFixed(0).padStart(8)} km` +
      `  v ${(e.speed / 1e3).toFixed(3)} km/s` +
      `  m ${(totalMass() / 1e3).toFixed(2)} t` +
      `  dv ${deltaV().toFixed(0)} m/s`,
  )
}

/**
 * Hold on the pad until a given hour of the epoch, then let go.
 *
 * Which hour a mission launches at is not cosmetic: it sets where the Moon is
 * when the window opens, and therefore how long the vehicle waits in its
 * parking orbit — which is what decides whether that orbit outlives the wait.
 * Launching Vandenberg at hour 0 gives an orbit with 204.8 h of life and a
 * 104.4 h wait, so nothing interesting happens; the *same* pad at the right
 * hour has to raise itself to survive. One number selects between them.
 *
 * Coarse until it is close, then fine, and that matters. At a day a second the
 * hold overshoots by up to a frame's worth of a day, so every launch hour
 * inside the same day collapses onto one commitment and the hour asked for is
 * not the hour flown. `verify-loiter` found this and holds the same way; the
 * two are the same two-stage hold for the same reason.
 */
function holdUntilEpoch(hour) {
  if (!(hour > 0)) return
  const target = hour * 3600
  flight.pilotWarp = WARP.d1
  for (let i = 0; live.sim.t < target - 3600 && i < 1_000_000; i++) frame()
  flight.pilotWarp = WARP.m1
  for (let i = 0; live.sim.t < target && i < 1_000_000; i++) frame()
  flight.pilotWarp = null
}

/** Fly the mission from the pad, committing TLI as soon as the orbit is stable, until `until`. */
export function flyMission(until = 'LUNAR_APPROACH', opts = {}) {
  resetMission()
  refreshDerived()
  holdUntilEpoch(opts.launchHour ?? 0)
  beginCountdown()

  let committed = false
  // A phase id, or a predicate for a moment no phase marks — a preset stopping
  // just short of a planned burn, say.
  const arrived = typeof until === 'function' ? until : () => currentPhase().id === until
  const ok = flyUntil(
    arrived,
    {
      onPhase: opts.onPhase ?? logPhase,
      onFrame: () => {
        const id = currentPhase().id
        if (!committed && id === 'COAST') committed = commitTLI()
        // The sequencer only asks for warp from the apoapsis coast onward. Where
        // it stays silent the pilot has the dial: 1 min/s through the ascent —
        // the powered cap's own ceiling, and warp-invariant against 1x: flown
        // both ways, each vessel reaches the same parking orbit to within
        // 0.06 km, which verify-warp checks — and 6 h/s across the lunar coast.
        flight.pilotWarp = mission.warpRequest !== null ? null : id === 'LUNAR_APPROACH' ? WARP.h6 : WARP.m1
      },
      maxFrames: opts.maxFrames ?? 5_000_000,
    },
  )
  return ok
}
