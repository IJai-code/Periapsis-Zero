/**
 * The node gizmo: does a click land where the pilot pointed?
 *
 * Everything the interactive editor does is a coordinate round trip, and every
 * one of them has a place to be quietly wrong. A click is a pixel; the thing
 * clicked is a float32 polyline in a body-relative frame parented to a moving
 * planet; the answer wanted is an instant, and from that instant an orbital
 * frame that has to be the same one the integrator will use when it applies the
 * burn. Nothing about that is visible on screen — a gizmo drawn against the
 * wrong basis looks exactly like a gizmo drawn against the right one until the
 * burn goes somewhere unexpected.
 *
 * So the picking runs through the *real* Line2 raycaster here, on a real
 * camera, against the same packed buffer the renderer draws. A reimplementation
 * of the raycast would test this file against itself.
 *
 *   node --expose-gc scripts/verify-gizmo.mjs
 */

import { PerspectiveCamera, Group, Raycaster, Vector2, Vector3 } from 'three'
import { Line2, LineGeometry, LineMaterial } from 'three-stdlib'

import { flight, frame } from './flight.mjs'
import { live, refreshDerived, resetSimulation } from '../src/sim/live.js'
import { beginCountdown, currentPhase, resetMission } from '../src/sim/mission.js'
import { BODIES, G } from '../src/sim/constants.js'
import { INDEX } from '../src/sim/system.js'
import { WARP } from '../src/sim/warp.js'
import { addNode, clearNodes, nodeBasis, nodes, removeNode, setNodeTime } from '../src/sim/nodes.js'
import { SAMPLES, packPolyline, plan, prediction, project } from '../src/sim/predict.js'
import {
  CROSSING_PX,
  DRAG_SPAN_FRACTION,
  DRAG_SPAN_PIXELS,
  MODIFIERS,
  chooseEpoch,
  epochOnSegment,
  gainFor,
  lineThreshold,
  paramOnSegment,
  pixelsToWorld,
  screenAxis,
  viewDepth,
} from '../src/gfx/gizmo.js'
import { SMALLEST_OBJECT, bytesPerCall, knownAllocation } from './allocation.mjs'

const MU = G * BODIES.earth.mass
const R = BODIES.earth.radius
const WIDTH = 1600
const HEIGHT = 900
const LINEWIDTH = 1.4
const GRAB_PX = 14

/* ---- fly to a parking orbit, the same way every other gate does ---- */
resetSimulation()
resetMission()
refreshDerived()
flight.warp = WARP.x1
flight.lastWarpRequest = null
flight.warpBeforeBurn = null
flight.pilotWarp = WARP.x1
beginCountdown()
for (let i = 0; i < 3_000_000; i++) {
  frame()
  if (currentPhase().id === 'TLI_ALIGN') break
}

const scratch = live.sim.clone()
const probe = live.sim.clone()
const period = live.elements.period
clearNodes()
project(live.sim, scratch, 'ship', 'earth', period, prediction)

/**
 * Samples are no longer evenly spaced — the projection puts them where the path
 * bends — so every expectation here comes from the recorded times rather than
 * from a stride. `gap` is a segment's own duration; `slowest` bounds them all.
 */
const gap = (i) => prediction.times[Math.min(i + 1, prediction.count - 1)] - prediction.times[i]
let slowest = 0
let quickest = Infinity
for (let i = 0; i < prediction.count - 1; i++) {
  slowest = Math.max(slowest, gap(i))
  quickest = Math.min(quickest, gap(i))
}
const median = (() => {
  const all = []
  for (let i = 0; i < prediction.count - 1; i++) all.push(gap(i))
  all.sort((a, b) => a - b)
  return all[all.length >> 1]
})()
/** The instant a point at `param` along segment `i` of the drawn line represents. */
const timeOn = (i, param) => prediction.times[i] + gap(i) * param
/** Which drawn segment an instant falls in, and how far along it. */
function segmentAt(t) {
  let i = 0
  while (i < prediction.count - 2 && prediction.times[i + 1] <= t) i++
  const d = gap(i)
  return { i, u: d > 0 ? Math.min(1, Math.max(0, (t - prediction.times[i]) / d)) : 0 }
}
console.log('=== the scene the pointer is pointing at ===')
console.log(`  orbit            ${((prediction.periapsis.radius - R) / 1e3).toFixed(1)} x ${((prediction.apoapsis.radius - R) / 1e3).toFixed(1)} km, ${(period / 60).toFixed(1)} min`)
console.log(`  polyline         ${prediction.count} samples spanning ${prediction.span.toFixed(1)} s` +
  `, ${quickest.toFixed(3)} / ${median.toFixed(3)} / ${slowest.toFixed(3)} s apart (min/median/max)`)

/**
 * The line as the renderer builds it: float32, body-relative, parented to a
 * group standing where the planet is. The group offset is deliberately not zero
 * — the whole point of the local frame is that world coordinates are somewhere
 * else entirely, and a pick that forgot to subtract it would still work
 * perfectly with the group at the origin.
 */
const GROUP_AT = new Vector3(1.2e7, -3.4e6, 8.8e6)
const group = new Group()
group.position.copy(GROUP_AT)

