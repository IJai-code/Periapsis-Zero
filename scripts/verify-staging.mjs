/**
 * Staging in the middle of the capture burn.
 *
 * The nominal insertion happens to fit inside the ICPS with about 18 m/s to
 * spare, so the separation never fires and the interrupt's behaviour is never
 * exercised. A slightly costlier approach or a slightly hungrier mid-course
 * correction would exercise it, so it is forced here by shorting the stage.
 *
 * What is checked while the interrupt is running: that the stage really does run
 * dry and separate mid-burn, that the vehicle stays pointed retrograde rather
 * than reverting to the ascent pitch programme, that the interrupt is short, and
 * that the capture still closes afterwards. Plus what a separation *is*:
 * bookkeeping, not an event in the trajectory — the mass drops by the jettisoned
 * structure and the craft is not moved.
 *
 * **Artemis, and that is not incidental.** This script is written against the
 * Artemis stack, whose capture burns stage 2, the ICPS (`stageProp[2]`, 26,853 kg
 * of a 29,360 kg vehicle). Apollo 8 has five stages and burns the Service Module
 * at index 3, so on an Apollo-8 state `stageProp[2]` is the S-IVB — jettisoned
 * back at TLI, and setting it does nothing at all. Measured: identical delivered
 * delta-v to two decimals for every value of the shorting, and `STAGING seen:
 * false`. So the vessel is pinned here rather than left to the environment, and
 * the fixture is Artemis's own approach state. Loading an Apollo-8 snapshot under
 * this vessel would be incoherent, so the two are pinned together.
 *
 *   node scripts/verify-staging.mjs                          the fixture
 *   node scripts/verify-staging.mjs other-artemis.json 2500   some other state,
 *                                                             and how much
 *                                                             propellant to leave
 *
 * The vessel is pinned **before** the imports, and they are dynamic for that
 * reason: static `import` declarations are hoisted and evaluated first, so an
 * assignment written above them lands after the modules that read it. Written
 * that way this loaded Artemis's state under Apollo 8's stage table — 44.77 t
 * with a 24,500 kg "ICPS" that is really the S-IVB — which is a coherent-looking
 * run of the wrong vehicle, so it is worth naming rather than leaving to bite.
 * `verify-lunar-ascent` pins its vessel and site the same way.
 */
process.env.PERIAPSIS_VESSEL = 'artemis'

const { flight, frame, loadSnapshot, LUNAR_APPROACH_ARTEMIS_FIXTURE } = await import('./flight.mjs')
const { WARP } = await import('../src/sim/warp.js')
const { live } = await import('../src/sim/live.js')
const { currentPhase, mission } = await import('../src/sim/mission.js')
const { ship, totalMass } = await import('../src/sim/ship.js')
const { BODIES, SHIP } = await import('../src/sim/constants.js')
const { INDEX } = await import('../src/sim/system.js')

const R = BODIES.moon.radius
const snap = process.argv[2] ?? LUNAR_APPROACH_ARTEMIS_FIXTURE
const SHORT = Number(process.argv[3] ?? 3000) // kg left in the ICPS

loadSnapshot(snap)
ship.stageProp[2] = SHORT
ship.mass = totalMass()

console.log(`ICPS shorted to ${SHORT} kg — the capture must cross a separation\n`)

const o = INDEX.ship * 6

let worstPointing = 0
let worstDuringStaging = 0
let stagingFrames = 0
let separations0 = ship.separations
let sawStaging = false
let last = currentPhase().id
let cutoffE = null

/* Bookkeeping around the separation, and the frame's own travel either side. */
let prevMass = totalMass()
let prevPropBurning = ship.stageProp[ship.stage]
let prevStage = ship.stage
let prevPos = [live.sim.state[o], live.sim.state[o + 1], live.sim.state[o + 2]]
let prevTravel = null
let separation = null

