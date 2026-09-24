import { live } from './live.js'
import { currentPhase, mission } from './mission.js'
import { nodes } from './nodes.js'
import { ship } from './ship.js'
import { stageOfCount } from './countdown.js'
import { APOLLO11, DOCKING_REACH, lunar } from './lunarMission.js'
import { INDEX } from './system.js'

/**
 * What is happening, and why.
 *
 * The interface said what the vehicle was *doing* — a phase label, a wall of
 * figures — and never what any of it was for. "Awaiting TLI window" is accurate
 * and tells a reader nothing: not what a window is, not why one has to be
 * waited for, not why the wait is three days rather than three minutes. A
 * simulator that is right about the physics and silent about the reasons is a
 * telemetry feed, and the people this was built for are not flight controllers.
 *
 * So each phase gets a sentence or two of commentary, and the rules are:
 *
 * **It explains rather than narrates.** "The engine is burning" is visible on
 * screen already. Why it is burning *now*, at this point in the orbit, is not.
 *
 * **It reads the simulation.** Where a number carries the argument it is the
 * live one, taken at the moment of reading, so the commentary cannot drift from
 * what the instruments say beside it. Several lines change as you watch them.
 *
 * **It is honest about the model.** Where the simulator is doing something
 * simpler than reality, the line says so rather than letting a confident
 * sentence imply more fidelity than is there.
 *
 * The entries are functions of nothing — they read module state directly —
 * because they are called once a second by a panel, not per frame, and a
 * closure per phase is cheaper to read than an argument list every one of them
 * would have to declare and most would ignore.
 */

const km = (m) => `${(m / 1e3).toLocaleString('en-US', { maximumFractionDigits: 0 })} km`
const hours = (s) => {
  if (!(s > 0)) return '—'
  const h = s / 3600
  return h < 1 ? `${Math.round(s / 60)} min` : h < 48 ? `${h.toFixed(1)} h` : `${(h / 24).toFixed(1)} days`
}

/** The raise the loiter plan is flying, if it planned one. */
function raiseLine() {
  const lo = mission.tli.loiter
  if (!lo.planned) return 'The flight computer is still working out whether this orbit will last.'
  if (!lo.needed) {
    return (
      `This orbit outlives its wait on its own — ${hours(lo.lifetime)} of life against ` +
      `${hours(lo.wait)} of waiting — so nothing needs to be done to it.`
    )
  }
  const dv = (lo.dv1 + lo.dv2).toFixed(1)
  return (
    `This orbit would come down before its window opens: ${hours(lo.lifetime)} of life against ` +
    `${hours(lo.wait)} of waiting. So the computer has planned two burns, ${dv} m/s in total, ` +
    `to raise it just enough that it decays back to this altitude exactly as the window arrives.`
  )
}