const geometry = new LineGeometry()
geometry.setPositions(new Float32Array(SAMPLES * 3))
const material = new LineMaterial({ linewidth: LINEWIDTH })
material.resolution.set(WIDTH, HEIGHT)
const line = new Line2(geometry, material)
line.frustumCulled = false
group.add(line)

const positions = line.geometry.attributes.instanceStart.data
packPolyline(positions.array, prediction.points, prediction.count, SAMPLES)
positions.needsUpdate = true
/**
 * The bounds, refreshed with the data.
 *
 * `setPositions` computes them once, at construction, from whatever buffer it
 * is handed — and both here and in the renderer that buffer is a zero-filled
 * placeholder. Writing the real path in afterwards leaves a bounding sphere of
 * radius zero at the origin, and every raycast is then rejected by the
 * pre-check before it looks at a single segment. The line still *draws*,
 * because it is marked `frustumCulled = false`, which is exactly why nothing
 * noticed until something tried to click it.
 */
line.geometry.computeBoundingBox()
line.geometry.computeBoundingSphere()

/**
 * Face-on to the orbit plane, so the ellipse does not cross itself on screen.
 * Self-crossings are handled — `chooseEpoch` exists for them — but a gate that
 * measures picking accuracy should not also be measuring crossing resolution.
 */
const shipO = INDEX.ship * 6
const earthO = INDEX.earth * 6
const bp = new Vector3()
const bn = new Vector3()
const bo = new Vector3()
nodeBasis(live.sim.state, shipO, earthO, bp, bn, bo)

const camera = new PerspectiveCamera(45, WIDTH / HEIGHT, 0.1, 1e13)
camera.position.copy(GROUP_AT).addScaledVector(bn, 2.6e7).addScaledVector(bp, 4e6)
camera.lookAt(GROUP_AT)
camera.updateMatrixWorld(true)
camera.updateProjectionMatrix()
group.updateMatrixWorld(true)

const raycaster = new Raycaster()
raycaster.params.Line2 = { threshold: lineThreshold(LINEWIDTH, GRAB_PX) }

const ndc = new Vector2()
const world = new Vector3()
const local = new Vector3()
const epochBuf = new Float64Array(64)
const gapBuf = new Float64Array(64)

/** Screen position of a world point, in the same pixels the pointer lives in. */
const _screen = new Vector3()
function screenOf(point) {
  _screen.copy(point).project(camera)
  return { x: ((_screen.x + 1) / 2) * WIDTH, y: ((1 - _screen.y) / 2) * HEIGHT }
}

/**
 * Click a world point and read back the instant it means.
 *
 * Deliberately the same selection the component runs — raycast, score every
 * candidate by how far from the pointer it is *drawn*, then `chooseEpoch`. An
 * earlier version of this used a different rule than the app did, which is a
 * way of testing nothing.
 */
function pickEpoch(point, continuing = null) {
  const want = screenOf(point)
  world.copy(point).project(camera)
  ndc.set(world.x, world.y)
  raycaster.setFromCamera(ndc, camera)
  const hits = []
  line.raycast(raycaster, hits)
  if (hits.length === 0) return { ok: false, hits: 0 }

  const n = Math.min(hits.length, epochBuf.length)
  for (let i = 0; i < n; i++) {
    local.copy(hits[i].pointOnLine).sub(GROUP_AT)
    const param = paramOnSegment(prediction.points, hits[i].faceIndex, local.x, local.y, local.z)
    epochBuf[i] = epochOnSegment(prediction, hits[i].faceIndex, param)
    const at = screenOf(hits[i].pointOnLine)
    gapBuf[i] = Math.hypot(at.x - want.x, at.y - want.y)
  }
  const k = chooseEpoch(epochBuf, gapBuf, n, continuing)
  if (k < 0) return { ok: false, hits: hits.length }
  return {
    ok: true,
    hits: hits.length,
    segment: hits[k].faceIndex,
    epoch: epochBuf[k],
    missMetres: Math.sqrt(hits[k].point.distanceToSquared(hits[k].pointOnLine)),
  }
}

/* ---- 1. click the line, get the instant back ---- */
/**
 * Exercised all the way round the orbit rather than at one convenient place.
 * The projection's samples are uniform in *time*, so on an eccentric orbit they
 * are not uniform in arc, and a picking bug that assumed otherwise would show
 * up near periapsis and nowhere else.
 */
const TRIALS = []
for (let k = 0; k < 41; k++) {
  const sample = Math.floor((k / 41) * (prediction.count - 2))
  const param = 0.37
  TRIALS.push({ sample, param })
}

