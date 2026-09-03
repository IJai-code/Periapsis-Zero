import { useEffect, useRef, useState } from 'react'
import { live } from '../sim/live.js'
import { activeStage, deltaV, ship, totalMass } from '../sim/ship.js'
import { SHIP } from '../sim/constants.js'
import { useUi } from '../sim/store.js'
import { beginCountdown, commitTLI, currentPhase, mission } from '../sim/mission.js'

/**
 * Metres to a readable distance.
 *
 * The compact branch divides by 1e9, not 1e6: the argument is in *metres*, so a
 * million kilometres is 1e9 of them. Dividing by 1e6 gave megametres and then
 * labelled them "x10^6 km", which read every distance over 1000 km as a
 * thousand times larger than it was — a 7,603 km parking orbit as 7.60x10^6 km,
 * and a 399,260 km lunar range as 399.26x10^6 km, further than the Sun.
 */
const km = (m) =>
  Math.abs(m) >= 1e9
    ? `${(m / 1e9).toFixed(2)}×10⁶ km`
    : `${(m / 1e3).toLocaleString('en-US', { maximumFractionDigits: 1 })} km`

const clock = (s) => {
  if (!Number.isFinite(s)) return '—'
  const m = Math.floor(s / 60)
  return `${m}m ${String(Math.round(s % 60)).padStart(2, '0')}s`
}

/**
 * Flight instruments. Like the system telemetry panel, these are written
 * straight into the DOM on a timer rather than through React state — the values
 * change every frame and re-rendering the tree to print eight numbers would
 * cost more than the physics does.
 */
/** Mission clock, negative before release. */
const met = () => {
  const t = mission.t
  const sign = t < 0 ? '-' : '+'
  const a = Math.abs(Math.round(t))
  return `T${sign}${String(Math.floor(a / 60)).padStart(2, '0')}:${String(a % 60).padStart(2, '0')}`
}

const kpa = (pa) => `${(pa / 1000).toFixed(1)} kPa`

const mmss = (s) => {
  if (!Number.isFinite(s)) return '—'
  const a = Math.max(0, Math.round(s))
  return `${String(Math.floor(a / 60)).padStart(2, '0')}:${String(a % 60).padStart(2, '0')}`
}

const MISSION = [
  { key: 'phase', label: 'Phase', get: () => currentPhase().label, wide: true },
  { key: 'met', label: 'Mission time', get: met },
  { key: 'q', label: 'Dynamic pressure', get: () => kpa(live.dynamicPressure) },
  { key: 'maxq', label: 'Max-Q', get: () => kpa(live.maxQ) },
  { key: 'tapo', label: 'To apoapsis', get: () => mmss(live.elements.timeToApoapsis) },
  {
    key: 'dvcirc',
    label: 'Δv to circularise',
    get: () => {
      const dv = live.elements.circulariseDeltaV
      return Number.isFinite(dv) ? `${dv.toFixed(0)} m/s` : '—'
    },
  },
]

const FIELDS = [
  { key: 'alt', label: 'Altitude', get: () => km(live.elements.altitude), wide: true },
  { key: 'vel', label: 'Orbital velocity', get: () => `${(live.elements.speed / 1000).toFixed(3)} km/s` },
  {
    key: 'vs',
    label: 'Vertical speed',
    get: () => {
      const v = live.elements.vertical
      return `${v >= 0 ? '+' : ''}${v.toFixed(1)} m/s`
    },
  },
  { key: 'apo', label: 'Apogee', get: () => (live.elements.bound ? km(live.elements.apogee) : 'escape') },
  { key: 'per', label: 'Perigee', get: () => km(live.elements.perigee) },
  { key: 'ecc', label: 'Eccentricity', get: () => live.elements.eccentricity.toFixed(5) },
  { key: 'per2', label: 'Period', get: () => clock(live.elements.period) },
]

