import { Matrix4, Quaternion, Vector3 } from 'three'
import { BODIES, G, G0, SHIP } from './constants.js'
import { INDEX } from './system.js'
import { live } from './live.js'
import { ship } from './ship.js'
import { siteDirection } from './launchsite.js'
import { lambert, orbitOf, propagate, vec } from './twoBody.js'
import { MOON_SPIN_RATE, moonAxes, moonClock } from './moonFrame.js'

/**
 * The lunar sequence: Eagle from Tranquility Base to Columbia's docking port.
 *
 * Apollo 11's own flight, in the order it was flown and to its own numbers.
 * A minute's count on the descent stage; ten seconds straight up; a guided
 * ascent to the insertion state P12 flew to; then the coelliptic rendezvous —
 * CSI at the first apolune, CDH half an orbit later to put Eagle's orbit
 * parallel to Columbia's and 15 nautical miles below it, TPI when Columbia
 * stood 26.6° above Eagle's horizon, two midcourse corrections, braking, and
 * docking. Eagle's took 3 h 41 min.
 *
 * Two kinds of code live here. The *guidance* — the ascent steering, the burns,
 * the closing phase — runs every frame and allocates nothing, like every other
 * frame path. The *planning* — where to put Columbia, how big CSI is, TPI's
 * Lambert solution — runs a few times a flight, on two-body predictions
 * (sim/twoBody.js), and the burns it plans are then flown in the full field and
 * re-planned from where the craft really is.
 *
 * Numbers from the Apollo 11 Flight Journal: liftoff 124:22:01, insertion
 * 124:29:17 into 9.5 x 47.3 nmi; CSI 125:19:35, 51.5 ft/s; CDH 126:17:50; TPI
 * 127:03:52; midcourse corrections of about a foot per second; braking from
 * 127:36:57; docked 128:03:00. Columbia: 56.6 x 62.5 nmi.
 */

const DEG = Math.PI / 180
const FT = 0.3048
const NMI = 1852

export const MU_MOON = G * BODIES.moon.mass
export const R_MOON = BODIES.moon.radius

/** Apollo 11's lunar ascent and rendezvous, as flown. Times from liftoff, s. */
export const APOLLO11 = Object.freeze({
  insertionAt: 7 * 60 + 16,
  csiDv: 51.5 * FT,
  /** TPI, 127:03:52, from liftoff at 124:22:01. */
  tpiAt: 2 * 3600 + 41 * 60 + 51,
  dockedAt: 3 * 3600 + 41 * 60,
  /** Columbia's elevation above Eagle's horizon at TPI — Apollo's standard. */
  tpiElevation: 26.6 * DEG,
  /** Orbital travel from TPI to intercept. */
  transferAngle: 130 * DEG,
  /** The midcourse corrections, after TPI: 127:18:31 and 127:33:31, fifteen and thirty minutes on. */
  mccAfterTpi: [15 * 60, 30 * 60],
  /** How far below Columbia the coelliptic orbit ran. */
  coellipticHeight: 15 * NMI,
  columbia: { perilune: 56.6 * NMI, apolune: 62.5 * NMI },
  insertionOrbit: { perilune: 9.5 * NMI, apolune: 47.3 * NMI },
})

/**
 * How far apart the two craft's states are when the probe meets the drogue —
 * measured off the drawings, so contact is when they touch on screen:
 *
 *   Eagle's docking ring tops out at 2.030 file units, 0.986 above the ascent
 *   stage's centre, at 1.4626 m a unit: 1.442 m. The stage is drawn 0.083 m
 *   up its axis from its state (see Craft.jsx). 1.525 m in all.
 *   Columbia's probe tip is at x = +1.014 in the Apollo–Soyuz file, whose CSM
 *   half is centred at -4.905: 5.918 m ahead of its state.
 *
 * gfx/models.js has the parts these come from.
 */
export const DOCKING_REACH = 1.442 + 0.083 + 5.918

/**
 * The closing phase's braking gates, Apollo's: range, m, against the closing
 * rate to be down to by then, m/s. 6,000 ft at 30 ft/s, 3,000 at 20, 1,500 at
 * 10, 500 at 5 — then held at a few metres a second into station-keeping at
 * 30 m, and docked at a tenth of a metre a second.
 */
const GATES = [
  [6000 * FT, 30 * FT],
  [3000 * FT, 20 * FT],
  [1500 * FT, 10 * FT],
  [500 * FT, 5 * FT],
  [150, 1.2],
  [60, 0.5],
  [30, 0.15],
]
export const STATION_KEEP = 30
export const DOCKING_SPEED = 0.1

/* ---------------------------------------------------------------- *
 * State
 * ---------------------------------------------------------------- */

/** The plan, and what happened, for the HUD, the commentary and the gates. */
/*
 * What the frame path writes every frame — range, closing rate, Columbia's
 * elevation, the RCS spent — kept in a typed array and read through the
 * getters below. A number written into a plain object's field is stored in
 * place only while V8 keeps that field's representation as a double; the
 * object here also holds nulls, records and strings, and measured after a
 * full flight, a store into it cost a boxed number a frame. A slot cannot.
 */
export const K_RANGE = 0
export const K_CLOSING = 1
export const K_ELEVATION = 2
const K_RCS = 3
const K_CSM_RCS = 4
/**
 * The slots. Frame paths read them directly: a getter is a call, and a double
 * coming back out of a call V8 has not inlined is boxed like one going in.
 */
export const lunarLive = new Float64Array(5)

export const lunar = {
  /** Unit normal of the plane the rendezvous is flown in: Columbia's. */
  plane: new Vector3(),
  liftoffTime: 0,
  /** Times of the planned events, sim seconds. */
  csiTime: 0,
  cdhTime: 0,
  tpiTime: 0,
  interceptTime: 0,
  mcc: [0, 0],
  mccDone: 0,
  /** The burn being flown: inertial Δv still to deliver, m/s. */
  burn: new Vector3(),
  burning: false,
  /** Telemetry. */
  insertion: null,
  csi: null,
  cdh: null,
  tpi: null,
  mccDv: [],
  brakingStart: 0,
  docked: false,
  dockedTime: 0,
  dockingSpeed: 0,
  /** Δv Eagle's RCS has delivered, m/s. */
  get rcsUsed() {
    return lunarLive[K_RCS]
  },
  /** Δv Columbia spent docking, m/s. */
  get columbiaRcs() {
    return lunarLive[K_CSM_RCS]
  },
  /** When station-keeping began, sim s. */
  stationKeeping: 0,
  /** Rate the two are closing, m/s; range between their states, m; Columbia's elevation over Eagle's horizon, rad. */
  get closing() {
    return lunarLive[K_CLOSING]
  },
  get range() {
    return lunarLive[K_RANGE]
  },
  get elevation() {
    return lunarLive[K_ELEVATION]
  },
  ascentCutoff: false,
  /** How Columbia was placed: 'solved' for Apollo's TPI time, or 'overhead'. */
  placement: '',
}

