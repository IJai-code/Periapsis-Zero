import * as THREE from 'three'
import { live } from '../sim/live.js'
import { BODIES } from '../sim/constants.js'
import { RAILS } from '../sim/rails.js'
import { makePose, restingPose } from './shotPoses.js'

/**
 * The mission intros: one continuous flight through the real solar system,
 * in the language the reference film speaks — a scale journey with no cuts,
 * the Sun first as a star among stars, then the planets, then one planet,
 * then the vehicle, and the mission's own shot underneath when it ends.
 *
 * Nothing here is a recording. The camera flies the scene the simulator is
 * already rendering — true at any resolution, free of compression, and it
 * arrives where the mission begins: one scale journey toward the point the
 * mission's first shot looks at, keyed from the live ephemeris at the moment
 * the intro starts (the sim is paused through the intro, so the keys hold),
 * and ending *on* that first shot. See "The flight" below for its shape.
 *
 * The keys are kept in **absolute** scene coordinates (live.abs), not in
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
    beats: [
      { s: 0.1, eyebrow: 'Kennedy Space Center', line: 'Simulated LC-39B · Apollo 8 hardware' },
      { s: 0.38, eyebrow: 'Saturn V', line: '110 metres of vehicle, 2,970 tonnes at liftoff' },
      { s: 0.62, eyebrow: 'Three crew', line: 'Borman · Lovell · Anders' },
      { s: 0.86, eyebrow: 'Apollo 8', line: 'The first flight to leave the Earth' },
      { s: 0.94, eyebrow: 'T-60 seconds', line: 'The last minute, standing on the ground' },
    ],
    arc: { swing: 1.1, tilt: 0.32 },
    specs: [
      ['Flight', 'First crewed Saturn V'],
      ['Vehicle', 'Saturn V SA-503'],
      ['Window', '21 December 1968'],
      ['Pad model', 'LC-39B · historical flight used 39A'],
    ],
  },
  'apollo11-liftoff': {
    beats: [
      { s: 0.1, eyebrow: 'Tranquility Base', line: '20 July 1969 · the Moon' },
      { s: 0.38, eyebrow: 'Eagle', line: 'Armstrong · Aldrin' },
      { s: 0.62, eyebrow: 'Ascent stage', line: 'A launch from another world' },
      { s: 0.86, eyebrow: 'Apollo 11', line: 'To meet Columbia in lunar orbit' },
      { s: 0.94, eyebrow: 'Liftoff', line: 'The first launch from another world' },
    ],
    arc: { swing: 0.9, tilt: 0.5 },
    specs: [
      ['Craft', 'Eagle · ascent stage'],
      ['Aloft', '21 h 36 m after touchdown'],
      ['Crew', 'Armstrong · Aldrin'],
      ['Waiting', 'Columbia, with Collins'],
    ],
  },
  'apollo11-docking': {
    beats: [
      { s: 0.1, eyebrow: 'Lunar orbit', line: 'Three and a quarter hours after liftoff' },
      { s: 0.38, eyebrow: 'Columbia waits', line: 'Collins, alone in the command module' },
      { s: 0.62, eyebrow: 'The braking gate', line: 'A mile and a bit, closing at walking pace' },
      { s: 0.86, eyebrow: 'Eagle', line: 'The last half hour was flown by hand' },
      { s: 0.94, eyebrow: 'Braking gate', line: 'A mile and a bit, and half an hour to go' },
    ],
    arc: { swing: 0.85, tilt: 0.55 },
    specs: [
      ['Range', '1.7 km at hand-over'],
      ['Closing', 'Walking pace'],
      ['Flown', 'By hand'],
      ['Rendezvous', 'CSM-107 Columbia'],
    ],
  },
  'apollo8-lunar-orbit': {
    beats: [
      { s: 0.1, eyebrow: 'Trans-lunar coast', line: 'Three days from the Earth' },
      { s: 0.38, eyebrow: 'The far side', line: 'No radio contact · the loneliest place' },
      { s: 0.62, eyebrow: 'Lunar orbit insertion', line: 'The burn that loses the way home' },
      { s: 0.86, eyebrow: 'Apollo 8', line: 'Ten revolutions, and a Christmas reading' },
      { s: 0.94, eyebrow: 'Lunar orbit', line: 'The Moon, as nobody had seen it' },
    ],
    arc: { swing: 1.0, tilt: 0.42 },
    specs: [
      ['Arrival', '24 December 1968'],
      ['Revolution', 'Ten'],
      ['Blackout', 'Far side · complete'],
      ['Burn', 'The one that loses the way home'],
    ],
  },
  'artemis-halo': {
    beats: [
      { s: 0.1, eyebrow: 'The Gateway', line: 'A halo orbit beyond the Moon' },
      { s: 0.38, eyebrow: 'Four burns', line: 'Solved in the background while you watch' },
      { s: 0.62, eyebrow: 'Artemis', line: 'Orion, bound for a space station' },
      { s: 0.86, eyebrow: 'Near-rectilinear', line: 'An orbit that is never the same twice' },
      { s: 0.94, eyebrow: 'The Gateway', line: 'A station in an orbit that never repeats' },
    ],
    arc: { swing: 1.35, tilt: 0.42 },
    specs: [
      ['Orbit', 'Near-rectilinear halo'],
      ['Period', '≈ 6.5 days'],
      ['Apolune', '≈ 70,000 km'],
      ['Perilune', '≈ 3,000 km · far side'],
    ],
  },
  'vandenberg-polar': {
    beats: [
      { s: 0.1, eyebrow: 'Vandenberg', line: 'SLC-6 · the Pacific range' },
      { s: 0.38, eyebrow: 'Polar parking orbit', line: 'A hundred kilometres up, waiting' },
      { s: 0.62, eyebrow: 'The window', line: 'An orbit that would decay before it arrived' },
      { s: 0.86, eyebrow: 'The raise', line: 'Two burns, 10.5 m/s, and time enough' },
      { s: 0.94, eyebrow: 'SLC-6', line: 'A Pacific range, and a window made by waiting' },
    ],
    arc: { swing: 1.1, tilt: 0.32 },
    specs: [
      ['Pad', 'Vandenberg SLC-6'],
      ['Launch epoch', 'J2000 + 144 hours'],
      ['Wait', '282.3 h to the window'],
      ['Raise', 'Two burns · 10.5 m/s'],
    ],
  },
  'apollo8-tli': {
    beats: [
      { s: 0.1, eyebrow: 'Parking orbit', line: 'Two and a half hours from the pad' },
      { s: 0.38, eyebrow: 'The window', line: 'The Moon is already moving where it will be' },
      { s: 0.62, eyebrow: 'S-IVB restart', line: 'The third stage lights again' },
      { s: 0.86, eyebrow: 'Trans-lunar injection', line: 'The moment the mission leaves the Earth' },
      { s: 0.94, eyebrow: 'Ignition', line: 'The third stage, lit on screen' },
    ],
    arc: { swing: 1.05, tilt: 0.36 },
    specs: [
      ['Stage', 'S-IVB · restarted'],
      ['Coast', 'Three days to the Moon'],
      ['Crew', 'Borman · Lovell · Anders'],
      ['Phase', 'Trans-lunar injection'],
    ],
  },
  'apollo8-tei': {
    beats: [
      { s: 0.1, eyebrow: 'Lunar orbit', line: '25 December 1968 · behind the Moon' },
      { s: 0.38, eyebrow: 'Trans-Earth injection', line: 'Lit with no radio contact at all' },
      { s: 0.62, eyebrow: 'The way home', line: 'Fifty-eight hours of coast, and one corridor' },
      { s: 0.86, eyebrow: 'Apollo 8', line: 'The burn for home' },
      { s: 0.94, eyebrow: 'Christmas Day', line: '1968 · lit on time, on the far side' },
    ],
    arc: { swing: 0.95, tilt: 0.48 },
    specs: [
      ['Lit', '25 December 1968'],
      ['Contact', 'None · far side'],
      ['Coast home', '≈ 58 hours'],
      ['Target', 'One entry corridor'],
    ],
  },
  'apollo8-reentry': {
    beats: [
      { s: 0.1, eyebrow: 'Return', line: '11 kilometres a second' },
      { s: 0.38, eyebrow: 'Service module separation', line: 'The heat shield is all that is left' },
      { s: 0.62, eyebrow: 'The corridor', line: 'A quarter of a degree wide' },
      { s: 0.86, eyebrow: 'Re-entry', line: 'Plasma, drogues, canopies, the Pacific' },
      { s: 0.94, eyebrow: 'The Pacific', line: 'Drogues, canopies, and the ship waiting' },
    ],
    arc: { swing: 1.0, tilt: 0.38 },
    specs: [
      ['Speed', '11.0 km/s at entry'],
      ['Shield', 'The heat shield, and nothing else'],
      ['Drogues', 'At 7 km'],
      ['Splashdown', '27 December 1968'],
    ],
  },
}

/** New archive chapters use the same continuous approach and exact hand-off. */
const chapter = (id, arc, specs, pages) => {
  DOSSIERS[id] = { arc, specs, beats: pages.map(([eyebrow, line], i) => ({ s: [0.1, 0.38, 0.62, 0.86, 0.94][i], eyebrow, line })) }
}
chapter('artemis-launch', { swing: 1.15, tilt: 0.38 },
  [['Vehicle', 'SLS Block 1'], ['Payload', 'Orion'], ['Scenario', 'Daylight simulation'], ['Pad', 'Kennedy LC-39B']],
  [['A new generation', 'SLS and Orion, standing beside the tower'], ['Two boosters', 'Solid motors beside a hydrogen core'], ['Beyond low orbit', 'A vehicle built for the Moon'], ['Simulated daylight', 'The hardware is modern; this sky is the model’s'], ['T-60 seconds', 'The last minute before release']])
