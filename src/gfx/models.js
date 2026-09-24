import { useSyncExternalStore } from 'react'
import * as THREE from 'three'
import { DRACOLoader, GLTFLoader } from 'three-stdlib'
import { MODEL_BY_ID } from './modelsManifest.js'

/**
 * On-demand glTF loader for the NASA model catalogue.
 *
 * Loading is per-model, never in bulk: the catalogue runs to 140 MB and a single
 * entry (Gateway Core) is 63 MB of it. A craft fetches only the mesh actually
 * assigned to it, and only when it is assigned.
 */

/**
 * Content types a glTF may legitimately arrive as.
 *
 * This has to be an allowlist rather than a "not HTML" test. Vite answers a
 * request for a missing file with `200 text/html` — the SPA fallback — and
 * answers one for an unknown extension such as `.7z` with `200` and *no*
 * content-type at all. A negative test accepts both, and GLTFLoader then tries
 * to parse markup or archive bytes as a mesh. Anything not on this list, empty
 * included, is treated as absent.
 */
const ACCEPTED_TYPES = new Set([
  'model/gltf-binary', // .glb — what Vite serves
  'model/gltf+json', // .gltf
  'application/octet-stream', // common on static hosts and CDNs
  'application/json', // some servers for .gltf
])

function isLoadableType(header) {
  if (!header) return false // an unknown extension yields no content-type
  return ACCEPTED_TYPES.has(header.split(';')[0].trim().toLowerCase())
}

/**
 * One shared loader, built lazily.
 *
 * 22 of the 48 catalogue entries declare KHR_draco_mesh_compression as
 * *required* — Hubble, JWST, the Shuttle, Cassini and Juno among them — so
 * without a Draco decoder attached, nearly half the fleet fails outright with
 * "No DRACOLoader instance provided". The decoder is served from public/draco/
 * rather than a CDN so the app keeps working with no network.
 */
let loader = null

function getLoader() {
  if (loader) return loader
  const draco = new DRACOLoader()
  draco.setDecoderPath(`${import.meta.env.BASE_URL}draco/`)
  loader = new GLTFLoader().setDRACOLoader(draco)
  return loader
}

/**
 * Which way a model's nose points in its own file, where it breaks glTF's
 * convention.
 *
 * glTF is +Y up, so a vehicle modelled standing upright has its nose at +Y and
 * needs no entry. The ship's body frame puts the nose — the thrust axis — at
 * +Z, so a hull drawn for the ship is turned from the one onto the other;
 * nothing did that, and the Saturn V stood on its pad lying on its side from
 * the day the model was bound. Measured from the files by profiling each along
 * its longest axis:
 *
 *   saturn_v    2.01 x 12.99 x 2.01, long in y; 0.06 from the axis in the +y
 *               tenth, which is the escape tower, and 1.23 in the -y, the fins
 *   apollo_csm  21.65 x 9.63 x 5.12, long in x
 *
 * The second is modelled lying down, so it is listed — and it is not a CSM.
 * Its own preview in public/models is the Apollo–Soyuz Test Project stack:
 * 21.65 m is the CSM's 11.0, the docking module's 3.2 and the Soyuz's 7.5, and
 * the 4.82 m members at +x are the Soyuz's solar arrays. The CSM docked apex
 * first, so its nose is +x.
 */
const NOSE = {
  apollo_csm: '+x',
}

/** Which way a model's nose points in its file: '+y' unless listed above. */
export const noseOf = (id) => NOSE[id] ?? '+y'

/**
 * Models whose *front* matters as well as their nose, and which way it faces
 * in the file. The sequencer points a craft's body +y where its front should
 * look — Eagle's windows and radar at Columbia — so a model with a front is
 * rolled about its nose to put the front there. The LM's front, the face with
 * the forward hatch and the ladder leg below it, is the file's +z.
 */
const FRONT = {
  apollo_lm: '+z',
}

/**
 * Turn an object so the file axis `nose` ('+x', '-y', …) lies along +Z — and,
 * for a model standing along +y with its front on +z, that front along +y.
 */