export function resetLunar() {
  lunar.plane.set(0, 0, 0)
  lunar.liftoffTime = 0
  lunar.csiTime = lunar.cdhTime = lunar.tpiTime = lunar.interceptTime = 0
  lunar.mcc[0] = lunar.mcc[1] = 0
  lunar.mccDone = 0
  lunar.burn.set(0, 0, 0)
  lunar.burning = false
  lunar.insertion = lunar.csi = lunar.cdh = lunar.tpi = null
  lunar.mccDv = []
  lunar.brakingStart = 0
  lunar.docked = false
  lunar.dockedTime = 0
  lunar.dockingSpeed = 0
  lunarLive.fill(0)
  lunar.stationKeeping = 0
  lunar.ascentCutoff = false
}

/* ---------------------------------------------------------------- *
 * Reading the state
 * ---------------------------------------------------------------- */

const SHIP_AT = () => INDEX.ship * 6
const MOON_AT = () => INDEX.moon * 6
const TARGET_AT = () => INDEX.target * 6

/** Selenocentric position and velocity of a slot, as arrays: for planning. */
export function selenocentric(slot) {
  const s = live.sim.state
  const m = MOON_AT()
  const o = slot * 6
  return {
    r: [s[o] - s[m], s[o + 1] - s[m + 1], s[o + 2] - s[m + 2]],
    v: [s[o + 3] - s[m + 3], s[o + 4] - s[m + 4], s[o + 5] - s[m + 5]],
  }
}

/** Write a selenocentric state into a slot. */
function writeSelenocentric(slot, r, v) {
  const s = live.sim.state
  const m = MOON_AT()
  const o = slot * 6
  for (let k = 0; k < 3; k++) {
    s[o + k] = s[m + k] + r[k]
    s[o + 3 + k] = s[m + 3 + k] + v[k]
  }
}

/* ---------------------------------------------------------------- *
 * Columbia
 * ---------------------------------------------------------------- */

/**
 * Columbia's orbit for a liftoff at `liftoff` (sim seconds): Apollo 11's, 56.6 x
 * 62.5 nmi, in the plane that carries it over the site at liftoff, moving west
 * — Apollo's lunar orbits were retrograde, entered from a free return — and a
 * `lead` (rad) ahead of the site along it.
 */
function columbiaState(site, liftoff, lead) {
  const up = new Vector3()
  siteDirection(up, site, liftoff)
  const u = [up.x, up.y, up.z]
  // West at the site: the Moon's pole crossed with up gives east.
  const pole = moonPole(liftoff)
  const east = vec.cross(pole, u)
  const en = vec.norm(east)
  const west = [-east[0] / en, -east[1] / en, -east[2] / en]
  const n = vec.cross(u, west) // plane normal: r x v for westward motion
  const nn = vec.norm(n)
  const normal = [n[0] / nn, n[1] / nn, n[2] / nn]
  const rp = R_MOON + APOLLO11.columbia.perilune
  const ra = R_MOON + APOLLO11.columbia.apolune
  const a = (rp + ra) / 2
  const e = (ra - rp) / (ra + rp)
  // Periapsis a quarter-turn ahead of the site: any choice is Apollo's within
  // the 11 km between its apsides; this one puts liftoff near the mean radius.
  const periDir = rotateInPlane(u, west, Math.PI / 2)
  const nu = lead - Math.PI / 2
  const p = a * (1 - e * e)
  const r = p / (1 + e * Math.cos(nu))
  const dir = rotateInPlane(periDir, vec.cross(normal, periDir), nu)
  const tdir = vec.cross(normal, dir)
  const vr = Math.sqrt(MU_MOON / p) * e * Math.sin(nu)
  const vt = Math.sqrt(MU_MOON / p) * (1 + e * Math.cos(nu))
  return {
    r: dir.map((c) => c * r),
    v: dir.map((c, k) => c * vr + tdir[k] * vt),
    normal,
  }
}

function rotateInPlane(a, b, angle) {
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  return [a[0] * c + b[0] * s, a[1] * c + b[1] * s, a[2] * c + b[2] * s]
}

const _poleAxes = new Float64Array(9)
function moonPole(t) {
  moonClock[0] = t
  moonAxes(_poleAxes)
  return [_poleAxes[6], _poleAxes[7], _poleAxes[8]]
}

/**
 * Where `f` crosses zero in [lo, hi]: scanned in steps of `step` for a sign
 * change between two finite values, then bisected until |f| < `tol`. NaN if
 * there is none.
 *
 * Both of the rendezvous's unknowns behave like this. TPI's time rises steadily
 * with Columbia's lead, and with the size of CSI, but only across a window:
 * outside it Eagle passes under Columbia before TPI's elevation comes, or never
 * catches it at all, and there is no TPI to time. A bisection over the whole
 * range has to land in the window before it can close on anything — the first
 * CSI targeting bisected −10…60 m/s, never did, and flew a retrograde CSI that
 * put perilune 25 km under the surface.
 */
function findCrossing(f, lo, hi, step, tol) {
  let a = lo
  let fa = f(a)
  for (let b = lo + step; b <= hi + 1e-9; b += step) {
    const fb = f(b)
    if (Number.isFinite(fa) && Number.isFinite(fb) && fa * fb <= 0) {
      let x = b
      for (let k = 0; k < 60; k++) {
        x = 0.5 * (a + b)
        const fx = f(x)
        if (!Number.isFinite(fx)) return NaN
        if (Math.abs(fx) < tol) return x
        if (fa * fx <= 0) b = x
        else {
          a = x
          fa = fx
        }
      }
      return x
    }
    a = b
    fa = fb
  }
  return NaN
}

