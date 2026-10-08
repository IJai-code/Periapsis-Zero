import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { applyRockSet, buildExpeditionTerrain, buildRocks, terrainMaterial } from '../gfx/expeditionTerrain.js'
import { mulberry32 } from '../gfx/noise.js'
import { useAuthored } from '../gfx/authored.js'
import { buildSurfaceEnvironment, SKY as SKY_COLOURS } from '../gfx/surfaceEnvironment.js'
import { governSurface, resetSurfaceGovernor, subscribeSurfaceQuality, surfaceQuality } from '../gfx/surfaceQuality.js'
import { NOISE_GLSL } from '../gfx/glsl/noise.js'
import { FEATURES, FIXED_STEP, nextTarget, REGIONS, ROVER, terrainFor, stepExpedition } from '../sim/expedition.js'

/**
 * The surface, on any world: ground, rocks, sky, the lander and rover, and
 * what the survey is looking for. Physics is sim/expedition.js; this draws it.
 *
 * Time warp lives here because it is how many fixed steps a frame runs: hold
 * Shift on the ground and the same physics runs four times as many steps.
 */
const WARP = 4

export function ExpeditionScene({ session, controls, paused, scenic = false, onPulse }) {
  const world = REGIONS[session.id]
  const ground = useMemo(() => buildExpeditionTerrain(session.id), [session.id])
  const material = useMemo(() => terrainMaterial(session.id), [session.id])
  const rocks = useMemo(() => buildRocks(session.id), [session.id])
  const authoredLander = useAuthored('survey-lander', !scenic)
  const authoredRover = useAuthored('survey-rover', !scenic && !world.hopper)
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
  const roverWheels = useMemo(() => {
    if (!authoredRover) return null
    const list = []
    for (let k = 0; k < 6; k++) { const w = authoredRover.scene.getObjectByName(`wheel_${k}`); if (w) list.push(w) }
    return list
  }, [authoredRover])
  const exitY = authoredLander?.points.nozzle_0?.y ?? -1.85
  const lander = useRef(), plume = useRef(), light = useRef(), rover = useRef(), wheels = useRef([])
  const clock = useRef({ accumulated: 0, pulse: 0, yaw: 0, pitch: 0.24, distance: 30 })
  const scratch = useMemo(() => ({ position: new THREE.Vector3(), target: new THREE.Vector3(), look: new THREE.Vector3() }), [])
  const { camera, gl, scene } = useThree()
  const quality = useSyncExternalStore(subscribeSurfaceQuality, surfaceQuality)
  const light$ = useMemo(() => lightingFor(world), [world])

  useEffect(() => {
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
    if (!quality.reflections) return undefined
    const env = buildSurfaceEnvironment(gl, session.id, SUN)
    scene.environment = env.texture
    material.envMapIntensity = 0
    return () => { scene.environment = null; env.dispose() }
  }, [gl, scene, session.id, material, quality.reflections])
  useEffect(() => {
    // Air: haze the colour of the world's own horizon, thick on Venus and Titan.
    const air = world.air
    const sky = air ? SKY_COLOURS[air.sky ?? 'mars'] : null
    scene.fog = air ? new THREE.Fog(sky.horizon, air.near, air.far) : null
    scene.background = new THREE.Color(sky ? sky.horizon : '#020307')
    return () => { scene.fog = null; scene.background = null }
  }, [scene, world])
  useEffect(() => {
    const canvas = gl.domElement
    canvas.tabIndex = -1
    let drag = false
    const down = (e) => { if (e.button === 0) { canvas.focus({ preventScroll: true }); drag = true; canvas.setPointerCapture(e.pointerId) } }
    const up = () => { drag = false }
    const move = (e) => {
      if (!drag || paused || scenic) return
      if (session.mode === 'eva') { session.walker.yaw += e.movementX * 0.004; session.walker.pitch = THREE.MathUtils.clamp(session.walker.pitch - e.movementY * 0.003, -1.1, 1.1) }
      else { clock.current.yaw += e.movementX * 0.004; clock.current.pitch = THREE.MathUtils.clamp(clock.current.pitch + e.movementY * 0.003, -0.25, 1.2) }
    }
    const wheel = (e) => { if (!scenic) clock.current.distance = THREE.MathUtils.clamp(clock.current.distance + e.deltaY * 0.03, 12, 90) }
    canvas.addEventListener('pointerdown', down); canvas.addEventListener('pointermove', move); canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up); canvas.addEventListener('wheel', wheel)
    return () => { canvas.removeEventListener('pointerdown', down); canvas.removeEventListener('pointermove', move); canvas.removeEventListener('pointerup', up); canvas.removeEventListener('pointercancel', up); canvas.removeEventListener('wheel', wheel) }
  }, [gl, session, paused, scenic])

  useFrame((state, delta) => {
    if (!scenic) governSurface(delta * 1000)
    const c = clock.current, s = session, keys = controls.current
    material.userData.uniforms.uTime.value = state.clock.elapsedTime
    if (!paused && !scenic) {
      // W is "away from the camera": the flight camera's heading goes to the physics.
      keys.camYaw = c.yaw
      // Warp on the ground, and while the assist is flying (a descent or a hop):
      // never with your own hands on the engine.
      const ground = s.mode === 'rover' || s.mode === 'eva' || (s.mode === 'flight' && s.assist && !s.landed)
      const warp = ground && keys.warp ? WARP : 1
      s.warping = warp > 1
      c.accumulated += Math.min(delta, 0.1) * warp
      let steps = 0
      while (c.accumulated >= FIXED_STEP && steps < 12 * warp) {
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
      const flying = (s.mode === 'flight' || s.mode === 'ascent') && !s.landed
      const throttle = flying ? s.throttle : 0
      plume.current.visible = throttle > 0.02
      plume.current.scale.set(1, 0.4 + throttle * 1.6, 1)
    }
    if (rover.current) {
      rover.current.visible = Boolean(s.rover)
      if (s.rover) {
        const r = s.rover
        rover.current.position.set(r.x, r.y - ROVER.clearance, r.z)
        const terrain = terrainFor(s.id)
        const ahead = terrain.height(r.x + Math.sin(r.yaw) * 1.2, r.z - Math.cos(r.yaw) * 1.2)
        const behind = terrain.height(r.x - Math.sin(r.yaw) * 1.2, r.z + Math.cos(r.yaw) * 1.2)
        rover.current.rotation.set(Math.atan2(ahead - behind, 2.4), -r.yaw, 0, 'YXZ')
        const roll = (s.mode === 'rover' ? r.speed : 0) * Math.min(delta, 0.05) * (s.warping ? WARP : 1)
        if (roverWheels) for (const wheel of roverWheels) wheel.rotation.x -= roll / ROVER_ROLLING_RADIUS
        else for (const wheel of Object.values(wheels.current)) if (wheel) wheel.rotation.x += roll / 0.26
      }
    }
    if (scenic) {
      scratch.position.set(360, 110, 370); scratch.target.set(-100, 220, -2200)
    } else if (s.mode === 'eva') {
      const w = s.walker
      scratch.position.set(w.x, w.y + 1.72, w.z)
      scratch.target.set(w.x + Math.sin(w.yaw) * Math.cos(w.pitch) * 20, w.y + 1.72 + Math.sin(w.pitch) * 20, w.z - Math.cos(w.yaw) * Math.cos(w.pitch) * 20)
    } else if (s.mode === 'rover' && s.rover) {
      const r = s.rover, yaw = c.yaw + r.yaw
      const distance = 8.5, lift = 2.8 + Math.sin(c.pitch) * 6
      scratch.position.set(r.x - Math.sin(yaw) * distance, r.y + lift, r.z + Math.cos(yaw) * distance)
      scratch.target.set(r.x + Math.sin(yaw) * 5, r.y + 0.9, r.z - Math.cos(yaw) * 5)
      scratch.position.y = Math.max(scratch.position.y, terrainFor(s.id).height(scratch.position.x, scratch.position.z) + 1.2)
    } else {
      const yaw = c.yaw, distance = c.distance
      scratch.position.set(s.x + Math.sin(yaw) * distance, s.y + 6 + Math.sin(c.pitch) * distance, s.z + Math.cos(yaw) * distance)
      scratch.target.set(s.x - Math.sin(yaw) * 8, s.y - 2, s.z - Math.cos(yaw) * 8)
      scratch.position.y = Math.max(scratch.position.y, terrainFor(s.id).height(scratch.position.x, scratch.position.z) + 3)
    }
    const k = s.mode === 'eva' || s.mode === 'rover' || scenic ? 1 : 1 - Math.exp(-Math.min(delta, 0.1) * 5)
    camera.position.lerp(scratch.position, k)
    scratch.look.lerp(scratch.target, k); camera.lookAt(scratch.look)
    if (light.current) {
      const focus = s.mode === 'rover' ? s.rover : s.mode === 'eva' ? s.walker : s
      light.current.position.set(focus.x + SUN_OFFSET[0], SUN_OFFSET[1], focus.z + SUN_OFFSET[2])
      light.current.target.position.set(focus.x, 0, focus.z); light.current.target.updateMatrixWorld()
    }
    c.pulse += Math.min(delta, 0.1)
    if (c.pulse >= 0.1) { c.pulse = 0; onPulse?.() }
  })
  const lake = FEATURES[session.id]?.lake
  return <>
    <Sky id={session.id} />
    <hemisphereLight args={light$.hemi} />
    <directionalLight ref={light} position={SUN_OFFSET} intensity={light$.sun} color={light$.colour} castShadow={quality.shadows} shadow-mapSize={[quality.shadow, quality.shadow]} shadow-camera-left={-110} shadow-camera-right={110} shadow-camera-top={110} shadow-camera-bottom={-110} shadow-camera-near={1} shadow-camera-far={1600} shadow-bias={-0.0002} shadow-normalBias={0.12} />
    {world.style === 'volcanic' && lake && <pointLight position={[lake.x, terrainFor(session.id).height(lake.x, lake.z) + 25, lake.z]} color="#ff7a2a" intensity={9000} distance={420} decay={2} />}
    {ground.map((g, i) => <mesh key={i} geometry={g} material={material} receiveShadow />)}
    <primitive object={rocks} />
    {!scenic && <>
      <group ref={lander}>{authoredLander ? <primitive object={authoredLander.scene} dispose={null} /> : <SurveyLander />}<mesh ref={plume} position={[0, exitY - 1.45, 0]} visible={false}><coneGeometry args={[0.45, 3.2, 20]} /><meshBasicMaterial color="#98cfff" transparent opacity={0.65} depthWrite={false} /></mesh></group>
      <LandingZone />
      <Beacon session={session} />
      <ScanPulse session={session} />
      {!world.hopper && <group ref={rover} visible={false}>{authoredRover ? <primitive object={authoredRover.scene} dispose={null} /> : <SurfaceRover wheels={wheels} />}</group>}
      <Finds session={session} kit={authoredKit} rocks={authoredRocks} />
    </>}
  </>
}

