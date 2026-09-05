/**
 * The vessel library: are these vehicles, and do they fly?
 *
 * Two different questions. The first is arithmetic against published figures —
 * launch mass, thrust-to-weight, ideal delta-v, the capsule's ballistic
 * coefficient — and it catches a stack that was typed wrong. The second needs
 * the mission actually flown, because a plausible set of numbers can still fail
 * to reach orbit.
 *
 *   node scripts/verify-vessels.mjs          # every vessel, arithmetic only
 *   node scripts/verify-vessels.mjs --fly    # and fly each to its parking orbit
 */

import { VESSELS } from '../src/sim/vessels.js'
import { MODEL_BY_ID } from '../src/gfx/modelsManifest.js'
import { BODIES, G0, SHIP } from '../src/sim/constants.js'

const g = 9.80665

/** Published figures, for comparison. Sources in sim/vessels.js. */
const PUBLISHED = {
  apollo8: { launchMass: 2.97e6, liftoffTW: 1.16, cmBeta: 350, entrySpeed: 10_820 },
  artemis: { launchMass: 2.6e6, liftoffTW: 1.57, cmBeta: 420, entrySpeed: 11_000 },
}

console.log('=== the stacks ===')
const rows = []
for (const [id, v] of Object.entries(VESSELS)) {
  const launch = v.stages.reduce((a, s) => a + s.dryMass + s.propellant, 0)
  const tw = v.stages[0].thrust / (launch * g)
  let m = launch
  let dv = 0
  for (const s of v.stages) {
    const after = m - s.propellant
    if (s.propellant > 0 && after > 0) dv += s.isp * G0 * Math.log(m / after)
    m = after - s.dryMass
  }
  const cm = v.stages.at(-1)
  const beta = cm.dryMass / (cm.drag.cd * cm.drag.area)
  const pub = PUBLISHED[id] ?? {}
  rows.push({ id, v, launch, tw, dv, beta, pub })

  console.log(`\n  ${v.name} — ${v.vehicle}, ${v.era}`)
  console.log(`    stages          ${v.stages.length}: ${v.stages.map((s) => s.name).join(' · ')}`)
  console.log(`    launch mass     ${(launch / 1e3).toFixed(0)} t` +
    (pub.launchMass ? `   published ${(pub.launchMass / 1e3).toFixed(0)} t` +
      `   (${(((launch - pub.launchMass) / pub.launchMass) * 100).toFixed(1)}%)` : ''))
  console.log(`    liftoff T/W     ${tw.toFixed(3)}` +
    (pub.liftoffTW ? `        published ${pub.liftoffTW.toFixed(2)}` : ''))
  console.log(`    ideal delta-v   ${(dv / 1e3).toFixed(2)} km/s`)
  console.log(`    capsule beta    ${beta.toFixed(0)} kg/m^2` +
    (pub.cmBeta ? `   published ${pub.cmBeta}` +
      `   (${(((beta - pub.cmBeta) / pub.cmBeta) * 100).toFixed(1)}%)` : ''))
}

/* ---- what each stage is drawn as ---- */
console.log('\n=== hulls ===')
console.log('  vessel      stage                 length      mesh')
let meshOk = true
for (const { v } of rows) {
  for (const s of v.stages) {
    const entry = s.model ? MODEL_BY_ID[s.model] : null
    if (s.model && !entry) meshOk = false
    const mesh = s.model ? (entry ? `${entry.label}` : `MISSING: ${s.model}`) : 'procedural placeholder'
    console.log(`  ${v.id.padEnd(11)} ${s.name.padEnd(21)}${`${s.visual} m`.padStart(9)}   ${mesh}`)
  }
}

/* ---- the length a staged vehicle actually spans ---- */
console.log('\n=== what staging changes ===')
for (const { v, launch } of rows) {
  const first = v.stages[0]
  const last = v.stages.at(-1)
  console.log(
    `  ${v.name.padEnd(11)} ${first.visual} m -> ${last.visual} m ` +
      `(${(first.visual / last.visual).toFixed(0)}x)   ` +
      `${(launch / 1e3).toFixed(0)} t -> ${(last.dryMass / 1e3).toFixed(2)} t ` +
      `(${(launch / last.dryMass).toFixed(0)}x)`,
  )
}

