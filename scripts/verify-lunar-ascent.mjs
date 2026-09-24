/**
 * Eagle, from Tranquility Base to Columbia: flown, and measured against the
 * physics and against the flight.
 *
 * The sequence is sim/lunarMission.js's — a guided ascent to P12's insertion
 * state, then the coelliptic rendezvous: CSI solved for Apollo 11's TPI time,
 * CDH, TPI when Columbia stands 26.6° above Eagle's horizon, two midcourse
 * corrections, braking through the gates, station-keeping, and Columbia flying
 * the last thirty metres. This gate flies all of it in the harness and holds it
 * to three kinds of claim:
 *
 * - **Constructions are exact.** The clamp carries the LM round at the Moon's
 *   spin; Columbia is put on Apollo 11's 56.6 by 62.5 nautical-mile orbit.
 * - **Guidance does what it says, at any warp.** The ascent cuts off on its
 *   target; flown with the burn stepped at the 60x powered cap it reaches the
 *   same orbit as at 1x; the RCS burns deliver the velocity they were loaded
 *   with; the docking closes at the speed it was told.
 * - **The flight is Apollo 11's.** TPI where the CSI was solved to put it, the
 *   docking where the schedule does — each to a tolerance worked out from the
 *   thing that moves it, stated beside the check.
 *
 * And the frame paths the sequence runs every frame allocate nothing.
 *
 *   node --expose-gc scripts/verify-lunar-ascent.mjs
 */
process.env.PERIAPSIS_VESSEL = 'apollo11'
process.env.PERIAPSIS_SITE = 'tranquility'

const { Quaternion } = await import('three')
const { flight, frame, WARP } = await import('./flight.mjs')
const { live, refreshDerived, resetSimulation } = await import('../src/sim/live.js')
const { beginCountdown, currentPhase, mission, resetMission, applyClamp } = await import('../src/sim/mission.js')
const { INDEX } = await import('../src/sim/system.js')
const { SHIP } = await import('../src/sim/constants.js')
const { ship } = await import('../src/sim/ship.js')
const { MOON_SPIN_RATE } = await import('../src/sim/moonFrame.js')
const { activeSite, clampToSiteNow, siteClock, siteDirection } = await import('../src/sim/launchsite.js')
const L = await import('../src/sim/lunarMission.js')
const { orbitOf } = await import('../src/sim/twoBody.js')
const { SMALLEST_OBJECT, allocatesNothing, bytesPerCall, knownAllocation, sampleText, seesAllocation } =
  await import('./allocation.mjs')

const { APOLLO11, DOCKING_REACH, DOCKING_SPEED, MU_MOON, R_MOON, lunar } = L
const DEG = Math.PI / 180
const NMI = 1852
const FT = 0.3048
const site = activeSite()
const hms = (s) => {
  const a = Math.round(s)
  return `${Math.floor(a / 3600)}:${String(Math.floor((a % 3600) / 60)).padStart(2, '0')}:${String(a % 60).padStart(2, '0')}`
}

/* ---------------------------------------------------------------- *
 * 1. On the pad, and Columbia's placing
 * ---------------------------------------------------------------- */

resetSimulation()
resetMission()
refreshDerived()
applyClamp()
const s0 = live.sim.state
const o = INDEX.ship * 6
const m = INDEX.moon * 6
const rPad = Math.hypot(s0[o] - s0[m], s0[o + 1] - s0[m + 1], s0[o + 2] - s0[m + 2])
const vPad = Math.hypot(s0[o + 3] - s0[m + 3], s0[o + 4] - s0[m + 4], s0[o + 5] - s0[m + 5])
const standing = R_MOON + SHIP.lunarAscent.standHeight
const spinSpeed = MOON_SPIN_RATE * standing * Math.cos(site.latitude * DEG)
const up = new (await import('three')).Vector3()
siteDirection(up, site, live.sim.t)
const onSite =
  ((s0[o] - s0[m]) * up.x + (s0[o + 1] - s0[m + 1]) * up.y + (s0[o + 2] - s0[m + 2]) * up.z) / rPad

const C = L.selenocentric(INDEX.target)
const co = orbitOf(C.r, C.v, MU_MOON)
const perilune = co.periapsis - R_MOON
const apolune = co.apoapsis - R_MOON

console.log('\n=== on the pad ===')
console.log(`  state radius ${(rPad - R_MOON).toFixed(6)} m above the datum (stand height ${SHIP.lunarAscent.standHeight} m)`)
console.log(`  carried round at ${vPad.toFixed(6)} m/s; the Moon's spin there is ${spinSpeed.toFixed(6)} m/s`)
console.log(`  Columbia placed ${lunar.placement}: ${(perilune / NMI).toFixed(4)} x ${(apolune / NMI).toFixed(4)} nmi`)

