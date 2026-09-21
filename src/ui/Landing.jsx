import { useEffect, useState } from 'react'
import { PRESETS, presetHref } from '../sim/presets.js'

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
 * on a cold cache, and a reader has something to read while they do.
 *
 * What it is *not* any more is a specification. It used to open with a wall of
 * instrument chrome — every label in tracked capitals, four figures including
 * "0 B allocated per frame" — which reads as a machine describing itself. The
 * numbers were true and none of them told a visitor what they could do here.
 * The claims that survive are the three a person can act on, in plain words,
 * and the missions are on the door rather than behind it.
 */

/**
 * The three claims that are actually load-bearing, in the order they matter.
 *
 * Set as a numbered list with hanging indices rather than as three equal cards.
 * A three-up grid of feature cards is the default shape of every landing page
 * built this decade, and it flattens three statements of different weight into
 * one row of equals. A list has a first item.
 */
const CLAIMS = [
  {
    k: 'Built at true scale',
    v: 'One unit is one metre. The Moon is 384,000 km away because that is where it is.',
  },
  {
    k: 'The vehicles that flew',
    v: 'Saturn V and SLS, stage by stage, carrying the masses and thrusts they actually carried.',
  },
  {
    k: 'A flight computer, not a rail',
    v: 'It can fly the whole mission. You can take the controls at any point in it.',
  },
]

/** Entrance stagger: the eye should land on the name, then the sentence, then the way in. */
const step = (shown, i) => ({
  opacity: shown ? 1 : 0,
  transform: shown ? 'none' : 'translateY(10px)',
  transition: `opacity 900ms cubic-bezier(.2,.7,.3,1) ${i * 110}ms, transform 900ms cubic-bezier(.2,.7,.3,1) ${i * 110}ms`,
})

