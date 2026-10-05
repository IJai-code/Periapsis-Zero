import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'

/**
 * Ships, stations and props.
 *
 * The real models are built in Blender (art/game-*) and shipped as GLB. Until
 * one has loaded, or if it fails to, each kind has a procedural stand-in of
 * the same size and silhouette, so the game never waits on art and never
 * shows a hole. A model's engine nozzles are named empties (`nozzle_0`...)
 * in the GLB; the stand-ins list theirs here.
 *
 * Conventions: metres, forward -Z, up +Y.
 */
const BASE = import.meta.env.BASE_URL
const cache = new Map()
const listeners = new Set()
export const onModelsChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn) }

const mat = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.35, ...o })
const M = {
  bone: mat('#d9d2c3', { roughness: 0.6, metalness: 0.2 }), dark: mat('#2b2a33', { roughness: 0.5, metalness: 0.5 }), steel: mat('#8b8e94', { metalness: 0.8, roughness: 0.35 }),
  ember: mat('#ff6b2c', { roughness: 0.5, metalness: 0.2 }), ion: mat('#2fd3ff', { emissive: '#2fd3ff', emissiveIntensity: 1.2, toneMapped: false }),
  glass: mat('#0d1a24', { roughness: 0.08, metalness: 0.9 }), red: mat('#7a1e1e', { roughness: 0.45, metalness: 0.45 }), white: mat('#eef0f2', { roughness: 0.45, metalness: 0.25 }),
  rock: mat('#6d6862', { roughness: 0.95, metalness: 0 }), lit: mat('#ffd7a0', { emissive: '#ffb060', emissiveIntensity: 2.5, toneMapped: false }),
  gold: mat('#c9973c', { metalness: 0.9, roughness: 0.35 }), panel: mat('#1d2a4a', { roughness: 0.3, metalness: 0.6 }),
}

function box(w, h, d, m, x = 0, y = 0, z = 0) { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(x, y, z); return o }
function cyl(r1, r2, len, m, seg = 16, axis = 'z', x = 0, y = 0, z = 0) {
  const o = new THREE.Mesh(new THREE.CylinderGeometry(r1, r2, len, seg), m)
  if (axis === 'z') o.rotation.x = Math.PI / 2
  if (axis === 'x') o.rotation.z = Math.PI / 2
  o.position.set(x, y, z)
  return o
}

/* ------------------------------------------------------------------ *
 * Stand-ins
 * ------------------------------------------------------------------ */
