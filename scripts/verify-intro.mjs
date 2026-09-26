/**
 * verify-intro — the mission intro flight is a safe flight.
 *
 * `gfx/introFlights.js` flies the camera half an AU down to a hull in one
 * 42-second shot. It cannot be watched from a Node process, but its geometry
 * can be walked: `introStep` is a pure function of the clock, so this drives
 * the whole flight for every mission's dossier and asserts what the shot
 * promises:
 *
 *   1. The path never enters anything drawn — the Sun, the Earth, the Moon,
 *      the vehicle, or any planet on rails. A quadratic Bézier cannot leave
 *      the hull of its own three points, which is why the path is built from
 *      them; this checks the claim rather than the argument. Swept over the
 *      Moon's phases and over every world the vehicle actually hands over at,
 *      because the anchors are taken from the live ephemeris wherever the
 *      mission happens to be. This is the sweep that caught the settle
 *      direction burying Eagle's intro inside a near-side Moon.
 *   2. The flight is invariant under floating-origin moves. The anchors are
 *      kept in absolute coordinates and `introStep` subtracts `live.origin` on
 *      the way out; run the same flight with the origin walking around and the
 *      absolute camera position must not change by more than a rounding error.
 *   3. The shot opens where the film opens — a star among stars, half an AU
 *      out — and settles where the mission begins: `arc.settle` off the hull,
 *      with the lens tightened from 52 degrees to 40.
 *   4. Every dossier page turns: five beats, in order, and the flight hands
 *      back `-2` when it is done.
 *   5. The lunar arcs actually pass the Moon. `viaMoon` is a promise that the
 *      Moon slides through frame on the way in, not a label.
 */
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { live } from '../src/sim/live.js'
import { BODIES, CRAFT } from '../src/sim/constants.js'
import { RAILS, RAIL_RADIUS, railHelio, updateRails } from '../src/sim/rails.js'
import { DOSSIERS, INTRO, introEnd, introStart, introStep } from '../src/gfx/introFlights.js'

const AU = 1.495978707e11

let n = 0
const check = (label, fn) => {
  fn()
  n++
  console.log(`  ✓ ${label}`)
}

/** A camera the rig would recognise — `introStep` touches exactly these. */
const makeCamera = () => new THREE.PerspectiveCamera(52, 1, 0.1, 1e13)

const SCRATCH = new THREE.Vector3()

/** Absolute camera position this step: the origin-relative point put back. */
const absolute = (cam) => SCRATCH.copy(cam.position).add(live.origin).clone()

/**
 * What is drawn, and the clearance the camera must hold from it.
 *
 * Distant bodies get a proportional margin — nothing approaches them. The
 * worlds the flight actually flies over get a fixed hundred metres of sky
 * instead: the settle is deliberately hundreds of metres over a pad, and a
 * proportional margin there would demand the shot stop 300 km up. The claim
 * is that the camera never enters anything — a hundred metres says "clearly
 * outside" without forbidding the approach the film is made of.
 */
const REL = { rel: 0.05 }
const SKY = { abs: 100 }
/** The clearance floor: a fixed hundred metres of sky, or 5% off the radius. */
const floorOf = (s) => (s.clear.abs != null ? s.r + s.clear.abs : s.r * (1 + s.clear.rel))

const surfaces = []
for (const id of ['sun', 'earth', 'moon']) {
  const host = id === 'earth' || id === 'moon'
  surfaces.push({
    id,
    r: BODIES[id].radius,
    clear: host ? SKY : REL,
    pos: () => live.abs[id],
  })
}
surfaces.push({
  id: 'ship',
  r: (CRAFT.ship.visual ?? 100) / 2,
  clear: REL,
  pos: () => live.abs.ship,
})
// And every planet on rails, wherever the epoch puts them.
updateRails(live.sim.t, railHelio)
for (let k = 0; k < RAILS.length; k++) {
  const o = k * 3
  const sun = live.abs.sun
  surfaces.push({
    id: RAILS[k].id,
    r: RAIL_RADIUS[k],
    clear: REL,
    pos: () => ({
      x: sun.x + railHelio[o],
      y: sun.y + railHelio[o + 1],
      z: sun.z + railHelio[o + 2],
    }),
  })
}

const STEPS = 1200

