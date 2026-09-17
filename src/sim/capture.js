import { BODIES, G } from './constants.js'
import { RK4NBody } from './rk4.js'
import { INDEX } from './system.js'
import { shootHalo } from './halo.js'

/**
 * Capturing a lunar approach onto a halo, in three burns.
 *
 * The approach this mission flies cannot join a halo at perilune, and that is
 * geometry rather than a shortage of propellant. On a Hohmann-class transfer the
 * craft arrives ahead of the Moon and is overtaken, so its lunar excess velocity
 * points against the Moon's motion; a flyby at 1,827 km with that arrival has
 * e = 1.3 and turns the velocity by only about 100 degrees. Whichever pole the
 * craft passes, it circulates the way the halo over the *other* pole does:
 * measured, its angular momentum sits 178-179 degrees from the halo's at both
 * poles, and 19 Newton solves seeded to 400 m/s in six directions never left
 * that branch. Matching velocity there costs 3,419-3,451 m/s. Nor does the
 * launch epoch help — across 28 launches spanning a month the coplanar mirror is
 * always 131-133 degrees out of phase and the in-phase mirror is always
 * retrograde.
 *
 * What does work is what Artemis flies: give up on perilune and meet the halo
 * where both are slow.
 *
 *   1. At periselene, a retrograde burn drops the hyperbola into an ellipse.
 *      Below about 191 m/s the craft is still unbound; just above it, apolune
 *      lands 50,000-61,000 km out, reached in 1-3 days.
 *   2. At that apolune, where the craft makes 70-100 m/s, a burn rotates the
 *      plane onto the halo's and aims at a chosen apolune patch point of the
 *      reference. This is the expensive one, because it does more than rotate:
 *      it also sets up the arrival time.
 *   3. At the patch point, a burn matches the reference's velocity.
 *
 * **Burn two is seeded by Lambert, and that is the difference between working
 * and not.** Seeded from zero — or from a vis-viva guess — the real-field
 * Newton wandered and finished 85,000-113,000 km out at every arrival epoch
 * tried. Seeded with the two-body arc from the transfer's apolune to the patch
 * point, every cell of the search converges to under 50 m. The seed is only a
 * seed: at these radii the Earth's pull is comparable to the Moon's, and the
 * correction is hundreds of m/s.
 *
 * Searched from Apollo 8's arrival at Kennedy's reference launch: 580 m/s, as
 * 191 + 283 + 105, against 819 m/s for the capture into low lunar orbit this
 * replaces. A wider search found transfers of 4-6 days converge, and that at 8.5
 * days the two-body seed is too poor and the solve misses by 20,000-50,000 km.
 *
 * Flown rather than applied, the burns are finite and the plan drifts; see
 * `solveHaloCorrection` for the burn that puts it back.
 *
 * A one-shot solver in the architecture's sense, and an expensive one: each cell
 * of the search shoots its own reference.
 */

const MU_MOON = G * BODIES.moon.mass
const BODY_SLOTS = 18
const SHIP = 18
const CRAFT = INDEX.ship * 6
const MOON = INDEX.moon * 6

const norm = (a) => Math.hypot(a[0], a[1], a[2])
const unit = (a) => {
  const n = norm(a)
  return [a[0] / n, a[1] / n, a[2] / n]
}

/**
 * Lambert's problem by universal variables, after Vallado.
 *
 * Returns the velocities at `r1` and `r2` for a transfer taking `dt`, or null
 * where the geometry is degenerate — the two positions parallel, or no solution
 * inside the bracket. `longWay` takes the arc the other way round. Verified
 * against Vallado's worked example to 1 mm/s in `verify-nrho-capture`.
 */
