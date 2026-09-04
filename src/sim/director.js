import { PHASE_IDS, currentPhase } from './mission.js'

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
 */
const SHOTS = {
  /* --- ascent: the vehicle is the story --- */
  PRE_LAUNCH: ['ship', 'On the pad'],
  LIFTOFF: ['chase', 'Liftoff'],
  PITCH_KICK: ['chase', 'Pitch kick'],
  GRAVITY_TURN: ['chase', 'Gravity turn'],
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
    return director
  }

  const id = currentPhase().id
  if (id === director.forPhase) return director

  const shot = SHOTS[id]
  if (!shot) return director

  director.forPhase = id
  director.request = shot[0]
  director.shot = shot[1]
  director.cuts += 1
  return director
}

/** Hand the camera back to the pilot for good. */
export function releaseDirector() {
  director.enabled = false
  director.request = null
  director.forPhase = ''
  director.shot = ''
}

/** Resume automatic direction from the current phase. */
export function resumeDirector() {
  director.enabled = true
  director.forPhase = '' // force a fresh decision next frame
}
