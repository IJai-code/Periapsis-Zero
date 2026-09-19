import { useEffect, useMemo, useState } from 'react'
import { live } from '../sim/live.js'
import { INDEX } from '../sim/system.js'
import { activeSite, siteDeflection, siteGravity } from '../sim/launchsite.js'
import { BODIES, G0, SHIP } from '../sim/constants.js'
import {
  INERTIA_FACTOR,
  J2,
  J3,
  J4,
  LAYERS,
  PREM_MASS,
  PREM_RADIUS,
  hydrostaticJ2,
  meanSemiMajor,
  profileSeries,
  radialGravity,
  secularRates,
} from '../sim/prem.js'
import { useUi } from '../sim/store.js'

/**
 * What the planet is made of, and what that does to the orbit.
 *
 * The interior model is the one part of this simulator with nothing to look at:
 * a layered density profile and four hundred lines of arithmetic, all of it
 * buried under a sphere that renders identically whichever coefficients are in
 * it. So this draws it — density and gravity against radius, the shell
 * boundaries marked, and the craft's own radius as a cursor on the curve. The
 * peak at 3,480 km is the core-mantle boundary, and it is why the second half of
 * the panel exists: a body whose gravity peaks *inside* it is not a point mass,
 * and an orbit round it does not close.
 *
 * The second half is the two things that follow — the node walking backwards
 * five degrees a day and the apsides rotating three and a half, computed from
 * the orbit the craft is actually on rather than tabulated, and both invisible
 * from one frame to the next. They are the reason a parking orbit planned
 * against a two-body conic arrives at the Moon's plane hours late after a
 * fortnight of waiting.
 *
 * Numbers refresh on a timer rather than per frame, the same as the other
 * panels. The cursor moves a pixel a minute, and re-rendering the tree to print
 * two rates at 60 Hz would cost more than the physics does.
 */

/** Points in the profile curve. Odd, so one lands exactly on the centre. */
const N = 97
const W = 168
const H = 66
/** Pixels of the box left below the axis the curves sit on. */
const BASE = 10
const RAD = Math.PI / 180

const perGcm3 = (kgm3) => (kgm3 / 1000).toFixed(2)

/**
 * The two curves, plus the scales they were drawn against so the cursor can be
 * placed on the same axes.
 *
 * Density and gravity differ by three orders of magnitude, so they get separate
 * vertical scales and each is labelled with its own maximum. A shared axis would
 * draw the gravity curve flat along the bottom and call it a day.
 */
function buildChart(rMax) {
  const r = new Float64Array(N)
  const rho = new Float64Array(N)
  const g = new Float64Array(N)
  profileSeries(r, rho, g, rMax)
  let rhoMax = 0
  let gMax = 0
  for (let i = 0; i < N; i++) {
    if (rho[i] > rhoMax) rhoMax = rho[i]
    if (g[i] > gMax) gMax = g[i]
  }
  const x = (metres) => (metres / rMax) * W
  const yRho = (v) => H - BASE - (v / rhoMax) * (H - BASE - 2)
  const yG = (v) => H - BASE - (v / gMax) * (H - BASE - 2)
  let rhoPath = ''
  let gPath = ''
  for (let i = 0; i < N; i++) {
    rhoPath += `${i === 0 ? 'M' : 'L'}${x(r[i]).toFixed(2)} ${yRho(rho[i]).toFixed(2)}`
    gPath += `${i === 0 ? 'M' : 'L'}${x(r[i]).toFixed(2)} ${yG(g[i]).toFixed(2)}`
  }
  return { rhoPath, gPath, rhoMax, x, yG }
}

/** Liftoff mass and thrust, for the pad's own thrust-to-weight. */
const LIFTOFF_MASS = SHIP.stages.reduce((m, s) => m + s.propellant + s.dryMass, 0)
const LIFTOFF_TW = SHIP.stages[0].thrust / (LIFTOFF_MASS * G0)
/** The chart never grows past this: a translunar craft pins to the right edge. */
const CHART_REACH = 6e7

const _craft = new Float64Array(3)

