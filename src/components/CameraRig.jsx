import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { live } from '../sim/live.js'
import { springFollow, omegaForSettling } from '../gfx/follow.js'
import { activeSite, siteDirection } from '../sim/launchsite.js'
import { currentHullLift } from '../gfx/pads.js'
import { EYE_FOV, earthStand, groundViewpoint, lunarStand, lunarViewpoint, standOffsets } from '../gfx/groundView.js'
import { lunarChaseOffset } from '../gfx/lunarChase.js'
import { BODIES, SHIP } from '../sim/constants.js'
import {
  CHASE_MULTIPLE,
  FRAMING,
  LIT_REACH,
  STAGE_LENGTH,
  VEHICLE_MULTIPLE,
  detentsIn,
  pathFramingDistance,
  stageLength,
  zoomSpeedFor,
} from '../gfx/framing.js'
import { clampTrim, flyAxisInput, flyModifier, flySpeed } from '../gfx/fly.js'
import {
  EYE as WALK_EYE,
  restingWalker,
  stepWalk,
  surfaceGravity,
  walkSpeed,
} from '../sim/walk.js'
import { INTRO, introStep } from '../gfx/introFlights.js'
import { mission } from '../sim/mission.js'
import { MAX_NODE_FRAMES, plan, prediction } from '../sim/predict.js'
import { selectedNode } from '../sim/nodes.js'
import { ship } from '../sim/ship.js'
import { useUi } from '../sim/store.js'
import { COSMIC, absoluteOf, rebasedOf } from '../sim/where.js'
import { DIRECT_RHO, RHO, flightSeconds, planZoomPan, smoother, zoomPanAt } from '../gfx/zoomPath.js'
import { PILOT_MOVE, QUICK_MOVE, TRANSIT } from '../gfx/transit.js'
import { BASE_FOV, PAD_FOV, PAD_OFFSET, litQuarter, padDrift } from '../gfx/shotPoses.js'



/**
 * The ground observer's lens, once it is tracking something rather than
 * standing still.
 *
 * The eye view is a *fixed* viewpoint at eye height, which is what makes a
 * launch read at the scale it happens at — and it is also why it loses the
 * vehicle: a 65-degree frame held at 380 m puts the top of its useful field
 * about 240 m above the deck, so from the moment the vehicle passes that the
 * rocket is a dot travelling up the middle of a very wide photograph, and by
 * 2 km it is not a visible object at all.
 *
 * Every broadcast of a launch solves this the same way and always has: the
 * camera does not move, the *lens* does. So the frame starts at the eye's own
 * field — the countdown and ignition are seen as a bystander sees them — and
 * pushes in as the vehicle climbs, holding it at roughly a third of frame.
 * `min` is the long end: at 2.5 degrees and 380 m of stand-off the frame is
 * about 516 m across, so the 110 m stack is still a fifth of it, and it stays
 * legible out past 40 km. Past that the director has long since cut away.
 *
 * The push is triggered off altitude rather than camera range, so it works the
 * same standing 380 m from LC-39B and 30 m from Eagle: in both cases the lens
 * opens up as the vehicle clears the ground it was sitting on.
 */
const GROUND_FOV = { min: 0.9, fill: 0.30, clearAlt: 60, fullAlt: 320 }

/**
 * Spring stiffness for the pad camera's aim, as a settling time.
 *
 * This is the one place a spring earns its keep. Measured against recorded
 * telemetry, the chase camera's exponential lag never exceeds 1.5 degrees of
 * framing error, because the vehicle rotates far too slowly to outrun it — so
 * the spring was *not* adopted there. A vehicle leaving a pad is the opposite
 * case: it accelerates from rest, so the aim point's velocity changes fast, and
 * a filter carrying no velocity of its own falls behind exactly when the shot
 * matters.
 */
const PAD_AIM_SETTLE = 0.45

/** The eye-level view's settle, s: a head turning, a little softer than a mount. */
const GROUND_AIM_SETTLE = 0.7
/** The pad crane eases in over the first seconds of the shot. See padDrift in shotPoses.js. */
const PAD_DRIFT_EASE = 2.4


/**
 * How quickly a locked camera closes on a vehicle that has just changed size.
 *
 * The chase camera needs nothing here — its offset is already filtered at this
 * rate, so a separation reaches it as a step into a filter that is running. A
 * locked camera has no such filter: OrbitControls holds a radius the *user*
 * chose, and the same rate moves it radially without touching the angles, so
 * the pilot keeps the view they framed and only its scale follows the vehicle.
 * 98% of the change in 4/6 s. The largest step a mission takes is a factor of
 * 3.2 in length — 35.1 m to 11.0 m — which from the default lock at 4.5 lengths
 * is a dolly from 158 m to 49.5 m.
 */
const REFRAME_RATE = 6

/**
 * Free flight, in the craft-less sense: a viewpoint you steer rather than a
 * target you orbit.
 *
 * Mouse drag looks, WASD translates in the view frame, R and F lift and drop.
 * Yaw is taken about world up rather than the camera's own, which is what stops
 * a long session accumulating roll — there is no horizon out here to tell you
 * you have drifted, so the control has to refuse to drift.
 */
const LOOK_PER_PIXEL = 0.0025
const PITCH_LIMIT = Math.PI / 2 - 0.01

/** Where the observer stands, as metres east and south. Module scratch: built once, never on the frame path. */
const _off = new Float64Array(2)

/**
 * How far the boots may get from the site, in metres.
 *
 * Not a fence but the edge of the ground that exists. `Terrain.jsx` grades an
 * Earth complex flat to 400 m and real relief takes over past it, so 340 keeps
 * the walker on the datum it is standing on with room to spare. The Moon's
 * loaded patch is far wider, and 900 m is about as far as the LM stays a
 * recognisable object behind you — past that the walk is a grey plain, and the
 * plain is not the feature.
 */
const WALK_LEASH_EARTH = 340
const WALK_LEASH_MOON = 900

/** How quickly the camera reaches the speed the keys are asking for. */
const FLY_RESPONSE = 8

/**
 * The opening shot: a slow circle of Earth, with the terminator kept in frame.
 *
 * Deliberately the live simulation rather than a rendered loop. The bodies are
 * where the integrator says they are, the lighting is the real sun angle, and
 * pressing enter does not load anything — it hands this camera to the player.
 * A pre-baked video would have to be re-rendered every time the scene changed,
 * and would be a promise the simulator then had to keep.
 */
const CINEMATIC = {
  /** Earth radii. Far enough for the whole disc plus limb. */
  range: 4.2,
  /** Seconds per revolution. Slow enough to read as drift, not rotation. */
  period: 190,
  /** Radians above the ecliptic, with a slow bob either side. */
  elevation: 0.34,
  bob: 0.13,
  /**
   * How far left of Earth the camera aims, in Earth radii, which pushes the
   * planet right of frame and leaves the left third for text.
   */
  aimOffset: 1.15,
}

/** Exponential smoothing that is independent of frame rate. */
const smooth = (dt, rate) => 1 - Math.exp(-dt * rate)

const WORLD_UP = new THREE.Vector3(0, 1, 0)

/**
 * Where the selected planned burn is, in world space.
 *
 * Read from the projection's recorded frame rather than recomputed: that is the
 * position the burn is actually applied at, and it is the same point the gizmo
 * is drawn on, so the camera and the handles cannot disagree about where the
 * pilot is looking. False when nothing is selected or the plan does not reach
 * it — a node beyond the projection's horizon has no drawn position to fly to.
 */
