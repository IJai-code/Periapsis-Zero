/**
 * Frames of reference: is a burn measured against the body it is actually near?
 *
 * Every node is written as prograde, normal and radial — and those words mean
 * nothing until a centre is chosen. The projection and the flight computer both
 * used to choose Earth, always, which is right for a parking orbit and wrong
 * by 23.5 degrees of prograde and 91.3 of normal at lunar periselene. The drawn
 * trajectory chose its centre by largest raw pull, which is a different wrong
 * answer: it put two-thirds of the translunar coast on the Sun.
 *
 * Both now ask one question — Laplace's sphere of influence, sim/soi.js — and
 * this gate asks it back three ways:
 *
 *   1. the radii against the closed form and the textbook figures
 *   2. the real translunar coast, flown: is the craft ever on the Sun, and does
 *      it change hands at the sphere's edge rather than somewhere near it
 *   3. a capture burn planned by the pilot at periselene: drawn against the
 *      Moon, flown against the Moon, and landing where it was drawn
 *
 *   node --expose-gc scripts/verify-frames.mjs
 */
import { Vector3 } from 'three'
import { flight, flyMission, flyUntil } from './flight.mjs'
import { live, refreshDerived } from '../src/sim/live.js'
import { PHASE_IDS, PROFILE, currentPhase, mission } from '../src/sim/mission.js'
import { BODIES, G } from '../src/sim/constants.js'
import { INDEX } from '../src/sim/system.js'
import { WARP } from '../src/sim/warp.js'
import { addNode, clearNodes, nodeBasis, nodes, resolveNode } from '../src/sim/nodes.js'
import { plan, prediction, project } from '../src/sim/predict.js'
import { dominantBody, soiRadius } from '../src/sim/soi.js'
import {
  SMALLEST_OBJECT,
  allocatesNothing,
  bytesPerCall,
  knownAllocation,
  sampleText,
  seesAllocation,
} from './allocation.mjs'

const C = INDEX.ship * 6
const E = INDEX.earth * 6
const M = INDEX.moon * 6
const S = INDEX.sun * 6
const MU_MOON = G * BODIES.moon.mass
const dist = (st, a, b) => Math.hypot(st[a] - st[b], st[a + 1] - st[b + 1], st[a + 2] - st[b + 2])

/** Apsides and plane of an orbit about `body`, from a state and a velocity change. */
function orbitAbout(st, bodyOffset, mu, radius, dv = null) {
  const r = new Vector3(st[C] - st[bodyOffset], st[C + 1] - st[bodyOffset + 1], st[C + 2] - st[bodyOffset + 2])
  const v = new Vector3(st[C + 3] - st[bodyOffset + 3], st[C + 4] - st[bodyOffset + 4], st[C + 5] - st[bodyOffset + 5])
  if (dv) v.add(dv)
  const eps = v.lengthSq() / 2 - mu / r.length()
  const a = -mu / (2 * eps)
  const h = new Vector3().crossVectors(r, v)
  const e = Math.sqrt(Math.max(0, 1 - h.lengthSq() / (mu * a)))
  return { bound: eps < 0, peri: a * (1 - e) - radius, apo: a * (1 + e) - radius, e, normal: h.normalize() }
}

/** The pilot flyMission uses: follow the sequencer, else its own coast rates. */
function pilotWarp() {
  const id = currentPhase().id
  flight.pilotWarp = mission.warpRequest !== null ? null : id === 'LUNAR_APPROACH' ? WARP.h6 : WARP.m1
}

/* ------------------------------------------------------------------ *
 * 1. the radii
 * ------------------------------------------------------------------ */
/**
 * Exact against the closed form at the live separation, since that is the
 * definition; and within a percent of the textbook radii at the mean distances,
 * which is a check on the masses and the exponent rather than on the arithmetic.
 * Textbooks round these differently — 66,100 or 66,200 km for the Moon, 924,000
 * or 925,000 for Earth — so the gate is a percent, and the numbers are printed.
 */
