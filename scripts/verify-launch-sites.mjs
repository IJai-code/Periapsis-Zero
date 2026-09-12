/**
 * Flying from somewhere other than Florida.
 *
 * The launch site is two numbers and a heading, and every one of them reaches
 * into the flight: latitude sets how much of the planet's rotation the vehicle
 * starts with and the lowest inclination it can reach, the azimuth sets the
 * plane it climbs into, and both change how much is left in the tanks at
 * cutoff. The picker is a dropdown; this is the part that has to be true.
 *
 * The ascent guidance carries no site-specific constants — it is the same
 * vertical-acceleration law for all four pads — so the test is whether it still
 * parks the vehicle in the same orbit when the ground underneath it is moving
 * 140 m/s slower and the plane is tilted 53 degrees further over.
 *
 *   node scripts/verify-launch-sites.mjs
 */

import { flight, flyMission } from './flight.mjs'
import { live, refreshDerived, resetSimulation } from '../src/sim/live.js'
import { currentPhase, mission, updateMission } from '../src/sim/mission.js'
import { deltaV, ship, totalMass } from '../src/sim/ship.js'
import { BODIES } from '../src/sim/constants.js'
import { INDEX } from '../src/sim/system.js'
import { SPIN_AXIS, SPIN_RATE } from '../src/sim/atmosphere.js'
import { LAUNCH_SITES, activeSite, inclinationFor, rotationBonus, selectSite } from '../src/sim/launchsite.js'

const R = BODIES.earth.radius
const C = INDEX.ship * 6
const E = INDEX.earth * 6

/**
 * Inclination from the state: the angle between the orbit's normal and the
 * planet's spin axis. Measured, not read off a stored element — nothing in the
 * flight model tracks inclination, and the whole point here is what the vehicle
 * actually achieved rather than what it was aimed at.
 */
function inclination() {
  const s = live.sim.state
  const rx = s[C] - s[E]
  const ry = s[C + 1] - s[E + 1]
  const rz = s[C + 2] - s[E + 2]
  const vx = s[C + 3] - s[E + 3]
  const vy = s[C + 4] - s[E + 4]
  const vz = s[C + 5] - s[E + 5]
  const hx = ry * vz - rz * vy
  const hy = rz * vx - rx * vz
  const hz = rx * vy - ry * vx
  const h = Math.hypot(hx, hy, hz)
  const dot = (hx * SPIN_AXIS[0] + hy * SPIN_AXIS[1] + hz * SPIN_AXIS[2]) / h
  return (Math.acos(Math.max(-1, Math.min(1, dot))) * 180) / Math.PI
}

const SITES = ['ksc', 'baikonur', 'kourou', 'vandenberg']
const flown = []

for (const id of SITES) {
  selectSite(id)
  resetSimulation()
  refreshDerived()
  const site = activeSite()
  /** Nose-to-vertical angle at the moment of release, degrees. */
  let liftoffTilt = Infinity
  const reached = flyMission('TLI_ALIGN', {
    onPhase: (to) => {
      if (to !== 'LIFTOFF') return
      const s = live.sim.state
      const ux = s[C] - s[E]
      const uy = s[C + 1] - s[E + 1]
      const uz = s[C + 2] - s[E + 2]
      const ul = Math.hypot(ux, uy, uz)
      const dot = (ship.forward.x * ux + ship.forward.y * uy + ship.forward.z * uz) / ul
      liftoffTilt = (Math.acos(Math.max(-1, Math.min(1, dot))) * 180) / Math.PI
    },
  })
  refreshDerived()
  const e = live.elements
  flown.push({
    id,
    site,
    reached,
    met: mission.t,
    phase: currentPhase().id,
    peri: (e.periapsisRadius - R) / 1e3,
    apo: (e.apoapsisRadius - R) / 1e3,
    inclination: inclination(),
    wanted: inclinationFor(site),
    floor: Math.abs(site.latitude),
    free: rotationBonus(site),
    /**
     * What the rotation is actually worth *downrange*, which is the raw bonus
     * projected onto the launch heading. The bonus alone predicts the wrong
     * order: Vandenberg leaves at 170 degrees, so almost none of its 382 m/s
     * points where the vehicle is going, and some of it has to be undone.
     */
    downrange: rotationBonus(site) * Math.sin((site.azimuth * Math.PI) / 180),
    closedForm: SPIN_RATE * R * Math.cos((site.latitude * Math.PI) / 180),
    left: deltaV(),
    tilt: liftoffTilt,
    mass: totalMass() / 1e3,
    frames: flight.frames,
  })
}

