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
import { BODIES } from './constants.js'
import { dominantBody } from './soi.js'
import { INDEX } from './system.js'
import { nodeBasis, resolveNode } from './nodes.js'

/** Samples along the path. Enough to draw a smooth ellipse at any zoom. */
export const SAMPLES = 512

/**
 * RK4 substeps per sample.
 *
 * Without this the projection inherits the flight integrator's `maxDt`, which
 * is 0.02 s — chosen for a vehicle under thrust in atmosphere, and absurd for a
 * ballistic look-ahead. A 3.5 s sample became 176 substeps and a full
 * revolution 90,000 of them, about 154 ms, five times a second. The projection
 * does not need the accuracy the flight does: it is advisory, redrawn
 * continuously, and its error against the analytic conic at four substeps is
 * measured in scripts/verify-predict.mjs rather than assumed.
 */
export const SUBSTEPS_PER_SAMPLE = 4

/**
 * How far ahead to look when the orbit does not close, in seconds.
 *
 * A bound orbit projects exactly one revolution, which is the whole of what
 * there is to see. An escape or a transfer has no period, so the horizon is a
 * choice: six days covers a translunar coast, which is the longest thing this
 * sequencer flies in one leg.
 */
export const OPEN_HORIZON = 6 * 86400

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
  /** Positions relative to `reference`, metres, xyz per sample. */
  points: new Float64Array(SAMPLES * 3),
  /** Seconds from now, per sample. */
  times: new Float64Array(SAMPLES),
  /** Which body the path is drawn around. */
  reference: 'earth',
  /** Simulated span covered, s. */
  span: 0,
  /** True when the projection closed a full revolution rather than running out. */
  closed: false,
  /** Apsides, as sample indices with refined values. Index -1 when absent. */
  apoapsis: { index: -1, radius: 0, time: 0 },
  periapsis: { index: -1, radius: 0, time: 0 },
  /** Set when the path meets the reference body's surface. */
  impact: { index: -1, time: 0 },
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
  out.apsisBody = out.reference
  empty(out.applied)
  empty(out.nodeSamples)
  out.lastNode = -1
  out.apoapsis.index = -1
  out.periapsis.index = -1
  out.impact.index = -1
}

const _fit = { offset: 0, value: 0 }

/**
 * Parabolic refinement through three samples.
 *
 * The extremum of a path sampled every few seconds sits between samples, and
 * taking the nearest one puts an apoapsis marker visibly off the top of the
 * arc. Fitting a parabola to the bracketing triple costs three multiplies and
 * lands it where it belongs — the same refinement the targeting solvers use on
 * their own minima.
 *
 * Written into one shared result rather than returning a fresh object. A fresh
 * object is free when the caller inlines this and the optimiser removes it —
 * measured at 0 B in isolation — and not free inside `project`, which is too
 * large to inline into. Every caller reads `offset` and `value` before the next
 * call.
 */
