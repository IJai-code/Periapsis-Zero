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
 * The interface said what the vehicle was *doing*, a phase label, a wall of
 * figures, and never what any of it was for. "Awaiting TLI window" is accurate
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
 * The entries are functions of nothing, they read module state directly —
 * because they are called once a second by a panel, not per frame, and a
 * closure per phase is cheaper to read than an argument list every one of them
 * would have to declare and most would ignore.
 */

const km = (m) => `${(m / 1e3).toLocaleString('en-US', { maximumFractionDigits: 0 })} km`
const hours = (s) => {
  if (!(s > 0)) return '·'
  const h = s / 3600
  return h < 1 ? `${Math.round(s / 60)} min` : h < 48 ? `${h.toFixed(1)} h` : `${(h / 24).toFixed(1)} days`
}

/** The raise the loiter plan is flying, if it planned one. */
function raiseLine() {
  const lo = mission.tli.loiter
  if (!lo.planned) return 'The flight computer is still working out whether this orbit will last.'
  if (!lo.needed) {
    return (
      `This orbit lasts ${hours(lo.lifetime)}, longer than the ${hours(lo.wait)} wait for ` +
      `the Moon, so no burns are needed.`
    )
  }
  const dv = (lo.dv1 + lo.dv2).toFixed(1)
  return (
    `This orbit would decay in ${hours(lo.lifetime)}, but the launch window to the Moon is ` +
    `${hours(lo.wait)} away. So the computer has planned two small burns, ${dv} m/s in total, ` +
    `to raise the orbit just enough to last until then.`
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
        `${clock}On the pad, held down by clamps. The launch time is set by where the Moon will be ` +
        `when the ship gets there, not where it is now.`
      )
    }
    switch (stageOfCount(mission.t)) {
      case 'ignition':
        return (
          `${clock}Ignition. The clamps hold the rocket down while the engines reach full thrust. ` +
          `If one engine fails now, it can still be shut down safely.`
        )
      case 'deluge':
        return (
          `${clock}Water floods the pad. Engine noise bouncing off the concrete is loud enough to ` +
          `damage the rocket, and the water soaks it up. The white cloud you see next is steam.`
        )
      case 'arms':
        return (
          `${clock}The tower's arms swing away. They fed the rocket fuel, power and air until now, ` +
          `and must be clear before it moves.`
        )
      default:
        return (
          `${clock}Fuelled and waiting. The white vapour is liquid oxygen at −183 °C boiling off. ` +
          `It is so cold it sinks down the side of the rocket instead of rising.`
        )
    }
  },

  LIFTOFF: () =>
    'Liftoff. The rocket is mostly fuel right now, so it is at its heaviest and climbs slowly. ' +
    'It speeds up as the fuel burns away.',

  PITCH_KICK: () =>
    'The rocket tips a few degrees on purpose. From here it starts curving over toward orbit.',

  GRAVITY_TURN: () =>
    `Gravity turn: gravity slowly bends the path over toward horizontal. ` +
    `Now ${km(live.elements.altitude)} up at ${(live.elements.speed / 1000).toFixed(2)} km/s.`,

  STAGING: () =>
    'Staging. The empty stage drops away so the next engine has less weight to push.',

  MECO: () =>
    'Engine off. The ship now coasts up to the top of its arc with no thrust.',

  COAST_TO_APOAPSIS: () =>
    `Coasting up. It reaches the top of the arc in ${hours(live.elements.timeToApoapsis)}, ` +
    `where one more burn will turn the arc into an orbit.`,

  CIRCULARISE: () =>
    'Burning sideways at the top of the arc. Without this burn the ship would fall back into the ' +
    'atmosphere.',

  COAST: () =>
    `In orbit: ${km(live.elements.perigee)} at the lowest point, ${km(live.elements.apogee)} at ` +
    `the highest. Now it waits for the Moon to be in the right place.`,

  TLI_ALIGN: raiseLine,

  TLI_BURN: () =>
    'Trans-lunar injection: the big burn that sends the ship to the Moon. It fires on the far side ' +
    'of Earth from the Moon, because a burn raises the opposite side of the orbit.',

  TRANS_LUNAR: () =>
    `Coasting to the Moon and slowing down: ${(live.elements.speed / 1000).toFixed(3)} km/s now, ` +
    `down from 10.8 after the burn. Earth's gravity pulls it back most of the way.`,

  MCC_SOLVE: () =>
    'Checking the aim. A tiny error now becomes a miss of thousands of kilometres at the Moon, ' +
    'so the computer works out a small fix while it is still cheap.',

  MCC_BURN: () =>
    'A small course correction. Fixing it early costs far less fuel than fixing it later.',

  /*
   * `live.lunarRange` is the vehicle's own distance to the Moon. The first
   * draft of this line reached for `live.metric.shipMoon`, which does not
   * exist, `metric` holds Sol-to-Terra and Terra-to-Luna, both distances
   * between *bodies*, and fell back to the Earth-Moon separation, so it would
   * have told the reader the vehicle was 384,000 km from the Moon at the exact
   * moment it was closing on it. A commentary line that quietly prints the
   * wrong body's number is worse than no line.
   */
  LUNAR_APPROACH: () => {
    const inside = live.lunarRange < live.lunarSOI
    return inside
      ? `Inside the Moon's influence now, ${km(live.lunarRange)} from it, and being pulled ahead ` +
          `rather than held back, the vehicle is speeding up again for the first time since the ` +
          `injection burn.`
      : `Closing on the Moon, ${km(live.lunarRange)} out. Earth is still the body in charge: its ` +
          `pull does not hand over until about ${km(live.lunarSOI)}, and until then the vehicle ` +
          `is still slowing down.`
  },

  LOI_ALIGN: () =>
    'Turning backwards to brake. The ship has to slow down enough for the Moon to capture it, ' +
    'or it flies straight past.',

  LOI_BURN: () =>
    'Braking into lunar orbit behind the Moon, out of radio contact with Earth, just like the real ' +
    'Apollo flights.',

  /*
   * `live.lunar`, not `live.elements`. The elements on `live` are geocentric,
   * and reading them here printed "in orbit around the Moon: 391,987 km by
   * 3,984,480 km", the vehicle's orbit about *Earth*, which at this point is
   * an enormous ellipse and says nothing about the hundred-kilometre lunar
   * orbit it is actually in. The selenocentric set is the one that means
   * anything once the Moon is the attractor.
   */
  LUNAR_ORBIT: () =>
    `In orbit around the Moon: ${km(live.lunar.perigee)} by ${km(live.lunar.apogee)}. With no ` +
    `air to drag on the ship, this orbit does not decay.`,

  TEI_ALIGN: () =>
    'Turning for the burn home. Leaving the Moon costs about as much fuel as arriving did.',

  TEI_BURN: () =>
    'Burning out of lunar orbit for home. Earth\'s atmosphere will do the rest of the braking.',

  TRANS_EARTH: () =>
    'Falling back to Earth and speeding up the whole way. It will hit the atmosphere at about ' +
    '11 km/s.',

  EI_SOLVE: () =>
    'Aiming for the entry corridor. Too shallow and the capsule bounces off the atmosphere; too ' +
    'steep and the crew could not survive the braking. The safe gap is about one degree wide.',

  EI_BURN: () =>
    'A small burn to fine-tune the entry angle.',

  SM_SEP: () =>
    'The service module is let go. Only the capsule has a heat shield, so only the capsule comes ' +
    'home.',

  RE_ENTRY: () =>
    `Re-entry: ${(live.decelG).toFixed(1)} g of braking and ` +
    `${(live.totalFlux / 1e4).toFixed(0)} W/cm² of heat on the shield. The glow is the ship's speed ` +
    `turning into heat.`,

  DROGUE: () =>
    'Small drogue parachutes first. A big parachute would tear at this speed.',

  MAIN_CHUTES: () =>
    'Main parachutes open. A gentle drop to the ocean from here.',

  SPLASHDOWN: () =>
    'Splashdown. Mission complete.',

  NODE_ALIGN: () => {
    const n = nodes.find((x) => !x.executed)
    return n
      ? `Turning for a planned burn: ${n.dv?.toFixed?.(1) ?? '·'} m/s, in ${hours(n.t - live.sim.t)}. ` +
          'The ship turns to face the right way first, then fires on time.'
      : 'Turning for a planned burn.'
  },

  NODE_BURN: () =>
    'Flying a planned burn, pointed exactly where the plan needs it.',

  HALO_CAPTURE: () =>
    'Moving onto a halo orbit: a loop around a balance point between Earth and Moon, not around ' +
    'either one. It needs small corrections to stay on it.',

  NRHO_COAST: () =>
    'Coasting on the Gateway\'s orbit: a quick swing past the Moon, then a long slow arc far out. ' +
    'It keeps the station in view of Earth almost all the time.',

  NRHO_STATION_KEEP: () =>
    'Station-keeping. This orbit is unstable, so it gets a small nudge about once per loop.',

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
    "the top of the descent stage, 'fire in the hole', stripping its insulation. Ten seconds " +
    'straight up to clear it and the ground.',

  LUNAR_ASCENT: () =>
    `Pitched over toward the west, the plane of Columbia's orbit. The ascent engine has one setting, ` +
    `3,500 lbf, no throttle, so the guidance steers the thrust instead, to arrive at 60,000 ft ` +
    `climbing at 32 ft/s and moving at 5,535. Now ${distance(live.lunar.altitude)} up at ` +
    `${(live.lunar.speed / 1000).toFixed(2)} km/s. (The law is explicit guidance of the family ` +
    `Apollo's P12 belongs to, not its code.)`,

  LUNAR_INSERTION: () =>
    `Engine off: in orbit, ${km(live.lunar.perigee)} by ${km(live.lunar.apogee)}.`,

  LM_COAST_CSI: () =>
    `In orbit, ${km(live.lunar.perigee)} by ${km(live.lunar.apogee)}, below and behind Columbia, ` +
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
    'below it, all the way round, same line of apsides, same a × e. From here the angle Columbia ' +
    'stands above Eagle’s horizon climbs steadily, and that angle is the clock for TPI.',

  LM_COAST_TPI: () => {
    const dh = lunar.cdh ? ` ${km(lunar.cdh.dh)} below Columbia,` : ''
    return (
      `Coelliptic,${dh} gaining. Columbia is ${deg(lunar.elevation)} above Eagle’s horizon; at ` +
      `${deg(APOLLO11.tpiElevation)}, a burn along the line of sight carries Eagle up to it in 130° ` +
      'of orbit, a geometry chosen because errors in the burn barely move where it ends.'
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
    `Braking through the gates: the closing rate comes down in steps as the range does, 30 ft/s at ` +
    `a mile, 20 at half a mile, 10 at 1,500 ft, 5 at 500, so there is always room to stop. ` +
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
