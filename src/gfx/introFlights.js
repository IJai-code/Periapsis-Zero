import * as THREE from 'three'
import { live } from '../sim/live.js'

/**
 * The mission intros: one continuous flight through the real solar system,
 * in the language the reference film speaks — a scale journey with no cuts,
 * the Sun first as a star among stars, then the planets, then one planet,
 * then the vehicle, and the mission's own shot underneath when it ends.
 *
 * Nothing here is a recording. The camera flies the scene the simulator is
 * already rendering — true at any resolution, free of compression, and it
 * arrives where the mission begins. The path is a chain of quadratic Béziers
 * through five anchors built from the live ephemeris at the moment the intro
 * starts (the sim is paused through the intro, so the anchors hold), eased at
 * both ends so the flight begins from stillness and settles onto the mission's
 * frame.
 *
 * The anchors are kept in **absolute** scene coordinates (live.abs), not in
 * the floating origin's rebased frame: the origin moves under the camera as
 * the flight crosses the system, and a path in rebased coordinates would tear
 * every time it did. `introStep` subtracts `live.origin` on the way out, which
 * is exact in float64 however far apart the two are.
 *
 * The frame path allocates nothing: the scratch vectors below are built once,
 * and `introStep` only reads them and writes the camera.
 */

/* ---------------------------------------------------------------- *
 * The dossier: what each mission is, in the film's sparse titles
 * ---------------------------------------------------------------- */

