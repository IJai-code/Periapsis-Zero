/**
 * Where the craft goes if nothing further is commanded.
 *
 * Integrated forward, not solved. A conic would be cheaper and would be wrong
 * in exactly the places this simulator spends its time: a translunar coast is
 * not a two-body problem, an NRHO is a periodic orbit of the *three*-body
 * problem and has no conic at all, and a low orbit decays through air that a
 * conic cannot see. Running the same RK4 that flies the mission means the
 * projection inherits every perturbation the flight does, for free, and cannot
 * disagree with it about the physics.
 *
 * The projection is ballistic: thrust is zeroed, drag is kept. Thrust is the
 * pilot's, and a line that assumed the current throttle would swing wildly
 * every time it changed; drag is the vehicle's and the air's, and ignoring it
 * would draw a confident closed ellipse through the atmosphere.
 *
 * Everything here is preallocated and reused. The projection is refreshed
 * several times a second while the map is open, so it sits close enough to the
 * render loop that the zero-allocation rule applies to it.
 */
import { Vector3 } from 'three'
import { BODIES, G, ORDER } from './constants.js'
import { dominantBody } from './soi.js'
import { INDEX } from './system.js'
import { nodeBasis, resolveNode } from './nodes.js'
import { MU_EARTH, MU_MOON, timestepLimit } from './ship.js'
import { ATMOSPHERE_TOP, density } from './atmosphere.js'

/** Most points drawn. The integration takes many more; these are chosen from it. */
export const SAMPLES = 512

/**
 * RK4 steps per *local* circular period.
 *
 * The step is sized from where the craft is — the circular period at its
 * current distance, over Earth and the Moon — the criterion the flight
 * integrator already uses at 400. It replaces a fixed fraction of the span,
 * which is the same thing on a circle and nothing like it on an ellipse: over
 * one revolution of a translunar ellipse (e 0.916), 2,048 equal steps left
 * 252.5 km of error where 2,048 steps scaled to the local period left 1.7 m.
 * Equal steps spend the budget where the craft is slow and starve perigee,
 * where it is fast; this does the opposite, and it converges cleanly at fourth
 * order — 113 km, 7.4 km, 473 m, 29 m as the divisor doubles from 100 to 800.
 * scripts/verify-horizon.mjs measures the value chosen here.
 */
export const STEPS_PER_LOCAL_PERIOD = 1024

/**
 * Integration steps a single projection may take.
 *
 * A budget, not a horizon: a low orbit costs about 1,024 steps a revolution, a
 * five-day translunar coast a few hundred because the steps grow with distance.
 * When a plan needs more than this — a node placed a week of low orbits away —
 * the projection stops and says so in `truncated`, rather than taking as long
 * as it takes inside a render frame.
 */
export const MAX_STEPS = 8192

/**
 * The longest any projection looks ahead, in seconds.
 *
 * Only a backstop. A bound orbit ends after one revolution, and a plan one
 * revolution after its last burn; this bounds the paths that never close — an
 * escape, a transfer, a flyby. Eight days covers the 5.3-day translunar coast
 * this sequencer flies and one revolution of any member of the NRHO family,
 * whose periods run from 6.15 to 7.24 days.
 */
export const OPEN_HORIZON = 8 * 86400

/**
 * How many nodes a projection records a full orbital frame for.
 *
 * The frames exist so the gizmo can draw the axes a burn will actually be
 * measured against — the ones the integrator used, at the instant it used them,
 * rather than a second guess computed from the craft's *present* state. Eight
 * is more nodes than any plan this sequencer flies, and the cap is here because
 * the buffer is preallocated; nodes past it are still applied, just not drawn
 * with handles.
 */
export const MAX_NODE_FRAMES = 8

/**
 * A projection result. Two exist: what happens if nothing is commanded, and
 * what happens if the planned nodes are flown. Both are refreshed in place.
 */
