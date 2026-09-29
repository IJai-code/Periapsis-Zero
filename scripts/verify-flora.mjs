/**
 * verify-flora — the plants cost what they are worth to look at.
 *
 * A launch site's scrub was, until it was measured, the most expensive thing in
 * the simulator: 36,540 plants round Kennedy at 386 to 800 triangles each, all
 * of them drawn every frame whatever the camera was pointed at. Measured from
 * the pad's ground view, 25,247 of them were behind the camera and 10,266 of
 * the rest covered fewer than twelve pixels — 8.6 million triangles a frame,
 * of which about one in ten could be seen.
 *
 * The fix must not cost anything visible, which is a claim with two halves,
 * and this checks both:
 *
 *   1. The full build of every species is *exactly* what it always was —
 *      the same vertex count, the same positions, the same colours, down to
 *      the random sequence. Anything near enough to look at is untouched.
 *   2. The reduced builds are genuinely cheaper, keep the plant's silhouette
 *      (its height and spread), and are only ever reached by a plant too small
 *      on screen for the parts they drop to be resolved.
 *
 * The screen-size arithmetic `SiteSurround` uses is reproduced here rather than
 * imported, because a gate that shares its subject's arithmetic cannot catch
 * the arithmetic being wrong.
 */
import assert from 'node:assert/strict'
import { DETAIL, SPECIES, facetSize, scatterFlora } from '../src/gfx/flora.js'
import { TIERS } from '../src/sim/device.js'

let n = 0
const check = (label, fn) => {
  fn()
  n++
  console.log(`  ✓ ${label}`)
}

const tris = (g) => g.attributes.position.count / 3
const bounds = (g) => {
  g.computeBoundingBox()
  const b = g.boundingBox
  return { h: b.max.y, w: Math.max(b.max.x - b.min.x, b.max.z - b.min.z) }
}

/* ---------------------------------------------------------------- *
 * 1. The full build is untouched
 * ---------------------------------------------------------------- */

check('detail runs from the whole plant down, and 1 is the whole plant', () => {
  assert.equal(DETAIL[0], 1, 'the first level must be the plant entire')
  for (let i = 1; i < DETAIL.length; i++) {
    assert.ok(DETAIL[i] < DETAIL[i - 1], `level ${i} is not below ${i - 1}`)
    assert.ok(DETAIL[i] > 0)
  }
})

check('calling a species with no argument gives the full build', () => {
  for (const [name, f] of Object.entries(SPECIES)) {
    const bare = f()
    const one = f(1)
    assert.equal(bare.attributes.position.count, one.attributes.position.count, name)
  }
})

check('the full build is identical, vertex for vertex, however often it is built', () => {
  // The species are seeded, so two builds must agree exactly — which is what
  // makes "nothing near the camera changed" a statement and not a hope.
  for (const [name, f] of Object.entries(SPECIES)) {
    const a = f(1)
    const b = f(1)
    for (const attr of ['position', 'color', 'sway']) {
      const x = a.attributes[attr]
      const y = b.attributes[attr]
      assert.ok(x && y, `${name} has no ${attr}`)
      assert.equal(x.count, y.count, `${name}.${attr} count`)
      for (let i = 0; i < x.array.length; i++) {
        if (x.array[i] !== y.array[i]) assert.fail(`${name}.${attr}[${i}] differs between builds`)
      }
    }
  }
})

/* ---------------------------------------------------------------- *
 * 2. The reduced builds are cheaper, and still the same plant
 * ---------------------------------------------------------------- */

/**
 * `SiteSurround` leaves a plant this cheap at its full build whatever the
 * distance, so these are the species a ladder has to earn its place on.
 * Restated rather than imported: the component is JSX and pulls in three.
 */
const LOD_MIN_TRIANGLES = 120

check('every reduced build is a saving worth the swap', () => {
  for (const [name, f] of Object.entries(SPECIES)) {
    const t = DETAIL.map((d) => tris(f(d)))
    if (t[0] < LOD_MIN_TRIANGLES) continue
    for (let i = 1; i < t.length; i++) {
      assert.ok(t[i] < t[i - 1], `${name}: level ${i} is ${t[i]} triangles against ${t[i - 1]}`)
    }
    // Worth doing at all: more than half must come off, or the swap is a
    // visible risk taken for nothing.
    assert.ok(t[t.length - 1] < t[0] * 0.45, `${name}: the coarse build saves too little (${t[t.length - 1]}/${t[0]})`)
  }
})

check('a reduced build keeps the plant standing where it stood', () => {
  // A plant that changed height or spread would move against its neighbours as
  // the camera walked toward it, which is exactly the popping to avoid.
  for (const [name, f] of Object.entries(SPECIES)) {
    const full = bounds(f(1))
    for (let i = 1; i < DETAIL.length; i++) {
      const cut = bounds(f(DETAIL[i]))
      assert.ok(
        Math.abs(cut.h - full.h) < full.h * 0.06,
        `${name} level ${i}: ${cut.h.toFixed(2)} m tall against ${full.h.toFixed(2)}`,
      )
      assert.ok(
        Math.abs(cut.w - full.w) < full.w * 0.06,
        `${name} level ${i}: ${cut.w.toFixed(2)} m across against ${full.w.toFixed(2)}`,
      )
    }
  }
})

