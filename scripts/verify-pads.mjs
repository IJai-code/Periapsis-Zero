/**
 * The pad under the vehicle, held to its contract.
 *
 * Three files agree on where the ground is: gfx/pads.js states it, Terrain.jsx
 * grades the heightfield to it, LaunchPad.jsx builds on it and Craft.jsx lifts
 * the hull onto it. The meshes need a browser; the numbers they are built from
 * do not, so this checks the numbers — for every site and for the vehicle that
 * was chosen at load, since a pad that fits a Saturn V has to fit an SLS with
 * its boosters too.
 *
 *   node --expose-gc scripts/verify-pads.mjs
 *   PERIAPSIS_VESSEL=artemis node --expose-gc scripts/verify-pads.mjs
 */
import {
  FLAT_RADIUS,
  LIFT_FADE,
  LIFT_HOLD,
  PADS,
  currentHullLift,
  exhaustOpening,
  hullLift,
  liftFactor,
  padFor,
  vehicleFootprint,
} from '../src/gfx/pads.js'
import { LAUNCH_SITES } from '../src/sim/launchsite.js'
import { stageLength } from '../src/gfx/framing.js'
import { ACTIVE_VESSEL } from '../src/sim/vessels.js'
import { SMALLEST_OBJECT, bytesPerCall, knownAllocation } from './allocation.mjs'

const STYLES = new Set(['umbilical', 'tulip', 'gantry', 'service'])
const L = stageLength(0)
const foot = vehicleFootprint()
const hole = exhaustOpening(foot)

console.log(`=== ${ACTIVE_VESSEL}: ${L.toFixed(1)} m stack, core radius ${foot.radius.toFixed(2)} m, reach ${foot.reach.toFixed(2)} m ===`)
console.log(`  exhaust opening half-size ${hole.toFixed(1)} m`)
console.log('\n  site         style       deck     hull base   tower    apron')

let everySite = true
let baseOnDeck = true
let apronGraded = true
let towerFits = true
for (const id of Object.keys(LAUNCH_SITES)) {
  const pad = PADS[id]
  if (!pad || !STYLES.has(pad.style) || !(pad.deck > 0) || Math.abs(pad.mound + pad.platform - pad.deck) > 1e-9) everySite = false
  const p = padFor(id)
  // The hull is drawn from -L/2 about the state; lifted, its base is at:
  const base = hullLift(id) - L / 2
  if (Math.abs(base - p.deck) > 1e-9) baseOnDeck = false
  if (!(p.apron < FLAT_RADIUS)) apronGraded = false
  const tower = p.towerScale * L
  if (!(tower > 0.5 * L && tower < 1.5 * L)) towerFits = false
  console.log(
    `  ${id.padEnd(12)} ${p.style.padEnd(10)} ${p.deck.toFixed(1).padStart(5)} m  ${base.toFixed(1).padStart(7)} m  ${tower.toFixed(0).padStart(5)} m  ${String(p.apron).padStart(5)} m`,
  )
}

/* The opening clears the widest thing on the vehicle, and the hold-downs still reach the core. */
const clears = hole > foot.reach && hole * 0.82 > foot.radius * 0.5 && foot.reach >= foot.radius

/* The fade: held, then eased to nothing, continuously. */
const f0 = liftFactor(0)
const fHold = liftFactor(LIFT_HOLD * L)
const fEnd = liftFactor((LIFT_HOLD + LIFT_FADE) * L)
const fFar = liftFactor(400e3)
let monotone = true
let maxStep = 0
let prev = liftFactor(0)
for (let h = 1; h <= (LIFT_HOLD + LIFT_FADE + 1) * L; h += 1) {
  const f = liftFactor(h)
  if (f > prev + 1e-12) monotone = false
  maxStep = Math.max(maxStep, prev - f)
  prev = f
}
console.log(`\n=== the lift ===`)
console.log(`  factor 1.000 held to ${(LIFT_HOLD * L).toFixed(0)} m, 0 from ${((LIFT_HOLD + LIFT_FADE) * L).toFixed(0)} m; largest change per metre ${maxStep.toExponential(2)}`)
const kscLift = hullLift('ksc')
console.log(`  Kennedy: hull raised ${kscLift.toFixed(1)} m on the pad, ${(kscLift * liftFactor(2 * L)).toFixed(1)} m at two stack lengths up`)

/*
 * The live read, as the frame loop makes it. Sunk into a typed array rather
 * than returned from the lambda: a double *returned* across a call the
 * optimiser has not inlined is boxed into a HeapNumber, 16 bytes, and that
 * would be the measurement's own artefact rather than the function's.
 */
const SINK = new Float64Array(1)
const control = await knownAllocation()
const liftBytes = await bytesPerCall(
  () => {
    SINK[0] = currentHullLift('ksc')
  },
  { calls: 50000, warm: 50000 },
)
if (control) {
  console.log('\n=== allocation ===')
  console.log(`  currentHullLift   ${liftBytes.bytes.toFixed(2)} B a call`)
  console.log(`  control           ${control.bytes.toFixed(0)} B`)
}

console.log('\n=== what this establishes ===')
const checks = [
  ['every launch site has a pad, of a known style, whose deck is mound plus platform', everySite],
  ['lifted, the hull\'s base sits exactly on the deck at every site', baseOnDeck],
  ['the exhaust opening clears the vehicle and the hold-downs reach the core', clears],
  ['the graded ground extends past every apron', apronGraded],
  ['every tower stands between half and one and a half stack lengths', towerFits],
  ['the lift is whole on the pad and through the first stack length of climb', f0 === 1 && fHold === 1],
  ['and gone at the end of the fade and in orbit', fEnd === 0 && fFar === 0],
  ['it never increases with altitude', monotone],
  // A smoothstep's steepest slope is 1.5 over its width; anything past that is a discontinuity.
  ['and never jumps: no steeper than the smoothstep it is', maxStep < 1.6 / (LIFT_FADE * L)],
  ['on the pad the state reads a full lift', Math.abs(currentHullLift('ksc') - kscLift) < 1e-9],
  ['the allocation measurement can see an allocation', !control || control.bytes >= SMALLEST_OBJECT],
  ['the per-frame lift allocates nothing', !liftBytes || liftBytes.bytes < SMALLEST_OBJECT / 2],
]
let pass = true
for (const [label, ok] of checks) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`)
  if (!ok) pass = false
}
console.log(`\n  ${pass ? 'PASS' : 'FAIL'}`)
process.exit(pass ? 0 : 1)
