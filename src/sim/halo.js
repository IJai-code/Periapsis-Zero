import { BODIES, G } from './constants.js'
import { RK4NBody } from './rk4.js'
import { MU } from './lagrange.js'
import { INDEX } from './system.js'
import { propagateToCrossing, synodic, updateSynodicFrame } from './cr3bp.js'

/**
 * A halo reference in the real field, by multiple shooting.
 *
 * The CR3BP corrector finds an orbit that is periodic in a model with two bodies
 * on a circle and no Sun. Put into this simulation's field it is not a natural
 * trajectory: flown unguided its perilune drift doubles every revolution and it
 * leaves after six, and held on perilune radius alone it costs 6.1 m/s a
 * revolution while the other five degrees of freedom wander. What station-keeping
 * wants instead is a trajectory the real field actually flies, continuous from
 * one revolution to the next — the continuation layer, as the keeping gate put
 * it. This builds one.
 *
 * The trajectory is split at patch points and each segment is flown on its own in
 * the simulation's own integrator, Sun, Earth and Moon included. Newton's method
 * then moves the patch states until every segment arrives exactly where the next
 * begins:
 *
 *     D_k = phi(X_k; t_k -> t_k+1) - X_k+1,      dX = -J^T (J J^T)^-1 D
 *
 * with J built from each segment's state transition matrix and the -I that ties
 * it to the next patch. Six equations a boundary, six unknowns a patch point,
 * one patch point more than boundaries: the six spare degrees of freedom are the
 * choice of trajectory, and the minimum-norm update spends none of them, so the
 * answer stays as close to the CR3BP member as continuity allows.
 *
 * Three choices were measured before any of this was written.
 *
 * **Patch points at apolune only, a revolution apart.** A perilune patch point is
 * where an NRHO moves 1.7 km/s and turns fastest, so an arrival there a little
 * early or late is a large mismatch: seeded from the member, segments ending at
 * perilune missed by a median of 1,900-15,500 km and 520-1,580 m/s across five
 * seed mappings, against about 1,500 km and 7 m/s at apolune. A revolution per
 * segment is also the longest horizon the keeping gate found finite differences
 * survive — the orbit's instability doubles a probe each revolution.
 *
 * **The member placed about the Moon, in fixed CR3BP units.** Scaling it by the
 * instantaneous Earth-Moon separation, as `insertMember` does, is the natural
 * reading of the pulsating frame, and it seeded twice as badly here: 3,100 km
 * median to this mapping's 1,490. An NRHO is a lunar orbit, and its size is set
 * by the Moon's gravity rather than by how far away the Earth happens to be.
 *
 * **A fixed 30 s step, and a fixed step count per segment.** Through a perilune
 * passage 30 s integrates to 0.04-0.19 m, where 60 s is 0.8-2.8 m. And the count
 * never depends on the state, because a finite-difference Jacobian taken across
 * runs with different step grids measures the grid.
 */

const MU_SYSTEM = G * (BODIES.earth.mass + BODIES.moon.mass)
/** The units the family is tabulated in: nominal separation, and the time and speed that belong to it. */
const LENGTH = 384400e3
const TIME = Math.sqrt((LENGTH * LENGTH * LENGTH) / MU_SYSTEM)
const SPEED = LENGTH / TIME

const MOON = INDEX.moon * 6
const BODY_SLOTS = 18
const SHIP = 18
/** The craft's slot in the simulation's own state, loaded into SHIP for a solve. */
const CRAFT = INDEX.ship * 6

/** A four-body integrator of the simulation's own kind: Sun, Earth, Moon and a massless craft. */
function makeScratch(sim) {
  const scratch = new RK4NBody([BODIES.sun.mass, BODIES.earth.mass, BODIES.moon.mass, 0], new Float64Array(24), 3)
  scratch.testSoftening2 = sim.testSoftening2
  return scratch
}

/** Fly the bodies in `from` (18 slots) with the craft at Moon-relative X (normalised) for `span` s. */
function flySegment(scratch, from, X, span, step, out) {
  scratch.state.set(from)
  for (let i = 0; i < 3; i++) {
    scratch.state[SHIP + i] = from[MOON + i] + X[i] * LENGTH
    scratch.state[SHIP + 3 + i] = from[MOON + 3 + i] + X[3 + i] * SPEED
  }
  const n = Math.ceil(span / step)
  const h = span / n
  for (let s = 0; s < n; s++) scratch.step(h)
  for (let i = 0; i < 3; i++) {
    out[i] = (scratch.state[SHIP + i] - scratch.state[MOON + i]) / LENGTH
    out[3 + i] = (scratch.state[SHIP + 3 + i] - scratch.state[MOON + 3 + i]) / SPEED
  }
}

