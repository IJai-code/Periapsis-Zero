import { useCallback, useEffect, useRef, useState } from 'react'
import { PRESETS } from '../sim/presets.js'
import { Mark } from './Mark.jsx'

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
 *
 * ── the scroll, and why it was broken ─────────────────────────────────
 *
 * The column is taller than a laptop viewport — 1,079 px against 768 — and the
 * element that scrolled it carried `pointer-events-none`. That flag was there so
 * the planet behind stayed grabbable, and it meant the wheel never reached the
 * scroller: the event went through to the canvas and OrbitControls zoomed
 * instead. It appeared to work in patches, because the handful of children that
 * re-enabled pointer events — the button, the three mission rows — *did* scroll
 * when the cursor happened to be over one. Scrolling down moved those patches
 * out from under the cursor, so the way back up was gone. A control that works
 * in three bands of a page and nowhere else is worse than one that never works,
 * because the visitor concludes the page is broken rather than that they missed.
 *
 * So the scroller takes pointer events, which costs nothing: this overlay is a
 * sibling of the Canvas and is mounted only *before* flight, so there is no
 * scene interaction behind it to preserve. The scrims move out of the scrolling
 * box and become siblings of it, which also fixes them visually — they used to
 * scroll away from the text they exist to make readable.
 *
 * And because a page that scrolls should say so, there is a cue at the foot
 * while there is more below, and a way back to the top once you have left it.
 * Both are real controls rather than decoration: the cue scrolls a page down,
 * and neither appears when it would be a lie.
 */