/**
 * Light for each world. The Sun's strength falls with the square of its
 * distance, and a camera opens up for that, so the scene keeps only a little
 * of it (a quarter power): Pluto is dim, not black. Thick air turns sunlight
 * into a diffuse glow from the whole sky, which is how Venus and Titan look.
 */
function lightingFor(w) {
  // Sunlight falls as 1/r^2; a camera (or an eye) exposes for it. The fourth
  // root keeps the far worlds darker than the near ones, and the floor keeps
  // Pluto's bright ice reading as bright ice rather than mud.
  const dim = Math.min(1.25, Math.max(0.5, Math.pow(1 / (w.sunAU * w.sunAU), 0.25)))
  if (w.air?.sky === 'venus') return { sun: 0.9, colour: '#ffb46a', hemi: ['#e7a45a', '#5a3a1e', 2.4] }
  if (w.air?.sky === 'titan') return { sun: 0.7, colour: '#ffbe78', hemi: ['#c99a5c', '#3e2c18', 2.0] }
  if (w.air) return { sun: 3.3, colour: '#ffe1bc', hemi: ['#e9c9ab', '#5a3a28', 1.5] }
  const bounce = new THREE.Color(w.ground.dust).multiplyScalar(0.75).getStyle()
  return { sun: 3.3 * dim, colour: '#fff5df', hemi: ['#1a1c24', bounce, 1.15 * dim] }
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
    <mesh castShadow><cylinderGeometry args={[1.75, 1.85, 2.2, 8]} /><meshStandardMaterial color="#c9a14a" metalness={0.75} roughness={0.38} /></mesh>
    <mesh position={[0, 1.5, 0]} castShadow><boxGeometry args={[2.6, 1.5, 2.5]} /><meshStandardMaterial color="#d9d9cc" roughness={0.45} metalness={0.3} /></mesh>
    <mesh position={[0, -1.45, 0]} castShadow><cylinderGeometry args={[0.33, 0.65, 0.8, 20, 1, true]} /><meshStandardMaterial color="#343b3d" side={THREE.DoubleSide} metalness={0.8} roughness={0.6} /></mesh>
    {[-1, 1].flatMap((x) => [-1, 1].map((z) => <group key={`${x}/${z}`}>
      <Beam from={[x * 1.4, -0.4, z * 1.4]} to={[x * 3.2, -2.42, z * 3.2]} radius={0.1} color="#c8902c" />
      <Beam from={[x * 1.2, 0.6, z * 1.2]} to={[x * 3.2, -2.42, z * 3.2]} radius={0.055} color="#c8902c" />
      <mesh position={[x * 3.2, -2.52, z * 3.2]} castShadow><cylinderGeometry args={[0.5, 0.5, 0.16, 16]} /><meshStandardMaterial color="#6b6862" metalness={0.65} roughness={0.6} /></mesh>
    </group>))}
  </group>
}
function LandingZone() {
  return <group position={[0, 0.06, 0]}>
    <mesh rotation={[-Math.PI / 2, 0, 0]}><ringGeometry args={[11.8, 12, 64]} /><meshBasicMaterial color="#d5ae6b" transparent opacity={0.55} side={THREE.DoubleSide} /></mesh>
    {[[-12, -12], [12, -12], [-12, 12], [12, 12]].map(([x, z]) => <group key={`${x}/${z}`} position={[x, 0, z]}><mesh position={[0, 0.65, 0]}><cylinderGeometry args={[0.04, 0.06, 1.3, 8]} /><meshStandardMaterial color="#bfc0b6" /></mesh><mesh position={[0, 1.3, 0]}><sphereGeometry args={[0.09, 8, 8]} /><meshBasicMaterial color="#e9b267" /></mesh></group>)}
  </group>
}
/** The rover from primitives, until the Blender-built one (art/survey-rover) loads. */
function SurfaceRover({ wheels }) {
  return <group>
    <mesh position={[0, 0.7, 0]} castShadow><boxGeometry args={[1.34, 0.36, 2.2]} /><meshStandardMaterial color="#cfc9b6" metalness={0.35} roughness={0.62} /></mesh>
    <mesh position={[0, 1.4, 0]} castShadow><boxGeometry args={[1.4, 0.04, 1.9]} /><meshStandardMaterial color="#1d2c46" metalness={0.4} roughness={0.3} /></mesh>
    {[-1, 0, 1].flatMap((sz) => [-1, 1].map((sx) => <mesh key={`${sx}/${sz}`} ref={(m) => { wheels.current[`${sx}${sz}`] = m }} position={[sx * 0.85, 0.313, sz * 1.05]} rotation={[0, 0, Math.PI / 2]} castShadow><cylinderGeometry args={[0.313, 0.313, 0.28, 16]} /><meshStandardMaterial color="#2e2d2a" roughness={0.85} /></mesh>))}
  </group>
}
/** The authored rover's rolling radius, to its cleat tips (art/survey-rover/spec.json). */
const ROVER_ROLLING_RADIUS = 0.313

