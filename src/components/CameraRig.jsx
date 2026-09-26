import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { live } from '../sim/live.js'
import { RAIL_BY_ID } from '../sim/rails.js'
import { springFollow, omegaForSettling } from '../gfx/follow.js'
import { activeSite, siteDirection } from '../sim/launchsite.js'
import { currentHullLift } from '../gfx/pads.js'
import { EYE_FOV, groundViewpoint, lunarViewpoint } from '../gfx/groundView.js'
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
import { INTRO, introStep } from '../gfx/introFlights.js'
import { mission } from '../sim/mission.js'
import { MAX_NODE_FRAMES, plan, prediction } from '../sim/predict.js'
import { selectedNode } from '../sim/nodes.js'
import { ship } from '../sim/ship.js'
import { useUi } from '../sim/store.js'

/**
 * Where the ground camera stands: 687 m across the launch azimuth, 147 m up.
 *
 * These are now the distances they claim to be. Under the old display scale the
 * vehicle was drawn 0.022 scene units long — about 27,000 km in the position
 * frame — so framing had to be chosen against the *rendered* size, and a camera
 * at a physically honest 500 m would have sat deep inside the rocket. The
 * comment here used to apologise for that. There is nothing left to apologise
 * for: a real tracking camera stands a few hundred metres out with a long lens
 * on it, and so does this one.
 *
 * `lateral` is across the azimuth so the ascent crosses the frame rather than
 * receding straight down the lens; `up` lifts the camera clear of the ground.
 */
const PAD_OFFSET = {
  lateral: SHIP.visual * 7,
  up: SHIP.visual * 1.5,
}

/**
 * The ground camera zooms to hold the vehicle a roughly constant size, which is
 * what a tracked long lens does and what makes an ascent read as *distance*
 * rather than as the rocket simply shrinking. Clamped at both ends: too narrow
 * and every tremor is amplified, too wide and it stops being a long lens.
 */
const PAD_FOV = { min: 2.5, max: 42, fill: 0.22 }

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

/** How long the cut out of the pad shot takes to blend into the chase. */
const CHASE_BLEND = 1.5

/**
 * How many chase-lengths away the previous shot may be before entering the
 * chase becomes a cut rather than a move. Described where it is used.
 *
 * Eight, because the shot this is reached from is the ground or pad camera at
 * a few hundred metres — under one length on Apollo 8's 110 m stack, and about
 * 1.7 on a 3.47 m capsule — while the shot that made it necessary is Earth's
 * lock at 38,000 lengths. Nothing legitimate lands between.
 */
const CHASE_CUT_FACTOR = 8

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

const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)

