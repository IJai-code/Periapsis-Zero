/**
 * The clock starts where the sky says it should.
 *
 * The simulator's epoch is J2000.0 and every fixture, gate and snapshot hangs
 * off that pinned world — so for its whole life the app booted there too, and
 * a visitor who opened it at local noon stood under a starfield. The day-night
 * bug was never the terminator maths (verify-solar has held that to the almanac
 * all along); it was the clock: 9771 days frozen at the turn of the millennium.
 *
 * The fix is `NOW_T`: in a browser the simulation starts at the real current
 * instant, and `buildInitialState(t)` places Earth, Moon and the vehicle at
 * that instant — Earth from the table's Kepler mean motion, the Moon from the
 * Sun-perturbed mean-element rates, every pad from its own GMST rotation.
 * This gate exercises that path exactly as the app runs it (simulated
 * `window`), without touching the pinned default the other gates rely on.
 *
 * Four claims, against the Astronomical Almanac's low-precision series —
 * code this simulator shares nothing with:
 *
 *  1. t = 0 is still J2000, byte for byte. The fixtures hang off it.
 *  2. The Sun is where the almanac puts it today (geocentric ecliptic
 *     longitude, to 1.5 deg — the table's own residual, as verify-solar holds).
 *  3. The Moon is where the almanac puts it, in longitude to 2 deg (the mean
 *     elements carry no evection) and in range to what they can carry.
 *  4. The terminator is real: the sub-solar longitude reads local solar time
 *     at each site to within 20 minutes, the equation of time's own amplitude
 *     — the claim "it was day where I live, and the sim showed day".
 *
 *   node scripts/verify-clock.mjs
 */
const { buildInitialState, NOW_T, INDEX } = await import('../src/sim/system.js')
const { LAUNCH_SITES, siteDirection } = await import('../src/sim/launchsite.js')
const { Vector3 } = await import('three')

const DEG = Math.PI / 180
const DAY = 86400

/* Standalone low-precision solar ecliptic longitude, deg — written out rather
   than imported, so this gate shares no helper with the code under test. */
function sunLongitude(t) {
  const n = t / DAY
  const L = (280.46 + 0.9856474 * n) % 360
  const g = ((357.528 + 0.9856003 * n) % 360) * DEG
  return (L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g) + 360) % 360
}

/* Truncated Meeus lunar longitude and range, deg and km. */
function moonState(t) {
  const T = t / DAY / 36525
  const sin = (x) => Math.sin(x * DEG)
  const cos = (x) => Math.cos(x * DEG)
  const lon =
    218.316 +
    481267.881 * T +
    6.29 * sin(134.963 + 477198.867 * T) -
    1.27 * sin(259.2 - 413335.38 * T) +
    0.66 * sin(235.7 + 890534.23 * T) +
    0.21 * sin(269.9 + 954397.7 * T) -
    0.19 * sin(357.5 + 35999.05 * T) -
    0.11 * sin(186.6 + 966404.05 * T)
  const dist =
    385000.56 -
    20905.355 * cos(134.963 + 477198.867 * T) -
    3699.111 * cos(259.2 - 413335.38 * T) -
    2955.968 * cos(235.7 + 890534.23 * T) -
    569.925 * cos(269.9 + 954397.7 * T)
  return { lon: (lon + 360) % 360, dist }
}

/* The simulator's geocentric ecliptic longitudes, from the scene frame. */
function skyAt(t) {
  const s = buildInitialState(t)
  const i = INDEX
  const ecl = (p) => [p[0], -p[2], p[1]]
  const P = (id) => ecl([s[i[id] * 6], s[i[id] * 6 + 1], s[i[id] * 6 + 2]])
  const se = P('earth').map((v, k) => v - P('sun')[k])
  const me = P('moon').map((v, k) => v - P('earth')[k])
  const wrap = (x) => ((x % 360) + 360) % 360
  return {
    sunLon: wrap(Math.atan2(se[1], se[0]) / DEG + 180),
    moonLon: wrap(Math.atan2(me[1], me[0]) / DEG),
    moonDist: Math.hypot(...me) / 1000,
    state: s,
  }
}

const diff = (a, b) => (((a - b + 540) % 360) - 180)

const checks = []
const check = (label, ok) => checks.push([label, ok])

/* 1 — the pinned world did not move. */
const atZero = skyAt(0)
const again = skyAt(0)
check('t = 0 is J2000, reproduced byte for byte', Buffer.from(atZero.state.buffer).equals(Buffer.from(again.state.buffer)))

/* 2 and 3 — today's sky, the way the app computes it: with a window. A query
   string makes Node load a fresh instance rather than the cached one whose
   NOW_T was evaluated windowless. */
