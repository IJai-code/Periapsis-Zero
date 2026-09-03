import { useEffect, useState } from 'react'
import { FocusMenu } from './FocusMenu.jsx'
import { TimeControls } from './TimeControls.jsx'
import { Telemetry } from './Telemetry.jsx'
import { Toggles } from './Toggles.jsx'
import { ModelSelector } from './ModelSelector.jsx'
import { ShipTelemetry } from './ShipTelemetry.jsx'
import { LagrangeMarkers } from './LagrangeMarkers.jsx'
import { setUi, useUi, WARP_LEVELS } from '../sim/store.js'
import { live } from '../sim/live.js'

const FOCUS_KEYS = {
  1: 'free',
  2: 'sun',
  3: 'earth',
  4: 'moon',
  5: 'ship',
  6: 'chase',
  7: 'iss',
  8: 'hubble',
}

function EclipseBanner() {
  const [kind, setKind] = useState(null)
  useEffect(() => {
    const id = setInterval(() => setKind(live.eclipse), 200)
    return () => clearInterval(id)
  }, [])
  if (!kind) return null

  const solar = kind === 'solar'
  return (
    <div className="panel pointer-events-none flex items-center gap-2.5 rounded-sm px-3.5 py-1.5">
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-300 shadow-[0_0_8px_1px_currentColor]" />
      <span className="text-[11px] tracking-[0.18em] text-amber-200 uppercase">
        {solar ? 'Solar eclipse' : 'Lunar eclipse'}
      </span>
      <span className="text-[10px] text-white/40">
        {solar ? 'Luna shadowing Terra' : 'Terra shadowing Luna'}
      </span>
    </div>
  )
}

export function Hud() {
  const open = useUi((s) => s.panelOpen)

  useEffect(() => {
    const onKey = (e) => {
      if (e.target instanceof HTMLInputElement) return
      if (FOCUS_KEYS[e.key]) return setUi({ focus: FOCUS_KEYS[e.key] })
      if (e.code === 'Space') {
        e.preventDefault()
        return setUi((s) => ({ paused: !s.paused }))
      }
      if (e.key === '[') return setUi((s) => ({ warp: Math.max(0, s.warp - 1) }))
      if (e.key === ']')
        return setUi((s) => ({ warp: Math.min(WARP_LEVELS.length - 1, s.warp + 1) }))
      if (e.key.toLowerCase() === 'h') return setUi((s) => ({ panelOpen: !s.panelOpen }))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <>
    <LagrangeMarkers />
    <div className="pointer-events-none fixed inset-0 z-10 select-none">
      <div className="absolute top-4 left-4 flex max-h-[calc(100vh-7rem)] flex-col gap-3 overflow-y-auto pr-1">
        <div className="pointer-events-auto">
          <div className="font-display text-lg leading-none font-semibold tracking-[0.28em] text-hud">
            SPXSIM
          </div>
          <div className="rule mt-1">Sol · Terra · Luna</div>
        </div>
        {open && (
          <div className="pointer-events-auto flex flex-col gap-3">
            <FocusMenu />
            <ModelSelector />
            <Toggles />
          </div>
        )}
      </div>

      {open && (
        <div className="pointer-events-auto absolute top-4 right-4 max-h-[calc(100vh-7rem)] overflow-y-auto">
          <div className="flex flex-col gap-3">
            <Telemetry />
            <ShipTelemetry />
          </div>
        </div>
      )}

      <div className="absolute top-4 left-1/2 -translate-x-1/2">
        <EclipseBanner />
      </div>

      <div className="pointer-events-auto absolute bottom-4 left-1/2 flex -translate-x-1/2 flex-col items-center gap-2">
        <TimeControls />
        <button
          onClick={() => setUi((s) => ({ panelOpen: !s.panelOpen }))}
          className="text-[9px] tracking-[0.2em] text-white/25 uppercase transition-colors hover:text-white/60"
        >
          {open ? 'hide panels' : 'show panels'} · h
        </button>
      </div>
    </div>
    </>
  )
}