const AU = 1.495978707e11
const MEAN_LUNAR_DISTANCE = 384_400e3
const st0 = live.sim.state
const moonRatio = Math.pow(BODIES.moon.mass / BODIES.earth.mass, 0.4)
const earthRatio = Math.pow(BODIES.earth.mass / BODIES.sun.mass, 0.4)
const moonRatioErr = Math.abs(soiRadius(st0, 'moon') / dist(st0, M, E) - moonRatio) / moonRatio
const earthRatioErr = Math.abs(soiRadius(st0, 'earth') / dist(st0, E, S) - earthRatio) / earthRatio
const moonMean = moonRatio * MEAN_LUNAR_DISTANCE
const earthMean = earthRatio * AU

console.log('=== spheres of influence ===')
console.log(`  Moon    ${(moonMean / 1e3).toFixed(0)} km at the mean distance (textbook 66,100)   live ${(soiRadius(st0, 'moon') / 1e3).toFixed(0)} km`)
console.log(`  Earth   ${(earthMean / 1e3).toFixed(0)} km at 1 AU (textbook 924,000)              live ${(soiRadius(st0, 'earth') / 1e3).toFixed(0)} km`)
console.log(`  Sun     ${soiRadius(st0, 'sun')}`)

/* Classification at constructed points either side of each boundary. */
const probe = live.sim.clone()
function classifyAt(bodyOffset, dir, radius) {
  probe.resetFrom(live.sim)
  const ps = probe.state
  for (let k = 0; k < 3; k++) ps[C + k] = ps[bodyOffset + k] + dir[k] * radius
  return dominantBody(probe, 'ship')
}
const em = [st0[M] - st0[E], st0[M + 1] - st0[E + 1], st0[M + 2] - st0[E + 2]]
const emLen = Math.hypot(...em)
const outward = em.map((x) => x / emLen)
// Perpendicular to the Earth-Moon line, so the Earth-boundary probes stay far from the Moon.
const perp = (() => {
  const p = [-outward[1], outward[0], 0]
  const l = Math.hypot(...p)
  return p.map((x) => x / l)
})()
const moonSOI = soiRadius(st0, 'moon')
const earthSOI = soiRadius(st0, 'earth')
const classes = {
  nearMoon: classifyAt(M, outward, 2_000e3),
  insideMoon: classifyAt(M, outward, moonSOI * 0.99),
  outsideMoon: classifyAt(M, outward, moonSOI * 1.01),
  insideEarth: classifyAt(E, perp, earthSOI * 0.99),
  outsideEarth: classifyAt(E, perp, earthSOI * 1.01),
}
console.log(`  2,000 km from the Moon -> ${classes.nearMoon};  0.99 / 1.01 of its sphere -> ${classes.insideMoon} / ${classes.outsideMoon}`)
console.log(`  0.99 / 1.01 of Earth's sphere, away from the Moon -> ${classes.insideEarth} / ${classes.outsideEarth}`)

/* ------------------------------------------------------------------ *
 * 2. the real coast
 * ------------------------------------------------------------------ */
/**
 * Stopped at TLI_ALIGN, not COAST. flyMission commits the injection from inside
 * its own per-frame hook, which runs before its stopping test — so on the frame
 * COAST is entered it has already moved on, never sees COAST again, and flies
 * the entire mission to the frame cap. The first draft of this gate did exactly
 * that and reported a "periselene" 378,840 km from the Moon. TLI_ALIGN is the
 * attitude phase before the burn, so the parking orbit is still intact here.
 */
flyMission('TLI_ALIGN', { onPhase: () => {} })
refreshDerived()

// A node in the parking orbit is Earth's, and must stay Earth's.
{
  const scratch = live.sim.clone()
  clearNodes()
  addNode(live.sim.t + 900, { prograde: 10 })
  project(live.sim, scratch, 'ship', 'earth', live.elements.period * 1.5, plan, nodes)
  var leoBody = plan.nodeBodies[0]
  clearNodes()
}

flyUntil(() => currentPhase().id === 'TRANS_LUNAR', { onFrame: pilotWarp })

/**
 * The criterion this replaced, reproduced here only to show what it did. Largest
 * raw pull: m / r^2 over the massive bodies.
 */
function rawPull(st) {
  let best = null
  let most = -Infinity
  for (const id of ['sun', 'earth', 'moon']) {
    const o = INDEX[id] * 6
    const pull = BODIES[id].mass / Math.max(dist(st, C, o) ** 2, 1)
    if (pull > most) {
      most = pull
      best = id
    }
  }
  return best
}

