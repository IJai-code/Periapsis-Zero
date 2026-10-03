import { BODIES, G, G0 } from './constants.js'
import { live } from './live.js'
import { mission, currentPhase, PHASE_IDS } from './mission.js'
import { ship, deltaV } from './ship.js'
import { INDEX } from './system.js'
import { recordStory } from './story.js'

/**
 * Flight programs and the wings a pilot earns.
 *
 * ── what this file is ────────────────────────────────────────────────
 *
 * The presets answer "show me a mission". A program answers "fly one
 * yourself". A program is a route with legs, a fuel load, a wing (how much
 * the flight computer owns), and objectives that are *evaluated from the
 * simulation*, the same rule every gate in `scripts/` follows: a claim about
 * flight is held against the flight, not against a flag the UI set.
 *
 * ── the wings, and why the ladder is freedom ─────────────────────────
 *
 * The natural design is "easy mode steers for you". That is the design this
 * file refuses, because it cannot be made honest: the sequencer's ascent is
 * a closed loop over the *live* state (apoapsis, dynamic pressure, stage
 * margins — `aimAscent`, `manageThrottle`), and a UI-level override that
 * yanks the stick away per frame either fights that loop or duplicates it.
 * So the ladder is written in freedom instead:
 *
 *   **Trainee**  the computer flies everything to orbit; you arrive in the
 *                parking orbit with the spacecraft and a checklist.
 *   **Aviator**  you fly the ascent at the stick from liftoff; the computer
 *                takes it back at MECO. Insertion, TLI and everything after
 *                are yours unless you ask for them back.
 *   **Aldrin**   nothing flies for you after the count: ascent, insertion,
 *                every burn, and the powered-warp ceiling the computer used
 *                to impose is *yours* to respect — exceed the step the
 *                integrator can carry and the flight model will tell you
 *                what that costs.
 *   **Kármán**   Aldrin, plus a fuel load of 84% — the road-not-taken
 *                margin, cut at the last stage, because the last stage is
 *                the one a return comes home on. Its budget is verified from
 *                the vehicle's own numbers in `verify-programs`.
 *
 * ── the Δv budget, honestly ──────────────────────────────────────────
 *
 * `legBudget` computes what each leg costs the *vehicle* by evaluating the
 * rocket equation on the stack as the leg would meet it: stage by stage,
 * dry mass included, exactly as `deltaV()` in `sim/ship.js` does. A leg
 * priced at 3.2 km/s against a stack that can only deliver 3.1 is a plan
 * that fails before the count — so the planner shows the margin, in ember
 * when it is negative, and the planner's promise is checked in
 * `verify-programs`: every program's full route must fit inside its own
 * fuel load with margin to spare, on both vehicles, from every site.
 */

/* ---------------------------------------------------------------- *
 * The wings
 * ---------------------------------------------------------------- */

/**
 * What each wing may hold, by the machine-readable capability names the
 * sequencer gate reads. A wing's *description* is copy; its `holds` array
 * is a contract, checked exhaustively in `verify-programs`.
 */
export const WINGS = {
  trainee: {
    id: 'trainee',
    name: 'Trainee',
    tagline: 'The computer flies you to orbit.',
    holds: ['ascent', 'insertion', 'burns', 'warpCeiling'],
    order: 1,
  },
  aviator: {
    id: 'aviator',
    name: 'Aviator',
    tagline: 'You fly the ascent. The computer flies the book.',
    holds: ['burns', 'warpCeiling'],
    order: 2,
  },
  aldrin: {
    id: 'aldrin',
    name: 'Aldrin',
    tagline: 'Nothing flies for you after the count.',
    holds: [],
    order: 3,
  },
  karman: {
    id: 'karman',
    name: 'Kármán',
    tagline: 'Aldrin, and 84% of the fuel.',
    holds: [],
    order: 4,
  },
}

/** The fuel fraction Kármán loads. See the ladder's argument above. */
export const KARMAN_FUEL = 0.84

/* ---------------------------------------------------------------- *
 * Rocket-equation helpers — the same arithmetic `ship.js` uses
 * ---------------------------------------------------------------- */

/*
 * Δv pricing, honestly.
 *
 * The first draft of this file carried a per-leg propellant allocation —
 * "this leg draws from the S-IC, that one from the SPS" — and it was deleted,
 * because it was planning fiction: an allocation that precise is a *claim*
 * about the flown trajectory, and the trajectory is the pilot's, not the
 * plan's. What a plan can honestly price is the route's total against what
 * the stack can deliver, both computed from the vehicle's own published
 * numbers by the same rocket-equation sum `ship.deltaV()` flies. A leg list
 * is guidance for the eye, a budget is a constraint; only the constraint
 * is enforced, in verify-programs, and only against the full stack.
 */

