import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { live } from '../sim/live.js'
import { springFollow, omegaForSettling } from '../gfx/follow.js'
import { LAUNCH_SITES, siteDirection } from '../sim/launchsite.js'
import { BODIES, SHIP } from '../sim/constants.js'
import { CHASE_OFFSET, FRAMING, detentsIn, zoomSpeedFor } from '../gfx/framing.js'
import { clampTrim, flyAxisInput, flyModifier, flySpeed } from '../gfx/fly.js'
import { mission } from '../sim/mission.js'
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

/** How long the cut out of the pad shot takes to blend into the chase. */
const CHASE_BLEND = 1.5

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
      anchor: new THREE.Vector3(),
    }),
    [],
  )
  const baseFov = useRef(null)
  const zoomBase = useRef(1)
  const focusRef = useRef(focus)
  focusRef.current = focus
  const flyKeys = useRef(null)
  const flyLook = useRef({ yaw: 0, pitch: 0, dragging: false, pointer: null, x: 0, y: 0 })
  const flyTrim = useRef(1)
  const cineT = useRef(0)
  if (flyKeys.current === null) flyKeys.current = new Set()

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

    const onPointerDown = (e) => {
      if (e.button !== 0) return
      look.dragging = true
      look.pointer = e.pointerId
      look.x = e.clientX
      look.y = e.clientY
      canvas.setPointerCapture?.(e.pointerId)
    }
    const onPointerMove = (e) => {
      if (!look.dragging || e.pointerId !== look.pointer) return
      look.yaw -= (e.clientX - look.x) * LOOK_PER_PIXEL
      look.pitch = THREE.MathUtils.clamp(
        look.pitch - (e.clientY - look.y) * LOOK_PER_PIXEL,
        -PITCH_LIMIT,
        PITCH_LIMIT,
      )
      look.x = e.clientX
      look.y = e.clientY
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
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    return () => {
      canvas.removeEventListener('pointerdown', onPointerDown)
      canvas.removeEventListener('pointermove', onPointerMove)
      canvas.removeEventListener('pointerup', onPointerUp)
      canvas.removeEventListener('pointercancel', onPointerUp)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
      keys.clear()
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
      focus !== 'chase' && focus !== 'pad' && focus !== 'fly' && focus !== 'cinematic'
    // Panning moves the orbit target, which is meaningful only when the camera
    // is not already pinned to a body.
    controls.enablePan = focus === 'free'

    // Leaving the pad shot: give the lens back before anything else uses it.
    if (focus !== 'pad' && baseFov.current !== null) {
      camera.fov = baseFov.current
      camera.updateProjectionMatrix()
      baseFov.current = null
    }

    if (focus === 'pad') {
      if (baseFov.current === null) baseFov.current = camera.fov
      opening.current = false
      flight.current = null
      // Seed the aim filter at the craft so the first frame is not a swing.
      scratch.aim.copy(live.pos.ship)
      scratch.aimVel.set(0, 0, 0)
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
       */
      scratch.offset.subVectors(camera.position, live.pos.ship)
      flight.current = {
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
    if (focus === 'free') {
      flight.current = null
      return
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
      const sunward = new THREE.Vector3().subVectors(live.pos.sun, live.pos[focus])
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
      controls.target.copy(live.pos[focus])
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
      distance: frame.distance,
    }
  }, [focus, controls, camera])

  useFrame((_, delta) => {
    if (!controls || focus === 'free') return

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
    if (focus === 'pad') {
      const site = mission.site ?? LAUNCH_SITES.ksc
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
      springFollow(
        scratch.aim,
        scratch.aim,
        live.pos.ship,
        scratch.aimVel,
        omegaForSettling(PAD_AIM_SETTLE),
        Math.min(delta, 1 / 20),
      )

      // Long lens: hold the vehicle at a roughly constant fraction of frame.
      const range = camera.position.distanceTo(live.pos.ship)
      const wanted =
        (2 * Math.atan(SHIP.visual / (PAD_FOV.fill * 2 * Math.max(range, 1e-6))) * 180) /
        Math.PI
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
      scratch.back.set(0, 0, -1).applyQuaternion(ship.quaternion)
      scratch.up.set(0, 1, 0).applyQuaternion(ship.quaternion)
      scratch.desired
        .set(0, 0, 0)
        .addScaledVector(scratch.back, CHASE_OFFSET.back)
        .addScaledVector(scratch.up, CHASE_OFFSET.up)

      const blend = flight.current
      if (blend?.chaseBlend) {
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

    const target = live.pos[focus]
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
  }, 0)

  return null
}