const timeIn = { sun: 0, earth: 0, moon: 0 }
const rawIn = { sun: 0, earth: 0, moon: 0 }
let coast = 0
let last = live.sim.t
let handover = null
let previous = dominantBody(live.sim, 'ship')
let rawPrevious = rawPull(live.sim.state)
const rawFlips = []
flyUntil(
  () => currentPhase().id === 'LUNAR_APPROACH' && live.insideLunarSOI && live.lunar.timeToPeriapsis > 0 && live.lunar.timeToPeriapsis < 5400,
  {
    maxFrames: 20_000_000,
    onFrame: () => {
      pilotWarp()
      const st = live.sim.state
      const dt = live.sim.t - last
      last = live.sim.t
      const now = dominantBody(live.sim, 'ship')
      timeIn[now] += dt
      const raw = rawPull(st)
      rawIn[raw] += dt
      if (raw !== rawPrevious) {
        rawFlips.push({ to: raw, fromEarth: dist(st, C, E), fromMoon: dist(st, C, M) })
        rawPrevious = raw
      }
      coast += dt
      if (now === 'moon' && previous !== 'moon' && handover === null) {
        const vRel = Math.hypot(st[C + 3] - st[M + 3], st[C + 4] - st[M + 4], st[C + 5] - st[M + 5])
        handover = { range: dist(st, C, M), radius: soiRadius(st, 'moon'), travel: vRel * dt }
      }
      previous = now
    },
  },
)
const pct = (o) => ['earth', 'sun', 'moon'].map((k) => `${k} ${((100 * o[k]) / coast).toFixed(1)}%`).join(', ')

console.log('\n=== the translunar coast, flown ===')
console.log(`  parking-orbit node measured against   ${leoBody}`)
console.log(`  ${(coast / 3600).toFixed(1)} h of coast, TLI to ${(live.lunar.timeToPeriapsis / 60).toFixed(0)} min before periselene`)
console.log(`  sphere of influence   ${pct(timeIn)}`)
console.log(`  largest raw pull      ${pct(rawIn)}   <- what the map used to draw against`)
for (const f of rawFlips) {
  console.log(`    raw pull -> ${f.to.padEnd(5)} at ${(f.fromEarth / 1e3).toFixed(0)} km from Earth, ${(f.fromMoon / 1e3).toFixed(0)} km from the Moon`)
}
if (handover) {
  console.log(`  handed to the Moon at ${(handover.range / 1e3).toFixed(0)} km, sphere radius ${(handover.radius / 1e3).toFixed(0)} km,` +
    ` inside by ${((handover.radius - handover.range) / 1e3).toFixed(1)} km — one frame's travel is ${(handover.travel / 1e3).toFixed(1)} km`)
}

/* ------------------------------------------------------------------ *
 * 3. a capture burn, planned by the pilot
 * ------------------------------------------------------------------ */
/**
 * The sequencer is parked in its passive lunar coast so that the only burn is
 * the pilot's: left in LUNAR_APPROACH it would fly its own capture as well, and
 * the orbit read afterwards would be the sum of two. `phaseT` is zeroed so the
 * coast's two-hour dwell cannot hand over to trans-Earth injection before the
 * node comes round.
 */
mission.index = PHASE_IDS.indexOf('LUNAR_ORBIT')
mission.phaseT = 0
refreshDerived()

const scratch = live.sim.clone()
const toPeri = live.lunar.timeToPeriapsis
project(live.sim, scratch, 'ship', 'moon', toPeri * 2, prediction)
const tPeri = live.sim.t + prediction.periapsis.time

// The state at that instant, coasted independently of the projection.
const atPeri = live.sim.clone()
atPeri.resetFrom(live.sim)
atPeri.advance(tPeri - live.sim.t, 2, 1e7)
const pst = atPeri.state
const rPeri = dist(pst, C, M)
const vPeri = Math.hypot(pst[C + 3] - pst[M + 3], pst[C + 4] - pst[M + 4], pst[C + 5] - pst[M + 5])
const radialRate = ((pst[C] - pst[M]) * (pst[C + 3] - pst[M + 3]) + (pst[C + 1] - pst[M + 1]) * (pst[C + 4] - pst[M + 4]) + (pst[C + 2] - pst[M + 2]) * (pst[C + 5] - pst[M + 5])) / rPeri
const dvCapture = vPeri - Math.sqrt(MU_MOON / rPeri)