/**
 * Full-stack Δv of a vessel at a fuel scale, exactly as `deltaV()` computes
 * it for the live ship: stage by stage, dry mass included, each stage's own
 * exhaust velocity. This is the number the planner shows and the number
 * `verify-programs` holds programs against.
 */
export function stackDeltaV(vessel, fuelScale = 1) {
  let m = 0
  for (const s of vessel.stages) m += s.dryMass + s.propellant * fuelScale
  let total = 0
  for (const s of vessel.stages) {
    const prop = s.propellant * fuelScale
    if (prop <= 0) continue
    const after = m - prop
    total += s.isp * G0 * Math.log(m / after)
    m = after - s.dryMass
  }
  return total
}

/* ---------------------------------------------------------------- *
 * Objective evaluation — read from the sim, never from a flag
 * ---------------------------------------------------------------- */

/** The craft's geocentric speed, m/s, off the same elements the HUD reads. */
const orbitalSpeed = () => live.elements.speed

/** Altitude above Earth's mean radius, m. */
const altitude = () => live.elements.altitude

/** Is the current phase the named one? */
const phaseIs = (id) => currentPhase().id === id

/** Has the vehicle ever reached this phase this flight? */
const reached = (id) => mission.index >= (missionIndexOf(id) ?? Infinity)

function missionIndexOf(id) {
  return PHASE_IDS.indexOf(id)
}

/**
 * Evaluate one objective against the live flight.
 *
 * Every objective returns { done, progress } where progress is 0..1 for the
 * checklist's bar. `done` is one-way per program run: `tickProgram` latches
 * it, because a pilot who overshoots a window has still *had* the window.
 */
