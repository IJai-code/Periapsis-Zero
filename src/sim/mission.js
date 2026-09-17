import { Matrix4, Quaternion, Vector3 } from 'three'
import { live } from './live.js'
import { activeStage, separate, ship, totalMass } from './ship.js'
import { INDEX } from './system.js'
import { activeSite, clampToSite, rotationBonus } from './launchsite.js'
import { SPIN_AXIS, SPIN_RATE } from './atmosphere.js'
import { projectPerigee, solveMidCourse, solveReturnCorridor } from './targeting.js'
import { referenceStateAt, solveHaloKeeping } from './halo.js'
import { solveHaloCapture, solveHaloCorrection } from './capture.js'
import { craftR, craftSynodic, synodic } from './cr3bp.js'
import { WARP } from './warp.js'
import {
  addNode,
  clearNodes,
  nodeBasis,
  nodeMagnitude,
  nodeRevision,
  nodes,
  nodesChanged,
  pendingNode,
  removeNode,
  resolveNode,
} from './nodes.js'
import { dominantBody } from './soi.js'
import { BODIES, G, G0, SHIP } from './constants.js'
import { DECAY_FLOOR, circularOrbitDecayingTo, decayAfter, decayed, orbitalLifetime } from './decay.js'

/**
 * Mission sequencer: a flat state machine driving throttle and attitude.
 *
 * Everything here is allocated once. The phase table and its closures are built
 * at module load, the scratch vectors below are module-level, and the context is
 * a single mutated object — so a frame of sequencing produces no garbage. The
 * HUD formats strings at its own refresh rate rather than per frame.
 *
 * Transitions are evaluated at the top of the frame, which is not stale: the
 * derived state there is the result of the previous integration step, and is
 * therefore current.
 */

/**
 * Plane-gap thresholds for the translunar warp ladder, radians.
 *
 * Coarse: beyond this the Moon cannot be in the plane soon, so run time hard —
 * at 6 h/s a frame is 36 minutes, and the gap moves about a third of a degree
 * in that. Fine: close enough to want the craft's own orbital position
 * resolved, at which point the alignment takes over.
 */
const TLI_PLANE_COARSE = 5 * (Math.PI / 180)
const TLI_PLANE_FINE = 1 * (Math.PI / 180)

const _up = new Vector3()
const _east = new Vector3()
const _north = new Vector3()
const _aim = new Vector3()
const _x = new Vector3()
const _y = new Vector3()
const _z = new Vector3()
const _basis = new Matrix4()
const _q = new Quaternion()
const _plane = new Vector3()
const _setup = new Vector3()
const _rs = new Vector3()
const _vs = new Vector3()
const _rm = new Vector3()
const _vm = new Vector3()
const _hs = new Vector3()
const _cross = new Vector3()
const _hm = new Vector3()
const _future = new Vector3()
const _apoDir = new Vector3()
const _mcc = new Vector3()
const _sr = new Vector3() // selenocentric craft position
const _sv = new Vector3() // selenocentric craft velocity
const _sh = new Vector3() // selenocentric orbit normal
const _tHat = new Vector3() // prograde transverse at the Moon, lunar orbit plane
const _vInf = new Vector3() // required hyperbolic excess velocity
const _vInfHat = new Vector3()
const _burnDir = new Vector3() // where the craft must be to depart correctly
const _ei = new Vector3()
const _entryNormal = new Vector3()
const _bankSign = { value: 1 }
const _retro = new Vector3()

const DEG = Math.PI / 180

/**
 * Closed-loop ascent gains. One pair, shared by every vehicle — the whole point
 * of closing the loop is that thrust-to-weight stops needing its own numbers.
 *
 * `ASCENT_APO_GAIN` turns remaining apoapsis deficit into a wanted climb rate
 * (100 km short asks for 400 m/s); `ASCENT_MIN_CLIMB` is the floor it decays
 * to, so the burn always ends below apoapsis and still rising; and
 * `ASCENT_CLIMB_GAIN` closes the climb-rate error.
 */
const ASCENT_APO_GAIN = 0.004
const ASCENT_MIN_CLIMB = 100
const ASCENT_CLIMB_GAIN = 0.2

/**
 * Dynamic pressure below which the ascent may steer freely, Pa.
 *
 * Max-Q is 22-35 kPa; 1 kPa is roughly 55 km up, where the air no longer
 * constrains the angle of attack and no longer meaningfully brakes. Below this
 * the closed loop can point wherever the orbit needs.
 */
const HANDOVER_Q = 1000

/** Ascent profile. Tuned so the programmed turn reaches orbit without iteration. */
export const PROFILE = {
  countdown: 10, // s

  /**
   * Pointing error a planned burn will ignite on, radians, and how long before
   * ignition the sequencer takes the vehicle to orient. The same pair the
   * capture burn uses and for the same reason — the slew has to be finished
   * before the clock runs out, and the burn lights anyway if it is not, rather
   * than sailing past the node in perfect attitude.
   */
  nodePointTolerance: 0.005,
  nodeAlignMargin: 60,

  /**
   * Whether the flight computer may raise the parking orbit to wait out a
   * distant translunar window. See `planLoiter`. Off only for measurement: the
   * verification that the decay theory predicts a flown lifetime needs a flight
   * that is allowed to decay. The forecast is still made and recorded.
   */
  loiterRaise: true,
  /**
   * How far the decay theory may overstate a lifetime, as a fraction.
   *
   * Measured at no more than 1.05% against flown decay on all four pads, always
   * in the long direction; `verify-loiter` flies it again and fails if the error
   * grows past this. A tolerance with a gate behind it, not a fitted constant.
   */
  lifetimeTolerance: 0.02,
  /**
   * Lowest perigee a translunar injection may start from, m of altitude.
   *
   * A policy, set as one rather than derived. What it guards is the steepness of
   * the last day of a decaying orbit: a Baikonur launch at +563.3 h lasted its
   * 319 h wait and injected from a 126 km perigee with seven hours of life left,
   * which leaves nothing for a pass missed or a window slipped. It is not drag
   * during the burn — 0.04 m/s from 126 km, measured — though the low start does
   * cost more, because a lower circular orbit is deeper in the well: 3,159 m/s
   * to inject from 126 km against 3,149 m/s from 164 km. When the orbit would
   * reach its window below this, even with life to spare, the flight computer
   * raises it by the least that keeps it above, and ignition waits for that raise
   * if it has not flown by the time the window comes.
   */
  injectionFloor: 140e3,
  /**
   * Ascent shaping moved to the vessel — see SHIP.ascent in sim/vessels.js.
   *
   * kickAltitude, kickAngle, turnStart, targetSpeed, turnExponent, qThrottle,
   * qThrottleLevel and gLimit are all properties of a *vehicle*, not of a
   * flight plan, and they only sat here while there was exactly one vehicle.
   * Saturn V leaves the pad at a thrust-to-weight of 1.166 against SLS's 1.57
   * and does not fly the same pitch programme.
   */
  /** Eccentricity below which the orbit counts as circular. */
  circularTolerance: 1e-3,
  /** Rise in eccentricity that counts as "past the optimum", not numerical noise. */
  eccNoiseFloor: 1e-5,
  /** How close the phase angle must be to its target before igniting, radians. */
  phaseTolerance: 0.6 * (Math.PI / 180),
  /** When to correct, after injection. Empirically the cheapest of 6/12/24/48 h. */
  mccDelay: 24 * 3600,
  /** Lunar periapsis to aim for: 1737 km surface + 100 km. */
  lunarPeriapsis: 1737e3 + 100e3,

  /* --- Lunar orbit insertion --- */
  /**
   * Pointing error the capture burn will ignite on, radians. The same gate the
   * mid-course correction uses, for the same reason, and it matters more here:
   * the flip from coast attitude to retrograde is close to 180 degrees.
   */
  loiPointTolerance: 0.005,
  /**
   * Slew margin ahead of the ignition point, s. The autopilot turns at
   * 0.15 rad/s, so a half-turn takes 21 s; 60 s leaves the attitude settled
   * well before the clock runs out, and doubles as the backstop — if pointing
   * has still not converged a full margin *past* the ignition point, the burn
   * lights anyway rather than sailing past the Moon in perfect attitude.
   */
  loiAlignMargin: 60,
  /** Rise in eccentricity that counts as past the optimum during capture. */
  loiEccNoiseFloor: 1e-5,
  /**
   * Where the burn sits relative to periapsis: ignition at
   * `t_periapsis - loiLeadFraction * duration`.
   *
   * 0.5 straddles it, which is what circularisation does at apoapsis and what
   * minimises the gravity loss. It is not what minimises the *eccentricity*
   * here, and the two are not the same objective — see the sweep in
   * scripts/verify-loi-sweep.mjs. Measured, not assumed.
   */
  loiLeadFraction: 0.5,
  /**
   * Periapsis floor during the capture burn, m of altitude. A backstop only:
   * the eccentricity minimum is itself the point at which periapsis would start
   * dropping, so a correct cutoff never reaches this.
   */
  loiSafeAltitude: 20e3,

  /* --- Trans-Earth injection and return --- */
  /**
   * How long to stay in lunar orbit before departing, s. One full revolution,
   * so the achieved orbit is flown and measured rather than merely asserted at
   * cutoff.
   */
  lunarDwell: 7050,
  /** Pointing gate for the departure burn, rad. Same as the capture's. */
  teiPointTolerance: 0.005,
  /** Slew margin ahead of the departure point, s, and the ignition backstop. */
  teiAlignMargin: 60,
  /** Where the departure burn sits relative to its ideal point, as a fraction. */
  teiLeadFraction: 0.5,
  /**
   * Vacuum perigee to come home on, m of altitude.
   *
   * 40 km is the middle of the entry corridor. Measured against this
   * simulation's own geometry it puts the flight-path angle at the 122 km
   * interface at -6.40 deg, against Apollo's -6.5 +- 0.5 — so the corridor is
   * an independently derived result here, not a transcribed constant. Shallower
   * skips, steeper overloads.
   */
  entryPerigee: 40e3,
  /** When to trim the corridor, after departure. Measured — see verify-tei.mjs. */
  eiDelay: 12 * 3600,
  /** Pointing gate for the corridor trim, rad. */
  eiPointTolerance: 0.005,
  /**
   * Largest correction the trim is allowed to execute, m/s.
   *
   * A backstop against a solve that has converged on nonsense. A corridor trim
   * is tens of m/s; anything approaching the whole remaining budget is a failed
   * solve, not a large correction, and firing it costs the mission. When the
   * projector once mistook a lunar-range wobble for perigee the solver asked
   * for 1,888 m/s and the sequencer flew it to depletion.
   */
  eiMaxDeltaV: 150,
  /** Altitude to discard the service module at, m. */
  smSepAltitude: 120e3,
  /** Entry interface, m — where the air starts to matter. */
  entryInterface: 122e3,

  /* --- Guided entry --- */
  /**
   * Deceleration the entry autopilot flies to, in g.
   *
   * Not a limit that is avoided but a target that is *held*. Diving to a chosen
   * load and staying there spreads the deceleration across a long plateau, and
   * a plateau at 6.5 g peaks lower than a ballistic spike does — which is the
   * whole reason a capsule with an offset centre of mass is worth building.
   */
  entryTargetG: 6.5,
  /** Band below the target over which lift-up demand ramps in, g. */
  entryGBand: 2.5,
  /** Altitude rate at which lift-down demand starts, m/s. Full once level. */
  entrySkipRate: 150,
  /**
   * Bank flown when neither hazard is active, as a vertical lift fraction.
   * 0.5 is a 60 deg bank — the nominal Apollo held, and enough lateral
   * component that the reversals have something to reverse.
   */
  entryNominalLift: 0.5,
  /** Roll rate the capsule manages on RCS, rad/s. Apollo's was about 20 deg/s. */
  entryRollRate: 0.35,
  /** Cross-range that triggers a bank reversal, m. */
  entryCrossRange: 60e3,
  /** Minimum seconds between reversals, so the deadband cannot chatter. */
  entryReversalDwell: 15,
  /** Lift-to-drag override; 0 flies it ballistically, for comparison. */
  entryLiftToDrag: null,

  /* --- Near-rectilinear halo orbit --- */
  /**
   * How often the halo is maintained, s.
   *
   * An NRHO is *unstable*: the along-track error grows exponentially with a
   * time constant of days, so unlike every other orbit in this simulation it
   * does not simply persist. Roughly weekly is what real NRHO station-keeping
   * plans use, at a fraction of a m/s each time.
   */
  nrhoKeepInterval: 6 * 86400,
  /** How long a maintenance pass holds before handing back to the coast, s. */
  nrhoKeepDuration: 120,
  /**
   * Revolutions the station-keeping solve looks ahead.
   *
   * One, and that is a measured ceiling rather than a default. The instability
   * that makes the correction necessary doubles an error every revolution, so
   * over two it amplifies a finite-difference probe fourfold and over three
   * eightfold; measured, the solver stops converging and drift reaches 2,000%.
   * The control horizon is set by the Lyapunov time. That was measured on the
   * perilune-radius law; the reference law that replaced it has only been flown
   * at one.
   */
  nrhoLookahead: 1,
  /** Largest maintenance burn that will be executed, m/s. A sanity backstop. */
  nrhoMaxDeltaV: 20,
  /**
   * How long before its instant the halo insertion is solved, s.
   *
   * Early enough that the node exists before the sequencer has to start turning
   * toward it — half a burn plus the slew margin, some 75 s for a 105 m/s
   * insertion — and late enough that it is solved across a coast of minutes
   * rather than the days the search predicted it across.
   */
  haloInsertionLead: 600,
  /**
   * How long after the plane change the transfer is re-aimed, s.
   *
   * Six hours: far enough ahead that the node exists long before the sequencer
   * has to turn toward it, and early enough in the coast that the error is cheap
   * to correct — the same miss costs roughly ten times as much to fix from one
   * day out as from five.
   */
  haloCorrectionDelay: 6 * 3600,

  /**
   * Warp during entry, as an index.
   *
   * Real time, deliberately. Entry is over in about four minutes and the loads
   * peak across roughly twenty seconds of it, so at 60x the peak deceleration
   * would be sampled once per simulated second — enough to miss the top of it.
   * The integrator would still be right; the *reported* number would not be.
   */
  entryWarp: WARP.x1,
}

export const mission = {
  site: activeSite(),
  index: 0,
  /** Phase to resume after a staging interrupt. */
  resumeIndex: 0,
  t: 0, // mission elapsed time, s (negative before release)
  phaseT: 0,
  countdown: PROFILE.countdown,
  lastSeparations: 0,
  running: false,
  /** True once the target orbital plane is fixed, at liftoff. */
  planeLocked: false,
  /**
   * Time-warp index the sequencer would like, or null to leave it to the pilot.
   * Used to skip the long ballistic coast without the pilot having to nurse it.
   */
  warpRequest: null,
  /**
   * The planned manoeuvre currently being flown, if any.
   *
   * `direction` is resolved once at ignition and then held inertially rather
   * than re-derived each frame. A node is written as an impulse and the map
   * draws it as one; chasing prograde through a finite burn would steer to a
   * frame that is itself rotating because of the burn, which is a different
   * manoeuvre from the one the pilot planned and the projection drew.
   */
  node: {
    /**
     * Id of the burn that just handed control back, or -1. Written by
     * NODE_BURN on the way out and consumed by the phase it resumes, so that
     * phase can tell a burn it planned from one the pilot did.
     */
    lastFlownId: -1,
    active: null,
    direction: new Vector3(),
    /**
     * The body the active node is measured against. Decided once, on alignment,
     * at the node's own instant — see `coastToNode` — and held through the burn.
     */
    body: 'earth',
    /** Plan revision the direction was solved against; a pilot's edit re-solves it. */
    revision: -1,
    target: 0, // m/s asked for
    delivered: 0, // m/s integrated from the applied acceleration
    burnStart: 0,
    pointingError: Math.PI, // rad between the nose and the commanded direction
  },

  /**
   * Where the vehicle was lost, if it was. `at` is MET in seconds and
   * `altitude` the depth below the surface when the guard tripped — kept
   * because "how far under" separates a grazing reentry from an integration
   * that ran away.
   */
  lost: { at: 0, altitude: 0, body: '' },

  /** Lowest eccentricity seen during a circularisation burn. */
  bestEccentricity: Infinity,
  /** Whether the phase a staging interrupt preempted has met its own cutoff. */
  resumeDone: false,

  /** Trans-lunar injection, all recomputed live. */
  tli: {
    timeOfFlight: 0, // s, Hohmann transfer to the Moon's current radius
    moonTravel: 0, // rad the Moon covers during that flight
    targetPhase: 0, // rad the Moon must lead the ship by at ignition
    phase: 0, // rad the Moon currently leads by
    timeToWindow: Infinity, // s
    /** How far the Moon's arrival point lies out of the parking plane, rad. */
    outOfPlane: Math.PI,
    /** 3D angle between where apoapsis will point and where the Moon will be. */
    alignment: Math.PI,
    lastAlignment: Math.PI,
    deltaV: 0, // m/s the injection needs
    burnStart: 0, // mission time at ignition
    burnDuration: 0, // s
    committed: false,
    /**
     * The loiter plan, made once per commitment on entry to TLI_ALIGN.
     *
     * Times are seconds and radii are semi-major axes in metres, so the figures
     * can be checked against `decay.js` directly rather than through a
     * conversion someone has to remember.
     */
    loiter: {
      planned: false,
      needed: false, // the committed orbit would not have lasted
      raised: false,
      wait: 0, // s from commitment until the Moon's arrival point reaches the plane
      lifetime: 0, // s the committed orbit would last
      margin: 0, // s the vehicle needs in hand at the window: an orbit to align, plus the burn
      arrive: 0, // m, the orbit to have decayed back down to when the window opens
      target: 0, // m, the loiter orbit
      dv1: 0, // m/s
      dv2: 0, // m/s
      /** Ids of the two raise burns, so they can be told apart and withdrawn. -1 when none. */
      node1: -1,
      node2: -1,
      /** How many times the plan has been remade, for any reason. */
      replans: 0,
      /** Of those, how many because a raise flown did not buy the life it was for. */
      corrections: 0,
      /** Perigee the orbit would have at the latest ignition before any raise, m from the centre. */
      periapsisAtIgnition: 0,
      /** Why a raise was needed: 'lifetime', 'floor', or '' when it was not. */
      reason: '',
      /** The pilot is thrusting by hand during the wait; replan when they stop. */
      manual: false,
    },
  },

  /** Mid-course correction, solved numerically once en route. */
  mcc: {
    solved: false,
    converged: false,
    magnitude: 0, // m/s
    lvlh: { prograde: 0, normal: 0, radial: 0 },
    direction: new Vector3(), // world unit vector
    targetMass: 0, // kg at cutoff, from the rocket equation
    predicted: 0, // m, projected lunar periapsis radius
    iterations: 0,
  },

  /** Lunar orbit insertion. Everything here is measured, not assumed. */
  loi: {
    /** Impulsive estimate, used only to schedule ignition. */
    deltaVEstimate: 0, // m/s
    burnEstimate: 0, // s, from the rocket equation across stages
    /** Angle between the thrust axis and retrograde, rad. */
    pointingError: Math.PI,
    /** Lowest selenocentric eccentricity seen during the burn. */
    bestEccentricity: Infinity,
    burnStart: 0, // mission time at ignition
    burnDuration: 0, // s, flown
    deltaVDelivered: 0, // m/s, integrated from the applied acceleration
    startMass: 0, // kg
    /** Closest the vehicle actually came to the Moon's centre, m. */
    minRadius: Infinity,
    /** Which criterion ended the burn. */
    cutoff: '',
    ignited: false,
  },

  /** Trans-Earth injection. Geometry recomputed live, cutoff closed-loop. */
  tei: {
    vInfRequired: 0, // m/s, from the patched-conic return ellipse
    c3Target: 0, // m^2/s^2, solved at ignition against the real field
    c3: 0, // m^2/s^2, achieved — the cutoff reads this
    deltaVEstimate: 0, // m/s
    burnEstimate: 0, // s
    timeToWindow: Infinity, // s until the departure point
    /** How far the required departure direction sits out of the orbit plane, rad. */
    outOfPlane: 0,
    pointingError: Math.PI,
    burnStart: 0,
    burnEnd: 0,
    burnDuration: 0,
    deltaVDelivered: 0,
    startMass: 0,
    predictedPerigee: 0, // m, what the ignition solve expected
    solved: false,
    cutoff: '',
    ignited: false,
  },

  /** Entry-corridor correction — the return leg's mid-course burn. */
  ei: {
    solved: false,
    converged: false,
    magnitude: 0, // m/s
    lvlh: { prograde: 0, normal: 0, radial: 0 },
    direction: new Vector3(),
    targetMass: 0, // kg at cutoff
    predicted: 0, // m, projected geocentric perigee
    before: 0, // m, what it was before the correction
    iterations: 0,
    pointingError: Math.PI,
  },

  /**
   * Halo-orbit maintenance. The first phase pair in this sequencer that is a
   * *cycle* rather than a step, because the orbit it holds is unstable and
   * therefore never finished.
   */
  nrho: {
    cycles: 0, // completed coast + maintenance pairs
    lastKeep: 0, // mission time of the last maintenance pass
    /** Apolune detection, three samples of selenocentric range. */
    prevRange: 0,
    prevPrevRange: 0,
    atApolune: false,
    /** The real-field halo being held, from `shootHalo`; null solves nothing. */
    reference: null,
    /** Last maintenance solve. */
    deltaV: 0,
    totalDeltaV: 0,
    solved: false,
    converged: false,
    /** m: how far the craft would pass from the reference's state a revolution on, without the burn and with it. */
    miss: 0,
    missAfter: 0,
    targetMass: 0,
    /** kg at the start of the pass, so a burn is booked as delivered rather than as asked. */
    startMass: 0,
    /** The pass's burn has cut off and must not be relit. */
    burnt: false,
    perilune: Infinity, // m, closest to the Moon this revolution
    apolune: 0, // m, furthest
    lastPerilune: 0, // the revolution just completed
    lastApolune: 0,
    synodicR: 0, // m, current distance from the Moon
    /** Out-of-plane excursion in the synodic frame — the halo's defining feature. */
    synodicZ: 0,
  },

  /**
   * A capture onto a halo, planned from the lunar approach by `armHaloCapture`.
   *
   * The burns themselves are ordinary nodes, so the map draws them and the node
   * phases fly them; these are the figures the search produced and the ids of
   * the nodes it left behind.
   */
  capture: {
    planned: false,
    total: 0, // m/s, as solved
    first: 0, // the capture at periselene
    second: 0, // the plane change at the transfer's apolune
    third: 0, // the insertion — replanned against the state the craft actually has
    correction: 0, // the transfer correction, solved once the plane change has flown
    arrival: 0, // simulation time the insertion is aimed at
    correctionAt: 0, // and the instant the correction burns at
    /** Node ids, in the order they fly. */
    nodes: { capture: 0, plane: 0, correction: 0, insertion: 0 },
    correctionPlanned: false,
    insertionPlanned: false,
    ms: 0, // how long the search took
  },

  /** Re-entry and descent. Peaks are tracked, not predicted. */
  entry: {
    interfaceSpeed: 0, // m/s at the 122 km interface
    interfaceTime: 0, // mission time there
    peakG: 0,
    peakQ: 0, // Pa
    peakHeatFlux: 0, // W/m^2, convective
    peakRadFlux: 0, // W/m^2, radiative
    peakTotalFlux: 0, // W/m^2 — peaks at its own moment, not at either of theirs
    peakTotalAltitude: 0,
    peakGAltitude: 0,
    drogueAltitude: 0,
    mainAltitude: 0,
    splashdownSpeed: 0,
    splashdownVertical: 0,
    splashdownTime: 0,
    /** Guided-entry telemetry. */
    bankReversals: 0,
    lastReversal: 0,
    crossRange: 0,
    peakCrossRange: 0,
    guided: false,
  },
}

