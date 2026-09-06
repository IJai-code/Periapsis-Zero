#!/usr/bin/env node
/**
 * Downloads public-domain Earth and Moon imagery into public/textures/, under
 * the exact filenames src/gfx/hdTextures.js probes for.
 *
 * Run:  npm run textures:fetch      (add -- --force to re-download)
 *
 * Nothing here is required to run the app. The procedural set remains the
 * default and the HD toggle simply finds more to work with once this has run.
 *
 * Two sources need work after download, both handled here:
 *
 *   - The CGI Moon Kit ships as 16-bit TIFF, which no browser can decode.
 *   - It provides a *displacement* map, not a normal map. Pairing NASA's real
 *     lunar albedo with the procedurally generated normals would put invented
 *     crater relief underneath real maria, so the normals are derived from the
 *     real LOLA elevation instead and the two line up.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { decodePNG, encodePNG, toGray, pngInfo } from './png.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT = path.join(ROOT, 'public', 'textures')
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'spxsim-hd-'))
const FORCE = process.argv.includes('--force')

const THREE_ASSETS = 'https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/textures/planets'
const SVS_MOON = 'https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720'

const SOURCES = [
  {
    out: 'earth_day.jpg',
    url: 'https://eoimages.gsfc.nasa.gov/images/imagerecords/73000/73909/world.topo.bathy.200412.3x5400x2700.jpg',
    credit: 'NASA Visible Earth — Blue Marble Next Generation, Dec 2004 (5400×2700)',
  },
  {
    out: 'earth_night.jpg',
    url: 'https://eoimages.gsfc.nasa.gov/images/imagerecords/79000/79765/dnb_land_ocean_ice.2012.3600x1800.jpg',
    credit: 'NASA Earth Observatory — Black Marble, VIIRS day/night band (3600×1800)',
  },
  {
    out: 'earth_normal.jpg',
    url: `${THREE_ASSETS}/earth_normal_2048.jpg`,
    credit: 'three.js example assets — Earth terrain normals (2048×1024)',
  },
  {
    out: 'earth_specular.jpg',
    url: `${THREE_ASSETS}/earth_specular_2048.jpg`,
    credit: 'three.js example assets — Earth specular / water mask (2048×1024)',
    note: 'inverted to roughness on load — see src/gfx/hdTextures.js',
  },
  {
    out: 'earth_clouds.png',
    url: `${THREE_ASSETS}/earth_clouds_1024.png`,
    credit: 'three.js example assets — cloud sheet (1024×512)',
    pipeline: 'ensureAlpha',
  },
  {
    out: 'moon_color.jpg',
    url: `${SVS_MOON}/lroc_color_poles_4k.tif`,
    credit: 'NASA SVS CGI Moon Kit — LROC WAC colour shade (4k)',
    pipeline: 'tiffToJpeg',
  },
  {
    out: 'moon_normal.jpg',
    url: `${SVS_MOON}/ldem_16_uint.tif`,
    credit: 'NASA SVS CGI Moon Kit — LOLA LDEM displacement',
    note: 'converted here to a tangent-space normal map',
    pipeline: 'displacementToNormal',
  },
]

const MB = (n) => `${(n / 1048576).toFixed(1)} MB`

function sips(args) {
  try {
    execFileSync('sips', args, { stdio: 'pipe' })
  } catch (err) {
    throw new Error(
      `sips failed (${err.message.split('\n')[0]}). It ships with macOS; on other ` +
        `platforms convert the TIFFs manually, or skip the two Moon entries.`,
    )
  }
}

async function download(url, dest) {
  const res = await fetch(url, { redirect: 'follow' })
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`)
  const type = res.headers.get('content-type') || ''
  if (!type.startsWith('image/')) throw new Error(`expected an image, got ${type}`)
  const buf = Buffer.from(await res.arrayBuffer())
  fs.writeFileSync(dest, buf)
  return buf.length
}

/**
 * The cloud sheet is sampled through its alpha channel, so a source that only
 * carries RGB gets an alpha built from its luminance.
 */
function ensureAlpha(file) {
  const buf = fs.readFileSync(file)
  const info = pngInfo(buf)

  // Check the header before decoding: a palette PNG with a tRNS chunk carries
  // real alpha that the browser reads perfectly well, even though the pixel
  // decoder here cannot expand palettes. Rewriting it would be wrong as well as
  // wasteful.
  if (info.hasAlpha) {
    const how = info.colorType === 3 ? 'palette alpha (tRNS)' : 'alpha channel'
    return `${info.width}×${info.height}, ${how} present`
  }

  const { width, height, channels, data } = decodePNG(buf)
  const rgba = new Uint8Array(width * height * 4)
  for (let i = 0; i < width * height; i++) {
    const s = i * channels
    const l = channels === 1 ? data[s] : (data[s] * 0.299 + data[s + 1] * 0.587 + data[s + 2] * 0.114) | 0
    rgba[i * 4] = 255
    rgba[i * 4 + 1] = 255
    rgba[i * 4 + 2] = 255
    rgba[i * 4 + 3] = l
  }
  fs.writeFileSync(file, encodePNG(rgba, width, height))
  return `${width}×${height}, alpha synthesised from luminance`
}

