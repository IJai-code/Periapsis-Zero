import { useEffect, useRef, useState } from 'react'
import { DEVICE_COPY, DEVICE_IDS, guessDevice } from '../sim/device.js'
import { Mark } from './Mark.jsx'

/**
 * The first question: what is this running on?
 *
 * Asked once, before the scene is built, because the answer decides how it is
 * built — how many pixels, how deep the surfaces go, how many trees stand round
 * the pad — and the layout the controls take. The detected device is marked and
 * focused so Enter takes it, but nothing is assumed: an iPad reports itself as a
 * Mac, and a touch laptop is not a tablet.
 *
 * It also takes over from the boot splash. The splash hands off on the first
 * rendered frame, and there is no frame yet — the canvas waits for this answer.
 */

function Icon({ id }) {
  const common = {
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.4,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
  }
  if (id === 'phone') {
    return (
      <svg viewBox="0 0 48 48" className="h-11 w-11" aria-hidden>
        <rect x="15" y="5" width="18" height="38" rx="3.5" {...common} />
        <path d="M21 9.5h6" {...common} />
        <circle cx="24" cy="38.5" r="1.2" {...common} />
      </svg>
    )
  }
  if (id === 'tablet') {
    return (
      <svg viewBox="0 0 48 48" className="h-11 w-11" aria-hidden>
        <rect x="8" y="6" width="32" height="36" rx="3.5" {...common} />
        <circle cx="24" cy="38.2" r="1.1" {...common} />
        <path d="M12 10h24v24H12z" {...common} strokeOpacity="0.45" />
      </svg>
    )
  }
  return (
    <svg viewBox="0 0 48 48" className="h-11 w-11" aria-hidden>
      <rect x="9" y="10" width="30" height="21" rx="2" {...common} />
      <path d="M4 37h40l-3-5H7z" {...common} />
      <path d="M21 34.5h6" {...common} />
    </svg>
  )
}

export function DevicePrompt({ onChoose }) {
  const guess = useRef(guessDevice()).current
  const [shown, setShown] = useState(false)
  const first = useRef(null)

  useEffect(() => {
    // The splash's own dismissal, early: this screen is the first frame now.
    const boot = document.getElementById('boot')
    if (boot && !boot.dataset.bootDone) {
      boot.dataset.bootDone = '1'
      boot.classList.add('boot-done')
      window.setTimeout(() => boot.remove(), 700)
    }
    const id = requestAnimationFrame(() => setShown(true))
    first.current?.focus({ preventScroll: true })
    return () => cancelAnimationFrame(id)
  }, [])

  // The detected device first in tab order and focus, the rest in their usual order.
  const order = [guess, ...DEVICE_IDS.filter((d) => d !== guess)]

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="pz-device-title"
      className="fixed inset-0 z-[110] flex items-center justify-center overflow-y-auto bg-obsidian px-4 py-8"
      style={{ background: 'radial-gradient(120% 80% at 50% 0%, #1c1815 0%, #0a0b0d 62%)' }}
    >
      <div
        className="w-full max-w-3xl text-center"
        style={{
          opacity: shown ? 1 : 0,
          transform: shown ? 'none' : 'translateY(12px)',
          transition: 'opacity 900ms cubic-bezier(.2,.7,.3,1), transform 900ms cubic-bezier(.2,.7,.3,1)',
        }}
      >
        <div className="flex justify-center">
          <Mark size={40} />
        </div>
        <div className="mt-4 font-mono text-[10px] tracking-[0.32em] text-hud/50 uppercase">
          Periapsis Zero
        </div>
        <h1
          id="pz-device-title"
          className="mt-3 font-display text-3xl font-light tracking-[0.04em] text-[#efe7db] sm:text-4xl"
        >
          What are you flying on?
        </h1>
        <p className="mx-auto mt-3 max-w-md font-sans text-[13px] leading-relaxed text-[#e8e0d5]/60">
          The solar system is drawn to fit the machine it runs on. Pick yours and the
          controls, the layout and the level of detail follow.
        </p>

        <div className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-3">
          {order.map((id, i) => {
            const copy = DEVICE_COPY[id]
            const detected = id === guess
            return (
              <button
                key={id}
                ref={i === 0 ? first : undefined}
                onClick={() => onChoose(id)}
                className={`control group relative flex min-h-[4.5rem] items-center gap-4 border px-5 py-4 text-left transition-colors duration-300 outline-none sm:min-h-0 sm:flex-col sm:items-center sm:gap-3 sm:px-4 sm:py-6 sm:text-center ${
                  detected
                    ? 'border-ember/70 bg-ember/8 text-ember hover:bg-ember/14 focus-visible:bg-ember/16'
                    : 'border-hud/18 text-hud/75 hover:border-ember/60 hover:text-ember focus-visible:border-ember focus-visible:text-ember'
                }`}
              >
                <span className="shrink-0">
                  <Icon id={id} />
                </span>
                <span className="min-w-0">
                  <span className="block font-mono text-[12px] tracking-[0.22em] uppercase">{copy.label}</span>
                  <span className="mt-1.5 block font-sans text-[12px] leading-snug text-[#e8e0d5]/55">
                    {copy.note}
                  </span>
                </span>
                {detected && (
                  <span className="absolute top-2 right-2 font-mono text-[8.5px] tracking-[0.24em] text-ember/80 uppercase sm:top-2.5 sm:right-3">
                    Detected
                  </span>
                )}
              </button>
            )
          })}
        </div>

        <p className="mt-6 font-mono text-[9px] tracking-[0.22em] text-hud/35 uppercase">
          You can change this later under display
        </p>
      </div>
    </div>
  )
}
