/**
 * The Moon's body-fixed frame, measured on the simulated Moon.
 *
 * `sim/moonFrame.js` is three empirical laws — uniform rotation locked to the
 * orbit, a fixed tilt to the ecliptic, the three poles coplanar — and a mean
 * orbit measured from the simulation. This gate checks the laws hold, and then
 * holds the frame to what the real Moon does when it obeys them: flown against
 * the integrated orbit, Earth must wander in the lunar sky by the real Moon's
 * libration and no more, and must not drift.
 *
 * And the drawn Moon with it. Before this frame the Moon was pointed at Earth,
 * and with the imagery's 0° longitude on three's +x and the mesh turned half a
 * turn, the hemisphere pointed at Earth was longitude 90°E — the limb, not the
 * near side. The drawn Moon is turned by the frame now; the gate composes the
 * same rotation three does and reads which longitude of the map faces Earth.
 *
 *   node --expose-gc scripts/verify-moon-frame.mjs
 */
const { Group, Matrix4, Object3D, Vector3 } = await import('three')
const { live, resetSimulation } = await import('../src/sim/live.js')
const { INDEX } = await import('../src/sim/system.js')
const { MOON_MEAN } = await import('../src/sim/moonMean.js')
const { MOON_EQUATOR_TILT, moonAxes, moonClock, moonTurn, toSelenographic } = await import('../src/sim/moonFrame.js')
const { measureMoon } = await import('./measure-moon.mjs')
const { SMALLEST_OBJECT, allocatesNothing, bytesPerCall, knownAllocation, sampleText, seesAllocation } =
  await import('./allocation.mjs')

const DEG = Math.PI / 180
const DAY = 86400
const MONTH = (2 * Math.PI) / MOON_MEAN.motion

/* ---------------------------------------------------------------- *
 * 1. The record is the simulated Moon's
 * ---------------------------------------------------------------- */

const fresh = measureMoon()
const recordMatches = ['longitude', 'motion', 'node', 'nodeRate', 'inclination'].every(
  (k) => fresh[k] === MOON_MEAN[k],
)
resetSimulation()

/* ---------------------------------------------------------------- *
 * 2. A rotation, obeying Cassini's laws
 * ---------------------------------------------------------------- */

const a = new Float64Array(9)
let worstOrtho = 0
let worstTilt = 0
let worstCoplanar = 0
for (let years = 0; years <= 20; years += 0.37) {
  moonClock[0] = years * 365.25 * DAY
  moonAxes(a)
  const x = new Vector3(a[0], a[1], a[2])
  const y = new Vector3(a[3], a[4], a[5])
  const z = new Vector3(a[6], a[7], a[8])
  worstOrtho = Math.max(
    worstOrtho,
    Math.abs(x.length() - 1),
    Math.abs(y.length() - 1),
    Math.abs(z.length() - 1),
    Math.abs(x.dot(y)),
    Math.abs(y.dot(z)),
    Math.abs(z.dot(x)),
    new Vector3().crossVectors(x, y).sub(z).length(),
  )
  // Law 2: the equator's pole stands I from the ecliptic's (scene +y).
  worstTilt = Math.max(worstTilt, Math.abs(Math.acos(z.y) - MOON_EQUATOR_TILT))
  // Law 3: the equator's pole leans toward the orbit's *descending* node, so
  // it is 180 degrees in longitude from the orbit's pole, which leans toward
  // longitude node - 90.
  const node = MOON_MEAN.node + MOON_MEAN.nodeRate * moonClock[0]
  const orbitPoleLon = node - Math.PI / 2
  const equatorPoleLon = Math.atan2(-z.z, z.x)
  let d = Math.abs(equatorPoleLon - orbitPoleLon) % (2 * Math.PI)
  if (d > Math.PI) d = 2 * Math.PI - d
  worstCoplanar = Math.max(worstCoplanar, Math.abs(d - Math.PI))
}
/*
 * Law 1: uniform rotation, measured about the Moon's own pole. (Measured as
 * the prime meridian's ecliptic longitude instead, the first draft saw the
 * rate wobble by 3.6e-4 and called it a failure: a point on a circle tilted by
 * I projects onto the ecliptic unevenly, by I²/2.) The spin about the body pole
 * is the mean motion less the node's regression seen through the tilt,
 * L' - Ω'(1 - cos I): once per sidereal month, to 1.5e-6.
 */