chapter('apollo8-parking', { swing: 1.0, tilt: 0.35 },
  [['Moment', 'Circularisation complete'], ['World', 'Earth'], ['Next', 'Lunar window'], ['Pace', '10× at hand-over']],
  [['The first orbit', 'Launch and staging are already behind the ship'], ['Falling around Earth', 'Orbital speed, not altitude, keeps it aloft'], ['The third stage waits', 'One restart separates Earth orbit from the Moon'], ['A moving destination', 'The window belongs to where the Moon will be'], ['On orbit', 'The flight computer keeps the real state']])
chapter('apollo8-moon-survey', { swing: 0.9, tilt: 0.5 },
  [['Moment', 'Capture complete'], ['World', 'Moon'], ['Surface', 'LRO + synthetic detail'], ['Dwell', 'One simulated revolution']],
  [['Another world', 'The Moon is now the dominant attractor'], ['Capture complete', 'The service engine has traded speed for an orbit'], ['The far side', 'No horizon here leads straight back to Earth'], ['Lunar relief', 'Basins in the maps; smaller craters beneath them'], ['One revolution', 'Watch the orbit before the burn for home']])
chapter('apollo11-csi', { swing: 0.8, tilt: 0.55 },
  [['Burn', 'Coelliptic initiation'], ['Craft', 'Eagle'], ['Target', 'Columbia'], ['Reference', 'Apollo 11 ascent sequence']],
  [['Above Tranquility', 'The descent stage stays where the crew left it'], ['Columbia', 'Collins waits in a higher lunar orbit'], ['Coelliptic initiation', 'The first deliberate reshape after insertion'], ['Relative motion', 'To catch a spacecraft, change the orbit first'], ['The rendezvous begins', 'Small burns, long arcs, one docking port']])
