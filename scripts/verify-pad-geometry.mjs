/**
 * The pads, built and measured.
 *
 * gfx/padGeometry.js is pure three.js so that it can run here, and the
 * things worth measuring are the ones a screenshot judges by eye: does every
 * material's merge actually produce a mesh (mixing indexed and non-indexed
 * geometry makes mergeGeometries return null, which is a crash in the
 * component and invisible to every other gate); does the complex touch the
 * ground and never float above it; does it stay out of the volume the vehicle
 * is drawn in; is there a deck at the height the hull is lifted to.
 *
 *   node scripts/verify-pad-geometry.mjs
 *   PERIAPSIS_VESSEL=artemis node scripts/verify-pad-geometry.mjs
 */
import { existsSync } from 'node:fs'
import { ARM_GAP, ARM_SWING, buildPad, swingPoint } from '../src/gfx/padGeometry.js'
import { hullRadiusBetween, padFor, vehicleFootprint } from '../src/gfx/pads.js'
import { HULL_PROFILES } from '../src/gfx/hullProfiles.js'
import { MODEL_BY_ID } from '../src/gfx/modelsManifest.js'
import { LAUNCH_SITES } from '../src/sim/launchsite.js'
import { ACTIVE_VESSEL, VESSELS } from '../src/sim/vessels.js'

const foot = vehicleFootprint()
const L = foot.length
/** Apron top, and how far under the datum foundations are allowed to reach. */
const APRON_TOP = 0.3
const FOUNDATION = 3.5
/** Samples through an arm's swing: one a degree. */
const SWING_STEPS = 90
/**
 * How exactly a mated arm can be expected to end where it was built to. The
 * geometry is stored in 32-bit floats, and an arm's coordinates run to about
 * 25 m from its hinge, which float32 resolves to 2e-6 m; a few of those.
 */
const FLOAT32_AT_ARM = 25 * 2 ** -23

/*
 * Where an arm is, exactly. The arm is boxes, and a box's nearest point to the
 * vehicle's axis is usually in the middle of a face — its corners are further
 * out — so the vertices alone overstate every gap and can miss a face passing
 * through the hull between them. Each triangle is projected onto the ground
 * plane, where the axis is a point and the distance to it is exact, and held
 * against the hull as drawn across that triangle's own heights.
 */
function toSegment(ax, az, bx, bz) {
  const dx = bx - ax
  const dz = bz - az
  const l2 = dx * dx + dz * dz
  let t = l2 > 0 ? -(ax * dx + az * dz) / l2 : 0
  t = t < 0 ? 0 : t > 1 ? 1 : t
  return Math.hypot(ax + t * dx, az + t * dz)
}
function fromAxis(ax, az, bx, bz, cx, cz) {
  const area = (bx - ax) * (cz - az) - (bz - az) * (cx - ax)
  if (Math.abs(area) > 1e-9) {
    const s1 = (bx - ax) * -az - (bz - az) * -ax
    const s2 = (cx - bx) * -bz - (cz - bz) * -bx
    const s3 = (ax - cx) * -cz - (az - cz) * -cx
    if ((s1 >= 0 && s2 >= 0 && s3 >= 0) || (s1 <= 0 && s2 <= 0 && s3 <= 0)) return 0
  }
  return Math.min(toSegment(ax, az, bx, bz), toSegment(bx, bz, cx, cz), toSegment(cx, cz, ax, az))
}

console.log(`=== ${ACTIVE_VESSEL}: ${L.toFixed(1)} m stack, reach ${foot.reach.toFixed(2)} m ===`)
console.log('  site         meshes  triangles   lowest    highest   nearest to axis (above deck)')