const STAND_INS = {
  kestrel() {
    const g = new THREE.Group()
    g.add(cyl(1.6, 2.6, 13, M.bone, 8, 'z', 0, 0, -1))
    g.add(cyl(0.2, 1.6, 4, M.bone, 8, 'z', 0, 0, -9.5))
    g.add(box(2.2, 1.0, 3.2, M.glass, 0, 1.3, -5.5))
    g.add(box(15, 0.45, 4.5, M.dark, 0, -0.3, 2))
    for (const s of [-1, 1]) { g.add(cyl(1.1, 1.3, 7, M.steel, 12, 'z', s * 4.2, -0.2, 3)); g.add(box(0.3, 2.4, 2.5, M.ember, s * 7.3, 0.6, 3.5)) }
    return { object: g, nozzles: [[-4.2, -0.2, 6.6], [4.2, -0.2, 6.6]] }
  },
  mule() {
    const g = new THREE.Group()
    g.add(box(6, 5, 30, M.dark, 0, 0, 0))
    g.add(box(5, 3.5, 6, M.bone, 0, 1.5, -16))
    g.add(box(3, 1.2, 2.5, M.glass, 0, 3.4, -17))
    for (let i = 0; i < 4; i++) for (const s of [-1, 1]) g.add(box(4.2, 4.2, 6, i % 2 ? M.ember : M.white, s * 5.2, 0, -8 + i * 6.5))
    for (const s of [-1, 1]) g.add(cyl(1.8, 2.2, 6, M.steel, 12, 'z', s * 2.4, 0, 16))
    return { object: g, nozzles: [[-2.4, 0, 19.2], [2.4, 0, 19.2]] }
  },
  lance() {
    const g = new THREE.Group()
    g.add(cyl(0.3, 1.9, 16, M.white, 6, 'z', 0, 0, -3))
    g.add(box(1.6, 0.9, 3, M.glass, 0, 1.0, -4))
    const wing = new THREE.Shape(); wing.moveTo(0, -6); wing.lineTo(9, 5); wing.lineTo(9, 7); wing.lineTo(0, 6)
    for (const s of [-1, 1]) { const w = new THREE.Mesh(new THREE.ExtrudeGeometry(wing, { depth: 0.35, bevelEnabled: false }), M.dark); w.rotation.x = -Math.PI / 2; w.scale.x = s; w.position.y = -0.2; g.add(w) }
    for (const s of [-1, 1]) g.add(cyl(0.9, 1.1, 5, M.steel, 12, 'z', s * 1.6, 0, 5))
    return { object: g, nozzles: [[-1.6, 0, 7.6], [1.6, 0, 7.6]] }
  },
  raider() {
    const g = new THREE.Group()
    const body = new THREE.Mesh(new THREE.OctahedronGeometry(4, 0), M.red); body.scale.set(1, 0.5, 2); g.add(body)
    for (const s of [-1, 1]) { const f = box(7, 0.3, 2.5, M.dark, s * 4.5, 0, 1.5); f.rotation.z = s * 0.35; g.add(f) }
    g.add(box(1.4, 0.8, 2, M.lit, 0, 1.2, -2.5))
    return { object: g, nozzles: [[0, 0, 7.5]] }
  },
  warden() {
    const g = STAND_INS.raider().object
    g.scale.setScalar(2.1)
    return { object: g, nozzles: [[0, 0, 15]] }
  },
  cutter() {
    const g = new THREE.Group()
    g.add(cyl(1.8, 2.8, 18, M.white, 8, 'z'))
    g.add(cyl(0.3, 1.8, 5, M.white, 8, 'z', 0, 0, -11.5))
    g.add(box(1.6, 0.9, 3, M.glass, 0, 1.6, -6))
    g.add(box(12, 0.4, 5, M.white, 0, -0.5, 3))
    for (const s of [-1, 1]) { g.add(box(0.5, 0.5, 6, M.ion, s * 6, -0.2, 3)); g.add(cyl(1.0, 1.3, 5, M.steel, 12, 'z', s * 2.5, 0, 9)) }
    return { object: g, nozzles: [[-2.5, 0, 11.6], [2.5, 0, 11.6]] }
  },
  wing() { return STAND_INS.cutter() },
  freighter() {
    const g = new THREE.Group()
    g.add(box(5, 5, 90, M.steel, 0, 0, 0))
    g.add(box(14, 10, 12, M.bone, 0, 2, -48))
    for (let i = 0; i < 6; i++) for (const s of [-1, 1]) for (const t of [-1, 1]) g.add(box(7, 7, 12, [M.ember, M.white, M.dark, M.panel][(i + (s > 0) + (t > 0) * 2) % 4], s * 6.5, t * 6.5, -30 + i * 13))
    for (const s of [-1, 1]) g.add(cyl(3, 4, 10, M.dark, 12, 'z', s * 4, 0, 48))
    return { object: g, nozzles: [[-4, 0, 53], [4, 0, 53]] }
  },
  hearth() {
    const g = new THREE.Group()
    const ring = new THREE.Mesh(new THREE.TorusGeometry(380, 42, 24, 96), M.bone); g.add(ring)
    const windows = new THREE.Mesh(new THREE.TorusGeometry(380, 43, 4, 96, Math.PI * 2), M.lit); windows.scale.set(1, 1, 0.06); g.add(windows)
    g.add(cyl(110, 110, 300, M.dark, 24, 'z'))
    g.add(cyl(130, 60, 120, M.steel, 24, 'z', 0, 0, -200))
    for (let i = 0; i < 4; i++) { const s = box(24, 260, 24, M.steel); s.rotation.z = i * Math.PI / 4 * 2; s.position.set(Math.sin(i * Math.PI / 2) * -230, Math.cos(i * Math.PI / 2) * 230, 0); g.add(s) }
    // The docking bay: a lit square mouth on the +z face.
    g.add(box(110, 70, 30, M.dark, 0, 0, 160))
    g.add(box(90, 4, 4, M.lit, 0, 37, 176)); g.add(box(90, 4, 4, M.lit, 0, -37, 176))
    for (const s of [-1, 1]) g.add(box(4, 74, 4, M.lit, s * 47, 0, 176))
    for (let i = 0; i < 2; i++) { const p = box(500, 2, 120, M.panel, 0, 0, -330 - i * 150); g.add(p) }
    return { object: g, nozzles: [] }
  },
  harbor() {
    const g = new THREE.Group()
    g.add(box(30, 30, 700, M.steel))
    for (let i = 0; i < 5; i++) g.add(cyl(22, 22, 70, i % 2 ? M.white : M.bone, 16, 'x', 0, 0, -220 + i * 110))
    for (const s of [-1, 1]) for (let i = 0; i < 3; i++) g.add(box(220, 3, 60, M.gold, s * 160, 0, -200 + i * 200))
    g.add(box(90, 60, 40, M.dark, 0, 0, 370))
    g.add(box(70, 4, 4, M.lit, 0, 31, 392)); g.add(box(70, 4, 4, M.lit, 0, -31, 392))
    return { object: g, nozzles: [] }
  },
  gateway() {
    const g = new THREE.Group()
    g.add(cyl(14, 14, 120, M.white, 16, 'z'))
    g.add(cyl(18, 18, 50, M.bone, 16, 'x', 0, 0, -30))
    for (const s of [-1, 1]) g.add(box(160, 2, 36, M.panel, s * 110, 0, -60))
    g.add(box(40, 30, 30, M.dark, 0, 0, 260 - 30))
    g.add(box(36, 3, 3, M.lit, 0, 16, 246))
    return { object: g, nozzles: [] }
  },
  shackle() {
    const g = new THREE.Group()
    const rock = new THREE.Mesh(roughRock(1, 77, 4), M.rock); rock.scale.setScalar(470); g.add(rock)
    for (let i = 0; i < 9; i++) { const a = i * 0.7; g.add(box(40, 18, 40, i % 3 ? M.dark : M.red, Math.cos(a) * 430, Math.sin(a * 1.7) * 200, Math.sin(a) * 430)) }
    g.add(box(80, 60, 160, M.dark, 0, 0, 520))
    g.add(box(70, 4, 4, M.lit, 0, 31, 600)); g.add(box(70, 4, 4, M.lit, 0, -31, 600))
    return { object: g, nozzles: [] }
  },
  canister() {
    const g = new THREE.Group()
    g.add(cyl(1.6, 1.6, 4.5, M.ember, 12, 'y'))
    g.add(cyl(1.7, 1.7, 0.6, M.ion, 12, 'y', 0, 1.6))
    return { object: g, nozzles: [] }
  },
  hangar() {
    // The bay, inside out: deck, walls and roof facing in, the door open to -Z.
    const g = new THREE.Group()
    const shell = new THREE.MeshStandardMaterial({ color: '#4a4d54', roughness: 0.7, metalness: 0.3, side: THREE.BackSide })
    // The -Z face is the sixth material slot: an invisible one is the open door.
    const door = new THREE.MeshBasicMaterial({ visible: false })
    const room = new THREE.Mesh(new THREE.BoxGeometry(72, 32, 91), [shell, shell, shell, shell, shell, door]); room.position.set(0, 10, 0.5)
    g.add(room)
    g.add(box(72, 0.4, 91, M.dark, 0, -6.2, 0.5))
    for (const s of [-1, 1]) g.add(box(0.3, 0.4, 85, M.ion, s * 35.4, 12, 0.5))
    return { object: g, nozzles: [] }
  },
}