function evaluate(o) {
  switch (o.check) {
    case 'liftoff':
      return { done: reached('LIFTOFF'), progress: reached('LIFTOFF') ? 1 : 0 }
    case 'orbit': {
      /*
       * An orbit is a fact about the *conic*, not about which phases ran.
       * The first draft latched this on `reached('CIRCULARISE')` — and the
       * harness caught it within minutes: a hand-flown vehicle that goes
       * too high skips the insertion phase entirely and re-enters, having
       * never been in orbit, while the checklist ticked anyway. The honest
       * test is the osculating perigee: above the atmosphere, with the
       * apoapsis near the parking altitude, the craft *is* in orbit,
       * however it got there — and perigee below the air is not, whatever
       * the phase table did.
       */
      const el = live.elements
      const inOrbit =
        el.perigee > 100e3 &&
        el.apogee > 120e3 &&
        el.apogee < SHIP_PARKING * 4 &&
        orbitalSpeed() > 6000
      return {
        done: inOrbit,
        progress: Math.max(
          Math.min(1, altitude() / SHIP_PARKING),
          Math.min(1, Math.max(0, (el.perigee - 0) / 100e3)) * 0.5,
        ),
      }
    }
    case 'tli': {
      /*
       * Translunar injection, read off the conic and not the sequencer.
       * `reached('TRANS_LUNAR')` was the first draft, and it was wrong for
       * exactly the pilot this file exists for: an Aldrin wing never enters
       * that phase — PILOT_FLIGHT holds the stick from MECO to the Moon —
       * so a checklist keyed to the phase table could never tick. The honest
       * test is geometric: the osculating apogee carried past half the way
       * to the Moon is a translunar orbit, whatever flew it. Half-way rather
       * than the sphere of influence because an orbit is a fact about the
       * ellipse; whether the Moon is *at* the far end is the next line's
       * business.
       */
      const el = live.elements
      // The Earth–Moon span, from the live positions — the distance the
      // transfer is actually being flown across this frame, not a mean.
      const em = Math.hypot(
        live.pos.moon.x - live.pos.earth.x,
        live.pos.moon.y - live.pos.earth.y,
        live.pos.moon.z - live.pos.earth.z,
      )
      const halfway = 0.55 * (em || 384.4e6)
      const injected = el.apogeeRadius > halfway && el.perigee > 100e3
      return {
        done: injected,
        progress: injected
          ? 1
          : Math.min(
              1,
              Math.max(0, (el.apogeeRadius - SHIP_PARKING) / (halfway - SHIP_PARKING)),
            ),
      }
    }
    case 'lunarSoi': {
      // The Moon's sphere of influence, off the same value refreshDerived
      // publishes each frame (the Laplace relation, soi.js).
      const soi = live.lunarSOI || 66_100e3
      const d = Math.hypot(
        live.pos.ship.x - live.pos.moon.x,
        live.pos.ship.y - live.pos.moon.y,
        live.pos.ship.z - live.pos.moon.z,
      )
      return { done: d < soi, progress: Math.max(0, Math.min(1, 1 - (d - soi) / 3.2e8)) }
    }
    case 'lunarOrbit': {
      /*
       * In lunar orbit, read from the selenocentric conic for the same
       * reason `tli` reads from the geocentric one: the sequencer's LOI_BURN
       * phase is computer work, and an Aldrin wing never walks through it.
       * Bound (eccentricity under 1), perigee above the surface, inside the
       * sphere of influence — that is lunar orbit, however the burn was
       * planned. A trajectory still on approach reads eccentricity ≥ 1 in
       * the Moon's frame, and a suborbital lob reads perigee below the
       * surface; neither is an orbit.
       */
      const l = live.lunar
      const soi = live.lunarSOI || 66_100e3
      const captured = l.perigee > 10e3 && l.eccentricity < 1 && l.altitude < soi
      return {
        done: captured,
        progress: captured
          ? 1
          : Math.min(1, Math.max(0, 1 - (distanceToMoon() - soi) / 3.2e8)),
      }
    }
    case 'landing': {
      // On the surface and slow: the same test the sequencer's own lunar
      // hold makes, read from the live state rather than the phase table.
      // Off `INDEX` — the slot map the integrator itself is laid out by —
      // not off a `live.index` that does not exist. This was a TypeError
      // waiting for the first pilot to reach the surface; nothing in the
      // harness had ever run this branch, because the harness never lands.
      const s = live.sim.state
      const o = INDEX.ship * 6
      const m = INDEX.moon * 6
      const rx = s[o] - s[m]
      const ry = s[o + 1] - s[m + 1]
      const rz = s[o + 2] - s[m + 2]
      const r = Math.sqrt(rx * rx + ry * ry + rz * rz)
      const onGround = r - BODIES.moon.radius < 60
      const dvx = s[o + 3] - s[m + 3]
      const dvy = s[o + 4] - s[m + 4]
      const dvz = s[o + 5] - s[m + 5]
      const slow = Math.sqrt(dvx * dvx + dvy * dvy + dvz * dvz) < 2.5
      return { done: onGround && slow, progress: Math.max(0, Math.min(1, 1 - (r - BODIES.moon.radius) / 20e3)) }
    }
    case 'home': {
      const d = Math.hypot(
        live.pos.ship.x - live.pos.earth.x,
        live.pos.ship.y - live.pos.earth.y,
        live.pos.ship.z - live.pos.earth.z,
      )
      return { done: d < BODIES.earth.radius + 200e3, progress: Math.max(0, Math.min(1, 1 - (d - 8e6) / 3.8e8)) }
    }
    case 'splashdown':
      return { done: reached('SPLASHDOWN'), progress: reached('SPLASHDOWN') ? 1 : 0 }
    case 'photograph': {
      /*
       * Take a photograph. The counter is this module's own — Photograph.jsx
       * notes each plate here — so the check reads a count taken since the
       * contract was armed, not a lifetime total.
       */
      const taken = photographs - (program.plates0 ?? 0)
      const want = o.count ?? 1
      return { done: taken >= want, progress: Math.min(1, taken / want) }
    }
    case 'proximity': {
      /*
       * Come close to something. Rendezvous is the honest hard part of
       * spaceflight — matching an orbit costs more delta-v than reaching the
       * Moon — and the contracts pay it respect: the target is read from the
       * integrator's own state vector, the same slots everything else flies
       * by, so there is no shortcut around the phasing.
       */
      const s = live.sim.state
      const i = INDEX[o.body]
      const oSlot = INDEX.ship * 6
      if (i == null) return { done: false, progress: 0 }
      const t = i * 6
      const d = Math.hypot(s[oSlot] - s[t], s[oSlot + 1] - s[t + 1], s[oSlot + 2] - s[t + 2])
      const want = (o.km ?? 100) * 1000
      return { done: d < want, progress: Math.max(0, Math.min(1, 1 - (d - want) / 2e6)) }
    }
    case 'inclination': {
      const deg = live.elements.inclination * (180 / Math.PI)
      const want = o.deg ?? 90
      return { done: deg >= want, progress: Math.min(1, deg / want) }
    }
    case 'apoapsis': {
      const km = live.elements.apogee / 1000
      const want = o.km ?? 10_000
      return { done: km >= want, progress: Math.min(1, km / want) }
    }
    default:
      return { done: false, progress: 0 }
  }
}

/** |ship − moon| in metres, off the live positions. */
function distanceToMoon() {
  return Math.hypot(
    live.pos.ship.x - live.pos.moon.x,
    live.pos.ship.y - live.pos.moon.y,
    live.pos.ship.z - live.pos.moon.z,
  )
}

