import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { live } from '../sim/live.js'
import { springFollow, omegaForSettling } from '../gfx/follow.js'
import { LAUNCH_SITES, siteDirection } from '../sim/launchsite.js'
import { AU, BODIES, CRAFT, SHIP } from '../sim/constants.js'
import { mission } from '../sim/mission.js'
import { ship } from '../sim/ship.js'
import { useUi } from '../sim/store.js'

/**
 * How the camera frames each body when it locks on, and how close it may get.
 * Metres, like everything else the scene draws.
 *
 * The multiples are the ones the exaggerated scene already used — they were
 * always written against each body's rendered radius, so they survive the
 * change to true scale by substitution and the framing is unchanged. Only the
 * outer limits are new numbers, because the old ones were bounded by a scene
 * 120 units wide per AU and had no meaning in metres.
 *
 * Kept unexported: a non-component export from a component module disables
 * React Fast Refresh for the whole file.
 */
const FRAMING = {
  sun: { distance: BODIES.sun.radius * 4.6, min: BODIES.sun.radius * 1.35, max: 2 * AU },
  earth: { distance: BODIES.earth.radius * 5.2, min: BODIES.earth.radius * 1.25, max: 4e9 },
  moon: { distance: BODIES.moon.radius * 6.0, min: BODIES.moon.radius * 1.3, max: 4e9 },
  ship: { distance: SHIP.visual * 4.5, min: SHIP.visual * 1.1, max: 1e9 },
  chase: { distance: SHIP.visual * 4.5, min: 0, max: 0 },
  pad: { distance: 0, min: 0, max: 0 },
  iss: { distance: CRAFT.iss.visual * 4.4, min: CRAFT.iss.visual * 1.2, max: 1e9 },
  hubble: { distance: CRAFT.hubble.visual * 4.4, min: CRAFT.hubble.visual * 1.25, max: 1e9 },
  /** Free flight roams the system: a metre off a hull out to a few AU. */
  free: { distance: 0, min: 1, max: 1e12 },
}

/** Where the chase camera sits, in the craft's own body frame. Metres. */
const CHASE_OFFSET = { back: SHIP.visual * 4.2, up: SHIP.visual * 1.3 }

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
      aim: new THREE.Vector3(),
      aimVel: new THREE.Vector3(),
      anchor: new THREE.Vector3(),
    }),
    [],
  )
  const baseFov = useRef(null)

  useEffect(() => {
    if (!controls) return
    const frame = FRAMING[focus]

    // Chase drives the camera outright, so orbit input is handed back only when
    // leaving the mode.
    controls.enabled = focus !== 'chase' && focus !== 'pad'
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

    controls.minDistance = frame.min
    controls.maxDistance = frame.max
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
