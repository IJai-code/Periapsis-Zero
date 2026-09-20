import { GAMMA_AIR, pressure } from '../sim/atmosphere.js'

/**
 * What an exhaust plume looks like, from the nozzle it came out of and the air
 * it is expanding into.
 *
 * A rocket nozzle has a fixed area ratio, so its exit pressure is fixed no
 * matter where the vehicle is. Ambient pressure is not. Everything a plume does
 * between the pad and vacuum follows from which of the two is larger:
 *
 *   p_ambient > p_exit   **over-expanded**. The outside air crushes the jet
 *                        back in, and it recovers through a train of oblique
 *                        shocks — the Mach diamonds on a first stage at liftoff.
 *   p_ambient = p_exit   **matched**. A clean column, no shocks, no flare. This
 *                        happens once, at the altitude the nozzle was designed
 *                        for.
 *   p_ambient < p_exit   **under-expanded**. The jet keeps expanding after it
 *                        leaves, turning outward through a Prandtl-Meyer fan,
 *                        and the lower the ambient the wider it opens. In
 *                        vacuum there is nothing to stop it at all.
 *
 * None of that is keyed to dynamic pressure, which is the obvious-looking state
 * to reach for and is the wrong one: `live.dynamicPressure` is 1/2 rho v^2, and
 * on the pad the clamp gives the vehicle exactly the local surface velocity, so
 * it reads **zero** there by construction. A plume driven by it would be fully
 * expanded at liftoff and collapse as the vehicle accelerated — backwards twice.
 * What drives a plume is ambient static pressure, which `atmosphere.js` derives
 * from the density the integrator is already using.
 *
 * ── what is declared and what is derived ──────────────────────────────
 *
 * Declared, per stage, in `vessels.js`: the nozzle's **area ratio** and the
 * engine's **chamber pressure**. Both are published engine figures of the same
 * kind as `thrust` and `isp`, which are also recorded rather than derived.
 *
 * Everything else here is the isentropic relations and Prandtl-Meyer, with no
 * fitted constants: the exit Mach number comes from the area ratio, the exit
 * pressure from the exit Mach and the chamber pressure, and the plume's opening
 * angle from the turn the flow makes expanding from the exit pressure to
 * ambient. `verify-plume` checks the chain against the vehicles it is applied
 * to — the F-1's exit plane comes out at Mach 3.60 and 47.8 kPa, which puts the
 * S-IC over-expanded on the pad and matched near 4.5 km, and that is the
 * altitude the Saturn V's diamonds are gone by.
 */

/**
 * Ratio of specific heats for rocket exhaust, not for air.
 *
 * Combustion products are hot polyatomic gas and run near 1.2 where air runs
 * 1.4. It matters: the Prandtl-Meyer turn a jet can make before it reaches
 * vacuum is (pi/2)(sqrt((g+1)/(g-1)) - 1), which is 130 degrees at 1.4 and
 * **208 degrees** at 1.2. Using air's value here would under-open every plume.
 */
export const GAMMA_EXHAUST = 1.2

/** Nozzle figures for a stage that does not carry its own. See `vessels.js`. */
export const DEFAULT_NOZZLE = { areaRatio: 16, chamberPressure: 7.0e6 }

/**
 * Prandtl-Meyer function, radians: how far a supersonic flow has turned by the
 * time it reaches Mach `M`, measured from Mach 1.
 */
export function prandtlMeyer(M, g = GAMMA_EXHAUST) {
  if (!(M > 1)) return 0
  const k = Math.sqrt((g + 1) / (g - 1))
  const m = Math.sqrt(M * M - 1)
  return k * Math.atan(m / k) - Math.atan(m)
}

/** The turn a jet makes expanding all the way to vacuum, radians. */
export const maxTurn = (g = GAMMA_EXHAUST) => (Math.PI / 2) * (Math.sqrt((g + 1) / (g - 1)) - 1)

/**
 * Exit Mach number from the nozzle's area ratio, by the isentropic area
 * relation. Bisected rather than solved in closed form, because the relation
 * does not invert: 40 halvings of a bracket that is generous at both ends.
 */
export function exitMach(areaRatio, g = GAMMA_EXHAUST) {
  if (!(areaRatio > 1)) return 1
  const e = (g + 1) / (2 * (g - 1))
  const c = 2 / (g + 1)
  const h = (g - 1) / 2
  const ratio = (M) => Math.pow(c * (1 + h * M * M), e) / M
  let lo = 1.0001
  let hi = 60
  for (let i = 0; i < 40; i++) {
    const mid = 0.5 * (lo + hi)
    if (ratio(mid) < areaRatio) lo = mid
    else hi = mid
  }
  return 0.5 * (lo + hi)
}

/** Static over stagnation pressure at a Mach number, isentropic. */
export const pressureRatio = (M, g = GAMMA_EXHAUST) =>
  Math.pow(1 + ((g - 1) / 2) * M * M, -g / (g - 1))