/**
 * Where to put Columbia, so the rendezvous can be flown as Eagle flew it.
 *
 * The geometry is not free: Eagle lifted off with Columbia a particular
 * distance ahead, and everything after — the size of CSI, when TPI fell — follows
 * from it. That distance is not in the Flight Journal. What is, is the result:
 * a 51.5 ft/s CSI that put TPI 2 h 41 m 51 s after liftoff. So the lead angle is
 * *solved* for that — the ascent flown in a point-mass field to an insertion
 * state, then the CSI and CDH that follow, and TPI's time read off — and
 * Columbia is placed there. The CSI actually flown is re-targeted in flight
 * from the orbit Eagle actually reached.
 */
export function placeColumbia(site, liftoff) {
  const ins = predictInsertion(site, liftoff)
  const tpiFor = (lead) => {
    const c0 = columbiaState(site, liftoff, lead)
    const c = propagate(c0.r, c0.v, ins.t - liftoff, MU_MOON)
    const plan = planCoelliptic(ins.r, ins.v, c.r, c.v, ins.t, APOLLO11.csiDv)
    return plan ? plan.tpiTime - liftoff : NaN
  }
  // TPI comes later the further ahead Columbia is, across a window.
  const found = findCrossing((lead) => tpiFor(lead) - APOLLO11.tpiAt, -30 * DEG, 60 * DEG, 1 * DEG, 0.05)
  // Without a solution — a vessel or a field this was never tuned for — put
  // Columbia overhead, where it can at least be seen and chased.
  const lead = Number.isFinite(found) ? found : 0
  lunar.placement = Number.isFinite(found) ? 'solved' : 'overhead'
  const c = columbiaState(site, liftoff, lead)
  // Placed at liftoff; the count is a minute before, so step it back.
  const back = propagate(c.r, c.v, live.sim.t - liftoff, MU_MOON)
  writeSelenocentric(INDEX.target, back.r, back.v)
  lunar.plane.set(c.normal[0], c.normal[1], c.normal[2])
  return { lead, insertion: ins }
}

/* ---------------------------------------------------------------- *
 * The ascent
 * ---------------------------------------------------------------- */

const ASC = () => SHIP.lunarAscent

/**
 * The ascent flown in a point-mass field, for planning: from the site at
 * `liftoff`, straight up for the vertical rise, then the same guidance law the
 * frame path flies, to cutoff. Returns the insertion state and time.
 */
export function predictInsertion(site, liftoff) {
  const up = new Vector3()
  siteDirection(up, site, liftoff)
  const r0 = R_MOON + ASC().standHeight
  let r = [up.x * r0, up.y * r0, up.z * r0]
  // The site's own motion: the Moon's spin, eastward.
  const pole = moonPole(liftoff)
  let v = vec.cross(pole, r).map((c) => c * MOON_SPIN_RATE)
  const stage = SHIP.stages[0]
  let m = stage.dryMass + stage.propellant
  const mdot = stage.thrust / (stage.isp * G0)
  const east = vec.cross(pole, [up.x, up.y, up.z])
  const en = vec.norm(east)
  const west = east.map((c) => -c / en)
  const normal = vec.cross([up.x, up.y, up.z], west)
  const nn = vec.norm(normal)
  const n = normal.map((c) => c / nn)
  const dt = 0.1
  let t = 0
  const out = new Float64Array(3)
  for (let k = 0; k < 20000; k++) {
    const rn = vec.norm(r)
    const g = -MU_MOON / (rn * rn * rn)
    let ax = g * r[0]
    let ay = g * r[1]
    let az = g * r[2]
    const aT = stage.thrust / m
    if (t < ASC().verticalRise) {
      out[0] = r[0] / rn
      out[1] = r[1] / rn
      out[2] = r[2] / rn
    } else {
      const done = ascentDirection(out, Float64Array.of(...r, ...v, ...n, m, aT))
      if (done) return { r, v, t: liftoff + t, mass: m }
    }
    ax += out[0] * aT
    ay += out[1] * aT
    az += out[2] * aT
    v = [v[0] + ax * dt, v[1] + ay * dt, v[2] + az * dt]
    r = [r[0] + v[0] * dt, r[1] + v[1] * dt, r[2] + v[2] * dt]
    m -= mdot * dt
    t += dt
  }
  return { r, v, t: liftoff + t, mass: m }
}

/**
 * The ascent's steering law: where to point the engine, given the state.
 * Writes a unit thrust direction into `out`; returns true once the insertion
 * state is reached and the engine should cut off.
 *
 * Explicit guidance to a target state at burnout, the family Apollo's P12
 * belongs to. The horizontal velocity to be gained sets the time to go, from
 * the rocket equation. The radial channel is then asked for the acceleration
 * that is *linear in time* and meets both the target radius and the target
 * climb rate at burnout —
 *
 *   A = 6 (r_f - r - v_r t) / t² - 2 (v_rf - v_r) / t
 *
 * — and the engine supplies that plus gravity less the centrifugal term, the
 * rest of its thrust going downrange. It runs every frame of the ascent, so
 * the state comes in an array — position, velocity, the plane's normal, mass
 * and thrust acceleration, eleven numbers — rather than as eleven arguments,
 * each of which V8 would box on the way in.
 */
export function ascentDirection(out, input) {
  const rx = input[0]
  const ry = input[1]
  const rz = input[2]
  const vx = input[3]
  const vy = input[4]
  const vz = input[5]
  const nx = input[6]
  const ny = input[7]
  const nz = input[8]
  const mass = input[9]
  const aT = input[10]
  const ins = ASC().insertion
  const r = Math.sqrt(rx * rx + ry * ry + rz * rz)
  const ux = rx / r
  const uy = ry / r
  const uz = rz / r
  // Downrange, in the plane: normal x up.
  let hx = ny * uz - nz * uy
  let hy = nz * ux - nx * uz
  let hz = nx * uy - ny * ux
  const hn = Math.sqrt(hx * hx + hy * hy + hz * hz)
  hx /= hn
  hy /= hn
  hz /= hn
  const vr = vx * ux + vy * uy + vz * uz
  const vh = vx * hx + vy * hy + vz * hz
  const rf = R_MOON + ins.altitude
  const dvh = ins.horizontal - vh
  ascentToGo[0] = dvh
  ascentToGo[1] = aT
  if (dvh <= 0) return true
  const ve = SHIP.stages[0].isp * G0
  const dvr = ins.radial - vr
  const dvgo = Math.sqrt(dvh * dvh + dvr * dvr)
  const tgo = (mass / ((mass * aT) / ve)) * (1 - Math.exp(-dvgo / ve))
  const g = MU_MOON / (r * r)
  let A
  if (tgo > 4) {
    A = (6 * (rf - r - vr * tgo)) / (tgo * tgo) - (2 * dvr) / tgo
  } else {
    // The last seconds: hold the climb rate rather than chase a radius the
    // law can no longer correct without a hard pitch.
    A = dvr / Math.max(tgo, 0.5)
  }
  let ar = A + g - (vh * vh) / r
  const lim = 0.9 * aT
  if (ar > lim) ar = lim
  if (ar < -lim) ar = -lim
  const ah = Math.sqrt(aT * aT - ar * ar)
  out[0] = (ar * ux + ah * hx) / aT
  out[1] = (ar * uy + ah * hy) / aT
  out[2] = (ar * uz + ah * hz) / aT
  return false
}

