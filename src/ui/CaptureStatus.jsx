import { useEffect, useState } from 'react'
import { mission } from '../sim/mission.js'
import { nodes } from '../sim/nodes.js'

const flown = (id) => id > 0 && nodes.some((n) => n.id === id && n.executed)

/** A copy of what the panel shows, taken on the HUD's clock rather than per frame. */
function read() {
  const c = mission.capture
  return {
    solving: c.solving,
    progress: c.progress,
    error: c.error,
    planned: c.planned,
    total: c.total,
    burns: [
      { name: 'Capture', dv: c.first, planned: c.nodes.capture > 0, flown: flown(c.nodes.capture), later: '' },
      { name: 'Plane change', dv: c.second, planned: c.nodes.plane > 0, flown: flown(c.nodes.plane), later: '' },
      {
        name: 'Correction',
        dv: c.correction,
        planned: c.correctionPlanned,
        flown: flown(c.nodes.correction),
        later: 'after the plane change',
      },
      { name: 'Insertion', dv: c.third, planned: c.insertionPlanned, flown: flown(c.nodes.insertion), later: 'at arrival' },
    ],
  }
}

/**
 * The halo capture, while there is one.
 *
 * While the worker searches: how far through it is, so fifteen seconds of
 * background targeting reads as progress rather than as nothing happening. Then
 * the burns it planned, and which have flown — the correction and the insertion
 * are solved later, against the states the craft actually reaches, so until then
 * their figures are the search's estimate or nothing.
 */
export function CaptureStatus() {
  const [s, setS] = useState(read)
  useEffect(() => {
    const id = setInterval(() => setS(read()), 200)
    return () => clearInterval(id)
  }, [])
  if (!s.solving && !s.error && !s.planned) return null

  const pct = Math.round(s.progress * 100)
  return (
    <div className="panel w-64 rounded-sm p-3.5">
      <div className="rule mb-2.5 flex items-baseline justify-between border-b border-white/10 pb-2">
        <span>Halo capture</span>
        {s.planned && <span className="font-mono text-[10px] text-hud">{s.total.toFixed(0)} m/s</span>}
      </div>

      {s.solving && (
        <div>
          <div className="mb-1.5 flex items-baseline justify-between text-[11px] text-white/70">
            <span>{pct === 0 ? "Finding the Gateway's orbit" : 'Searching transfers'}</span>
            <span className="font-mono text-[10px] text-white/40">{pct}%</span>
          </div>
          <div className="relative h-px w-full overflow-hidden bg-white/10">
            <div className="h-full bg-hud transition-[width] duration-200 ease-out" style={{ width: `${pct}%` }} />
          </div>
          <div className="mt-2 text-[9px] leading-relaxed text-white/30">
            Solved in a worker, so the flight carries on meanwhile.
          </div>
        </div>
      )}

      {!s.solving && s.error && <div className="text-[11px] leading-relaxed text-amber-300">{s.error}</div>}

      {!s.solving && s.planned && (
        <div className="space-y-1">
          {s.burns.map((burn) => (
            <div key={burn.name} className="flex items-baseline justify-between text-[11px]">
              <span className={burn.flown ? 'text-white/40' : 'text-white/75'}>
                {burn.flown ? '✓ ' : ''}
                {burn.name}
              </span>
              <span className="font-mono text-[10px] text-white/45">
                {burn.planned && burn.dv > 0 ? `${burn.dv.toFixed(1)} m/s` : burn.later}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