/* ---------------------------------------------------------------- *
 * Attitude helpers — all write into preallocated scratch
 * ---------------------------------------------------------------- */

/** Local vertical, and the east/north frame at the vehicle's position. */
function updateLocalFrame() {
  const s = live.sim.state
  const o = INDEX.ship * 6
  const e = INDEX.earth * 6
  _up.set(s[o] - s[e], s[o + 1] - s[e + 1], s[o + 2] - s[e + 2]).normalize()

  // East is the direction the surface is travelling: omega-hat x up.
  _east
    .set(
      SPIN_AXIS[1] * _up.z - SPIN_AXIS[2] * _up.y,
      SPIN_AXIS[2] * _up.x - SPIN_AXIS[0] * _up.z,
      SPIN_AXIS[0] * _up.y - SPIN_AXIS[1] * _up.x,
    )
    .normalize()
  _north.crossVectors(_up, _east).normalize()
}

/**
 * Point the thrust axis (+Z) along `dir`, rolled to keep local up overhead.
 *
 * Once the plane is locked the command is first projected into it. Steering to
 * a fixed compass azimuth every frame follows a *rhumb line*, not a great
 * circle — a due-east launch from 28.58 deg drifts the plane and arrives at
 * 41 deg inclination. Fixing the plane at liftoff and steering inside it is
 * what makes the launch site's latitude actually determine the inclination.
 */
function aimThrust(dir) {
  _z.copy(dir)
  if (mission.planeLocked) _z.addScaledVector(_plane, -_z.dot(_plane))
  _z.normalize()
  _x.crossVectors(_up, _z)
  /**
   * `dir` parallel to the local vertical, which is exactly what a vehicle on a
   * pad is commanded: the cross product vanishes and any horizontal axis will
   * do for roll. East is one, and it is already perpendicular to up — where the
   * fallback used to be a fixed world axis, which is *not*, so `makeBasis` was
   * handed three vectors that were not a basis and the quaternion came out
   * tilted by however far that axis happened to sit from the local horizontal.
   * Measured at release: 1.4 degrees off vertical at Kennedy, where the
   * profile was tuned, and 27.7 at Kourou, which lifted off leaning and gave
   * back 38 m/s of the eastward speed its latitude exists to provide.
   */
  if (_x.lengthSq() < 1e-10) _x.copy(_east)
  _x.normalize()
  _y.crossVectors(_z, _x)
  _basis.makeBasis(_x, _y, _z)
  ship.targetQuaternion.setFromRotationMatrix(_basis)
}

/** Downrange direction for the launch azimuth, measured clockwise from north. */
function azimuthDirection(out, azimuthDeg) {
  const a = azimuthDeg * DEG
  return out.copy(_north).multiplyScalar(Math.cos(a)).addScaledVector(_east, Math.sin(a))
}

/**
 * Pitch the vehicle over on a schedule in *velocity*, not altitude.
 *
 * A pitch programme rather than a pure zero-angle-of-attack turn: following the
 * velocity vector exactly is the textbook gravity turn, but it is acutely
 * sensitive to the kick and needs iterating to close. A schedule is
 * deterministic, and this one still produces a genuine gravity-turn shape.
 *
 * Scheduling on altitude looks natural and flies badly — it reaches horizontal
 * around 130 km while the vehicle is still only doing 2 km/s, far too slow to
 * hold itself up, so the trajectory lofts and then sinks back through 90 km.
 * Velocity is the honest variable: the vehicle may only lie down once it is
 * going fast enough to stay up, which is what real closed-loop guidance
 * enforces. The surface speed it started with is subtracted so the schedule
 * begins at zero pitch on the pad.
 */
/**
 * Throttle management during powered ascent.
 *
 * Two real constraints, both of which a launch vehicle actually flies. The
 * throttle bucket eases back through maximum dynamic pressure, where
 * aerodynamic load peaks; the g-limiter caps acceleration as the tanks empty
 * and thrust-to-weight runs away — by the end of a core burn an unthrottled
 * stage would be pulling well over 4 g.
 */
function manageThrottle() {
  let level = live.dynamicPressure > SHIP.ascent.qThrottle ? SHIP.ascent.qThrottleLevel : 1

  const accel = ship.thrust / ship.mass
  if (accel > SHIP.ascent.gLimit) level = Math.min(level, ship.throttle * (SHIP.ascent.gLimit / accel))

  ship.throttle = Math.max(0.1, Math.min(1, level))
}

/**
 * Ascent steering, in two regimes.
 *
 * **Open loop, until steering is free.** Pitch is a function of speed alone —
 * `90 deg x (v/vt)^n` — which is what a launch vehicle wants low down, where the
 * angle of attack has to stay near zero and there is nothing useful to feed back
 * on yet. It hands over once the vehicle is above the initial climb and dynamic
 * pressure is low enough to point off the velocity vector; handing over on
 * apoapsis instead levelled Apollo 8 off at four kilometres.
 *
 * **Closed loop, from there to cutoff.** The open-loop law cannot be the whole
 * ascent, and the failure is not subtle: it knows the vehicle's *speed* and
 * nothing about where the orbit is going, so a vehicle that climbs faster than
 * the schedule assumed simply keeps climbing. Measured, Apollo 8 parked at
 * 1,318 x 1,323 km against a real 185, and Artemis — at a thrust-to-weight of
 * 1.57 against 1.166 — reached 7,602 km. Higher thrust lofts *worse*, because it
 * finishes the velocity schedule sooner and spends the rest of the burn pushing
 * apoapsis outward.
 *
 * So the loop commands the vertical acceleration rather than an angle, with a
 * climb rate that tapers as apoapsis nears the parking altitude, and converts it
 * into the angle that delivers it at the thrust actually available. That
 * conversion is what lets the same three gains fly both vehicles. A flight-path
 * angle commanded straight from the apoapsis error was tried first and ran
 * apoapsis out past escape. From Kennedy both vehicles now park at 172.0 x
 * 185.0-185.1 km, at any warp — which took the step limit in `updateStepCeiling`
 * as well as this loop.
 */
function aimAscent() {
  const target = SHIP.parkingOrbit.altitude
  const e = live.elements

  /**
   * Handover to the closed loop, on two physical conditions rather than on
   * apoapsis alone.
   *
   * Apoapsis alone fails hard: a vehicle going straight up has an apoapsis far
   * above the parking orbit within seconds of leaving the pad, so the loop sees
   * no error and commands level flight at four kilometres. Measured, Apollo 8
   * did exactly that, burned every stage inside the atmosphere and came down.
   *
   * Hand over when steering is actually free: above the initial climb, and with
   * dynamic pressure low enough that pointing away from the velocity vector
   * costs nothing structurally. Both are properties of the flight rather than
   * of the vehicle, which is what keeps this free of per-vessel constants.
   */
  const steerable = e.altitude > SHIP.ascent.turnStart && live.dynamicPressure < HANDOVER_Q

  if (!steerable) {
    const v0 = rotationBonus(mission.site)
    const span = SHIP.ascent.targetSpeed - v0
    const tau = Math.min(1, Math.max(0, (e.speed - v0) / span))
    const pitch = (Math.PI / 2) * Math.pow(tau, SHIP.ascent.turnExponent)
    azimuthDirection(_aim, mission.site.azimuth)
    _aim.multiplyScalar(Math.sin(pitch)).addScaledVector(_up, Math.cos(pitch))
    return aimThrust(_aim)
  }

  /**
   * Closed loop: control the *vertical acceleration*, not the pitch angle.
   *
   * Two simpler laws were tried and both failed for the same underlying reason
   * — a commanded flight-path angle is not a control over anything the orbit
   * cares about, because what the angle does depends on the thrust-to-weight
   * behind it. Commanding a fixed climb angle let the stack run apoapsis out to
   * `Infinity` at 11.2 km/s; clamping the angle non-negative instead let the
   * vehicle sink through apoapsis with periapsis at -57 km, because pointing
   * level does not stop you falling when gravity exceeds the vertical component
   * of thrust.
   *
   * The vertical acceleration is the thing that has to be right, and it is
   * computable rather than tunable:
   *
   *   g_eff = mu/r^2 - v_h^2/r        gravity, less centrifugal relief
   *   a_cmd = g_eff + k (vv* - vv)    hold it, plus close the climb-rate error
   *   sin(gamma) = a_cmd / (F/m)      the angle that delivers it
   *
   * A vehicle at 30 m/s^2 needs 18 degrees to hold altitude and one at 10 m/s^2
   * needs 68; the same line computes both, which is the entire point of closing
   * the loop. The climb target decays as apoapsis approaches the parking orbit
   * but never to zero, so the burn always arrives *below* apoapsis and still
   * rising — which is what the coast that follows needs.
   */
  const r = e.radius
  const vh = Math.sqrt(Math.max(0, e.speed * e.speed - e.vertical * e.vertical))
  const gEff = (G * BODIES.earth.mass) / (r * r) - (vh * vh) / r

  const climbWanted = Math.max(ASCENT_MIN_CLIMB, ASCENT_APO_GAIN * (target - e.apogee))
  const aVert = gEff + ASCENT_CLIMB_GAIN * (climbWanted - e.vertical)

  const accel = ship.thrust / Math.max(ship.mass, 1)
  const sinGamma = Math.max(-0.6, Math.min(0.95, accel > 0 ? aVert / accel : 0))
  const pitch = Math.PI / 2 - Math.asin(sinGamma)

  azimuthDirection(_aim, mission.site.azimuth)
  _aim.multiplyScalar(Math.sin(pitch)).addScaledVector(_up, Math.cos(pitch))
  aimThrust(_aim)
}

/** Inertial prograde, for coasting after cutoff. */
function aimPrograde() {
  const s = live.sim.state
  const o = INDEX.ship * 6
  const e = INDEX.earth * 6
  _aim.set(s[o + 3] - s[e + 3], s[o + 4] - s[e + 4], s[o + 5] - s[e + 5])
  if (_aim.lengthSq() < 1) return aimThrust(_up)
  aimThrust(_aim)
}

/**
 * How long the circularisation burn will take, from the rocket equation.
 *
 *   dv = ve ln(m0/m1)  ->  m1 = m0 exp(-dv/ve),  t = (m0 - m1) / mdot
 *
 * The sequencer starts the burn half this early, so it straddles apoapsis
 * rather than beginning there: a finite burn applied entirely after apoapsis
 * raises periapsis on one side only and leaves the orbit lopsided.
 */
function burnDuration() {
  const stage = activeStage()
  const dv = live.elements.circulariseDeltaV
  if (!stage || !(dv > 0)) return 0

  const ve = stage.isp * G0
  const mdot = stage.thrust / ve
  const burned = totalMass() * (1 - Math.exp(-dv / ve))
  // Cap it: an impossible dv must not produce an absurd lead time.
  return Math.min(burned / mdot, live.elements.period * 0.25)
}

const burnLead = () => burnDuration() * 0.5

/* ---------------------------------------------------------------- *
 * Lunar orbit insertion
 * ---------------------------------------------------------------- */

/**
 * Selenocentric velocity of the craft, into `out`.
 *
 * Relative to the Moon, not to Earth. A capture burn is judged entirely in this
 * frame: the geocentric velocity here is about 1 km/s of mostly irrelevant
 * lunar orbital motion carried along for the ride.
 */
function lunarVelocity(out) {
  const st = live.sim.state
  const o = INDEX.ship * 6
  const m = INDEX.moon * 6
  return out.set(st[o + 3] - st[m + 3], st[o + 4] - st[m + 4], st[o + 5] - st[m + 5])
}

/** Point the thrust axis against the selenocentric velocity. Fills `_retro`. */
function aimLunarRetrograde() {
  lunarVelocity(_retro).multiplyScalar(-1)
  if (_retro.lengthSq() < 1) return aimThrust(_up)
  aimThrust(_retro)
  mission.loi.pointingError = ship.forward.angleTo(_retro)
}

/** Nose along the selenocentric velocity — the coast attitude on approach. */
function aimLunarPrograde() {
  lunarVelocity(_retro)
  if (_retro.lengthSq() < 1) return aimThrust(_up)
  aimThrust(_retro)
}

/**
 * A ballistic copy of the flight, coasted to a planned node's instant.
 *
 * The question "which body is this burn relative to?" has to be asked where the
 * burn happens, not where the craft is when it starts turning toward it — and
 * it has to be asked the same way the map asked it, or the pilot can plan a
 * capture burn against the Moon and have it flown against Earth. The projection
 * reaches the node by integrating ballistically from the present; so does this.
 * Near a sphere-of-influence boundary that is the difference between agreeing
 * with the map and not, and everywhere else it costs a few dozen RK4 steps once
 * per burn — a one-shot solve on phase entry, which the allocation rule exempts.
 *
 * Created on first use: `live.sim` is replaced on reset, and a copy taken at
 * import would be a copy of a simulation that no longer exists.
 */
let _coast = null
function coastToNode(t) {
  if (!_coast) _coast = live.sim.clone()
  _coast.resetFrom(live.sim)
  const ahead = t - live.sim.t
  if (ahead > 0) _coast.advance(ahead, Math.min(live.maxDt, 10), 1e6)
  return _coast
}

/**
 * Solve the active node into the inertial direction the burn will be flown along.
 *
 * Resolved at the node's own instant — not the craft's present one, and not the
 * moment of ignition — against the body whose sphere it is in there. That is the
 * vector the projection applied, so it is the only one that flies the orbit the
 * map drew.
 *
 * It used to be re-resolved from the live state while aligning and frozen at
 * ignition. A centred burn ignites half its duration early, and the frame turns
 * in the meantime: at lunar periselene the velocity rotates 1.35 mrad/s, so an
 * 839 m/s capture burn frozen 108 s early was flown the whole way along a
 * direction some 8 degrees off the one planned. Correctly measured against the
 * Moon, it still arrived in a 48.4 x 161.5 km orbit where the map drew
 * 95.7 x 95.7. Held on the node-instant vector instead, the errors either side
 * of the node point opposite ways and largely cancel.
 */
function solveNodeBurn(node) {
  mission.node.revision = nodeRevision()
  if (!node) {
    mission.node.target = 0
    mission.node.body = 'earth'
    mission.node.direction.set(0, 0, 0)
    return
  }
  const at = coastToNode(node.t)
  mission.node.body = dominantBody(at, 'ship')
  mission.node.target = nodeMagnitude(node)
  resolveNode(node, at.state, INDEX.ship * 6, INDEX[mission.node.body] * 6, mission.node.direction)
}

/**
 * How long the capture burn will take, from the rocket equation — walked stage
 * by stage rather than taken from one mass ratio.
 *
 * That matters here in a way it did not for circularisation. The insertion is
 * an 800 m/s burn and the stage it starts on has about 18 m/s of margin on it,
 * so the burn very likely crosses a separation: each side of that has its own
 * exhaust velocity and mass flow, and the structure jettisoned in between is
 * mass the second half never has to accelerate. Sizing the whole burn on the
 * first stage's numbers would put the ignition point out by tens of seconds.
 */
/**
 * How long the stack needs to deliver `dv`, in seconds.
 *
 * Stage by stage, because each has its own exhaust velocity and because
 * dropping a spent one changes the mass the next has to push. Within a stage
 * the rocket equation inverts directly — m1 = m0 exp(-dv/ve), and the time is
 * the propellant difference over the flow rate — and a stage that cannot
 * finish the job hands the remainder to the one above it, minus its own
 * structure.
 *
 * This was written out three times, once for capture, once for departure and
 * once for a planned node, differing only in where `dv` came from. One of the
 * three would eventually have been fixed alone.
 */