/**
 * The ascent's horizontal speed still to gain, m/s, and the thrust acceleration
 * gaining it, m/s²: written by the steering law each step, read by the step
 * ceiling. A slot rather than a return value, for the boxing reason.
 */
export const ascentToGo = new Float64Array(2)

/**
 * The longest step the lunar sequence can take right now, s, into slot 0 —
 * Infinity where it has no opinion. The rest of the sequencer's ceilings are in
 * `updateStepCeiling`; these are the lunar phases', for the same reasons:
 *
 * - **Ascent cutoff.** The engine stops when the horizontal speed it is flying
 *   to is reached, and at the powered cap a step is a second: 6 m/s² would
 *   carry it 6 m/s past, and near this orbit a metre a second is 4.4 km of
 *   apolune. So the step is held to half the time the remaining speed takes,
 *   and never below the time to gain 0.02 m/s — 90 m of apolune.
 * - **CSI and CDH.** Burns at an apsis the plan put a time on: never step past it.
 * - **TPI.** Timed by an angle climbing about a hundredth of a degree a second:
 *   within three degrees of it, two-second steps, so it is caught within 0.02°.
 * - **Braking to the latch.** The closing law's gain is a quarter per second,
 *   and a step much over a second would make it ring; a second at most.
 */
export const lunarCeiling = new Float64Array(1)
const ASCENT_CUTOFF_TOLERANCE = 0.02
export function lunarStepCeiling(phase) {
  // The clock read here rather than passed: a double crossing a call is boxed.
  const now = live.sim.t
  let c = Infinity
  if (phase === 'LUNAR_ASCENT') {
    /*
     * From the state as it stands now, not from the steering's last reading:
     * the ceiling is set before the sequencer steers, so that reading is a step
     * old, and a step old is exactly the step that overshoots — measured at
     * 60x, a second's step landed 0.007 m/s short and the next, sized from the
     * stale figure, went 2.9 m/s past.
     */
    const s = live.sim.state
    const o = SHIP_AT()
    const m = MOON_AT()
    const rx = s[o] - s[m]
    const ry = s[o + 1] - s[m + 1]
    const rz = s[o + 2] - s[m + 2]
    const r = Math.sqrt(rx * rx + ry * ry + rz * rz)
    const n = lunar.plane
    // Downrange, in the plane, as the steering law takes it: normal × up.
    let hx = (n.y * rz - n.z * ry) / r
    let hy = (n.z * rx - n.x * rz) / r
    let hz = (n.x * ry - n.y * rx) / r
    const hn = Math.sqrt(hx * hx + hy * hy + hz * hz)
    hx /= hn
    hy /= hn
    hz /= hn
    const vh = (s[o + 3] - s[m + 3]) * hx + (s[o + 4] - s[m + 4]) * hy + (s[o + 5] - s[m + 5]) * hz
    const togo = ASC().insertion.horizontal - vh
    const a = ship.mass > 0 ? SHIP.stages[0].thrust / ship.mass : 0
    if (a > 0 && togo > 0) {
      const half = (0.5 * togo) / a
      const floor = ASCENT_CUTOFF_TOLERANCE / a
      c = half > floor ? half : floor
    }
  } else if (phase === 'LM_COAST_CSI' || phase === 'LM_COAST_CDH') {
    const at = phase === 'LM_COAST_CSI' ? lunar.csiTime : lunar.cdhTime
    if (at - now > 1e-3) c = at - now
  } else if (phase === 'LM_COAST_TPI') {
    if (APOLLO11.tpiElevation - lunarLive[K_ELEVATION] < 3 * DEG) c = 2
  } else if (phase === 'LM_TRANSFER') {
    // The midcourse corrections are at set times, like CSI.
    const next = lunar.mccDone < 2 ? lunar.mcc[lunar.mccDone] : Infinity
    if (next - now > 1e-3) c = next - now
  } else if (phase === 'LM_BRAKING' || phase === 'LM_STATION_KEEP' || phase === 'LM_DOCKING') {
    c = 1
  }
  lunarCeiling[0] = c
}

/*
 * Frame-path scratch, and the slots the steering helpers take their numbers
 * in: a double handed to a function V8 does not inline is boxed at the call,
 * sixteen bytes an argument — measured, six of them made holding Eagle on the
 * pad cost 96 bytes a frame.
 */
const _dir = new Float64Array(3)
const _ascent = new Float64Array(11)
const _aim = new Float64Array(6)
const _front = new Float64Array(3)
const _basis = new Matrix4()

/**
 * A rotation's columns written straight into a matrix's elements — what
 * `Matrix4.makeBasis` does, less the call it makes to `set` with sixteen
 * arguments. That call is too big to inline, so each of its nine doubles is
 * boxed on the way in: measured, 144 bytes every time Eagle was pointed. Only
 * the rotation part is written; the matrices here hold nothing else.
 */
export function writeBasis(m, x, y, z) {
  const e = m.elements
  e[0] = x.x
  e[1] = x.y
  e[2] = x.z
  e[4] = y.x
  e[5] = y.y
  e[6] = y.z
  e[8] = z.x
  e[9] = z.y
  e[10] = z.z
  return m
}

/**
 * Point the thrust axis (+Z) along a direction, rolled so body +x lies along
 * the roll reference projected off it: direction in `_aim[0..2]`, reference in
 * `_aim[3..5]`. Allocation-free; writes the autopilot's target.
 */