/** The parking altitude SHIP targets; wired beside the phase table. */
let SHIP_PARKING = 185e3
export function __wireParking(alt) {
  SHIP_PARKING = alt
}

/**
 * Photographs taken this session, noted by the photograph component and read
 * by the `photograph` check. A counter, not an import of the logbook: the
 * logbook persists across flights and the contracts measure *this* flight.
 */
export let photographs = 0
export function notePhotograph() {
  photographs += 1
}

/**
 * The contracts: jobs a pilot takes, not routes a planner prices.
 *
 * They ride exactly the machinery the routes ride — objectives evaluated from
 * the simulation, a checklist riding the instruments, arming through the same
 * gate — because a job and a route differ in whose idea it was, not in what
 * the flight model owes it. The board's realism is the point: nothing here
 * shoots at anybody. The work of spaceflight — reaching orbit, phasing toward
 * a station, raising an ellipse, coming home — *is* the game.
 */
export const CONTRACTS = [
  {
    id: 'contract-first-light',
    name: 'First Light',
    group: 'Contract',
    brief: 'Reach orbit and take a photograph of the Earth from it. The plate is yours to keep.',
    vessel: 'apollo8',
    sites: ['ksc', 'kourou', 'baikonur', 'vandenberg'],
    target: 'contract',
    wings: ['trainee', 'aviator', 'aldrin', 'karman'],
    contract: true,
    legs: [{ name: 'Ascent to parking orbit', dv: 9_400 }],
    objectives: [
      { id: 'orbit', label: 'Reach a parking orbit', check: 'orbit' },
      { id: 'photo', label: 'Photograph the Earth from orbit', check: 'photograph' },
    ],
    order: 1,
  },
  {
    id: 'contract-station',
    name: 'Station Approach',
    group: 'Contract',
    brief: 'Close to within 100 km of the station. The phasing is the work: launch when the orbit says, not when you feel like it.',
    vessel: 'apollo8',
    sites: ['ksc', 'kourou', 'baikonur', 'vandenberg'],
    target: 'contract',
    wings: ['trainee', 'aviator', 'aldrin', 'karman'],
    contract: true,
    legs: [
      { name: 'Ascent to parking orbit', dv: 9_400 },
      { name: 'Phasing burns', dv: 120 },
    ],
    objectives: [
      { id: 'orbit', label: 'Reach a parking orbit', check: 'orbit' },
      { id: 'close', label: 'Close to within 100 km of the station', check: 'proximity', body: 'iss', km: 100 },
    ],
    order: 2,
  },
  {
    id: 'contract-polar',
    name: 'Polar Sentinel',
    group: 'Contract',
    brief: 'Orbit over the poles — past 95 degrees. Vandenberg throws south for exactly this; the dogleg is priced in.',
    vessel: 'apollo8',
    sites: ['vandenberg'],
    target: 'contract',
    wings: ['trainee', 'aviator', 'aldrin', 'karman'],
    contract: true,
    legs: [{ name: 'Ascent to polar orbit', dv: 9_600 }],
    objectives: [
      { id: 'orbit', label: 'Reach a parking orbit', check: 'orbit' },
      { id: 'inc', label: 'Fly past 95° of inclination', check: 'inclination', deg: 95 },
    ],
    order: 3,
  },
  {
    id: 'contract-high-road',
    name: 'The High Road',
    group: 'Contract',
    brief: 'Raise an ellipse a tenth of the way to the Moon and live in it for an orbit. Apoapsis past 10,000 km.',
    vessel: 'apollo8',
    sites: ['ksc', 'kourou', 'baikonur', 'vandenberg'],
    target: 'contract',
    wings: ['trainee', 'aviator', 'aldrin', 'karman'],
    contract: true,
    legs: [
      { name: 'Ascent to parking orbit', dv: 9_400 },
      { name: 'Raise the ellipse', dv: 2_400 },
    ],
    objectives: [
      { id: 'orbit', label: 'Reach a parking orbit', check: 'orbit' },
      { id: 'high', label: 'Raise apoapsis past 10,000 km', check: 'apoapsis', km: 10_000 },
    ],
    order: 4,
  },
  {
    id: 'contract-far-side',
    name: 'Far-Side Solo',
    group: 'Contract',
    brief: 'The Apollo 8 loop as a job: brake into lunar orbit behind the far side, where no one on Earth can see you.',
    vessel: 'apollo8',
    sites: ['ksc', 'kourou', 'baikonur', 'vandenberg'],
    target: 'contract',
    wings: ['aviator', 'aldrin', 'karman'],
    contract: true,
    legs: [
      { name: 'Ascent to parking orbit', dv: 9_400 },
      { name: 'Trans-lunar injection', dv: 3_050 },
      { name: 'Lunar orbit insertion', dv: 890 },
    ],
    objectives: [
      { id: 'tli', label: 'Injected toward the Moon', check: 'tli' },
      { id: 'loi', label: 'In lunar orbit', check: 'lunarOrbit' },
    ],
    order: 5,
  },]