function burnTimeFor(dv) {
  if (!(dv > 0) || !Number.isFinite(dv)) return 0
  let m = totalMass()
  let togo = dv
  let t = 0
  for (let i = ship.stage; i < SHIP.stages.length && togo > 0; i++) {
    const st = SHIP.stages[i]
    const prop = i === ship.stage ? ship.stageProp[i] : st.propellant
    if (!(prop > 0)) continue
    const ve = st.isp * G0
    const mdot = st.thrust / ve
    // Everything this stage could deliver if it burned to depletion.
    const full = ve * Math.log(m / (m - prop))
    if (full >= togo) {
      t += (m * (1 - Math.exp(-togo / ve))) / mdot
      togo = 0
    } else {
      t += prop / mdot
      togo -= full
      m -= prop + st.dryMass // the spent structure goes too
    }
  }
  return t
}

const loiBurnDuration = () => burnTimeFor(live.lunar.captureDeltaV)

/**
 * How early to light the engine, as a fraction of the burn ahead of periapsis.
 *
 * A finite burn has to be placed relative to its apsis, not simply started at
 * it. Where exactly is a measured trade rather than a given: see
 * `PROFILE.loiLeadFraction`.
 */
const loiIgnitionLead = () => loiBurnDuration() * PROFILE.loiLeadFraction

/**
 * Refresh the insertion estimates. Scheduling only — the cutoff is closed-loop
 * and reads none of this.
 */
function updateLOI() {
  const loi = mission.loi
  // Outside the sphere of influence the selenocentric conic is a fiction, so
  // the capture burn it implies is one too — and it is a plausible-looking
  // number, which is worse than none. Report nothing until the Moon is actually
  // in charge of the trajectory.
  if (!live.insideLunarSOI) {
    loi.deltaVEstimate = 0
    loi.burnEstimate = 0
    return loi
  }
  loi.deltaVEstimate = live.lunar.captureDeltaV
  loi.burnEstimate = loiBurnDuration()
  return loi
}

export { updateLOI }

/* ---------------------------------------------------------------- *
 * Trans-Earth injection
 * ---------------------------------------------------------------- */

/** Selenocentric position and velocity of the craft, into `_sr` / `_sv`. */
function loadSelenocentric() {
  const st = live.sim.state
  const o = INDEX.ship * 6
  const m = INDEX.moon * 6
  _sr.set(st[o] - st[m], st[o + 1] - st[m + 1], st[o + 2] - st[m + 2])
  _sv.set(st[o + 3] - st[m + 3], st[o + 4] - st[m + 4], st[o + 5] - st[m + 5])
}

/** Point the thrust axis along the selenocentric velocity, and score it. */
function aimLunarProgradeGated() {
  lunarVelocity(_retro)
  if (_retro.lengthSq() < 1) return aimThrust(_up)
  aimThrust(_retro)
  mission.tei.pointingError = ship.forward.angleTo(_retro)
}

/**
 * Refresh the departure solution from live state.
 *
 * Unlike injection *to* the Moon, this is not a phase-angle problem. The target
 * is the Earth, which does not move appreciably in the rotating frame over a
 * return, so what has to be right is the **direction the craft leaves the lunar
 * sphere of influence** — and that is a property of where in the orbit the
 * engine lights, not of when the Moon will be somewhere.
 *
 * Three steps, all recomputed live because the Earth-Moon distance swings some
 * 45,000 km over a month and moves every one of them:
 *
 *   1. The return ellipse, apogee at the Moon and perigee in the corridor:
 *
 *        a = (r_M + r_p)/2        v_apo = sqrt(mu_E (2/r_M - 1/a))
 *
 *   2. What excess velocity that needs, as a vector:
 *
 *        v_inf = v_geo_target - v_moon
 *
 *      Measured here it comes out 846 m/s sitting 0.73 deg from -v_moon: the
 *      craft leaves *backwards* along the Moon's own path, so that what is left
 *      geocentrically is the 186 m/s that falls to Earth. That is the same
 *      direction the craft arrived on, which is the time symmetry of the
 *      transfer and the only reason the parking orbit's plane can serve at all.
 *
 *   3. Where in the orbit to burn. The departure asymptote of an escape
 *      hyperbola lies at true anomaly nu_inf = acos(-1/e) from its periapsis,
 *      so the burn point sits that far *behind* the required direction,
 *      measured in the direction of travel:
 *
 *        e = 1 + r v_inf^2 / mu_moon        nu_inf = acos(-1/e) = 142.05 deg
 *
 * The plane is deliberately left free. Forcing the return into the Moon's own
 * orbital plane would over-constrain a problem whose only real requirement is a
 * scalar — perigee radius — and would demand 111.6 m/s of out-of-plane burn to
 * fix a 7.58 deg mismatch that costs nothing if the return is simply allowed to
 * be inclined. `outOfPlane` reports that angle rather than correcting it.
 */
function updateTEI() {
  const tei = mission.tei
  loadSelenocentric()
  loadGeocentric()

  const rM = _rm.length()
  const r = _sr.length()
  if (!(rM > 1) || !(r > 1)) return tei

  // 1. the return ellipse
  const rp = BODIES.earth.radius + PROFILE.entryPerigee
  const at = (rM + rp) / 2
  const vApo = Math.sqrt(MU_EARTH * (2 / rM - 1 / at))

  // 2. the excess velocity it needs. Transverse direction in the lunar plane.
  _hm.crossVectors(_rm, _vm).normalize()
  _cross.copy(_rm).divideScalar(rM)
  _tHat.crossVectors(_hm, _cross).normalize()
  _vInf.copy(_tHat).multiplyScalar(vApo).sub(_vm)
  const vInf = _vInf.length()
  tei.vInfRequired = vInf
  _vInfHat.copy(_vInf).divideScalar(vInf)

  // The craft's own orbit normal, and how far the required direction lies out
  // of that plane. Reported, not corrected.
  _sh.crossVectors(_sr, _sv).normalize()
  const outDot = _vInfHat.dot(_sh)
  tei.outOfPlane = Math.asin(outDot > 1 ? 1 : outDot < -1 ? -1 : outDot)

  // 3. the escape hyperbola, and the burn point that produces this asymptote.
  const eHyp = 1 + (r * vInf * vInf) / MU_MOON
  const nuInf = Math.acos(-1 / eHyp)
  const vPeri = Math.sqrt(vInf * vInf + (2 * MU_MOON) / r)
  const vCirc = Math.sqrt(MU_MOON / r)
  tei.deltaVEstimate = vPeri - vCirc
  tei.burnEstimate = teiBurnDuration()

  // Project the required direction into the orbit plane, then walk back by
  // nu_inf against the direction of motion to get the ignition point.
  _burnDir.copy(_vInfHat).addScaledVector(_sh, -outDot)
  if (_burnDir.lengthSq() < 1e-12) return tei
  _burnDir.normalize().applyAxisAngle(_sh, -nuInf)

  // Phase from here to there, measured the way the craft actually travels.
  _cross.copy(_sr).divideScalar(r)
  const cosA = _cross.dot(_burnDir)
  let ang = Math.acos(cosA > 1 ? 1 : cosA < -1 ? -1 : cosA)
  _mcc.crossVectors(_cross, _burnDir)
  if (_mcc.dot(_sh) < 0) ang = TWO_PI - ang

  const n = _sv.length() / r // mean motion, from live state
  tei.timeToWindow = n > 1e-12 ? ang / n : Infinity
  return tei
}

export { updateTEI }

/** Departure burn duration, walked stage by stage — same as the capture's. */
const teiBurnDuration = () => burnTimeFor(mission.tei.deltaVEstimate)

const teiIgnitionLead = () => teiBurnDuration() * PROFILE.teiLeadFraction

/**
 * Entry attitude: heat shield into the relative wind.
 *
 * Aimed against the wind the drag model actually uses — velocity minus the
 * co-rotating air — rather than against inertial velocity, because at entry
 * speeds the 400 m/s the atmosphere is turning at is the difference between
 * pointing at the airflow and pointing 2 degrees off it.
 *
 * Worth being explicit that this is presentation, not dynamics: the drag model
 * has no lift and no angle-of-attack term, so the capsule's attitude does not
 * enter its trajectory at all. A real Orion flies a lifting entry and steers
 * with bank angle; this one is ballistic, and the attitude is here so the
 * vehicle is drawn the way it is flying.
 */
function aimEntryAttitude() {
  const st = live.sim.state
  const o = INDEX.ship * 6
  const e = INDEX.earth * 6
  const rx = st[o] - st[e]
  const ry = st[o + 1] - st[e + 1]
  const rz = st[o + 2] - st[e + 2]
  const w = live.sim.omega
  _aim.set(
    -(st[o + 3] - st[e + 3] - (w[1] * rz - w[2] * ry)),
    -(st[o + 4] - st[e + 4] - (w[2] * rx - w[0] * rz)),
    -(st[o + 5] - st[e + 5] - (w[0] * ry - w[1] * rx)),
  )
  if (_aim.lengthSq() < 1) return aimThrust(_up)
  aimThrust(_aim)
}

/**
 * Entry guidance: the capsule's one control loop.
 *
 * A blunt body flies a fixed trimmed angle of attack, so lift magnitude is not
 * available as a control — only its direction is. Rolling about the relative
 * wind decides how much of a fixed lift vector points up against gravity and
 * how much points down into the air, and that single number is the entire
 * authority the vehicle has over where it ends up and how hard it gets there.
 *
 * Two terms, and they do different jobs:
 *
 * **Track the target load, do not merely avoid it.** The g term is
 * proportional to `g - target`, so below the target the command rolls *toward*
 * lift-down and digs in. That looks wrong until you consider what minimises the
 * peak: flying lift-up throughout keeps the capsule high and fast, and it then
 * has to shed all that energy lower down where the air is thick — which is a
 * bigger spike, later. Diving to the target load and holding it spreads the
 * deceleration across a plateau, and a plateau at 6.5 g peaks lower than a
 * ballistic entry's 12 g does.
 *
 * **Damp on altitude rate.** A pure g loop rings: the vehicle is a lightly
 * damped phugoid at these speeds, and correcting only on the load error
 * overshoots into a skip and then back into a dive. The `hdot` term is what
 * turns that oscillation into a settled plateau, and it doubles as the
 * skip guard the moment the trajectory starts climbing.
 *
 * The commanded bank is rate-limited, because a capsule rolls on RCS at
 * something like 20 deg/s rather than instantly. That limit is deliberately not
 * the autopilot's 0.15 rad/s slew: that figure is a thrust-vector rate for
 * pointing an engine, and a capsule with no engine rolls faster.
 */
function updateEntryGuidance() {
  const en = mission.entry
  ship.liftToDrag = PROFILE.entryLiftToDrag
  en.guided = (ship.liftToDrag ?? SHIP.stages[ship.stage]?.drag?.ld ?? 0) > 0
  if (!en.guided) return // ballistic: no lift to point, so nothing to command

  /**
   * Two demands, blended about a nominal bank. Positive is lift up.
   *
   * This is a *demand* law, not an error law, and the difference is not
   * cosmetic. Tracking `g - target` proportionally looks equivalent and is not:
   * below the target it commands lift *down* to build load, so from an
   * interface where g is still zero it rolls to full dive and holds there until
   * the load arrives — by which time the capsule is deep, fast, and the loop
   * has no authority left to arrest it. Measured, that law peaked at **149 g**
   * against the ballistic entry's 12.
   *
   * What the vehicle actually wants is to sit at a nominal bank and be pushed
   * off it by whichever hazard is closer: rising load pushes toward lift up,
   * an incipient skip pushes toward lift down. Neither demand does anything
   * until its hazard is real, so the entry begins by flying the corridor it was
   * already targeted onto rather than fighting it.
   */
  const T = PROFILE.entryTargetG
  const B = PROFILE.entryGBand
  const S = PROFILE.entrySkipRate

  // Lift-up demand: nothing until the load is within a band of the target.
  let gDemand = (live.decelG - (T - B)) / B
  if (gDemand < 0) gDemand = 0
  else if (gDemand > 1) gDemand = 1

  // Lift-down demand: nothing while descending briskly, full once level.
  let skipDemand = (live.elements.vertical + S) / S
  if (skipDemand < 0) skipDemand = 0
  else if (skipDemand > 1) skipDemand = 1

  const nominal = PROFILE.entryNominalLift
  let vertical = nominal + gDemand * (1 - nominal) - skipDemand * (1 + nominal)
  if (vertical > 1) vertical = 1
  else if (vertical < -1) vertical = -1

  /**
   * Cross-range, and why the bank has a sign at all.
   *
   * Only |cos(bank)| is set by the loop above; the sign of sin(bank) is free,
   * and it steers laterally. Left unmanaged the capsule would fly a long arc
   * out of its entry plane, so the sign is flipped whenever the accumulated
   * cross-range runs past a deadband — which is exactly the bank reversal
   * Apollo flew, for exactly this reason. The plane is fixed at the interface
   * and the error measured against it.
   */
  const st = live.sim.state
  const o = INDEX.ship * 6
  const e = INDEX.earth * 6
  _sr.set(st[o] - st[e], st[o + 1] - st[e + 1], st[o + 2] - st[e + 2])
  const cross = _sr.dot(_entryNormal)
  en.crossRange = cross
  if (Math.abs(cross) > Math.abs(en.peakCrossRange)) en.peakCrossRange = cross

  /**
   * Reverse when the error is past the deadband *and still growing*.
   *
   * Stated on the rate rather than on the bank's sign, which is the robust
   * form: whether a positive bank drives cross-range positive or negative
   * depends on how the lateral axis was constructed, and an earlier version
   * that reasoned from that convention had it backwards and never reversed at
   * all — the capsule simply flew 194 km off plane. Asking whether the vehicle
   * is currently moving further out cannot be got backwards.
   *
   * The dwell stops it chattering at the deadband, where the error hovers and
   * the rate flickers sign every few frames.
   */
  _sv.set(st[o + 3] - st[e + 3], st[o + 4] - st[e + 4], st[o + 5] - st[e + 5])
  const crossRate = _sv.dot(_entryNormal)
  const sinceReversal = mission.t - en.lastReversal
  if (
    Math.abs(cross) > PROFILE.entryCrossRange &&
    cross * crossRate > 0 &&
    sinceReversal > PROFILE.entryReversalDwell
  ) {
    _bankSign.value = -_bankSign.value
    en.bankReversals += 1
    en.lastReversal = mission.t
  }

  const target = Math.acos(vertical) * _bankSign.value
  ship.bankCommand = target

  /**
   * Rate limit: roll toward the command at the vehicle's actual authority.
   *
   * On **simulated** seconds, not the wall clock. `control()` is handed the
   * wall delta — correct for the pad countdown, which is a real-time hold — but
   * a vehicle rolling in the world has to roll at the rate the world is
   * advancing, or at 60x it turns sixty times too slowly relative to its own
   * trajectory. Entry runs at warp 0 today, so the two are equal and nothing
   * would show; it would appear the moment anyone raised `entryWarp`.
   */
  let delta = target - ship.bankAngle
  const maxStep = PROFILE.entryRollRate * live.simDtLastFrame
  if (delta > maxStep) delta = maxStep
  else if (delta < -maxStep) delta = -maxStep
  ship.bankAngle += delta
}

/**
 * Halo diagnostics, in the frame the halo is actually periodic in.
 *
 * Perilune and apolune are what identify *which* NRHO this is — the family is
 * usually quoted by its perilune altitude and its resonance with the lunar
 * period — and the out-of-plane excursion is what makes it a halo rather than a
 * planar orbit. All read from the synodic frame, all scalars, no allocation.
 */
function trackHalo() {
  const nr = mission.nrho
  craftSynodic(live.sim.state)

  // Distance from the Moon, which sits at (1-MU, 0, 0) x separation.
  const mx = synodic.separation * (1 - MU_MASS)
  const dx = craftR.x - mx
  const r = Math.sqrt(dx * dx + craftR.y * craftR.y + craftR.z * craftR.z)
  nr.synodicR = r
  nr.synodicZ = craftR.z
  if (r < nr.perilune) nr.perilune = r
  if (r > nr.apolune) nr.apolune = r

  // Apolune is a local maximum in three consecutive selenocentric ranges. Read
  // from live.lunarRange rather than the synodic distance, because the burn is
  // aimed in the inertial frame and this is the quantity the projector targets.
  const range = live.lunarRange
  nr.atApolune = nr.prevRange > nr.prevPrevRange && nr.prevRange > range
  nr.prevPrevRange = nr.prevRange
  nr.prevRange = range
}

/** Peak loads through entry. Measured per frame, never predicted. */
function trackEntryPeaks() {
  const en = mission.entry
  if (live.decelG > en.peakG) {
    en.peakG = live.decelG
    en.peakGAltitude = live.elements.altitude
  }
  if (live.dynamicPressure > en.peakQ) en.peakQ = live.dynamicPressure
  // Three separate peaks, because they do not coincide: convective goes as
  // sqrt(rho) v^3 and radiative as roughly rho^1.2 f(v), so radiation peaks
  // higher and earlier where the craft is still fast, convection lower and
  // later where the air is thick. The total peaks at neither.
  if (live.heatFlux > en.peakHeatFlux) en.peakHeatFlux = live.heatFlux
  if (live.radiativeFlux > en.peakRadFlux) en.peakRadFlux = live.radiativeFlux
  if (live.totalFlux > en.peakTotalFlux) {
    en.peakTotalFlux = live.totalFlux
    en.peakTotalAltitude = live.elements.altitude
  }
}

/** Selenocentric characteristic energy, m^2/s^2. Negative while still bound. */
function selenocentricC3() {
  loadSelenocentric()
  const r = _sr.length()
  return _sv.lengthSq() - (2 * MU_MOON) / r
}

/**
 * Solve, at the ignition point, for the C3 the burn must reach.
 *
 * The patched-conic figure is a good guess and not an answer: it puts the
 * departure at the Moon's centre rather than 1,835 km off it, and it has no
 * Earth or Sun in it. So the target is found by *flying* candidate departures in
 * the scratch integrator and taking the best — the same "evaluate the objective
 * by propagating it" approach the corrections use, reduced to one variable
 * because the burn can only be prograde.
 *
 * A **minimisation**, not a root-find, and that distinction is the whole
 * character of this departure. Projected perigee against departure energy is a
 * smooth curve with a floor, and measured from this parking orbit that floor is
 * 6,487 km — the corridor is 6,411 km, and the curve never reaches it:
 *
 *     dv      763    796    829    862    895   m/s
 *     r_p   18185   8897   6487   9127  15941   km altitude
 *
 * The reason is the plane. The required departure direction sits 9.37 deg out of
 * the parking orbit's plane, and an in-plane burn cannot produce it, so about
 * 168 m/s of the Moon's own orbital velocity survives uncancelled at right
 * angles to the return. That component is perpendicular to the radius, so it
 * counts in full toward the angular momentum, and perigee goes as h^2 — which is
 * why leaving the return's plane "free" does not help. It is not free; it is
 * paid for in perigee.
 *
 * Nor is it worth fixing here. Thrusting out of plane at the burn point buys
 * 4.5 km of perigee per m/s, and squaring the plane up in lunar orbit costs
 * 2 v sin(theta/2) = 267 m/s. The same error costs about 90 m/s to remove after
 * departure, where the craft is down to a couple of hundred m/s and turning its
 * velocity is cheap. So the departure gets as close as its plane allows and the
 * corridor trim does the rest.
 *
 * The underlying lesson is a mission-design one: this plane was inherited from
 * whatever the arrival hyperbola happened to give, because the capture had no
 * reason to care. Apollo chose its insertion plane with the departure already in
 * mind. Ours pays 90 m/s for not having.
 *
 * Run once, on ignition — a few dozen five-day projections.
 */