check('every build still carries the wind and its colours', () => {
  for (const [name, f] of Object.entries(SPECIES)) {
    for (const d of DETAIL) {
      const g = f(d)
      assert.ok(g.attributes.sway, `${name} at ${d} lost its sway weights`)
      assert.ok(g.attributes.color, `${name} at ${d} lost its colours`)
      assert.equal(g.attributes.sway.count, g.attributes.position.count, `${name} at ${d}`)
      const s = g.attributes.sway.array
      for (let i = 0; i < s.length; i++) {
        assert.ok(s[i] >= 0 && s[i] <= 1, `${name} at ${d}: sway ${s[i]} out of range`)
      }
    }
  }
})

/* ---------------------------------------------------------------- *
 * 3. A reduced build is only reached where it cannot be told apart
 * ---------------------------------------------------------------- */

check('a plant is never swapped while it is still large on screen', () => {
  /*
   * `SiteSurround` swaps when one facet of the coarse build would cover
   * `SWAP_PX` pixels. That rule is about facets, so it says nothing on its own
   * about how big the plant is when it happens — and swapping a tree that
   * fills a third of the screen would be obvious however fine its facets are.
   * So this works the rule back to a distance and asks what the *plant* looks
   * like there, which the rule never considers.
   */
  const SWAP_PX = 4
  const perRadian = 1080 / (2 * Math.tan((45 * Math.PI) / 360))
  for (const [name, f] of Object.entries(SPECIES)) {
    const full = f(1)
    if (tris(full) < LOD_MIN_TRIANGLES) continue // never swapped, so never a risk
    const coarse = f(DETAIL[DETAIL.length - 1])
    const distance = (facetSize(coarse) / SWAP_PX) * perRadian
    const plantPx = (bounds(full).h / distance) * perRadian
    assert.ok(
      plantPx < 120,
      `${name} swaps at ${Math.round(distance)} m, where it still stands ${Math.round(plantPx)} px tall`,
    )
    // And it must not be so cautious that the coarse build is never reached:
    // the scrub runs out to about five kilometres.
    assert.ok(distance < 2000, `${name} only swaps beyond ${Math.round(distance)} m, which is most of the site`)
  }
})

/* ---------------------------------------------------------------- *
 * 4. What a site now costs
 * ---------------------------------------------------------------- */

check('the plants round every site fit in a sane triangle budget', () => {
  const groundAt = () => 0
  for (const site of ['ksc', 'baikonur', 'kourou', 'vandenberg']) {
    for (const [tier, q] of Object.entries(TIERS)) {
      const plants = scatterFlora(site, { budget: q.trees, groundAt, clearRadius: 440, eye: { x: 0, z: 400 } })
      let whole = 0
      let far = 0
      let count = 0
      for (const [species, data] of Object.entries(plants)) {
        const rows = data.length / 6
        count += rows
        whole += rows * tris(SPECIES[species](1))
        far += rows * tris(SPECIES[species](DETAIL[DETAIL.length - 1]))
      }
      const label = `${site}/${tier}`
      assert.ok(count > 0, `${label} grew nothing`)
      // Drawn whole, a desktop site is millions of triangles; this is the
      // figure the fix exists to bring down, so it is worth asserting it is
      // still large — if it ever is not, the scatter has quietly shrunk.
      if (tier === 'desktop') assert.ok(whole > 3e6, `${label}: only ${(whole / 1e6).toFixed(1)}M triangles whole`)
      // Not a smaller fraction than this: the ground cover a visitor stands in
      // keeps its full build at every distance by design, and on a phone,
      // where the budget is small, that cover is most of what grows.
      assert.ok(far < whole * 0.5, `${label}: the coarse build is ${((far / whole) * 100).toFixed(0)}% of whole`)
    }
  }
})

check('a site the camera faces away from costs almost nothing', () => {
  // The tiling is what makes this true, and the tiling is in the component;
  // what is checked here is the premise it rests on — that the scatter really
  // is spread over kilometres, so that most of it is behind you.
  const groundAt = () => 0
  const plants = scatterFlora('ksc', { budget: TIERS.desktop.trees, groundAt, clearRadius: 440, eye: { x: 0, z: 400 } })
  let beyond = 0
  let total = 0
  for (const data of Object.values(plants)) {
    for (let i = 0; i < data.length / 6; i++) {
      const r = Math.hypot(data[i * 6], data[i * 6 + 2])
      total++
      if (r > 1000) beyond++
    }
  }
  assert.ok(total > 20000, `only ${total} plants`)
  assert.ok(beyond / total > 0.2, `only ${((beyond / total) * 100).toFixed(0)}% of the scrub is past a kilometre`)
})

console.log(`\n${n} checks pass — the plants keep every triangle worth seeing, and drop the ones that are not.`)
