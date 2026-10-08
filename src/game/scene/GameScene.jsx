import { Suspense, useEffect, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { EffectComposer, Bloom, Vignette } from '@react-three/postprocessing'
import * as THREE from 'three'
import { STATIONS, SUN_DIR } from '../core/world.js'
import { BARREL } from '../core/flight.js'
import { STEP, stepGame, BERTH, DOCK_T, LAUNCH_T, berthQuat } from '../core/game.js'
import { resolveInput } from '../ui/controls.js'
import { tierOf } from '../core/quality.js'
import { pushFrameTime } from '../../gfx/frameStats.js'
import { Sky } from './Sky.jsx'
import { Ships } from './Ships.jsx'
import { Props, BayEnvironment, Warmup } from './Props.jsx'
import { Fx } from './Fx.jsx'
import { BOARD_DUR, BOARD_SEATED, COCKPIT, boardPose } from './Boarding.jsx'

/**
 * The game's 3D view: the fixed-step loop, the camera, the light, and the
 * post-processing. The loop runs inside the render loop at 60 Hz of game
 * time (up to six catch-up steps a frame, so a stall never becomes a jump),
 * and `onFrame` hands the interface the camera for its markers.
 */
export default function GameScene({ game, controls, quality, placeKey, paused, onFrame }) {
  // What this tier means lives in core/quality.js, beside the guess that
  // chose it and the lessons that can change it; this is only where the
  // numbers reach the canvas.
  const cfg = tierOf(quality)
  const [hidden, setHidden] = useState(() => document.hidden)
  useEffect(() => {
    const change = () => setHidden(document.hidden)
    document.addEventListener('visibilitychange', change)
    return () => document.removeEventListener('visibilitychange', change)
  }, [])
  return <Canvas
    frameloop={hidden || paused ? 'never' : 'always'}
    shadows={cfg.shadows ? 'soft' : false}
    dpr={cfg.dpr}
    gl={{ antialias: cfg.antialias, logarithmicDepthBuffer: true, powerPreference: cfg.power, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.0 }}
    camera={{ fov: 62, near: 0.5, far: 4.5e6, position: [0, 30, 120] }}
    style={{ position: 'fixed', inset: 0, background: '#000' }}>
    <Loop game={game} controls={controls} paused={paused} onFrame={onFrame} maxDpr={cfg.dpr[1]} minDpr={cfg.dpr[0]} />
    <ambientLight intensity={0.06} color="#9fb4ff" />
    <hemisphereLight intensity={0.12} color="#b8c8ff" groundColor="#2a1a12" />
    <directionalLight name="sun" position={SUN_DIR.clone().multiplyScalar(1e4)} intensity={3.2} color="#fff4e2" />
    {/* A cool rim from the far side: the night side of a hull reads as a silhouette edged in blue, not a hole. */}
    <directionalLight position={SUN_DIR.clone().multiplyScalar(-1e4).add(new THREE.Vector3(0, 4e3, 0))} intensity={0.55} color="#7fb0ff" />
    <Suspense fallback={null}>
      <Sky game={game} quality={quality} />
    </Suspense>
    <Props game={game} placeKey={placeKey} quality={quality} />
    <BayEnvironment quality={quality} />
    <Warmup />
    <Ships game={game} />
    <Fx game={game} />
    {cfg.bloom && <EffectComposer disableNormalPass multisampling={0}>
      <Bloom mipmapBlur intensity={0.28} luminanceThreshold={1.5} luminanceSmoothing={0.2} radius={0.5} />
      <Vignette offset={0.3} darkness={0.55} />
    </EffectComposer>}
  </Canvas>
}

const _v = new THREE.Vector3(), _t = new THREE.Vector3(), _up = new THREE.Vector3(), _f = new THREE.Vector3(), _q = new THREE.Quaternion(), _qr = new THREE.Quaternion(), _z = new THREE.Vector3(0, 0, 1), _bay = new THREE.Vector3(), _qbay = new THREE.Quaternion(), _pose = { pos: new THREE.Vector3() }

function Loop({ game, controls, paused, onFrame, maxDpr, minDpr }) {
  const { camera, gl, setDpr } = useThree()
  const acc = useRef(0)
  // Resolution that follows the frame rate: down a step when frames run long,
  // back up when there is room. The pixels are the cost that scales, and a
  // machine that is nowhere near the frame budget gives up three steps at once
  // rather than crawling to the floor one rung every 1.5 s.
  const res = useRef({ ema: 1 / 60, at: 0, dpr: Math.min(maxDpr, window.devicePixelRatio || 1) })
  const rig = useRef({ pos: new THREE.Vector3(0, 30, 120), look: new THREE.Vector3(), up: new THREE.Vector3(0, 1, 0), orbit: 0, init: false })
  useEffect(() => {
    controls.current.canvas = gl.domElement; gl.domElement.tabIndex = -1
    if (import.meta.env.DEV) window.__pzRenderer = gl
    return () => { if (import.meta.env.DEV && window.__pzRenderer === gl) delete window.__pzRenderer }
  }, [gl, controls])
  // A tier change moves the ceiling: take the new one at once instead of
  // climbing down to it a tenth of a pixel per second and a half.
  useEffect(() => {
    const next = Math.min(maxDpr, window.devicePixelRatio || 1)
    res.current.dpr = next
    setDpr(next)
  }, [maxDpr, setDpr])

  useFrame((state, delta) => {
    const g = game.current, c = controls.current
    if (!g) return
    const dt = Math.min(delta, 0.1)
    const r = res.current
    const ms = Math.min(delta, 0.25) * 1000
    r.ema += (Math.min(delta, 0.25) - r.ema) * 0.05
    // The shared sampler (gfx/frameStats.js), the same ring the diagnostics
    // report and the quality checkpoint read: one measurement, one place. A
    // frozen tab is no frame at all, so nothing is recorded for one.
    if (!stoppedNow()) pushFrameTime(ms)
    if (state.clock.elapsedTime - r.at > 1.5) {
      r.at = state.clock.elapsedTime
      const top = Math.min(maxDpr, window.devicePixelRatio || 1)
      const step = r.ema > 1 / 25 ? 0.3 : r.ema > 1 / 45 ? 0.15 : 0
      const next = step ? Math.max(minDpr, r.dpr - step) : r.ema < 1 / 57 ? Math.min(top, r.dpr + 0.1) : r.dpr
      if (Math.abs(next - r.dpr) > 0.01) { r.dpr = next; setDpr(next) }
    }
    const flying = g.mode === 'flight'
    const stopped = paused || document.hidden
    resolveInput(c, g.player, camera, flying && !stopped)
    if (!stopped && !g.cine) {
      acc.current += dt
      let n = 0
      while (acc.current >= STEP && n < 6) { stepGame(g, c); acc.current -= STEP; n++ }
      if (n === 6) acc.current = 0
    } else acc.current = 0
    if (!stopped) placeCamera(g, c, camera, rig.current, dt, state.clock.elapsedTime)
    onFrame?.(g, camera)
  }, -1)
  return null
}

/** A hidden tab is not drawing frames, and a 250 ms wake-up is not a slow one. */
const stoppedNow = () => typeof document !== 'undefined' && document.hidden

/** Where the camera goes, by what the game is doing. */
function placeCamera(g, c, cam, rig, dt, t) {
  const p = g.player
  const r = p.radius
  const k = 1 - Math.exp(-dt * 6)
  if (g.mode === 'docked' && g.cine?.kind === 'board') {
    // Boarding: outside the skywalk with the station beyond the glass; cut
    // inside as the pilot comes into the bay; watch the bridge reach out and
    // the crossing; then hand back to the berth shot.
    g.cine.t += dt
    const c = g.cine
    const st = STATIONS[g.docked]
    _bay.copy(st.port.at).addScaledVector(st.port.axis, BERTH)
    berthQuat(g, st, _qbay)
    boardPose(g.ship.hull, Math.min(c.t, BOARD_SEATED - 0.01), _pose)
    const P = _pose.pos
    const [cx, cy, cz] = COCKPIT[g.ship.hull] ?? COCKPIT.kestrel
    let snap = false
    if (_pose.phase === 'outside') { _v.set(P.x - 3.5, P.y + 2.4, P.z - 9.5); _t.set(P.x - 1.5, P.y + 1.5, P.z) }
    else if (_pose.phase === 'inside') { _v.set(P.x + 5.5, P.y + 2.6, P.z + 8.5); _t.set(P.x - 2, P.y + 1.3, P.z) }
    else if (_pose.phase === 'climb') { _v.set(cx + 5, cy + 2.5, cz + 3.5); _t.set(cx + 0.5, cy + 0.5, cz) }
    else if (c.t < BOARD_SEATED) { _v.set(cx + 9, cy + 4, cz + 7); _t.set((P.x + cx) / 2, P.y + 1, (P.z + cz) / 2) }
    else { _v.set(9, 6, 9); _t.set(0, 0, 0) }
    if (rig.boardPhase !== _pose.phase) { snap = rig.boardPhase === undefined || _pose.phase === 'inside' || _pose.phase === 'outside'; rig.boardPhase = _pose.phase }
    _v.applyQuaternion(_qbay).add(_bay)
    cam.position.lerp(_v, snap ? 1 : 1 - Math.exp(-dt * (c.t < BOARD_SEATED ? 2.2 : 1.1)))
    cam.up.set(0, 1, 0).applyQuaternion(_qbay)
    cam.lookAt(_t.applyQuaternion(_qbay).add(_bay))
    if (c.t >= BOARD_DUR) { g.cine = null; rig.boardPhase = undefined; rig.glide = 0; rig.mode = 'docked' }
    return
  }
  if (g.mode === 'docked' || g.mode === 'surface') {
    // In the bay: behind and beside the ship, looking past it to the open
    // door and the sky, swinging slowly so the lamps move over the hull.
    // The bay's frame is the ship's (it sits level, nose to the door).
    rig.orbit += dt * 0.05
    const az = 0.62 + Math.sin(rig.orbit) * 0.42
    const d = Math.min(r * 3.1, 30)
    _v.set(Math.sin(az) * d, r * 0.5 + 3.5, Math.cos(az) * d).applyQuaternion(p.q).add(p.pos)
    if (rig.mode !== 'docked' && rig.mode !== 'docking' && g.mode === 'docked') {
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
    // Shots in the bay's frame (art/game-hangar): -z is out of the door.
    const st = STATIONS[g.anim?.st] ?? STATIONS[g.home]
    _bay.copy(st.port.at).addScaledVector(st.port.axis, BERTH)
    berthQuat(g, st, _qbay)
    const t = g.anim?.t ?? 0
    const at = (x, y, z) => _v.set(x, y, z).applyQuaternion(_qbay).add(_bay)
    cam.up.set(0, 1, 0).applyQuaternion(_qbay)
    if (g.mode === 'docking') {
      if (t < DOCK_T.approach) {
        // Outside: off the door's shoulder, watching the ship come in.
        cam.position.lerp(at(80, 30, -240), rig.shot === 'dock-out' ? k : 1)
        rig.shot = 'dock-out'
      } else {
        // The cut: inside, high in the back corner, the door ahead.
        cam.position.lerp(at(-22, 10, 30), rig.shot === 'dock-in' ? k * 0.3 : 1)
        rig.shot = 'dock-in'
      }
      cam.lookAt(p.pos)
    } else {
      if (t < LAUNCH_T.lift) {
        cam.position.lerp(at(16, 5, 26), rig.shot === 'lift' ? k * 0.4 : 1)
        rig.shot = 'lift'
        cam.lookAt(p.pos)
      } else {
        // The chase out of the door: behind and above, the camera lagging as she gathers speed.
        _t.set(5, 7, 32).applyQuaternion(_qbay).add(p.pos)
        cam.position.lerp(_t, rig.shot === 'out' ? 1 - Math.exp(-dt * 3) : 1 - Math.exp(-dt * 1.5))
        rig.shot = 'out'
        cam.lookAt(_t.set(0, 0, -80).applyQuaternion(_qbay).add(p.pos))
      }
    }
    return
  }
  rig.shot = null
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
    // Through a barrel roll the camera holds the horizon and the ship spins in it.
    if (!p.barrel) rig.up.lerp(_up, 1 - Math.exp(-dt * 2)).normalize()
    _v.copy(p.pos).addScaledVector(c.aimDir, -dist).addScaledVector(rig.up, height)
    cam.position.lerp(_v, 1 - Math.exp(-dt * 14))
    cam.up.copy(rig.up)
    _t.copy(p.pos).addScaledVector(c.aimDir, 600)
    cam.lookAt(_t)
  } else {
    _q.copy(p.q)
    // Take the barrel roll back out, so the camera stays put while the ship turns over.
    if (p.barrel) { const s = Math.min(1, p.barrel.t / BARREL.dur); _q.multiply(_qr.setFromAxisAngle(_z, -p.barrel.dir * Math.PI * 2 * s * s * (3 - 2 * s))) }
    _v.set(0, height, dist).applyQuaternion(_q).add(p.pos)
    cam.position.lerp(_v, 1 - Math.exp(-dt * 10))
    _up.set(0, 1, 0).applyQuaternion(_q)
    if (!p.barrel) rig.up.lerp(_up, 1 - Math.exp(-dt * 6)).normalize()
    cam.up.copy(rig.up)
    _t.set(0, 0, -600).applyQuaternion(_q).add(p.pos)
    cam.lookAt(_t)
  }
  // Boost and hits shake the view a little.
  const shake = (p.boosting ? 0.15 : 0) + Math.max(0, 0.6 - (g.time - p.hitAt)) * 0.8
  if (shake > 0) cam.position.add(_v.set(Math.sin(t * 61) * shake, Math.cos(t * 53) * shake, 0))
}