export const DOSSIERS = {
  'apollo8-launch': {
    music: 'ascent',
    beats: [
      { s: 0.1, eyebrow: 'Kennedy Space Center', line: 'Launch Complex 39B · December 1968' },
      { s: 0.38, eyebrow: 'Saturn V', line: '110 metres of vehicle, 2,970 tonnes at liftoff' },
      { s: 0.62, eyebrow: 'Three crew', line: 'Borman · Lovell · Anders' },
      { s: 0.86, eyebrow: 'Apollo 8', line: 'The first flight to leave the Earth' },
      { s: 0.94, eyebrow: 'T-60 seconds', line: 'The last minute, standing on the ground' },
    ],
    arc: { swing: 1.1, settle: 900, tilt: 0.32 },
    specs: [
      ['Flight', 'First crewed Saturn V'],
      ['Vehicle', 'Saturn V SA-503'],
      ['Window', '21 December 1968'],
      ['Pad', 'Kennedy LC-39B'],
    ],
  },
  'apollo11-liftoff': {
    music: 'lunar',
    beats: [
      { s: 0.1, eyebrow: 'Tranquility Base', line: '20 July 1969 · the Moon' },
      { s: 0.38, eyebrow: 'Eagle', line: 'Armstrong · Aldrin' },
      { s: 0.62, eyebrow: 'Ascent stage', line: 'A launch from another world' },
      { s: 0.86, eyebrow: 'Apollo 11', line: 'To meet Columbia in lunar orbit' },
      { s: 0.94, eyebrow: 'Liftoff', line: 'The first launch from another world' },
    ],
    arc: { swing: 0.9, settle: 600, tilt: 0.5, viaMoon: true },
    specs: [
      ['Craft', 'Eagle · ascent stage'],
      ['Aloft', '21 h 36 m after touchdown'],
      ['Crew', 'Armstrong · Aldrin'],
      ['Waiting', 'Columbia, with Collins'],
    ],
  },
  'apollo11-docking': {
    music: 'rendezvous',
    beats: [
      { s: 0.1, eyebrow: 'Lunar orbit', line: 'Three and a quarter hours after liftoff' },
      { s: 0.38, eyebrow: 'Columbia waits', line: 'Collins, alone in the command module' },
      { s: 0.62, eyebrow: 'The braking gate', line: 'A mile and a bit, closing at walking pace' },
      { s: 0.86, eyebrow: 'Eagle', line: 'The last half hour was flown by hand' },
      { s: 0.94, eyebrow: 'Braking gate', line: 'A mile and a bit, and half an hour to go' },
    ],
    arc: { swing: 0.85, settle: 320, tilt: 0.55, viaMoon: true },
    specs: [
      ['Range', '1.7 km at hand-over'],
      ['Closing', 'Walking pace'],
      ['Flown', 'By hand'],
      ['Rendezvous', 'CSM-107 Columbia'],
    ],
  },
  'apollo8-lunar-orbit': {
    music: 'arrival',
    beats: [
      { s: 0.1, eyebrow: 'Trans-lunar coast', line: 'Three days from the Earth' },
      { s: 0.38, eyebrow: 'The far side', line: 'No radio contact · the loneliest place' },
      { s: 0.62, eyebrow: 'Lunar orbit insertion', line: 'The burn that loses the way home' },
      { s: 0.86, eyebrow: 'Apollo 8', line: 'Ten revolutions, and a Christmas reading' },
      { s: 0.94, eyebrow: 'Lunar orbit', line: 'The Moon, as nobody had seen it' },
    ],
    arc: { swing: 1.0, settle: 2400, tilt: 0.42, viaMoon: true },
    specs: [
      ['Arrival', '24 December 1968'],
      ['Revolution', 'Ten'],
      ['Blackout', 'Far side · complete'],
      ['Burn', 'The one that loses the way home'],
    ],
  },
  'artemis-halo': {
    music: 'deep',
    beats: [
      { s: 0.1, eyebrow: 'The Gateway', line: 'A halo orbit beyond the Moon' },
      { s: 0.38, eyebrow: 'Four burns', line: 'Solved in the background while you watch' },
      { s: 0.62, eyebrow: 'Artemis', line: 'Orion, bound for a space station' },
      { s: 0.86, eyebrow: 'Near-rectilinear', line: 'An orbit that is never the same twice' },
      { s: 0.94, eyebrow: 'The Gateway', line: 'A station in an orbit that never repeats' },
    ],
    arc: { swing: 1.35, settle: 3200, tilt: 0.42, viaMoon: true },
    specs: [
      ['Orbit', 'Near-rectilinear halo'],
      ['Period', '≈ 6.5 days'],
      ['Apolune', '≈ 70,000 km'],
      ['Perilune', '≈ 3,000 km · far side'],
    ],
  },
  'vandenberg-polar': {
    music: 'vigil',
    beats: [
      { s: 0.1, eyebrow: 'Vandenberg', line: 'SLC-6 · the Pacific range' },
      { s: 0.38, eyebrow: 'Polar parking orbit', line: 'A hundred kilometres up, waiting' },
      { s: 0.62, eyebrow: 'The window', line: 'An orbit that would decay before it arrived' },
      { s: 0.86, eyebrow: 'The raise', line: 'Two burns, 10.5 m/s, and time enough' },
      { s: 0.94, eyebrow: 'SLC-6', line: 'A Pacific range, and a window made by waiting' },
    ],
    arc: { swing: 1.1, settle: 900, tilt: 0.32 },
    specs: [
      ['Pad', 'Vandenberg SLC-6'],
      ['Wait', '104.4 h to the window'],
      ['Life', '204.8 h in orbit'],
      ['Raise', 'Two burns · 10.5 m/s'],
    ],
  },
  'apollo8-tli': {
    music: 'departure',
    beats: [
      { s: 0.1, eyebrow: 'Parking orbit', line: 'Two and a half hours from the pad' },
      { s: 0.38, eyebrow: 'The window', line: 'The Moon is already moving where it will be' },
      { s: 0.62, eyebrow: 'S-IVB restart', line: 'The third stage lights again' },
      { s: 0.86, eyebrow: 'Trans-lunar injection', line: 'The moment the mission leaves the Earth' },
      { s: 0.94, eyebrow: 'Ignition', line: 'The third stage, lit on screen' },
    ],
    arc: { swing: 1.05, settle: 700, tilt: 0.36 },
    specs: [
      ['Stage', 'S-IVB · restarted'],
      ['Coast', 'Three days to the Moon'],
      ['Crew', 'Borman · Lovell · Anders'],
      ['Phase', 'Trans-lunar injection'],
    ],
  },
  'apollo8-tei': {
    music: 'return',
    beats: [
      { s: 0.1, eyebrow: 'Lunar orbit', line: '25 December 1968 · behind the Moon' },
      { s: 0.38, eyebrow: 'Trans-Earth injection', line: 'Lit with no radio contact at all' },
      { s: 0.62, eyebrow: 'The way home', line: 'Fifty-eight hours of coast, and one corridor' },
      { s: 0.86, eyebrow: 'Apollo 8', line: 'The burn for home' },
      { s: 0.94, eyebrow: 'Christmas Day', line: '1968 · lit on time, on the far side' },
    ],
    arc: { swing: 0.95, settle: 1800, tilt: 0.48, viaMoon: true },
    specs: [
      ['Lit', '25 December 1968'],
      ['Contact', 'None · far side'],
      ['Coast home', '≈ 58 hours'],
      ['Target', 'One entry corridor'],
    ],
  },
  'apollo8-reentry': {
    music: 'fire',
    beats: [
      { s: 0.1, eyebrow: 'Return', line: '11 kilometres a second' },
      { s: 0.38, eyebrow: 'Service module separation', line: 'The heat shield is all that is left' },
      { s: 0.62, eyebrow: 'The corridor', line: 'A quarter of a degree wide' },
      { s: 0.86, eyebrow: 'Re-entry', line: 'Plasma, drogues, canopies, the Pacific' },
      { s: 0.94, eyebrow: 'The Pacific', line: 'Drogues, canopies, and the ship waiting' },
    ],
    arc: { swing: 1.0, settle: 500, tilt: 0.38 },
    specs: [
      ['Speed', '11.0 km/s at entry'],
      ['Shield', 'The heat shield, and nothing else'],
      ['Drogues', 'At 7 km'],
      ['Splashdown', '27 December 1968'],
    ],
  },
}

