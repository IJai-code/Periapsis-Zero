/**
 * The one light in this scene that can have a shadow map, and what it costs.
 *
 * Everything is lit by a point light inside the Sun with 1/r^2 falloff. That is
 * right everywhere and cannot cast a shadow anywhere: a point light's cube
 * shadow at 2048 a face is 146,000 km per texel by the time it reaches Earth, so
 * the `castShadow` flags on the pads and the hulls have been inert since they
 * were written.
 *
 * Near the ground the point light is replaced — not joined — by a parallel beam
 * that can. A substitution has to be justified rather than assumed, and it has
 * exactly two errors, both measured here:
 *
 *   1. a beam does not converge, so the sun's direction is the same everywhere
 *      on the patch instead of turning across it
 *   2. a beam does not fall off, so the illuminance is the same everywhere on
 *      the patch instead of weakening across it
 *
 * Both are compared against the resolution of the thing the substitution exists
 * to serve — a shadow texel on the ground — because an error below that cannot
 * appear in the image it is being made for. What is *not* checked is the
 * penumbra, which the substitution does get wrong, and `sunlight.js` says so.
 *
 *   node scripts/verify-shadows.mjs
 */
import { Vector3 } from 'three'
import { live, refreshDerived, resetSimulation } from '../src/sim/live.js'
import { LAUNCH_SITES, selectSite } from '../src/sim/launchsite.js'
import { AU, BODIES } from '../src/sim/constants.js'
import { buildPad } from '../src/gfx/padGeometry.js'
import { padFor, vehicleFootprint } from '../src/gfx/pads.js'
import { stageLength } from '../src/gfx/framing.js'
import { ACTIVE_VESSEL } from '../src/sim/vessels.js'
import {
  GROUND_RANGE,
  SHADOW_DISTANCE,
  SHADOW_EXTENT,
  SHADOW_TEXELS,
  SHADOW_TEXEL_METRES,
  SOLAR_ILLUMINANCE_AT_1AU,
  SOLAR_INTENSITY,
  falloffOver,
  illuminanceAt,
  onTheGround,
  padScenePoint,
  parallaxOver,
} from '../src/gfx/sunlight.js'

const R = BODIES.earth.radius
const L = stageLength(0)
const foot = vehicleFootprint()

/* ---------------------------------------------------------------- *
 * 1. The substitution, against the resolution it serves
 * ---------------------------------------------------------------- */

resetSimulation()
refreshDerived()

const pad = new Vector3()
padScenePoint(pad, LAUNCH_SITES.ksc)
const sunRange = pad.distanceTo(live.pos.sun)

/*
 * Convergence is compared over the *shadow box*, not the terrain, and in metres
 * on the ground rather than in radians: what a beam gets wrong is where a shadow
 * lands. Falloff is compared over the terrain, because the beam lights that too.
 */
const turn = parallaxOver(SHADOW_EXTENT, sunRange)
const fade = falloffOver(GROUND_RANGE, sunRange)

/* ---------------------------------------------------------------- *
 * 2. The handover puts the same light on the pad
 * ---------------------------------------------------------------- */

console.log('\n=== the handover, pad by pad ===')
console.log('  site          pad to Sun AU     beam lux        point-light lux      ratio')
let worstRatio = 0
let worstDrift = 0
for (const site of Object.values(LAUNCH_SITES)) {
  selectSite(site.id)
  resetSimulation()
  refreshDerived()
  padScenePoint(pad, site)
  const d = pad.distanceTo(live.pos.sun)
  const beam = illuminanceAt(d)
  const point = SOLAR_INTENSITY / (d * d)
  worstRatio = Math.max(worstRatio, Math.abs(beam / point - 1))
  // And how much the illuminance really varies across the ground the beam covers.
  const drift = Math.abs(illuminanceAt(d - GROUND_RANGE) / beam - 1)
  worstDrift = Math.max(worstDrift, drift)
  console.log(
    `  ${site.id.padEnd(12)}${(d / AU).toFixed(6).padStart(12)}   ${beam.toFixed(4).padStart(12)}   ${point.toFixed(4).padStart(14)}   ${(beam / point).toFixed(12)}`,
  )
}

/* ---------------------------------------------------------------- *
 * 3. The shadow camera contains what casts into it
 * ---------------------------------------------------------------- */

console.log('\n=== what has to fit inside the shadow box ===')
console.log(`  ${ACTIVE_VESSEL}: ${L.toFixed(1)} m stack`)
console.log('  site          structure reach    tallest      shadow at 10 deg sun')
let widest = 0
let tallest = 0
let longestShadow = 0
let lowestSun = 0
for (const id of Object.keys(LAUNCH_SITES)) {
  const p = padFor(id)
  const { meshes } = buildPad(id)
  let reach = 0
  let high = -Infinity
  for (const m of meshes) {
    const pos = m.geometry.getAttribute('position')
    for (let i = 0; i < pos.count; i++) {
      reach = Math.max(reach, Math.hypot(pos.getX(i), pos.getZ(i)))
      high = Math.max(high, pos.getY(i))
    }
  }
  // The vehicle stands on the deck, so the tallest thing is whichever is higher.
  const top = Math.max(high, p.deck + L)
  // A low sun is what makes a shadow long; 10 degrees is a launch-window dawn.
  const cast = top / Math.tan((10 * Math.PI) / 180)
  widest = Math.max(widest, reach)
  tallest = Math.max(tallest, top)
  longestShadow = Math.max(longestShadow, reach + cast)
  // The elevation at which this pad's tallest shadow just reaches the box edge.
  lowestSun = Math.max(lowestSun, (Math.atan2(top, SHADOW_EXTENT - reach) * 180) / Math.PI)
  console.log(
    `  ${id.padEnd(12)}${reach.toFixed(1).padStart(12)} m${top.toFixed(1).padStart(12)} m${cast.toFixed(0).padStart(18)} m`,
  )
}