chapter('apollo11-final-docking', { swing: 0.85, tilt: 0.5 },
  [['Moment', 'Final approach'], ['Range', 'About 30 metres'], ['Craft', 'Eagle + Columbia'], ['Pace', 'Real time at hand-over']],
  [['Two spacecraft', 'Two trajectories have become one rendezvous'], ['Station-keeping', 'The target no longer sweeps across the window'], ['Thirty metres', 'Distance measured between craft, not map markers'], ['The last approach', 'A fraction of a metre a second'], ['Contact ahead', 'Probe, drogue, and the way home']])
chapter('apollo8-canopies', { swing: 1.0, tilt: 0.3 },
  [['Moment', 'Main deployment'], ['World', 'Earth'], ['Sequence', 'After the drogues'], ['End', 'Ocean splashdown']],
  [['Back in the air', 'The lunar voyage has become a descent'], ['The heat shield', 'Orbital energy has gone into the atmosphere'], ['Drogues first', 'Stabilised before the main canopies'], ['Under parachutes', 'The last kilometres belong to gravity and drag'], ['The Pacific', 'An ocean, not a runway']])

/* ---------------------------------------------------------------- *
 * The flight: one continuous zoom, from a star to a frame
 * ---------------------------------------------------------------- */

/** The running intro. The UI reads it; the rig calls `introStep`. */
export const INTRO = {
  active: false,
  t: 0,
  duration: 40,
  s: 0,
  beat: -1,
  presetId: null,
  finalFocus: 'earth',
  /** Where the lens is pointed this frame, in the floating origin's frame.
   * The rig parks OrbitControls' target here so the hand-off out of the intro
   * flies from a coherent state. Built once in `introStart`. */
  look: null,
  dossier: null,
}

