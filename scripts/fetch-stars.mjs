/**
 * The real sky, from the Hipparcos catalogue.
 *
 * The backdrop was a painted Milky Way on a sphere, which is fine until someone
 * looks for Orion. This fetches the ESA Hipparcos main catalogue — 118,218 stars
 * measured by a satellite built to do nothing else — and stores the three things
 * a sky needs from each one: where it is, how bright it is, and what colour it
 * is. Keyless and public, from the CDS archive at Strasbourg, for the same
 * reason the terrain tiles are: a star field that only renders for someone
 * holding an API key would not be one.
 *
 * Three things are done to the catalogue on the way through, and each is a
 * decision rather than a detail.
 *
 * **The epoch is moved.** Hipparcos positions are ICRS at J1991.25, and this
 * simulator's epoch is J2000.0 — 8.75 years later. Most stars do not care;
 * Barnard's star moves 88 arcseconds in that time, Proxima 33, and both would
 * sit visibly wrong against a planet that is in the right place. The proper
 * motions are in the catalogue, so they are applied:
 *
 *   alpha += pmRA * dt / cos(delta),   delta += pmDE * dt
 *
 * where `pmRA` is already mu_alpha cos(delta), as the catalogue's own byte
 * description says.
 *
 * **The frame stays equatorial.** ICRS is what the catalogue is in, and the
 * rotation into the scene's ecliptic frame is Earth's obliquity — which this
 * repository keeps in exactly one place, `SPIN_AXIS`. Baking that rotation into
 * the asset would put a second copy of the obliquity on disk, where it could
 * not follow a correction to the first. `src/gfx/stars.js` does the rotation at
 * load, out of the same constant the atmosphere and the launch sites use, and
 * `verify-stars` checks the two agree by looking for Polaris on the spin axis.
 *
 * **It is quantised.** Each record is five 16-bit integers: the unit vector, the
 * V magnitude, and the B-V colour index. A direction quantised to 1/32767 is
 * good to about 6 arcseconds, which is finer than a pixel at any zoom this
 * renderer offers and coarser than nothing that matters. That is 10 bytes a
 * star, 1.13 MB for the catalogue, against 2.4 MB of float32.
 *
 * Records come out sorted brightest first, so a client that wants only the
 * naked-eye sky reads a prefix rather than filtering 118,000 rows.
 *
 *   node scripts/fetch-stars.mjs
 */
import fs from 'node:fs'
import path from 'node:path'

const SOURCE = 'https://cdsarc.cds.unistra.fr/ftp/I/239/hip_main.dat'
const DIR = 'public/stars'
const OUT = 'hipparcos.bin'

/** Catalogue epoch to J2000.0, years. Hipparcos astrometry is at J1991.25. */
const EPOCH_SHIFT = 2000.0 - 1991.25

/** Bytes per record: 3 direction + magnitude + colour, all Int16. */
export const RECORD = 10

/** What a missing B-V is stored as — the one value the colour scale cannot mean. */
export const NO_COLOUR = -32768

const DEG = Math.PI / 180
/** Milliarcseconds to degrees. */
const MAS = 1 / 3.6e6

/** Fixed-width field, by the catalogue's own 1-based byte description. */
const field = (line, from, to) => line.slice(from - 1, to).trim()

console.log(`  fetching ${SOURCE}`)
const res = await fetch(SOURCE)
if (!res.ok) throw new Error(`${SOURCE}: ${res.status}`)
const text = Buffer.from(await res.arrayBuffer()).toString('latin1')
const lines = text.split('\n')
console.log(`  ${lines.length} lines, ${(text.length / 1e6).toFixed(1)} MB`)

const stars = []
let noPosition = 0
let noMagnitude = 0
let noColour = 0
let moved = 0
let worstMotion = 0
let worstHip = 0

