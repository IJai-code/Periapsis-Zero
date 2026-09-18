import { G } from './constants.js'
import { ATMOSPHERE_TOP, density } from './atmosphere.js'

/**
 * Classical Runge-Kutta 4th-order N-body integrator, in two tiers.
 *
 * State is one flat Float64Array laid out as [x, y, z, vx, vy, vz] per body,
 * in SI units. Every buffer is allocated once in the constructor: `step()` runs
 * on every animation frame and must not produce garbage.
 *
 * Bodies below `massiveCount` interact fully and pair-symmetrically. Bodies at
 * or above it are **test particles**: they read gravity from the massive set,
 * exert none in return, and ignore each other. That is the restricted N-body
 * formulation, and it does two things a zero-mass entry in the full pair loop
 * would not. It drops the cost from O(N^2/2) to O(M^2/2 + P*M), and it makes it
 * structurally impossible for a spacecraft to perturb a planet — the massive
 * bodies' accelerations never read a test particle's slot at all.
 *
 * Accelerations come straight from Newton's law of universal gravitation with
 * no softening term. The massive bodies never approach each other closely
 * enough for the 1/r^2 singularity to bite, and adding softening would quietly
 * falsify the orbits. Test particles get a floor on r^2 instead, since a
 * spacecraft really can fly into a planet.
 */
