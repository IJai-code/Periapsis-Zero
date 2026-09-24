/**
 * When to trim the corridor, measured rather than assumed.
 *
 * The outbound correction turned out cheapest at TLI+24 h — earlier has more
 * leverage but sits deeper in Earth's well, and the cost curve turns over. The
 * return leg has the opposite geometry: the craft leaves the Moon slowly and
 * speeds up all the way home, so leverage per m/s falls monotonically and the
 * only question is how early the solve is trustworthy while the Moon is still
 * pulling on it.
 *
 * The state is `scripts/fixtures/lunar-orbit.json` unless another is given —
 * that file is a lunar-orbit state, which is what the sweep wants, and pinning
 * it is what lets this gate sit in the suite. The fixture's README argues that
 * choice and states its cost.
 *
 *   node scripts/verify-tei-timing.mjs                    the fixture
 *   node scripts/verify-tei-timing.mjs other-state.json   some other state
 */
import { flight, frame, loadSnapshot, LUNAR_ORBIT_FIXTURE } from './flight.mjs'
import { WARP } from '../src/sim/warp.js'
import { live } from '../src/sim/live.js'
import { currentPhase, mission, PROFILE } from '../src/sim/mission.js'
import { BODIES } from '../src/sim/constants.js'
import { solveReturnCorridor, projectPerigee } from '../src/sim/targeting.js'

const RE = BODIES.earth.radius
const snap = process.argv[2] ?? LUNAR_ORBIT_FIXTURE
loadSnapshot(snap)

// Fly once to just after the departure burn, then branch from there.
for (let i = 0; i < 3_000_000; i++) {
  flight.pilotWarp = mission.warpRequest === null ? WARP.m1 : null
  if (currentPhase().id === 'TRANS_EARTH' && mission.tei.burnEnd) break
  frame()
}
console.log(`departure complete at MET ${(mission.t / 3600).toFixed(2)} h`)
console.log(`  perigee on the departure alone: ${((projectPerigee(0,0,0) - RE) / 1e3).toFixed(0)} km altitude\n`)
console.log('  trim point      dv        predicted perigee    converged   inside SOI')

const target = RE + PROFILE.entryPerigee
// Push the sequencer's own trim out of reach: it fires at eiDelay, which would
// otherwise have already corrected the trajectory before the later test points
// were sampled, and every one of them would report a converged 0.03 m/s.
PROFILE.eiDelay = 1e9
for (const hours of [3, 6, 12, 24, 36, 48]) {
  // Re-fly from the snapshot each time: the solve is a pure function of state,
  // but getting to that state means integrating there.
  loadSnapshot(snap)
  for (let i = 0; i < 3_000_000; i++) {
    flight.pilotWarp = mission.warpRequest === null ? WARP.m1 : null
    if (currentPhase().id === 'TRANS_EARTH' && mission.tei.burnEnd &&
        mission.t - mission.tei.burnEnd >= hours * 3600) break
    frame()
  }
  const inside = live.insideLunarSOI
  const sol = solveReturnCorridor(target)
  console.log(
    `  TEI+${String(hours).padStart(2)} h    ${sol.magnitude.toFixed(2).padStart(8)} m/s` +
    `   ${((sol.approach - RE) / 1e3).toFixed(2).padStart(10)} km` +
    `      ${String(sol.converged).padStart(5)}       ${inside}`,
  )
}
