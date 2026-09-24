/**
 * Headless mission runner.
 *
 * The frame loop itself is `src/sim/fastForward.js` — `Driver.jsx`'s loop with no
 * renderer attached, shared with the page's presets — and is re-exported here, so
 * every gate keeps importing it from this file. What stays is what needs Node:
 * snapshots on disk, and the command line. Every mission figure quoted in the
 * README comes from this.
 *
 *   node scripts/flight.mjs                        fly the whole mission
 *   node scripts/flight.mjs --save state.json      ... and dump the end state
 *   node scripts/flight.mjs --load state.json      resume from a dump
 *   node scripts/flight.mjs --until LUNAR_APPROACH stop when a phase is entered
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
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
  resetLoiter,
  resetMission,
  stepCeiling,
  updateMission,
  updateStepCeiling,
} from '../src/sim/mission.js'

/** Mirrors store.js — kept as a literal so the harness never imports React. */
/**
 * The ladder, imported rather than restated.
 *
 * This used to be a literal copy of the store's array. Two copies of a list
 * whose *positions* are referenced by forty call sites is one edit away from
 * the harness and the app disagreeing about what a warp level means, with every
 * verification still passing against the wrong pace.
 */
export { WARP_RATES, WARP } from '../src/sim/warp.js'
export { flight, frame, flyMission, flyUntil, logPhase } from '../src/sim/fastForward.js'
import { flight, flyMission, flyUntil, logPhase } from '../src/sim/fastForward.js'

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
      tli: { ...mission.tli, committed: mission.tli.committed, loiter: { ...mission.tli.loiter } },
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
  /**
   * The loiter plan is the one nested object in the block. Copied into the live
   * object rather than letting the snapshot's become it — otherwise the next
   * flight restored from the same snapshot inherits whatever this one planned.
   * Older snapshot files have no plan at all, and restore to none.
   */
  const loiter = mission.tli.loiter
  Object.assign(mission.tli, snap.mission.tli)
  mission.tli.loiter = loiter
  resetLoiter()
  Object.assign(loiter, snap.mission.tli.loiter)
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

/**
 * The checked-in states, resolved against this file rather than the working
 * directory — `verify-all` spawns gates by absolute path and a relative default
 * would break the moment anything ran from elsewhere.
 *
 * Two, because two regimes are asked about and they are 114 hours and a capture
 * burn apart. `lunar-orbit` is the one with gates in the suite; `lunar-approach`
 * is the state *before* the sphere of influence, which is what the approach and
 * LOI scripts need and which no re-flight from orbit can give them.
 *
 * `scripts/fixtures/README.md` says what each is and how to regenerate it.
 */
export const LUNAR_ORBIT_FIXTURE = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'lunar-orbit.json')
export const LUNAR_APPROACH_FIXTURE = join(
  dirname(fileURLToPath(import.meta.url)),
  'fixtures',
  'lunar-approach.json',
)
/*
 * The same phase for the other stack. There are two because a state carries no
 * vessel: `restore()` fills the state vector and the ship's own fields, and the
 * stage table comes from the environment. So a fixture is only coherent under
 * the vessel it was flown with, and `verify-staging` is written against Artemis
 * (see its header) while the three Apollo-8 instruments above are not.
 */
export const LUNAR_APPROACH_ARTEMIS_FIXTURE = join(
  dirname(fileURLToPath(import.meta.url)),
  'fixtures',
  'lunar-approach-artemis.json',
)

export const loadSnapshot = (path) => restore(JSON.parse(readFileSync(path, 'utf8')))
export const saveSnapshot = (path) => writeFileSync(path, JSON.stringify(snapshot()))

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