function refine(rm, r0, rp) {
  const denom = rm - 2 * r0 + rp
  if (Math.abs(denom) < 1e-12) {
    _fit.offset = 0
    _fit.value = r0
    return _fit
  }
  const offset = (0.5 * (rm - rp)) / denom
  _fit.offset = offset
  _fit.value = r0 - 0.25 * (rm - rp) * offset
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

const _radii = new Float64Array(SAMPLES)

/**
 * Project the craft's path forward.
 *
 * Nodes, when given, are folded in as instantaneous velocity changes at their
 * stated times. The integration is split at each one — advance exactly to the
 * node, apply, advance the remainder — rather than rounding it to the nearest
 * sample, because a 60 m/s impulse landed one sample late is a visibly
 * different orbit and the whole point of drawing the plan is to see what the
 * burn does.
 *
 * @param {object} sim        the live simulation, read only
 * @param {object} scratch    a persistent integrator to run the projection in
 * @param {string} craft      state-vector id of the craft
 * @param {string} reference  body the path is drawn relative to
 * @param {number} period     orbital period if bound, else 0 or Infinity
 * @param {object} out        result to fill; defaults to the ballistic one
 * @param {Array|null} nodes  planned manoeuvres to fold in
 */
const _dv = new Vector3()
const _fp = new Vector3()
const _fn = new Vector3()
const _fo = new Vector3()

export function project(sim, scratch, craft, reference, period, out = prediction, nodes = null) {
  const closed = Number.isFinite(period) && period > 0
  const span = closed ? period : OPEN_HORIZON
  const dt = span / (SAMPLES - 1)

  scratch.resetFrom(sim)

  const c = INDEX[craft] * 6
  const r = INDEX[reference] * 6
  const surface = BODIES[reference].radius

  out.reference = reference
  out.span = span
  out.closed = closed
  out.apoapsis.index = -1
  out.periapsis.index = -1
  out.impact.index = -1
  empty(out.applied)
  empty(out.nodeSamples)
  out.lastNode = -1
  out.apsisBody = reference

  /** State offset the apsis radii are measured from; moves to each node's body. */
  let apsisOffset = r

  /** Nodes still ahead of the projection, in order. */
  let nodeAt = 0
  const pending = nodes ?? null

  let n = 0
  for (let i = 0; i < SAMPLES; i++) {
    if (i > 0) {
      let remaining = dt
      // Split the step at every node that falls inside it.
      while (pending && nodeAt < pending.length) {
        const node = pending[nodeAt]
        const until = node.t - scratch.t
        if (node.executed || until < 0) {
          nodeAt++
          continue
        }
        if (until > remaining) break
        if (until > 0) scratch.advance(until, dt / SUBSTEPS_PER_SAMPLE, SUBSTEPS_PER_SAMPLE)
        /**
         * The frame first, then the impulse. The basis is defined by the
         * velocity the craft has *arriving* at the node — applying the burn
         * first and measuring afterwards would rotate prograde by the very
         * thing being measured.
         */
        const body = dominantBody(scratch, craft)
        const b = INDEX[body] * 6
        const slot = out.applied.length
        if (slot < MAX_NODE_FRAMES && nodeBasis(scratch.state, c, b, _fp, _fn, _fo)) {
          const f = slot * 12
          const fr = out.nodeFrames
          fr[f] = scratch.state[c] - scratch.state[r]
          fr[f + 1] = scratch.state[c + 1] - scratch.state[r + 1]
          fr[f + 2] = scratch.state[c + 2] - scratch.state[r + 2]
          fr[f + 3] = _fp.x; fr[f + 4] = _fp.y; fr[f + 5] = _fp.z
          fr[f + 6] = _fn.x; fr[f + 7] = _fn.y; fr[f + 8] = _fn.z
          fr[f + 9] = _fo.x; fr[f + 10] = _fo.y; fr[f + 11] = _fo.z
          out.nodeTimes[slot] = scratch.t - sim.t
          const vx = scratch.state[c + 3] - scratch.state[b + 3]
          const vy = scratch.state[c + 4] - scratch.state[b + 4]
          const vz = scratch.state[c + 5] - scratch.state[b + 5]
          out.nodeSpeeds[slot] = Math.sqrt(vx * vx + vy * vy + vz * vz)
          out.nodeBodies[slot] = body
        }
        // Position stays relative to `reference`, because that is the frame the
        // line and the gizmo are drawn in; only the *axes* belong to the node's
        // own body.
        resolveNode(node, scratch.state, c, b, _dv)
        scratch.state[c + 3] += _dv.x
        scratch.state[c + 4] += _dv.y
        scratch.state[c + 5] += _dv.z
        out.applied.push(node.id)
        out.nodeSamples.push(i)
        out.lastNode = i
        out.apsisBody = body
        apsisOffset = b
        remaining -= Math.max(0, until)
        nodeAt++
      }
      if (remaining > 0) {
        scratch.advance(remaining, dt / SUBSTEPS_PER_SAMPLE, SUBSTEPS_PER_SAMPLE)
      }
    }
    const s = scratch.state
    const x = s[c] - s[r]
    const y = s[c + 1] - s[r + 1]
    const z = s[c + 2] - s[r + 2]
    out.points[i * 3] = x
    out.points[i * 3 + 1] = y
    out.points[i * 3 + 2] = z
    out.times[i] = i * dt
    /**
     * Lengths as square roots, not `Math.hypot`. On this V8 hypot allocates on
     * every call, and this line runs 512 times a projection: HEAD's single call
     * here was 1,260 minor collections per 20,000 projections, all of it
     * garbage, and invisible to the old heap-after-GC gate — which is why that
     * gate is gone (scripts/allocation.mjs).
     */
    const fromReference = Math.sqrt(x * x + y * y + z * z)
    const ax = s[c] - s[apsisOffset]
    const ay = s[c + 1] - s[apsisOffset + 1]
    const az = s[c + 2] - s[apsisOffset + 2]
    _radii[i] = Math.sqrt(ax * ax + ay * ay + az * az)
    n = i + 1

    /**
     * Stop at the surface. Past it the integrator is describing a trajectory
     * through rock, and drawing that is worse than drawing nothing — it is the
     * one part of the path the vehicle definitely will not fly.
     *
     * Against the reference body, deliberately not `_radii`: after a capture
     * burn those are distances from the Moon, and comparing 1,800 km to Earth's
     * radius would end every lunar plan at the first sample past the node.
     */
    if (fromReference <= surface) {
      out.impact.index = i
      out.impact.time = i * dt
      break
    }
  }
  out.count = n

  /* ---- apsides, from the sampled radii, after the last planned burn ---- */
  for (let i = Math.max(1, out.lastNode + 1); i < n - 1; i++) {
    const rm = _radii[i - 1]
    const r0 = _radii[i]
    const rp = _radii[i + 1]
    if (r0 >= rm && r0 >= rp && out.apoapsis.index < 0) {
      const f = refine(rm, r0, rp)
      out.apoapsis.index = i
      out.apoapsis.radius = f.value
      out.apoapsis.time = (i + f.offset) * dt
    }
    if (r0 <= rm && r0 <= rp && out.periapsis.index < 0) {
      const f = refine(rm, r0, rp)
      out.periapsis.index = i
      out.periapsis.radius = f.value
      out.periapsis.time = (i + f.offset) * dt
    }
  }

  return out
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
