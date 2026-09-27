import { ACTIVE_VESSEL } from './vessels.js'
import { activeSite } from './launchsite.js'
import { currentPhase, mission } from './mission.js'
import { live } from './live.js'
import { INDEX } from './system.js'
import { BODIES, SHIP } from './constants.js'
import { ship } from './ship.js'

/**
 * The mission as it was watched: what a camera would have been, what the
 * clock on the screen would have read, and what was said on the loop.
 *
 * The simulator draws a flight. A viewer in 1968 did not see a flight — they
 * saw a feed: a picture from one particular camera, a caption saying which,
 * a clock counting from liftoff, a lower third when something happened, and
 * the air-to-ground loop. This module is that feed's
 * script. It decides nothing about the flight and nothing reads it back; it
 * only reads the flight and says what a broadcast of it would have shown.
 *
 * Three things are kept honest here rather than dressed up:
 *
 * - **Which views were cameras.** A ground camera beside the pad, the
 *   television camera on the lunar surface, the window of a spacecraft
 *   looking at the other one — those existed. A view of Apollo 8 from outside
 *   Apollo 8 did not, and the networks said so over their own models and
 *   animations: CBS captioned them SIMULATION. NASA's own channel still
 *   captions its renders ANIMATION. So does this.
 * - **The clock.** Apollo flew on ground elapsed time from the Earth liftoff,
 *   so Eagle's ascent — which this simulator starts the flight at — reads the
 *   GET it actually happened at, 124:22:00.79 (Apollo 11 Mission Report,
 *   table 2-I), plus the simulated seconds since.
 * - **The loop.** Nothing gets through a spacecraft behind the Moon, where
 *   the geometry says the Earth is hidden; and a
 *   reply from the Moon comes back a round trip of light later, 2.6 s, which
 *   is the pause every Apollo recording has in it.
 *
 * Everything here runs on a timer in the page, not in the render loop — it
 * formats strings and builds captions, which allocate, and belongs where the
 * other text readouts already live. `signalLost` is scalar geometry and
 * allocates nothing, so anything can ask it as often as it likes.
 */

/* ---------------------------------------------------------------- *
 * The programmes
 * ---------------------------------------------------------------- */

/** Apollo 11's ground elapsed time at lunar liftoff, s — 124:22:00.79. */
export const APOLLO11_LIFTOFF_GET = 124 * 3600 + 22 * 60 + 0.79

/**
 * One entry per vehicle.
 *
 *   era         'apollo' (1968-72 film and network television) or 'artemis'
 *   clock       'GET' ground elapsed time, or 'MET' mission elapsed time
 *   epoch       what the clock read at the simulator's mission time zero
 *   ground      the capsule communicator's callsign, as heard on the loop
 *   craft       the spacecraft's, likewise
 *   rendered    the caption a view no camera could have taken carries
 */
export const FEEDS = {
  apollo8: {
    programme: 'Apollo 8',
    era: 'apollo',
    clock: 'GET',
    epoch: 0,
    ground: 'Houston',
    craft: 'Apollo 8',
    rendered: 'Simulation',
  },
  apollo11: {
    programme: 'Apollo 11',
    era: 'apollo',
    clock: 'GET',
    epoch: APOLLO11_LIFTOFF_GET,
    ground: 'Houston',
    craft: 'Eagle',
    /** Flown from the Moon: its ground camera is the surface television. */
    lunar: true,
    /** The other spacecraft on the loop from the ascent to the docking. */
    partner: 'Columbia',
    rendered: 'Simulation',
  },
  artemis: {
    programme: 'Artemis',
    era: 'artemis',
    clock: 'MET',
    epoch: 0,
    ground: 'Houston',
    craft: 'Orion',
    rendered: 'Animation',
  },
}

/** This page's feed. The vessel is fixed at load, so this is too. */
export const FEED = FEEDS[ACTIVE_VESSEL] ?? FEEDS.apollo8

/* ---------------------------------------------------------------- *
 * The picture: which camera, and what it looks like
 * ---------------------------------------------------------------- */

/**
 * The look each kind of picture gets — see `gfx/filmLook.js` for what each
 * one does to the frame.
 *
 *   film       16 mm and 35 mm colour reversal: the pad, the tracking cameras,
 *              the spacecraft windows. Grain, weave, a warm fade, dust.
 *   tv         the Apollo lunar-surface colour camera: interlace, bloom, a
 *              soft picture and colour that bleeds sideways.
 *   network    1968 network television carrying a model or an animation:
 *              the same scan lines, no film in front of them.
 *   hd         a present-day camera: clean, a little sensor noise.
 *   clean      a present-day render: nothing done to it at all.
 */
export const LOOKS = ['film', 'tv', 'network', 'hd', 'clean']

/** The short name a pad's own crews use for it. */
const PAD_NAME = {
  ksc: 'Pad 39B',
  vandenberg: 'SLC-6',
  baikonur: 'Site 1/5',
  kourou: 'ELA-3',
}


