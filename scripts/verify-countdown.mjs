/**
 * The last minute on the pad, flown and measured.
 *
 * `countdown.js` is a table and a handful of pure functions; this gate is the
 * claim that the minute they describe is the minute the simulator flies. It
 * stands a vehicle on the pad with the ground sequence running, steps it at
 * real time through to the pitch kick, and checks what happened against what
 * was said would happen — the order of events, the vehicle held still under
 * full thrust, the propellant that costs, the clock running through the hold,
 * and a flight that still reaches its parking orbit afterwards.
 *
 * It also pins the two things this work found wrong on the way, so they stay
 * fixed:
 *
 * **Mission time was frozen through the hold.** `resetMission` set it to minus
 * the count and nothing advanced it until liftoff wrote zero, so MET read T-60
 * for the whole minute and then jumped. Checked here as a clock that increases
 * every frame of the hold and passes through zero without a step.
 *
 * **The ground was drawn tilted.** Terrain and pad were oriented by a
 * left-handed basis — x east, y up, z north — which is a reflection, and
 * `setFromRotationMatrix` forced it into a rotation that was wrong by 40 to 70
 * degrees depending on the hour. The fix is a right-handed rotation plus a
 * mirror in z; checked here the way the renderer composes it, at several
 * hours, against the true local frame.
 *
 *   node --expose-gc scripts/verify-countdown.mjs
 */
process.env.PERIAPSIS_VESSEL ??= 'apollo8'
process.env.PERIAPSIS_SITE ??= 'ksc'

const { Matrix4, Quaternion, Vector3 } = await import('three')
const { commitTLI, currentPhase, mission } = await import('../src/sim/mission.js')
const { flight, flyUntil, frame, standOnPad } = await import('../src/sim/fastForward.js')
const { live } = await import('../src/sim/live.js')
const { ship } = await import('../src/sim/ship.js')
const { WARP } = await import('../src/sim/warp.js')
const { INDEX } = await import('../src/sim/system.js')
const { SPIN_AXIS, SPIN_RATE } = await import('../src/sim/atmosphere.js')
const { LAUNCH_SITES, siteDirection } = await import('../src/sim/launchsite.js')
const { BODIES, G, SHIP } = await import('../src/sim/constants.js')
const {
  COUNT_LENGTH,
  EVENTS,
  armRetraction,
  delugeLevel,
  ignitionThrottle,
  stageOfCount,
  steamLevel,
  ventLevel,
} = await import('../src/sim/countdown.js')
const { EYE_FOV, EYE_HEIGHT, STAND_OFF, groundViewpoint, lastPlacement } = await import('../src/gfx/groundView.js')
const { padFor } = await import('../src/gfx/pads.js')
const { SMALLEST_OBJECT, allocatesNothing, bytesPerCall, knownAllocation, sampleText, seesAllocation } =
  await import('./allocation.mjs')

const FRAME = 1 / 60

/* ---------------------------------------------------------------- *
 * 1. The timeline, as functions
 * ---------------------------------------------------------------- */

const order = [EVENTS.ventStart, EVENTS.armsAway, EVENTS.deluge, EVENTS.ignition, EVENTS.release]
const ordered = order.every((t, i) => i === 0 || t > order[i - 1])
const armsClearBeforeIgnition = armRetraction(EVENTS.ignition) === 1
const fullThrustAtRelease = ignitionThrottle(EVENTS.release) === 1
const noThrustBeforeIgnition = ignitionThrottle(EVENTS.ignition - 0.01) === 0
const noSteamWithoutWater = steamLevel(EVENTS.ignition, 1) === delugeLevel(EVENTS.ignition) * 1 && steamLevel(-30, 1) === 0
const ventsClosedAtIgnition = ventLevel(EVENTS.ignition) === 0

/* ---------------------------------------------------------------- *
 * 2. The minute, flown at real time
 * ---------------------------------------------------------------- */