export function lambert(r1, r2, dt, mu, longWay = false) {
  const R1 = norm(r1)
  const R2 = norm(r2)
  let cosDnu = (r1[0] * r2[0] + r1[1] * r2[1] + r1[2] * r2[2]) / (R1 * R2)
  cosDnu = Math.max(-1, Math.min(1, cosDnu))
  const sinDnu = Math.sqrt(Math.max(0, 1 - cosDnu * cosDnu)) * (longWay ? -1 : 1)
  const denom = 1 - cosDnu
  if (!(denom > 1e-12)) return null
  const A = sinDnu * Math.sqrt((R1 * R2) / denom)
  if (!(Math.abs(A) > 1e-12)) return null

  // Stumpff functions, with the series limit taken at psi = 0.
  const stumpff = (psi, out) => {
    if (psi > 1e-6) {
      const s = Math.sqrt(psi)
      out[0] = (1 - Math.cos(s)) / psi
      out[1] = (s - Math.sin(s)) / Math.sqrt(psi * psi * psi)
    } else if (psi < -1e-6) {
      const s = Math.sqrt(-psi)
      out[0] = (1 - Math.cosh(s)) / psi
      out[1] = (Math.sinh(s) - s) / Math.sqrt(-psi * -psi * -psi)
    } else {
      out[0] = 0.5
      out[1] = 1 / 6
    }
  }

  const c = [0.5, 1 / 6]
  let low = -4 * Math.PI * Math.PI
  let up = 4 * Math.PI * Math.PI
  let psi = 0
  let y = 0
  let converged = false
  for (let i = 0; i < 300; i++) {
    stumpff(psi, c)
    y = R1 + R2 + (A * (psi * c[1] - 1)) / Math.sqrt(c[0])
    // A positive-A geometry with y < 0 is inconsistent; raise psi until it is not.
    for (let guard = 0; A > 0 && y < 0 && guard < 200; guard++) {
      psi += 0.1
      stumpff(psi, c)
      y = R1 + R2 + (A * (psi * c[1] - 1)) / Math.sqrt(c[0])
      low = psi
    }
    if (!(y > 0)) return null
    const chi = Math.sqrt(y / c[0])
    const dtTry = (chi * chi * chi * c[1] + A * Math.sqrt(y)) / Math.sqrt(mu)
    if (Math.abs(dtTry - dt) < 1e-8 * Math.max(dt, 1)) {
      converged = true
      break
    }
    if (dtTry <= dt) low = psi
    else up = psi
    psi = 0.5 * (low + up)
  }
  if (!converged) return null

  const f = 1 - y / R1
  const g = A * Math.sqrt(y / mu)
  const gdot = 1 - y / R2
  if (!(Math.abs(g) > 0)) return null
  return {
    v1: [0, 1, 2].map((i) => (r2[i] - f * r1[i]) / g),
    v2: [0, 1, 2].map((i) => (gdot * r2[i] - r1[i]) / g),
  }
}

/** A four-body integrator of the simulation's own kind: Sun, Earth, Moon and a massless craft. */
function scratchFor(sim) {
  const sc = new RK4NBody([BODIES.sun.mass, BODIES.earth.mass, BODIES.moon.mass, 0], new Float64Array(24), 3)
  sc.testSoftening2 = sim.testSoftening2
  return sc
}

/** The simulation's bodies and craft, packed into the four-body layout. */
function pack(sim, into) {
  into.set(sim.state.subarray(0, BODY_SLOTS))
  for (let i = 0; i < 6; i++) into[SHIP + i] = sim.state[CRAFT + i]
  return into
}

/** Selenocentric position and velocity of the craft in a packed state, into `out`. */
function selenocentric(state, out) {
  for (let i = 0; i < 6; i++) out[i] = state[SHIP + i] - state[MOON + i]
  return out
}

/** Fly a packed state from `from` to `to`; writes into `out` and returns it. */
function fly(sc, state, from, to, step, out) {
  sc.state.set(state)
  const n = Math.max(1, Math.ceil(Math.abs(to - from) / step))
  const h = (to - from) / n
  for (let s = 0; s < n; s++) sc.step(h)
  out.set(sc.state)
  return out
}

/**
 * Solve the burn at `t0` that puts the craft at `targetR` (Moon-relative) at
 * `t1`, by Gauss-Newton on central differences with a halving line search.
 */
