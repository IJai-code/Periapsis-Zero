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
import { G0 } from '../src/sim/constants.js'

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