export function Landing({ ready, progress, label, onEnter }) {
  const [shown, setShown] = useState(false)
  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(true))
    return () => cancelAnimationFrame(id)
  }, [])

  const pct = Math.round((progress ?? 0) * 100)

  return (
    <div className="pointer-events-none absolute inset-0 overflow-y-auto font-sans">
      {/*
        Lighter than it was. The old scrim ran to 92% black across the left half
        to make room for a column of specifications; with less to read there, the
        planet can be most of what you see.
      */}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-black/85 via-black/45 to-transparent" />
      {/*
        The bottom fade is deep rather than shallow because the column is long:
        at 800 px the colophon sits squarely over the daylit Pacific, and
        white-on-cloud is unreadable at 11 px. Sized so the scrim covers the whole
        column rather than its top third: the colophon sits 638 px down an 887 px
        page, and the old 224 px fade ended long before it.
      */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[72%] bg-gradient-to-t from-black/92 via-black/55 to-transparent" />

      <div className="relative flex min-h-full items-center px-7 py-14 sm:px-16 lg:px-24">
        <div className="w-full max-w-[36rem]">
          <div
            style={step(shown, 0)}
            className="font-mono text-[10px] tracking-[0.34em] text-hud/70 uppercase"
          >
            Sol · Terra · Luna
          </div>

          <h1
            style={step(shown, 1)}
            className="mt-5 font-display text-[2.6rem] leading-[0.96] font-semibold tracking-[0.03em] text-white sm:text-[4.2rem] sm:tracking-[0.04em] lg:text-[4.8rem]"
          >
            Periapsis Zero
          </h1>

          <p style={step(shown, 2)} className="mt-6 max-w-[30rem] text-[17px] leading-[1.62] font-light text-white/80">
            Fly the missions that were actually flown — Apollo&nbsp;8 to the Moon and
            home, Artemis onto a halo orbit beyond it — through a solar system the
            size it really is.
          </p>

          <div style={step(shown, 3)} className="mt-9">
            <button
              onClick={onEnter}
              disabled={!ready}
              /*
               * Square, and no glow. A soft-cornered button with a coloured
               * halo is the house style of every SaaS front page; an
               * instrument's controls are rectilinear because a panel is
               * machined, and that is the register this thing wants.
               */
              className={`pointer-events-auto relative w-full overflow-hidden px-9 py-4 font-display text-[13px] font-semibold tracking-[0.14em] uppercase transition-all duration-200 sm:w-auto ${
                ready
                  ? 'bg-hud text-black hover:bg-white'
                  : 'cursor-progress border border-white/12 bg-transparent text-white/45'
              }`}
            >
              {/* While the world is being built the button *is* the progress bar. */}
              {!ready && (
                <span
                  aria-hidden
                  className="absolute inset-y-0 left-0 bg-white/10 transition-[width] duration-500"
                  style={{ width: `${pct}%` }}
                />
              )}
              <span className="relative">
                {ready ? 'Begin flight' : `Building the world · ${pct}%`}
              </span>
            </button>
            {!ready && label && (
              <div className="mt-3 font-mono text-[10px] tracking-wider text-white/25 lowercase">
                {label}
              </div>
            )}
          </div>

          {/* The missions, on the door rather than behind it. Each is a link: the
              vessel and the pad are fixed at load, so a mission is an address. */}
          <div style={step(shown, 4)} className="mt-11">
            <div className="font-mono text-[10px] tracking-[0.26em] text-white/30 uppercase">
              Or start inside one
            </div>
            <div className="mt-3 border-t border-white/10">
              {PRESETS.map((p, i) => (
                <a
                  key={p.id}
                  href={presetHref(p)}
                  className="pointer-events-auto group flex items-baseline gap-5 border-b border-white/10 py-3.5 transition-colors duration-200 hover:bg-white/[0.045]"
                >
                  <span className="font-mono text-[10px] text-hud/45 tabular-nums">
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13.5px] font-medium text-white/90">{p.title}</span>
                    <span className="mt-1 block text-[12px] leading-snug text-white/45">
                      {p.blurb}
                    </span>
                  </span>
                  <span className="pr-1 text-hud/50 transition-transform duration-200 group-hover:translate-x-1">
                    →
                  </span>
                </a>
              ))}
            </div>
          </div>

          {/*
            Ruled, but not numbered. The missions above are already a numbered
            list, and two of them stacked reads like a form rather than a page —
            so these are set as a definition list with the term in the display
            face and the gloss beside it, which is a different shape doing a
            different job.
          */}
          <dl style={step(shown, 5)} className="mt-12 border-t border-white/10">
            {CLAIMS.map((c) => (
              <div
                key={c.k}
                className="border-b border-white/[0.07] py-4 sm:flex sm:items-baseline sm:gap-6"
              >
                <dt className="font-display text-[11px] font-medium tracking-[0.1em] text-white/75 uppercase sm:w-[11.5rem] sm:shrink-0">
                  {c.k}
                </dt>
                <dd className="mt-1.5 min-w-0 text-[11.5px] leading-relaxed text-white/40 sm:mt-0">
                  {c.v}
                </dd>
              </div>
            ))}
          </dl>

          {/*
            The colophon. A person made this and the page says so — plainly,
            once, at the foot where a colophon belongs, rather than as a badge.
            The figures beside it are the ones this simulator is actually built
            on, and they are the kind of detail no template supplies.
          */}
          <div style={step(shown, 6)} className="mt-10 flex flex-wrap items-baseline gap-x-6 gap-y-2">
            <span className="text-[11.5px] text-white/45">
              Built by <span className="font-medium text-white/75">Ishaan&nbsp;Jha</span>, a
              high-school freshman.
            </span>
            <span className="font-mono text-[10px] tracking-[0.16em] text-white/22 uppercase">
              Epoch J2000.0 · 117,955 stars · four pads
            </span>
          </div>

          <p style={step(shown, 7)} className="mt-4 text-[11px] leading-relaxed text-white/22">
            Everything behind this page is the simulation itself, already running.
          </p>
        </div>
      </div>
    </div>
  )
}