let worstEpoch = 0
let worstShare = 0
let worstSegment = 0
let picked = 0
let missed = 0
let maxMiss = 0
for (const trial of TRIALS) {
  const o = trial.sample * 3
  world.set(
    prediction.points[o] + (prediction.points[o + 3] - prediction.points[o]) * trial.param,
    prediction.points[o + 1] + (prediction.points[o + 4] - prediction.points[o + 1]) * trial.param,
    prediction.points[o + 2] + (prediction.points[o + 5] - prediction.points[o + 2]) * trial.param,
  ).add(GROUP_AT)

  const got = pickEpoch(world)
  if (!got.ok) {
    missed++
    continue
  }
  picked++
  const want = timeOn(trial.sample, trial.param)
  worstEpoch = Math.max(worstEpoch, Math.abs(got.epoch - want))
  worstShare = Math.max(worstShare, Math.abs(got.epoch - want) / Math.max(gap(trial.sample), 1e-9))
  worstSegment = Math.max(worstSegment, Math.abs(got.segment - trial.sample))
  maxMiss = Math.max(maxMiss, got.missMetres)
}

console.log('\n=== clicking the drawn line ===')
console.log(`  ${TRIALS.length} points around the orbit, ${missed} missed`)
console.log(`  worst epoch error   ${(worstEpoch * 1e3).toFixed(3)} ms` +
  `  (${(worstShare * 100).toFixed(4)}% of its own segment; segments run to ${slowest.toFixed(2)} s)`)
console.log(`  worst segment error ${worstSegment}`)
console.log(`  worst ray miss      ${maxMiss.toFixed(2)} m`)

/**
 * The floor this is measured against.
 *
 * The buffer the pointer hits is float32 at an orbital radius of ~6.9e6 m, so a
 * vertex quantises to about 0.5 m, and the craft crosses that in 0.5 / 7660 s.
 * Anything near that number is the format, not the arithmetic; anything a
 * thousand times larger is a bug. The tolerance is a hundred times the floor.
 */
const speedNow = Math.hypot(
  live.sim.state[shipO + 3] - live.sim.state[earthO + 3],
  live.sim.state[shipO + 4] - live.sim.state[earthO + 4],
  live.sim.state[shipO + 5] - live.sim.state[earthO + 5],
)
const float32Floor = (Math.pow(2, -23) * prediction.apoapsis.radius) / speedNow
console.log(`  float32 floor       ${(float32Floor * 1e3).toFixed(3)} ms at ${(speedNow / 1e3).toFixed(2)} km/s`)

/* ---- 2. a click far from the line must miss ---- */
const o0 = 200 * 3
world
  .set(prediction.points[o0], prediction.points[o0 + 1], prediction.points[o0 + 2])
  .add(GROUP_AT)
// Push the click sideways by a known number of pixels along the screen normal
// to the track, and check the tolerance is the one that was asked for.
const tangent = new Vector3(
  prediction.points[o0 + 3] - prediction.points[o0],
  prediction.points[o0 + 4] - prediction.points[o0 + 1],
  prediction.points[o0 + 5] - prediction.points[o0 + 2],
).normalize()
const across = new Vector3().crossVectors(tangent, bn).normalize()
const pxPerMetre = screenAxis(new Vector2(), world, across, camera, WIDTH, HEIGHT)

/**
 * Measured in the units the tolerance is written in.
 *
 * The first version stepped the click sideways by a world offset and called
 * that a pixel count, which quietly under-reports: `across` is perpendicular to
 * the track in *space*, and its projection onto the screen is not perpendicular
 * to the track's projection, so a 14 m/px offset of 14 px lands nearer than 14
 * px from the drawn line. The raycaster tests perpendicular distance to the
 * screen-space segment, so that is what gets measured here too — and the
 * boundary then lands where it was asked to.
 */
const _s0 = new Vector3()
const _s1 = new Vector3()
const _sp = new Vector3()
function toPixels(out, point) {
  out.copy(point).project(camera)
  out.set((out.x * WIDTH) / 2, (-out.y * HEIGHT) / 2, 0)
  return out
}
function pixelsFromTrack(point, segment) {
  const o = segment * 3
  toPixels(_s0, _sp.set(prediction.points[o], prediction.points[o + 1], prediction.points[o + 2]).add(GROUP_AT))
  toPixels(_s1, _sp.set(prediction.points[o + 3], prediction.points[o + 4], prediction.points[o + 5]).add(GROUP_AT))
  toPixels(_sp, point)
  const ex = _s1.x - _s0.x
  const ey = _s1.y - _s0.y
  const len2 = ex * ex + ey * ey
  const u = len2 > 0 ? ((_sp.x - _s0.x) * ex + (_sp.y - _s0.y) * ey) / len2 : 0
  return Math.hypot(_sp.x - (_s0.x + ex * u), _sp.y - (_s0.y + ey * u))
}

/**
 * `world` is `pickEpoch`'s own scratch and is destroyed by the first call, so
 * the base point gets its own vector. Reusing it made every probe after the
 * first an offset from a normalised device coordinate, which is why the sweep
 * reported grabbing at a tenth of a pixel and missing at a hundred.
 */
let grabbedAt = 0
let missedAt = 0
const trackPoint = new Vector3().copy(world)
const probePoint = new Vector3()
for (let step = 1; step <= 400; step++) {
  const px = step * 0.1
  probePoint.copy(trackPoint).addScaledVector(across, px / pxPerMetre)
  const gap = pixelsFromTrack(probePoint, 200)
  if (pickEpoch(probePoint).ok) grabbedAt = Math.max(grabbedAt, gap)
  else if (missedAt === 0) missedAt = gap
}
console.log('\n=== how wide the grab actually is ===')
console.log(`  asked for    ${GRAB_PX}.00 px either side of the drawn track`)
console.log(`  last grab at ${grabbedAt.toFixed(2)} px, first miss at ${missedAt.toFixed(2)} px`)