function makeProjection() {
  return {
  /** Samples actually written this pass. */
  count: 0,
  /** Integration steps the pass took. */
  steps: 0,
  /** True when the step budget ran out before the horizon did. */
  truncated: false,
  /** Positions relative to `reference`, metres, xyz per sample. */
  points: new Float64Array(SAMPLES * 3),
  /**
   * Seconds from now, per sample. Not evenly spaced: samples are dense where the
   * path bends and sparse where it runs straight, so anything mapping a point on
   * the line to an instant must interpolate these rather than assume a stride.
   */
  times: new Float64Array(SAMPLES),
  /** Which body the path is drawn around. */
  reference: 'earth',
  /**
   * Absolute simulated time this pass started from; `times` are measured from it.
   *
   * Needed because the two projections are refreshed on different triggers — the
   * ballistic one on a clock, the planned one whenever the plan changes — so
   * their epochs can be measured from instants a fifth of a second apart. A
   * click on one line converted through the *live* clock instead of through its
   * own pass lands 1.5 km away at orbital speed.
   */
  t0: 0,
  /** Simulated span covered, s. */
  span: 0,
  /** True when the pass ended by completing a revolution, rather than at a limit. */
  closed: false,
  /** Apsides, as sample indices with refined values. Index -1 when absent. */
  apoapsis: { index: -1, radius: 0, time: 0 },
  periapsis: { index: -1, radius: 0, time: 0 },
  /** Set when the path meets any body's surface, and which. */
  impact: { index: -1, time: 0, body: null },
  /** Node ids folded into this pass, in the order they fired. */
  applied: [],
  /** Sample index each applied node fired at, parallel to `applied`. */
  nodeSamples: [],
  /**
   * The orbital frame at each applied node, up to MAX_NODE_FRAMES, laid out as
   * twelve doubles: position, then prograde, normal and radial-out unit
   * vectors, all relative to `reference`.
   *
   * Recorded rather than recomputed. The frame is defined by the state the
   * integrator had reached at the node's exact instant — which is mid-step, not
   * at a sample — so anything reconstructing it from the drawn polyline would
   * be reading a slightly different orbit than the one the burn was applied to.
   */
  nodeFrames: new Float64Array(MAX_NODE_FRAMES * 12),
  /** Seconds from now at which each recorded node fires, parallel to the frames. */
  nodeTimes: new Float64Array(MAX_NODE_FRAMES),
  /**
   * Speed relative to `reference` at each recorded node, m/s.
   *
   * Recorded because the gizmo's drag sensitivity is a fraction of it — a burn
   * planned two days out at the far end of a translunar coast is happening at
   * 200 m/s, not the 10 km/s the craft is doing now, and a handle geared to the
   * craft's present speed would be fifty times too coarse there.
   */
  nodeSpeeds: new Float64Array(MAX_NODE_FRAMES),
  /**
   * The body each recorded node is measured against — the one whose sphere of
   * influence the craft is inside at the node's own instant.
   *
   * Per node, because a plan can span more than one. A translunar injection is
   * written against Earth and the capture burn three days later against the
   * Moon, and resolving both against the body the *line* happens to be drawn
   * around put a capture burn 23.5 degrees off retrograde and 91.3 off normal:
   * measured at periselene, an 839 m/s circularisation that should leave a
   * 95.7 x 95.7 km orbit left a periselene 112.5 km below the lunar surface.
   */
  nodeBodies: new Array(MAX_NODE_FRAMES).fill(null),
  /**
   * The orbit each burn leaves the craft on, as periapsis and apoapsis radii
   * about that burn's own body — two doubles per recorded node.
   *
   * Osculating, taken at the instant of the impulse, rather than read off the
   * integrated path afterwards. Two reasons. A burn's result is a fact about
   * that burn, and should not change because a *later* node was added; and a
   * plan whose next burn comes before the orbit reaches an apsis — a Hohmann
   * transfer is exactly that — has no apsis on the path between them to read.
   * Apoapsis is Infinity when the burn opens the orbit.
   */
  nodeApsides: new Float64Array(MAX_NODE_FRAMES * 2),
  /**
   * The body the apsides are measured about: the last node's, or `reference`
   * when there is none. "Resulting orbit" after a capture burn is an orbit of
   * the Moon, and its extremes of distance from Earth describe nothing.
   */
  apsisBody: 'earth',
  /**
   * Sample index at which the last node fired, or -1.
   *
   * The apsis scan starts after it. Scanning the whole span reports whichever
   * extremum comes first, and on a planned path that is usually one the craft
   * reaches *before* the burn — so a radial node that swings apoapsis from 185
   * to 229 km would still print the old 172 km periapsis, which is a true fact
   * about a trajectory the pilot has just decided not to fly.
   */
  lastNode: -1,
  }
}

