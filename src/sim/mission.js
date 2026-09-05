import { Matrix4, Quaternion, Vector3 } from 'three'
import { live } from './live.js'
import { activeStage, separate, ship, totalMass } from './ship.js'
import { INDEX } from './system.js'
import { LAUNCH_SITES, clampToSite, rotationBonus } from './launchsite.js'
import { SPIN_AXIS, SPIN_RATE } from './atmosphere.js'
import {
  projectPerigee,
  solveMidCourse,
  solveReturnCorridor,
  solveStationKeeping,
} from './targeting.js'
import { craftR, craftSynodic, synodic } from './cr3bp.js'
import { WARP } from './warp.js'
import { BODIES, G, G0, SHIP } from './constants.js'

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
   * How far below the parking orbit periapsis may sit at cutoff, m.
   *
   * This replaces a flat 150 km target, which was the right idea for the wrong
   * orbit: with the ascent lofting to over a thousand kilometres, "perigee
   * above the air" was met while apoapsis was already in deep space. Measured
   * against the vessel's own parking altitude it means what it says — the orbit
   * has closed, near-circular, where it was meant to.
   */
  insertionMargin: 20e3,
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
   * The control horizon is set by the Lyapunov time.
   */
  nrhoLookahead: 1,
  /** Largest maintenance burn that will be executed, m/s. A sanity backstop. */
  nrhoMaxDeltaV: 20,
  /** Reference perilune radius to hold, m. Set on entry to the cycle. */
  nrhoReference: 0,

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
  site: LAUNCH_SITES.ksc,
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
    /** 3D angle between where apoapsis will point and where the Moon will be. */
    alignment: Math.PI,
    lastAlignment: Math.PI,
    deltaV: 0, // m/s the injection needs
    burnStart: 0, // mission time at ignition
    burnDuration: 0, // s
    committed: false,
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
    /** Last maintenance solve. */
    deltaV: 0,
    totalDeltaV: 0,
    solved: false,
    converged: false,
    predicted: 0,
    targetMass: 0,
    perilune: Infinity, // m, closest to the Moon this revolution
    apolune: 0, // m, furthest
    lastPerilune: 0, // the revolution just completed
    lastApolune: 0,
    synodicR: 0, // m, current distance from the Moon
    /** Out-of-plane excursion in the synodic frame — the halo's defining feature. */
    synodicZ: 0,
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
  if (_x.lengthSq() < 1e-10) _x.set(1, 0, 0)
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
 * **Open loop, while apoapsis is still short of the parking orbit.** Pitch is a
 * function of speed alone — `90 deg x (v/vt)^n` — which is what a launch
 * vehicle wants low down, where the angle of attack has to stay near zero and
 * there is nothing useful to feed back on yet.
 *
 * **Closed loop, once apoapsis reaches the target.** The open-loop law cannot
 * be the whole ascent, and the failure is not subtle: it knows the vehicle's
 * *speed* and nothing about where the orbit is going, so a vehicle that climbs
 * faster than the schedule assumed simply keeps climbing. Measured, Apollo 8
 * parked at 1,318 x 1,323 km against a real 185, and Artemis — at a
 * thrust-to-weight of 1.57 against 1.166 — reached 7,602 km. Higher thrust
 * lofts *worse*, because it finishes the velocity schedule sooner and spends
 * the rest of the burn pushing apoapsis outward.
 *
 * So once apoapsis is where it belongs, hold it there and put everything else
 * into horizontal speed. Commanding a flight-path angle proportional to the
 * apoapsis error does that with one gain and no vehicle-specific numbers: short
 * of target, pitch up; past it, pitch below the horizon; at it, fly level and
 * let periapsis climb. The loop is what makes the same code fly both vehicles.
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
function loiBurnDuration() {
  const dv = live.lunar.captureDeltaV
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
function teiBurnDuration() {
  const dv = mission.tei.deltaVEstimate
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
    const full = ve * Math.log(m / (m - prop))
    if (full >= togo) {
      t += (m * (1 - Math.exp(-togo / ve))) / mdot
      togo = 0
    } else {
      t += prop / mdot
      togo -= full
      m -= prop + st.dryMass
    }
  }
  return t
}

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
  tli.timeOfFlight = Math.PI * Math.sqrt((at * at * at) / MU_EARTH)

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
  _hm.crossVectors(_rm, _vm).normalize()
  _future.copy(_rm).divideScalar(r2).applyAxisAngle(_hm, tli.moonTravel)
  _apoDir.copy(_rs).divideScalar(-r1)

  tli.lastAlignment = tli.alignment
  const cosAlign = _apoDir.dot(_future)
  tli.alignment = Math.acos(cosAlign > 1 ? 1 : cosAlign < -1 ? -1 : cosAlign)

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
  setPhase(INDEX_OF.TLI_ALIGN)
  return true
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
     * Cut off on *perigee*, not apogee.
     *
     * Apogee is the intuitive target and it is the wrong one: a ballistic lob
     * reaches 200 km apogee at under 2 km/s, so an apogee trigger cuts the
     * engines less than three minutes in, on a trajectory whose perigee is
     * 6000 km below the surface. Perigee rising above the atmosphere is the
     * condition that actually means "in orbit". The depletion clause is the
     * fallback for a vehicle that cannot get there.
     *
     * What has changed is the number. It was a flat 150 km, which said nothing
     * about *which* orbit; now it is the vessel's own parking altitude less a
     * margin, so the test is "the orbit has closed where it was meant to"
     * rather than merely "above the air". With the steering closing the loop on
     * apoapsis, the two together are a direct insertion — which is what the
     * S-IVB actually did.
     */
    /**
     * Cut off when the orbit has actually closed where it was meant to.
     *
     * Three conditions were tried here and the first two are instructive.
     * Perigee against a flat 150 km was the original: right idea, wrong orbit,
     * because with the ascent lofting past a thousand kilometres "above the
     * air" said nothing about *which* orbit. Apoapsis plus a speed gate was the
     * second, and it cut Artemis off eighty metres a second into a *descent*,
     * past apoapsis with periapsis at -57 km — an orbit whose next stop is the
     * ground. Apoapsis is a target, not a state.
     *
     * Perigee against the vessel's own parking altitude is a state, and it is
     * the one that means "in orbit, here". With the steering holding apoapsis
     * at the target and never commanding below the horizon, reaching it is a
     * direct insertion — which is what the S-IVB did.
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
    },
    control() {
      aimPrograde()
      const tli = updateTLI()
      // Same ladder as the apoapsis coast: warp hard while the window is far
      // off, then buy back resolution as it closes.
      const t = tli.timeToWindow
      // Wider tolerance further out: the alignment sweeps fast, and a frame at
      // 1 hr/s covers a minute of it.
      mission.warpRequest = t > 7200 ? WARP.h6 : t > 3600 ? WARP.h1 : t > 600 ? WARP.m1 : WARP.x1
    },
    done: () => mission.tli.alignment <= PROFILE.phaseTolerance,
    next: () => INDEX_OF.TLI_BURN,
  },
  {
    id: 'TLI_BURN',
    label: 'TLI burn',
    enter() {
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
    done: () =>
      live.insideLunarSOI &&
      live.lunar.timeToPeriapsis > 0 &&
      live.lunar.timeToPeriapsis <= loiIgnitionLead() + PROFILE.loiAlignMargin,
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
     */
    enter() {
      ship.throttle = 0
      mission.warpRequest = WARP.x1
      const nr = mission.nrho
      nr.lastKeep = mission.t
      nr.solved = false
      nr.converged = false
      nr.deltaV = 0

      if (!(PROFILE.nrhoReference > 0)) return
      const sol = solveStationKeeping(PROFILE.nrhoReference, PROFILE.nrhoLookahead)
      nr.solved = true
      nr.predicted = sol.approach
      nr.converged = sol.converged && sol.magnitude <= PROFILE.nrhoMaxDeltaV
      nr.deltaV = sol.magnitude
      if (nr.converged && sol.magnitude > 1e-6) {
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
      // Point at the solution if there is one to fly, otherwise hold the coast
      // attitude. The burn itself is a few seconds at most.
      if (nr.converged && nr.deltaV > 1e-6) {
        aimThrust(mission.ei.direction)
        nr.pointingError = ship.forward.angleTo(mission.ei.direction)
        if (nr.pointingError < PROFILE.eiPointTolerance) ship.throttle = 1
      } else {
        aimLunarPrograde()
      }
      trackHalo()
      if (ship.thrust > 0 && totalMass() <= nr.targetMass) {
        ship.throttle = 0
        nr.totalDeltaV += nr.deltaV
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
function setPhase(next, resuming = false) {
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
/**
 * Enter the halo-maintenance cycle.
 *
 * Separate from the linear mission for now: the corrector that would actually
 * place the vehicle on a halo is not written yet, so this establishes the
 * *control structure* — an indefinitely repeating pair — against which the
 * targeting can be built. Called from a test or the HUD, never automatically.
 */
export function enterNrhoCycle(referenceRadius = 0) {
  setPhase(INDEX_OF.NRHO_COAST)
  const nr = mission.nrho
  nr.cycles = 0
  nr.totalDeltaV = 0
  nr.prevRange = live.lunarRange
  nr.prevPrevRange = live.lunarRange
  nr.atApolune = false
  PROFILE.nrhoReference = referenceRadius
  return true
}

export function beginCountdown() {
  mission.running = true
  mission.warpRequest = WARP.m1
}

export function resetMission() {
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
export function updateMission(dt, simDt = dt) {
  updateLocalFrame()

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