function nodePosition(out) {
  const node = selectedNode()
  if (!node) return false
  const slot = plan.applied.indexOf(node.id)
  if (slot < 0 || slot >= MAX_NODE_FRAMES) return false
  const f = slot * 12
  const body = live.pos[plan.reference]
  if (!body) return false
  out.set(plan.nodeFrames[f], plan.nodeFrames[f + 1], plan.nodeFrames[f + 2]).add(body)
  return true
}

/** Locks onto a spacecraft rather than a world: they keep their approach direction. */
const CRAFT_FOCI = new Set(['ship', 'iss', 'hubble', 'target'])

/**
 * Framing for something beyond the planets: a star, a nebula, a galaxy. Those
 * register their own radius and the multiple they are best seen from (see
 * `sim/cosmos.js`), so the table in `framing.js` does not have to know them.
 */
function cosmicFraming(id) {
  const c = COSMIC[id]
  if (!c) return FRAMING.earth
  return {
    distance: c.radius * (c.frame ?? 5),
    min: c.radius * (c.min ?? 1.2),
    max: Math.max(c.radius * 1e5, 1e13),
  }
}

/**
 * The body a view's look point rides on, so that a move out of it starts from
 * where that body *is* on every frame of the move rather than from where it was
 * when the move began — at a month a second Earth leaves a stationary start
 * point at 78,000 km per second of the move.
 */
function anchorOf(focus) {
  // The intro ends on its mission's first frame, which rides whatever that
  // frame rides — the vehicle on a turning, orbiting Earth. Unanchored, the
  // start of the hand-off was left behind at 30 km/s the moment the clock ran.
  if (focus === 'intro') return INTRO.finalFocus ? anchorOf(INTRO.finalFocus) : null
  if (!focus || focus === 'free' || focus === 'fly') return null
  if (focus === 'cinematic') return 'earth'
  if (focus === 'chase' || focus === 'pad' || focus === 'ground' || focus === 'ship') return 'ship'
  if (focus === 'node') return plan.reference ?? 'earth'
  return focus
}

const _perp = new THREE.Vector3()
/** Spherical interpolation between unit vectors. Allocation-free. */
function slerpUnit(out, a, b, t) {
  const d = Math.min(1, Math.max(-1, a.dot(b)))
  if (d > 0.9995) return out.copy(a).lerp(b, t).normalize()
  if (d < -0.9995) {
    // Antiparallel: any great circle will do, so take one through a perpendicular.
    _perp.set(Math.abs(a.x) > 0.9 ? 0 : 1, Math.abs(a.x) > 0.9 ? 1 : 0, 0)
    _perp.crossVectors(a, _perp).normalize()
    const th = Math.PI * t
    return out.copy(a).multiplyScalar(Math.cos(th)).addScaledVector(_perp, Math.sin(th))
  }
  const th = Math.acos(d)
  const s = Math.sin(th)
  const wa = Math.sin((1 - t) * th) / s
  const wb = Math.sin(t * th) / s
  return out.set(a.x * wa + b.x * wb, a.y * wa + b.y * wb, a.z * wa + b.z * wb)
}


/**
 * Camera lock.
 *
 * Locking has two phases. A zoom-pan move to frame the body (see `blend`), then a hard
 * follow that translates the camera and the orbit target by the same vector
 * every frame. Because the offset between them never changes, OrbitControls
 * recomputes an identical spherical position next frame — so the user keeps full
 * orbit, zoom and damping control while the body moves underneath them.
 *
 * Runs at priority 0, after OrbitControls' own update at -1, so the follow is
 * applied on top of the damped result rather than being overwritten by it.
 */
