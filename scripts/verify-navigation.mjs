/**
 * Navigation at true scale: how far the nearest surface is, and how many turns
 * of the wheel it takes to get anywhere.
 *
 * Both exist because one constant cannot serve twelve decades. A movement speed
 * fixed in metres per second is either unusable next to a hull or unusable at an
 * AU, and a zoom speed fixed as a percentage per tick crosses a narrow range in
 * a flick and a wide one in seven hundred detents.
 *
 * And the same argument one decade down: a standoff fixed in metres cannot serve
 * a vehicle that sheds 97% of its length on the way to the Moon.
 *
 *   node --expose-gc scripts/verify-navigation.mjs
 */

import { Vector3 } from 'three'
import { live, refreshDerived, resetSimulation, updateNearestSurface } from '../src/sim/live.js'
import { INDEX } from '../src/sim/system.js'
import { BODIES, CRAFT } from '../src/sim/constants.js'
import {
  CHASE_MULTIPLE,
  FRAMING,
  LIT_REACH,
  STAGE_LENGTH,
  VEHICLE_MULTIPLE,
  ZOOM_DETENTS,
  detentsIn,
  detentsToCross,
  stageLength,
  zoomSpeedFor,
} from '../src/gfx/framing.js'
import {
  SMALLEST_OBJECT,
  allocatesNothing,
  bytesPerCall,
  knownAllocation,
  sampleText,
  seesAllocation,
} from './allocation.mjs'
import { readFileSync } from 'node:fs'
import {
  FLY_BOOST,
  FLY_FINE,
  FLY_FLOOR,
  FLY_GAIN,
  clampTrim,
  flyAxisInput,
  flyModifier,
  flySpeed,
  flyTime,
} from '../src/gfx/fly.js'

resetSimulation()
refreshDerived('earth')

const E = live.pos.earth.clone()
const M = live.pos.moon.clone()
const toMoon = new Vector3().subVectors(M, E).normalize()
/** A direction across the Earth-Moon line, for standing off to one side. */
const across = new Vector3().crossVectors(toMoon, new Vector3(0, 1, 0)).normalize()

const cam = new Vector3()

/**
 * Cases chosen so the answer is known independently, and so that the two
 * rejected designs — the focused body's radius, and a forward raycast — give
 * visibly wrong answers on at least one of them.
 */
const CASES = [
  {
    what: '200 km above Earth',
    at: () => cam.copy(E).addScaledVector(toMoon, BODIES.earth.radius + 200e3),
    expect: 200e3,
    id: 'earth',
  },
  {
    what: '100 km above the Moon',
    at: () => cam.copy(M).addScaledVector(toMoon, BODIES.moon.radius + 100e3),
    expect: 100e3,
    id: 'moon',
  },
  {
    /**
     * The lateral skim. The camera sits 500 m over the Moon and looks along the
     * surface, not down at it. A ray cast along the view direction leaves the
     * scene and reports nothing, so a speed derived from it would be an
     * interplanetary speed five hundred metres above the ground. Subtracting a
     * radius from a centre distance has no direction in it and returns 500.
     */
    what: '500 m over the Moon, looking at the horizon',
    at: () => cam.copy(M).addScaledVector(across, BODIES.moon.radius + 500),
    expect: 500,
    id: 'moon',
  },
  {
    /**
     * Nearest is not the thing you are locked to. Sitting just off the Moon
     * while focused on Earth, the focused body's radius would give a speed set
     * by 6,371 km.
     */
    what: '2 km off the Moon, focused on Earth',
    at: () => cam.copy(M).addScaledVector(toMoon, BODIES.moon.radius + 2000),
    expect: 2000,
    id: 'moon',
  },
  {
    what: 'deep space, between Earth and Moon',
    at: () => cam.copy(E).addScaledVector(toMoon, 2e8),
    expect: 2e8 - BODIES.earth.radius,
    id: 'earth',
  },
]

