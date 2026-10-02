import { Vector3 } from 'three'
import { BODIES } from '../sim/constants.js'
import { SPIN_AXIS } from '../sim/atmosphere.js'
import { siteDirection } from '../sim/launchsite.js'
import { live } from '../sim/live.js'
import { padFor } from './pads.js'
import { moonAxes, moonClock } from '../sim/moonFrame.js'
import { groundProbe, probeGround, siteAxes } from './moonTerrain.js'

/**
 * Standing on the ground, watching.
 *
 * Every other camera in this simulator is a machine's: a chase camera riding
 * behind the vehicle, a ground camera on a long lens, a free camera anywhere in
 * the solar system. This one is a person's. It stands on the graded ground
 * beside the pad with its eye at head height, looks through a lens as wide as
 * an eye, and keeps its head level with the horizon — so a launch is seen at
 * the scale it happens at, which is the one thing every other view hides.
 *
 * ── where the person stands, and why there ────────────────────────────
 *
 * Derived, not placed, and the rule is ranked: each condition decides only what
 * the one before it left open.
 *
 * **Across the flame trench.** This is the one that decides the picture, and
 * the first version of this file did not have it. It stood across the *flight
 * path* instead — which at Kennedy, where the flight path runs east and the
 * trench runs north–south, put the observer due south, looking straight down
 * the trench. Both steam jets then travelled along the line of sight, one at
 * the camera and one away from it, and stacked into a single grey egg that hid
 * the vehicle. Rendered, it was unmistakable, and nothing numeric had flagged
 * it. Standing across the trench, the two jets billow left and right with the
 * vehicle standing clear between them, which is the picture of a launch.
 *
 * **On the side the vehicle flies away from.** Of the two sides of the trench,
 * the one opposite the flight path has the vehicle climb and then recede. The
 * other has it come overhead, where a camera looking straight up has no horizon
 * left to be level with and `lookAt` against a local-up vector degenerates.
 *
 * **Then the Sun.** Where the trench runs across the flight path, both sides
 * are equally good on the first two counts, and the one the Sun is on puts the
 * light behind the viewer so the face turned to them is lit. A pad with no
 * trench — Baikonur stands over an open pit — takes the flight path's normal
 * instead of the trench's and goes straight to this.
 *
 * The distance is inside the graded complex: `FLAT_RADIUS` is 400 m and this
 * stands at 380, so the ground under the observer is the datum Terrain grades
 * to and the eye height is exact rather than an estimate over real relief. It
 * is the distance of a remote camera trap, not of anywhere a person could
 * survive a Saturn V; this is a view, not a safety claim.
 *
 * ── the axis east is taken from ───────────────────────────────────────
 *
 * The spin axis, `SPIN_AXIS`, tilted 23.44 degrees from the scene's +y. The pad
 * camera in `CameraRig` takes "east" from +y instead, which puts its sideways
 * offset up to the obliquity away from true east — harmless there, since
 * nothing about that shot depends on which way east is. Here it matters: the
 * launch azimuth is measured from true north, so a wrong east would stand the
 * observer at the wrong angle to the flight path they are meant to be across.
 */

/*
 * Module-local, then exported as aliases. The frame path reads the locals:
 * `gfx/sunlight.js` measured an exported const read inside a hot function
 * costing 16.62 bytes a call against 0.83 for a local, because V8 folds a plain
 * local into the function and will not fold a module cell.
 */
const EYE = 1.75
const OFF = 380
const FOV = 65

/** Eye height above the ground, m. */
export const EYE_HEIGHT = EYE

/** Vertical field of view, degrees — about what a person takes in without moving their eyes. */
export const EYE_FOV = FOV

/** How far from the pad the observer stands, m. Inside `FLAT_RADIUS` (400), so the ground is graded. */
export const STAND_OFF = OFF

const R = BODIES.earth.radius
const DEG = Math.PI / 180
const AX = SPIN_AXIS[0]
const AY = SPIN_AXIS[1]
const AZ = SPIN_AXIS[2]
const _up = new Vector3()
const _launch = new Vector3()
const _across = new Vector3()

/**
 * The observer's eye, in scene coordinates, written into `out`.
 *
 * Also writes the local vertical at the observer into `up` — which is what the
 * camera's up vector is set to, so its head stays level with *its own* horizon
 * rather than with the pad's, 380 m away and very slightly tilted from it.
 *
 * Written out in scalars rather than through three's vector methods, and that
 * is deliberate rather than stylistic. The first version chained `crossVectors`,
 * `multiplyScalar(Math.cos(az))`, `addScaledVector(v, R + EYE_HEIGHT)` and the
 * rest, and measured **62 bytes a call** — four computed doubles each handed to
 * a method V8 did not inline, each one boxed. It runs every frame the ground
 * view is up, and the render loop allocates nothing. Every intermediate here is
 * a local double; the only writes are into the components of vectors that
 * already exist.
 *
 * And the time is read here, from `live.sim.t`, rather than passed in. With
 * everything above written out, the body measured 0.82 bytes a call — and the
 * call still cost 15, all of it the time argument: a bare double handed to a
 * function V8 does not inline is boxed at the boundary, where vectors pass by
 * reference and cost nothing. `sunlight.js`'s `padScenePoint` reads the clock
 * the same way and for the same reason; a gate sets `live.sim.t` to place the
 * observer at another hour.
 */
