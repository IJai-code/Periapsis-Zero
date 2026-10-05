import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { instance, MATERIALS, onModelsChange, preload, roughRock } from './models.js'
import { STATIONS } from '../core/world.js'
import { BERTH, berthQuat } from '../core/game.js'
import { Boarding, KEEL } from './Boarding.jsx'

/**
 * What a place is built of: its stations, the Drift's rocks, salvage
 * canisters, the race rings, and the descent corridor at Shackleton. Rebuilt
 * when the place changes; per frame only the moving bits move.
 */
export function Props({ game, placeKey }) {
  const g = game.current
  const [version, bump] = useState(0)
  useEffect(() => { preload(['hearth', 'harbor', 'gateway', 'shackle', 'canister', 'hangar']); return onModelsChange(() => bump((n) => n + 1)) }, [])
  if (!g) return null
  return <group key={placeKey}>
    <Hangar key={`hangar:${version}`} game={game} />
    <Boarding game={game} />
    <StationsOutside>{g.stations.map((st) => <Station key={`${st.id}:${version}`} st={st} />)}</StationsOutside>
    {g.rocks.length > 0 && <Rocks rocks={g.rocks} />}
    <Canisters game={game} />
    {g.rings.length > 0 && <Rings game={game} />}
    {g.beacons.map((b, i) => <Corridor key={i} at={b.at} />)}
  </group>
}

/**
 * The bay a docked ship sits in, round the player at the berth: lit by its
 * own lamps, the door open on the sky. The stations outside are hidden
 * meanwhile (the bay is inside one) and the sun is dimmed to what spills in.
 */
// Each station's bay has its own light: Hearth's warm work lamps, Harbor's
// clean white, the Shackle's dim sodium, Gateway's cold Compact blue.
const BAY_LIGHT = {
  hearth: ['#fff1d8', '#ffd7a8', 1], harbor: ['#f2f6ff', '#dfe9ff', 1.1],
  shackle: ['#ffb27a', '#ff8a52', 0.7], gateway: ['#d8ecff', '#9fd2ff', 1],
}
function Hangar({ game }) {
  const ref = useRef()
  const lamps = useRef([])
  const lit = useRef(null)
  const obj = useMemo(() => instance('hangar').object, [])
  const sun = useRef(null)
  useFrame(({ scene, camera }) => {
    const g = game.current, h = ref.current
    if (!g || !h) return
    // The bay stands at the berth of the station you are in, or docking
    // with, or leaving; it is drawn while the camera is inside it.
    const id = g.mode === 'docked' ? g.docked : (g.mode === 'docking' || g.mode === 'launch') ? g.anim?.st : null
    const st = id && STATIONS[id]
    if (st) {
      h.position.copy(st.port.at).addScaledVector(st.port.axis, BERTH)
      berthQuat(g, st, h.quaternion)
      obj.position.y = 6 - (KEEL[g.ship.hull] ?? 2.9)
      _local.copy(camera.position).sub(h.position).applyQuaternion(_inv.copy(h.quaternion).invert())
      _local.y -= obj.position.y
      BAY.inside = Math.abs(_local.x) < 35.5 && _local.y > -5.8 && _local.y < 25.8 && _local.z > -45.5 && _local.z < 45.5
    } else BAY.inside = false
    h.visible = BAY.inside
    if (!sun.current) sun.current = scene.getObjectByName('sun')
    if (sun.current) sun.current.intensity = BAY.inside ? 0.9 : 3.2
    if (!BAY.inside) return
    if (lit.current !== id) {
      lit.current = id
      const [key, fill, k] = BAY_LIGHT[id] ?? BAY_LIGHT.hearth
      lamps.current.forEach((l, i) => { if (!l) return; l.color.set(i === 0 ? key : fill); l.intensity = [4200, 2400, 2400][i] * k })
    }
  })
  return <group ref={ref} visible={false}>
    <primitive object={obj} />
    <pointLight ref={(l) => { lamps.current[0] = l }} position={[0, 16, 6]} color="#fff1d8" intensity={4200} distance={130} decay={2} />
    <pointLight ref={(l) => { lamps.current[1] = l }} position={[-22, 12, -24]} color="#ffd7a8" intensity={2400} distance={100} decay={2} />
    <pointLight ref={(l) => { lamps.current[2] = l }} position={[22, 12, 26]} color="#ffd7a8" intensity={2400} distance={100} decay={2} />
    <pointLight position={[0, 2, -40]} color="#9fe6ff" intensity={700} distance={60} decay={2} />
  </group>
}

/** Whether the camera is inside the bay this frame: the bay hides the stations outside it. */
export const BAY = { inside: false }
const _local = new THREE.Vector3(), _inv = new THREE.Quaternion()

function StationsOutside({ children }) {
  const ref = useRef()
  useFrame(() => { if (ref.current) ref.current.visible = !BAY.inside })
  return <group ref={ref}>{children}</group>
}

function Station({ st }) {
  const obj = useMemo(() => instance(st.model).object, [st.model])
  const ref = useRef()
  useFrame((_, dt) => { if (ref.current && st.model === 'hearth') ref.current.rotation.z += dt * 0.035 })
  // Hearth's ring turns for its gravity (about 0.3 g at 380 m, one turn a minute and a half).
  return <group position={st.at}>
    <primitive object={obj} ref={ref} />
    <pointLight position={st.port.at.clone().sub(st.at).multiplyScalar(1.15)} color="#ffc890" intensity={6e3} distance={900} decay={2} />
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

/** Shackleton's descent corridor: a stack of rings leading down to the pole (+y is toward the Moon there). */
function Corridor({ at }) {
  const ref = useRef()
  useFrame((s) => { if (ref.current) ref.current.children.forEach((c, i) => { c.material.opacity = 0.35 + 0.35 * Math.sin(s.clock.elapsedTime * 2 - i * 0.6) }) })
  return <group ref={ref} position={at} rotation={[-Math.PI / 2, 0, 0]}>
    {[0, 1, 2, 3, 4].map((i) => <mesh key={i} position={[0, 0, i * 220]}><torusGeometry args={[260 - i * 30, 4, 8, 64]} /><meshBasicMaterial color="#2fd3ff" transparent opacity={0.5} toneMapped={false} depthWrite={false} /></mesh>)}
  </group>
}
