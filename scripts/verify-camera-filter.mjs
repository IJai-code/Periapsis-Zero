/**
 * Replay recorded attitude through both camera filters and measure the damage.
 *
 * The claim under test is that a fixed-rate exponential lag whips or falls behind
 * during the capture flip and the entry bank reversals, and that a critically
 * damped spring does better. Neither half of that is obvious, and both have been
 * asserted in conversation without a number attached.
 *
 * What is measured, per phase:
 *
 *   framing error   the angle, at the craft, between where the camera actually
 *                   sits and where the body-frame offset says it should — this
 *                   is what a viewer perceives as the vehicle sliding off-axis
 *   position error  the same thing in hull lengths, which is what decides
 *                   whether the existing snap threshold fires
 *   lag             the frame offset that best aligns the filtered track with
 *                   the desired one, found by minimising RMS over shifts
 *
 * Lag is reported separately from error on purpose. A filter can have large
 * error because it is *behind* — which reads as smooth and slightly delayed — or
 * because it is *swinging*, which reads as a whip. The two feel completely
 * different and a single error number cannot tell them apart.
 *
 *   node scripts/verify-camera-filter.mjs <attitude.json>
 */

import { readFileSync } from 'node:fs'
import { Quaternion, Vector3 } from 'three'
import { expFollow, omegaForSettling, rateForSettling, springFollow } from '../src/gfx/follow.js'
import { SHIP_VISUAL_LENGTH } from '../src/sim/scale.js'

const path = process.argv[2]
if (!path) {
  console.error('usage: node scripts/verify-camera-filter.mjs <attitude.json>')
  process.exit(2)
}
const segments = JSON.parse(readFileSync(path, 'utf8'))

/** The rig's own chase geometry. */
const BACK = SHIP_VISUAL_LENGTH * 4.2
const UP = SHIP_VISUAL_LENGTH * 1.3

/**
 * Matched aggression, so the comparison is of *filter shape* and not of tuning.
 *
 * The rig ships a rate-6 exponential, which reaches 98% in 4/6 = 0.667 s. Both
 * filters are given that same settling time; otherwise a stiffer spring would
 * "win" for reasons having nothing to do with carrying a velocity.
 */
const SETTLE = 4 / 6
const RATE = rateForSettling(SETTLE)
const OMEGA = omegaForSettling(SETTLE)

const q = new Quaternion()
const pos = new Vector3()
const back = new Vector3()
const up = new Vector3()
const desired = new Vector3()
const cam = new Vector3()
const vel = new Vector3()
const tmp = new Vector3()
const camUp = new Vector3()
const camUpVel = new Vector3()
const wantUp = new Vector3()

/** The craft's own up axis at sample i — what the camera's up should match. */
function upAt(seg, i, out) {
  q.set(seg.q[i * 4], seg.q[i * 4 + 1], seg.q[i * 4 + 2], seg.q[i * 4 + 3])
  return out.set(0, 1, 0).applyQuaternion(q)
}

/** Rebuild the desired chase point for sample i, exactly as the rig does. */
function desiredAt(seg, i, out) {
  q.set(seg.q[i * 4], seg.q[i * 4 + 1], seg.q[i * 4 + 2], seg.q[i * 4 + 3])
  pos.set(seg.p[i * 3], seg.p[i * 3 + 1], seg.p[i * 3 + 2])
  back.set(0, 0, -1).applyQuaternion(q)
  up.set(0, 1, 0).applyQuaternion(q)
  return out.copy(pos).addScaledVector(back, BACK).addScaledVector(up, UP)
}

/**
 * Run a filter over a segment. Returns the track and the per-frame errors.
 * `snap` reproduces the rig's existing escape hatch so the comparison is against
 * what actually ships, not an idealised version of it.
 */