/** Where the craft goes if nothing further is commanded. */
export const prediction = makeProjection()

/** Where the craft goes if the planned nodes are flown. */
export const plan = makeProjection()

/**
 * Forget what a projection holds, without running one.
 *
 * Needed because the planned path is only re-projected while there is a plan.
 * Delete the last node and the amber line is simply hidden — and `applied` goes
 * on naming a node that no longer exists, with a recorded frame still sitting
 * where it used to be. The editor draws its markers and does its picking from
 * exactly those two, so a deleted node left an invisible marker on screen that
 * kept swallowing clicks: pressing the trajectory where the node had been
 * selected the ghost instead of planning a new burn, and went on doing so
 * indefinitely, since with nothing pending there was never another projection
 * to overwrite it.
 */
export function clearProjection(out) {
  out.count = 0
  out.steps = 0
  out.truncated = false
  out.apsisBody = out.reference
  empty(out.applied)
  empty(out.nodeSamples)
  out.lastNode = -1
  out.apoapsis.index = -1
  out.periapsis.index = -1
  out.impact.index = -1
}

const _fit = { time: 0, value: 0 }

/**
 * Parabolic refinement through three samples.
 *
 * The extremum of a sampled path sits between samples, and taking the nearest
 * one puts an apoapsis marker visibly off the top of the arc. A parabola through
 * the bracketing triple lands it where it belongs.
 *
 * Through unevenly spaced times, because the steps are: fitting the triple as if
 * it were evenly spaced would bias the vertex toward the wider gap, which on an
 * adaptively stepped path is always the slower side of the apsis.
 *
 * Written into one shared result rather than returning a fresh object, which
 * allocates inside a function too large for the optimiser to inline this into.
 * Callers read `time` and `value` before the next call.
 */
function refine(t0, r0, t1, r1, t2, r2) {
  const d0 = t0 - t1
  const d2 = t2 - t1
  const denom = d0 * d2 * (d2 - d0)
  _fit.time = t1
  _fit.value = r1
  if (!(Math.abs(denom) > 0)) return _fit
  const a = ((r2 - r1) * d0 - (r0 - r1) * d2) / denom
  if (!(Math.abs(a) > 0)) return _fit
  const b = (r0 - r1 - a * d0 * d0) / d0
  const offset = -b / (2 * a)
  // A vertex outside its own bracket is noise, not an apsis.
  if (offset < d0 || offset > d2) return _fit
  _fit.time = t1 + offset
  _fit.value = r1 + b * offset + a * offset * offset
  return _fit
}

/**
 * Empty an array without giving back its storage.
 *
 * `arr.length = 0` is the idiom, and V8 answers it by dropping the backing
 * store, so the next push allocates a new one: 152 B a reset, measured, on
 * arrays this module empties every projection. Popping keeps the capacity.
 */
function empty(arr) {
  while (arr.length > 0) arr.pop()
}

/* ---- per-step scratch: every step is kept, and SAMPLES are chosen from it ---- */
const MAX_POINTS = MAX_STEPS + 1
const _pos = new Float64Array(MAX_POINTS * 3) // relative to the reference body
const _time = new Float64Array(MAX_POINTS) // seconds from now
const _radius = new Float64Array(MAX_POINTS) // from the apsis body in force at that step
const _forced = new Uint8Array(MAX_POINTS) // must be drawn: ends, burns, apsides, impact
const _sampleOf = new Int32Array(MAX_POINTS) // which drawn sample a kept step became
const _nodeStep = new Int32Array(64)

/** Massive bodies, for the surface test: state offsets and radii. */
const _bodyOffset = new Int32Array(ORDER.length)
const _bodyRadius = new Float64Array(ORDER.length)
for (let k = 0; k < ORDER.length; k++) {
  _bodyOffset[k] = INDEX[ORDER[k]] * 6
  _bodyRadius[k] = BODIES[ORDER[k]].radius
}

/**
 * Results of the per-step helpers, written here rather than returned.
 *
 * A double returned from a function the optimiser does not inline comes back
 * boxed — a heap number per call — and `project` is too large for everything it
 * calls to be inlined into it. Measured at about 48 B a step, 50 KB a
 * projection, before this; a Float64Array slot is never boxed.
 */
const _out = new Float64Array(3)
const STEP = 0
const RATE = 1
const DRAG_K = 2