export const COMMENTARY = {
  /*
   * On a watched launch the minute is a sequence, so the line follows it: each
   * event gets its own sentence, said when it happens and replaced when the next
   * one does. The harness's ten-second count has none of those events and keeps
   * the single line it always had.
   */
  PRE_LAUNCH: () => {
    const t = mission.countdown
    const clock = t > 0 ? `T−${t.toFixed(1)} s. ` : 'Clamps released. '
    if (!mission.groundSequence) {
      return (
        `${clock}On the pad, held down, with the world turning underneath. The launch window is ` +
        `set by where the Moon will be when the vehicle arrives, not by where it is now.`
      )
    }
    switch (stageOfCount(mission.t)) {
      case 'ignition':
        return (
          `${clock}Ignition — with the vehicle still held down. The engines come up to thrust ` +
          `over a couple of seconds, and the hold-downs keep it on the pad until all of them ` +
          `have: if one does not, it can still be shut down here, and nowhere after.`
        )
      case 'deluge':
        return (
          `${clock}Sound suppression. Water floods the pad and the flame trench, because the ` +
          `noise of the engines reflecting off concrete is loud enough to damage the vehicle ` +
          `it is launching. The water absorbs it; what comes off the trench next is steam.`
        )
      case 'arms':
        return (
          `${clock}The swing arms are pulling back. They carried propellant, power and air to ` +
          `the vehicle until a moment ago, and they have to be clear of it before it moves.`
        )
      default:
        return (
          `${clock}Fuelled and holding. The white plumes off the side are liquid oxygen boiling ` +
          `away at −183 °C and being vented — cold enough that the vapour is heavier than air ` +
          `and falls down the vehicle rather than rising off it.`
        )
    }
  },

  LIFTOFF: () =>
    'Full thrust against a vehicle that is mostly propellant. It climbs slowly at first because ' +
    'it is heaviest at the moment it has the least speed to show for it.',

  PITCH_KICK: () =>
    'A few degrees off vertical, deliberately. Everything after this is the vehicle falling ' +
    'around the planet rather than being held up by its engines.',

  GRAVITY_TURN: () =>
    `Thrust stays along the vehicle's own axis and gravity does the steering — the trajectory ` +
    `bends by being pulled, not by being flown. Now ${km(live.elements.altitude)} up at ` +
    `${(live.elements.speed / 1000).toFixed(2)} km/s.`,

  STAGING: () =>
    'The spent stage is dropped because carrying an empty tank costs the same as carrying a full ' +
    'one. Every kilogram released here is a kilogram the next engine does not have to accelerate.',

  MECO: () =>
    'Engine cutoff. The vehicle is now on a ballistic arc — it will coast up to the top of that ' +
    'arc with no thrust at all, because thrust spent at the bottom of an orbit is wasted.',

  COAST_TO_APOAPSIS: () =>
    `Falling upward. It reaches the top of the arc in ` +
    `${hours(live.elements.timeToApoapsis)}, and the circularising burn happens there because ` +
    `that is where the orbit is cheapest to change.`,

  CIRCULARISE: () =>
    'Burning horizontally at the top of the arc. Without this the vehicle comes straight back ' +
    'down — the arc it is on still has its low point inside the atmosphere.',

  COAST: () =>
    `A closed parking orbit: ${km(live.elements.perigee)} at its lowest, ` +
    `${km(live.elements.apogee)} at its highest. From here the mission waits for the geometry ` +
    `rather than for the vehicle.`,

  TLI_ALIGN: raiseLine,

  TLI_BURN: () =>
    'Trans-lunar injection — the burn that stops this being an orbit of Earth. It happens on the ' +
    'far side from the Moon, because a burn raises the *opposite* side of an orbit, and the ' +
    'opposite side is where the Moon has to be met.',

  TRANS_LUNAR: () =>
    `Coasting out, and slowing the whole way: ${(live.elements.speed / 1000).toFixed(3)} km/s now, ` +
    `against 10.8 at the end of the burn. Earth's gravity is still the thing in charge, and it ` +
    `will be for most of the crossing.`,

  MCC_SOLVE: () =>
    'Midcourse targeting. The injection was accurate to a few metres a second, and a few metres a ' +
    'second three days from the Moon is a miss measured in thousands of kilometres — so the ' +
    'computer is solving for the correction now, while it is still cheap.',

  MCC_BURN: () =>
    'A small correction, made early on purpose. The same fix bought closer in would cost many ' +
    'times as much, because the error has had less distance to grow into.',

  /*
   * `live.lunarRange` is the vehicle's own distance to the Moon. The first
   * draft of this line reached for `live.metric.shipMoon`, which does not
   * exist — `metric` holds Sol-to-Terra and Terra-to-Luna, both distances
   * between *bodies* — and fell back to the Earth-Moon separation, so it would
   * have told the reader the vehicle was 384,000 km from the Moon at the exact
   * moment it was closing on it. A commentary line that quietly prints the
   * wrong body's number is worse than no line.
   */
  LUNAR_APPROACH: () => {
    const inside = live.lunarRange < live.lunarSOI
    return inside
      ? `Inside the Moon's influence now, ${km(live.lunarRange)} from it, and being pulled ahead ` +
          `rather than held back — the vehicle is speeding up again for the first time since the ` +
          `injection burn.`
      : `Closing on the Moon, ${km(live.lunarRange)} out. Earth is still the body in charge: its ` +
          `pull does not hand over until about ${km(live.lunarSOI)}, and until then the vehicle ` +
          `is still slowing down.`
  },

  LOI_ALIGN: () =>
    'Turning retrograde for lunar orbit insertion. The burn has to fire backwards along the path ' +
    'to slow the vehicle enough for the Moon to keep it; miss the attitude and the vehicle simply ' +
    'flies past and comes home.',

  LOI_BURN: () =>
    'Braking into lunar orbit, on the far side, out of contact with Earth — which is where this ' +
    'burn has always had to happen and why the real one was flown on the back of the Moon with ' +
    'nobody listening.',

  /*
   * `live.lunar`, not `live.elements`. The elements on `live` are geocentric,
   * and reading them here printed "in orbit around the Moon: 391,987 km by
   * 3,984,480 km" — the vehicle's orbit about *Earth*, which at this point is
   * an enormous ellipse and says nothing about the hundred-kilometre lunar
   * orbit it is actually in. The selenocentric set is the one that means
   * anything once the Moon is the attractor.
   */
  LUNAR_ORBIT: () =>
    `In orbit around the Moon: ${km(live.lunar.perigee)} by ${km(live.lunar.apogee)}. No ` +
    `atmosphere, so nothing decays here — this orbit is stable in a way no low Earth orbit is.`,

  TEI_ALIGN: () =>
    'Turning for trans-Earth injection. The Moon has no atmosphere to help slow anything down, so ' +
    'leaving costs very nearly what arriving did.',

  TEI_BURN: () =>
    'Burning out of lunar orbit for home. From here the vehicle is on a trajectory that ends in ' +
    "Earth's atmosphere, and the atmosphere does the rest of the braking for free.",

  TRANS_EARTH: () =>
    'Falling home, accelerating the whole way. It arrives at the atmosphere at about 11 km/s — ' +
    'the speed it left Earth with, given back.',

  EI_SOLVE: () =>
    'Solving the entry corridor. Too shallow and the vehicle skips off the atmosphere back into ' +
    'space; too steep and the deceleration is unsurvivable. The gap between those is about a ' +
    'degree wide.',

  EI_BURN: () =>
    'Trimming the corridor. A few metres a second here is the difference between an entry and a ' +
    'ricochet.',

  SM_SEP: () =>
    'The service module goes, because only the capsule has a heat shield. Everything that is not ' +
    'behind that shield is about to stop existing.',

  RE_ENTRY: () =>
    `Entry. ${(live.decelG).toFixed(1)} g and ` +
    `${(live.totalFlux / 1e4).toFixed(0)} W/cm² on the shield — the vehicle is braking against ` +
    `air, and the heat is the kinetic energy it is getting rid of.`,

  DROGUE: () =>
    'Drogues out. They are small on purpose: opening a full canopy at this speed would tear it ' +
    'off, so these slow the capsule to a speed the mains can survive.',

  MAIN_CHUTES: () =>
    'Mains. From here it is an ordinary fall at an ordinary speed, which after the last four ' +
    'minutes is the whole point.',

  SPLASHDOWN: () =>
    'Down. The mission is over; the simulation keeps integrating, because that is what it does ' +
    'whether or not anyone is flying.',

  NODE_ALIGN: () => {
    const n = nodes.find((x) => !x.executed)
    return n
      ? `Turning for a planned burn: ${n.dv?.toFixed?.(1) ?? '—'} m/s, in ${hours(n.t - live.sim.t)}. ` +
          'The computer orients first and lights the engine on the clock, not the other way round.'
      : 'Turning for a planned burn.'
  },

  NODE_BURN: () =>
    'Flying a planned burn. The engine is aimed at a fixed direction in space rather than along ' +
    'the vehicle, so the delta-v arrives where the plan wanted it.',

  HALO_CAPTURE: () =>
    'Capturing onto a halo orbit — a path that goes around a point where Earth and Moon balance, ' +
    'rather than around either body. Nothing is holding it there but the two gravities and the ' +
    'motion between them, which is why it has to be corrected.',

  NRHO_COAST: () =>
    'Coasting on the near-rectilinear halo orbit. It is nearly a straight line through perilune ' +
    'and a long slow arc at the far end, which is what keeps the Gateway in sight of Earth almost ' +
    'all the time.',

  NRHO_STATION_KEEP: () =>
    'Station-keeping. A halo orbit is unstable — errors grow rather than average out — so it has ' +
    'to be nudged back roughly once a revolution, for a handful of metres a second.',

  /* --- Eagle, from Tranquility Base to Columbia --- */

  LUNAR_PRE_LAUNCH: () => {
    const clock = mission.running ? `T−${Math.max(0, mission.countdown).toFixed(0)} s. ` : ''
    return (
      `${clock}Eagle's ascent stage, on the descent stage it landed on, which stays behind as its ` +
      `launch pad. Columbia is ${distance(range())} away in its 60-mile orbit. Liftoff is timed by ` +
      `where Columbia is, not by the clock: the ascent has to end a set distance behind and below it.`
    )
  },

  LUNAR_LIFTOFF: () =>
    'Liftoff is ignition: the bolts joining the two stages fire as the ascent engine lights, into ' +
    "the top of the descent stage — 'fire in the hole' — stripping its insulation. Ten seconds " +
    'straight up to clear it and the ground.',

  LUNAR_ASCENT: () =>
    `Pitched over toward the west, the plane of Columbia's orbit. The ascent engine has one setting — ` +
    `3,500 lbf, no throttle — so the guidance steers the thrust instead, to arrive at 60,000 ft ` +
    `climbing at 32 ft/s and moving at 5,535. Now ${distance(live.lunar.altitude)} up at ` +
    `${(live.lunar.speed / 1000).toFixed(2)} km/s. (The law is explicit guidance of the family ` +
    `Apollo's P12 belongs to, not its code.)`,

  LUNAR_INSERTION: () =>
    `Engine off: in orbit, ${km(live.lunar.perigee)} by ${km(live.lunar.apogee)}.`,

  LM_COAST_CSI: () =>
    `In orbit, ${km(live.lunar.perigee)} by ${km(live.lunar.apogee)}, below and behind Columbia — ` +
    `and catching it, because a lower orbit is a faster one. At apolune, in ${hours(lunar.csiTime - live.sim.t)}, ` +
    `CSI adds ${ftps(lunar.csi?.dv ?? 0)} forward: the one burn that sets how fast Eagle gains from ` +
    'then on, and so when the terminal phase can begin. Its size was solved for Apollo 11’s TPI time.',

  LM_CSI: () =>
    `Coelliptic sequence initiation: ${ftps(lunar.csi?.dv ?? 0)} forward on the reaction control ` +
    'jets. The ascent engine is kept for an emergency; everything from here to docking is flown on ' +
    'the small thrusters.',

  LM_COAST_CDH: () =>
    `Half an orbit to the opposite apsis, where CDH will make the two orbits parallel. ${hours(lunar.cdhTime - live.sim.t)} to go.`,

  LM_CDH: () =>
    'Constant delta height: Eagle’s orbit is reshaped to follow Columbia’s at a fixed distance ' +
    'below it, all the way round — same line of apsides, same a × e. From here the angle Columbia ' +
    'stands above Eagle’s horizon climbs steadily, and that angle is the clock for TPI.',

  LM_COAST_TPI: () => {
    const dh = lunar.cdh ? ` ${km(lunar.cdh.dh)} below Columbia,` : ''
    return (
      `Coelliptic,${dh} gaining. Columbia is ${deg(lunar.elevation)} above Eagle’s horizon; at ` +
      `${deg(APOLLO11.tpiElevation)}, a burn along the line of sight carries Eagle up to it in 130° ` +
      'of orbit — a geometry chosen because errors in the burn barely move where it ends.'
    )
  },

  LM_TPI: () =>
    `Terminal phase initiation: ${ftps(lunar.tpi?.dv ?? 0)}, solved as a Lambert transfer to where ` +
    `Columbia will be 130° of orbit from now. Range ${distance(range())}.`,

  LM_TRANSFER: () =>
    `Coasting up to Columbia, ${distance(range())} to go. Two midcourse corrections, fifteen and ` +
    'thirty minutes after TPI, trim the errors out. Here they come out at hundredths of a foot a ' +
    'second: this Moon is a point mass, and the real one’s mascons made Apollo 11’s about one.',

  LM_BRAKING: () =>
    `Braking through the gates: the closing rate comes down in steps as the range does — 30 ft/s at ` +
    `a mile, 20 at half a mile, 10 at 1,500 ft, 5 at 500 — so there is always room to stop. ` +
    `${distance(range())}, closing at ${ftps(closing())}.`,

  LM_STATION_KEEP: () =>
    'Station-keeping, thirty metres apart, nothing closing. Apollo 11 held here about ten minutes, ' +
    'the two crews looking each other over before the docking.',

  LM_DOCKING: () =>
    `Collins flies Columbia the last metres at a tenth of a metre a second; Eagle holds attitude with ` +
    `its docking tunnel turned up to him. ${distance(Math.max(0, range() - DOCKING_REACH))} between the probe and the drogue.`,

  DOCKED: () =>
    `Docked, ${hms(lunar.dockedTime - lunar.liftoffTime)} after liftoff, at ${lunar.dockingSpeed.toFixed(2)} m/s. ` +
    'Apollo 11’s was 3:41:00. The crews move through the tunnel with the samples, and Eagle is ' +
    'cast off to stay in lunar orbit.',

  LOST: () =>
    'The vehicle is on a trajectory the mission cannot recover. The simulation keeps integrating ' +
    'it, because that is what the physics does.',
}

