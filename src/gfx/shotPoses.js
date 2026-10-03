import { Vector3 } from 'three'
import { live } from '../sim/live.js'
import { BODIES, SHIP } from '../sim/constants.js'
import { activeSite, siteDirection } from '../sim/launchsite.js'
import { mission } from '../sim/mission.js'
import { ship } from '../sim/ship.js'
import { currentHullLift } from './pads.js'
import { EYE_FOV, groundViewpoint, lunarViewpoint } from './groundView.js'
import { lunarChaseOffset } from './lunarChase.js'
import { CHASE_MULTIPLE, FRAMING, LIT_REACH, STAGE_LENGTH, VEHICLE_MULTIPLE, stageLength } from './framing.js'
import { LOOKS } from './bodyLooks.js'
import { poleDirection } from './bodyFrame.js'
import { COSMIC, rebasedOf } from '../sim/where.js'

/**
 * Where each shot puts the camera once it has settled.
 *
 * The rig (`components/CameraRig.jsx`) flies every shot live — springs on the
 * aim, a filter on the chase offset, a lens that tracks — and a move into a
 * shot blends toward whatever it is doing. The mission intro has to *arrive*
 * at a shot, in one continuous flight that ends on the frame the mission opens
 * on, so it needs that frame before the rig has ever flown it: this is it,
 * unsprung, which is exactly where the rig's springs start.
 *
 * Positions are in the floating origin's frame, like everything drawn.
 */

/**
 * The pad camera stands 7 stack lengths across the azimuth and 1.5 up: a
 * tracking camera a few hundred metres out with a long lens on it.
 */
export const PAD_OFFSET = {
  lateral: SHIP.visual * 7,
  up: SHIP.visual * 1.5,
}

/**
 * The pad camera breathes instead of standing bolted to the ground.
 *
 * A mount fixed at one spot on one bearing is the shot every low-budget
 * launch scene has: static, flat, and the same frame from T-minus an hour to
 * the tower clear. Real launch coverage is a crane that creeps, so the mount
 * wanders on three slow, deliberately incommensurate periods: a lateral arc
 * of about a tenth, a small swing about the pad (the bearing turning a few
 * degrees), and a lift of about a fifth of its height. Nothing about it is
 * visible as motion; everything about it is visible as a shot that lives.
 *
 * Driven by the wall clock and not by the simulation clock, because this is
 * presentation: under a day a second the shot would strobe. The *rig* applies
 * it, ramping in from zero over the first seconds of the shot; `restingPose`
 * stays on the nominal mount, which is what the mission intro lands on. The
 * gate that holds the intro's last frame to the shot's first wants two
 * samples of the pose to agree to a millimetre, and any pose that keeps time
 * disagrees with itself; a crane that eases in as the shot begins gives the
 * life without the drift.
 */
export function padDrift(t) {
  return {
    arc: Math.sin(t / 47) * 0.1 + Math.sin(t / 89 + 1.7) * 0.06,
    turn: Math.sin(t / 73 + 2.2) * 0.055,
    lift: Math.sin(t / 61 + 0.8) * 0.22,
  }
}

/** The pad camera's lens holds the vehicle at `fill` of frame, clamped at both ends. */
export const PAD_FOV = { min: 2.5, max: 42, fill: 0.22 }

/** The lens every orbiting lock uses — the canvas's own. */
export const BASE_FOV = 45

const WORLD_UP = new Vector3(0, 1, 0)
const _perp = new Vector3()
const _poleArr = new Float64Array(3)
const _ringUp = new Vector3()
const _dir = new Vector3()
const _a = new Vector3()
const _b = new Vector3()

/**
 * Where a body is lit from three-quarters: the direction a camera arriving at
 * it should settle along. Offset from the sun line so the terminator is in
 * frame, rather than the flat full disc looking straight down the sun vector.
 *
 * A ringed world is approached from the side of its rings the Sun is on. From
 * the other side the rings are lit only by what shines through them: the dense
 * B ring goes black and the faint C ring glows — true, and what Cassini saw,
 * and a poor first look at Saturn.
 */
export function litQuarter(out, bodyPos, id) {
  out.subVectors(live.pos.sun, bodyPos)
  if (out.lengthSq() < 1e-8) return out.set(0.45, 0.28, 1).normalize()
  out.normalize()
  _perp.crossVectors(WORLD_UP, out).normalize()
  const look = LOOKS[id]
  if (look?.ring && look.pole) {
    poleDirection(_poleArr, look.pole[0], look.pole[1])
    _ringUp.set(_poleArr[0], _poleArr[1], _poleArr[2])
    if (_ringUp.dot(out) < 0) _ringUp.negate()
    return out.multiplyScalar(0.62).addScaledVector(_perp, 0.72).addScaledVector(_ringUp, 0.45).normalize()
  }
  return out.multiplyScalar(0.62).addScaledVector(_perp, 0.72).addScaledVector(WORLD_UP, 0.3).normalize()
}