const TWO_PI = 2 * Math.PI
/** Swept angle counted as a whole revolution, allowing for the last step's rounding. */
const REVOLUTION = TWO_PI * (1 - 1e-6)
/** Shortest step taken to land exactly on a revolution or a node. */
const MIN_STEP = 1e-3

/**
 * The step for this state: the tightest of the local-period limit about Earth
 * and about the Moon, and the drag limit inside the atmosphere.
 */
function stepFor(s, c) {
  const e = INDEX.earth * 6
  const m = INDEX.moon * 6
  const ex = s[c] - s[e]
  const ey = s[c + 1] - s[e + 1]
  const ez = s[c + 2] - s[e + 2]
  const re = Math.sqrt(ex * ex + ey * ey + ez * ez)
  const mx = s[c] - s[m]
  const my = s[c + 1] - s[m + 1]
  const mz = s[c + 2] - s[m + 2]
  const rm = Math.sqrt(mx * mx + my * my + mz * mz)
  let h = timestepLimit(re, MU_EARTH, STEPS_PER_LOCAL_PERIOD)
  const hm = timestepLimit(rm, MU_MOON, STEPS_PER_LOCAL_PERIOD)
  if (hm < h) h = hm
  /**
   * Drag, which low down is far stiffer than gravity: a capsule at 20 km wants
   * half-second steps where the orbital criterion alone would take five. The
   * same rule live.js applies to the flight integrator, and written out here
   * rather than shared with it because a call cannot carry doubles for free —
   * measured, this one cost 32 B a step, 33 KB a projection, and the same call
   * put an allocation inside the render loop at the other end.
   */
  const dragK = _out[DRAG_K]
  const altitude = re - BODIES.earth.radius
  if (dragK > 0 && altitude < ATMOSPHERE_TOP) {
    const vx = s[c + 3] - s[e + 3]
    const vy = s[c + 4] - s[e + 4]
    const vz = s[c + 5] - s[e + 5]
    const speed = Math.sqrt(vx * vx + vy * vy + vz * vz)
    const accel = dragK * density(altitude) * speed * speed
    if (accel > 0) {
      const hd = (0.02 * speed) / accel
      const bounded = hd > 0.02 ? hd : 0.02
      if (bounded < h) h = bounded
    }
  }
  _out[STEP] = h
}

/** Offset of the body whose surface the craft is at or under, or -1. */
function surfaceUnder(s, c) {
  for (let k = 0; k < _bodyOffset.length; k++) {
    const o = _bodyOffset[k]
    const dx = s[c] - s[o]
    const dy = s[c + 1] - s[o + 1]
    const dz = s[c + 2] - s[o + 2]
    if (dx * dx + dy * dy + dz * dz <= _bodyRadius[k] * _bodyRadius[k]) return k
  }
  return -1
}

/** Angular rate about a body, |r x v| / r^2, rad/s. */
function angularRate(s, c, o) {
  const rx = s[c] - s[o]
  const ry = s[c + 1] - s[o + 1]
  const rz = s[c + 2] - s[o + 2]
  const vx = s[c + 3] - s[o + 3]
  const vy = s[c + 4] - s[o + 4]
  const vz = s[c + 5] - s[o + 5]
  const hx = ry * vz - rz * vy
  const hy = rz * vx - rx * vz
  const hz = rx * vy - ry * vx
  const r2 = rx * rx + ry * ry + rz * rz
  _out[RATE] = r2 > 0 ? Math.sqrt(hx * hx + hy * hy + hz * hz) / r2 : 0
}

/**
 * The osculating apsides an impulse leaves behind, about the body it is measured
 * against. Writes periapsis then apoapsis radii into `out` at `at`.
 *
 * Straight vis-viva on the state the integrator is holding: no second
 * integration, and no dependence on what the path does afterwards.
 */