/* ---------------------------------------------------------------- *
 * The flight: anchors in, camera out
 * ---------------------------------------------------------------- */

/** The running intro. The UI reads it; the rig calls `introStep`. */
export const INTRO = {
  active: false,
  t: 0,
  duration: 42,
  s: 0,
  beat: -1,
  presetId: null,
  finalFocus: 'earth',
  /** Where the lens is pointed this frame, in the floating origin's frame.
   * The rig parks OrbitControls' target here so the hand-off out of the intro
   * flies from a coherent state. Built once in `introStart`. */
  look: null,
}

// Scratch, built once: the frame path allocates nothing.
const anchor = (n) => Array.from({ length: n }, () => new THREE.Vector3())
const PATH = anchor(5)
const CTRL = anchor(4) // one Bézier control point per segment
const LOOK = anchor(5)
const V = new THREE.Vector3()
const V2 = new THREE.Vector3()
const PERP = new THREE.Vector3()
const UP = new THREE.Vector3(0, 1, 0)
const FAR = 1.495978707e11 // one AU, the scale the flight opens on

/**
 * The path is four quadratic Béziers, not a spline through all five anchors.
 * A Catmull-Rom through points four decades apart overshoots near the short
 * segments — the tangent borrowed from the AU-long leg flings the curve
 * through the planet it is approaching. A quadratic Bézier cannot leave the
 * hull of its own three points, so the curve bends and the camera can never
 * be thrown inside a body. The bend is a per-segment bulge, perpendicular to
 * the chord.
 */
function bezier(out, p0, c, p1, u) {
  const m = 1 - u
  out.set(
    m * m * p0.x + 2 * m * u * c.x + u * u * p1.x,
    m * m * p0.y + 2 * m * u * c.y + u * u * p1.y,
    m * m * p0.z + 2 * m * u * c.z + u * u * p1.z,
  )
  return out
}

/** Segment i at u, into out. The four segments share one evaluator. */
function pathAt(out, u) {
  const n = PATH.length - 1
  const x = Math.min(0.999999, Math.max(0, u)) * n
  const i = Math.min(n - 1, Math.floor(x))
  return bezier(out, PATH[i], CTRL[i], PATH[i + 1], x - i)
}

/** The look target: straight segments are right for gaze — it should not drift. */
function lookAt(out, u) {
  const n = LOOK.length - 1
  const x = Math.min(0.999999, Math.max(0, u)) * n
  const i = Math.min(n - 1, Math.floor(x))
  const t = x - i
  out.copy(LOOK[i]).addScaledVector(V.copy(LOOK[i + 1]).sub(LOOK[i]), t)
  return out
}

/** Fill the control points from the anchors: midpoints, pushed off the chord. */
function shapePath(bulges) {
  for (let i = 0; i < CTRL.length; i++) {
    const p0 = PATH[i]
    const p1 = PATH[i + 1]
    const c = CTRL[i]
    c.copy(p0).add(p1).multiplyScalar(0.5)
    PERP.copy(p1).sub(p0)
    const len = PERP.length() || 1
    PERP.normalize().cross(UP).normalize()
    c.addScaledVector(PERP, len * bulges[i])
  }
}

/**
 * Begin an intro for `presetId`. Anchors are taken from the live ephemeris
 * once — the sim is paused through the flight, so the sky holds still while
 * the camera crosses it.
 */
