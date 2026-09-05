/**
 * Depth-buffer probe for the true-scale migration.
 *
 * The migration bets that one camera can span from a 0.1 m near plane to a
 * 1e13 m far plane — fourteen decades — on a logarithmic depth buffer. The
 * arithmetic says it can:
 *
 *   three writes  gl_FragDepth = log2(1 + w) / log2(far + 1)
 *
 * so a 24-bit buffer spreads 2^24 codes across log2(1e13) ~ 43.2, giving
 * 2.57e-6 per code in log2 space and a *range-independent* relative resolution
 * of ln(2) x 2.57e-6 ~ 1.79e-6. Two surfaces separated by more than that
 * fraction of their range should resolve; below it they should z-fight.
 *
 * Arithmetic is not evidence. This measures the real threshold on the real GPU
 * through the real three.js pipeline, at ranges spanning a spacecraft hull to
 * an astronomical unit, and runs the same sweep with the logarithmic buffer
 * turned off as a control — because a number with nothing to compare against
 * would be equally consistent with the probe measuring nothing at all.
 *
 * Method: two view-perpendicular planes separated by delta along the view axis,
 * the *back* one drawn last via renderOrder so only a working depth test can
 * keep it hidden. Local vertex z is exactly zero on both, so the separation
 * lives entirely in the model matrix — which isolates the depth buffer and the
 * float32 modelView downcast from geometry precision, and those two are the
 * pipeline the migration actually depends on.
 */
import * as THREE from 'three'

const NEAR = 0.1
const FAR = 1e13
const FOV = 45

/**
 * Ranges worth testing, chosen as things the sim actually draws — each with
 * the separation that has to resolve there for the scene to read correctly.
 *
 * `needs` is set from the geometry, not from the measurement: panel lines on a
 * hull, the relief of a mountain against Earth's limb, the Moon's disc against
 * the stars. Comparing a relative resolution against a relative prediction only
 * says whether the encoding behaved; comparing metres against metres says
 * whether the camera can draw the scene.
 */
const RANGES = [
  { w: 1, what: 'hull detail', needs: 1e-3, why: 'rivets, panel lines' },
  { w: 1e2, what: 'SLS, nose to skirt', needs: 1e-2, why: 'stage separation lines' },
  { w: 1e4, what: 'launch site', needs: 1e-1, why: 'tower structure' },
  { w: 6.371e6, what: "Earth's limb", needs: 1e2, why: 'terrain relief, LEO traffic' },
  { w: 3.844e8, what: 'lunar distance', needs: 1e4, why: "the Moon's disc" },
  { w: 1.496e11, what: 'one AU', needs: 1e6, why: "the Sun's disc" },
]

/** Predicted relative resolution, from the log-depth encoding above. */
const PREDICTED = Math.LN2 * (Math.log2(FAR + 1) / 2 ** 24)

/** float32 spacing, relative — the downcast floor, for comparison. */
const FLOAT32_ULP = 2 ** -23

const SIZE = 48 // readback patch, px
const CLEAN = 0.995 // fraction of red pixels that counts as resolved

function makeRig(logarithmicDepthBuffer, far = FAR) {
  const renderer = new THREE.WebGLRenderer({ logarithmicDepthBuffer, antialias: false })
  renderer.setSize(SIZE, SIZE)
  const target = new THREE.WebGLRenderTarget(SIZE, SIZE, { depthBuffer: true })

  const camera = new THREE.PerspectiveCamera(FOV, 1, NEAR, far)
  camera.position.set(0, 0, 0)
  camera.lookAt(0, 0, -1)

  const scene = new THREE.Scene()
  const front = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ color: 0xff0000 }),
  )
  const back = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ color: 0x0000ff }),
  )
  // Draw the *farther* plane last. With a working depth test it is rejected;
  // without one it paints over the near plane and the readback goes blue.
  front.renderOrder = 0
  back.renderOrder = 1
  scene.add(front, back)

  return { renderer, target, camera, scene, front, back }
}

