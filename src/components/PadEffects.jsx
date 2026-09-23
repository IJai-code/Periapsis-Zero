import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { aimPadParticles, makePadParticles } from '../gfx/padParticles.js'
import { vehicleFootprint } from '../gfx/pads.js'
import { SOLAR_INTENSITY, padScenePoint } from '../gfx/sunlight.js'
import { delugeLevel, ignitionThrottle, steamLevel, ventLevel } from '../sim/countdown.js'
import { SHIP } from '../sim/constants.js'
import { live } from '../sim/live.js'
import { activeSite } from '../sim/launchsite.js'
import { mission } from '../sim/mission.js'
import { ship } from '../sim/ship.js'

/**
 * The pad's weather during the last minute: vapour, spray and steam.
 *
 * Rendered inside `LaunchPad`'s group, so everything here is in the pad frame —
 * x east, y up, z north, origin at the pad on the datum — and rides the turning
 * planet with the structures rather than being positioned every frame.
 *
 * The emitters are derived rather than placed. Vents sit just below each stage
 * interface *as drawn*, from the stage's own `visual` extent, because that is
 * where a propellant tank's forward end is and it keeps the vapour on the hull
 * the viewer can see whichever vehicle is standing there. Steam leaves by the
 * pad's own exhaust path — the two mouths of the flame trench, or on a pad
 * built over a pit, up out of the opening all round.
 *
 * What moves each frame is the countdown clock and three effects' levels, a
 * rotation of the sun into view space, the sunlight's illuminance at the pad,
 * and nothing else. When all three levels
 * are zero — the idle pad, the landing page, a vehicle days into its mission —
 * the meshes are hidden, so an effect nobody can see costs no draw call.
 */

/*
 * The numbers below are drawing decisions, stated as such — there is no
 * measured steam cloud here to be matched. One thing in them is physics and is
 * marked where it appears: the *sign* of `rise`, which says whether a gas is
 * lighter or heavier than the air around it. The magnitudes are chosen to read
 * as the real thing does from a few hundred metres, and were adjusted by
 * looking at them rendered.
 */
/*
 * The Sun's luminous intensity in the pad light's units, copied into this
 * module so the frame loop reads a local: an export read inside a hot function
 * is not folded, and `gfx/sunlight.js` measured what that costs.
 */
const SUN = SOLAR_INTENSITY

const VENT = {
  count: 540,
  colour: '#f4f6f7',
  // Thin. Ninety puffs overlap in each stream at any moment, and at 0.6 each
  // the stream saturated into an opaque white egg that hid the stage behind
  // it — the first thing anyone saw from the ground was three balloons.
  opacity: 0.26,
  life: 9,
  // Out of the vent as a jet, slowed in a metre or two, then falling.
  speed: 4,
  spread: 0.12,
  drag: 1.2,
  // Liquid-oxygen boil-off is far colder than the air and denser than it: it
  // falls, which is why the real vents pour down the side of the vehicle in
  // long streamers rather than puffing off it. Drawn at 2.8 m/s of sink over
  // nine seconds, twenty-five metres of fall — the first version sank at 1.6
  // over four and read as small knots at each vent rather than streams.
  rise: -2.8,
  // Narrow at the vent and widening as it falls and mixes; at 13 m a stream
  // was wider than the S-IVB it was venting from.
  size0: 0.8,
  size1: 6,
}

const SPRAY = {
  count: 500,
  colour: '#dfe9ee',
  opacity: 0.35,
  life: 1.4,
  speed: 14,
  spread: 0.35,
  drag: 1.6,
  rise: -2,
  size0: 0.8,
  size1: 4.5,
}

const STEAM = {
  count: 2200,
  colour: '#f1ece4',
  opacity: 0.55,
  life: 8,
  // Driven out along the ground by the exhaust behind it: about 117 m of travel
  // (speed over drag) from each trench mouth before the air has slowed it.
  speed: 70,
  spread: 0.45,
  drag: 0.6,
  // Hot, so it rises — but slower than it spreads, and it lifts as it cools and
  // slows. At 6 m/s with a steep launch it stood up in two columns.
  rise: 2.5,
  // Many smaller puffs rather than fewer large ones: at 70 m each, a cloud was
  // a smooth oval; at 42 it is lumpy, which is what steam looks like.
  size0: 8,
  size1: 42,
}

function ventEmitters(deck) {
  const foot = vehicleFootprint()
  const r = foot.radius
  const stages = SHIP.stages
  const top = stages[0].visual
  const out = []
  for (let i = 1; i < Math.min(stages.length, 4); i++) {
    // Just below the interface, on the hull as drawn.
    const h = top - stages[i].visual - 2
    if (!(h > 5)) continue
    for (const a of [0.4, 0.4 + Math.PI]) {
      out.push({
        pos: [Math.cos(a) * r, deck + h, Math.sin(a) * r],
        dir: [Math.cos(a), -0.15, Math.sin(a)],
        jitter: [0.6, 1.2, 0.6],
      })
    }
  }
  return out
}