/** A lumpy asteroid: an icosphere with layered noise, flattened in places. */
export function roughRock(radius, seed, detail = 3) {
  const geo = new THREE.IcosahedronGeometry(radius, detail)
  const p = geo.attributes.position, v = new THREE.Vector3()
  const h = (x, y, z) => { const s = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719 + seed) * 43758.5453; return s - Math.floor(s) }
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i).normalize()
    let k = 1 + 0.22 * Math.sin(v.x * 3 + seed) * Math.cos(v.y * 2.5 - seed) + 0.12 * Math.sin(v.z * 5.3 + seed * 2) + 0.05 * (h(v.x, v.y, v.z) - 0.5)
    if (v.dot(new THREE.Vector3(0.6, 0.5, 0.62)) > 0.55) k *= 0.88
    v.multiplyScalar(radius * k)
    p.setXYZ(i, v.x, v.y, v.z)
  }
  geo.computeVertexNormals()
  return geo
}

/* ------------------------------------------------------------------ *
 * Authored models
 * ------------------------------------------------------------------ */
let loader = null
function gltf() {
  if (loader) return loader
  const draco = new DRACOLoader()
  draco.setDecoderPath(`${BASE}draco/`)
  loader = new GLTFLoader()
  loader.setDRACOLoader(draco)
  return loader
}
/** Which kinds have a Blender model, and its file (art/game-*, baked and exported by npm run art:build). */
export const AUTHORED = Object.fromEntries(['kestrel', 'mule', 'lance', 'raider', 'warden', 'cutter', 'freighter', 'canister', 'hangar', 'hearth', 'harbor', 'gateway', 'shackle'].map((k) => [k, `authored/game-${k}.glb`]))
AUTHORED.wing = AUTHORED.cutter
export function registerAuthored(map) { Object.assign(AUTHORED, map) }