/** Lunar constants, for turning elevation into real surface slopes. */
const MOON_RADIUS_M = 1737400
const LDEM_RANGE_M = 19900 // LOLA spans roughly -9 km to +10.9 km

/**
 * Displacement map -> tangent-space normal map.
 *
 * Slopes are computed in real units rather than in texels: the longitude
 * derivative is divided by cos(latitude), without which every feature shears
 * sideways as it approaches the poles. RELIEF is then an honest, single-point
 * exaggeration — true lunar slopes at this sampling are gentle enough to read
 * as flat once lit.
 */
const RELIEF = 3.0

function displacementToNormal(tif, outJpg) {
  const asPng = path.join(TMP, 'ldem.png')
  sips(['-s', 'format', 'png', tif, '--out', asPng])

  const png = decodePNG(fs.readFileSync(asPng))
  const { width: w, height: h } = png
  const height = toGray(png)

  const metresPerTexel = (2 * Math.PI * MOON_RADIUS_M) / w
  const out = new Uint8Array(w * h * 4)

  for (let y = 0; y < h; y++) {
    const lat = ((y + 0.5) / h - 0.5) * Math.PI
    const invCos = 1 / Math.max(0.25, Math.cos(lat))
    const rowUp = Math.max(0, y - 1) * w
    const rowDn = Math.min(h - 1, y + 1) * w
    const row = y * w

    for (let x = 0; x < w; x++) {
      const xm = (x - 1 + w) % w // longitude wraps
      const xp = (x + 1) % w

      const dhx = ((height[row + xp] - height[row + xm]) * 0.5 * LDEM_RANGE_M) / metresPerTexel
      const dhy = ((height[rowDn + x] - height[rowUp + x]) * 0.5 * LDEM_RANGE_M) / metresPerTexel

      const nx = -dhx * invCos * RELIEF
      const ny = -dhy * RELIEF
      const inv = 1 / Math.sqrt(nx * nx + ny * ny + 1)

      const o = (row + x) * 4
      out[o] = (nx * inv * 0.5 + 0.5) * 255
      out[o + 1] = (ny * inv * 0.5 + 0.5) * 255
      out[o + 2] = (inv * 0.5 + 0.5) * 255
      out[o + 3] = 255
    }
  }

  const normalPng = path.join(TMP, 'moon_normal.png')
  fs.writeFileSync(normalPng, encodePNG(out, w, h))
  sips(['-s', 'format', 'jpeg', '-s', 'formatOptions', '92', normalPng, '--out', outJpg])
  return `${w}×${h} derived from LOLA elevation`
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true })
  console.log(`\nFetching HD textures into ${path.relative(ROOT, OUT)}/\n`)

  let ok = 0
  let skipped = 0
  const failures = []

  for (const src of SOURCES) {
    const dest = path.join(OUT, src.out)
    if (fs.existsSync(dest) && !FORCE) {
      console.log(`  · ${src.out.padEnd(20)} already present (--force to replace)`)
      skipped++
      continue
    }

    process.stdout.write(`  → ${src.out.padEnd(20)} `)
    try {
      let detail
      if (src.pipeline === 'tiffToJpeg' || src.pipeline === 'displacementToNormal') {
        const tif = path.join(TMP, `${src.out}.tif`)
        const bytes = await download(src.url, tif)
        process.stdout.write(`${MB(bytes).padStart(9)}  `)
        if (src.pipeline === 'tiffToJpeg') {
          sips(['-s', 'format', 'jpeg', '-s', 'formatOptions', '90', tif, '--out', dest])
          detail = 'TIFF → JPEG'
        } else {
          detail = displacementToNormal(tif, dest)
        }
      } else {
        const bytes = await download(src.url, dest)
        process.stdout.write(`${MB(bytes).padStart(9)}  `)
        detail = src.pipeline === 'ensureAlpha' ? ensureAlpha(dest) : 'ok'
      }
      console.log(detail)
      console.log(`     ${src.credit}${src.note ? `\n     ${src.note}` : ''}`)
      ok++
    } catch (err) {
      console.log(`FAILED — ${err.message}`)
      failures.push(src.out)
    }
  }

  fs.rmSync(TMP, { recursive: true, force: true })

  console.log(`\n  ${ok} downloaded, ${skipped} already present, ${failures.length} failed`)
  if (failures.length) console.log(`  failed: ${failures.join(', ')}`)
  console.log(
    '\n  The Milky Way skybox stays procedural — no public-domain equirectangular\n' +
      '  panorama with a stable URL was worth hard-coding here.\n' +
      '\n  These load automatically the next time the app starts.\n',
  )
  if (failures.length) process.exitCode = 1
}

main().catch((err) => {
  console.error(`\nfetch-hd-textures failed: ${err.stack}\n`)
  fs.rmSync(TMP, { recursive: true, force: true })
  process.exitCode = 1
})