function aimAlong() {
  /*
   * Scalars throughout, and the basis written as array stores: three's vector
   * helpers take doubles as arguments, and whether V8 inlines one depends on
   * which caller it is compiled into — measured, the same aim cost nothing from
   * the ascent and 48 bytes from the pad.
   */
  let zx = _aim[0]
  let zy = _aim[1]
  let zz = _aim[2]
  const zn = Math.sqrt(zx * zx + zy * zy + zz * zz)
  zx /= zn
  zy /= zn
  zz /= zn
  const d = _aim[3] * zx + _aim[4] * zy + _aim[5] * zz
  let xx = _aim[3] - d * zx
  let xy = _aim[4] - d * zy
  let xz = _aim[5] - d * zz
  let xn = xx * xx + xy * xy + xz * xz
  if (xn < 1e-12) {
    xx = zy
    xy = -zx
    xz = 0
    xn = xx * xx + xy * xy
  }
  if (xn < 1e-12) {
    xx = 1
    xy = 0
    xz = 0
    xn = 1
  }
  xn = Math.sqrt(xn)
  xx /= xn
  xy /= xn
  xz /= xn
  const e = _basis.elements
  e[0] = xx
  e[1] = xy
  e[2] = xz
  // y = z × x
  e[4] = zy * xz - zz * xy
  e[5] = zz * xx - zx * xz
  e[6] = zx * xy - zy * xx
  e[8] = zx
  e[9] = zy
  e[10] = zz
  ship.targetQuaternion.setFromRotationMatrix(_basis)
}

/*
 * Eagle's axes, in the sim's terms. Body +Z is the thrust axis, as for every
 * vessel — the LM's own +X, up through the ascent engine and out of the docking
 * tunnel. Body +y is the *front*: the LM's +Z, the face with the two triangular
 * windows and the rendezvous radar. Body +x is then y × z, the LM's left.
 *
 * So "front downrange" is +x along minus the orbit normal: with the plane's
 * normal n = up × west, y = z × (−n) = west when z is up. Eagle faced west on
 * the surface — it had flown in westward, sun behind it — and pitched over
 * toward the west on the way up, the crew watching the ground ahead.
 */

/**
 * Point the front (+y) along the direction in `_front`, the thrust axis as near
 * the local vertical as that allows: the attitude Eagle tracked Columbia in,
 * its radar and windows on it. Allocation-free.
 */
function aimFront() {
  const s = live.sim.state
  const o = SHIP_AT()
  const m = MOON_AT()
  const fn = Math.sqrt(_front[0] * _front[0] + _front[1] * _front[1] + _front[2] * _front[2])
  const fx = _front[0] / fn
  const fy = _front[1] / fn
  const fz = _front[2] / fn
  // Up, less its part along the front.
  let ux = s[o] - s[m]
  let uy = s[o + 1] - s[m + 1]
  let uz = s[o + 2] - s[m + 2]
  const k = ux * fx + uy * fy + uz * fz
  ux -= k * fx
  uy -= k * fy
  uz -= k * fz
  if (ux * ux + uy * uy + uz * uz < 1e-6) {
    ux = lunar.plane.x
    uy = lunar.plane.y
    uz = lunar.plane.z
  }
  // x = front × z makes y = z × x the front.
  _aim[0] = ux
  _aim[1] = uy
  _aim[2] = uz
  _aim[3] = fy * uz - fz * uy
  _aim[4] = fz * ux - fx * uz
  _aim[5] = fx * uy - fy * ux
  aimAlong()
}

/** Aim +Z along local up, front downrange: the pad and the vertical rise. */
function aimUp() {
  const s = live.sim.state
  const o = SHIP_AT()
  const m = MOON_AT()
  _aim[0] = s[o] - s[m]
  _aim[1] = s[o + 1] - s[m + 1]
  _aim[2] = s[o + 2] - s[m + 2]
  _aim[3] = -lunar.plane.x
  _aim[4] = -lunar.plane.y
  _aim[5] = -lunar.plane.z
  aimAlong()
}

/** Stand the LM up on its descent stage: engine axis along local vertical, facing west. */
export function holdOnSurface() {
  aimUp()
  ship.quaternion.copy(ship.targetQuaternion)
}

/** The vertical rise: straight up, full thrust, facing downrange. */
export function steerVertical() {
  aimUp()
}

/** The guided ascent. Returns true at cutoff. */
export function steerAscent() {
  const s = live.sim.state
  const o = SHIP_AT()
  const m = MOON_AT()
  for (let k = 0; k < 6; k++) _ascent[k] = s[o + k] - s[m + k]
  _ascent[6] = lunar.plane.x
  _ascent[7] = lunar.plane.y
  _ascent[8] = lunar.plane.z
  _ascent[9] = ship.mass
  _ascent[10] = ship.mass > 0 ? SHIP.stages[0].thrust / ship.mass : 0
  const done = ascentDirection(_dir, _ascent)
  if (!done) {
    _aim[0] = _dir[0]
    _aim[1] = _dir[1]
    _aim[2] = _dir[2]
    _aim[3] = -lunar.plane.x
    _aim[4] = -lunar.plane.y
    _aim[5] = -lunar.plane.z
    aimAlong()
  }
  return done
}

/* ---------------------------------------------------------------- *
 * The coelliptic sequence
 * ---------------------------------------------------------------- */

/** Time from (r, v) to the next apsis on a point-mass orbit, s. */
function toNextApsis(r, v) {
  const o = orbitOf(r, v, MU_MOON)
  // Search forward for the radial velocity changing sign.
  const period = o.period
  const vrAt = (t) => {
    const p = propagate(r, v, t, MU_MOON)
    return vec.dot(p.r, p.v)
  }
  let t0 = 1
  let f0 = vrAt(t0)
  const step = period / 64
  for (let t = step; t < period; t += step) {
    const f = vrAt(t)
    if (f0 * f <= 0) {
      let a = t - step
      let b = t
      let fa = vrAt(a)
      for (let k = 0; k < 60; k++) {
        const c = 0.5 * (a + b)
        const fc = vrAt(c)
        if (fc * fa <= 0) b = c
        else {
          a = c
          fa = fc
        }
      }
      return 0.5 * (a + b)
    }
    t0 = t
    f0 = f
  }
  return period / 2
}

/**
 * The velocity that makes Eagle's orbit *coelliptic* with Columbia's at this
 * point: the same line of apsides, a semi-major axis smaller by the height
 * between them here, and the eccentricity that keeps that height constant all
 * the way round — a·e the same for both. That is CDH's definition.
 */