/*
 * The shape of the flight, and why it is this shape.
 *
 * The first version was four Béziers through five points, a quarter of the
 * clock each — half an AU in the first quarter and the last few kilometres in
 * the fourth — with the gaze sliding in a straight line from Earth's centre to
 * the pad. Watched, it did two things wrong. The camera dropped the last
 * 1,500 km in under a second, and for the seconds before that it stared at
 * whatever the line from the planet's centre happened to cross: open Pacific,
 * then a lurch across to Florida. And it ended 900 m straight over the pad and
 * then *cut* to the observer on the ground, because the flight's last frame and
 * the mission's first were not the same frame.
 *
 * So the flight is now a single scale journey toward one point — the thing
 * the mission's first shot looks at — and every part of it is smooth:
 *
 *   - **Distance** falls log-linearly: every second of the flight the view
 *     closes by about the same *factor*, which is what reads as steady motion
 *     across fourteen decades, easing out to rest on the last frame.
 *   - **The gaze** never leaves the destination. From 25 AU it is also nearly
 *     the direction of the Sun — which is the opening shot, a star among stars
 *     — and as the camera closes, the world the destination is on grows round
 *     it, then the ground, then the vehicle.
 *   - **The direction** the camera comes in from swings through four keys: the
 *     sunward side for the opening, the world's lit three-quarter face as it
 *     fills the frame, straight down over the site for the descent, and finally
 *     the mission's own camera — eye level beside the pad, behind the hull —
 *     so the last frame of the flight *is* the first frame of the mission and
 *     the hand-over is not an event at all.
 *
 * `restingPose` (gfx/shotPoses.js) says where that first frame is; the rig
 * uses the same function, so the two cannot disagree.
 */

const AU_M = 1.495978707e11
/** Where the flight opens: far enough that the Sun is a star, near enough to find it. */
const OPEN_DISTANCE = 25 * AU_M
/** Lens at the opening: wide on the star field. */
const OPEN_FOV = 52
/** How far off the Sun line the opening stands, rad, so the Sun is passed rather than flown through. */
const SUN_OFFSET = 0.42

const V = new THREE.Vector3()
const V2 = new THREE.Vector3()
const UP = new THREE.Vector3(0, 1, 0)
const F = new THREE.Vector3() // the destination: what the first shot looks at (absolute)
const HOST = new THREE.Vector3()
const HOST_RADIAL = new THREE.Vector3()
let hostFloor = 0
const FC = new THREE.Vector3() // the first shot's camera (absolute)
const FU = new THREE.Vector3() // its up
const KEY_U = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()]
const KEY_S = [0, 0.46, 0.8, 1]
const UP_OPEN = new THREE.Vector3(0, 1, 0)
const _u = new THREE.Vector3()
const _up = new THREE.Vector3()
const _perp2 = new THREE.Vector3()
const POSE = makePose()
const FLIGHT = { lnD0: 0, lnD1: 0, fov1: 45, power: 1.04 }

/** Smootherstep. */
const smoother = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * x * (x * (x * 6 - 15) + 10))