for (const line of lines) {
  if (line.length < 260) continue
  const raText = field(line, 52, 63)
  const deText = field(line, 65, 76)
  const vText = field(line, 42, 46)
  if (!raText || !deText) {
    noPosition++
    continue
  }
  if (!vText) {
    noMagnitude++
    continue
  }
  let ra = Number(raText)
  let de = Number(deText)
  const vmag = Number(vText)
  if (!Number.isFinite(ra) || !Number.isFinite(de) || !Number.isFinite(vmag)) {
    noPosition++
    continue
  }

  // J1991.25 -> J2000.0. pmRA is already mu_alpha cos(delta).
  const pmRA = Number(field(line, 88, 95)) || 0
  const pmDE = Number(field(line, 97, 104)) || 0
  if (pmRA !== 0 || pmDE !== 0) {
    const cosDe = Math.cos(de * DEG)
    const dDe = pmDE * EPOCH_SHIFT * MAS
    const dRa = cosDe > 1e-9 ? (pmRA * EPOCH_SHIFT * MAS) / cosDe : 0
    // The angle actually travelled on the sky, which is what "moved" means.
    const arc = Math.hypot(dDe, dRa * cosDe) * 3600
    if (arc > worstMotion) {
      worstMotion = arc
      worstHip = Number(field(line, 9, 14))
    }
    if (arc > 1) moved++
    ra += dRa
    de += dDe
  }

  const bvText = field(line, 246, 251)
  let bv = NO_COLOUR
  if (bvText) {
    const v = Number(bvText)
    if (Number.isFinite(v)) bv = Math.round(v * 1000)
    else noColour++
  } else noColour++

  const a = ra * DEG
  const d = de * DEG
  const cd = Math.cos(d)
  stars.push({
    // ICRS equatorial unit vector: +x to the equinox, +z to the north pole.
    x: cd * Math.cos(a),
    y: cd * Math.sin(a),
    z: Math.sin(d),
    vmag,
    bv,
  })
}

// Brightest first, so a magnitude cut is a prefix.
stars.sort((p, q) => p.vmag - q.vmag)

const buf = Buffer.alloc(stars.length * RECORD)
let o = 0
for (const s of stars) {
  buf.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(s.x * 32767))), o)
  buf.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(s.y * 32767))), o + 2)
  buf.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(s.z * 32767))), o + 4)
  // Magnitudes run about -1.5 to 14; x100 fits Int16 with room to spare.
  buf.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(s.vmag * 100))), o + 6)
  buf.writeInt16LE(s.bv === NO_COLOUR ? NO_COLOUR : Math.max(-32767, Math.min(32767, s.bv)), o + 8)
  o += RECORD
}

fs.mkdirSync(DIR, { recursive: true })
fs.writeFileSync(path.join(DIR, OUT), buf)

/** How many stars are brighter than each of these, for the client and the gate. */
const CUTS = [1, 2, 3, 4, 5, 6, 6.5, 7, 8, 10, 12]
const brighterThan = {}
for (const m of CUTS) brighterThan[m] = stars.filter((s) => s.vmag < m).length

fs.writeFileSync(
  path.join(DIR, 'manifest.json'),
  JSON.stringify(
    {
      catalogue: 'Hipparcos main catalogue (ESA 1997), I/239/hip_main',
      source: SOURCE,
      frame: 'ICRS equatorial unit vectors',
      epoch: 'J2000.0, proper motion applied from J1991.25',
      file: OUT,
      record: RECORD,
      layout: 'Int16LE x, y, z (/32767), Vmag (x100), B-V (x1000; -32768 = unknown)',
      count: stars.length,
      brightest: stars[0].vmag / 1,
      faintest: stars[stars.length - 1].vmag,
      noColour,
      brighterThan,
    },
    null,
    2,
  ) + '\n',
)

console.log(`  kept ${stars.length} stars; dropped ${noPosition} without a position, ${noMagnitude} without a magnitude`)
console.log(`  ${noColour} have no B-V and are stored as unknown`)
console.log(`  ${moved} moved more than an arcsecond between the epochs; worst HIP ${worstHip} at ${worstMotion.toFixed(1)}"`)
console.log(`  magnitudes ${stars[0].vmag.toFixed(2)} to ${stars[stars.length - 1].vmag.toFixed(2)}`)
console.log(`  naked eye (V < 6.5): ${brighterThan[6.5]}`)
console.log(`  wrote ${(buf.length / 1e6).toFixed(2)} MB to ${DIR}/${OUT}`)
