/**
 * Real ground around Tranquility Base, in three levels of real height data.
 *
 * The lunar counterpart of fetch-terrain.mjs, and the same reasoning: the ground
 * a vehicle leaves is part of what makes a site that site, none of it can be
 * invented convincingly, and all of it is public. What differs is how much of
 * it a lunar ascent needs. A person on the surface sees 2.6 km to the horizon;
 * Eagle at insertion, 18 km up, sees 250. So the ground comes in three rings,
 * each from the best public model that covers it:
 *
 *   near   LROC NAC DTM of the Apollo 11 site, 2 m a sample, ±1 km
 *          (NAC_DTM_APOLLO11, ASU, stereo from two NAC pairs, tied to LOLA)
 *   mid    LOLA gridded DEM, 1024 samples a degree — 29.6 m — ±15 km
 *   far    LOLA gridded DEM, 256 a degree — 118 m — ±121 km
 *
 * All three are equirectangular grids read straight out of their archives with
 * HTTP range requests: the NAC DTM is an uncompressed GeoTIFF with one row per
 * strip, and the LOLA tiles are raw 16-bit PDS images, so the rows around the
 * site can be read without downloading the 113 MB and 2 GB files they sit in.
 * About 12 MB crosses the network in total.
 *
 * Heights are stored as they are published — metres relative to the 1737.4 km
 * reference sphere — packed into the red and green channels of an RGB PNG, with
 * a base and a step per level in the manifest. The client shifts each level so
 * the landing site is at zero, the rule the Earth pads follow; see
 * components/LunarSurface.jsx.
 *
 *   npm run terrain:moon
 */
import fs from 'node:fs'
import path from 'node:path'
import { encodePNGPaeth } from './png.mjs'
import { LUNAR_SITES } from '../src/sim/launchsite.js'

const SITE = LUNAR_SITES.tranquility
const DIR = path.join('public/terrain', SITE.id)
const R = 1737400

const NAC = {
  url: 'https://pds.mcp.nasa.gov/data/store/img/lunar_reconnaissance_orbiter/pds4/lroc/lro-l-lroc-5-rdr/LROLRC_2001/DATA/SDP/NAC_DTM/APOLLO11/NAC_DTM_APOLLO11.TIF',
  label: 'https://pds.lroc.im-ldi.com/data/LRO-L-LROC-5-RDR-V1.0/LROLRC_2001/DATA/SDP/NAC_DTM/APOLLO11/NAC_DTM_APOLLO11.LBL',
  // From the label and the TIFF's own tags, checked below rather than trusted.
  width: 2111,
  height: 13978,
  dataOffset: 112495,
  metres: 2,
  // ModelTiepoint: pixel (0, 0)'s corner in projected metres. Equirectangular,
  // standard parallel 1°, centre longitude 180°.
  x0: -4748754.0000014,
  y0: 37496.000000011,
  standardParallel: 1,
  centreLongitude: 180,
  noData: -3e38,
}

const LOLA = 'https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/cylindrical/img'

const DEG = Math.PI / 180

/* ---------------------------------------------------------------- *
 * Fetching
 * ---------------------------------------------------------------- */

async function range(url, start, length) {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const res = await fetch(url, { headers: { Range: `bytes=${start}-${start + length - 1}` } })
      if (res.status !== 206) throw new Error(`HTTP ${res.status}, wanted 206`)
      const buf = Buffer.from(await res.arrayBuffer())
      if (buf.length !== length) throw new Error(`got ${buf.length} bytes of ${length}`)
      return buf
    } catch (e) {
      if (attempt === 4) throw new Error(`${url} [${start}+${length}]: ${e.message}`)
      await new Promise((r) => setTimeout(r, 500 * (attempt + 1)))
    }
  }
}

/** Run `task(i)` for i in [0, n) with at most `width` in flight. */
async function pool(n, width, task) {
  let next = 0
  let done = 0
  const worker = async () => {
    while (next < n) {
      const i = next++
      await task(i)
      if (++done % 256 === 0) process.stdout.write(`    ${done}/${n} rows\r`)
    }
  }
  await Promise.all(Array.from({ length: width }, worker))
}

/* ---------------------------------------------------------------- *
 * The three levels
 * ---------------------------------------------------------------- */

/**
 * The NAC DTM around the site: `samples` a side, one pixel a sample, centred on
 * the pixel the site falls in. Float heights, with the file's no-data value
 * filled from the nearest valid neighbour along the row.
 */