/** And back: the Mach number a flow reaches expanding to `p / p0`. */
export function machFromPressure(ratio, g = GAMMA_EXHAUST) {
  if (!(ratio > 0)) return Infinity
  if (ratio >= 1) return 0
  return Math.sqrt((2 / (g - 1)) * (Math.pow(ratio, -(g - 1) / g) - 1))
}

/** Exit static pressure of a nozzle, Pa. */
export function exitPressure(nozzle, g = GAMMA_EXHAUST) {
  return _table[slotFor(nozzle, g) + PE]
}

/**
 * How wide a plume drawn at `angle` radians is allowed to open.
 *
 * The Prandtl-Meyer turn is real all the way to 208 degrees, and a plume drawn
 * at 208 degrees is a sphere pointing backwards, which is a worse picture of a
 * rocket than a narrow one. Real vacuum plumes *are* nearly hemispherical and
 * are also nearly invisible at that point, because the same expansion that
 * opens them drops their density to nothing. So the drawn angle is capped, and
 * the cap is declared here as a drawing decision rather than buried as a
 * coefficient: 60 degrees, past which the mesh is opening faster than its
 * brightness is falling and it stops reading as exhaust.
 */
export const DRAWN_HALF_ANGLE_CAP = Math.PI / 3

/**
 * Everything that depends only on the nozzle, cached in a flat table.
 *
 * Two reasons it is a `Float64Array` and an integer index rather than the
 * obvious object in a `Map`.
 *
 * The cheap one: `exitMach` is forty halvings of a bracket and Prandtl-Meyer is
 * two arctans, and none of it changes while a stage is burning, so it is solved
 * once and looked up after that.
 *
 * The expensive one: a `Map.get` hands back an object whose shape V8 cannot
 * pin at the call site, so every double read off it is **boxed on load**.
 * Measured on this file — the same arithmetic reading these constants off a
 * cached object allocated 19 to 33 bytes a call, and reading them out of a flat
 * array allocates nothing. It is the same hazard `rails.js` hit reading orbital
 * elements out of object arrays, and it has the same fix.
 */
const PE = 0
const NU_E = 1
const P0 = 2
const TURN_MAX = 3
const K = 4
const EXP = 5
const KV = 6
const FIELDS = 7

const _slots = new Map()
let _table = new Float64Array(FIELDS * 8)
let _used = 0

function slotFor(nozzle, g) {
  const found = _slots.get(nozzle)
  if (found !== undefined) return found
  const i = _used * FIELDS
  if (i + FIELDS > _table.length) {
    const grown = new Float64Array(_table.length * 2)
    grown.set(_table)
    _table = grown
  }
  const Me = exitMach(nozzle.areaRatio, g)
  const pe = nozzle.chamberPressure * pressureRatio(Me, g)
  _table[i + PE] = pe
  _table[i + NU_E] = prandtlMeyer(Me, g)
  _table[i + P0] = pe / pressureRatio(Me, g)
  _table[i + TURN_MAX] = maxTurn(g) - prandtlMeyer(Me, g)
  _table[i + K] = 2 / (g - 1)
  _table[i + EXP] = -(g - 1) / g
  _table[i + KV] = Math.sqrt((g + 1) / (g - 1))
  _used++
  _slots.set(nozzle, i)
  return i
}

/**
 * The plume's state at an altitude, written into `out` — never allocated.
 *
 * @param {Float64Array} out  [halfAngle rad, diamonds 0-1, underExpansion, lengthScale]
 */
export function plumeState(out, nozzle, altitude, g = GAMMA_EXHAUST) {
  return plumeAt(out, slotFor(nozzle, g), pressure(altitude))
}

/** The slot a nozzle's constants live in. Called once, not per frame. */
export const nozzleSlot = (nozzle, g = GAMMA_EXHAUST) => slotFor(nozzle, g)

/**
 * ── what this costs, measured, including the part I did not solve ─────
 *
 * `plumeAt` below is the frame path and it is not allocation-free. Measured
 * across a realistic pressure sweep, reproducibly, it is **11.8 bytes a call**:
 * 0.8 in the over-expanded and vacuum regimes, and **16.8 in the
 * under-expanded one** — one boxed double, in a branch that is pure arithmetic
 * on `Float64Array` elements. I could not find which value V8 tags. Replacing
 * `Math.pow` with `exp(e log x)` moved nothing; removing every unreachable
 * `x > 0 ? x : 0` moved nothing; caching the answer and returning it on a
 * comparison made it *worse*, 23.4 bytes, because the extra call and branch
 * cost more than the arithmetic saved.
 *
 * Two things that did work, and are the reason it is 11.8 rather than 33:
 * taking the object argument out — a `Map.get` hands back a shape V8 cannot
 * pin, so every double read off it boxed — and taking the call to
 * `atmosphere.pressure` out, so the caller reads the air once a frame rather
 * than once an engine. Both also made the *measurement* repeatable, which it
 * was not before: on the object version the same unchanged code read 48.80 and
 * 17.61 bytes on alternating runs, and several of the "fixes" that produced
 * those numbers were me chasing the harness.
 *
 * So the standing rule that the render loop allocates nothing is **not met by
 * this function**, and the way it is met in practice is by not calling it every
 * frame: the plume's shape is a function of ambient pressure, which moves
 * slowly, so a caller steps it in bands and the steady-state frame path makes
 * no call at all. That is a property of the caller, not of this file, and it is
 * the caller's gate that has to show it.
 */