export function coellipticVelocity(rL, rC, vC) {
  const c = orbitOf(rC, vC, MU_MOON)
  const hHat = c.h.map((x) => x / c.hn)
  const rn = vec.norm(rL)
  const u = rL.map((x) => x / rn)
  // Columbia's radius at Eagle's polar angle.
  const peri = c.e > 1e-9 ? c.ev.map((x) => x / c.e) : u
  const cosNu = vec.dot(u, peri)
  const sinNu = vec.dot(vec.cross(peri, u), hHat)
  const pC = c.a * (1 - c.e * c.e)
  const rCat = pC / (1 + c.e * cosNu)
  const dh = rCat - rn
  const aL = c.a - dh
  const eL = (c.e * c.a) / aL
  const pL = aL * (1 - eL * eL)
  const vr = Math.sqrt(MU_MOON / pL) * eL * sinNu
  const vt = Math.sqrt(MU_MOON / pL) * (1 + eL * cosNu)
  const t = vec.cross(hHat, u)
  return { v: u.map((x, k) => x * vr + t[k] * vt), dh }
}

/** Columbia's elevation above Eagle's local horizontal, rad. */
export function elevationOf(rL, rC) {
  const d = [rC[0] - rL[0], rC[1] - rL[1], rC[2] - rL[2]]
  const rn = vec.norm(rL)
  return Math.asin(vec.dot(d, rL) / (vec.norm(d) * rn))
}

/**
 * The rest of the sequence from Eagle at (rL, vL) and Columbia at (rC, vC) at
 * time `t`, for a CSI of `dvCsi` at the next apsis: CSI there, CDH at the apsis
 * after, and the time TPI's elevation is reached. Null if it never is within a
 * few orbits.
 */
export function planCoelliptic(rL, vL, rC, vC, t, dvCsi) {
  const toCsi = toNextApsis(rL, vL)
  const L1 = propagate(rL, vL, toCsi, MU_MOON)
  const C1 = propagate(rC, vC, toCsi, MU_MOON)
  const csiTime = t + toCsi
  // Horizontal, prograde, in Eagle's own plane.
  const h = vec.cross(L1.r, L1.v)
  const along = vec.cross(h, L1.r)
  const an = vec.norm(along)
  const vAfter = L1.v.map((x, k) => x + (dvCsi * along[k]) / an)
  const toCdh = toNextApsis(L1.r, vAfter)
  const L2 = propagate(L1.r, vAfter, toCdh, MU_MOON)
  const C2 = propagate(C1.r, C1.v, toCdh, MU_MOON)
  const cdhTime = csiTime + toCdh
  const co = coellipticVelocity(L2.r, C2.r, C2.v)
  const dvCdh = co.v.map((x, k) => x - L2.v[k])
  // March forward to TPI's elevation.
  let L = { r: L2.r, v: co.v }
  let C = C2
  let prev = elevationOf(L.r, C.r)
  const stepT = 20
  for (let s = stepT; s < 4 * 7200; s += stepT) {
    const Ln = propagate(L.r, L.v, stepT, MU_MOON)
    const Cn = propagate(C.r, C.v, stepT, MU_MOON)
    const el = elevationOf(Ln.r, Cn.r)
    // Rising through the elevation with Columbia ahead of Eagle.
    const ahead = vec.dot(vec.cross(Ln.r, Cn.r), vec.cross(Ln.r, Ln.v)) > 0
    if (ahead && prev < APOLLO11.tpiElevation && el >= APOLLO11.tpiElevation) {
      const f = (APOLLO11.tpiElevation - prev) / (el - prev)
      return { csiTime, cdhTime, tpiTime: cdhTime + s - stepT + f * stepT, dvCdh, dh: co.dh }
    }
    prev = el
    L = Ln
    C = Cn
  }
  return null
}

/**
 * CSI, targeted: the horizontal Δv at the coming apsis that puts TPI at Apollo
 * 11's time after liftoff. TPI moves later as CSI grows — a higher orbit gains
 * on Columbia more slowly — so it is a monotone one-dimensional search.
 */
export function targetCsi() {
  const L = selenocentric(INDEX.ship)
  const C = selenocentric(INDEX.target)
  const want = lunar.liftoffTime + APOLLO11.tpiAt
  const tpiFor = (dv) => {
    const p = planCoelliptic(L.r, L.v, C.r, C.v, live.sim.t, dv)
    return p ? p.tpiTime - want : NaN
  }
  // Half a metre a second of scan: the window is about ten wide.
  const found = findCrossing(tpiFor, -10, 60, 0.5, 0.5)
  // No TPI at Apollo's time from here: fly Apollo's own CSI and take the TPI
  // it gives, which the elevation test times whenever it comes.
  const dv = Number.isFinite(found) ? found : APOLLO11.csiDv
  const plan = planCoelliptic(L.r, L.v, C.r, C.v, live.sim.t, dv)
  lunar.csiTime = plan ? plan.csiTime : live.sim.t + toNextApsis(L.r, L.v)
  lunar.cdhTime = plan ? plan.cdhTime : 0
  lunar.tpiTime = plan ? plan.tpiTime : 0
  lunar.csi = { dv, targeted: Number.isFinite(found) }
  return dv
}

/** Load the CSI burn at its time: horizontal, prograde. */
export function beginCsi() {
  const L = selenocentric(INDEX.ship)
  const h = vec.cross(L.r, L.v)
  const along = vec.cross(h, L.r)
  const an = vec.norm(along)
  const dv = lunar.csi.dv
  lunar.burn.set((dv * along[0]) / an, (dv * along[1]) / an, (dv * along[2]) / an)
  lunar.burning = true
  lunar.csi.time = live.sim.t
}

/** Load CDH at its time, from where both craft really are. */
export function beginCdh() {
  const L = selenocentric(INDEX.ship)
  const C = selenocentric(INDEX.target)
  const co = coellipticVelocity(L.r, C.r, C.v)
  const dv = co.v.map((x, k) => x - L.v[k])
  lunar.burn.set(dv[0], dv[1], dv[2])
  lunar.burning = true
  lunar.cdh = { dv: vec.norm(dv), dh: co.dh, time: live.sim.t }
}