const spinRate = MOON_MEAN.motion - MOON_MEAN.nodeRate * (1 - Math.cos(MOON_EQUATOR_TILT))
let worstRate = 0
const b = new Float64Array(9)
for (let day = 0; day < 60; day += 7) {
  moonClock[0] = day * DAY
  moonAxes(a)
  moonClock[0] = day * DAY + 3600
  moonAxes(b)
  const x0 = new Vector3(a[0], a[1], a[2])
  const x1 = new Vector3(b[0], b[1], b[2])
  const pole = new Vector3(a[6], a[7], a[8])
  const turned = Math.atan2(new Vector3().crossVectors(x0, x1).dot(pole), x0.dot(x1))
  worstRate = Math.max(worstRate, Math.abs(turned / 3600 - spinRate) / spinRate)
}

/* ---------------------------------------------------------------- *
 * 3. Libration, flown
 * ---------------------------------------------------------------- */

const lon = []
const lat = []
const ts = []
for (let h = 0; h <= 366 * 24; h += 6) {
  const gap = h * 3600 - live.sim.t
  if (gap > 0) live.sim.advance(gap, 900)
  const s = live.sim.state
  const m = INDEX.moon * 6
  const e = INDEX.earth * 6
  const p = toSelenographic(s[e] - s[m], s[e + 1] - s[m + 1], s[e + 2] - s[m + 2], live.sim.t)
  lon.push(p.longitude)
  lat.push(p.latitude)
  ts.push(live.sim.t)
}
const monthlyMeans = []
for (let k = 0; (k + 1) * MONTH <= ts[ts.length - 1]; k++) {
  const seg = lon.filter((_, i) => ts[i] >= k * MONTH && ts[i] < (k + 1) * MONTH)
  monthlyMeans.push(seg.reduce((x, y) => x + y, 0) / seg.length)
}
const worstMonthlyMean = Math.max(...monthlyMeans.map(Math.abs))
const maxLon = Math.max(...lon.map(Math.abs))
const maxLat = Math.max(...lat.map(Math.abs))
const latExpected = (MOON_EQUATOR_TILT + MOON_MEAN.inclination) / DEG

/* ---------------------------------------------------------------- *
 * 4. The drawn Moon
 * ---------------------------------------------------------------- */

/*
 * Composed as Moon.jsx composes it: the group turned by the frame, the mesh a
 * quarter-turn about its pole inside it. three's sphere puts a map's u at
 * atan2(z, -x) around its pole, and the map's 0° longitude at u = 0.5; so the
 * map longitude a direction lands on is read from the mesh's own frame.
 */
const mapLongitude = (mesh, dir) => {
  mesh.updateWorldMatrix(true, false)
  const local = dir.clone().transformDirection(mesh.matrixWorld.clone().invert())
  const u = (((Math.atan2(local.z, -local.x) / (2 * Math.PI)) % 1) + 1) % 1
  return { longitude: (u - 0.5) * 360, latitude: Math.asin(Math.max(-1, Math.min(1, local.y))) / DEG }
}
resetSimulation()
const drawn = new Group()
const surface = new Object3D()
surface.rotation.set(0, -Math.PI / 2, 0)
drawn.add(surface)
const turn = new Matrix4()
// The construction this replaced: pointed at Earth, the mesh a half-turn round.
const pointed = new Group()
const pointedSurface = new Object3D()
pointedSurface.rotation.set(0, Math.PI, 0)
pointed.add(pointedSurface)
let worstMapLon = 0
let worstMapLat = 0
let oldFacing = 0
for (let day = 0; day <= 30; day += 3) {
  const gap = day * DAY - live.sim.t
  if (gap > 0) live.sim.advance(gap, 900)
  const s = live.sim.state
  const m = INDEX.moon * 6
  const e = INDEX.earth * 6
  const toEarth = new Vector3(s[e] - s[m], s[e + 1] - s[m + 1], s[e + 2] - s[m + 2]).normalize()
  const frame = toSelenographic(toEarth.x, toEarth.y, toEarth.z, live.sim.t)
  moonClock[0] = live.sim.t
  moonTurn(turn.elements)
  drawn.quaternion.setFromRotationMatrix(turn)
  const map = mapLongitude(surface, toEarth)
  let dl = Math.abs(map.longitude - frame.longitude) % 360
  if (dl > 180) dl = 360 - dl
  worstMapLon = Math.max(worstMapLon, dl)
  worstMapLat = Math.max(worstMapLat, Math.abs(map.latitude - frame.latitude))
  pointed.position.set(0, 0, 0)
  pointed.lookAt(toEarth)
  oldFacing = mapLongitude(pointedSurface, toEarth).longitude
}