standOnPad(5)
flight.pilotWarp = WARP.x1
const prop0 = ship.stageProp[0]
const startPos = new Vector3()
const pos = new Vector3()
const shipRel = (out) => {
  const s = live.sim.state
  const o = INDEX.ship * 6
  const e = INDEX.earth * 6
  return out.set(s[o] - s[e], s[o + 1] - s[e + 1], s[o + 2] - s[e + 2])
}
shipRel(startPos)

/*
 * Gravity at the pad: the point mass's GM/r² less the radial part of the
 * centrifugal term, ω² r_perp² / r — from the pad's own radius and the spin
 * axis the clamp turns about, rather than a textbook 9.81.
 */
const padR = startPos.length()
const alongAxis = startPos.x * SPIN_AXIS[0] + startPos.y * SPIN_AXIS[1] + startPos.z * SPIN_AXIS[2]
const padGravity = (G * BODIES.earth.mass) / (padR * padR) - (SPIN_RATE * SPIN_RATE * (padR * padR - alongAxis * alongAxis)) / padR

const seen = []
let lastStage = ''
let lastMET = mission.t
let metMonotone = true
let maxMETStep = 0
let heldDrift = 0
let firstThrust = null
let propAtRelease = null
let throttleAtRelease = null
let thrustAtRelease = null
let massAtRelease = null
let coordinate = null
// A vehicle that was not held, flown alongside on the same thrust history.
let freeV = 0
let freeRise = 0
for (let i = 0; i < 60 * (COUNT_LENGTH + 5); i++) {
  frame(FRAME)
  const id = currentPhase().id
  const T = mission.t
  if (T < lastMET - 1e-9) metMonotone = false
  maxMETStep = Math.max(maxMETStep, T - lastMET)
  lastMET = T
  if (id === 'PRE_LAUNCH') {
    const st = stageOfCount(T)
    if (st !== lastStage) {
      seen.push([st, +T.toFixed(2)])
      lastStage = st
    }
    // Held still: the vehicle's height above Earth's centre must not change.
    heldDrift = Math.max(heldDrift, Math.abs(shipRel(pos).length() - startPos.length()))
    if (firstThrust === null && ship.thrust > 0) firstThrust = T
    // Unheld, it rests on the pad until thrust exceeds weight, then climbs.
    freeV = Math.max(0, freeV + (ship.thrust / ship.mass - padGravity) * FRAME)
    freeRise += freeV * FRAME
  } else if (propAtRelease === null) {
    propAtRelease = prop0 - ship.stageProp[0]
    throttleAtRelease = ship.throttle
    // Read here, at release, and not after the flight below has gone on to
    // orbit — see where the unclamped frame is worked out.
    thrustAtRelease = ship.thrust
    massAtRelease = ship.mass
    coordinate = Math.hypot(...live.sim.state.slice(INDEX.earth * 6, INDEX.earth * 6 + 3))
  }
  if (id === 'PITCH_KICK') break
}

const mdot = SHIP.stages[0].thrust / (SHIP.stages[0].isp * 9.80665)
const equivalentSeconds = EVENTS.spinUp * 0.5 + (EVENTS.release - EVENTS.ignition - EVENTS.spinUp)
const predictedBurn = mdot * equivalentSeconds

/* ---------------------------------------------------------------- *
 * 3. And the flight still reaches orbit afterwards
 * ---------------------------------------------------------------- */

let committed = false
flyUntil(() => ['TLI_ALIGN', 'TLI_BURN', 'TRANS_LUNAR', 'LOST'].includes(currentPhase().id), {
  onPhase: () => {},
  onFrame: () => {
    if (!committed && currentPhase().id === 'COAST') committed = commitTLI()
    flight.pilotWarp = mission.warpRequest !== null ? null : WARP.m1
  },
})
const reached = currentPhase().id
const perigee = live.elements.perigee
const apogee = live.elements.apogee