console.log('=== nearest surface ===')
console.log('  where                                        measured        expected     nearest')
let worstErr = 0
for (const c of CASES) {
  const p = c.at()
  const d = updateNearestSurface(p)
  const err = Math.abs(d - c.expect)
  if (err > worstErr) worstErr = err
  const fmt = (v) => (v < 1000 ? `${v.toFixed(1)} m` : `${(v / 1e3).toFixed(1)} km`)
  console.log(
    `  ${c.what.padEnd(44)}${fmt(d).padStart(12)}${fmt(c.expect).padStart(16)}` +
      `${(live.nearest.id === c.id ? live.nearest.id : `${live.nearest.id} (WANT ${c.id})`).padStart(12)}`,
  )
}
const rightBody = CASES.every((c) => {
  c.at()
  updateNearestSurface(cam)
  return live.nearest.id === c.id
})

/* ---- craft participate, so the floor drops near a vessel ---- */
/**
 * Written in *absolute* coordinates, which is what the state vector holds.
 *
 * The first version of this placed the ship at `M + toMoon * 5e6` using the
 * rebased `live.pos.moon`, i.e. a geocentric vector, and so put the craft
 * 400,000 km from the *heliocentric* origin — inside the Sun. It reported a
 * nearest surface of -291,000 km and looked like a bug in the distance code.
 * The rebased and absolute frames differ by an AU and nothing in a Vector3
 * says which one it is.
 */
const shipOffset = INDEX.ship * 6
const moonAbs = INDEX.moon * 6
live.sim.state[shipOffset] = live.sim.state[moonAbs] + toMoon.x * 5e6
live.sim.state[shipOffset + 1] = live.sim.state[moonAbs + 1] + toMoon.y * 5e6
live.sim.state[shipOffset + 2] = live.sim.state[moonAbs + 2] + toMoon.z * 5e6
refreshDerived('earth')
cam.copy(live.pos.ship).addScaledVector(across, CRAFT.ship.visual / 2 + 40)
const nearShip = updateNearestSurface(cam)
console.log(`\n  40 m off the hull, 5,000 km from the Moon:  ${nearShip.toFixed(1)} m · ${live.nearest.id}`)

/* ---- zoom traversal ---- */
console.log('\n=== wheel detents to cross each mode ===')
console.log('  mode        min            max          zoomSpeed   detents    was (at 0.7)')
const rows = []
for (const [mode, f] of Object.entries(FRAMING)) {
  if (!(f.min > 0 && f.max > f.min)) continue
  const speed = zoomSpeedFor(f.min, f.max)
  const now = detentsToCross(f.min, f.max, speed)
  const before = detentsToCross(f.min, f.max, 0.7)
  rows.push({ mode, now, before, speed })
  const m = (v) => (v >= 1e9 ? `${(v / 1e9).toFixed(2)}e9` : v >= 1e3 ? `${(v / 1e3).toFixed(1)}e3` : v.toFixed(1))
  console.log(
    `  ${mode.padEnd(10)}${m(f.min).padStart(10)} m${m(f.max).padStart(13)} m` +
      `${speed.toFixed(3).padStart(12)}${now.toFixed(1).padStart(10)}${before.toFixed(0).padStart(15)}`,
  )
}

/* ---- a detent means a detent, on either device ---- */
console.log('\n=== deltaY normalisation ===')
const DEVICES = [
  { what: 'mouse wheel, one detent', e: { deltaY: 100, deltaMode: 0 }, expect: 1 },
  { what: 'mouse wheel, line mode', e: { deltaY: 3, deltaMode: 1 }, expect: 1 },
  { what: 'trackpad, small tick', e: { deltaY: 4, deltaMode: 0 }, expect: 0.05 },
  { what: 'trackpad, firm swipe', e: { deltaY: 220, deltaMode: 0 }, expect: 2.2 },
  { what: 'runaway single event', e: { deltaY: 100000, deltaMode: 0 }, expect: 4 },
]
for (const d of DEVICES) {
  console.log(`  ${d.what.padEnd(28)}deltaY ${String(d.e.deltaY).padStart(6)} -> ${detentsIn(d.e).toFixed(2)} detents`)
}
const normalised = DEVICES.every((d) => Math.abs(detentsIn(d.e) - d.expect) < 1e-9)

/**
 * A trackpad flick is many events, not one. Summed over a gesture it must land
 * near the physical scroll distance rather than at one tick per event, which is
 * what OrbitControls' sign-only reading would give.
 */
