import { useMemo } from 'react'
import * as THREE from 'three'
import { configureTexture } from './textureSettings.js'
import { useUi } from '../sim/store.js'

/**
 * Real NASA imagery from public/textures/.
 *
 * Loaded at startup alongside the procedural set rather than behind a switch —
 * see ./useAssets.js for why. The manifest is probed before anything is
 * fetched, so a partial install is a supported outcome rather than a string of
 * failed requests, and every slot without a real image keeps its generated
 * version. Results are cached at module scope.
 */

/**
 * The imagery, by material slot.
 *
 * `alt` is a fallback filename for the same slot. Published Earth maps are
 * almost always *specular* rather than roughness — bright where the surface is
 * shiny — which is the exact inverse of what a roughnessMap wants. Rather than
 * making that the user's problem, the alternate is inverted on load. `invert`
 * says the same of a *primary*: the Earth slot is declared with the specular
 * map as its file, because this install deliberately ships no roughness map
 * (see `public/textures/README.md`) and a manifest entry whose primary is
 * absent costs every visitor a console 404 and a dead request before the
 * fallback answers.
 *
 * `defer` says a slot is not wanted for the first frame. The Moon's two maps
 * are 9.5 MB of the 14 MB this site downloads, and every visitor was waiting
 * for them before anything could be flown — including the ones who never leave
 * Earth. They are fetched once the first frame is up instead, and because HD
 * imagery is layered over a procedural baseline rather than replacing it, the
 * Moon is drawn from its generated maps in the meantime and rebound the moment
 * the real ones land. On a 5 Mbps connection that is the difference between
 * waiting twenty-two seconds and waiting seven.
 */
export const HD_MANIFEST = [
  { slot: 'earth.day', file: 'earth_day.jpg' },
  { slot: 'earth.normal', file: 'earth_normal.jpg' },
  { slot: 'earth.rough', file: 'earth_specular.jpg', invert: true },
  { slot: 'earth.night', file: 'earth_night.jpg' },
  { slot: 'earth.clouds', file: 'earth_clouds.png' },
  { slot: 'moon.color', file: 'moon_color.jpg', defer: true },
  { slot: 'moon.normal', file: 'moon_normal.jpg', defer: true },
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
 * Resolves once everything wanted for the first frame is in. Slots marked
 * `defer` keep loading behind it and call `onLate` when they land, which is
 * what tells the scene to rebind them.
 *
 * @param {(loaded: number, total: number) => void} onProgress
 * @param {(found: number) => void} onLate
 * @returns {Promise<{ textures: Record<string, THREE.Texture>, found: number, missing: string[] }>}
 */
export function loadHdTextures(onProgress = () => {}, onLate = () => {}) {
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

    const now = available.filter((e) => !e.defer)
    const later = available.filter((e) => e.defer)

    onProgress(0, now.length)
    if (available.length === 0) {
      inFlight = null
      return { textures: {}, found: 0, missing }
    }

    const loader = new THREE.TextureLoader()
    const textures = {}
    let done = 0
    const fetchInto = async (entry) => {
      let texture = configureTexture(await loader.loadAsync(entry.url), entry.slot)
      if (entry.usedAlt ? entry.invertAlt : entry.invert) texture = invertToRoughness(texture, entry.slot)
      textures[entry.slot] = texture
      return texture
    }

    await Promise.all(
      now.map(async (entry) => {
        await fetchInto(entry)
        onProgress(++done, now.length)
      }),
    )

    cache = textures
    inFlight = null

    /*
     * The rest, behind the first frame. Nothing awaits this: the slots it fills
     * already hold their procedural versions, and `useActiveTextures` rebinds
     * when `onLate` reports. A failure here is not a failure of the page —
     * whatever does not arrive simply stays procedural.
     */
    if (later.length) {
      Promise.allSettled(later.map(fetchInto)).then(() => onLate(Object.keys(textures).length))
    }

    return { textures, found: now.length, missing, deferred: later.length }
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
  // `hdStatus` is the re-render trigger, not a preference: the cache appears
  // asynchronously and materials have to be rebound when it does.
  const ready = useUi((s) => s.hdStatus === 'ready')
  // And the revision, which moves when deferred imagery lands after the first
  // frame. Without it the memo would keep handing out the set it first saw.
  const revision = useUi((s) => s.hdRevision)
  return useMemo(
    () => (ready && cache ? { ...procedural, ...cache } : procedural),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ready, revision, procedural],
  )
}