/**
 * Arm a contract. The wing is the route's freest unless the board says
 * otherwise — same rule the deep link keeps.
 */
export function armContract(def) {
  return armProgram(def, def.wings[0] ?? 'trainee')
}

/* ---------------------------------------------------------------- *
 * The story
 * ---------------------------------------------------------------- */

/**
 * Six flights, in order — the career of a pilot in miniature.
 *
 * A contract is someone else's idea of work; a preset is someone else's
 * flight. What neither gives a newcomer is an *order*: the boards list
 * everything at once, and the hardest thing in orbital mechanics has always
 * been knowing what to learn next. The story is that order, told the way
 * the programme itself was — orbit, then station, then high, then the
 * crossing, then the far side, then down. Each chapter is a program in
 * every mechanical sense: legs priced by the rocket equation, objectives
 * evaluated from the live state, the same checklist riding the instruments.
 * What makes it a story is only that each one unlocks the next, and that
 * the briefs say what the flight is *for*.
 *
 * Every chapter arms with the Trainee wing — the computer flies the book
 * parts, the pilot reads the checklist — because a story that demands
 * mastery in chapter one is a story nobody finishes. The wings a pilot
 * flies the chapters with are their own business; the ladder is still
 * there, and `verify-programs` still holds every leg price against the
 * stack, exactly as it does for the routes and the jobs.
 */