/* ---------------------------------------------------------------- *
 * 2. The flight
 * ---------------------------------------------------------------- */

/**
 * Fly from the count to `until` (a phase), holding the burns at `force` if
 * given: the pilot's dial, turned up through the ascent. Returns what the
 * checks read, and the events in the order they happened.
 */
function fly(until, force = null) {
  resetSimulation()
  resetMission()
  refreshDerived()
  flight.warp = WARP.x1
  flight.lastWarpRequest = null
  flight.warpBeforeBurn = null
  flight.pilotWarp = null
  beginCountdown()
  const held = new Set(['LUNAR_PRE_LAUNCH', 'LUNAR_LIFTOFF', 'LUNAR_ASCENT'])
  const events = {}
  let cutoff = null
  let last = ''
  let lost = false
  for (let i = 0; i < 3_000_000; i++) {
    const id = currentPhase().id
    if (id !== last) {
      events[id] = { t: mission.t, sim: live.sim.t, rcs: lunar.rcsUsed, range: lunar.range }
      if (id === 'LUNAR_INSERTION' || (last === 'LUNAR_ASCENT' && !cutoff)) {
        const s = live.sim.state
        const r = [s[o] - s[m], s[o + 1] - s[m + 1], s[o + 2] - s[m + 2]]
        const v = [s[o + 3] - s[m + 3], s[o + 4] - s[m + 4], s[o + 5] - s[m + 5]]
        const rn = Math.hypot(...r)
        const vr = (r[0] * v[0] + r[1] * v[1] + r[2] * v[2]) / rn
        const vh = Math.sqrt(v[0] ** 2 + v[1] ** 2 + v[2] ** 2 - vr * vr)
        const orbit = orbitOf(r, v, MU_MOON)
        cutoff = {
          t: mission.t,
          altitude: rn - R_MOON,
          radial: vr,
          horizontal: vh,
          perilune: orbit.periapsis - R_MOON,
          apolune: orbit.apoapsis - R_MOON,
          propellant: ship.stageProp[0],
        }
      }
      last = id
      if (id === until) break
      if (id === 'LOST') {
        lost = true
        break
      }
    }
    if (force !== null && held.has(id)) {
      flight.lastWarpRequest = mission.warpRequest
      flight.warp = force
    }
    frame()
  }
  return { events, cutoff, lost, lunar: { ...lunar, mccDv: [...lunar.mccDv] } }
}

const nominal = fly('DOCKED')
const fast = fly('LM_COAST_CSI', WARP.m1)
const ev = nominal.events
const liftoff = nominal.lunar.liftoffTime
const at = (id) => (ev[id] ? ev[id].sim - liftoff : NaN)
const ins = SHIP.lunarAscent.insertion

console.log('\n=== the ascent ===')
const c = nominal.cutoff
console.log(`  burn ${c.t.toFixed(1)} s (Eagle's: 435 s)   propellant left ${c.propellant.toFixed(0)} kg`)
console.log(
  `  cutoff: ${(c.altitude / 1000).toFixed(3)} km, climbing ${c.radial.toFixed(3)} m/s, ` +
    `${c.horizontal.toFixed(3)} m/s horizontal   (P12 target ${ins.altitude / 1000} km, ${ins.radial}, ${ins.horizontal})`,
)
console.log(`  orbit ${(c.perilune / 1000).toFixed(2)} x ${(c.apolune / 1000).toFixed(2)} km (Eagle's: 17.6 x 87.6)`)
const f = fast.cutoff
console.log(
  `  flown at 60x: ${(f.perilune / 1000).toFixed(3)} x ${(f.apolune / 1000).toFixed(3)} km ` +
    `against ${(c.perilune / 1000).toFixed(3)} x ${(c.apolune / 1000).toFixed(3)} at 1x`,
)

console.log('\n=== the rendezvous ===')
const lu = nominal.lunar
const row = (name, t, apollo, extra = '') =>
  console.log(`  ${name.padEnd(10)} ${hms(t).padStart(8)}   Apollo 11 ${apollo.padStart(8)}   ${extra}`)
