/**
 * verify-deep-sky — the sky beyond the planets is where the catalogues say.
 *
 * `sim/cosmos.js` places named stars, nebulae, clusters and galaxies from
 * published astrometry. Typed by hand, a table like that is one transposed
 * digit from putting Sirius in the wrong constellation, so this holds it
 * against measurements it did not come from:
 *
 *   1. The ICRS→galactic rotation is a rotation, and it recovers the two
 *      points that define it — the north galactic pole and l = 0 — and the
 *      published galactic coordinates of eight objects from their equatorial
 *      ones.
 *   2. Every named star bright enough for Hipparcos lands on a Hipparcos star
 *      of its own magnitude within an arcminute. The catalogue is the one the
 *      star field draws (`public/stars/hipparcos.bin`), so the named stars and
 *      the field cannot disagree about where a star is.
 *   3. The Galaxy's frame: Sgr A* at its origin, the Sun R0 from it and zSun
 *      above the plane, and the frame the renderer is handed pointing the
 *      same way as the table's own Sgr A*.
 *   4. Every place is on the map with a finite position and a size, and the
 *      search finds it by its common names.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  ICRS_TO_GALACTIC,
  GALAXY,
  NAMED_STARS,
  DEEP_SKY,
  GALAXIES,
  GALAXY_CLUSTERS,
  MILKY_WAY_FRAME,
  KILOPARSEC,
  PARSEC,
  VARIABLE,
  galacticLB,
  hms,
  dms,
  icrsUnit,
  toGalactocentric,
  fromGalactocentric,
  icrsToGalactic,
} from '../src/sim/cosmos.js'
import { COSMIC } from '../src/sim/cosmic.js'
import { search } from '../src/sim/catalog.js'
import { sceneToEquatorial } from '../src/gfx/stars.js'

let n = 0
const check = (label, fn) => {
  fn()
  n++
  console.log(`  ✓ ${label}`)
}
const DEG = Math.PI / 180

/* ---------------------------------------------------------------- *
 * 1. Galactic coordinates
 * ---------------------------------------------------------------- */

check('ICRS→galactic is a proper rotation', () => {
  const M = ICRS_TO_GALACTIC
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      const d = M[i][0] * M[j][0] + M[i][1] * M[j][1] + M[i][2] * M[j][2]
      assert.ok(Math.abs(d - (i === j ? 1 : 0)) < 1e-12, `rows ${i},${j} dot ${d}`)
    }
  }
  const det =
    M[0][0] * (M[1][1] * M[2][2] - M[1][2] * M[2][1]) -
    M[0][1] * (M[1][0] * M[2][2] - M[1][2] * M[2][0]) +
    M[0][2] * (M[1][0] * M[2][1] - M[1][1] * M[2][0])
  assert.ok(Math.abs(det - 1) < 1e-12, `determinant ${det}`)
})

const angle = (a, b) => Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]))) / DEG

check('it recovers its own definition: the galactic pole and l = 0', () => {
  const ngp = icrsUnit([0, 0, 0], 192.85948 * DEG, 27.12825 * DEG)
  const [, b] = galacticLB(ngp)
  assert.ok(Math.abs(b - 90) < 1e-4, `NGP at b = ${b}`)
  const l0 = icrsUnit([0, 0, 0], 266.40499 * DEG, -28.93617 * DEG)
  const [l, b0] = galacticLB(l0)
  assert.ok(Math.min(l, 360 - l) < 1e-4 && Math.abs(b0) < 1e-4, `l = 0 point at (${l}, ${b0})`)
})

/**
 * Published galactic coordinates (SIMBAD), for objects whose equatorial
 * positions are typed independently below. Agreement to 0.02° is what the
 * table's arcsecond-rounded positions allow.
 */