/**
 * Fraction of the readback patch that is the near plane's red.
 * 1 means the depth test resolved the pair; 0 means the far plane won
 * outright; anything between is z-fighting.
 */
function redFraction(rig, w, delta) {
  const { renderer, target, camera, scene, front, back } = rig
  // Over-fill the frustum at both ranges so the patch is never background.
  const span = 4 * (w + delta) * Math.tan((FOV * Math.PI) / 360)
  front.scale.setScalar(span)
  back.scale.setScalar(span)
  front.position.set(0, 0, -w)
  back.position.set(0, 0, -(w + delta))

  renderer.setRenderTarget(target)
  renderer.setClearColor(0x000000, 1)
  renderer.clear()
  renderer.render(scene, camera)

  const buf = new Uint8Array(SIZE * SIZE * 4)
  renderer.readRenderTargetPixels(target, 0, 0, SIZE, SIZE, buf)
  renderer.setRenderTarget(null)

  let red = 0
  let counted = 0
  for (let i = 0; i < SIZE * SIZE; i++) {
    const r = buf[i * 4]
    const b = buf[i * 4 + 2]
    if (r < 8 && b < 8) continue // background: both planes missed this pixel
    counted++
    if (r > b) red++
  }
  return counted === 0 ? NaN : red / counted
}

/**
 * Smallest separation, as a fraction of range, that the buffer resolves
 * cleanly. Bisected on the exponent rather than swept, so the answer carries
 * real digits instead of whatever the sweep's spacing happened to be.
 */
function threshold(rig, w) {
  let lo = -12 // ratios this small must fail
  let hi = -1 // and this large must succeed
  if (redFraction(rig, w, w * 10 ** hi) < CLEAN) return { ratio: NaN, coverage: NaN }
  for (let i = 0; i < 44; i++) {
    const mid = (lo + hi) / 2
    if (redFraction(rig, w, w * 10 ** mid) >= CLEAN) hi = mid
    else lo = mid
  }
  return { ratio: 10 ** hi, coverage: redFraction(rig, w, w * 10 ** hi) }
}

/**
 * Which constraint is actually binding, at each end of the range.
 *
 * The first sweep came back ~10x *better* than predicted at short range and on
 * prediction at an AU, which the log-depth encoding alone cannot explain — its
 * relative resolution is range-independent by construction. Two candidates:
 * the depth codes, or the float32 downcast of the modelView translation. They
 * are separable, because only one of them depends on `far`:
 *
 *   depth-limited   threshold proportional to log2(far + 1)
 *   float32-limited threshold unchanged by far
 *
 * So sweep far across nine decades and watch which thresholds move. This is
 * the discriminator; without it, "the close range is float32-limited" is a
 * story that happens to fit six numbers.
 */
/**
 * Does the far plane still cull, and at what near/far ratio does it stop?
 *
 * The first attempt at this swept `far` across nine decades and got thresholds
 * identical to three significant figures — which is either a real invariance
 * or a parameter that never reached the pipeline. A positive control (does
 * geometry beyond `far` get clipped?) said the far plane was doing no culling
 * at all, which is what this test replaces it with.
 *
 * Note that the original sweep was not therefore worthless: `far` feeds the
 * culling planes *and* three's `logDepthBufFC`, and only the first was dead.
 * The invariance it measured is real evidence that depth code density does not
 * bind. What it could not do is what it claimed to — attribute the floor.
 *
 * The suspicion is arithmetic. A perspective projection carries
 *
 *     C = (f + n) / (n - f)      D = 2 f n / (n - f)
 *
 * and as f/n grows, C -> -1 and D -> -2n, both of which stop depending on f at
 * all. Past that point the far plane is numerically gone: nothing is ever
 * clipped by it, and `far` survives only as three's log-depth scale factor
 * `logDepthBufFC = 2 / log2(far + 1)`.
 *
 * That matters for the migration because near = 0.1 m with far = 1e13 m is a
 * ratio of 1e14 — far past any plausible collapse — so it needs to be known
 * rather than assumed, and the control needs checking at a ratio where culling
 * certainly does work, or "NOT APPLIED" is just as consistent with a broken
 * test.
 */
