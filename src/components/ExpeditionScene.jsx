import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { applyRockSet, buildExpeditionTerrain, buildRocks, terrainMaterial } from '../gfx/expeditionTerrain.js'
import { mulberry32 } from '../gfx/noise.js'
import { useAuthored } from '../gfx/authored.js'
import { buildSurfaceEnvironment } from '../gfx/surfaceEnvironment.js'
import { governSurface, resetSurfaceGovernor, subscribeSurfaceQuality, surfaceQuality } from '../gfx/surfaceQuality.js'
import { NOISE_GLSL } from '../gfx/glsl/noise.js'
import { FIXED_STEP, instrumentsFor, nextTarget, REGIONS, ROVER, sitesFor, terrainFor, stepExpedition, VEHICLE } from '../sim/expedition.js'

export function ExpeditionScene({ session, controls, paused, scenic = false, onPulse }) {
  const ground = useMemo(() => buildExpeditionTerrain(session.id), [session.id])
  const material = useMemo(() => terrainMaterial(session.id), [session.id])
  const rocks = useMemo(() => buildRocks(session.id), [session.id])
  const region = REGIONS[session.id]
  /*
   * The survey lander, built in Blender from art/survey-lander/build.py. Until
   * it is in, and for good if it fails to load, the primitive SurveyLander
   * below stands in. The front door's backdrop shares this scene with no
   * lander in it, so it never fetches the file.
   */
  const authoredLander = useAuthored('survey-lander', !scenic)
  const authoredRover = useAuthored('survey-rover', !scenic)
  const authoredKit = useAuthored('survey-kit', !scenic)
  // The stones, baked in Blender (art/rocks); the front page's backdrop uses them too.
  const invalidate = useThree((s) => s.invalidate)
  const authoredRocks = useAuthored('rocks')
  useEffect(() => { applyRockSet(rocks, authoredRocks); invalidate() }, [rocks, authoredRocks, invalidate])
  useEffect(() => {
    const redraw = () => invalidate()
    material.addEventListener('detailready', redraw)
    return () => material.removeEventListener('detailready', redraw)
  }, [material, invalidate])
  /*
   * The authored rover's six wheels, found by name once it arrives. Each has
   * its origin at the hub and its axle on X, so turning one node turns one
   * wheel. The primitive rover's wheels were kept under string keys on an
   * array, which forEach skips, so they never turned at all.
   */
  const roverWheels = useMemo(() => {
    if (!authoredRover) return null
    const list = []
    for (let k = 0; k < 6; k++) { const w = authoredRover.scene.getObjectByName(`wheel_${k}`); if (w) list.push(w) }
    return list
  }, [authoredRover])
  // The plume hangs from the engine's exit plane, read off the model's own
  // nozzle_0 marker; -1.85 is the same plane on the primitive lander.
  const exitY = authoredLander?.points.nozzle_0?.y ?? -1.85
  const lander = useRef(), plume = useRef(), light = useRef(), rover = useRef(), wheels = useRef([])
  const clock = useRef({ accumulated: 0, pulse: 0, yaw: 0, pitch: 0.24, distance: 28 })
  const scratch = useMemo(() => ({ position: new THREE.Vector3(), target: new THREE.Vector3(), look: new THREE.Vector3() }), [])
  const { camera, gl, scene } = useThree()
  /*
   * What this machine can draw (gfx/surfaceQuality.js). Pixels, shadow map,
   * surface relief and rock count follow the tier; the frame loop below feeds
   * the governor that picks it. The front page's backdrop is drawn on demand,
   * not every frame, so it takes the tier without voting on it.
   */
  const quality = useSyncExternalStore(subscribeSurfaceQuality, surfaceQuality)
  useEffect(() => {
    // The pixel ratio is the Canvas's own prop (Expedition.jsx, ScenicBackdrop.jsx):
    // R3F reapplies that prop on every render, so a setDpr here would not hold.
    const l = light.current
    if (l) {
      l.castShadow = quality.shadows
      if (l.shadow.mapSize.x !== quality.shadow) {
        l.shadow.mapSize.set(quality.shadow, quality.shadow)
        l.shadow.map?.dispose()
        l.shadow.map = null
      }
    }
    const relief = 'PZ_RELIEF' in material.defines
    if (relief !== quality.relief) {
      if (quality.relief) material.defines.PZ_RELIEF = ''
      else delete material.defines.PZ_RELIEF
      material.needsUpdate = true
    }
    rocks.children.forEach((mesh, k) => { mesh.count = Math.ceil((rocks.userData.full?.[k] ?? mesh.count) * quality.rocks) })
  }, [quality, material, rocks])
  useEffect(() => { resetSurfaceGovernor() }, [session.id])

  useEffect(() => {
    const boot = document.getElementById('boot')
    if (boot) { boot.classList.add('boot-done'); const timer = setTimeout(() => boot.remove(), 700); return () => clearTimeout(timer) }
  }, [])
  useEffect(() => () => { ground.forEach((g) => g.dispose()); material.dispose(); rocks.userData.dispose?.() }, [ground, material, rocks])
  useEffect(() => {
    // Reflections: the world's own ground, sky and Sun (gfx/surfaceEnvironment.js).
    // The ground keeps its own look; only what is meant to shine reflects.
    // Off on the low tiers: image lighting on every material is the dearest
    // thing a software renderer draws (gfx/surfaceQuality.js).
    if (!quality.reflections) return undefined
    const env = buildSurfaceEnvironment(gl, session.id, SUN)
    scene.environment = env.texture
    material.envMapIntensity = 0
    return () => { scene.environment = null; env.dispose() }
  }, [gl, scene, session.id, material, quality.reflections])
  useEffect(() => {
    // Mars's haze is the colour of its own horizon, so distant mesas fade into
    // the sky rather than into a flat brown. Airless worlds have no haze.
    scene.fog = region.atmosphere ? new THREE.Fog(MARS_SKY.horizon, 1400, 16000) : null
    scene.background = new THREE.Color(region.atmosphere ? MARS_SKY.horizon : '#020307')
    return () => { scene.fog = null; scene.background = null }
  }, [scene, region])
  useEffect(() => {
    const canvas = gl.domElement
    canvas.tabIndex = -1
    let drag = false
    const down = (e) => { if (e.button === 0) { canvas.focus({ preventScroll: true }); drag = true; canvas.setPointerCapture(e.pointerId) } }
    const up = () => { drag = false }
    const move = (e) => {
      if (!drag || paused || scenic) return
      if (session.mode === 'eva') { session.walker.yaw += e.movementX * 0.004; session.walker.pitch = THREE.MathUtils.clamp(session.walker.pitch - e.movementY * 0.003, -1.1, 1.1) }
      else { clock.current.yaw += e.movementX * 0.004; clock.current.pitch = THREE.MathUtils.clamp(clock.current.pitch + e.movementY * 0.003, -0.2, 1.1) }
    }
    const wheel = (e) => { if (!scenic) clock.current.distance = THREE.MathUtils.clamp(clock.current.distance + e.deltaY * 0.03, 14, 70) }
    canvas.addEventListener('pointerdown', down); canvas.addEventListener('pointermove', move); canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up); canvas.addEventListener('wheel', wheel)
    return () => { canvas.removeEventListener('pointerdown', down); canvas.removeEventListener('pointermove', move); canvas.removeEventListener('pointerup', up); canvas.removeEventListener('pointercancel', up); canvas.removeEventListener('wheel', wheel) }
  }, [gl, session, paused, scenic])

  useFrame((_, delta) => {
    if (!scenic) governSurface(delta * 1000)
    const c = clock.current, s = session, keys = controls.current
    if (!paused && !scenic) {
      c.accumulated += Math.min(delta, 0.1)
      let steps = 0
      while (c.accumulated >= FIXED_STEP && steps < 12) {
        if (s.mode === 'eva') s.walker.yaw += ((keys.lookRight ? 1 : 0) - (keys.lookLeft ? 1 : 0)) * FIXED_STEP * 1.15
        stepExpedition(s, keys)
        c.accumulated -= FIXED_STEP; steps++
      }
    } else c.accumulated = 0
    if (lander.current) {
      lander.current.position.set(s.x, s.y, s.z)
      lander.current.rotation.set(s.pitch, s.yaw, s.roll, 'YXZ')
    }
    if (plume.current) {
      const throttle = s.mode === 'flight' && !s.landed ? s.throttle : 0
      plume.current.visible = throttle > 0.02
      plume.current.scale.set(1, 0.4 + throttle * 1.6, 1)
    }
    if (rover.current && s.rover) {
      const r = s.rover
      rover.current.visible = true
      // r.y is the chassis underside, ROVER.clearance above the ground; the
      // model's origin is the ground under it. The primitive rover was placed
      // with its wheel bottoms at r.y and so drove 46 cm in the air.
      rover.current.position.set(r.x, r.y - ROVER.clearance, r.z)
      // Chassis follows the ground's own slope rather than staying level.
      const terrain = terrainFor(s.id)
      const ahead = terrain.height(r.x + Math.sin(r.yaw) * 1.2, r.z - Math.cos(r.yaw) * 1.2)
      const behind = terrain.height(r.x - Math.sin(r.yaw) * 1.2, r.z + Math.cos(r.yaw) * 1.2)
      rover.current.rotation.set(Math.atan2(behind - ahead, 2.4), r.yaw, 0, 'YXZ')
      // Rolling without slipping: the wheel turns through v / r radians a
      // second, r being the radius to the cleat tips that touch the ground.
      const roll = (s.mode === 'rover' ? r.speed : 0) * Math.min(delta, 0.05)
      if (roverWheels) for (const wheel of roverWheels) wheel.rotation.x -= roll / ROVER_ROLLING_RADIUS
      else for (const wheel of Object.values(wheels.current)) if (wheel) wheel.rotation.x += roll / 0.26
    }
    if (scenic) {
      scratch.position.set(360, 110, 370); scratch.target.set(-100, 220, -2200)
    } else if (s.mode === 'eva') {
      const w = s.walker
      scratch.position.set(w.x, w.y + 1.72, w.z)
      scratch.target.set(w.x + Math.sin(w.yaw) * Math.cos(w.pitch) * 20, w.y + 1.72 + Math.sin(w.pitch) * 20, w.z - Math.cos(w.yaw) * Math.cos(w.pitch) * 20)
    } else if (s.mode === 'rover' && s.rover) {
      /*
       * A chase camera behind the vehicle, low and close, so the ground reads
       * at speed. The heading is (sin yaw, -cos yaw), so "behind" is its
       * negative and the look point sits ahead of the rover. The first version
       * put the look point *astern* by getting that sign backwards, which
       * framed the rover on the edge of the shot instead of in it.
       */
      const r = s.rover, yaw = c.yaw + r.yaw
      const distance = 7.5, lift = 2.4 + Math.sin(c.pitch) * 5
      scratch.position.set(r.x - Math.sin(yaw) * distance, r.y + lift, r.z + Math.cos(yaw) * distance)
      scratch.target.set(r.x + Math.sin(yaw) * 4, r.y + 0.9, r.z - Math.cos(yaw) * 4)
      scratch.position.y = Math.max(scratch.position.y, terrainFor(s.id).height(scratch.position.x, scratch.position.z) + 1.1)
    } else {
      const yaw = c.yaw + s.yaw, distance = c.distance
      scratch.position.set(s.x + Math.sin(yaw) * distance, s.y + 9 + Math.sin(c.pitch) * distance, s.z + Math.cos(yaw) * distance)
      scratch.target.set(s.x, s.y + 3, s.z - 10)
      scratch.position.y = Math.max(scratch.position.y, terrainFor(s.id).height(scratch.position.x, scratch.position.z) + 3)
    }
    const k = s.mode === 'eva' || s.mode === 'rover' || scenic ? 1 : 1 - Math.exp(-Math.min(delta, 0.1) * 5)
    camera.position.lerp(scratch.position, k)
    scratch.look.lerp(scratch.target, k); camera.lookAt(scratch.look)
    if (light.current) {
      // Local shadow frustum follows the player, not a twelve-kilometre landscape.
      const focus = s.mode === 'rover' ? s.rover : s.mode === 'eva' ? s.walker : s
      const x = focus.x, z = focus.z
      light.current.position.set(x + SUN_OFFSET[0], SUN_OFFSET[1], z + SUN_OFFSET[2])
      light.current.target.position.set(x, 0, z); light.current.target.updateMatrixWorld()
    }
    c.pulse += Math.min(delta, 0.1)
    if (c.pulse >= 0.1) { c.pulse = 0; onPulse?.() }
  })
  return <>
    <Sky id={session.id} />
    {/* Fill light. Mars has a bright dusty sky overhead; the airless worlds
        have a black one, so their fill comes from below, sunlight bounced off
        the ground, which is what keeps a lander's shadowed side readable. */}
    <hemisphereLight args={region.atmosphere ? ['#e9c9ab', '#5a3a28', 1.5] : ['#1a1c24', session.id === 'europa' ? '#8f9ba0' : '#6a645b', 1.15]} />
    <directionalLight ref={light} position={SUN_OFFSET} intensity={3.3} color={region.atmosphere ? '#ffe1bc' : '#fff5df'} castShadow={quality.shadows} shadow-mapSize={[quality.shadow, quality.shadow]} shadow-camera-left={-110} shadow-camera-right={110} shadow-camera-top={110} shadow-camera-bottom={-110} shadow-camera-near={1} shadow-camera-far={1600} shadow-bias={-0.0002} shadow-normalBias={0.12} />
    {ground.map((g, i) => <mesh key={i} geometry={g} material={material} receiveShadow />)}
    <primitive object={rocks} />
    {!scenic && <>
      <group ref={lander}>{authoredLander ? <primitive object={authoredLander.scene} dispose={null} /> : <SurveyLander />}<mesh ref={plume} position={[0, exitY - 1.45, 0]} visible={false}><coneGeometry args={[0.45, 3.2, 20]} /><meshBasicMaterial color="#98cfff" transparent opacity={0.65} depthWrite={false} /></mesh></group>
      <LandingZone />
      <Beacon session={session} />
      <group ref={rover} visible={false}>{authoredRover ? <primitive object={authoredRover.scene} dispose={null} /> : <SurfaceRover wheels={wheels} />}</group>
      {instrumentsFor(session.id).map((p, i) => <Instrument key={i} id={session.id} site={p} deployed={session.instruments.includes(i)} kit={authoredKit} node={KIT_NODE[p.name]} />)}
      {sitesFor(session.id).map((p, i) => <Sample key={i} id={session.id} site={p} taken={session.samples.includes(i)} kit={authoredKit} rocks={authoredRocks} />)}
    </>}
  </>
}

