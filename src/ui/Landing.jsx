import { useEffect, useState } from 'react'
import { SHIP } from '../sim/constants.js'
import { VESSELS } from '../sim/vessels.js'

/**
 * The front door, over the live simulation.
 *
 * Not a separate page. The background is the simulator running — real bodies at
 * real positions under the real sun angle — and entering does not load
 * anything, it hands that camera to the player. A standalone landing page had
 * to be found at its own URL, went stale the moment the scene changed, and made
 * a promise the thing behind it then had to keep separately.
 *
 * It is also the loading screen. Textures take most of a minute to synthesise
 * on a cold cache, and a reader has something to read while they do; the call
 * to action simply waits, showing what is still being built.
 */

/** What the thing is, in the three claims that are actually load-bearing. */
const PILLARS = [
  {
    k: 'True scale',
    v: 'One scene unit is one metre. Earth is 6,371 km and the Moon is 384,000 km away, because they are. Nothing is exaggerated to fit.',
  },
  {
    k: 'Real vehicles',
    v: 'Saturn V and SLS, stage by stage, with the masses and thrusts they flew. The capsule’s ballistic coefficient comes out at 343 kg/m² because the capsule is 3.91 m across.',
  },
  {
    k: 'A flight computer, not a rail',
    v: 'The autopilot can fly Apollo 8 end to end — ascent, injection, capture, return, entry. It is a tool you can take the controls from.',
  },
]

/** Figures the engine actually produces, quoted rather than invented. */
const FIGURES = [
  { n: '1 : 1', l: 'scale, metres' },
  { n: '10⁻¹²', l: 'energy drift' },
  { n: '14', l: 'decades of depth' },
  { n: '0 B', l: 'allocated per frame' },
]

export function Landing({ ready, progress, label, onEnter }) {
  const [shown, setShown] = useState(false)
  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(true))
    return () => cancelAnimationFrame(id)
  }, [])

  const pct = Math.round((progress ?? 0) * 100)

  return (
    <div
      className={`pointer-events-none absolute inset-0 overflow-y-auto transition-opacity duration-[1200ms] ${
        shown ? 'opacity-100' : 'opacity-0'
      }`}
    >
      {/* Scrim: dense at the left where the text sits, clear on the right where
          the planet is, so the render is never fighting the copy. */}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-black/92 via-black/70 to-transparent" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-black/85 to-transparent" />

      <div className="relative flex min-h-full items-center px-8 py-16 sm:px-16">
        <div className="max-w-xl">
          <div className="rule mb-3 text-hud/70">Sol · Terra · Luna · n-body</div>
          <h1 className="font-display text-6xl leading-none font-semibold tracking-[0.14em] text-white sm:text-7xl">
            SPXSIM
          </h1>

          <p className="mt-6 text-[15px] leading-relaxed text-white/70">
            A true-scale spaceflight simulator where the missions are ones that were
            actually flown, the vehicles are the ones that flew them, and the autopilot
            is something you can take the controls from.
          </p>
          <p className="mt-3 text-[13px] leading-relaxed text-white/40">
            Watch {SHIP.name} fly itself to the Moon and back. Or fly it yourself, and
            roam a solar system that is the size it really is.
          </p>

          <div className="mt-9 flex flex-wrap items-center gap-4">
            <button
              onClick={onEnter}
              disabled={!ready}
              className={`pointer-events-auto rounded-[3px] px-7 py-3 text-[12px] font-semibold tracking-[0.22em] uppercase transition-all duration-300 ${
                ready
                  ? 'bg-hud text-black shadow-[0_0_28px_-4px_currentColor] hover:brightness-110'
                  : 'cursor-progress bg-white/10 text-white/40'
              }`}
            >
              {ready ? 'Begin flight' : `Building the world · ${pct}%`}
            </button>
            {!ready && (
              <span className="text-[10px] tracking-wider text-white/30 lowercase">{label}</span>
            )}
          </div>

          {!ready && (
            <div className="mt-4 h-px w-full max-w-sm bg-white/10">
              <div
                className="h-px bg-hud/70 transition-[width] duration-500"
                style={{ width: `${pct}%` }}
              />
            </div>
          )}

          <div className="mt-12 grid gap-5 border-t border-white/10 pt-8 sm:grid-cols-3">
            {PILLARS.map((p) => (
              <div key={p.k}>
                <div className="rule mb-1.5 text-hud/60">{p.k}</div>
                <p className="text-[11px] leading-relaxed text-white/45">{p.v}</p>
              </div>
            ))}
          </div>

          <div className="mt-8 flex flex-wrap gap-x-10 gap-y-3 border-t border-white/10 pt-6">
            {FIGURES.map((f) => (
              <div key={f.l}>
                <div className="font-display text-lg leading-none text-white/85">{f.n}</div>
                <div className="rule mt-1 text-[8px] text-white/25">{f.l}</div>
              </div>
            ))}
          </div>

          <p className="mt-8 text-[10px] leading-relaxed text-white/25">
            Flyable now: {Object.values(VESSELS).map((v) => `${v.name} — ${v.vehicle}`).join(' · ')}.
            Everything behind this page is the simulation itself, running.
          </p>
        </div>
      </div>
    </div>
  )
}