row('insertion', at('LUNAR_INSERTION'), '0:07:16', '')
row('CSI', at('LM_CSI'), '0:57:34', `${(lu.csi.dv / FT).toFixed(1)} ft/s (51.5)`)
row('CDH', at('LM_CDH'), '1:55:49', `${(lu.cdh.dv / FT).toFixed(1)} ft/s, ${(lu.cdh.dh / NMI).toFixed(1)} nmi below`)
row('TPI', at('LM_TPI'), '2:41:51', `${(lu.tpi.dv / FT).toFixed(1)} ft/s (24.9)`)
row('braking', at('LM_BRAKING'), '3:14:56', '')
row('docked', lu.dockedTime - liftoff, '3:41:00', `at ${lu.dockingSpeed.toFixed(3)} m/s`)
console.log(`  midcourse corrections ${lu.mccDv.map((v) => `${(v / FT).toFixed(2)} ft/s`).join(', ')}`)
console.log(`  RCS Δv used ${lu.rcsUsed.toFixed(1)} m/s; Columbia's ${lu.columbiaRcs.toFixed(3)} m/s`)

/* ---------------------------------------------------------------- *
 * 3. The frame paths
 * ---------------------------------------------------------------- */

console.log('\n=== allocation ===')
const control = await knownAllocation()
const samples = {}
// The pad paths on the pad, where they run. The clamp is measured as
// `clampToSiteNow`, the lunar clamp itself: `applyClamp` above it only chooses
// between it and the docked hold, and read through that dispatcher the reading
// depends on which branch the optimiser saw first — measured, 16 B while its
// code was the one compiled mid-flight, 0.06 B recompiled, on identical work.
resetSimulation()
resetMission()
refreshDerived()
const padState = live.sim.state
const padSite = mission.site
// Integers, resolved here as the sequencer resolves them: `INDEX` is built by
// Object.fromEntries, and its entries times six come out of the optimiser as
// doubles, boxed when they are handed to a call.
const padBody = mission.bodyOffset | 0
const padShip = (INDEX.ship * 6) | 0
for (const [name, fn] of Object.entries({
  'holdOnSurface, on the pad': () => L.holdOnSurface(),
  'steerVertical, on the pad': () => L.steerVertical(),
  'the lunar clamp, on the pad': () => {
    siteClock[0] = live.sim.t
    clampToSiteNow(padState, padSite, padBody, padShip)
  },
})) {
  /*
   * A longer warm-up than the harness's default. Back on the pad after the
   * flights above, the optimiser recompiles these, concurrently, and the new
   * code lands after 4,000 calls: measured, the clamp's first reading was 16 B
   * and the same call read 0.06 B a moment later.
   */
  samples[name] = await bytesPerCall(fn, { warm: 40_000 })
  console.log(`  ${name.padEnd(30)} ${sampleText(samples[name])}`)
}
// The rest in flight: the terminal phase, where they all have state to act on.
fly('LM_BRAKING')
const q = new Quaternion()
const { Matrix4, Vector3 } = await import('three')
const basis = new Matrix4()
const ax = new Vector3(1, 0, 0)
const ay = new Vector3(0, 1, 0)
const az = new Vector3(0, 0, 1)
const paths = {
  steerAscent: () => L.steerAscent(),
  flyBurn: () => {
    lunar.burn.set(0.3, 0.2, 0.1)
    L.flyBurn(1 / 60)
  },
  flyClosing: () => L.flyClosing(1 / 60),
  flyDocking: () => L.flyDocking(0),
  faceTarget: () => L.faceTarget(),
  readTarget: () => L.readTarget(),
  columbiaAttitude: () => L.columbiaAttitude(q),
  lunarStepCeiling: () => L.lunarStepCeiling('LUNAR_ASCENT'),
  applyDocked: () => L.applyDocked(),
  writeBasis: () => L.writeBasis(basis, ax, ay, az),
}
for (const [name, fn] of Object.entries(paths)) {
  samples[name] = await bytesPerCall(fn)
  console.log(`  ${name.padEnd(30)} ${sampleText(samples[name])}`)
}
console.log(`  the bar for allocating nothing is ${SMALLEST_OBJECT / 2} B a call`)

/* ---------------------------------------------------------------- *
 * The claims
 * ---------------------------------------------------------------- */