/**
 * The three claims that are actually load-bearing, in the order they matter.
 *
 * Set as a definition list rather than three equal cards. A three-up grid of
 * feature cards is the default shape of every landing page built this decade,
 * and it flattens three statements of different weight into one row of equals.
 * Deliberately not numbered either — the missions above already are, and two
 * numbered lists stacked read like a form rather than a page.
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

export function Landing({ ready, progress, label, onEnter, onLibrary, onTour }) {
  const [shown, setShown] = useState(false)
  const scroller = useRef(null)
  /** How far down we are, and whether there is anything below. Both drive controls. */
  const [scrolled, setScrolled] = useState(false)
  const [more, setMore] = useState(false)

  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(true))
    return () => cancelAnimationFrame(id)
  }, [])

  /*
   * One handler for the scroller's own geometry, run on scroll and on resize,
   * and once on mount because the page can already overflow before anything has
   * moved. `ResizeObserver` rather than a window listener: the column's height
   * changes when the button stops being a progress bar, not only when the window
   * does.
   */
  const measure = useCallback(() => {
    const el = scroller.current
    if (!el) return
    setScrolled(el.scrollTop > 120)
    setMore(el.scrollTop + el.clientHeight < el.scrollHeight - 24)
  }, [])

  useEffect(() => {
    const el = scroller.current
    if (!el) return
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    if (el.firstElementChild) ro.observe(el.firstElementChild)
    return () => ro.disconnect()
  }, [measure, ready])

  const scrollBy = useCallback((sign) => {
    const el = scroller.current
    if (!el) return
    el.scrollTo({ top: sign < 0 ? 0 : el.scrollTop + el.clientHeight * 0.82, behavior: 'smooth' })
  }, [])

  const pct = Math.round((progress ?? 0) * 100)

  return (
    <div className="absolute inset-0 font-sans">
      {/*
        The scrims sit outside the scrolling box now. Inside it they were laid
        out at the top of a 1,079 px column and scrolled off with it, so the foot
        of the page — the colophon, over the daylit Pacific — lost the fade that
        made it legible at exactly the moment it came into view.

        Lighter than it was across the left: with less to read there, the planet
        can be most of what you see.
      */}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-obsidian/92 via-obsidian/55 to-transparent" />
      {/*
        The foot runs deeper and further up than it did. The column ends over
        the daylit Pacific, and cream text on a sunlit cloud top is the one
        place on this page where contrast can actually fail — so the scrim
        covers the whole lower half rather than the lower third, and it fades
        from obsidian rather than from pure black so it sits under warm imagery
        without going grey.
      */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[72%] bg-gradient-to-t from-obsidian/96 via-obsidian/74 to-transparent" />
      {/* The warm top-down vignette, over the title bar. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-48 bg-gradient-to-b from-warm/90 via-obsidian/55 to-transparent" />

      {/*
        The title bar. Two readouts, hairline-ruled, in the mono face — the
        register of a panel rather than of a nav. It is not a menu and does not
        pretend to be one: there is one place to go from here.
      */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-center justify-between border-b border-hud/[0.12] px-7 py-4 sm:px-16 lg:px-24">
        <span
          style={step(shown, 0)}
          className="flex items-center gap-2.5 font-mono text-[10px] tracking-[0.34em] text-hud/75 uppercase"
        >
          <Mark size={18} />
          Sol · Terra · Luna
        </span>
        <span
          style={step(shown, 0)}
          className="hidden font-mono text-[10px] tracking-[0.2em] text-hud/40 uppercase sm:block"
        >
          Epoch J2000.0 · 117,955 stars
        </span>
      </div>

      {/*
        The scroller. `overscroll-contain` so a flick at the bottom does not
        hand the gesture to the page behind, and a focusable region so the
        keyboard can drive it — a scrollable box that only answers to a wheel is
        half a control.
      */}
      <div
        ref={scroller}
        onScroll={measure}
        tabIndex={0}
        aria-label="Introduction"
        className="absolute inset-0 overflow-y-auto overscroll-contain scroll-smooth outline-none"
      >
        <div className="relative flex min-h-full items-center px-7 pt-24 pb-24 sm:px-16 lg:px-24">
          <div className="w-full max-w-[36rem]">
            {/*
              Light, serif, and widely tracked — and *smaller* than it was,
              which is the part that is counter-intuitive. Letterspacing at
              0.15em adds about two ems across fourteen characters, so the old
              4.8rem setting would have run 693 px into a 576 px column. An
              editorial display line is not a big word; it is a quiet one with
              air around every letter, and the air is what has to be paid for.
            */}
            <h1
              style={step(shown, 1)}
              className="font-display text-[2rem] leading-[1.06] font-light tracking-[0.15em] text-[#f5efe6] sm:text-[3rem] lg:text-[3.4rem]"
            >
              Periapsis Zero
            </h1>

            <p
              style={step(shown, 2)}
              className="mt-7 max-w-[30rem] text-[16.5px] leading-[1.75] font-light text-[#e8e0d5]/92"
            >
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
                /*
                 * A hairline rather than a slab. The old button was a solid
                 * block of accent with the label knocked out of it, which is
                 * the loudest thing a page can contain and made the accent
                 * colour mean "button" instead of "this one". Now the border
                 * carries it and the fill arrives on hover — the control is
                 * quiet until you reach for it.
                 */
                className={`group relative w-full overflow-hidden border px-10 py-4 font-sans text-[11px] font-medium tracking-[0.22em] uppercase transition-colors duration-300 outline-none focus-visible:ring-1 focus-visible:ring-ember/80 focus-visible:ring-offset-4 focus-visible:ring-offset-obsidian sm:w-auto ${
                  ready
                    ? 'border-hud/45 text-[#f0e7da] hover:border-ember hover:bg-ember hover:text-obsidian'
                    : 'cursor-progress border-white/10 bg-transparent text-white/40'
                }`}
              >
                {/* While the world is being built the button *is* the progress bar. */}
                {!ready && (
                  <>
                    <span
                      aria-hidden
                      className="absolute inset-y-0 left-0 bg-hud/12 transition-[width] duration-500"
                      style={{ width: `${pct}%` }}
                    />
                    {/* The sweep is already in the stylesheet, for exactly this. */}
                    <span
                      aria-hidden
                      className="absolute inset-y-0 w-1/3 bg-gradient-to-r from-transparent via-white/[0.07] to-transparent motion-reduce:hidden"
                      style={{ animation: 'sweep 2.4s linear infinite' }}
                    />
                  </>
                )}
                <span className="relative">
                  {ready ? 'Begin flight' : `Building the world · ${pct}%`}
                </span>
              </button>
              {!ready && label && (
                <div className="mt-3 font-mono text-[10px] tracking-wider text-hud/40 lowercase">
                  {label}
                </div>
              )}
            </div>

            {/* The flights, and the two ways into them. Nine missions is a
                drawer, not a list — they live in the library now — and the tour
                is the other door: one row for people who know what they want,
                one for people who would rather be shown around first. The
                hairline that changes colour rather than moving is kept from the
                rows these replace; nothing here rises when touched. */}
            <div style={step(shown, 4)} className="mt-11">
              <div className="font-mono text-[10px] tracking-[0.26em] text-hud/45 uppercase">
                The flights
              </div>
              <div className="mt-3 border-t border-hud/12">
                <button
                  onClick={onLibrary}
                  className="group relative flex w-full items-baseline gap-5 border-b border-hud/12 py-5 text-left outline-none transition-colors duration-500 hover:bg-hud/[0.04] focus-visible:bg-hud/[0.05]"
                >
                  <span
                    aria-hidden
                    className="absolute top-0 bottom-0 -left-4 w-px bg-hud/20 transition-colors duration-500 group-hover:bg-ember group-focus-visible:bg-ember"
                  />
                  <span className="font-mono text-[10px] text-hud/40 transition-colors duration-500 group-hover:text-ember">
                    {String(PRESETS.length).padStart(2, '0')}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-sans text-[13.5px] font-normal text-[#efe7db]/90">
                      Mission library
                    </span>
                    <span className="mt-1.5 block text-[11.5px] leading-snug text-[#e8e0d5]/58">
                      From the pad, to the Moon, and the burn for home — choose where to
                      arrive.
                    </span>
                  </span>
                  <span className="pr-1 text-hud/30 transition-colors duration-500 group-hover:text-ember">
                    →
                  </span>
                </button>
                <button
                  onClick={onTour}
                  className="group relative flex w-full items-baseline gap-5 border-b border-hud/12 py-5 text-left outline-none transition-colors duration-500 hover:bg-hud/[0.04] focus-visible:bg-hud/[0.05]"
                >
                  <span
                    aria-hidden
                    className="absolute top-0 bottom-0 -left-4 w-px bg-hud/20 transition-colors duration-500 group-hover:bg-ember group-focus-visible:bg-ember"
                  />
                  <span className="font-mono text-[10px] text-hud/40 transition-colors duration-500 group-hover:text-ember">
                    ~
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-sans text-[13.5px] font-normal text-[#efe7db]/90">
                      Take the tour
                    </span>
                    <span className="mt-1.5 block text-[11.5px] leading-snug text-[#e8e0d5]/58">
                      A short tour of the solar system, flown by the camera itself.
                    </span>
                  </span>
                  <span className="pr-1 text-hud/30 transition-colors duration-500 group-hover:text-ember">
                    →
                  </span>
                </button>
              </div>
            </div>

            {/*
              Ruled, but not numbered — see CLAIMS above for why this is a
              definition list and not a row of cards.
            */}
            <dl style={step(shown, 5)} className="mt-12 border-t border-hud/12">
              {CLAIMS.map((c) => (
                <div
                  key={c.k}
                  className="border-b border-hud/[0.09] py-4 sm:flex sm:items-baseline sm:gap-6"
                >
                  <dt className="font-display text-[13px] font-normal tracking-[0.16em] text-hud/85 uppercase sm:w-[11.5rem] sm:shrink-0">
                    {c.k}
                  </dt>
                  {/*
                    /50 rather than /40, and the notch is measured rather than
                    eyeballed. Rendering the scene into an offscreen target and
                    sampling the band this list sits in: the background is
                    0.0191 relative luminance at the 95th percentile, where
                    white/40 reads 6.67:1 and clears AA for small text easily.
                    The tail is the problem — the brightest cloud tops in that
                    same band reach 0.111, and white/40 falls to 3.2:1 against
                    those. /50 takes the typical case to 8.1:1 and the tail to
                    3.8:1. That last figure is still under 4.5, and is left
                    written down rather than rounded up to a claim: clearing it
                    everywhere needs white/65, which is the term's own weight
                    and would flatten the list into one tone.
                  */}
                  <dd className="mt-1.5 min-w-0 text-[11.5px] leading-relaxed text-[#e8e0d5]/55 sm:mt-0">
                    {c.v}
                  </dd>
                </div>
              ))}
            </dl>

            {/*
              The colophon. A person made this and the page says so — plainly,
              once, at the foot where a colophon belongs, rather than as a badge.
            */}
            <div
              style={step(shown, 6)}
              className="mt-10 flex flex-wrap items-baseline gap-x-6 gap-y-2"
            >
              <span className="text-[11.5px] text-[#e8e0d5]/55">
                Built by <span className="font-medium text-[#f2ebe0]/85">Ishaan&nbsp;Jha</span>, a
                high-school freshman.
              </span>
              <span className="font-mono text-[10px] tracking-[0.16em] text-hud/35 uppercase">
                Four pads · one integrator
              </span>
            </div>

            <p style={step(shown, 7)} className="mt-4 text-[11px] leading-relaxed text-[#e8e0d5]/42">
              Everything behind this page is the simulation itself, already running.
            </p>

            {/*
              The phone's way back up, in the flow of the column rather than
              floating over it. On a narrow screen the column is the whole width,
              so a floating control has nowhere to sit that is not on top of
              something — measured, the two in the margin below overlapped a line
              of body text at four of the five scroll positions sampled at 375 px.
              A control that covers the sentence you are reading is not an
              affordance. In the flow it can never collide, and a touch screen
              scrolls by direct manipulation anyway, so the floating cue is
              solving a wheel problem that a thumb does not have.
            */}
            <button
              type="button"
              onClick={() => scrollBy(-1)}
              className="mt-8 border border-hud/20 px-4 py-2.5 font-mono text-[10px] tracking-[0.24em] text-hud/55 uppercase outline-none hover:border-ember hover:text-ember focus-visible:border-ember sm:hidden"
            >
              ↑ Back to top
            </button>
          </div>
        </div>
      </div>

      {/*
        The two scroll controls, as one rail down the right-hand margin. Neither
        is decoration: each appears only when it has somewhere to go, each does
        the thing it depicts, and each leaves the tab order when hidden so it
        cannot become a keyboard trap. They sit outside the scroller so they stay
        put while it moves.

        The right margin rather than the centre, and that is a correction: the
        cue was centred on the viewport, and the reading column is left-aligned
        and ends around two-thirds across — so a centred button sat squarely in
        the middle of the claims, and the live page read "The Moo[ MORE ]m away".
        The column never reaches this margin, and the planet behind it is the
        part of the frame with nothing to read on it.
      */}
      <button
        type="button"
        onClick={() => scrollBy(1)}
        aria-hidden={!more}
        tabIndex={more ? 0 : -1}
        className={`absolute right-7 bottom-6 z-20 hidden border border-hud/20 bg-obsidian/55 px-4 py-2 font-mono text-[9px] tracking-[0.26em] text-hud/55 uppercase backdrop-blur-[16px] transition-all duration-300 outline-none hover:border-ember hover:text-ember focus-visible:border-ember motion-reduce:transition-none sm:right-16 sm:block lg:right-24 ${
          more ? 'pointer-events-auto opacity-100' : 'pointer-events-none translate-y-2 opacity-0'
        }`}
      >
        More ↓
      </button>

      <button
        type="button"
        onClick={() => scrollBy(-1)}
        aria-label="Back to top"
        aria-hidden={!scrolled}
        tabIndex={scrolled ? 0 : -1}
        className={`absolute top-20 right-7 z-20 hidden border border-hud/20 bg-obsidian/55 px-3 py-2 font-mono text-[9px] tracking-[0.24em] text-hud/55 uppercase backdrop-blur-[16px] transition-all duration-300 outline-none hover:border-ember hover:text-ember focus-visible:border-ember motion-reduce:transition-none sm:right-16 sm:block lg:right-24 ${
          scrolled ? 'pointer-events-auto opacity-100' : 'pointer-events-none -translate-y-2 opacity-0'
        }`}
      >
        ↑ Top
      </button>
    </div>
  )
}