/* ---------------------------------------------------------------- *
 * 4. The ground's frame, as the renderer composes it
 * ---------------------------------------------------------------- */

/*
 * Terrain.jsx: rotation from the basis (east, up, -north), composed with a
 * scale of -1 in z. That should carry local (x, y, z) to x east + y up +
 * z north exactly — checked here by building the same matrix three would, at
 * several hours, and reading its columns back against the true local frame.
 */
const axis = new Vector3(SPIN_AXIS[0], SPIN_AXIS[1], SPIN_AXIS[2])
let worstGroundDeg = 0
let worstOldDeg = 0
for (const hours of [0, 2, 5, 6.58, 12, 18]) {
  const up = new Vector3()
  siteDirection(up, LAUNCH_SITES.ksc, hours * 3600)
  const east = new Vector3().crossVectors(axis, up).normalize()
  const north = new Vector3().crossVectors(up, east).normalize()

  const q = new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(east, up, north.clone().negate()))
  const m = new Matrix4().compose(new Vector3(), q, new Vector3(1, 1, -1))
  const col = (i) => new Vector3().setFromMatrixColumn(m, i).normalize()
  const deg = (a, b) => (Math.acos(Math.min(1, Math.max(-1, a.dot(b)))) * 180) / Math.PI
  worstGroundDeg = Math.max(worstGroundDeg, deg(col(0), east), deg(col(1), up), deg(col(2), north))

  // The construction it replaced, for the record of how wrong it was.
  const old = new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(east, up, north))
  worstOldDeg = Math.max(worstOldDeg, deg(new Vector3(0, 1, 0).applyQuaternion(old), up))
}

/* ---------------------------------------------------------------- *
 * 5. The person on the ground
 * ---------------------------------------------------------------- */

const eye = new Vector3()
const eyeUp = new Vector3()
const earth = new Vector3()
const R = (await import('../src/sim/constants.js')).BODIES.earth.radius
const across = new Vector3()
const launch = new Vector3()
let worstHeight = 0
let worstStandOff = 0
let worstTrench = 0
let everToward = false
let tieOffSunSide = false
const placements = []
/*
 * Two Suns, to the south and to the north *of each pad* — built in that pad's
 * own frame at that hour — so the tie-break is exercised both ways. The first
 * draft used two fixed scene vectors and called them south and north, but a
 * scene axis is not a compass direction at any particular pad, and at Kourou
 * both happened to fall on the same side, so the tie-break was never tested
 * against a Sun it should have turned away from.
 */
const sun = new Vector3()
for (const side of [-1, 1]) {
  for (const site of Object.values(LAUNCH_SITES)) {
    for (const hours of [0, 5, 11]) {
      live.sim.t = hours * 3600
      {
        const u = new Vector3()
        siteDirection(u, site, live.sim.t)
        const e = new Vector3().crossVectors(axis, u).normalize()
        const n = new Vector3().crossVectors(u, e).normalize()
        sun.copy(u).multiplyScalar(0.6).addScaledVector(n, 0.8 * side).normalize()
      }
      groundViewpoint(eye, eyeUp, site, sun, earth)
      lastPlacement(across, launch)
      worstHeight = Math.max(worstHeight, Math.abs(eye.length() - (R + EYE_HEIGHT)))
      const padUp = new Vector3()
      siteDirection(padUp, site, live.sim.t)
      worstStandOff = Math.max(worstStandOff, Math.abs(R * Math.acos(Math.min(1, padUp.dot(eyeUp))) - STAND_OFF))

      // The trench's horizontal direction at this pad, if it has one.
      const eastP = new Vector3().crossVectors(axis, padUp).normalize()
      const northP = new Vector3().crossVectors(padUp, eastP).normalize()
      const pad = padFor(site.id)
      if (pad.trench > 0) worstTrench = Math.max(worstTrench, Math.abs(across.dot(pad.trenchAxis === 'ew' ? eastP : northP)))

      const toward = across.dot(launch)
      if (toward > 0.2) everToward = true
      if (Math.abs(toward) <= 0.2) {
        const sunH = sun.clone().addScaledVector(padUp, -sun.dot(padUp))
        if (across.dot(sunH) < 0) tieOffSunSide = true
      }
      if (hours === 5) {
        const bearing = ((Math.atan2(across.dot(eastP), across.dot(northP)) * 180) / Math.PI + 360) % 360
        placements.push(`${site.id} ${bearing.toFixed(0)}°`)
      }
    }
  }
}

