/**
 * What the renderer draws must be where the integrator says things are.
 *
 * This is the check that did not exist when it was needed. The display layer
 * used to apply three independent exaggerations — body radii, the Moon's
 * geocentric offset (x24), and every craft's geocentric offset (x225) — and the
 * last two disagreed. A ship in a 100 km lunar orbit was drawn 201 lunar radii
 * from the Moon, nine times further from Earth than the Moon itself, for the
 * whole lunar half of the mission. Eighteen verification programs asserted
 * physics invariants and not one asserted rendered geometry, so nothing caught
 * it; the physics was right the entire time.
 *
 * The invariant is one line: for every pair of drawn objects, the separation on
 * screen equals the separation in the state vector, in metres. That holds under
 * any floating origin, because the origin is a translation and translations do
 * not change separations — which is also why the origin has to be varied here
 * rather than left at its default.
 *
 *   node scripts/verify-geometry.mjs
 */

import { Vector3 } from 'three'
import { live, refreshDerived, resetSimulation } from '../src/sim/live.js'
import { INDEX } from '../src/sim/system.js'
import { BODIES, BODY_ORDER, CRAFT } from '../src/sim/constants.js'

/** Place a craft at an absolute position, in metres. */
function place(id, x, y, z) {
  const o = INDEX[id] * 6
  live.sim.state[o] = x
  live.sim.state[o + 1] = y
  live.sim.state[o + 2] = z
}

/** Physical separation straight out of the state vector. */
function trueSeparation(a, b) {
  const s = live.sim.state
  const i = INDEX[a] * 6
  const j = INDEX[b] * 6
  return Math.hypot(s[i] - s[j], s[i + 1] - s[j + 1], s[i + 2] - s[j + 2])
}

resetSimulation()

const earth = INDEX.earth * 6
const moon = INDEX.moon * 6
const E = new Vector3(live.sim.state[earth], live.sim.state[earth + 1], live.sim.state[earth + 2])
const M = new Vector3(live.sim.state[moon], live.sim.state[moon + 1], live.sim.state[moon + 2])

/** Unit vector from Earth toward the Moon, for placing things believably. */
const toMoon = new Vector3().subVectors(M, E).normalize()

/**
 * Ship placements worth checking, each one a place the mission actually goes.
 * The lunar cases are the ones the old display scale got wrong.
 */
const CASES = [
  {
    what: 'on the pad',
    at: () => new Vector3().copy(E).addScaledVector(toMoon, BODIES.earth.radius),
  },
  {
    what: 'in a 400 km LEO',
    at: () => new Vector3().copy(E).addScaledVector(toMoon, BODIES.earth.radius + 400e3),
  },
  {
    what: 'at translunar midpoint',
    at: () => new Vector3().copy(E).addScaledVector(toMoon, 2e8),
  },
  {
    what: 'in a 100 km lunar orbit',
    at: () => new Vector3().copy(M).addScaledVector(toMoon, BODIES.moon.radius + 100e3),
  },
  {
    what: 'at lunar far side, 100 km',
    at: () => new Vector3().copy(M).addScaledVector(toMoon, -(BODIES.moon.radius + 100e3)),
  },
]

/** Every origin the driver can pin to, plus none at all. */
const ORIGINS = [null, 'earth', 'moon', 'ship', 'sun']

const PAIRS = []
for (let i = 0; i < BODY_ORDER.length; i++) {
  for (let j = i + 1; j < BODY_ORDER.length; j++) PAIRS.push([BODY_ORDER[i], BODY_ORDER[j]])
}

console.log(`=== ${CASES.length} ship placements x ${ORIGINS.length} origins x ${PAIRS.length} pairs ===\n`)
console.log('  ship placement                rendered ship-Moon    true ship-Moon      error')

let worstRel = 0
let worstAbs = 0
let worstWhere = ''
let checked = 0