/* ---------------------------------------------------------------- *
 * 5. Allocation of what runs every frame
 * ---------------------------------------------------------------- */

const control = await knownAllocation()
const times = new Float64Array(64)
for (let i = 0; i < 64; i++) times[i] = i * 3600.5
const cursor = new Int32Array(1)
const elements = new Float64Array(16)
const perFrame = await bytesPerCall(() => {
  moonClock[0] = times[cursor[0]++ & 63]
  moonTurn(elements)
})

/* ---------------------------------------------------------------- *
 * Report
 * ---------------------------------------------------------------- */

const f = (x, n = 2) => x.toFixed(n)
console.log('\n=== the mean orbit ===')
console.log(`  sidereal month ${f(MONTH / DAY, 4)} d, mean longitude at J2000 ${f(MOON_MEAN.longitude / DEG, 3)}°, node ${f(MOON_MEAN.node / DEG, 3)}°`)
console.log(`  re-measured from a year of the integrated system: ${recordMatches ? 'identical' : 'DIFFERENT'}`)
console.log('\n=== the laws ===')
console.log(`  orthonormal and right-handed over 20 years to ${worstOrtho.toExponential(1)}`)
console.log(`  equator tilt ${f(MOON_EQUATOR_TILT / DEG, 3)}°, held to ${worstTilt.toExponential(1)} rad; poles coplanar to ${worstCoplanar.toExponential(1)} rad`)
console.log(`  turning at the orbit's mean motion to ${worstRate.toExponential(1)} of it`)
console.log('\n=== libration, a year of the integrated orbit ===')
console.log(`  longitude: widest ${f(maxLon)}°; each month's mean ${monthlyMeans.map((x) => f(x)).join(' ')}`)
console.log(`  latitude: widest ${f(maxLat)}°, against I + i = ${f(latExpected)}°`)
console.log('\n=== the drawn Moon ===')
console.log(`  the map longitude facing Earth, against the frame's: within ${worstMapLon.toExponential(1)}°, latitude ${worstMapLat.toExponential(1)}°`)
console.log(`  pointed at Earth the old way, it faced map longitude ${f(oldFacing, 1)}°`)
console.log(`\n=== allocation ===\n  the frame's turn, per frame: ${sampleText(perFrame)}`)

console.log('\n=== what this establishes ===')
const checks = [
  ["the recorded mean orbit is the simulated Moon's own", recordMatches],
  ['the frame is a rotation, right-handed, at every time', worstOrtho < 1e-12],
  ["it turns uniformly at the orbit's mean motion — locked, Cassini's first law", worstRate < 1e-9],
  ['its equator holds a fixed tilt to the ecliptic — the second', worstTilt < 1e-12],
  ["and its pole leans away from the orbit's, across the ecliptic's — the third", worstCoplanar < 1e-9],
  /*
   * What those laws do, measured on the integrated orbit. Each month's mean
   * sub-Earth longitude is zero but for the solar terms a month does not
   * average out — the annual equation, 0.19°, and the unaveraged part of
   * evection's 1.27° over a month that is not its period — so under half a
   * degree. Paced by the real Moon instead, it drifted 3.8° a month.
   */
  ['Earth stays centred in the lunar sky, month after month', worstMonthlyMean < 0.5],
  ["and wanders east and west no further than the real Moon's 7.9°", maxLon < 7.9 && maxLon > 4],
  ['and north and south by the tilt between the equator and the orbit', Math.abs(maxLat - latExpected) < 0.3],
  ['the drawn Moon shows Earth the longitude the frame says it does', worstMapLon < 1e-6 && worstMapLat < 1e-6],
  ['which pointed at Earth the old way was the limb at 90°E', Math.abs(Math.abs(oldFacing) - 90) < 1],
  seesAllocation('the allocation measurement can see an allocation', control),
  allocatesNothing('turning the drawn Moon allocates nothing', perFrame, SMALLEST_OBJECT / 2),
]
let pass = true
for (const [label, ok] of checks) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`)
  if (!ok) pass = false
}
console.log(`\n  ${pass ? 'PASS' : 'FAIL'}`)
process.exit(pass ? 0 : 1)