/**
 * What the panel reads, taken once so the two halves cannot disagree.
 *
 * The gravity is the *field's* radial value at the craft — the same call the
 * ascent guidance steers by — so the cursor on the chart is the acceleration the
 * integrator is applying rather than a second opinion about it. The rates come
 * off the osculating elements for the same reason: the perturbation of the orbit
 * as flown, not of the one that was planned.
 */
function snapshot() {
  const e = live.elements
  const s = live.sim.state
  const o = INDEX.ship * 6
  const c = INDEX.earth * 6
  const rx = s[o] - s[c]
  const ry = s[o + 1] - s[c + 1]
  const rz = s[o + 2] - s[c + 2]
  _craft[0] = rx
  _craft[1] = ry
  _craft[2] = rz
  /**
   * The closed forms are the first-order rates about a bound ellipse. Asked
   * about an escape trajectory they would return a rate for an orbit that does
   * not exist, so an unbound craft gets no rates and no cursor instead.
   *
   * A craft still on its pad is the case that made the second condition
   * necessary rather than merely tidy. Held to the ground it sits a few
   * kilometres off the centre, which reads as a bound orbit of a thousand
   * kilometres with its perigee inside the planet: every test above passes, and
   * the rates come back at three and a half million degrees a day, because both
   * closed forms carry (R/p)^2 and one carries the mean motion.
   */
  const bound =
    e.bound && e.semiMajor > BODIES.earth.radius && e.periapsisRadius > BODIES.earth.radius
  const r2 = rx * rx + ry * ry + rz * rz
  return {
    radius: Math.hypot(rx, ry, rz),
    gravity: Math.abs(radialGravity(rx, ry, rz)),
    altitude: e.altitude,
    inclination: e.inclination,
    bound,
    /**
     * The two semi-major axes, side by side, because the gap between them is
     * the thing this panel exists to make visible.
     *
     * The HUD reports the osculating one — that is what "OSCULATING" at the top
     * of the elements panel means, and what the two rates above are functions of.
     * The flight computer plans the loiter on the mean one, and under J2 they
     * differ by several kilometres: it is why a parking orbit committed at 178.7
     * is a mean 183.6, and why the same orbit's lifetime is 406 hours rather
     * than the 320 the osculating value predicts.
     */
    osculatingSemiMajor: e.semiMajor,
    meanSemiMajor: meanSemiMajor(
      rx,
      ry,
      rz,
      s[o + 3] - s[c + 3],
      s[o + 4] - s[c + 4],
      s[o + 5] - s[c + 5],
      r2,
    ),
    rates: bound ? secularRates(e.semiMajor, e.eccentricity, e.inclination) : { node: 0, apsis: 0 },
  }
}