function sprayEmitters(deck, hole) {
  const out = []
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2
    out.push({
      pos: [Math.cos(a) * hole * 0.9, deck + 0.5, Math.sin(a) * hole * 0.9],
      // Up and in: the deluge is aimed at the exhaust's path, not away from it.
      dir: [-Math.cos(a) * 0.5, 1, -Math.sin(a) * 0.5],
      jitter: [2, 0.5, 2],
    })
  }
  return out
}

function steamEmitters(exhaust) {
  if (exhaust.axis !== null) {
    const out = []
    for (const s of [-1, 1]) {
      const along = s * exhaust.half
      const z = exhaust.axis === 'z'
      out.push({
        pos: z ? [0, exhaust.floor + 3, along] : [along, exhaust.floor + 3, 0],
        dir: z ? [0, 0.15, s] : [s, 0.15, 0],
        jitter: z ? [exhaust.width, 4, 3] : [3, 4, exhaust.width],
      })
    }
    return out
  }
  // A pit: the steam comes up out of the opening, all the way round.
  const out = []
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2
    out.push({
      pos: [Math.cos(a) * exhaust.half, exhaust.floor, Math.sin(a) * exhaust.half],
      dir: [Math.cos(a) * 0.6, 1, Math.sin(a) * 0.6],
      jitter: [6, 2, 6],
    })
  }
  return out
}

export function PadEffects({ built }) {
  const effects = useMemo(() => {
    const { pad, exhaust, hole } = built
    return {
      vent: makePadParticles({ ...VENT, emitters: ventEmitters(pad.deck) }),
      spray: makePadParticles({ ...SPRAY, emitters: sprayEmitters(pad.deck, hole) }),
      steam: makePadParticles({ ...STEAM, emitters: steamEmitters(exhaust) }),
    }
  }, [built])
  useEffect(
    () => () => {
      for (const e of Object.values(effects)) {
        e.geometry.dispose()
        e.material.dispose()
      }
    },
    [effects],
  )

  const vent = useRef()
  const spray = useRef()
  const steam = useRef()
  const scratch = useMemo(() => ({ pad: new THREE.Vector3(), up: new THREE.Vector3(), sun: new THREE.Vector3() }), [])

  useFrame(({ camera, clock }) => {
    // Nothing is venting, spraying or steaming on a pad nobody is counting down.
    const running = mission.running
    const T = mission.t
    const throttle = ship.throttle
    const lv = running ? ventLevel(T) : 0
    const ls = running ? delugeLevel(T) * (1 - ignitionThrottle(T)) : 0
    const lt = running ? steamLevel(T, throttle) : 0

    if (vent.current) vent.current.visible = lv > 0.002
    if (spray.current) spray.current.visible = ls > 0.002
    if (steam.current) steam.current.visible = lt > 0.002
    if (!(lv > 0.002 || ls > 0.002 || lt > 0.002)) return

    // Daylight at the pad, and the sun in view space for the puffs' shading.
    padScenePoint(scratch.pad, mission.site ?? activeSite())
    scratch.up.copy(scratch.pad).sub(live.pos.earth).normalize()
    const sinEl = live.sunDir.dot(scratch.up)
    const daylight = sinEl > 0.15 ? 1 : sinEl < -0.05 ? 0 : (sinEl + 0.05) / 0.2
    scratch.sun.copy(live.sunDir).transformDirection(camera.matrixWorldInverse)
    // The illuminance the pad's own light delivers here, over pi.
    const r2 = scratch.pad.distanceToSquared(live.pos.sun)
    const light = SUN / r2 / Math.PI

    const t = clock.elapsedTime
    aimPadParticles(effects.vent.material, t, lv, scratch.sun, daylight, light)
    aimPadParticles(effects.spray.material, t, ls, scratch.sun, daylight, light)
    aimPadParticles(effects.steam.material, t, lt, scratch.sun, daylight, light)
  })

  return (
    <group>
      <mesh ref={vent} geometry={effects.vent.geometry} material={effects.vent.material} frustumCulled={false} visible={false} renderOrder={3} />
      <mesh ref={spray} geometry={effects.spray.geometry} material={effects.spray.material} frustumCulled={false} visible={false} renderOrder={3} />
      <mesh ref={steam} geometry={effects.steam.geometry} material={effects.steam.material} frustumCulled={false} visible={false} renderOrder={4} />
    </group>
  )
}
