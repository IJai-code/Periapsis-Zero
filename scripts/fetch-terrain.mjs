/**
 * Real ground around each launch pad.
 *
 * The horizon a rocket leaves is part of what makes a site that site: Vandenberg
 * sits in coastal hills, Kourou on a jungle shoreline, Baikonur in flat steppe,
 * Kennedy on a barrier island a few metres above the sea. None of that can be
 * invented convincingly, and all of it is public data.
 *
 * Heights come from the Terrarium tiles on AWS Open Data, which are SRTM and
 * friends repackaged as PNG: elevation in metres is
 *
 *   (R * 256 + G + B / 256) - 32768
 *
 * They need no key and no account, which is why they are the source — the rest
 * of this repository is self-contained and a launch site that only renders for
 * someone holding an API key would not be.
 *
 * What is *not* fetched is imagery. Ground-resolution satellite pictures of a
 * launch pad are all commercial; the keyless public sets (NASA GIBS, MODIS and
 * VIIRS) top out around 250 m a pixel, which puts a whole launch complex inside
 * one pixel. So the ground is shaded procedurally from the site's own biome and
 * the height data does the work, and that is a limit worth stating rather than
 * papering over.
 *
 * Output is one PNG per site under public/terrain, in the same Terrarium
 * encoding it arrives in, plus a manifest. Committed, like the textures and for
 * the same reason.
 *
 *   node scripts/fetch-terrain.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { decodePNG, encodePNG } from './png.mjs'
import { LAUNCH_SITES } from '../src/sim/launchsite.js'

/** Terrarium zoom. 12 is about 33 m a sample at these latitudes. */
const ZOOM = 12
/** Tiles a side around the pad: 8 covers 60-78 km depending on latitude. */
const SPAN = 8
/** Samples a side in the stored grid. 512 over ~70 km is about 135 m. */
const OUT = 512
const SOURCE = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium'
const DIR = 'public/terrain'

const lonToX = (lon, z) => ((lon + 180) / 360) * 2 ** z
const latToY = (lat, z) => {
  const s = Math.sin((lat * Math.PI) / 180)
  return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * 2 ** z
}
const xToLon = (x, z) => (x / 2 ** z) * 360 - 180
const yToLat = (y, z) => {
  const n = Math.PI - (2 * Math.PI * y) / 2 ** z
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)))
}

/** Terrarium metres from a decoded pixel. */
const metres = (d, o) => d[o] * 256 + d[o + 1] + d[o + 2] / 256 - 32768

async function tile(z, x, y) {
  const n = 2 ** z
  const wrapped = ((x % n) + n) % n
  const url = `${SOURCE}/${z}/${wrapped}/${y}.png`
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(url)
      if (res.status === 404) return null // ocean tiles are simply absent
      if (!res.ok) throw new Error(`${res.status}`)
      return decodePNG(Buffer.from(await res.arrayBuffer()))
    } catch (e) {
      if (attempt === 3) throw new Error(`${url}: ${e.message}`)
      await new Promise((r) => setTimeout(r, 400 * (attempt + 1)))
    }
  }
  return null
}

fs.mkdirSync(DIR, { recursive: true })
const manifest = []

for (const site of Object.values(LAUNCH_SITES)) {
  const cx = lonToX(site.longitude, ZOOM)
  const cy = latToY(site.latitude, ZOOM)
  const x0 = Math.floor(cx - SPAN / 2)
  const y0 = Math.floor(cy - SPAN / 2)

  // The full-resolution block, then a box filter down to the stored grid.
  const full = SPAN * 256
  const grid = new Float32Array(full * full)
  let missing = 0
  for (let ty = 0; ty < SPAN; ty++) {
    for (let tx = 0; tx < SPAN; tx++) {
      const img = await tile(ZOOM, x0 + tx, y0 + ty)
      if (!img) {
        missing++
        continue
      }
      const { data, channels, width } = img
      for (let py = 0; py < 256; py++) {
        for (let px = 0; px < 256; px++) {
          const o = (py * width + px) * channels
          grid[(ty * 256 + py) * full + (tx * 256 + px)] = metres(data, o)
        }
      }
    }
  }

  const step = full / OUT
  const out = new Uint8Array(OUT * OUT * 4)
  let lo = Infinity
  let hi = -Infinity
  for (let y = 0; y < OUT; y++) {
    for (let x = 0; x < OUT; x++) {
      let sum = 0
      for (let j = 0; j < step; j++) {
        for (let i = 0; i < step; i++) sum += grid[(y * step + j) * full + (x * step + i)]
      }
      const h = sum / (step * step)
      lo = Math.min(lo, h)
      hi = Math.max(hi, h)
      // Back into Terrarium, so the browser decodes it the same way this did.
      const v = Math.round((h + 32768) * 256)
      const o = (y * OUT + x) * 4
      out[o] = (v >> 16) & 255
      out[o + 1] = (v >> 8) & 255
      out[o + 2] = v & 255
      out[o + 3] = 255
    }
  }

  fs.writeFileSync(path.join(DIR, `${site.id}.png`), encodePNG(out, OUT, OUT))

  // Geographic bounds of the stored grid, and what a sample is worth on the
  // ground at this latitude — Mercator stretches with latitude and the mesh has
  // to be built in metres, not degrees.
  const west = xToLon(x0, ZOOM)
  const east = xToLon(x0 + SPAN, ZOOM)
  const north = yToLat(y0, ZOOM)
  const south = yToLat(y0 + SPAN, ZOOM)
  const metresPerDegLon = 111320 * Math.cos((site.latitude * Math.PI) / 180)
  const width = (east - west) * metresPerDegLon
  const height = (north - south) * 110574

  manifest.push({
    id: site.id,
    name: site.name,
    samples: OUT,
    /*
     * The tile origin, so the client can invert Mercator per row rather than
     * interpolating latitude linearly between the bounds. Web Mercator is not
     * linear in latitude, and over 70 km at Vandenberg's 34.7 degrees the error
     * would put the horizon in the wrong place.
     */
    zoom: ZOOM,
    tileX: x0,
    tileY: y0,
    tileSpan: SPAN,
    west,
    east,
    south,
    north,
    width: Math.round(width),
    height: Math.round(height),
    metresPerSample: Math.round(width / OUT),
    low: Math.round(lo),
    high: Math.round(hi),
  })
  console.log(
    `  ${site.id.padEnd(11)}${Math.round(width / 1000)} x ${Math.round(height / 1000)} km` +
      `  ${Math.round(width / OUT)} m a sample   ${Math.round(lo)} to ${Math.round(hi)} m` +
      (missing ? `   (${missing} tiles absent — ocean)` : ''),
  )
}

fs.writeFileSync(
  path.join(DIR, 'manifest.json'),
  JSON.stringify({ zoom: ZOOM, encoding: 'terrarium', sites: manifest }, null, 2) + '\n',
)
console.log(`\n  wrote ${manifest.length} heightfields to ${DIR}/`)