function apsidesAfter(s, c, b, body, dv, out, at) {
  const mu = G * BODIES[body].mass
  const rx = s[c] - s[b]
  const ry = s[c + 1] - s[b + 1]
  const rz = s[c + 2] - s[b + 2]
  const vx = s[c + 3] - s[b + 3] + dv.x
  const vy = s[c + 4] - s[b + 4] + dv.y
  const vz = s[c + 5] - s[b + 5] + dv.z
  const r = Math.sqrt(rx * rx + ry * ry + rz * rz)
  const v2 = vx * vx + vy * vy + vz * vz
  const energy = v2 / 2 - mu / r
  const hx = ry * vz - rz * vy
  const hy = rz * vx - rx * vz
  const hz = rx * vy - ry * vx
  const h2 = hx * hx + hy * hy + hz * hz
  const a = -mu / (2 * energy)
  const e = Math.sqrt(Math.max(0, 1 + (2 * energy * h2) / (mu * mu)))
  out[at] = a * (1 - e)
  // A hyperbola has no far side. Infinity, rather than the negative radius the
  // algebra gives, so a reader cannot mistake it for a very low orbit.
  out[at + 1] = energy < 0 ? a * (1 + e) : Infinity
}

/** Keep step `k`: position relative to the reference, time, radius about the apsis body. */
function keep(k, s, c, r, a, t) {
  const o = k * 3
  _pos[o] = s[c] - s[r]
  _pos[o + 1] = s[c + 1] - s[r + 1]
  _pos[o + 2] = s[c + 2] - s[r + 2]
  _time[k] = t
  const ax = s[c] - s[a]
  const ay = s[c + 1] - s[a + 1]
  const az = s[c + 2] - s[a + 2]
  _radius[k] = Math.sqrt(ax * ax + ay * ay + az * az)
}

const _dv = new Vector3()
const _fp = new Vector3()
const _fn = new Vector3()
const _fo = new Vector3()

/**
 * Project the craft's path forward.
 *
 * **How far.** With no `horizon`, until the path has swept one full revolution
 * about the body it orbits, counted from the last thing that changed the orbit
 * — the present, or the last planned burn, after which the count restarts about
 * *that* burn's body. So a parking orbit draws one lap; a translunar injection
 * followed by a capture burn draws the coast, the capture, and one lap of the
 * Moon. It stops earlier at any body's surface, and at OPEN_HORIZON or the step
 * budget for paths that never close.
 *
 * Neither a period nor a fixed window could say this. The period in hand was
 * Earth's even while the line was drawn around the Moon — measured in lunar
 * orbit, that is 134 days against the two hours the craft actually takes to go
 * round; and a window long enough for a translunar plan draws a low orbit
 * dozens of times over.
 *
 * A positive `horizon` projects exactly that many seconds instead, with no
 * revolution test — for callers that need a fixed window.
 *
 * **How finely.** Each step is sized from the local period (STEPS_PER_LOCAL_
 * PERIOD), every step is kept, and SAMPLES of them are drawn — spread by how much
 * the drawn line turns and how much time passes, so perigee gets the points
 * perigee needs. Equal spacing in time drew a translunar ellipse's perigee as a
 * chord 31 km underground while every sample on it was 186 km up. Burns,
 * apsides and the impact point are always among the samples drawn.
 *
 * Nodes are folded in as instantaneous velocity changes at their exact times:
 * the step before one is shortened to land on it.
 *
 * @param {object} sim        the live simulation, read only
 * @param {object} scratch    a persistent integrator to run the projection in
 * @param {string} craft      state-vector id of the craft
 * @param {string} reference  body the path is drawn relative to
 * @param {number|null} horizon  seconds to project, or null for one revolution
 * @param {object} out        result to fill; defaults to the ballistic one
 * @param {Array|null} nodes  planned manoeuvres to fold in
 */