export function groundViewpoint(out, up, site, sunDir, earthPos) {
  siteDirection(_up, site, live.sim.t)
  const ux = _up.x
  const uy = _up.y
  const uz = _up.z

  // East: the spin axis crossed with up, normalised.
  let ex = AY * uz - AZ * uy
  let ey = AZ * ux - AX * uz
  let ez = AX * uy - AY * ux
  let n = Math.sqrt(ex * ex + ey * ey + ez * ez)
  if (n < 1e-12) {
    ex = 1
    ey = 0
    ez = 0
    n = 1
  }
  ex /= n
  ey /= n
  ez /= n

  // North: up crossed with east.
  const nx = uy * ez - uz * ey
  const ny = uz * ex - ux * ez
  const nz = ux * ey - uy * ex

  // The flight path's horizontal direction, from its azimuth off true north.
  const a = site.azimuth * DEG
  const ca = Math.cos(a)
  const sa = Math.sin(a)
  const lx = nx * ca + ex * sa
  const ly = ny * ca + ey * sa
  const lz = nz * ca + ez * sa

  // Across the trench if there is one, across the flight path if not.
  const pad = padFor(site.id)
  let tx = lx
  let ty = ly
  let tz = lz
  if (pad.trench > 0) {
    const ew = pad.trenchAxis === 'ew'
    tx = ew ? ex : nx
    ty = ew ? ey : ny
    tz = ew ? ez : nz
  }
  let cx = uy * tz - uz * ty
  let cy = uz * tx - ux * tz
  let cz = ux * ty - uy * tx

  // The side the vehicle flies away from; where both sides are level on that,
  // the side the Sun is on.
  const toward = cx * lx + cy * ly + cz * lz
  let flip = false
  if (toward > 0.2) flip = true
  else if (!(toward < -0.2)) {
    const sd = sunDir.x * ux + sunDir.y * uy + sunDir.z * uz
    const hx = sunDir.x - sd * ux
    const hy = sunDir.y - sd * uy
    const hz = sunDir.z - sd * uz
    flip = cx * hx + cy * hy + cz * hz < 0
  }
  if (flip) {
    cx = -cx
    cy = -cy
    cz = -cz
  }

  // Along the surface by OFF, then up to the eye. The ground here is the graded
  // datum, which is the sphere itself, so the eye is R + EYE out along the
  // observer's own radial — not along the pad's.
  let ox = ux * R + cx * OFF
  let oy = uy * R + cy * OFF
  let oz = uz * R + cz * OFF
  const on = Math.sqrt(ox * ox + oy * oy + oz * oz)
  ox /= on
  oy /= on
  oz /= on
  up.x = ox
  up.y = oy
  up.z = oz
  const k = R + EYE
  out.x = earthPos.x + ox * k
  out.y = earthPos.y + oy * k
  out.z = earthPos.z + oz * k

  _across.x = cx
  _across.y = cy
  _across.z = cz
  _launch.x = lx
  _launch.y = ly
  _launch.z = lz
  return out
}

/**
 * The two horizontal directions the last placement was built from — which side
 * the observer stands on, and which way the vehicle will fly — copied out for a
 * gate to check against each other. Read after `groundViewpoint`.
 */
export function lastPlacement(across, launch) {
  across.copy(_across)
  launch.copy(_launch)
}

/**
 * A point standing on the graded ground at an Earth pad, `east` and `south`
 * metres from the site, eye `eye` metres up.
 *
 * The height is the datum and that is not an approximation here: `Terrain.jsx`
 * grades the complex flat to `FLAT_RADIUS` — 400 m — because a launch complex
 * *is* graded flat, and the drawn ground inside that circle is the datum. Past
 * it the real relief takes over and this would start to lie, so the walker's
 * leash is shorter than the grading (see `components/CameraRig.jsx`).
 *
 * East is taken from the spin axis, the same axis `groundViewpoint` above uses
 * and the same one the clamp and the drag model share, so the ground a person
 * walks on turns with the vehicle standing on it rather than drifting away
 * from it at 465 m/s.
 */
const _siteUp = new Vector3()
const _siteEast = new Vector3()
const _siteNorth = new Vector3()
const _spin = new Vector3(SPIN_AXIS[0], SPIN_AXIS[1], SPIN_AXIS[2])

export function earthStand(out, up, site, east, south, eye = EYE) {
  siteDirection(_siteUp, site, live.sim.t)
  _siteEast.crossVectors(_spin, _siteUp)
  if (_siteEast.lengthSq() < 1e-12) _siteEast.set(1, 0, 0)
  _siteEast.normalize()
  _siteNorth.crossVectors(_siteUp, _siteEast).normalize()
  const R = BODIES.earth.radius
  const e = live.pos.earth
  out.x = e.x + _siteUp.x * (R + eye) + _siteEast.x * east - _siteNorth.x * south
  out.y = e.y + _siteUp.y * (R + eye) + _siteEast.y * east - _siteNorth.y * south
  out.z = e.z + _siteUp.z * (R + eye) + _siteEast.z * east - _siteNorth.z * south
  up.copy(_siteUp)
  return out
}