/**
 * One prop out of the survey kit, cloned for this site, with its own copy of
 * the status light so one package can glow while the others wait.
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
    else { m.color.set('#6b625a'); m.emissive?.set('#000000') }
  }, [prop, lit, litColour])
  return prop?.copy ?? null
}

/**
 * Everything the survey is about, drawn from the session's own list: samples
 * (a darker stone with an ember stake; the rare one with an ion ring), the
 * station site (a marker until the seismometer is set down), the anomaly (its
 * world's own effect), and the search zones the scanner has not cleared yet.
 * Redrawn when the HUD's pulse re-renders, ten times a second.
 */
function Finds({ session, kit, rocks }) {
  const t = terrainFor(session.id)
  return <>
    {session.pois.map((p, i) => {
      const y = t.height(p.x, p.z)
      if (!p.found) return p.zone ? <Zone key={i} x={p.zone.x} z={p.zone.z} r={p.zone.r} y={t.height(p.zone.x, p.zone.z)} /> : null
      if (p.kind === 'sample') return <Sample key={i} id={session.id} p={p} y={y} kit={kit} rocks={rocks} />
      if (p.kind === 'station') return <Station key={i} p={p} y={y} kit={kit} />
      return <Anomaly key={i} id={session.id} p={p} y={y} />
    })}
  </>
}