/* ---- 3. the frame the gizmo draws is the frame the burn uses ---- */
project(live.sim, scratch, 'ship', 'earth', period, prediction)
const tBurn = live.sim.t + prediction.periapsis.time
clearNodes()
const node = addNode(tBurn, { prograde: 0 })
project(live.sim, scratch, 'ship', 'earth', period * 1.6, plan, nodes)

const fp = new Vector3(plan.nodeFrames[3], plan.nodeFrames[4], plan.nodeFrames[5])
const fn = new Vector3(plan.nodeFrames[6], plan.nodeFrames[7], plan.nodeFrames[8])
const fo = new Vector3(plan.nodeFrames[9], plan.nodeFrames[10], plan.nodeFrames[11])

const orthoErr = Math.max(
  Math.abs(fp.length() - 1),
  Math.abs(fn.length() - 1),
  Math.abs(fo.length() - 1),
  Math.abs(fp.dot(fn)),
  Math.abs(fp.dot(fo)),
  Math.abs(fn.dot(fo)),
)
const handedness = new Vector3().crossVectors(fp, fn).dot(fo)

/**
 * Recomputed independently: integrate to the node's instant in one call and
 * take the basis there. The projection reaches the same instant by 100-odd
 * separate steps, so the two differ by RK4 step placement and nothing else.
 * Over one orbit that truncation is metres (verify-predict measures 1.3 m at
 * apoapsis), which at this radius is 2e-7 rad of direction.
 */
probe.resetFrom(live.sim)
probe.advance(tBurn - live.sim.t, slowest / 4, 65536)
const ip = new Vector3()
const inn = new Vector3()
const io = new Vector3()
nodeBasis(probe.state, shipO, earthO, ip, inn, io)
const frameAngle = Math.max(
  Math.acos(Math.min(1, Math.abs(fp.dot(ip)))),
  Math.acos(Math.min(1, Math.abs(fn.dot(inn)))),
  Math.acos(Math.min(1, Math.abs(io.dot(io)))),
)
const framePos = new Vector3(plan.nodeFrames[0], plan.nodeFrames[1], plan.nodeFrames[2])
const probePos = new Vector3(
  probe.state[shipO] - probe.state[earthO],
  probe.state[shipO + 1] - probe.state[earthO + 1],
  probe.state[shipO + 2] - probe.state[earthO + 2],
)

console.log('\n=== the recorded orbital frame ===')
console.log(`  orthonormal to      ${orthoErr.toExponential(2)}`)
console.log(`  right-handed        p x n . o = ${handedness.toFixed(12)}`)
console.log(`  against an independent integration to the same instant:`)
console.log(`    direction         ${frameAngle.toExponential(2)} rad`)
console.log(`    position          ${framePos.distanceTo(probePos).toFixed(3)} m`)
/**
 * Read now, not at the end. `plan` is refreshed in place by every projection
 * that follows — the scrub section runs five more — so a check written against
 * it down in the verdict would be reporting the last one instead of this one.
 */
const firedAt = plan.nodeTimes[0]
/**
 * And what it was asked for, captured alongside it. Later sections advance the
 * simulation — deliberately, to put the two projections a fifth of a second
 * apart — so a lead recomputed against the clock down in the verdict is a lead
 * from a different instant than the one measured here.
 */
const firedWanted = tBurn - live.sim.t
console.log(`  node fires at       ${firedAt.toFixed(3)} s from now (asked ${(tBurn - live.sim.t).toFixed(3)})`)

/* ---- 4. drag the prograde handle, and check where the orbit ends up ---- */
/**
 * The gate that makes the gizmo an instrument rather than a slider: pull the
 * handle a stated number of pixels and the orbit has to arrive where vis-viva
 * says it should, with nothing in between having been measured off a screenshot.
 */
const nodeWorld = new Vector3().copy(framePos).add(GROUP_AT)
const axis2 = new Vector2()
screenAxis(axis2, nodeWorld, fp, camera, WIDTH, HEIGHT)

const DRAG_PX = 120
const gain = gainFor(speedNow, MODIFIERS.normal)
const dragged = DRAG_PX * gain
node.prograde = dragged
project(live.sim, scratch, 'ship', 'earth', period * 1.8, plan, nodes)

const r1 = prediction.periapsis.radius
const vStart = Math.sqrt(MU * (2 / r1 - 1 / live.elements.semiMajor))
const vAfter = vStart + dragged
const epsAfter = (vAfter * vAfter) / 2 - MU / r1
const aAfter = -MU / (2 * epsAfter)
const hAfter = r1 * vAfter
const eAfter = Math.sqrt(Math.max(0, 1 - (hAfter * hAfter) / (MU * aAfter)))
const apoExpected = aAfter * (1 + eAfter)
const apoGot = plan.apoapsis.radius