export function introStart(presetId, finalFocus = 'earth') {
  const d = DOSSIERS[presetId] ?? DOSSIERS['apollo8-launch']
  const arc = d.arc
  const sun = V.copy(live.abs.sun)
  const earth = new THREE.Vector3().copy(live.abs.earth)
  const moon = new THREE.Vector3().copy(live.abs.moon)
  const ship = new THREE.Vector3().copy(live.abs.ship)

  // The flight opens half an AU out, off the ecliptic, looking back at the
  // Sun — the film's first shot: a star, alone in frame.
  const out = earth.clone().sub(sun).normalize()
  const off = new THREE.Vector3().crossVectors(out, UP).normalize()
  PATH[0].copy(sun).addScaledVector(out, FAR * 0.55).addScaledVector(off, FAR * 0.1).addScaledVector(UP, FAR * arc.tilt * 0.22)

  // Then the swing past the Moon's distance, so the Earth grows from a
  // marble and the Moon slides through frame on the way in.
  const toEarth = earth.clone().sub(sun).normalize()
  PATH[1]
    .copy(earth)
    .addScaledVector(toEarth, -FAR * 0.06)
    .addScaledVector(off, FAR * 0.035)
    .addScaledVector(UP, FAR * arc.tilt * 0.05)
  if (arc.viaMoon) {
    PATH[1].copy(moon).addScaledVector(moon.clone().sub(earth).normalize(), BODIES_R * 6)
  }

  // Then the world the ship is actually at — a few of its own radii out, and
  // the approach: the last kilometres, decelerating into the settle.
  //
  // Both are built around the vehicle's *host* world: the Earth from a pad,
  // the Moon from Tranquility or a lunar orbit. And the settle direction is
  // that world's outward radial — the Earth's radial at a near-side lunar
  // site points into the Moon, so settling along it buried Eagle's intro
  // 600 m underground. `verify-intro` flies both hemispheres so it stays out.
  const host = ship.distanceTo(moon) < ship.distanceTo(earth) ? moon : earth
  const hostR = host === moon ? MOON_R : BODIES_R
  const down = ship.clone().sub(host).normalize()
  PATH[2].copy(host).addScaledVector(down, hostR * 7).addScaledVector(off, hostR * 4)

  PATH[3].copy(ship).addScaledVector(down, arc.settle * 6).addScaledVector(off, arc.settle * 3)
  PATH[4].copy(ship).addScaledVector(down, arc.settle).addScaledVector(off, arc.settle * 0.35)

  LOOK[0].copy(sun)
  LOOK[1].copy(earth)
  LOOK[2].copy(earth)
  LOOK[3].copy(ship)
  LOOK[4].copy(ship)

  // The curve: wide swings out in the system, a tight hand on the approach.
  shapePath([0.16, 0.1, 0.06, 0.03])

  INTRO.active = true
  INTRO.t = 0
  INTRO.s = 0
  INTRO.beat = -1
  INTRO.presetId = presetId
  INTRO.finalFocus = finalFocus
  INTRO.dossier = d
  if (!INTRO.look) INTRO.look = new THREE.Vector3()
  INTRO.look.subVectors(LOOK[0], live.origin)
  return d
}

/** The Earth's radius, as the approach scale. Read once, lazily. */
const BODIES_R = 6.371e6
/** And the Moon's, for the flights whose host is the Moon. */
const MOON_R = 1.7374e6

/**
 * Advance the flight by `delta` seconds and place the camera. Returns the
 * beat index when it changes (−1 between beats, −2 when done), so the UI
 * turns pages on events rather than polling. Allocation-free: every vector
 * touched here was built above.
 */
export function introStep(camera, delta) {
  if (!INTRO.active) return -2
  INTRO.t += delta
  const raw = Math.min(1, INTRO.t / INTRO.duration)
  // Slow out of stillness, fast through the middle, slow into the settle.
  const u = raw * raw * (3 - 2 * raw)
  INTRO.s = raw

  pathAt(V, u)
  camera.position.subVectors(V, live.origin)
  lookAt(V2, u)
  INTRO.look.subVectors(V2, live.origin)
  camera.up.copy(UP)
  camera.lookAt(INTRO.look)

  // The lens breathes: wide on the star field, tightening on the approach.
  const fov = 52 - 12 * u * u
  if (Math.abs(camera.fov - fov) > 0.01) {
    camera.fov = fov
    camera.updateProjectionMatrix()
  }

  // Beats: the dossier's pages, keyed to the same clock the path uses.
  const beats = INTRO.dossier?.beats ?? []
  let beat = -1
  for (let i = 0; i < beats.length; i++) {
    if (raw >= beats[i].s) beat = i
  }
  const changed = beat !== INTRO.beat ? beat : -1
  INTRO.beat = beat

  if (raw >= 1) {
    INTRO.active = false
    return -2
  }
  return changed
}

/** End the flight now — the skip button, and the hand-off at the end. */
export function introEnd() {
  INTRO.active = false
}
