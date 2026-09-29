import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { CATALOG, KINDS, SUGGESTED, entryById, lookup } from '../sim/catalog.js'
// The sky beyond the planets registers itself into the catalogue on load.
import '../sim/cosmos.js'
import { setUi, useUi } from '../sim/store.js'

/**
 * Go anywhere by name.
 *
 * This replaces the camera-lock list — ten fixed buttons, one of them a planet,
 * none of them the other seven — with the question a visitor actually has:
 * *where do I want to look?* Type "sat", "red planet", "moons of jupiter",
 * "sirius", "andromeda" or "chase" and choose; the camera flies there along a
 * zoom-pan path (see `gfx/zoomPath.js`) however far away it is. The list is
 * `sim/catalog.js`, which knows every body, craft, view, pad, mission and — once
 * the cosmos has loaded — star and galaxy the simulator draws.
 *
 * A typed name need not be typed correctly: "nepchune" and "androemda" are
 * matched, and a name the simulator merely recognises — Ceres, Voyager 1, a
 * constellation — is answered with what it is and that it is not in yet, rather
 * than with the nearest entry that shares some letters. `sim/catalog.js`
 * decides which of those it is; this draws the three answers.
 *
 * `/` or ⌘K focuses it from anywhere; arrows and Enter drive the list, Escape
 * leaves. On a touch layout it opens as a sheet with thumb-sized rows.
 */

/** A small glyph per kind, drawn rather than pictographic: the list is an instrument. */
function Glyph({ kind }) {
  const c = 'h-3.5 w-3.5 shrink-0'
  const s = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.3 }
  switch (kind) {
    case 'star':
      return (
        <svg viewBox="0 0 16 16" className={c} aria-hidden>
          <path d="M8 1.5v13M1.5 8h13M3.4 3.4l9.2 9.2M12.6 3.4l-9.2 9.2" {...s} strokeWidth="1.1" />
          <circle cx="8" cy="8" r="2.2" fill="currentColor" />
        </svg>
      )
    case 'planet':
    case 'dwarf':
      return (
        <svg viewBox="0 0 16 16" className={c} aria-hidden>
          <circle cx="8" cy="8" r="4.2" {...s} />
          <ellipse cx="8" cy="8" rx="7" ry="2.2" {...s} transform="rotate(-18 8 8)" strokeOpacity="0.6" />
        </svg>
      )
    case 'moon':
      return (
        <svg viewBox="0 0 16 16" className={c} aria-hidden>
          <path d="M10.8 2.6A5.6 5.6 0 1 0 13.4 11 4.6 4.6 0 0 1 10.8 2.6z" {...s} />
        </svg>
      )
    case 'comet':
      return (
        <svg viewBox="0 0 16 16" className={c} aria-hidden>
          <circle cx="11.5" cy="4.5" r="2" fill="currentColor" />
          <path d="M10 6 2 14M11 7.3 5 14.5M8.6 5 1.5 11" {...s} strokeOpacity="0.7" />
        </svg>
      )
    case 'craft':
      return (
        <svg viewBox="0 0 16 16" className={c} aria-hidden>
          <path d="M8 1.5c2 2 2.4 5 2.2 8.5H5.8C5.6 6.5 6 3.5 8 1.5z" {...s} />
          <path d="M5.8 10 4 13.5h8L10.2 10" {...s} />
        </svg>
      )
    case 'view':
      return (
        <svg viewBox="0 0 16 16" className={c} aria-hidden>
          <rect x="1.5" y="4" width="10" height="8" rx="1" {...s} />
          <path d="m11.5 7 3-2v6l-3-2" {...s} />
        </svg>
      )
    case 'site':
      return (
        <svg viewBox="0 0 16 16" className={c} aria-hidden>
          <path d="M8 14.5s-4.5-4.2-4.5-7.6a4.5 4.5 0 0 1 9 0c0 3.4-4.5 7.6-4.5 7.6z" {...s} />
          <circle cx="8" cy="7" r="1.5" {...s} />
        </svg>
      )
    case 'mission':
      return (
        <svg viewBox="0 0 16 16" className={c} aria-hidden>
          <path d="M2 13.5c3-1 5.5-4 7-9M9 4.5l3.5-2.5-.5 4.2" {...s} />
          <circle cx="3" cy="13" r="1.2" fill="currentColor" />
        </svg>
      )
    case 'galaxy':
      return (
        <svg viewBox="0 0 16 16" className={c} aria-hidden>
          <path d="M8 8c2.5-1.5 5.5-.5 6 1.5M8 8C5.5 9.5 2.5 8.5 2 6.5M8 8c1.5 2.5.5 5.5-1.5 6M8 8C6.5 5.5 7.5 2.5 9.5 2" {...s} />
          <circle cx="8" cy="8" r="1.3" fill="currentColor" />
        </svg>
      )
    case 'nebula':
    case 'cluster':
    case 'region':
    default:
      return (
        <svg viewBox="0 0 16 16" className={c} aria-hidden>
          <circle cx="5.5" cy="6" r="1.2" fill="currentColor" />
          <circle cx="10.5" cy="5" r="0.9" fill="currentColor" />
          <circle cx="9" cy="10.5" r="1.4" fill="currentColor" />
          <circle cx="4.5" cy="11" r="0.8" fill="currentColor" />
          <circle cx="12.5" cy="9.5" r="0.7" fill="currentColor" />
        </svg>
      )
  }
}

