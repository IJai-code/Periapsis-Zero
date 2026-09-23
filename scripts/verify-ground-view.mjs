/**
 * What a person standing by the pad sees, measured.
 *
 * The eye-level view (`gfx/groundView.js`) is the one shot in the simulator
 * meant to look like being there, and the first time it was looked at in the
 * running app it showed four things wrong that nothing numeric had caught:
 *
 * **The sky was dusk at mid-morning.** The atmosphere is drawn 3.5 times
 * thicker than it is so its limb shows from space, with the scattering
 * coefficients left alone — which multiplies every vertical optical depth by
 * 3.5. From the ground that turned a Sun 38 degrees up into the colour of one
 * 10 degrees up: pale green overhead, orange along the horizon. The stretch now
 * eases to 1 below the real atmosphere's top (`stretchAtmosphere`), and the
 * samples bunch toward the eye so fourteen of them resolve an 8 km scale
 * height.
 *
 * **The stars were out.** The starfield and the Milky Way are drawn for space,
 * and nothing told them the sky had become bright. `gfx/skyGlow.js` works out
 * the sky's brightness over the camera from the same scattering integral and
 * hides what an eye adapted to it could not find.
 *
 * **The Saturn V lay on its side.** A glTF stands along +Y and the ship's nose
 * is +Z, and nothing turned the one onto the other — so the stack stood on its
 * pad horizontal, and had since the model was bound.
 *
 * **The vapour was not drawn at all.** The pad is carried into the scene by a
 * mirror, three answers a mirrored object by flipping which winding is the
 * front, and billboards built in view space do not flip with it: every puff was
 * culled.
 *
 * This gate holds each of those, and holds the part that must not move: from
 * above 100 km every uniform the atmosphere is drawn with is bit-for-bit what
 * it was, and every star is where it was.
 *
 *   node --expose-gc scripts/verify-ground-view.mjs
 */
process.env.PERIAPSIS_VESSEL ??= 'apollo8'
process.env.PERIAPSIS_SITE ??= 'ksc'

import { existsSync, readFileSync } from 'node:fs'

const { DoubleSide, Matrix4, Object3D, Quaternion, Vector3 } = await import('three')
const A = await import('../src/gfx/atmosphereShader.js')
const { daySky, measureSky, skyRadiance } = await import('../src/gfx/skyGlow.js')
const { MAGNITUDE_LIMIT } = await import('../src/gfx/stars.js')
const { noseOf, turnNose } = await import('../src/gfx/models.js')
const { aimPadParticles, makePadParticles } = await import('../src/gfx/padParticles.js')
const { makePlumeMaterial } = await import('../src/gfx/plumeShader.js')
const { makeSunMaterial } = await import('../src/gfx/shaders.js')
const { ShaderMaterial } = await import('three')
const { BODIES } = await import('../src/sim/constants.js')
const { VESSELS } = await import('../src/sim/vessels.js')
const { SMALLEST_OBJECT, allocatesNothing, bytesPerCall, knownAllocation, sampleText, seesAllocation } =
  await import('./allocation.mjs')

const Re = BODIES.earth.radius
const DEG = Math.PI / 180
/** The brightest star in the catalogue: Sirius, V = −1.46. */
const SIRIUS = -1.46
/** And the brightest planet, Venus near greatest brilliancy — `Planets.jsx`'s bound. */
const VENUS = -4.9

const mat = A.makeVolumetricAtmosphere()
const u = mat.uniforms
/** Put the camera `h` metres above the sphere with the Sun `el` degrees up, and stretch. */
function standAt(h, el = 38, m = mat) {
  m.uniforms.uCamToPlanet.value.set(0, 1 + h / Re, 0)
  m.uniforms.uSunDir.value.set(Math.cos(el * DEG), Math.sin(el * DEG), 0)
  A.stretchAtmosphere(m)
}
const stretchNow = () => u.uHr.value / (8000 / Re)
/** Eye height, m — `gfx/groundView.js`'s. */
const EYE = 1.75

/* ---------------------------------------------------------------- *
 * 1. The stretch: true on the ground, unchanged from orbit
 * ---------------------------------------------------------------- */