export class RK4NBody {
  /**
   * @param {number[]} masses in kilograms, in the same order as the state vector
   * @param {Float64Array} initial flat state, length 6 * masses.length
   * @param {number} massiveCount how many leading bodies are gravitationally active
   */
  constructor(masses, initial, massiveCount = masses.length) {
    this.n = masses.length
    this.massiveCount = massiveCount
    this.masses = Float64Array.from(masses)
    this.state = Float64Array.from(initial)
    this.t = 0 // seconds since epoch

    const len = this.n * 6
    this.k1 = new Float64Array(len)
    this.k2 = new Float64Array(len)
    this.k3 = new Float64Array(len)
    this.k4 = new Float64Array(len)
    this.tmp = new Float64Array(len)

    /**
     * World-space non-gravitational acceleration per test particle — thrust.
     * Written once per frame by the driver and held constant across all four
     * RK4 stages: a zero-order hold on the control input, which is how discrete
     * control is modelled in real avionics. RK4 integrates a constant
     * acceleration *exactly*, so a steady burn costs no integration error.
     */
    this.extAccel = new Float64Array(Math.max(0, this.n - massiveCount) * 3)

    /**
     * Aerodynamic drag, per test particle.
     *
     * `dragK` is (Cd * A) / 2m — everything in the drag term that belongs to the
     * vehicle rather than to the state — so the inner loop multiplies rather
     * than reconstructs it. Zero disables drag for that particle.
     *
     * Unlike thrust, drag is *not* a zero-order hold. It depends on position
     * (through density) and on velocity (quadratically), so it has to be
     * evaluated inside every RK4 stage rather than frozen for the step. Freezing
     * it would drop the whole integration back to first order exactly where the
     * dynamics are stiffest.
     */
    this.dragK = new Float64Array(Math.max(0, this.n - massiveCount))

    /**
     * Aerodynamic lift, per test particle.
     *
     * `liftK` is (Cl * A) / 2m, the same shape as `dragK`, and `bank` is the
     * roll angle of the lift vector about the relative wind — 0 for lift
     * straight up, pi for straight down, +-pi/2 for purely lateral.
     *
     * The split between them is the split between plant and control, and it is
     * the same one thrust already makes. `liftK` is a property of the vehicle
     * and the lift force is recomputed inside every RK4 stage, because it
     * depends on position through density and on velocity quadratically — the
     * same reasoning that keeps drag out of the zero-order hold. `bank` is a
     * *command*, held constant across the four stages, because a control input
     * that varied within a step would not correspond to anything the flight
     * computer could actually issue.
     *
     * Zero `liftK` recovers the ballistic capsule exactly.
     */
    this.liftK = new Float64Array(Math.max(0, this.n - massiveCount))
    this.bank = new Float64Array(Math.max(0, this.n - massiveCount))
    /** State-vector slot of the body with an atmosphere, or -1. */
    this.dragBody = -1
    this.dragBodyRadius = 0
    /** Angular velocity of that body, rad/s — the air co-rotates with it. */
    this.omega = new Float64Array(3)

    /**
     * Step ceiling, in seconds. Lives on the instance rather than only at the
     * call site because a caller who forgets it silently gets the 900 s
     * planetary default — which is eight steps per revolution for a low orbit,
     * enough to tear a satellite off the planet. Refreshed each frame from the
     * fastest craft in flight.
     */
    this.maxDt = 900

    /**
     * Floor on r^2 for test particles only, in square metres.
     *
     * A *floor* rather than an additive softening term: adding biases gravity
     * everywhere, and at a plausible floor of a quarter Earth radius that is an
     * 8% error at 400 km — enough to lift a circular orbit by 78 km per
     * revolution. Clamping instead has exactly zero effect outside the
     * threshold and, since the numerator keeps the true separation vector,
     * decays acceleration smoothly to zero at the centre.
     */
    this.testSoftening2 = 0

    /**
     * Bodies that pull but are not pulled: the rest of the solar system.
     *
     * Null unless a caller installs one. The shape is `{ count, mu, helio,
     * sunOffset, refresh }` — `mu` is GM per body, `helio` is xyz per body
     * measured from the Sun, `sunOffset` says which slot of the state vector
     * the Sun occupies, and `refresh(t)` rewrites `helio` for a given time.
     *
     * They act on test particles only. Letting them act on the massive bodies
     * would make the integrated three-body solution depend on a table of
     * approximate elements, and every figure ever measured about it — the
     * energy drift, the step ceilings, the flown missions — is a figure about
     * a closed system of three.
     *
     * `refresh` is called once per step rather than once per stage: the same
     * zero-order hold thrust already uses, for the same reason it is sound here
     * — over a 900 s step Jupiter moves 1.5e-5 of its own orbital radius, and
     * RK4 integrates a constant acceleration exactly.
     */
    this.rails = null

    /**
     * What the rails pull with, per test particle, held for the step.
     *
     * Evaluating seven extra bodies inside all four RK4 stages made the gate
     * suite 4.6 times slower for an acceleration of order 1e-7 m/s^2 that
     * changes by about one part in 1e8 across a step — the craft moves a few
     * kilometres, the planet is 1e11 m away. So it is computed once from the
     * state at the step's start and held, which is what `extAccel` already does
     * with thrust and for a far better reason here.
     */
    this.railAccel = new Float64Array(3 * Math.max(0, this.n - massiveCount))

    /**
     * When the rails were last solved, in a slot rather than a field.
     *
     * The throttle used to live in the rails module behind `refresh(t)`, which
     * meant a call through a property with a double argument on every step —
     * 16,210 B a projection, all of it boxing that argument. Here the common
     * case is a Float64Array read and a comparison, and the call happens only
     * when the sky has actually moved.
     */
    this.railClock = new Float64Array(1)
    this.railClock[0] = NaN

    /**
     * Whether this integrator is the one that moves the planets.
     *
     * The live simulation is; a projection is not. A forecast borrows whatever
     * sky the live run last solved and holds it, which is both cheaper and more
     * honest — the drawn path and the flown path are then answering to exactly
     * the same planetary positions, which is the agreement this codebase has
     * paid for losing before.
     *
     * A projection does not recompute the pull either, it inherits the value.
     * That costs nothing in accuracy — the planet is 1e11 m away, so moving the
     * craft the width of a translunar coast changes its pull by about a part in
     * a thousand of an acceleration already down at 1e-7 m/s^2 — and it is the
     * whole of the cost. Recomputed per step in a projection it measured
     * 16,178 B against a 1,024 B budget, because a method called from nowhere
     * else is never hot enough for the optimiser and boxes its intermediates.
     */
    this.movesRails = true

    this.initialEnergy = this.energy()
  }

