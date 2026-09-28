/**
 * verify-intro — the mission intro flight is a safe flight, and a seamless one.
 *
 * `gfx/introFlights.js` flies the camera from 25 AU down onto the mission's
 * first shot in one continuous zoom. It cannot be watched from a Node process,
 * but its geometry can be walked: `introStep` is a pure function of the clock,
 * so this drives the whole flight for every mission's dossier and asserts what
 * the shot promises:
 *
 *   1. The path never enters anything drawn — the Sun, the Earth, the Moon,
 *      the vehicle, or any planet on rails. Swept over the Moon's phases and
 *      over every world the vehicle actually hands over at, because the keys
 *      are taken from the live ephemeris wherever the mission happens to be.
 *   2. The flight is invariant under floating-origin moves. The keys are kept
 *      in absolute coordinates and `introStep` subtracts `live.origin` on the
 *      way out; run the same flight with the origin walking around and the
 *      absolute camera position must not change by more than a rounding error.
 *   3. The shot opens where the film opens — a star among stars, tens of AU
 *      out with the Sun in frame — and its last frame *is* the mission's first:
 *      the camera, the look point, the up vector and the lens all equal what
 *      `restingPose` gives the rig for that shot, so the hand-over is not an
 *      event. This is the check the old flight failed by design: it ended
 *      900 m over the pad and then cut to the ground.
 *   4. Every dossier page turns: its beats, in order.
 *   5. It is one zoom: the distance to the destination only ever falls, and
 *      the lens never leaves the destination — the first version stared at
 *      whatever the line from Earth's centre crossed (open ocean) and then
 *      lurched to the pad.
 */
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { live } from '../src/sim/live.js'
import { BODIES, CRAFT } from '../src/sim/constants.js'
import { RAILS, RAIL_RADIUS, railHelio, updateRails } from '../src/sim/rails.js'
import { DOSSIERS, INTRO, introEnd, introStart, introStep, introTarget } from '../src/gfx/introFlights.js'
import { makePose, restingPose } from '../src/gfx/shotPoses.js'

const AU = 1.495978707e11

let n = 0
const check = (label, fn) => {
  fn()
  n++
  console.log(`  ✓ ${label}`)
}

/** A camera the rig would recognise — `introStep` touches exactly these. */
const makeCamera = () => new THREE.PerspectiveCamera(52, 1, 0.1, 1e13)

const SCRATCH = new THREE.Vector3()

/** Absolute camera position this step: the origin-relative point put back. */
const absolute = (cam) => SCRATCH.copy(cam.position).add(live.origin).clone()

/**
 * What is drawn, and the clearance the camera must hold from it.
 *
 * Distant bodies get a proportional margin — nothing approaches them. The
 * worlds the flight actually flies over get a fixed hundred metres of sky
 * instead: the settle is deliberately hundreds of metres over a pad, and a
 * proportional margin there would demand the shot stop 300 km up. The claim
 * is that the camera never enters anything — a hundred metres says "clearly
 * outside" without forbidding the approach the film is made of.
 */
const REL = { rel: 0.05 }
const SKY = { abs: 100 }
/** The clearance floor: a fixed hundred metres of sky, or 5% off the radius. */
const floorOf = (s) => (s.clear.abs != null ? s.r + s.clear.abs : s.r * (1 + s.clear.rel))

const surfaces = []
for (const id of ['sun', 'earth', 'moon']) {
  const host = id === 'earth' || id === 'moon'
  surfaces.push({
    id,
    r: BODIES[id].radius,
    clear: host ? SKY : REL,
    pos: () => live.abs[id],
  })
}
surfaces.push({
  id: 'ship',
  r: (CRAFT.ship.visual ?? 100) / 2,
  clear: REL,
  pos: () => live.abs.ship,
})
// And every planet on rails, wherever the epoch puts them.
updateRails(live.sim.t, railHelio)
for (let k = 0; k < RAILS.length; k++) {
  const o = k * 3
  const sun = live.abs.sun
  surfaces.push({
    id: RAILS[k].id,
    r: RAIL_RADIUS[k],
    clear: REL,
    pos: () => ({
      x: sun.x + railHelio[o],
      y: sun.y + railHelio[o + 1],
      z: sun.z + railHelio[o + 2],
    }),
  })
}

const STEPS = 1200