// The ground first, so that returning to space has to restore the spacing.
standAt(EYE)
const groundX = stretchNow()
const groundTopKm = ((u.uAtmosRadius.value - 1) * Re) / 1e3
const groundNear = u.uNear.value
// A zenith ray's first sample, as the shader places it: fraction of a 100 km span.
const firstSampleWarped = u.uViewMid.value[0] * 100e3
const firstSampleEven = (0.5 / A.VIEW_SAMPLES) * 100e3

// Continuity through the air: 0 to 100 km in 500 m steps.
let monotone = true
let prevX = 0
let prevNear = 2
let biggestStep = 0
for (let h = 0; h <= 100e3; h += 500) {
  standAt(h)
  const x = stretchNow()
  if (x < prevX - 1e-12 || u.uNear.value > prevNear + 1e-12) monotone = false
  if (prevX > 0) biggestStep = Math.max(biggestStep, x - prevX)
  prevX = x
  prevNear = u.uNear.value
}

// And from orbit, bit for bit what the shell was always drawn with.
const SPACE_HR = (8000 * A.THICKNESS_EXAGGERATION) / Re
const SPACE_HM = (1200 * A.THICKNESS_EXAGGERATION) / Re
let spaceIdentical = true
let spaceEven = true
for (const h of [100e3, 185e3, 35_786e3, 384_400e3]) {
  standAt(h)
  if (u.uHr.value !== SPACE_HR || u.uHm.value !== SPACE_HM || u.uAtmosRadius.value !== A.ATMOSPHERE_RADIUS) {
    spaceIdentical = false
  }
  if (u.uNear.value !== 0) spaceIdentical = false
  for (let i = 0; i < A.VIEW_SAMPLES; i++) {
    if (Math.abs(u.uViewMid.value[i] - (i + 0.5) / A.VIEW_SAMPLES) > 1e-7) spaceEven = false
    if (Math.abs(u.uViewSeg.value[i] - 1 / A.VIEW_SAMPLES) > 1e-7) spaceEven = false
  }
  for (let j = 0; j < A.LIGHT_SAMPLES; j++) {
    if (Math.abs(u.uLightMid.value[j] - (j + 0.5) / A.LIGHT_SAMPLES) > 1e-7) spaceEven = false
    if (Math.abs(u.uLightSeg.value[j] - 1 / A.LIGHT_SAMPLES) > 1e-7) spaceEven = false
  }
}

/* ---------------------------------------------------------------- *
 * 2. The colour of the sky from the ground
 * ---------------------------------------------------------------- */

const eye = [0, 1 + EYE / Re, 0]
const sun38 = [Math.cos(38 * DEG), Math.sin(38 * DEG), 0]
const dirAt = (el, az) => [Math.cos(el * DEG) * Math.cos(az * DEG), Math.sin(el * DEG), Math.cos(el * DEG) * Math.sin(az * DEG)]
const zenith = dirAt(90, 0)
const lowAway = dirAt(5, 180)

standAt(EYE, 38)
const nowZenith = skyRadiance([0, 0, 0], eye, zenith, sun38, mat)
const nowLow = skyRadiance([0, 0, 0], eye, lowAway, sun38, mat)

// The construction it replaced: the space uniforms, used from the ground.
standAt(185e3, 38)
const oldZenith = skyRadiance([0, 0, 0], eye, zenith, sun38, mat)
const oldLow = skyRadiance([0, 0, 0], eye, lowAway, sun38, mat)
const hue = (v) => v.map((x) => (x / Math.max(...v)).toFixed(2)).join(' : ')

/* ---------------------------------------------------------------- *
 * 3. How well fourteen samples do it
 * ---------------------------------------------------------------- */

