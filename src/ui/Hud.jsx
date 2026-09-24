import { useEffect, useState } from 'react'
import { FocusMenu } from './FocusMenu.jsx'
import { LaunchSite } from './LaunchSite.jsx'
import { FlyHud } from './FlyHud.jsx'
import { Geophysics } from './Geophysics.jsx'
import { TimeControls } from './TimeControls.jsx'
import { Telemetry } from './Telemetry.jsx'
import { Toggles } from './Toggles.jsx'
import { ModelSelector } from './ModelSelector.jsx'
import { ShipTelemetry } from './ShipTelemetry.jsx'
import { NodePanel } from './NodePanel.jsx'
import { Presets } from './Presets.jsx'
import { CaptureStatus } from './CaptureStatus.jsx'
import { BurnPanel } from './BurnPanel.jsx'
import { LagrangeMarkers } from './LagrangeMarkers.jsx'
import { FlightStrip } from './FlightStrip.jsx'
import { Commentary } from './Commentary.jsx'
import { setUi, useUi, WARP_LEVELS } from '../sim/store.js'
import { live } from '../sim/live.js'
import { SHIP } from '../sim/constants.js'
import { prediction } from '../sim/predict.js'

/**
 * Camera modes the map cannot use.
 *
 * The map is a view of an orbit, and an orbit has to be seen from outside it.
 * These put the camera on the vehicle, inside it, or on the ground beside it,
 * so entering the map from one of them moves to the body the path is drawn
 * around.
 */
const FROM_THE_VEHICLE = new Set(['chase', 'pad', 'ground', 'fly', 'cinematic'])

const FOCUS_KEYS = {
  0: 'ground',
  1: 'free',
  2: 'sun',
  3: 'earth',
  4: 'moon',
  5: 'ship',
  6: 'chase',
  7: 'iss',
  8: 'hubble',
  9: 'fly',
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

/**
 * Into the map and back.
 *
 * Entering from a camera riding the vehicle moves to whichever body the path is
 * drawn around, because an orbit cannot be read from inside it. Any other lock
 * is left alone — if the pilot was looking at the Moon, the map opens on the
 * Moon.
 */
function toggleMap() {
  setUi((s) => ({
    map: !s.map,
    focus: !s.map && FROM_THE_VEHICLE.has(s.focus) ? (prediction.reference ?? 'earth') : s.focus,
  }))
}

/**
 * Whether the viewport is too narrow to carry two rails of panels.
 *
 * `store.js` already decides this once, at module load, to choose whether the
 * panels start open. That is the right default and the wrong thing to lay out
 * against: it never runs again, so a phone rotated into landscape, a window
 * dragged wider, or a load that happened before the viewport settled all leave
 * the layout committed to a width it no longer has. Measured at 375 px with the
 * panels open, the two rails and the centre column produced **ten overlapping
 * pairs** — panels printed over panels, which is the one thing a glass
 * interface makes worse rather than better.
 *
 * So the layout asks the viewport itself, and keeps asking.
 */
function useNarrow() {
  const [narrow, setNarrow] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(max-width: 1023px)').matches,
  )
  useEffect(() => {
    const q = window.matchMedia('(max-width: 1023px)')
    const on = (e) => setNarrow(e.matches)
    q.addEventListener('change', on)
    setNarrow(q.matches)
    return () => q.removeEventListener('change', on)
  }, [])
  return narrow
}