/** Load TPI now: Lambert to where Columbia will be after the transfer. */
export function beginTpi() {
  const L = selenocentric(INDEX.ship)
  const C = selenocentric(INDEX.target)
  const co = orbitOf(C.r, C.v, MU_MOON)
  const tof = (APOLLO11.transferAngle / (2 * Math.PI)) * co.period
  const arrive = propagate(C.r, C.v, tof, MU_MOON)
  const sol = lambert(L.r, arrive.r, tof, MU_MOON, vec.cross(L.r, L.v))
  lunar.interceptTime = live.sim.t + tof
  lunar.mcc[0] = live.sim.t + APOLLO11.mccAfterTpi[0]
  lunar.mcc[1] = live.sim.t + APOLLO11.mccAfterTpi[1]
  lunar.mccDone = 0
  if (!sol) return
  const dv = sol.v1.map((x, k) => x - L.v[k])
  lunar.burn.set(dv[0], dv[1], dv[2])
  lunar.burning = true
  lunar.tpi = { dv: vec.norm(dv), time: live.sim.t, tof }
}

/** A midcourse correction: Lambert again, to the same intercept time. */
export function beginMcc() {
  const L = selenocentric(INDEX.ship)
  const C = selenocentric(INDEX.target)
  const tof = lunar.interceptTime - live.sim.t
  if (!(tof > 60)) return
  const arrive = propagate(C.r, C.v, tof, MU_MOON)
  const sol = lambert(L.r, arrive.r, tof, MU_MOON, vec.cross(L.r, L.v))
  if (!sol) return
  const dv = sol.v1.map((x, k) => x - L.v[k])
  lunar.burn.set(dv[0], dv[1], dv[2])
  lunar.burning = true
  lunar.mccDv.push(vec.norm(dv))
}

/* ---------------------------------------------------------------- *
 * Flying a burn, and the closing phase — the frame path
 * ---------------------------------------------------------------- */

/** The RCS's translational force, N: its acceleration is this over the mass, worked where it is used. */
const RCS_THRUST = SHIP.rcs ? SHIP.rcs.thrust : 0

/**
 * Deliver the loaded burn on the RCS: accelerate along what is left of it, and
 * never more than what is left, so the Δv comes out exact whatever the step.
 * Returns true when it has all been delivered. Allocation-free.
 */
export function flyBurn(simDt) {
  const left = lunar.burn.length()
  if (!(left > 1e-4) || !(simDt > 0)) {
    ship.rcs.set(0, 0, 0)
    lunar.burning = false
    return left <= 1e-4
  }
  const most = RCS_THRUST / (ship.mass > 1 ? ship.mass : 1)
  const a = most < left / simDt ? most : left / simDt
  const k = a / left
  ship.rcs.set(lunar.burn.x * k, lunar.burn.y * k, lunar.burn.z * k)
  lunar.burn.addScaledVector(ship.rcs, -simDt)
  lunarLive[K_RCS] += a * simDt
  return false
}

/** Relative geometry, refreshed each frame of the closing phases. */
const rel = {
  los: new Vector3(),
  vrel: new Vector3(),
}

function readRelative() {
  const s = live.sim.state
  const o = SHIP_AT()
  const t = TARGET_AT()
  rel.los.set(s[t] - s[o], s[t + 1] - s[o + 1], s[t + 2] - s[o + 2])
  const range = rel.los.length()
  lunarLive[K_RANGE] = range
  if (range > 0) rel.los.multiplyScalar(1 / range)
  // Columbia's velocity relative to Eagle.
  rel.vrel.set(s[t + 3] - s[o + 3], s[t + 4] - s[o + 4], s[t + 5] - s[o + 5])
  lunarLive[K_CLOSING] = -(rel.vrel.x * rel.los.x + rel.vrel.y * rel.los.y + rel.vrel.z * rel.los.z)
}

/**
 * The closing rate the gates allow at the range in `_gate[0]`, m/s, into
 * `_gate[1]`: linear between gates. Slots, and no destructuring — unpacking a
 * gate pair runs the iterator protocol, which allocates.
 */
const _gate = new Float64Array(2)
function gateSpeed() {
  const range = _gate[0]
  const n = GATES.length
  if (range >= GATES[0][0]) {
    _gate[1] = GATES[0][1]
    return
  }
  for (let i = 1; i < n; i++) {
    const g1 = GATES[i]
    if (range >= g1[0]) {
      const g0 = GATES[i - 1]
      _gate[1] = g1[1] + ((g0[1] - g1[1]) * (range - g1[0])) / (g0[0] - g1[0])
      return
    }
  }
  _gate[1] = GATES[n - 1][1]
}

/** Gain on the relative-velocity error, 1/s: a four-second time constant. */
const CLOSING_GAIN = 0.25
/**
 * Dead band, m/s: jets fire in pulses, and a hundredth of a metre a second is
 * below anything worth firing for.
 */
const DEAD_BAND = 0.01

/**
 * The acceleration, into `_cmd`, that takes the error between the relative
 * velocity and the one wanted — `want` along the line of sight, closing, and
 * nothing across it — out at CLOSING_GAIN, within `limit`. Zero inside the
 * dead band. Nulling the across-line part is nulling the line-of-sight rate,
 * the thing that makes an approach miss. The command is for Eagle; Columbia
 * flying it is the same with the sign turned. Reads `rel`; allocation-free.
 */
const _cmd = new Float64Array(3)
/** The closing law's inputs: the speed wanted along the line of sight, and the acceleration limit. */
const _closing = new Float64Array(2)
function closingCommand() {
  const want = _closing[0]
  const limit = _closing[1]
  // Wanted: Columbia's velocity relative to Eagle = −want · los.
  const ex = -want * rel.los.x - rel.vrel.x
  const ey = -want * rel.los.y - rel.vrel.y
  const ez = -want * rel.los.z - rel.vrel.z
  if (Math.sqrt(ex * ex + ey * ey + ez * ez) < DEAD_BAND) {
    _cmd[0] = _cmd[1] = _cmd[2] = 0
    return
  }
  let ax = -CLOSING_GAIN * ex
  let ay = -CLOSING_GAIN * ey
  let az = -CLOSING_GAIN * ez
  const an = Math.sqrt(ax * ax + ay * ay + az * az)
  if (an > limit) {
    ax *= limit / an
    ay *= limit / an
    az *= limit / an
  }
  _cmd[0] = ax
  _cmd[1] = ay
  _cmd[2] = az
}