const fine = A.makeVolumetricAtmosphere({ viewSamples: 3000, lightSamples: 600 })
const even = A.makeVolumetricAtmosphere()
standAt(EYE, 38)
standAt(EYE, 38, fine)
standAt(EYE, 38, even)
// The same air, sampled the way it was before: evenly.
for (let i = 0; i < A.VIEW_SAMPLES; i++) {
  even.uniforms.uViewMid.value[i] = (i + 0.5) / A.VIEW_SAMPLES
  even.uniforms.uViewSeg.value[i] = 1 / A.VIEW_SAMPLES
}
for (let j = 0; j < A.LIGHT_SAMPLES; j++) {
  even.uniforms.uLightMid.value[j] = (j + 0.5) / A.LIGHT_SAMPLES
  even.uniforms.uLightSeg.value[j] = 1 / A.LIGHT_SAMPLES
}
let worstHigh = 0
let worstLow = 0
let alwaysBetter = true
let worstEvenHigh = 0
for (const el of [90, 60, 30, 15, 5, 2]) {
  for (const az of [0, 90, 180]) {
    const d = dirAt(el, az)
    const ref = skyRadiance([0, 0, 0], eye, d, sun38, fine)
    const w = skyRadiance([0, 0, 0], eye, d, sun38, mat)
    const e = skyRadiance([0, 0, 0], eye, d, sun38, even)
    const err = (v) => Math.max(...[0, 1, 2].map((k) => Math.abs(v[k] - ref[k]) / ref[k]))
    if (err(w) > err(e)) alwaysBetter = false
    if (el >= 15) {
      worstHigh = Math.max(worstHigh, err(w))
      worstEvenHigh = Math.max(worstEvenHigh, err(e))
    } else worstLow = Math.max(worstLow, err(w))
  }
}

/* ---------------------------------------------------------------- *
 * 4. What the sky hides
 * ---------------------------------------------------------------- */

standAt(EYE, 38)
measureSky(mat)
const day = { ...daySky }
standAt(EYE, -30)
measureSky(mat)
const night = { ...daySky }
const dusk = []
let darkening = true
for (let el = 30; el >= -18; el -= 3) {
  standAt(EYE, el)
  measureSky(mat)
  if (dusk.length && daySky.limitMagnitude < dusk[dusk.length - 1] - 1e-9) darkening = false
  dusk.push(daySky.limitMagnitude)
}
let orbitShowsAll = true
for (const el of [60, 0, -30]) {
  standAt(185e3, el)
  measureSky(mat)
  if (!(daySky.limitMagnitude >= MAGNITUDE_LIMIT) || daySky.milkyWay !== 1) orbitShowsAll = false
}
standAt(99.9e3, 38)
measureSky(mat)
const below = daySky.limitMagnitude
standAt(100.1e3, 38)
measureSky(mat)
const above = daySky.limitMagnitude

/* ---------------------------------------------------------------- *
 * 5. The vehicle stands up
 * ---------------------------------------------------------------- */

const AXES = { '+x': [1, 0, 0], '-x': [-1, 0, 0], '+y': [0, 1, 0], '-y': [0, -1, 0], '+z': [0, 0, 1], '-z': [0, 0, -1] }
let worstNose = 0
for (const [code, v] of Object.entries(AXES)) {
  const o = turnNose(new Object3D(), code)
  const n = new Vector3(...v).applyEuler(o.rotation)
  worstNose = Math.max(worstNose, new Vector3(0, 0, 1).distanceTo(n))
}

/*
 * The file itself, where it is present. The model catalogue is not in the
 * repository — CI fetches it after the gates run — so this half measures the
 * Saturn V when it can and says so when it cannot, and the recorded axes above
 * are what the build is held to either way.
 */
const SATURN = 'public/models/Saturn V/Saturn V.glb'
let saturn = null
if (existsSync(SATURN)) saturn = profileGlb(SATURN)

