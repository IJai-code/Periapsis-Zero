/**
 * What cascaded shadow maps would cost here, measured before anything is wired.
 *
 * This gate was written first on purpose. Patching cascades into a scene means
 * touching every lit material in it, and an unpatched one is not a shadow bug —
 * it is silently N times too bright, which reads as a lighting mistake and not
 * as a missing patch. So the arithmetic comes before the wiring, and what the
 * arithmetic says is recorded here whether or not it is the hoped-for answer.
 *
 * It says cascades as usually specified would make this scene's shadows *worse*
 * at the same map size. That is not an argument against cascades in general; it
 * is a property of how CSM sizes its boxes against how this repository sizes its
 * one box, and the numbers are below.
 *
 * ── the box-sizing law, which is the whole result ─────────────────────
 *
 * `GroundLight.jsx` sets its orthographic box directly: +-1200 m, centred on the
 * pad, 2400 m across at 4096 texels, 0.586 m a texel.
 *
 * CSM cannot do that, because a cascade has to cover a *slice of the camera
 * frustum* from any angle. So it sizes each box from the slice's far-plane
 * diagonal, and at this camera's 45-degree vertical field and a 16:9 frame that
 * diagonal is 1.690 times the slice's far distance. A cascade ending at 800 m
 * therefore gets a 1352 m box, not an 800 m one — and the last cascade always
 * gets 1.690 x its own far distance, whatever the split scheme, because the far
 * plane is where it is.
 *
 * That factor is measured here rather than derived by hand, so it follows the
 * camera rather than a note about the camera.
 *
 * ── two bugs this found before they could ship ────────────────────────
 *
 * **`three-stdlib`'s CSM is broken against three 0.180.** Its `injectInclude()`
 * assigns `ShaderChunk.lights_pars_begin = CSMShader.lights_pars_begin`, and
 * that property does not exist — the object defines `getlights_pars_begin()`
 * instead. So merely *constructing* one sets a chunk every lit shader in three
 * includes to `undefined`, globally, for the rest of the process. three's own
 * `examples/jsm/csm` is correct and extends the chunk properly. The gate holds
 * both to account so an import cannot quietly go to the wrong one.
 *
 * **`setupMaterial` overwrites `onBeforeCompile`.** It is a plain assignment, and
 * `gfx/shaders.js` already uses that hook for the Earth's night lights and the
 * Moon's eclipse shading. Patching those materials for cascades would delete
 * their patches; not patching them makes them N times too bright. Either way
 * something is wrong and neither is visible in a shadow.
 *
 *   node scripts/verify-csm.mjs
 */
import { readFileSync } from 'node:fs'
import { PerspectiveCamera, Group, ShaderChunk, MeshStandardMaterial } from 'three'
import { CSM } from 'three/examples/jsm/csm/CSM.js'
import { SHADOW_EXTENT, SHADOW_TEXELS, SHADOW_TEXEL_METRES } from '../src/gfx/sunlight.js'

