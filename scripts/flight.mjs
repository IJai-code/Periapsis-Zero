/**
 * Headless mission runner.
 *
 * Reproduces `Driver.jsx`'s frame loop exactly — same ordering, same clamped
 * delta, same warp ladder and powered-warp cap — with no renderer attached, so
 * the sequencer can be flown and measured from the command line. Every mission
 * figure quoted in the README comes from this.
 *
 * The ordering is load-bearing and mirrors the driver's comment: sequencer,
 * attitude, thrust, integrate, clamp, rebase. Anything else reads stale state.
 *
 *   node scripts/flight.mjs                        fly the whole mission
 *   node scripts/flight.mjs --save state.json      ... and dump the end state
 *   node scripts/flight.mjs --load state.json      resume from a dump
 *   node scripts/flight.mjs --until LUNAR_APPROACH stop when a phase is entered
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { live, refreshDerived } from '../src/sim/live.js'
import { activeStage, applyThrust, integrateAttitude, ship, totalMass, deltaV } from '../src/sim/ship.js'
import {
  applyClamp,
  beginCountdown,
  commitTLI,
  currentPhase,
  isClamped,
  isSplashed,
  applySplashdownHold,
  mission,
  resetMission,
  updateMission,
} from '../src/sim/mission.js'

/** Mirrors store.js — kept as a literal so the harness never imports React. */
export const WARP_RATES = [1, 60, 3600, 21600, 86400, 259200, 604800, 2629800]

/** Driver.jsx: warp ceiling while the engines are lit. */
const POWERED_WARP_CAP = 1

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
  warp: 4,
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
  let simDt = dt * rate
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
 * State capture — so a phase can be iterated on without re-flying
 * ---------------------------------------------------------------- */

export function snapshot() {
  return {
    state: Array.from(live.sim.state),
    t: live.sim.t,
    ship: {
      quaternion: ship.quaternion.toArray(),
      targetQuaternion: ship.targetQuaternion.toArray(),
      angularVelocity: ship.angularVelocity.toArray(),
      throttle: ship.throttle,
      stage: ship.stage,
      stageProp: Array.from(ship.stageProp),
      separations: ship.separations,
      autopilot: ship.autopilot,
    },
    mission: {
      index: mission.index,
      resumeIndex: mission.resumeIndex,
      t: mission.t,
      phaseT: mission.phaseT,
      running: mission.running,
      planeLocked: mission.planeLocked,
      lastSeparations: mission.lastSeparations,
      warpRequest: mission.warpRequest,
      bestEccentricity: mission.bestEccentricity,
      tli: { ...mission.tli, committed: mission.tli.committed },
      mcc: {
        solved: mission.mcc.solved,
        converged: mission.mcc.converged,
        magnitude: mission.mcc.magnitude,
        lvlh: { ...mission.mcc.lvlh },
        direction: mission.mcc.direction.toArray(),
        targetMass: mission.mcc.targetMass,
        predicted: mission.mcc.predicted,
        iterations: mission.mcc.iterations,
      },
    },
    flight: { warp: flight.warp, frames: flight.frames, wall: flight.wall },
  }
}

