import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { buildExpeditionTerrain, buildRocks, terrainMaterial } from '../gfx/expeditionTerrain.js'
import { mulberry32 } from '../gfx/noise.js'
import { FIXED_STEP, REGIONS, SITES, terrainFor, stepExpedition, VEHICLE } from '../sim/expedition.js'

export function ExpeditionScene({ session, controls, paused, scenic = false, onPulse }) {
  const ground = useMemo(() => buildExpeditionTerrain(session.id), [session.id])
  const material = useMemo(() => terrainMaterial(session.id), [session.id])
  const rocks = useMemo(() => buildRocks(session.id), [session.id])
  const region = REGIONS[session.id]
  const lander = useRef(), plume = useRef(), light = useRef()
  const clock = useRef({ accumulated: 0, pulse: 0, yaw: 0, pitch: 0.24, distance: 28 })
  const scratch = useMemo(() => ({ position: new THREE.Vector3(), target: new THREE.Vector3(), look: new THREE.Vector3() }), [])
  const { camera, gl, scene } = useThree()

  useEffect(() => {
    const boot = document.getElementById('boot')
    if (boot) { boot.classList.add('boot-done'); const timer = setTimeout(() => boot.remove(), 700); return () => clearTimeout(timer) }
  }, [])
  useEffect(() => () => { ground.forEach((g) => g.dispose()); material.dispose(); rocks.geometry.dispose(); rocks.material.dispose() }, [ground, material, rocks])
  useEffect(() => {
    scene.fog = region.atmosphere ? new THREE.Fog(region.sky, 1800, 14000) : null
    scene.background = new THREE.Color(region.sky)
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
    if (scenic) {
      scratch.position.set(360, 110, 370); scratch.target.set(-100, 220, -2200)
    } else if (s.mode === 'eva') {
      const w = s.walker
      scratch.position.set(w.x, w.y + 1.72, w.z)
      scratch.target.set(w.x + Math.sin(w.yaw) * Math.cos(w.pitch) * 20, w.y + 1.72 + Math.sin(w.pitch) * 20, w.z - Math.cos(w.yaw) * Math.cos(w.pitch) * 20)
    } else {
      const yaw = c.yaw + s.yaw, distance = c.distance
      scratch.position.set(s.x + Math.sin(yaw) * distance, s.y + 9 + Math.sin(c.pitch) * distance, s.z + Math.cos(yaw) * distance)
      scratch.target.set(s.x, s.y + 3, s.z - 10)
      scratch.position.y = Math.max(scratch.position.y, terrainFor(s.id).height(scratch.position.x, scratch.position.z) + 3)
    }
    const k = s.mode === 'eva' || scenic ? 1 : 1 - Math.exp(-Math.min(delta, 0.1) * 5)
    camera.position.lerp(scratch.position, k)
    scratch.look.lerp(scratch.target, k); camera.lookAt(scratch.look)
    if (light.current) {
      // Local shadow frustum follows the player, not a twelve-kilometre landscape.
      const x = s.mode === 'eva' ? s.walker.x : s.x, z = s.mode === 'eva' ? s.walker.z : s.z
      light.current.position.set(x - 300, 500, z - 700)
      light.current.target.position.set(x, 0, z); light.current.target.updateMatrixWorld()
    }
    c.pulse += Math.min(delta, 0.1)
    if (c.pulse >= 0.1) { c.pulse = 0; onPulse?.() }
  })
  return <>
    <Sky id={session.id} />
    <hemisphereLight args={[region.atmosphere ? '#e6cab3' : '#9fa8b8', '#42372c', region.atmosphere ? 1.6 : 0.7]} />
    <directionalLight ref={light} position={[-300, 500, -700]} intensity={3.3} color={region.atmosphere ? '#ffe1bc' : '#fff5df'} castShadow shadow-mapSize={[2048, 2048]} shadow-camera-left={-110} shadow-camera-right={110} shadow-camera-top={110} shadow-camera-bottom={-110} shadow-camera-near={1} shadow-camera-far={1600} shadow-bias={-0.0002} shadow-normalBias={0.12} />
    {ground.map((g, i) => <mesh key={i} geometry={g} material={material} receiveShadow />)}
    <primitive object={rocks} />
    {!scenic && <>
      <group ref={lander}><SurveyLander /><mesh ref={plume} position={[0, -3.3, 0]} visible={false}><coneGeometry args={[0.45, 3.2, 20]} /><meshBasicMaterial color="#98cfff" transparent opacity={0.65} depthWrite={false} /></mesh></group>
      <LandingZone />
      {SITES.map((p, i) => <Sample key={i} id={session.id} site={p} taken={session.samples.includes(i)} />)}
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
function Sample({ id, site, taken }) {
  const height = terrainFor(id).height(site.x, site.z)
  return <group position={[site.x, height, site.z]}>
    <mesh position={[0, 0.45, 0]} castShadow scale={[1.2, 0.7, 0.8]}><icosahedronGeometry args={[0.7, 1]} /><meshStandardMaterial color={id === 'europa' ? '#7a6b58' : '#50483e'} roughness={0.9} /></mesh>
    <mesh position={[1.1, 0.65, 0]}><cylinderGeometry args={[0.018, 0.018, 1.3, 6]} /><meshStandardMaterial color="#c5c1b0" /></mesh>
    <mesh position={[1.1, 1.3, 0]}><boxGeometry args={[0.18, 0.18, 0.18]} /><meshBasicMaterial color={taken ? '#576054' : '#edb76c'} /></mesh>
  </group>
}

function Sky({ id }) {
  const region = REGIONS[id]
  const points = useMemo(() => {
    const rand = mulberry32(601), a = new Float32Array(1800 * 3)
    for (let i = 0; i < 1800; i++) {
      const az = rand() * Math.PI * 2, y = rand(), r = Math.sqrt(1 - y * y) * 40000
      a[i * 3] = Math.cos(az) * r; a[i * 3 + 1] = y * 40000; a[i * 3 + 2] = Math.sin(az) * r
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(a, 3)); return g
  }, [])
  useEffect(() => () => points.dispose(), [points])
  const skyMaterial = useMemo(() => new THREE.ShaderMaterial({ side: THREE.BackSide, depthWrite: false, uniforms: { top: { value: new THREE.Color('#403d41') }, bottom: { value: new THREE.Color('#d6ae86') } }, vertexShader: 'varying vec3 vSky; void main(){ vSky=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }', fragmentShader: 'varying vec3 vSky; uniform vec3 top; uniform vec3 bottom; void main(){ float h=clamp(normalize(vSky).y,0.0,1.0); gl_FragColor=vec4(mix(bottom,top,pow(h,0.6)),1.0);\n#include <tonemapping_fragment>\n#include <colorspace_fragment>\n}' }), [])
  useEffect(() => () => skyMaterial.dispose(), [skyMaterial])
  const parentMaterial = useMemo(() => new THREE.ShaderMaterial({ uniforms: { earth: { value: id === 'moon' ? 1 : 0 } }, vertexShader: 'varying vec3 vN; void main(){vN=normal;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}', fragmentShader: `varying vec3 vN; uniform float earth; void main(){
      float stripes=sin(vN.y*58.0+sin(vN.x*12.0)*0.7);
      vec3 j=mix(vec3(0.38,0.23,0.14),vec3(0.85,0.73,0.56),0.5+stripes*0.35);
      float land=sin(vN.x*12.0+sin(vN.y*8.0))*sin(vN.y*17.0+vN.z*5.0);
      vec3 e=mix(vec3(0.04,0.18,0.33),vec3(0.19,0.28,0.16),smoothstep(0.1,0.25,land));
      float cloud=sin(vN.y*43.0+sin(vN.x*21.0)*3.0)*sin(vN.z*37.0);
      e=mix(e,vec3(0.8),smoothstep(0.45,0.72,cloud));
      float light=max(0.025,dot(normalize(vN),normalize(vec3(-0.7,0.5,0.8))));
      gl_FragColor=vec4(mix(j,e,earth)*light,1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }` }), [id])
  useEffect(() => () => parentMaterial.dispose(), [parentMaterial])
  const distance = 35000, radius = region.parent ? distance * region.parentRadius / region.parentDistance : 0
  return <>
    {region.atmosphere ? <mesh material={skyMaterial}><sphereGeometry args={[50000, 32, 16]} /></mesh> : <points geometry={points}><pointsMaterial color="#dad8ce" size={17} sizeAttenuation fog={false} transparent opacity={0.75} /></points>}
    {region.parent && <mesh position={[-4000, id === 'europa' ? 3000 : 1800, -35000]} material={parentMaterial}><sphereGeometry args={[radius, 48, 32]} /></mesh>}
  </>
}