export const STORY = [
  {
    id: 'story-first-orbit',
    name: 'First Orbit',
    group: 'Story',
    story: true,
    brief: 'Everything before this was rehearsal. Clear the tower, ride the gravity turn, and come around the far side of the planet with the spacecraft still worth flying. Up is the easy part; sideways is what costs.',
    vessel: 'apollo8',
    sites: ['ksc', 'kourou', 'baikonur', 'vandenberg'],
    target: 'earth-orbit',
    wings: ['trainee', 'aviator', 'aldrin'],
    legs: [{ name: 'Ascent to parking orbit', dv: 9_400 }],
    objectives: [
      { id: 'lift', label: 'Clear the tower', check: 'liftoff' },
      { id: 'orbit', label: 'Arrive in orbit, whole', check: 'orbit' },
    ],
    order: 1,
  },
  {
    id: 'story-rendezvous',
    name: 'Rendezvous',
    group: 'Story',
    story: true,
    brief: 'A station is a place with no address. Launch when the orbit says — catching up is flown at liftoff or not at all — and close to within a hundred kilometres of the one other thing moving up here with you.',
    vessel: 'apollo8',
    sites: ['ksc', 'kourou', 'baikonur', 'vandenberg'],
    target: 'earth-orbit',
    wings: ['trainee', 'aviator', 'aldrin'],
    legs: [
      { name: 'Ascent to parking orbit', dv: 9_400 },
      { name: 'Phasing burns', dv: 120 },
    ],
    objectives: [
      { id: 'orbit', label: 'Reach a parking orbit', check: 'orbit' },
      { id: 'close', label: 'Close to within 100 km of the station', check: 'proximity', body: 'iss', km: 100 },
    ],
    order: 2,
  },
  {
    id: 'story-alone',
    name: 'Alone in the Sky',
    group: 'Story',
    story: true,
    brief: 'Raise apoapsis a tenth of the way to the Moon and live up there for an orbit. From ten thousand kilometres the planet stops being a place and becomes a body — phase, terminator, weather — and the view is the instrument.',
    vessel: 'apollo8',
    sites: ['ksc', 'kourou', 'baikonur', 'vandenberg'],
    target: 'earth-orbit',
    wings: ['trainee', 'aviator', 'aldrin'],
    legs: [
      { name: 'Ascent to parking orbit', dv: 9_400 },
      { name: 'Raise the ellipse', dv: 2_400 },
    ],
    objectives: [
      { id: 'orbit', label: 'Reach a parking orbit', check: 'orbit' },
      { id: 'high', label: 'Raise apoapsis past 10,000 km', check: 'apoapsis', km: 10_000 },
    ],
    order: 3,
  },
  {
    id: 'story-crossing',
    name: 'The Crossing',
    group: 'Story',
    story: true,
    brief: 'The burn that commits you. Trans-lunar injection is minutes of thrust with no way to check the arithmetic twice; after it, the Moon does the navigating. Let its gravity take you into its reach.',
    vessel: 'apollo8',
    sites: ['ksc', 'kourou', 'baikonur', 'vandenberg'],
    target: 'free-return',
    wings: ['trainee', 'aviator', 'aldrin'],
    legs: [
      { name: 'Ascent to parking orbit', dv: 9_400 },
      { name: 'Trans-lunar injection', dv: 3_050 },
      { name: 'Mid-course corrections', dv: 60 },
    ],
    objectives: [
      { id: 'orbit', label: 'Reach a parking orbit', check: 'orbit' },
      { id: 'tli', label: 'Injected toward the Moon', check: 'tli' },
      { id: 'soi', label: 'Into the Moon\'s reach', check: 'lunarSoi' },
    ],
    order: 4,
  },
  {
    id: 'story-far-side',
    name: 'Far Side',
    group: 'Story',
    story: true,
    brief: 'Brake into lunar orbit where Earth cannot see you — behind the Moon, alone with the spacecraft, LOS gone for half an hour at a stretch. Photograph what no one on the ground can watch you photograph.',
    vessel: 'apollo8',
    sites: ['ksc', 'kourou', 'baikonur', 'vandenberg'],
    target: 'lunar-orbit',
    wings: ['trainee', 'aviator', 'aldrin'],
    legs: [
      { name: 'Ascent to parking orbit', dv: 9_400 },
      { name: 'Trans-lunar injection', dv: 3_050 },
      { name: 'Lunar orbit insertion', dv: 890 },
    ],
    objectives: [
      { id: 'tli', label: 'Injected toward the Moon', check: 'tli' },
      { id: 'loi', label: 'In lunar orbit', check: 'lunarOrbit' },
      { id: 'photo', label: 'Photograph the Moon from orbit', check: 'photograph' },
    ],
    order: 5,
  },
  {
    /*
     * The last chapter, and why it is one-way.
     *
     * The stack that carried the crossing cannot carry a ride home out of
     * lunar orbit — the pricing is the Descent program's, verified against
     * the vehicle's own numbers in `verify-programs`, and it closes with
     * 670 m/s of margin for a hand-flown approach. That is not a limitation
     * of the sim; it is why Apollo had a lander, learned here at the scale
     * of a checklist instead of the scale of a programme. What replaces the
     * ride home is the ending the presets never offered: press G on the
     * surface and stand on it.
     */
    id: 'story-contact',
    name: 'Contact',
    group: 'Story',
    story: true,
    brief: 'The last ten kilometres by hand, down to the surface — one way, because the stack that brought you cannot bring you back. Set down gently, then press G and stand on it. That is the ending.',
    vessel: 'apollo8',
    sites: ['ksc', 'kourou', 'baikonur', 'vandenberg'],
    target: 'lunar-descent',
    wings: ['trainee', 'aviator', 'aldrin'],
    legs: [
      { name: 'Ascent to parking orbit', dv: 9_400 },
      { name: 'Trans-lunar injection', dv: 3_050 },
      { name: 'Lunar orbit insertion', dv: 890 },
      { name: 'Powered descent', dv: 2_000 },
    ],
    objectives: [
      { id: 'orbit', label: 'Reach a parking orbit', check: 'orbit' },
      { id: 'tli', label: 'Injected toward the Moon', check: 'tli' },
      { id: 'loi', label: 'In lunar orbit', check: 'lunarOrbit' },
      { id: 'land', label: 'Set down on the Moon', check: 'landing' },
    ],
    order: 6,
  },
]

/* ---------------------------------------------------------------- *
 * The programs
 * ---------------------------------------------------------------- */

/**
 * Δv legs, priced for the plan. Each leg names the burn and its cost in
 * m/s *as priced for the Apollo 8 stack*; `verify-programs` holds every
 * program's total against `stackDeltaV` at both fuel scales and from both
 * hemispheres of sites.
 */