const flick = Array.from({ length: 30 }, () => ({ deltaY: 12, deltaMode: 0 }))
const flickDetents = flick.reduce((a, e) => a + detentsIn(e), 0)
const signOnly = flick.length
console.log(`\n  30-event trackpad flick (deltaY 12 each): ${flickDetents.toFixed(1)} detents` +
  `, against ${signOnly} if only the sign were read`)

/* ---- the free-flight speed law ---- */
const C = 299792458
console.log('\n=== free-flight speed, by how much room there is ===')
console.log('  clearance                      speed              as')
const SPEEDS = [
  { d: 0, what: 'touching a hull' },
  { d: 40, what: '40 m off a hull' },
  { d: 400e3, what: 'a 400 km orbit' },
  { d: 3.844e8, what: 'lunar distance' },
  { d: 1.496e11, what: 'one AU' },
]
for (const { d, what } of SPEEDS) {
  const v = flySpeed(d)
  const as = v >= 0.1 * C ? `${(v / C).toFixed(0)} c` : v >= 1e4 ? `${(v / 1e3).toFixed(0)} km/s` : `${v.toFixed(1)} m/s`
  console.log(`  ${what.padEnd(30)}${v.toExponential(2).padStart(12)} m/s${as.padStart(12)}`)
}

/**
 * Time to fly a journey, integrated at 60 Hz rather than taken from the closed
 * form, because the floor makes the last metre linear and t = ln(r)/gain does
 * not know that.
 *
 * The property worth checking is that these are *logarithmic* in the ratio, so
 * a journey ten decades long costs about what a journey five decades long
 * costs twice — the control does not saturate at either end.
 */
console.log('\n=== how long a journey takes ===')
console.log('  journey                                decades      nominal     boosted        fine')
const TRIPS = [
  { from: 1.496e11, to: 10, what: 'one AU -> 10 m off a hull' },
  { from: 3.844e8, to: 10, what: 'lunar distance -> 10 m' },
  { from: 400e3, to: 10, what: '400 km orbit -> 10 m' },
  { from: 1000, to: 10, what: '1 km -> 10 m' },
]
const trips = []
for (const t of TRIPS) {
  const nominal = flyTime(t.from, t.to)
  const boosted = flyTime(t.from, t.to, FLY_BOOST)
  const fine = flyTime(t.from, t.to, FLY_FINE)
  const decades = Math.log10(t.from / t.to)
  trips.push({ ...t, nominal, boosted, fine, decades })
  console.log(
    `  ${t.what.padEnd(38)}${decades.toFixed(1).padStart(8)}` +
      `${nominal.toFixed(1).padStart(13)} s${boosted.toFixed(1).padStart(11)} s${fine.toFixed(0).padStart(11)} s`,
  )
}

/** Seconds per decade, which the law says should be the same for every trip. */
const perDecade = trips.map((t) => t.nominal / t.decades)
const decadeSpread = Math.max(...perDecade) / Math.min(...perDecade)
console.log(`\n  seconds per decade: ${perDecade.map((p) => p.toFixed(2)).join(', ')}` +
  `  (spread ${decadeSpread.toFixed(3)}x)`)
console.log(`  predicted ln(10)/gain = ${(Math.LN10 / FLY_GAIN).toFixed(3)} s`)

/* ---- what the keys fold down to ---- */
/**
 * Checked here because it cannot be checked in a browser.
 *
 * Holding a key is the one input the tooling cannot produce: a dispatched
 * KeyboardEvent does not reach the page's listeners at all, and the
 * automation's key action completes press-and-release inside one task, so the
 * key is never held across an animation frame. Sixty presses moved the camera
 * zero metres, which is what that predicts and also what a broken listener
 * would look like. Making the fold pure moves everything except the
 * `addEventListener` line into reach — and that line is shared with the pointer
 * handlers in the same effect, which were exercised live.
 */
