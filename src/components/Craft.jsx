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
  const visual = stageSpec?.visual ?? spec.visual
  const source = useModel(modelId)

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
      {model ? <primitive object={model} /> : <Placeholder id={id} size={visual} />}
    </group>
  )
}