function aimAt(sc, state, t0, t1, targetR, seedDv, { probe = 1e-2, step = 30, tolerance = 50, iterations = 20 } = {}) {
  const n = Math.max(1, Math.ceil((t1 - t0) / step))
  const h = (t1 - t0) / n
  const arrival = new Float64Array(6)
  const f = new Float64Array(3)
  const plus = new Float64Array(3)
  const minus = new Float64Array(3)
  const J = new Float64Array(9)
  const dv = [seedDv[0], seedDv[1], seedDv[2]]
  const trial = [0, 0, 0]

  const residual = (d, into) => {
    sc.state.set(state)
    for (let i = 0; i < 3; i++) sc.state[SHIP + 3 + i] += d[i]
    for (let s = 0; s < n; s++) sc.step(h)
    selenocentric(sc.state, arrival)
    for (let i = 0; i < 3; i++) into[i] = arrival[i] - targetR[i]
  }

  residual(dv, f)
  let miss = norm([f[0], f[1], f[2]])
  for (let it = 0; it < iterations && miss > tolerance; it++) {
    for (let c = 0; c < 3; c++) {
      for (let i = 0; i < 3; i++) trial[i] = dv[i]
      trial[c] += probe
      residual(trial, plus)
      trial[c] -= 2 * probe
      residual(trial, minus)
      for (let r = 0; r < 3; r++) J[r * 3 + c] = (plus[r] - minus[r]) / (2 * probe)
    }
    residual(dv, f)
    const det =
      J[0] * (J[4] * J[8] - J[5] * J[7]) - J[1] * (J[3] * J[8] - J[5] * J[6]) + J[2] * (J[3] * J[7] - J[4] * J[6])
    if (!(Math.abs(det) > 0)) break
    const b = [-f[0], -f[1], -f[2]]
    const column = (k) => {
      const A = [J[0], J[1], J[2], J[3], J[4], J[5], J[6], J[7], J[8]]
      for (let r = 0; r < 3; r++) A[r * 3 + k] = b[r]
      return A[0] * (A[4] * A[8] - A[5] * A[7]) - A[1] * (A[3] * A[8] - A[5] * A[6]) + A[2] * (A[3] * A[7] - A[4] * A[6])
    }
    const dx = [column(0) / det, column(1) / det, column(2) / det]
    let scale = 1
    let moved = false
    for (let k = 0; k < 16; k++) {
      for (let i = 0; i < 3; i++) trial[i] = dv[i] + scale * dx[i]
      residual(trial, f)
      const m = norm([f[0], f[1], f[2]])
      if (m < miss) {
        for (let i = 0; i < 3; i++) dv[i] = trial[i]
        miss = m
        moved = true
        break
      }
      scale *= 0.5
    }
    if (!moved) break
  }
  residual(dv, f)
  return { dv, miss, arrival: Float64Array.from(arrival) }
}

/**
 * The craft's next periselene, as a packed state and its epoch.
 *
 * Found by stepping rather than from the osculating elements, because the
 * approach is only Keplerian about the Moon to the extent the Earth is ignorable
 * — which on the way in it is not.
 */
export function nextPeriselene(sim, { step = 30, horizon = 8 * 86400 } = {}) {
  const sc = scratchFor(sim)
  const packed = pack(sim, new Float64Array(24))
  const here = new Float64Array(6)
  sc.state.set(packed)
  let prev = Infinity
  let prevPrev = Infinity
  for (let t = 0; t < horizon; t += step) {
    sc.step(step)
    selenocentric(sc.state, here)
    const r = norm([here[0], here[1], here[2]])
    if (prev < prevPrev && prev < r) {
      const at = sim.t + t - step
      return { t: at, state: fly(sc, packed, sim.t, at, step, new Float64Array(24)) }
    }
    prevPrev = prev
    prev = r
  }
  return null
}

/** The units the family is tabulated in, as in `halo.js`. */
const LENGTH = 384400e3

/**
 * Solve a three-burn capture from the craft's approach onto a real-field halo.
 *
 * Searches a small grid, because the cost is not smooth in any of its three
 * parameters and every cell has to shoot its own reference: how far out the
 * transfer's apolune is put (as a fraction of the halo's own), how long the
 * craft then coasts to the patch point, and which mirror of the family it joins.
 * The best converged cell is returned, along with every cell tried.
 *
 * `member` is a CR3BP family member as `continueFamily` produces them. `sim`
 * supplies the field and the craft, which must be on a lunar approach — the
 * first periselene ahead of `sim.t` is where the first burn goes.
 */