const KNOWN_LB = [
  ['Sirius', '06 45 08.92', '-16 42 58.0', 227.23, -8.89],
  ['Vega', '18 36 56.34', '+38 47 01.3', 67.45, 19.24],
  ['Deneb', '20 41 25.92', '+45 16 49.2', 84.28, 1.99],
  ['Betelgeuse', '05 55 10.31', '+07 24 25.4', 199.79, -8.96],
  ['Polaris', '02 31 49.09', '+89 15 50.8', 123.28, 26.46],
  ['Andromeda', '00 42 44.3', '+41 16 09', 121.17, -21.57],
  ['LMC', '05 23 34.5', '-69 45 22', 280.47, -32.89],
  ['Sgr A*', '17 45 40.04', '-29 00 28.1', 359.944, -0.046],
  ['Eta Carinae', '10 45 03.59', '-59 41 04.3', 287.597, -0.630],
]
for (const [name, ra, dec, l, b] of KNOWN_LB) {
  check(`${name} comes out at its published (l, b) = (${l}, ${b})`, () => {
    const [gl, gb] = galacticLB(icrsUnit([0, 0, 0], hms(ra), dms(dec)))
    const dl = Math.min(Math.abs(gl - l), 360 - Math.abs(gl - l)) * Math.cos(b * DEG)
    assert.ok(Math.hypot(dl, gb - b) < 0.02, `${name} at (${gl.toFixed(3)}, ${gb.toFixed(3)})`)
  })
}

/* ---------------------------------------------------------------- *
 * 2. The named stars are Hipparcos stars
 * ---------------------------------------------------------------- */

const bin = readFileSync(new URL('../public/stars/hipparcos.bin', import.meta.url))
const view = new DataView(bin.buffer, bin.byteOffset, bin.byteLength)
const HIP = []
for (let o = 0; o + 10 <= bin.byteLength; o += 10) {
  const x = view.getInt16(o, true) / 32767
  const y = view.getInt16(o + 2, true) / 32767
  const z = view.getInt16(o + 4, true) / 32767
  const l = Math.hypot(x, y, z)
  HIP.push([x / l, y / l, z / l, view.getInt16(o + 6, true) / 100])
}

/** Hipparcos reaches V ≈ 12.4 at its faint end; fainter named stars are not in it. */
const HIP_LIMIT = 12.4

/**
 * Named stars the drawn catalogue does not hold. `fetch-stars.mjs` keeps
 * 117,955 of Hipparcos's 118,218 records — the rest have no usable position or
 * magnitude — and Eta Carinae, buried in its own nebula, is not among those
 * kept: there is no star within 7′ of it in the file. Its position is held to
 * its published galactic coordinates in section 1 instead.
 */
const NOT_IN_FIELD = new Set(['eta-carinae'])

check(`every named star Hipparcos could see is a Hipparcos star, within 1′ and its magnitude`, () => {
  const report = []
  for (const s of NAMED_STARS) {
    if (s.v > HIP_LIMIT || NOT_IN_FIELD.has(s.id)) continue
    // Its direction, recovered from the scene position the renderer uses.
    const e = sceneToEquatorial([0, 0, 0], s.abs.x, s.abs.y, s.abs.z)
    const len = Math.hypot(e[0], e[1], e[2])
    const u = [e[0] / len, e[1] / len, e[2] / len]
    let best = null
    for (const h of HIP) {
      const sep = angle(u, h) * 60
      if (sep > 1) continue
      const dv = Math.abs(h[3] - s.v)
      if (!best || dv < best.dv) best = { sep, dv, v: h[3] }
    }
    const tol = VARIABLE.has(s.id) ? 1.6 : 0.25
    if (!best || best.dv > tol) report.push(`${s.name}: ${best ? `nearest match V=${best.v} at ${best.sep.toFixed(2)}′` : 'no Hipparcos star within 1′'} (table V=${s.v})`)
  }
  assert.ok(report.length === 0, `\n    ${report.join('\n    ')}`)
})

check('a star’s absolute magnitude reproduces its catalogue magnitude from the Sun', () => {
  for (const s of NAMED_STARS) {
    const d = s.abs.length() / PARSEC
    const m = s.absMag + 5 * Math.log10(d / 10)
    assert.ok(Math.abs(m - s.v) < 1e-9, `${s.name}: ${m} vs ${s.v}`)
    assert.ok(Math.abs(d - s.pc) / s.pc < 1e-12, `${s.name} placed at ${d} pc, table says ${s.pc}`)
  }
})

/* ---------------------------------------------------------------- *
 * 3. The Galaxy's frame
 * ---------------------------------------------------------------- */