function solveTEICutoff() {
  const tei = mission.tei
  loadSelenocentric()
  const r = _sr.length()
  const v = _sv.length()
  const target = BODIES.earth.radius + PROFILE.entryPerigee
  _cross.copy(_sv).divideScalar(v)

  const miss = (dv) => {
    _mcc.copy(_cross).multiplyScalar(dv)
    const p = projectPerigee(_mcc.x, _mcc.y, _mcc.z)
    return Number.isFinite(p) ? Math.abs(p - target) : Infinity
  }

  const guess = tei.deltaVEstimate
  if (!(guess > 0)) {
    tei.solved = false
    return
  }

  // Coarse scan for the basin, then golden-section inside it. Scanning first
  // because the curve is only unimodal near its floor — far out on either side
  // the projection stops returning a return trajectory at all.
  let bestDv = guess
  let bestMiss = Infinity
  const lo0 = guess * 0.9
  const hi0 = guess * 1.1
  const N = 16
  for (let i = 0; i <= N; i++) {
    const dv = lo0 + ((hi0 - lo0) * i) / N
    const f = miss(dv)
    if (f < bestMiss) {
      bestMiss = f
      bestDv = dv
    }
  }

  const span = (hi0 - lo0) / N
  let a = bestDv - span
  let b = bestDv + span
  const phi = 0.6180339887
  let c = b - phi * (b - a)
  let d = a + phi * (b - a)
  let fc = miss(c)
  let fd = miss(d)
  for (let k = 0; k < 20 && b - a > 0.05; k++) {
    if (fc < fd) {
      b = d
      d = c
      fd = fc
      c = b - phi * (b - a)
      fc = miss(c)
    } else {
      a = c
      c = d
      fc = fd
      d = a + phi * (b - a)
      fd = miss(d)
    }
  }
  const dv = 0.5 * (a + b)
  const finalMiss = miss(dv)

  const vOut = v + dv
  tei.c3Target = vOut * vOut - (2 * MU_MOON) / r
  tei.predictedPerigee = finalMiss <= bestMiss ? target + finalMiss : target + bestMiss
  tei.solved = true
  /** True only if a prograde departure can reach the corridor unaided. */
  tei.corridorReachable = Math.min(finalMiss, bestMiss) < 50e3
}



/* ---------------------------------------------------------------- *
 * Trans-lunar injection geometry
 * ---------------------------------------------------------------- */

const MU_EARTH = G * BODIES.earth.mass
const MU_MOON = G * BODIES.moon.mass
/** Moon's mass fraction, for locating it in the synodic frame. */
const MU_MASS = BODIES.moon.mass / (BODIES.earth.mass + BODIES.moon.mass)
const TWO_PI = Math.PI * 2

/** Geocentric state of the ship and the Moon, into the scratch vectors. */
function loadGeocentric() {
  const st = live.sim.state
  const o = INDEX.ship * 6
  const e = INDEX.earth * 6
  const m = INDEX.moon * 6
  _rs.set(st[o] - st[e], st[o + 1] - st[e + 1], st[o + 2] - st[e + 2])
  _vs.set(st[o + 3] - st[e + 3], st[o + 4] - st[e + 4], st[o + 5] - st[e + 5])
  _rm.set(st[m] - st[e], st[m + 1] - st[e + 1], st[m + 2] - st[e + 2])
  _vm.set(st[m + 3] - st[e + 3], st[m + 4] - st[e + 4], st[m + 5] - st[e + 5])
}

/**
 * Hohmann flight time from a departure radius out to the Moon's, s.
 *
 * Shared between the live injection solution and the window forecast, because
 * the forecast is only worth anything if it asks exactly the question the
 * ignition test will ask when the day comes.
 */
function transferTime(r1, r2) {
  const at = (r1 + r2) / 2
  return Math.PI * Math.sqrt((at * at * at) / MU_EARTH)
}

/**
 * Where the Moon will be when a transfer launched now arrives: its present
 * direction carried forward by `travel` radians about its own orbit normal.
 * Written into `out`. The same two lines `updateTLI` has always used, moved so
 * the forecast cannot drift from them.
 */
function arrivalDirection(out, rm, vm, r2, travel) {
  _hm.crossVectors(rm, vm).normalize()
  return out.copy(rm).divideScalar(r2).applyAxisAngle(_hm, travel)
}

/**
 * Refresh the whole injection solution from live state.
 *
 * A Hohmann transfer covers 180 degrees while the Moon covers only part of its
 * own orbit, so the Moon has to be *led*: it must sit ahead by exactly the
 * shortfall, 180 degrees minus whatever it will travel during the flight.
 *
 *   a  = (r_ship + r_moon) / 2
 *   T  = pi sqrt(a^3 / mu)
 *   dθ = n_moon T
 *   target phase = pi - dθ
 *
 * Everything is recomputed each frame rather than solved once, because the
 * Moon's radius is emergent here and swings by some 45,000 km over a month —
 * which moves both the flight time and the lead angle.
 */
function updateTLI() {
  const tli = mission.tli
  loadGeocentric()

  const r1 = _rs.length()
  const r2 = _rm.length()
  if (r1 < 1 || r2 < 1) return tli

  const at = (r1 + r2) / 2
  tli.timeOfFlight = transferTime(r1, r2)

  // The Moon's mean motion, taken from its live state rather than a constant.
  const nMoon = _vm.length() / r2
  tli.moonTravel = nMoon * tli.timeOfFlight
  tli.targetPhase = Math.PI - tli.moonTravel

  // Injection burn, vis-viva at the departure radius.
  tli.deltaV = Math.sqrt(MU_EARTH * (2 / r1 - 1 / at)) - Math.sqrt(MU_EARTH / r1)

  // Signed phase: how far *ahead* the Moon is, measured about the ship's own
  // orbit normal so that "ahead" means ahead in the direction of travel.
  _hs.crossVectors(_rs, _vs)
  const cosPhase = _rs.dot(_rm) / (r1 * r2)
  let phase = Math.acos(cosPhase > 1 ? 1 : cosPhase < -1 ? -1 : cosPhase)
  // Scratch, not clone(): this runs every frame and must not allocate.
  _cross.crossVectors(_rs, _rm)
  if (_hs.dot(_cross) < 0) phase = TWO_PI - phase
  tli.phase = phase

  // The ship laps the Moon, so the lead angle closes at the difference of the
  // two mean motions.
  const nShip = _vs.length() / r1
  const closing = nShip - nMoon

  /**
   * The ignition test, in three dimensions.
   *
   * The planar phase angle above is the classical condition and it is what the
   * HUD reports, but on its own it only fixes radius and timing. Our parking
   * orbit sits some 40 degrees off the lunar plane, and apoapsis is pinned to
   * *our* plane — so matching the phase angle alone arrives at the right
   * distance on the right day and still misses by sin(40 deg) x 400,000 km.
   *
   * Stated in 3D the same condition also fixes the plane: apoapsis will point
   * opposite the ignition point, so fire when that direction lines up with
   * where the Moon will actually be after the flight. Satisfying it forces
   * ignition onto a node, which is exactly the constraint the planar form drops.
   */
  arrivalDirection(_future, _rm, _vm, r2, tli.moonTravel)
  _apoDir.copy(_rs).divideScalar(-r1)

  tli.lastAlignment = tli.alignment
  const cosAlign = _apoDir.dot(_future)
  tli.alignment = Math.acos(cosAlign > 1 ? 1 : cosAlign < -1 ? -1 : cosAlign)

  /**
   * How far out of the parking plane the Moon's arrival point lies.
   *
   * The slow half of the problem, and the half worth steering time by.
   * `alignment` mixes two rates: the craft sweeps its whole plane every 88
   * minutes, so the angle it reports dives toward zero and climbs again twice
   * an orbit whether or not a window is open at all. This does not — it is set
   * by the Moon, and it changes over days.
   */
  const hLen = _hs.length()
  const outDot = hLen > 0 ? _hs.dot(_future) / hLen : 0
  tli.outOfPlane = Math.asin(outDot > 1 ? 1 : outDot < -1 ? -1 : outDot)

  // Time to the window from how fast the alignment is closing. Measured rather
  // than derived, because it depends on both bodies and on the flight time,
  // which itself moves with the Moon's radius.
  const rate = (tli.lastAlignment - tli.alignment) / Math.max(live.simDtLastFrame, 1e-6)
  tli.timeToWindow = rate > 1e-12 ? tli.alignment / rate : Infinity

  let gap = phase - tli.targetPhase
  if (gap < 0) gap += TWO_PI
  tli.timeToPhase = closing > 1e-12 ? gap / closing : Infinity

  return tli
}

export { updateTLI }

/** Commit to the injection. Called from the HUD, not automatic. */
export function commitTLI() {
  if (currentPhase().id !== 'COAST') return false
  mission.tli.committed = true
  resetLoiter()
  setPhase(INDEX_OF.TLI_ALIGN)
  return true
}

/** Clear the loiter plan. Exported for the harness's snapshot restore. */
export function resetLoiter() {
  const lo = mission.tli.loiter
  lo.planned = false
  lo.needed = false
  lo.raised = false
  lo.wait = 0
  lo.lifetime = 0
  lo.margin = 0
  lo.arrive = 0
  lo.target = 0
  lo.dv1 = 0
  lo.dv2 = 0
  lo.node1 = -1
  lo.node2 = -1
  lo.replans = 0
  lo.corrections = 0
  lo.periapsisAtIgnition = 0
  lo.reason = ''
  lo.manual = false
}

/* ---------------------------------------------------------------- *
 * Waiting for the window without falling out of the sky
 * ---------------------------------------------------------------- */

/** Sample spacing and reach of the window forecast, s. Half an hour is 0.3 deg of lunar motion. */
const WINDOW_STEP = 1800
const WINDOW_HORIZON = 30 * 86400
/** Spacing of the scan for the craft's pass through a window already open, s: 1.4 deg of its orbit. */
const PASS_STEP = 20
/**
 * How far inside the tolerance a pass must fall for the forecast to count on
 * it, rad.
 *
 * The error this guards against costs very differently in its two directions.
 * A pass counted on that then misses leaves the vehicle waiting half a month
 * with no raise planned, which is how the one vehicle lost in 624 launches was
 * lost. A pass not counted on that then fires costs a raise that is withdrawn
 * at ignition.
 */
const PASS_MARGIN = 0.05 * (Math.PI / 180)

let _ephemeris = null
const _em = new Vector3()
const _ev = new Vector3()
const _eh = new Vector3()
const _ef = new Vector3()
const _er = new Vector3()
const _evs = new Vector3()
const _ea = new Vector3()
const _eb = new Vector3()

/**
 * The craft's next ignition inside a window that is open now, s from now, or
 * Infinity if the window will close before the craft comes round to use it.
 *
 * Open is not the same as usable. Ignition needs the Moon's arrival point within
 * tolerance of the plane *at the moment* the craft passes the point opposite it,
 * and that comes round once an orbit. At commitment the arrival point can be
 * inside tolerance and on its way out: measured, a Vandenberg launch committed
 * with it 0.09 deg out of plane, and by the time the craft came round an orbit
 * later it was 0.77 deg out and the pass missed. The forecast had said "now";
 * the next window was half a month away; no raise had been planned.
 *
 * So within an open window the pass itself is found: the craft and the Moon
 * propagated together on the drag-free copy in 20 s steps — two orbits of drag
 * move the craft well under a kilometre — asking at each step where the arrival
 * point sits in the craft's own orbital plane relative to apoapsis, and taking
 * the out-of-plane angle at the step where that crosses zero.
 */
function passInOpenWindow(horizon) {
  _ephemeris.resetFrom(live.sim)
  const y = _ephemeris.state
  const o = INDEX.ship * 6
  const e = INDEX.earth * 6
  const m = INDEX.moon * 6
  const limit = PROFILE.phaseTolerance - PASS_MARGIN
  let lastAhead = 0
  let lastOut = 0
  for (let t = 0; t <= horizon; t += PASS_STEP) {
    if (t > 0) _ephemeris.advance(PASS_STEP, PASS_STEP, 1)
    _er.set(y[o] - y[e], y[o + 1] - y[e + 1], y[o + 2] - y[e + 2])
    _evs.set(y[o + 3] - y[e + 3], y[o + 4] - y[e + 4], y[o + 5] - y[e + 5])
    _em.set(y[m] - y[e], y[m + 1] - y[e + 1], y[m + 2] - y[e + 2])
    _ev.set(y[m + 3] - y[e + 3], y[m + 4] - y[e + 4], y[m + 5] - y[e + 5])
    const rs = _er.length()
    const r2 = _em.length()
    _eh.crossVectors(_er, _evs).normalize()
    arrivalDirection(_ef, _em, _ev, r2, (_ev.length() / r2) * transferTime(rs, r2))
    const sine = _eh.dot(_ef)
    const out = Math.asin(sine > 1 ? 1 : sine < -1 ? -1 : sine)
    // Apoapsis points away from the craft; "ahead" is the direction it turns.
    _ea.copy(_er).divideScalar(-rs)
    _eb.crossVectors(_eh, _ea)
    const ahead = Math.atan2(_ef.dot(_eb), _ef.dot(_ea))
    if (t > 0 && lastAhead > 0 && ahead <= 0 && _ef.dot(_ea) > 0) {
      const frac = lastAhead / (lastAhead - ahead)
      const atPass = lastOut + frac * (out - lastOut)
      if (Math.abs(atPass) <= limit) return t - PASS_STEP + frac * PASS_STEP
    }
    lastAhead = ahead
    lastOut = out
  }
  return Infinity
}

/**
 * Seconds until the craft can inject: the pass through a window open now if it
 * will be caught, otherwise the moment the next window opens. Infinity if none
 * within a month.
 *
 * The Moon is propagated, not extrapolated: a drag-free copy of the simulation
 * (`clone()` does not carry the atmosphere) marched in half-hour steps, with
 * `arrivalDirection` asked the question `updateTLI` will ask each frame. A
 * window's opening is interpolated between the two samples either side of it —
 * the first version returned the sample, up to half an hour late, and 103 of
 * 624 launches then injected before their own forecast. What follows an opening
 * is the craft coming round, within one parking orbit; the planner's margin
 * carries that orbit. A window that is open when this runs is handed to
 * `passInOpenWindow` instead, and skipped if its pass will not be caught.
 */
function predictTLIWindow(r1) {
  if (!_ephemeris) _ephemeris = live.sim.clone()
  loadGeocentric()
  _eh.crossVectors(_rs, _vs).normalize()
  const planeX = _eh.x
  const planeY = _eh.y
  const planeZ = _eh.z

  const tol = PROFILE.phaseTolerance
  const y = _ephemeris.state
  const e = INDEX.earth * 6
  const m = INDEX.moon * 6
  const outAt = () => {
    _em.set(y[m] - y[e], y[m + 1] - y[e + 1], y[m + 2] - y[e + 2])
    _ev.set(y[m + 3] - y[e + 3], y[m + 4] - y[e + 4], y[m + 5] - y[e + 5])
    const r2 = _em.length()
    arrivalDirection(_ef, _em, _ev, r2, (_ev.length() / r2) * transferTime(r1, r2))
    const sine = planeX * _ef.x + planeY * _ef.y + planeZ * _ef.z
    return Math.asin(sine > 1 ? 1 : sine < -1 ? -1 : sine)
  }

  _ephemeris.resetFrom(live.sim)
  let skipping = false
  let last = outAt()
  if (Math.abs(last) <= tol) {
    const period = 2 * Math.PI * Math.sqrt((r1 * r1 * r1) / MU_EARTH)
    const pass = passInOpenWindow(2 * period)
    if (Number.isFinite(pass)) return pass
    skipping = true
    _ephemeris.resetFrom(live.sim)
  }
  for (let k = 1; k * WINDOW_STEP <= WINDOW_HORIZON; k++) {
    _ephemeris.advance(WINDOW_STEP, WINDOW_STEP, 1)
    const out = outAt()
    if (skipping) {
      if (Math.abs(out) > tol) skipping = false
    } else if (Math.abs(last) > tol && (Math.abs(out) <= tol || out > 0 !== last > 0)) {
      // A straight line through the two readings, signed, so a crossing inside
      // one step is found as well as an approach.
      const frac = (last - Math.sign(last) * tol) / (last - out)
      return (k - 1 + frac) * WINDOW_STEP
    }
    last = out
  }
  return Infinity
}

/** Withdraw the loiter plan's raise burns that have not flown yet. */
function withdrawLoiterBurns() {
  const lo = mission.tli.loiter
  for (const id of [lo.node1, lo.node2]) {
    if (id < 0) continue
    const node = nodes.find((n) => n.id === id)
    if (node && !node.executed) removeNode(id)
  }
}

/**
 * Whether ignition waits for a raise still to fly.
 *
 * The floor is a hard one. When the window comes with perigee under it and the
 * raise that fixes it has not flown — a pilot trimmed the orbit just before the
 * window, or committed from a low one at the wrong moment — the window is let go
 * rather than injected through. The raise flies, the plan is checked again, and
 * the next window is taken from an orbit that clears the floor.
 *
 * Evaluated every frame of the wait, so it allocates nothing, and the perigee
 * test comes first: above the floor, which is almost always, there is no loop.
 */
function holdingForRaise() {
  if (live.elements.periapsisRadius >= BODIES.earth.radius + PROFILE.injectionFloor) return false
  const lo = mission.tli.loiter
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i]
    if (!n.executed && (n.id === lo.node1 || n.id === lo.node2)) return true
  }
  return false
}

/**
 * Remake the plan from the orbit the vehicle is now in.
 *
 * Called when the pilot has changed the orbit during the wait — a burn of their
 * own planned as a node, or thrust by hand. The committed orbit the raise was
 * built around is no longer the one being flown: a retrograde trim can take a
 * lifetime that comfortably covered the wait and leave a day of it, and a
 * prograde one can make a planned raise pointless. Either way the old burns are
 * withdrawn before the new plan is drawn up.
 */
function replanLoiter() {
  const lo = mission.tli.loiter
  const replans = lo.replans + 1
  const corrections = lo.corrections
  withdrawLoiterBurns()
  resetLoiter()
  lo.replans = replans
  lo.corrections = corrections
  planLoiter()
}

/**
 * How many times a raise that has flown may be followed by another.
 *
 * A raise is flown to within a frame of thrust and timed from osculating
 * elements, so a second, small correction is ordinary. A third means the
 * vehicle cannot be kept up this way — out of propellant, or an orbit the
 * theory does not describe — and it should be seen to fail rather than spend
 * its tanks trying.
 */
const LOITER_CORRECTIONS = 2

/** After the plan's last raise burn: did it buy the life it was for? */
function verifyLoiter() {
  const lo = mission.tli.loiter
  if (lo.corrections >= LOITER_CORRECTIONS || !assessOrbit()) return
  if (!shortOfWindow(_orbit) && !belowInjectionFloor(_orbit)) return
  lo.corrections += 1
  replanLoiter()
}

/** The orbit being flown, measured against the wait. Filled by `assessOrbit`. */
const _orbit = { a: 0, e: 0, cosI: 0, dragK: 0, n: 0, meanAnomaly: 0, wait: 0, lifetime: 0, margin: 0, periapsisAtIgnition: 0 }

/**
 * Measure the orbit being flown against the wait for the window. False when
 * there is no bound orbit to measure.
 *
 * The wait is a forecast (`predictTLIWindow`) and the remaining life a decay
 * integral (`decay.js`), both from models the rest of the simulation already
 * runs on. The vehicle needs to reach the window with one more parking orbit in
 * hand — the craft comes round to the ignition point within one — and the
 * injection burn on top.
 */
function assessOrbit() {
  updateTLI()
  const r = _rs.length()
  const a = 1 / (2 / r - _vs.lengthSq() / MU_EARTH)
  if (!(a > 0)) return false
  _eh.crossVectors(_rs, _vs)
  const hLen = _eh.length()
  const o = _orbit
  o.a = a
  o.e = Math.sqrt(Math.max(0, 1 - (hLen * hLen) / (MU_EARTH * a)))
  o.cosI = (_eh.x * SPIN_AXIS[0] + _eh.y * SPIN_AXIS[1] + _eh.z * SPIN_AXIS[2]) / hLen
  o.dragK = live.sim.dragK[0]
  o.n = Math.sqrt(MU_EARTH / (a * a * a))
  // e sin E and e cos E straight from the state, so a near-circle loses nothing to a division by e.
  const eSinE = _rs.dot(_vs) / Math.sqrt(MU_EARTH * a)
  o.meanAnomaly = Math.atan2(eSinE, 1 - r / a) - eSinE
  o.wait = predictTLIWindow(a)
  o.lifetime = orbitalLifetime(a, o.e, o.dragK, o.cosI)
  o.margin = TWO_PI / o.n + burnTimeFor(mission.tli.deltaV)
  // Perigee at the latest ignition: the window's opening, plus the orbit the craft
  // can take to come round to it. Measured against flight, to under half a kilometre.
  if (!Number.isFinite(o.wait)) o.periapsisAtIgnition = Infinity
  else if (decayAfter(a, o.e, o.wait + TWO_PI / o.n, o.dragK, o.cosI)) o.periapsisAtIgnition = decayed[0] * (1 - decayed[1])
  else o.periapsisAtIgnition = -Infinity
  return true
}