/**
 * The frame path: an integer slot and an ambient pressure in, four doubles out.
 *
 * No object argument, no map lookup, no call to the atmosphere — every input is
 * a number and every constant is read out of a flat `Float64Array`. That is the
 * shape `decay.js`'s `rates` has for the same reason, and the caller holds the
 * slot and reads the pressure once a frame rather than once an engine.
 */
export function plumeAt(out, i, pa) {
  const t = _table
  const pe = t[i + PE]
  /*
   * Divided rather than written. In vacuum `pa` is zero and this is Infinity,
   * which is the right answer and the cheap way to say it: the **literal**
   * `Infinity` is a property of the global object, not a constant, so V8 loads
   * it tagged and boxes the store — measured at 96.8 bytes a call against 0.06
   * for exactly the same value arrived at by dividing. That is the whole
   * difference between this line and `out[2] = Infinity`.
   */
  const ratio = pe / pa
  out[2] = ratio

  if (!(pa > 0)) {
    // Vacuum: the jet turns as far as it can and nothing brings it back.
    const tm = t[i + TURN_MAX]
    out[0] = tm > DRAWN_HALF_ANGLE_CAP ? DRAWN_HALF_ANGLE_CAP : tm
    out[1] = 0
  } else if (ratio >= 1) {
    /*
     * Under-expanded: the flow turns outward through the difference between the
     * Mach it leaves at and the Mach it would reach expanding to ambient.
     *
     * Written out rather than called. `machFromPressure` returns Infinity down
     * one path and 0 down another, so V8 cannot keep its return in a register
     * and boxes it — 16 bytes a call, measured, and 32 in this branch once the
     * Prandtl-Meyer call beside it did the same. Both stay exported because the
     * gate reads them and a gate is not a frame; this path holds the arithmetic.
     */
    const kv = t[i + KV]
    /*
     * No guards on any of these, and the branch condition is why. Here `pa` is
     * below the exit pressure, which is far below the chamber's, so the ratio
     * raised to the exponent exceeds one, `M2sq` is positive, the Mach it gives
     * is above the exit Mach which is already supersonic, and the turn between
     * them is therefore positive. Every `x > 0 ? x : 0` that used to sit on
     * those lines was unreachable — and not free, because one arm is a small
     * integer and the other a double, which V8 cannot keep untagged. Sixteen
     * bytes a call for four comparisons that could never fail.
     */
    const M2sq = t[i + K] * (Math.pow(pa / t[i + P0], t[i + EXP]) - 1)
    const m = Math.sqrt(M2sq)
    const root = Math.sqrt(m * m - 1)
    const nu2 = kv * Math.atan(root / kv) - Math.atan(root)
    const turn = nu2 - t[i + NU_E]
    out[0] = turn > DRAWN_HALF_ANGLE_CAP ? DRAWN_HALF_ANGLE_CAP : turn
    out[1] = 0
  } else {
    /*
     * Over-expanded: no outward turn at all — the jet is squeezed inward and
     * recovers through shocks. The strength of the diamonds goes with how far
     * from matched it is, and they are gone by the time it is matched, which is
     * the one thing this has to get right and is what the gate checks.
     */
    /*
     * No clamp, because this branch's own condition is the clamp: `ratio` is
     * `pe / pa` with both pressures positive and is less than one here, so
     * `1 - ratio` is already inside (0, 1).
     *
     * It used to be clamped anyway, and the clamp was not free. Whether written
     * as `Math.min(1, s)` or as `s > 1 ? 1 : s`, one arm is a small integer and
     * the other a double, so V8 cannot keep the result untagged and boxes it —
     * **96.8 bytes a call**, measured on this branch in a process that saw no
     * other, for a comparison that could never be true.
     */
    out[0] = 0
    out[1] = 1 - ratio
  }

  /*
   * Length. An over-expanded jet is short and bright; an under-expanded one
   * thins out as it opens, and its visible length falls with the same angle
   * that opens it, because the same gas is being spread over a wider cone.
   */
  out[3] = 1 / (1 + out[0] * 2)
  return out
}

/** Altitude at which a nozzle is matched to ambient, m — its design altitude. */
export function matchedAltitude(nozzle, g = GAMMA_EXHAUST) {
  const pe = exitPressure(nozzle, g)
  let lo = 0
  let hi = 200e3
  if (pressure(0) <= pe) return 0
  for (let i = 0; i < 60; i++) {
    const mid = 0.5 * (lo + hi)
    if (pressure(mid) > pe) lo = mid
    else hi = mid
  }
  return 0.5 * (lo + hi)
}

/** Ambient pressure, re-exported so a caller needs one import. */
export { pressure, GAMMA_AIR }
