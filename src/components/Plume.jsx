import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { ship } from '../sim/ship.js'
import { live } from '../sim/live.js'
import { ACTIVE_VESSEL, VESSELS } from '../sim/vessels.js'
import { DEFAULT_NOZZLE, nozzleSlot } from '../gfx/plume.js'
import { aimPlume, makePlumeMaterial, plumeGeometry } from '../gfx/plumeShader.js'

/**
 * The exhaust of one stage, wherever that stage is being drawn from.
 *
 * It lives in its own component because the vehicle is drawn two ways. A stage
 * with `model: null` is built from sections by `Hull.jsx`; a stage with a mesh —
 * the S-IC is one — is a glTF, and a glTF carries no plume. Attaching this only
 * to the procedural hull would have put shock diamonds on every stage except
 * the one that fires at sea level, which is the only stage that has them.
 *
 * Two things gate it, and the first was a bug worth naming. Sections are drawn
 * whenever `s.stage >= ship.stage`, so the whole stack is on screen at liftoff;
 * the flame this replaces keyed off `ship.thrust` alone and therefore lit the
 * S-II's bells, the S-IVB's and the service module's while the S-IC was still
 * on the pad. Four plumes on a Saturn V, one of them real. A plume now needs
 * its own stage to be the burning one.
 *
 * The rest is `gfx/plume.js` and `gfx/plumeShader.js`: the nozzle's constants
 * are solved once into an integer slot, ambient pressure is read off `live`
 * where `refreshDerived` has already worked it out for the drag term, and the
 * frame path is three sines and seven uniform writes.
 */
/**
 * What a combustion chamber is actually doing, as one number in [-1, 1].
 *
 * This was a sine: `0.9 + 0.1 * sin(t * 47.3)`. A single tone at 7.5 Hz is a
 * throb, and the eye finds a repeating throb immediately — it was most of why
 * the flame read as an animation playing under a rocket rather than as a jet.
 *
 * A large liquid engine's chamber pressure is broadband and a few per cent
 * deep: feed-system coupling in the tens of hertz, acoustic modes far above
 * anything a frame can carry, and no line spectrum a viewer could learn. Three
 * tones with no common factor is the cheapest stand-in, and it costs three
 * sines and no allocation, where a noise table costs a table.
 *
 * Its period is not infinite and the number is worth writing down rather than
 * hand-waving: the rates are 7.31, 17.77 and 41.3 rad/s, which share no common
 * divisor above 0.01, so the sum repeats every 2*pi/0.01 = **628 s**. That is
 * ten and a half minutes, against an S-IC burn of 168 s and an entry of about
 * twelve — nothing in this simulator burns long enough to come back round, and
 * measured against every shift by the slow tone's own period the signal
 * differs by 0.44 of its own amplitude on average.
 */
const chamberBreath = (t) => 0.5 * Math.sin(t * 7.31) + 0.32 * Math.sin(t * 17.77) + 0.18 * Math.sin(t * 41.3)

/**
 * How deep the chamber's fluctuation runs, as a fraction of thrust.
 *
 * Four per cent. Published chamber-pressure oscillations for stable large
 * liquid engines sit in the low single digits of per cent; anything that
 * reached ten would be a combustion instability and a flight failure, not a
 * texture. It is applied to the drawn throttle, not to `ship.thrust` — the
 * integrator's thrust is a published figure and this is the picture of it.
 */
const CHAMBER_DEPTH = 0.04

export function Plume({ stage, seats, bell, z = 0 }) {
  const group = useRef()
  const material = useMemo(makePlumeMaterial, [])
  const geometry = useMemo(plumeGeometry, [])
  const slot = useMemo(() => {
    const st = VESSELS[ACTIVE_VESSEL]?.stages?.[stage]
    // A stage with no published nozzle draws a sea-level one rather than
    // nothing: a missing figure should cost accuracy, not the picture.
    return nozzleSlot(st?.nozzle ?? DEFAULT_NOZZLE)
  }, [stage])

  useFrame(() => {
    const g = group.current
    if (!g) return
    const lit = ship.stage === stage && ship.thrust > 0
    g.visible = lit
    if (!lit) return
    const t = live.sim.t
    const breath = chamberBreath(t)
    aimPlume(material, slot, live.ambientPressure, bell * 0.42, ship.throttle * (1 + CHAMBER_DEPTH * breath), t, breath)
  }, -2)

  return (
    <group ref={group} position={[0, 0, z]} visible={false}>
      {seats.map(([x, y], i) => (
        <mesh key={i} position={[x, y, 0]} geometry={geometry} material={material} frustumCulled={false} />
      ))}
    </group>
  )
}