/**
 * Camera lock.
 *
 * Locking has two phases. A ~1.2s eased flight to frame the body, then a hard
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
  const flight = useRef(null)
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
    }),
    [],
  )
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
  /** The drawn length last framed, and the radius a reframe is closing on. */
  const hullSeen = useRef(STAGE_LENGTH[0])
  const reframe = useRef(0)
  if (flyKeys.current === null) flyKeys.current = new Set()

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
    if (focus !== 'fly') return
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
    const frame = FRAMING[focus]

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

    // Leaving the pad, ground or intro shot: give the lens back before anything else uses it.
    if (focus !== 'pad' && focus !== 'ground' && focus !== 'intro' && baseFov.current !== null) {
      camera.fov = baseFov.current
      camera.updateProjectionMatrix()
      baseFov.current = null
    }

    if (focus === 'pad' || focus === 'ground') {
      if (baseFov.current === null) baseFov.current = camera.fov
      opening.current = false
      flight.current = null
      // The aim is seeded on the first frame, from that frame's positions.
      seedAim.current = true
      if (focus === 'ground') {
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
      if (baseFov.current === null) baseFov.current = camera.fov
      flight.current = null
      opening.current = false
      return
    }

    if (focus === 'chase') {
      /**
       * Blend into the chase rather than snapping — in the *body frame*, from
       * wherever the previous shot left the camera relative to the craft.
       *
       * Entering chase used to return here with no transition, and the frame
       * loop then snapped outright whenever the gap exceeded twelve hull
       * lengths — which a hand-off from a ground camera always does, since that
       * camera stands several hull lengths away by construction. The blend is
       * timed rather than sprung because the offset is being retargeted; a
       * spring adds an overshoot the cut does not need.
       *
       * But a blend is a *flight of the camera*, and it is only the right
       * answer when the two shots are near enough that a flight between them
       * reads as a move. Measured, they are not: `COAST_TO_APOAPSIS` and
       * `CIRCULARISE` frame the craft from Earth's lock at 5.2 radii — 33,150 km
       * — so cutting to the chase meant flying the camera **33,791 km in 1.5 s**
       * to end 412 m behind the vehicle. Rendered at 60x it is the single worst
       * thing in the flight, and it is the shot the two burns above are cut to.
       *
       * So the gap decides. Within a few chase lengths it is a move and gets the
       * blend; beyond that it is a different place entirely and a cut is the
       * only honest transition — which is also what the director's own shots do
       * everywhere else.
       */
      const hull = STAGE_LENGTH[Math.min(Math.max(ship.stage | 0, 0), STAGE_LENGTH.length - 1)]
      const reach = ship.thrust > 0 ? hull * LIT_REACH : hull
      const near = Math.hypot(CHASE_MULTIPLE.back * reach, CHASE_MULTIPLE.up * reach)
      scratch.offset.subVectors(camera.position, live.pos.ship)
      flight.current =
        scratch.offset.length() > near * CHASE_CUT_FACTOR
          ? { chaseSnap: true }
          : {
              chaseBlend: true,
              elapsed: 0,
              duration: CHASE_BLEND,
              fromOffset: scratch.offset.clone(),
            }
      opening.current = false
      return
    }

    if (focus === 'cinematic') {
      flight.current = null
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
      flight.current = null
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
      flight.current = null
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
        camera.fov,
        (BODIES[focus]?.radius ?? BODIES.earth.radius) * 3,
      )
    } else if (focus === 'node') {
      const anchor = live.pos[plan.reference]
      const away = nodePosition(scratch.nodeAim) ? scratch.nodeAim.distanceTo(anchor) : 0
      const surface = BODIES[plan.reference]?.radius ?? BODIES.earth.radius
      distance = Math.max(surface * 1.6, away * 0.9)
    }

    // Keep the current viewing direction through the flight, so locking on
    // feels like a dolly toward the body rather than a swing around it.
    const dir = new THREE.Vector3().subVectors(camera.position, controls.target)
    if (dir.lengthSq() < 1e-8) dir.set(0.45, 0.28, 1)
    dir.normalize()

    // The very first lock is the opening shot, and there is nothing to ease
    // from — the default camera is nowhere near the target, so animating it
    // just makes the user watch a 1.2s swoop past the Sun. Snap instead, and
    // pick the angle deliberately: offset from the sun line so the body opens
    // on a lit three-quarter face with the terminator in view, rather than the
    // flat fully-lit disc you get looking straight down the sun vector.
    if (opening.current) {
      opening.current = false
      const sunward = new THREE.Vector3().subVectors(live.pos.sun, live.pos[focus] ?? live.railPos[focus])
      if (sunward.lengthSq() > 1e-8) {
        sunward.normalize()
        const right = new THREE.Vector3().crossVectors(WORLD_UP, sunward).normalize()
        dir
          .copy(sunward)
          .multiplyScalar(0.62)
          .addScaledVector(right, 0.72)
          .addScaledVector(WORLD_UP, 0.3)
          .normalize()
      }
      controls.target.copy(live.pos[focus] ?? live.railPos[focus])
      camera.position.copy(controls.target).addScaledVector(dir, frame.distance)
      flight.current = null
      return
    }

    flight.current = {
      elapsed: 0,
      duration: 1.2,
      fromCamera: camera.position.clone(),
      fromTarget: controls.target.clone(),
      dir,
      distance,
    }
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

      scratch.anchor
        .copy(live.pos.earth)
        .addScaledVector(scratch.siteDir, BODIES.earth.radius + PAD_OFFSET.up)
        .addScaledVector(scratch.east, PAD_OFFSET.lateral)
      camera.position.copy(scratch.anchor)

      // The aim point is sprung, not snapped: a vehicle accelerating off a pad
      // is precisely the target whose velocity a first-order lag cannot carry.
      // Aimed at the hull as drawn, not at the state: on the pad the hull is
      // raised onto the deck (gfx/pads.js), and a camera aimed at the centre
      // of mass would frame a vehicle standing in the top half of the shot.
      scratch.padAim
        .copy(live.pos.ship)
        .addScaledVector(scratch.siteDir, currentHullLift(site.id))
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

      // Long lens: hold the vehicle at a roughly constant fraction of frame.
      const range = camera.position.distanceTo(live.pos.ship)
      const wanted =
        (2 * Math.atan(hull / (PAD_FOV.fill * 2 * Math.max(range, 1e-6))) * 180) / Math.PI
      const fov = Math.min(PAD_FOV.max, Math.max(PAD_FOV.min, wanted))
      if (Math.abs(camera.fov - fov) > 1e-3) {
        camera.fov = fov
        camera.updateProjectionMatrix()
      }

      camera.up.copy(scratch.siteDir)
      camera.lookAt(scratch.aim)
      controls.target.copy(scratch.aim)
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

      const blend = flight.current
      if (blend?.chaseSnap) {
        // Straight to the shot. A cut has no duration to run, so this clears on
        // the same frame it was asked for.
        scratch.offset.copy(scratch.desired)
        flight.current = null
      } else if (blend?.chaseBlend) {
        blend.elapsed += delta
        const t = easeInOutCubic(Math.min(1, blend.elapsed / blend.duration))
        scratch.offset.lerpVectors(blend.fromOffset, scratch.desired, t)
        if (blend.elapsed >= blend.duration) flight.current = null
      } else {
        scratch.offset.lerp(scratch.desired, smooth(delta, 6))
      }

      camera.position.copy(live.pos.ship).add(scratch.offset)
      camera.up.lerp(scratch.up, smooth(delta, 4))
      camera.lookAt(live.pos.ship)
      controls.target.copy(live.pos.ship)
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
          // state vector. It is drawn from the same buffer it pulls with.
          (RAIL_BY_ID[focus] ? live.railPos[focus] : live.pos[focus])
    const f = flight.current

    if (f) {
      f.elapsed += delta
      const t = easeInOutCubic(Math.min(1, f.elapsed / f.duration))
      scratch.to.copy(target).addScaledVector(f.dir, f.distance)
      camera.position.lerpVectors(f.fromCamera, scratch.to, t)
      controls.target.lerpVectors(f.fromTarget, target, t)
      if (f.elapsed >= f.duration) flight.current = null
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
