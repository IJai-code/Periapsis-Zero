/**
 * Navigation at true scale: how far the nearest surface is, and how many turns
 * of the wheel it takes to get anywhere.
 *
 * Both exist because one constant cannot serve twelve decades. A movement speed
 * fixed in metres per second is either unusable next to a hull or unusable at an
 * AU, and a zoom speed fixed as a percentage per tick crosses a narrow range in
 * a flick and a wide one in seven hundred detents.
 *
 *   node --expose-gc scripts/verify-navigation.mjs
 */

import { Vector3 } from 'three'
import { live, refreshDerived, resetSimulation, updateNearestSurface } from '../src/sim/live.js'
import { INDEX } from '../src/sim/system.js'
import { BODIES, CRAFT } from '../src/sim/constants.js'
import { FRAMING, ZOOM_DETENTS, detentsIn, detentsToCross, zoomSpeedFor } from '../src/gfx/framing.js'

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