/** Solve the symmetric positive-definite system A x = b in place (Cholesky). False if A is not SPD. */
function solveSPD(A, b, n) {
  for (let j = 0; j < n; j++) {
    let d = A[j * n + j]
    for (let k = 0; k < j; k++) d -= A[j * n + k] * A[j * n + k]
    if (!(d > 0)) return false
    const ljj = Math.sqrt(d)
    A[j * n + j] = ljj
    for (let i = j + 1; i < n; i++) {
      let s = A[i * n + j]
      for (let k = 0; k < j; k++) s -= A[i * n + k] * A[j * n + k]
      A[i * n + j] = s / ljj
    }
  }
  for (let i = 0; i < n; i++) {
    let s = b[i]
    for (let k = 0; k < i; k++) s -= A[i * n + k] * b[k]
    b[i] = s / A[i * n + i]
  }
  for (let i = n - 1; i >= 0; i--) {
    let s = b[i]
    for (let k = i + 1; k < n; k++) s -= A[k * n + i] * b[k]
    b[i] = s / A[i * n + i]
  }
  return true
}

/**
 * Shoot a real-field halo reference from a CR3BP family member.
 *
 * `sim` supplies the field at its current epoch; the reference's first patch
 * point is at that epoch and the rest follow one member period apart. Returns
 * the patch epochs, the Moon-relative patch states in metres and m/s, and the
 * Sun, Earth and Moon states the shooting flew against at each, which is what
 * lets a caller re-fly any segment exactly.
 *
 * A one-shot solve in the architecture's sense: hundreds of propagations on
 * demand, never in a frame.
 */
