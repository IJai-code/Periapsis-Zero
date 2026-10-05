import { useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'

/**
 * Effects: bolts, hits, explosions, and the dust that tells you how fast
 * you are going. All pooled; the frame writes into existing buffers.
 */
const TEAM_BOLT = { player: new THREE.Color('#ffc36b'), ally: new THREE.Color('#7fe2ff'), compact: new THREE.Color('#7fe2ff'), hollow: new THREE.Color('#ff3b2c'), civil: new THREE.Color('#ffffff'), drone: new THREE.Color('#ffffff') }
const _o = new THREE.Object3D(), _v = new THREE.Vector3(), _c = new THREE.Color()

export function Fx({ game }) {
  return <>
    <Bolts game={game} />
    <Blasts game={game} />
    <Dust game={game} />
  </>
}

function Bolts({ game }) {
  const mesh = useMemo(() => {
    const geo = new THREE.CylinderGeometry(0.35, 0.35, 1, 6, 1)
    geo.rotateX(Math.PI / 2)
    const m = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ toneMapped: false }), 512)
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    m.frustumCulled = false
    for (let i = 0; i < 512; i++) m.setColorAt(i, TEAM_BOLT.player)
    return m
  }, [])
  useFrame(() => {
    const g = game.current
    if (!g) return
    const b = g.bolts
    let n = 0
    for (let i = 0; i < b.n; i++) {
      if (b.life[i] <= 0) continue
      _v.set(b.vx[i], b.vy[i], b.vz[i])
      const sp = _v.length()
      _o.position.set(b.x[i], b.y[i], b.z[i])
      _o.lookAt(_v.add(_o.position))
      _o.scale.set(1, 1, Math.min(40, sp * 0.012))
      _o.updateMatrix()
      mesh.setMatrixAt(n, _o.matrix)
      _c.copy(TEAM_BOLT[b.team[i]] ?? TEAM_BOLT.civil).multiplyScalar(4)
      mesh.setColorAt(n, _c)
      n++
    }
    mesh.count = n
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  })
  return <primitive object={mesh} />
}

/**
 * Explosions and hits, read from the game's events. A blast is a flash, a
 * fireball that grows and cools, and a shell of debris sparks.
 */
const POOL = 24, SPARKS = 40
function Blasts({ game }) {
  const seen = useRef(0)
  const pool = useMemo(() => {
    const flashTex = radial()
    return Array.from({ length: POOL }, () => {
      const group = new THREE.Group()
      const flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: flashTex, color: '#ffd9a0', blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false }))
      const ball = new THREE.Sprite(new THREE.SpriteMaterial({ map: flashTex, color: '#ff6b2c', blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false }))
      const geo = new THREE.BufferGeometry()
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(SPARKS * 3), 3))
      const sparks = new THREE.Points(geo, new THREE.PointsMaterial({ color: '#ffcf8a', size: 2.2, sizeAttenuation: true, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false }))
      sparks.frustumCulled = false
      group.add(flash, ball, sparks)
      group.visible = false
      const dirs = new Float32Array(SPARKS * 3)
      return { group, flash, ball, sparks, dirs, t: 99, size: 1, hit: false }
    })
  }, [])
  const next = useRef(0)
  useFrame((_, dt) => {
    const g = game.current
    if (!g) return
    // New events since last frame (a new game restarts the count).
    if (g.evN < seen.current) seen.current = 0
    for (const ev of g.events) {
      if (ev.n <= seen.current) continue
      if (ev.type === 'explode') fireBlast(pool[next.current++ % POOL], ev.x, ev.y, ev.z, ev.size, false)
      if (ev.type === 'hit') { const e = g.byId(ev.ship); if (e) fireBlast(pool[next.current++ % POOL], e.pos.x, e.pos.y, e.pos.z, e.radius * 0.35, true) }
    }
    seen.current = g.evN
    for (const b of pool) {
      if (b.t > 3) { b.group.visible = false; continue }
      b.t += dt
      const life = b.hit ? 0.35 : 2.6
      const f = b.t / life
      b.group.visible = f < 1
      if (f >= 1) continue
      b.flash.scale.setScalar(b.size * (b.hit ? 3 : 7) * (1 - f) ** 3)
      b.flash.material.opacity = (1 - f) ** 2
      b.ball.scale.setScalar(b.size * (b.hit ? 1.5 : 2.5 + 9 * Math.sqrt(f)))
      b.ball.material.opacity = (b.hit ? 0.6 : 1) * (1 - f) ** 1.5
      b.ball.material.color.setHSL(0.06 - 0.04 * f, 1, 0.55 - 0.3 * f)
      const p = b.sparks.geometry.attributes.position
      for (let i = 0; i < SPARKS; i++) p.setXYZ(i, b.dirs[i * 3] * b.t, b.dirs[i * 3 + 1] * b.t, b.dirs[i * 3 + 2] * b.t)
      p.needsUpdate = true
      b.sparks.material.opacity = 1 - f
    }
  })
  return <group>{pool.map((b, i) => <primitive key={i} object={b.group} />)}</group>
}
function fireBlast(b, x, y, z, size, hit) {
  b.group.position.set(x, y, z)
  b.group.visible = true
  b.t = 0; b.size = size; b.hit = hit
  const speed = hit ? 25 : 40 + size * 6
  for (let i = 0; i < SPARKS; i++) {
    _v.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize().multiplyScalar(speed * (0.3 + Math.random()))
    b.dirs[i * 3] = _v.x; b.dirs[i * 3 + 1] = _v.y; b.dirs[i * 3 + 2] = _v.z
  }
  b.sparks.visible = true
}
function radial() {
  const c = document.createElement('canvas')
  c.width = c.height = 128
  const x = c.getContext('2d')
  const r = x.createRadialGradient(64, 64, 0, 64, 64, 64)
  r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.25, 'rgba(255,255,255,0.6)'); r.addColorStop(1, 'rgba(255,255,255,0)')
  x.fillStyle = r; x.fillRect(0, 0, 128, 128)
  return new THREE.CanvasTexture(c)
}