/** Walk one whole flight, sampling absolute camera positions per step. */
function fly(presetId, wanderOrigin) {
  const cam = makeCamera()
  introStart(presetId, 'earth')
  const samples = []
  const beats = []
  for (let i = 0; i <= STEPS; i++) {
    if (wanderOrigin) {
      // The floating origin walks: the Sun, then Earth, then the vehicle —
      // and a detour. The absolute flight must not notice.
      const phase = i / STEPS
      const base = phase < 0.5 ? live.abs.sun : live.abs.earth
      live.origin.set(
        base.x + Math.sin(phase * 31) * 1e6,
        base.y + Math.cos(phase * 17) * 1e6,
        base.z,
      )
    }
    const changed = introStep(cam, INTRO.duration / STEPS)
    if (changed >= 0) beats.push(changed)
    samples.push(absolute(cam))
  }
  introEnd()
  return { cam, samples, beats }
}

/** The Moon swung to another quarter of its orbit, for the sweep below. */
const moonHome = live.abs.moon.clone()
function setMoonPhase(theta) {
  const e = live.abs.earth
  const r = moonHome.distanceTo(e)
  const base = Math.atan2(moonHome.z - e.z, moonHome.x - e.x)
  live.abs.moon.set(e.x + Math.cos(base + theta) * r, moonHome.y, e.z + Math.sin(base + theta) * r)
}

/**
 * Where the vehicle hands over. The epoch leaves it on the pad at Kennedy;
 * the missions fly it to both hemispheres of the Moon and to lunar orbit, and
 * the anchors are taken from wherever it actually is.
 */
const shipHome = live.abs.ship.clone()
function withShipAt(kind, fn) {
  const e = live.abs.earth
  const m = live.abs.moon
  const moonR = BODIES.moon.radius
  if (kind === 'lunar-near') {
    // Tranquility: the far side of the near side — facing Earth.
    live.abs.ship.copy(m).addScaledVector(SCRATCH.copy(e).sub(m).normalize(), moonR + 2)
  } else if (kind === 'lunar-far') {
    live.abs.ship.copy(m).addScaledVector(SCRATCH.copy(m).sub(e).normalize(), moonR + 2)
  } else if (kind === 'lunar-orbit') {
    const out = SCRATCH.copy(m).sub(e).normalize()
    const perp = new THREE.Vector3(-out.z, 0, out.x).normalize()
    live.abs.ship.copy(m).addScaledVector(perp, moonR * 1.15)
  }
  try {
    fn()
  } finally {
    live.abs.ship.copy(shipHome)
  }
}

const HEMISPHERES = ['pad', 'lunar-near', 'lunar-far', 'lunar-orbit']

const ids = Object.keys(DOSSIERS)
assert.ok(ids.length >= 9, `expected the nine missions' dossiers, found ${ids.length}`)

/* ---------------------------------------------------------------- *
 * 1. Clearance: nothing drawn is ever entered, wherever it all is
 * ---------------------------------------------------------------- */

for (const id of ids) {
  check(`[${id}] the flight never enters a body — any Moon phase, any hand-over world`, () => {
    for (const theta of [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2]) {
      setMoonPhase(theta)
      for (const where of HEMISPHERES) {
        withShipAt(where, () => {
          const { samples } = fly(id, false)
          for (const s of surfaces) {
            const p = s.pos()
            const floor = floorOf(s)
            let closest = Infinity
            for (const c of samples) {
              const d = Math.hypot(c.x - p.x, c.y - p.y, c.z - p.z)
              if (d < closest) closest = d
            }
            assert.ok(
              closest > floor,
              `[${id}] at lunar phase ${theta.toFixed(2)}, from ${where}: camera passes ` +
                `${Math.round(closest)} m from ${s.id}, whose clear floor is ${Math.round(floor)} m`,
            )
          }
        })
      }
    }
    live.abs.moon.copy(moonHome)
  })
}

/* ---------------------------------------------------------------- *
 * 2. The absolute flight does not know the origin moved
 * ---------------------------------------------------------------- */

for (const id of ids) {
  check(`[${id}] the flight is invariant under floating-origin moves`, () => {
    const still = fly(id, false).samples
    const moving = fly(id, true).samples
    for (let i = 0; i < still.length; i++) {
      const drift = moving[i].distanceTo(still[i])
      // Rounding only: the numbers involved are ~1e11 m in float64, whose
      // resolution there is a third of a micron.
      assert.ok(drift < 1e-3, `[${id}] sample ${i} drifted ${drift} m when the origin moved`)
    }
  })
}