const PROPULSION = [
  {
    key: 'stage',
    label: 'Stage',
    get: () => {
      const st = activeStage()
      return st ? `${st.name}  ${ship.stage + 1}/${SHIP.stages.length}` : '—'
    },
  },
  { key: 'thr', label: 'Throttle', get: () => `${(ship.throttle * 100).toFixed(0)} %` },
  { key: 'acc', label: 'Acceleration', get: () => `${(ship.thrust / ship.mass).toFixed(2)} m/s²` },
  { key: 'mass', label: 'Vehicle mass', get: () => `${(totalMass() / 1000).toFixed(2)} t` },
  {
    key: 'prop',
    label: 'Stage propellant',
    get: () => {
      const st = activeStage()
      if (!st) return '—'
      const left = ship.stageProp[ship.stage]
      return `${left.toFixed(0)} kg (${((left / st.propellant) * 100).toFixed(0)}%)`
    },
  },
  { key: 'dv', label: 'Δv remaining', get: () => `${deltaV().toFixed(0)} m/s` },
]

/** Release the hold. Only meaningful before the count starts. */
function LaunchButton() {
  const [held, setHeld] = useState(true)
  useEffect(() => {
    const id = setInterval(() => setHeld(currentPhase().id === 'PRE_LAUNCH' && !mission.running), 200)
    return () => clearInterval(id)
  }, [])
  if (!held) return null
  return (
    <button
      onClick={beginCountdown}
      className="mt-1 w-full rounded-[2px] border border-hud/40 bg-hud/10 py-1.5 text-[11px] tracking-[0.22em] text-hud uppercase transition-colors hover:bg-hud/20"
    >
      Start countdown
    </button>
  )
}

const deg = (r) => `${((r * 180) / Math.PI).toFixed(1)}°`

const hhmm = (s) => {
  if (!Number.isFinite(s) || s > 40 * 86400) return '—'
  if (s > 86400) return `${(s / 86400).toFixed(2)} d`
  const a = Math.max(0, Math.round(s))
  return `${String(Math.floor(a / 3600)).padStart(2, '0')}:${String(Math.floor((a % 3600) / 60)).padStart(2, '0')}`
}

const TLI = [
  { key: 'align', label: 'Apoapsis alignment', get: () => deg(mission.tli.alignment) },
  {
    // Not 'phase': the mission table already claims that key, and the rows are
    // addressed by a data attribute — a collision silently makes one getter
    // overwrite the other's cell.
    key: 'tliPhase',
    label: 'Phase angle',
    get: () => `${deg(mission.tli.phase)} → ${deg(mission.tli.targetPhase)}`,
  },
  { key: 'window', label: 'TLI window', get: () => hhmm(mission.tli.timeToWindow) },
  { key: 'tof', label: 'Transfer time', get: () => hhmm(mission.tli.timeOfFlight) },
  { key: 'tlidv', label: 'TLI Δv', get: () => `${mission.tli.deltaV.toFixed(0)} m/s` },
]

const MOON_RADIUS = 1737e3

const MCC = [
  {
    key: 'mccdv',
    label: 'MCC Δv',
    get: () => (mission.mcc.solved ? `${mission.mcc.magnitude.toFixed(2)} m/s` : '—'),
  },
  {
    key: 'mccLvlh',
    label: 'pro / nrm / rad',
    get: () => {
      const l = mission.mcc.lvlh
      if (!mission.mcc.solved) return '—'
      return `${l.prograde.toFixed(0)} / ${l.normal.toFixed(0)} / ${l.radial.toFixed(0)}`
    },
  },
  {
    key: 'mccPred',
    // Distinct from the Lunar section's row of the same quantity: this is what
    // the solver's projection promised, that is what the state vector currently
    // says. They differ by the projector's error, which is the whole reason the
    // insertion cutoff reads the second one and never the first.
    label: 'Predicted periapsis',
    get: () =>
      mission.mcc.solved
        ? `${((mission.mcc.predicted - MOON_RADIUS) / 1000).toFixed(1)} km alt`
        : '—',
  },
]

