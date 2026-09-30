import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import {
  MILESTONES,
  SITES,
  logbookSnapshot,
  milestonesReached,
  platesTaken,
  filmsKept,
  padsFlown,
  subscribeLogbook,
} from '../sim/logbook.js'
import { currentPhase, PHASE_IDS } from '../sim/mission.js'
import { PRESETS, presetHref } from '../sim/presets.js'
import { metLabel } from '../gfx/photoCaption.js'

/**
 * The logbook's two surfaces.
 *
 * `LogProgress` is the strip that always runs: what you have done, and the one
 * moment this flight is about to give you next. `Logbook` is the drawer that
 * holds the whole record — milestones in flight order with the mission clock
 * they were reached at, the plates, the films on the shelf, the pads — each
 * item pointing at the flight it belongs to, so the record is also an index.
 *
 * The house grammar is kept throughout: hairlines that change colour rather
 * than move, champagne at rest and ember under the pointer, mono labels, no
 * card lifts, no counters that tick for the pleasure of ticking. A logbook is
 * a record, and a record is calm.
 *
 * ── why not the store ─────────────────────────────────────────────────
 *
 * The logbook is not view state, so it does not live in `uiStore`; it outlives
 * the page. But the HUD still has to re-render when it changes, so it exposes
 * the same subscribe/get pattern `uiStore` does and the same
 * `useSyncExternalStore` wiring reads it. The strip re-renders only when
 * something is actually recorded — never per frame.
 *
 * ── which milestone is "next" ─────────────────────────────────────────
 *
 * The milestones are listed in a flight's own order, but two kinds of flight
 * share the machine: an Earth launch runs LIFTOFF → SPLASHDOWN and never sees
 * the lunar ascent, and Eagle's flight runs the LUNAR_* phases and never sees
 * a launch from Florida. Asking "what is the first milestone I have not logged"
 * in list order would answer *Liftoff* to an Eagle pilot, forever.
 *
 * So the question is asked of the sequencer's own phase order — `PHASE_IDS`,
 * the array whose layout *is* the machine's control flow — seeded from the
 * phase the flight is actually in. The first unlogged milestone at or after
 * the current phase is the honest "next in this flight"; anything the flight
 * has already passed or will never reach is not advertised.
 */

function useLogbook() {
  return useSyncExternalStore(subscribeLogbook, logbookSnapshot, logbookSnapshot)
}

/** "T+00:02:31", or an em dash for a moment the record does not date. */
const stamp = (t) => (Number.isFinite(t) ? metLabel(t) : '—')

/** The first unlogged milestone at or after the phase the flight is in. */
function upcomingMilestone(reachedPhases) {
  let id
  try {
    id = currentPhase().id
  } catch {
    return null
  }
  const from = PHASE_IDS.indexOf(id)
  if (from < 0) return null
  return (
    MILESTONES.find(
      (m) => !reachedPhases.has(m.phase) && PHASE_IDS.indexOf(m.phase) >= from,
    ) ?? null
  )
}

/**
 * The progress strip, under the flight strip.
 *
 * Left: the count — milestones, plates, films. Right: the next moment this
 * flight is aiming at.
 */