function run(seg, kind, omega = OMEGA, rate = RATE) {
  const n = seg.dt.length
  const track = new Float64Array(n * 3)
  const framing = new Float64Array(n)
  const posErr = new Float64Array(n)
  const rollErr = new Float64Array(n)
  vel.set(0, 0, 0)
  camUpVel.set(0, 0, 0)

  desiredAt(seg, 0, desired)
  cam.copy(desired)
  upAt(seg, 0, wantUp)
  camUp.copy(wantUp)

  for (let i = 0; i < n; i++) {
    desiredAt(seg, i, desired)
    upAt(seg, i, wantUp)
    const dt = Math.max(seg.dt[i], 1e-6)

    if (i > 0) {
      /**
       * The roll channel, which the position metric cannot see.
       *
       * The rig filters `camera.up` separately and at a *slower* rate than
       * position — 4 against 6 — so during an entry bank reversal at 0.35 rad/s
       * the horizon can lag well behind the hull even while the vehicle stays
       * perfectly centred in frame. That is a different artefact from a whip and
       * it is the one a viewer would actually notice.
       */
      if (kind === 'exp') expFollow(camUp, camUp, wantUp, rate * (4 / 6), dt)
      else springFollow(camUp, camUp, wantUp, camUpVel, omega * (4 / 6), dt)
      camUp.normalize()
      const cu = Math.min(1, Math.max(-1, camUp.dot(wantUp)))
      rollErr[i] = Math.acos(cu)

      if (kind === 'exp') expFollow(cam, cam, desired, rate, dt)
      else springFollow(cam, cam, desired, vel, omega, dt)

      // The rig snaps when it has fallen far enough behind. Keep it, or the
      // comparison flatters whichever filter lags more.
      if (cam.distanceTo(desired) > SHIP_VISUAL_LENGTH * 12) {
        cam.copy(desired)
        vel.set(0, 0, 0)
      }
    }

    track[i * 3] = cam.x
    track[i * 3 + 1] = cam.y
    track[i * 3 + 2] = cam.z

    // Framing error: the angle at the craft between actual and desired camera.
    pos.set(seg.p[i * 3], seg.p[i * 3 + 1], seg.p[i * 3 + 2])
    tmp.copy(cam).sub(pos)
    desired.sub(pos)
    const a = tmp.length()
    const b = desired.length()
    framing[i] = a > 1e-12 && b > 1e-12 ? Math.acos(Math.min(1, Math.max(-1, tmp.dot(desired) / (a * b)))) : 0
    posErr[i] = tmp.distanceTo(desired)
  }
  return { track, framing, posErr, rollErr, n }
}

/** Frame offset that best aligns a track with the desired one. */
function bestLag(seg, track, maxShift = 90) {
  const n = seg.dt.length
  let best = 0
  let bestRms = Infinity
  for (let s = 0; s <= maxShift; s++) {
    let acc = 0
    let count = 0
    for (let i = s; i < n; i += 7) {
      desiredAt(seg, i - s, desired)
      const dx = track[i * 3] - desired.x
      const dy = track[i * 3 + 1] - desired.y
      const dz = track[i * 3 + 2] - desired.z
      acc += dx * dx + dy * dy + dz * dz
      count++
    }
    const rms = Math.sqrt(acc / Math.max(count, 1))
    if (rms < bestRms) {
      bestRms = rms
      best = s
    }
  }
  return best
}

const DEG = 180 / Math.PI
console.log(`=== matched aggression: settling ${SETTLE.toFixed(3)} s  (exp rate ${RATE.toFixed(2)}, spring omega ${OMEGA.toFixed(2)}) ===`)
console.log('\n                    peak framing   peak ROLL err   rms roll    peak pos     lag')
console.log('  phase        filter     deg            deg           deg        hull len   frames')

const results = {}
for (const [name, seg] of Object.entries(segments)) {
  if (seg.dt.length < 50) continue
  results[name] = {}
  for (const kind of ['exp', 'spring']) {
    const r = run(seg, kind)
    let peak = 0
    let acc = 0
    let peakPos = 0
    let peakRoll = 0
    let rollAcc = 0
    for (let i = 0; i < r.n; i++) {
      if (r.framing[i] > peak) peak = r.framing[i]
      acc += r.framing[i] * r.framing[i]
      if (r.posErr[i] > peakPos) peakPos = r.posErr[i]
      if (r.rollErr[i] > peakRoll) peakRoll = r.rollErr[i]
      rollAcc += r.rollErr[i] * r.rollErr[i]
    }
    const rms = Math.sqrt(acc / r.n)
    const rmsRoll = Math.sqrt(rollAcc / r.n)
    const lag = bestLag(seg, r.track)
    results[name][kind] = { peak, rms, peakPos, lag, peakRoll, rmsRoll }
    console.log(
      `  ${(kind === 'exp' ? name : '').padEnd(13)}${kind.padEnd(7)}` +
        `${(peak * DEG).toFixed(2).padStart(10)}` +
        `${(peakRoll * DEG).toFixed(2).padStart(15)}` +
        `${(rmsRoll * DEG).toFixed(2).padStart(12)}` +
        `${(peakPos / SHIP_VISUAL_LENGTH).toFixed(2).padStart(12)}` +
        `${String(lag).padStart(9)}`,
    )
  }
}