console.log('\n=== pulling the prograde handle ===')
console.log(`  screen direction    (${axis2.x.toFixed(4)}, ${axis2.y.toFixed(4)}), unit ${Math.hypot(axis2.x, axis2.y).toFixed(9)}`)
console.log(`  gain                ${gain.toFixed(4)} m/s per pixel at ${(speedNow / 1e3).toFixed(2)} km/s`)
console.log(`  ${DRAG_PX} px drag        ${dragged.toFixed(2)} m/s prograde at periapsis`)
console.log(`  vis-viva says       ${((apoExpected - R) / 1e3).toFixed(2)} km apoapsis`)
console.log(`  projection draws    ${((apoGot - R) / 1e3).toFixed(2)} km` +
  `  — ${apoGot >= apoExpected ? '+' : ''}${((apoGot - apoExpected) / 1e3).toFixed(3)} km`)
console.log(`  a full ${DRAG_SPAN_PIXELS} px pull is ${(DRAG_SPAN_PIXELS * gain).toFixed(0)} m/s` +
  `, ${(DRAG_SPAN_FRACTION * 100).toFixed(0)}% of orbital speed`)

/* ---- 5. scrub the node in time ---- */
/**
 * Scrubbing has to move the node *along the path*, not merely change a number.
 * The node's recorded position is compared against the ballistic polyline at
 * the same instant — the line the pointer was dragged along — so a scrub that
 * updated `t` without the projection agreeing would show up here as a gap.
 */
node.prograde = 0
let worstScrub = 0
const scrubs = [0.12, 0.3, 0.55, 0.8, 0.93]
for (const f of scrubs) {
  const want = f * period
  setNodeTime(node, live.sim.t + want, live.sim.t, 1)
  project(live.sim, scratch, 'ship', 'earth', period * 1.2, plan, nodes)

  const { i, u } = segmentAt(want)
  const on = new Vector3(
    prediction.points[i * 3] + (prediction.points[i * 3 + 3] - prediction.points[i * 3]) * u,
    prediction.points[i * 3 + 1] + (prediction.points[i * 3 + 4] - prediction.points[i * 3 + 1]) * u,
    prediction.points[i * 3 + 2] + (prediction.points[i * 3 + 5] - prediction.points[i * 3 + 2]) * u,
  )
  const got = new Vector3(plan.nodeFrames[0], plan.nodeFrames[1], plan.nodeFrames[2])
  worstScrub = Math.max(worstScrub, got.distanceTo(on))
}

/**
 * The chord, not the arc. The comparison point is interpolated along a straight
 * segment between two samples while the node sits on the curve, so the gap is
 * dominated by sagitta, which for the widest segment the projection drew is a
 * few metres and has nothing to do with scrubbing.
 */
const sag = prediction.apoapsis.radius * (1 - Math.cos((Math.PI * slowest) / period))

console.log('\n=== scrubbing the node along the line ===')
console.log(`  ${scrubs.length} positions round the orbit`)
console.log(`  worst gap to the drawn path  ${worstScrub.toFixed(2)} m`)
console.log(`  the chord's own sagitta is   ${sag.toFixed(2)} m`)

/* ---- 6. a node cannot be scrubbed into the past ---- */
setNodeTime(node, live.sim.t - 500, live.sim.t, 1)
const clampedAhead = node.t - live.sim.t

/* ---- 7. screen sizing ---- */
/**
 * A gizmo specified in pixels has to actually occupy them. Measured by putting
 * a point at the computed world offset and reading back how far it moved on
 * screen, which is the only definition that matters.
 */
const gizmoDepth = viewDepth(nodeWorld, camera)
const gizmoRange = camera.position.distanceTo(nodeWorld)
const wantPx = 74
const worldSize = pixelsToWorld(wantPx, gizmoDepth, camera.fov, HEIGHT)
/**
 * The camera's *own* up axis, not `camera.up` — that is the world-space hint
 * `lookAt` orients against and points wherever the scene's up is, so measuring
 * along it puts most of the offset into screen x and depth and reads back a
 * number that has nothing to do with the vertical.
 */
const screenUp = new Vector3(0, 1, 0).applyQuaternion(camera.quaternion)
const centreNdc = new Vector3().copy(nodeWorld).project(camera)
const edgeNdc = new Vector3()
  .copy(nodeWorld)
  .addScaledVector(screenUp, worldSize)
  .project(camera)
const gotPx = Math.abs(edgeNdc.y - centreNdc.y) * HEIGHT * 0.5

console.log('\n=== screen-constant sizing ===')
console.log(`  ${wantPx} px at ${(gizmoDepth / 1e3).toFixed(0)} km depth is ${(worldSize / 1e3).toFixed(1)} km of geometry`)
console.log(`  the node is ${(gizmoRange / 1e3).toFixed(0)} km from the lens, ` +
  `${(((gizmoRange - gizmoDepth) / gizmoDepth) * 100).toFixed(1)}% further than it is deep`)
console.log(`  measured back        ${gotPx.toFixed(3)} px`)

/* ---- 8. clicking the path the plan draws ---- */
/**
 * A second burn is planned on the orbit the first one produces, and that orbit
 * exists only as the amber line. Three things have to hold for a click on it to
 * mean anything: it must be read off the *planned* samples, its instant must be
 * converted through the pass that drew them rather than through the clock, and a
 * node being dragged must stop bending the very line it is being dragged along.
 */