/* How far apart the two candidate frames are, where the burn happens. */
const axes = { pE: new Vector3(), nE: new Vector3(), oE: new Vector3(), pM: new Vector3(), nM: new Vector3(), oM: new Vector3() }
nodeBasis(pst, C, E, axes.pE, axes.nE, axes.oE)
nodeBasis(pst, C, M, axes.pM, axes.nM, axes.oM)
const smallAngle = (a, b) => Math.atan2(new Vector3().crossVectors(a, b).length(), a.dot(b))
const progradeApart = (smallAngle(axes.pE, axes.pM) * 180) / Math.PI
const normalApart = (smallAngle(axes.nE, axes.nM) * 180) / Math.PI

clearNodes()
const node = addNode(tPeri, { prograde: -dvCapture })
const circularPeriod = 2 * Math.PI * Math.sqrt(rPeri ** 3 / MU_MOON)
project(live.sim, scratch, 'ship', 'moon', toPeri + 1.5 * circularPeriod, plan, nodes)
const drawn = {
  body: plan.nodeBodies[0],
  apsisBody: plan.apsisBody,
  applied: plan.applied[0] === node.id,
  peri: plan.periapsis.radius - BODIES.moon.radius,
  apo: plan.apoapsis.radius - BODIES.moon.radius,
}

/**
 * The vector the projection applied, rebuilt from the frame it recorded — taken
 * now, while `plan` still describes this node. Read after the flight it would be
 * whatever the last projection wrote, the mistake verify-nodes already made once.
 */
{
  const fr = plan.nodeFrames
  var plannedDirection = new Vector3(fr[3], fr[4], fr[5]).multiplyScalar(node.prograde)
    .add(new Vector3(fr[6], fr[7], fr[8]).multiplyScalar(node.normal))
    .add(new Vector3(fr[9], fr[10], fr[11]).multiplyScalar(node.radial))
}

/* What the same node does resolved each way, at the same instant, in closed form. */
const dvMoon = new Vector3()
const dvEarth = new Vector3()
resolveNode(node, pst, C, M, dvMoon)
resolveNode(node, pst, C, E, dvEarth)
const viaMoon = orbitAbout(pst, M, MU_MOON, BODIES.moon.radius, dvMoon)
const viaEarth = orbitAbout(pst, M, MU_MOON, BODIES.moon.radius, dvEarth)

console.log('\n=== a capture burn at periselene ===')
console.log(`  periselene            ${((rPeri - BODIES.moon.radius) / 1e3).toFixed(1)} km, ${vPeri.toFixed(1)} m/s, radial rate ${radialRate.toFixed(3)} m/s`)
console.log(`  node                  ${dvCapture.toFixed(1)} m/s retrograde, ${(toPeri / 60).toFixed(0)} min out`)
console.log(`  Earth's axes vs the Moon's there   prograde ${progradeApart.toFixed(1)} deg apart, normal ${normalApart.toFixed(1)} deg`)
console.log(`  closed form, Moon's axes   ${(viaMoon.peri / 1e3).toFixed(1)} x ${(viaMoon.apo / 1e3).toFixed(1)} km`)
console.log(`  closed form, Earth's axes  ${(viaEarth.peri / 1e3).toFixed(1)} x ${(viaEarth.apo / 1e3).toFixed(1)} km   <- what used to be flown`)
console.log(`  projection draws      ${(drawn.peri / 1e3).toFixed(1)} x ${(drawn.apo / 1e3).toFixed(1)} km about ${drawn.apsisBody}, node measured against ${drawn.body}`)

/* ------------------------------------------------------------------ *
 * 4. the flight computer flies it
 * ------------------------------------------------------------------ */