export function shootHalo(
  sim,
  member,
  {
    revolutions = 13,
    step = 30,
    probe = 1e-7,
    maxIterations = 30,
    positionTolerance = 0.1,
    velocityTolerance = 1e-4,
  } = {},
) {
  const K = revolutions
  const scratch = makeScratch(sim)

  // The member's two plane crossings; the one further from the Moon is apolune.
  const a = Float64Array.from([member.x, 0, member.z, 0, member.vy, 0])
  const b = Float64Array.from(a)
  const halfPeriod = propagateToCrossing(b)
  const range = (y) => Math.hypot(y[0] - (1 - MU), y[1], y[2])
  const apolune = range(b) > range(a) ? b : a
  const span = 2 * halfPeriod * TIME

  // Sun, Earth and Moon at each patch epoch, stepped exactly as the segments are.
  const epochs = new Float64Array(K + 1)
  const bodies = new Float64Array(BODY_SLOTS * (K + 1))
  scratch.state.set(sim.state.subarray(0, BODY_SLOTS))
  for (let i = 0; i < 3; i++) {
    scratch.state[SHIP + i] = sim.state[MOON + i] + (i === 0 ? 1e9 : 0)
    scratch.state[SHIP + 3 + i] = sim.state[MOON + 3 + i]
  }
  bodies.set(scratch.state.subarray(0, BODY_SLOTS), 0)
  epochs[0] = sim.t
  for (let k = 1; k <= K; k++) {
    const n = Math.ceil(span / step)
    const h = span / n
    for (let s = 0; s < n; s++) scratch.step(h)
    bodies.set(scratch.state.subarray(0, BODY_SLOTS), BODY_SLOTS * k)
    epochs[k] = epochs[k - 1] + span
  }

  // Seed: the member's apolune about the Moon, in the Earth-Moon frame of each epoch.
  const X = new Float64Array(6 * (K + 1))
  for (let k = 0; k <= K; k++) {
    updateSynodicFrame(bodies.subarray(BODY_SLOTS * k, BODY_SLOTS * (k + 1)))
    const { omega, xhat, yhat, zhat } = synodic
    const dx = (apolune[0] - (1 - MU)) * LENGTH
    const dy = apolune[1] * LENGTH
    const dz = apolune[2] * LENGTH
    const du = apolune[3] * SPEED - omega * dy
    const dv = apolune[4] * SPEED + omega * dx
    const dw = apolune[5] * SPEED
    const o = 6 * k
    X[o] = (xhat.x * dx + yhat.x * dy + zhat.x * dz) / LENGTH
    X[o + 1] = (xhat.y * dx + yhat.y * dy + zhat.y * dz) / LENGTH
    X[o + 2] = (xhat.z * dx + yhat.z * dy + zhat.z * dz) / LENGTH
    X[o + 3] = (xhat.x * du + yhat.x * dv + zhat.x * dw) / SPEED
    X[o + 4] = (xhat.y * du + yhat.y * dv + zhat.y * dw) / SPEED
    X[o + 5] = (xhat.z * du + yhat.z * dv + zhat.z * dw) / SPEED
  }
  const seedStates = Float64Array.from(X)

  const D = new Float64Array(6 * K)
  const Phi = new Float64Array(36 * K)
  const N = 6 * K
  const A = new Float64Array(N * N)
  const w = new Float64Array(N)
  const dX = new Float64Array(6 * (K + 1))
  const trial = new Float64Array(6 * (K + 1))
  const out = new Float64Array(6)
  const plus = new Float64Array(6)
  const minus = new Float64Array(6)
  const patch = new Float64Array(6)

  /** Fill D from states S; return the largest position and velocity mismatch, SI, and the merit. */
  function mismatches(S, into) {
    let worstPosition = 0
    let worstVelocity = 0
    let merit = 0
    for (let k = 0; k < K; k++) {
      for (let i = 0; i < 6; i++) patch[i] = S[6 * k + i]
      flySegment(scratch, bodies.subarray(BODY_SLOTS * k, BODY_SLOTS * (k + 1)), patch, span, step, out)
      for (let i = 0; i < 6; i++) {
        const d = out[i] - S[6 * (k + 1) + i]
        into[6 * k + i] = d
        merit += d * d
      }
      const o = 6 * k
      worstPosition = Math.max(worstPosition, Math.hypot(into[o], into[o + 1], into[o + 2]) * LENGTH)
      worstVelocity = Math.max(worstVelocity, Math.hypot(into[o + 3], into[o + 4], into[o + 5]) * SPEED)
    }
    return { position: worstPosition, velocity: worstVelocity, merit }
  }

  const history = []
  let m = mismatches(X, D)
  const seedMismatch = { position: m.position, velocity: m.velocity }
  let converged = false
  let iterations = 0

  for (let iter = 0; iter < maxIterations; iter++) {
    if (m.position < positionTolerance && m.velocity < velocityTolerance) {
      converged = true
      break
    }
    iterations = iter + 1

    // Each segment's state transition matrix, by central differences.
    for (let k = 0; k < K; k++) {
      const from = bodies.subarray(BODY_SLOTS * k, BODY_SLOTS * (k + 1))
      for (let c = 0; c < 6; c++) {
        for (let i = 0; i < 6; i++) patch[i] = X[6 * k + i]
        patch[c] += probe
        flySegment(scratch, from, patch, span, step, plus)
        patch[c] -= 2 * probe
        flySegment(scratch, from, patch, span, step, minus)
        for (let r = 0; r < 6; r++) Phi[36 * k + r * 6 + c] = (plus[r] - minus[r]) / (2 * probe)
      }
    }

    // J J^T: Phi_k Phi_k^T + I on the diagonal blocks, -Phi_k+1^T beside them.
    A.fill(0)
    for (let k = 0; k < K; k++) {
      const p = 36 * k
      for (let r = 0; r < 6; r++) {
        for (let c = 0; c < 6; c++) {
          let s = 0
          for (let j = 0; j < 6; j++) s += Phi[p + r * 6 + j] * Phi[p + c * 6 + j]
          A[(6 * k + r) * N + 6 * k + c] = s + (r === c ? 1 : 0)
        }
      }
      if (k + 1 < K) {
        const q = 36 * (k + 1)
        for (let r = 0; r < 6; r++) {
          for (let c = 0; c < 6; c++) {
            A[(6 * k + r) * N + 6 * (k + 1) + c] = -Phi[q + c * 6 + r]
            A[(6 * (k + 1) + c) * N + 6 * k + r] = -Phi[q + c * 6 + r]
          }
        }
      }
    }
    for (let i = 0; i < N; i++) w[i] = D[i]
    if (!solveSPD(A, w, N)) break

    // dX = -J^T w.
    dX.fill(0)
    for (let k = 0; k < K; k++) {
      const p = 36 * k
      for (let c = 0; c < 6; c++) {
        let s = 0
        for (let r = 0; r < 6; r++) s += Phi[p + r * 6 + c] * w[6 * k + r]
        dX[6 * k + c] -= s
        dX[6 * (k + 1) + c] += w[6 * k + c]
      }
    }

    // Backtrack until the mismatch actually falls.
    let scale = 1
    let accepted = null
    for (let attempt = 0; attempt < 10; attempt++) {
      for (let i = 0; i < trial.length; i++) trial[i] = X[i] + scale * dX[i]
      const next = mismatches(trial, w)
      if (next.merit < m.merit) {
        accepted = next
        break
      }
      scale *= 0.5
    }
    if (!accepted) break
    X.set(trial)
    m = mismatches(X, D)
    history.push({ iteration: iterations, position: m.position, velocity: m.velocity, scale })
  }
  if (m.position < positionTolerance && m.velocity < velocityTolerance) converged = true

  const states = new Float64Array(6 * (K + 1))
  for (let k = 0; k <= K; k++) {
    for (let i = 0; i < 3; i++) {
      states[6 * k + i] = X[6 * k + i] * LENGTH
      states[6 * k + 3 + i] = X[6 * k + 3 + i] * SPEED
    }
  }
  let movedPosition = 0
  let movedVelocity = 0
  for (let k = 0; k <= K; k++) {
    const o = 6 * k
    movedPosition = Math.max(movedPosition, Math.hypot(X[o] - seedStates[o], X[o + 1] - seedStates[o + 1], X[o + 2] - seedStates[o + 2]) * LENGTH)
    movedVelocity = Math.max(movedVelocity, Math.hypot(X[o + 3] - seedStates[o + 3], X[o + 4] - seedStates[o + 4], X[o + 5] - seedStates[o + 5]) * SPEED)
  }

  return {
    epochs,
    states,
    bodies,
    span,
    step,
    softening2: sim.testSoftening2,
    revolutions: K,
    converged,
    iterations,
    history,
    seedMismatch,
    mismatch: { position: m.position, velocity: m.velocity },
    moved: { position: movedPosition, velocity: movedVelocity },
  }
}