export function project(sim, scratch, craft, reference, horizon = null, out = prediction, nodes = null) {
  const fixed = Number.isFinite(horizon) && horizon > 0
  const limit = fixed ? horizon : OPEN_HORIZON

  scratch.resetFrom(sim)
  const s = scratch.state
  const c = INDEX[craft] * 6
  const r = INDEX[reference] * 6
  _out[DRAG_K] = scratch.dragK[INDEX[craft] - ORDER.length] ?? 0

  out.reference = reference
  out.t0 = sim.t
  out.closed = false
  out.truncated = false
  out.apoapsis.index = -1
  out.periapsis.index = -1
  out.impact.index = -1
  out.impact.body = null
  empty(out.applied)
  empty(out.nodeSamples)
  out.lastNode = -1
  out.apsisBody = reference

  /** What "one revolution" is counted about, and what apsides are measured from. */
  let orbitOffset = INDEX[dominantBody(scratch, craft)] * 6
  let apsisOffset = r
  let swept = 0
  let px = s[c] - s[orbitOffset]
  let py = s[c + 1] - s[orbitOffset + 1]
  let pz = s[c + 2] - s[orbitOffset + 2]

  let nodeAt = 0
  let lastNodeStep = -1
  let applied = 0
  let n = 0
  let steps = 0
  _forced[0] = 1
  keep(0, s, c, r, apsisOffset, 0)

  let impact = surfaceUnder(s, c)
  while (impact < 0) {
    // Nodes behind the craft, or already flown, are not part of the plan.
    while (nodes && nodeAt < nodes.length && (nodes[nodeAt].executed || nodes[nodeAt].t < scratch.t - 1e-9)) {
      nodeAt++
    }
    const next = nodes && nodeAt < nodes.length ? nodes[nodeAt] : null

    if (next && next.t - scratch.t <= 1e-9) {
      /**
       * The frame first, then the impulse. The basis is defined by the
       * velocity the craft has *arriving* at the node — applying the burn
       * first and measuring afterwards would rotate prograde by the very
       * thing being measured.
       */
      /**
       * A node being dragged through time is *deferred*: its frame is recorded,
       * so the gizmo stays on it, but its impulse is not applied. The drawn plan
       * is then the path the node is sliding along — every earlier burn, and not
       * its own — which is the line the pointer is picking against. Applying it
       * would draw the node's own result and leave the pilot scrubbing along a
       * trajectory that only exists if the node stays where it already is.
       */
      const deferred = next.deferred === true
      const body = dominantBody(scratch, craft)
      const b = INDEX[body] * 6
      const slot = out.applied.length
      if (slot < MAX_NODE_FRAMES && nodeBasis(s, c, b, _fp, _fn, _fo)) {
        const f = slot * 12
        const fr = out.nodeFrames
        fr[f] = s[c] - s[r]
        fr[f + 1] = s[c + 1] - s[r + 1]
        fr[f + 2] = s[c + 2] - s[r + 2]
        fr[f + 3] = _fp.x; fr[f + 4] = _fp.y; fr[f + 5] = _fp.z
        fr[f + 6] = _fn.x; fr[f + 7] = _fn.y; fr[f + 8] = _fn.z
        fr[f + 9] = _fo.x; fr[f + 10] = _fo.y; fr[f + 11] = _fo.z
        out.nodeTimes[slot] = scratch.t - sim.t
        const vx = s[c + 3] - s[b + 3]
        const vy = s[c + 4] - s[b + 4]
        const vz = s[c + 5] - s[b + 5]
        out.nodeSpeeds[slot] = Math.sqrt(vx * vx + vy * vy + vz * vz)
        out.nodeBodies[slot] = body
      }
      out.applied.push(next.id)
      if (applied < _nodeStep.length) _nodeStep[applied] = n
      applied++
      _forced[n] = 1
      nodeAt++
      if (deferred) {
        // Held out of the path, but still reported: the panel should say what
        // this burn does while the pilot is dragging it about.
        resolveNode(next, s, c, b, _dv)
        if (slot < MAX_NODE_FRAMES) apsidesAfter(s, c, b, body, _dv, out.nodeApsides, slot * 2)
        continue
      }

      // Position stays relative to `reference`, the frame the line and the gizmo
      // are drawn in; only the *axes* belong to the node's own body.
      resolveNode(next, s, c, b, _dv)
      if (slot < MAX_NODE_FRAMES) apsidesAfter(s, c, b, body, _dv, out.nodeApsides, slot * 2)
      s[c + 3] += _dv.x
      s[c + 4] += _dv.y
      s[c + 5] += _dv.z
      lastNodeStep = n

      // A burn is a new orbit: its revolution and its apsides belong to its body.
      out.apsisBody = body
      apsisOffset = b
      orbitOffset = b
      swept = 0
      px = s[c] - s[b]
      py = s[c + 1] - s[b + 1]
      pz = s[c + 2] - s[b + 2]
      _radius[n] = Math.sqrt(px * px + py * py + pz * pz)
      continue
    }

    const elapsed = scratch.t - sim.t
    if (elapsed >= limit - 1e-9) break
    if (!fixed && !next && swept >= REVOLUTION) {
      out.closed = true
      break
    }
    if (steps >= MAX_STEPS) {
      out.truncated = true
      break
    }

    stepFor(s, c)
    let h = _out[STEP]
    if (h > limit - elapsed) h = limit - elapsed
    if (!fixed && !next) {
      // Land the revolution on itself instead of overshooting by a step.
      angularRate(s, c, orbitOffset)
      const rate = _out[RATE]
      if (rate > 0 && swept + rate * h > TWO_PI) h = Math.max((TWO_PI - swept) / rate, MIN_STEP)
    }
    /**
     * Clipped to a node last, and never floored. A minimum step applied after
     * this would carry the craft a millisecond past a burn that was due, and the
     * test at the top of the loop would then see that node as behind it and drop
     * it from the plan without a word.
     */
    if (next && next.t - scratch.t < h) h = next.t - scratch.t

    scratch.step(h)
    steps++
    n++

    const qx = s[c] - s[orbitOffset]
    const qy = s[c + 1] - s[orbitOffset + 1]
    const qz = s[c + 2] - s[orbitOffset + 2]
    const cx = py * qz - pz * qy
    const cy = pz * qx - px * qz
    const cz = px * qy - py * qx
    swept += Math.atan2(Math.sqrt(cx * cx + cy * cy + cz * cz), px * qx + py * qy + pz * qz)
    px = qx
    py = qy
    pz = qz

    _forced[n] = 0
    keep(n, s, c, r, apsisOffset, scratch.t - sim.t)

    /**
     * Stop at a surface — any body's. Past it the integrator is describing a
     * trajectory through rock, and drawing that is worse than drawing nothing:
     * it is the one part of the path the vehicle definitely will not fly.
     */
    impact = surfaceUnder(s, c)
  }
  _forced[n] = 1
  out.steps = steps

  /* ---- apsides, from every kept step, after the last planned burn ---- */
  /**
   * On a closed revolution the radius is periodic, so the scan wraps: the step
   * before the end stands in for the step before the start, and an apsis
   * refined to just before "now" is reported as the next passage, a revolution
   * on. Without the wrap an apsis at either end of the path is never an
   * interior extremum and is simply not found — which is where it always is at
   * the moment this sequencer hands over to TLI alignment, 2 s past apoapsis,
   * and the parking orbit's apoapsis vanished from the map.
   */
  let apoStep = -1
  let periStep = -1
  const origin = lastNodeStep >= 0 ? lastNodeStep : 0
  const wrap = out.closed && n - origin >= 3
  const revolution = _time[n] - _time[origin]
  for (let k = wrap ? origin : Math.max(1, origin + 1); k < n; k++) {
    const seam = wrap && k === origin
    const km = seam ? n - 1 : k - 1
    const tm = seam ? _time[n - 1] - revolution : _time[km]
    const rm = _radius[km]
    const r0 = _radius[k]
    const rp = _radius[k + 1]
    const isApo = apoStep < 0 && r0 >= rm && r0 >= rp
    const isPeri = periStep < 0 && r0 <= rm && r0 <= rp
    if (!isApo && !isPeri) continue
    refine(tm, rm, _time[k], r0, _time[k + 1], rp)
    const when = wrap && _fit.time < _time[origin] ? _fit.time + revolution : _fit.time
    if (isApo) {
      apoStep = k
      out.apoapsis.radius = _fit.value
      out.apoapsis.time = when
    } else {
      periStep = k
      out.periapsis.radius = _fit.value
      out.periapsis.time = when
    }
    _forced[k] = 1
    if (apoStep >= 0 && periStep >= 0) break
  }

  /* ---- choose what to draw ---- */
  const count = choose(n, out)
  out.count = count
  out.span = _time[n]

  for (let i = 0; i < applied && i < _nodeStep.length; i++) out.nodeSamples.push(_sampleOf[_nodeStep[i]])
  if (lastNodeStep >= 0) out.lastNode = _sampleOf[lastNodeStep]
  if (apoStep >= 0) out.apoapsis.index = _sampleOf[apoStep]
  if (periStep >= 0) out.periapsis.index = _sampleOf[periStep]
  if (impact >= 0) {
    out.impact.index = count - 1
    out.impact.time = _time[n]
    out.impact.body = ORDER[impact]
  }
  return out
}

