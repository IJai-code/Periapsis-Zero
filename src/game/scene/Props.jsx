import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
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
  const rig = useRef()
  const inner = useRef()
  const lamps = useRef([])
  const lit = useRef(null)
  const obj = useMemo(() => { const o = instance('hangar').object; o.traverse((m) => { if (m.isMesh) { m.receiveShadow = true; m.castShadow = !/glass/.test(m.material?.name ?? '') } }); return o }, [])
  const sun = useRef(null)
  const spot = useRef()
  const aim = useRef()
  useEffect(() => { if (spot.current && aim.current) spot.current.target = aim.current }, [])
  const { scene } = useThree()
  const { shafts, dust } = useMemo(bayAtmosphere, [])
  useFrame(({ camera, clock }) => {
    const g = game.current, h = ref.current
    if (!g || !h) return
    // The bay stands at the berth of the station you are in, or docking
    // with, or leaving; it is drawn while the camera is inside it, or while
    // a pilot walks the skywalk to it.
    const id = g.mode === 'docked' ? g.docked : (g.mode === 'docking' || g.mode === 'launch') ? g.anim?.st : null
    const st = id && STATIONS[id]
    if (st) {
      h.position.copy(st.port.at).addScaledVector(st.port.axis, BERTH)
      berthQuat(g, st, h.quaternion)
      rig.current.position.copy(h.position); rig.current.quaternion.copy(h.quaternion)
      obj.position.y = 6 - (KEEL[g.ship.hull] ?? 2.9)
      inner.current.position.y = obj.position.y
      _local.copy(camera.position).sub(h.position).applyQuaternion(_inv.copy(h.quaternion).invert())
      _local.y -= obj.position.y
      BAY.inside = Math.abs(_local.x) < 35.5 && _local.y > -5.8 && _local.y < 25.8 && _local.z > -45.5 && _local.z < 45.5
    } else BAY.inside = false
    const walking = g.mode === 'docked' && g.cine?.kind === 'board'
    h.visible = BAY.inside || walking
    if (!sun.current) sun.current = scene.getObjectByName('sun')
    if (sun.current) sun.current.intensity = BAY.inside ? 0.7 : 3.2
    scene.environmentIntensity = BAY.inside ? 0.45 : 0
    // The key light's shadows are drawn only while they can be seen.
    if (spot.current) { spot.current.intensity = h.visible ? 3600 * (BAY_LIGHT[id] ?? BAY_LIGHT.hearth)[2] : 0; spot.current.shadow.autoUpdate = h.visible }
    const k = BAY_LIGHT[id] ?? BAY_LIGHT.hearth
    if (lit.current !== `${id}:${h.visible}`) {
      lit.current = `${id}:${h.visible}`
      lamps.current.forEach((l, i) => { if (!l) return; l.color.set(i === 0 ? k[0] : i < 3 ? k[1] : '#2fd3ff'); l.intensity = h.visible ? [5200, 1700, 1700, 1100][i] * (i < 3 ? k[2] : 1) : 0 })
    }
    if (!h.visible) return
    dust.rotation.y = clock.elapsedTime * 0.006
    dust.position.y = Math.sin(clock.elapsedTime * 0.15) * 0.6
  })
  return <>
    <group ref={ref} visible={false}>
      <primitive object={obj} />
      <group ref={inner}><primitive object={shafts} /><primitive object={dust} /></group>
    </group>
    {/* The bay's lamps stay in the scene at zero when it is not drawn, so the light count never changes. */}
    <group ref={rig}>
      <pointLight ref={(l) => { lamps.current[0] = l }} position={[0, 18, 6]} intensity={0} distance={130} decay={2} />
      <pointLight ref={(l) => { lamps.current[1] = l }} position={[-22, 12, -24]} intensity={0} distance={100} decay={2} />
      <pointLight ref={(l) => { lamps.current[2] = l }} position={[22, 12, 26]} intensity={0} distance={100} decay={2} />
      <pointLight ref={(l) => { lamps.current[3] = l }} position={[-30, 3, 0]} intensity={0} distance={70} decay={2} />
      {/* The pad's key light: a soft spot from the roof that casts the ship's and the pilot's shadows on the deck. */}
      <spotLight ref={spot} position={[3, 21, 9]} angle={0.8} penumbra={0.65} decay={2} distance={80} intensity={0} color="#fff1dc"
        castShadow shadow-mapSize={[2048, 2048]} shadow-bias={-0.0004} shadow-normalBias={0.03} shadow-camera-near={4} shadow-camera-far={70}>
      </spotLight>
      <object3D ref={aim} position={[0, -3, -2]} />
    </group>
  </>
}