async function nearLevel(samples) {
  // Check the layout against the TIFF's own tags before reading rows by offset.
  const head = await range(NAC.url, 0, 64 * 1024)
  const tag = (want) => {
    const n = head.readUInt16LE(8)
    for (let i = 0; i < n; i++) {
      const e = 10 + i * 12
      if (head.readUInt16LE(e) === want) return head.readUInt32LE(e + 8) & (head.readUInt16LE(e + 2) === 3 ? 0xffff : 0xffffffff)
    }
    return undefined
  }
  if (tag(256) !== NAC.width || tag(257) !== NAC.height || tag(259) !== 1 || tag(278) !== 1) {
    throw new Error('NAC_DTM_APOLLO11.TIF is not the uncompressed, row-per-strip image this reads')
  }
  if (head.readUInt32LE(tag(273)) !== NAC.dataOffset) throw new Error('NAC DTM data offset moved')

  const cosSP = Math.cos(NAC.standardParallel * DEG)
  const col = (lon) => (R * cosSP * (lon - NAC.centreLongitude) * DEG - NAC.x0) / NAC.metres - 0.5
  const row = (lat) => (NAC.y0 - R * lat * DEG) / NAC.metres - 0.5
  const siteCol = col(SITE.longitude)
  const siteRow = row(SITE.latitude)
  const c0 = Math.round(siteCol) - samples / 2 + 1
  const r0 = Math.round(siteRow) - samples / 2 + 1
  if (c0 < 0 || c0 + samples > NAC.width || r0 < 0 || r0 + samples > NAC.height) {
    throw new Error('the near level runs off the NAC DTM')
  }
  console.log(`  near: NAC DTM rows ${r0}-${r0 + samples - 1}, columns ${c0}-${c0 + samples - 1}`)
  const stride = NAC.width * 4
  const block = await range(NAC.url, NAC.dataOffset + r0 * stride, samples * stride)
  const h = new Float64Array(samples * samples)
  let filled = 0
  for (let j = 0; j < samples; j++) {
    let last = NaN
    for (let i = 0; i < samples; i++) {
      const v = block.readFloatLE(j * stride + (c0 + i) * 4)
      if (v > NAC.noData) last = v
      else filled++
      h[j * samples + i] = v > NAC.noData ? v : last
    }
    // A row that began in no-data: back-fill from its first valid sample.
    for (let i = samples - 1; i >= 0; i--) {
      if (Number.isNaN(h[j * samples + i])) h[j * samples + i] = last
      else last = h[j * samples + i]
    }
  }
  const latOf = (r) => ((NAC.y0 - (r + 0.5) * NAC.metres) / R) / DEG
  const lonOf = (c) => NAC.centreLongitude + ((NAC.x0 + (c + 0.5) * NAC.metres) / (R * cosSP)) / DEG
  return {
    heights: h,
    grid: {
      latTop: latOf(r0),
      latStep: latOf(r0 + 1) - latOf(r0),
      lonLeft: lonOf(c0),
      lonStep: lonOf(c0 + 1) - lonOf(c0),
    },
    site: { row: siteRow - r0, col: siteCol - c0 },
    metresPerSample: NAC.metres,
    source: 'LROC NAC DTM NAC_DTM_APOLLO11 v1.9 (ASU / NASA), 2 m',
    url: NAC.label,
    noData: filled,
  }
}

/**
 * A LOLA gridded DEM around the site: `samples` a side at `ppd` samples a
 * degree, snapped to the product's own pixel centres. `tiles(lat)` names the
 * file a latitude is in, with its first row's latitude and the file's width.
 */
async function lolaLevel(samples, ppd, tiles) {
  const siteLatRow = (90 - SITE.latitude) * ppd - 0.5 // global row, 0 at the north pole's first row
  const r0 = Math.round(siteLatRow) - samples / 2 + 1
  const h = new Float64Array(samples * samples)
  const lonCol = (lon) => lon * ppd - 0.5
  const c0Global = Math.round(lonCol(SITE.longitude)) - samples / 2 + 1
  const rows = []
  for (let j = 0; j < samples; j++) {
    const lat = 90 - (r0 + j + 0.5) / ppd
    const t = tiles(lat)
    const row = Math.round((t.north - lat) * ppd - 0.5)
    const col = c0Global - Math.round(t.west * ppd)
    if (col < 0 || col + samples > t.width) throw new Error(`level runs off ${t.file}`)
    rows.push({ j, url: `${LOLA}/${t.file}`, offset: (row * t.width + col) * 2 })
  }
  await pool(samples, 24, async (k) => {
    const { j, url, offset } = rows[k]
    const buf = await range(url, offset, samples * 2)
    for (let i = 0; i < samples; i++) h[j * samples + i] = buf.readInt16LE(i * 2) * 0.5
  })
  process.stdout.write('\n')
  return {
    heights: h,
    grid: {
      latTop: 90 - (r0 + 0.5) / ppd,
      latStep: -1 / ppd,
      lonLeft: (c0Global + 0.5) / ppd,
      lonStep: 1 / ppd,
    },
    site: { row: siteLatRow - r0, col: lonCol(SITE.longitude) - c0Global },
    metresPerSample: (R * DEG) / ppd,
    files: [...new Set(rows.map((r) => path.basename(r.url)))],
  }
}