export function CameraRig() {
  const focus = useUi((s) => s.focus)
  const map = useUi((s) => s.map)
  const controls = useThree((s) => s.controls)
  const camera = useThree((s) => s.camera)
  const gl = useThree((s) => s.gl)
  const opening = useRef(true)

  const scratch = useMemo(
    () => ({
      dir: new THREE.Vector3(),
      to: new THREE.Vector3(),
      delta: new THREE.Vector3(),
      back: new THREE.Vector3(),
      up: new THREE.Vector3(),
      desired: new THREE.Vector3(),
      siteDir: new THREE.Vector3(),
      east: new THREE.Vector3(),
      offset: new THREE.Vector3(),
      flyVel: new THREE.Vector3(),
      flyWant: new THREE.Vector3(),
      flyEuler: new THREE.Euler(0, 0, 0, 'YXZ'),
      aim: new THREE.Vector3(),
      aimVel: new THREE.Vector3(),
      padAim: new THREE.Vector3(),
      nodeAim: new THREE.Vector3(),
      eye: new THREE.Vector3(),
      eyeUp: new THREE.Vector3(),
      anchor: new THREE.Vector3(),
      siteNow: new THREE.Vector3(),
      sitePrev: new THREE.Vector3(),
      // Boots on the ground: the walker's offset from the body's centre, and
      // the tangent frame it is standing in. See sim/walk.js.
      walkUp: new THREE.Vector3(),
      walkEast: new THREE.Vector3(),
      walkNorth: new THREE.Vector3(),
      walkFwd: new THREE.Vector3(),
      walkRight: new THREE.Vector3(),
      walkLook: new THREE.Vector3(),
      walkBack: new THREE.Vector3(),
      walkBasis: new THREE.Matrix4(),
    }),
    [],
  )
  /**
   * The walker: which ground, where on it, which way the head is pointed, and
   * the physics state `sim/walk.js` steps. `east`/`south` are metres in the
   * site's own frame — the coordinate the terrain's height probe takes. The
   * leash — how far the boots may get from the site, and why — is stated
   * where the constants live, at `WALK_LEASH_EARTH` above.
   */
  const jumped = useRef(false)
  const walker = useRef({
    body: 'earth',
    site: null,
    east: 0,
    south: 0,
    heading: 0,
    lastYaw: 0,
    reach: 0,
    state: restingWalker(),
  })
  const baseFov = useRef(null)
  /**
   * Set on entering the pad or ground shot, and cleared by the first frame of
   * it, which puts the aim straight onto its target. Seeding it in the effect
   * that sees the focus change was the first version, and the effect runs
   * before the frame loop has placed anything: on a preset that has just held
   * five hours on the pad, `live.pos.ship` was still where the site had been
   * five hours of rotation earlier — seventy-odd degrees round the planet — so
   * the first second of the ground view looked down at the dirt while the
   * spring swung up to a vehicle it should have started on.
   */
  const seedAim = useRef(false)
  const zoomBase = useRef(1)
  const focusRef = useRef(focus)
  focusRef.current = focus
  const flyKeys = useRef(null)
  const flyLook = useRef({ yaw: 0, pitch: 0, dragging: false, locked: false, pointer: null, x: 0, y: 0 })
  const flyTrim = useRef(1)
  const cineT = useRef(0)
  /** How long the pad shot's crane has been easing in; reset when the shot starts. */
  const padT = useRef(0)
  /** The drawn length last framed, and the radius a reframe is closing on. */
  const hullSeen = useRef(STAGE_LENGTH[0])
  const reframe = useRef(0)
  if (flyKeys.current === null) flyKeys.current = new Set()
  /** The focus the rig last set up for — the view a move starts from. */
  const lastFocus = useRef(null)
  /** Set on entering the chase: the first frame puts the offset straight onto the shot. */
  const seedChase = useRef(false)

  /**
   * A move between two views: every change of lock, whatever the two ends are.
   *
   * The destination is not computed here. Each mode keeps placing the camera
   * exactly as it would if the move had already landed — the ground observer's
   * aim spring, the chase camera's offset, a body's framing — and the move
   * reads that pose and blends toward it along a van Wijk–Nuij path (see
   * `gfx/zoomPath.js`). So the move ends on the mode's own frame by
   * construction, springs and all, and the hand-back is not an event.
   *
   * The start rides the body it was looking at (`anchorOf`), for the same
   * reason: a start point fixed in space would be left behind by a planet
   * under time warp before the move had got going.
   */
  const trans = useMemo(
    () => ({
      active: false,
      t: 0,
      T: 1,
      maxT: 9,
      anchor: null,
      anchorNow: new THREE.Vector3(),
      camRel: new THREE.Vector3(),
      tgtRel: new THREE.Vector3(),
      startCam: new THREE.Vector3(),
      startTarget: new THREE.Vector3(),
      up0: new THREE.Vector3(0, 1, 0),
      fov0: 45,
      dir1: new THREE.Vector3(),
      dist1: 0,
      fov1: 45,
      plan: {},
      at: { f: 0, w: 0 },
      destCam: new THREE.Vector3(),
      destTarget: new THREE.Vector3(),
      destUp: new THREE.Vector3(),
      dir0: new THREE.Vector3(),
      dirD: new THREE.Vector3(),
      dir: new THREE.Vector3(),
      look: new THREE.Vector3(),
    }),
    [],
  )

  /**
   * Carry a sprung aim point with the ground it is aimed over.
   *
   * The aim springs live in the floating origin's frame, and two things move
   * that frame's contents that have nothing to do with where the camera should
   * look. The origin itself moves — during a move it rides the camera — and a
   * spring left where it was is dragged by every metre of it. And the ground
   * turns: pinned to Earth's centre, a pad at Kennedy travels 408 m/s, and a
   * critically damped spring chasing a target at constant speed settles 2v/ω
   * behind it — 95 m, measured, so the ground camera aimed at a point a
   * hundred metres in front of the rocket, and a move into the shot saw its
   * destination somewhere else. Both are feed-forward: the aim is shifted with
   * the origin and carried with the site, so the spring is left to do only
   * what it is for — smoothing the vehicle's own motion off the pad.
   */
  function carryAim(site, seeding) {
    const R = site.body === 'moon' ? BODIES.moon.radius : BODIES.earth.radius
    const body = site.body === 'moon' ? live.pos.moon : live.pos.earth
    scratch.siteNow.copy(body).addScaledVector(scratch.siteDir, R).add(live.origin)
    if (!seeding) {
      scratch.aim.sub(live.originDelta)
      scratch.aim.add(scratch.siteNow).sub(scratch.sitePrev)
    }
    scratch.sitePrev.copy(scratch.siteNow)
  }

  /** Take the view as it stands, before the new mode touches the lens. */
  function beginTransition(prevFocus, to) {
    const tr = trans
    tr.startCam.copy(camera.position).add(live.origin)
    tr.startTarget.copy(controls.target).add(live.origin)
    // A degenerate start — camera on its own target — has no direction to leave along.
    if (tr.startCam.distanceToSquared(tr.startTarget) < 1e-6) {
      scratch.dir.set(0, 0, -1).applyQuaternion(camera.quaternion)
      tr.startTarget.copy(tr.startCam).addScaledVector(scratch.dir, Math.max(live.nearest.distance, 10))
    }
    tr.anchor = anchorOf(prevFocus)
    if (tr.anchor !== null && absoluteOf(tr.anchor, tr.anchorNow) !== null) {
      tr.camRel.subVectors(tr.startCam, tr.anchorNow)
      tr.tgtRel.subVectors(tr.startTarget, tr.anchorNow)
    } else {
      tr.anchor = null
    }
    tr.up0.copy(camera.up).normalize()
    tr.fov0 = camera.fov
    tr.t = 0
    tr.T = 1
    /*
     * A move asked to arrive is still *planned* — the destination is whatever
     * the mode puts the camera at, which only the path knows how to read — but
     * it is given no time to take, so the first frame of it is also the last.
     * Skipping the plan outright leaves the camera where it was: the move is
     * what computes where it is going.
     */
    // A hair rather than zero: the length divides the elapsed time, and on a
    // frame where no time has passed zero over zero is not a number, which
    // would put the camera at NaN and the screen at black.
    tr.maxT = TRANSIT.arrive ? 1e-6 : TRANSIT.quick ? QUICK_MOVE : PILOT_MOVE
    TRANSIT.arrive = false
    TRANSIT.quick = false
    tr.active = true
    TRANSIT.active = true
    TRANSIT.progress = 0
    TRANSIT.to = to
  }

  /**
   * One frame of a move. The mode has just placed the camera where it wants it;
   * this reads that as the destination and puts the camera where the path is.
   */
  function blend(delta) {
    const tr = trans
    tr.destCam.copy(camera.position).add(live.origin)
    tr.destTarget.copy(controls.target).add(live.origin)
    tr.destUp.copy(camera.up).normalize()
    const fov1 = camera.fov
    if (tr.anchor !== null && absoluteOf(tr.anchor, tr.anchorNow) !== null) {
      tr.startCam.copy(tr.anchorNow).add(tr.camRel)
      tr.startTarget.copy(tr.anchorNow).add(tr.tgtRel)
    }
    const d0 = Math.max(tr.startCam.distanceTo(tr.startTarget), 1e-3)
    const d1 = Math.max(tr.destCam.distanceTo(tr.destTarget), 1e-3)
    const k0 = 2 * Math.tan((tr.fov0 * Math.PI) / 360)
    const k1 = 2 * Math.tan((fov1 * Math.PI) / 360)
    const w0 = d0 * k0
    const w1 = d1 * k1
    const u1 = tr.startTarget.distanceTo(tr.destTarget)
    /*
     * A click is a glance, not a journey. When the pan is inside a few view
     * widths the geodesic is straightened (DIRECT_RHO) instead of zooming the
     * world out, pinning across it and zooming back in to cross a distance a
     * glance crosses. A system-spanning move keeps the geodesic, which is the
     * right shape for scale.
     */
    planZoomPan(tr.plan, w0, w1, u1, u1 < 2.5 * Math.max(w0, w1) ? DIRECT_RHO : RHO)
    // The length is fixed on the first frame; after that only the ends move.
    if (tr.t === 0) tr.T = flightSeconds(tr.plan.S, 0.9, tr.maxT)
    tr.t += Math.min(delta, 1 / 20)
    const raw = Math.min(1, tr.t / tr.T)
    const e = smoother(raw)
    TRANSIT.progress = e
    if (raw >= 1) {
      // Land exactly on the mode's own frame, and give it the camera back.
      tr.active = false
      TRANSIT.active = false
      TRANSIT.progress = 1
      camera.fov = fov1
      camera.updateProjectionMatrix()
      return
    }
    const fov = tr.fov0 + (fov1 - tr.fov0) * e
    /*
     * An arrival at the ground is shaped like a flyover that turns final.
     * The zoom-pan geodesic dives radially along the chord, which over a
     * rotating Earth means a long slide across open ocean and then the pad
     * arriving from nowhere: the sloppy zoom-in. So for an arrival from
     * height (ground or pad, more than 25 times the shot's own range and at
     * least 200 km up) the pan happens first and the descent happens last:
     * the direction swings onto the shot while the camera holds its
     * altitude, then the altitude falls along the shot's own axis with the
     * horizon in frame the whole way down. It ends exactly on the shot, the
     * same as every other move.
     */
    const arrival = (TRANSIT.to === 'ground' || TRANSIT.to === 'pad') && d0 > d1 * 25 && d0 > 2e5
    if (arrival) {
      const panE = smoother(Math.min(1, raw / 0.5))
      const dropE = smoother(Math.max(0, (raw - 0.45) / 0.55))
      tr.look.copy(tr.startTarget).lerp(tr.destTarget, e)
      tr.dir0.subVectors(tr.startCam, tr.startTarget).normalize()
      tr.dirD.subVectors(tr.destCam, tr.destTarget).normalize()
      slerpUnit(tr.dir, tr.dir0, tr.dirD, panE)
      const dist = Math.exp(Math.log(d0) + (Math.log(d1) - Math.log(d0)) * dropE)
      camera.position.copy(tr.look).addScaledVector(tr.dir, dist).sub(live.origin)
    } else {
      zoomPanAt(tr.plan, e * tr.plan.S, tr.at)
      const dist = tr.at.w / (2 * Math.tan((fov * Math.PI) / 360))
      tr.look.copy(tr.startTarget).lerp(tr.destTarget, Math.min(1, Math.max(0, tr.at.f)))
      tr.dir0.subVectors(tr.startCam, tr.startTarget).normalize()
      tr.dirD.subVectors(tr.destCam, tr.destTarget).normalize()
      slerpUnit(tr.dir, tr.dir0, tr.dirD, e)
      camera.position.copy(tr.look).addScaledVector(tr.dir, dist).sub(live.origin)
    }
    controls.target.copy(tr.look).sub(live.origin)
    slerpUnit(camera.up, tr.up0, tr.destUp, e)
    if (Math.abs(camera.fov - fov) > 1e-4) {
      camera.fov = fov
      camera.updateProjectionMatrix()
    }
    camera.lookAt(controls.target)
  }

  /**
   * How close and how far a locked camera may sit from the vehicle, for the
   * stage flying now. The zoom speed is re-derived with them, because the whole
   * point of `zoomSpeedFor` is that a wheel detent means the same fraction of
   * whatever range it is crossing — and that range shrinks by 32x over a
   * mission. Before this, a 3.47 m capsule could not be approached closer than
   * 121.7 m: 35 of its own lengths, set by a stack it jettisoned days earlier.
   */
  function vehicleLimits() {
    const min = stageLength(ship.stage) * VEHICLE_MULTIPLE.min
    controls.minDistance = min
    controls.maxDistance = FRAMING.ship.max
    zoomBase.current = zoomSpeedFor(min, FRAMING.ship.max)
  }

  /**
   * Scale `zoomSpeed` by how much the user actually scrolled, before
   * OrbitControls reads it.
   *
   * Attached to the canvas's *parent* in the capture phase: two listeners on
   * the same element fire in registration order regardless of the capture flag,
   * so being early requires being higher up the tree, not just capturing.
   */
  /**
   * Look and translate, bound only while the mode is active.
   *
   * Mounted per-mode rather than globally and gated: a listener that exists but
   * declines to act still swallows the gesture, and W and S belong to the
   * throttle the rest of the time.
   */
  useEffect(() => {
    // The walk borrows this wholesale: pointer lock, mouse look, a held-key
    // set and a blur that lets go of them are the same problem for a person on
    // foot as for a camera in free flight, and a second copy of it would be a
    // second set of listeners fighting over the same canvas.
    if (focus !== 'fly' && focus !== 'walk') return
    const canvas = gl.domElement
    const look = flyLook.current
    const keys = flyKeys.current
    keys.clear()

    /**
     * Two ways to look, and the good one needs a gesture to start.
     *
     * Pointer lock is what this mode wants: the mouse steers on its own, both
     * hands stay on the keys, and there is no button to hold while also holding
     * W. The browser will only grant it from a user gesture, so a click asks for
     * it and escape gives it back — that is the browser's own binding and it is
     * the one people already know. Dragging still works, unchanged, for anyone
     * who declines the lock or whose browser refuses it, so nothing is lost by
     * asking.
     */
    const aim = (dx, dy) => {
      look.yaw -= dx * LOOK_PER_PIXEL
      look.pitch = THREE.MathUtils.clamp(look.pitch - dy * LOOK_PER_PIXEL, -PITCH_LIMIT, PITCH_LIMIT)
    }
    const onPointerDown = (e) => {
      if (e.button !== 0) return
      // The request can be refused — an embedded or background document gets a
      // WrongDocumentError, and some browsers require a fresh gesture. It
      // returns a promise in current browsers and nothing in older ones, and an
      // unhandled rejection here would be a console error on every click in a
      // context where dragging works perfectly well.
      if (!look.locked) Promise.resolve(canvas.requestPointerLock?.()).catch(() => {})
      look.dragging = true
      look.pointer = e.pointerId
      look.x = e.clientX
      look.y = e.clientY
      // Capture keeps a drag alive when the pointer leaves the canvas, and it
      // throws InvalidStateError if that pointer is no longer active by the time
      // it is asked — which an uncaught handler turns into a console error on
      // every click. The drag does not depend on it.
      try {
        canvas.setPointerCapture?.(e.pointerId)
      } catch {
        /* no capture; the drag still tracks while the pointer is over the canvas */
      }
    }
    const onPointerMove = (e) => {
      if (look.locked) {
        // movementX/Y is the only thing that means anything under lock: the
        // pointer itself no longer moves, so clientX would never change.
        aim(e.movementX ?? 0, e.movementY ?? 0)
        return
      }
      if (!look.dragging || e.pointerId !== look.pointer) return
      aim(e.clientX - look.x, e.clientY - look.y)
      look.x = e.clientX
      look.y = e.clientY
    }
    const onLockChange = () => {
      look.locked = document.pointerLockElement === canvas
      live.flyLocked = look.locked
      if (!look.locked) {
        look.dragging = false
        look.pointer = null
      }
    }
    const onPointerUp = (e) => {
      if (e.pointerId !== look.pointer) return
      look.dragging = false
      look.pointer = null
      canvas.releasePointerCapture?.(e.pointerId)
    }
    const onKeyDown = (e) => {
      if (!e.repeat) keys.add(e.code)
      /*
       * A jump is an event, not a state, and it has to be latched.
       *
       * Reading the held-key set on the frame path loses any press that begins
       * and ends between two frames — which at 60 Hz is a 16 ms window a real
       * tap can easily fit inside, and which a synthetic keypress fits inside
       * every time. Measured: driving the page with a dispatched keyDown and
       * keyUp in the same task, the walker never left the ground once. Held
       * Space still repeats, because holding it is how you hop.
       */
      if (e.code === 'Space') jumped.current = true
    }
    const onKeyUp = (e) => keys.delete(e.code)
    // A key held while the window loses focus would otherwise stay held, and
    // this camera has no drag to stop it.
    const onBlur = () => keys.clear()

    canvas.addEventListener('pointerdown', onPointerDown)
    canvas.addEventListener('pointermove', onPointerMove)
    canvas.addEventListener('pointerup', onPointerUp)
    canvas.addEventListener('pointercancel', onPointerUp)
    document.addEventListener('pointerlockchange', onLockChange)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    return () => {
      canvas.removeEventListener('pointerdown', onPointerDown)
      canvas.removeEventListener('pointermove', onPointerMove)
      canvas.removeEventListener('pointerup', onPointerUp)
      canvas.removeEventListener('pointercancel', onPointerUp)
      document.removeEventListener('pointerlockchange', onLockChange)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
      keys.clear()
      jumped.current = false
      // Leaving the mode gives the pointer back, whatever else happens.
      if (document.pointerLockElement === canvas) document.exitPointerLock?.()
      look.locked = false
      live.flyLocked = false
      look.dragging = false
      scratch.flyVel.set(0, 0, 0)
      live.flySpeed = 0
    }
  }, [focus, gl, scratch])

  useEffect(() => {
    if (!controls) return
    const canvas = gl.domElement
    const host = canvas.parentElement ?? canvas
    const onWheel = (e) => {
      // In free flight the wheel has no radius to change, so it trims speed —
      // the same gesture, applied to the only scalar the mode has.
      if (focusRef.current === 'fly') {
        const step = Math.exp(detentsIn(e) * 0.35 * (e.deltaY < 0 ? 1 : -1))
        flyTrim.current = clampTrim(flyTrim.current * step)
        return
      }
      controls.zoomSpeed = zoomBase.current * detentsIn(e)
    }
    host.addEventListener('wheel', onWheel, { capture: true, passive: true })
    return () => host.removeEventListener('wheel', onWheel, { capture: true })
  }, [controls, gl])

  useEffect(() => {
    if (!controls) return
    const frame = FRAMING[focus] ?? cosmicFraming(focus)
    const prev = lastFocus.current
    lastFocus.current = focus

    /**
     * Every change of view is a move now, except the ones that are not views:
     * the intro and the opening shot drive the camera themselves, free flight
     * and a free orbit start from wherever the camera already is, and the very
     * first lock has nothing to move from. The start is taken here, before
     * anything below touches the lens.
     */
    const moving =
      prev !== null &&
      !opening.current &&
      focus !== 'intro' &&
      focus !== 'cinematic' &&
      focus !== 'fly' &&
      focus !== 'free'
    if (moving) beginTransition(prev, focus)
    else TRANSIT.quick = false
    if (!moving && trans.active) {
      trans.active = false
      TRANSIT.active = false
      TRANSIT.progress = 1
    }

    // Chase drives the camera outright, so orbit input is handed back only when
    // leaving the mode.
    controls.enabled =
      focus !== 'chase' &&
      focus !== 'pad' &&
      focus !== 'ground' &&
      focus !== 'fly' &&
      focus !== 'cinematic' &&
      focus !== 'intro'
    // Panning moves the orbit target, which is meaningful only when the camera
    // is not already pinned to a body.
    controls.enablePan = focus === 'free'

    // Leaving the pad, ground or intro shot: give the lens back. A move out of
    // one blends the lens back over the move rather than snapping it here.
    if (focus !== 'pad' && focus !== 'ground' && focus !== 'intro' && baseFov.current !== null) {
      if (!moving) {
        camera.fov = baseFov.current
        camera.updateProjectionMatrix()
      }
      baseFov.current = null
    }
    trans.fov1 = BASE_FOV

    if (focus === 'pad' || focus === 'ground') {
      if (baseFov.current === null) baseFov.current = BASE_FOV
      opening.current = false
      // The aim is seeded on the first frame, from that frame's positions.
      seedAim.current = true
      // The crane starts again with the shot.
      padT.current = 0
      if (focus === 'ground' && !moving) {
        camera.fov = EYE_FOV
        camera.updateProjectionMatrix()
      }
      return
    }

    /**
     * The mission intro: a flight the rig flies but does not own.
     *
     * The path lives in `gfx/introFlights.js`; what is here is only the same
     * bargain the pad and ground shots make — hold the lens for whoever drives
     * it, and give it back when the mode leaves. The camera is placed outright
     * each frame while `INTRO.active`, and freezes on the settle frame while
     * the curtain's last page holds.
     */
    if (focus === 'intro') {
      if (baseFov.current === null) baseFov.current = BASE_FOV
      opening.current = false
      return
    }

    if (focus === 'chase') {
      /**
       * Into the chase by the same move as everything else. It used to be a
       * cut beyond eight chase lengths and a 1.5 s body-frame blend inside
       * them, because the only alternative on offer was a straight-line flight
       * — 33,791 km in 1.5 s from Earth's lock — and a cut was better than that.
       * A zoom-pan path is better than both: it leaves Earth's frame by scale,
       * not by speed. The offset is seeded straight onto the shot, because the
       * move is what blends now.
       */
      seedChase.current = true
      opening.current = false
      return
    }

    if (focus === 'cinematic') {
      opening.current = false
      return
    }

    /**
     * Entering free flight: adopt the camera's current orientation rather than
     * imposing one, so the cut is a change of control and not of view.
     */
    if (focus === 'fly') {
      scratch.flyEuler.setFromQuaternion(camera.quaternion, 'YXZ')
      flyLook.current.yaw = scratch.flyEuler.y
      flyLook.current.pitch = THREE.MathUtils.clamp(scratch.flyEuler.x, -PITCH_LIMIT, PITCH_LIMIT)
      scratch.flyVel.set(0, 0, 0)
      opening.current = false
      return
    }

    /**
     * Boots on the ground: put the walker down beside the launch observer.
     *
     * The ground a person can stand on is the ground the simulator actually
     * draws, which is the flight's own site: the graded complex at an Earth
     * pad, or the loaded LRO patch at a lunar one. `sim/walk.js` already
     * carries the physics for all eighteen standable worlds — every planet,
     * every large moon, two comet nuclei — and the only thing keeping the
     * boots off them is that those bodies are drawn as datum spheres with a
     * shader on them, with no surface to meet the feet. Standing on one would
     * be standing on a featureless ball, which is the opposite of the point.
     */
    if (focus === 'walk') {
      const site = mission.site ?? activeSite()
      const w = walker.current
      w.site = site
      w.body = site.body === 'moon' ? 'moon' : 'earth'
      w.state = restingWalker()
      /*
       * Where the ground camera was standing, exactly.
       *
       * A change of control, not a change of place: the observer's viewpoint
       * *is* the person, so the boots go on where the eyes already are and
       * nothing jumps. Set down beside the site instead — three metres out,
       * which was the first attempt — the walker opens the mode inside the
       * LM's descent stage looking at a strut, which is not a view of the
       * Moon. `gfx/groundView.js` owns both offsets, so the two cannot drift.
       */
      if (site.body === 'moon') lunarViewpoint(scratch.eye, scratch.eyeUp, site)
      else groundViewpoint(scratch.eye, scratch.eyeUp, site, live.sunDir, live.pos.earth)
      standOffsets(_off, site)
      w.east = _off[0]
      w.south = _off[1]
      w.reach = Math.hypot(w.east, w.south)
      w.heading = 0
      w.lastYaw = flyLook.current.yaw
      flyLook.current.pitch = 0
      opening.current = false
      return
    }

    controls.minDistance = frame.min
    controls.maxDistance = frame.max
    zoomBase.current = zoomSpeedFor(frame.min, frame.max)
    if (focus === 'ship') vehicleLimits()
    // A deliberate change of shot supersedes a reframe the vehicle asked for.
    reframe.current = 0
    if (focus === 'free') {
      return
    }

    /**
     * Framing a burn: far enough out to see the arc it sits on, which means
     * scaling with its distance from the body rather than with the body's size.
     * A 200 km parking orbit and a burn at the Moon are four decades apart.
     */
    let distance = focus === 'ship' ? stageLength(ship.stage) * VEHICLE_MULTIPLE.distance : frame.distance
    if (map && focus !== 'node') {
      distance = pathFramingDistance(
        prediction.points,
        prediction.count,
        BASE_FOV,
        (BODIES[focus]?.radius ?? BODIES.earth.radius) * 3,
      )
    } else if (focus === 'node') {
      const anchor = live.pos[plan.reference]
      const away = nodePosition(scratch.nodeAim) ? scratch.nodeAim.distanceTo(anchor) : 0
      const surface = BODIES[plan.reference]?.radius ?? BODIES.earth.radius
      distance = Math.max(surface * 1.6, away * 0.9)
    }

    const here = focus === 'node' ? live.pos[plan.reference] : rebasedOf(focus, scratch.anchor)
    const dir = trans.dir1.subVectors(camera.position, controls.target)
    if (dir.lengthSq() < 1e-8) dir.set(0.45, 0.28, 1)
    dir.normalize()

    /**
     * Which way to arrive. Re-framing the body already in view — the map, a
     * burn on the same orbit — keeps the viewing direction, so it reads as a
     * dolly rather than a swing. Arriving at a *different* world comes in on
     * its lit three-quarter face, terminator in frame: it is the first look at
     * that place, and a flat full disc or a night side is a poor one. Craft
     * keep the direction too; what frames a spacecraft well is its
     * surroundings, and those are what the camera was already looking at.
     */
    const sameBody = anchorOf(prev) === anchorOf(focus)
    const world = !CRAFT_FOCI.has(focus) && focus !== 'node' && focus !== 'sun'
    if (here && world && (!sameBody || opening.current)) {
      // Beyond the planets there is no lit face: a place says where it is best seen from.
      if (COSMIC[focus]?.view) dir.copy(COSMIC[focus].view)
      else litQuarter(dir, here, focus)
    }

    // The very first lock is the opening shot, and there is nothing to ease
    // from — the default camera is nowhere near the target, so animating it
    // just makes the user watch a swoop past the Sun. Snap instead.
    if (opening.current) {
      opening.current = false
      if (here) {
        controls.target.copy(here)
        camera.position.copy(here).addScaledVector(dir, frame.distance)
      }
      return
    }

    trans.dist1 = distance
  }, [focus, map, controls, camera])

  useFrame((_, delta) => {
    /**
     * A separation is a step change in the size of the thing being framed, and
     * the only one in the mission that arrives without the user asking for it.
     *
     * The chase camera needs no help: its desired offset is rebuilt from this
     * length every frame and the existing filter smooths the step. A locked
     * camera is holding a radius the user chose, so what is preserved is their
     * framing rather than their distance — the radius is scaled by the same
     * ratio the vehicle shrank by, and eased in radially below. Watching the
     * length rather than `ship.separations` also covers a reset, which puts the
     * full stack back.
     */
    const hull = STAGE_LENGTH[ship.stage] ?? STAGE_LENGTH[0]
    if (hull !== hullSeen.current) {
      const ratio = hull / hullSeen.current
      hullSeen.current = hull
      if (controls && focus === 'ship') {
        vehicleLimits()
        const radius = camera.position.distanceTo(controls.target)
        reframe.current = THREE.MathUtils.clamp(
          radius * ratio,
          controls.minDistance,
          controls.maxDistance,
        )
      }
    }

    if (!controls || focus === 'free') return

    // During a move the lens is the move's; a mode that sets its own lens
    // (ground, pad) overwrites this, and every other mode rests on the base.
    if (trans.active) camera.fov = trans.fov1

    /**
     * The intro flight. `introStep` places the camera and the lens outright;
     * OrbitControls' target is parked where the lens is pointing so the cut
     * out of the flight has a direction to fly from.
     */
    if (focus === 'intro') {
      introStep(camera, delta)
      if (INTRO.look) controls.target.copy(INTRO.look)
      return
    }

    /* The opening shot. No input, no state beyond the clock. */
    if (focus === 'cinematic') {
      cineT.current += delta
      const a = (cineT.current / CINEMATIC.period) * Math.PI * 2
      const R = BODIES.earth.radius * CINEMATIC.range
      const el = CINEMATIC.elevation + Math.sin(a * 0.37) * CINEMATIC.bob

      scratch.desired.set(
        Math.cos(a) * Math.cos(el) * R,
        Math.sin(el) * R,
        Math.sin(a) * Math.cos(el) * R,
      )
      camera.position.copy(live.pos.earth).add(scratch.desired)

      // Aim to one side of the planet so it sits right of frame.
      scratch.back.copy(scratch.desired).cross(WORLD_UP).normalize()
      scratch.aim
        .copy(live.pos.earth)
        .addScaledVector(scratch.back, BODIES.earth.radius * CINEMATIC.aimOffset)

      camera.up.set(0, 1, 0)
      camera.lookAt(scratch.aim)
      controls.target.copy(live.pos.earth)
      return
    }

    /**
     * Free flight: integrate the camera, do not solve for it.
     *
     * Speed comes from `live.nearest.distance` through `flySpeed`, so the
     * control has no scale of its own — it borrows the scene's. Forty metres
     * off a hull that is 0.5 m/s; between the planets it is a tenth of an AU a
     * second. Crossing ten decades takes the same forty-seven seconds wherever
     * those decades are.
     */
    if (focus === 'fly') {
      const look = flyLook.current
      const keys = flyKeys.current

      scratch.flyEuler.set(look.pitch, look.yaw, 0, 'YXZ')
      camera.quaternion.setFromEuler(scratch.flyEuler)
      camera.up.set(0, 1, 0)

      flyAxisInput(keys, scratch.flyWant)
      if (scratch.flyWant.lengthSq() > 0) {
        scratch.flyWant
          .normalize()
          .applyQuaternion(camera.quaternion)
          .multiplyScalar(
            flySpeed(live.nearest.distance, flyTrim.current * flyModifier(keys)),
          )
      }

      // Ease, so a keypress is an acceleration rather than a teleport.
      scratch.flyVel.lerp(scratch.flyWant, smooth(delta, FLY_RESPONSE))
      camera.position.addScaledVector(scratch.flyVel, delta)
      live.flySpeed = scratch.flyVel.length()

      // Park the orbit target ahead of the camera so leaving for a free orbit
      // has something plausible to swing around rather than the last body.
      scratch.back.set(0, 0, -1).applyQuaternion(camera.quaternion)
      controls.target
        .copy(camera.position)
        .addScaledVector(scratch.back, Math.max(live.nearest.distance, 10))
      return
    }

    /**
     * Boots on the ground: a person, not a camera.
     *
     * The physics is `sim/walk.js` and every number in it is a measurement
     * about a human being — a 0.40 m standing jump, a 0.9 m leg, boots with a
     * friction of 0.6 — acted on by whatever world is underfoot. Nothing here
     * decides how walking feels. The Moon feels like the Moon because the Moon
     * pulls at 1.63 m/s², and the consequences are the real ones: the walking
     * gait breaks above **1.21 m/s** where it breaks at 2.97 on Earth, which
     * is why the Apollo crews hopped; a jump hangs for three and a half
     * seconds and reaches 2.4 m; and with a sixth of the grip you cannot stop
     * or turn quickly, which is the part nobody expects.
     *
     * The frame is the site's — `gfx/groundView.js` — so the walker stands on
     * the same ground the launch observer stands on, and walks on the Moon's
     * real LRO relief rather than on a sphere. Position is carried as two
     * numbers, metres east and south of the site, which is the coordinate the
     * terrain's own height probe takes.
     */
    if (focus === 'walk') {
      const w = walker.current
      const site = w.site
      const g = surfaceGravity(w.body)
      const keys = flyKeys.current

      /*
       * Heading is kept here rather than taken from the camera's world yaw.
       * A yaw about the scene's +y is only a heading where "up" happens to be
       * +y, and a person standing on a sphere is almost never at that point —
       * on the Moon's near side the local vertical is 80-odd degrees off it,
       * and a mouse that turns the head about the wrong axis rolls the horizon
       * instead of looking along it.
       */
      w.heading -= (flyLook.current.yaw - w.lastYaw)
      w.lastYaw = flyLook.current.yaw
      const pitch = flyLook.current.pitch
      const ch = Math.cos(w.heading)
      const sh = Math.sin(w.heading)

      // What the feet are asking for, in the site's own east/south axes.
      const ahead = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0)
      const beside = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0)
      // Heading 0 faces north, which is -south; +heading turns toward east.
      const wantE = ahead * sh + beside * ch
      const wantS = -(ahead * ch - beside * sh)

      const step = Math.min(delta, 0.1)
      // Latched or held: a tap that fell between two frames still counts, and
      // Space held down hops, which on the Moon is the only way to get about.
      const push = jumped.current || keys.has('Space')
      jumped.current = false
      stepWalk(w.state, step, g, wantE, wantS, push)
      w.east += w.state.east * step
      w.south += w.state.north * step

      /*
       * A leash, and it is an honest one rather than a fence.
       *
       * On Earth the ground is the datum only inside the graded complex; on
       * the Moon it is real relief only inside the loaded patch. Outside
       * either, this would be walking on a number the terrain does not draw.
       * So the walker is held inside the ground that exists, and the HUD says
       * why rather than pretending the world ends.
       */
      const leash = w.body === 'moon' ? WALK_LEASH_MOON : WALK_LEASH_EARTH
      const out = Math.hypot(w.east, w.south)
      if (out > leash) {
        const k = leash / out
        w.east *= k
        w.south *= k
        w.state.east = 0
        w.state.north = 0
      }
      w.reach = out

      // Where that puts the eyes, and which way is up there.
      if (w.body === 'moon') lunarStand(camera.position, scratch.walkUp, site, w.east, w.south, WALK_EYE + w.state.height)
      else earthStand(camera.position, scratch.walkUp, site, w.east, w.south, WALK_EYE + w.state.height)

      /*
       * The head. Built from the local frame rather than from a world-space
       * Euler, so the horizon is level wherever on the body the walker is
       * standing: east and north are perpendicular to the local vertical by
       * construction, and the look direction is the heading tilted by pitch.
       */
      scratch.walkEast.crossVectors(WORLD_UP, scratch.walkUp)
      if (scratch.walkEast.lengthSq() < 1e-12) scratch.walkEast.set(1, 0, 0)
      scratch.walkEast.normalize()
      scratch.walkNorth.crossVectors(scratch.walkUp, scratch.walkEast).normalize()
      // Forward and right in the tangent plane, from the heading.
      scratch.walkFwd.copy(scratch.walkNorth).multiplyScalar(ch).addScaledVector(scratch.walkEast, sh)
      scratch.walkRight.copy(scratch.walkEast).multiplyScalar(ch).addScaledVector(scratch.walkNorth, -sh)
      // Tilt the look, and take the head's own up with it.
      const cp = Math.cos(pitch)
      const sp = Math.sin(pitch)
      scratch.walkLook.copy(scratch.walkFwd).multiplyScalar(cp).addScaledVector(scratch.walkUp, sp)
      scratch.up.copy(scratch.walkUp).multiplyScalar(cp).addScaledVector(scratch.walkFwd, -sp)
      // Three's basis wants the camera's +z, which looks *backwards*.
      // `.clone().negate()` here would allocate a Vector3 a frame.
      scratch.walkBack.copy(scratch.walkLook).negate()
      scratch.walkBasis.makeBasis(scratch.walkRight, scratch.up, scratch.walkBack)
      camera.quaternion.setFromRotationMatrix(scratch.walkBasis)
      camera.up.copy(scratch.up)

      live.walkSpeed = Math.hypot(w.state.east, w.state.north)
      live.walkHeight = w.state.height
      live.walkGround = w.state.onGround

      controls.target.copy(camera.position).addScaledVector(scratch.walkLook, 40)
      return
    }

    /**
     * Pad: a camera bolted to the ground, turning to follow.
     *
     * The anchor is recomputed every frame from the site's body-fixed direction
     * rather than cached, because the planet turns underneath it — a fixed scene
     * position would slide off the launch site within minutes and, at 465 m/s of
     * surface speed, visibly. It is the same direction the pad clamp and the
     * drag model use, so the camera and the vehicle standing on it agree.
     */
    /*
     * The person on the ground. See gfx/groundView.js for where they stand and
     * why; what is here is only how they look.
     *
     * At the vehicle's *base*, as drawn, which is where a person watching a
     * launch actually looks — the engines, the hold-downs, the steam. The rest
     * of the stack rises into the upper half of a 65-degree frame, and the
     * lower half is ground and weather. After release the aim point climbs with
     * the base on the same critically damped spring the pad camera uses, so the
     * head tilts up with the vehicle rather than snapping to it: a first-order
     * lag cannot keep up with a vehicle accelerating off a pad, a spring can.
     * The settle is a little softer than the pad camera's, because a head is.
     *
     * The up vector is the observer's own vertical, so the horizon is level.
     */
    if (focus === 'ground') {
      const site = mission.site ?? activeSite()
      if (site.body === 'moon') lunarViewpoint(scratch.eye, scratch.eyeUp, site)
      else groundViewpoint(scratch.eye, scratch.eyeUp, site, live.sunDir, live.pos.earth)
      camera.position.copy(scratch.eye)

      siteDirection(scratch.siteDir, site, live.sim.t)
      scratch.padAim
        .copy(live.pos.ship)
        .addScaledVector(scratch.siteDir, currentHullLift(site.id) - hull * 0.5)
      carryAim(site, seedAim.current)
      if (seedAim.current) {
        scratch.aim.copy(scratch.padAim)
        scratch.aimVel.set(0, 0, 0)
        seedAim.current = false
      }
      springFollow(
        scratch.aim,
        scratch.aim,
        scratch.padAim,
        scratch.aimVel,
        omegaForSettling(GROUND_AIM_SETTLE),
        Math.min(delta, 1 / 20),
      )
      /*
       * The tracked lens, described by `GROUND_FOV` above. `push` is zero while
       * the vehicle is on the pad and one once it is well clear, and the frame
       * is blended between the eye's own field and whatever holds the vehicle
       * at `fill` of frame at the range it is actually at.
       *
       * Clamped at both ends for the reason the pad camera is: too wide and
       * there is no tracking in it, too narrow and every tremor in the aim
       * spring is amplified into a visible shake.
       */
      const range = camera.position.distanceTo(live.pos.ship)
      const push = THREE.MathUtils.clamp(
        (live.elements.altitude - GROUND_FOV.clearAlt) / (GROUND_FOV.fullAlt - GROUND_FOV.clearAlt),
        0,
        1,
      )
      const tracked =
        (2 * Math.atan(hull / (GROUND_FOV.fill * 2 * Math.max(range, 1e-6))) * 180) / Math.PI
      const fov = EYE_FOV + (THREE.MathUtils.clamp(tracked, GROUND_FOV.min, EYE_FOV) - EYE_FOV) * push
      if (Math.abs(camera.fov - fov) > 1e-3) {
        camera.fov = fov
        camera.updateProjectionMatrix()
      }
      camera.up.copy(scratch.eyeUp)
      camera.lookAt(scratch.aim)
      controls.target.copy(scratch.aim)
      if (trans.active) blend(delta)
      return
    }

    if (focus === 'pad') {
      const site = mission.site ?? activeSite()
      siteDirection(scratch.siteDir, site, live.sim.t)

      // East at the site: omega-hat x up, the direction the ground is moving.
      scratch.east.set(0, 0, 0)
      scratch.up.copy(WORLD_UP)
      scratch.east.crossVectors(scratch.up, scratch.siteDir)
      if (scratch.east.lengthSq() < 1e-12) scratch.east.set(1, 0, 0)
      scratch.east.normalize()

      /*
       * The mount breathes: see padDrift in shotPoses.js for the crane this
       * replaces the bolted-down mount with, and why it runs on the wall
       * clock. It eases in from zero over the first seconds of the shot (the
       * settled pose is nominal, so the mission intro lands on exactly this
       * frame), and the turn rotates the mount about the pad in the tangent
       * plane.
       */
      padT.current = Math.min(PAD_DRIFT_EASE, padT.current + Math.min(delta, 1 / 20))
      const rk = padT.current / PAD_DRIFT_EASE
      const ramp = rk * rk * (3 - 2 * rk)
      const drift = padDrift(performance.now() / 1000)
      const turn = drift.turn * ramp
      scratch.desired.crossVectors(scratch.siteDir, scratch.east).normalize().multiplyScalar(Math.sin(turn))
      scratch.desired.addScaledVector(scratch.east, Math.cos(turn))
      scratch.anchor
        .copy(live.pos.earth)
        .addScaledVector(scratch.siteDir, BODIES.earth.radius + PAD_OFFSET.up * (1 + drift.lift * ramp))
        .addScaledVector(scratch.desired, PAD_OFFSET.lateral * (1 + drift.arc * ramp))
      camera.position.copy(scratch.anchor)

      // The aim point is sprung, not snapped: a vehicle accelerating off a pad
      // is precisely the target whose velocity a first-order lag cannot carry.
      // Aimed at the hull as drawn, not at the state: on the pad the hull is
      // raised onto the deck (gfx/pads.js), and a camera aimed at the centre
      // of mass would frame a vehicle standing in the top half of the shot.
      scratch.padAim
        .copy(live.pos.ship)
        .addScaledVector(scratch.siteDir, currentHullLift(site.id))
      carryAim(site, seedAim.current)
      if (seedAim.current) {
        scratch.aim.copy(scratch.padAim)
        scratch.aimVel.set(0, 0, 0)
        seedAim.current = false
      }
      springFollow(
        scratch.aim,
        scratch.aim,
        scratch.padAim,
        scratch.aimVel,
        omegaForSettling(PAD_AIM_SETTLE),
        Math.min(delta, 1 / 20),
      )

      /*
       * Long lens: hold the vehicle at a roughly constant fraction of frame,
       * and let that fraction shrink as it climbs. Holding 22% through the
       * ascent keeps the vehicle the same size and the sky a backdrop that
       * never enters the picture; the fill opens toward a half of itself by a
       * kilometre up, so ground and horizon stay in the shot while the
       * vehicle goes away from it.
       */
      const range = camera.position.distanceTo(live.pos.ship)
      const open = THREE.MathUtils.clamp((live.elements.altitude - 80) / 920, 0, 1)
      const fill = PAD_FOV.fill * (1 - 0.45 * open)
      const wanted =
        (2 * Math.atan(hull / (fill * 2 * Math.max(range, 1e-6))) * 180) / Math.PI
      const fov = Math.min(PAD_FOV.max, Math.max(PAD_FOV.min, wanted))
      if (Math.abs(camera.fov - fov) > 1e-3) {
        camera.fov = fov
        camera.updateProjectionMatrix()
      }

      camera.up.copy(scratch.siteDir)
      camera.lookAt(scratch.aim)
      controls.target.copy(scratch.aim)
      if (trans.active) blend(delta)
      return
    }

    /**
     * Chase: ride behind and slightly above the craft, in its own body frame,
     * so the view banks with a roll instead of staying stubbornly world-level.
     *
     * The filter is applied to the **offset**, not to the world position. Those
     * were the same thing at display scale and are not the same thing now. The
     * offset is a body-frame vector 412 m long, so it only ever changes when the
     * craft *rotates*; the craft's translation is followed rigidly, which is
     * what a camera bolted to a vehicle does.
     *
     * Filtering the world position instead meant chasing 7.8 km/s of orbital
     * motion with a 1/6 s lag. Under the old exaggeration that motion was
     * 0.0152 chase-offsets per second and invisible; at true scale it is 18.9,
     * about 1,240x harder, and the measured framing error went from under 1.5
     * degrees to 103. The vehicle did not change — the frame the filter ran in
     * did, and only one of the two frames was ever the right one.
     *
     * Two things fall out. There is no longer a snap threshold, because a
     * body-frame offset cannot diverge from its target however fast the craft
     * moves; and the time-compression case that motivated the snap — a craft
     * lapping its orbit several times a second — stops being a special case at
     * all.
     */
    if (focus === 'chase') {
      if (SHIP.lunar) {
        // Eagle is filmed from the Moon's frame, not its own: see gfx/lunarChase.js.
        lunarChaseOffset(scratch.desired, scratch.up, hull)
      } else {
        scratch.back.set(0, 0, -1).applyQuaternion(ship.quaternion)
        scratch.up.set(0, 1, 0).applyQuaternion(ship.quaternion)
        // The stage on screen, and its exhaust when there is one: a lit vehicle
        // is 1.72 times the object an unlit one is, and the extra points this way.
        const reach = ship.thrust > 0 ? hull * LIT_REACH : hull
        scratch.desired
          .set(0, 0, 0)
          .addScaledVector(scratch.back, CHASE_MULTIPLE.back * reach)
          .addScaledVector(scratch.up, CHASE_MULTIPLE.up * reach)
      }

      if (seedChase.current) {
        // Straight onto the shot: the move into it does the blending.
        scratch.offset.copy(scratch.desired)
        camera.up.copy(scratch.up)
        seedChase.current = false
      } else {
        scratch.offset.lerp(scratch.desired, smooth(delta, 6))
        camera.up.lerp(scratch.up, smooth(delta, 4))
      }

      camera.position.copy(live.pos.ship).add(scratch.offset)
      camera.lookAt(live.pos.ship)
      controls.target.copy(live.pos.ship)
      if (trans.active) blend(delta)
      return
    }

    /**
     * A planned burn is followed the same way a body is: it is a point that
     * moves, and the tail of this function only needs somewhere to point. When
     * the selection goes — deleted, flown, or scrubbed past the horizon — it
     * falls back to the body the plan is drawn around rather than stranding the
     * camera on a stale position.
     */
    const target =
      focus === 'node'
        ? nodePosition(scratch.nodeAim)
          ? scratch.nodeAim
          : live.pos[plan.reference]
        : // A planet on rails is not in `live.pos`, because it is not in the
          // state vector, and a star is in neither: `rebasedOf` knows all three.
          rebasedOf(focus, scratch.to)
    if (!target) return

    if (trans.active) {
      // The frame the move is heading for: the body at the distance and from
      // the direction the lock chose. The move reads it and blends toward it.
      camera.position.copy(target).addScaledVector(trans.dir1, trans.dist1)
      controls.target.copy(target)
      camera.up.copy(WORLD_UP)
      camera.lookAt(target)
      blend(delta)
      return
    }

    scratch.delta.copy(target).sub(controls.target)
    controls.target.add(scratch.delta)
    camera.position.add(scratch.delta)

    /**
     * Close on the radius the new stage asks for, along the line the camera is
     * already on. Radial by construction: OrbitControls recomputes its spherical
     * coordinates from wherever the camera ends up, so moving it straight out or
     * straight in changes the radius and leaves the pilot's angles untouched.
     */
    if (reframe.current > 0) {
      scratch.dir.subVectors(camera.position, controls.target)
      const radius = scratch.dir.length()
      if (radius > 1e-9 && Math.abs(radius - reframe.current) > reframe.current * 1e-3) {
        const step = (reframe.current - radius) * smooth(delta, REFRAME_RATE)
        camera.position.addScaledVector(scratch.dir, step / radius)
      } else {
        reframe.current = 0
      }
    }
  }, 0)

  return null
}