function Beam({ from, to, radius = 0.055, color = '#b3b4b0' }) {
  const transform = useMemo(() => {
    const a = new THREE.Vector3(...from), b = new THREE.Vector3(...to), d = b.clone().sub(a)
    return { position: a.add(b).multiplyScalar(0.5).toArray(), length: d.length(), quaternion: new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()) }
  }, [from, to])
  return <mesh position={transform.position} quaternion={transform.quaternion} castShadow><cylinderGeometry args={[radius, radius, transform.length, 8]} /><meshStandardMaterial color={color} roughness={0.42} metalness={0.7} /></mesh>
}
export function SurveyLander() {
  return <group>
    <mesh castShadow><cylinderGeometry args={[1.75, 1.85, 2.2, 8]} /><meshStandardMaterial color="#cbc9bb" metalness={0.55} roughness={0.58} /></mesh>
    <mesh position={[0, 1.5, 0]} castShadow><boxGeometry args={[2.6, 1.5, 2.5]} /><meshStandardMaterial color="#d9d9cc" roughness={0.45} metalness={0.3} /></mesh>
    <mesh position={[0, 1.6, -1.26]}><boxGeometry args={[1.7, 0.6, 0.06]} /><meshStandardMaterial color="#10232d" metalness={0.6} roughness={0.18} /></mesh>
    <mesh position={[0, -1.45, 0]} castShadow><cylinderGeometry args={[0.33, 0.65, 0.8, 20, 1, true]} /><meshStandardMaterial color="#343b3d" side={THREE.DoubleSide} metalness={0.8} roughness={0.6} /></mesh>
    {[-1, 1].flatMap((x) => [-1, 1].map((z) => <group key={`${x}/${z}`}>
      <Beam from={[x * 1.4, -0.4, z * 1.4]} to={[x * 3.2, -2.42, z * 3.2]} radius={0.1} />
      <Beam from={[x * 1.2, 0.6, z * 1.2]} to={[x * 3.2, -2.42, z * 3.2]} radius={0.055} />
      <mesh position={[x * 3.2, -2.52, z * 3.2]} castShadow><cylinderGeometry args={[0.5, 0.5, 0.16, 16]} /><meshStandardMaterial color="#6b6862" metalness={0.65} roughness={0.6} /></mesh>
      <mesh position={[x * 1.9, 0, z * 0.7]} castShadow><sphereGeometry args={[0.57, 16, 12]} /><meshStandardMaterial color="#b69a52" metalness={0.7} roughness={0.42} /></mesh>
    </group>))}
    <Beam from={[0.9, 2.2, 0.4]} to={[0.9, 3.3, 0.4]} radius={0.035} />
    <mesh position={[0.9, 3.3, 0.4]} rotation={[0.5, 0, 0]}><sphereGeometry args={[0.45, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2]} /><meshStandardMaterial color="#d1d1cb" side={THREE.DoubleSide} metalness={0.6} roughness={0.4} /></mesh>
    <mesh position={[0, 0.2, 1.87]}><boxGeometry args={[0.9, 1.4, 0.08]} /><meshStandardMaterial color="#4a504d" metalness={0.5} /></mesh>
    {[0, 1, 2, 3, 4].map((i) => <Beam key={i} from={[-0.45, -1.05 - i * 0.27, 1.9]} to={[0.45, -1.05 - i * 0.27, 1.9]} radius={0.032} />)}
    <mesh position={[0, 2.32, 0]}><boxGeometry args={[1.8, 0.06, 1.6]} /><meshStandardMaterial color="#243749" metalness={0.6} roughness={0.3} /></mesh>
    <mesh position={[0, 0.3, -1.81]}><boxGeometry args={[1.3, 0.14, 0.07]} /><meshStandardMaterial color="#ef703a" /></mesh>
  </group>
}
function LandingZone() {
  return <group position={[0, 0.06, 0]}>
    <mesh rotation={[-Math.PI / 2, 0, 0]}><ringGeometry args={[11.8, 12, 64]} /><meshBasicMaterial color="#d5ae6b" transparent opacity={0.55} side={THREE.DoubleSide} /></mesh>
    {[[-12, -12], [12, -12], [-12, 12], [12, 12]].map(([x, z]) => <group key={`${x}/${z}`} position={[x, 0, z]}><mesh position={[0, 0.65, 0]}><cylinderGeometry args={[0.04, 0.06, 1.3, 8]} /><meshStandardMaterial color="#bfc0b6" /></mesh><mesh position={[0, 1.3, 0]}><sphereGeometry args={[0.09, 8, 8]} /><meshBasicMaterial color="#e9b267" /></mesh></group>)}
  </group>
}
/**
 * Six wheels on a rocker, drawn from primitives rather than a downloaded mesh:
 * the catalogue has no rover small enough to be a surface vehicle, and the
 * Perseverance mesh is a 1-tonne Mars 2020 machine that would dwarf the lander.
 * So this is the vehicle the fiction already implies, at 2.6 m long.
 */
