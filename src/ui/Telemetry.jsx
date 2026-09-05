import { useEffect, useRef } from 'react'
import { live } from '../sim/live.js'
import { AU } from '../sim/constants.js'

const km = (m) => (m / 1e3).toLocaleString('en-US', { maximumFractionDigits: 0 })
const kms = (v) => (v / 1e3).toFixed(3)

const DATE_FMT = new Intl.DateTimeFormat('en-GB', {
  year: 'numeric',
  month: 'short',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'UTC',
})

/**
 * Live readout.
 *
 * Written straight into the DOM on a timer rather than through React state:
 * these values change every frame, and re-rendering the tree at 60Hz to print
 * six numbers would cost more than the physics does.
 */
const FIELDS = [
  { key: 'date', label: 'Mission time (UTC)', get: () => DATE_FMT.format(live.date), wide: true },
  { key: 'sunEarth', label: 'Sol → Terra', get: () => `${km(live.metric.sunEarth)} km` },
  { key: 'au', label: 'in AU', get: () => (live.metric.sunEarth / AU).toFixed(6) },
  { key: 'earthMoon', label: 'Terra → Luna', get: () => `${km(live.metric.earthMoon)} km` },
  { key: 'earthV', label: 'Terra velocity', get: () => `${kms(live.metric.earthSpeed)} km/s` },
  { key: 'moonV', label: 'Luna rel. velocity', get: () => `${kms(live.metric.moonSpeed)} km/s` },
]

const DIAGNOSTICS = [
  { key: 'substeps', label: 'RK4 substeps / frame', get: () => String(live.stepsLastFrame) },
  {
    key: 'drift',
    label: 'Energy drift',
    // Parts per billion of total mechanical energy. The honest measure of how
    // much the integrator has lied since t=0.
    get: () => `${(live.sim.energyDrift() * 1e9).toFixed(3)} ppb`,
  },
  { key: 'fps', label: 'Frame rate', get: () => `${live.fps.toFixed(0)} fps` },
]

function Row({ label, id, wide }) {
  return (
    <div className={`flex items-baseline justify-between gap-4 ${wide ? 'pb-1' : ''}`}>
      <span className="shrink-0 text-[10px] text-white/35">{label}</span>
      <span
        data-field={id}
        className={`tabular-nums text-right ${wide ? 'text-[13px] text-hud' : 'text-[11px] text-white/85'}`}
      >
        —
      </span>
    </div>
  )
}

export function Telemetry() {
  const root = useRef(null)

  useEffect(() => {
    const all = [...FIELDS, ...DIAGNOSTICS]
    const nodes = new Map()
    for (const f of all) {
      const el = root.current?.querySelector(`[data-field="${f.key}"]`)
      if (el) nodes.set(f, el)
    }
    const tick = () => {
      for (const [f, el] of nodes) el.textContent = f.get()
    }
    tick()
    const id = setInterval(tick, 110)
    return () => clearInterval(id)
  }, [])

  return (
    <div ref={root} className="panel w-64 rounded-sm p-3.5">
      <div className="rule mb-2.5 border-b border-white/10 pb-2">Telemetry</div>
      <div className="space-y-1.5">
        {FIELDS.map((f) => (
          <Row key={f.key} id={f.key} label={f.label} wide={f.wide} />
        ))}
      </div>

      <div className="rule mt-4 mb-2.5 border-b border-white/10 pb-2">Integrator</div>
      <div className="space-y-1.5">
        {DIAGNOSTICS.map((f) => (
          <Row key={f.key} id={f.key} label={f.label} />
        ))}
      </div>

      <div className="mt-4 border-t border-white/10 pt-2.5 text-[9px] leading-relaxed text-white/25">
        True scale, 1:1. One scene unit is one metre — every radius, altitude and
        separation you see is the one the integrator is working in.
      </div>
    </div>
  )
}