clearNodes()
project(live.sim, scratch, 'ship', 'earth', period, prediction)
const firstBurn = live.sim.t + prediction.periapsis.time
addNode(firstBurn, { prograde: 400 })

/**
 * The two passes are deliberately made from instants a fifth of a second apart,
 * which is what the renderer does: the ballistic path is on a clock and the
 * planned one is redrawn whenever the plan changes.
 */
const SKEW = 0.2
live.sim.advance(SKEW, 0.05, 4096)
project(live.sim, scratch, 'ship', 'earth', period * 1.6, plan, nodes)
const skew = plan.t0 - prediction.t0

const planGeometry = new LineGeometry()
planGeometry.setPositions(new Float32Array(SAMPLES * 3))
const planMaterial = new LineMaterial({ linewidth: LINEWIDTH })
planMaterial.resolution.set(WIDTH, HEIGHT)
const planLine = new Line2(planGeometry, planMaterial)
planLine.frustumCulled = false
group.add(planLine)
const planAttr = planLine.geometry.attributes.instanceStart.data
packPolyline(planAttr.array, plan.points, plan.count, SAMPLES)
planAttr.needsUpdate = true
planLine.geometry.computeBoundingBox()
planLine.geometry.computeBoundingSphere()
group.updateMatrixWorld(true)

/** Both paths offered at once, exactly as the editor offers them. */
function pickEither(point) {
  const want = screenOf(point)
  world.copy(point).project(camera)
  ndc.set(world.x, world.y)
  raycaster.setFromCamera(ndc, camera)
  let n = 0
  for (const [object, projection] of [[line, prediction], [planLine, plan]]) {
    const hits = []
    object.raycast(raycaster, hits)
    for (let i = 0; i < hits.length && n < epochBuf.length; i++, n++) {
      local.copy(hits[i].pointOnLine).sub(GROUP_AT)
      const u = paramOnSegment(projection.points, hits[i].faceIndex, local.x, local.y, local.z)
      epochBuf[n] = epochOnSegment(projection, hits[i].faceIndex, u)
      owners[n] = projection
      const at = screenOf(hits[i].pointOnLine)
      gapBuf[n] = Math.hypot(at.x - want.x, at.y - want.y)
    }
  }
  if (n === 0) return null
  const k = chooseEpoch(epochBuf, gapBuf, n, null)
  return k < 0 ? null : { epoch: epochBuf[k], owner: owners[k], onPlan: owners[k] === plan }
}
const owners = new Array(64).fill(null)

/** A point on the amber line well past the burn, where the two have parted. */
const afterBurn = Math.min(plan.count - 2, (plan.nodeSamples[0] ?? 0) + 120)
const planPoint = new Vector3(
  plan.points[afterBurn * 3],
  plan.points[afterBurn * 3 + 1],
  plan.points[afterBurn * 3 + 2],
).add(GROUP_AT)
const ballisticAtSame = new Vector3(
  prediction.points[afterBurn * 3],
  prediction.points[afterBurn * 3 + 1],
  prediction.points[afterBurn * 3 + 2],
).add(GROUP_AT)
const parted = planPoint.distanceTo(ballisticAtSame)

const gotPlan = pickEither(planPoint)
const wantAbsolute = plan.t0 + plan.times[afterBurn]
const gotAbsolute = gotPlan ? gotPlan.owner.t0 + gotPlan.epoch : NaN
const clockAbsolute = gotPlan ? live.sim.t + gotPlan.epoch : NaN

/* And a click on the cyan line, where reading the clock instead of the pass costs. */
const cyanPoint = new Vector3(
  prediction.points[40 * 3],
  prediction.points[40 * 3 + 1],
  prediction.points[40 * 3 + 2],
).add(GROUP_AT)
const gotCyan = pickEither(cyanPoint)
const cyanWant = prediction.t0 + prediction.times[40]
const cyanGot = gotCyan ? gotCyan.owner.t0 + gotCyan.epoch : NaN
const cyanByClock = gotCyan ? live.sim.t + gotCyan.epoch : NaN
const speedThere = Math.hypot(
  live.sim.state[shipO + 3] - live.sim.state[earthO + 3],
  live.sim.state[shipO + 4] - live.sim.state[earthO + 4],
  live.sim.state[shipO + 5] - live.sim.state[earthO + 5],
)

/* A node planned there lands where it was clicked. */
const second = addNode(gotAbsolute, { prograde: 0 })
project(live.sim, scratch, 'ship', 'earth', period * 1.6, plan, nodes)
const secondSlot = plan.applied.indexOf(second.id)
const secondAt = secondSlot >= 0
  ? new Vector3(
      plan.nodeFrames[secondSlot * 12],
      plan.nodeFrames[secondSlot * 12 + 1],
      plan.nodeFrames[secondSlot * 12 + 2],
    ).add(GROUP_AT)
  : null
const landedGap = secondAt ? secondAt.distanceTo(planPoint) : Infinity