export function preload(kinds) {
  for (const k of kinds) {
    if (!AUTHORED[k] || cache.has(k)) continue
    cache.set(k, null)
    gltf().load(`${BASE}${AUTHORED[k]}`, (res) => {
      const root = res.scene
      const nozzles = []
      root.traverse((o) => {
        if (/^nozzle_\d+/.test(o.name)) nozzles.push(o.getWorldPosition(new THREE.Vector3()).toArray())
        if (!o.isMesh) return
        o.castShadow = false; o.receiveShadow = false
        // Canopies are glass you can see the pilot through.
        for (const m of [o.material].flat()) if (m?.name === 'canopy') { m.transparent = true; m.opacity = 0.34; m.depthWrite = false; m.roughness = 0.04; m.metalness = 0.5 }
      })
      cache.set(k, { object: root, nozzles })
      listeners.forEach((fn) => fn(k))
    }, undefined, () => { cache.set(k, false) })
  }
}

/**
 * Dress the pilot in a model in a suit's colours: the suit, its stripe and
 * the visor are their own materials in the GLB (art/lib/craft.py); this
 * instance gets its own copies, so other ships of the kind are untouched.
 */
export function paintPilot(object, suit) {
  const want = { pilotsuit: suit.suit, pilotstripe: suit.stripe, pilotvisor: suit.visor }
  object.traverse((o) => {
    if (!o.isMesh) return
    const list = [o.material].flat()
    const next = list.map((m) => {
      if (!m || !(m.name in want)) return m
      const own = m.userData.own ? m : Object.assign(m.clone(), { userData: { own: true } })
      own.color.set(want[m.name])
      if (m.name === 'pilotvisor') { own.emissive?.set(want[m.name]); own.emissiveIntensity = 0.35 }
      return own
    })
    o.material = Array.isArray(o.material) ? next : next[0]
  })
}

/** A fresh instance of a kind: the authored model if loaded, else the stand-in. */
export function instance(kind) {
  const a = cache.get(kind)
  if (a) return { object: a.object.clone(true), nozzles: a.nozzles, authored: true }
  const make = STAND_INS[kind] ?? STAND_INS.raider
  if (!cache.has(`stand:${kind}`)) cache.set(`stand:${kind}`, make())
  const s = cache.get(`stand:${kind}`)
  return { object: s.object.clone(true), nozzles: s.nozzles, authored: false }
}
export const hasAuthored = (kind) => Boolean(cache.get(kind))
export { M as MATERIALS }
