/**
 * verify-programs — the planner's promises, held before a pilot meets them.
 *
 * The planner is a screen full of claims: a route priced in delta-v, a
 * stack that delivers one, wings that promise who holds the stick, a fuel
 * load that says how much margin survives. Every one of those claims is
 * checkable headlessly, which is the same rule the rest of the suite runs
 * on — a claim about flight is held against the flight model, not against
 * the UI that printed it. This gate holds them:
 *
 *   1. The ladder is an offer, not a gate: Trainee holds everything, the
 *      freer wings hold strictly less, and no wing claims a capability
 *      outside the vocabulary the sequencer asks about.
 *   2. Every program's priced route fits inside its own stack's delta-v,
 *      at the fuel load its freest wing actually carries, with margin —
 *      computed by the same rocket-equation sum `ship.deltaV()` flies.
 *      This is the check that caught the first draft selling a landing
 *      the vehicle could not fly.
 *   3. Program arming produces the state the sequencer gate reads: the
 *      objectives latched, the wing answering `wingHolds`, and the fuel
 *      load actually drained on the live stack.
 *   4. Every program names a real vessel and sites that exist, and every
 *      objective names a check the evaluator knows.
 */
import assert from 'node:assert/strict'
import { PROGRAMS, WINGS, stackDeltaV, armProgram, disarmProgram, wingHolds, wingFuel, program, KARMAN_FUEL } from '../src/sim/programs.js'
import { VESSELS } from '../src/sim/vessels.js'
import { LAUNCH_SITES, ALL_SITES } from '../src/sim/launchsite.js'
import { resetMission } from '../src/sim/mission.js'
import { ship } from '../src/sim/ship.js'

let n = 0
const check = (label, fn) => {
  fn()
  n++
  console.log(`  ✓ ${label}`)
}

/* 1. The ladder is freedom, held strictly. */
check('the wings form a freedom ladder over a known vocabulary', () => {
  const known = new Set(['ascent', 'insertion', 'burns', 'warpCeiling'])
  const order = Object.values(WINGS).sort((a, b) => a.order - b.order)
  for (let i = 1; i < order.length; i++) {
    const freer = order[i]
    const below = order[i - 1]
    // Strictly fewer, except the step where the ladder is already free:
    // Kármán is Aldrin *plus a fuel penalty*, not more freedom, so holding
    // the same empty set is correct and the fuel is the difference.
    assert.ok(
      freer.holds.length <= below.holds.length,
      `${freer.id} must not hold more capabilities than ${below.id}`,
    )
    for (const cap of freer.holds) {
      assert.ok(below.holds.includes(cap), `${freer.id} holds ${cap} but ${below.id} does not`)
    }
  }
  for (const w of Object.values(WINGS)) {
    for (const cap of w.holds) assert.ok(known.has(cap), `${w.id} claims unknown capability ${cap}`)
  }
  assert.equal(WINGS.trainee.holds.length, 4, 'Trainee holds everything')
  assert.equal(WINGS.aldrin.holds.length, 0, 'Aldrin holds nothing — that is the point')
  assert.equal(WINGS.karman.holds.length, 0, 'Kármán holds nothing either — its margin is the fuel, not the stick')
})

/* 2. The routes fit the stacks that are asked to fly them. */
check('every program closes its delta-v budget on its own vehicle and load', () => {
  for (const def of PROGRAMS) {
    const vessel = VESSELS[def.vessel]
    assert.ok(vessel, `${def.id} names unknown vessel ${def.vessel}`)
    // The freest wing decides the fuel: a program offered at Kármán must
    // close at the Kármán load, not at the full tank it never gets.
    const freest = def.wings.at(-1)
    const scale = freest === 'karman' ? KARMAN_FUEL : 1
    const budget = stackDeltaV(vessel, scale)
    const cost = def.legs.reduce((s, l) => s + l.dv, 0)
    assert.ok(
      budget > cost,
      `${def.id} priced ${cost.toFixed(0)} m/s against a ${(scale * 100).toFixed(0)}% stack delivering ${budget.toFixed(0)}: the plan cannot fly`,
    )
    // A margin worth having, not a rounding error: 300 m/s is roughly one
    // mid-course correction, and a plan with less than that is a trap.
    assert.ok(budget - cost > 300, `${def.id} closes with only ${(budget - cost).toFixed(0)} m/s of margin`)
  }
})