/* Deferring the dragged node: frame kept, impulse withheld. */
second.prograde = 250
project(live.sim, scratch, 'ship', 'earth', period * 1.6, plan, nodes)
const withSecond = new Vector3(
  plan.points[(plan.count - 1) * 3],
  plan.points[(plan.count - 1) * 3 + 1],
  plan.points[(plan.count - 1) * 3 + 2],
)
second.deferred = true
project(live.sim, scratch, 'ship', 'earth', period * 1.6, plan, nodes)
const deferredEnd = new Vector3(
  plan.points[(plan.count - 1) * 3],
  plan.points[(plan.count - 1) * 3 + 1],
  plan.points[(plan.count - 1) * 3 + 2],
)
const deferredSlot = plan.applied.indexOf(second.id)
removeNode(second.id)
project(live.sim, scratch, 'ship', 'earth', period * 1.6, plan, nodes)
const withoutSecond = new Vector3(
  plan.points[(plan.count - 1) * 3],
  plan.points[(plan.count - 1) * 3 + 1],
  plan.points[(plan.count - 1) * 3 + 2],
)

console.log('\n=== clicking the planned path ===')
console.log(`  the two passes are ${skew.toFixed(3)} s apart, as the renderer leaves them`)
console.log(`  at that point they have parted by ${(parted / 1e3).toFixed(1)} km`)
console.log(`  picked from         ${gotPlan ? (gotPlan.onPlan ? 'the planned path' : 'the ballistic path') : 'nothing'}`)
console.log(`  instant recovered   ${(gotAbsolute - wantAbsolute).toExponential(2)} s out` +
  `   — read off the clock instead: ${(clockAbsolute - wantAbsolute).toFixed(3)} s`)
console.log(`  a cyan click        ${(cyanGot - cyanWant).toExponential(2)} s out` +
  `   — off the clock: ${(cyanByClock - cyanWant).toFixed(3)} s, worth ${((cyanByClock - cyanWant) * speedThere / 1e3).toFixed(2)} km at ${(speedThere / 1e3).toFixed(2)} km/s`)
console.log(`  a node planned there lands ${landedGap.toFixed(1)} m from the click`)
console.log(`  deferred            frame kept ${deferredSlot >= 0}, path moves ` +
  `${deferredEnd.distanceTo(withoutSecond).toFixed(3)} m from the plan without it` +
  ` (with it applied: ${(withSecond.distanceTo(withoutSecond) / 1e3).toFixed(0)} km)`)

/* ---- 9. choosing between candidates ---- */
/**
 * The rule that decides which bit of an overlapping line the pointer means,
 * exercised on made-up candidates so the two cases can be posed exactly.
 *
 * The second one is a regression. Continuity used to be applied first, which
 * made a scrub creep: at every step it took whichever candidate sat nearest to
 * where the node already was, which is the trailing edge of its own tolerance
 * band. Dragged sixty-four samples along the orbit it advanced fifty and
 * stopped.
 */
const selEpochs = new Float64Array([100, 4000, 120])
const selGaps = new Float64Array([2, 2.5, 30])
// No gesture in progress: the nearest pixel wins outright.
const pickCold = chooseEpoch(selEpochs, selGaps, 3, null)
// Mid-scrub near a crossing: two candidates the pointer cannot separate, so the
// one continuing from 3,900 s is taken even though it is half a pixel further.
const pickCrossing = chooseEpoch(selEpochs, selGaps, 3, 3900)
// Mid-scrub with a clearly nearer candidate: the pixel wins, and continuity
// does not get to drag the answer backwards.
const pickAhead = chooseEpoch(selEpochs, selGaps, 3, 118)

console.log('\n=== choosing between overlapping candidates ===')
console.log(`  crossing window     ${CROSSING_PX} px`)
console.log(`  no gesture          picks ${selEpochs[pickCold]} s (nearest pixel)`)
console.log(`  continuing from 3900 picks ${selEpochs[pickCrossing]} s (same pixel, continues)`)
console.log(`  continuing from 118  picks ${selEpochs[pickAhead]} s (28 px nearer wins)`)

/* ---- 10. allocation ---- */
/**
 * Two different budgets. The maths run every frame and must allocate nothing;
 * the raycast allocates inside three-stdlib — two Vector3 per hit, which is not
 * ours to fix — and is therefore driven by pointer movement rather than by the
 * frame clock.
 *
 * Measured across the loop (scripts/allocation.mjs). The first version of this
 * gate read the heap after a forced collection, reported the maths clean, and
 * was blind: `screenAxis` took its length with `Math.hypot`, which on this V8
 * allocates on every call.
 */
const axisTmp = new Vector2()
const control = await knownAllocation()
const mathBytes = await bytesPerCall(() => {
  screenAxis(axisTmp, nodeWorld, fp, camera, WIDTH, HEIGHT)
  paramOnSegment(prediction.points, 100, world.x, world.y, world.z)
  epochOnSegment(prediction, 100, 0.5)
}, { calls: 20000, warm: 20000 })
const hover = await bytesPerCall(() => pickEpoch(nodeWorld), { calls: 512, warm: 500, windows: 5 })

