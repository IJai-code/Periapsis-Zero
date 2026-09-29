import { useCallback, useEffect, useRef, useState } from 'react'
import { INTRO, introEnd, introStart, DOSSIERS } from '../gfx/introFlights.js'
import { filmSave, filmSupported, startFilm, stopFilm } from '../gfx/filmRecorder.js'

/**
 * The mission intro, watched rather than read.
 *
 * A black curtain holds the mission's name until the viewer asks for it,
 * then the flight begins, exactly as the reference film opens: title, then
 * the slow fall into the scene. It is silent — the product makes no sound.
 *
 * Under it, one continuous camera flight through the real solar system (see
 * `gfx/introFlights.js`) with the dossier's pages turning on its beats, a
 * letterbox to say *film* rather than *simulator*, and two ways out: Skip,
 * or Enter to go straight to the mission. Nothing here renders video — the
 * flight is the scene itself, which is why it is sharp at any resolution.
 *
 * The component polls `INTRO` on a rAF and re-renders only when the beat
 * changes: the flight itself allocates nothing, and neither does watching it.
 */

export function MissionIntro({ preset, finalFocus, onBegin, onSkip }) {
  // 'curtain' | 'flying' | 'arrived'
  const [stage, setStage] = useState('curtain')
  const [beat, setBeat] = useState(-1)
  const [, setFilm] = useState(null)
  const raf = useRef(0)
  const started = useRef(false)
  const dossier = DOSSIERS[preset?.id] ?? null

  /**
   * The gesture: the flight begins. The anchors are taken here
   * — while the sim is still paused behind the curtain — so the path is built
   * from the sky the viewer is about to cross.
   */
  const begin = useCallback(() => {
    if (started.current) return
    started.current = true
    introStart(preset.id, finalFocus)
    // And the film is made of it: the flight is a pure function of its clock,
    // so what is recorded is not *a* take, it is the flight.
    startFilm(document.querySelector('canvas'), preset)
    setStage('flying')
  }, [preset, finalFocus])

  /** Skip leaves the film and goes straight to the mission. */
  const skip = useCallback(() => {
    stopFilm()
    introEnd()
    onSkip?.()
  }, [onSkip])

  // Enter/Space advances, Esc leaves. The film's controls, not a form's.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        skip()
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        if (stage === 'curtain') begin()
        else if (stage === 'arrived') onBegin?.()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [stage, begin, skip, onBegin])

  // The flight itself is flown by the camera rig (focus 'intro'); this only
  // watches `INTRO` and turns pages when the beat changes. A rAF poll outside
  // the Canvas is the honest way to read scene state from the DOM side — and
  // it renders only on change, so watching the film costs nothing per frame.
  useEffect(() => {
    if (stage !== 'flying') return
    const loop = () => {
      const b = INTRO.beat
      setBeat((prev) => (prev === b ? prev : b))
      if (!INTRO.active) {
        setStage('arrived')
        return
      }
      raf.current = requestAnimationFrame(loop)
    }
    raf.current = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf.current)
  }, [stage])

  // Arrived: the flight's last frame *is* the mission's first (see
  // gfx/introFlights.js), so there is nothing to wait for — the bars draw back
  // off the picture, the page fades, and the mission has the screen. The film
  // comes off the recorder and onto the library's shelf, where its card keeps it.
  useEffect(() => {
    if (stage !== 'arrived') return
    stopFilm().then((blob) => {
      if (!blob) return
      setFilm(blob)
      filmSave(preset.id, blob)
    })
    const t = setTimeout(() => onBegin?.(), 1250)
    return () => clearTimeout(t)
  }, [stage, onBegin, preset])

  if (!preset) return null
  const s = INTRO.s
  const page = beat >= 0 ? dossier?.beats?.[beat] : null

  return (
    <div className="fixed inset-0 z-40 pointer-events-none">
      {/*
        The curtain itself: black, all of it, until the viewer asks. The bars
        alone left the middle quarter of the screen open onto whatever the
        camera happened to face before the flight — at a pad at noon that was
        the sky's glare, straight behind the title, the blurb and the dossier,
        which were then cream on pale yellow and could not be read. The bars
        stay for the film; the curtain lifts off them as the flight begins.
      */}
      <div
        aria-hidden
        className={`absolute inset-0 bg-black transition-opacity duration-[1600ms] ease-out ${
          stage === 'curtain' ? 'opacity-100' : 'opacity-0'
        }`}
      />
      {/* Letterbox: the one wordless signal that says film — and on arrival
          it draws back off the picture rather than vanishing with it. */}
      <div
        aria-hidden
        className={`absolute inset-x-0 top-0 bg-black transition-[height] duration-[1200ms] ease-in-out ${
          stage === 'curtain' ? 'h-[38vh]' : stage === 'arrived' ? 'h-0' : 'h-[7vh]'
        }`}
      />
      <div
        aria-hidden
        className={`absolute inset-x-0 bottom-0 bg-black transition-[height] duration-[1200ms] ease-in-out ${
          stage === 'curtain' ? 'h-[38vh]' : stage === 'arrived' ? 'h-0' : 'h-[7vh]'
        }`}
      />

      {stage === 'curtain' && (
        <div className="pointer-events-auto absolute inset-0 flex items-center justify-center">
          <div className="text-center">
            <div className="font-mono text-[10px] tracking-[0.32em] text-hud/50 uppercase">
              Periapsis Zero presents
            </div>
            <h1 className="mt-4 font-display text-4xl font-light tracking-[0.06em] text-[#efe7db] sm:text-5xl">
              {preset.title}
            </h1>
            <div className="mt-3 text-[12.5px] tracking-wide text-[#e8e0d5]/60">{preset.blurb}</div>
            {/* The dossier's cover sheet: the flight's own numbers, in the
                library's grammar — hairlines and mono labels, nothing lifted. */}
            {dossier?.specs && (
              <dl className="mx-auto mt-6 grid max-w-2xl grid-cols-2 gap-x-8 gap-y-3 border-y border-hud/12 px-2 py-4 text-left sm:grid-cols-4">
                {dossier.specs.map(([label, value]) => (
                  <div key={label}>
                    <dt className="font-mono text-[9px] tracking-[0.22em] text-hud/40 uppercase">
                      {label}
                    </dt>
                    <dd className="mt-1 text-[11.5px] leading-snug text-[#e8e0d5]/78">{value}</dd>
                  </div>
                ))}
              </dl>
            )}
            <button
              onClick={begin}
              className="control mt-9 border border-ember/70 px-7 py-3 font-mono text-[11px] tracking-[0.26em] text-ember uppercase transition-colors duration-300 hover:bg-ember/12"
            >
              Begin the approach ▸
            </button>
            <div className="mt-4 font-mono text-[9px] tracking-[0.22em] text-hud/35 uppercase">
              Esc to skip
              {filmSupported() && ' · the flight is kept as a film'}
            </div>
          </div>
        </div>
      )}

      {stage !== 'curtain' && (
        <div
          className="transition-opacity duration-700"
          style={{ opacity: stage === 'arrived' ? 0 : 1 }}
        >
          {/* The dossier's page, lower third between the bars. */}
          <div className="absolute inset-x-0 bottom-[11vh] flex justify-center px-8">
            <div
              key={beat}
              className="max-w-xl text-center"
              style={{ animation: 'pz-fade 1.2s ease both' }}
            >
              {page && (
                <>
                  <div className="font-mono text-[10px] tracking-[0.32em] text-ember/85 uppercase">
                    {page.eyebrow}
                  </div>
                  <div className="mt-2 font-display text-2xl font-light tracking-wide text-[#efe7db]/92 sm:text-3xl">
                    {page.line}
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Progress hairline + controls, quiet in the corner. */}
          <div className="pointer-events-auto absolute inset-x-0 top-[7vh] flex items-center gap-4 px-6 py-3">
            <div className="h-px flex-1 bg-hud/15">
              <div
                aria-hidden
                className="h-px bg-ember/80 transition-[width] duration-500"
                style={{ width: `${Math.round(s * 100)}%` }}
              />
            </div>
            <button
              onClick={skip}
              className="control min-h-9 border border-hud/20 px-3 py-1.5 font-mono text-[9px] tracking-[0.22em] text-hud/70 uppercase transition-colors duration-300 hover:border-ember hover:text-ember lg:min-h-0"
            >
              Skip
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
