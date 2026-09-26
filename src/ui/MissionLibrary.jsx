import { useEffect, useRef, useState } from 'react'
import { PRESETS, presetHref } from '../sim/presets.js'
import { filmAll, filmDownload } from '../gfx/filmRecorder.js'
import { VESSELS } from '../sim/vessels.js'
import { ALL_SITES } from '../sim/launchsite.js'
import { WARP } from '../sim/warp.js'

/**
 * The mission library: nine flights as a flight archive.
 *
 * The landing page used to carry the missions as a ruled list — fine for three,
 * thin for nine. This is the drawer they belong in: a catalogue of flight
 * plans, each with the vehicle, the pad, the moment it hands over and the pace
 * it hands over at. The cards are links, because a mission here is still an
 * address — vessel and pad are fixed at load, so choosing a flight reloads with
 * its own and flies from the pad to the moment it advertises.
 *
 * The visual grammar is the front door's: hairlines that change colour rather
 * than move, champagne at rest and ember under the pointer, mono labels, no
 * card lifts. A flight archive is an index, not a shop.
 */

/**
 * The curated part of the catalogue — what each flight hands over to, and
 * where it belongs in the drawer. Everything else (craft, pad) is read from
 * the simulator's own registries so the two cannot disagree.
 */
const PLAN = {
  'apollo8-launch': { tag: 'From the pad', hand: 'T-60 s, standing on the ground' },
  'apollo11-liftoff': { tag: 'From the pad', hand: 'T-60 s, Tranquility Base' },
  'apollo8-tli': { tag: 'To the Moon', hand: 'At TLI ignition, real time' },
  'apollo8-lunar-orbit': { tag: 'To the Moon', hand: 'Before the capture burn' },
  'apollo11-docking': { tag: 'To the Moon', hand: 'Braking, a mile from Columbia' },
  'artemis-halo': { tag: 'In orbit', hand: 'Lunar approach, capture solved' },
  'vandenberg-polar': { tag: 'In orbit', hand: 'Minutes before the raise' },
  'apollo8-tei': { tag: 'Coming home', hand: 'At TEI ignition, real time' },
  'apollo8-reentry': { tag: 'Coming home', hand: 'Service module separation' },
}

const TAGS = ['From the pad', 'To the Moon', 'In orbit', 'Coming home']

const pace = (warp) => {
  if (warp === WARP.x1) return 'Real time'
  if (warp === WARP.m1) return 'A minute a second'
  if (warp === WARP.x10) return '10×'
  return 'Sequenced'
}

/* ------------------------------------------------------------------ *
 * The hero motifs: one diagram per kind of flight, drawn in the brand's
 * own hairlines — arc, body, ember tick. The library is the mark's home
 * as much as the tab is.
 * ------------------------------------------------------------------ */

function Motif({ tag }) {
  const hud = 'currentColor'
  const ember = '#d7733e'
  return (
    <svg viewBox="0 0 160 72" aria-hidden className="h-full w-full text-hud/55">
      {tag === 'From the pad' && (
        <>
          <line x1="0" y1="64" x2="160" y2="64" stroke={hud} strokeWidth="1" opacity="0.5" />
          <path d="M36 64 C 60 60, 84 36, 118 8" fill="none" stroke={hud} strokeWidth="1.4" />
          <circle cx="36" cy="64" r="3.2" fill={hud} />
          <path d="M112 10 l6 -4 1 7 z" fill={ember} />
        </>
      )}
      {tag === 'To the Moon' && (
        <>
          <circle cx="34" cy="36" r="16" fill="none" stroke={hud} strokeWidth="1.3" />
          <circle cx="128" cy="26" r="8" fill="none" stroke={hud} strokeWidth="1.1" opacity="0.75" />
          <path d="M46 28 C 74 6, 104 8, 122 20" fill="none" stroke={ember} strokeWidth="1.3" strokeDasharray="3 3" />
          <circle cx="86" cy="11" r="2.6" fill={hud} />
        </>
      )}
      {tag === 'In orbit' && (
        <>
          <ellipse cx="80" cy="38" rx="52" ry="21" fill="none" stroke={hud} strokeWidth="1.3" />
          <circle cx="80" cy="38" r="11" fill="none" stroke={hud} strokeWidth="1.1" opacity="0.8" />
          <circle cx="28" cy="38" r="3" fill={ember} />
          <path d="M28 52 l-4 6 8 0 z" fill={ember} opacity="0.85" />
        </>
      )}
      {tag === 'Coming home' && (
        <>
          <path d="M18 12 C 52 22, 88 42, 122 62" fill="none" stroke={hud} strokeWidth="1.4" />
          <circle cx="122" cy="62" r="3.2" fill={hud} />
          <path d="M30 18 l-9 -5 M44 24 l-10 -6 M58 31 l-11 -6" stroke={ember} strokeWidth="1.2" />
          <line x1="0" y1="68" x2="160" y2="68" stroke={hud} strokeWidth="1" opacity="0.4" />
        </>
      )}
    </svg>
  )
}