const SAMPLE_TINT = new THREE.Color('#4a423a')
function Sample({ id, p, y, kit, rocks }) {
  const stake = useKitProp(kit, 'stake', !p.done, p.rare ? '#2fd3ff' : '#ff6b2c')
  const stone = useMemo(() => {
    const source = rocks?.scene.getObjectByName('rock_3')
    const mesh = source?.isMesh ? source : source?.children?.find((c) => c.isMesh)
    if (!mesh) return null
    const material = mesh.material.clone()
    material.color.copy(SAMPLE_TINT).lerp(new THREE.Color(REGIONS[id].rockTint), 0.4).multiplyScalar(2)
    return { geometry: mesh.geometry, material }
  }, [rocks, id])
  useEffect(() => () => stone?.material.dispose(), [stone])
  return <group position={[p.x, y, p.z]}>
    {!p.done && (stone
      ? <mesh position={[0, 0.2, 0]} castShadow receiveShadow scale={[0.7, 0.6, 0.6]} geometry={stone.geometry} material={stone.material} />
      : <mesh position={[0, 0.3, 0]} castShadow scale={[1.0, 0.6, 0.75]}><icosahedronGeometry args={[0.7, 2]} /><meshStandardMaterial color="#4a423a" roughness={0.9} flatShading /></mesh>)}
    {!p.done && p.rare && <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.06, 0]}><ringGeometry args={[1.5, 1.7, 40]} /><meshBasicMaterial color="#2fd3ff" transparent opacity={0.75} depthWrite={false} /></mesh>}
    {stake ? <group position={[1.1, 0, 0]}><primitive object={stake} /></group> : <mesh position={[1.1, 0.65, 0]}><cylinderGeometry args={[0.02, 0.02, 1.3, 6]} /><meshBasicMaterial color={p.done ? '#576054' : '#ff6b2c'} /></mesh>}
  </group>
}
function Station({ p, y, kit }) {
  const prop = useKitProp(kit, 'seismometer', p.done, '#2fd3ff')
  return <group position={[p.x, y, p.z]}>
    {p.done ? (prop ? <primitive object={prop} /> : <mesh position={[0, 0.4, 0]}><cylinderGeometry args={[0.4, 0.5, 0.8, 16]} /><meshStandardMaterial color="#d8d2bf" /></mesh>)
      : <><mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.06, 0]}><ringGeometry args={[2.2, 2.45, 48]} /><meshBasicMaterial color="#2fd3ff" transparent opacity={0.8} depthWrite={false} /></mesh>
        <mesh position={[0, 0.8, 0]}><cylinderGeometry args={[0.03, 0.03, 1.6, 6]} /><meshBasicMaterial color="#2fd3ff" /></mesh></>}
  </group>
}

