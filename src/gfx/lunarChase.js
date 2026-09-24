import { Vector3 } from 'three'
import { live } from '../sim/live.js'
import { INDEX } from '../sim/system.js'
import { K_RANGE, lunar, lunarLive } from '../sim/lunarMission.js'
import { currentPhase } from '../sim/mission.js'

/**
 * Where the chase camera rides for a lunar vessel.
 *
 * The chase every other vessel uses sits behind the engines on the thrust axis,
 * which for a rocket climbing out of an atmosphere is behind and below it, with
 * the planet's limb in frame. For the LM it is the wrong place twice over. The
 * ascent stage pitches over to 50° within a minute and flies with its engine
 * toward the ground, so "behind the engine" is under it, looking up at the
 * black sky; and from TPI on, the thing worth watching is not the vehicle's own
 * attitude but where Columbia is.
 *
 * So two framings, both in the Moon's local frame rather than the body's:
 *
 * - **Climbing and coasting**, abeam: off to the side of the plane, a little
 *   behind and above, so the LM crosses the frame in profile with the ground
 *   spread out beyond it. The side is the one that looks *across* the sun. Eagle
 *   flew west with the Sun low in the east behind it, and a camera trailing
 *   behind looks straight down-sun, where the Moon has no relief at all — at
 *   zero phase every slope is equally bright under Lommel–Seeliger, which is
 *   the washout the Apollo crews described. Abeam on the plane's southern side,
 *   the Sun is on the camera's right, as it is for the ground view, and every
 *   crater throws its shadow.
 * - **Closing**, over the shoulder: behind Eagle on the line to Columbia and
 *   above it, so the two are on screen together. Only inside 6 km — the last
 *   of braking, station-keeping and the docking. Further out Columbia is a
 *   point of light, and the line to it climbs 27° above Eagle's horizon at TPI,
 *   which with the horizon 18° down from 90 km puts the Moon out of the frame
 *   altogether; abeam keeps the Moon under the LM until there is something to
 *   see ahead of it.
 *
 * Offsets are in multiples of the vehicle's length, like `CHASE_MULTIPLE`; the
 * rig smooths them as it smooths that one. Allocation-free.
 */
const TRAIL = { back: 2.2, up: 1.3, side: 5.2 }
const SHOULDER = { back: 6, up: 2.2 }

const _up = new Vector3()
const _v = new Vector3()
const _n = new Vector3()
const _f = new Vector3()

/** Phases in which the other craft can be the subject, and from how far, m. */
const WATCHING = new Set(['LM_TRANSFER', 'LM_BRAKING', 'LM_STATION_KEEP', 'LM_DOCKING', 'DOCKED'])
const SHOULDER_RANGE = 6000

/**
 * The chase offset from the vehicle, into `out`, and the camera's up, into
 * `up`: the local vertical. `length` is the vehicle's.
 */
export function lunarChaseOffset(out, up, length) {
  const s = live.sim.state
  const o = INDEX.ship * 6
  const m = INDEX.moon * 6
  _up.set(s[o] - s[m], s[o + 1] - s[m + 1], s[o + 2] - s[m + 2]).normalize()
  up.copy(_up)
  if (INDEX.target !== undefined && lunarLive[K_RANGE] < SHOULDER_RANGE && WATCHING.has(currentPhase().id)) {
    const t = INDEX.target * 6
    _f.set(s[t] - s[o], s[t + 1] - s[o + 1], s[t + 2] - s[o + 2]).normalize()
    out.copy(_f).multiplyScalar(-SHOULDER.back * length).addScaledVector(_up, SHOULDER.up * length)
    return out
  }
  // Downrange: the plane of the rendezvous, crossed with up. Before the plane
  // exists, the horizontal part of the velocity over the ground.
  if (lunar.plane.lengthSq() > 0.5) {
    _n.copy(lunar.plane)
    _f.crossVectors(_n, _up).normalize()
  } else {
    _v.set(s[o + 3] - s[m + 3], s[o + 4] - s[m + 4], s[o + 5] - s[m + 5])
    _f.copy(_v).addScaledVector(_up, -_v.dot(_up))
    if (_f.lengthSq() < 1e-6) _f.set(1, 0, 0)
    _f.normalize()
    _n.crossVectors(_up, _f)
  }
  out
    .copy(_f)
    .multiplyScalar(-TRAIL.back * length)
    .addScaledVector(_up, TRAIL.up * length)
    .addScaledVector(_n, TRAIL.side * length)
  return out
}