/* ---- and does it reach the orbit it claims? ---- */
let parked = null
if (process.argv.includes('--fly')) {
  /**
   * Flown, because arithmetic cannot answer this one.
   *
   * The ascent lofted for the entire life of this project and nothing noticed,
   * because every check asked about staging, warp, capture, entry and heating —
   * and none asked what orbit the launch actually reached. Apollo 8 parked at
   * 1,318 x 1,323 km against a real 185, and Artemis at 7,602. A vehicle can
   * have every mass right and still fly to the wrong place.
   *
   * Only the active vessel can be flown, since the flight model binds to one at
   * load; run it once per vessel with SPXSIM_VESSEL.
   */
  const { flyMission } = await import('./flight.mjs')
  const { live } = await import('../src/sim/live.js')
  const { mission } = await import('../src/sim/mission.js')
  const { totalMass } = await import('../src/sim/ship.js')

  flyMission('TLI_ALIGN')
  const e = live.elements
  const R = BODIES.earth.radius
  const target = SHIP.parkingOrbit.altitude
  parked = {
    perigee: e.periapsisRadius - R,
    apogee: e.apoapsisRadius - R,
    target,
    ecc: e.eccentricity,
    met: mission.t,
    mass: totalMass(),
  }
  console.log(`\n=== ${SHIP.name} flown to its parking orbit ===`)
  console.log(`  reached      ${(parked.perigee / 1e3).toFixed(0)} x ${(parked.apogee / 1e3).toFixed(0)} km` +
    `   e ${parked.ecc.toFixed(4)}`)
  console.log(`  target       ${(target / 1e3).toFixed(0)} km`)
  console.log(`  insertion    MET ${(parked.met / 60).toFixed(1)} min, ${(parked.mass / 1e3).toFixed(1)} t in orbit`)
  console.log(`  error        perigee ${(((parked.perigee - target) / target) * 100).toFixed(1)}%` +
    `, apogee ${(((parked.apogee - target) / target) * 100).toFixed(1)}%`)
}

console.log('\n=== what this establishes ===')
const checks = [
  ['every vessel has stages, chutes and an ascent programme',
   rows.every(({ v }) => v.stages.length > 1 && v.chutes?.main && v.ascent?.targetSpeed)],
  ['every named mesh exists in the catalogue', meshOk],
  ['launch masses are within 5% of published',
   rows.every(({ launch, pub }) => !pub.launchMass || Math.abs(launch - pub.launchMass) / pub.launchMass < 0.05)],
  ['liftoff thrust-to-weight is within 2% of published',
   rows.every(({ tw, pub }) => !pub.liftoffTW || Math.abs(tw - pub.liftoffTW) / pub.liftoffTW < 0.02)],
  // Apollo's needs no adjustment; Orion's area was chosen to hold it.
  ['capsule ballistic coefficients are within 5% of published',
   rows.every(({ beta, pub }) => !pub.cmBeta || Math.abs(beta - pub.cmBeta) / pub.cmBeta < 0.05)],
  ['every stack carries enough ideal delta-v for a lunar return',
   rows.every(({ dv }) => dv > 14_000)],
  // A vehicle that cannot lift itself never leaves the pad, and the sequencer
  // would sit in GRAVITY_TURN until the propellant ran out.
  ['every vessel can lift itself', rows.every(({ tw }) => tw > 1.05)],
  ...(parked
    ? [
        /**
         * Both apsides within a quarter of the target altitude.
         *
         * A requirement with its margin stated, not a threshold fitted to the
         * result: the worst measured error is 9%, so this leaves 2.7x. The
         * ascent it replaces missed by 610% for Apollo and 4,000% for Artemis,
         * so no plausible loosening of this could have let that through.
         */
        ['the launch reaches the parking orbit it claims',
         Math.abs(parked.perigee - parked.target) < parked.target * 0.25 &&
           Math.abs(parked.apogee - parked.target) < parked.target * 0.25],
        ['the orbit is very nearly circular', parked.ecc < 0.01],
        ['insertion takes a plausible time', parked.met > 300 && parked.met < 3600],
      ]
    : []),
  ['stages are ordered heaviest first', rows.every(({ v }) =>
    v.stages.every((s, i, a) => i === 0 || s.dryMass + s.propellant <= a[i - 1].dryMass + a[i - 1].propellant))],
]
let pass = true
for (const [label, ok] of checks) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`)
  if (!ok) pass = false
}
console.log(`\n  ${pass ? 'PASS' : 'FAIL'}`)
process.exit(pass ? 0 : 1)