function profileGlb(file) {
  const buf = readFileSync(file)
  const jsonLen = buf.readUInt32LE(12)
  const gltf = JSON.parse(buf.subarray(20, 20 + jsonLen).toString())
  const bin = buf.subarray(20 + jsonLen + 8)
  const pts = []
  const nodeMatrix = (n) =>
    n.matrix
      ? new Matrix4().fromArray(n.matrix)
      : new Matrix4().compose(
          new Vector3(...(n.translation ?? [0, 0, 0])),
          new Quaternion(...(n.rotation ?? [0, 0, 0, 1])),
          new Vector3(...(n.scale ?? [1, 1, 1])),
        )
  const visit = (i, parent) => {
    const n = gltf.nodes[i]
    const m = parent.clone().multiply(nodeMatrix(n))
    for (const prim of n.mesh !== undefined ? gltf.meshes[n.mesh].primitives : []) {
      const acc = gltf.accessors[prim.attributes.POSITION]
      const view = gltf.bufferViews[acc.bufferView]
      const stride = view.byteStride ?? 12
      const off = (view.byteOffset ?? 0) + (acc.byteOffset ?? 0)
      for (let k = 0; k < acc.count; k++) {
        const b = off + k * stride
        pts.push(new Vector3(bin.readFloatLE(b), bin.readFloatLE(b + 4), bin.readFloatLE(b + 8)).applyMatrix4(m))
      }
    }
    for (const c of n.children ?? []) visit(c, m)
  }
  for (const r of gltf.scenes[gltf.scene ?? 0].nodes) visit(r, new Matrix4())
  // Turned as the craft turns it, then profiled along +Z: how wide is it near each end?
  const turn = new Matrix4().makeRotationFromEuler(turnNose(new Object3D(), noseOf('saturn_v')).rotation)
  const q = pts.map((p) => p.clone().applyMatrix4(turn))
  const lo = new Vector3(Infinity, Infinity, Infinity)
  const hi = new Vector3(-Infinity, -Infinity, -Infinity)
  for (const p of q) {
    lo.min(p)
    hi.max(p)
  }
  const size = new Vector3().subVectors(hi, lo)
  const cx = (lo.x + hi.x) / 2
  const cy = (lo.y + hi.y) / 2
  const width = (from, to) => {
    let w = 0
    for (const p of q) {
      const f = (p.z - lo.z) / size.z
      if (f >= from && f <= to) w = Math.max(w, Math.hypot(p.x - cx, p.y - cy))
    }
    return w
  }
  return { size: size.toArray(), nose: width(0.9, 1), tail: width(0, 0.1) }
}

const csm = VESSELS.apollo8.stages.find((s) => s.name === 'Service Module')

/* ---------------------------------------------------------------- *
 * 6. The pad's weather, inside a mirror
 * ---------------------------------------------------------------- */

// Terrain.jsx carries the pad into the scene with a scale of -1 in z.
const mirrored = new Matrix4().makeScale(1, 1, -1).determinant() < 0
const puffs = makePadParticles({
  emitters: [{ pos: [0, 0, 0], dir: [0, 1, 0] }],
  count: 8,
  colour: '#ffffff',
  opacity: 0.5,
  life: 1,
  speed: 1,
  spread: 0.1,
  drag: 1,
  rise: 1,
  size0: 1,
  size1: 2,
})
const albedo = puffs.material.uniforms.uColour.value

/* ---------------------------------------------------------------- *
 * 7. Allocation of what runs every frame
 * ---------------------------------------------------------------- */

const control = await knownAllocation()
// On the ground, with the camera's height wobbling as it does in the scene,
// so the sample arrays are rewritten on every call.
const wobble = new Float64Array(64)
for (let i = 0; i < 64; i++) wobble[i] = 1 + (1.75 + Math.sin(i) * 0.8) / Re
const cursor = new Int32Array(1)
standAt(EYE, 38)
const onGround = await bytesPerCall(() => {
  u.uCamToPlanet.value.y = wobble[cursor[0]++ & 63]
  A.stretchAtmosphere(mat)
  measureSky(mat)
})
standAt(185e3, 38)
const inOrbit = await bytesPerCall(() => {
  A.stretchAtmosphere(mat)
  measureSky(mat)
})

/*
 * And the line that hands a number to the GPU, which is where the allocation
 * the first run of this gate found actually was: 16 bytes a uniform, every
 * frame, in every material that animates. The control is the construction all
 * of them used — a `{ value }` literal — which has to be seen allocating, or a
 * zero below means nothing.
 */
