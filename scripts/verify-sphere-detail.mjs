import assert from 'node:assert/strict'
import { SphereGeometry } from 'three'
import { readFileSync } from 'node:fs'
import { projectedRadius, sphereLevel, SPHERE_SEGMENTS, SILHOUETTE_ERROR } from '../src/gfx/sphereDetail.js'
import { cappedLevel, DETAIL_STEPS } from '../src/gfx/detailBudget.js'
let previous = 0
for (let p = 0.01; p <= 20000; p *= 1.08) {
  const level = sphereLevel(p)
  assert.ok(level >= previous)
  previous = level
  const error = p * (1 - Math.cos(Math.PI / SPHERE_SEGMENTS[level]))
  if (level < 4) assert.ok(error <= SILHOUETTE_ERROR + 1e-10)
}
assert.equal(sphereLevel(Infinity), 4)
assert.equal(sphereLevel(0), 0)
assert.equal(sphereLevel(Infinity, -1, 3), 3)
assert.equal(projectedRadius(1, 1, 1080, 45), Infinity)
assert.ok(projectedRadius(1, 3, 1080, 45) > projectedRadius(1, 6, 1080, 45))
const low = new SphereGeometry(1, 32, 16)
const high = new SphereGeometry(1, 512, 256)
assert.ok(high.index.count / low.index.count > 250)
low.dispose(); high.dispose()
const detail = readFileSync(new URL('../src/gfx/surfaceDetail.js', import.meta.url), 'utf8')
assert.ok(detail.includes('craters(mP, 156250.0'))
const worlds = readFileSync(new URL('../src/gfx/glsl/worlds.js', import.meta.url), 'utf8')
assert.ok(worlds.includes('if (fade <= 0.0) return vec2(0.0)'))

/*
 * The ladder a consumer holds must be as long as the ladder `sphereLevel`
 * chooses from. Planets held four rungs of a five-rung ladder, so a body
 * whose projected radius passed ~4,000 drawing-buffer pixels — and every body
 * seen from inside, where `projectedRadius` is Infinity — selected a rung
 * that was not there. The mesh took `undefined`, and the next frame threw on
 * its bounding sphere. A silent out-of-range read is exactly the failure a
 * numeric gate should not have to be told about twice, so it is checked two
 * ways: the selection can never exceed the ladder, and neither consumer is
 * allowed to shorten its copy of it.
 */
for (let cap = 0; cap < SPHERE_SEGMENTS.length; cap++) {
  for (const px of [0, 1, 500, 3999, 4000, 1e6, Infinity]) {
    const level = cappedLevel(px, -1, cap)
    assert.ok(Number.isInteger(level) && level >= 0 && level < SPHERE_SEGMENTS.length,
      `cappedLevel(${px}, -1, ${cap}) = ${level} is not an index into SPHERE_SEGMENTS`)
    assert.ok(level <= cap)
    assert.ok(SPHERE_SEGMENTS[level] !== undefined)
  }
}
assert.ok(DETAIL_STEPS.every((cap) => SPHERE_SEGMENTS[cap] !== undefined),
  'every distress cap must name a rung that exists')

for (const file of ['../src/components/Planets.jsx', '../src/components/Moon.jsx']) {
  const src = readFileSync(new URL(file, import.meta.url), 'utf8')
  assert.ok(!/SPHERE_SEGMENTS\.slice\(/.test(src),
    `${file} shortens the LOD ladder; sphereLevel can return any rung in it`)
  assert.ok(/SPHERE_SEGMENTS\.(length|map)/.test(src),
    `${file} must size its ladder from SPHERE_SEGMENTS rather than a literal`)
}

console.log('verify-sphere-detail: screen-space error, monotonic LOD, in-range rungs, >250× distant geometry savings and fine-detail guards pass')