/** Whether an assessed orbit falls short of its window, with the theory's tolerance taken off its life. */
const shortOfWindow = (o) =>
  Number.isFinite(o.wait) && o.lifetime * (1 - PROFILE.lifetimeTolerance) < o.wait + o.margin

/**
 * How far above the injection floor the flight computer judges and aims, m.
 *
 * More than the theory's error in perigee at ignition, which measured 0.43 km at
 * worst across the flights that checked it. A raise aimed at the floor itself
 * could arrive a few hundred metres under it, and an orbit predicted a few
 * hundred metres over it could inject under it; judged and aimed a kilometre
 * up, a hard floor stays hard.
 */
const PERIGEE_MARGIN = 1e3

/** Whether an assessed orbit would reach its ignition with perigee under the injection floor. */
const belowInjectionFloor = (o) =>
  o.periapsisAtIgnition < BODIES.earth.radius + PROFILE.injectionFloor + PERIGEE_MARGIN

/**
 * Decide, at commitment and again whenever the orbit changes under the plan,
 * whether it will outlast the wait — and if it will not, plan the orbit that
 * does.
 *
 * The raise goes to the circular orbit that decays back down into the one it
 * started from *just as the window opens*. So injection is flown from the orbit
 * it always was, and the margin at the window is not a tolerance but that
 * orbit's whole remaining life. It is flown as ordinary manoeuvre nodes, in the
 * flight plan like any other burn, where the pilot can see what was decided or
 * delete it.
 *
 * The burns sit at the apsides, where the transfer formulas are true. The first
 * version burned two minutes after planning wherever the craft was, treating
 * the orbit as a circle at its semi-major axis — harmless from a parking orbit
 * with 6 km between its apsides, and not from one a pilot has just trimmed: a
 * correct replan after a 25 m/s retrograde trim flew its raise from the wrong
 * point and the vehicle was lost at MET 181.7 h. Now, when the target lies above
 * apogee, the transfer starts at perigee and is rounded off at the target; when
 * it lies inside the orbit, one burn at apogee lifts perigee to it and leaves
 * apogee where it is, which only lengthens the life.
 *
 * This cannot move to the pad. Commitment is the pilot's, made in orbit, at
 * whatever time they choose; the flight computer's job is to survive the wait
 * it was handed, from wherever the pilot handed it over.
 */
function planLoiter() {
  const lo = mission.tli.loiter
  lo.planned = true
  if (!assessOrbit()) return
  const o = _orbit
  lo.wait = o.wait
  lo.lifetime = o.lifetime
  lo.margin = o.margin
  lo.periapsisAtIgnition = o.periapsisAtIgnition
  const short = shortOfWindow(o)
  if (!short && !belowInjectionFloor(o)) return
  lo.needed = true
  lo.reason = short ? 'lifetime' : 'floor'
  if (!PROFILE.loiterRaise) return

  const keep = 1 - PROFILE.lifetimeTolerance
  const floor = BODIES.earth.radius + PROFILE.injectionFloor + PERIGEE_MARGIN
  /**
   * Where to have decayed to when the window comes. Short of life: back down into
   * the orbit being flown, but never under the injection floor, which a pilot's
   * trim can take it below. Only low: the floor itself — the least raise that keeps
   * the injection above it. And never an orbit that could not survive the
   * alignment itself.
   */
  lo.arrive = short ? Math.max(o.a, floor) : floor
  if (orbitalLifetime(lo.arrive, 0, o.dragK, o.cosI) * keep < lo.margin) {
    lo.arrive = Math.max(lo.arrive, circularOrbitDecayingTo(BODIES.earth.radius + DECAY_FLOOR, lo.margin / keep, o.dragK, o.cosI))
  }

  const rp = o.a * (1 - o.e)
  const ra = o.a * (1 + o.e)
  const period = TWO_PI / o.n
  const slew = 2 * PROFILE.nodeAlignMargin
  const until = (anomaly) => {
    let dt = ((((anomaly - o.meanAnomaly) % TWO_PI) + TWO_PI) % TWO_PI) / o.n
    while (dt < slew) dt += period
    return dt
  }
  const toPerigee = until(0)
  // The loiter clock starts once the orbit is up, half a transfer after perigee. An
  // orbit aimed at the floor is aimed at the latest ignition, an orbit after the
  // window opens, because that is where the floor is judged.
  const aimAt = lo.arrive <= floor ? lo.wait + period : lo.wait

  /**
   * One burn at apogee when lifting perigee is enough, sized exactly: the lowest
   * perigee whose orbit, decayed to `aimAt`, still has its perigee at `arrive`.
   *
   * The first version sized it as if the burn left a circle at the new perigee.
   * It does not — apogee stays where it was, and an orbit with a high apogee
   * decays far more slowly than a circle at its perigee — so a floor raise aimed
   * at 140 km arrived at 152, and was not the least raise at all.
   */
  const toApogee = until(Math.PI)
  const perigeeAtAim = (newPerigee) => {
    const a1 = 0.5 * (newPerigee + ra)
    const e1 = (ra - newPerigee) / (ra + newPerigee)
    return decayAfter(a1, e1, aimAt - toApogee, o.dragK, o.cosI) ? decayed[0] * (1 - decayed[1]) : -Infinity
  }
  if (perigeeAtAim(ra) >= lo.arrive) {
    let under = rp
    let over = ra
    for (let k = 0; k < 24 && over - under > 50; k++) {
      const mid = 0.5 * (under + over)
      if (perigeeAtAim(mid) >= lo.arrive) over = mid
      else under = mid
    }
    lo.target = over
    lo.dv1 = Math.sqrt(MU_EARTH * (2 / ra - 2 / (ra + lo.target))) - Math.sqrt(MU_EARTH * (2 / ra - 1 / o.a))
    lo.dv2 = 0
    lo.node1 = addNode(live.sim.t + toApogee, { prograde: lo.dv1 }).id
    lo.node2 = -1
  } else {
    // Two burns to a circle above apogee, where a circle is what they leave.
    lo.target = circularOrbitDecayingTo(lo.arrive, aimAt - toPerigee - 0.5 * period, o.dragK, o.cosI)
    const at = 0.5 * (rp + lo.target)
    lo.dv1 = Math.sqrt(MU_EARTH * (2 / rp - 1 / at)) - Math.sqrt(MU_EARTH * (2 / rp - 1 / o.a))
    lo.dv2 = Math.sqrt(MU_EARTH / lo.target) - Math.sqrt(MU_EARTH * (2 / lo.target - 1 / at))
    const t1 = live.sim.t + toPerigee
    lo.node1 = addNode(t1, { prograde: lo.dv1 }).id
    lo.node2 = addNode(t1 + Math.PI * Math.sqrt((at * at * at) / MU_EARTH), { prograde: lo.dv2 }).id
  }
  lo.raised = true
}

/* ---------------------------------------------------------------- *
 * Phases
 * ---------------------------------------------------------------- */