export function Geophysics() {
  const open = useUi((s) => s.geophysics)
  /**
   * The radius the chart is drawn out to. Held in state and moved only when the
   * craft leaves the window by a margin: a chart that rescaled under a cursor
   * drifting out would be unreadable, and one that never rescaled would lose the
   * cursor on the way to the Moon.
   */
  const [rMax, setRMax] = useState(() => Math.max(PREM_RADIUS * 1.06, live.elements.radius * 1.04))
  const [read, setRead] = useState(snapshot)

  useEffect(() => {
    if (!open) return
    const id = setInterval(() => {
      const next = snapshot()
      setRead(next)
      if (next.radius > rMax || next.radius < rMax * 0.4) {
        setRMax(Math.min(CHART_REACH, Math.max(PREM_RADIUS * 1.06, next.radius * 1.06)))
      }
    }, 250)
    return () => clearInterval(id)
  }, [open, rMax])

  const chart = useMemo(() => buildChart(rMax), [rMax])
  if (!open) return null

  const site = activeSite()
  const g = siteGravity(site)
  const cursor = read.bound && read.radius <= rMax

  return (
    <div className="panel w-48 rounded-sm p-3.5">
      <div className="rule mb-2 border-b border-white/10 pb-2">Terra interior</div>

      {/* The gravity curve is the HUD's own colour, so `currentColor` carries it. */}
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="text-hud">
        {/* The mean radius: the surface the simulator draws and clamps to. */}
        <line
          x1={chart.x(PREM_RADIUS)}
          y1={1}
          x2={chart.x(PREM_RADIUS)}
          y2={H - BASE}
          stroke="rgba(255,255,255,0.3)"
          strokeDasharray="2 2"
        />
        {LAYERS.map((l) =>
          l.r0 > 0 ? (
            <line
              key={l.name}
              x1={chart.x(l.r0)}
              y1={H - BASE}
              x2={chart.x(l.r0)}
              y2={H - BASE + 3}
              stroke="rgba(255,255,255,0.25)"
            />
          ) : null,
        )}
        <path d={chart.rhoPath} fill="none" stroke="#f0b45a" strokeWidth="1.1" />
        <path d={chart.gPath} fill="none" stroke="currentColor" strokeWidth="1.1" />
        {cursor && (
          <>
            <line
              x1={chart.x(read.radius)}
              y1={1}
              x2={chart.x(read.radius)}
              y2={H - BASE}
              stroke="currentColor"
              strokeOpacity="0.5"
            />
            <circle cx={chart.x(read.radius)} cy={chart.yG(read.gravity)} r="1.9" fill="currentColor" />
          </>
        )}
        <line x1="0" y1={H - BASE} x2={W} y2={H - BASE} stroke="rgba(255,255,255,0.18)" />
      </svg>

      <div className="mt-1 flex justify-between font-mono text-[8px] text-white/30">
        <span>centre</span>
        <span>{(PREM_RADIUS / 1000).toFixed(0)} km</span>
        <span>{(rMax / 1000).toFixed(0)}</span>
      </div>

      <div className="mt-1.5 flex justify-between font-mono text-[9px]">
        <span className="text-amber-300/75">ρ {perGcm3(chart.rhoMax)} g/cm³</span>
        <span className="text-hud/75">
          g 10.69 at the CMB{cursor ? `, ${read.gravity.toFixed(2)} here` : ''}
        </span>
      </div>

      <div className="mt-2 space-y-1 border-t border-white/8 pt-2">
        <Row label="mass" value={`${(PREM_MASS / 1e24).toFixed(4)}×10²⁴ kg`} />
        <Row label="C/MR²" value={INERTIA_FACTOR.toFixed(4)} />
        <Row label="J₂" value={`${J2.toExponential(3)} · hydro ${(hydrostaticJ2() / J2).toFixed(4)}`} />
        <Row label="J₃ · J₄" value={`${J3.toExponential(2)} · ${J4.toExponential(2)}`} />
      </div>

      <div className="mt-2 space-y-1 border-t border-white/8 pt-2">
        <Row label={`pad · ${site.id}`} value={`${g.toFixed(3)} m/s² · T/W ${(LIFTOFF_TW * (G0 / g)).toFixed(3)}`} />
        <Row
          label="plumb line"
          value={`${Math.abs(siteDeflection(site) / RAD).toFixed(3)}° ${site.latitude >= 0 ? 'S' : 'N'}`}
        />
      </div>

      {read.bound ? (
        <div className="mt-2 space-y-1 border-t border-white/8 pt-2">
          <Row
            label="orbit"
            value={`${(read.altitude / 1000).toFixed(1)} km · ${(read.inclination / RAD).toFixed(2)}°`}
          />
          {/* Osculating first, because that is the number the HUD reports. */}
          <Row
            label="a ○ · mean"
            value={`${(read.osculatingSemiMajor / 1000).toFixed(1)} · ${(read.meanSemiMajor / 1000).toFixed(1)} km`}
          />
          <Row label="node walks" value={`${read.rates.node.toFixed(3)}°/day`} />
          <Row label="apsides walk" value={`${read.rates.apsis.toFixed(3)}°/day`} />
        </div>
      ) : (
        <div className="mt-2 border-t border-white/8 pt-2 text-[9px] leading-relaxed text-white/25">
          No orbit to perturb yet — the stack is on its pad, and the pad's own gravity is above.
        </div>
      )}
    </div>
  )
}

function Row({ label, value }) {
  return (
    <div className="flex items-baseline justify-between gap-2 font-mono text-[9px]">
      <span className="text-white/25">{label}</span>
      <span className="text-white/60">{value}</span>
    </div>
  )
}
