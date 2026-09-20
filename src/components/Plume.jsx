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
 * frame path is five uniform writes.
 */
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
    const flicker = 0.9 + 0.1 * Math.sin(live.sim.t * 47.3)
    aimPlume(material, slot, live.ambientPressure, bell * 0.42, ship.throttle * flicker)
  }, -2)

  return (
    <group ref={group} position={[0, 0, z]} visible={false}>
      {seats.map(([x, y], i) => (
        <mesh key={i} position={[x, y, 0]} geometry={geometry} material={material} frustumCulled={false} />
      ))}
    </group>
  )
}
