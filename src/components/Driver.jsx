import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { live, refreshDerived, updateNearestSurface } from '../sim/live.js'
import { activeStage, applyThrust, input, integrateAttitude, ship } from '../sim/ship.js'
import {
  applyClamp,
  beginCountdown,
  commitTLI,
  currentPhase,
  isClamped,
  isSplashed,
  applySplashdownHold,
  mission,
  resetMission,
  updateMission,
  updateTLI,
} from '../sim/mission.js'
import { setUi, uiStore, useUi, WARP, WARP_LEVELS } from '../sim/store.js'
import { director, updateDirector } from '../sim/director.js'

/**
 * Steps the integrator once per frame, before anything reads a position.
 *
 * Runs at priority -3 so the ordering across the frame is: physics, then bodies
 * follow the physics, then OrbitControls damping (drei uses -1), then the camera
 * rig re-anchors onto its target. Priorities must stay negative — a positive
 * renderPriority makes R3F hand the render loop over to the caller.
 */
/**
 * Warp ceiling while the engines are lit, named rather than numbered.
 *
 * Thrust and attitude are held constant for a whole frame, so the error that
 * matters is per *frame*, not per substep. At 1 min/s that is one simulated
 * second per frame — about 0.3 degrees of pitch during a gravity turn, which is
 * negligible, and it turns an authentic eight-minute ascent into eight watchable
 * seconds.
 */
const POWERED_WARP_CAP = WARP.m1

/** Which body the floating origin pins to, per camera mode. */
const ORIGIN_BODY = {
  sun: 'sun',
  earth: 'earth',
  moon: 'moon',
  ship: 'ship',
  chase: 'ship',
  // Ground camera: the origin belongs on the planet it is standing on, not on
  // the vehicle it is watching leave.
  pad: 'earth',
  iss: 'iss',
  hubble: 'hubble',
  free: null, // follows the orbit target instead
  /**
   * Free flight rides whatever it is nearest, resolved per frame — see below.
   * The table entry is a placeholder so the map stays exhaustive.
   */
  fly: null,
}