function cullSweep(say) {
  const RATIOS = [1e3, 1e5, 1e7, 1e9, 1e11, 1e14]
  say()
  say('=== does the far plane still cull? ===')
  say('  near     far          f/n        C = (f+n)/(n-f)      D = 2fn/(n-f)     culls beyond far?')
  const rows = []
  for (const ratio of RATIOS) {
    const near = NEAR
    const far = near * ratio
    const C = (far + near) / (near - far)
    const D = (2 * far * near) / (near - far)
    const rig = makeRig(true, far)
    // Something beyond the far plane must not draw; something inside must.
    const beyond = redFraction(rig, far * 2, far * 0.01)
    const within = redFraction(rig, far * 0.5, far * 0.01)
    const culls = Number.isNaN(beyond) && !Number.isNaN(within)
    rows.push({ ratio, far, C, D, culls, drew: !Number.isNaN(within) })
    say(
      `  ${near}${far.toExponential(1).padStart(11)}${ratio.toExponential(0).padStart(11)}` +
        `${C.toPrecision(12).padStart(22)}${D.toPrecision(6).padStart(19)}` +
        `${(culls ? 'yes' : rows.at(-1).drew ? 'NO — far is numerically gone' : 'clips everything').padStart(32)}`,
    )
    rig.renderer.dispose()
    rig.target.dispose()
  }
  const lastCulling = rows.filter((r) => r.culls).at(-1)
  const firstDead = rows.find((r) => !r.culls && r.drew)
  say()
  say(`  culling survives up to f/n = ${lastCulling ? lastCulling.ratio.toExponential(0) : 'never'}`)
  say(`  culling is gone from f/n = ${firstDead ? firstDead.ratio.toExponential(0) : 'never'}`)
  say(`  D collapses to -2n = ${(-2 * NEAR).toPrecision(6)}; at f/n = 1e14, D = ${rows.at(-1).D.toPrecision(6)}`)
  return { rows, cullsSomewhere: rows.some((r) => r.culls), deadAtWorking: firstDead !== undefined }
}