/* ---------------------------------------------------------------- *
 * 6. Allocation of what runs every frame
 * ---------------------------------------------------------------- */

const control = await knownAllocation()
const Ts = new Float64Array(512)
for (let i = 0; i < 512; i++) Ts[i] = -60 + (i / 512) * 80
const cursor = new Int32Array(1)
const sink = new Float64Array(1)
const levels = await bytesPerCall(() => {
  const T = Ts[cursor[0]++ & 511]
  sink[0] = ventLevel(T) + delugeLevel(T) + armRetraction(T) + steamLevel(T, ignitionThrottle(T))
})
const benchSun = new Vector3(0.12, 0.6, -0.78).normalize()
const placement = await bytesPerCall(() => {
  groundViewpoint(eye, eyeUp, LAUNCH_SITES.ksc, benchSun, earth)
})

/*
 * What "held still" can mean at all. The state is heliocentric, ~1.5e11 m from
 * the origin, and float64 resolves a number that size to one unit in the last
 * place — so the ship-minus-Earth radius can wobble by a few of those however
 * perfectly the clamp works. The bar is set from that resolution rather than
 * picked: the first draft asserted a micrometre, which is below what these
 * coordinates can represent, and failed on roundoff.
 *
 * And what a bar that loose can still tell apart. The check that pairs with
 * it is the same control the allocation checks use — that the measurement can
 * see the thing it rules out: a vehicle *not* held, flown alongside on the same
 * thrust history, rests on the pad until thrust passes its weight and then
 * climbs, and by release it has to have gone further than the hold is allowed
 * to drift, or "held still" would not distinguish held from free.
 *
 * The first draft compared against one frame of free flight instead, and got
 * that wrong twice: it read `ship.mass` down here, after the flight above had
 * gone on to orbit, so it divided the first stage's thrust by what was left of
 * the vehicle — 4.0 cm a frame — and its comment's 1.6 mm had left gravity
 * out. At release it is 0.24 mm. And one frame was never the right comparison:
 * the whole point of a hold-down is the second or so during which thrust
 * exceeds weight and the vehicle is not allowed to go.
 */
const ulp = coordinate * Number.EPSILON

console.log('\n=== the minute ===')
console.log(`  events as flown: ${seen.map(([s, t]) => `${s} T${t}`).join(' -> ')}`)
console.log(`  first thrust at T${firstThrust?.toFixed(2)}, released at full throttle ${throttleAtRelease?.toFixed(3)}`)
console.log(`  held still under thrust: ${heldDrift.toExponential(2)} m of drift in radius, against ${ulp.toExponential(2)} m of coordinate resolution`)
console.log(`  at release: ${(thrustAtRelease / 1e6).toFixed(2)} MN on ${(massAtRelease / 1e3).toFixed(0)} t, thrust-to-weight ${(thrustAtRelease / (massAtRelease * padGravity)).toFixed(3)} against ${padGravity.toFixed(3)} m/s² at the pad`)
console.log(`  not held, the same thrust would have lifted it ${freeRise.toFixed(2)} m by release`)
console.log(`  propellant burned on the pad: ${(propAtRelease / 1000).toFixed(1)} t measured, ${(predictedBurn / 1000).toFixed(1)} t predicted`)
console.log(`  mission time through the hold: monotone ${metMonotone}, largest step ${maxMETStep.toFixed(3)} s`)
console.log(`  then: ${reached}, parking orbit ${(perigee / 1e3).toFixed(1)} x ${(apogee / 1e3).toFixed(1)} km`)
console.log('\n=== the ground frame ===')
console.log(`  worst axis error as rendered: ${worstGroundDeg.toExponential(2)} deg; the old construction's up was off by up to ${worstOldDeg.toFixed(1)} deg`)
console.log('\n=== the observer ===')
console.log(`  eye height error ${worstHeight.toExponential(2)} m, stand-off error ${worstStandOff.toExponential(2)} m`)
console.log(`  bearing from the pad at +5 h, Sun to the local south then north: ${placements.join(', ')}`)
console.log(`\n=== allocation ===\n  the countdown levels: ${sampleText(levels)}\n  the observer placement: ${sampleText(placement)}`)