const LUNAR = [
  {
    key: 'luRange',
    label: 'Lunar range',
    get: () => (live.insideLunarSOI ? km(live.lunarRange) : `${km(live.lunarRange)} (outside SOI)`),
    wide: true,
  },
  {
    key: 'luAlt',
    label: 'Lunar altitude',
    get: () => km(live.lunar.altitude),
  },
  {
    // Only meaningful inside the sphere of influence: outside it Earth is the
    // dominant attractor and the selenocentric conic describes no trajectory
    // the craft is on. Reported as a dash rather than as a number that looks
    // like one.
    key: 'luPeri',
    label: 'Lunar periapsis',
    get: () => (live.insideLunarSOI ? `${((live.lunar.periapsisRadius - MOON_RADIUS) / 1e3).toFixed(1)} km` : '—'),
  },
  {
    key: 'luApo',
    label: 'Lunar apoapsis',
    get: () =>
      live.insideLunarSOI
        ? live.lunar.bound
          ? `${((live.lunar.apoapsisRadius - MOON_RADIUS) / 1e3).toFixed(1)} km`
          : 'hyperbolic'
        : '—',
  },
  {
    key: 'luEcc',
    label: 'Lunar eccentricity',
    get: () => (live.insideLunarSOI ? live.lunar.eccentricity.toFixed(5) : '—'),
  },
  {
    key: 'luPeriod',
    label: 'Lunar period',
    get: () => (live.insideLunarSOI && live.lunar.bound ? clock(live.lunar.period) : '—'),
  },
  {
    key: 'loiTp',
    label: 'To lunar periapsis',
    get: () =>
      live.insideLunarSOI && live.lunar.timeToPeriapsis > 0
        ? hhmm(live.lunar.timeToPeriapsis)
        : '—',
  },
  {
    key: 'loiDv',
    label: 'LOI Δv / burn',
    get: () =>
      mission.loi.burnEstimate > 0
        ? `${mission.loi.deltaVEstimate.toFixed(0)} m/s / ${mission.loi.burnEstimate.toFixed(0)} s`
        : '—',
  },
  {
    key: 'loiPoint',
    label: 'Retrograde error',
    get: () => `${(mission.loi.pointingError * 1000).toFixed(1)} mrad`,
  },
  {
    key: 'loiResult',
    label: 'LOI delivered',
    get: () =>
      mission.loi.ignited
        ? `${mission.loi.deltaVDelivered.toFixed(1)} m/s${mission.loi.cutoff ? ` · ${mission.loi.cutoff}` : ''}`
        : '—',
    wide: true,
  },
]

const RETURN = [
  {
    key: 'teiWin',
    label: 'To TEI window',
    get: () =>
      Number.isFinite(mission.tei.timeToWindow) && mission.tei.timeToWindow > 0
        ? hhmm(mission.tei.timeToWindow)
        : '—',
  },
  {
    key: 'teiOop',
    label: 'Departure plane error',
    get: () =>
      mission.tei.vInfRequired > 0
        ? `${((mission.tei.outOfPlane * 180) / Math.PI).toFixed(2)}°`
        : '—',
  },
  {
    key: 'teiC3',
    label: 'C3 target / now',
    get: () =>
      mission.tei.c3Target !== 0
        ? `${(mission.tei.c3Target / 1e6).toFixed(4)} / ${(mission.tei.c3 / 1e6).toFixed(4)}`
        : '—',
  },
  {
    key: 'teiResult',
    label: 'TEI delivered',
    get: () =>
      mission.tei.ignited
        ? `${mission.tei.deltaVDelivered.toFixed(1)} m/s${mission.tei.cutoff ? ` · ${mission.tei.cutoff}` : ''}`
        : '—',
    wide: true,
  },
  {
    key: 'eiTrim',
    label: 'Corridor trim',
    get: () =>
      mission.ei.solved
        ? `${mission.ei.magnitude.toFixed(2)} m/s${mission.ei.converged ? '' : ' · rejected'}`
        : '—',
  },
  {
    key: 'eiPeri',
    label: 'Vacuum perigee',
    get: () =>
      live.elements.bound && live.elements.perigee < 1e7
        ? `${(live.elements.perigee / 1e3).toFixed(1)} km`
        : '—',
  },
]

