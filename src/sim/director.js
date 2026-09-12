import { PHASE_IDS, currentPhase } from './mission.js'
import { WARP } from './warp.js'

/**
 * The camera director: which shot each mission phase is worth watching from.
 *
 * A table, not a controller. The rig already knows how to fly to a body, ride
 * the hull, and hand orbit control back; what was missing is anything deciding
 * *which* of those a given moment wants, so that a mission which flies itself is
 * also filmed by itself.
 *
 * It requests rather than commands, which is the same contract the sequencer's
 * `warpRequest` has and for the same reason: the request is applied **only when
 * it changes**, so a pilot who takes the camera keeps it until the next phase
 * boundary. A director that reasserted itself every frame would be unusable —
 * you could never look at anything else.
 *
 * Nothing here allocates. It is a lookup and a string comparison per frame.
 */
export const director = {
  /** Off hands the camera back entirely. */
  enabled: true,
  /** Camera mode wanted, or null when the director has no opinion. */
  request: null,
  /** Phase the current request was derived from. */
  forPhase: '',
  /** Human-readable label for the HUD. */
  shot: '',
  /**
   * Warp level this shot wants, or null to leave the pace alone.
   *
   * A *request*, with the weakest claim of anything that touches the dial. The
   * sequencer asks for physics reasons, the pilot asks because they want to, and
   * the powered clamp in the driver overrides both by capping the step directly
   * where it is used — so this can only ever slow things down, never speed them
   * past what is safe.
   */
  warp: null,
  /** Shots requested so far — the count a test can assert against frames. */
  cuts: 0,
}

/**
 * Phase to camera mode.
 *
 * The reasoning is the same throughout: watch the vehicle when the vehicle is
 * doing something, and watch the geometry when the geometry is. A burn is worth
 * seeing from the hull because the interesting thing is the vehicle's attitude;
 * a coast is not, because the interesting thing is where it is going, which the
 * hull view cannot show.
 *
 * `chase` rides the craft's own body frame, so it banks with a roll — which is
 * what makes the entry bank reversals legible rather than invisible.
 *
 * `pad` is world-fixed at the launch site and turns to follow, which is the one
 * shot the body-frame chase cannot give: a vehicle leaving the ground only reads
 * as *leaving* against something that stays put. It hands over at the gravity
 * turn, by which point the vehicle is far enough downrange that a ground camera
 * has nothing left to say.
 */