/** Views that are the viewer's own rather than any camera's: no feed at all. */
const NO_FEED = new Set(['cinematic', 'intro'])

/**
 * What is on screen, as a broadcast would caption it.
 *
 * Returns `{ label, camera, look }`: the caption, whether a real camera could
 * have taken the picture, and the look it gets. `null` for the views that are
 * not a feed at all — the front door, the intro film.
 */
export function cameraSource(focus, phaseId = currentPhase().id, feed = FEED, site = mission.site ?? activeSite()) {
  if (NO_FEED.has(focus)) return null
  const apollo = feed.era === 'apollo'
  const rendered = { label: feed.rendered, camera: false, look: apollo ? 'network' : 'clean' }
  const lunar = site.body === 'moon'

  if (focus === 'ground') {
    if (lunar) return { label: 'Lunar surface · TV camera', camera: true, look: apollo ? 'tv' : 'hd' }
    const pad = PAD_NAME[site.id] ?? site.name
    return { label: `${pad} · Remote camera`, camera: true, look: apollo ? 'film' : 'hd' }
  }
  if (focus === 'pad') {
    const pad = PAD_NAME[site.id] ?? site.name
    return { label: `${pad} · Tracking camera`, camera: true, look: apollo ? 'film' : 'hd' }
  }
  if (focus === 'chase') {
    // The one hull view in these flights a real camera took: Orion's own.
    // Over Eagle's shoulder is not Eagle's window — the window is inside.
    if (feed.era === 'artemis') {
      return { label: `${feed.craft} · Solar array wing camera`, camera: true, look: 'hd' }
    }
    return rendered
  }
  return rendered
}

/* ---------------------------------------------------------------- *
 * The clock
 * ---------------------------------------------------------------- */

const two = (n) => String(n).padStart(2, '0')

/** hhh:mm:ss, the way the Apollo flight plans wrote GET. */
export function formatGet(seconds) {
  const s = Math.max(0, Math.floor(seconds))
  const h = Math.floor(s / 3600)
  return `${String(h).padStart(3, '0')}:${two(Math.floor((s % 3600) / 60))}:${two(s % 60)}`
}

/** d/hh:mm:ss, the way a present-day mission clock reads. */
export function formatMet(seconds) {
  const s = Math.max(0, Math.floor(seconds))
  const d = Math.floor(s / 86400)
  return `${d}/${two(Math.floor((s % 86400) / 3600))}:${two(Math.floor((s % 3600) / 60))}:${two(s % 60)}`
}

/** T-mm:ss, rounded up, so the count reads T-00:01 until it reads zero. */
export function formatCount(seconds) {
  const s = Math.max(0, Math.ceil(seconds))
  return `T–${two(Math.floor(s / 3600))}:${two(Math.floor((s % 3600) / 60))}:${two(s % 60)}`
}

/**
 * The clock a broadcast of this mission showed, for mission time `t` (seconds
 * from this flight's liftoff, negative in the count).
 *
 * `{ main, sub }`: the big figure, and a second line where there is one. Before
 * an Earth liftoff the main figure is the count, because that is the only
 * clock that exists yet. On the Moon the ground elapsed time has been running
 * for five days, so it stays the main figure and the count is the second line.
 */
export function missionClock(t = mission.t, feed = FEED) {
  const counting = t < 0 && (mission.running || currentPhase().held)
  if (feed.epoch > 0) {
    return {
      main: `GET ${formatGet(feed.epoch + t)}`,
      sub: counting ? `Liftoff ${formatCount(-t)}` : null,
    }
  }
  if (counting || t < 0) return { main: formatCount(-t), sub: null }
  return { main: `${feed.clock} ${feed.clock === 'GET' ? formatGet(t) : formatMet(t)}`, sub: null }
}

/* ---------------------------------------------------------------- *
 * Lower thirds
 * ---------------------------------------------------------------- */

const nmi = (m) => (m / 1852).toFixed(1)

/**
 * The lower third for a phase: `[title, detail]`, `detail` possibly null. A
 * function where the detail is a figure the flight itself produced — the
 * orbit Eagle actually reached, not Apollo 11's.
 */