/* The displacement needs the tallest caster, so it is printed after the pads. */
const landingError = turn * tallest

console.log('\n=== the parallel-beam substitution ===')
console.log(`  pad to Sun                       ${(sunRange / AU).toFixed(6)} AU`)
console.log(`  across the shadow box it ignores a turn of ${turn.toExponential(3)} rad`)
console.log(`  which moves the tallest shadow   ${landingError.toExponential(3)} m`)
console.log(`  against a texel of               ${SHADOW_TEXEL_METRES.toFixed(3)} m — ${(SHADOW_TEXEL_METRES / landingError).toExponential(2)}x larger`)
console.log(`  and over ${(GROUND_RANGE / 1e3).toFixed(0)} km of terrain it flattens a falloff of ${fade.toExponential(3)}`)

console.log('\n=== the shadow map ===')
console.log(`  box            ${2 * SHADOW_EXTENT} x ${2 * SHADOW_EXTENT} m at ${SHADOW_TEXELS} texels`)
console.log(`  a texel is     ${SHADOW_TEXEL_METRES.toFixed(3)} m on the ground`)
console.log(`  depth range    ${1} to ${SHADOW_DISTANCE * 2} m, light sits at ${SHADOW_DISTANCE} m`)
console.log(`  normal bias    ${SHADOW_TEXEL_METRES.toFixed(3)} m, which is one texel and not a tuned number`)
console.log(`  shadows are whole above ${lowestSun.toFixed(1)} deg of sun elevation; below that the longest tip leaves the box`)
console.log(
  `  the vehicle is ${(foot.radius * 2).toFixed(1)} m across, ${(( foot.radius * 2) / SHADOW_TEXEL_METRES).toFixed(0)} texels;` +
    ` a lattice tie under ${SHADOW_TEXEL_METRES.toFixed(2)} m does not resolve and its shadow is the tower's, not its own`,
)

/* ---------------------------------------------------------------- *
 * 4. The switch happens where the ground does
 * ---------------------------------------------------------------- */

selectSite('ksc')
resetSimulation()
refreshDerived()
padScenePoint(pad, LAUNCH_SITES.ksc)
const up = pad.clone().sub(live.pos.earth).normalize()
const camera = { position: new Vector3() }
const at = (metres) => {
  camera.position.copy(pad).addScaledVector(up, metres)
  return onTheGround(camera, LAUNCH_SITES.ksc)
}
const onPad = at(50)
const justInside = at(GROUND_RANGE * 0.99)
const justOutside = at(GROUND_RANGE * 1.01)
console.log('\n=== where the beam takes over ===')
console.log(`  on the pad ${onPad}, at ${(GROUND_RANGE * 0.99) / 1e3} km ${justInside}, at ${(GROUND_RANGE * 1.01) / 1e3} km ${justOutside}`)

console.log('\n=== what this establishes ===')
const checks = [
  ['the beam delivers the illuminance the point light did, to a part in 1e9', worstRatio < 1e-9],
  ['and that illuminance varies under 1e-5 across the ground it covers', worstDrift < 1e-5],
  // The substitution's own error, against the resolution it is made for.
  ['the convergence it flattens moves a shadow less than a texel', landingError < SHADOW_TEXEL_METRES],
  ['by a factor of a hundred thousand or more', SHADOW_TEXEL_METRES / landingError > 1e5],
  ['and the falloff it drops is under a part in a hundred thousand', fade < 1e-5],
  ['one AU of the point light is the illuminance the constant names', Math.abs(illuminanceAt(AU) / SOLAR_ILLUMINANCE_AT_1AU - 1) < 1e-12],
  // The box has to hold the casters and the ground their shadows land on.
  ['every pad structure stands inside the shadow box', widest < SHADOW_EXTENT],
  /*
   * Not "every shadow fits" — one map cannot hold a 2 km shadow and resolve the
   * tower casting it. What is asserted is the elevation above which they do,
   * which is a property of the box and the pads rather than a hope.
   */
  ['shadows are whole down to a low sun, and the angle is measured not assumed', lowestSun < 12],
  ['the light is further up the ray than anything is tall', SHADOW_DISTANCE > tallest * 2],
  ['and its far plane clears the light by the same margin again', SHADOW_DISTANCE * 2 > SHADOW_DISTANCE + tallest],
  /*
   * Against the vehicle, which is the thing the shadow is mostly of, rather than
   * against a number chosen to be passed. What a texel does *not* resolve is
   * printed above rather than asserted away.
   */
  ['a texel is small against the vehicle it is shadowing', SHADOW_TEXEL_METRES * 8 < foot.radius * 2],
  ['the beam is on at the pad and off above the ground that is drawn', onPad && justInside && !justOutside],
]
let pass = true
for (const [label, ok] of checks) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`)
  if (!ok) pass = false
}
console.log(`\n  worst handover ratio error ${worstRatio.toExponential(2)}, worst illuminance drift ${worstDrift.toExponential(2)}`)
console.log(`  ${pass ? 'PASS' : 'FAIL'}`)
process.exit(pass ? 0 : 1)