const PHASES = [
  {
    id: 'PRE_LAUNCH',
    label: 'Pre-launch',
    clamped: true,
    enter() {
      ship.throttle = 0
      ship.autopilot = true
      mission.countdown = PROFILE.countdown
    },
    control(dt) {
      aimThrust(_up)
      // Held on the pad, so point the vehicle rather than slewing to it: a
      // rocket does not spend its countdown rotating to vertical.
      ship.quaternion.copy(ship.targetQuaternion)
      mission.countdown -= dt
    },
    done: () => mission.countdown <= 0,
    next: () => INDEX_OF.LIFTOFF,
  },
  {
    id: 'LIFTOFF',
    label: 'Liftoff',
    enter() {
      ship.throttle = 1
      mission.t = 0
      // Freeze the target orbital plane from the pad's local frame. Everything
      // after this steers within it.
      updateLocalFrame()
      azimuthDirection(_setup, mission.site.azimuth)
      _plane.crossVectors(_up, _setup).normalize()
      mission.planeLocked = true
    },
    control() {
      manageThrottle()
      aimThrust(_up)
    },
    done: () => live.elements.altitude > SHIP.ascent.kickAltitude,
    next: () => INDEX_OF.PITCH_KICK,
  },
  {
    id: 'PITCH_KICK',
    label: 'Pitch kick',
    control() {
      manageThrottle()
      const a = SHIP.ascent.kickAngle * DEG
      azimuthDirection(_aim, mission.site.azimuth)
      _aim.multiplyScalar(Math.sin(a)).addScaledVector(_up, Math.cos(a))
      aimThrust(_aim)
    },
    done: () => live.elements.altitude > SHIP.ascent.turnStart,
    next: () => INDEX_OF.GRAVITY_TURN,
  },
  {
    id: 'GRAVITY_TURN',
    label: 'Gravity turn',
    control(dt) {
      manageThrottle()
      aimAscent()
    },
    /**
     * Cut off when apoapsis reaches the parking altitude at better than half
     * circular speed, or when the propellant runs out.
     *
     * Perigee was the test before this, twice: against a flat 150 km, which said
     * nothing about which orbit while the ascent lofted past a thousand
     * kilometres, and then against the parking altitude, which burned on while
     * apoapsis ran away. The comment inside `done` has the measurement. The
     * -57 km periapsis an apoapsis cutoff once left Artemis with came from
     * steering clamped never to point below the horizon, not from the cutoff,
     * and it went with the vertical-acceleration law in `aimAscent`.
     */
    done: () => {
      const target = SHIP.parkingOrbit.altitude
      /**
       * Apoapsis on target, with speed enough that it is an insertion and not a
       * lob — the objection this comment used to raise against an apoapsis
       * trigger, answered rather than avoided. A lob reaches 200 km at 2 km/s,
       * a quarter of circular; an insertion is within a few percent of it.
       *
       * Perigee is deliberately *not* in the test. Thrusting below apoapsis
       * raises apoapsis, not perigee, so waiting for perigee means burning
       * until apoapsis has run away with it: measured, that parked Apollo at
       * 10,181 km. Perigee is what the circularisation burn at apoapsis is for.
       */
      const vCircular = Math.sqrt((G * BODIES.earth.mass) / (BODIES.earth.radius + target))
      return (
        (live.elements.apogee >= target && live.elements.speed >= 0.5 * vCircular) ||
        ship.thrust === 0
      )
    },
    next: () => INDEX_OF.MECO,
  },
  {
    id: 'STAGING',
    label: 'Staging',
    enter() {},
    /**
     * An interrupt, not a step — so it holds whatever the preempted phase was
     * commanding rather than substituting its own.
     *
     * This used to run the ascent pitch programme outright, which is invisible
     * while the only separations happen during ascent and wrong the moment one
     * does not. The insertion burn starts on a stage carrying about 18 m/s of
     * margin against an 800 m/s burn, so it stages within seconds of its
     * target: reverting to a launch pitch schedule would swing the vehicle off
     * retrograde for 2.5 s in the middle of the capture.
     */
    control(dt) {
      PHASES[mission.resumeIndex].control(dt)
    },
    /**
     * Held briefly so the event is visible — but the hold must not swallow the
     * cutoff test of the phase it preempted. A burn that stages 2 m/s short of
     * its target would otherwise run 2.5 s unwatched past it, which at the
     * insertion's acceleration is several m/s of overshoot and thousands of
     * kilometres of apoapsis.
     */
    done() {
      mission.resumeDone = PHASES[mission.resumeIndex].done()
      return mission.resumeDone || mission.phaseT > 2.5
    },
    next: () =>
      mission.resumeDone ? PHASES[mission.resumeIndex].next() : mission.resumeIndex,
  },
  {
    id: 'MECO',
    label: 'MECO',
    enter() {
      ship.throttle = 0
    },
    control: aimPrograde,
    done: () => mission.phaseT > 3,
    next: () => INDEX_OF.COAST_TO_APOAPSIS,
  },
  {
    id: 'COAST_TO_APOAPSIS',
    label: 'Coast to apoapsis',
    enter() {
      ship.throttle = 0
    },
    control() {
      aimPrograde()
      // Step the warp down as the ignition point approaches. Held at 1 hr/s the
      // frame covers 60 simulated seconds, which would overshoot the trigger by
      // up to a minute; the ladder trades that away for resolution only where
      // resolution matters.
      const slack = live.elements.timeToApoapsis - burnLead()
      mission.warpRequest = slack > 1200 ? WARP.h1 : slack > 300 ? WARP.m1 : WARP.x1
    },
    done: () => live.elements.timeToApoapsis <= burnLead(),
    next: () => INDEX_OF.CIRCULARISE,
  },
  {
    id: 'CIRCULARISE',
    label: 'Circularise',
    enter() {
      ship.throttle = 1
      mission.bestEccentricity = Infinity
      /**
       * Real time, like every other burn that cuts off on a minimum.
       *
       * This asked for a minute a second, which the powered cap allows and
       * which makes a frame one simulated second. A minimum-seeking cutoff can
       * only resolve to a frame, so the overshoot is one frame of delta-v —
       * 9 m/s on an S-IVB and 52 m/s on an SLS core, the latter worth 170 km of
       * apoapsis. Measured: Apollo circularised to 186 x 232 km and Artemis to
       * 202 x 355, both with the perigee spot on and the apoapsis thrown out by
       * the burn that was supposed to be closing it.
       *
       * LOI_BURN already drops to real time here and says why; this was simply
       * the one that did not.
       */
      mission.warpRequest = WARP.x1
    },
    control: aimPrograde,
    /**
     * Cut off at the eccentricity *minimum*, not at a fixed target.
     *
     * A prograde burn at apoapsis drives eccentricity down, through a minimum,
     * and back up again as the burn continues past the optimum. Watching for
     * the turn is self-correcting: it lands on the roundest orbit the vehicle
     * can actually reach, whether or not the tolerance was ever achievable, and
     * it cannot overshoot into a worse orbit than it started with.
     */
    done() {
      const e = live.elements.eccentricity
      if (ship.thrust === 0) return true // tanks dry
      if (e < PROFILE.circularTolerance) return true
      if (e < mission.bestEccentricity) {
        mission.bestEccentricity = e
        return false
      }
      return e > mission.bestEccentricity + PROFILE.eccNoiseFloor
    },
    next: () => INDEX_OF.COAST,
  },
  {
    id: 'COAST',
    label: 'On orbit',
    enter() {
      ship.throttle = 0
      mission.warpRequest = null // hand time control back to the pilot
      // Release the ascent plane lock. It exists to hold the launch azimuth;
      // left engaged it would project the out-of-plane component straight out
      // of a mid-course correction, which is where most of that burn lives.
      mission.planeLocked = false
    },
    control() {
      aimPrograde()
      updateTLI() // keep the window solution live for the HUD
    },
    done: () => false,
  },
  {
    id: 'TLI_ALIGN',
    label: 'Awaiting TLI window',
    enter() {
      ship.throttle = 0
      /**
       * Entered at commitment and again every time a planned burn hands back.
       * A raise burn of the plan's own changes nothing about the plan; any other
       * burn was the pilot's, and the orbit the plan was built around has gone.
       */
      const lo = mission.tli.loiter
      const flown = mission.node.lastFlownId
      mission.node.lastFlownId = -1
      if (!lo.planned) planLoiter()
      else if (flown < 0) return
      else if (flown !== lo.node1 && flown !== lo.node2) replanLoiter()
      else if (flown === (lo.node2 >= 0 ? lo.node2 : lo.node1)) verifyLoiter()
    },
    control() {
      // Thrust here is the pilot's by hand — the flight computer does not burn in
      // this phase — so replan once they let go.
      const lo = mission.tli.loiter
      if (ship.thrust > 0) lo.manual = true
      else if (lo.manual) {
        lo.manual = false
        replanLoiter()
      }
      aimPrograde()
      const tli = updateTLI()
      /**
       * Steered by how far the *Moon* is from the plane, not by the alignment.
       *
       * The alignment closes and reopens twice an orbit as apoapsis sweeps the
       * plane, so a ladder reading its rate of closure sees a window arriving
       * every few minutes and holds real time indefinitely: measured, every
       * site spent essentially every frame at 1x and bought four simulated
       * seconds for each one, taking half a million frames to reach a window
       * nine days out. The Moon's distance from the plane moves on the
       * timescale the window actually lives on, and no window can open while it
       * is large however the craft is pointed.
       */
      const out = Math.abs(tli.outOfPlane)
      mission.warpRequest =
        out > TLI_PLANE_COARSE
          ? WARP.h6
          : out > TLI_PLANE_FINE
            ? WARP.h1
            : tli.alignment > PROFILE.phaseTolerance * 8
              ? WARP.m1
              : WARP.x1
    },
    done: () => mission.tli.alignment <= PROFILE.phaseTolerance && !holdingForRaise(),
    next: () => INDEX_OF.TLI_BURN,
  },
  {
    id: 'TLI_BURN',
    label: 'TLI burn',
    enter() {
      // A raise still waiting to fly when the window arrives was planned against
      // a later window — a pass the forecast would not count on, then caught.
      // Left in the plan it would preempt the injection mid-burn.
      withdrawLoiterBurns()
      ship.throttle = 1
      mission.warpRequest = WARP.m1
      mission.tli.burnStart = mission.t
    },
    control() {
      aimPrograde()
      updateTLI()
    },
    /**
     * Cut off when the predicted apoapsis reaches the Moon's radius.
     *
     * Predicted, not achieved: apoapsisRadius comes from the osculating
     * elements, so it answers "where would this trajectory take me if I stopped
     * now" — which is exactly the cutoff condition. An escape trajectory
     * reports Infinity and therefore also trips it, so an overshoot cannot run
     * the tanks dry.
     */
    done() {
      if (ship.thrust === 0) return true
      loadGeocentric()
      return live.elements.apoapsisRadius >= _rm.length()
    },
    next: () => INDEX_OF.TRANS_LUNAR,
  },
  {
    id: 'TRANS_LUNAR',
    label: 'Trans-lunar coast',
    enter() {
      ship.throttle = 0
      mission.tli.burnDuration = mission.t - mission.tli.burnStart
      mission.tli.burnEnd = mission.t
    },
    control() {
      aimPrograde()
      updateTLI()
      const togo = PROFILE.mccDelay - (mission.t - mission.tli.burnEnd)
      mission.warpRequest = togo > 7200 ? WARP.h6 : togo > 1800 ? WARP.h1 : WARP.m1
    },
    done: () => mission.t - mission.tli.burnEnd >= PROFILE.mccDelay,
    next: () => INDEX_OF.MCC_SOLVE,
  },
  {
    id: 'MCC_SOLVE',
    label: 'MCC targeting',
    /**
     * Solve for the correction, once.
     *
     * There is no closed form for "what lunar altitude does this trajectory
     * reach" in an n-body field, so the objective is evaluated by flying the
     * trajectory in a scratch integrator. That costs several dozen projections
     * — tens of milliseconds — and is deliberately a one-off on entry rather
     * than anything the render loop repeats.
     */
    enter() {
      ship.throttle = 0
      mission.warpRequest = WARP.x1

      const sol = solveMidCourse(PROFILE.lunarPeriapsis)
      const mcc = mission.mcc
      mcc.solved = true
      mcc.converged = sol.converged
      mcc.magnitude = sol.magnitude
      mcc.lvlh.prograde = sol.lvlh.prograde
      mcc.lvlh.normal = sol.lvlh.normal
      mcc.lvlh.radial = sol.lvlh.radial
      mcc.predicted = sol.approach
      mcc.iterations = sol.history.length - 1

      if (sol.magnitude > 1e-6) {
        mcc.direction.set(sol.world[0], sol.world[1], sol.world[2]).normalize()
      }

      // Cutoff by mass rather than by a stopwatch: the rocket equation gives
      // the exact burnout mass for a given impulse, so the delivered delta-v is
      // right regardless of how the throttle behaved on the way there.
      const stage = activeStage()
      mcc.targetMass = stage
        ? totalMass() * Math.exp(-sol.magnitude / (stage.isp * G0))
        : totalMass()
    },
    control() {
      if (mission.mcc.solved) aimThrust(mission.mcc.direction)
    },
    /**
     * Hold until the craft is actually pointing where the solution says.
     *
     * The correction is a ~15 second burn and the autopilot slews at 0.15 rad/s,
     * so a fixed one-second pause meant igniting mid-rotation and spraying the
     * impulse across a wide arc of directions — the solve was right and the
     * delivery was not. The timeout is a backstop, not the normal path.
     */
    done: () =>
      mission.mcc.solved &&
      (ship.forward.angleTo(mission.mcc.direction) < 0.005 || mission.phaseT > 120),
    next: () => (mission.mcc.converged ? INDEX_OF.MCC_BURN : INDEX_OF.LUNAR_APPROACH),
  },
  {
    id: 'MCC_BURN',
    label: 'MCC burn',
    enter() {
      mission.warpRequest = WARP.x1
      ship.throttle = 1
    },
    control() {
      aimThrust(mission.mcc.direction)
    },
    done: () => totalMass() <= mission.mcc.targetMass || ship.thrust === 0,
    next: () => INDEX_OF.LUNAR_APPROACH,
  },
  {
    id: 'LUNAR_APPROACH',
    label: 'Lunar approach',
    enter() {
      ship.throttle = 0
    },
    control() {
      // Coast attitude is nose-along-velocity about the Moon, the same
      // local-horizontal pose an uncontrolled craft flies. The flip to
      // retrograde is deliberately left to the alignment phase, so the gate
      // there has a real 180-degree slew to converge — not a formality.
      aimLunarPrograde()
      updateLOI()

      // Warp ladder on the time left, exactly as the apoapsis coast does. It
      // only engages inside the sphere of influence: outside it the Moon is not
      // the dominant attractor and the selenocentric conic — periapsis time
      // included — describes no trajectory the craft is actually on.
      if (!live.insideLunarSOI) {
        mission.warpRequest = null
        return
      }
      const togo = live.lunar.timeToPeriapsis - loiIgnitionLead()
      mission.warpRequest = togo > 7200 ? WARP.h1 : togo > 900 ? WARP.m1 : WARP.x1
    },
    /**
     * Hand over once periapsis is within a burn-lead plus a slew margin.
     *
     * Gated on being inside the sphere of influence. Outside it the osculating
     * selenocentric elements are a fiction: on this trajectory they reported a
     * 187,000 km lunar periapsis while the craft was still 286,000 km out, and
     * a sequencer reading that would arm the capture burn three days early.
     */
    done() {
      // A planned halo capture takes the approach over, because its first burn
      // is at periselene too and LOI_ALIGN would spend the same minutes turning
      // retrograde to fly the other capture entirely.
      if (mission.capture.planned) return 'HALO_CAPTURE'
      return (
        live.insideLunarSOI &&
        live.lunar.timeToPeriapsis > 0 &&
        live.lunar.timeToPeriapsis <= loiIgnitionLead() + PROFILE.loiAlignMargin
      )
    },
    next: () => INDEX_OF.LOI_ALIGN,
  },
  {
    id: 'LOI_ALIGN',
    label: 'LOI attitude',
    enter() {
      ship.throttle = 0
      mission.warpRequest = WARP.x1 // real time from here to cutoff
      mission.loi.pointingError = Math.PI
    },
    control() {
      aimLunarRetrograde()
      updateLOI()
    },
    /**
     * Ignite when the clock reaches the lead point *and* the attitude has
     * converged.
     *
     * Two conditions, in that order, and both are needed. The mid-course
     * correction proved the second one: a fixed pause let the engine light
     * mid-slew and sprayed a correct solution across a wide arc of directions.
     * This burn starts with a near-180-degree flip out of the coast attitude,
     * so there is more to get wrong, not less.
     *
     * The backstop runs the other way from the correction's. There the risk was
     * igniting too early; here it is not igniting at all, because periapsis
     * arrives whether or not the vehicle is ready. So the timeout fires a full
     * margin *past* the lead point: a slightly mis-pointed capture still beats
     * a clean flypast.
     */
    done() {
      const lead = loiIgnitionLead()
      const togo = live.lunar.timeToPeriapsis - lead
      if (togo > 0) return false
      return (
        mission.loi.pointingError < PROFILE.loiPointTolerance ||
        togo <= -PROFILE.loiAlignMargin
      )
    },
    next: () => INDEX_OF.LOI_BURN,
  },
  {
    id: 'LOI_BURN',
    label: 'LOI burn',
    enter() {
      mission.warpRequest = WARP.x1
      ship.throttle = 1
      const loi = mission.loi
      loi.bestEccentricity = Infinity
      loi.burnStart = mission.t
      loi.startMass = totalMass()
      loi.deltaVDelivered = 0
      loi.minRadius = Infinity
      loi.cutoff = ''
      loi.ignited = true
    },
    control() {
      // Retrograde is re-read every frame, not frozen at ignition. The velocity
      // vector turns about 7.6 degrees across this burn — small, but the
      // autopilot tracks it for free at 0.15 rad/s against the 0.0013 rad/s the
      // target actually moves, so there is no reason to accept the error.
      aimLunarRetrograde()

      const loi = mission.loi
      // Ideal delta-v actually applied, integrated from the acceleration the
      // propulsion model reported last frame.
      loi.deltaVDelivered += (ship.thrust / ship.mass) * live.simDtLastFrame
      if (live.lunar.radius < loi.minRadius) loi.minRadius = live.lunar.radius
    },
    /**
     * Closed-loop cutoff: the eccentricity minimum of the *achieved*
     * selenocentric orbit.
     *
     * A precomputed burn time or burnout mass cannot hold here. Both are open
     * loop — they say how much impulse to spend, not what orbit resulted — and
     * an 800 m/s burn magnifies every error a 74 m/s correction could absorb:
     * mass-flow drift, the finite arc the vehicle sweeps while thrusting, the
     * gravity loss that arc costs, and any residual pointing error. Reading the
     * orbit instead makes all of them self-correcting, because whatever they did
     * is already in the state the criterion is computed from.
     *
     * The minimum is the right extremum to watch. A retrograde burn at
     * periapsis drives eccentricity down through zero and back up: while
     * v > v_circ the burn point is still periapsis and apoapsis is falling
     * toward it, and past v_circ the burn point becomes *apoapsis* and periapsis
     * starts dropping on the far side. So the turn is not merely the roundest
     * orbit reachable — it is the exact moment continuing would begin digging
     * periapsis into the Moon. Watching for it cannot overshoot into a worse
     * orbit than it has already achieved.
     */
    done() {
      const loi = mission.loi
      if (ship.thrust === 0) {
        loi.cutoff = 'propellant depleted'
        return true
      }
      // Backstop, not the normal path — see the note on loiSafeAltitude.
      if (live.lunar.periapsisRadius < BODIES.moon.radius + PROFILE.loiSafeAltitude) {
        loi.cutoff = 'periapsis floor'
        return true
      }
      const e = live.lunar.eccentricity
      if (e < loi.bestEccentricity) {
        loi.bestEccentricity = e
        return false
      }
      if (e > loi.bestEccentricity + PROFILE.loiEccNoiseFloor) {
        loi.cutoff = 'eccentricity minimum'
        return true
      }
      return false
    },
    next: () => INDEX_OF.LUNAR_ORBIT,
  },
  {
    id: 'LUNAR_ORBIT',
    label: 'Lunar orbit',
    enter() {
      ship.throttle = 0
      mission.warpRequest = null // hand time control back to the pilot
      mission.loi.burnDuration = mission.t - mission.loi.burnStart
    },
    control() {
      aimLunarPrograde()
      if (live.lunar.radius < mission.loi.minRadius) mission.loi.minRadius = live.lunar.radius
      updateTEI()
      mission.warpRequest = WARP.m1
    },
    /**
     * Depart after one full revolution.
     *
     * A dwell rather than an immediate turnaround, so the achieved orbit is
     * actually flown and measured before it is left — the capture's cutoff
     * asserts an orbit from osculating elements, and a revolution is what makes
     * that an observation.
     */
    done: () => mission.phaseT >= PROFILE.lunarDwell,
    next: () => INDEX_OF.TEI_ALIGN,
  },
  {
    id: 'TEI_ALIGN',
    label: 'TEI attitude',
    enter() {
      ship.throttle = 0
      mission.tei.pointingError = Math.PI
    },
    control() {
      aimLunarProgradeGated()
      const tei = updateTEI()
      const togo = tei.timeToWindow - teiIgnitionLead()
      mission.warpRequest = togo > 1800 ? WARP.m1 : WARP.x1
    },
    /**
     * Ignite at the departure point, with the attitude converged.
     *
     * The same two conditions as the capture and in the same order, but the
     * slew here is nearly nothing: the coast attitude in lunar orbit is already
     * along the selenocentric velocity, which is exactly where a prograde
     * departure burn points. The gate is kept anyway — it costs one comparison
     * and it is the difference between assuming the attitude is right and
     * knowing it. The backstop still fires a margin past the point, because the
     * departure window comes round once per revolution and missing it costs an
     * orbit.
     */
    done() {
      // Wait for the departure point. `timeToWindow` counts down to it and then
      // wraps to a full revolution, so "arrived" is the sign change and nothing
      // else — an earlier version fell through to the pointing test whenever the
      // window was more than half an orbit off, and since the coast attitude in
      // lunar orbit *is* prograde that test was already satisfied. The burn lit
      // on the frame it entered, departed 100 degrees from the right point, and
      // left on an Earth-escape hyperbola at 1.65 km/s.
      const togo = mission.tei.timeToWindow - teiIgnitionLead()
      if (togo > 0) return false
      return (
        mission.tei.pointingError < PROFILE.teiPointTolerance ||
        togo <= -PROFILE.teiAlignMargin
      )
    },
    next: () => INDEX_OF.TEI_BURN,
  },
  {
    id: 'TEI_BURN',
    label: 'TEI burn',
    enter() {
      mission.warpRequest = WARP.x1
      const tei = mission.tei
      tei.burnStart = mission.t
      tei.startMass = totalMass()
      tei.deltaVDelivered = 0
      tei.cutoff = ''
      tei.ignited = true
      // Solve for the cutoff energy *here*, where the live state is the
      // ignition point — one shot, on entry, never in the loop.
      solveTEICutoff()
      ship.throttle = 1
    },
    control() {
      aimLunarProgradeGated()
      const tei = mission.tei
      tei.deltaVDelivered += (ship.thrust / ship.mass) * live.simDtLastFrame
      tei.c3 = selenocentricC3()
    },
    /**
     * Closed-loop cutoff on the achieved selenocentric characteristic energy.
     *
     *     C3 = v^2 - 2 mu_moon / r
     *
     * A threshold rather than a turning point, and that is the right shape here
     * because the objective genuinely is a target value: the departure needs
     * one specific hyperbolic excess speed, not the extremum of anything. C3 is
     * negative while bound and rises monotonically through a prograde burn, so
     * there is no branch to get wrong and no minimum to overshoot.
     *
     * What makes it closed-loop is the same thing that made the capture's
     * eccentricity minimum closed-loop: it is computed from the state the
     * vehicle actually reached, so mass-flow drift, the 21 degrees of arc the
     * burn sweeps, its gravity loss and any residual pointing error are all
     * already in the number being tested. A burn time or a burnout mass would
     * be open loop and would carry every one of them straight through.
     */
    done() {
      const tei = mission.tei
      if (ship.thrust === 0) {
        tei.cutoff = 'propellant depleted'
        return true
      }
      if (tei.c3Target > 0 && tei.c3 >= tei.c3Target) {
        tei.cutoff = 'C3 target'
        return true
      }
      return false
    },
    next: () => INDEX_OF.TRANS_EARTH,
  },
  {
    id: 'TRANS_EARTH',
    label: 'Trans-Earth coast',
    enter() {
      ship.throttle = 0
      if (mission.tei.ignited && !mission.tei.burnEnd) {
        mission.tei.burnEnd = mission.t
        mission.tei.burnDuration = mission.t - mission.tei.burnStart
      }
    },
    control() {
      aimPrograde()
      // The coast is flown twice — out to the correction, then on to entry —
      // so the ladder keys off whichever leg is running.
      if (!mission.ei.solved) {
        const togo = PROFILE.eiDelay - (mission.t - mission.tei.burnEnd)
        mission.warpRequest = togo > 7200 ? WARP.h6 : togo > 1800 ? WARP.h1 : WARP.m1
      } else {
        const alt = live.elements.altitude
        mission.warpRequest = alt > 2e8 ? WARP.h6 : alt > 2e7 ? WARP.h1 : alt > 1e6 ? WARP.m1 : WARP.x1
      }
    },
    /**
     * Two legs, one phase, and the successor says which.
     *
     * It is the same trans-Earth coast either side of the correction, so giving
     * it two phase ids would be describing the vehicle's schedule rather than
     * its trajectory. The branch is explicit in `next()`, which is what the
     * named-successor rule exists for.
     */
    done() {
      if (!mission.ei.solved) return mission.t - mission.tei.burnEnd >= PROFILE.eiDelay
      return live.elements.altitude <= PROFILE.smSepAltitude && live.elements.vertical < 0
    },
    next: () => (mission.ei.solved ? INDEX_OF.SM_SEP : INDEX_OF.EI_SOLVE),
  },
  {
    id: 'EI_SOLVE',
    label: 'Corridor targeting',
    /**
     * Solve for the correction that puts geocentric perigee in the corridor.
     *
     * The same Gauss-Newton machinery as the outbound correction, against a
     * different objective — minimum-norm through the pseudo-inverse, then a
     * null-space descent to walk off what a wandering path accumulates. It has
     * to exist: perigee moves 68.9 km per m/s of transverse velocity at lunar
     * distance, so the corridor demands the departure to a precision no
     * seven-minute burn can hold, and this is where that precision is bought.
     */
    enter() {
      ship.throttle = 0
      mission.warpRequest = WARP.x1
      const ei = mission.ei
      ei.before = projectPerigee(0, 0, 0)

      const sol = solveReturnCorridor(BODIES.earth.radius + PROFILE.entryPerigee)
      ei.solved = true
      ei.converged = sol.converged && sol.magnitude <= PROFILE.eiMaxDeltaV
      ei.rejected = sol.converged && sol.magnitude > PROFILE.eiMaxDeltaV
      ei.magnitude = sol.magnitude
      ei.lvlh.prograde = sol.lvlh.prograde
      ei.lvlh.normal = sol.lvlh.normal
      ei.lvlh.radial = sol.lvlh.radial
      ei.predicted = sol.approach
      ei.iterations = sol.history.length - 1
      if (sol.magnitude > 1e-6) {
        ei.direction.set(sol.world[0], sol.world[1], sol.world[2]).normalize()
      }
      const stage = activeStage()
      ei.targetMass = stage
        ? totalMass() * Math.exp(-sol.magnitude / (stage.isp * G0))
        : totalMass()
    },
    control() {
      if (mission.ei.magnitude > 1e-6) {
        aimThrust(mission.ei.direction)
        mission.ei.pointingError = ship.forward.angleTo(mission.ei.direction)
      }
    },
    done: () =>
      mission.ei.magnitude <= 1e-6 ||
      mission.ei.pointingError < PROFILE.eiPointTolerance ||
      mission.phaseT > 120,
    next: () =>
      mission.ei.converged && mission.ei.magnitude > 1e-6
        ? INDEX_OF.EI_BURN
        : INDEX_OF.TRANS_EARTH,
  },
  {
    id: 'EI_BURN',
    label: 'Corridor trim',
    enter() {
      mission.warpRequest = WARP.x1
      ship.throttle = 1
    },
    control() {
      aimThrust(mission.ei.direction)
      mission.ei.pointingError = ship.forward.angleTo(mission.ei.direction)
    },
    // Small and near-impulsive, so burnout mass is honest here in a way it
    // would not be for the departure: at a few m/s there is no arc to speak of.
    done: () => totalMass() <= mission.ei.targetMass || ship.thrust === 0,
    next: () => INDEX_OF.TRANS_EARTH,
  },
  {
    id: 'SM_SEP',
    label: 'SM separation',
    /**
     * Discard everything above the capsule, leaving the entry vehicle.
     *
     * A loop, not a single call, and the difference is not cosmetic. This used
     * to separate exactly once, which quietly assumed the vehicle had reached
     * the service module by now — true only because the ascent used to be
     * wasteful enough to strand the upper stage empty. With the closed loop
     * flying an efficient ascent, Artemis arrived here still carrying an ICPS
     * with 1.6 tonnes aboard, so the one separation dropped *that* and the
     * capsule re-entered with a service module still attached: 14.8 t at a
     * ballistic coefficient of 336 instead of 3.9 t at 420. It survived, which
     * is the worst kind of wrong.
     *
     * `separate()` returns false on the last stage, so this drops down to it
     * whatever is above — the entry vehicle is identified as the stage that
     * comes home, not as a position in a list, which is what sim/vessels.js
     * asserts at load.
     *
     * The separation is *commanded* here rather than falling out of propellant
     * depletion, so the staging interrupt is acknowledged on the spot: there is
     * nothing to preempt and nothing to resume — this phase is the event.
     */
    enter() {
      ship.throttle = 0
      mission.warpRequest = WARP.x1
      while (separate());
      mission.lastSeparations = ship.separations
      mission.entry.interfaceSpeed = live.elements.speed
      mission.entry.interfaceTime = mission.t

      /**
       * Freeze the entry plane here, at separation, and measure cross-range
       * against it for the rest of the descent. It has to be captured once
       * rather than recomputed: the whole point of a bank reversal is to
       * correct drift away from the plane the vehicle arrived on, and a normal
       * recomputed each frame would follow the drift instead of resisting it.
       */
      const st = live.sim.state
      const o = INDEX.ship * 6
      const e = INDEX.earth * 6
      _sr.set(st[o] - st[e], st[o + 1] - st[e + 1], st[o + 2] - st[e + 2])
      _sv.set(st[o + 3] - st[e + 3], st[o + 4] - st[e + 4], st[o + 5] - st[e + 5])
      _entryNormal.crossVectors(_sr, _sv).normalize()
      _bankSign.value = 1
      mission.entry.bankReversals = 0
      mission.entry.lastReversal = mission.t
      mission.entry.peakCrossRange = 0
      ship.bankAngle = 0
      ship.bankCommand = 0
    },
    control: aimEntryAttitude,
    done: () => mission.phaseT > 2,
    next: () => INDEX_OF.RE_ENTRY,
  },
  {
    id: 'RE_ENTRY',
    label: 'Re-entry',
    landing: true,
    enter() {
      ship.throttle = 0
      mission.warpRequest = PROFILE.entryWarp
    },
    control() {
      updateEntryGuidance()
      aimEntryAttitude()
      trackEntryPeaks()
    },
    done: () =>
      live.elements.altitude <= SHIP.chutes.drogue.altitude &&
      live.mach < SHIP.chutes.drogue.mach,
    next: () => INDEX_OF.DROGUE,
  },
  {
    id: 'DROGUE',
    label: 'Drogues',
    landing: true,
    enter() {
      ship.chuteTarget = SHIP.chutes.drogue.cdA
      ship.chuteTau = SHIP.chutes.drogue.tau
      mission.entry.drogueAltitude = live.elements.altitude
      mission.warpRequest = PROFILE.entryWarp
    },
    control() {
      aimEntryAttitude()
      trackEntryPeaks()
    },
    done: () => live.elements.altitude <= SHIP.chutes.main.altitude,
    next: () => INDEX_OF.MAIN_CHUTES,
  },
  {
    id: 'MAIN_CHUTES',
    label: 'Main chutes',
    landing: true,
    enter() {
      ship.chuteTarget = SHIP.chutes.main.cdA
      ship.chuteTau = SHIP.chutes.main.tau
      mission.entry.mainAltitude = live.elements.altitude
      mission.warpRequest = WARP.m1
    },
    control() {
      aimEntryAttitude()
      trackEntryPeaks()
    },
    done: () => live.elements.altitude <= 0,
    next: () => INDEX_OF.SPLASHDOWN,
  },
  {
    id: 'SPLASHDOWN',
    label: 'Splashdown',
    splashed: true,
    enter() {
      ship.throttle = 0
      mission.warpRequest = WARP.x1
      mission.entry.splashdownSpeed = live.elements.speed
      mission.entry.splashdownTime = mission.t
      // The descent rate is what matters, and it is the vertical component:
      // horizontal motion at splashdown is the ocean moving with the planet.
      mission.entry.splashdownVertical = Math.abs(live.elements.vertical)
    },
    control: aimEntryAttitude,
    done: () => false,
  },

  /* ---------------------------------------------------------------- *
   * Halo-orbit maintenance — a cycle, not a step
   * ---------------------------------------------------------------- */
  {
    /**
     * Orient for a planned burn.
     *
     * An interrupt like STAGING, not a step in the script: a node can fall in
     * any coast, so the sequencer preempts whatever is running, flies the
     * manoeuvre, and resumes. That is what turns this from a director following
     * a storyboard into a flight computer executing what it is handed.
     */
    id: 'NODE_ALIGN',
    label: 'Node attitude',
    enter() {
      ship.throttle = 0
      mission.warpRequest = WARP.x1
      mission.node.delivered = 0
      solveNodeBurn(mission.node.active)
    },
    control() {
      const node = mission.node.active
      if (!node) return aimPrograde()
      // Solved once, against the node's instant. Solved again only if the pilot
      // edits the node while the vehicle is turning toward it.
      if (nodeRevision() !== mission.node.revision) solveNodeBurn(node)
      if (mission.node.direction.lengthSq() === 0) return
      mission.node.pointingError = ship.forward.angleTo(mission.node.direction)
      aimThrust(mission.node.direction)
    },
    done() {
      const node = mission.node.active
      if (!node || !(mission.node.target > 0)) return true
      const lead = burnTimeFor(mission.node.target) * 0.5
      const togo = node.t - live.sim.t - lead
      const pointed = mission.node.pointingError <= PROFILE.nodePointTolerance
      // Ignite when the clock arrives and the vehicle is pointed, or when the
      // clock has run a full margin past it regardless.
      return (togo <= 0 && pointed) || togo <= -PROFILE.nodeAlignMargin
    },
    next: () => INDEX_OF.NODE_BURN,
  },
  {
    id: 'NODE_BURN',
    label: 'Planned burn',
    enter() {
      ship.throttle = 1
      mission.warpRequest = WARP.x1
      mission.node.burnStart = mission.t
      mission.node.delivered = 0
      // The direction was solved at the node's instant while aligning, and is
      // held from here: re-resolving it now would measure the frame half a burn
      // early, which is exactly the error solveNodeBurn exists to remove.
    },
    control() {
      if (mission.node.direction.lengthSq() > 0) aimThrust(mission.node.direction)
      mission.node.delivered += (ship.thrust / ship.mass) * live.simDtLastFrame
    },
    /**
     * Cut off on delivered delta-v, integrated from the acceleration actually
     * applied rather than from the clock. A burn that stages partway through
     * changes both thrust and mass, and a stopwatch started at ignition would
     * be wrong from that moment on.
     */
    done: () => mission.node.delivered >= mission.node.target || ship.thrust === 0,
    exit() {
      ship.throttle = 0
      const node = mission.node.active
      if (node) {
        node.executed = true
        mission.node.lastFlownId = node.id
        // The plan has changed even though nothing in the UI touched it: the
        // node stops being a plan the moment it is flown, and the editor has to
        // hear about that from here or it will keep offering handles for a burn
        // that already happened.
        nodesChanged()
      }
      mission.node.active = null
      mission.warpRequest = null // hand time control back to the pilot
    },
    next: () => mission.resumeIndex,
  },
  {
    id: 'HALO_CAPTURE',
    label: 'Halo capture',
    /**
     * The coast the capture's burns fall in.
     *
     * The burns are nodes, flown by `NODE_ALIGN` and `NODE_BURN` like any other
     * planned manoeuvre. Those already centre a burn on its instant, resolve its
     * direction against the body whose sphere it happens in, cut off on
     * delivered delta-v rather than on a stopwatch, keep the frame's step from
     * carrying the clock past the turn, and draw the burn on the map. Three
     * bespoke phases would be a second copy of all of that, and the first thing
     * to drift out of step with it.
     *
     * What is left for this phase is to wait for them, to solve the last burn
     * against the state the craft actually arrives with rather than the one the
     * search predicted days earlier, and to hand over to the maintenance cycle
     * once it has flown.
     */
    enter() {
      ship.throttle = 0
    },
    control() {
      aimLunarPrograde()
      const cap = mission.capture
      // The correction is planned the moment the burn it corrects has flown,
      // six hours ahead of its own instant. Planning it on a clock instead put
      // it barely ten minutes out, and a frame at 6 h/s — whose step is fixed
      // before the sequencer runs, so the ceiling could not know a node had
      // appeared inside it — stepped straight past it. It was never flown, and
      // the craft arrived 939 km off the reference with the error intact.
      const plane = nodeById(cap.nodes.plane)
      if (!cap.correctionPlanned && plane && plane.executed) planHaloCorrection()
      if (!cap.insertionPlanned && live.sim.t >= cap.arrival - PROFILE.haloInsertionLead) planHaloInsertion()
      const node = pendingNode(live.sim.t)
      const togo = (node ? alignmentStart(node) : cap.arrival) - live.sim.t
      mission.warpRequest = togo > 7200 ? WARP.h6 : togo > 900 ? WARP.h1 : WARP.m1
    },
    /**
     * Done when the insertion has flown, or when its instant has passed without
     * one — which leaves the craft in whatever orbit the first two burns made,
     * and the cycle's own solve to report that it is not on the reference. The
     * alternative is a phase that never completes.
     */
    done() {
      const cap = mission.capture
      if (!cap.insertionPlanned) return false
      const node = nodeById(cap.nodes.insertion)
      if (node && !node.executed) return false
      if (!node && live.sim.t < cap.arrival) return false
      // The cycle counts from here, and its apolune search needs two samples
      // before it can call one.
      beginHaloTracking()
      return 'NRHO_COAST'
    },
  },
  {
    id: 'NRHO_COAST',
    label: 'NRHO coast',
    enter() {
      ship.throttle = 0
      mission.warpRequest = WARP.h6
      // Carry the revolution just finished before starting a fresh extremum
      // search, or the figures read as Infinity/0 to anything that samples them
      // just after a transition — which is exactly when a test would.
      if (Number.isFinite(mission.nrho.perilune)) {
        mission.nrho.lastPerilune = mission.nrho.perilune
        mission.nrho.lastApolune = mission.nrho.apolune
      }
      mission.nrho.perilune = Infinity
      mission.nrho.apolune = 0
    },
    control() {
      aimLunarPrograde()
      trackHalo()
    },
    /**
     * Hand over at **apolune**, not on a clock.
     *
     * That is the control point: the craft is slowest there, so a given impulse
     * buys the most change in the next perilune — the Oberth argument run
     * backwards, since what is wanted is a change of orbit *shape* rather than
     * of energy. Measured, dr_p/dv is about 92 km per m/s at apolune.
     *
     * The interval remains as a floor, so a noisy range reading cannot fire two
     * corrections in quick succession.
     */
    done() {
      const nr = mission.nrho
      if (!nr.atApolune) return false
      return mission.phaseT >= Math.min(PROFILE.nrhoKeepInterval, 86400)
    },
    next: () => INDEX_OF.NRHO_STATION_KEEP,
  },
  {
    id: 'NRHO_STATION_KEEP',
    label: 'NRHO maintenance',
    /**
     * Solve the correction, once, on entry — the established shape for every
     * solver in this sequencer.
     *
     * For the reference's whole state a revolution on, not for perilune radius:
     * held on that one number from the reference's start, the craft was dragged
     * 17,603 km off the orbit for 3.28 m/s a revolution, because the orbit the
     * field flies does not keep a constant perilune (verify-nrho-keeping).
     */
    enter() {
      ship.throttle = 0
      mission.warpRequest = WARP.x1
      const nr = mission.nrho
      nr.lastKeep = mission.t
      nr.solved = false
      nr.converged = false
      nr.deltaV = 0
      nr.miss = 0
      nr.missAfter = 0
      nr.burnt = false
      nr.startMass = totalMass()

      if (!nr.reference) return
      const sol = solveHaloKeeping(nr.reference, live.sim, { lookahead: PROFILE.nrhoLookahead })
      nr.solved = true
      if (sol.before) {
        nr.miss = sol.before.position
        nr.missAfter = sol.after.position
      }
      nr.converged = sol.converged && sol.magnitude <= PROFILE.nrhoMaxDeltaV
      nr.deltaV = sol.magnitude
      if (nr.converged && sol.magnitude > KEEP_DV_RESOLUTION) {
        _ei.set(sol.world[0], sol.world[1], sol.world[2]).normalize()
        mission.ei.direction.copy(_ei)
        const stage = activeStage()
        nr.targetMass = stage
          ? totalMass() * Math.exp(-sol.magnitude / (stage.isp * G0))
          : totalMass()
      }
    },
    control() {
      const nr = mission.nrho
      // Point at the solution if there is one still to fly, otherwise hold the
      // coast attitude. The burn itself is a second or two at most.
      if (nr.converged && nr.deltaV > KEEP_DV_RESOLUTION && !nr.burnt) {
        aimThrust(mission.ei.direction)
        nr.pointingError = ship.forward.angleTo(mission.ei.direction)
        if (nr.pointingError < PROFILE.eiPointTolerance) ship.throttle = 1
      } else {
        aimLunarPrograde()
      }
      trackHalo()
      /**
       * Cut off once, on the commanded throttle.
       *
       * This read `ship.thrust`, which `applyThrust` writes later in the frame,
       * so the frame after a cutoff saw no thrust and skipped it, and the pointing
       * test above opened the throttle again: the engine lit on alternate frames
       * until the hold ran out. No burn had been flown here before the reference
       * law, and its first correction, 2.1e-6 m/s, delivered 166 m/s and put the
       * craft into the Moon.
       */
      if (ship.throttle > 0 && totalMass() <= nr.targetMass) {
        ship.throttle = 0
        nr.burnt = true
        const stage = activeStage()
        if (stage) nr.totalDeltaV += stage.isp * G0 * Math.log(nr.startMass / totalMass())
      }
    },
    /**
     * Return a **routing key** rather than `true`.
     *
     * The pair is a closed cycle, and saying so here rather than in a `next()`
     * that would have to re-derive it is the point of the key. The cycle count
     * is incremented on the way out, so it is the transition being counted and
     * not the number of frames the phase happened to run for.
     *
     * Nothing about this depends on where either phase sits in the array. A
     * routing key names a phase; it never means "the next one along".
     */
    done() {
      const nr = mission.nrho
      // Done when the burn is complete, or when there was nothing to fly, but
      // never before the minimum hold so the event is visible.
      const burning = ship.thrust > 0
      if (burning) return false
      if (mission.phaseT < PROFILE.nrhoKeepDuration) return false
      nr.cycles += 1
      return 'NRHO_COAST'
    },
  },

  /**
   * The vehicle is inside a planet. Nothing else in this list can be true.
   *
   * A terminal phase rather than a flag, because the sequencer's whole contract
   * is that some phase is always running: a flag would have to be consulted by
   * every `control()` and one of them would forget. This one holds, and the
   * `done: () => false` means the run stops here and says where.
   *
   * It exists because the run that did not have it was believed. Vandenberg's
   * parking orbit decayed through the atmosphere on day 11.4 of a 12.8-day wait
   * for a lunar window, and with no check on it the craft kept integrating down
   * to r = 0 and sat at Earth's centre. The sequencer flew on, reached the
   * window at MET 306.6 h, and dutifully ran a translunar injection from the
   * middle of the planet — 5,208 m/s spent to raise apoapsis to 15 km. That was
   * read as "the polar azimuth costs more than the vehicle has", written into
   * this file's documentation as a delta-v finding, and committed. It was the
   * fourth wrong explanation for this pad, and the only one that a two-line
   * altitude check would have caught before it was ever written down.
   */
  {
    id: 'LOST',
    label: 'Vehicle lost',
    /**
     * `landing: true` on the descent phases is what keeps this one from
     * stealing splashdown. `MAIN_CHUTES.done()` fires on `altitude <= 0`, and
     * it reads the same refreshed elements the guard does — so without the
     * flag the guard trips first, every single flight, and the capsule is
     * reported lost one frame before it lands.
     */
    enter() {
      ship.throttle = 0
      mission.warpRequest = WARP.x1
      mission.lost.at = mission.t
      mission.lost.altitude = surfaceAltitude()
      mission.lost.body = live.insideLunarSOI ? 'moon' : 'earth'
    },
    control() {},
    done: () => false,
  },
]