/**
 * Dust: faint motes in a box round the camera, wrapped so they never run
 * out. Space is not dusty enough to see; this is the one convention the
 * game keeps for the eye's sake, because without a reference nearby, 200 m/s
 * looks like standing still. In the drive, the motes stretch into streaks.
 */
const DUST = 260, BOX = 420
function Dust({ game }) {
  const { camera } = useThree()
  const pts = useMemo(() => {
    const pos = new Float32Array(DUST * 6)
    const seed = new Float32Array(DUST * 3)
    for (let i = 0; i < DUST * 3; i++) seed[i] = (Math.random() - 0.5) * BOX
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    const line = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: '#b9c6d6', transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false }))
    line.frustumCulled = false
    return { line, seed, pos }
  }, [])
  const origin = useRef(new THREE.Vector3())
  useFrame(() => {
    const g = game.current
    if (!g) return
    const p = g.player
    const transfer = g.mode === 'transfer'
    // The dust is fixed in the local frame, so moving through it is moving.
    origin.current.copy(camera.position)
    const v = p.vel, sp = v.length()
    const stretch = transfer ? 0.08 : Math.min(0.25, sp / 900) * 0.25
    const a = pts.pos
    for (let i = 0; i < DUST; i++) {
      const sx = pts.seed[i * 3], sy = pts.seed[i * 3 + 1], sz = pts.seed[i * 3 + 2]
      const x = origin.current.x + wrap(sx - origin.current.x), y = origin.current.y + wrap(sy - origin.current.y), z = origin.current.z + wrap(sz - origin.current.z)
      const k = transfer ? 120 : stretch
      a[i * 6] = x; a[i * 6 + 1] = y; a[i * 6 + 2] = z
      a[i * 6 + 3] = x - v.x * k * (transfer ? 0.0002 : 1); a[i * 6 + 4] = y - v.y * k * (transfer ? 0.0002 : 1); a[i * 6 + 5] = z - v.z * k * (transfer ? 0.0002 : 1)
    }
    pts.line.geometry.attributes.position.needsUpdate = true
    pts.line.material.opacity = transfer ? 0.45 : Math.min(0.22, 0.04 + sp / 1400)
  })
  return <primitive object={pts.line} />
}
const wrap = (d) => ((((d + BOX / 2) % BOX) + BOX) % BOX) - BOX / 2