/* ---------------------------------------------------------------- *
 * Flying against the reference
 * ---------------------------------------------------------------- */

let _flight = null
/** One scratch integrator for everything that re-flies the reference after it is built. */
function scratchFor(reference) {
  if (!_flight) _flight = new RK4NBody([BODIES.sun.mass, BODIES.earth.mass, BODIES.moon.mass, 0], new Float64Array(24), 3)
  _flight.testSoftening2 = reference.softening2
  return _flight
}

/**
 * The reference's Moon-relative state at simulation time `t`, m and m/s, into
 * `out`. Re-flown from the patch point before `t` with the shooting's own step,
 * so it is the same trajectory the patch points describe. False outside it.
 */
export function referenceStateAt(reference, t, out) {
  const { epochs, states, bodies, span, step, revolutions } = reference
  const k = Math.min(revolutions, Math.floor((t - epochs[0]) / span))
  if (!(k >= 0) || t > epochs[revolutions]) return false
  const scratch = scratchFor(reference)
  scratch.state.set(bodies.subarray(BODY_SLOTS * k, BODY_SLOTS * (k + 1)))
  for (let i = 0; i < 6; i++) scratch.state[SHIP + i] = scratch.state[MOON + i] + states[6 * k + i]
  const dt = t - epochs[k]
  if (dt > 0) {
    const n = Math.ceil(dt / step)
    const h = dt / n
    for (let s = 0; s < n; s++) scratch.step(h)
  }
  for (let i = 0; i < 6; i++) out[i] = scratch.state[SHIP + i] - scratch.state[MOON + i]
  return true
}

/** Solve the 3x3 system M x = g in place by Gaussian elimination with partial pivoting. */
function solve3(M, g) {
  for (let c = 0; c < 3; c++) {
    let p = c
    for (let r = c + 1; r < 3; r++) if (Math.abs(M[r * 3 + c]) > Math.abs(M[p * 3 + c])) p = r
    if (!(Math.abs(M[p * 3 + c]) > 0)) return false
    if (p !== c) {
      for (let j = 0; j < 3; j++) {
        const t = M[c * 3 + j]
        M[c * 3 + j] = M[p * 3 + j]
        M[p * 3 + j] = t
      }
      const t = g[c]
      g[c] = g[p]
      g[p] = t
    }
    for (let r = c + 1; r < 3; r++) {
      const f = M[r * 3 + c] / M[c * 3 + c]
      for (let j = c; j < 3; j++) M[r * 3 + j] -= f * M[c * 3 + j]
      g[r] -= f * g[c]
    }
  }
  for (let r = 2; r >= 0; r--) {
    let s = g[r]
    for (let j = r + 1; j < 3; j++) s -= M[r * 3 + j] * g[j]
    g[r] = s / M[r * 3 + r]
  }
  return true
}