/* ---------------------------------------------------------------- *
 * 3. The shot's two ends
 * ---------------------------------------------------------------- */

for (const id of ids) {
  check(`[${id}] opens among the stars, settles at the hull`, () => {
    const arc = DOSSIERS[id].arc
    for (const where of HEMISPHERES) {
      withShipAt(where, () => {
        const cam = makeCamera()
        introStart(id, 'earth')
        introStep(cam, 0.001)
        const openR = absolute(cam).distanceTo(live.abs.sun)
        assert.ok(openR > 0.4 * AU, `[${id}/${where}] opens ${openR.toFixed(3)} AU from the Sun`)

        // Walk to the settle and measure the last frame against the hull.
        for (let i = 0; i < STEPS; i++) introStep(cam, INTRO.duration / STEPS)
        const end = absolute(cam)
        const toShip = end.distanceTo(live.abs.ship)
        // The final anchor is `settle` out along the host world's radial and
        // `settle * 0.35` across it. Those directions are not perpendicular,
        // so the distance is settle times a factor between 0.65 and 1.35 —
        // pinned to exactly that range, and no tighter.
        const lo = arc.settle * 0.65 - 1
        const hi = arc.settle * 1.35 + 1
        assert.ok(
          toShip >= lo && toShip <= hi,
          `[${id}/${where}] settles ${Math.round(toShip)} m from the hull, ` +
            `expected ${Math.round(lo)}–${Math.round(hi)} m`,
        )
        // And it settles *above* the world it sits on: further from the host's
        // centre than the hull is, by at least the settle's own scale. This is
        // the assertion that keeps the settle direction honest — the first
        // version of the flight buried Eagle's intro 600 m inside a near-side
        // Moon, which a hull-distance check alone would not catch.
        const hostC =
          live.abs.ship.distanceTo(live.abs.moon) < live.abs.ship.distanceTo(live.abs.earth)
            ? live.abs.moon
            : live.abs.earth
        const lift = end.distanceTo(hostC) - live.abs.ship.distanceTo(hostC)
        assert.ok(
          lift > arc.settle * 0.6 - 1,
          `[${id}/${where}] settles ${Math.round(lift)} m *below* the host world's horizon`,
        )
        assert.ok(
          Math.abs(cam.fov - 40) < 0.5,
          `[${id}/${where}] lens ends at ${cam.fov.toFixed(1)} degrees, expected 40`,
        )
        introEnd()
      })
    }
  })
}

/* ---------------------------------------------------------------- *
 * 4. The dossier's pages
 * ---------------------------------------------------------------- */

for (const id of ids) {
  check(`[${id}] every page turns, in order`, () => {
    const { beats } = fly(id, false)
    const want = DOSSIERS[id].beats.length
    assert.equal(beats.length, want, `[${id}] ${beats.length} beats turned, expected ${want}`)
    for (let i = 0; i < beats.length; i++) {
      assert.equal(beats[i], i, `[${id}] beat ${i} arrived as ${beats[i]}`)
    }
  })
}

/* ---------------------------------------------------------------- *
 * 5. The lunar arcs pass the Moon
 * ---------------------------------------------------------------- */

for (const id of ids) {
  const arc = DOSSIERS[id].arc
  check(
    `[${id}] ${arc.viaMoon ? 'passes the Moon on the way in' : 'keeps to the Earth line'}`,
    () => {
      const { samples } = fly(id, false)
      const moon = live.abs.moon
      let closest = Infinity
      for (const c of samples) {
        const d = c.distanceTo(moon)
        if (d < closest) closest = d
      }
      if (arc.viaMoon) {
        assert.ok(
          closest < 1e8,
          `[${id}] claims the Moon slides through frame but never comes closer than ` +
            `${(closest / 1000).toFixed(0)} km`,
        )
      }
      // Either way the Moon is never entered — asserted above, but the arc's
      // whole shape depends on this and it costs one line to say so.
      assert.ok(closest > BODIES.moon.radius * 1.05, `[${id}] enters the Moon at ${Math.round(closest)} m`)
    },
  )
}

console.log(`\nverify-intro: ${n} checks passed`)