const ENTRY = [
  {
    key: 'enMach',
    label: 'Mach',
    get: () => (live.mach > 0.01 ? live.mach.toFixed(2) : '—'),
  },
  {
    key: 'enG',
    label: 'Deceleration',
    get: () => (live.decelG > 0.01 ? `${live.decelG.toFixed(2)} g` : '—'),
  },
  {
    key: 'enQ',
    label: 'Dynamic pressure',
    get: () => (live.dynamicPressure > 1 ? `${(live.dynamicPressure / 1e3).toFixed(1)} kPa` : '—'),
  },
  {
    // Convective only — the Sutton-Graves correlation carries no radiative term,
    // and at 11 km/s radiation is a large share of the real total. Reported as
    // what it is rather than as "heating".
    key: 'enHeat',
    label: 'Convective flux',
    get: () => (live.heatFlux > 1e3 ? `${(live.heatFlux / 1e4).toFixed(0)} W/cm²` : '—'),
  },
  {
    key: 'enPeak',
    label: 'Peak load / flux',
    get: () =>
      mission.entry.peakG > 0
        ? `${mission.entry.peakG.toFixed(1)} g · ${(mission.entry.peakHeatFlux / 1e4).toFixed(0)} W/cm²`
        : '—',
    wide: true,
  },
  {
    key: 'enChute',
    label: 'Canopy',
    get: () =>
      ship.chuteCdA > 0.1 ? `${ship.chuteCdA.toFixed(0)} / ${ship.chuteTarget.toFixed(0)} m²` : 'stowed',
  },
  {
    key: 'enSplash',
    label: 'Splashdown',
    get: () =>
      mission.entry.splashdownVertical > 0
        ? `${mission.entry.splashdownVertical.toFixed(2)} m/s descent`
        : '—',
    wide: true,
  },
]

/** Commit to trans-lunar injection. Offered only once the orbit is stable. */
function TliButton() {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    const id = setInterval(() => setReady(currentPhase().id === 'COAST'), 200)
    return () => clearInterval(id)
  }, [])
  if (!ready) return null
  return (
    <button
      onClick={commitTLI}
      className="mt-1.5 w-full rounded-[2px] border border-amber-400/40 bg-amber-400/10 py-1.5 text-[11px] tracking-[0.22em] text-amber-200 uppercase transition-colors hover:bg-amber-400/20"
    >
      Commit TLI
    </button>
  )
}

/**
 * Every row is addressed by its `data-ship` attribute, so two rows sharing a key
 * makes `querySelector` return the same node twice: one getter overwrites the
 * other's cell and the loser sits frozen at whatever it last printed. It is
 * silent, and it looks exactly like a stale value.
 *
 * This has caught it once already — the trans-lunar block wanted `phase`, which
 * the mission block had claimed. So the check runs rather than being described:
 * a comment cannot fail.
 */
function assertUniqueKeys(groups) {
  const seen = new Set()
  const clashes = []
  for (const g of groups) {
    for (const f of g) {
      if (seen.has(f.key)) clashes.push(f.key)
      seen.add(f.key)
    }
  }
  if (clashes.length) {
    throw new Error(`ShipTelemetry: duplicate row key(s): ${clashes.join(', ')}`)
  }
  return seen.size
}

assertUniqueKeys([MISSION, FIELDS, TLI, MCC, LUNAR, RETURN, ENTRY, PROPULSION])

function Row({ label, id, wide }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="shrink-0 text-[10px] text-white/35">{label}</span>
      <span
        data-ship={id}
        className={`tabular-nums text-right ${wide ? 'text-[13px] text-hud' : 'text-[11px] text-white/85'}`}
      >
        —
      </span>
    </div>
  )
}

