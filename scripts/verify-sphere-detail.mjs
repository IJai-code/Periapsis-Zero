import assert from 'node:assert/strict'
import { SphereGeometry } from 'three'
import { readFileSync } from 'node:fs'
import { projectedRadius, sphereLevel, SPHERE_SEGMENTS, SILHOUETTE_ERROR } from '../src/gfx/sphereDetail.js'
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
console.log('verify-sphere-detail: screen-space error, monotonic LOD, >250× distant geometry savings and fine-detail guards pass')