console.log('=== the planet gives, by latitude ===')
console.log('  site          lat      free m/s   closed form')
for (const f of flown) {
  console.log(
    `  ${f.id.padEnd(11)} ${f.site.latitude.toFixed(2).padStart(6)}N ${f.free.toFixed(1).padStart(11)} ` +
      `${f.closedForm.toFixed(1).padStart(13)}`,
  )
}

console.log('\n=== the same guidance, four pads ===')
console.log('  site         azimuth   parking orbit        inclination  floor   wanted   dv left   MET')
for (const f of flown) {
  console.log(
    `  ${f.id.padEnd(11)} ${f.site.azimuth.toFixed(1).padStart(6)}  ` +
      `${f.peri.toFixed(1).padStart(6)} x ${f.apo.toFixed(1).padStart(6)} km  ` +
      `${f.inclination.toFixed(2).padStart(9)}  ${f.floor.toFixed(2).padStart(6)}  ` +
      `${f.wanted.toFixed(2).padStart(6)}  ${f.left.toFixed(0).padStart(7)}  ${(f.met / 60).toFixed(1).padStart(6)} min`,
  )
}

const baseline = flown[0]
const periSpread = Math.max(...flown.map((f) => f.peri)) - Math.min(...flown.map((f) => f.peri))
const apoSpread = Math.max(...flown.map((f) => f.apo)) - Math.min(...flown.map((f) => f.apo))
/**
 * The latitude penalty, stated as what is left in the tanks. Kourou starts
 * 55 m/s faster than Kennedy and should arrive with more; Vandenberg launches
 * across the rotation rather than with it and should arrive with least.
 */
const byDownrange = [...flown].sort((a, b) => b.downrange - a.downrange)
console.log('\n  ordered by how much of that rotation points downrange:')
for (const f of byDownrange) {
  console.log(
    `    ${f.id.padEnd(11)} ${f.free.toFixed(0).padStart(4)} m/s x sin(${f.site.azimuth.toFixed(0)}) = ` +
      `${f.downrange.toFixed(0).padStart(4)} downrange → ${f.left.toFixed(0).padStart(5)} m/s left, ${f.mass.toFixed(1)} t`,
  )
}

/* Restore the default pad so nothing downstream inherits the last one. */
selectSite('ksc')

