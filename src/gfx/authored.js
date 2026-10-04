import { useEffect, useSyncExternalStore } from 'react'
import { gltfLoader } from './gltf.js'

/**
 * Art built in Blender, loaded when a scene first asks for it.
 *
 * Each asset under `art/<id>/` is built by a script into
 * `public/authored/<id>.glb` (AGENT.md, section 4). This is the runtime side:
 * one load per asset per page, shared by whoever asks, and a status the caller
 * can fall back on. A scene asks with `useAuthored(id)` and gets `null` until
 * the file is in — and `null` for good if it fails — so the caller keeps
 * drawing whatever it drew before. Authored art is an upgrade, never a
 * dependency: an offline page, a blocked request or a broken file costs the
 * picture, not the flight.
 *
 * What comes back is the glTF scene, with shadows switched on, and the named
 * points the build script placed — `nozzle_0`, `hatch`, `footpad_0` and so on —
 * as positions in the asset's own frame, so the runtime reads where things are
 * instead of restating numbers the model already carries.
 *
 * Nothing here is imported on the first-paint path; `verify-art` holds that.
 */

const entries = new Map()
const listeners = new Set()
const emit = () => { for (const l of listeners) l() }

function load(id) {
  if (entries.has(id)) return
  entries.set(id, { status: 'loading', value: null })
  gltfLoader()
    .loadAsync(`${import.meta.env.BASE_URL}authored/${id}.glb`)
    .then((gltf) => {
      const scene = gltf.scene
      const points = {}
      scene.traverse((o) => {
        if (o.isMesh) {
          o.castShadow = true
          o.receiveShadow = true
        } else if (o !== scene && o.name && o.children.length === 0) {
          points[o.name] = o.position.clone()
        }
      })
      entries.set(id, { status: 'ready', value: { scene, points } })
      emit()
    })
    .catch((error) => {
      console.warn(`[periapsis] authored asset "${id}" did not load; keeping the fallback`, error)
      entries.set(id, { status: 'failed', value: null })
      emit()
    })
}

const subscribe = (l) => { listeners.add(l); return () => listeners.delete(l) }

/**
 * The asset once it is in, otherwise null. `wanted` lets a caller that only
 * sometimes draws the asset — the front door's backdrop shares the expedition
 * scene but has no lander in it — avoid fetching it at all.
 */
export function useAuthored(id, wanted = true) {
  useEffect(() => { if (wanted) load(id) }, [id, wanted])
  return useSyncExternalStore(subscribe, () => entries.get(id)?.value ?? null, () => null)
}