export function Driver() {
  const warp = useUi((s) => s.warp)
  const paused = useUi((s) => s.paused)
  const assist = useUi((s) => s.assist)
  const focus = useUi((s) => s.focus)
  const three = useThree()
  const warpBeforeBurn = useRef(null)
  const lastWarpRequest = useRef(null)
  /** Which body the origin was pinned to last frame, for the rebase test below. */
  const lastOrigin = useRef(null)
  const lastShotRequest = useRef(null)
  const lastShotWarp = useRef(null)

  // Arm the sequencer once. Without this the opening phase's enter() never
  // runs, so the autopilot is never engaged and the vehicle would leave the pad
  // under manual RCS with nobody at the controls.
  useEffect(() => {
    resetMission()
  }, [])

  // Dev-only inspection handle. Exposes the modules' *own* instances — a
  // dynamic import from the console resolves to a different copy once Vite has
  // hot-reloaded a module under a timestamp query, so poking at that would
  // silently mutate a second, unused store.
  useEffect(() => {
    if (import.meta.env.DEV) window.__spx = {
        live,
        three,
        ship,
        input,
        uiStore,
        setUi,
        mission,
        // The step functions too, not just the state. A dynamic import from the
        // console resolves to a *different* module copy once Vite has
        // hot-reloaded under a timestamp query, so driving the sim that way
        // silently advances a second, unused simulation.
        step: {
          updateMission,
          integrateAttitude,
          applyThrust,
          isClamped,
          applyClamp,
          refreshDerived,
          beginCountdown,
          commitTLI,
          updateTLI,
          currentPhase,
        },
      }
  }, [three])

  useFrame((_, delta) => {
    /**
     * Nearest surface, computed *first* — against last frame's rendered state,
     * which is the last moment the camera and `live.pos` agree.
     *
     * Both are in the origin `refreshDerived` established last frame: the rig
     * wrote the camera at priority 0 then, and nothing has moved either since.
     * One frame of lag is immaterial for a scalar that sets a movement speed.
     *
     * Two wrong versions came before this. The first ran later in this same
     * callback, *after* the origin had been rebased and the camera shifted by
     * the delta — an offset of 4.3e7 m per frame at 1 day/s, since the origin
     * rides a body moving at 30 km/s. That shift is meaningful only in free
     * flight, where OrbitControls owns the camera; in a locked mode the rig
     * overwrites the position outright at priority 0, so the intermediate value
     * is nowhere. It read 33,629 km from a camera 147 m above the pad.
     *
     * The second moved it to its own `useFrame` at priority 1, to run after the
     * rig. That does order correctly and it also stops the renderer: in R3F any
     * subscriber with a priority above zero takes over the render loop, and
     * nothing calls `gl.render` any more. Measured as `internal.priority` of 2
     * and zero rendered frames in a second.
     */
    updateNearestSurface(three.camera.position)

    // A backgrounded tab hands back a delta of many seconds. Clamping keeps a
    // returning tab from teleporting the planets across a third of an orbit.
    const dt = Math.min(delta, 1 / 20)
    live.fps += (1 / Math.max(delta, 1e-4) - live.fps) * 0.08

    ship.assist = assist

    // How much simulated time this frame covers. Needed before the sequencer,
    // because flight timing and attitude both advance with the simulation
    // rather than the wall clock.
    // The sequencer may ask for a warp level — it skips the ballistic coast to
    // apoapsis, which is most of an orbit of nothing happening. Applied only on
    // change, so the pilot keeps control the rest of the time.
    if (mission.warpRequest !== null && mission.warpRequest !== lastWarpRequest.current) {
      lastWarpRequest.current = mission.warpRequest
      setUi({ warp: mission.warpRequest })
    } else if (mission.warpRequest === null) {
      lastWarpRequest.current = null
    }

    const rate = WARP_LEVELS[uiStore.get().warp].rate
    let simDt = paused ? 0 : dt * rate
    live.simDtLastFrame = simDt

    const phaseBefore = mission.index

    // Sequencer first: it commands throttle and target attitude, both of which
    // the steps below consume. Transitions evaluated here are current, not
    // stale — the derived state is the result of the previous step.
    updateMission(dt, simDt)

    /**
     * Burning under time compression is meaningless — a few seconds of engine
     * stretched over a simulated week would hand out absurd delta-v. Drop to
     * real time while the throttle is open, and restore what the pilot had once
     * it closes.
     *
     * The test is the *commanded* throttle, not `ship.thrust`. Thrust is written
     * by applyThrust() further down, so reading it here reports the previous
     * frame — and a phase's enter() opens the throttle inside updateMission
     * above, so the ignition frame escaped the cap entirely.
     */
    const stage = activeStage()
    const burning = ship.throttle > 0 && stage !== null && ship.stageProp[ship.stage] > 0

    if (burning) {
      if (warp > POWERED_WARP_CAP) {
        warpBeforeBurn.current = warp
        setUi({ warp: POWERED_WARP_CAP })
      }
    } else if (warpBeforeBurn.current !== null) {
      const restore = warpBeforeBurn.current
      warpBeforeBurn.current = null
      /**
       * Hand the dial back only if nobody else is driving.
       *
       * While the sequencer is asking for a warp level it owns the dial, and
       * restoring over the top of it drops a day-long step into whatever phase
       * follows cutoff: MECO's three-second hold becomes a single 1440 s frame
       * and the mission clock jumps 24 minutes. The restore exists for the
       * pilot's own burns, which are the case where nothing is being requested.
       */
      if (mission.warpRequest === null && uiStore.get().warp <= POWERED_WARP_CAP) {
        setUi({ warp: restore })
      }
    }

    /**
     * Lowering the warp above only reaches `rate` on the *next* frame, and this
     * frame's step was committed before the sequencer ran — so the ignition
     * frame has to be clamped directly, or it integrates a full day of
     * full-throttle SLS in one go and the vehicle leaves on a solar trajectory.
     *
     * The mission clock is wound back by whatever is removed, so flight time and
     * simulated time stay one quantity. A frame that changed phase needs no
     * correction: the transition reset `phaseT` and, at liftoff, set the mission
     * clock outright, so nothing this frame added survives in either.
     */
    const poweredStep = WARP_LEVELS[POWERED_WARP_CAP].rate * dt
    if (burning && simDt > poweredStep) {
      if (mission.index === phaseBefore) {
        mission.t -= simDt - poweredStep
        mission.phaseT -= simDt - poweredStep
      }
      simDt = poweredStep
      live.simDtLastFrame = simDt
    }

    // Attitude next, in simulated seconds: the vehicle turns in the world, and
    // the world has advanced by simDt. The thrust axis this produces is then
    // held fixed across every RK4 stage of the step.
    integrateAttitude(simDt)

    applyThrust(dt, simDt, live.sim.extAccel)
    live.sim.dragK[0] = live.sim.extAccel.dragK ?? 0 // slot 0 is the ship
    live.sim.liftK[0] = live.sim.extAccel.liftK ?? 0
    live.sim.bank[0] = live.sim.extAccel.bank ?? 0

    live.stepsLastFrame = paused ? 0 : live.sim.advance(simDt, live.maxDt)

    // The pad hold is a constraint, applied after the step: whatever gravity
    // did to the vehicle this frame is simply discarded.
    if (isClamped()) applyClamp()
    // Same shape at the other end of the mission: once the capsule is down it
    // rides the surface instead of continuing through it.
    if (isSplashed()) applySplashdownHold()

    /**
     * The camera director, applied the way the warp ladder is: only when the
     * request *changes*.
     *
     * That single rule is what makes it a director rather than a lock. `focus`
     * is store state, so writing it re-runs the rig's effect and starts a fly-to
     * — doing that every frame would restart the flight every frame and pin the
     * camera immovably. Applied on change, a pilot who picks another view keeps
     * it until the next phase boundary, which is the same bargain the sequencer
     * already strikes over time warp.
     */
    updateDirector()
    if (director.request !== null && director.request !== lastShotRequest.current) {
      lastShotRequest.current = director.request
      if (uiStore.get().focus !== director.request) setUi({ focus: director.request })
    } else if (director.request === null) {
      lastShotRequest.current = null
    }

    /**
     * A shot may also ask for a pace, on exactly the same terms.
     *
     * Applied on change and nothing else, so it is a request rather than a lock
     * and the pilot keeps whatever they choose afterward. It has the weakest
     * claim on the dial of anything here: the sequencer asks for physics
     * reasons above, and the powered clamp further down overrides both by
     * capping this frame's step where it is used — so a shot can slow the
     * mission down but can never speed it past what is safe to integrate.
     *
     * It lands after the sequencer deliberately. Where both want the dial on the
     * same frame the shot wins, and the only phases that state a warp are ones
     * the sequencer is not laddering.
     */
    if (director.warp !== null && director.warp !== lastShotWarp.current) {
      lastShotWarp.current = director.warp
      if (uiStore.get().warp !== director.warp) setUi({ warp: director.warp })
    } else if (director.warp === null) {
      lastShotWarp.current = null
    }

    // Rebase. The origin follows whatever the camera is looking at; in free
    // flight it follows the orbit target, which only moves when the user does.
    const controls = three.controls
    /**
     * Free flight anchors to the nearest body, not to inertial space.
     *
     * Pinning the origin to the camera was the obvious reading of "free" and it
     * is unusable: a viewpoint fixed in the heliocentric frame is a viewpoint
     * the solar system leaves. Earth moves at 30 km/s, so at 1 day/s it departs
     * a stationary camera at 2.59e9 m per wall-clock second — measured as
     * 261,779 km of clearance a tenth of a second after entering the mode, from
     * a camera that had been standing 147 m above the pad.
     *
     * Anchoring to `live.nearest.id` instead makes the camera co-move with
     * whatever it is closest to, which is what a viewer means by standing
     * still. The handoff as one body gives way to another is continuous in
     * position — the loop below shifts the camera by the same vector as the
     * origin — and changes only which motion the camera shares.
     */
    const flying = focus === 'fly'
    const originBody = flying ? (live.nearest.id ?? 'earth') : (ORIGIN_BODY[focus] ?? null)
    refreshDerived(originBody, originBody ? null : (controls?.target ?? null))

    /**
     * Shifting the origin without shifting the camera by the same vector would
     * throw the view across the scene. Moving both together leaves the offset
     * between them untouched, so OrbitControls recomputes an identical
     * spherical next frame — the same trick the focus follow already relies on.
     *
     * Except in free flight, and only while the anchor holds. The correction
     * assumes the camera's coordinates were fixed in the frame the origin just
     * left; every other mode either has the rig overwrite the position outright
     * a moment later, or is following the very target the origin tracks. Free
     * flight does neither — it integrates a position that is already expressed
     * relative to the anchor — so applying the shift pushes the camera away
     * from the body it is supposed to be riding, by that body's motion, every
     * frame. At 1 day/s Earth moves 2.59e9 m per wall-clock second, and the
     * clearance readout climbed from 147 m to 654,104 km with the speed showing
     * a steady 0.0 m/s.
     *
     * When the anchor *changes* the shift is exactly right and is needed: the
     * camera's coordinates have to be rebased from one body to another, and
     * `originDelta` is that rebasing. So the test is on the anchor, not on the
     * mode.
     */
    const anchorHeld = flying && originBody === lastOrigin.current
    lastOrigin.current = originBody
    if (controls && live.originDelta.lengthSq() > 0 && !anchorHeld) {
      three.camera.position.sub(live.originDelta)
      controls.target.sub(live.originDelta)
    }
  }, -3)

  return null
}