export function MissionLibrary({ open, onClose }) {
  const [tag, setTag] = useState('All')
  const gridRef = useRef(null)
  const shown = tag === 'All' ? PRESETS : PRESETS.filter((p) => PLAN[p.id]?.tag === tag)

  /**
   * The shelf: films the flights have left here.
   *
   * Each mission's intro is recorded as it plays (gfx/filmRecorder.js) and
   * kept on this shelf, so a flight watched becomes a flight kept — its card
   * plays it back and can hand it over as a file. The object URLs are made
   * when the drawer opens and given back when it closes.
   */
  const [films, setFilms] = useState({})
  useEffect(() => {
    if (!open) return
    let alive = true
    const urls = []
    filmAll().then((all) => {
      if (!alive) return
      const out = {}
      for (const [id, entry] of Object.entries(all)) {
        const url = URL.createObjectURL(entry.blob)
        urls.push(url)
        out[id] = { url, entry }
      }
      setFilms(out)
    })
    return () => {
      alive = false
      for (const u of urls) URL.revokeObjectURL(u)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
        return
      }
      if (!['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp'].includes(e.key)) return
      // Roving focus across the cards: a drawer is walked with the arrows.
      const cards = gridRef.current?.querySelectorAll('a[data-card]')
      if (!cards?.length) return
      const list = [...cards]
      const at = list.indexOf(document.activeElement)
      const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1
      const next = at < 0 ? 0 : (at + step + list.length) % list.length
      e.preventDefault()
      list[next].focus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Mission library"
      className="fixed inset-0 z-50 overflow-y-auto bg-[#0a0b0d]/96 backdrop-blur-[2px]"
    >
      <div className="mx-auto min-h-full w-full max-w-6xl px-6 py-10 sm:px-10">
        {/* The masthead: same eyebrow rhythm as the front door. */}
        <header className="flex items-start justify-between gap-6 border-b border-hud/15 pb-6">
          <div>
            <div className="font-mono text-[10px] tracking-[0.26em] text-hud/45 uppercase">
              Periapsis Zero · flight archive
            </div>
            <h1 className="mt-2 font-display text-3xl font-normal tracking-[0.04em] text-[#efe7db] sm:text-4xl">
              Mission library
            </h1>
            <p className="mt-2 max-w-xl text-[12.5px] leading-relaxed text-[#e8e0d5]/60">
              Every flight here is flown from the pad when it loads — nothing is a saved
              state. Choose where to arrive.
            </p>
          </div>
          <button
            onClick={onClose}
            className="mt-1 shrink-0 border border-hud/20 px-3 py-1.5 font-mono text-[10px] tracking-[0.22em] text-hud/70 uppercase transition-colors duration-300 hover:border-ember hover:text-ember"
          >
            Close
          </button>
        </header>

        {/* The drawer's own index tabs. */}
        <nav className="mt-6 flex flex-wrap gap-2" aria-label="Filter missions">
          {['All', ...TAGS].map((t) => {
            const on = t === tag
            return (
              <button
                key={t}
                onClick={() => setTag(t)}
                aria-pressed={on}
                className={`border px-3.5 py-1.5 font-mono text-[10px] tracking-[0.18em] uppercase transition-colors duration-300 ${
                  on
                    ? 'border-ember/70 text-ember'
                    : 'border-hud/18 text-hud/55 hover:border-hud/40 hover:text-hud/85'
                }`}
              >
                {t}
              </button>
            )
          })}
          <span className="ml-auto self-center font-mono text-[10px] tracking-[0.18em] text-hud/35 uppercase">
            {shown.length} {shown.length === 1 ? 'flight' : 'flights'}
          </span>
        </nav>

        {/* The cards. Colour is the only animated property — see the front
            door's mission rows for why nothing here moves. */}
        <div ref={gridRef} className="mt-6 grid gap-px bg-hud/12 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((p, i) => {
            const plan = PLAN[p.id] ?? { tag: 'In orbit', hand: 'As sequenced' }
            const craft = VESSELS[p.vessel]?.name ?? p.vessel
            const pad = ALL_SITES[p.site]?.name ?? p.site
            return (
              <a
                key={p.id}
                data-card
                href={presetHref(p)}
                className="group relative flex flex-col bg-[#0a0b0d] p-5 outline-none transition-colors duration-500 hover:bg-hud/[0.045] focus-visible:bg-hud/[0.055]"
              >
                <span
                  aria-hidden
                  className="absolute top-0 bottom-0 left-0 w-px bg-transparent transition-colors duration-500 group-hover:bg-ember group-focus-visible:bg-ember"
                />
                <div className="flex items-start justify-between gap-3">
                  <span className="font-mono text-[10px] text-hud/40 transition-colors duration-500 group-hover:text-ember">
                    {String(PRESETS.indexOf(p) + 1).padStart(2, '0')}
                  </span>
                  <span className="font-mono text-[9px] tracking-[0.18em] text-hud/38 uppercase">
                    {plan.tag}
                  </span>
                </div>
                <div className="mt-3 h-16 w-full overflow-hidden opacity-90">
                  {films[p.id] ? (
                    <video
                      src={films[p.id].url}
                      muted
                      loop
                      playsInline
                      autoPlay
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <Motif tag={plan.tag} />
                  )}
                </div>
                <h2 className="mt-3 font-sans text-[14px] font-normal text-[#efe7db]/92">
                  {p.title}
                </h2>
                <p className="mt-1.5 text-[11.5px] leading-snug text-[#e8e0d5]/58">{p.blurb}</p>
                <dl className="mt-4 space-y-1 border-t border-hud/10 pt-3 font-mono text-[9.5px] tracking-wider text-hud/45 uppercase">
                  <div className="flex justify-between gap-3">
                    <dt>Craft</dt>
                    <dd className="text-hud/70 normal-case">{craft}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt>Pad</dt>
                    <dd className="text-hud/70 normal-case">{pad}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt>Hands over</dt>
                    <dd className="text-right text-hud/70 normal-case">{plan.hand}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt>Pace</dt>
                    <dd className="text-hud/70 normal-case">{pace(p.warp)}</dd>
                  </div>
                </dl>
                {films[p.id] && (
                  <button
                    onClick={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      filmDownload(films[p.id].entry, p.id)
                    }}
                    className="mt-3 w-fit border border-hud/20 px-2.5 py-1 font-mono text-[9px] tracking-[0.2em] text-hud/65 uppercase transition-colors duration-300 hover:border-ember hover:text-ember"
                  >
                    Your film ↓
                  </button>
                )}
                <span className="mt-4 flex items-center gap-2 font-mono text-[10px] tracking-[0.22em] text-hud/40 uppercase transition-colors duration-500 group-hover:text-ember">
                  Fly this flight
                  <span aria-hidden className="text-hud/30 transition-colors duration-500 group-hover:text-ember">
                    →
                  </span>
                </span>
              </a>
            )
          })}
        </div>

        <footer className="mt-8 border-t border-hud/12 pt-4 font-mono text-[10px] leading-relaxed tracking-wider text-hud/35">
          Arrow keys walk the drawer · Esc closes · Each flight is flown from the pad
          to the moment it names, in well under a second · A flight watched is kept
          here as a film.
        </footer>
      </div>
    </div>
  )
}