const checks = [
  // Constructions: exact to the arithmetic, so to a part in 10^9 of what is written.
  ['the clamp stands the LM at its stand height over the site', Math.abs(rPad - standing) < 1e-3 && onSite > 1 - 1e-12],
  ['and carries it round at the Moon\'s spin there', Math.abs(vPad - spinSpeed) < 1e-9 * spinSpeed + 1e-9],
  ["Columbia's placing was solved for Apollo 11's TPI time", lunar.placement === 'solved'],
  // A conic written as a state reads back as itself: a millimetre.
  ["and put it on Columbia's 56.6 x 62.5 nmi orbit", Math.abs(perilune - APOLLO11.columbia.perilune) < 1e-3 && Math.abs(apolune - APOLLO11.columbia.apolune) < 1e-3],
  ['the whole sequence flies to the latch without losing the vehicle', !nominal.lost && Boolean(ev.DOCKED)],
  /*
   * The cutoff. The engine stops when the horizontal speed reaches its target,
   * on a step held to the time 0.02 m/s takes (see lunarStepCeiling): so it can
   * finish at most that far past. The climb rate and height are the guidance
   * law's own convergence, which the last seconds of the burn hold rather than
   * chase: to a tenth of a metre a second and a few metres.
   */
  ['the ascent cuts off on its horizontal speed, to the step', c.horizontal - ins.horizontal >= 0 && c.horizontal - ins.horizontal < 0.02],
  ['climbing at P12\'s rate', Math.abs(c.radial - ins.radial) < 0.1],
  ['at P12\'s height', Math.abs(c.altitude - ins.altitude) < 10],
  /*
   * And at any warp. At 60x a step is a second; the ceiling holds the last of
   * them to the time 0.02 m/s takes, and near this orbit a metre a second is
   * 4.4 km of apolune: 90 m.
   */
  ['flown at the 60x cap it reaches the same orbit, to 0.1 km', Math.abs(f.apolune - c.apolune) < 100 && Math.abs(f.perilune - c.perilune) < 100],
  ['CSI was targeted, not fallen back on', lu.csi.targeted === true],
  /*
   * TPI where the CSI was solved to put it. The plan is two-body; Earth's
   * tide, 2.6e-5 m/s² at the Moon, acts across the 1.7 h from CSI to TPI and
   * moves a craft by up to half a t², 490 m; the coelliptic orbits close at
   * about 35 m/s along track (three halves the mean motion times 26 km over the
   * radius), so that is 14 s of TPI time. Twice it.
   */
  ['TPI falls within 30 s of Apollo 11\'s, 2:41:51', Math.abs(at('LM_TPI') - APOLLO11.tpiAt) < 30],
  /*
   * The same tide over the 43-minute transfer is 86 m, taken out over the half
   * hour the corrections have: 0.05 m/s. Six times it.
   */
  ['the midcourse corrections are under 0.3 m/s', lu.mccDv.length === 2 && lu.mccDv.every((v) => v < 0.3)],
  // A burn is delivered by never accelerating past what is left of it: exact.
  ['CSI delivered on the jets exactly what it was loaded with', Math.abs(ev.LM_COAST_CDH.rcs - ev.LM_CSI.rcs - lu.csi.dv) < 1e-9],
  ['and CDH and TPI likewise', Math.abs(ev.LM_COAST_TPI.rcs - ev.LM_CDH.rcs - lu.cdh.dv) < 1e-9 && Math.abs(ev.LM_TRANSFER.rcs - ev.LM_TPI.rcs - lu.tpi.dv) < 1e-9],
  /*
   * Braking begins at the first gate, 6,000 ft between the craft. The test is
   * made on the range read last frame, which closes 10 m/s at a sixth of a
   * second a frame: 2 m.
   */
  ['braking begins at the first gate, 6,000 ft', Math.abs(ev.LM_BRAKING.range - DOCKING_REACH - 6000 * FT) < 2 + 1e-9],
  // The docking closes at the speed it was told, inside the jets' dead band.
  ['contact at a tenth of a metre a second, within the dead band', Math.abs(lu.dockingSpeed - DOCKING_SPEED) < 0.01],
  /*
   * The schedule starts the final approach 300 s before Apollo 11's docking
   * time; the gap it starts from is whatever station-keeping held, 26 to 32 m,
   * which at 0.1 m/s is 260 to 320 s. 40 s either way.
   */
  ['docked within 40 s of Apollo 11\'s 3:41:00', Math.abs(lu.dockedTime - liftoff - APOLLO11.dockedAt) < 40],
  ['the ascent stage\'s RCS is left more than half full', lu.rcsUsed < 160],
  seesAllocation('the allocation measurement can see an allocation', control),
  ...Object.entries(samples).map(([name, sample]) =>
    allocatesNothing(`${name} allocates nothing`, sample, SMALLEST_OBJECT / 2),
  ),
]

console.log('\n=== what this establishes ===')
let ok = true
for (const [label, pass] of checks) {
  if (pass !== true) ok = false
  console.log(`  ${pass === true ? 'PASS' : 'FAIL'}  ${label}`)
}
console.log(`\n  ${ok ? 'PASS' : 'FAIL'}`)
process.exit(ok ? 0 : 1)
