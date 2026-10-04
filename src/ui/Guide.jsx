import { useCallback, useEffect, useState } from 'react'
import { setUi } from '../sim/store.js'
import { presetHref, PRESETS } from '../sim/presets.js'

/**
 * The cosmic guide: what you see when the sim opens.
 *
 * A short, skippable tour that steers the *live* scene, the same camera the
 * simulator flies with, through the beats the product is made of, one caption
 * at a time. Nothing here is a video or a slideshow of renders: each step sets
 * the camera's focus and the scene responds, so the guide is the simulation
 * showing itself around.
 *
 * It opens once per browser (localStorage decides), stays reachable from the
 * front door, and gets out of the way with Esc or its own skip, an intro that
 * cannot be left is not an intro, it is a hostage situation.
 */

const STEPS = [
  {
    focus: 'sun',
    eyebrow: 'One star',
    title: 'The real solar system, right now',
    body:
      'Every planet is where it really is today. Their motion is calculated live ' +
      'from gravity, step by step, not played back from an animation.',
  },
  {
    focus: 'earth',
    eyebrow: 'One planet',
    title: 'Earth, at true size',
    body:
      'Real ground heights under every launch pad, and Earth\u2019s slightly squashed ' +
      'shape built into its gravity, which slowly turns every low orbit you fly.',
  },
  {
    focus: 'moon',
    eyebrow: 'One moon',
    title: 'The Moon, three days away',
    body:
      'Moon terrain from NASA\u2019s lunar orbiters. The paths to it are calculated, ' +
      'not drawn by hand: the burns into orbit, the halo orbits and the way home.',
  },
  {
    /*
     * From the ground, at eye height, not the orbit lock. On the pad the
     * orbit lock's offset put the camera beside the launch deck's underside,
     * and the stop was a grey slab filling the frame; the eye-level camera is
     * the one built to stand next to the hull, which is what the caption says.
     */
    focus: 'ground',
    eyebrow: 'One vehicle',
    title: 'A rocket you can stand next to',
    body:
      'The pad is modelled down to the swing arms and flame trench. The last minute ' +
      'of the countdown runs as it really did: venting, the arms swinging back, water ' +
      'on the pad, and the engines lit while the rocket is still held down.',
  },
  {
    focus: 'cinematic',
    eyebrow: 'Your turn',
    title: 'Fly one',
    body:
      `${PRESETS.length} real missions, each starting on the pad. Pick one to watch, or ` +
      'take the guided flight with the countdown at sixty seconds.',
  },
]

const SEEN_KEY = 'periapsis.guide.v1'

export function guideShouldOpen() {
  try {
    return !window.localStorage.getItem(SEEN_KEY)
  } catch {
    return false
  }
}

/** Remember that this browser has been shown round, however the tour was left. */
function markSeen() {
  try {
    window.localStorage.setItem(SEEN_KEY, '1')
  } catch {
    /* private mode: the guide simply opens again next time */
  }
}