const SHOTS = {
  /* --- ascent: the vehicle is the story --- */
  /**
   * The third column is a warp request, and only the ascent uses it.
   *
   * Left at 60x the entire pad shot is over in 0.4 s of wall clock: the vehicle
   * reaches the gravity turn at MET 24 s, and sixty of those pass every second.
   * An altitude condition cannot fix that — the shot already runs to 2 km, and
   * holding it longer would mean holding a *ground* camera past 50 km. The
   * problem is temporal, so the fix is.
   *
   * `GRAVITY_TURN` states 60x explicitly rather than the director remembering
   * what to restore. Remembering would mean carrying hidden state and deciding
   * what to do when the pilot has intervened in between; naming it keeps the
   * table a lookup and keeps the hand-back visible in the same place as the
   * hand-over.
   */
  /**
   * Opens wide, on the planet, rather than on the pad.
   *
   * The pad is the better shot once something is about to happen, and LIFTOFF
   * cuts to it. But it is a ground camera at whatever local hour the epoch
   * lands on — J2000 puts the site in darkness — so as a first frame it is a
   * grey cone in the dark with nothing to say where it is. Establish the world,
   * then go close, which is the order a viewer needs and also the order a cut
   * list is normally written in.
   */
  PRE_LAUNCH: ['earth', 'Before the count', null],
  LIFTOFF: ['pad', 'Liftoff', WARP.x1],
  PITCH_KICK: ['pad', 'Pitch kick', WARP.x1],
  GRAVITY_TURN: ['chase', 'Gravity turn', WARP.m1],
  STAGING: ['chase', 'Separation'],
  MECO: ['chase', 'Cutoff'],

  /* --- orbit: pull back, the shape matters --- */
  COAST_TO_APOAPSIS: ['earth', 'Coasting to apoapsis'],
  CIRCULARISE: ['chase', 'Circularisation burn'],
  COAST: ['earth', 'On orbit'],

  /* --- translunar --- */
  TLI_ALIGN: ['earth', 'Awaiting the window'],
  TLI_BURN: ['chase', 'Trans-lunar injection'],
  TRANS_LUNAR: ['earth', 'Trans-lunar coast'],
  MCC_SOLVE: ['chase', 'Correction attitude'],
  MCC_BURN: ['chase', 'Mid-course correction'],

  /* --- the Moon --- */
  LUNAR_APPROACH: ['moon', 'Lunar approach'],
  LOI_ALIGN: ['chase', 'Insertion attitude'],
  LOI_BURN: ['chase', 'Lunar orbit insertion'],
  LUNAR_ORBIT: ['moon', 'In lunar orbit'],

  /* --- halo maintenance --- */
  /* A planned burn is the pilot's, so the camera rides the hull for it. */
  NODE_ALIGN: ['chase', 'Node attitude'],
  NODE_BURN: ['chase', 'Planned burn'],

  NRHO_COAST: ['moon', 'Halo coast'],
  NRHO_STATION_KEEP: ['chase', 'Station-keeping'],

  /* --- coming home --- */
  TEI_ALIGN: ['chase', 'Departure attitude'],
  TEI_BURN: ['chase', 'Trans-Earth injection'],
  TRANS_EARTH: ['earth', 'Trans-Earth coast'],
  EI_SOLVE: ['chase', 'Corridor attitude'],
  EI_BURN: ['chase', 'Corridor trim'],

  /* --- entry: the hull again, and the bank reversals are the point --- */
  SM_SEP: ['chase', 'Service module separation'],
  RE_ENTRY: ['chase', 'Re-entry'],
  DROGUE: ['chase', 'Drogues'],
  MAIN_CHUTES: ['chase', 'Main canopies'],
  SPLASHDOWN: ['ship', 'Splashdown'],

  /**
   * Pull back to the planet. Wherever the vehicle got to, the useful thing to
   * see is the body it is inside, not a chase camera buried in the crust.
   */
  LOST: ['earth', 'Vehicle lost'],
}

/**
 * Every phase must have a shot, and the check runs rather than being described.
 *
 * A missing entry would leave the camera wherever the previous phase left it —
 * silent, and indistinguishable from a deliberate hold. The same reasoning the
 * HUD's duplicate-key assertion carries: a comment cannot fail.
 */
const missing = PHASE_IDS.filter((id) => !SHOTS[id])
if (missing.length) {
  throw new Error(`director: no shot for phase(s) ${missing.join(', ')}`)
}
const extra = Object.keys(SHOTS).filter((id) => !PHASE_IDS.includes(id))
if (extra.length) {
  throw new Error(`director: shot for unknown phase(s) ${extra.join(', ')}`)
}

/**
 * One frame of direction. Called from the driver before the camera rig runs.
 *
 * Deliberately does nothing but decide. Applying the request is the driver's
 * job, because that is where the store lives and where the "only on change"
 * rule can be enforced against a single remembered value.
 */
export function updateDirector() {
  if (!director.enabled) {
    director.request = null
    director.shot = ''
    director.warp = null
    return director
  }

  const id = currentPhase().id
  if (id === director.forPhase) return director

  const shot = SHOTS[id]
  if (!shot) return director

  director.forPhase = id
  director.request = shot[0]
  director.shot = shot[1]
  director.warp = shot[2] ?? null
  director.cuts += 1
  return director
}

/** Hand the camera back to the pilot for good. */
export function releaseDirector() {
  director.enabled = false
  director.request = null
  director.forPhase = ''
  director.shot = ''
  director.warp = null
}

/** Resume automatic direction from the current phase. */
export function resumeDirector() {
  director.enabled = true
  director.forPhase = '' // force a fresh decision next frame
}
