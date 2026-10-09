import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'
import { detailModel } from './detail.js'

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
const SHIPS = new Set(['kestrel', 'mule', 'lance', 'raider', 'warden', 'cutter', 'freighter'])
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
  arbor() {
    // A rotating garden habitat: the axis stays fixed for docking while the
    // ring and its orchard modules turn together to make artificial gravity.
    const g = new THREE.Group()
    g.add(cyl(24, 24, 760, M.steel, 20, 'z'))
    g.add(cyl(40, 40, 62, M.dark, 24, 'z'))
    g.add(cyl(35, 35, 10, M.ion, 24, 'z', 0, 0, 35))
    g.add(cyl(35, 35, 10, M.ion, 24, 'z', 0, 0, -35))
    const habitat = new THREE.Group(); habitat.name = 'habitat-ring'; g.add(habitat)
    habitat.add(new THREE.Mesh(new THREE.TorusGeometry(280, 18, 12, 96), M.bone))
    habitat.add(new THREE.Mesh(new THREE.TorusGeometry(253, 3, 8, 96), M.ion))
    for (let i = 0; i < 8; i++) {
      const a = i * Math.PI / 4, x = Math.cos(a), y = Math.sin(a)
      const spoke = box(232, 12, 14, M.steel, x * 145, y * 145, 0); spoke.rotation.z = a; habitat.add(spoke)
      const pod = box(92, 48, 68, M.dark, x * 280, y * 280, 0); pod.rotation.z = a + Math.PI / 2; habitat.add(pod)
      const garden = box(58, 3, 38, M.ion, x * 280, y * 280, 36); garden.rotation.z = a + Math.PI / 2; habitat.add(garden)
      const window = box(40, 3, 5, M.lit, x * 280, y * 280, 39); window.rotation.z = a + Math.PI / 2; habitat.add(window)
    }
    // Axial docking collar and a pair of quiet beacon rails.
    g.add(cyl(48, 34, 86, M.steel, 20, 'z', 0, 0, 390))
    g.add(box(4, 4, 42, M.ion, -58, 0, 365)); g.add(box(4, 4, 42, M.ion, 58, 0, 365))
    return { object: g, nozzles: [] }
  },
  vesper() {
    // An empty deep-fleet drydock: long open cradles, gantry rails and a
    // half-built keel where the finished ships used to leave from.
    const g = new THREE.Group()
    for (const x of [-360, 360]) {
      g.add(box(28, 24, 1040, M.steel, x, 36, -90))
      g.add(box(22, 190, 24, M.dark, x, 118, -90))
      g.add(box(46, 5, 900, M.ion, x, 232, -90))
      for (const z of [-510, -250, 10, 270, 430]) {
        g.add(box(30, 150, 30, M.dark, x, 145, z))
        g.add(box(58, 18, 38, M.ember, x, 232, z))
      }
    }
    for (const z of [-500, -180, 140, 430]) g.add(box(760, 22, 30, M.steel, 0, 35, z))
    // The unfinished hull's exposed rib frame makes the yard read as industry,
    // not just another rockside port with its paint worn off.
    g.add(cyl(34, 54, 520, M.dark, 10, 'z', 0, 54, -260))
    for (let i = 0; i < 7; i++) {
      const z = -480 + i * 72
      const rib = new THREE.Mesh(new THREE.TorusGeometry(64 - i * 2, 5, 6, 16), i % 2 ? M.steel : M.ember)
      rib.position.set(0, 54, z); rib.scale.set(1, 0.72, 1); g.add(rib)
    }
    // Gantry bridge and the long, lit approach spine.
    g.add(box(900, 22, 26, M.steel, 0, 270, -90))
    g.add(box(24, 300, 24, M.dark, -420, 120, -90)); g.add(box(24, 300, 24, M.dark, 420, 120, -90))
    g.add(cyl(30, 30, 260, M.dark, 16, 'z', 0, 0, 510))
    g.add(cyl(44, 44, 18, M.ion, 20, 'z', 0, 0, 600))
    g.add(box(70, 4, 5, M.lit, 0, 34, 625)); g.add(box(70, 4, 5, M.lit, 0, -34, 625))
    return { object: g, nozzles: [] }
  },
  citadel() {
    // Compact command: a faceted armored core, shield/sensor hoops and a
    // narrow, unmistakably blue arrival beacon above its defended collar.
    const g = new THREE.Group()
    const core = new THREE.Mesh(new THREE.OctahedronGeometry(205, 1), M.dark)
    core.scale.set(1.05, 0.82, 1.28); core.position.set(0, 0, -30); g.add(core)
    g.add(new THREE.Mesh(new THREE.TorusGeometry(260, 8, 8, 72), M.steel))
    const sensor = new THREE.Mesh(new THREE.TorusGeometry(300, 3, 6, 72), M.ion); sensor.rotation.x = Math.PI / 2.8; g.add(sensor)
    for (let i = 0; i < 6; i++) {
      const a = i * Math.PI / 3, x = Math.cos(a), y = Math.sin(a)
      const wing = box(178, 24, 80, i % 2 ? M.panel : M.steel, x * 245, y * 245, -20)
      wing.rotation.z = a; g.add(wing)
      const tower = cyl(18, 24, 125, M.dark, 8, 'y', x * 235, y * 235, 42)
      g.add(tower)
    }
    // The command mast and its two bright transponder bars face inbound traffic.
    g.add(cyl(38, 54, 190, M.steel, 12, 'z', 0, 0, 210))
    g.add(cyl(54, 54, 18, M.ion, 20, 'z', 0, 0, 290))
    g.add(box(8, 120, 8, M.ion, -76, 0, 175)); g.add(box(8, 120, 8, M.ion, 76, 0, 175))
    g.add(box(30, 180, 30, M.dark, 0, 170, -75))
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(20, 12, 8), M.ion)
    beacon.position.set(0, 270, -75); g.add(beacon)
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
        // Keep navigation lamps legible without turning white hulls and
        // brushed deck plates into clipped bloom blobs in the bay.
        for (const m of [o.material].flat()) if (m?.emissive && /^(lights|ion)$/.test(m.name)) m.emissiveIntensity = k === 'hangar' ? 1.4 : 1.8
        // Canopies are glass you can see the pilot through.
        for (const m of [o.material].flat()) if (m?.name === 'canopy') { m.transparent = true; m.opacity = 0.34; m.depthWrite = false; m.roughness = 0.04; m.metalness = 0.5 }
        // The skywalk's glass: thin, cool, and see-through from both sides.
        for (const m of [o.material].flat()) if (m?.name === 'skyglass') { m.transparent = true; m.opacity = 0.16; m.depthWrite = false; m.side = THREE.DoubleSide; m.roughness = 0.05; m.metalness = 0.6 }
      })
      // Close-up detail (scene/detail.js): deck plate in the bay, fine plate on hulls.
      if (k === 'hangar') {
        root.traverse((o) => { if (o.isMesh) for (const m of [o.material].flat()) if (m.name === 'hangar') m.color.multiplyScalar(0.68) })
        detailModel(root, 'plate', { scale: 0.5, strength: 0.55, wear: 0.55 })
      }
      else if (SHIPS.has(k)) detailModel(root, 'hull', { scale: k === 'freighter' ? 0.35 : 0.8, strength: 0.35, wear: 0.4 })
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

/** The rigged pilot (art/game-pilot): its scene and animation clips, loaded once. */
let pilotRig = null
export function loadPilot(done) {
  if (pilotRig?.ready) return done(pilotRig)
  if (!pilotRig) {
    pilotRig = { ready: false, waiting: [] }
    gltf().load(`${BASE}authored/game-pilot.glb`, (res) => { pilotRig.ready = true; pilotRig.scene = res.scene; pilotRig.clips = res.animations; for (const f of pilotRig.waiting.splice(0)) f(pilotRig) }, undefined, () => { pilotRig.failed = true })
  }
  pilotRig.waiting.push(done)
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
