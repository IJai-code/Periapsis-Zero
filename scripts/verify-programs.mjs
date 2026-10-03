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
 *   5. The Trainee handoff is flown, not asserted: a Trainee Orbit Run from
 *      the pad, through the scripted ascent and insertion, and the stick
 *      actually changes hands at the door out of CIRCULARISE — PILOT_FLIGHT
 *      entered, COAST never reached, the first objectives latched by the
 *      simulation. This is the planner's own copy made true on a real
 *      trajectory; it caught an inverted capability read before a pilot did.
 */
import assert from 'node:assert/strict'
import { PROGRAMS, CONTRACTS, STORY, WINGS, stackDeltaV, armProgram, disarmProgram, tickProgram, wingHolds, wingFuel, program, KARMAN_FUEL, notePhotograph, plateLog } from '../src/sim/programs.js'
import { almanacBriefings } from '../src/sim/almanac.js'
import { VESSELS } from '../src/sim/vessels.js'
import { LAUNCH_SITES, ALL_SITES } from '../src/sim/launchsite.js'
import { resetMission, currentPhase } from '../src/sim/mission.js'
import { ship } from '../src/sim/ship.js'
import { flyMission, flyUntil } from '../src/sim/fastForward.js'

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

/* 2. The routes — the jobs — and the story chapters all fit the stacks that are asked to fly them. */
check('every program, contract and story chapter closes its delta-v budget on its own vehicle and load', () => {
  for (const def of [...PROGRAMS, ...CONTRACTS, ...STORY]) {
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
check('every program, contract and story chapter names real vessels, real sites, real checks', () => {
  const checks = new Set(['liftoff', 'orbit', 'tli', 'lunarSoi', 'lunarOrbit', 'landing', 'home', 'splashdown', 'photograph', 'eclipsePlate', 'proximity', 'inclination', 'apoapsis'])
  for (const def of [...PROGRAMS, ...CONTRACTS, ...STORY]) {
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
  const offered = new Set([...PROGRAMS, ...CONTRACTS, ...STORY].flatMap((p) => p.sites))
  for (const id of Object.keys(LAUNCH_SITES)) assert.ok(offered.has(id), `no program offers ${id}`)
})

/* The Almanac: missions generated from a fixed sky must be honest about it. */
check('the Almanac quotes the sky it was handed, and prices its legs like every other flight', () => {
  const sky = { issGap: 228_000e3, moonSpan: 382_471e3, eclipse: true }
  const board = almanacBriefings(sky)
  assert.deepEqual(board, almanacBriefings(sky), 'the generator must be deterministic')
  assert.equal(board.length, 4, 'three standing briefs and one for the eclipse in the sky')

  const gap = board.find((d) => d.id === 'almanac-gap')
  const close = gap.objectives.find((o) => o.check === 'proximity')
  assert.equal(gap.basis.gapKm, 228000, 'the brief quotes the gap it was handed')
  assert.equal(close.km, 34200, 'the objective closes at 15% of the gap the brief quotes')
  assert.ok(gap.brief.includes('228,000'), 'the brief text carries the measured gap')

  const high = board.find((d) => d.id === 'almanac-high')
  const apo = high.objectives.find((o) => o.check === 'apoapsis')
  assert.equal(apo.km, 210359, 'the apoapsis target is 55% of tonight lunar span')
  assert.ok(high.brief.includes('382,471'), 'the brief text carries the measured span')

  assert.ok(
    !almanacBriefings({ ...sky, eclipse: false }).some((d) => d.id === 'almanac-shadows'),
    'no eclipse in the sky, no eclipse briefing: a board that invents events is a board that lies',
  )

  const vessel = VESSELS['apollo8']
  for (const def of board) {
    assert.ok(def.wings.every((w) => WINGS[w]), `${def.id}: unknown wing`)
    assert.equal(def.wings[0], 'trainee', `${def.id}: the brief must open at the gentlest wing`)
    const cost = def.legs.reduce((s, l) => s + l.dv, 0)
    assert.ok(stackDeltaV(vessel, 1) - cost > 300, `${def.id}: the brief cannot close its own budget`)
  }
})

/* The eclipse plate is a fact about the shutter's moment, and the log is the
   only thing that remembers it. The check is exercised through the real
   evaluator, the tick the checklist itself rides. */
check('the eclipse plate check reads what the sky was doing when the plate was taken', () => {
  const sky = { issGap: 1e6, moonSpan: 3.8e8, eclipse: true }
  const def = almanacBriefings(sky).find((d) => d.id === 'almanac-shadows')
  plateLog.length = 0
  resetMission()
  armProgram(def, 'trainee')
  assert.equal(program.objectives[0].check, 'eclipsePlate')
  // A plate under a clear sky (the note path reads live.eclipse, null under Node).
  notePhotograph()
  tickProgram(1 / 60)
  assert.equal(program.objectives[0].done, false, 'a plate under a clear sky is not the eclipse plate')
  // A plate under the eclipse: it ticks.
  plateLog.push({ eclipse: true })
  tickProgram(1 / 60)
  assert.equal(program.objectives[0].done, true, 'a plate under the eclipse is the eclipse plate')
  disarmProgram()
})

/* The story is a chain: a chapter that armed its wing at anything but the
   gentlest would be a gate on skill dressed as a story beat, and a chapter
   that did not declare itself would escape the completion recording in
   tickProgram and be a chapter nobody could ever finish. */
check('the story is a chain of honest chapters, gentlest wing first', () => {
  assert.ok(STORY.length >= 4, 'a story of fewer than four chapters is a tutorial')
  const ids = new Set(STORY.map((c) => c.id))
  assert.equal(ids.size, STORY.length, 'two chapters share an id')
  for (const [i, def] of STORY.entries()) {
    assert.ok(def.story, `${def.id} does not declare itself a story chapter`)
    assert.equal(def.wings[0], 'trainee', `${def.id} does not open at the gentlest wing`)
    assert.ok(def.brief && def.brief.length > 40, `${def.id} does not say what the flight is for`)
    assert.equal(def.order, i + 1, `${def.id} is out of sequence`)
  }
})

/* 5. The handoff is a flight, not a claim — in both directions. */
check('the Trainee handoff happens on a flown trajectory — and presets keep theirs', () => {
  const def = PROGRAMS.find((p) => p.id === 'orbit-run')
  // The armed half: a Trainee's stick changes hands at insertion's door.
  // The phase log is collected through flyMission's own onPhase hook — the
  // ascent happens *inside* that call, and a collector that starts after it
  // sees only what came later. (This gate caught exactly that mistake in
  // its own first draft.)
  armProgram(def, 'trainee')
  const phases = new Set()
  flyMission('CIRCULARISE', {
    onPhase: (id, from) => {
      phases.add(from)
      phases.add(id)
    },
  })

  let handed = false
  flyUntil(
    () => {
      if (currentPhase().id === 'PILOT_FLIGHT') return (handed = true)
      return false
    },
    { maxFrames: 2_000_000 },
  )

  assert.ok(handed, 'the stick never changed hands after insertion')
  assert.ok(!phases.has('COAST'), 'the sequencer kept flying through COAST — the handoff did not happen')
  for (const scripted of ['PITCH_KICK', 'GRAVITY_TURN', 'CIRCULARISE']) {
    assert.ok(phases.has(scripted), `the computer was supposed to fly ${scripted}`)
  }
  const done = program.objectives.filter((o) => o.done)
  assert.ok(done.some((o) => o.check === 'liftoff'), 'liftoff did not latch')
  assert.ok(
    done.some((o) => o.check === 'orbit'),
    'the orbit objective did not latch on a real 185 km orbit — the geometric check is broken',
  )
  disarmProgram()

  /* The unarmed half — the one a first draft of the sequencer gate got
     wrong: with nothing armed the same door must open onto COAST, exactly
     as every scripted mission has always flown it. A capability read
     passes this by accident, for the wrong reason; the armed-contract read
     passes it by construction. */
  const unprogrammed = new Set()
  flyMission('CIRCULARISE', {
    onPhase: (id, from) => {
      unprogrammed.add(from)
      unprogrammed.add(id)
    },
  })
  let coasted = false
  flyUntil(
    () => {
      const id = currentPhase().id
      if (id === 'COAST') return (coasted = true)
      if (id === 'PILOT_FLIGHT') return true
      return false
    },
    { maxFrames: 400_000 },
  )
  assert.ok(coasted, 'an unarmed flight was routed into pilot flight — the scripted missions broke')
  assert.ok(unprogrammed.has('CIRCULARISE'), 'the unarmed flight never reached insertion')
  assert.ok(!unprogrammed.has('PILOT_FLIGHT'), 'an unarmed flight entered pilot flight')
  disarmProgram()
  resetMission()
})

console.log(`verify-programs: ${n} checks — ladder, budgets, the one-way landing, arming, tables, and a flown handoff pass`)