export function turnNose(object, nose, front = null) {
  const r = object.rotation
  // A half-turn about the file's own +y first carries +z to -z, which the tip
  // onto +Z then carries to +y. Euler XYZ applies the y turn first.
  if (nose === '+y') r.set(Math.PI / 2, front === '+z' ? Math.PI : 0, 0)
  else if (nose === '-y') r.set(-Math.PI / 2, 0, 0)
  else if (nose === '+x') r.set(0, -Math.PI / 2, 0)
  else if (nose === '-x') r.set(0, Math.PI / 2, 0)
  else if (nose === '-z') r.set(0, Math.PI, 0)
  else r.set(0, 0, 0)
  return object
}

/** Turn a hull instance so its nose lies along +Z, the ship's thrust axis. */
export const alignNose = (object, id) => turnNose(object, noseOf(id), FRONT[id] ?? null)

/**
 * The file's front direction, for placing a model on the ground by hand.
 * Null for a model with none listed.
 */
export const frontOf = (id) => FRONT[id] ?? null

/**
 * Pieces of a model file flown or drawn as things of their own.
 *
 * The LM is one file and two vehicles: the ascent stage flies, and the descent
 * stage stays on the Moon as its launch pad. The catalogue's "Apollo CSM" is
 * the Apollo–Soyuz stack, of which Columbia is the −x half. Each part keeps
 * the meshes whose bounds are centred on its side of a plane, in the file's
 * normalised frame — which is the frame `normalize` below leaves every model
 * in, centred on its own bounding box.
 *
 * The planes are measured, not chosen. The LM stands 5.013 file units from
 * footpad to tunnel and is 6.427 across its pads, the real 9.4 m: 1.4626 m a
 * unit. The descent stage is 3.23 m to its top deck, which puts the deck at
 * -2.506 + 3.23 / 1.4626 = -0.297 — and the gap between the two stages' meshes
 * is there, at -0.29. In the Apollo–Soyuz file the CSM's last mesh ends at x =
 * +1.01 (the probe's tip) and the docking module's first begins at +0.69 with its
 * centre at +1.95, so a centre left of +1.3 is the CSM.
 *
 * `scale` is metres a file unit — the LM is drawn at its own measured size,
 * not stretched to a length — and `anchor` is where the part is drawn about:
 * the centre of its own bounds; the same height on the stack's axis, for a part
 * whose bounds are lopsided (the ascent stage's rendezvous radar juts forward,
 * pulling its box's centre 0.28 units off the docking tunnel it flies about); or
 * the footpads' plane under the axis.
 */
export const LM_SCALE = 9.4 / 6.427394866943359
/**
 * The split, a little above the deck: the RCS plume deflectors, bolted to the
 * descent stage's upper corners to shield it from the ascent stage's jets,
 * straddle the deck with their centres at -0.28, and stay behind with it.
 */
const LM_DECK = -0.27
export const PARTS = {
  'apollo_lm:ascent': { keep: (c) => c.y > LM_DECK, scale: LM_SCALE, anchor: 'axis' },
  'apollo_lm:descent': { keep: (c) => c.y <= LM_DECK, scale: LM_SCALE, anchor: 'base' },
  'apollo_csm:csm': { keep: (c) => c.x < 1.3, scale: 1, anchor: 'centre' },
}

/**
 * A new object holding just one part of a loaded model, scaled to metres and
 * placed about its anchor. The meshes are clones sharing geometry and
 * materials, as every other instance does; bounds are measured in the
 * normalised frame, so on the model as loaded, before anything moves it.
 */