export function Hud() {
  const open = useUi((s) => s.panelOpen)
  const map = useUi((s) => s.map)
  const narrow = useNarrow()

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
      if (e.key.toLowerCase() === 'm') return toggleMap()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  /* Above the instruments on purpose: telemetry is ambient, the manoeuvre
     panel is whatever the pilot is doing right now. */
  const instruments = (
    <>
      <CaptureStatus />
      <NodePanel />
      <Telemetry />
      {!map && <ShipTelemetry />}
    </>
  )

  return (
    <>
    <LagrangeMarkers />
    <div className="pointer-events-none fixed inset-0 z-10 select-none">
      {/*
        The bottom clearance is 9rem on a phone and 7rem above it, and the
        difference is the control bar's own height: its buttons are 36 px for a
        thumb and 32 px for a pointer, which with the panel toggle under them
        makes the bottom furniture 97 px tall on a phone against 7rem of
        assumed clearance. Measured, the rail ran 17 px into it.
      */}
      <div className="absolute top-4 left-4 flex max-h-[calc(100vh-9rem)] flex-col gap-3 overflow-y-auto pr-1 lg:max-h-[calc(100vh-8rem)]">
        <div className="pointer-events-auto">
          <div className="flex items-baseline gap-2">
            <div className="font-display text-xl leading-none font-light tracking-[0.3em] text-hud/90">
              PERIAPSIS ZERO
            </div>
            <button
              onClick={toggleMap}
              title="Flight plan (m)"
              className={`grid h-9 min-w-[3.75rem] place-items-center border px-2 text-[9px] tracking-[0.2em] uppercase transition-colors duration-300 outline-none focus-visible:border-ember focus-visible:text-ember lg:h-7 ${
                map
                  ? 'border-ember bg-ember/18 text-ember'
                  : 'border-hud/22 text-hud/50 hover:border-ember/70 hover:text-ember'
              }`}
            >
              map · m
            </button>
          </div>
          <div className="rule mt-1">{map ? 'Flight plan' : 'Sol · Terra · Luna'}</div>
        </div>
        {/*
          The figures that change fastest, beside the ones that never do. Not
          behind the panel toggle: an ascent is over in nine minutes and a
          readout you have to reveal is a readout nobody saw.
        */}
        <div className="pointer-events-auto">
          <FlightStrip />
        </div>
        {open && (
          <div className="pointer-events-auto flex flex-col gap-3">
            <FocusMenu />
            {/* Setting the flight up, not flying it: out of the way on the map. */}
            {!map && <Presets />}
            {/* Earth's pads; a lunar vessel's site is its own, fixed. */}
            {!map && !SHIP.lunar && <LaunchSite />}
            {/* Earth's interior, and gravity at an Earth pad: nothing to say on the Moon. */}
            {!map && !SHIP.lunar && <Geophysics />}
            {!map && <ModelSelector />}
            <Toggles />
            {/*
              On a narrow screen the right-hand rail has nowhere to be, so it
              folds in here and the whole instrument set becomes one scrolling
              column. Rendered from the same elements rather than a second copy:
              two layouts of one panel set is one edit away from disagreeing.
            */}
            {narrow && instruments}
          </div>
        )}
      </div>

      {open && !narrow && (
        <div className="pointer-events-auto absolute top-4 right-4 max-h-[calc(100vh-8rem)] overflow-y-auto">
          <div className="flex flex-col gap-3">{instruments}</div>
        </div>
      )}

      {/*
        Below the strip, not beside it. The centre column is centred on the
        *viewport* while the left rail is not, so at 1024 px the burn panel ran
        from x=304 and the telemetry strip to x=453 — measured, a 149 px overlap
        straight through the dynamic-pressure figure. Dropping the column clear
        of the strip's own band costs nothing: the panel is still centred, still
        the first thing in the middle of the frame, and now nothing is ever
        printed over a live number.
      */}
      {/*
        Hidden while the single column is open on a narrow screen — there is
        one column's worth of room and the instruments are in it. Opening the
        panels on a phone is an explicit "show me everything" and this is what
        it costs; closing them brings the burn panel straight back.
      */}
      {!(narrow && open) && (
        <div className="absolute top-[8.5rem] left-1/2 flex w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 flex-col items-center gap-2 sm:top-[8rem]">
          <EclipseBanner />
          <BurnPanel />
        </div>
      )}

      {/* Outside the panel toggle on purpose: it is the mode's own instructions,
          and a mode whose controls are only documented behind a hidden panel is
          a mode nobody finds. */}
      {/* Outside the panel toggle on purpose: it is the mode's own instructions,
          and a mode whose controls are only documented behind a hidden panel is
          a mode nobody finds. */}
      <div className="absolute bottom-4 left-4">
        <FlyHud />
      </div>

      {/*
        Commentary above the controls, in the centre column rather than at the
        bottom-left where it started. The left corner looked right and was not:
        the control bar is centred on the viewport and 670 px wide at this size,
        so a 480 px line beginning at the left margin ran straight underneath
        it and lost its last two sentences. The centre column is the one place
        at the foot of the screen wide enough for prose, and stacking the two
        means neither can reach the other however either one grows.
      */}
      <div className="pointer-events-auto absolute bottom-4 left-1/2 flex -translate-x-1/2 flex-col items-center gap-2">
        <Commentary />
        <TimeControls />
        <button
          onClick={() => setUi((s) => ({ panelOpen: !s.panelOpen }))}
          className="min-h-9 px-4 py-2.5 text-[9px] tracking-[0.2em] text-hud/35 uppercase transition-colors duration-300 outline-none hover:text-ember focus-visible:text-ember lg:min-h-0 lg:py-2"
        >
          {open ? 'hide panels' : 'show panels'} · h
        </button>
      </div>
    </div>
    </>
  )
}