/**
 * Braking, and then station-keeping: Eagle through the gates on its own jets,
 * its front on Columbia, down to STATION_KEEP metres and held there with
 * nothing closing. Allocation-free; the gap is `lunarLive[K_RANGE]` less
 * DOCKING_REACH.
 */
export function flyClosing(simDt) {
  readRelative()
  const range = lunarLive[K_RANGE] - DOCKING_REACH
  _gate[0] = range
  gateSpeed()
  _closing[0] = range > STATION_KEEP ? _gate[1] : 0
  _closing[1] = RCS_THRUST / (ship.mass > 1 ? ship.mass : 1)
  closingCommand()
  ship.rcs.set(_cmd[0], _cmd[1], _cmd[2])
  lunarLive[K_RCS] += ship.rcs.length() * simDt
  _front[0] = rel.los.x
  _front[1] = rel.los.y
  _front[2] = rel.los.z
  aimFront()
}

/**
 * The last thirty metres, which Columbia flew: on Apollo 11 it was Collins who
 * docked, the LM holding attitude with its tunnel turned up to him. Columbia's
 * jets are applied as a change in its velocity each step — it is a test
 * particle, with no thrust of its own in the integrator — at the rate its RCS
 * can give, four 100 lbf jets on the command and service module's 16.5 t.
 * Allocation-free.
 */
const CSM_RCS_ACCEL = (4 * 445) / 16_500
export function flyDocking(simDt) {
  readRelative()
  ship.rcs.set(0, 0, 0)
  _closing[0] = DOCKING_SPEED
  _closing[1] = CSM_RCS_ACCEL
  closingCommand()
  // Columbia accelerates by minus what Eagle would have.
  const s = live.sim.state
  const t = TARGET_AT()
  s[t + 3] -= _cmd[0] * simDt
  s[t + 4] -= _cmd[1] * simDt
  s[t + 5] -= _cmd[2] * simDt
  lunarLive[K_CSM_RCS] += Math.sqrt(_cmd[0] * _cmd[0] + _cmd[1] * _cmd[1] + _cmd[2] * _cmd[2]) * simDt
  aimTunnel()
}

/** Eagle's tunnel (+Z) on Columbia, its front turned up, away from the Moon. */
function aimTunnel() {
  const s = live.sim.state
  const o = SHIP_AT()
  const m = MOON_AT()
  const lx = rel.los.x
  const ly = rel.los.y
  const lz = rel.los.z
  // x = up × los makes y = z × x the part of up across the line of sight.
  const ux = s[o] - s[m]
  const uy = s[o + 1] - s[m + 1]
  const uz = s[o + 2] - s[m + 2]
  _aim[0] = lx
  _aim[1] = ly
  _aim[2] = lz
  _aim[3] = uy * lz - uz * ly
  _aim[4] = uz * lx - ux * lz
  _aim[5] = ux * ly - uy * lx
  aimAlong()
}

/**
 * Columbia's attitude, into a quaternion: body +Z — the probe — at Eagle once
 * Eagle has lifted off, which is what Collins flew for the sextant and the
 * docking; along its own velocity before, like any craft coasting. Rolled so
 * body +y is as near the Moon's local vertical as that allows. Allocation-free.
 */
const _cz = new Vector3()
const _cx = new Vector3()
const _cy = new Vector3()
const _cBasis = new Matrix4()
/** Columbia's attitude from the latch on: the stack holds it as one body. */
const _stack = new Quaternion()
export function columbiaAttitude(q) {
  if (lunar.docked) {
    q.copy(_stack)
    return
  }
  const s = live.sim.state
  const t = TARGET_AT()
  const m = MOON_AT()
  if (lunar.liftoffTime > 0) {
    const o = SHIP_AT()
    _cz.set(s[o] - s[t], s[o + 1] - s[t + 1], s[o + 2] - s[t + 2])
  } else _cz.set(s[t + 3] - s[m + 3], s[t + 4] - s[m + 4], s[t + 5] - s[m + 5])
  if (!(_cz.lengthSq() > 0)) return
  _cz.normalize()
  _cy.set(s[t] - s[m], s[t + 1] - s[m + 1], s[t + 2] - s[m + 2])
  _cx.crossVectors(_cy, _cz)
  if (_cx.lengthSq() < 1e-12) _cx.set(_cz.y, -_cz.x, 0)
  _cx.normalize()
  _cy.crossVectors(_cz, _cx)
  q.setFromRotationMatrix(writeBasis(_cBasis, _cx, _cy, _cz))
}

/** Eagle's front — radar and windows — on Columbia, without translating. */
export function faceTarget() {
  readRelative()
  _front[0] = rel.los.x
  _front[1] = rel.los.y
  _front[2] = rel.los.z
  aimFront()
}

/** Refresh the elevation and range readouts. Allocation-free. */
export function readTarget() {
  readRelative()
  const s = live.sim.state
  const o = SHIP_AT()
  const m = MOON_AT()
  const rx = s[o] - s[m]
  const ry = s[o + 1] - s[m + 1]
  const rz = s[o + 2] - s[m + 2]
  const rn = Math.sqrt(rx * rx + ry * ry + rz * rz)
  lunarLive[K_ELEVATION] = Math.asin((rel.los.x * rx + rel.los.y * ry + rel.los.z * rz) / rn)
}

/**
 * Once docked, the two fly as one: Eagle's state is Columbia's plus the
 * docking offset along the line between them, every step, the way the pad
 * clamp holds a vehicle to the ground.
 */
const dockedOffset = new Vector3()
export function latch() {
  readRelative()
  // Columbia's attitude at contact, held from here: Eagle holds its own the
  // same way, so the two stay one rigid stack rather than one rolling on the other.
  columbiaAttitude(_stack)
  dockedOffset.copy(rel.los).multiplyScalar(-DOCKING_REACH)
  lunar.docked = true
  lunar.dockedTime = live.sim.t
  lunar.dockingSpeed = lunarLive[K_CLOSING]
}
export function applyDocked() {
  const s = live.sim.state
  const o = SHIP_AT()
  const t = TARGET_AT()
  s[o] = s[t] + dockedOffset.x
  s[o + 1] = s[t + 1] + dockedOffset.y
  s[o + 2] = s[t + 2] + dockedOffset.z
  s[o + 3] = s[t + 3]
  s[o + 4] = s[t + 4]
  s[o + 5] = s[t + 5]
}