export function ShipTelemetry() {
  const root = useRef(null)
  const assist = useUi((s) => s.assist)

  useEffect(() => {
    const all = [...MISSION, ...FIELDS, ...TLI, ...MCC, ...LUNAR, ...RETURN, ...ENTRY, ...PROPULSION]
    const nodes = new Map()
    for (const f of all) {
      const el = root.current?.querySelector(`[data-ship="${f.key}"]`)
      if (el) nodes.set(f, el)
    }
    const bar = root.current?.querySelector('[data-ship-bar]')
    const fuel = root.current?.querySelector('[data-fuel-bar]')
    const tick = () => {
      for (const [f, el] of nodes) el.textContent = f.get()
      if (bar) bar.style.width = `${ship.throttle * 100}%`
      const st = activeStage()
      if (fuel) fuel.style.width = st ? `${(ship.stageProp[ship.stage] / st.propellant) * 100}%` : '0%'
    }
    tick()
    const id = setInterval(tick, 110)
    return () => clearInterval(id)
  }, [])

  return (
    <div ref={root} className="panel w-60 rounded-sm p-3.5">
      <div className="rule mb-2.5 flex items-center justify-between border-b border-white/10 pb-2">
        <span>Flight — {SHIP.name}</span>
        <span className={assist ? 'text-hud' : 'text-white/25'}>{assist ? 'SAS' : 'sas'}</span>
      </div>

      <div className="mb-3 space-y-1.5 border-b border-white/10 pb-3">
        {MISSION.map((f) => (
          <Row key={f.key} id={f.key} label={f.label} wide={f.wide} />
        ))}
        <LaunchButton />
      </div>

      <div className="space-y-1.5">
        {FIELDS.map((f) => (
          <Row key={f.key} id={f.key} label={f.label} wide={f.wide} />
        ))}
      </div>

      <div className="rule mt-4 mb-2.5 border-b border-white/10 pb-2">Trans-lunar</div>
      <div className="space-y-1.5">
        {TLI.map((f) => (
          <Row key={f.key} id={f.key} label={f.label} />
        ))}
        <TliButton />
      </div>

      <div className="rule mt-4 mb-2.5 border-b border-white/10 pb-2">Mid-course</div>
      <div className="space-y-1.5">
        {MCC.map((f) => (
          <Row key={f.key} id={f.key} label={f.label} />
        ))}
      </div>

      <div className="rule mt-4 mb-2.5 border-b border-white/10 pb-2">Lunar</div>
      <div className="space-y-1.5">
        {LUNAR.map((f) => (
          <Row key={f.key} id={f.key} label={f.label} wide={f.wide} />
        ))}
      </div>

      <div className="rule mt-4 mb-2.5 border-b border-white/10 pb-2">Return</div>
      <div className="space-y-1.5">
        {RETURN.map((f) => (
          <Row key={f.key} id={f.key} label={f.label} wide={f.wide} />
        ))}
      </div>

      <div className="rule mt-4 mb-2.5 border-b border-white/10 pb-2">Entry</div>
      <div className="space-y-1.5">
        {ENTRY.map((f) => (
          <Row key={f.key} id={f.key} label={f.label} wide={f.wide} />
        ))}
      </div>

      <div className="rule mt-4 mb-2.5 border-b border-white/10 pb-2">Propulsion</div>
      <div className="mb-1 h-px w-full bg-white/10">
        <div data-ship-bar className="h-full bg-hud shadow-[0_0_6px_currentColor]" style={{ width: '0%' }} />
      </div>
      <div className="mb-2 h-px w-full bg-white/10">
        <div data-fuel-bar className="h-full bg-amber-400/70" style={{ width: '100%' }} />
      </div>
      <div className="space-y-1.5">
        {PROPULSION.map((f) => (
          <Row key={f.key} id={f.key} label={f.label} />
        ))}
      </div>

      <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-0.5 border-t border-white/10 pt-2.5 text-[9px] text-white/25">
        <span>W / S</span><span className="text-white/40">throttle</span>
        <span>Z / X</span><span className="text-white/40">full / cut</span>
        <span>I / K</span><span className="text-white/40">pitch</span>
        <span>J / L</span><span className="text-white/40">yaw</span>
        <span>Q / E</span><span className="text-white/40">roll</span>
        <span>T</span><span className="text-white/40">stability hold</span>
        <span>Enter</span><span className="text-white/40">separate stage</span>
      </div>
    </div>
  )
}