/**
 * The burn, now, that brings the craft back onto the reference.
 *
 * Aimed at the reference's state at a patch point `lookahead` revolutions on —
 * the first at least half a revolution away, so a burn at apolune looks one
 * whole revolution ahead — in least squares over position and velocity in CR3BP
 * units, where a metre per second weighs as much as 375 km. `match: 'position'`
 * aims at position alone. Gauss-Newton on finite-differenced sensitivities, with
 * the step count fixed across every probe of a solve.
 */
export function solveHaloKeeping(
  reference,
  sim,
  { lookahead = 1, match = 'state', probe = 1e-3, iterations = 4, tolerance = 1e-4, state = null } = {},
) {
  // What the craft believes its state is. Defaults to the truth; a caller
  // modelling navigation error passes an estimate instead.
  const known = state ?? sim.state
  const { epochs, states, span, step } = reference
  const now = sim.t
  let j = 0
  while (j < epochs.length && epochs[j] < now + 0.5 * span) j++
  j += lookahead - 1
  if (j >= epochs.length) return { converged: false, world: [0, 0, 0], magnitude: 0, reason: 'past the end of the reference' }

  const horizon = epochs[j] - now
  const n = Math.ceil(horizon / step)
  const h = horizon / n
  const scratch = scratchFor(reference)
  const rows = match === 'position' ? 3 : 6
  const res = new Float64Array(6)
  const plus = new Float64Array(6)
  const minus = new Float64Array(6)
  const A = new Float64Array(6 * 3)
  const M = new Float64Array(9)
  const g = new Float64Array(3)
  const dv = [0, 0, 0]

  const residual = (dvx, dvy, dvz, into) => {
    scratch.state.set(known.subarray(0, BODY_SLOTS))
    for (let i = 0; i < 6; i++) scratch.state[SHIP + i] = known[CRAFT + i]
    scratch.state[SHIP + 3] += dvx
    scratch.state[SHIP + 4] += dvy
    scratch.state[SHIP + 5] += dvz
    for (let s = 0; s < n; s++) scratch.step(h)
    for (let i = 0; i < 3; i++) {
      into[i] = (scratch.state[SHIP + i] - scratch.state[MOON + i] - states[6 * j + i]) / LENGTH
      into[3 + i] = (scratch.state[SHIP + 3 + i] - scratch.state[MOON + 3 + i] - states[6 * j + 3 + i]) / SPEED
    }
  }
  const norms = (r) => ({ position: Math.hypot(r[0], r[1], r[2]) * LENGTH, velocity: Math.hypot(r[3], r[4], r[5]) * SPEED })

  residual(0, 0, 0, res)
  const before = norms(res)
  let converged = false
  for (let it = 0; it < iterations; it++) {
    residual(dv[0], dv[1], dv[2], res)
    for (let c = 0; c < 3; c++) {
      const at = [dv[0], dv[1], dv[2]]
      at[c] += probe
      residual(at[0], at[1], at[2], plus)
      at[c] -= 2 * probe
      residual(at[0], at[1], at[2], minus)
      for (let r = 0; r < 6; r++) A[r * 3 + c] = (plus[r] - minus[r]) / (2 * probe)
    }
    // Normal equations: (A^T A) delta = -A^T res, over the matched rows.
    for (let a = 0; a < 3; a++) {
      let ga = 0
      for (let r = 0; r < rows; r++) ga += A[r * 3 + a] * res[r]
      g[a] = -ga
      for (let b = 0; b < 3; b++) {
        let s = 0
        for (let r = 0; r < rows; r++) s += A[r * 3 + a] * A[r * 3 + b]
        M[a * 3 + b] = s
      }
    }
    if (!solve3(M, g)) break
    dv[0] += g[0]
    dv[1] += g[1]
    dv[2] += g[2]
    if (Math.hypot(g[0], g[1], g[2]) < tolerance) {
      converged = true
      break
    }
  }
  residual(dv[0], dv[1], dv[2], res)
  return {
    world: dv,
    magnitude: Math.hypot(dv[0], dv[1], dv[2]),
    target: j,
    horizon,
    before,
    after: norms(res),
    converged,
  }
}