/**
 * Every ship, station and prop compiled once, early: the first raider of the
 * day should not cost a frame while its shaders build. Instances go into the
 * scene for a moment, are compiled, and leave; their materials are shared
 * with every later instance, so the programs stay.
 */
/**
 * The bay's reflections, made once and left on the scene: switching
 * scene.environment (or the number of lights) recompiles every material in
 * view, which was the stutter at the moment of docking. Intensity does not.
 */
export function BayEnvironment() {
  const { gl, scene } = useThree()
  useEffect(() => {
    const pm = new THREE.PMREMGenerator(gl)
    const env = pm.fromScene(new RoomEnvironment(), 0.04).texture
    pm.dispose()
    scene.environment = env
    scene.environmentIntensity = 0
    return () => { if (scene.environment === env) scene.environment = null; env.dispose() }
  }, [gl, scene])
  return null
}

export function Warmup() {
  const { gl, scene, camera } = useThree()
  useEffect(() => {
    let alive = true
    const run = () => {
      const group = new THREE.Group()
      for (const k of ['kestrel', 'mule', 'lance', 'raider', 'warden', 'cutter', 'freighter', 'canister', 'hearth', 'harbor', 'gateway', 'shackle']) group.add(instance(k).object)
      group.position.set(0, -1e6, 0)
      scene.add(group)
      const done = () => scene.remove(group)
      if (gl.compileAsync) gl.compileAsync(scene, camera).then(done, done)
      else { gl.compile(scene, camera); done() }
    }
    // Models arrive one by one: compile once they have stopped arriving.
    let t = setTimeout(() => { if (alive) run() }, 1500)
    const off = onModelsChange(() => { clearTimeout(t); t = setTimeout(() => { if (alive) run() }, 900) })
    return () => { alive = false; clearTimeout(t); off() }
  }, [gl, scene, camera])
  return null
}

/**
 * The air in the bay: a shaft of light under each roof panel (art/game-hangar,
 * panels at y 24, every 15 m), and dust turning slowly in it. Additive and
 * depth-tested, so they sit in the room, not on the screen.
 */
function bayAtmosphere() {
  const c = document.createElement('canvas')
  c.width = 4; c.height = 128
  const x = c.getContext('2d')
  const gr = x.createLinearGradient(0, 0, 0, 128)
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(255,255,255,0.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)')
  x.fillStyle = gr; x.fillRect(0, 0, 4, 128)
  const fade = new THREE.CanvasTexture(c)
  const shaftMat = new THREE.MeshBasicMaterial({ color: '#ffe9c8', alphaMap: fade, transparent: true, opacity: 0.075, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })
  const geo = new THREE.CylinderGeometry(6.2, 9.5, 30, 24, 1, true)
  // The cylinder's v runs bottom to top; flip so the bright end is at the lamp.
  const uv = geo.attributes.uv
  for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - uv.getY(i))
  const shafts = new THREE.Group()
  for (const z of [-31, -16, -1, 14, 29, 44]) { const m = new THREE.Mesh(geo, shaftMat); m.position.set(0, 9, z); m.renderOrder = 6; shafts.add(m) }
  const n = 420, pos = new Float32Array(n * 3)
  let seed = 7
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 }
  for (let i = 0; i < n; i++) { pos[i * 3] = (rnd() - 0.5) * 64; pos[i * 3 + 1] = -5 + rnd() * 26; pos[i * 3 + 2] = (rnd() - 0.5) * 84 }
  const dg = new THREE.BufferGeometry()
  dg.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  const dust = new THREE.Points(dg, new THREE.PointsMaterial({ color: '#ffe8c8', size: 0.07, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }))
  return { shafts, dust }
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