export function Guide({ open, onClose, onLibrary }) {
  const [step, setStep] = useState(0)

  // Each beat points the live camera. One store write per step, the rig does
  // the flying.
  useEffect(() => {
    if (open) setUi({ focus: STEPS[step].focus })
  }, [open, step])

  /*
   * The scene is told a tour is running, so it can leave the pilot's
   * instruments out of the shots; and when the tour ends, however it ends, the
   * front door gets its own shot back. Leaving the camera where the last stop
   * put it parked the page on the Sun, with the planets' name tags printed
   * across its title.
   */
  useEffect(() => {
    if (!open) return
    setUi({ tour: true })
    return () => setUi({ tour: false, focus: 'cinematic' })
  }, [open])

  const close = useCallback(() => {
    markSeen()
    onClose()
  }, [onClose])

  // The library is a way out of the tour too, and counts as having seen it:
  // it used to skip the note, so the tour reopened on every visit after.
  const toLibrary = useCallback(() => {
    markSeen()
    onLibrary()
  }, [onLibrary])

  const next = useCallback(() => {
    setStep((s) => (s + 1 < STEPS.length ? s + 1 : s))
  }, [])
  const back = useCallback(() => setStep((s) => Math.max(0, s - 1)), [])

  useEffect(() => {
    if (!open) return
    const onKey = (e) => {
      /*
       * The tour's keys belong to the tour's own controls only. Space and
       * Enter bubbled out of the caption card's buttons, press Next and the
       * keydown also advanced the beat the button had just moved to, so one
       * click moved the tour two steps and every second slide flashed past
       * unread; on the last beat they fired the flight link *and* closed the
       * tour. Inputs are excluded so the mission library's search still works
       * underneath.
       */
      if (e.target instanceof HTMLInputElement) return
      if (e.target instanceof HTMLButtonElement || e.target instanceof HTMLAnchorElement) return
      if (e.key === 'Escape') {
        e.preventDefault()
        close()
      } else if (e.key === 'ArrowRight' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        next()
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        back()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, close, next, back])

  if (!open) return null
  const s = STEPS[step]
  const last = step === STEPS.length - 1
  const launch = PRESETS.find((p) => p.id === 'apollo8-launch')

  return (
    <div className="pointer-events-none fixed inset-0 z-40 flex flex-col justify-between">
      {/* A vignette, so captions read against the scene whatever the camera is on. */}
      <div
        aria-hidden
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(120% 90% at 50% 40%, transparent 55%, rgba(10,11,13,0.55) 100%)',
        }}
      />

      {/* Top: the beat index, as a walkable rail of dots. */}
      <div className="pointer-events-auto flex items-start justify-between gap-6 px-6 pt-6 sm:px-10">
        <div className="flex items-center gap-3">
          <span className="font-mono text-[10px] tracking-[0.26em] text-hud/50 uppercase">
            A short tour
          </span>
          <div className="flex items-center gap-1.5" role="tablist" aria-label="Tour beats">
            {STEPS.map((st, i) => (
              <button
                key={st.title}
                role="tab"
                aria-selected={i === step}
                aria-label={st.eyebrow}
                title={st.title}
                onClick={() => setStep(i)}
                className={`control h-3 w-8 transition-colors duration-500 ${
                  i === step ? 'lit bg-ember' : i < step ? 'bg-hud/50 hover:bg-hud/70' : 'bg-hud/20 hover:bg-hud/40'
                }`}
              />
            ))}
          </div>
          <span className="font-mono text-[10px] text-hud/40">
            {String(step + 1).padStart(2, '0')}/{String(STEPS.length).padStart(2, '0')}
          </span>
        </div>
        <button
          onClick={close}
          className="control border border-hud/20 px-3 py-1.5 font-mono text-[10px] tracking-[0.22em] text-hud/70 uppercase transition-colors duration-300 hover:border-ember hover:text-ember"
        >
          Skip tour
        </button>
      </div>

      {/* Bottom: the caption card and its controls. */}
      <div className="pointer-events-auto px-6 pb-8 sm:px-10">
        <div className="mx-auto max-w-2xl border border-hud/15 bg-[#120b22]/82 px-6 py-5 backdrop-blur-[3px]">
          <div className="font-mono text-[10px] tracking-[0.26em] text-ember/85 uppercase">
            {s.eyebrow}
          </div>
          <h2 className="mt-2 font-display text-2xl font-normal tracking-[0.03em] text-hud">
            {s.title}
          </h2>
          <p className="mt-2.5 text-[12px] leading-relaxed text-hud/72">{s.body}</p>

          <div className="mt-5 flex flex-wrap items-center gap-2">
            {last ? (
              <>
                <button
                  onClick={toLibrary}
                  className="control border border-ember/70 px-4 py-2 font-mono text-[10px] tracking-[0.22em] text-ember uppercase transition-colors duration-300 hover:bg-ember/12"
                >
                  Open the mission library
                </button>
                <a
                  href={launch ? presetHref(launch) : '#flight'}
                  onClick={close}
                  className="border border-hud/25 px-4 py-2 font-mono text-[10px] tracking-[0.22em] text-hud/80 uppercase transition-colors duration-300 hover:border-ember hover:text-ember"
                >
                  Watch a launch from the pad
                </a>
              </>
            ) : (
              <>
                <button
                  onClick={next}
                  className="control border border-hud/25 px-4 py-2 font-mono text-[10px] tracking-[0.22em] text-hud/85 uppercase transition-colors duration-300 hover:border-ember hover:text-ember"
                >
                  Next →
                </button>
                <button
                  onClick={back}
                  disabled={step === 0}
                  className="control px-3 py-2 font-mono text-[10px] tracking-[0.22em] text-hud/55 uppercase transition-colors duration-300 hover:text-hud/85 disabled:opacity-35"
                >
                  ← Back
                </button>
              </>
            )}
            <span className="ml-auto font-mono text-[9px] tracking-[0.18em] text-hud/35 uppercase">
              ← → to walk · Esc to leave
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