check('Sgr A* is the galactocentric origin, and the Sun is R0 from it and zSun above the plane', () => {
  const sgr = DEEP_SKY.find((o) => o.id === 'sagittarius-a')
  const g = icrsToGalactic([0, 0, 0], icrsUnit([0, 0, 0], sgr.ra, sgr.dec))
  const q = toGalactocentric([0, 0, 0], g.map((c) => c * GALAXY.R0))
  assert.ok(Math.hypot(...q) < 0.001, `Sgr A* is ${Math.hypot(...q) * 1000} pc from the origin`)
  const sun = toGalactocentric([0, 0, 0], [0, 0, 0])
  assert.ok(Math.abs(Math.hypot(...sun) - GALAXY.R0) < 1e-9, `Sun ${Math.hypot(...sun)} kpc out`)
  assert.ok(Math.abs(sun[2] - GALAXY.zSun) < 1e-9, `Sun ${sun[2] * 1000} pc above the plane`)
  assert.ok(Math.abs(sun[1]) < 1e-9 && sun[0] < 0, `Sun at (${sun}) — should be on −x`)
  const back = fromGalactocentric([0, 0, 0], sun)
  assert.ok(Math.hypot(...back) < 1e-12, 'the round trip does not return the Sun home')
})

check('the frame the renderer draws the Galaxy in agrees with the table', () => {
  const c = MILKY_WAY_FRAME.centre
  assert.ok(Math.abs(c.length() / KILOPARSEC - GALAXY.R0) < 1e-6, `centre ${c.length() / KILOPARSEC} kpc`)
  const sgr = DEEP_SKY.find((o) => o.id === 'sagittarius-a').abs
  const off = (c.angleTo(sgr) * 180) / Math.PI
  assert.ok(off < 0.01, `the drawn centre is ${off}° from Sgr A*`)
  // The disc normal is the north galactic pole, tipped 0.15° by zSun.
  const e = MILKY_WAY_FRAME.basis.elements
  const zs = sceneToEquatorial([0, 0, 0], e[8], e[9], e[10])
  const [, b] = galacticLB(zs)
  assert.ok(Math.abs(b - 90) < 0.2, `the drawn disc normal is at b = ${b}`)
  // Rotation: the Sun moves toward l = 90°, which is +y.
  const ys = sceneToEquatorial([0, 0, 0], e[4], e[5], e[6])
  const [ly, by] = galacticLB(ys)
  assert.ok(Math.abs(ly - 90) < 0.2 && Math.abs(by) < 0.2, `+y points at (${ly}, ${by})`)
})

/* ---------------------------------------------------------------- *
 * 4. On the map, and findable
 * ---------------------------------------------------------------- */

check('every place is on the map with a finite position and a size', () => {
  const ids = [
    ...NAMED_STARS.map((s) => s.id),
    ...DEEP_SKY.map((o) => o.id),
    ...GALAXIES.map((g) => g.id),
    ...GALAXY_CLUSTERS.map((c) => c.id),
    'alpha-centauri',
    'milky-way',
    'local-group',
    'laniakea',
    'observable-universe',
    'oort-cloud',
    'heliosphere',
  ]
  for (const id of ids) {
    const c = COSMIC[id]
    assert.ok(c, `${id} is not registered`)
    assert.ok([c.abs.x, c.abs.y, c.abs.z].every(Number.isFinite), `${id} is nowhere`)
    assert.ok(c.radius > 0 && c.frame > 0, `${id} has no size`)
  }
  assert.equal(new Set(ids).size, ids.length, 'two places share an id')
})

const FINDS = [
  ['sirius', 'sirius'],
  ['andromeda', 'andromeda'],
  ['m31', 'andromeda'],
  ['milky way', 'milky-way'],
  ['orion nebula', 'orion-nebula'],
  ['m42', 'orion-nebula'],
  ['pleiades', 'pleiades'],
  ['alpha centauri', 'alpha-centauri'],
  ['proxima', 'proxima'],
  ['betelgeuse', 'betelgeuse'],
  ['betelguese', 'betelgeuse'],
  ['black hole', 'sagittarius-a'],
  ['pillars of creation', 'eagle-nebula'],
  ['sombrero', 'sombrero'],
  ['universe', 'observable-universe'],
  ['sun', 'sun'],
  ['neptune', 'neptune'],
]
for (const [q, want] of FINDS) {
  check(`searching "${q}" finds ${want} first`, () => {
    const got = search(q, 3)
    assert.ok(got.length, `nothing found for "${q}"`)
    assert.equal(got[0].id, want, `"${q}" → ${got.map((e) => e.id).join(', ')}`)
  })
}

console.log(`\nverify-deep-sky: ${n} checks pass`)
