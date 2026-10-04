import { DRACOLoader, GLTFLoader } from 'three-stdlib'

/**
 * One glTF loader for the whole page, built the first time something asks.
 *
 * 22 of the 48 catalogue entries declare KHR_draco_mesh_compression as
 * *required* — Hubble, JWST, the Shuttle, Cassini and Juno among them — and so
 * does every authored asset under `public/authored/`, so without a Draco
 * decoder attached nearly half the fleet and all of the authored art fail
 * outright with "No DRACOLoader instance provided". The decoder is served from
 * public/draco/ rather than a CDN so the app keeps working with no network.
 *
 * Shared rather than one per caller: a DRACOLoader owns a worker pool, and a
 * second loader would start a second pool to decode the same kind of file.
 */
let loader = null

export function gltfLoader() {
  if (loader) return loader
  const draco = new DRACOLoader()
  draco.setDecoderPath(`${import.meta.env.BASE_URL}draco/`)
  loader = new GLTFLoader().setDRACOLoader(draco)
  return loader
}