/** Walk one whole flight, sampling absolute camera positions per step. */
function fly(presetId, wanderOrigin, focus = 'earth') {
  const cam = makeCamera()
  introStart(presetId, focus)
  const samples = []
  const beats = []
  const looks = []
  const fwd = []
  for (let i = 0; i <= STEPS; i++) {
    if (wanderOrigin) {
      // The floating origin walks: the Sun, then Earth, then the vehicle —
      // and a detour. The absolute flight must not notice.
      const phase = i / STEPS
      const base = phase < 0.5 ? live.abs.sun : live.abs.earth
      live.origin.set(
        base.x + Math.sin(phase * 31) * 1e6,
        base.y + Math.cos(phase * 17) * 1e6,
        base.z,
      )
    }
    // After the last frame the camera belongs to the rig, not the flight.
    if (!INTRO.active) break
    const changed = introStep(cam, INTRO.duration / STEPS)
    if (changed >= 0) beats.push(changed)
    samples.push(absolute(cam))
    looks.push(SCRATCH.copy(INTRO.look).add(live.origin).clone())
    fwd.push(cam.getWorldDirection(new THREE.Vector3()))
  }
  introEnd()
  return { cam, samples, beats, looks, fwd }
}

/** The Moon swung to another quarter of its orbit, for the sweep below. */
const moonHome = live.abs.moon.clone()
function setMoonPhase(theta) {
  const e = live.abs.earth
  const r = moonHome.distanceTo(e)
  const base = Math.atan2(moonHome.z - e.z, moonHome.x - e.x)
  live.abs.moon.set(e.x + Math.cos(base + theta) * r, moonHome.y, e.z + Math.sin(base + theta) * r)
}

/**
 * Where the vehicle hands over. The epoch leaves it on the pad at Kennedy;
 * the missions fly it to both hemispheres of the Moon and to lunar orbit, and
 * the anchors are taken from wherever it actually is.
 */
const shipHome = live.abs.ship.clone()
function withShipAt(kind, fn) {
  const e = live.abs.earth
  const m = live.abs.moon
  const moonR = BODIES.moon.radius
  if (kind === 'lunar-near') {
    // Tranquility: the far side of the near side — facing Earth.
    live.abs.ship.copy(m).addScaledVector(SCRATCH.copy(e).sub(m).normalize(), moonR + 2)
  } else if (kind === 'lunar-far') {
    live.abs.ship.copy(m).addScaledVector(SCRATCH.copy(m).sub(e).normalize(), moonR + 2)
  } else if (kind === 'lunar-orbit') {
    const out = SCRATCH.copy(m).sub(e).normalize()
    const perp = new THREE.Vector3(-out.z, 0, out.x).normalize()
    live.abs.ship.copy(m).addScaledVector(perp, moonR * 1.15)
  }
  try {
    fn()
  } finally {
    live.abs.ship.copy(shipHome)
  }
}

const HEMISPHERES = ['pad', 'lunar-near', 'lunar-far', 'lunar-orbit']

const ids = Object.keys(DOSSIERS)
assert.ok(ids.length >= 9, `expected the nine missions' dossiers, found ${ids.length}`)

/* ---------------------------------------------------------------- *
 * 1. Clearance: nothing drawn is ever entered, wherever it all is
 * ---------------------------------------------------------------- */

for (const id of ids) {
  check(`[${id}] the flight never enters a body — any Moon phase, any hand-over world`, () => {
    for (const theta of [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2]) {
      setMoonPhase(theta)
      for (const where of HEMISPHERES) {
        withShipAt(where, () => {
          const { samples } = fly(id, false)
          for (const s of surfaces) {
            const p = s.pos()
            const floor = floorOf(s)
            let closest = Infinity
            for (const c of samples) {
              const d = Math.hypot(c.x - p.x, c.y - p.y, c.z - p.z)
              if (d < closest) closest = d
            }
            assert.ok(
              closest > floor,
              `[${id}] at lunar phase ${theta.toFixed(2)}, from ${where}: camera passes ` +
                `${Math.round(closest)} m from ${s.id}, whose clear floor is ${Math.round(floor)} m`,
            )
          }
        })
      }
    }
    live.abs.moon.copy(moonHome)
  })
}

/* ---------------------------------------------------------------- *
 * 2. The absolute flight does not know the origin moved
 * ---------------------------------------------------------------- */

for (const id of ids) {
  check(`[${id}] the flight is invariant under floating-origin moves`, () => {
    const still = fly(id, false).samples
    const moving = fly(id, true).samples
    for (let i = 0; i < still.length; i++) {
      const drift = moving[i].distanceTo(still[i])
      // Rounding only: the numbers involved are ~1e11 m in float64, whose
      // resolution there is a third of a micron.
      assert.ok(drift < 1e-3, `[${id}] sample ${i} drifted ${drift} m when the origin moved`)
    }
  })
}