const INDEX_OF = Object.fromEntries(PHASES.map((p, i) => [p.id, i]))

export const PHASE_IDS = PHASES.map((p) => p.id)

/**
 * @param {number} next
 * @param {boolean} resuming  true when returning from a staging interrupt
 *
 * A resumption is not a fresh entry, and `enter()` is where phases initialise
 * the accumulators their cutoffs are built on — the circularisation and capture
 * burns both track an eccentricity *minimum* there. Re-running it on the way
 * back from an interrupt restarts that search from scratch, so a separation
 * occurring after the turn would discard the observation the cutoff is waiting
 * for and let the burn run on past its optimum. It also re-zeroed the mission
 * clock whenever a separation happened during liftoff.
 *
 * Nothing needs restoring on the way back: the interrupt never touches throttle
 * or the warp request, and its `control` delegates to the phase it preempted.
 */
/**
 * Leave one phase and take up another.
 *
 * The machine had only an `enter` hook until now, and phases did their teardown
 * either inline in `done()` or in whatever ran next — workable while every
 * successor was known at the time of writing. A planned burn is not: it resumes
 * whichever coast it interrupted, so it has nowhere to put "and mark the node
 * flown" except on the way out. `exit` is called on the phase being left, and
 * no existing phase defines one, so nothing else changes behaviour.
 */
function setPhase(next, resuming = false) {
  if (next !== mission.index) PHASES[mission.index].exit?.()
  mission.index = next
  mission.phaseT = 0
  if (!resuming) PHASES[next].enter?.()
}

export const currentPhase = () => PHASES[mission.index]
export const isClamped = () => Boolean(PHASES[mission.index].clamped)

/**
 * Release the hold and begin the count.
 *
 * Asking for the powered ceiling here, rather than on entry to the hold, is
 * deliberate. The frame that *releases* the hold must not be carrying a large
 * step — LIFTOFF's enter() opens the throttle inside that frame, whose step was
 * fixed before the sequencer ran, so from the store's 1 day/s default that is
 * 1440 s of full-throttle SLS in one go. But arming it on entry would also pin
 * the *opening* scene to 1 min/s, and the store defaults to 1 day/s precisely so
 * the system is visibly moving when the app loads. Arming it on the count keeps
 * both: watch the planets turn, then get a safe step the moment it matters.
 *
 * It asks for 60x rather than 1x because that is where a burn is pinned anyway,
 * so the ascent is unchanged. The driver clamps the step regardless — that is
 * the structural guarantee; this only stops the situation arising.
 */
/** A node by id, without the closure `find` would allocate on a per-frame path. */
function nodeById(id) {
  for (let i = 0; i < nodes.length; i++) if (nodes[i].id === id) return nodes[i]
  return null
}

const _capP = new Vector3()
const _capN = new Vector3()
const _capO = new Vector3()
const _capDv = new Vector3()
const _capRef = new Float64Array(6)

/**
 * The components a world impulse has in the frame a node is written in, at the
 * state it will be flown from.
 *
 * Against the body whose sphere of influence that state is in, because that is
 * the rule `solveNodeBurn` resolves by — write the node in one frame and have it
 * flown in another and the burn points somewhere else entirely.
 */
function nodeComponents(state, dv) {
  const body = dominantBody({ state }, 'ship')
  if (!nodeBasis(state, INDEX.ship * 6, INDEX[body] * 6, _capP, _capN, _capO)) return null
  _capDv.set(dv[0], dv[1], dv[2])
  return { prograde: _capDv.dot(_capP), normal: _capDv.dot(_capN), radial: _capDv.dot(_capO) }
}

/**
 * Plan a capture onto a halo from the approach the craft is on.
 *
 * Called with a CR3BP family member while the vehicle is still coasting to the
 * Moon; the search costs about 19 s, and the approach it plans from has hours in
 * hand. Measured on Apollo 8's own arrival from Kennedy: 580 m/s, as 191 at
 * periselene, 283 at the transfer's apolune and 105 at the halo's, against the
 * 819 m/s the capture into low lunar orbit spends. See `sim/capture.js` for why
 * it takes three burns rather than one.
 *
 * Only the first two are planned here. The transfer correction and the insertion
 * are solved later, against the states the craft actually has rather than the
 * ones a search days earlier predicted — see `planHaloCorrection` and
 * `planHaloInsertion`.
 */
export function armHaloCapture(member, options = {}) {
  const cap = mission.capture
  const started = Date.now()
  const solution = solveHaloCapture(live.sim, member, options)
  cap.ms = Date.now() - started
  cap.planned = false
  cap.correctionPlanned = false
  cap.insertionPlanned = false
  if (!solution.converged) return solution
  for (let i = 0; i < 2; i++) {
    const burn = solution.burns[i]
    const components = nodeComponents(burn.at, burn.dv)
    if (!components) return { converged: false, reason: 'the node frame is degenerate at a burn', tried: solution.tried }
    cap.nodes[i === 0 ? 'capture' : 'plane'] = addNode(burn.t, components).id
  }
  mission.nrho.reference = solution.reference
  cap.first = solution.burns[0].magnitude
  cap.second = solution.burns[1].magnitude
  cap.third = solution.burns[2].magnitude
  cap.arrival = solution.burns[2].t
  cap.correctionAt = solution.burns[1].t + PROFILE.haloCorrectionDelay
  cap.correction = 0
  cap.total = solution.total
  cap.planned = true
  return solution
}

/**
 * Re-aim the transfer once the plane change has been flown.
 *
 * See `solveHaloCorrection`: the burns are finite and the coast that follows
 * them is long, so the arrival the search solved is not the one the craft is on.
 */
function planHaloCorrection() {
  const cap = mission.capture
  // One attempt, like the insertion: a second would be solved too late to fly.
  cap.correctionPlanned = true
  const reference = mission.nrho.reference
  if (!reference) return
  const solved = solveHaloCorrection(live.sim, reference, cap.correctionAt)
  if (!solved) return
  const magnitude = Math.hypot(solved.dv[0], solved.dv[1], solved.dv[2])
  if (!(magnitude > 0)) return
  const components = nodeComponents(solved.at, solved.dv)
  if (!components) return
  cap.nodes.correction = addNode(cap.correctionAt, components).id
  cap.correction = magnitude
}

/**
 * Plan the burn that puts the craft on the reference at the arrival instant.
 *
 * The search solved this one days ahead, against a trajectory two finite burns
 * had not yet been flown along. This solves it again from what the craft will
 * actually have — the same velocity difference, taken against a coast of
 * minutes — and plans it as a node so the same machinery flies it.
 */