/* Lunar helpers: the state, read when the line is. */
const FT = 0.3048
const ftps = (v) => `${(v / FT).toFixed(1)} ft/s`
const deg = (r) => `${((r * 180) / Math.PI).toFixed(1)}°`
const distance = (m) => (m < 10e3 ? `${m.toFixed(0)} m` : km(m))
const hms = (s) => {
  const a = Math.max(0, Math.round(s))
  return `${Math.floor(a / 3600)}:${String(Math.floor((a % 3600) / 60)).padStart(2, '0')}:${String(a % 60).padStart(2, '0')}`
}
function range() {
  const s = live.sim.state
  const o = INDEX.ship * 6
  const t = INDEX.target * 6
  return Math.hypot(s[t] - s[o], s[t + 1] - s[o + 1], s[t + 2] - s[o + 2])
}
function closing() {
  const s = live.sim.state
  const o = INDEX.ship * 6
  const t = INDEX.target * 6
  const dx = s[t] - s[o]
  const dy = s[t + 1] - s[o + 1]
  const dz = s[t + 2] - s[o + 2]
  const r = Math.hypot(dx, dy, dz)
  return -((s[t + 3] - s[o + 3]) * dx + (s[t + 4] - s[o + 4]) * dy + (s[t + 5] - s[o + 5]) * dz) / r
}

/**
 * Phases that end something rather than lead to the next thing.
 *
 * Their commentary is worth reading once and then not forever: a line that sits
 * on screen for the rest of the session saying the mission is over is the
 * interface failing to notice that it is. `Commentary` retires these after a
 * while; everything else stays because something is still happening.
 */
export const TERMINAL = new Set(['SPLASHDOWN', 'DOCKED', 'LOST'])

/**
 * The line for the phase the vehicle is in, or null if that phase has none.
 *
 * Null rather than a placeholder: a panel with nothing to say should not be
 * drawn at all, and a phase that has been added without commentary should look
 * missing rather than look finished.
 */
export function commentaryNow() {
  const entry = COMMENTARY[currentPhase().id]
  if (!entry) return null
  try {
    return entry()
  } catch {
    /*
     * A commentary line reads live state, and live state has holes in it —
     * `timeToApoapsis` on an escape trajectory, a node that executed between
     * the lookup and the read. A thrown line must not take the HUD with it;
     * the panel simply says nothing that second.
     */
    return null
  }
}

/** Whether the vehicle is under power, which the panel uses to mark the line. */
export const commentaryIsBurning = () => ship.thrust > 0