let bodyAtAlign = null
let sawAlign = false
let sawBurn = false
let ignitionLate = null
let burnStart = null
let burnEnd = null
const flownDirection = new Vector3()
flyUntil(() => node.executed && currentPhase().id !== 'NODE_BURN' && live.sim.t > node.t + 900, {
  maxFrames: 5_000_000,
  onFrame: () => {
    const id = currentPhase().id
    if (id === 'NODE_ALIGN') {
      sawAlign = true
      if (bodyAtAlign === null) bodyAtAlign = mission.node.body
    }
    if (id === 'NODE_BURN' && !sawBurn) {
      sawBurn = true
      ignitionLate = live.sim.t - node.t
      burnStart = live.sim.t
      flownDirection.copy(mission.node.direction)
    }
    if (sawBurn && burnEnd === null && id !== 'NODE_BURN') burnEnd = live.sim.t
    flight.pilotWarp = mission.warpRequest !== null ? null : WARP.m1
  },
})
const flown = orbitAbout(live.sim.state, M, MU_MOON, BODIES.moon.radius)

console.log('\n=== flown by the sequencer ===')
console.log(`  aligned ${sawAlign}, burned ${sawBurn}, executed ${node.executed}, measured against ${bodyAtAlign}`)
console.log(`  ignition              ${ignitionLate?.toFixed(1)} s relative to the node (a centred burn starts half a burn early)`)
console.log(`  delivered             ${mission.node.delivered.toFixed(1)} of ${dvCapture.toFixed(1)} m/s`)
console.log(`  flown orbit           ${(flown.peri / 1e3).toFixed(1)} x ${(flown.apo / 1e3).toFixed(1)} km, e ${flown.e.toFixed(4)}, bound ${flown.bound}`)
console.log(`  against the drawing   periselene ${((flown.peri - drawn.peri) / 1e3).toFixed(1)} km, aposelene ${((flown.apo - drawn.apo) / 1e3).toFixed(1)} km`)

/* ------------------------------------------------------------------ *
 * 5. what the map applied against what was flown
 * ------------------------------------------------------------------ */
/**
 * The direction the projection applied, rebuilt from the frame it recorded, and
 * the one the flight computer held. They are solved from separate integrations
 * of the same coast — ninety minutes in the projection's coarse steps, a few
 * minutes in the flight computer's fine ones — so they agree to integration
 * error, not exactly. The gate is the vehicle's own pointing tolerance: if the
 * map and the autopilot differ by less than the vehicle can resolve, they are
 * flying the same burn.
 */
/**
 * atan2(|a x b|, a . b), not `angleTo`. The latter takes acos of the cosine,
 * and below about 1.5e-8 rad the cosine rounds to exactly 1 — this gate first
 * printed a flat zero for two vectors that differ in their ninth decimal.
 */
const directionGap = Math.atan2(
  new Vector3().crossVectors(plannedDirection, flownDirection).length(),
  plannedDirection.dot(flownDirection),
)

/**
 * The residual a finite burn leaves, derived from the burn rather than chosen.
 *
 * A burn held on the node-instant direction and centred on the node sweeps
 * +-theta of arc, theta = omega * T / 2. The first-order errors either side
 * cancel; what survives is the cosine loss, dv * theta^2 / 6, and on a
 * near-circular orbit a tangential error of that size moves the far apsis by
 * about 4 r dv / v. It is a scale, not a prediction — the vehicle slows through
 * the burn, so the arc is not swept uniformly — which is why the gate is the
 * scale itself and the measured values are printed beside it.
 */
const burnSeconds = burnEnd - burnStart
const omega = vPeri / rPeri
const theta = (omega * burnSeconds) / 2
const lossScale = (dvCapture * theta * theta) / 6
const vCircular = Math.sqrt(MU_MOON / rPeri)
const apsisAllowance = (4 * rPeri * lossScale) / vCircular

console.log('\n=== the map and the autopilot ===')
console.log(`  directions differ by  ${directionGap.toExponential(2)} rad (pointing tolerance ${PROFILE.nodePointTolerance} rad)` +
  ` — magnitudes ${plannedDirection.length().toFixed(2)} and ${flownDirection.length().toFixed(2)} m/s`)
console.log(`  burn                  ${burnSeconds.toFixed(1)} s over +-${((theta * 180) / Math.PI).toFixed(1)} deg of arc`)
console.log(`  finite-burn scale     ${lossScale.toFixed(2)} m/s, so apsides to ~${(apsisAllowance / 1e3).toFixed(1)} km`)

/* ------------------------------------------------------------------ *
 * 6. allocation
 * ------------------------------------------------------------------ */