  /**
   * dy/dt for the whole system. Pair-symmetric: each interaction is evaluated
   * once and applied to both bodies with opposite sign, which halves the work
   * and makes momentum conservation exact to floating point.
   */
  derivative(y, out) {
    const { n, massiveCount: M, masses: m, extAccel, testSoftening2: soft2 } = this

    for (let i = 0; i < n; i++) {
      const o = i * 6
      out[o] = y[o + 3]
      out[o + 1] = y[o + 4]
      out[o + 2] = y[o + 5]
      out[o + 3] = 0
      out[o + 4] = 0
      out[o + 5] = 0
    }

    // Tier 1 — massive against massive. Each interaction is evaluated once and
    // applied to both bodies with opposite sign, which halves the work and
    // makes momentum conservation exact to floating point.
    for (let i = 0; i < M; i++) {
      const oi = i * 6
      for (let j = i + 1; j < M; j++) {
        const oj = j * 6
        const dx = y[oj] - y[oi]
        const dy = y[oj + 1] - y[oi + 1]
        const dz = y[oj + 2] - y[oi + 2]

        const r2 = dx * dx + dy * dy + dz * dz
        const invR3 = 1 / (r2 * Math.sqrt(r2))

        const ai = G * m[j] * invR3 // acceleration of i, toward j
        const aj = G * m[i] * invR3 // acceleration of j, toward i

        out[oi + 3] += ai * dx
        out[oi + 4] += ai * dy
        out[oi + 5] += ai * dz

        out[oj + 3] -= aj * dx
        out[oj + 4] -= aj * dy
        out[oj + 5] -= aj * dz
      }
    }

    // Tier 2 — test particles. One-way gravity, plus thrust.
    for (let p = M; p < n; p++) {
      const op = p * 6
      for (let j = 0; j < M; j++) {
        const oj = j * 6
        const dx = y[oj] - y[op]
        const dy = y[oj + 1] - y[op + 1]
        const dz = y[oj + 2] - y[op + 2]

        const raw = dx * dx + dy * dy + dz * dz
        const r2 = raw < soft2 ? soft2 : raw
        const a = (G * m[j]) / (r2 * Math.sqrt(r2))

        out[op + 3] += a * dx
        out[op + 4] += a * dy
        out[op + 5] += a * dz
      }

      // And the planets, as a constant for this step. See `railAccel`.
      if (this.rails !== null) {
        const or = (p - M) * 3
        out[op + 3] += this.railAccel[or]
        out[op + 4] += this.railAccel[or + 1]
        out[op + 5] += this.railAccel[or + 2]
      }

      const e = (p - M) * 3
      out[op + 3] += extAccel[e]
      out[op + 4] += extAccel[e + 1]
      out[op + 5] += extAccel[e + 2]

      // Aerodynamic drag against the co-rotating atmosphere.
      const k0 = this.dragK[p - M]
      if (k0 > 0 && this.dragBody >= 0) {
        const ob = this.dragBody * 6
        const rx = y[op] - y[ob]
        const ry = y[op + 1] - y[ob + 1]
        const rz = y[op + 2] - y[ob + 2]
        const alt = Math.sqrt(rx * rx + ry * ry + rz * rz) - this.dragBodyRadius

        if (alt < ATMOSPHERE_TOP) {
          const rho = density(alt)
          if (rho > 0) {
            // The air turns with the planet, so the wind a craft feels is its
            // velocity minus the local surface velocity omega x r. At the
            // equator that is 465 m/s — 6% of orbital speed, and the difference
            // between a prograde and a retrograde reentry.
            const w = this.omega
            const vx = y[op + 3] - y[ob + 3] - (w[1] * rz - w[2] * ry)
            const vy = y[op + 4] - y[ob + 4] - (w[2] * rx - w[0] * rz)
            const vz = y[op + 5] - y[ob + 5] - (w[0] * ry - w[1] * rx)

            const speed = Math.sqrt(vx * vx + vy * vy + vz * vz)
            const k = k0 * rho * speed // the |v| of the |v| v term
            out[op + 3] -= k * vx
            out[op + 4] -= k * vy
            out[op + 5] -= k * vz

            /**
             * Lift, perpendicular to the relative wind.
             *
             * A blunt capsule flies a fixed trimmed angle of attack, set by an
             * offset centre of mass, so the *magnitude* of lift is not a
             * control at all — only its direction is. Rolling about the wind
             * vector is the entire control authority the vehicle has.
             *
             * The frame is built on the wind rather than on the position, which
             * matters at entry speeds: the air is turning at 400 m/s and the
             * lift acts on the flow the vehicle actually meets, not on its
             * inertial velocity. From v-hat, the local vertical projected
             * perpendicular to it gives "up"; their cross product gives the
             * lateral axis; and the bank angle rotates lift between them.
             */
            const kl = this.liftK[p - M]
            if (kl !== 0 && speed > 1) {
              const inv = 1 / speed
              const vhx = vx * inv
              const vhy = vy * inv
              const vhz = vz * inv

              // Local vertical. `alt` already carries the radius, so no sqrt.
              const rlen = alt + this.dragBodyRadius
              const rhx = rx / rlen
              const rhy = ry / rlen
              const rhz = rz / rlen

              // Component of "up" perpendicular to the wind.
              const dot = rhx * vhx + rhy * vhy + rhz * vhz
              let ux = rhx - dot * vhx
              let uy = rhy - dot * vhy
              let uz = rhz - dot * vhz
              const ulen = Math.sqrt(ux * ux + uy * uy + uz * uz)

              // Degenerate only if flying exactly radially, where "up" relative
              // to the wind is undefined and lift genuinely has no vertical
              // sense to resolve.
              if (ulen > 1e-9) {
                const uinv = 1 / ulen
                ux *= uinv
                uy *= uinv
                uz *= uinv

                // Lateral axis completes the triad: w = v x u.
                const wx = vhy * uz - vhz * uy
                const wy = vhz * ux - vhx * uz
                const wz = vhx * uy - vhy * ux

                const sig = this.bank[p - M]
                const cs = Math.cos(sig)
                const sn = Math.sin(sig)
                const aL = kl * rho * speed * speed

                out[op + 3] += aL * (cs * ux + sn * wx)
                out[op + 4] += aL * (cs * uy + sn * wy)
                out[op + 5] += aL * (cs * uz + sn * wz)
              }
            }
          }
        }
      }
    }
  }