/**
 * Pick at most SAMPLES of the kept steps to draw, and write them out.
 *
 * Every step gets a cost: how far the drawn line turns there, as a share of how
 * far it turns in total, plus how much time passes, as a share of the whole
 * span. Samples go at equal intervals of accumulated cost, so half the budget
 * follows curvature — perigee, a lunar loop — and half follows time, so a long
 * straight coast still gets points often enough to click on. Forced steps are
 * always drawn and come out of the same budget.
 *
 * The turn is measured in the frame the line is drawn in, not about any body: a
 * lunar orbit drawn around Earth is a loop on a nearly straight line from
 * Earth's point of view, and it is the loop that needs the points.
 */
function choose(n, out) {
  const total = n + 1
  if (total <= SAMPLES) {
    for (let k = 0; k <= n; k++) write(out, k, k)
    return total
  }

  let forced = 0
  for (let k = 0; k <= n; k++) forced += _forced[k]
  const budget = SAMPLES - forced

  let turning = 0
  for (let k = 1; k < n; k++) turning += turnAt(k, n)
  const span = _time[n] - _time[0]
  const spacing = 2 / Math.max(budget, 1)

  let written = 0
  let chosenFree = 0
  let accumulated = 0
  let threshold = spacing
  for (let k = 0; k <= n; k++) {
    if (k > 0) {
      accumulated += (turning > 0 ? turnAt(k, n) / turning : 0) + (span > 0 ? (_time[k] - _time[k - 1]) / span : 0)
    }
    if (_forced[k]) {
      write(out, k, written++)
    } else if (accumulated >= threshold && chosenFree < budget) {
      write(out, k, written++)
      chosenFree++
      while (threshold <= accumulated) threshold += spacing
    }
  }
  return written
}

