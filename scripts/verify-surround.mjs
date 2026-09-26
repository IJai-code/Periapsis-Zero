/**
 * verify-surround — the world around the pad stands on the ground.
 *
 * The pad structures are graded to a surveyed rectangle; everything past it —
 * the Vehicle Assembly Building, the press site, the crowds, the parking lots,
 * the treeline — meets 130 m-sampled real relief. This gate builds every site's
 * surroundings under Node against a *sloped* heightfield and asserts the
 * property that matters: nothing floats and nothing is buried past its skirt.
 *
 * Checks:
 *   1. every earth site builds, with real detail (vertex + instance counts)
 *   2. all geometry is finite and within the terrain patch
 *   3. on flat ground every structure's base reaches exactly the skirt line
 *   4. on sloped ground no vertex is buried more than the skirt below its own
 *      ground, and the deepest point *is* the skirt — contact, by construction
 *   5. every tree, car and person stands exactly on the sampled ground
 */
import assert from 'node:assert/strict'
import { buildSurround, makeGroundSampler, SKIRT } from '../src/gfx/siteSurround.js'

const SITES = ['ksc', 'vandenberg', 'baikonur', 'kourou']
let n = 0
const check = (label, fn) => {
  fn()
  n++
  console.log(`  ✓ ${label}`)
}

const finite = (arr) => {
  for (let i = 0; i < arr.length; i++) {
    assert.ok(Number.isFinite(arr[i]), `non-finite value at index ${i}`)
  }
}

for (const site of SITES) {
  console.log(`\n${site}`)

  // 1 + 2: build against flat ground first, for the pure geometry bounds.
  const flat = buildSurround(site, () => 0)
  let vertices = 0
  let maxR = 0
  for (const key of ['solid', 'glass', 'green', 'dark']) {
    const g = flat[key]
    if (!g) continue
    const pos = g.attributes.position.array
    finite(pos)
    vertices += pos.length / 3
    for (let i = 0; i < pos.length; i += 3) {
      maxR = Math.max(maxR, Math.hypot(pos[i], pos[i + 2]))
    }
  }
  check(`${site}: builds with detail (${vertices} baked vertices)`, () => {
    assert.ok(vertices > 2000, `expected real detail, got ${vertices} vertices`)
  })
  check(`${site}: all geometry finite and within the patch`, () => {
    assert.ok(maxR < 30e3, `geometry reaches ${maxR} m — outside the 70 km terrain patch`)
  })

  // 3: per structure — floating is a per-structure property, so the build
  // keeps a ledger of every base. On flat ground each base is either at the
  // skirt line (structures with skirts) or at grade (towers on legs, tanks),
  // and nothing stands above its own ground.
  check(`${site}: every structure reaches its base line (${flat.foot.length} recorded)`, () => {
    assert.ok(flat.foot.length > 4, `only ${flat.foot.length} structures recorded`)
    for (const f of flat.foot) {
      assert.ok(f.baseY <= 0.01, `${f.name} at ${f.x},${f.z} floats: base ${f.baseY} above grade`)
      assert.ok(f.baseY >= -SKIRT - 0.01, `${f.name} at ${f.x},${f.z} sunk to ${f.baseY}, past the skirt`)
      const skirted = f.baseY < -0.01
      if (skirted) assert.ok(Math.abs(f.baseY + SKIRT) < 0.01, `${f.name} base ${f.baseY} off the skirt line`)
    }
  })

  // 4: the real test — a sloped heightfield. Real graded surroundings run
  // under 0.5% (Merritt Island marsh, Kazakh steppe, the Kourou plain), so
  // that is the gradient tested. A structure's uphill edge sits Δ = slope ×
  // half-footprint above its sampled centre: the skirt must swallow that, and
  // the tolerances are exactly this — the deepest and shallowest base points
  // land within one footprint-relief of the skirt line.
  const slope = (x, z) => 0.005 * x - 0.0025 * z
  const sloped = buildSurround(site, slope)
  let worstBurial = -Infinity
  let deepest = Infinity
  for (const key of ['solid', 'glass', 'green', 'dark']) {
    const g = sloped[key]
    if (!g) continue
    const pos = g.attributes.position.array
    for (let i = 0; i < pos.length; i += 3) {
      const clear = pos[i + 1] - slope(pos[i], pos[i + 2])
      deepest = Math.min(deepest, clear)
      worstBurial = Math.max(worstBurial, -clear)
    }
  }
  check(`${site}: on a slope, sunk to the skirt and no deeper (${deepest.toFixed(2)} m clear)`, () => {
    // Nothing buried past skirt + one footprint of relief…
    assert.ok(worstBurial <= SKIRT + 1.5, `buried ${worstBurial} m — past the ${SKIRT} m skirt + relief`)
    // …and the deepest point reaches the skirt line: contact, so nothing floats.
    assert.ok(deepest <= -SKIRT + 1.5, `deepest point ${deepest} m — structures would float`)
    assert.ok(deepest >= -SKIRT - 1.5, `deepest point ${deepest} m — buried past the skirt`)
    // Per structure, the strict form: each base crosses the surface sampled at
    // its own centre, and none is driven deeper than its skirt.
    for (const f of sloped.foot) {
      const g = slope(f.x, f.z)
      assert.ok(f.baseY <= g + 1e-6, `${f.name} at ${f.x},${f.z} floats on the slope: base ${f.baseY}, ground ${g}`)
      assert.ok(f.baseY >= g - SKIRT - 1e-6, `${f.name} at ${f.x},${f.z} buried: base ${f.baseY}, ground ${g}`)
    }
  })

  // 5: the three instanced families stand exactly on the sampled ground.
  let rows = 0
  for (const family of ['tree', 'car', 'crowd']) {
    for (const [x, y, z] of sloped.instances[family]) {
      assert.ok(Math.abs(y - slope(x, z)) < 1e-6, `${family} floats at ${x},${z}`)
    }
    rows += sloped.instances[family].length
  }
  check(`${site}: ${rows} trees, cars and people stand exactly on the ground`, () => {
    assert.ok(rows > 20, `expected a populated site, got ${rows} instances`)
  })
}

// The sampler itself: bucketed nearest-vertex must answer with the mesh's own
// heights, including outside the buckets' initial neighbourhood.
console.log('\nsampler')
check('makeGroundSampler answers with the mesh height', () => {
  const pos = new Float32Array(3 * 4)
  pos.set([-10, 5, -10, 10, 7, -10, -10, 9, 10, 10, 11, 10], 0)
  const at = makeGroundSampler(pos)
  assert.equal(at(0, 0), 5)
  assert.equal(at(10, -10), 7)
  assert.equal(at(-10, 10), 9)
  assert.equal(at(10, 10), 11)
})

console.log(`\nverify-surround: ${n}/${n} checks pass`)
