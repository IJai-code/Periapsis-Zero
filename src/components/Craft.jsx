import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { live } from '../sim/live.js'
import { ship } from '../sim/ship.js'
import { INDEX } from '../sim/system.js'
import { CRAFT } from '../sim/constants.js'
import { getModel, loadModel, useModel } from '../gfx/models.js'
import { useUi } from '../sim/store.js'
import { Placeholder } from './Placeholders.jsx'
import { Hull } from './Hull.jsx'
import { Plume } from './Plume.jsx'
import { SECTIONS, bellSeats } from '../gfx/hulls.js'
import { ACTIVE_VESSEL } from '../sim/vessels.js'
import { stageLength } from '../gfx/framing.js'
import { currentHullLift } from '../gfx/pads.js'
import { mission } from '../sim/mission.js'
import { activeSite } from '../sim/launchsite.js'

/**
 * One spacecraft: position from the integrator, hull from either a loaded glTF
 * or the procedural placeholder.
 *
 * Uncontrolled craft are held in the local-vertical/local-horizontal attitude
 * real satellites fly — nose along the velocity vector, one face to the ground.
 * The controllable ship uses its own flight-model quaternion instead.
 */
const _fwd = new THREE.Vector3()
const _up = new THREE.Vector3()
const _right = new THREE.Vector3()
const _basis = new THREE.Matrix4()

export function Craft({ id }) {
  const group = useRef()
  /**
   * The drawn hull, one node inside the state's group so it can be raised
   * without moving the state. On the pad the ship state is the centre of mass
   * at one Earth radius, and the hull is drawn about it — half of it under
   * the ground until this lifts it onto the deck. See gfx/pads.js.
   */
  const lift = useRef()
  const spec = CRAFT[id]

  /**
   * A staged vehicle changes shape as it flies, so the mesh and the length
   * follow the *stage*, not the craft.
   *
   * Apollo 8 leaves the pad as a 110.6 m Saturn V, sheds two stages, coasts to
   * the Moon as an 11 m CSM and comes home as a 3.47 m capsule — a factor of 32
   * in length and 500 in mass, all of it previously drawn as one unchanging
   * object. A user's explicit pick still wins: the dropdown is an override, and
   * the stage is what it overrides.
   */
  const [stage, setStage] = useState(id === 'ship' ? ship.stage : 0)
  const stageSpec = id === 'ship' ? (spec.stages?.[stage] ?? null) : null

  const override = useUi((s) => s.modelFor[id])
  const modelId = override ?? stageSpec?.model ?? null
  /**
   * For the ship this is the section-derived length, which is also what every
   * camera frames it by — one number, so the hull and the framing cannot drift
   * apart. Other craft keep their single figure.
   */
  const visual = id === 'ship' ? stageLength(stage) : (stageSpec?.visual ?? spec.visual)
  const source = useModel(modelId)

  /*
   * Where this stage's bells sit, taken from the same section table the
   * procedural hull is built from — a mesh is scaled to the stack's length, so
   * the tail is at -L/2 whichever way the stage is drawn.
   */
  const plume = useMemo(() => {
    if (id !== 'ship') return null
    const sec = SECTIONS[ACTIVE_VESSEL]?.find((x) => x.stage === stage && x.engines > 0)
    if (!sec) return null
    const bell = sec.bell ?? 2
    return { seats: bellSeats(sec.engines, (sec.diameter / 2) * 0.55), bell }
  }, [id, stage])

  /**
   * Fetch whatever mesh this craft is bound to.
   *
   * `useModel` only reads the cache, so until now a binding was only ever
   * loaded as a side effect of picking it in the panel — which meant a default
   * binding never loaded at all, and on a narrow viewport, where the panels
   * start collapsed, no binding could. A craft needing its own hull should not
   * depend on a panel being open. `loadModel` dedupes through a pending map, so
   * asking twice costs nothing.
   */
  useEffect(() => {
    if (modelId && !getModel(modelId)) loadModel(modelId)
  }, [modelId])

  // Clone per craft: the same catalogue entry can be bound to more than one
  // vehicle, and an Object3D cannot occupy two places in the scene graph.
  // three's clone shares geometry and materials, so this is cheap.
  const model = useMemo(() => {
    if (!source) return null
    const instance = source.clone(true)
    instance.scale.setScalar(visual / source.userData.longest)
    return instance
  }, [source, visual])

  // Direction only, so the raw SI difference is fine: every display transform
  // here is a uniform scale, which leaves directions untouched.
  const offsets = useMemo(() => ({ craft: INDEX[id] * 6, earth: INDEX.earth * 6 }), [id])

  useFrame(() => {
    const g = group.current
    if (!g) return
    g.position.copy(live.pos[id])

    if (id === 'ship') {
      // Four transitions in a whole mission, so a compare-and-set here costs
      // nothing and keeps the stage out of the store.
      if (ship.stage !== stage) setStage(ship.stage)
      g.quaternion.copy(ship.quaternion)
      // Body +Z is the nose, so the lift runs along it: up, on the pad.
      if (lift.current) lift.current.position.z = currentHullLift((mission.site ?? activeSite()).id)
      return
    }

    const s = live.sim.state
    const { craft, earth } = offsets
    _fwd.set(s[craft + 3] - s[earth + 3], s[craft + 4] - s[earth + 4], s[craft + 5] - s[earth + 5])
    _up.set(s[craft] - s[earth], s[craft + 1] - s[earth + 1], s[craft + 2] - s[earth + 2])
    if (_fwd.lengthSq() === 0) return

    _fwd.normalize()
    _up.normalize()
    _right.crossVectors(_up, _fwd).normalize()
    _up.crossVectors(_fwd, _right).normalize() // re-orthogonalise; the orbit is not exactly circular
    _basis.makeBasis(_right, _up, _fwd)
    g.quaternion.setFromRotationMatrix(_basis)
  }, -2)

  return (
    <group ref={group}>
      <group ref={lift}>
        {model ? (
          <>
            <primitive object={model} />
            {/* A glTF hull carries no exhaust, and the stage that flies one is
                the S-IC — the only stage with shock diamonds. See Plume.jsx. */}
            {id === 'ship' && plume && (
              <Plume stage={stage} seats={plume.seats} bell={plume.bell} z={-visual / 2 - plume.bell} />
            )}
          </>
        ) : id === 'ship' ? (
          /* The vehicle built from its own sections — see gfx/hulls.js for why a
             borrowed full-stack mesh could not be made to serve three stages. */
          <Hull vessel={ACTIVE_VESSEL} stage={stage} size={visual} />
        ) : (
          <Placeholder id={id} size={visual} />
        )}
      </group>
    </group>
  )
}