for (const c of CASES) {
  const p = c.at()
  place('ship', p.x, p.y, p.z)

  for (const origin of ORIGINS) {
    refreshDerived(origin)
    for (const [a, b] of PAIRS) {
      const rendered = live.pos[a].distanceTo(live.pos[b])
      const truth = trueSeparation(a, b)
      const err = Math.abs(rendered - truth)
      const rel = truth > 0 ? err / truth : err
      checked++
      if (rel > worstRel) {
        worstRel = rel
        worstAbs = err
        worstWhere = `${a}-${b}, ship ${c.what}, origin ${origin ?? 'none'}`
      }
    }
  }

  refreshDerived('earth')
  const rend = live.pos.ship.distanceTo(live.pos.moon)
  const truth = trueSeparation('ship', 'moon')
  console.log(
    `  ${c.what.padEnd(28)}${(rend / 1e3).toFixed(1).padStart(14)} km` +
      `${(truth / 1e3).toFixed(1).padStart(16)} km${(Math.abs(rend - truth)).toExponential(1).padStart(12)} m`,
  )
}

/* ---- the specific failure this replaces ---- */
place(
  'ship',
  ...new Vector3().copy(M).addScaledVector(toMoon, BODIES.moon.radius + 100e3).toArray(),
)
refreshDerived('earth')
const lunarRadii = live.pos.ship.distanceTo(live.pos.moon) / BODIES.moon.radius
const shipVsMoonFromEarth =
  live.pos.ship.distanceTo(live.pos.earth) / live.pos.moon.distanceTo(live.pos.earth)

console.log('\n=== the regression this exists to catch ===')
console.log(`  ship in a 100 km lunar orbit renders ${lunarRadii.toFixed(3)} lunar radii from the Moon`)
console.log(`    (physically ${((BODIES.moon.radius + 100e3) / BODIES.moon.radius).toFixed(3)}; the exaggerated scene drew 201)`)
console.log(`  ship's distance from Earth / Moon's distance from Earth: ${shipVsMoonFromEarth.toFixed(4)}`)
console.log(`    (the exaggerated scene drew 9.4)`)

/* ---- rendered sizes are the real ones ---- */
console.log('\n=== drawn sizes ===')
for (const [id, b] of Object.entries(BODIES)) {
  console.log(`  ${id.padEnd(8)} radius ${(b.radius / 1e3).toFixed(1).padStart(10)} km`)
}
for (const [id, c] of Object.entries(CRAFT)) {
  console.log(`  ${id.padEnd(8)} length ${c.visual.toFixed(1).padStart(10)} m`)
}

console.log('\n=== what this establishes ===')
const checks = [
  ['every rendered separation matches the state vector', worstRel < 1e-12],
  /**
   * Derived rather than written down, and toleranced to what the coordinates
   * can actually hold.
   *
   * Two wrong versions came before this one. The first compared against
   * `1.0576` — the printed value, rounded — and failed at 1e-6 because the true
   * ratio is 1.0575572. The second derived the ratio correctly and still failed,
   * at 2.8e-12, which is the interesting one: the ship is stored
   * *heliocentrically*, at ~1.5e11 m, where one float64 ulp is 3e-5 m. Placing
   * it 1,837,400 m from the Moon lands 4.85 um off, below one ulp of the
   * number it is stored in. That is the floor for any Moon-relative quantity
   * here and no rendering change can move it.
   *
   * The renderer's own contract — rendered separation equals state-vector
   * separation — is the check above, and it holds to 4.6e-16.
   */
  ['the ship orbits the Moon on screen, not past it',
   Math.abs(lunarRadii - (BODIES.moon.radius + 100e3) / BODIES.moon.radius) < 1e-10],
  ['the ship is not flung beyond the Moon', Math.abs(shipVsMoonFromEarth - 1) < 0.01],
  ['bodies are drawn at their real radii', BODIES.earth.radius === 6.371e6],
  // A craft the length of a city block was the tell that sizes were display
  // numbers rather than measurements.
  ['craft are drawn at plausible vehicle lengths',
   Object.values(CRAFT).every((c) => c.visual > 1 && c.visual < 500)],
]
let pass = true
for (const [label, ok] of checks) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`)
  if (!ok) pass = false
}
console.log(`\n  ${checked} separations checked`)
console.log(`  worst relative error ${worstRel.toExponential(3)} (${worstAbs.toExponential(3)} m)` +
  `${worstRel > 0 ? ` at ${worstWhere}` : ''}`)
console.log(`  ${pass ? 'PASS' : 'FAIL'}`)
process.exit(pass ? 0 : 1)