/**
 * Measured across the loop, not after a collection (scripts/allocation.mjs).
 * The sphere test runs once per node inside every projection, so it has the
 * render loop's budget: not one object per call. The lunar projection has the
 * same kilobyte-per-projection budget as verify-nodes, for the same reason.
 */
const control = await knownAllocation()
const scratchAlloc = live.sim.clone()
const soiBytes = await bytesPerCall(() => dominantBody(scratchAlloc, 'ship'), { calls: 50000, warm: 50000 })
clearNodes()
addNode(live.sim.t + 3600, { prograde: -20, normal: 5 })
const lunarProjection = await bytesPerCall(
  () => project(live.sim, scratchAlloc, 'ship', 'moon', 7200, plan, nodes),
  { calls: 512, warm: 3000, windows: 5 },
)
console.log('\n=== allocation ===')
console.log(`  dominantBody          ${sampleText(soiBytes)}`)
console.log(`  lunar projection      ${sampleText(lunarProjection)} (budget 1024)`)
console.log(`  control object        ${sampleText(control)}`)

/* ------------------------------------------------------------------ *
 * verdict
 * ------------------------------------------------------------------ */
console.log('\n=== what this establishes ===')
const checks = [
  ['the radii are Laplace\'s, exactly', moonRatioErr < 1e-12 && earthRatioErr < 1e-12],
  ['and within a percent of the textbook figures',
    Math.abs(moonMean - 66_100e3) / 66_100e3 < 0.01 && Math.abs(earthMean - 924_000e3) / 924_000e3 < 0.01],
  ['each boundary is classified on the correct side',
    classes.nearMoon === 'moon' && classes.insideMoon === 'moon' && classes.outsideMoon === 'earth' &&
    classes.insideEarth === 'earth' && classes.outsideEarth === 'sun'],
  ['a parking-orbit node is measured against Earth', leoBody === 'earth'],
  ['the translunar coast is never put on the Sun', timeIn.sun === 0],
  // The regression this replaces, reproduced: raw pull did put most of it there.
  ['(which raw pull did, for most of it)', rawIn.sun / coast > 0.5],
  ['the Moon takes over at its sphere, within one frame of travel',
    handover !== null && handover.radius - handover.range >= 0 && handover.radius - handover.range <= handover.travel],
  ['the capture node is drawn against the Moon', drawn.applied && drawn.body === 'moon' && drawn.apsisBody === 'moon'],
  /**
   * A kilometre, as verify-nodes allows a transfer: the drawing is an n-body
   * projection over an orbit and a half, the closed form is two bodies at an
   * instant.
   */
  ['and draws the orbit the closed form gives, to a kilometre',
    Math.abs(drawn.peri - viaMoon.peri) < 1000 && Math.abs(drawn.apo - viaMoon.apo) < 1000],
  ['the same node on Earth\'s axes would have hit the Moon', viaEarth.peri < 0],
  ['the flight computer measured it against the Moon too', sawAlign && bodyAtAlign === 'moon'],
  ['it flew the node and delivered what was asked, to 1 m/s',
    sawBurn && node.executed && Math.abs(mission.node.delivered - dvCapture) < 1],
  ['the map\'s vector and the flown vector agree to the pointing tolerance',
    directionGap < PROFILE.nodePointTolerance && Math.abs(plannedDirection.length() - dvCapture) < 1e-6 &&
    Math.abs(flownDirection.length() - dvCapture) < 1e-6],
  ['the craft is captured, above the surface', flown.bound && flown.peri > 0],
  ['and in the orbit the map drew, to the finite-burn scale',
    Math.abs(flown.peri - drawn.peri) < apsisAllowance && Math.abs(flown.apo - drawn.apo) < apsisAllowance],
  seesAllocation('the allocation measurement can see an allocation', control),
  allocatesNothing('the sphere test allocates nothing', soiBytes, SMALLEST_OBJECT / 2),
  allocatesNothing('a lunar projection allocates under a kilobyte', lunarProjection, 1024),
]
let pass = true
for (const [label, ok] of checks) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`)
  if (!ok) pass = false
}
console.log(`\n  ${pass ? 'PASS' : 'FAIL'}`)
process.exit(pass ? 0 : 1)
