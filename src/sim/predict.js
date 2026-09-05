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
import { BODIES, BODY_ORDER } from './constants.js'
import { INDEX } from './system.js'

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

/** The live result, refreshed in place. */
export const prediction = {
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
}

/**
 * Parabolic refinement through three samples.
 *
 * The extremum of a path sampled every few seconds sits between samples, and
 * taking the nearest one puts an apoapsis marker visibly off the top of the
 * arc. Fitting a parabola to the bracketing triple costs three multiplies and
 * lands it where it belongs — the same refinement the targeting solvers use on
 * their own minima.
 */
function refine(rm, r0, rp) {
  const denom = rm - 2 * r0 + rp
  if (Math.abs(denom) < 1e-12) return { offset: 0, value: r0 }
  const offset = (0.5 * (rm - rp)) / denom
  return { offset, value: r0 - 0.25 * (rm - rp) * offset }
}

const _radii = new Float64Array(SAMPLES)

/**
 * Project the craft's path forward.
 *
 * @param {object} sim        the live simulation, read only
 * @param {object} scratch    a persistent integrator to run the projection in
 * @param {string} craft      state-vector id of the craft
 * @param {string} reference  body the path is drawn relative to
 * @param {number} period     orbital period if bound, else 0 or Infinity
 */
export function project(sim, scratch, craft, reference, period) {
  const closed = Number.isFinite(period) && period > 0
  const span = closed ? period : OPEN_HORIZON
  const dt = span / (SAMPLES - 1)

  scratch.resetFrom(sim)

  const c = INDEX[craft] * 6
  const r = INDEX[reference] * 6
  const surface = BODIES[reference].radius

  prediction.reference = reference
  prediction.span = span
  prediction.closed = closed
  prediction.apoapsis.index = -1
  prediction.periapsis.index = -1
  prediction.impact.index = -1

  let n = 0
  for (let i = 0; i < SAMPLES; i++) {
    if (i > 0) scratch.advance(dt, dt / SUBSTEPS_PER_SAMPLE, SUBSTEPS_PER_SAMPLE)
    const s = scratch.state
    const x = s[c] - s[r]
    const y = s[c + 1] - s[r + 1]
    const z = s[c + 2] - s[r + 2]
    prediction.points[i * 3] = x
    prediction.points[i * 3 + 1] = y
    prediction.points[i * 3 + 2] = z
    prediction.times[i] = i * dt
    _radii[i] = Math.hypot(x, y, z)
    n = i + 1

    /**
     * Stop at the surface. Past it the integrator is describing a trajectory
     * through rock, and drawing that is worse than drawing nothing — it is the
     * one part of the path the vehicle definitely will not fly.
     */
    if (_radii[i] <= surface) {
      prediction.impact.index = i
      prediction.impact.time = i * dt
      break
    }
  }
  prediction.count = n

  /* ---- apsides, from the sampled radii ---- */
  for (let i = 1; i < n - 1; i++) {
    const rm = _radii[i - 1]
    const r0 = _radii[i]
    const rp = _radii[i + 1]
    if (r0 >= rm && r0 >= rp && prediction.apoapsis.index < 0) {
      const f = refine(rm, r0, rp)
      prediction.apoapsis.index = i
      prediction.apoapsis.radius = f.value
      prediction.apoapsis.time = (i + f.offset) * dt
    }
    if (r0 <= rm && r0 <= rp && prediction.periapsis.index < 0) {
      const f = refine(rm, r0, rp)
      prediction.periapsis.index = i
      prediction.periapsis.radius = f.value
      prediction.periapsis.time = (i + f.offset) * dt
    }
  }

  return prediction
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

/** Which body a craft's path should be drawn around, by whichever pulls hardest. */
export function dominantBody(sim, craft) {
  const c = INDEX[craft] * 6
  let best = null
  let strongest = -Infinity
  for (const id of BODY_ORDER) {
    const b = BODIES[id]
    if (!b) continue
    const o = INDEX[id] * 6
    const d2 =
      (sim.state[c] - sim.state[o]) ** 2 +
      (sim.state[c + 1] - sim.state[o + 1]) ** 2 +
      (sim.state[c + 2] - sim.state[o + 2]) ** 2
    const pull = b.mass / Math.max(d2, 1)
    if (pull > strongest) {
      strongest = pull
      best = id
    }
  }
  return best
}