/* ---------------------------------------------------------------- *
 * Writing
 * ---------------------------------------------------------------- */

/** Bilinear height at a fractional (row, col). */
function heightAt(level, n, row, col) {
  const r = Math.min(n - 2, Math.max(0, Math.floor(row)))
  const c = Math.min(n - 2, Math.max(0, Math.floor(col)))
  const fr = row - r
  const fc = col - c
  const h = level.heights
  const a = h[r * n + c] * (1 - fc) + h[r * n + c + 1] * fc
  const b = h[(r + 1) * n + c] * (1 - fc) + h[(r + 1) * n + c + 1] * fc
  return a * (1 - fr) + b * fr
}

/** Pack heights as 16-bit steps above a base in red and green; blue is zero. */
function write(id, level, samples, step) {
  let lo = Infinity
  let hi = -Infinity
  for (const v of level.heights) {
    lo = Math.min(lo, v)
    hi = Math.max(hi, v)
  }
  const base = Math.floor(lo / step) * step
  if ((hi - base) / step > 65535) throw new Error(`${id}: ${hi - lo} m of relief does not fit ${step} m steps`)
  const rgb = new Uint8Array(samples * samples * 3)
  for (let i = 0; i < samples * samples; i++) {
    const v = Math.round((level.heights[i] - base) / step)
    rgb[i * 3] = v >> 8
    rgb[i * 3 + 1] = v & 255
  }
  const file = `${id}.png`
  const png = encodePNGPaeth(rgb, samples, samples)
  fs.writeFileSync(path.join(DIR, file), png)
  const site = heightAt(level, samples, level.site.row, level.site.col)
  console.log(
    `  ${id.padEnd(5)} ${samples} x ${samples}, ${level.metresPerSample.toFixed(1)} m a sample, ` +
      `${Math.round(lo)} to ${Math.round(hi)} m, site at ${site.toFixed(2)} m   ${(png.length / 1e6).toFixed(2)} MB`,
  )
  return {
    id,
    file,
    samples,
    metresPerSample: level.metresPerSample,
    grid: level.grid,
    encoding: { base, step },
    site: { ...level.site, height: site },
    low: lo,
    high: hi,
    source: level.source,
    url: level.url,
    files: level.files,
  }
}

fs.mkdirSync(DIR, { recursive: true })
console.log(`${SITE.name}, ${SITE.latitude}°N ${SITE.longitude}°E`)

const near = await nearLevel(1024)
if (near.noData) console.log(`  (${near.noData} no-data samples in the near level, filled along their rows)`)

const LOLA_1024 = (lat) =>
  lat >= 0
    ? { file: 'ldem_1024_00n_15n_000_030.img', north: 15, west: 0, width: 30720 }
    : { file: 'ldem_1024_15s_00s_000_030.img', north: 0, west: 0, width: 30720 }
console.log('  mid: LOLA 1024 px/deg')
const mid = await lolaLevel(1024, 1024, LOLA_1024)
mid.source = 'LOLA LDEM 1024 px/deg (NASA GSFC / PDS Geosciences), 29.6 m'
mid.url = LOLA

const LOLA_256 = (lat) =>
  lat >= 0
    ? { file: 'ldem_256_00n_90n_000_180.img', north: 90, west: 0, width: 46080 }
    : { file: 'ldem_256_90s_00s_000_180.img', north: 0, west: 0, width: 46080 }
console.log('  far: LOLA 256 px/deg')
const far = await lolaLevel(2048, 256, LOLA_256)
far.source = 'LOLA LDEM 256 px/deg (NASA GSFC / PDS Geosciences), 118 m'
far.url = LOLA

const levels = [write('near', near, 1024, 0.01), write('mid', mid, 1024, 0.5), write('far', far, 2048, 0.5)]

fs.writeFileSync(
  path.join(DIR, 'manifest.json'),
  JSON.stringify(
    {
      site: SITE.id,
      name: SITE.name,
      latitude: SITE.latitude,
      longitude: SITE.longitude,
      reference: 'heights in metres relative to the 1737.4 km sphere',
      levels,
    },
    null,
    2,
  ) + '\n',
)
console.log(`\n  wrote ${levels.length} levels to ${DIR}/`)
