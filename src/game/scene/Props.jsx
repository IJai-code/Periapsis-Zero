import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { instance, MATERIALS, onModelsChange, preload, roughRock } from './models.js'

/**
 * What a place is built of: its stations, the Drift's rocks, salvage
 * canisters, the race rings, and the descent corridor at Shackleton. Rebuilt
 * when the place changes; per frame only the moving bits move.
 */
export function Props({ game, placeKey }) {
  const g = game.current
  const [, bump] = useState(0)
  useEffect(() => { preload(['hearth', 'harbor', 'gateway', 'shackle', 'canister']); return onModelsChange(() => bump((n) => n + 1)) }, [])
  if (!g) return null
  return <group key={placeKey}>
    {g.stations.map((st) => <Station key={st.id} st={st} />)}
    {g.rocks.length > 0 && <Rocks rocks={g.rocks} />}
    <Canisters game={game} />
    {g.rings.length > 0 && <Rings game={game} />}
    {g.beacons.map((b, i) => <Corridor key={i} at={b.at} />)}
  </group>
}

function Station({ st }) {
  const obj = useMemo(() => instance(st.model).object, [st.model])
  const ref = useRef()
  useFrame((_, dt) => { if (ref.current && st.model === 'hearth') ref.current.rotation.z += dt * 0.035 })
  // Hearth's ring turns for its gravity (about 0.3 g at 380 m, one turn a minute and a half).
  return <group position={st.at}>
    <primitive object={obj} ref={ref} />
    <pointLight position={st.port.at.clone().sub(st.at).multiplyScalar(1.05)} color="#ffc890" intensity={4e5} distance={2500} decay={2} />
  </group>
}

function Rocks({ rocks }) {
  const variants = 5
  const geos = useMemo(() => Array.from({ length: variants }, (_, i) => roughRock(1, i * 13.7 + 2, 4)), [])
  const mat = MATERIALS.rock
  const meshes = useMemo(() => geos.map((geo, v) => {
    const mine = rocks.filter((r) => r.seed % variants === v)
    const m = new THREE.InstancedMesh(geo, mat, Math.max(1, mine.length))
    const o = new THREE.Object3D()
    mine.forEach((r, i) => { o.position.copy(r.at); o.rotation.set(r.seed, r.seed * 1.3, r.seed * 0.7); o.scale.setScalar(r.radius); o.updateMatrix(); m.setMatrixAt(i, o.matrix) })
    m.count = mine.length
    return m
  }), [geos, mat, rocks])
  return <group>{meshes.map((m, i) => <primitive key={i} object={m} />)}</group>
}

function Canisters({ game }) {
  const group = useRef()
  const made = useRef(new Map())
  useFrame((state) => {
    const g = game.current
    if (!g || !group.current) return
    const t = state.clock.elapsedTime
    for (const c of g.canisters) {
      let o = made.current.get(c.id)
      if (!o) { o = instance('canister').object; made.current.set(c.id, o); group.current.add(o) }
      o.visible = !c.taken
      o.position.copy(c.at)
      o.rotation.set(t * 0.4 + c.at.x, t * 0.3, 0.5)
    }
    for (const [id, o] of made.current) if (!g.canisters.some((c) => c.id === id)) { group.current.remove(o); made.current.delete(id) }
  })
  return <group ref={group} />
}

const ringGeo = new THREE.TorusGeometry(60, 2.6, 10, 64)
function Rings({ game }) {
  const refs = useRef([])
  const mats = useMemo(() => [0, 1, 2].map((k) => new THREE.MeshBasicMaterial({ color: ['#ff6b2c', '#2fd3ff', '#3b3448'][k], toneMapped: false })), [])
  useFrame(() => {
    const g = game.current
    if (!g) return
    const next = g.race?.next ?? -1
    g.rings.forEach((r, i) => {
      const m = refs.current[i]
      if (!m) return
      const n = g.rings[(i + 1) % g.rings.length]
      m.position.copy(r)
      m.lookAt(n)
      m.material = i === next ? mats[0] : i === next + 1 ? mats[1] : mats[2]
    })
  })
  return <group>{game.current.rings.map((r, i) => <mesh key={i} ref={(m) => { refs.current[i] = m }} geometry={ringGeo} />)}</group>
}

/** Shackleton's descent corridor: a stack of rings pointing at the pole. */
function Corridor({ at }) {
  const ref = useRef()
  useFrame((s) => { if (ref.current) ref.current.children.forEach((c, i) => { c.material.opacity = 0.35 + 0.35 * Math.sin(s.clock.elapsedTime * 2 - i * 0.6) }) })
  return <group ref={ref} position={at} rotation={[Math.PI / 2, 0, 0]}>
    {[0, 1, 2, 3, 4].map((i) => <mesh key={i} position={[0, 0, i * 220]}><torusGeometry args={[260 - i * 30, 4, 8, 64]} /><meshBasicMaterial color="#2fd3ff" transparent opacity={0.5} toneMapped={false} depthWrite={false} /></mesh>)}
  </group>
}