const rows = []
for (const id of Object.keys(LAUNCH_SITES)) {
  const pad = padFor(id)
  const { meshes, arms } = buildPad(id)
  /*
   * The arms, swept. They left the merged steel so they could move, which also
   * took them out of the "nothing inside the vehicle" check below — and they
   * were the structure closest to the vehicle, so that was the check that
   * mattered for them. Put back, and made stronger: every vertex of every arm is
   * tested at eleven points through its swing, not only where it rests, because
   * an arm that starts clear and ends clear can still pass through the hull in
   * between.
   */
  let armNearest = Infinity
  let armClearAtEnd = Infinity
  const matedGaps = []
  const oldGaps = []
  const t = [[0, 0, 0], [0, 0, 0], [0, 0, 0]]
  for (const a of arms) {
    const pos = a.geometry.getAttribute('position')
    const index = a.geometry.getIndex()
    const corner = (n) => (index ? index.getX(n) : n)
    const count = index ? index.count : pos.count
    /*
     * A degree at a time. The carrier is 3.2 m wide, so as an arm starts to
     * turn, the edge of its face sweeps in toward the vehicle before the whole
     * arm draws away — nearest a few degrees in, which eleven samples nine
     * degrees apart stepped straight over.
     */
    for (let k = 0; k <= SWING_STEPS; k++) {
      const angle = (ARM_SWING * k) / SWING_STEPS
      let armGap = Infinity
      for (let n = 0; n < count; n += 3) {
        for (let c = 0; c < 3; c++) {
          const i = corner(n + c)
          swingPoint(t[c], a.hinge, pos.getX(i), pos.getY(i), pos.getZ(i), angle)
        }
        const y0 = Math.max(0, Math.min(t[0][1], t[1][1], t[2][1]) - pad.deck)
        const y1 = Math.min(L, Math.max(t[0][1], t[1][1], t[2][1]) - pad.deck)
        if (y1 <= 0.05 || y0 >= L) continue
        const d = fromAxis(t[0][0], t[0][2], t[1][0], t[1][2], t[2][0], t[2][2])
        armGap = Math.min(armGap, d - hullRadiusBetween(y0, y1))
        if (k === SWING_STEPS && d < armClearAtEnd) armClearAtEnd = d
      }
      if (armGap < armNearest) armNearest = armGap
      if (k === 0) {
        matedGaps.push(armGap)
        // Where the construction this replaced ended it: at the vehicle's reach.
        const h = a.hinge[1] - pad.deck
        oldGaps.push(foot.reach * 1.02 - hullRadiusBetween(h - 1.3, h + 1.3))
      }
    }
  }
  let triangles = 0
  let nearest = Infinity
  let deckVertices = 0
  let lowest = Infinity
  let highest = -Infinity
  for (const m of meshes) {
    const g = m.geometry
    const pos = g.getAttribute('position')
    triangles += (g.index ? g.index.count : pos.count) / 3
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i)
      const y = pos.getY(i)
      const z = pos.getZ(i)
      if (y < lowest) lowest = y
      if (y > highest) highest = y
      // Inside the vehicle's cylinder, above the deck, is the one place nothing may be.
      if (y > pad.deck + 0.05 && y < pad.deck + L) nearest = Math.min(nearest, Math.hypot(x, z))
      // Something to stand on, at the deck, within the hold-down ring.
      if (Math.abs(y - pad.deck) < 1e-3 && Math.hypot(x, z) < foot.radius) deckVertices++
    }
  }
  const row = {
    id,
    meshes: meshes.length,
    keys: meshes.map((m) => m.key),
    triangles,
    lowest,
    highest,
    nearest,
    deckVertices,
    merged: meshes.every((m) => m.geometry && m.geometry.getAttribute('position').count > 0),
    tower: pad.towerScale * L,
    deck: pad.deck,
    arms: arms.length,
    armNearest,
    armClearAtEnd,
    matedGaps,
    oldGaps,
  }
  rows.push(row)
  console.log(
    `  ${id.padEnd(12)} ${String(row.meshes).padStart(5)}  ${String(Math.round(triangles)).padStart(9)}  ${lowest.toFixed(2).padStart(7)} m  ${highest.toFixed(1).padStart(7)} m  ${nearest.toFixed(2).padStart(6)} m`,
  )
  console.log(
    `  ${''.padEnd(12)} ${String(row.arms).padStart(5)} arms, closest to the hull as drawn ${armNearest.toFixed(3)} m through the swing,` +
      ` ${armClearAtEnd.toFixed(1)} m from the axis once swung back`,
  )
  console.log(
    `  ${''.padEnd(12)}       mated, ${Math.min(...matedGaps).toFixed(3)} to ${Math.max(...matedGaps).toFixed(3)} m short of it;` +
      ` ended at the reach instead, ${Math.min(...oldGaps).toFixed(2)} to ${Math.max(...oldGaps).toFixed(2)} m`,
  )
  for (const m of meshes) m.geometry.dispose()
  for (const a of arms) a.geometry.dispose()
}