  /**
   * The rails' pull on each test particle, frozen for the step like thrust.
   *
   * A method rather than inlined into `step`, and that is not a style choice.
   * Written out inside `step` it allocated 16,178 B a projection *with the
   * rails switched off entirely* — the block is large enough to push `step`
   * past what the optimiser will take, and an unoptimised `step` boxes the
   * doubles of the RK4 combination itself. The same code behind a call leaves
   * `step` the shape it was.
   */
  applyRails() {
    const rails = this.rails
    const clock = this.railClock
    // NaN on the first step, and any comparison with NaN is false, so the first
    // call always solves. A jump in either direction re-solves too, which is
    // what a reset or a back-propagated trail needs.
    if (!(Math.abs(this.t - clock[0]) < rails.refreshAfter)) {
      clock[0] = this.t
      rails.refresh(this.t)
    }
    const y = this.state
    const M = this.massiveCount
    const n = this.n
    const so = rails.sunOffset
    const sx = y[so]
    const sy = y[so + 1]
    const sz = y[so + 2]
    const helio = rails.helio
    const mu = rails.mu
    const count = rails.count
    const accel = this.railAccel
    const soft2 = this.testSoftening2
    for (let p = M; p < n; p++) {
      const op = p * 6
      let ax = 0
      let ay = 0
      let az = 0
      for (let j = 0; j < count; j++) {
        const oj = j * 3
        const dx = sx + helio[oj] - y[op]
        const dy = sy + helio[oj + 1] - y[op + 1]
        const dz = sz + helio[oj + 2] - y[op + 2]
        const raw = dx * dx + dy * dy + dz * dz
        const r2 = raw < soft2 ? soft2 : raw
        const a = mu[j] / (r2 * Math.sqrt(r2))
        ax += a * dx
        ay += a * dy
        az += a * dz
      }
      const or = (p - M) * 3
      accel[or] = ax
      accel[or + 1] = ay
      accel[or + 2] = az
    }
  }

  /** One RK4 step of `dt` seconds. `dt` may be negative (back-propagation). */
  step(dt) {
    const { state: y, k1, k2, k3, k4, tmp } = this
    const len = y.length
    const h2 = dt * 0.5
    const h6 = dt / 6

    this.derivative(y, k1)
    for (let a = 0; a < len; a++) tmp[a] = y[a] + h2 * k1[a]

    this.derivative(tmp, k2)
    for (let a = 0; a < len; a++) tmp[a] = y[a] + h2 * k2[a]

    this.derivative(tmp, k3)
    for (let a = 0; a < len; a++) tmp[a] = y[a] + dt * k3[a]

    this.derivative(tmp, k4)
    for (let a = 0; a < len; a++) {
      y[a] += h6 * (k1[a] + 2 * k2[a] + 2 * k3[a] + k4[a])
    }

    this.t += dt
  }

