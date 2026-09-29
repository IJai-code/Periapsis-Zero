/**
 * verify-site-ground — the globe is only skipped while it truly cannot be seen.
 *
 * `Terrain.jsx` draws seventy kilometres of real relief round a pad, and from
 * inside that the planet's own globe is behind it in every direction. Skipping
 * it is worth about 8 ms of a 33 ms frame, because the logarithmic depth buffer
 * writes `gl_FragDepth` and so switches off early-Z: a hidden fragment runs its
 * whole shader before anything throws it away.
 *
 * The saving is only honest if the test is. It has one job — never say hidden
 * when any part of the globe could reach the eye — and the failure it must not
 * have is a hole in the world, which is far worse than a slow frame. So this
 * checks the geometry the test rests on, over the whole range of heights and
 * offsets a camera can take, rather than the two or three a screenshot covers:
 *
 *   1. It refuses whenever the patch is not there to cover anything.
 *   2. Whenever it says hidden, the horizon from that point really does fall
 *      inside the patch — recomputed here from the sphere, not from the
 *      function's own arithmetic.
 *   3. It says hidden where it plainly should: standing on the pad.
 *   4. It gives up where it should: above the height whose horizon runs past
 *      the patch's edge.
 */
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { groundHidesGlobe, siteGround } from '../src/gfx/siteGround.js'
import { BODIES } from '../src/sim/constants.js'

let n = 0
const check = (label, fn) => {
  fn()
  n++
  console.log(`  ✓ ${label}`)
}

const R = BODIES.earth.radius
/** The patch Kennedy actually gets, measured in the running page. */
const REACH = 30597

const centre = new THREE.Vector3(0, R, 0)
const planet = new THREE.Vector3(0, 0, 0)
const cam = new THREE.Vector3()

/** Put the camera `height` above the datum and `offset` metres along the ground. */
function place(height, offset) {
  // Far enough from the pole that the small-angle treatment is the real one.
  const a = offset / R
  cam.set(Math.sin(a) * (R + height), Math.cos(a) * (R + height), 0)
  return cam
}

const arm = (reach = REACH) => {
  siteGround.drawn = true
  siteGround.reach = reach
  siteGround.centre.copy(centre)
}

check('with no ground drawn, the globe is always drawn', () => {
  siteGround.drawn = false
  siteGround.reach = REACH
  siteGround.centre.copy(centre)
  assert.equal(groundHidesGlobe(place(2, 0), planet, R), false)
  siteGround.drawn = true
  siteGround.reach = 0
  assert.equal(groundHidesGlobe(place(2, 0), planet, R), false, 'a patch of no reach hides nothing')
})

check('standing on the pad, the globe is behind the ground', () => {
  arm()
  assert.equal(groundHidesGlobe(place(2, 0), planet, R), true)
  assert.equal(groundHidesGlobe(place(2, 400), planet, R), true, 'the ground view stands 380 m off')
  assert.equal(groundHidesGlobe(place(60, 400), planet, R), true, 'the chase camera rides higher')
})

check('once the horizon runs past the patch, the globe comes back', () => {
  arm()
  // The horizon from height h is sqrt(2Rh); it reaches REACH at about 73 m.
  const breaks = (REACH * REACH) / (2 * R)
  assert.ok(breaks > 50 && breaks < 100, `the crossing is at ${breaks.toFixed(0)} m, which is not the ~73 expected`)
  assert.equal(groundHidesGlobe(place(breaks * 2, 0), planet, R), false)
  assert.equal(groundHidesGlobe(place(1000, 0), planet, R), false, 'a kilometre up, plainly')
  assert.equal(groundHidesGlobe(place(400e3, 0), planet, R), false, 'from orbit, plainly')
})

check('it never hides the globe while the horizon lies outside the patch', () => {
  /*
   * The property that matters, swept rather than sampled. For every height and
   * every offset, if the function says hidden then the horizon — recomputed
   * here straight from the sphere — must fall inside the patch with the
   * offset added, because that circle is the furthest the eye can reach.
   */
  arm()
  let hidden = 0
  let tested = 0
  for (let h = 0; h <= 400; h += 0.5) {
    for (let d = 0; d <= REACH; d += 250) {
      tested++
      if (!groundHidesGlobe(place(h, d), planet, R)) continue
      hidden++
      const horizon = Math.sqrt(2 * R * h)
      assert.ok(
        d + horizon <= REACH,
        `hidden at ${h} m and ${d} m out, where the horizon reaches ${Math.round(d + horizon)} m of ${REACH}`,
      )
    }
  }
  assert.ok(hidden > 100, `only ${hidden} of ${tested} placements were hidden; the test may be inert`)
})

check('a smaller patch hides less, in proportion', () => {
  // Kourou and Vandenberg get their own tiles; nothing here may assume Kennedy's.
  for (const reach of [4000, 12000, 30597, 60000]) {
    arm(reach)
    const breaks = (reach * reach) / (2 * R)
    assert.equal(groundHidesGlobe(place(Math.max(0.5, breaks * 0.4), 0), planet, R), true, `reach ${reach}`)
    assert.equal(groundHidesGlobe(place(breaks * 3, 0), planet, R), false, `reach ${reach}`)
  }
})

check('it refuses anything it cannot reason about', () => {
  arm()
  assert.equal(groundHidesGlobe(place(-50, 0), planet, R), false, 'below the datum')
  siteGround.reach = Number.NaN
  assert.equal(groundHidesGlobe(place(2, 0), planet, R), false, 'a reach that is not a number')
  arm()
})

console.log(`\n${n} checks pass — the globe is skipped only from inside the ground that covers it.`)
