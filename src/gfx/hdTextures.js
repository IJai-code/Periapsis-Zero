import { useMemo } from 'react'
import * as THREE from 'three'
import { configureTexture } from './textureSettings.js'
import { useUi } from '../sim/store.js'

/**
 * Lazy loader for real NASA imagery dropped into public/textures/.
 *
 * Nothing here runs at startup. The manifest is probed and the files fetched
 * only when the user asks for them, so the offline-first procedural path stays
 * the default and the initial load is untouched. Results are cached at module
 * scope, so toggling back and forth after the first fetch costs nothing.
 */

/**
 * `alt` is a fallback filename for the same slot. Published Earth maps are
 * almost always *specular* rather than roughness — bright where the surface is
 * shiny — which is the exact inverse of what a roughnessMap wants. Rather than
 * making that the user's problem, the alternate is inverted on load.
 */
export const HD_MANIFEST = [
  { slot: 'earth.day', file: 'earth_day.jpg' },
  { slot: 'earth.normal', file: 'earth_normal.jpg' },
  { slot: 'earth.rough', file: 'earth_roughness.jpg', alt: 'earth_specular.jpg', invertAlt: true },
  { slot: 'earth.night', file: 'earth_night.jpg' },
  { slot: 'earth.clouds', file: 'earth_clouds.png' },
  { slot: 'moon.color', file: 'moon_color.jpg' },
  { slot: 'moon.normal', file: 'moon_normal.jpg' },
  { slot: 'sky.sky', file: 'milkyway.jpg' },
]

let cache = null // slot -> Texture, once loaded
let inFlight = null

export function getHdTextures() {
  return cache
}

/** Only treat a file as present if the server really returns an image. */
async function exists(url) {
  try {
    const res = await fetch(url, { method: 'HEAD' })
    return res.ok && (res.headers.get('content-type') || '').startsWith('image/')
  } catch {
    return false
  }
}

/**
 * Invert a specular map into a roughness map.
 *
 * three multiplies material.roughness by the green channel, so oceans have to
 * be dark. A specular map has them bright; used directly it produces mirror-
 * finish continents and matte water — visibly backwards.
 */
function invertToRoughness(texture, slot) {
  const image = texture.image
  const canvas = document.createElement('canvas')
  canvas.width = image.width
  canvas.height = image.height

  const ctx = canvas.getContext('2d')
  ctx.drawImage(image, 0, 0)
  const frame = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const d = frame.data
  for (let i = 0; i < d.length; i += 4) {
    d[i] = 255 - d[i]
    d[i + 1] = 255 - d[i + 1]
    d[i + 2] = 255 - d[i + 2]
  }
  ctx.putImageData(frame, 0, 0)

  texture.dispose()
  return configureTexture(new THREE.CanvasTexture(canvas), slot)
}

/**
 * Fetch every manifest entry that is actually installed.
 *
 * @param {(loaded: number, total: number) => void} onProgress
 * @returns {Promise<{ textures: Record<string, THREE.Texture>, found: number, missing: string[] }>}
 */
export function loadHdTextures(onProgress = () => {}) {
  if (cache) {
    const found = Object.keys(cache).length
    onProgress(found, found)
    return Promise.resolve({ textures: cache, found, missing: [] })
  }
  if (inFlight) return inFlight

  inFlight = (async () => {
    const base = `${import.meta.env.BASE_URL}textures/`

    // Probe first so the progress readout has a real denominator, and so a
    // partial install (say, Earth only) is a supported outcome rather than a
    // string of failed requests.
    const probed = await Promise.all(
      HD_MANIFEST.map(async (entry) => {
        if (await exists(base + entry.file)) return { ...entry, url: base + entry.file }
        if (entry.alt && (await exists(base + entry.alt))) {
          return { ...entry, url: base + entry.alt, usedAlt: true }
        }
        return null
      }),
    )

    const available = probed.filter(Boolean)
    const missing = HD_MANIFEST.filter((e) => !available.some((a) => a.slot === e.slot)).map(
      (e) => e.file,
    )

    onProgress(0, available.length)
    if (available.length === 0) {
      inFlight = null
      return { textures: {}, found: 0, missing }
    }

    const loader = new THREE.TextureLoader()
    const textures = {}
    let done = 0

    await Promise.all(
      available.map(async (entry) => {
        let texture = configureTexture(await loader.loadAsync(entry.url), entry.slot)
        if (entry.usedAlt && entry.invertAlt) texture = invertToRoughness(texture, entry.slot)
        textures[entry.slot] = texture
        onProgress(++done, available.length)
      }),
    )

    cache = textures
    inFlight = null
    return { textures, found: available.length, missing }
  })()

  return inFlight
}

/**
 * Resolve the texture set a component should actually bind.
 *
 * HD entries are layered over the procedural baseline rather than replacing it,
 * so a partial install works: any slot without a real image keeps its generated
 * version instead of going undefined.
 */
export function useActiveTextures(procedural) {
  const useHd = useUi((s) => s.hd && s.hdStatus === 'ready')
  return useMemo(
    () => (useHd && cache ? { ...procedural, ...cache } : procedural),
    [useHd, procedural],
  )
}