/** Spherical interpolation between unit vectors (writes out). */
function slerpDir(out, a, b, t) {
  const d = Math.min(1, Math.max(-1, a.dot(b)))
  if (d > 0.9999) return out.copy(a).lerp(b, t).normalize()
  const th = Math.acos(d)
  const sn = Math.sin(th)
  const wa = Math.sin((1 - t) * th) / sn
  const wb = Math.sin(t * th) / sn
  return out.set(a.x * wa + b.x * wb, a.y * wa + b.y * wb, a.z * wa + b.z * wb)
}

/** The direction from the destination to the camera at path fraction s. */
function directionAt(out, s) {
  for (let i = 0; i < KEY_S.length - 1; i++) {
    if (s <= KEY_S[i + 1] || i === KEY_S.length - 2) {
      const k = (s - KEY_S[i]) / (KEY_S[i + 1] - KEY_S[i])
      return slerpDir(out, KEY_U[i], KEY_U[i + 1], smoother(Math.min(1, Math.max(0, k))))
    }
  }
  return out.copy(KEY_U[KEY_U.length - 1])
}

/** Distance from the destination at path fraction s: log-linear, easing out. */
function distanceAt(s) {
  const w = 1 - Math.pow(1 - Math.min(1, Math.max(0, s)), FLIGHT.power)
  return Math.exp(FLIGHT.lnD0 + (FLIGHT.lnD1 - FLIGHT.lnD0) * w)
}

/** The camera, absolute, at path fraction s. */
export function introCameraAt(out, s) {
  directionAt(_u, s)
  out.copy(F).addScaledVector(_u, distanceAt(s))
  // The direction swings toward an eye-level endpoint. During that swing a
  // chord can dip below the host even if every anchor is outside it. Enforce
  // the radial envelope analytically, retaining the exact resting endpoint.
  HOST_RADIAL.subVectors(out, HOST)
  const radius = HOST_RADIAL.length()
  if (radius < hostFloor && radius > 0) out.copy(HOST).addScaledVector(HOST_RADIAL, hostFloor / radius)
  return out
}

/** The bodies a path must stay out of, absolute: [centre, clearance, isHost]. */
function obstacles(host) {
  const list = [
    [live.abs.sun, BODIES.sun.radius * 1.6, false],
    [live.abs.earth, BODIES.earth.radius * 1.004, host === live.abs.earth],
    [live.abs.moon, BODIES.moon.radius * 1.004, host === live.abs.moon],
  ]
  for (const p of RAILS) {
    const q = new THREE.Vector3().copy(live.railPos[p.id]).add(live.origin)
    list.push([q, p.radius * 1.2, false])
  }
  return list
}

/**
 * Closest approach of the planned path to anything, as a multiple of that
 * thing's clearance. The host is exempt for the descent — landing beside the
 * pad is the point — and nowhere else.
 */
function worstClearance(obs) {
  let worst = Infinity
  for (let i = 0; i <= 600; i++) {
    const s = i / 600
    introCameraAt(V2, s)
    for (const [c, clear, isHost] of obs) {
      if (isHost && s > 0.85) continue
      const r = V2.distanceTo(c) / clear
      if (r < worst) worst = r
    }
  }
  return worst
}

/**
 * Begin an intro for `presetId`, landing on `finalFocus`'s first frame. The sky
 * holds still through the flight — the sim is paused — so every key is taken
 * now, from the live ephemeris.
 */