function SurfaceRover({ wheels }) {
  return <group>
    <mesh position={[0, 0.28, 0]} castShadow><boxGeometry args={[1.5, 0.34, 2.3]} /><meshStandardMaterial color="#cfc9b6" metalness={0.35} roughness={0.62} /></mesh>
    <mesh position={[0, 0.55, 0.35]} castShadow><boxGeometry args={[1.25, 0.42, 1.1]} /><meshStandardMaterial color="#ded8c4" roughness={0.5} /></mesh>
    <mesh position={[0, 0.6, 0.92]} rotation={[0.45, 0, 0]}><boxGeometry args={[1.05, 0.5, 0.04]} /><meshStandardMaterial color="#1d2b33" metalness={0.6} roughness={0.2} /></mesh>
    <mesh position={[0, 1.02, 0.3]} castShadow><cylinderGeometry args={[0.05, 0.05, 0.85, 6]} /><meshStandardMaterial color="#c6bfa8" metalness={0.6} /></mesh>
    <mesh position={[0, 1.45, 0.3]}><boxGeometry args={[0.42, 0.16, 0.34]} /><meshStandardMaterial color="#2a3a44" metalness={0.55} roughness={0.3} /></mesh>
    {[-1, 1].flatMap((sx) => [-1, 1].map((sz) => <mesh key={`${sx}/${sz}`} ref={(m) => { wheels.current[[sx, sz].join('')] = m }} position={[sx * 0.82, 0.26, sz * 0.78]} rotation={[0, 0, Math.PI / 2]} castShadow><cylinderGeometry args={[0.26, 0.26, 0.2, 14]} /><meshStandardMaterial color="#8d8a7c" roughness={0.85} /></mesh>))}
    {[-1, 1].map((sx) => <mesh key={sx} position={[sx * 0.62, 0.2, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow><cylinderGeometry args={[0.06, 0.06, 1.9, 8]} /><meshStandardMaterial color="#b3ad99" metalness={0.5} /></mesh>)}
  </group>
}
/** Which node of the survey kit each instrument is. */
const KIT_NODE = { Seismometer: 'seismometer', Magnetometer: 'magnetometer', 'Heat probe': 'heat_probe' }
/** The authored rover's rolling radius, to its cleat tips (art/survey-rover/spec.json). */
const ROVER_ROLLING_RADIUS = 0.313

/**
 * One prop out of the survey kit, cloned for this site, with its own copy of
 * the status light so one package can glow while the others wait. Ion when
 * deployed, a dull unlit grey until then. The clone shares geometry with the
 * kit; only the one material is its own.
 */
function useKitProp(kit, name, lit, litColour) {
  const prop = useMemo(() => {
    if (!kit) return null
    const node = kit.scene.getObjectByName(name)
    if (!node) return null
    const copy = node.clone(true)
    copy.position.set(0, 0, 0)
    let status = null
    copy.traverse((o) => {
      if (!o.isMesh) return
      o.castShadow = true; o.receiveShadow = true
      const swap = (m) => (m && (m.name === 'status' || m.name === 'kit_ember') ? (status = m.clone()) : m)
      o.material = Array.isArray(o.material) ? o.material.map(swap) : swap(o.material)
    })
    return { copy, status }
  }, [kit, name])
  useEffect(() => () => prop?.status?.dispose(), [prop])
  useEffect(() => {
    if (!prop?.status) return
    const m = prop.status
    if (lit) { m.color.set(litColour); m.emissive?.set(litColour); if ('emissiveIntensity' in m) m.emissiveIntensity = 1.6 }
    else { m.color.set(litColour === '#2fd3ff' ? '#5a5d5f' : '#6b625a'); m.emissive?.set('#000000') }
  }, [prop, lit, litColour])
  return prop?.copy ?? null
}

/** A survey package: the authored model, or a tripod and drum until it loads. */
function Instrument({ id, site, deployed, kit, node }) {
  const y = terrainFor(id).height(site.x, site.z)
  const prop = useKitProp(kit, node, deployed, '#2fd3ff')
  if (prop) return <group position={[site.x, y, site.z]}><primitive object={prop} /></group>
  return <group position={[site.x, y, site.z]}>
    <mesh position={[0, 0.5, 0]} castShadow><cylinderGeometry args={[0.22, 0.26, 1, 10]} /><meshStandardMaterial color={deployed ? '#9fd8c4' : '#b8b2a0'} metalness={0.45} roughness={0.5} /></mesh>
    <mesh position={[0, 1.05, 0]} castShadow><boxGeometry args={[0.4, 0.1, 0.4]} /><meshStandardMaterial color="#33454e" metalness={0.6} roughness={0.3} /></mesh>
    <mesh position={[0.3, 0.75, 0.22]} rotation={[0, 0.6, 0.5]}><boxGeometry args={[0.26, 0.2, 0.02]} /><meshBasicMaterial color={deployed ? '#7fe3ff' : '#c8c2ae'} /></mesh>
    {[[-0.3, 0.28], [0.32, -0.2], [0.02, -0.36]].map(([x, z], i) => <mesh key={i} position={[x, 0.12, z]} rotation={[0, 0, x > 0 ? -0.4 : 0.4]}><cylinderGeometry args={[0.02, 0.02, 0.5, 6]} /><meshStandardMaterial color="#a8a294" /></mesh>)}
  </group>
}
/**
 * A sample site: the rock to collect, and a stake with a flag beside it. The
 * flag is ember while the rock is waiting and goes grey once it is taken, so
 * the field reads at a glance as done or not done.
 */
/** The sample itself: a darker stone than the field around it, so it reads as the one to pick up. */
const SAMPLE_TINT = { moon: '#50483e', mars: '#5e3727', europa: '#7a6b58' }

function Sample({ id, site, taken, kit, rocks }) {
  const height = terrainFor(id).height(site.x, site.z)
  const stake = useKitProp(kit, 'stake', !taken, '#ff6b2c')
  // One of the Blender-baked stones (art/rocks) when it is in, tinted; the
  // faceted placeholder until then.
  const stone = useMemo(() => {
    const source = rocks?.scene.getObjectByName('rock_3')
    const mesh = source?.isMesh ? source : source?.children?.find((c) => c.isMesh)
    if (!mesh) return null
    const material = mesh.material.clone()
    material.color.set(SAMPLE_TINT[id] ?? SAMPLE_TINT.moon).multiplyScalar(2)
    return { geometry: mesh.geometry, material }
  }, [rocks, id])
  useEffect(() => () => stone?.material.dispose(), [stone])
  return <group position={[site.x, height, site.z]}>
    {!taken && (stone
      ? <mesh position={[0, 0.2, 0]} castShadow receiveShadow scale={[0.7, 0.6, 0.6]} geometry={stone.geometry} material={stone.material} />
      : <mesh position={[0, 0.3, 0]} castShadow scale={[1.0, 0.6, 0.75]}><icosahedronGeometry args={[0.7, 2]} /><meshStandardMaterial color={SAMPLE_TINT[id] ?? SAMPLE_TINT.moon} roughness={0.9} flatShading /></mesh>)}
    {stake ? <group position={[1.1, 0, 0]}><primitive object={stake} /></group> : <>
      <mesh position={[1.1, 0.65, 0]}><cylinderGeometry args={[0.018, 0.018, 1.3, 6]} /><meshStandardMaterial color="#c5c1b0" /></mesh>
      <mesh position={[1.1, 1.3, 0]}><boxGeometry args={[0.18, 0.18, 0.18]} /><meshBasicMaterial color={taken ? '#576054' : '#edb76c'} /></mesh>
    </>}
  </group>
}

/**
 * Where the Sun is, as a direction: the same one the shadow-casting light
 * comes from (its position sits at this offset from whatever it follows).
 *
 * From the left and a little behind the cameras, 31 degrees up. It used to be
 * ahead of them, so every shot looked into the light: the lander's camera-
 * facing side was its shadowed one, shadows ran toward the viewer, and the
 * planet in the sky showed its night side. Long shadows are kept; they now
 * fall across the frame instead of out of it.
 */
const SUN_OFFSET = [-650, 460, 380]
const SUN = new THREE.Vector3(...SUN_OFFSET).normalize()
/** How far out the sky's furniture is drawn: inside the camera's far plane. */
const SKY_RADIUS = 42000

/** Mars's daytime sky, by eye from the rovers' own colour-calibrated frames. */
const MARS_SKY = { horizon: '#d6a982', zenith: '#6c5347', glow: '#fff3df' }

function skyMaterialFor() {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      uHorizon: { value: new THREE.Color(MARS_SKY.horizon) },
      uZenith: { value: new THREE.Color(MARS_SKY.zenith) },
      uGlow: { value: new THREE.Color(MARS_SKY.glow) },
      uSun: { value: SUN },
    },
    vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `varying vec3 vDir; uniform vec3 uHorizon, uZenith, uGlow, uSun;
      void main(){
        float h = clamp(vDir.y, 0.0, 1.0);
        vec3 col = mix(uHorizon, uZenith, pow(h, 0.55));
        // Dust scatters forward: the sky brightens toward the Sun, tightly
        // around it and broadly over the whole sunward half.
        float c = max(dot(normalize(vDir), uSun), 0.0);
        col += uGlow * (pow(c, 900.0) * 3.0 + pow(c, 40.0) * 0.35 + pow(c, 6.0) * 0.12);
        // A little brighter right at the horizon, where the path through dust is longest.
        col *= 1.0 + 0.18 * exp(-h * 18.0);
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  })
}

/** A soft radial glare for the Sun seen through a lens with no air in the way. */
function glareTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 256
  const g = c.getContext('2d')
  const grad = g.createRadialGradient(128, 128, 0, 128, 128, 128)
  grad.addColorStop(0, 'rgba(255,252,244,1)')
  grad.addColorStop(0.05, 'rgba(255,248,232,0.95)')
  grad.addColorStop(0.16, 'rgba(255,236,206,0.28)')
  grad.addColorStop(0.45, 'rgba(255,226,190,0.06)')
  grad.addColorStop(1, 'rgba(255,220,180,0)')
  g.fillStyle = grad; g.fillRect(0, 0, 256, 256)
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace
  return t
}

/**
 * The planet in the sky: Earth over the Moon, Jupiter over Europa.
 *
 * Both used to be a product of sines, which aliased into speckle at the size
 * they are drawn and gave Jupiter ruler-straight stripes. These are built from
 * simplex noise on the sphere: Jupiter's belts and zones are bands of latitude
 * pushed about by turbulence, with the Great Red Spot in its southern belt;
 * Earth is oceans, continents, ice caps and cloud, with a blue limb. Each is
 * lit by the same Sun as the ground, so the phase you see is the real one for
 * that geometry, and limb-darkened the way a gas giant is.
 */
function parentMaterialFor(id) {
  return new THREE.ShaderMaterial({
    uniforms: { uSun: { value: SUN } },
    vertexShader: `varying vec3 vN; varying vec3 vView;
      void main(){ vN = normal; vec4 w = modelMatrix * vec4(position, 1.0); vView = normalize(cameraPosition - w.xyz); gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `${NOISE_GLSL}
      varying vec3 vN; varying vec3 vView; uniform vec3 uSun;
      void main(){
        vec3 n = normalize(vN);
        float ndl = dot(n, uSun);
        float ndv = max(dot(n, normalize(vView)), 0.0);
        vec3 col;
        ${id === 'europa' ? `
          float warp = snoise(n * 3.0) * 0.035 + snoise(vec3(n.x * 14.0, n.y * 4.0, n.z * 14.0)) * 0.012;
          float lat = n.y + warp;
          // Belts and zones of uneven width: two incommensurate frequencies.
          float band = clamp(0.5 + 0.35 * sin(lat * 23.0) + 0.25 * sin(lat * 9.0 + 1.3) + 0.12 * sin(lat * 51.0), 0.0, 1.0);
          vec3 zone = vec3(0.90, 0.85, 0.74), belt = vec3(0.62, 0.39, 0.23);
          col = mix(belt, zone, smoothstep(0.35, 0.65, band));
          col *= 0.92 + 0.16 * snoise(vec3(n.x * 6.0, lat * 40.0, n.z * 6.0));
          // The Great Red Spot, in the southern equatorial belt.
          vec3 grs = normalize(vec3(0.35, -0.38, 0.86));
          float spot = smoothstep(0.985, 0.995, dot(n, grs) + (n.y + 0.38) * 0.02);
          col = mix(col, vec3(0.72, 0.33, 0.22), spot * 0.85);
          col = mix(col, vec3(0.55, 0.58, 0.62), smoothstep(0.78, 0.95, abs(n.y)));
          col *= pow(ndv, 0.32);
          float light = smoothstep(-0.06, 0.25, ndl) * (0.25 + 0.75 * max(ndl, 0.0));
          gl_FragColor = vec4(col * (0.012 + light), 1.0);
        ` : `
          float land = snoise(n * 1.7) + snoise(n * 4.3) * 0.35;
          vec3 ocean = vec3(0.03, 0.12, 0.28), ground = mix(vec3(0.22, 0.30, 0.14), vec3(0.47, 0.38, 0.24), smoothstep(-0.3, 0.6, snoise(n * 3.1)));
          col = mix(ocean, ground, smoothstep(0.18, 0.28, land));
          col = mix(col, vec3(0.92), smoothstep(0.82, 0.9, abs(n.y)));
          float cloud = snoise(n * 3.2 + vec3(snoise(n * 6.0) * 0.6)) * 0.6 + snoise(n * 9.0) * 0.4;
          col = mix(col, vec3(0.93), smoothstep(0.15, 0.6, cloud) * 0.85);
          float light = max(ndl, 0.0);
          col *= 0.02 + light;
          col += vec3(0.25, 0.45, 0.9) * pow(1.0 - ndv, 3.0) * smoothstep(-0.2, 0.3, ndl) * 0.7;
          gl_FragColor = vec4(col, 1.0);
        `}
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  })
}

function Sky({ id }) {
  const region = REGIONS[id]
  const points = useMemo(() => {
    const rand = mulberry32(601), a = new Float32Array(2400 * 3), c = new Float32Array(2400 * 3)
    for (let i = 0; i < 2400; i++) {
      const az = rand() * Math.PI * 2, y = rand() * 1.08 - 0.08, r = Math.sqrt(Math.max(0, 1 - y * y)) * SKY_RADIUS
      a[i * 3] = Math.cos(az) * r; a[i * 3 + 1] = y * SKY_RADIUS; a[i * 3 + 2] = Math.sin(az) * r
      // A few warm and cool stars among the white, and a spread of brightness.
      const b = 0.35 + rand() ** 3 * 0.9, t = rand()
      c[i * 3] = b * (t < 0.15 ? 1.0 : t > 0.88 ? 0.78 : 0.92); c[i * 3 + 1] = b * 0.9; c[i * 3 + 2] = b * (t < 0.15 ? 0.72 : t > 0.88 ? 1.0 : 0.88)
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(a, 3)); g.setAttribute('color', new THREE.BufferAttribute(c, 3)); return g
  }, [])
  useEffect(() => () => points.dispose(), [points])
  const skyMaterial = useMemo(skyMaterialFor, [])
  useEffect(() => () => skyMaterial.dispose(), [skyMaterial])
  const parentMaterial = useMemo(() => parentMaterialFor(id), [id])
  useEffect(() => () => parentMaterial.dispose(), [parentMaterial])
  const glare = useMemo(glareTexture, [])
  useEffect(() => () => glare.dispose(), [glare])
  const distance = 35000, radius = region.parent ? distance * region.parentRadius / region.parentDistance : 0
  const sunAt = SUN.clone().multiplyScalar(SKY_RADIUS * 0.95)
  // The Sun's true angular radius at each world, drawn as a disc; the glare
  // around it is what a camera sees, not part of the Sun.
  const sunRadius = SKY_RADIUS * 0.95 * (id === 'europa' ? 0.00089 : id === 'mars' ? 0.00306 : 0.00465)
  return <>
    {region.atmosphere
      ? <mesh material={skyMaterial} renderOrder={-2}><sphereGeometry args={[SKY_RADIUS + 3000, 48, 24]} /></mesh>
      : <>
        <points geometry={points} renderOrder={-2}><pointsMaterial vertexColors size={16} sizeAttenuation fog={false} transparent opacity={0.9} depthWrite={false} /></points>
        <mesh position={sunAt} renderOrder={-1}><sphereGeometry args={[Math.max(sunRadius, 60), 24, 12]} /><meshBasicMaterial color="#fff8ec" fog={false} toneMapped={false} /></mesh>
        <sprite position={sunAt} scale={[sunRadius * 60, sunRadius * 60, 1]} renderOrder={-1}><spriteMaterial map={glare} blending={THREE.AdditiveBlending} depthWrite={false} fog={false} transparent opacity={0.85} /></sprite>
      </>}
    {region.parent && <mesh position={[-4000, id === 'europa' ? 3000 : 1800, -35000]} material={parentMaterial}><sphereGeometry args={[radius, 64, 40]} /></mesh>}
  </>
}

/**
 * A column of light over wherever the player should go next.
 *
 * The objective used to be a compass bearing in a corner, and a person on
 * foot on a grey plain cannot steer by "324 degrees". A beacon is the oldest
 * answer there is: it reads from 600 m away, it says *there* without a word,
 * and it is the same target the HUD's arrow points at because both ask
 * `nextTarget` in sim/expedition.js. The beam fades upward so it marks a spot
 * on the ground rather than standing like a pole, and it goes out when the
 * player is standing in it.
 */
const BEAM_HEIGHT = 46
const _goal = new Float64Array(2)
const beamMaterial = () => new THREE.ShaderMaterial({
  uniforms: { uTime: { value: 0 } },
  vertexShader: `varying float vUp; void main() { vUp = position.y / ${BEAM_HEIGHT.toFixed(1)} + 0.5; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `uniform float uTime; varying float vUp;
    void main() {
      float fade = pow(1.0 - clamp(vUp, 0.0, 1.0), 1.8);
      float pulse = 0.82 + 0.18 * sin(uTime * 2.4 - vUp * 9.0);
      gl_FragColor = vec4(vec3(1.0, 0.42, 0.17) * fade * pulse, fade * 0.55);
    }`,
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
})
function Beacon({ session }) {
  const group = useRef(), ring = useRef()
  const material = useMemo(beamMaterial, [])
  useEffect(() => () => material.dispose(), [material])
  useFrame((state) => {
    const g = group.current
    if (!g) return
    const s = session
    const kind = s.mode === 'eva' || s.mode === 'rover' ? nextTarget(s, _goal) : null
    const p = s.mode === 'rover' ? s.rover : s.walker
    const close = kind ? Math.hypot(p.x - _goal[0], p.z - _goal[1]) < 3 : true
    g.visible = Boolean(kind) && kind !== 'pad' && !close
    if (!g.visible) return
    g.position.set(_goal[0], terrainFor(s.id).height(_goal[0], _goal[1]), _goal[1])
    material.uniforms.uTime.value = state.clock.elapsedTime
    if (ring.current) ring.current.scale.setScalar(1 + 0.25 * Math.sin(state.clock.elapsedTime * 2.4))
  })
  return <group ref={group} visible={false}>
    <mesh position={[0, BEAM_HEIGHT / 2, 0]} material={material} renderOrder={5}><cylinderGeometry args={[0.32, 0.55, BEAM_HEIGHT, 20, 1, true]} /></mesh>
    <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.08, 0]} renderOrder={5}><ringGeometry args={[1.6, 1.85, 48]} /><meshBasicMaterial color="#ff6b2c" transparent opacity={0.8} depthWrite={false} /></mesh>
  </group>
}