function planHaloInsertion() {
  const cap = mission.capture
  // One attempt: a second would be planned too late to turn toward.
  cap.insertionPlanned = true
  const reference = mission.nrho.reference
  if (!reference || !referenceStateAt(reference, cap.arrival, _capRef)) return
  const at = coastToNode(cap.arrival)
  const o = INDEX.ship * 6
  const m = INDEX.moon * 6
  _capDv.set(
    _capRef[3] - (at.state[o + 3] - at.state[m + 3]),
    _capRef[4] - (at.state[o + 4] - at.state[m + 4]),
    _capRef[5] - (at.state[o + 5] - at.state[m + 5]),
  )
  const magnitude = _capDv.length()
  if (!(magnitude > 0)) return
  const components = nodeComponents(at.state, [_capDv.x, _capDv.y, _capDv.z])
  if (!components) return
  cap.nodes.insertion = addNode(cap.arrival, components).id
  cap.third = magnitude
}

/** Start the maintenance cycle's counters and its apolune search. */
function beginHaloTracking() {
  const nr = mission.nrho
  nr.cycles = 0
  nr.totalDeltaV = 0
  nr.prevRange = live.lunarRange
  nr.prevPrevRange = live.lunarRange
  nr.atApolune = false
}

/**
 * Enter the halo-maintenance cycle.
 *
 * The linear mission reaches it through `HALO_CAPTURE`, which arrives on a
 * reference and hands over. Called directly — from a test, or to establish the
 * cycle around a craft placed on an orbit — it takes the reference to hold, and
 * without one the pair still cycles and solves nothing.
 */
export function enterNrhoCycle(reference = null) {
  setPhase(INDEX_OF.NRHO_COAST)
  beginHaloTracking()
  mission.nrho.reference = reference
  return true
}

export function beginCountdown() {
  mission.running = true
  mission.warpRequest = WARP.m1
}

export function resetMission() {
  // Picked up here rather than held from module load, so changing the pad and
  // resetting is all it takes to fly from somewhere else.
  mission.site = activeSite()
  mission.index = 0
  mission.resumeIndex = 0
  mission.t = -PROFILE.countdown
  mission.phaseT = 0
  mission.countdown = PROFILE.countdown
  mission.lastSeparations = ship.separations
  mission.running = false
  mission.planeLocked = false
  // Left to the pilot until the count starts — see beginCountdown().
  mission.warpRequest = null
  mission.bestEccentricity = Infinity
  mission.tei.solved = false
  mission.tei.ignited = false
  mission.tei.burnEnd = 0
  mission.tei.c3Target = 0
  mission.tei.cutoff = ''
  mission.ei.solved = false
  mission.ei.converged = false
  mission.ei.magnitude = 0
  // Tied to absolute epochs, like the flight plan.
  mission.nrho.reference = null
  mission.capture.planned = false
  mission.capture.correctionPlanned = false
  mission.capture.insertionPlanned = false
  mission.entry.peakG = 0
  mission.entry.peakQ = 0
  mission.entry.peakHeatFlux = 0
  mission.entry.peakRadFlux = 0
  mission.entry.peakTotalFlux = 0
  mission.entry.splashdownSpeed = 0
  mission.resumeDone = false
  mission.loi.bestEccentricity = Infinity
  mission.loi.minRadius = Infinity
  mission.loi.ignited = false
  mission.loi.cutoff = ''
  mission.lost.at = 0
  mission.lost.altitude = 0
  mission.lost.body = ''
  mission.tli.committed = false
  resetLoiter()
  /**
   * A reset discards the flight plan.
   *
   * Node times are absolute simulated seconds and a reset puts the clock back
   * to the epoch, so a plan carried across one is not stale — it is a set of
   * burns scheduled into the *next* flight. Choosing a new pad or restarting
   * used to leave them in place, where a warped coast usually stepped over them
   * unnoticed. Once burns stopped being stepped over, a 3,000 m/s node left
   * behind by one section of verify-horizon lit in the next section's parking
   * orbit and sent the vehicle 5.5 million km out.
   */
  clearNodes()
  PHASES[0].enter()
}

/**
 * One frame of sequencing. Called before attitude and thrust are consumed.
 */
/**
 * @param {number} dt     wall-clock seconds — the pre-launch hold only
 * @param {number} simDt  simulated seconds — everything in flight
 *
 * The distinction matters the moment time warp is involved. Flight timing has
 * to advance with the *simulation*, or at 60x the vehicle experiences a minute
 * of trajectory for every second the sequencer believes has passed.
 */
/**
 * Height above the surface of whichever body the craft is actually near, m.
 *
 * `live.elements` is geocentric and `live.lunar` selenocentric, and only one of
 * them means anything at a time — a craft in lunar orbit is 400,000 km up by
 * the first and 100 km up by the second. `insideLunarSOI` is the same test the
 * rest of the sequencer uses to decide which conic to believe.
 */
function surfaceAltitude() {
  return live.insideLunarSOI ? live.lunar.altitude : live.elements.altitude
}

/**
 * Is the vehicle somewhere a vehicle can be?
 *
 * Two phases legitimately sit at or below zero: a clamped stack on the pad
 * reads exactly 0, and a capsule in the water is done. Everything else in the
 * list is flight, and flight below the surface is not a manoeuvre the sequencer
 * should keep steering — it is the run having already failed somewhere earlier.
 */
function belowSurface() {
  const phase = PHASES[mission.index]
  if (phase.splashed || phase.clamped || phase.landing || phase.id === 'LOST') return false
  return surfaceAltitude() < 0
}

/**
 * The planned node the running phase would hand over to, or null.
 *
 * One definition for the preemption and for the step ceiling, and it has to be
 * one: a ceiling that holds time still for a node the preemption will not take
 * is a deadlock. So the phases that cannot be interrupted — a burn already
 * running, a staging event, a lost vehicle, the pad before the count — are
 * excluded here and nowhere else. `LOST` is new to the list: without it a node
 * still in the plan would pull a vehicle out of the planet and fly the burn.
 */
function nodeAhead(now) {
  const id = PHASES[mission.index].id
  if (id === 'NODE_ALIGN' || id === 'NODE_BURN' || id === 'STAGING' || id === 'LOST') return null
  if (mission.index === 0 && !mission.running) return null
  return pendingNode(now)
}

/** When the sequencer turns toward a node: half the burn early, less the slew. */
const alignmentStart = (node) =>
  node.t - burnTimeFor(nodeMagnitude(node)) * 0.5 - PROFILE.nodeAlignMargin

/** How close counts as arrived, s. Stepping by the remaining time can otherwise fall short by less than a unit in the last place forever. */
const NODE_TIME_EPS = 1e-3

/**
 * Longest step this frame may take, s. Written by `updateStepCeiling`, read by
 * the frame loop — a typed slot rather than a return value, for the reason the
 * README gives about doubles crossing calls.
 */
export const stepCeiling = new Float64Array(1)

/**
 * Never step past the burns that reach orbit either.
 *
 * Both end on a test made once a frame: GRAVITY_TURN when apoapsis reaches the
 * parking altitude, CIRCULARISE when eccentricity falls below the circular
 * tolerance. With the engines lit a frame is up to 60 s of flight for each second
 * of wall clock — a full second at 60 Hz, three at 20 — and both quantities race
 * at the end, because near orbital speed each m/s is about 3.4 km of apoapsis or
 * of perigee. Measured at 60x, Artemis's Core stage, held at the 4 g limit and
 * reaching orbital speed at 152 km, had apoapsis rising 20 km/s over its last
 * frame; the check caught it at 200.4 km, 15 km high, where the same flight at 1x
 * cut off at 185.1. Circularising on the same stage at 51.8 m/s^2 raises perigee
 * 174 km/s, so even at the 1x that phase asks for, one frame could carry perigee
 * 2.9 km past its cutoff. Apollo 8, on an S-IVB at 8.9 m/s^2, lost a quarter of a
 * kilometre of apoapsis the same way, and up to half a kilometre of perigee.
 *
 * So the step is held to half the time the cutoff quantity needs to close its
 * remaining gap at the rate it is closing now, and never below the time to close
 * 50 m, so the approach ends and the last step carries apoapsis or perigee at
 * most that far past. The rate comes from the state, not from the last frame —
 * near cutoff it doubles within a second — as the quantity's sensitivity to
 * velocity along the thrust axis times the thrust acceleration: gravity alone
 * leaves osculating elements where they are.
 *
 * Fifty metres is below the tenth of a kilometre parking orbits are quoted to.
 * Flown with both burns stepped at 60x and at 1x, each vessel now reaches the
 * same parking orbit to within 0.06 km, which verify-warp checks.
 */
const CUTOFF_TOLERANCE = 50 // m: of apoapsis in the gravity turn, of perigee when circularising
const DV_PROBE = 0.01 // m/s along the thrust axis
/** Geocentric r and v in 0..5; apoapsis radius, eccentricity and semi-major axis in 6..8. Scratch, per frame. */
const _orb = new Float64Array(9)

/** Fill `_orb[6..8]` from the state in `_orb[0..5]`. Apoapsis is Infinity when the orbit is unbound. */
function orbitInto() {
  const rx = _orb[0]
  const ry = _orb[1]
  const rz = _orb[2]
  const vx = _orb[3]
  const vy = _orb[4]
  const vz = _orb[5]
  const inverseA = 2 / Math.sqrt(rx * rx + ry * ry + rz * rz) - (vx * vx + vy * vy + vz * vz) / MU_EARTH
  if (!(inverseA > 0)) {
    _orb[6] = Infinity
    _orb[7] = 1
    _orb[8] = Infinity
    return
  }
  const a = 1 / inverseA
  const hx = ry * vz - rz * vy
  const hy = rz * vx - rx * vz
  const hz = rx * vy - ry * vx
  const e2 = 1 - (hx * hx + hy * hy + hz * hz) / (MU_EARTH * a)
  const e = Math.sqrt(e2 > 0 ? e2 : 0)
  _orb[6] = a * (1 + e)
  _orb[7] = e
  _orb[8] = a
}

/**
 * Lower `stepCeiling[0]` so this frame cannot carry what a burn cuts off on far
 * past its threshold: apoapsis rising to the parking altitude in the gravity
 * turn, eccentricity falling to the circular tolerance while circularising.
 */
function limitStepToCutoff(circularising) {
  const thrust = ship.thrust
  const mass = ship.mass
  if (!(thrust > 0 && mass > 0)) return
  const st = live.sim.state
  const o = INDEX.ship * 6
  const e = INDEX.earth * 6
  for (let k = 0; k < 6; k++) _orb[k] = st[o + k] - st[e + k]
  orbitInto()
  const value = circularising ? _orb[7] : _orb[6]
  const gap = circularising
    ? value - PROFILE.circularTolerance
    : BODIES.earth.radius + SHIP.parkingOrbit.altitude - value
  if (!(gap > 0)) return
  // Fifty metres of perigee, as eccentricity: a burn at apoapsis holds apoapsis,
  // so perigee moves 2a for each unit of e.
  const tolerance = circularising ? CUTOFF_TOLERANCE / (2 * _orb[8]) : CUTOFF_TOLERANCE
  _orb[3] += ship.forward.x * DV_PROBE
  _orb[4] += ship.forward.y * DV_PROBE
  _orb[5] += ship.forward.z * DV_PROBE
  orbitInto()
  const closing = ((circularising ? value - _orb[7] : _orb[6] - value) / DV_PROBE) * (thrust / mass)
  if (!(closing > 0 && closing < Infinity)) return
  const limit = (gap > 2 * tolerance ? 0.5 * gap : tolerance) / closing
  if (limit < stepCeiling[0]) stepCeiling[0] = limit
}

/** Below this a halo maintenance burn is not flown, and to within it one is cut off, m/s. */
const KEEP_DV_RESOLUTION = 1e-6

/**
 * Lower `stepCeiling[0]` so a halo maintenance burn ends on its own cutoff mass
 * rather than on a frame boundary.
 *
 * Its corrections run from millionths to hundredths of a m/s, and the service
 * module's engine delivers 0.05 m/s in a single 1x frame, so cut at the first
 * frame past its mass every burn was at least that frame. Flown on the reference
 * with its state known exactly, a 2.1e-6 m/s correction delivered 0.0505 m/s,
 * the craft passed its next apolune 11.6 km off, and holding it cost 0.05 m/s a
 * revolution and strayed 15 km: more than 1 km of navigation error costs in
 * verify-nrho-keeping. Each step of a burn is now held to the time left to its
 * cutoff mass, and never below the time to deliver `KEEP_DV_RESOLUTION`, so the
 * last one always reaches it.
 *
 * The frame that lights the engine is decided after this, so a burn not yet lit
 * is limited once it points, on the same test that opens the throttle — nothing
 * moves the attitude between the two.
 */
function limitStepToKeepBurn() {
  const nr = mission.nrho
  if (!(nr.converged && nr.deltaV > KEEP_DV_RESOLUTION) || nr.burnt) return
  const stage = activeStage()
  if (!stage || !(stage.thrust > 0)) return
  if (!(ship.throttle > 0) && !(ship.forward.angleTo(mission.ei.direction) < PROFILE.eiPointTolerance)) return
  const mass = totalMass()
  const togo = ((mass - nr.targetMass) * stage.isp * G0) / stage.thrust
  const least = (KEEP_DV_RESOLUTION * mass) / stage.thrust
  const limit = togo > least ? togo : least
  if (limit < stepCeiling[0]) stepCeiling[0] = limit
}

/**
 * Never step past the moment a planned burn has to start turning.
 *
 * Called by the frame loop *before* the sequencer, while this frame's step can
 * still be shortened for free. The preemption above is checked once a frame,
 * and the window it looks for is `nodeAlignMargin` wide — 60 s. A frame at 6 h/s
 * is 360 s, so a node in a warped coast was caught only when a frame boundary
 * happened to land inside that minute. Measured during TLI_ALIGN: a node
 * planned two hours ahead was skipped outright — the sequencer flew on through
 * injection and the mid-course correction to lunar approach with the burn never
 * made — and one that was caught lit 332 s late, because the frame that entered
 * NODE_ALIGN had already committed to its 360 s step.
 *
 * With this the approach lands on the alignment start, the frame that preempts
 * takes no step at all, and NODE_ALIGN's own request for 1x does the rest. While
 * aligning it also stops the clock at ignition, so a warp dial turned up by hand
 * mid-slew cannot carry the burn past its time; once ignition is due, the phase
 * waits out pointing on its own terms.
 */
export function updateStepCeiling(now) {
  if (PHASES[mission.index].id === 'NODE_ALIGN') {
    const node = mission.node.active
    const togo = node && mission.node.target > 0 ? node.t - burnTimeFor(mission.node.target) * 0.5 - now : 0
    stepCeiling[0] = togo > NODE_TIME_EPS ? togo : Infinity
    return
  }
  const node = nodeAhead(now)
  if (!node) stepCeiling[0] = Infinity
  else {
    const togo = alignmentStart(node) - now
    stepCeiling[0] = togo > NODE_TIME_EPS ? togo : 0
  }
  const phase = PHASES[mission.index].id
  if (phase === 'GRAVITY_TURN' || phase === 'CIRCULARISE') limitStepToCutoff(phase === 'CIRCULARISE')
  else if (phase === 'NRHO_STATION_KEEP') limitStepToKeepBurn()
}

export function updateMission(dt, simDt = dt) {
  updateLocalFrame()

  /**
   * Checked before anything else steers, and from every phase.
   *
   * Deliberately not a `done()` on the phases that can reach it: the point is
   * that *no* phase has to know about it, because the phase that needed it last
   * time was `TLI_ALIGN` — a coast that does nothing but wait, and the last
   * place anyone would have thought to test for a crash.
   */
  if (belowSurface()) {
    setPhase(INDEX_OF.LOST)
    return
  }

  const phase = PHASES[mission.index]
  mission.phaseT += mission.index === 0 ? dt : simDt
  if (mission.index > 0) mission.t += simDt

  // A separation preempts whatever is running, so the event gets its own phase
  // without the sequencer duplicating the propulsion model's staging logic.
  if (ship.separations > mission.lastSeparations && phase.id !== 'STAGING') {
    mission.lastSeparations = ship.separations
    mission.resumeIndex = mission.index
    setPhase(INDEX_OF.STAGING)
    return
  }

  if (mission.index === 0 && !mission.running) {
    aimThrust(_up)
    return // held, count not started
  }

  /**
   * A planned manoeuvre preempts the coast it falls in.
   *
   * Only from a phase that is not already flying one, and not from a staging
   * interrupt, which is itself mid-preemption. `resumeIndex` is the phase to
   * come back to — the same field STAGING uses, because this is the same shape
   * of interruption.
   */
  const ahead = nodeAhead(live.sim.t)
  if (ahead && live.sim.t >= alignmentStart(ahead) - NODE_TIME_EPS) {
    mission.node.active = ahead
    mission.resumeIndex = mission.index
    setPhase(INDEX_OF.NODE_ALIGN)
    return
  }

  phase.control(dt)

  /**
   * Transition. `done()` may answer in two ways.
   *
   * `true` hands over to the phase's own `next()`. A **string** names the
   * successor directly, which is for the case where `done()` has already worked
   * out where to go and `next()` would only re-derive it from state one of them
   * has to remember — the wart `STAGING` still carries in `resumeDone`.
   *
   * What it explicitly cannot do is fall through to `index + 1`. That lets the
   * array's *layout* encode control flow, which is how `STAGING` — an
   * interrupt, not a step — once wedged itself between the gravity turn and
   * cutoff and ping-ponged forever. A routing key that names nothing is a
   * programming error and says so, rather than silently going nowhere or, worse,
   * somewhere adjacent.
   *
   * Cycles need none of this: a phase whose `next()` names an earlier phase is
   * already a loop, which is how `TRANS_EARTH` is flown twice. The routing key
   * makes a loop's exit condition readable, not possible.
   */
  const verdict = phase.done()
  if (verdict) {
    if (typeof verdict === 'string') {
      const target = INDEX_OF[verdict]
      if (target === undefined) {
        throw new Error(`${phase.id}.done() routed to unknown phase "${verdict}"`)
      }
      setPhase(target)
    } else if (phase.next) {
      setPhase(phase.next(), phase.id === 'STAGING' && !mission.resumeDone)
    }
  }
}

/** Hold the vehicle on the pad. Called after the integration step. */
export function applyClamp() {
  clampToSite(live.sim.state, live.sim.t, mission.site, INDEX.earth * 6, INDEX.ship * 6)
}

/** True once the capsule is in the water. */
export const isSplashed = () => Boolean(PHASES[mission.index].splashed)

/**
 * Hold the capsule on the surface after splashdown.
 *
 * A constraint applied after the step, exactly as the pad hold is, and for the
 * same reason: modelling flotation as a force would be the stiffest term in the
 * system and would collapse the step size for everything else. The velocity it
 * is given is the local surface velocity — the ocean is turning with the planet
 * — so the capsule sits still relative to the water rather than being frozen in
 * inertial space, which would have it ploughing east at 400 m/s.
 */
export function applySplashdownHold() {
  const st = live.sim.state
  const o = INDEX.ship * 6
  const e = INDEX.earth * 6
  const rx = st[o] - st[e]
  const ry = st[o + 1] - st[e + 1]
  const rz = st[o + 2] - st[e + 2]
  const r = Math.hypot(rx, ry, rz)
  if (!(r > 0)) return
  const k = BODIES.earth.radius / r
  st[o] = st[e] + rx * k
  st[o + 1] = st[e + 1] + ry * k
  st[o + 2] = st[e + 2] + rz * k

  const w = live.sim.omega
  st[o + 3] = st[e + 3] + (w[1] * rz * k - w[2] * ry * k)
  st[o + 4] = st[e + 4] + (w[2] * rx * k - w[0] * rz * k)
  st[o + 5] = st[e + 5] + (w[0] * ry * k - w[1] * rx * k)
}