/**
 * The anomaly, as its world makes it: a vapour plume on Europa, a dust jet on
 * the comet, the lava lake's own glow on Io, the methane shore on Titan.
 * Anywhere else a ring of ion light marks the spot.
 */
function Anomaly({ id, p, y }) {
  const plume = useRef()
  const kind = id === 'europa' ? 'vapour' : id === 'halley' ? 'jet' : null
  const material = useMemo(() => new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uColour: { value: new THREE.Color(kind === 'jet' ? '#d8cfc0' : '#e8f4ff') } },
    vertexShader: 'varying float vUp; varying vec2 vUv; void main(){ vUp = uv.y; vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform float uTime; uniform vec3 uColour; varying float vUp; varying vec2 vUv;
      void main(){ float flicker = 0.7 + 0.3 * sin(uTime * 7.0 + vUv.x * 40.0 + vUp * 12.0);
        float a = pow(1.0 - vUp, 1.4) * smoothstep(0.0, 0.08, vUp) * flicker * 0.55;
        gl_FragColor = vec4(uColour * a, a); }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  }), [kind])
  useEffect(() => () => material.dispose(), [material])
  useFrame((state) => { material.uniforms.uTime.value = state.clock.elapsedTime })
  return <group position={[p.x, y, p.z]}>
    {kind && !p.done && <mesh ref={plume} position={[0, kind === 'jet' ? 30 : 18, 0]} material={material}><coneGeometry args={[kind === 'jet' ? 9 : 6, kind === 'jet' ? 60 : 36, 24, 1, true]} /></mesh>}
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.08, 0]}><ringGeometry args={[13.6, 14, 64]} /><meshBasicMaterial color={p.done ? '#576054' : '#2fd3ff'} transparent opacity={0.7} depthWrite={false} /></mesh>
  </group>
}