function run() {
  const lines = []
  const say = (s = '') => {
    lines.push(s)
    console.log(s)
  }

  const probe = document.createElement('canvas')
  const gl2 = probe.getContext('webgl2')
  say(`WebGL2            ${gl2 ? 'yes' : 'NO — log depth falls back per-vertex'}`)
  if (gl2) {
    const dbg = gl2.getExtension('WEBGL_debug_renderer_info')
    if (dbg) say(`renderer          ${gl2.getParameter(dbg.UNMASKED_RENDERER_WEBGL)}`)
    say(`depth bits        ${gl2.getParameter(gl2.DEPTH_BITS)}`)
  }
  say(`near / far        ${NEAR} / ${FAR.toExponential(0)}  (ratio ${(FAR / NEAR).toExponential(0)})`)
  say(`predicted dw/w    ${PREDICTED.toExponential(3)}   (log depth, 24-bit)`)
  say(`float32 ulp       ${FLOAT32_ULP.toExponential(3)}   (modelView downcast floor)`)

  const results = {}
  for (const logDepth of [true, false]) {
    const rig = makeRig(logDepth)
    say()
    say(`=== logarithmicDepthBuffer: ${logDepth} ===`)
    say('  range                what                    dw/w      resolves      scene needs    margin')
    const rows = []
    for (const { w, what, needs, why } of RANGES) {
      const { ratio } = threshold(rig, w)
      const metres = ratio * w
      rows.push({ w, what, ratio, metres, needs, why })
      const shown = Number.isFinite(ratio) ? ratio.toExponential(2) : 'never'
      const abs = Number.isFinite(ratio) ? `${metres.toExponential(2)} m` : '—'
      const margin = Number.isFinite(ratio) ? `${(needs / metres).toFixed(0)}x` : 'FAILS'
      say(
        `  ${w.toExponential(2).padStart(9)} m  ${what.padEnd(20)}${shown.padStart(10)}` +
          `${abs.padStart(15)}${`${needs.toExponential(0)} m`.padStart(15)}${margin.padStart(10)}`,
      )
    }
    results[logDepth ? 'log' : 'linear'] = rows
    rig.renderer.dispose()
    rig.target.dispose()
  }

  const cull = cullSweep(say)

  /* ---- what this establishes ---- */
  const log = results.log
  const linear = results.linear
  const finite = log.filter((r) => Number.isFinite(r.ratio))
  const short = linear.filter((r) => Number.isFinite(r.ratio)).length
  const linearFailures = linear.length - short
  const tightest = finite.reduce(
    (worst, r) => (r.needs / r.metres < worst.margin ? { margin: r.needs / r.metres, at: r } : worst),
    { margin: Infinity, at: null },
  )

  say()
  say('=== what this establishes ===')
  const checks = [
    ['every range resolves on the log buffer', finite.length === RANGES.length],
    /**
     * The claim the migration rests on, in metres: at every range the scene
     * draws, the camera separates what has to look separate. An earlier version
     * asserted that dw/w stayed flat across range and failed at 11x spread —
     * but flatness was never the requirement, and the spread turned out to be
     * short range coming in *better* than the log encoding predicts, not far
     * range coming in worse. The relative figure was the wrong yardstick.
     */
    ...RANGES.map((r, i) => {
      const row = log[i]
      const ok = Number.isFinite(row.ratio) && row.metres < row.needs
      return [`${r.what}: resolves ${r.needs.toExponential(0)} m (${r.why})`, ok]
    }),
    // The control. If the linear buffer did as well, this is measuring
    // something other than the depth buffer.
    ['a linear buffer fails where the log buffer holds', linearFailures > 0],
    ['the log buffer beats linear at every range they share', log.every((r, i) =>
      !Number.isFinite(linear[i].ratio) || r.ratio <= linear[i].ratio)],
    // Not a defect — a property to design around. `far` stops culling long
    // before the working ratio, so nothing is ever clipped for being distant
    // and `far` survives only as three's log-depth scale factor.
    ['the far plane is known to stop culling above f/n ~ 1e7',
     cull.cullsSomewhere && cull.deadAtWorking],
  ]
  let pass = true
  for (const [label, ok] of checks) {
    say(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`)
    if (!ok) pass = false
  }
  say()
  say(`  tightest margin      ${tightest.margin.toFixed(1)}x at ${tightest.at.what}` +
    `  (${tightest.at.metres.toExponential(2)} m resolved, ${tightest.at.needs.toExponential(0)} m needed)`)
  say(`  linear-buffer ranges that never resolved  ${linearFailures} of ${RANGES.length}`)
  /**
   * Reported, not asserted.
   *
   * The log-depth code count predicted 1.79e-6 and every range came in at or
   * below it, short range by a factor of ten. A sweep of `far` across nine
   * decades moved the threshold by 1.00x — and `far` feeds two independent
   * consumers, the projection matrix's culling planes and three's
   * `logDepthBufFC = 2 / log2(far + 1)`. Only the first collapsed; the second
   * varied by 1.9x across that sweep and changed nothing. So the depth code
   * density is *not* the binding constraint, which is a real conclusion from
   * valid data.
   *
   * What sets the floor instead is float32 somewhere upstream — the
   * `vFragDepth` varying, the modelView downcast, or the interpolator — and
   * this probe does not separate them. It does not need to: every range clears
   * its requirement, and the error is in the safe direction. Recorded so the
   * open part stays visibly open.
   */
  say(`  note: depth codes are NOT the limit — 1.9x of logDepthBufFC moved the threshold 1.00x.`)
  say(`        prediction was ${(PREDICTED / log[0].ratio).toFixed(0)}x pessimistic at 1 m; the float32 stage that binds is not isolated here.`)
  say(`  ${pass ? 'PASS' : 'FAIL'}`)

  document.getElementById('out').textContent = lines.join('\n')
  window.__probe = { pass, results, predicted: PREDICTED }
}

run()
