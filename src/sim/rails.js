/**
 * The rest of the solar system, on rails.
 *
 * Sol, Terra and Luna are integrated: they attract each other, their solution is
 * pair-symmetric and its energy drift is measured. The other seven planets are
 * not, and deliberately. Adding them to tier one would change every figure that
 * has ever been measured about the integrated three — the step ceilings, the
 * drift, the flown missions — in exchange for an effect on those three that is
 * smaller than the difference between one ephemeris and another. So they are
 * carried analytically, from Keplerian elements with secular rates, and they
 * pull on the craft without perturbing the bodies whose solution is verified.
 *
 * The elements are the standard low-precision set for 1800-2050 (the table
 * reproduced in the Explanatory Supplement and by JPL's Solar System Dynamics
 * group): `a` in AU, angles in degrees, and a rate per Julian century beside
 * each. Quoted accuracy over that window is a few arcminutes of heliocentric
 * longitude for the inner planets and rather better than a planetary radius in
 * distance — far inside anything this simulator can show or a craft can feel.
 *
 * What this is *not* is a general-purpose ephemeris. It has no perturbations in
 * it, so outside 1800-2050 it drifts, and Jupiter and Saturn's great inequality
 * is absent entirely. The date is on the HUD; the limits are stated here.
 */
import { AU, G } from './constants.js'

const DEG = Math.PI / 180
/** Julian century, seconds. The rates are per century. */
const CENTURY = 36525 * 86400

/**
 * Elements at J2000.0 and their rates per Julian century:
 *   a  semi-major axis, AU        e  eccentricity
 *   i  inclination, deg           L  mean longitude, deg
 *   peri  longitude of perihelion, deg
 *   node  longitude of ascending node, deg
 *
 * Mass and radius are the body's own, in kg and m.
 */
export const RAILS = [
  {
    id: 'mercury',
    name: 'Mercury',
    mass: 3.3011e23,
    radius: 2.4397e6,
    colour: '#9c8e86',
    a: [0.38709927, 0.00000037],
    e: [0.20563593, 0.00001906],
    i: [7.00497902, -0.00594749],
    L: [252.2503235, 149472.67411175],
    peri: [77.45779628, 0.16047689],
    node: [48.33076593, -0.12534081],
  },
  {
    id: 'venus',
    name: 'Venus',
    mass: 4.8675e24,
    radius: 6.0518e6,
    colour: '#d8c9a3',
    a: [0.72333566, 0.0000039],
    e: [0.00677672, -0.00004107],
    i: [3.39467605, -0.0007889],
    L: [181.9790995, 58517.81538729],
    peri: [131.60246718, 0.00268329],
    node: [76.67984255, -0.27769418],
  },
  {
    id: 'mars',
    name: 'Mars',
    mass: 6.4171e23,
    radius: 3.3895e6,
    colour: '#c1603f',
    a: [1.52371034, 0.00001847],
    e: [0.0933941, 0.00007882],
    i: [1.84969142, -0.00813131],
    L: [-4.55343205, 19140.30268499],
    peri: [-23.94362959, 0.44441088],
    node: [49.55953891, -0.29257343],
  },
  {
    id: 'jupiter',
    name: 'Jupiter',
    mass: 1.8982e27,
    radius: 6.9911e7,
    colour: '#cbab86',
    a: [5.202887, -0.00011607],
    e: [0.04838624, -0.00013253],
    i: [1.30439695, -0.00183714],
    L: [34.39644051, 3034.74612775],
    peri: [14.72847983, 0.21252668],
    node: [100.47390909, 0.20469106],
  },
  {
    id: 'saturn',
    name: 'Saturn',
    mass: 5.6834e26,
    radius: 5.8232e7,
    colour: '#d8c08a',
    ring: [1.11, 2.27],
    a: [9.53667594, -0.0012506],
    e: [0.05386179, -0.00050991],
    i: [2.48599187, 0.00193609],
    L: [49.95424423, 1222.49362201],
    peri: [92.59887831, -0.41897216],
    node: [113.66242448, -0.28867794],
  },
  {
    id: 'uranus',
    name: 'Uranus',
    mass: 8.681e25,
    radius: 2.5362e7,
    colour: '#a7d8de',
    ring: [1.64, 2.0],
    a: [19.18916464, -0.00196176],
    e: [0.04725744, -0.00004397],
    i: [0.77263783, -0.00242939],
    L: [313.23810451, 428.48202785],
    peri: [170.9542763, 0.40805281],
    node: [74.01692503, 0.04240589],
  },
  {
    id: 'neptune',
    name: 'Neptune',
    mass: 1.02413e26,
    radius: 2.4622e7,
    colour: '#5b7fd4',
    a: [30.06992276, 0.00026291],
    e: [0.00859048, 0.00005105],
    i: [1.77004347, 0.00035372],
    L: [-55.12002969, 218.45945325],
    peri: [44.96476227, -0.32241464],
    node: [131.78422574, -0.00508664],
  },
]