/** A search zone: where the scanner should be used. A soft dashed ring on the ground. */
const zoneMaterial = new THREE.ShaderMaterial({
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: 'varying vec2 vUv; void main(){ float a = step(0.5, fract(atan(vUv.y - 0.5, vUv.x - 0.5) * 9.549)); gl_FragColor = vec4(0.18, 0.83, 1.0, 0.55 * a); }',
  transparent: true, depthWrite: false,
})
function Zone({ x, z, r, y }) {
  return <mesh rotation={[-Math.PI / 2, 0, 0]} position={[x, y + 1.5, z]} material={zoneMaterial} renderOrder={4}><ringGeometry args={[r - 0.8, r, 96]} /></mesh>
}

/** The scanner's pulse: a ring that sweeps out to the scanner's range. */
function ScanPulse({ session }) {
  const ring = useRef()
  useFrame(() => {
    const m = ring.current
    if (!m) return
    const age = session.time - session.scan.at
    const on = session.landedAt !== null && age >= 0 && age < 1.6
    m.visible = on
    if (!on) return
    const r = Math.max(1, session.scan.range * (age / 1.6))
    m.scale.set(r, r, 1)
    m.position.set(session.scan.x, terrainFor(session.id).height(session.scan.x, session.scan.z) + 2, session.scan.z)
    m.material.opacity = 0.7 * (1 - age / 1.6)
  })
  return <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]} visible={false} renderOrder={6}><ringGeometry args={[0.97, 1, 128]} /><meshBasicMaterial color="#2fd3ff" transparent opacity={0.7} depthWrite={false} /></mesh>
}

/**
 * Where the Sun is: the direction the shadow-casting light comes from, left
 * of and a little behind the cameras, 31 degrees up, so shots are lit from
 * the side the camera is on.
 */
const SUN_OFFSET = [-650, 460, 380]
const SUN = new THREE.Vector3(...SUN_OFFSET).normalize()
const SKY_RADIUS = 42000

