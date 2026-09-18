/**
 * The ground under each pad, against what is published about those pads.
 *
 * The risk in a heightfield fetched from tiles is not that the numbers are
 * wrong — they are SRTM — it is that they are indexed wrong. Web Mercator is
 * not linear in latitude, tile rows run north to south while most grids run the
 * other way, and any of those mistakes produces a perfectly plausible landscape
 * belonging to somewhere else. So this samples each grid at the pad's own
 * coordinates and checks the elevation against the figure published for that
 * launch complex. Getting four of those right by accident is not likely.
 *
 *   node scripts/verify-terrain.mjs
 */
import fs from 'node:fs'
import { decodePNG } from './png.mjs'
import { LAUNCH_SITES } from '../src/sim/launchsite.js'

/** Published elevations, metres above sea level, for the pads the sites name. */
const PUBLISHED = {
  ksc: { name: 'Kennedy LC-39B', metres: 3, tolerance: 12 },
  /*
   * The loosest of the four, and deliberately. "90 m" is the figure published
   * for the cosmodrome, which spans 72 to 143 m inside this grid alone; it is
   * not a surveyed pad elevation the way the other three are. The grid reads
   * 111.6 m at Site 1/5's coordinates, which is mid-range for the area — and
   * the other three land within 2.4 m of their published figures, which is
   * where the confidence in the indexing actually comes from.
   */
  baikonur: { name: 'Baikonur Site 1/5', metres: 90, tolerance: 30 },
  kourou: { name: 'Kourou ELA-3', metres: 10, tolerance: 20 },
  vandenberg: { name: 'Vandenberg SLC-6', metres: 100, tolerance: 45 },
}

const xToLon = (x, z) => (x / 2 ** z) * 360 - 180
const yToLat = (y, z) => {
  const n = Math.PI - (2 * Math.PI * y) / 2 ** z
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)))
}

const manifest = JSON.parse(fs.readFileSync('public/terrain/manifest.json', 'utf8'))

console.log('=== the sample under each pad ===')
console.log('  site          published      measured      error     grid            relief')
let worstError = 0
let allInside = true
let allResolved = true
const seaLevel = {}

for (const entry of manifest.sites) {
  const site = LAUNCH_SITES[entry.id]
  const img = decodePNG(fs.readFileSync(`public/terrain/${entry.id}.png`))
  const n = entry.samples
  const height = (x, y) => {
    const o = (y * img.width + x) * img.channels
    return img.data[o] * 256 + img.data[o + 1] + img.data[o + 2] / 256 - 32768
  }

  // Where the pad falls in the grid, by the same inversion the renderer uses.
  const west = xToLon(entry.tileX, entry.zoom)
  const east = xToLon(entry.tileX + entry.tileSpan, entry.zoom)
  const gx = Math.round(((site.longitude - west) / (east - west)) * (n - 1))
  let lo = 0
  let hi = n - 1
  for (let k = 0; k < 40; k++) {
    const mid = (lo + hi) / 2
    if (yToLat(entry.tileY + (mid / (n - 1)) * entry.tileSpan, entry.zoom) > site.latitude) lo = mid
    else hi = mid
  }
  const gy = Math.round((lo + hi) / 2)

  const inside = gx > 0 && gx < n - 1 && gy > 0 && gy < n - 1
  if (!inside) allInside = false

  const measured = height(gx, gy)
  const want = PUBLISHED[entry.id]
  const error = Math.abs(measured - want.metres)
  if (error > want.tolerance) allResolved = false
  worstError = Math.max(worstError, error / Math.max(want.tolerance, 1))

  // Relief the pad can actually see, relative to the pad itself.
  let high = -Infinity
  for (let i = 0; i < n * n; i++) {
    const h = height(i % n, Math.floor(i / n))
    if (h > high) high = h
  }
  seaLevel[entry.id] = entry.low

  console.log(
    `  ${entry.id.padEnd(12)}${String(want.metres).padStart(7)} m` +
      `${measured.toFixed(1).padStart(13)} m${error.toFixed(1).padStart(10)} m` +
      `    ${gx},${gy}`.padEnd(16) +
      `${(high - measured).toFixed(0).padStart(7)} m above the pad`,
  )
}

/* ---- the patch is the size it claims, and the datum is sea level ---- */
console.log('\n=== extent and datum ===')
let sized = true
for (const entry of manifest.sites) {
  const perSample = entry.width / entry.samples
  // Terrarium is 1 arcsecond data resampled; at zoom 12 a stored sample is a
  // little over 100 m at these latitudes, and nothing here should be outside
  // 90-170 m or the tile maths has gone wrong.
  if (!(perSample > 90 && perSample < 170)) sized = false
  console.log(
    `  ${entry.id.padEnd(12)}${(entry.width / 1000).toFixed(0)} x ${(entry.height / 1000).toFixed(0)} km` +
      `   ${perSample.toFixed(0)} m a sample   ${entry.low} to ${entry.high} m`,
  )
}

/**
 * Coastal sites reach below sea level and inland ones do not — a cheap check
 * that each grid is over the place it says. Terrarium carries bathymetry, so
 * Vandenberg and Kennedy and Kourou all have water in frame and Baikonur, a
 * thousand kilometres from any sea, has none.
 */
const coastal = ['ksc', 'kourou', 'vandenberg'].every((id) => seaLevel[id] < 0)
const inland = seaLevel.baikonur > 0

console.log('\n=== what this establishes ===')
const checks = [
  ['every pad falls inside its own grid', allInside],
  ['and its elevation matches the published figure', allResolved],
  ['the three coastal sites carry water, at negative elevation', coastal],
  ['Baikonur, a thousand km from any sea, carries none', inland],
  ['every patch is 90-170 m a sample', sized],
]
let pass = true
for (const [label, ok] of checks) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`)
  if (!ok) pass = false
}
console.log(`\n  worst elevation error, as a fraction of its tolerance: ${worstError.toFixed(2)}`)
console.log(`  ${pass ? 'PASS' : 'FAIL'}`)
process.exit(pass ? 0 : 1)