/** Open the search from anywhere — the broadcast's button, a keyboard shortcut. */
export const openSearch = () => window.dispatchEvent(new CustomEvent('pz:search'))

/** Carry out a choice: lock the camera, or follow a link. */
export function goToEntry(entry) {
  if (!entry) return
  if (entry.href) {
    window.location.href = entry.href
    return
  }
  // A view from the vehicle has no meaning on the map, which is a view of a path.
  const vehicleView = entry.kind === 'view'
  setUi((s) => ({
    focus: entry.focus,
    map: vehicleView ? false : s.map,
    // The feed shows what the director chose; choosing for yourself is flying.
    broadcast: false,
  }))
}

export function SearchBar({ compact = false }) {
  const focus = useUi((s) => s.focus)
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const input = useRef(null)
  const listId = useId()

  const { status, results, missing, note } = useMemo(() => {
    if (!query.trim()) {
      return { status: 'suggested', results: SUGGESTED.map(entryById).filter(Boolean), missing: null, note: null }
    }
    return lookup(query, 9)
    // CATALOG grows when the cosmos loads; its length is the dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, CATALOG.length])

  useEffect(() => setActive(0), [query])

  const close = useCallback(() => {
    setOpen(false)
    setQuery('')
    input.current?.blur()
  }, [])

  const choose = useCallback(
    (entry) => {
      goToEntry(entry)
      close()
    },
    [close],
  )

  // `/` and ⌘K from anywhere; the custom event from other controls.
  useEffect(() => {
    const onKey = (e) => {
      const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement
      if ((e.key === '/' && !typing) || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k')) {
        e.preventDefault()
        setOpen(true)
        requestAnimationFrame(() => input.current?.focus())
      }
    }
    const onOpen = () => {
      setOpen(true)
      requestAnimationFrame(() => input.current?.focus())
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('pz:search', onOpen)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pz:search', onOpen)
    }
  }, [])

  const onKeyDown = (e) => {
    // Keys typed here are the search's, not the cockpit's: WASD, digits and
    // Space all mean something to the sim, and none of them should fire while
    // a name is being typed.
    e.stopPropagation()
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((a) => Math.min(Math.max(0, results.length - 1), a + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => Math.max(0, a - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (results[active]) choose(results[active])
    } else if (e.key === 'Escape') {
      e.preventDefault()
      close()
    }
  }

  const current = CATALOG.find((c) => c.focus === focus && !c.href)
  const placeholder = current ? `${current.name} — search anywhere` : 'Search planets, moons, stars…'

  /*
   * On a wide screen the results float over the scene under the field. In the
   * narrow layout the field sits in the left column, which scrolls — and a
   * scrolling box clips what floats out of it, so the list was drawn nowhere
   * and a tap on a result landed on the canvas. There the list takes its
   * place in the column instead.
   */
  /*
   * The answer to a name the simulator knows of but has not built, and to one
   * it cannot place at all. Neither is selectable — there is nowhere to go —
   * so both sit above the list rather than in it, and the arrow keys walk
   * whatever genuine near-misses came with them.
   */
  const answer =
    missing != null ? (
      <li role="presentation" className={`flex items-start gap-3 px-3 ${results.length ? 'border-b border-white/8 pb-2.5' : 'pb-2'} pt-2.5`}>
        <span className="mt-px text-hud/35">
          <Glyph kind={missing.kind} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[12px] leading-tight tracking-wide text-white/65">{missing.name}</span>
          <span className="line-clamp-2 block text-[9.5px] leading-tight text-white/35">{missing.hint}</span>
        </span>
        <span className="shrink-0 text-[8.5px] tracking-[0.2em] text-ember/75 uppercase">{missing.label}</span>
      </li>
    ) : status === 'none' ? (
      <li role="presentation" className="px-3 pt-2.5 pb-2">
        <span className="block text-[12px] leading-tight tracking-wide text-white/65">{note}</span>
        <span className="mt-1 block text-[9.5px] leading-tight text-white/35">
          Nothing out there answers to that — try the Sun, Mars, Andromeda, or the Pillars of Creation
        </span>
      </li>
    ) : null

  const list = open && (answer != null || results.length > 0) && (
    <ul
      id={listId}
      role="listbox"
      className={`panel z-30 mt-1.5 overflow-y-auto rounded-sm py-1 ${
        compact ? 'relative max-h-[50vh]' : 'absolute top-full right-0 left-0 max-h-[min(60vh,26rem)]'
      }`}
    >
      {status === 'suggested' && (
        <li className="rule px-3 pt-1.5 pb-1" aria-hidden>
          Suggested
        </li>
      )}
      {answer}
      {answer != null && results.length > 0 && (
        <li className="rule px-3 pt-2 pb-1" role="presentation" aria-hidden>
          Or try
        </li>
      )}
      {results.map((e, i) => {
        const on = i === active
        const here = e.focus && e.focus === focus && !e.href
        return (
          <li key={e.id} role="option" aria-selected={on}>
            <button
              onMouseEnter={() => setActive(i)}
              onMouseDown={(ev) => ev.preventDefault()}
              onClick={() => choose(e)}
              className={`control flex w-full items-center gap-3 px-3 text-left transition-colors duration-150 outline-none ${
                compact ? 'min-h-12 py-2' : 'min-h-10 py-1.5 lg:min-h-0'
              } ${on ? 'lit bg-hud/12 text-ember' : 'text-white/75'}`}
            >
              <span className={on ? 'text-ember' : 'text-hud/55'}>
                <Glyph kind={e.kind} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12px] leading-tight tracking-wide">
                  {e.name}
                  {here && <span className="ml-2 text-[9px] tracking-[0.2em] text-hud/50 uppercase">here</span>}
                </span>
                {e.hint && (
                  <span className="block truncate text-[9.5px] leading-tight text-white/35">{e.hint}</span>
                )}
              </span>
              <span className="shrink-0 text-[8.5px] tracking-[0.2em] text-white/25 uppercase">
                {e.href ? 'open ↗' : (KINDS[e.kind]?.label ?? '')}
              </span>
            </button>
          </li>
        )
      })}
    </ul>
  )

  return (
    <div className="pointer-events-auto relative w-full">
      <label className="panel flex h-10 items-center gap-2.5 rounded-sm px-3 lg:h-9">
        <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 shrink-0 text-hud/60" aria-hidden>
          <circle cx="7" cy="7" r="4.6" fill="none" stroke="currentColor" strokeWidth="1.4" />
          <path d="m10.5 10.5 3.8 3.8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
        <input
          ref={input}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          aria-label="Search the simulator — planets, moons, stars, craft, views"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          autoComplete="off"
          spellCheck={false}
          enterKeyHint="go"
          className="min-w-0 flex-1 bg-transparent text-[16px] text-white/90 placeholder:text-white/35 outline-none sm:text-[12px]"
        />
        {query ? (
          <button
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setQuery('')}
            aria-label="Clear"
            className="control grid h-7 w-7 place-items-center text-white/40 hover:text-ember"
          >
            ×
          </button>
        ) : (
          !compact && (
            <kbd className="hidden shrink-0 rounded-[2px] border border-white/12 px-1.5 text-[9px] text-white/30 lg:block">
              /
            </kbd>
          )
        )}
      </label>
      {list}
    </div>
  )
}
