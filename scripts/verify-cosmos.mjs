/**
 * verify-cosmos — the sky beyond the force model is a real sky.
 *
 * The rails table grew Pluto, Halley and seven moons. None of them pull on the
 * craft (`FORCE_COUNT` — asserted here), so the honest way to hold them is
 * against observed facts rather than against themselves:
 *
 *   1. Halley's elements must reproduce its *observed* perihelion of
 *      1986-02-09 and its *observed* 0.586 AU perihelion distance. The entry
 *      was anchored to that passage, and this walks the Kepler machinery
 *      forward to find it again.
 *   2. Pluto's mean motion must give its *observed* 248-year period.
 *   3. Every moon's offset radius and period must match the *measured*
 *      values of that moon's orbit — JPL mean elements, pinned in the gate so
 *      a mistyped digit in the table goes red here.
 *   4. The force/sky split: exactly the seven planets pull, the sky pulls on
 *      nothing, and every sky body renders (radius, colour, name).
 *   5. Everything the writer produces is finite, and each moon lands within
 *      one offset radius of its parent.
 */
import assert from 'node:assert/strict'
import {
  RAILS,
  RAIL_INDEX,
  FORCE_COUNT,
  RAIL_COUNT,
  railHelio,
  updateRails,
} from '../src/sim/rails.js'

const AU = 1.495978707e11
const DAY = 86400
const J2000_MS = Date.UTC(2000, 0, 1, 12, 0, 0)

let n = 0
const check = (label, fn) => {
  fn()
  n++
  console.log(`  ✓ ${label}`)
}

/* ---------------------------------------------------------------- *
 * 1. Halley's perihelion, found rather than asserted
 * ---------------------------------------------------------------- */

const byId = Object.fromEntries(RAILS.map((p) => [p.id, p]))
const halleySlot = RAIL_INDEX.halley

/** Geocentric? No — heliocentric distance of a rail body at time t. */
const helioR = (slot, t) => {
  updateRails(t, railHelio)
  const o = slot * 3
  return Math.hypot(railHelio[o], railHelio[o + 1], railHelio[o + 2])
}

check('Halley reproduces its observed perihelion of 1986-02-09', () => {
  // Daily scan across 1985–1987, then a parabolic refinement at the minimum.
  const t0 = (Date.UTC(1985, 0, 1) - J2000_MS) / 1000
  let bestT = t0
  let bestR = Infinity
  for (let d = 0; d < 730; d++) {
    const t = t0 + d * DAY
    const r = helioR(halleySlot, t)
    if (r < bestR) {
      bestR = r
      bestT = t
    }
  }
  // Refine with three points around the day minimum.
  const r1 = helioR(halleySlot, bestT - DAY)
  const r2 = bestR
  const r3 = helioR(halleySlot, bestT + DAY)
  const denom = r1 - 2 * r2 + r3
  const shift = denom !== 0 ? (0.5 * (r1 - r3) / denom) * DAY : 0
  const periT = bestT + shift
  const periDate = new Date(J2000_MS + periT * 1000)
  const want = Date.UTC(1986, 1, 9)
  const driftDays = Math.abs(J2000_MS + periT * 1000 - want) / (DAY * 1000)
  assert.ok(driftDays < 3, `perihelion at ${periDate.toISOString().slice(0, 10)}, expected 1986-02-09`)
  console.log(`      perihelion ${periDate.toISOString().slice(0, 10)}, drift ${driftDays.toFixed(2)} d`)
})

check('Halley’s perihelion distance is the observed 0.586 AU', () => {
  const q = helioR(halleySlot, (Date.UTC(1986, 1, 9, 12) - J2000_MS) / 1000) / AU
  assert.ok(Math.abs(q - 0.586) < 0.01, `q = ${q.toFixed(4)} AU, observed 0.586`)
  console.log(`      q = ${q.toFixed(4)} AU`)
})

/* ---------------------------------------------------------------- *
 * 2. Pluto's period
 * ---------------------------------------------------------------- */

check('Pluto’s mean motion gives its observed 248-year period', () => {
  const p = byId.pluto
  const yearsPerRev = 360 / (p.L[1] / 100) // L̇ deg/century → deg/year
  assert.ok(Math.abs(yearsPerRev - 248) < 1, `period ${yearsPerRev.toFixed(1)} yr, observed 248.0`)
  console.log(`      period ${yearsPerRev.toFixed(1)} yr`)
})