export function restore(snap) {
  live.sim.state.set(snap.state)
  live.sim.t = snap.t

  ship.quaternion.fromArray(snap.ship.quaternion)
  ship.targetQuaternion.fromArray(snap.ship.targetQuaternion)
  ship.angularVelocity.fromArray(snap.ship.angularVelocity)
  ship.throttle = snap.ship.throttle
  ship.stage = snap.ship.stage
  ship.stageProp.set(snap.ship.stageProp)
  ship.separations = snap.ship.separations
  ship.autopilot = snap.ship.autopilot
  ship.mass = totalMass()

  Object.assign(mission, {
    index: snap.mission.index,
    resumeIndex: snap.mission.resumeIndex,
    t: snap.mission.t,
    phaseT: snap.mission.phaseT,
    running: snap.mission.running,
    planeLocked: snap.mission.planeLocked,
    lastSeparations: snap.mission.lastSeparations,
    warpRequest: snap.mission.warpRequest,
    bestEccentricity: snap.mission.bestEccentricity,
  })
  Object.assign(mission.tli, snap.mission.tli)
  Object.assign(mission.mcc, {
    solved: snap.mission.mcc.solved,
    converged: snap.mission.mcc.converged,
    magnitude: snap.mission.mcc.magnitude,
    targetMass: snap.mission.mcc.targetMass,
    predicted: snap.mission.mcc.predicted,
    iterations: snap.mission.mcc.iterations,
  })
  Object.assign(mission.mcc.lvlh, snap.mission.mcc.lvlh)
  mission.mcc.direction.fromArray(snap.mission.mcc.direction)

  // The insertion block is not part of a snapshot taken before it — reset it,
  // so a harness that restores the same approach state repeatedly (a parameter
  // sweep) does not carry the previous run's turning-point minimum into the
  // next one and cut the burn off on entry.
  Object.assign(mission.loi, {
    deltaVEstimate: 0,
    burnEstimate: 0,
    pointingError: Math.PI,
    bestEccentricity: Infinity,
    burnStart: 0,
    burnDuration: 0,
    deltaVDelivered: 0,
    startMass: 0,
    minRadius: Infinity,
    cutoff: '',
    ignited: false,
  })
  /**
   * The return blocks get the same treatment, and for a sharper version of the
   * same reason.
   *
   * A snapshot taken in lunar orbit predates all of this, so none of it is in
   * the file — but these are live module singletons, and a second run in the
   * same process inherits whatever the first one left. `ei.solved` is the
   * dangerous one: `TRANS_EARTH.done()` branches on it, so a stale `true` makes
   * the second run skip the corridor trim entirely and fly the *untrimmed*
   * departure, which has a perigee 1,528 km below the surface. That arrives at
   * the interface descending at 5.5 km/s on a 30 degree path, and the entry
   * autopilot — correctly — cannot save it. The failure looks exactly like a
   * guidance bug and is not one.
   */
  Object.assign(mission.tei, {
    vInfRequired: 0,
    c3Target: 0,
    c3: 0,
    deltaVEstimate: 0,
    burnEstimate: 0,
    timeToWindow: Infinity,
    outOfPlane: 0,
    pointingError: Math.PI,
    burnStart: 0,
    burnEnd: 0,
    burnDuration: 0,
    deltaVDelivered: 0,
    startMass: 0,
    predictedPerigee: 0,
    solved: false,
    cutoff: '',
    ignited: false,
  })
  Object.assign(mission.ei, {
    solved: false,
    converged: false,
    rejected: false,
    magnitude: 0,
    targetMass: 0,
    predicted: 0,
    before: 0,
    iterations: 0,
    pointingError: Math.PI,
  })
  Object.assign(mission.entry, {
    interfaceSpeed: 0,
    interfaceTime: 0,
    peakG: 0,
    peakQ: 0,
    peakHeatFlux: 0,
    peakRadFlux: 0,
    peakTotalFlux: 0,
    peakGAltitude: 0,
    peakTotalAltitude: 0,
    drogueAltitude: 0,
    mainAltitude: 0,
    splashdownSpeed: 0,
    splashdownVertical: 0,
    splashdownTime: 0,
    bankReversals: 0,
    lastReversal: 0,
    crossRange: 0,
    peakCrossRange: 0,
    guided: false,
  })

  // Aerodynamic control state, likewise: a run that reached the water would
  // otherwise hand the next one a fully inflated main canopy in lunar orbit.
  ship.chuteCdA = 0
  ship.chuteTarget = 0
  ship.chuteTau = 1
  ship.bankAngle = 0
  ship.bankCommand = 0
  ship.liftToDrag = null

  mission.resumeDone = false

  flight.warp = snap.flight.warp
  flight.frames = snap.flight.frames
  flight.wall = snap.flight.wall
  flight.lastWarpRequest = null
  flight.warpBeforeBurn = null

  refreshDerived()
}

export const loadSnapshot = (path) => restore(JSON.parse(readFileSync(path, 'utf8')))
export const saveSnapshot = (path) => writeFileSync(path, JSON.stringify(snapshot()))

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

/** Fly the mission from the pad. Commits TLI as soon as the orbit is stable. */
export function flyMission(untilPhase = 'LUNAR_APPROACH', opts = {}) {
  resetMission()
  refreshDerived()
  beginCountdown()

  let committed = false
  const ok = flyUntil(
    () => currentPhase().id === untilPhase,
    {
      onPhase: opts.onPhase ?? logPhase,
      onFrame: () => {
        const id = currentPhase().id
        if (!committed && id === 'COAST') committed = commitTLI()
        // The sequencer only asks for warp from the apoapsis coast onward. Where
        // it stays silent the pilot has the dial: 1 min/s through the ascent
        // (the powered cap's own ceiling, and verified warp-invariant against
        // 1x), and 6 h/s across the days-long lunar coast.
        flight.pilotWarp = mission.warpRequest !== null ? null : id === 'LUNAR_APPROACH' ? 3 : 1
      },
      maxFrames: opts.maxFrames ?? 5_000_000,
    },
  )
  return ok
}

/* ---------------------------------------------------------------- *
 * CLI
 * ---------------------------------------------------------------- */

if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = (name) => {
    const i = process.argv.indexOf(name)
    return i >= 0 ? process.argv[i + 1] : null
  }
  const until = arg('--until') ?? 'LUNAR_APPROACH'
  const load = arg('--load')
  const save = arg('--save')

  const t0 = Date.now()
  if (load) {
    loadSnapshot(load)
    console.log(`resumed in ${currentPhase().id} at MET ${(mission.t / 3600).toFixed(2)} h`)
    flyUntil(() => currentPhase().id === until, { onPhase: logPhase })
  } else {
    console.log('flying from the pad:')
    flyMission(until)
  }

  const e = live.elements
  console.log(
    `\n${currentPhase().id} at MET ${(mission.t / 3600).toFixed(3)} h` +
      ` — ${flight.frames} frames, ${(flight.wall).toFixed(1)} s of wall clock,` +
      ` ${((Date.now() - t0) / 1000).toFixed(1)} s real`,
  )
  console.log(
    `  geocentric: alt ${(e.altitude / 1e3).toFixed(0)} km  e ${e.eccentricity.toFixed(5)}` +
      `  stage ${ship.stage}  mass ${(totalMass() / 1e3).toFixed(3)} t  dv ${deltaV().toFixed(1)} m/s`,
  )
  if (save) {
    saveSnapshot(save)
    console.log(`  state written to ${save}`)
  }
}
