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

/** Turn an object so the file axis `nose` ('+x', '-y', …) lies along +Z. */
export function turnNose(object, nose) {
  const r = object.rotation
  if (nose === '+y') r.set(Math.PI / 2, 0, 0)
  else if (nose === '-y') r.set(-Math.PI / 2, 0, 0)
  else if (nose === '+x') r.set(0, -Math.PI / 2, 0)
  else if (nose === '-x') r.set(0, Math.PI / 2, 0)
  else if (nose === '-z') r.set(0, Math.PI, 0)
  else r.set(0, 0, 0)
  return object
}

/** Turn a hull instance so its nose lies along +Z, the ship's thrust axis. */
export const alignNose = (object, id) => turnNose(object, noseOf(id))

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
