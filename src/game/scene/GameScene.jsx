import { Suspense, useEffect, useRef } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { EffectComposer, Bloom, Vignette } from '@react-three/postprocessing'
import * as THREE from 'three'
import { STEP, stepGame } from '../core/game.js'
import { STATIONS, SUN_DIR } from '../core/world.js'
import { resolveInput } from '../ui/controls.js'
import { Sky } from './Sky.jsx'
import { Ships } from './Ships.jsx'
import { Props } from './Props.jsx'
import { Fx } from './Fx.jsx'

/**
 * The game's 3D view: the fixed-step loop, the camera, the light, and the
 * post-processing. The loop runs inside the render loop at 60 Hz of game
 * time (up to six catch-up steps a frame, so a stall never becomes a jump),
 * and `onFrame` hands the interface the camera for its markers.
 */
export default function GameScene({ game, controls, quality, placeKey, paused, onFrame }) {
  const hi = quality !== 'low'
  return <Canvas
    dpr={hi ? [1, 1.75] : [0.7, 1]}
    gl={{ antialias: hi, logarithmicDepthBuffer: true, powerPreference: 'high-performance', toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.0 }}
    camera={{ fov: 62, near: 0.5, far: 4.5e6, position: [0, 30, 120] }}
    style={{ position: 'fixed', inset: 0, background: '#000' }}>
    <Loop game={game} controls={controls} paused={paused} onFrame={onFrame} />
    <ambientLight intensity={0.06} color="#9fb4ff" />
    <hemisphereLight intensity={0.12} color="#b8c8ff" groundColor="#2a1a12" />
    <directionalLight name="sun" position={SUN_DIR.clone().multiplyScalar(1e4)} intensity={3.2} color="#fff4e2" />
    <Suspense fallback={null}>
      <Sky game={game} quality={quality} />
    </Suspense>
    <Props game={game} placeKey={placeKey} />
    <Ships game={game} />
    <Fx game={game} />
    {hi && <EffectComposer disableNormalPass multisampling={0}>
      <Bloom mipmapBlur intensity={0.85} luminanceThreshold={0.85} luminanceSmoothing={0.2} radius={0.65} />
      <Vignette offset={0.3} darkness={0.55} />
    </EffectComposer>}
  </Canvas>
}

const _v = new THREE.Vector3(), _t = new THREE.Vector3(), _up = new THREE.Vector3(), _f = new THREE.Vector3(), _q = new THREE.Quaternion()

function Loop({ game, controls, paused, onFrame }) {
  const { camera, gl } = useThree()
  const acc = useRef(0)
  const rig = useRef({ pos: new THREE.Vector3(0, 30, 120), look: new THREE.Vector3(), up: new THREE.Vector3(0, 1, 0), orbit: 0, init: false })
  useEffect(() => { controls.current.canvas = gl.domElement }, [gl, controls])

  useFrame((state, delta) => {
    const g = game.current, c = controls.current
    if (!g) return
    const dt = Math.min(delta, 0.1)
    const flying = g.mode === 'flight'
    resolveInput(c, g.player, camera, flying && !paused)
    if (!paused) {
      acc.current += dt
      let n = 0
      while (acc.current >= STEP && n < 6) { stepGame(g, c); acc.current -= STEP; n++ }
      if (n === 6) acc.current = 0
    }
    placeCamera(g, c, camera, rig.current, dt, state.clock.elapsedTime)
    onFrame?.(g, camera)
  }, -1)
  return null
}