/** A shot's settled frame: camera, look point, up, lens. */
export const makePose = () => ({ cam: new Vector3(), look: new Vector3(), up: new Vector3(0, 1, 0), fov: BASE_FOV })

const CRAFT = new Set(['ship', 'iss', 'hubble', 'target'])

/**
 * Fill `pose` with where `focus` settles, or return false for a view that has
 * no resting place of its own (free orbit, free flight).
 */
export function restingPose(focus, pose) {
  const site = mission.site ?? activeSite()
  const hull = STAGE_LENGTH[ship.stage] ?? STAGE_LENGTH[0]
  pose.fov = BASE_FOV
  pose.up.copy(WORLD_UP)

  if (focus === 'ground') {
    if (site.body === 'moon') lunarViewpoint(pose.cam, pose.up, site)
    else groundViewpoint(pose.cam, pose.up, site, live.sunDir, live.pos.earth)
    siteDirection(_dir, site, live.sim.t)
    pose.look.copy(live.pos.ship).addScaledVector(_dir, currentHullLift(site.id) - hull * 0.5)
    pose.fov = EYE_FOV
    return true
  }

  if (focus === 'pad') {
    siteDirection(_dir, site, live.sim.t)
    _a.crossVectors(WORLD_UP, _dir)
    if (_a.lengthSq() < 1e-12) _a.set(1, 0, 0)
    _a.normalize()
    // The nominal mount. The rig's crane rides on top of this and eases in
    // from zero when the shot starts (see padDrift), so this pose is exact
    // and the intro lands on exactly it.
    pose.cam
      .copy(live.pos.earth)
      .addScaledVector(_dir, BODIES.earth.radius + PAD_OFFSET.up)
      .addScaledVector(_a, PAD_OFFSET.lateral)
    pose.look.copy(live.pos.ship).addScaledVector(_dir, currentHullLift(site.id))
    const range = pose.cam.distanceTo(live.pos.ship)
    const wanted = (2 * Math.atan(hull / (PAD_FOV.fill * 2 * Math.max(range, 1e-6))) * 180) / Math.PI
    pose.fov = Math.min(PAD_FOV.max, Math.max(PAD_FOV.min, wanted))
    pose.up.copy(_dir)
    return true
  }

  if (focus === 'chase') {
    if (SHIP.lunar) {
      lunarChaseOffset(_a, pose.up, hull)
    } else {
      _b.set(0, 0, -1).applyQuaternion(ship.quaternion)
      pose.up.set(0, 1, 0).applyQuaternion(ship.quaternion)
      const reach = ship.thrust > 0 ? hull * LIT_REACH : hull
      _a.set(0, 0, 0).addScaledVector(_b, CHASE_MULTIPLE.back * reach).addScaledVector(pose.up, CHASE_MULTIPLE.up * reach)
    }
    pose.look.copy(live.pos.ship)
    pose.cam.copy(live.pos.ship).add(_a)
    return true
  }

  if (focus === 'free' || focus === 'fly' || focus === 'intro' || focus === 'cinematic' || focus === 'node') return false

  const here = rebasedOf(focus, pose.look)
  if (!here) return false
  let distance = FRAMING[focus]?.distance
  if (focus === 'ship') distance = stageLength(ship.stage) * VEHICLE_MULTIPLE.distance
  if (distance === undefined && COSMIC[focus]) distance = COSMIC[focus].radius * (COSMIC[focus].frame ?? 5)
  if (!distance) distance = BODIES.earth.radius * 5
  if (CRAFT.has(focus)) {
    // A craft is framed against the world it circles: from outside its orbit,
    // a little to one side, with the planet behind it.
    const host = focus === 'target' || SHIP.lunar ? live.pos.moon : live.pos.earth
    _dir.subVectors(here, host).normalize()
    _perp.crossVectors(WORLD_UP, _dir).normalize()
    _dir.multiplyScalar(0.55).addScaledVector(_perp, 0.75).addScaledVector(WORLD_UP, 0.35).normalize()
  } else if (COSMIC[focus]?.view) {
    _dir.copy(COSMIC[focus].view)
  } else {
    litQuarter(_dir, here, focus)
  }
  pose.cam.copy(here).addScaledVector(_dir, distance)
  return true
}