/*
 * The record the arms are built from, against the file it was taken from. The
 * catalogue is not in the repository — CI fetches it after the gates — so this
 * measures where the file is present and says so where it is not; either way
 * the arms are held to the record above.
 */
const standing = VESSELS[ACTIVE_VESSEL]?.stages?.[0]?.model
const recorded = standing ? HULL_PROFILES[standing] : null
let profileMatches = null
if (standing && recorded) {
  const file = `public/models/${decodeURIComponent(MODEL_BY_ID[standing].file)}`
  if (existsSync(file)) {
    const { measure } = await import('./measure-hulls.mjs')
    const fresh = measure(standing).radius.map((x) => +x.toPrecision(6))
    profileMatches = fresh.length === recorded.length && fresh.every((x, i) => x === recorded[i])
    console.log(`\n  ${standing}: the recorded profile ${profileMatches ? 'matches' : 'DOES NOT match'} the file, band for band`)
  } else {
    console.log(`\n  ${standing}: file not present — the catalogue is fetched after the gates in CI — so the record was not re-measured`)
  }
}

console.log('\n=== what this establishes ===')
const checks = [
  ['every pad merges into a mesh per material \u2014 steel, concrete, dark and white', rows.every((r) => r.merged && r.meshes === 4 && ['steel', 'concrete', 'dark', 'white'].every((k) => r.keys.includes(k)))],
  ['every pad reaches down to the datum: foundations, not a float', rows.every((r) => r.lowest < 0 && r.lowest >= -FOUNDATION)],
  ['the apron top sits just above the datum everywhere', rows.every((r) => r.lowest <= APRON_TOP)],
  ['nothing stands inside the volume the vehicle is drawn in', rows.every((r) => r.nearest > foot.reach)],
  ['there is a pedestal under the vehicle at exactly the deck height', rows.every((r) => r.deckVertices >= 4)],
  ['the tallest structure is the tower, and it clears the stack', rows.every((r) => r.highest > r.deck + L * 0.6 && r.highest > r.tower)],
  ['each pad is a few thousand triangles, not a model', rows.every((r) => r.triangles > 500 && r.triangles < 60000)],
  // The arms, now that they move.
  ['every pad has swing arms, and they are built apart so they can swing', rows.every((r) => r.arms > 0)],
  ['no arm enters the vehicle as drawn at any point in its swing, mated or not', rows.every((r) => r.armNearest > 0)],
  // Measured on the triangle nearest the hull, which is the face of the carrier.
  ['and mated, every arm ends at the vehicle as drawn at its own height', rows.every((r) => r.matedGaps.every((g) => Math.abs(g - ARM_GAP) < 8 * FLOAT32_AT_ARM))],
  ['a hull taken from a model is recorded as the file measures it', profileMatches !== false],
  ['and swung back, every arm stands well clear of the hull', rows.every((r) => r.armClearAtEnd > foot.reach * 2)],
]
let pass = true
for (const [label, ok] of checks) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`)
  if (!ok) pass = false
}
console.log(`\n  ${pass ? 'PASS' : 'FAIL'}`)
process.exit(pass ? 0 : 1)