const numbers = new Float64Array(64)
for (let i = 0; i < 64; i++) numbers[i] = 0.1 + i * 0.37
const literal = new ShaderMaterial({ uniforms: { uX: { value: 0.5 } } })
const literalWrite = await bytesPerCall(() => {
  literal.uniforms.uX.value = numbers[cursor[0]++ & 63]
})
const sunView = new Vector3(0, 1, 0)
const padWrite = await bytesPerCall(() => {
  const i = cursor[0]++ & 63
  aimPadParticles(puffs.material, numbers[i], numbers[(i + 1) & 63], sunView, numbers[(i + 2) & 63], numbers[(i + 3) & 63])
})
const plume = makePlumeMaterial()
const plumeWrite = await bytesPerCall(() => {
  const i = cursor[0]++ & 63
  const p = plume.uniforms
  p.uTanAngle.value = numbers[i]
  p.uDiamonds.value = numbers[(i + 1) & 63]
  p.uLength.value = numbers[(i + 2) & 63]
  p.uExitRadius.value = numbers[(i + 3) & 63]
  p.uThrottle.value = numbers[(i + 4) & 63]
})
const sunMat = makeSunMaterial()
const sunWrite = await bytesPerCall(() => {
  sunMat.uniforms.uTime.value = numbers[cursor[0]++ & 63]
})

/* ---------------------------------------------------------------- *
 * Report
 * ---------------------------------------------------------------- */

const f3 = (v) => v.map((x) => x.toExponential(2)).join(', ')
console.log('\n=== the stretch ===')
console.log(`  at eye height: ${groundX.toFixed(6)}x, march top ${groundTopKm.toFixed(3)} km, near ${groundNear.toFixed(9)}`)
console.log(`  first sample up a zenith ray: ${firstSampleWarped.toFixed(1)} m, against ${firstSampleEven.toFixed(0)} m evenly spaced`)
console.log(`  0 to 100 km: monotone ${monotone}, largest step per 500 m ${biggestStep.toFixed(4)}`)
console.log(`  from 100 km out: uniforms identical ${spaceIdentical}, samples evenly spaced ${spaceEven}`)
console.log('\n=== the sky from the ground, Sun 38 degrees up ===')
console.log(`  zenith now:     ${f3(nowZenith)}   (${hue(nowZenith)})`)
console.log(`  zenith before:  ${f3(oldZenith)}   (${hue(oldZenith)})`)
console.log(`  5 deg up, away from the Sun, now:    (${hue(nowLow)})`)
console.log(`  5 deg up, away from the Sun, before: (${hue(oldLow)})`)
console.log(`  against a 3000 x 600 march: worst ${(worstHigh * 100).toFixed(1)}% above 15 deg (evenly spaced ${(worstEvenHigh * 100).toFixed(1)}%), ${(worstLow * 100).toFixed(1)}% nearer the horizon`)
console.log('\n=== what the sky hides ===')
console.log(`  day:   zenith ${day.zenith.toExponential(2)} cd/m2, ${day.brightness.toFixed(2)} mag/arcsec2, faintest visible ${day.limitMagnitude.toFixed(2)}, Milky Way ${day.milkyWay.toFixed(2)}`)
console.log(`  night: zenith ${night.zenith.toExponential(2)} cd/m2, ${night.brightness.toFixed(2)} mag/arcsec2, faintest visible ${night.limitMagnitude.toFixed(2)}, Milky Way ${night.milkyWay.toFixed(2)}`)
console.log(`  Sun from 30 to -18 deg, faintest visible: ${dusk.map((m) => m.toFixed(1)).join(' ')}`)
console.log(`  across the real top: ${below.toFixed(3)} at 99.9 km, ${above.toFixed(3)} at 100.1 km`)
console.log('\n=== the vehicle ===')
console.log(`  every nose axis onto +Z to ${worstNose.toExponential(1)}; saturn_v ${noseOf('saturn_v')}, apollo_csm ${noseOf('apollo_csm')}`)
console.log(
  saturn
    ? `  Saturn V file, turned: ${saturn.size.map((x) => x.toFixed(2)).join(' x ')}, ${saturn.nose.toFixed(2)} from the axis in the nose tenth and ${saturn.tail.toFixed(2)} in the tail`
    : '  Saturn V file not present — the catalogue is fetched after the gates in CI — so it was not re-measured',
)
console.log(`  Apollo 8's CSM stage is drawn from ${csm?.model === null ? 'its own sections' : `the model "${csm?.model}"`}`)
console.log('\n=== the pad ===')
console.log(`  mirrored ${mirrored}, particles double-sided ${puffs.material.side === DoubleSide}, albedo ${albedo.r}, ${albedo.g}, ${albedo.b}`)
console.log(`\n=== allocation ===\n  stretch and sky, on the ground: ${sampleText(onGround)}\n  stretch and sky, in orbit: ${sampleText(inOrbit)}`)
console.log(`  a uniform built as a { value } literal, written: ${sampleText(literalWrite)}`)
console.log(`  the pad particles aimed, as PadEffects aims them: ${sampleText(padWrite)}`)
console.log(`  the plume's five uniforms written: ${sampleText(plumeWrite)}`)
console.log(`  the Sun's clock written: ${sampleText(sunWrite)}`)