export const PROGRAMS = [
  {
    id: 'orbit-run',
    name: 'Orbit Run',
    group: 'Starter',
    blurb: 'One clean ascent, one circular orbit, one deorbit and home. The whole craft of spaceflight in ninety minutes.',
    vessel: 'apollo8',
    sites: ['ksc', 'kourou', 'baikonur', 'vandenberg'],
    target: 'earth-orbit',
    wings: ['trainee', 'aviator', 'aldrin', 'karman'],
    legs: [
      { name: 'Ascent to parking orbit', dv: 9_400 },
      { name: 'Deorbit burn', dv: 120 },
    ],
    objectives: [
      { id: 'lift', label: 'Clear the tower', check: 'liftoff' },
      { id: 'orbit', label: 'Parking orbit, 185 km', check: 'orbit' },
      { id: 'home', label: 'Come home through the air', check: 'splashdown' },
    ],
    order: 1,
  },
  {
    id: 'free-return',
    name: 'Free Return',
    group: 'Flyer',
    blurb: 'Trans-lunar injection on a free-return trajectory — pass behind the Moon and let its gravity bring you home.',
    vessel: 'apollo8',
    sites: ['ksc', 'kourou', 'baikonur', 'vandenberg'],
    target: 'free-return',
    wings: ['aviator', 'aldrin', 'karman'],
    legs: [
      { name: 'Ascent to parking orbit', dv: 9_400 },
      { name: 'Trans-lunar injection', dv: 3_050 },
      { name: 'Mid-course corrections', dv: 60 },
    ],
    objectives: [
      { id: 'orbit', label: 'Parking orbit', check: 'orbit' },
      { id: 'tli', label: 'Injected toward the Moon', check: 'tli' },
      { id: 'soi', label: 'Into the Moon\'s reach', check: 'lunarSoi' },
      { id: 'home', label: 'Fall home past the Moon', check: 'splashdown' },
    ],
    order: 2,
  },
  {
    id: 'lunar-orbit',
    name: 'Lunar Orbit',
    group: 'Flyer',
    blurb: 'Brake into lunar orbit behind the far side, fly ten revs over the surface, then make the burn for home.',
    vessel: 'apollo8',
    sites: ['ksc', 'kourou', 'baikonur', 'vandenberg'],
    target: 'lunar-orbit',
    wings: ['aviator', 'aldrin', 'karman'],
    legs: [
      { name: 'Ascent to parking orbit', dv: 9_400 },
      { name: 'Trans-lunar injection', dv: 3_050 },
      { name: 'Lunar orbit insertion', dv: 890 },
      { name: 'Trans-Earth injection', dv: 1_000 },
    ],
    objectives: [
      { id: 'orbit', label: 'Parking orbit', check: 'orbit' },
      { id: 'tli', label: 'Injected toward the Moon', check: 'tli' },
      { id: 'loi', label: 'In lunar orbit', check: 'lunarOrbit' },
      { id: 'home', label: 'Burn for home', check: 'splashdown' },
    ],
    order: 3,
  },
  {
    /*
     * The one-way landing, and why it is one-way.
     *
     * The first draft of this program offered "land and come home" at a
     * priced 18.2 km/s — and the budget check caught it: the full stack
     * delivers 16.0. This is not a pricing error to be tuned away; it is
     * the reason Apollo needed a two-part vehicle. After TLI the spent
     * S-IVB is discarded and the service module alone holds about 2.9 km/s,
     * against roughly 5.7 for descent, ascent and TEI. Apollo 8 did not
     * land because Apollo 8 *could not* land, and a planner that offered
     * the route would be selling a lie the pilot would only discover in
     * lunar orbit.
     *
     * So the program is the descent, honestly priced at 15.34 against a
     * 16.0 stack — 670 m/s of margin for a hand-flown approach, which is
     * genuinely tight because genuinely hard — and the objective list ends
     * where the vehicle does. What replaces the ride home is the thing no
     * preset ever offered: press G on the surface and stand on it. The
     * return is the next program a pilot will ask for, and it will need a
     * lander — which is the same lesson the real programme learned, learned
     * in the simulator instead of in orbit.
     */
    id: 'lunar-descent',
    name: 'Descent',
    group: 'Aldrin',
    blurb: 'Fly to the Moon, brake behind the far side, and take the last ten kilometres by hand — down to the surface, one way. Walk when you get there.',
    vessel: 'apollo8',
    sites: ['ksc', 'kourou', 'baikonur', 'vandenberg'],
    target: 'lunar-descent',
    wings: ['aldrin'],
    legs: [
      { name: 'Ascent to parking orbit', dv: 9_400 },
      { name: 'Trans-lunar injection', dv: 3_050 },
      { name: 'Lunar orbit insertion', dv: 890 },
      { name: 'Powered descent', dv: 2_000 },
    ],
    objectives: [
      { id: 'orbit', label: 'Parking orbit', check: 'orbit' },
      { id: 'tli', label: 'Injected toward the Moon', check: 'tli' },
      { id: 'loi', label: 'In lunar orbit', check: 'lunarOrbit' },
      { id: 'land', label: 'Set down on the Moon', check: 'landing' },
    ],
    order: 4,
  },
]

/* ---------------------------------------------------------------- *
 * Program runtime
 * ---------------------------------------------------------------- */

/**
 * The armed program: one at a time, module state like `mission` itself.
 * Null until `armProgram` runs, which is the planner's hand-off.
 */
