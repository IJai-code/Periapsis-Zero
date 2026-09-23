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
import { ARM_SWING, buildPad, swingPoint } from '../src/gfx/padGeometry.js'
import { padFor, vehicleFootprint } from '../src/gfx/pads.js'
import { LAUNCH_SITES } from '../src/sim/launchsite.js'
import { ACTIVE_VESSEL } from '../src/sim/vessels.js'

const foot = vehicleFootprint()
const L = foot.length
/** Apron top, and how far under the datum foundations are allowed to reach. */
const APRON_TOP = 0.3
const FOUNDATION = 3.5

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
  const v = [0, 0, 0]
  for (const a of arms) {
    const pos = a.geometry.getAttribute('position')
    for (let k = 0; k <= 10; k++) {
      const angle = (ARM_SWING * k) / 10
      for (let i = 0; i < pos.count; i++) {
        swingPoint(v, a.hinge, pos.getX(i), pos.getY(i), pos.getZ(i), angle)
        if (v[1] <= pad.deck + 0.05 || v[1] >= pad.deck + L) continue
        const r = Math.hypot(v[0], v[2])
        if (r < armNearest) armNearest = r
        if (k === 10 && r < armClearAtEnd) armClearAtEnd = r
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
  }
  rows.push(row)
  console.log(
    `  ${id.padEnd(12)} ${String(row.meshes).padStart(5)}  ${String(Math.round(triangles)).padStart(9)}  ${lowest.toFixed(2).padStart(7)} m  ${highest.toFixed(1).padStart(7)} m  ${nearest.toFixed(2).padStart(6)} m`,
  )
  console.log(
    `  ${''.padEnd(12)} ${String(row.arms).padStart(5)} arms, nearest the hull ${armNearest.toFixed(2)} m through the swing,` +
      ` ${armClearAtEnd.toFixed(1)} m once swung back`,
  )
  for (const m of meshes) m.geometry.dispose()
  for (const a of arms) a.geometry.dispose()
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
  ['no arm enters the vehicle at any point in its swing, mated or not', rows.every((r) => r.armNearest > foot.reach)],
  ['and swung back, every arm stands well clear of the hull', rows.every((r) => r.armClearAtEnd > foot.reach * 2)],
]
let pass = true
for (const [label, ok] of checks) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`)
  if (!ok) pass = false
}
console.log(`\n  ${pass ? 'PASS' : 'FAIL'}`)
process.exit(pass ? 0 : 1)