/** Where the camera goes, by what the game is doing. */
function placeCamera(g, c, cam, rig, dt, t) {
  const p = g.player
  const r = p.radius
  const k = 1 - Math.exp(-dt * 6)
  if (g.mode === 'docked' || g.mode === 'surface') {
    // In the bay: behind and beside the ship, looking past it to the open
    // door and the sky, swinging slowly so the lamps move over the hull.
    // The bay's frame is the ship's (it sits level, nose to the door).
    rig.orbit += dt * 0.05
    const az = 0.62 + Math.sin(rig.orbit) * 0.42
    const d = Math.min(r * 3.1, 30)
    _v.set(Math.sin(az) * d, r * 0.5 + 3.5, Math.cos(az) * d).applyQuaternion(p.q).add(p.pos)
    if (rig.mode !== 'docked' && g.mode === 'docked') {
      // Just docked: start at the bay door, looking in, and glide to the berth.
      cam.position.set(-6, 9, -40).applyQuaternion(p.q).add(p.pos)
      rig.glide = 0
    }
    rig.mode = g.mode
    rig.glide = Math.min(1, (rig.glide ?? 1) + dt / 2.6)
    cam.position.lerp(_v, rig.glide < 1 ? 1 - Math.exp(-dt * (1 + 3 * rig.glide)) : k * 0.5)
    _up.set(0, 1, 0).applyQuaternion(p.q)
    cam.up.copy(_up)
    // Look at the ship, a little to its left so the menu does not cover it.
    _f.copy(p.pos).sub(cam.position).normalize().cross(_up).normalize()
    _t.copy(p.pos).addScaledVector(_f, -r * 0.9).addScaledVector(_up, -r * 0.1)
    cam.lookAt(_t)
    rig.init = true
    return
  }
  rig.mode = g.mode
  if (g.mode === 'docking' || g.mode === 'launch') {
    const st = STATIONS[g.anim?.st] ?? STATIONS[g.home]
    _v.copy(st.port.at).addScaledVector(st.port.axis, 260).add(_t.set(120, 70, 0))
    cam.position.lerp(_v, k)
    cam.up.set(0, 1, 0)
    cam.lookAt(p.pos)
    return
  }
  if (g.mode === 'transfer' || g.mode === 'align') {
    // The drive: a slow swing round the ship, so the burn and the flip are seen.
    rig.orbit += dt * 0.12
    _v.set(Math.cos(rig.orbit) * r * 5, r * 1.5, Math.sin(rig.orbit) * r * 5 + r * 3).applyQuaternion(p.q).add(p.pos)
    cam.position.lerp(_v, k)
    cam.lookAt(p.pos)
    return
  }
  if (g.mode === 'dead') {
    cam.position.addScaledVector(_v.copy(cam.position).sub(p.pos).normalize(), dt * 8)
    cam.lookAt(p.pos)
    return
  }
  // Flight: behind the aim (mouse) or behind the ship (stick).
  const dist = r * 3.4 + 10, height = r * 0.85 + 2.5
  if (c.aiming) {
    // The up vector follows the ship's, slowly, so rolling tilts the world.
    _up.set(0, 1, 0).applyQuaternion(p.q)
    rig.up.lerp(_up, 1 - Math.exp(-dt * 2)).normalize()
    _v.copy(p.pos).addScaledVector(c.aimDir, -dist).addScaledVector(rig.up, height)
    cam.position.lerp(_v, 1 - Math.exp(-dt * 14))
    cam.up.copy(rig.up)
    _t.copy(p.pos).addScaledVector(c.aimDir, 600)
    cam.lookAt(_t)
  } else {
    _q.copy(p.q)
    _v.set(0, height, dist).applyQuaternion(_q).add(p.pos)
    cam.position.lerp(_v, 1 - Math.exp(-dt * 10))
    _up.set(0, 1, 0).applyQuaternion(_q)
    rig.up.lerp(_up, 1 - Math.exp(-dt * 6)).normalize()
    cam.up.copy(rig.up)
    _t.set(0, 0, -600).applyQuaternion(_q).add(p.pos)
    cam.lookAt(_t)
  }
  // Boost and hits shake the view a little.
  const shake = (p.boosting ? 0.15 : 0) + Math.max(0, 0.6 - (g.time - p.hitAt)) * 0.8
  if (shake > 0) cam.position.add(_v.set(Math.sin(t * 61) * shake, Math.cos(t * 53) * shake, 0))
}