  /**
   * Advance by `seconds` of simulated time, subdividing so no single step
   * exceeds `maxDt`. The substep count is capped so that an extreme time warp
   * degrades accuracy gracefully instead of stalling the frame.
   */
  advance(seconds, maxDt = this.maxDt, maxSubsteps = 2048) {
    if (seconds === 0) return 0
    /*
     * Here rather than in `step`, and the difference is 16,178 B a projection.
     * `step` holds its RK4 coefficients in double locals that stay live across
     * anything it calls, so a call it cannot inline forces every one of them
     * onto the heap — the cost is paid on every step whether the call does
     * anything or not. `advance` runs once a frame, and a frame's planets are
     * frozen anyway.
     */
    if (this.rails !== null && this.movesRails) this.applyRails()
    const steps = Math.min(maxSubsteps, Math.max(1, Math.ceil(Math.abs(seconds) / maxDt)))
    const dt = seconds / steps
    for (let s = 0; s < steps; s++) this.step(dt)
    return steps
  }

  /**
   * Total mechanical energy of the **massive** bodies, in joules.
   *
   * Test particles are excluded deliberately. A thrusting spacecraft adds
   * energy to the system by design, so including it would turn the HUD's drift
   * readout from a measure of integrator quality into a measure of how hard the
   * pilot is burning. Restricted to the massive set, the figure keeps meaning
   * what it has always meant.
   */
  energy() {
    const { massiveCount: n, masses: m, state: y } = this
    let kinetic = 0
    let potential = 0
    for (let i = 0; i < n; i++) {
      const o = i * 6
      const vx = y[o + 3]
      const vy = y[o + 4]
      const vz = y[o + 5]
      kinetic += 0.5 * m[i] * (vx * vx + vy * vy + vz * vz)
      for (let j = i + 1; j < n; j++) {
        const oj = j * 6
        const dx = y[oj] - y[o]
        const dy = y[oj + 1] - y[o + 1]
        const dz = y[oj + 2] - y[o + 2]
        potential -= (G * m[i] * m[j]) / Math.sqrt(dx * dx + dy * dy + dz * dz)
      }
    }
    return kinetic + potential
  }

  /**
   * Fractional drift of total energy since t=0. This is the honest measure of
   * how much the integrator is lying to you; RK4 at these step sizes holds it
   * around 1e-11, so the HUD reports it in parts per billion.
   */
  energyDrift() {
    return (this.energy() - this.initialEnergy) / Math.abs(this.initialEnergy)
  }

  /**
   * Copy of the current state, for back-propagating trails without disturbing
   * it. The clone's `extAccel` starts at zero, so a trail seeded from it is
   * ballistic — which is what you want, since replaying the current thrust
   * backwards through history would be meaningless.
   */
  clone() {
    const copy = new RK4NBody(this.masses, this.state, this.massiveCount)
    copy.testSoftening2 = this.testSoftening2
    copy.maxDt = this.maxDt
    // The same sky, or a projection would be drawn under different physics from
    // the one that gets flown — which is the disagreement this codebase has
    // paid for before, between the map and the autopilot.
    copy.rails = this.rails
    copy.movesRails = false
    // Carry the field itself across, or a projection would fly with no planets
    // in it at all while the craft it forecasts flies with seven.
    copy.railAccel.set(this.railAccel)
    return copy
  }

  /**
   * Reset this integrator to another's state, without allocating.
   *
   * `clone()` builds a whole integrator — six state-sized buffers and the
   * per-particle tables — which is right for the trail seeder, since that runs
   * once per mount. It is wrong for anything that re-projects continuously: the
   * map's forward prediction resets a scratch integrator several times a second
   * and would otherwise hand the collector a new set of buffers each time.
   *
   * Ballistic on purpose, like `clone()`: thrust and lift are left at zero, so
   * a projection shows where the craft goes if nothing further is commanded.
   * Drag is kept, because it is a property of the vehicle and the air rather
   * than of the pilot, and a projection through the atmosphere that ignored it
   * would be confidently wrong exactly where it matters.
   */
  resetFrom(other) {
    this.state.set(other.state)
    this.t = other.t
    this.railAccel.set(other.railAccel)
    this.extAccel.fill(0)
    this.dragK.set(other.dragK)
    if (this.liftK && other.liftK) this.liftK.set(other.liftK)
    if (this.bank && other.bank) this.bank.set(other.bank)
    return this
  }
}