console.log('\n=== what changed ===')
let anyBetter = false
let anyWorse = false
for (const [name, r] of Object.entries(results)) {
  const dPeak = ((r.spring.peak - r.exp.peak) / Math.max(r.exp.peak, 1e-12)) * 100
  const dRms = ((r.spring.rms - r.exp.rms) / Math.max(r.exp.rms, 1e-12)) * 100
  console.log(
    `  ${name.padEnd(14)} peak ${dPeak > 0 ? '+' : ''}${dPeak.toFixed(1)}%` +
      `   rms ${dRms > 0 ? '+' : ''}${dRms.toFixed(1)}%` +
      `   lag ${r.exp.lag} -> ${r.spring.lag} frames`,
  )
  const dRoll = ((r.spring.peakRoll - r.exp.peakRoll) / Math.max(r.exp.peakRoll, 1e-12)) * 100
  console.log(`  ${' '.repeat(14)} peak roll ${dRoll > 0 ? '+' : ''}${dRoll.toFixed(1)}%`)
  if (dPeak < -5) anyBetter = true
  if (dPeak > 5) anyWorse = true
}

/**
 * Sweep the spring's stiffness, so "no tuning helps" is measured rather than
 * assumed. The comparison above uses one settling-time convention, and a
 * critically damped spring is genuinely slower to settle than a first-order lag
 * at the same nominal figure — so the +35% is partly that convention. This asks
 * the question the convention cannot: is there *any* omega that beats the
 * shipping filter on the worst phase?
 */
const worstPhase = 'RE_ENTRY'
if (segments[worstPhase]) {
  const seg = segments[worstPhase]
  const base = run(seg, 'exp')
  let basePeak = 0
  for (let i = 0; i < base.n; i++) if (base.framing[i] > basePeak) basePeak = base.framing[i]

  console.log(`\n=== spring stiffness sweep on ${worstPhase} (exp baseline ${(basePeak * DEG).toFixed(2)} deg) ===`)
  console.log('   omega   settling s   peak framing deg   vs exp')
  let bestSpring = Infinity
  for (const om of [4.5, 9, 18, 36, 72, 144]) {
    const r = run(seg, 'spring', om)
    let peak = 0
    for (let i = 0; i < r.n; i++) if (r.framing[i] > peak) peak = r.framing[i]
    if (peak < bestSpring) bestSpring = peak
    const rel = ((peak - basePeak) / basePeak) * 100
    console.log(
      `  ${om.toFixed(1).padStart(6)}${(6 / om).toFixed(3).padStart(13)}` +
        `${(peak * DEG).toFixed(3).padStart(19)}` +
        `${(rel > 0 ? '+' : '') + rel.toFixed(1)}%`.padStart(11),
    )
  }
  console.log(`  a stiffer spring converges on the exponential's answer, as it must:`)
  console.log('  both tend to "track the target exactly" as their time constant goes to zero.')
}

console.log('\n=== what this establishes ===')
/**
 * The conclusion is the opposite of the one this script was written to confirm,
 * so the checks assert what was actually found: the shipping filter is adequate,
 * with the margin quoted. Leaving in a "the spring is better" check that fails
 * would be recording a wish.
 */
const worstFraming = Math.max(...Object.values(results).map((r) => r.exp.peak)) * DEG
const worstRoll = Math.max(...Object.values(results).map((r) => r.exp.peakRoll)) * DEG
const worstPos = Math.max(...Object.values(results).map((r) => r.exp.peakPos)) / SHIP_VISUAL_LENGTH
const checks = [
  ['both filters ran over every recorded phase', Object.keys(results).length >= 3],
  ['the shipping filter holds framing under 3 deg everywhere', worstFraming < 3],
  ['the shipping filter holds roll under 3 deg everywhere', worstRoll < 3],
  ['position error never approaches the 12 hull-length snap threshold', worstPos < 1],
  ['the snap therefore never fires in normal flight', worstPos < 12],
]
let pass = true
for (const [label, ok] of checks) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`)
  if (!ok) pass = false
}
console.log(`\n  worst framing ${worstFraming.toFixed(2)} deg, worst roll ${worstRoll.toFixed(2)} deg,` +
  ` worst position ${worstPos.toFixed(2)} hull lengths`)
console.log(`  spring better anywhere: ${anyBetter}; worse somewhere: ${anyWorse}`)
console.log(`  ${pass ? 'PASS' : 'FAIL'}`)
process.exit(pass ? 0 : 1)