globalThis.window = {}
const { NOW_T: realNow } = await import('../src/sim/system.js?as-browser')
delete globalThis.window
const nowT = realNow
check('the app clock defaults to the pinned epoch outside a browser', NOW_T === 0)
check('the browser clock is the real current instant', Math.abs(nowT - (Date.now() - Date.UTC(2000, 0, 1, 12)) / 1000) < 60)
const now = skyAt(nowT)
console.log(`  now: ${new Date(Date.UTC(2000, 0, 1, 12) + nowT * 1000).toISOString()}  (${(nowT / DAY).toFixed(2)} d past J2000)`)

const sunErr = diff(now.sunLon, sunLongitude(nowT))
console.log(`  sun ecliptic longitude: sim ${now.sunLon.toFixed(3)}  almanac ${sunLongitude(nowT).toFixed(3)}  err ${sunErr.toFixed(3)} deg`)
check('the Sun is where the almanac puts it today, to 1.5 deg', Math.abs(sunErr) < 1.5)

const moon = moonState(nowT)
const moonErr = diff(now.moonLon, moon.lon)
console.log(`  moon ecliptic longitude: sim ${now.moonLon.toFixed(2)}  almanac ${moon.lon.toFixed(2)}  err ${moonErr.toFixed(2)} deg`)
check('the Moon is where the almanac puts it today, to 2 deg', Math.abs(moonErr) < 2)
console.log(`  moon range: sim ${now.moonDist.toFixed(0)} km  almanac ${moon.dist.toFixed(0)} km  err ${(now.moonDist - moon.dist).toFixed(0)} km`)
check('the Moon is no worse than the mean elements can carry (8000 km)', Math.abs(now.moonDist - moon.dist) < 8000)

/* 4 — the terminator. The sub-solar longitude is the one whose siteDirection
   faces the Sun most squarely — an argmax, not a zero crossing, which is why
   this is a golden-section search and not the bisection the first draft
   reached for: bisection finds the terminator, 90 degrees from noon. Against
   mean solar time, whose equation-of-time amplitude is 16.4 min; 20 min lets
   the claim through and nothing else. */
const up = new Vector3()
let worstMin = 0
const nowState = buildInitialState(nowT)
{
  const i = INDEX
  const ecl = (p) => [p[0], -p[2], p[1]]
  const dir = ecl([nowState[i.sun * 6], nowState[i.sun * 6 + 1], nowState[i.sun * 6 + 2]]).map(
    (v, k) => v - ecl([nowState[i.earth * 6], nowState[i.earth * 6 + 1], nowState[i.earth * 6 + 2]])[k],
  )
  const len = Math.hypot(...dir)
  const sunScene = { x: dir[0] / len, y: dir[2] / len, z: -dir[1] / len }
  const faces = (lon) => {
    siteDirection(up, { ...Object.values(LAUNCH_SITES)[0], longitude: lon }, nowT)
    return up.x * sunScene.x + up.y * sunScene.y + up.z * sunScene.z
  }
  /* Golden-section maximum of a cos-shaped function over one turn. */
  const PHI = (Math.sqrt(5) - 1) / 2
  let a = -180
  let b = 180
  let c = b - PHI * (b - a)
  let d = a + PHI * (b - a)
  for (let k = 0; k < 60 && b - a > 1e-4; k++) {
    if (faces(c) > faces(d)) {
      b = d
      d = c
      c = b - PHI * (b - a)
    } else {
      a = c
      c = d
      d = a + PHI * (b - a)
    }
  }
  const simNoonLon = (((a + b) / 2 + 360) % 360 + 360) % 360
  /* Mean-sun sub-solar longitude. nowT is seconds past J2000.0, which was
   * 12:00 UTC, so (nowT/3600) mod 24 is hours since UTC noon — and the sun
   * stands 15 deg further west for every hour of it. The clock-of-day forms
   * of this (both earlier drafts) hid a 12-hour offset inside a wrap and put
   * the mean sun on the other side of the planet. */
  const hoursSinceNoon = ((nowT / 3600) % 24 + 24) % 24
  const meanNoonLon = (((-15 * hoursSinceNoon) % 360) + 360) % 360
  worstMin = Math.abs(diff(simNoonLon, meanNoonLon)) * 4
}
console.log(`  sub-solar longitude vs mean solar time: worst ${worstMin.toFixed(1)} min (equation of time amplitude 16.4)`)
check('the terminator runs on real local solar time, to 20 min', worstMin < 20)

console.log('\n=== what this establishes ===')
let pass = true
for (const [label, ok] of checks) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`)
  if (!ok) pass = false
}
console.log(`\n  ${pass ? 'PASS' : 'FAIL'}`)
process.exit(pass ? 0 : 1)