console.log('\n=== what this establishes ===')
const checks = [
  ['the events are in order: vents, arms, deluge, ignition, release', ordered],
  ['the arms are clear before the engines light', armsClearBeforeIgnition],
  ['the vents are closed by ignition, the tanks pressurised for flight', ventsClosedAtIgnition],
  ['no thrust before ignition, and full thrust by release', noThrustBeforeIgnition && fullThrustAtRelease],
  ['no steam without deluge water, however hard the engines burn', noSteamWithoutWater],
  ['the count is a minute', COUNT_LENGTH === 60],
  // Flown.
  ['flown, the events happen in that order', seen.map((s) => s[0]).join(',') === 'hold,arms,deluge,ignition'],
  ['the engines light at ignition, not before', firstThrust !== null && Math.abs(firstThrust - EVENTS.ignition) < 0.05],
  ['and the vehicle leaves at full throttle', throttleAtRelease === 1],
  ['the clamp holds it still under thrust, to the resolution of the coordinates', heldDrift < ulp * 8],
  ['against thrust that would have lifted it further than that before release', freeRise > ulp * 8],
  ['the pad burn costs the propellant the engines actually use', Math.abs(propAtRelease / predictedBurn - 1) < 0.03],
  ['mission time runs through the hold, never backwards and never jumping', metMonotone && maxMETStep < 0.05],
  ['and the flight still reaches a closed parking orbit', ['TLI_ALIGN', 'TLI_BURN', 'TRANS_LUNAR'].includes(reached) && perigee > 150e3],
  // The ground.
  ['the ground is drawn in the true local frame at every hour', worstGroundDeg < 1e-6],
  ['which the left-handed construction it replaced was not', worstOldDeg > 30],
  // The observer.
  [`the eye is ${EYE_HEIGHT} m above the ground at every pad and hour`, worstHeight < 1e-6],
  [`standing ${STAND_OFF} m from the pad`, worstStandOff < 0.01],
  /*
   * The placement rule, ranked. Across the trench first: the check that the
   * first version of this view lacked, and whose absence stacked both steam
   * jets along the line of sight into one grey blob at Kennedy.
   */
  ['on every trenched pad the observer stands across the trench', worstTrench < 1e-9],
  ['never on the side the vehicle flies toward', !everToward],
  ['and where the first two leave it open, on the side the Sun is on', !tieOffSunSide],
  ['through a human lens', EYE_FOV === 65],
  // Cost.
  seesAllocation('the allocation measurement can see an allocation', control),
  allocatesNothing('the countdown levels allocate nothing', levels, SMALLEST_OBJECT / 2),
  allocatesNothing('placing the observer allocates nothing', placement, SMALLEST_OBJECT / 2),
]
let pass = true
for (const [label, ok] of checks) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`)
  if (!ok) pass = false
}
console.log(`\n  ${pass ? 'PASS' : 'FAIL'}`)
process.exit(pass ? 0 : 1)