console.log('\n=== allocation ===')
if (mathBytes) {
  console.log(`  gizmo maths     ${mathBytes.bytes.toFixed(1)} B per frame's worth of calls`)
  console.log(`  one hover pick  ${hover.bytes.toFixed(0)} B — raycast plus this harness's bookkeeping; pointer-gated, not per frame`)
  console.log(`  control object  ${control.bytes.toFixed(0)} B — proof the measurement can see one`)
}

/* ---- verdict ---- */
console.log('\n=== what this establishes ===')
const checks = [
  // Both halves: nothing missed, and something was actually measured. The
  // first version reported a perfect epoch error while picking nothing at all,
  // because a maximum over an empty set is whatever it was initialised to.
  ['every point on the drawn line is grabbable', missed === 0 && picked === TRIALS.length],
  /**
   * A hundred times the float32 floor and a thousandth of a sample. Below the
   * first would be measuring the buffer format; above the second the pick would
   * be quantised to samples, which is the thing sub-sample interpolation exists
   * to avoid.
   */
  ['a click recovers its instant to a thousandth of the segment it lands on', worstShare < 1e-3],
  ['and comfortably above the float32 floor it is limited by', worstEpoch < float32Floor * 100],
  ['the segment it lands on is the segment clicked', worstSegment === 0],
  ['the grab is the width it was asked for, to a tenth of a pixel',
    Math.abs(grabbedAt - GRAB_PX) < 0.1],
  ['and refuses clicks past it', missedAt > GRAB_PX && missedAt - GRAB_PX < 0.2],
  ['the recorded frame is orthonormal', orthoErr < 1e-12],
  ['and right-handed', handedness > 0.999999],
  /**
   * 1e-5 rad is fifty times the RK4 truncation this comparison is limited by
   * and a thousandth of a degree of gizmo alignment — far below anything a
   * pilot could aim at, and far above the noise.
   */
  ['it matches an independent integration to the same instant', frameAngle < 1e-5],
  ['the node fires when it was told to', Math.abs(firedAt - firedWanted) < 1e-6],
  ['the screen axis is a unit vector', Math.abs(Math.hypot(axis2.x, axis2.y) - 1) < 1e-12],
  /**
   * A kilometre on a 1,400 km apoapsis: the same allowance verify-nodes makes,
   * for the same reason — an n-body projection against a two-body formula.
   */
  ['a 120 px pull reaches the apoapsis vis-viva predicts', Math.abs(apoGot - apoExpected) < 1000],
  ['a full drag spends the stated fraction of orbital speed',
    Math.abs(DRAG_SPAN_PIXELS * gain - speedNow * DRAG_SPAN_FRACTION) < 1e-6],
  ['fine and coarse bracket it', MODIFIERS.fine < 1 && MODIFIERS.coarse > 1],
  // Twice the chord's own sagitta: the node sits on the curve, the reference
  // point on the straight line between samples, and that gap is geometry.
  ['scrubbing moves the node along the drawn path', worstScrub < 2 * sag],
  ['a node cannot be scrubbed into the past', clampedAhead >= 1],
  ['a pixel size is the pixel size asked for', Math.abs(gotPx - wantPx) < 0.5],
  ['a click on the planned path is read off the planned path', gotPlan !== null && gotPlan.onPlan],
  ['where the two have visibly parted', parted > 1e4],
  /**
   * Against the float32 floor, not a round number. The click is read back
   * through the drawn buffer, which is float32 metres, so the instant can be no
   * sharper than the quantisation of a vertex divided by orbital speed — the
   * same floor the picking section measures at a tenth of a millisecond.
   */
  ['its instant comes back below the float32 floor', Math.abs(gotAbsolute - wantAbsolute) < float32Floor],
  /**
   * The two passes are made a fifth of a second apart, so reading either one's
   * epoch off the live clock is wrong by that much — 1.5 km of arc at orbital
   * speed, which is the whole reason each pass records the instant it began.
   */
  ['reading it off the clock instead would be a fifth of a second out',
    Math.abs(cyanByClock - cyanWant) > SKEW * 0.9],
  ['while its own pass stays below that floor', Math.abs(cyanGot - cyanWant) < float32Floor],
  ['a node planned there lands within a metre of the click', landedGap < 1],
  ['a deferred node keeps its handle', deferredSlot >= 0],
  ['and stops bending the line it is dragged along',
    deferredEnd.distanceTo(withoutSecond) < 1 && withSecond.distanceTo(withoutSecond) > 1e4],
  ['with no gesture in progress the nearest pixel wins', pickCold === 0],
  ['at a crossing, the candidate that continues the gesture wins', pickCrossing === 1],
  ['but a clearly nearer candidate is not overruled by continuity', pickAhead === 0],
  ['the allocation measurement can see an allocation', !control || control.bytes >= SMALLEST_OBJECT],
  // Under the smallest object there is: not even one allocation per frame.
  ['the per-frame maths allocate nothing', !mathBytes || mathBytes.bytes < SMALLEST_OBJECT / 2],
]
let pass = true
for (const [label, ok] of checks) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`)
  if (!ok) pass = false
}
console.log(`\n  ${pass ? 'PASS' : 'FAIL'}`)
process.exit(pass ? 0 : 1)