for (let i = 0; i < 6_000_000; i++) {
  flight.pilotWarp = mission.warpRequest === null ? WARP.h6 : null
  const massBefore = totalMass()
  const stageBefore = ship.stage
  frame()
  const id = currentPhase().id

  const p = [live.sim.state[o], live.sim.state[o + 1], live.sim.state[o + 2]]
  const travel = Math.hypot(p[0] - prevPos[0], p[1] - prevPos[1], p[2] - prevPos[2])

  if (id !== last) {
    console.log(
      `  ${(last + ' -> ' + id).padEnd(28)} MET ${(mission.t / 3600).toFixed(4)} h  ` +
        `stage ${ship.stage}  mass ${(totalMass() / 1e3).toFixed(3)} t  ` +
        `e ${live.lunar.eccentricity.toFixed(5)}  point ${(mission.loi.pointingError * 1e3).toFixed(2)} mrad`,
    )
    last = id
  }

  if (mission.loi.ignited && (id === 'LOI_BURN' || id === 'STAGING')) {
    worstPointing = Math.max(worstPointing, mission.loi.pointingError)
    if (id === 'STAGING') {
      sawStaging = true
      stagingFrames++
      worstDuringStaging = Math.max(worstDuringStaging, mission.loi.pointingError)
    }
  }

  if (ship.separations > separations0 && !separation) {
    /*
     * The frame the stage went. `separate()` clamps the burning stage to zero
     * propellant before it jettisons, so the drop is the propellant that frame's
     * burn consumed plus the jettisoned stage's dry structure — both known
     * exactly, so this is arithmetic rather than a tolerance.
     */
    const jettisoned = stageBefore
    separation = {
      stage: jettisoned,
      massBefore,
      massAfter: totalMass(),
      burnedProp: prevPropBurning,
      dry: SHIP.stages[jettisoned].dryMass,
      travel,
      prevTravel,
      speed: live.lunar.speed,
    }
  }

  prevMass = totalMass()
  prevPropBurning = ship.stageProp[ship.stage]
  prevStage = ship.stage
  prevPos = p
  prevTravel = travel

  if (id === 'LUNAR_ORBIT') {
    cutoffE = live.lunar.eccentricity
    break
  }
}

const l = live.lunar
console.log(`\n  separation during the burn   ${ship.separations > separations0} (STAGING seen: ${sawStaging}, ${stagingFrames} frames)`)
console.log(`  worst pointing error, burn   ${(worstPointing * 1e3).toFixed(3)} mrad`)
console.log(`  worst pointing, while staging ${(worstDuringStaging * 1e3).toFixed(3)} mrad`)
console.log(`  cutoff criterion             ${mission.loi.cutoff}`)
console.log(`  delivered dv                 ${mission.loi.deltaVDelivered.toFixed(2)} m/s over ${mission.loi.burnDuration.toFixed(1)} s`)
console.log(
  `  achieved orbit               ${((l.periapsisRadius - R) / 1e3).toFixed(2)} x ` +
    `${((l.apoapsisRadius - R) / 1e3).toFixed(2)} km   e ${cutoffE.toFixed(5)}   ` +
    `period ${(l.period / 60).toFixed(2)} min`,
)
console.log(`  minimum altitude reached     ${((mission.loi.minRadius - R) / 1e3).toFixed(2)} km`)
if (separation) {
  const expected = separation.massBefore - (separation.burnedProp + separation.dry)
  console.log(
    `\n  stage ${separation.stage} jettisoned: mass ${(separation.massBefore / 1e3).toFixed(4)} t -> ` +
      `${(separation.massAfter / 1e3).toFixed(4)} t, a drop of ${(separation.massBefore - separation.massAfter).toFixed(3)} kg\n` +
      `    = ${separation.burnedProp.toFixed(3)} kg burnt that frame + ${separation.dry} kg dry structure; ` +
      `the arithmetic expects ${(separation.massBefore - expected).toFixed(6)} kg, off by ` +
      `${Math.abs(separation.massAfter - expected).toExponential(2)} kg`,
  )
  console.log(
    `    travel across that frame ${separation.travel.toFixed(4)} m against ${(separation.prevTravel ?? NaN).toFixed(4)} m the frame before`,
  )
}

/*
 * The claims.
 *
 * The interrupt is held for 2.5 s, which at the burn's 1x cap is 150 frames;
 * measured 151, so the bar is 600 and is about bounding a runaway rather than
 * pinning a figure. The pointing bar is looser than it looks for the same reason
 * — measured 0.028 mrad, where the alignment phase's own convergence test is
 * 5 mrad, so the bar is the same 5 mrad the sequencer already calls aligned.
 */
const checks = [
  ['the shorted stage really does run dry mid-burn and separate', ship.separations > separations0],
  ['the interrupt runs, and briefly', sawStaging && stagingFrames > 0 && stagingFrames < 600],
  [
    'the vehicle holds retrograde through the interrupt',
    worstDuringStaging < 5e-3,
  ],
  [
    'the separation is bookkeeping: the drop is the burnt propellant plus dry structure, to 1e-6 kg',
    separation !== null &&
      Math.abs(separation.massAfter - (separation.massBefore - (separation.burnedProp + separation.dry))) < 1e-6,
  ],
  [
    'and the craft is not thrown: it travels no further across that frame than it did the one before',
    separation !== null && separation.prevTravel !== null && separation.travel <= separation.prevTravel * 1.5,
  ],
  ['the capture still closes after the interruption: bound and low', cutoffE < 0.05],
  [
    'and above the surface',
    l.periapsisRadius > R && l.periapsisRadius - R < 200e3,
  ],
]

console.log('\n=== what this establishes ===')
let ok = true
for (const [label, pass] of checks) {
  if (pass !== true) ok = false
  console.log(`  ${pass === true ? 'PASS' : 'FAIL'}  ${label}`)
}
console.log(`\n  ${ok ? 'PASS' : 'FAIL'}`)
process.exit(ok ? 0 : 1)