export function makePart(source, key) {
  const part = PARTS[key]
  if (!part) throw new Error(`no model part "${key}"`)
  const instance = source.clone(true)
  instance.updateWorldMatrix(true, true)
  const drop = []
  const kept = new THREE.Box3()
  const box = new THREE.Box3()
  const c = new THREE.Vector3()
  instance.traverse((o) => {
    if (!o.isMesh) return
    box.setFromObject(o)
    box.getCenter(c)
    if (part.keep(c)) kept.union(box)
    else drop.push(o)
  })
  for (const o of drop) o.parent.remove(o)
  const anchor = new THREE.Vector3()
  if (part.anchor === 'base') {
    // The whole model's base: the stack's axis, on the plane of its lowest point.
    anchor.set(0, -source.userData.extent[1] / 2, 0)
  } else {
    kept.getCenter(anchor)
    if (part.anchor === 'axis') anchor.set(0, anchor.y, 0)
  }
  instance.position.sub(anchor)
  const group = new THREE.Group()
  group.add(instance)
  group.scale.setScalar(part.scale)
  const size = kept.getSize(new THREE.Vector3()).multiplyScalar(part.scale)
  group.userData.size = [size.x, size.y, size.z]
  // Where the part sits in the stack, m above the stack's base: for the ascent
  // stage standing on the descent stage.
  group.userData.aboveBase = (anchor.y + source.userData.extent[1] / 2) * part.scale
  return group
}

const cache = new Map() // id -> normalised Object3D
const pending = new Map() // id -> Promise
const failed = new Map() // id -> reason
const listeners = new Set()
const notify = () => listeners.forEach((l) => l())

export const getModel = (id) => cache.get(id) ?? null
export const getModelError = (id) => failed.get(id) ?? null

/**
 * Centre a model on its own bounding box and record its longest dimension.
 *
 * Downloaded assets arrive in whatever units and offset their author chose —
 * this catalogue mixes metres, centimetres and arbitrary studio scales — so
 * without this a model could sit far off its own origin or dwarf the planet.
 * The scale itself is left to the consumer, because the same mesh may be bound
 * to craft of different rendered sizes.
 */
function normalize(scene) {
  scene.updateWorldMatrix(true, true)
  const box = new THREE.Box3().setFromObject(scene)
  const size = box.getSize(new THREE.Vector3())
  const centre = box.getCenter(new THREE.Vector3())

  scene.position.sub(centre)
  scene.traverse((o) => {
    if (!o.isMesh) return
    o.castShadow = true
    o.receiveShadow = true
    // Bounds travel with the geometry, so recompute them after the recentre or
    // frustum culling will test against the wrong volume.
    o.geometry?.computeBoundingBox?.()
    o.geometry?.computeBoundingSphere?.()
  })

  const wrapper = new THREE.Group()
  wrapper.add(scene)
  wrapper.userData.longest = Math.max(size.x, size.y, size.z) || 1
  wrapper.userData.extent = [size.x, size.y, size.z]
  return wrapper
}

async function probe(url) {
  try {
    const res = await fetch(url, { method: 'HEAD' })
    if (!res.ok) return { ok: false, reason: `HTTP ${res.status}` }
    const type = res.headers.get('content-type')
    if (!isLoadableType(type)) {
      return { ok: false, reason: type ? `served as ${type.split(';')[0]}` : 'no content-type' }
    }
    return { ok: true }
  } catch (err) {
    return { ok: false, reason: err.message }
  }
}

/**
 * Fetch one model. Resolves to the normalised object, or null if the file is
 * absent or unreadable — failures are recorded per model so one bad entry in a
 * 48-model catalogue cannot take down the rest.
 */
export function loadModel(id) {
  if (cache.has(id)) return Promise.resolve(cache.get(id))
  if (pending.has(id)) return pending.get(id)

  const entry = MODEL_BY_ID[id]
  if (!entry) return Promise.resolve(null)

  const task = (async () => {
    const url = `${import.meta.env.BASE_URL}models/${entry.file}`
    const check = await probe(url)
    if (!check.ok) {
      failed.set(id, check.reason)
      pending.delete(id)
      notify()
      return null
    }
    try {
      const gltf = await getLoader().loadAsync(url)
      const model = normalize(gltf.scene)
      cache.set(id, model)
      failed.delete(id)
      return model
    } catch (err) {
      failed.set(id, err.message?.slice(0, 80) ?? 'parse failed')
      console.error(`[periapsis] model "${id}" failed to load`, err)
      return null
    } finally {
      pending.delete(id)
      notify()
    }
  })()

  pending.set(id, task)
  return task
}

export const isModelLoading = (id) => pending.has(id)

/** Subscribe to the cache so a craft swaps the moment its mesh lands. */
export function useModel(id) {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => (id ? (cache.get(id) ?? null) : null),
    () => null,
  )
}