export function LogProgress() {
  const rec = useLogbook()
  const [justNow, setJustNow] = useState(null)

  /*
   * The strip is also where the toast lives — a moment earned is announced
   * once, here, where the eye already is. The announcement comes from the
   * change itself: whenever the milestone count grows, show the newest label
   * for four seconds. No imperative caller, nothing to forget to unmount.
   */
  const count = Object.keys(rec.milestones).length
  const lastRef = useRef(count)
  useEffect(() => {
    if (count <= lastRef.current) {
      lastRef.current = count
      return
    }
    lastRef.current = count
    const reached = milestonesReached()
    const label = reached[reached.length - 1]?.label
    if (!label) return
    setJustNow(label)
    const id = setTimeout(() => setJustNow(null), 4000)
    return () => clearTimeout(id)
  }, [count])

  const reachedPhases = new Set(Object.keys(rec.milestones))
  const upcoming = justNow ? null : upcomingMilestone(reachedPhases)

  return (
    <div className="panel pointer-events-auto w-full max-w-[calc(100vw-2rem)] sm:w-fit">
      <div className="flex items-stretch">
        <div className="flex items-baseline gap-2 border-r border-hud/15 px-3.5 py-2 sm:px-4">
          <span className="rule text-[8px]">Log</span>
          <span className="font-mono text-[12px] leading-none text-[#f0e7da]/90 tabular-nums">
            {count}
            <span className="text-hud/35">/{MILESTONES.length}</span>
          </span>
          <span aria-hidden className="text-hud/20">·</span>
          <span className="font-mono text-[12px] leading-none text-[#f0e7da]/75 tabular-nums">
            {rec.plates} <span className="text-hud/35">plates</span>
          </span>
          <span aria-hidden className="text-hud/20">·</span>
          <span className="font-mono text-[12px] leading-none text-[#f0e7da]/75 tabular-nums">
            {Object.keys(rec.films).length} <span className="text-hud/35">films</span>
          </span>
        </div>
        {justNow ? (
          <div className="min-w-0 px-3.5 py-2 sm:px-4" role="status">
            <span className="rule text-[8px] whitespace-nowrap">Just now</span>
            <div className="mt-1 font-mono text-[12px] leading-none whitespace-nowrap text-ember">
              {justNow} — logged
            </div>
          </div>
        ) : upcoming ? (
          <div className="min-w-0 px-3.5 py-2 sm:px-4">
            <span className="rule text-[8px] whitespace-nowrap">Next in this flight</span>
            <div className="mt-1 font-mono text-[12px] leading-none whitespace-nowrap text-ember/90">
              {upcoming.label}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}

/**
 * The full drawer. Portalled to the body, like the mission library — for the
 * same reason: the HUD's smoked glass would otherwise become its containing
 * block and lay the drawer out in a 190-pixel column.
 */
export function Logbook({ open, onClose }) {
  const rec = useLogbook()
  useEffect(() => {
    if (!open) return
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  const reached = milestonesReached()
  const reachedPhases = new Set(reached.map((m) => m.phase))
  const films = filmsKept()
  const pads = padsFlown()
  const plates = platesTaken()
  const presetName = (id) => PRESETS.find((p) => p.id === id)?.title ?? id

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Flight logbook"
      className="fixed inset-0 z-50 overflow-y-auto bg-[#0a0b0d]/96 backdrop-blur-[2px]"
    >
      <div className="mx-auto min-h-full w-full max-w-4xl px-6 py-10 sm:px-10">
        <header className="flex items-start justify-between gap-6 border-b border-hud/15 pb-6">
          <div>
            <div className="font-mono text-[10px] tracking-[0.26em] text-hud/45 uppercase">
              Periapsis Zero · this browser
            </div>
            <h1 className="mt-2 font-display text-3xl font-normal tracking-[0.04em] text-[#efe7db] sm:text-4xl">
              Flight logbook
            </h1>
            <p className="mt-2 max-w-xl text-[12.5px] leading-relaxed text-[#e8e0d5]/60">
              What you have actually flown, seen and kept here. Nothing is graded —
              the record is the point.
            </p>
          </div>
          <button
            onClick={onClose}
            className="control mt-1 shrink-0 border border-hud/20 px-3 py-1.5 font-mono text-[10px] tracking-[0.22em] text-hud/70 uppercase transition-colors duration-300 hover:border-ember hover:text-ember"
          >
            Close
          </button>
        </header>

        {/* The milestones, in flight order — flown ones lit, the rest ahead. */}
        <section aria-label="Milestones" className="mt-8">
          <div className="font-mono text-[10px] tracking-[0.26em] text-hud/45 uppercase">
            Milestones · {reached.length}/{MILESTONES.length}
          </div>
          <div className="mt-3 border-t border-hud/12">
            {MILESTONES.map((m) => {
              const done = reachedPhases.has(m.phase)
              const at = reached.find((r) => r.phase === m.phase)?.t
              return (
                <div key={m.phase} className="flex items-baseline gap-5 border-b border-hud/12 py-3">
                  <span
                    aria-hidden
                    className={`h-1.5 w-1.5 shrink-0 translate-y-[-1px] rounded-full transition-colors duration-500 ${
                      done ? (m.phase === 'LOST' ? 'bg-red-400/70' : 'bg-ember') : 'bg-hud/20'
                    }`}
                  />
                  <span
                    className={`min-w-0 flex-1 font-sans text-[13px] ${
                      done ? 'text-[#efe7db]/92' : 'text-[#e8e0d5]/38'
                    }`}
                  >
                    {m.label}
                    <span className="ml-3 hidden text-[11px] text-[#e8e0d5]/45 sm:inline">
                      {m.note}
                    </span>
                  </span>
                  <span className="font-mono text-[10px] tracking-wider text-hud/55 tabular-nums">
                    {done ? stamp(at) : '· · ·'}
                  </span>
                </div>
              )
            })}
          </div>
        </section>

        {/* Plates, films, pads: the other three kinds of kept thing. */}
        <div className="mt-8 grid gap-px bg-hud/12 sm:grid-cols-3">
          <div className="bg-[#0a0b0d] p-5">
            <div className="rule text-[8px]">Plates taken</div>
            <div className="mt-2 font-display text-4xl font-light text-[#f0e7da]">{plates}</div>
            <p className="mt-2 text-[11px] leading-snug text-[#e8e0d5]/50">
              Press P anywhere to add one — captioned, and yours to keep.
            </p>
          </div>
          <div className="bg-[#0a0b0d] p-5">
            <div className="rule text-[8px]">Films kept</div>
            <div className="mt-2 font-display text-4xl font-light text-[#f0e7da]">
              {Object.keys(films).length}
            </div>
            <ul className="mt-2 space-y-1">
              {Object.entries(films)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 3)
                .map(([id]) => (
                  <li key={id}>
                    <a
                      href={presetHref(PRESETS.find((p) => p.id === id) ?? PRESETS[0])}
                      className="text-[11px] text-[#e8e0d5]/60 transition-colors duration-300 hover:text-ember"
                    >
                      {presetName(id)}
                    </a>
                  </li>
                ))}
            </ul>
          </div>
          <div className="bg-[#0a0b0d] p-5">
            <div className="rule text-[8px]">Pads flown from</div>
            <div className="mt-2 font-display text-4xl font-light text-[#f0e7da]">
              {pads.length}
              <span className="ml-1 font-mono text-[11px] text-hud/35">/{SITES.length}</span>
            </div>
            <ul className="mt-2 space-y-1">
              {SITES.filter((s) => pads.includes(s.id)).map((s) => (
                <li key={s.id} className="text-[11px] text-[#e8e0d5]/60">
                  {s.name}
                </li>
              ))}
            </ul>
          </div>
        </div>

        <footer className="mt-8 border-t border-hud/12 pt-4 font-mono text-[10px] leading-relaxed tracking-wider text-hud/35">
          The logbook lives in this browser only · Esc closes · Every flight here is
          flown from the pad, so the record keeps what happened, not what was loaded.
        </footer>
      </div>
    </div>,
    document.body,
  )
}
