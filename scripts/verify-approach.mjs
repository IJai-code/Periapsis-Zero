/**
 * Coast the lunar approach and watch the selenocentric conic become real.
 *
 * Two things are being measured. First, where the osculating selenocentric
 * elements stop being a fiction: outside the sphere of influence Earth is the
 * dominant attractor and "periapsis about the Moon" is a number with no
 * trajectory behind it. Second, what the integrator's step ceiling does through
 * the encounter — the geocentric-only limit returns the 900 s planetary default
 * at 400,000 km from Earth, which is 7.9 steps per lunar revolution.
 *
 * This is an *instrument*, not a gate: it prints the table and a closest
 * approach and asserts nothing, so it can never go red. Reading it is the point.
 *
 * The state is `scripts/fixtures/lunar-approach.json` unless another is given —
 * that file is the post-midcourse approach state, still 130,000 km outside the
 * sphere of influence, which is where this script has to start to see the conic
 * stop being a fiction.
 *
 *   node scripts/verify-approach.mjs                    the fixture
 *   node scripts/verify-approach.mjs other-state.json   some other state
 */

import { flight, frame, loadSnapshot, LUNAR_APPROACH_FIXTURE } from './flight.mjs'
import { live } from '../src/sim/live.js'
import { currentPhase, mission } from '../src/sim/mission.js'

const snap = process.argv[2] ?? LUNAR_APPROACH_FIXTURE
loadSnapshot(snap)

console.log(`from ${currentPhase().id} at MET ${(mission.t / 3600).toFixed(2)} h\n`)
console.log(
  '   MET      range      SOI    in    r_p(osc)   t_p(osc)      e        maxDt   steps',
)

let last = -Infinity
let entered = false
let minRange = Infinity
let minRangeT = 0

for (let i = 0; i < 4_000_000; i++) {
  // Warp down as the encounter develops, the same ladder shape the other coasts
  // use: resolution costs nothing where nothing is happening.
  const tp = live.lunar.timeToPeriapsis
  flight.pilotWarp = !live.insideLunarSOI ? 3 : tp > 7200 ? 2 : tp > 900 ? 1 : 0
  frame()

  if (live.lunarRange < minRange) {
    minRange = live.lunarRange
    minRangeT = mission.t
  }

  if (!entered && live.insideLunarSOI) {
    entered = true
    console.log(`  --- entered the lunar SOI at MET ${(mission.t / 3600).toFixed(3)} h ---`)
  }

  if (mission.t - last > 3600 || (live.insideLunarSOI && mission.t - last > 600)) {
    last = mission.t
    const l = live.lunar
    console.log(
      `  ${(mission.t / 3600).toFixed(2).padStart(7)}h ${(live.lunarRange / 1e3).toFixed(0).padStart(8)} ` +
        `${(live.lunarSOI / 1e3).toFixed(0).padStart(7)} ${String(live.insideLunarSOI).padStart(5)} ` +
        `${(l.periapsisRadius / 1e3).toFixed(1).padStart(10)} ${(l.timeToPeriapsis / 3600).toFixed(3).padStart(10)}h ` +
        `${l.eccentricity.toFixed(4).padStart(8)} ${live.maxDt.toFixed(2).padStart(8)} ${String(live.stepsLastFrame).padStart(6)}`,
    )
  }

  // Stop just after the true closest approach.
  if (entered && live.lunar.vertical > 0 && live.lunarRange > minRange * 1.02) break
}

console.log(
  `\n  true closest approach: ${(minRange / 1e3).toFixed(2)} km radius = ` +
    `${((minRange - 1737e3) / 1e3).toFixed(2)} km altitude, at MET ${(minRangeT / 3600).toFixed(3)} h`,
)
console.log(`  frames ${flight.frames}`)
