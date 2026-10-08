import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { advancePrologue, FIRST_MISSION, PROLOGUE_SECONDS, prologueAt } from '../core/prologue.js'
import { initialQuality, resetFilmLearner } from '../core/quality.js'
import { pauseSound } from '../audio.js'

const Scene = lazy(() => import('../scene/PrologueScene.jsx'))
const timecode = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`

export function Prologue({ onComplete }) {
  const clock = useRef({ time: 0 })
  const [time, setTime] = useState(0)
  const [paused, setPaused] = useState(false)
  const [brief, setBrief] = useState(false)
  const [hidden, setHidden] = useState(() => document.hidden)
  const [reduced] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  const root = useRef()
  const [initialTier] = useState(() => initialQuality())
  const { chapter, caption, progress } = prologueAt(time)
  useEffect(() => { root.current?.focus() }, [])
  useEffect(() => {
    let last = performance.now(), frame
    const tick = (now) => {
      clock.current.time = advancePrologue(clock.current.time, Math.min(0.25, (now - last) / 1000), paused || brief, document.hidden)
      last = now
      // The caption, the timecode and the bar read to a tenth of a second and
      // no finer, so the interface is told only when one of those moves: six
      // renders a second instead of sixty, on the device least able to pay
      // for them. The clock itself stays exact.
      setTime((shown) => (Math.abs(shown - clock.current.time) >= 0.1 ? clock.current.time : shown))
      if (clock.current.time >= PROLOGUE_SECONDS) setBrief(true)
      frame = requestAnimationFrame(tick)
    }
    const visibility = () => { last = performance.now(); setHidden(document.hidden) }
    document.addEventListener('visibilitychange', visibility)
    frame = requestAnimationFrame(tick)
    return () => { cancelAnimationFrame(frame); document.removeEventListener('visibilitychange', visibility) }
  }, [paused, brief])
  useEffect(() => { pauseSound(paused || hidden); return () => pauseSound(false) }, [paused, hidden])
  // The film's own measurement is good for one run of the film: a replay, or
  // coming back to it, is a fresh look at the machine.
  useEffect(() => () => resetFilmLearner(), [])
  const skip = () => setBrief(true)
  return <section className="film-root" ref={root} tabIndex={-1} aria-label={brief ? 'Mission briefing' : 'Opening film'} onKeyDown={(e) => {
    if (/input|button/i.test(e.target.tagName)) return
    if (e.code === 'Space') { e.preventDefault(); skip() }
    if (e.code === 'Escape' && !brief) { e.preventDefault(); setPaused((p) => !p) }
  }}>
    <Suspense fallback={<div className="gm-loading">Preparing the opening film</div>}><Scene clock={clock} reduced={reduced} tier={initialTier} stopped={paused || brief || hidden} /></Suspense>
    {!brief ? <div className="film-overlay">
      <header><span>Periapsis Zero / Prologue · captions + music only</span><span>{timecode(time)} / 2:00</span></header>
      <div className="film-chapter" key={chapter.id}><span className="st-eyebrow">{chapter.label}</span><h1>{chapter.title}</h1></div>
      <p className="film-caption" aria-live="polite" aria-atomic="true">{caption}</p>
      {paused && <div className="film-paused">Film paused</div>}
      <footer>
        <div><button onClick={() => setPaused((p) => !p)}>{paused ? 'Resume film' : 'Pause film'}</button></div>
        <button onClick={skip}>Skip to mission <kbd className="gk">Space</kbd></button>
      </footer>
      <div className="film-progress" role="progressbar" aria-label="Opening film progress" aria-valuemin={0} aria-valuemax={120} aria-valuenow={Math.floor(time)}><i style={{ width: `${progress * 100}%` }} /></div>
    </div> : <div className="film-brief" role="dialog" aria-label="Your first mission">
      <article>
        <span className="st-eyebrow">Act I / Mission 01</span><h1>{FIRST_MISSION.title}</h1>
        <p className="film-contact">{FIRST_MISSION.contact}</p>
        <p>{FIRST_MISSION.premise}</p><h2>Your mission</h2><p>{FIRST_MISSION.objective}</p>
        <ol>{FIRST_MISSION.steps.map((s) => <li key={s}>{s}</li>)}</ol>
        <p className="film-reward">{FIRST_MISSION.reward}</p>
        <p className="film-controls">Mouse to steer. Hold W to fly, release to brake. F to dock. Advanced controls can wait.</p>
        {/* The film has just measured this machine; hand the answer to the game
            so it begins at the tier the film's own frames argued for. */}
        <button className="st-primary" autoFocus onClick={() => { pauseSound(false); onComplete(initialQuality()) }}>Board your Kestrel</button>
        <button className="st-ghost" onClick={() => { clock.current.time = 0; setTime(0); setBrief(false); setPaused(false); resetFilmLearner() }}>Replay film</button>
      </article>
    </div>}
  </section>
}