export const RAIL_COUNT = RAILS.length
export const RAIL_IDS = RAILS.map((r) => r.id)
export const RAIL_BY_ID = Object.fromEntries(RAILS.map((r) => [r.id, r]))
/** Which slot of the position buffer each planet occupies. */
export const RAIL_INDEX = Object.fromEntries(RAILS.map((r, i) => [r.id, i]))

/** GM per body, in the order the position buffer uses. Built once. */
export const RAIL_MU = Float64Array.from(RAILS.map((r) => G * r.mass))
export const RAIL_RADIUS = Float64Array.from(RAILS.map((r) => r.radius))

/**
 * Heliocentric positions in the scene frame, xyz per body, metres.
 *
 * A module-scope buffer written in place, because this is evaluated inside the
 * integrator's step and the render loop allocates nothing. Heliocentric rather
 * than barycentric: the elements are referred to the Sun, and the Sun's own
 * position is in the state vector, so the caller adds the two.
 */
export const railHelio = new Float64Array(RAIL_COUNT * 3)

/**
 * The same elements again, flat.
 *
 * Twelve doubles a planet — value and rate for each of the six — in one typed
 * array, because the table above is an array of objects and reading a double
 * out of one of those, in a function the optimiser has not bothered with, hands
 * back a boxed number. This is not hypothetical: with the objects read
 * directly, a projection carrying a node allocated 16,210 B against its 1,024 B
 * budget, all of it here. Every read below is a Float64Array index, and the
 * Newton solve is written out rather than called for the same reason.
 *
 * Units are converted once, on the way in: metres and radians, so the per-call
 * path has no multiplication by AU or DEG left in it.
 */
export const RAIL_ELEMENTS = new Float64Array(RAIL_COUNT * 12)
const EL = RAIL_ELEMENTS
RAILS.forEach((p, k) => {
  const o = k * 12
  EL[o] = p.a[0] * AU
  EL[o + 1] = p.a[1] * AU
  EL[o + 2] = p.e[0]
  EL[o + 3] = p.e[1]
  EL[o + 4] = p.i[0] * DEG
  EL[o + 5] = p.i[1] * DEG
  EL[o + 6] = p.L[0] * DEG
  EL[o + 7] = p.L[1] * DEG
  EL[o + 8] = p.peri[0] * DEG
  EL[o + 9] = p.peri[1] * DEG
  EL[o + 10] = p.node[0] * DEG
  EL[o + 11] = p.node[1] * DEG
})

const TWO_PI = Math.PI * 2

/**
 * Write every planet's heliocentric position for simulated time `t`, in seconds
 * from J2000.0.
 *
 * Ecliptic coordinates come out as (x, y, z) with z toward the north ecliptic
 * pole, and are folded into the scene's y-up frame the same way system.js folds
 * the integrated bodies — (x, z, -y) — so the two agree about which way the
 * solar system turns.
 *
 * `into` is the buffer to write, `railHelio` by default. A solver that spans
 * months has to move the planets itself while it works, and doing that through
 * the shared buffer would leave the live simulation reading a sky a season
 * ahead of its own clock — see `ownRails`.
 */