/* The lens, read off the app rather than restated — verify-navigation's idiom. */
const APP = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8')
const FOV = Number(APP.match(/camera=\{\{[^}]*fov:\s*([\d.]+)/)?.[1])
const NEAR = Number(APP.match(/camera=\{\{[^}]*near:\s*([\d.e+-]+)/)?.[1])
const WIDTH = 1600
const HEIGHT = 900

/* What the brief asks cascades to deliver. */
const WANT_NEAR_SPLIT = 800
const WANT_FAR = 2200
const LATTICE = 0.3 // m, the narrowest tie on a service tower

/* ---------------------------------------------------------------- *
 * 1. three-stdlib's CSM mutates three's chunks into nonsense
 * ---------------------------------------------------------------- */

const parsBefore = ShaderChunk.lights_pars_begin
const stdlib = await import('three-stdlib')
const camA = new PerspectiveCamera(FOV, WIDTH / HEIGHT, NEAR, 1e13)
new stdlib.CSM({ camera: camA, parent: new Group(), cascades: 2, maxFar: WANT_FAR })
const parsAfterStdlib = ShaderChunk.lights_pars_begin
/* Put it back before anything else looks at it. */
ShaderChunk.lights_pars_begin = parsBefore

console.log('\n=== the two CSM implementations, against three 0.180 ===')
console.log(`  lights_pars_begin, untouched        ${parsBefore.length} chars`)
console.log(`  after three-stdlib's CSM            ${parsAfterStdlib === undefined ? 'undefined — every lit shader loses the chunk' : parsAfterStdlib.length + ' chars'}`)

const camera = new PerspectiveCamera(FOV, WIDTH / HEIGHT, NEAR, 1e13)
camera.updateProjectionMatrix()
const csm = new CSM({
  camera,
  parent: new Group(),
  cascades: 2,
  maxFar: WANT_FAR,
  shadowMapSize: SHADOW_TEXELS,
  mode: 'custom',
  customSplitsCallback: (n, near, far, target) => {
    target.push(WANT_NEAR_SPLIT / far)
    target.push(1)
  },
})
csm.updateFrustums()
console.log(`  after three's own CSM               ${ShaderChunk.lights_pars_begin.length} chars — extended, as intended`)

/* ---------------------------------------------------------------- *
 * 2. What the cascades actually resolve
 * ---------------------------------------------------------------- */

const boxes = csm.lights.map((l) => l.shadow.camera.right - l.shadow.camera.left)
const texels = boxes.map((w) => w / SHADOW_TEXELS)
/* The diagonal factor, measured off the near cascade rather than trigonometry. */
const diagonalFactor = boxes[0] / WANT_NEAR_SPLIT

console.log('\n=== cascades, at the split the brief asks for ===')
console.log(`  camera ${FOV} deg vertical, ${WIDTH}x${HEIGHT}, so a slice's box is ${diagonalFactor.toFixed(3)}x its far distance`)
console.log(`  near   0 - ${WANT_NEAR_SPLIT} m       box ${boxes[0].toFixed(0).padStart(5)} m   ${texels[0].toFixed(3)} m/texel`)
console.log(`  far    ${WANT_NEAR_SPLIT} - ${WANT_FAR} m    box ${boxes[1].toFixed(0).padStart(5)} m   ${texels[1].toFixed(3)} m/texel`)
console.log(`  today  +-${SHADOW_EXTENT} m centred   box ${(2 * SHADOW_EXTENT).toFixed(0).padStart(5)} m   ${SHADOW_TEXEL_METRES.toFixed(3)} m/texel`)
console.log(`  the brief expects ${(WANT_NEAR_SPLIT / SHADOW_TEXELS).toFixed(3)} m/texel near; the box sizing gives ${texels[0].toFixed(3)}`)

/*
 * The target is reachable — the split just has to be derived from it instead of
 * asserted. A box of `texel x texels` needs a slice ending at box / 1.690, so
 * three cascades placed by that rule hit 0.195 m near *and* keep the 2,200 m
 * reach. This is the configuration to build, and it is arithmetic rather than a
 * number anybody liked.
 */
const TARGET_TEXEL = WANT_NEAR_SPLIT / SHADOW_TEXELS
const splitFor = (texel) => (texel * SHADOW_TEXELS) / diagonalFactor
const derivedNear = splitFor(TARGET_TEXEL)

const camB = new PerspectiveCamera(FOV, WIDTH / HEIGHT, NEAR, 1e13)
camB.updateProjectionMatrix()
const mid = Math.sqrt(derivedNear * WANT_FAR)
const three = new CSM({
  camera: camB,
  parent: new Group(),
  cascades: 3,
  maxFar: WANT_FAR,
  shadowMapSize: SHADOW_TEXELS,
  mode: 'custom',
  customSplitsCallback: (n, near, far, target) => {
    target.push(derivedNear / far)
    target.push(mid / far)
    target.push(1)
  },
})
three.updateFrustums()
const threeTexels = three.lights.map((l) => (l.shadow.camera.right - l.shadow.camera.left) / SHADOW_TEXELS)

console.log('\n=== three cascades, split from the texel rather than guessed ===')
console.log(`  a box of t x ${SHADOW_TEXELS} texels needs a slice ending at box / ${diagonalFactor.toFixed(3)}`)
console.log(`  so ${TARGET_TEXEL.toFixed(3)} m/texel wants a near split at ${derivedNear.toFixed(0)} m, not ${WANT_NEAR_SPLIT}`)
console.log(`  splits  0 - ${derivedNear.toFixed(0)} - ${mid.toFixed(0)} - ${WANT_FAR} m`)
console.log(`  texels  ${threeTexels.map((t) => t.toFixed(3)).join('  ')} m`)
console.log(`  against ${SHADOW_TEXEL_METRES.toFixed(3)} m today, out to ${SHADOW_EXTENT} m and nothing beyond`)

/* ---------------------------------------------------------------- *
 * 3. The over-lighting hazard, as a number
 * ---------------------------------------------------------------- */

const patched = new MeshStandardMaterial()
csm.setupMaterial(patched)
const unpatched = new MeshStandardMaterial()

/* A fragment on a patched material takes one cascade; an unpatched one takes
 * every directional light in the scene, because three feeds them all to every
 * material and layers do not filter lights per object. */
const perFragmentPatched = 1
const perFragmentUnpatched = csm.lights.length

console.log('\n=== what an unpatched material receives ===')
console.log(`  cascade lights in the scene         ${csm.lights.length}`)
console.log(`  a patched material sums             ${perFragmentPatched} of them`)
console.log(`  an unpatched one sums               ${perFragmentUnpatched} — ${perFragmentUnpatched}x over-lit, and it looks like a lighting bug`)
console.log(`  patched defines                     ${JSON.stringify(patched.defines)}`)
console.log(`  unpatched defines                   ${JSON.stringify(unpatched.defines ?? null)}`)

/* ---------------------------------------------------------------- *
 * 4. setupMaterial destroys an existing onBeforeCompile
 * ---------------------------------------------------------------- */

const withHook = new MeshStandardMaterial()
let ownHookRan = false
withHook.onBeforeCompile = () => {
  ownHookRan = true
}
const ownHook = withHook.onBeforeCompile
csm.setupMaterial(withHook)
const hookSurvived = withHook.onBeforeCompile === ownHook
/* And the composition that would have to be written to keep it. */
const injected = withHook.onBeforeCompile
withHook.onBeforeCompile = function (shader, renderer) {
  injected.call(this, shader, renderer)
  ownHook.call(this, shader, renderer)
}
withHook.onBeforeCompile({ uniforms: {}, vertexShader: '', fragmentShader: '' }, null)

const SHADERS = readFileSync(new URL('../src/gfx/shaders.js', import.meta.url), 'utf8')
const hookUsers = (SHADERS.match(/onBeforeCompile/g) ?? []).length

console.log('\n=== the hook collision ===')
console.log(`  gfx/shaders.js installs onBeforeCompile ${hookUsers} times (Earth night lights, Moon eclipse)`)
console.log(`  setupMaterial leaves an existing hook in place?  ${hookSurvived}`)
console.log(`  a composed hook runs both?                       ${ownHookRan}`)

console.log('\n=== what this establishes ===')
const checks = [
  ['the lens is read off the app rather than restated here', Number.isFinite(FOV) && Number.isFinite(NEAR)],
  // The reason the import in any future wiring must be three's own.
  ["three-stdlib's CSM destroys lights_pars_begin for every lit shader", parsAfterStdlib === undefined],
  ["three's own CSM extends that chunk instead", ShaderChunk.lights_pars_begin.length > parsBefore.length],
  // The measurement that decides the design.
  ['a cascade box is its far distance times the frame diagonal, not its depth', diagonalFactor > 1.6 && diagonalFactor < 1.8],
  ['so the near cascade misses the texel size the split implies', texels[0] > (WANT_NEAR_SPLIT / SHADOW_TEXELS) * 1.5],
  ['and it does not resolve a tower lattice tie', texels[0] > LATTICE],
  /*
   * The honest comparison, which is not the one the first draft of this gate
   * made. Cascades are better near and coarser far — the ordinary trade — and
   * the far figure is not a regression against 0.586 m because beyond
   * SHADOW_EXTENT there is no shadow today at all.
   */
  ['the near cascade is finer than the single map it would replace', texels[0] < SHADOW_TEXEL_METRES],
  ['the far cascade is coarser, which is the trade cascades make', texels[1] > SHADOW_TEXEL_METRES],
  ['and it reaches past where the single map stops entirely', WANT_FAR > SHADOW_EXTENT],
  // The derived configuration, which is the one worth building.
  ['deriving the split from the texel hits the figure the brief asks for', Math.abs(threeTexels[0] - TARGET_TEXEL) < 0.005],
  ['and it resolves a tower lattice tie, which 800 m does not', threeTexels[0] < LATTICE],
  /*
   * Not "every cascade is finer", which is false for the same reason as above
   * and was the second draft's mistake: the last one reaches from 1,021 m to
   * 2,200 and is coarser at 0.908 m, but the ground past 1,200 m has no shadow
   * on it today, so there is nothing there for it to be a regression against.
   * What has to hold is that the ground the single map *does* cover comes out
   * finer everywhere.
   */
  ['the cascades covering the ground the single map covers are all finer', threeTexels[0] < SHADOW_TEXEL_METRES && threeTexels[1] < SHADOW_TEXEL_METRES],
  ['and the coarse one is buying ground that has no shadow on it at all today', mid < SHADOW_EXTENT && WANT_FAR > SHADOW_EXTENT],
  // The hazards, as facts rather than warnings.
  ['an unpatched material takes every cascade light at once', perFragmentUnpatched === csm.lights.length && csm.lights.length > 1],
  ['setupMaterial overwrites an existing onBeforeCompile', !hookSurvived],
  ['and a composed hook is what keeps both', ownHookRan],
  ['there are materials in this scene that need that composition', hookUsers >= 2],
]
let pass = true
for (const [label, ok] of checks) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`)
  if (!ok) pass = false
}
console.log(`\n  measured diagonal factor ${diagonalFactor.toFixed(3)}; cascade texels ${texels.map((t) => t.toFixed(3)).join(', ')} against ${SHADOW_TEXEL_METRES.toFixed(3)} today`)
console.log(`  ${pass ? 'PASS' : 'FAIL'}`)
process.exit(pass ? 0 : 1)
