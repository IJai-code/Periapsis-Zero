import { useCallback, useEffect, useRef, useState } from 'react'
import { INTRO, introEnd, introStart, DOSSIERS } from '../gfx/introFlights.js'
import { startMusic, cueMusic } from '../sfx/music.js'
import { filmDownload, filmSave, filmSupported, startFilm, stopFilm } from '../gfx/filmRecorder.js'
import { unlockAudio } from '../sfx/engine.js'

/**
 * The mission intro, watched rather than read.
 *
 * A black curtain holds the mission's name until the viewer asks for it —
 * which is also the gesture the browser demands before any sound may play,
 * so the cosmic score and the flight start together, exactly as the reference
 * film opens: title, then the slow fall into the scene.
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

/** Beat → music lean. The score breathes with the pages. */
const CUES = ['hold', 'reveal', 'swell', 'reveal']

export function MissionIntro({ preset, finalFocus, onBegin, onSkip }) {
  // 'curtain' | 'flying' | 'arrived'
  const [stage, setStage] = useState('curtain')
  const [beat, setBeat] = useState(-1)
  const [film, setFilm] = useState(null)
  const raf = useRef(0)
  const started = useRef(false)
  const dossier = DOSSIERS[preset?.id] ?? null

  /**
   * The gesture: sound and flight begin together. The anchors are taken here
   * — while the sim is still paused behind the curtain — so the path is built
   * from the sky the viewer is about to cross.
   */
  const begin = useCallback(() => {
    if (started.current) return
    started.current = true
    unlockAudio()
    startMusic(dossier?.music ?? 'deep')
    cueMusic('swell')
    introStart(preset.id, finalFocus)
    // And the film is made of it: the flight is a pure function of its clock,
    // so what is recorded is not *a* take, it is the flight.
    startFilm(document.querySelector('canvas'), preset)
    setStage('flying')
  }, [dossier, preset, finalFocus])

  /** Skip leaves the film, not the score: it is the mission's, and carries on. */
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
        cueMusic('reveal')
        return
      }
      raf.current = requestAnimationFrame(loop)
    }
    raf.current = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf.current)
  }, [stage])

  // The score's leans ride the beats.
  useEffect(() => {
    if (stage === 'flying' && beat >= 0) cueMusic(CUES[Math.min(CUES.length - 1, beat)] ?? 'hold')
  }, [stage, beat])

  // Arrived: hold the last page a beat, then hand the mission the screen. The
  // score settles to its resting lean and plays on underneath the flight — and
  // the film comes off the recorder and onto the library's shelf, where its
  // card keeps it.
  useEffect(() => {
    if (stage !== 'arrived') return
    stopFilm().then((blob) => {
      if (!blob) return
      setFilm(blob)
      filmSave(preset.id, blob)
    })
    const t = setTimeout(() => {
      cueMusic('hold')
      onBegin?.()
    }, 2600)
    return () => clearTimeout(t)
  }, [stage, onBegin, preset])

  if (!preset) return null
  const s = INTRO.s
  const page = beat >= 0 ? dossier?.beats?.[beat] : null

  return (
    <div className="fixed inset-0 z-40 pointer-events-none">
      {/* Letterbox: the one wordless signal that says film. */}
      <div
        aria-hidden
        className={`absolute inset-x-0 top-0 bg-black transition-all duration-1000 ${
          stage === 'curtain' ? 'h-[38vh]' : 'h-[7vh]'
        }`}
      />
      <div
        aria-hidden
        className={`absolute inset-x-0 bottom-0 bg-black transition-all duration-1000 ${
          stage === 'curtain' ? 'h-[38vh]' : 'h-[7vh]'
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
              className="mt-9 border border-ember/70 px-7 py-3 font-mono text-[11px] tracking-[0.26em] text-ember uppercase transition-colors duration-300 hover:bg-ember/12"
            >
              Begin the approach ▸
            </button>
            <div className="mt-4 font-mono text-[9px] tracking-[0.22em] text-hud/35 uppercase">
              With sound · Esc to skip
              {filmSupported() && ' · the flight is kept as a film'}
            </div>
          </div>
        </div>
      )}

      {stage !== 'curtain' && (
        <>
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
              className="border border-hud/20 px-3 py-1.5 font-mono text-[9px] tracking-[0.22em] text-hud/70 uppercase transition-colors duration-300 hover:border-ember hover:text-ember"
            >
              Skip
            </button>
            {stage === 'arrived' && film && (
              <button
                onClick={() => filmDownload(film, preset.id)}
                className="border border-hud/20 px-3 py-1.5 font-mono text-[9px] tracking-[0.22em] text-hud/70 uppercase transition-colors duration-300 hover:border-ember hover:text-ember"
              >
                Save the film ↓
              </button>
            )}
            {stage === 'arrived' && (
              <button
                onClick={() => onBegin?.()}
                className="border border-ember/70 px-3.5 py-1.5 font-mono text-[9px] tracking-[0.22em] text-ember uppercase"
              >
                Fly ▸
              </button>
            )}
          </div>
        </>
      )}
    </div>
  )
}