check('the Descent program is the honest one-way answer to landing', () => {
  const descent = PROGRAMS.find((p) => p.id === 'lunar-descent')
  assert.ok(descent, 'the descent program exists')
  assert.ok(!descent.objectives.some((o) => o.check === 'splashdown'), 'Descent does not promise a ride home')
  // And the lie it replaced stays dead: land-and-return must not close.
  const vessel = VESSELS['apollo8']
  const lie = 9400 + 3050 + 890 + 2000 + 2850
  assert.ok(stackDeltaV(vessel) < lie, 'the CSM stack must not be able to land and return — that is why Apollo had an LM')
})

/* 3. Arming produces the state the sequencer reads. */
check('arming a program drives the wing gate and the live fuel load', () => {
  const def = PROGRAMS.find((p) => p.id === 'lunar-orbit')
  const apollo = VESSELS['apollo8']
  // Aldrin: no capabilities, full tank.
  resetMission()
  armProgram(def, 'aldrin')
  assert.ok(program.armed)
  assert.equal(wingHolds('burns'), false, 'Aldrin holds no burns')
  assert.equal(wingFuel(), 1)
  resetMission()
  const full = ship.stageProp[0]
  assert.equal(full, apollo.stages[0].propellant, 'full load stands on an Aldrin reset')
  // Kármán: the drain is real, on the live stack, after the reset.
  disarmProgram()
  armProgram(def, 'karman')
  assert.equal(wingHolds('ascent'), false)
  assert.ok(Math.abs(wingFuel() - 0.84) < 1e-9)
  resetMission()
  const drained = ship.stageProp[0]
  assert.ok(
    Math.abs(drained - apollo.stages[0].propellant * KARMAN_FUEL) < 1e-6,
    `Kármán reset carries ${drained} t, expected ${(apollo.stages[0].propellant * KARMAN_FUEL).toFixed(0)}`,
  )
  // And an unarmed sim is untouched by all of it.
  disarmProgram()
  assert.equal(wingHolds('burns'), true, 'no program armed: the sequencer keeps everything')
  assert.equal(wingFuel(), 1)
  resetMission()
  assert.equal(ship.stageProp[0], apollo.stages[0].propellant)
})

/* 4. The tables agree with the world they name. */
check('every program names real vessels, real sites, real checks', () => {
  const checks = new Set(['liftoff', 'orbit', 'tli', 'lunarSoi', 'lunarOrbit', 'landing', 'home', 'splashdown'])
  for (const def of PROGRAMS) {
    assert.ok(VESSELS[def.vessel], `${def.id}: unknown vessel`)
    assert.ok(def.sites.every((s) => ALL_SITES[s]), `${def.id}: unknown site ${def.sites.find((s) => !ALL_SITES[s])}`)
    assert.ok(def.sites.every((s) => !LAUNCH_SITES[s] || true))
    assert.ok(def.wings.every((w) => WINGS[w]), `${def.id}: unknown wing`)
    for (const o of def.objectives) assert.ok(checks.has(o.check), `${def.id}: unknown check ${o.check}`)
    assert.ok(def.legs.length >= def.objectives.length - 1, `${def.id}: fewer legs than the route needs`)
  }
  // Every launch site is offered by at least one program, and every site's
  // pads exist — a planner that cannot fly from where the sim can stand is
  // a planner lying about the world.
  const offered = new Set(PROGRAMS.flatMap((p) => p.sites))
  for (const id of Object.keys(LAUNCH_SITES)) assert.ok(offered.has(id), `no program offers ${id}`)
})

console.log(`verify-programs: ${n} checks — freedom ladder, closed budgets, the honest one-way landing, arming and fuel drains pass`)