/* ---------------------------------------------------------------- *
 * 3. The shot's two ends — and the last frame is the mission's first
 * ---------------------------------------------------------------- */

/** The first shots a mission can open on, each checked where the gate can pose it. */
const FINAL_FOCI = ['earth', 'ground', 'pad', 'ship', 'moon']
const pose = makePose()

for (const id of ids) {
  check(`[${id}] opens among the stars, lands exactly on the mission's first frame`, () => {
    for (const focus of FINAL_FOCI) {
      const cam = makeCamera()
      introStart(id, focus)
      introStep(cam, 0.001)
      const start = absolute(cam)
      const target = introTarget()
      const openR = start.distanceTo(target.look)
      assert.ok(openR > 20 * AU, `[${id}/${focus}] opens ${(openR / AU).toFixed(2)} AU from its destination`)
      // The Sun is in the opening frame: within the half-width of a 52-degree lens.
      const toSun = SCRATCH.copy(live.abs.sun).sub(start).normalize()
      const sunOff = (Math.acos(Math.min(1, toSun.dot(cam.getWorldDirection(new THREE.Vector3())))) * 180) / Math.PI
      assert.ok(sunOff < 26, `[${id}/${focus}] the Sun opens ${sunOff.toFixed(1)} degrees off axis, outside the frame`)

      for (let i = 0; i < STEPS && INTRO.active; i++) introStep(cam, INTRO.duration / STEPS)
      assert.equal(INTRO.active, false, `[${id}/${focus}] the flight did not end on its clock`)

      // The rig's own first frame, from the same function the rig calls.
      assert.ok(restingPose(focus, pose), `[${id}] no resting pose for ${focus}`)
      const wantCam = pose.cam.clone().add(live.origin)
      const wantLook = pose.look.clone().add(live.origin)
      const endCam = absolute(cam)
      const miss = endCam.distanceTo(wantCam)
      // Float64 at ~1.5e11 m resolves 3e-5 m; a millimetre is rounding, not a cut.
      assert.ok(miss < 1e-3, `[${id}/${focus}] last frame is ${miss.toExponential(2)} m from the mission's first`)
      const lookMiss = SCRATCH.copy(INTRO.look).add(live.origin).distanceTo(wantLook)
      assert.ok(lookMiss < 1e-3, `[${id}/${focus}] last look point is ${lookMiss.toExponential(2)} m off`)
      assert.ok(cam.up.angleTo(pose.up) < 1e-6, `[${id}/${focus}] horizon ends ${cam.up.angleTo(pose.up)} rad off the shot's`)
      assert.ok(Math.abs(cam.fov - pose.fov) < 0.01, `[${id}/${focus}] lens ends at ${cam.fov.toFixed(2)} degrees, the shot wants ${pose.fov.toFixed(2)}`)
      introEnd()
    }
  })
}

/* ---------------------------------------------------------------- *
 * 4. The dossier's pages
 * ---------------------------------------------------------------- */

for (const id of ids) {
  check(`[${id}] every page turns, in order`, () => {
    const { beats } = fly(id, false)
    const want = DOSSIERS[id].beats.length
    assert.equal(beats.length, want, `[${id}] ${beats.length} beats turned, expected ${want}`)
    for (let i = 0; i < beats.length; i++) {
      assert.equal(beats[i], i, `[${id}] beat ${i} arrived as ${beats[i]}`)
    }
  })
}

/* ---------------------------------------------------------------- *
 * 5. One zoom: always closing, always looking at where it is going
 * ---------------------------------------------------------------- */

for (const id of ids) {
  check(`[${id}] closes on its destination the whole way, and never looks away from it`, () => {
    for (const focus of ['earth', 'ground', 'ship']) {
      const { samples, looks, fwd } = fly(id, false, focus)
      let prev = Infinity
      let worstGaze = 0
      for (let i = 0; i < samples.length; i++) {
        const d = samples[i].distanceTo(looks[i])
        // Rounding only: a step that holds still is not a zoom back out.
        assert.ok(d <= prev * (1 + 1e-12) + 1e-6, `[${id}/${focus}] step ${i} backs out from ${prev.toFixed(0)} to ${d.toFixed(0)} m`)
        prev = d
        const want = SCRATCH.copy(looks[i]).sub(samples[i]).normalize()
        worstGaze = Math.max(worstGaze, fwd[i].angleTo(want))
      }
      assert.ok(worstGaze < 1e-6, `[${id}/${focus}] the lens strays ${((worstGaze * 180) / Math.PI).toFixed(4)} degrees off the destination`)
    }
  })
}

console.log(`\nverify-intro: ${n} checks passed`)