console.log('\n=== what this establishes ===')
const checks = [
  // The stretch.
  ['on the ground the atmosphere is drawn at its true thickness', Math.abs(groundX - 1) < 1e-6 && Math.abs(groundTopKm - 100) < 0.01],
  ['and sampled from the eye outward, the first sample inside the lowest tenth of a scale height', firstSampleWarped < 800 && firstSampleEven > 800],
  ['easing to the exaggerated one without a step on the way up', monotone && biggestStep < 0.05],
  ['from 100 km out, every uniform is bit-for-bit what it was', spaceIdentical],
  ['and the samples are spaced as they always were', spaceEven],
  // The colour.
  ['the zenith from the ground is blue', nowZenith[2] > nowZenith[1] && nowZenith[1] > nowZenith[0]],
  ['and so is the low sky away from the Sun', nowLow[2] >= nowLow[0]],
  ['which, drawn the old way, was orange', oldLow[0] > oldLow[2]],
  ['bunching the samples beats spacing them evenly in every direction', alwaysBetter],
  ['and fourteen of them hold the sky above 15 degrees to within a tenth', worstHigh < 0.1],
  // What it hides.
  ['in daylight not one catalogue star is left', day.limitMagnitude < SIRIUS],
  ['nor any planet', day.limitMagnitude < VENUS],
  ['nor the Milky Way', day.milkyWay < 1e-6],
  ['at night the naked-eye sky, and the galaxy back', night.limitMagnitude > 6 && night.limitMagnitude < 7 && night.milkyWay === 1],
  ['the sky only ever darkens as the Sun goes down', darkening],
  ['from orbit every star is where it was', orbitShowsAll],
  ['and passing the real top shows nothing appearing all at once', Math.abs(below - above) < 0.1],
  // The vehicle.
  ['every model axis the craft may name is turned onto the nose', worstNose < 1e-12],
  ['the Saturn V file stands with its escape tower up', saturn === null || (saturn.size[2] > saturn.size[0] * 4 && saturn.nose < saturn.tail / 4)],
  ["and Apollo 8 does not fly a Soyuz on its nose", csm?.model === null],
  // The pad.
  ['the pad is carried into the scene by a mirror', mirrored],
  ['so the particles are drawn from both sides, or the mirror culls them', puffs.material.side === DoubleSide],
  ['and a puff is no brighter than a white surface in the same light', albedo.r <= 1 && albedo.g <= 1 && albedo.b <= 1],
  // Cost.
  seesAllocation('the allocation measurement can see an allocation', control),
  allocatesNothing('the sky allocates nothing on the ground', onGround, SMALLEST_OBJECT / 2),
  allocatesNothing('nor in orbit', inOrbit, SMALLEST_OBJECT / 2),
  ['a { value } literal uniform allocates when written — the cause, seen', literalWrite.measured && literalWrite.bytes >= SMALLEST_OBJECT],
  allocatesNothing('the pad particles are aimed without allocating', padWrite, SMALLEST_OBJECT / 2),
  allocatesNothing("the plume's uniforms are written without allocating", plumeWrite, SMALLEST_OBJECT / 2),
  allocatesNothing("and so is the Sun's clock", sunWrite, SMALLEST_OBJECT / 2),
]
let pass = true
for (const [label, ok] of checks) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`)
  if (!ok) pass = false
}
console.log(`\n  ${pass ? 'PASS' : 'FAIL'}`)
process.exit(pass ? 0 : 1)