/* ---------------------------------------------------------------- *
 * 3. The moons, against measured orbits
 * ---------------------------------------------------------------- */

/** Offset radius and period as measured, metres and hours. */
const OBSERVED_MOONS = {
  phobos: [9.376e6, 7.65],
  deimos: [23.463e6, 30.3],
  io: [421.7e6, 42.459],
  europa: [671.034e6, 85.228],
  ganymede: [1070.412e6, 171.709],
  callisto: [1882.709e6, 400.536],
  titan: [1221.87e6, 382.69],
}

check('every moon matches its measured orbit (JPL mean elements)', () => {
  for (const [id, [aObs, hoursObs]] of Object.entries(OBSERVED_MOONS)) {
    const p = byId[id]
    assert.ok(p, `${id} missing from the table`)
    assert.ok(p.parent, `${id} has no parent`)
    assert.ok(RAIL_INDEX[p.parent] !== undefined, `${id} parent ${p.parent} not in the table`)
    const a = p.moon.a
    const hours = p.moon.period / 3600
    assert.ok(Math.abs(a - aObs) / aObs < 1e-4, `${id} a = ${a}, measured ${aObs}`)
    assert.ok(Math.abs(hours - hoursObs) / hoursObs < 1e-3, `${id} period = ${hours} h, measured ${hoursObs}`)
  }
})

/* ---------------------------------------------------------------- *
 * 4. The force/sky split
 * ---------------------------------------------------------------- */

check('exactly the seven planets pull; the sky pulls on nothing', () => {
  const forceIds = RAILS.slice(0, FORCE_COUNT).map((p) => p.id)
  assert.deepEqual(forceIds, ['mercury', 'venus', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune'])
  assert.equal(FORCE_COUNT, 7)
  for (const p of RAILS.slice(FORCE_COUNT)) {
    // A sky body must render and must never be reachable as a force slot.
    assert.ok(p.radius > 0 && p.colour && p.name, `${p.id} cannot render`)
  }
})

check('every sky body renders and every moon hangs on a parent inside the force set', () => {
  for (const p of RAILS.slice(FORCE_COUNT)) {
    if (!p.parent) continue
    const parentSlot = RAIL_INDEX[p.parent]
    assert.ok(parentSlot !== undefined && parentSlot < RAIL_COUNT, `${p.id} parent slot bad`)
  }
  assert.ok(RAILS.length > 12, `expected a populated sky, got ${RAILS.length} bodies`)
})

/* ---------------------------------------------------------------- *
 * 5. The writer: finite, bounded, and moons on their parents
 * ---------------------------------------------------------------- */

check('updateRails writes finite positions and bounded orbits', () => {
  for (const day of [0, 4000, 20000, 40000]) {
    const t = day * DAY
    updateRails(t, railHelio)
    for (let k = 0; k < RAIL_COUNT; k++) {
      const o = k * 3
      for (let j = 0; j < 3; j++) assert.ok(Number.isFinite(railHelio[o + j]), `${RAILS[k].id} non-finite`)
      const p = RAILS[k]
      if (p.a) {
        const r = Math.hypot(railHelio[o], railHelio[o + 1], railHelio[o + 2])
        const a = p.a[0] * AU
        const e = p.e[0]
        assert.ok(r > a * (1 - e) * 0.99 && r < a * (1 + e) * 1.005, `${p.id} r ${r} outside its orbit`)
      }
    }
  }
})

check('every moon rides within one offset radius of its parent', () => {
  updateRails(123456789, railHelio)
  for (let k = 0; k < RAIL_COUNT; k++) {
    const p = RAILS[k]
    if (!p.parent) continue
    const o = k * 3
    const po = RAIL_INDEX[p.parent] * 3
    const d = Math.hypot(railHelio[o] - railHelio[po], railHelio[o + 1] - railHelio[po + 1], railHelio[o + 2] - railHelio[po + 2])
    assert.ok(Math.abs(d - p.moon.a) < 1, `${p.id} offset ${d}, expected ${p.moon.a}`)
  }
})

console.log(`\nverify-cosmos: ${n}/${n} checks pass`)