export function introStart(presetId, finalFocus = 'earth') {
  const d = DOSSIERS[presetId] ?? DOSSIERS['apollo8-launch']
  const arc = d.arc ?? {}

  // The frame the mission opens on, from the function the rig itself uses.
  if (!restingPose(finalFocus, POSE)) restingPose('earth', POSE)
  F.copy(POSE.look).add(live.origin)
  FC.copy(POSE.cam).add(live.origin)
  FU.copy(POSE.up)
  FLIGHT.fov1 = POSE.fov
  const dF = Math.max(FC.distanceTo(F), 1)
  FLIGHT.lnD0 = Math.log(OPEN_DISTANCE)
  FLIGHT.lnD1 = Math.log(dF)

  // The world the destination belongs to.
  const toEarth = V.copy(live.abs.earth).distanceTo(F)
  const toMoon = V.copy(live.abs.moon).distanceTo(F)
  const host = toMoon < toEarth ? live.abs.moon : live.abs.earth
  HOST.copy(host)
  const bodyR = host === live.abs.moon ? BODIES.moon.radius : BODIES.earth.radius
  hostFloor = bodyR + Math.max(0.1, Math.min(100, FC.distanceTo(host) - bodyR))

  // Key 3: the first shot's own direction.
  KEY_U[3].subVectors(FC, F).normalize()

  // Key 2: straight down over the destination for a surface shot — the
  // descent — or the shot's own direction for one in space.
  const hostR = host === live.abs.moon ? BODIES.moon.radius : BODIES.earth.radius
  const fromHost = V.copy(F).sub(host).length()
  const onSurface = fromHost > hostR * 0.5 && fromHost < hostR * 1.02
  if (onSurface) {
    KEY_U[2].subVectors(F, host).normalize()
    KEY_U[2].lerp(KEY_U[3], 0.22).normalize()
  } else {
    KEY_U[2].copy(KEY_U[3])
  }

  // Key 0: sunward, off the Sun line by SUN_OFFSET and tilted by the arc.
  const sun = V2.copy(live.abs.sun).sub(F).normalize()
  _perp2.crossVectors(sun, UP_OPEN)
  if (_perp2.lengthSq() < 1e-8) _perp2.set(1, 0, 0)
  _perp2.normalize()

  // Key 1: the host's lit three-quarter face, which is the world filling the frame.
  const buildKeys = (twist) => {
    KEY_U[0]
      .copy(sun)
      .applyAxisAngle(_perp2, SUN_OFFSET * (arc.swing ?? 1))
      .addScaledVector(UP_OPEN, (arc.tilt ?? 0.35) * 0.35)
      .normalize()
    V.subVectors(live.abs.sun, host).normalize()
    _up.crossVectors(UP_OPEN, V).normalize()
    KEY_U[1].copy(V).multiplyScalar(0.62).addScaledVector(_up, 0.72).addScaledVector(UP_OPEN, 0.3).normalize()
    if (twist !== 0) KEY_U[1].applyAxisAngle(V, twist)
  }
  const obs = obstacles(host)
  let best = -Infinity
  let bestTwist = 0
  // Twist the middle key round the Sun line until nothing is in the way.
  for (const twist of [0, 0.6, -0.6, 1.2, -1.2, 1.8, -1.8, 2.6, -2.6, Math.PI]) {
    buildKeys(twist)
    const c = worstClearance(obs)
    if (c > best) {
      best = c
      bestTwist = twist
    }
    if (c > 1.05) break
  }
  buildKeys(bestTwist)

  INTRO.active = true
  INTRO.t = 0
  INTRO.s = 0
  INTRO.beat = -1
  INTRO.presetId = presetId
  INTRO.finalFocus = finalFocus
  INTRO.dossier = d
  if (!INTRO.look) INTRO.look = new THREE.Vector3()
  INTRO.look.subVectors(F, live.origin)
  return d
}

/**
 * Advance the flight by `delta` seconds and place the camera. Returns the
 * beat index when it changes (−1 between beats, −2 when done), so the UI
 * turns pages on events rather than polling. Allocation-free.
 */
export function introStep(camera, delta) {
  if (!INTRO.active) return -2
  INTRO.t += Math.max(0, Math.min(delta, 0.1))
  const raw = Math.min(1, INTRO.t / INTRO.duration)
  // Out of stillness, steady through the middle, settling onto the first frame.
  const s = raw * raw * (3 - 2 * raw)
  INTRO.s = raw

  introCameraAt(V, s)
  camera.position.subVectors(V, live.origin)
  INTRO.look.subVectors(F, live.origin)
  // The horizon comes level as the shot does: world up far out, the shot's up at the end.
  _up.copy(UP).lerp(FU, smoother((s - 0.7) / 0.3)).normalize()
  camera.up.copy(_up)
  camera.lookAt(INTRO.look)

  // The lens: wide on the stars, then the first shot's own.
  const fov = OPEN_FOV + (FLIGHT.fov1 - OPEN_FOV) * smoother((s - 0.55) / 0.45)
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

/** The flight's destination and first frame, absolute — for the gate. */
export const introTarget = () => ({ look: F.clone(), cam: FC.clone(), up: FU.clone(), fov: FLIGHT.fov1 })