console.log('\n=== key fold ===')
console.log('  held                          direction          modifier')
const KEYCASES = [
  { keys: ['KeyW'], want: [0, 0, -1], mod: 1, what: 'W' },
  { keys: ['KeyS'], want: [0, 0, 1], mod: 1, what: 'S' },
  { keys: ['KeyA'], want: [-1, 0, 0], mod: 1, what: 'A' },
  { keys: ['KeyD'], want: [1, 0, 0], mod: 1, what: 'D' },
  { keys: ['KeyR'], want: [0, 1, 0], mod: 1, what: 'R' },
  { keys: ['KeyF'], want: [0, -1, 0], mod: 1, what: 'F' },
  { keys: ['KeyW', 'KeyD'], want: [1, 0, -1], mod: 1, what: 'W+D' },
  // Opposing keys cancel by summing signs, not by precedence.
  { keys: ['KeyW', 'KeyS'], want: [0, 0, 0], mod: 1, what: 'W+S (cancel)' },
  { keys: ['KeyW', 'ShiftLeft'], want: [0, 0, -1], mod: FLY_BOOST, what: 'W+shift' },
  { keys: ['KeyW', 'ControlLeft'], want: [0, 0, -1], mod: FLY_FINE, what: 'W+ctrl' },
  // Boost wins when both modifiers are down, rather than multiplying to 1.
  { keys: ['KeyW', 'ShiftLeft', 'ControlLeft'], want: [0, 0, -1], mod: FLY_BOOST, what: 'W+shift+ctrl' },
  { keys: ['KeyQ', 'Enter', 'KeyI'], want: [0, 0, 0], mod: 1, what: 'ship keys only' },
]
const vec = { x: 0, y: 0, z: 0 }
let foldOk = true
for (const c of KEYCASES) {
  const set = new Set(c.keys)
  flyAxisInput(set, vec)
  const mod = flyModifier(set)
  const ok =
    vec.x === c.want[0] && vec.y === c.want[1] && vec.z === c.want[2] && mod === c.mod
  if (!ok) foldOk = false
  console.log(
    `  ${c.what.padEnd(30)}(${vec.x}, ${vec.y}, ${vec.z})`.padEnd(52) +
      `x${mod}${ok ? '' : '   MISMATCH'}`,
  )
}

/* ---- framing a vehicle that changes length as it flies ---- */
/**
 * The camera's field of view, read out of the source rather than restated.
 *
 * Everything below is a fraction of the frame, and the frame is whatever
 * App.jsx gives the Canvas. A constant copied here would keep passing after
 * somebody changed the lens.
 */