export const program = {
  def: null,
  wing: null,
  objectives: [],
  armed: false,
  started: false,
  /** Set true the first time the mission reaches a phase past the count. */
  handedOff: false,
}

/**
 * Arm a program.
 *
 * `parking` is the vessel's parking altitude for the orbit check. The fuel
 * load needs no wiring: resetMission reads `wingFuel()` off the armed
 * program itself and drains the stack there, so the fraction lives in
 * exactly one place — `KARMAN_FUEL`, above.
 */
export function armProgram(def, wing, parking = 185e3) {
  program.def = def
  program.wing = WINGS[wing] ?? wing
  program.objectives = def.objectives.map((o) => ({ ...o, done: false, progress: 0 }))
  program.armed = true
  program.started = false
  program.handedOff = false
  // The photograph check measures *this* flight, so the baseline is taken here.
  program.plates0 = photographs
  __wireParking(parking)
  return program
}

export function disarmProgram() {
  program.def = null
  program.wing = null
  program.objectives = []
  program.armed = false
  program.started = false
  program.handedOff = false
}

/**
 * Advance the program: latch objectives, then evaluate hand-off and wing
 * boundaries.
 *
 * Runs inside `updateMission`'s tail — after the sequencer has acted this
 * frame, so every read here is of the frame's own state. Called with the
 * same arguments the sequencer itself receives.
 */
export function tickProgram(dt, simDt = dt) {
  if (!program.armed || !program.def) return
  if (!program.started) program.started = true

  // Objectives first, so a boundary that fires this frame still reports the
  // objective it made true.
  for (const o of program.objectives) {
    if (o.done) continue
    const { done, progress } = evaluate(o)
    o.progress = progress
    if (done) {
      o.done = true
      o.doneAt = mission.t
    }
  }

  /*
   * A story chapter is finished when its last objective latches — recorded
   * the same tick it completes, from the same read of the sim the checklist
   * trusts, and never from a flag the UI set. `recordStory` is idempotent,
   * so the every-frame cost of a completed chapter is one array scan.
   */
  if (program.def.story && program.objectives.length && program.objectives.every((o) => o.done)) {
    recordStory(program.def.id, mission.t)
  }
}

/** Whether a wing holds a capability — the sequencer gate's single question. */
export const wingHolds = (capability) => {
  if (!program.armed || !program.wing) return true
  return program.wing.holds.includes(capability)
}

/** The fuel scale to load, or 1 for a full load. */
export const wingFuel = () => {
  if (!program.armed || !program.wing) return 1
  return program.wing.id === 'karman' ? KARMAN_FUEL : 1
}

/**
 * Whether the stick changes hands at the door out of insertion.
 *
 * A capability read cannot answer this. `wingHolds('burns')` is true both
 * for a Trainee whose computer has just finished *its* last burn and for a
 * preset with nothing armed at all — the same answer meaning opposite
 * things, and the CIRCULARISE exit cannot send a scripted mission into the
 * pilot's cockpit. (A first draft read the capability and would have done
 * exactly that; the flight in `verify-programs` is what exposed it.)
 *
 * The honest discriminator is the armed contract: a Trainee program *names*
 * insertion as computer work, so when its CIRCULARISE ends, the planner's
 * promise — from the parking orbit, the spacecraft is yours — falls due.
 * Nothing armed, or any other wing — Aviator took the stick at MECO, Aldrin
 * and Kármán at the count — and the sequencer keeps the vehicle.
 */
export function handsOffAfterInsertion() {
  return program.armed && program.wing?.id === 'trainee'
}

/** Progress through the checklist, 0..1, for the planner strip. */
export function programProgress() {
  if (!program.objectives.length) return 0
  return program.objectives.filter((o) => o.done).length / program.objectives.length
}

/**
 * A program requested from outside the app, before anything is built —
 * `PERIAPSIS_PROGRAM=orbit-run` under Node, `?program=orbit-run` in a
 * browser. Read once at load, the same contract `requested.js` keeps for
 * the vessel and the pad; the *wing* stays a choice made in the planner,
 * because a link that pinned the difficulty would be a link deciding how
 * good a pilot you are.
 */
export function requestedProgram() {
  const fromEnv = typeof process !== 'undefined' && process.env ? process.env.PERIAPSIS_PROGRAM : undefined
  const search = typeof window !== 'undefined' && window.location ? window.location.search : ''
  const fromUrl = search ? new URLSearchParams(search).get('program') : null
  const id = fromEnv ?? fromUrl
  if (!id) return null
  const def = PROGRAMS.find((p) => p.id === id)
  if (!def) {
    console.warn(`[periapsis] unknown program "${id}"; ignored. Known: ${PROGRAMS.map((p) => p.id).join(', ')}`)
    return null
  }
  return def
}