export function updateRails(t, into = railHelio) {
  const T = t / CENTURY
  for (let k = 0; k < RAIL_COUNT; k++) {
    const o = k * 12
    const a = EL[o] + EL[o + 1] * T
    const e = EL[o + 2] + EL[o + 3] * T
    const i = EL[o + 4] + EL[o + 5] * T
    const L = EL[o + 6] + EL[o + 7] * T
    const peri = EL[o + 8] + EL[o + 9] * T
    const node = EL[o + 10] + EL[o + 11] * T

    // Argument of perihelion and mean anomaly follow from the two longitudes.
    const w = peri - node

    // Mean anomaly, wrapped to [-pi, pi] where Newton starts well.
    let M = (L - peri + Math.PI) % TWO_PI
    if (M < 0) M += TWO_PI
    M -= Math.PI

    // Solve M = E - e sin E. Written out: a call taking two doubles, made as
    // rarely as this one is, returns them boxed.
    let E = e < 0.8 ? M : Math.PI
    for (let it = 0; it < 32; it++) {
      const d = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E))
      E -= d
      if (Math.abs(d) < 1e-13) break
    }

    // Perifocal position, then the standard three rotations into the ecliptic.
    const cosE = Math.cos(E)
    const sinE = Math.sin(E)
    const px = a * (cosE - e)
    const py = a * Math.sqrt(1 - e * e) * sinE

    const cO = Math.cos(node)
    const sO = Math.sin(node)
    const ci = Math.cos(i)
    const si = Math.sin(i)
    const cw = Math.cos(w)
    const sw = Math.sin(w)

    const ex = (cO * cw - sO * sw * ci) * px - (cO * sw + sO * cw * ci) * py
    const ey = (sO * cw + cO * sw * ci) * px - (sO * sw - cO * cw * ci) * py
    const ez = sw * si * px + cw * si * py

    const oh = k * 3
    into[oh] = ex
    into[oh + 1] = ez
    into[oh + 2] = -ey
  }
}

/**
 * A rails table with a position buffer of its own.
 *
 * The live simulation and every projection drawn from it share one buffer,
 * which is right: a projection borrows the sky the live run last solved and
 * holds it, so the drawn path and the flown path answer to the same planetary
 * positions. It is wrong for the solving scratch integrators — the halo shooter
 * in `halo.js` propagates seventeen revolutions, roughly a hundred days, and
 * the capture solver in `capture.js` spans most of a translunar coast. A
 * hundred days of stale planets is not a held sky, it is a wrong one, and
 * re-solving into the shared buffer instead would move the *live* simulation's
 * sky to the far end of the solve.
 *
 * So a scratch gets its own table and its own buffer, and refreshes it as it
 * goes. `from` seeds the buffer and carries the Sun's slot; the caller supplies
 * it whenever a table already exists.
 */
export function ownRails(from = null) {
  const helio = new Float64Array(RAIL_COUNT * 3)
  if (from) helio.set(from.helio)
  return {
    count: RAIL_COUNT,
    mu: RAIL_MU,
    helio,
    sunOffset: from ? from.sunOffset : 0,
    refreshAfter: RAIL_REFRESH,
    refresh: (t) => updateRails(t, helio),
  }
}

/**
 * A rails table's cloneable content: exactly what `ownRails` reads, and nothing
 * else.
 *
 * A rails table cannot cross a `postMessage`. `refresh` is a closure and
 * structured clone refuses functions outright, so a message carrying one fails
 * outright rather than arriving degraded — which is what happened to the halo
 * capture, whose worker is handed a solved reference containing the table it was
 * shot against.
 *
 * So the *content* travels and the closure is rebuilt on the far side. It is the
 * right split on its own terms, not a workaround: `ownRails` takes only `helio`
 * and `sunOffset` from its seed, so those two fields are the whole of what a
 * table means as data, and the closure that refreshes them is an implementation
 * detail of whoever is holding the clock.
 */
export function railsRecipe(table) {
  if (!table) return null
  return { helio: Float64Array.from(table.helio), sunOffset: table.sunOffset }
}

/**
 * How stale a planet's position may be before it is worth solving Kepler again.
 *
 * Evaluating seven planets inside every RK4 step costs more than the rest of
 * the integration put together — measured at roughly four times the whole gate
 * suite's runtime — and buys nothing. In an hour Jupiter covers 1e-5 of its own
 * orbital radius, which changes its pull on a craft at Earth by about 6e-12
 * m/s^2 against the 9.8 the craft is already feeling. So the table is re-solved
 * on its own clock rather than the integrator's, and between solves the planets
 * are held still — the same zero-order hold thrust uses, over an interval
 * chosen from what the freeze actually costs.
 *
 * The integrator owns the clock that enforces it — see `railClock` in rk4.js.
 * Held here it would have been a module-level double read through a call on
 * every step, which is the shape that boxes.
 */
export const RAIL_REFRESH = 3600

/** Orbital period, seconds, from the semi-major axis and the Sun's mass. */
export function railPeriod(id, sunMass) {
  const p = RAIL_BY_ID[id]
  const a = p.a[0] * AU
  return 2 * Math.PI * Math.sqrt((a * a * a) / (G * sunMass))
}