/** Turning angle of the kept line at step k of 0..n, radians; 0 at the ends. */
function turnAt(k, n) {
  if (k <= 0 || k >= n) return 0
  const a = (k - 1) * 3
  const b = k * 3
  const d = (k + 1) * 3
  const ux = _pos[b] - _pos[a]
  const uy = _pos[b + 1] - _pos[a + 1]
  const uz = _pos[b + 2] - _pos[a + 2]
  const wx = _pos[d] - _pos[b]
  const wy = _pos[d + 1] - _pos[b + 1]
  const wz = _pos[d + 2] - _pos[b + 2]
  const cx = uy * wz - uz * wy
  const cy = uz * wx - ux * wz
  const cz = ux * wy - uy * wx
  const dot = ux * wx + uy * wy + uz * wz
  const cross = Math.sqrt(cx * cx + cy * cy + cz * cz)
  return cross > 0 || dot < 0 ? Math.atan2(cross, dot) : 0
}

function write(out, k, j) {
  out.points[j * 3] = _pos[k * 3]
  out.points[j * 3 + 1] = _pos[k * 3 + 1]
  out.points[j * 3 + 2] = _pos[k * 3 + 2]
  out.times[j] = _time[k]
  _sampleOf[k] = j
}

/**
 * Pack the projection into a Line2 interleaved segment buffer.
 *
 * Line2 stores `[start.xyz, end.xyz]` per segment at stride 6, so consecutive
 * segments repeat the shared vertex. Extracted from the component and given a
 * test because two things here are easy to get wrong and invisible when you do:
 * the shared vertex has to actually match, or the line comes apart into
 * disconnected dashes; and samples past `count` — everything after an impact —
 * have to collapse onto the last real point rather than staying at the origin,
 * which would draw a spike from the impact site to the planet's centre.
 *
 * @param {Float32Array} out interleaved, length (samples - 1) * 6
 * @param {Float64Array} points xyz per sample, from `prediction`
 * @param {number} count samples actually written
 * @param {number} samples buffer capacity
 */
export function packPolyline(out, points, count, samples) {
  const n = Math.max(1, count)
  const lx = points[(n - 1) * 3]
  const ly = points[(n - 1) * 3 + 1]
  const lz = points[(n - 1) * 3 + 2]
  const at = (i, k) => (i < n ? points[i * 3 + k] : k === 0 ? lx : k === 1 ? ly : lz)

  for (let s = 0; s < samples - 1; s++) {
    const o = s * 6
    out[o] = at(s, 0)
    out[o + 1] = at(s, 1)
    out[o + 2] = at(s, 2)
    out[o + 3] = at(s + 1, 0)
    out[o + 4] = at(s + 1, 1)
    out[o + 5] = at(s + 1, 2)
  }
  return out
}
