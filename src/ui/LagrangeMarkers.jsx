import { useEffect, useRef } from 'react'
import { lagrange, markerNodes } from '../sim/lagrange.js'
import { useUi } from '../sim/store.js'

/**
 * Screen-space waypoints for the Earth-Moon libration points.
 *
 * Plain DOM in the HUD layer — positions are written directly by
 * LagrangeProjector, so nothing here re-renders as the camera moves. The
 * distance readout ticks on a slow timer because it is text, not motion.
 */
const STYLE = {
  L1: 'text-hud',
  L2: 'text-hud',
  L3: 'text-hud',
  L4: 'text-emerald-300',
  L5: 'text-emerald-300',
}

export function LagrangeMarkers() {
  const show = useUi((s) => s.lagrange)
  const root = useRef(null)

  useEffect(() => {
    if (!show) return undefined
    const nodes = lagrange.labels.map((l) => root.current?.querySelector(`[data-lp="${l}"]`))
    const tick = () => {
      for (let i = 0; i < nodes.length; i++) {
        if (nodes[i]) nodes[i].textContent = `${(lagrange.distance[i] / 1000).toFixed(0)} km`
      }
    }
    tick()
    const id = setInterval(tick, 250)
    return () => clearInterval(id)
  }, [show])

  if (!show) return null

  return (
    <div ref={root} className="pointer-events-none fixed inset-0 z-[6] overflow-hidden">
      {lagrange.labels.map((label, i) => (
        <div
          key={label}
          ref={(n) => (markerNodes[i] = n)}
          className="absolute top-0 left-0 will-change-transform"
          style={{ transform: 'translate3d(-9999px,-9999px,0)' }}
        >
          <div className="flex -translate-x-1/2 -translate-y-1/2 items-center gap-1.5">
            {/* Hollow diamond: reads as a waypoint rather than a body. */}
            <span
              className={`block h-[7px] w-[7px] rotate-45 border border-current ${STYLE[label]} opacity-70`}
            />
            <span className="flex flex-col leading-none">
              <span className={`font-mono text-[10px] tracking-[0.18em] ${STYLE[label]}`}>
                {label}
              </span>
              <span data-lp={label} className="font-mono text-[8px] text-white/30 tabular-nums">
                —
              </span>
            </span>
          </div>
        </div>
      ))}
    </div>
  )
}