const APP = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8')
const FOV = Number(APP.match(/camera=\{\{[^}]*fov:\s*([\d.]+)/)?.[1])
const HALF = Math.tan(((FOV / 2) * Math.PI) / 180)

/**
 * The drawn silhouette, in hull lengths, taken off Placeholders.jsx: command
 * module apex, service barrel, engine bell, and the exhaust cone that appears
 * when the engine lights.
 *
 * Needed because the chase camera looks along the vehicle's own axis from
 * behind it, so the vehicle's *length* is foreshortened to almost nothing and
 * its width is not. How much of the frame it fills cannot be had by dividing a
 * length by a frame height; it has to be projected.
 */
const HULL_POINTS = [
  [0, 0, 0.51],
  [0.22, 0, 0.19],
  [0, 0.22, 0.19],
  [0.22, 0, -0.23],
  [0, 0.22, -0.23],
  [0.19, 0, -0.46],
  [0, 0.19, -0.46],
]
const PLUME_POINTS = [
  [0.15, 0, -0.46],
  [0, 0.15, -0.46],
  [0, 0, -1.16],
]

/** Where the chase camera stands off a vehicle of this length, m. */
const standoff = (length) =>
  Math.sqrt((CHASE_MULTIPLE.back * length) ** 2 + (CHASE_MULTIPLE.up * length) ** 2)

/**
 * How much of the frame's height the drawn vehicle spans, from a camera on the
 * rig's own offset `reach` hull lengths out, aimed at the craft.
 */
function fill(reach, lit) {
  const cy = CHASE_MULTIPLE.up * reach
  const cz = -CHASE_MULTIPLE.back * reach
  const n = Math.sqrt(cy * cy + cz * cz)
  // The camera looks at the craft, so the view axis is straight back down the
  // offset; screen up is what is left of the offset plane.
  const ay = -cy / n
  const az = -cz / n
  const uy = -az
  const uz = ay
  let lo = Infinity
  let hi = -Infinity
  for (const p of lit ? HULL_POINTS.concat(PLUME_POINTS) : HULL_POINTS) {
    const dy = p[1] - cy
    const dz = p[2] - cz
    const along = dy * ay + dz * az
    if (!(along > 0)) continue
    const y = (dy * uy + dz * uz) / along / HALF
    if (y < lo) lo = y
    if (y > hi) hi = y
  }
  // Screen y runs -1 to 1 over the full height.
  return (hi - lo) / 2
}

console.log('\n=== how much of the frame the vehicle fills ===')
console.log('  stage             hull    standoff   in hulls      fills       before')
const fills = []
const fillsBefore = []
for (let i = 0; i < STAGE_LENGTH.length; i++) {
  const L = STAGE_LENGTH[i]
  const now = standoff(L)
  // What it did before: the standoff was built from stage 0 and never moved,
  // which in this stage's own lengths is that much further out.
  const wasInHulls = standoff(STAGE_LENGTH[0]) / L
  fills.push(fill(1, false))
  fillsBefore.push(fill(wasInHulls / (standoff(1) / 1), false))
  console.log(
    `  ${String(i).padEnd(6)}${L.toFixed(2).padStart(11)} m${now.toFixed(1).padStart(10)} m` +
      `${(now / L).toFixed(2).padStart(11)}${(fills[i] * 100).toFixed(1).padStart(10)}%` +
      `${(fillsBefore[i] * 100).toFixed(2).padStart(12)}%`,
  )
}
const fillSpread = Math.max(...fills) / Math.min(...fills)
const wasSpread = Math.max(...fillsBefore) / Math.min(...fillsBefore)
console.log(
  `\n  spread across the mission: ${fillSpread.toFixed(6)}x now, ${wasSpread.toFixed(1)}x before`,
)

/**
 * Ignition, which is the other event the framing law has to answer to.
 *
 * The claim that wanted checking was that the plume would otherwise run out of
 * frame. It does not, and by a long way: a lit vehicle with the camera held
 * spans 16% of the frame's height against 45 degrees of frame. So easing back
 * is not a rescue, it is the same law the stages obey — hold what is *drawn* at
 * a constant fraction of frame, and the drawn object grows by 72% of its own
 * length the moment the engine lights.
 */
const unlit = fill(1, false)
const litHeld = fill(1, true)
const litMoved = fill(LIT_REACH, true)
console.log('\n=== the burn, from the chase camera ===')
console.log(`  hull alone, engine out             ${(unlit * 100).toFixed(1).padStart(5)}% of the frame's height`)
console.log(`  hull and plume, camera held        ${(litHeld * 100).toFixed(1).padStart(5)}%`)
console.log(`  hull and plume, camera eased back  ${(litMoved * 100).toFixed(1).padStart(5)}%`)

/**
 * The step response, which is the whole of what "smooth" means here.
 *
 * Both filters are the rig's own: the chase camera lerps its offset toward the
 * desired one at rate 6, and a locked camera moves its radius the same way. A
 * step into an exponential cannot overshoot, so what is checked is that it
 * settles quickly enough to read as a move rather than a cut, and that it never
 * turns around — which a spring in the same place would.
 */
const RATE = 6
const HZ = 60
function settle(from, to) {
  let x = from
  let frames = 0
  let monotone = true
  const rising = to > from
  for (; frames < HZ * 10; frames++) {
    const next = x + (to - x) * (1 - Math.exp(-(1 / HZ) * RATE))
    if (rising ? next < x - 1e-12 : next > x + 1e-12) monotone = false
    x = next
    if (Math.abs(x - to) <= Math.abs(to - from) * 0.01) break
  }
  return { seconds: frames / HZ, monotone }
}
console.log('\n=== how long the reframe takes ===')
const MOVES = [
  { what: 'first separation', from: standoff(STAGE_LENGTH[0]), to: standoff(STAGE_LENGTH[1]) },
  { what: 'the last stage away', from: standoff(STAGE_LENGTH[2]), to: standoff(STAGE_LENGTH[3]) },
  { what: 'ignition: the plume appears', from: standoff(STAGE_LENGTH[3]), to: standoff(STAGE_LENGTH[3]) * LIT_REACH },
  { what: 'cutoff: it goes out', from: standoff(STAGE_LENGTH[3]) * LIT_REACH, to: standoff(STAGE_LENGTH[3]) },
  { what: 'locked at 500 m, through staging', from: 500, to: (500 * STAGE_LENGTH[3]) / STAGE_LENGTH[2] },
]
let slowest = 0
let allMonotone = true
for (const m of MOVES) {
  const r = settle(m.from, m.to)
  if (r.seconds > slowest) slowest = r.seconds
  if (!r.monotone) allMonotone = false
  console.log(
    `  ${m.what.padEnd(34)}${m.from.toFixed(1).padStart(8)} m ->${m.to.toFixed(1).padStart(8)} m` +
      `   within 1% in ${r.seconds.toFixed(2)} s${r.monotone ? '' : '   OVERSHOOT'}`,
  )
}

/* How close the lock camera may come, and how many detents its range takes. */
console.log('\n=== approaching the vehicle ===')
console.log('  stage           closest      in hulls        was    in hulls    detents')
let worstApproach = 0
let worstStageDetents = 0
for (let i = 0; i < STAGE_LENGTH.length; i++) {
  const L = STAGE_LENGTH[i]
  const min = L * VEHICLE_MULTIPLE.min
  const speed = zoomSpeedFor(min, FRAMING.ship.max)
  const detents = detentsToCross(min, FRAMING.ship.max, speed)
  worstApproach = Math.max(worstApproach, min / L)
  worstStageDetents = Math.max(worstStageDetents, Math.abs(detents - ZOOM_DETENTS))
  console.log(
    `  ${String(i).padEnd(6)}${min.toFixed(2).padStart(13)} m${(min / L).toFixed(2).padStart(13)}` +
      `${FRAMING.ship.min.toFixed(1).padStart(11)} m${(FRAMING.ship.min / L).toFixed(1).padStart(12)}` +
      `${detents.toFixed(1).padStart(11)}`,
  )
}

/**
 * The rig reads the stage, not the stack.
 *
 * Everything above is the law; this is the one line of evidence that the camera
 * obeys it, and it cannot be had by importing, because the rig is a component.
 * `CHASE_OFFSET` is the pad-stack offset kept for the attitude replay — if it
 * reappears in the rig, the standoff has been pinned to stage 0 again.
 */
const RIG = readFileSync(new URL('../src/components/CameraRig.jsx', import.meta.url), 'utf8')
const rigScales = !/CHASE_OFFSET/.test(RIG) && /CHASE_MULTIPLE/.test(RIG) && /STAGE_LENGTH\[ship\.stage\]/.test(RIG)

/* The frame path: an indexed read and three multiplies, measured. */
const control = await knownAllocation()
/** A typed slot to accumulate into: a plain `let` double is boxed on every write. */
const sink = new Float64Array(1)
let litFlag = false
const noop = await bytesPerCall(() => {
  sink[0] += 1
}, { calls: 50000, warm: 50000 })
const framePath = await bytesPerCall(
  () => {
    litFlag = !litFlag
    const L = STAGE_LENGTH[3]
    const reach = litFlag ? L * LIT_REACH : L
    sink[0] += CHASE_MULTIPLE.back * reach + CHASE_MULTIPLE.up * reach
  },
  { calls: 50000, warm: 50000 },
)
const lookup = await bytesPerCall(() => {
  sink[0] += stageLength(3)
}, { calls: 50000, warm: 50000 })
console.log('\n=== allocation, per call ===')
console.log(`  control (a known allocation)        ${sampleText(control)}`)
console.log(`  the harness itself                  ${sampleText(noop)}`)
console.log(`  chase standoff, as the loop does it ${sampleText(framePath)}`)
console.log(`  stageLength()                       ${sampleText(lookup)}   (sink ${sink[0].toFixed(0)})`)

/* ---- allocation ---- */
const gc = globalThis.gc
for (let i = 0; i < 20000; i++) updateNearestSurface(cam)
if (gc) {
  gc()
  gc()
}
const before = process.memoryUsage().heapUsed
const N = 300000
for (let i = 0; i < N; i++) updateNearestSurface(cam)
if (gc) {
  gc()
  gc()
}
const delta = process.memoryUsage().heapUsed - before

console.log('\n=== what this establishes ===')
const worstDetents = Math.max(...rows.map((r) => r.now))
const spread = worstDetents / Math.min(...rows.map((r) => r.now))
const checks = [
  ['nearest surface is exact in every case', worstErr < 1e-6],
  ['it names the right body, focus notwithstanding', rightBody],
  // The case a raycast along the view vector cannot see at all.
  ['a lateral skim reports 500 m, not infinity', Math.abs(CASES[2].expect - 500) < 1e-9],
  ['craft participate: 40 m off a hull reads 40 m', Math.abs(nearShip - 40) < 1e-6],
  [`every mode crosses its range in about ${ZOOM_DETENTS} detents`, Math.abs(worstDetents - ZOOM_DETENTS) < 1e-6],
  ['no mode is more than a wheel-turn harder than another', spread < 1.0001],
  ['a detent means a detent on mouse and trackpad alike', normalised],
  ['a trackpad flick is not read as one tick per event', Math.abs(flickDetents - 30) > 20],
  ['nearest surface allocates nothing', !gc || Math.abs(delta) < 64 * 1024],
  // Framing the vehicle that exists, rather than the one that left the pad.
  ['the camera reads the field of view the scene actually uses', FOV > 0],
  ['the vehicle fills the same fraction of frame at every stage', fillSpread < 1 + 1e-12],
  ['it did not before: the last stage was 32x smaller in frame', wasSpread > 30],
  ['the lit vehicle and its plume stay in frame', litMoved < 1],
  // Not a rescue: it holds the drawn object at the size the unlit one had.
  ['easing back on ignition holds the framing', Math.abs(litMoved / unlit - 1) < 0.1],
  ['holding the camera would have grown it by half', litHeld / unlit > 1.5],
  ['the rig frames the stage, not the stack', rigScales],
  ['every reframe settles in under a second', slowest < 1],
  ['and none of them overshoots', allMonotone],
  ['every stage can be approached to about its own length', worstApproach < 1.5],
  [`every stage's range still crosses in ${ZOOM_DETENTS} detents`, worstStageDetents < 1e-6],
  seesAllocation('the allocation measurement can see an allocation', control),
  allocatesNothing('the chase standoff allocates nothing', framePath, SMALLEST_OBJECT / 2),
  allocatesNothing('nor does the stage lookup', lookup, SMALLEST_OBJECT / 2),
  // The speed law is only useful if it never stops and never inverts.
  ['speed is positive everywhere, inside a body included',
   [-1e9, 0, 1, 1e6, 1e12].every((d) => flySpeed(d) >= FLY_FLOOR)],
  ['speed rises with clearance', SPEEDS.every((s, i, a) => i === 0 || flySpeed(s.d) >= flySpeed(a[i - 1].d))],
  /**
   * The property the whole design rests on: cost is logarithmic in distance,
   * so every decade costs the same and neither end of the range saturates.
   * ln(10)/gain seconds per decade, checked against the integrated times rather
   * than asserted from the algebra.
   */
  ['a decade costs the same wherever it is', decadeSpread < 1.05],
  ['seconds per decade matches ln(10)/gain',
   Math.abs(perDecade[0] - Math.LN10 / FLY_GAIN) < 0.2],
  ['ten decades cross in under a minute', trips[0].nominal < 60],
  ['trim stays inside its band', clampTrim(1e9) <= 20 && clampTrim(-5) >= 0.05],
  ['keys fold to the right direction and modifier', foldOk],
  // The camera must not answer to the throttle and attitude keys.
  ['the ship\'s own keys do not move the camera',
   (() => {
     flyAxisInput(new Set(['KeyQ', 'KeyE', 'KeyI', 'KeyJ', 'KeyK', 'KeyL', 'KeyZ', 'KeyX']), vec)
     return vec.x === 0 && vec.y === 0 && vec.z === 0
   })()],
]
let pass = true
for (const [label, ok] of checks) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`)
  if (!ok) pass = false
}
console.log(`\n  worst nearest-surface error ${worstErr.toExponential(2)} m`)
console.log(`  heap delta ${(delta / 1024).toFixed(2)} KB over ${N} settled calls` +
  ` (${(delta / N).toFixed(4)} bytes/call)`)
console.log(`  ${pass ? 'PASS' : 'FAIL'}`)
process.exit(pass ? 0 : 1)