function skyMaterialFor(id) {
  const w = REGIONS[id]
  const colours = SKY_COLOURS[w.air?.sky ?? 'mars']
  const overcast = w.air?.rho > 1
  return new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      uHorizon: { value: new THREE.Color(colours.horizon) },
      uZenith: { value: new THREE.Color(colours.zenith) },
      uGlow: { value: new THREE.Color('#fff3df') },
      uSun: { value: SUN },
      uSunlit: { value: overcast ? 0.0 : 1.0 },
    },
    vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `varying vec3 vDir; uniform vec3 uHorizon, uZenith, uGlow, uSun; uniform float uSunlit;
      void main(){
        float h = clamp(vDir.y, 0.0, 1.0);
        vec3 col = mix(uHorizon, uZenith, pow(h, 0.55));
        // Dust scatters forward: the sky brightens toward the Sun. Under an
        // overcast (Venus, Titan) there is no Sun to see, only a brighter patch.
        float c = max(dot(normalize(vDir), uSun), 0.0);
        col += uGlow * (uSunlit * (pow(c, 900.0) * 3.0 + pow(c, 40.0) * 0.35) + pow(c, 6.0) * 0.12);
        col *= 1.0 + 0.18 * exp(-h * 18.0);
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  })
}

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
 * The body in the sky, lit by the same Sun as the ground so its phase is
 * the real one for that geometry: Earth over the Moon, Mars over its moons
 * (forty degrees across from Phobos), Jupiter over its four, Saturn and its
 * rings over Titan's haze, Charon over Pluto. Built from noise on the sphere.
 */
const LOOKS = {
  jupiter: `
    float warp = snoise(n * 3.0) * 0.035 + snoise(vec3(n.x * 14.0, n.y * 4.0, n.z * 14.0)) * 0.012;
    float lat = n.y + warp;
    float band = clamp(0.5 + 0.35 * sin(lat * 23.0) + 0.25 * sin(lat * 9.0 + 1.3) + 0.12 * sin(lat * 51.0), 0.0, 1.0);
    col = mix(vec3(0.62, 0.39, 0.23), vec3(0.90, 0.85, 0.74), smoothstep(0.35, 0.65, band));
    col *= 0.92 + 0.16 * snoise(vec3(n.x * 6.0, lat * 40.0, n.z * 6.0));
    vec3 grs = normalize(vec3(0.35, -0.38, 0.86));
    col = mix(col, vec3(0.72, 0.33, 0.22), smoothstep(0.985, 0.995, dot(n, grs)) * 0.85);
    col = mix(col, vec3(0.55, 0.58, 0.62), smoothstep(0.78, 0.95, abs(n.y)));
    col *= pow(ndv, 0.32);`,
  saturn: `
    float lat = n.y + snoise(n * 4.0) * 0.015;
    float band = 0.5 + 0.3 * sin(lat * 19.0) + 0.2 * sin(lat * 47.0 + 0.7);
    col = mix(vec3(0.78, 0.66, 0.45), vec3(0.93, 0.86, 0.68), smoothstep(0.3, 0.7, band));
    col *= pow(ndv, 0.3);`,
  mars: `
    float albedo = snoise(n * 2.2) + snoise(n * 5.0) * 0.4;
    col = mix(vec3(0.62, 0.32, 0.17), vec3(0.36, 0.2, 0.13), smoothstep(0.1, 0.5, albedo));
    col = mix(col, vec3(0.95), smoothstep(0.88, 0.94, n.y));`,
  charon: `
    col = mix(vec3(0.55, 0.53, 0.5), vec3(0.42, 0.4, 0.38), smoothstep(-0.2, 0.4, snoise(n * 3.0)));
    col = mix(col, vec3(0.45, 0.22, 0.14), smoothstep(0.7, 0.85, n.y));`,
  earth: `
    float land = snoise(n * 1.7) + snoise(n * 4.3) * 0.35;
    vec3 ocean = vec3(0.03, 0.12, 0.28), ground = mix(vec3(0.22, 0.30, 0.14), vec3(0.47, 0.38, 0.24), smoothstep(-0.3, 0.6, snoise(n * 3.1)));
    col = mix(ocean, ground, smoothstep(0.18, 0.28, land));
    col = mix(col, vec3(0.92), smoothstep(0.82, 0.9, abs(n.y)));
    float cloud = snoise(n * 3.2 + vec3(snoise(n * 6.0) * 0.6)) * 0.6 + snoise(n * 9.0) * 0.4;
    col = mix(col, vec3(0.93), smoothstep(0.15, 0.6, cloud) * 0.85);
    rim = vec3(0.25, 0.45, 0.9) * pow(1.0 - ndv, 3.0) * smoothstep(-0.2, 0.3, ndl) * 0.7;`,
}
function parentMaterialFor(look) {
  return new THREE.ShaderMaterial({
    uniforms: { uSun: { value: SUN } },
    fog: false,
    vertexShader: `varying vec3 vN; varying vec3 vView;
      void main(){ vN = normal; vec4 w = modelMatrix * vec4(position, 1.0); vView = normalize(cameraPosition - w.xyz); gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `${NOISE_GLSL}
      varying vec3 vN; varying vec3 vView; uniform vec3 uSun;
      void main(){
        vec3 n = normalize(vN);
        float ndl = dot(n, uSun);
        float ndv = max(dot(n, normalize(vView)), 0.0);
        vec3 col = vec3(0.5), rim = vec3(0.0);
        ${LOOKS[look] ?? LOOKS.charon}
        float light = smoothstep(-0.06, 0.25, ndl) * (0.25 + 0.75 * max(ndl, 0.0));
        gl_FragColor = vec4(col * (0.012 + light) + rim, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  })
}
const ringMaterial = () => new THREE.ShaderMaterial({
  side: THREE.DoubleSide, transparent: true, depthWrite: false, fog: false,
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `varying vec2 vUv;
    void main(){ float r = length(vUv - 0.5) * 2.0;
      float t = (r - 0.55) / 0.45;
      float bands = 0.55 + 0.25 * sin(t * 60.0) + 0.2 * sin(t * 23.0 + 1.0);
      float gap = 1.0 - smoothstep(0.0, 0.02, abs(t - 0.62)) * 0.9;
      float a = smoothstep(0.0, 0.05, t) * (1.0 - smoothstep(0.95, 1.0, t)) * bands * gap * 0.85;
      gl_FragColor = vec4(vec3(0.85, 0.78, 0.62) * a, a); }`,
})

function Sky({ id }) {
  const w = REGIONS[id]
  const points = useMemo(() => {
    const rand = mulberry32(601), a = new Float32Array(2400 * 3), c = new Float32Array(2400 * 3)
    for (let i = 0; i < 2400; i++) {
      const az = rand() * Math.PI * 2, y = rand() * 1.08 - 0.08, r = Math.sqrt(Math.max(0, 1 - y * y)) * SKY_RADIUS
      a[i * 3] = Math.cos(az) * r; a[i * 3 + 1] = y * SKY_RADIUS; a[i * 3 + 2] = Math.sin(az) * r
      const b = 0.35 + rand() ** 3 * 0.9, t = rand()
      c[i * 3] = b * (t < 0.15 ? 1.0 : t > 0.88 ? 0.78 : 0.92); c[i * 3 + 1] = b * 0.9; c[i * 3 + 2] = b * (t < 0.15 ? 0.72 : t > 0.88 ? 1.0 : 0.88)
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(a, 3)); g.setAttribute('color', new THREE.BufferAttribute(c, 3)); return g
  }, [])
  useEffect(() => () => points.dispose(), [points])
  const skyMaterial = useMemo(() => (w.air ? skyMaterialFor(id) : null), [id, w.air])
  useEffect(() => () => skyMaterial?.dispose(), [skyMaterial])
  const parent = w.parent
  const parentMaterial = useMemo(() => (parent ? parentMaterialFor(parent.look) : null), [parent])
  useEffect(() => () => parentMaterial?.dispose(), [parentMaterial])
  const rings = useMemo(() => (parent?.look === 'saturn' ? ringMaterial() : null), [parent])
  useEffect(() => () => rings?.dispose(), [rings])
  const glare = useMemo(glareTexture, [])
  useEffect(() => () => glare.dispose(), [glare])
  const sunAt = SUN.clone().multiplyScalar(SKY_RADIUS * 0.95)
  // The Sun at its true angular size for this world's distance from it.
  const sunRadius = SKY_RADIUS * 0.95 * 0.00465 / w.sunAU
  // The parent body at its true angular size, up and ahead of the approach.
  const distance = 35000
  const radius = parent ? distance * Math.tan(Math.asin(Math.min(0.95, parent.radius / parent.distance))) : 0
  const elevation = parent ? Math.max(0.12, Math.min(0.5, Math.asin(parent.radius / parent.distance) + 0.06)) : 0
  const parentAt = [-0.11 * distance, Math.sin(elevation) * distance, -Math.cos(elevation) * distance]
  const overcast = w.air?.rho > 1
  return <>
    {w.air && <mesh material={skyMaterial} renderOrder={-2}><sphereGeometry args={[SKY_RADIUS + 3000, 48, 24]} /></mesh>}
    {!w.air && <>
      <points geometry={points} renderOrder={-2}><pointsMaterial vertexColors size={16} sizeAttenuation fog={false} transparent opacity={0.9} depthWrite={false} /></points>
      <mesh position={sunAt} renderOrder={-1}><sphereGeometry args={[Math.max(sunRadius, 30), 24, 12]} /><meshBasicMaterial color="#fff8ec" fog={false} toneMapped={false} /></mesh>
      <sprite position={sunAt} scale={[Math.max(sunRadius, 30) * 60, Math.max(sunRadius, 30) * 60, 1]} renderOrder={-1}><spriteMaterial map={glare} blending={THREE.AdditiveBlending} depthWrite={false} fog={false} transparent opacity={0.85} /></sprite>
    </>}
    {parent && !overcast && <group position={parentAt}>
      <mesh material={parentMaterial} renderOrder={-1}><sphereGeometry args={[radius, 64, 40]} /></mesh>
      {rings && <mesh material={rings} rotation={[-Math.PI / 2 + 0.42, 0.2, 0]} renderOrder={-1}><ringGeometry args={[radius * 1.2, radius * 2.3, 128, 1]} /></mesh>}
    </group>}
  </>
}

/**
 * A column of light over wherever the player should go next: the same
 * target the HUD's arrow and radar point at, all three asking nextTarget.
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
    const kind = s.landedAt !== null ? nextTarget(s, _goal) : null
    const p = s.mode === 'rover' ? s.rover : s.mode === 'eva' ? s.walker : s
    const close = kind ? Math.hypot(p.x - _goal[0], p.z - _goal[1]) < 4 : true
    g.visible = Boolean(kind) && kind !== 'pad' && kind !== 'zone' && !close
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