console.log('\n=== what this establishes ===')
const checks = [
  ['every pad takes omega R cos(phi) from the planet',
    flown.every((f) => Math.abs(f.free - f.closedForm) < 1e-9)],
  ['the vehicle reaches orbit from all four', flown.every((f) => f.reached && f.phase === 'TLI_ALIGN')],
  /**
   * The hard bound: a launch cannot reach an inclination below its latitude,
   * whatever it steers. Half a degree of slack for the plane lock's own
   * convergence.
   */
  ['none beats its own latitude floor', flown.every((f) => f.inclination >= f.floor - 0.5)],
  ['each arrives in the plane its azimuth asks for, to two degrees',
    flown.every((f) => Math.abs(f.inclination - f.wanted) < 2)],
  ['and the four planes are genuinely different',
    Math.max(...flown.map((f) => f.inclination)) - Math.min(...flown.map((f) => f.inclination)) > 40],
  /**
   * The point of the whole exercise. One guidance law, no per-site constants,
   * and the four parking orbits agree to a few kilometres — against a 140 m/s
   * spread in what the ground handed them and 77 degrees of plane.
   */
  ['all four park in the same orbit, to 15 km', periSpread < 15 && apoSpread < 15],
  ['and it is the orbit Kennedy has always reached', Math.abs(baseline.peri - 171.7) < 5],
  ['nobody is left in the atmosphere', flown.every((f) => f.peri > 140)],
  /**
   * What is left in the tanks follows the rotation *along the heading*, not the
   * rotation. The raw bonus puts Vandenberg above Baikonur and the flights say
   * otherwise, because a launch across the planet's motion collects almost none
   * of it — 66 m/s of Vandenberg's 382.
   */
  ['propellant left follows the rotation that points downrange',
    byDownrange.every((f, i, a) => i === 0 || a[i - 1].left >= f.left)],
  ['and the raw bonus would have got that order wrong',
    (() => {
      const byFree = [...flown].sort((a, b) => b.free - a.free)
      return !byFree.every((f, i, a) => i === 0 || a[i - 1].left >= f.left)
    })()],
  /**
   * The bug this exposed: a vehicle on a pad points along its own local
   * vertical, wherever the pad is. It used to point along whatever `makeBasis`
   * made of a fallback axis that was not perpendicular to it.
   */
  ['every stack leaves its pad pointing straight up', flown.every((f) => f.tilt < 0.01)],
]

/* ---------------------------------------------------------------- *
 * A vehicle inside the planet is not still flying
 * ---------------------------------------------------------------- */

/**
 * The check that was missing, and what it cost.
 *
 * A parking orbit at 172 x 185 km is not a place to loiter: drag takes 1.6 km
 * of perigee a day, measured, and the same figure comes back at 60x and at
 * 21,600x warp, so it is the air and not the integrator. The sequencer waits
 * there for the Moon to cross its orbital plane, which at this epoch is 137 h
 * from Baikonur and 306 h from Vandenberg — and Vandenberg's vehicle reenters
 * on day 11.4, 32 hours before its window opens.
 *
 * Nothing noticed. The craft kept integrating down to r = 0, sat at Earth's
 * centre, and the sequencer flew on and ran a translunar injection out of the
 * middle of the planet: 5,208 m/s spent to raise apoapsis to 15 km. That was
 * read as a delta-v shortfall, written into the README as one, and committed.
 *
 * So the guard is tested the cheap way rather than by flying eleven days: put
 * the craft under the surface and take one frame. It has to stop.
 */
selectSite('ksc')
resetSimulation()
refreshDerived()
/**
 * `TLI_ALIGN`, not `COAST`.
 *
 * `flyMission`'s own `onFrame` calls `commitTLI()` the moment `COAST` is
 * entered, and `flyUntil` tests the predicate *after* `onFrame` — so by the
 * time anything asks whether the phase is `COAST` it is already `TLI_ALIGN`,
 * and a run asked to stop there instead flies to splashdown. Asking for a phase
 * nothing preempts is the whole of the fix.
 */
flyMission('TLI_ALIGN', { onPhase: () => {}, maxFrames: 2_000_000 })
const orbiting = currentPhase().id

// Halve the radius, keeping the velocity: unambiguously inside the planet, and
// nothing else about the state disturbed.
const st = live.sim.state
for (let k = 0; k < 3; k++) st[C + k] = st[E + k] + (st[C + k] - st[E + k]) * 0.5
refreshDerived()
const depth = live.elements.altitude
updateMission(1 / 60, 1 / 60)

console.log('\n=== a vehicle inside the planet ===')
console.log(`  from ${orbiting}, moved to ${(depth / 1e3).toFixed(0)} km altitude`)
console.log(`  sequencer now in ${currentPhase().id}`)

checks.push(
  ['a craft below the surface is reported lost', currentPhase().id === 'LOST'],
  ['and the depth it was lost at is recorded', mission.lost.altitude < 0],
  ['against the body it is inside', mission.lost.body === 'earth'],
)

let pass = true
for (const [label, ok] of checks) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`)
  if (!ok) pass = false
}
console.log(`\n  ${pass ? 'PASS' : 'FAIL'}`)
process.exit(pass ? 0 : 1)