const CAPTIONS = {
  PRE_LAUNCH: () => (mission.running ? ['Terminal count', null] : null),
  LIFTOFF: () => ['Liftoff', (PAD_NAME[(mission.site ?? activeSite()).id] ?? (mission.site ?? activeSite()).name)],
  PITCH_KICK: ['Roll and pitch program', null],
  GRAVITY_TURN: ['Gravity turn', null],
  STAGING: () => ['Staging', stageJustLeft()],
  MECO: ['Engine cutoff', null],
  COAST_TO_APOAPSIS: ['Coast to apogee', null],
  CIRCULARISE: ['Orbit insertion', null],
  COAST: ['Earth parking orbit', null],
  TLI_ALIGN: ['Awaiting TLI', null],
  TLI_BURN: ['Translunar injection', 'Third stage, second burn'],
  TRANS_LUNAR: ['Translunar coast', null],
  MCC_BURN: ['Midcourse correction', null],
  LUNAR_APPROACH: ['Lunar approach', null],
  LOI_ALIGN: ['LOI attitude', null],
  // Behind the Moon only if the geometry says so: Apollo 8's burns were on the
  // far side, and a flight that fires its elsewhere does not get the caption.
  LOI_BURN: () => ['Lunar orbit insertion', signalLost() ? 'Behind the Moon' : null],
  LUNAR_ORBIT: () => ['Lunar orbit', `${nmi(live.lunar.apogee)} × ${nmi(live.lunar.perigee)} nmi`],
  TEI_ALIGN: ['TEI attitude', null],
  TEI_BURN: () => ['Transearth injection', signalLost() ? 'Behind the Moon' : null],
  TRANS_EARTH: ['Transearth coast', null],
  EI_BURN: ['Corridor correction', null],
  SM_SEP: ['CM/SM separation', null],
  RE_ENTRY: ['Entry interface', '400,000 ft'],
  DROGUE: ['Drogue parachutes', null],
  MAIN_CHUTES: ['Main parachutes', null],
  SPLASHDOWN: ['Splashdown', 'Pacific Ocean'],
  NODE_BURN: ['Planned burn', null],
  HALO_CAPTURE: ['NRHO capture', null],
  NRHO_COAST: ['Near-rectilinear halo orbit', null],
  NRHO_STATION_KEEP: ['Orbit maintenance', null],
  LUNAR_PRE_LAUNCH: () => (mission.running ? ['Tranquility Base', 'The count for liftoff'] : ['Tranquility Base', null]),
  LUNAR_LIFTOFF: ['Liftoff', 'Tranquility Base'],
  LUNAR_ASCENT: ['Powered ascent', null],
  LUNAR_INSERTION: () => ['Orbit insertion', `${nmi(live.lunar.perigee)} × ${nmi(live.lunar.apogee)} nmi`],
  LM_CSI: ['Coelliptic sequence initiation', null],
  LM_CDH: ['Constant delta height', null],
  LM_TPI: ['Terminal phase initiation', null],
  LM_BRAKING: ['Braking', null],
  LM_STATION_KEEP: ['Station-keeping', null],
  LM_DOCKING: ['Docking', null],
  DOCKED: ['Hard dock', 'Columbia and Eagle'],
  LOST: ['Loss of vehicle', null],
}

/** The stage that has just been let go of — the one before the active one — by name. */
function stageJustLeft() {
  const left = SHIP.stages[ship.stage - 1]
  return left ? `${left.name} separation` : null
}

/** The lower third for `phaseId`, or null where nothing is worth one. */
export function eventCaption(phaseId = currentPhase().id) {
  const entry = CAPTIONS[phaseId]
  if (!entry) return null
  const got = typeof entry === 'function' ? entry() : entry
  if (!got) return null
  return { title: got[0], detail: got[1] ?? null }
}

/* ---------------------------------------------------------------- *
 * The link
 * ---------------------------------------------------------------- */

/** Metres a second. */
export const LIGHT_SPEED = 299_792_458

const R_MOON = BODIES.moon.radius

/**
 * Whether the Moon stands between the vehicle and the Earth.
 *
 * The segment from the vehicle to the Earth's centre against the Moon's
 * sphere: the closest point of the segment to the Moon's centre, and whether it
 * is inside the radius. The Earth's centre rather than a tracking station is a
 * simplification worth its size — the three Deep Space Network sites are there
 * so that one of them always sees whatever the Earth's disc does, and the disc
 * is two degrees across from the Moon against the Moon's own thirty-one.
 *
 * Scalars off the state vector; allocates nothing.
 */
export function signalLost() {
  const s = live.sim.state
  const o = INDEX.ship * 6
  const e = INDEX.earth * 6
  const m = INDEX.moon * 6
  const dx = s[e] - s[o]
  const dy = s[e + 1] - s[o + 1]
  const dz = s[e + 2] - s[o + 2]
  const mx = s[m] - s[o]
  const my = s[m + 1] - s[o + 1]
  const mz = s[m + 2] - s[o + 2]
  const dd = dx * dx + dy * dy + dz * dz
  if (!(dd > 0)) return false
  let u = (mx * dx + my * dy + mz * dz) / dd
  if (u <= 0) return false // the Moon is behind the vehicle, away from Earth
  if (u > 1) u = 1
  const cx = mx - u * dx
  const cy = my - u * dy
  const cz = mz - u * dz
  return cx * cx + cy * cy + cz * cz < R_MOON * R_MOON
}

/** Light's round trip between the vehicle and the Earth, s: the pause before any reply. */
export function roundTrip() {
  const s = live.sim.state
  const o = INDEX.ship * 6
  const e = INDEX.earth * 6
  const dx = s[e] - s[o]
  const dy = s[e + 1] - s[o + 1]
  const dz = s[e + 2] - s[o + 2]
  return (2 * Math.sqrt(dx * dx + dy * dy + dz * dz)) / LIGHT_SPEED
}