export function solveHaloCapture(
  sim,
  member,
  {
    apolunes = [0.8, 0.9, 1.0],
    transfers = [4.25, 5.5],
    mirrors = [1, -1],
    revolutions = 3,
    step = 30,
    probe = 1e-2,
    tolerance = 50,
    shoot = shootHalo,
  } = {},
) {
  const sc = scratchFor(sim)
  const peri = nextPeriselene(sim, { step })
  if (!peri) return { converged: false, reason: 'no periselene ahead', tried: [] }

  const here = selenocentric(peri.state, new Float64Array(6))
  const rPeri = norm([here[0], here[1], here[2]])
  const vPeri = [here[3], here[4], here[5]]
  const speed = norm(vPeri)
  const along = unit(vPeri)
  const rApolune = member.apolune * LENGTH
  const scratch = new Float64Array(24)
  const transfer = new Float64Array(24)
  const at = new Float64Array(6)
  const tried = []
  let best = null

  for (const fraction of apolunes) {
    // Burn one, by vis-viva: the retrograde impulse that leaves an ellipse with
    // this apolune. Below the capture threshold there is no apolune to find.
    const target = fraction * rApolune
    const a = (rPeri + target) / 2
    const want = Math.sqrt(MU_MOON * (2 / rPeri - 1 / a))
    const first = speed - want
    if (!(first > 0)) continue
    scratch.set(peri.state)
    for (let i = 0; i < 3; i++) scratch[SHIP + 3 + i] -= first * along[i]

    // Where that ellipse turns round, found by stepping.
    sc.state.set(scratch)
    let apoT = 0
    let prev = 0
    let prevPrev = 0
    for (let k = 1; k < 40000; k++) {
      sc.step(60)
      selenocentric(sc.state, at)
      const r = norm([at[0], at[1], at[2]])
      if (prev > prevPrev && prev > r && prev > 20000e3) {
        apoT = peri.t + (k - 1) * 60
        break
      }
      prevPrev = prev
      prev = r
    }
    if (!apoT) continue
    fly(sc, scratch, peri.t, apoT, step, transfer)
    const apo = selenocentric(transfer, new Float64Array(6))
    const rA = [apo[0], apo[1], apo[2]]
    const vA = [apo[3], apo[4], apo[5]]

    for (const mirror of mirrors) {
      const shape = mirror < 0 ? { ...member, z: -member.z } : member
      for (const days of transfers) {
        const span = days * 86400
        const arriveAt = apoT + span
        const bodies = fly(sc, transfer, apoT, arriveAt, step, new Float64Array(24))
        const reference = shoot({ state: bodies, t: arriveAt, testSoftening2: sim.testSoftening2 }, shape, {
          revolutions,
          step,
        })
        const targetR = [reference.states[0], reference.states[1], reference.states[2]]
        const targetV = [reference.states[3], reference.states[4], reference.states[5]]

        // Burn two, seeded by the two-body arc that gets there in the time
        // allowed, then corrected in the real field.
        let seed = null
        for (const longWay of [false, true]) {
          const arc = lambert(rA, targetR, span, MU_MOON, longWay)
          if (!arc) continue
          const dv = [0, 1, 2].map((i) => arc.v1[i] - vA[i])
          if (!seed || norm(dv) < norm(seed)) seed = dv
        }
        if (!seed) continue
        const second = aimAt(sc, transfer, apoT, arriveAt, targetR, seed, { probe, step, tolerance })

        // Burn three: whatever velocity the reference has there that the craft does not.
        const third = [0, 1, 2].map((i) => targetV[i] - second.arrival[3 + i])
        const cell = {
          fraction,
          mirror,
          days,
          apolune: norm(rA),
          apoluneAt: apoT,
          first,
          second: norm(second.dv),
          third: norm(third),
          miss: second.miss,
          total: first + norm(second.dv) + norm(third),
          converged: second.miss < 5e3,
        }
        tried.push(cell)
        if (cell.converged && (!best || cell.total < best.total)) {
          best = {
            ...cell,
            reference,
            burns: [
              {
                t: peri.t,
                dv: along.map((c) => -first * c),
                magnitude: first,
                label: 'capture',
                // The state the burn is made from, so a caller can build the
                // frame a planned node is written in at that instant.
                at: Float64Array.from(peri.state),
              },
              { t: apoT, dv: [...second.dv], magnitude: norm(second.dv), label: 'plane', at: Float64Array.from(transfer) },
              { t: arriveAt, dv: third, magnitude: norm(third), label: 'insertion' },
            ],
          }
        }
      }
    }
  }
  if (!best) return { converged: false, reason: 'no cell converged', tried }
  return { converged: true, ...best, tried }
}

/**
 * Re-aim the transfer at the patch point, from where the craft actually is.
 *
 * The capture is solved against impulses days before it is flown, and the burns
 * that fly it are not impulses: a 283 m/s plane change is some 79 s of service
 * module, and a couple of m/s delivered off the solution is 475 km by the time
 * the craft reaches the patch point, five days on. Flown without this the craft
 * arrived 939 km out — close enough to look captured, far enough that the
 * station-keeping law, which exists to spend centimetres a second, could not
 * solve at all.
 *
 * So the same Newton runs again over the coast that is left, from the state the
 * craft has rather than the one the search predicted. Solving at `burnAt` rather
 * than now leaves the sequencer time to turn toward it.
 */
export function solveHaloCorrection(sim, reference, burnAt, { probe = 1e-3, step = 30, tolerance = 50, patch = 0 } = {}) {
  const sc = scratchFor(sim)
  const packed = pack(sim, new Float64Array(24))
  const arrival = reference.epochs[patch]
  if (!(burnAt > sim.t) || !(arrival > burnAt)) return null
  const at = fly(sc, packed, sim.t, burnAt, step, new Float64Array(24))
  const target = [reference.states[6 * patch], reference.states[6 * patch + 1], reference.states[6 * patch + 2]]
  const solved = aimAt(sc, at, burnAt, arrival, target, [0, 0, 0], { probe, step, tolerance })
  return { ...solved, at, burnAt, arrival }
}