/* ---------------------------------------------------------------- *
 * On the Moon
 * ---------------------------------------------------------------- */

/**
 * Where a person would stand to watch the LM go: 30 m out, south-south-west.
 *
 * Nobody did, for Apollo 11 — the only film is from Eagle's own window — so
 * this is placed for what the ground is like there, not for a record. The LM
 * faces west and flies west, and the Sun is 22° up in the east, so an observer
 * to the south-south-west has it lit from the right: the east faces in sun,
 * the shadows running long to the left, the ascent stage crossing the frame
 * right to left as it pitches over. 30 m keeps the whole LM, 7 m tall, in the
 * lower part of the frame with the ground it stands on, and is outside most of
 * the descent stage's blown-off insulation. The eye is 1.75 m above the
 * real ground under the observer, from the same heights the ground is drawn
 * with.
 */
const LUNAR_OFF = 30
const LUNAR_AZIMUTH = 205 * DEG
const R_MOON = BODIES.moon.radius
const _mx = new Float64Array(9)
const _frame = new Float64Array(9)
let _axes = null
let _axesFor = ''

/**
 * The site's own frame in the scene, and the ground's height in it.
 *
 * Nine numbers out: east, up and south at the site, as scene directions, built
 * from the site's body-fixed axes turned by the Moon's own rotation. It is the
 * frame everything standing on the Moon shares — the observer below, and the
 * walker in `components/CameraRig.jsx` — so a person who walks away from the
 * viewpoint walks on the same ground the viewpoint was standing on, by
 * construction rather than by two files agreeing.
 *
 * Allocation-free: the axes are cached per site and the Moon's rotation goes
 * into a module-level array.
 */
export function lunarSiteFrame(out, site) {
  if (_axesFor !== site.id) {
    _axes = siteAxes(site.latitude, site.longitude)
    _axesFor = site.id
  }
  const A = _axes
  moonClock[0] = live.sim.t
  moonAxes(_mx)
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      out[r * 3 + c] = A[r * 3] * _mx[c] + A[r * 3 + 1] * _mx[3 + c] + A[r * 3 + 2] * _mx[6 + c]
    }
  }
  return out
}

/**
 * A point standing on the lunar ground at `east`, `south` metres from the
 * site, with its eye `eye` metres above the surface there.
 *
 * `lunarViewpoint` is this with the observer's own offsets; the walker is this
 * with whatever offsets the feet have reached. Writes the scene position into
 * `out` and the local vertical into `up`, and allocates nothing.
 */
export function lunarStand(out, up, site, east, south, eye = EYE) {
  const F = lunarSiteFrame(_frame, site)
  groundProbe[0] = east
  groundProbe[1] = south
  probeGround()
  const h = groundProbe[2] + eye
  const moon = live.pos.moon
  out.x = moon.x + F[3] * (R_MOON + h) + F[0] * east + F[6] * south
  out.y = moon.y + F[4] * (R_MOON + h) + F[1] * east + F[7] * south
  out.z = moon.z + F[5] * (R_MOON + h) + F[2] * east + F[8] * south
  // The stander's own vertical, so the horizon is level.
  up.x = out.x - moon.x
  up.y = out.y - moon.y
  up.z = out.z - moon.z
  const n = Math.sqrt(up.x * up.x + up.y * up.y + up.z * up.z)
  up.x /= n
  up.y /= n
  up.z /= n
  return out
}

export function lunarViewpoint(out, up, site) {
  return lunarStand(out, up, site, LUNAR_OFF * Math.sin(LUNAR_AZIMUTH), -LUNAR_OFF * Math.cos(LUNAR_AZIMUTH))
}

/**
 * Where the observer is standing, as metres east and south of the site.
 *
 * The walker starts here rather than a few metres from the pad, so putting the
 * boots on is a change of control and not of place. Both offsets come from the
 * placements above rather than being restated: the Moon's from its own two
 * constants, Earth's by projecting the across-the-trench direction
 * `groundViewpoint` chose onto the site's east and north. Earth's therefore
 * requires `groundViewpoint` to have run for this site — which the caller does,
 * because it is placing the camera it is about to hand over from.
 */
export function standOffsets(out, site) {
  if (site.body === 'moon') {
    out[0] = LUNAR_OFF * Math.sin(LUNAR_AZIMUTH)
    out[1] = -LUNAR_OFF * Math.cos(LUNAR_AZIMUTH)
    return out
  }
  siteDirection(_siteUp, site, live.sim.t)
  _siteEast.crossVectors(_spin, _siteUp)
  if (_siteEast.lengthSq() < 1e-12) _siteEast.set(1, 0, 0)
  _siteEast.normalize()
  _siteNorth.crossVectors(_siteUp, _siteEast).normalize()
  out[0] = OFF * _across.dot(_siteEast)
  out[1] = -OFF * _across.dot(_siteNorth)
  return out
}
