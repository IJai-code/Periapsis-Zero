import { useCallback, useEffect, useRef, useState } from 'react'
import { setUi, uiStore, useUi, WARP_LEVELS } from '../sim/store.js'
import { currentPhase } from '../sim/mission.js'
import { FEED, cameraSource, eventCaption, missionClock } from '../sim/broadcast.js'
import { radio, radioTick } from '../sim/radio.js'
import { commentaryNow } from '../sim/commentary.js'
import { TimeControls } from './TimeControls.jsx'
import { openSearch } from './SearchBar.jsx'
import { GoForLaunch } from './GoForLaunch.jsx'
import { Mark } from './Mark.jsx'

/**
 * The flight as a broadcast.
 *
 * The instrument panel is for flying. This is for watching, and it is laid out
 * the way a feed from the mission was: the picture, a caption in the corner
 * saying which camera it is, the mission clock in the other, a lower third
 * when something happens, and the loop — Houston and the spacecraft —
 * captioned at the foot of the frame. It is silent: the loop is read, not
 * heard. The narration the instruments
 * carry comes too, as a caption that appears when something new happens and
 * goes when it has been read, so the picture is left alone the rest of the time.
 *
 * The controls get out of the way. They show while the pointer moves and for
 * three seconds after, and stay while the flight is paused; `B` goes back to
 * the instruments and the number keys still cut between cameras, which in a
 * broadcast is what a director's switcher does.
 *
 * Everything that changes often is written straight into the DOM from one
 * tenth-of-a-second timer, as the instrument strip is; React renders only on
 * the events — a cut, a phase, a transmission.
 */

/** How long a lower third stays up, ms. */
const LOWER_THIRD_MS = 7000
/** How long the controls linger after the pointer stops, ms. */
const CHROME_MS = 3000

/** Seconds a narration line stays: its reading time and a margin, capped. */
function readingSeconds(text) {
  const words = text.split(/\s+/).length
  return Math.min(22, words / 3.2 + 3)
}

/**
 * Searching is choosing where to look, which a feed does not let you do — so
 * it leaves the feed for the cockpit and opens the search there, once the
 * cockpit has mounted to receive the request.
 */
function searchFromFeed() {
  setUi({ broadcast: false })
  setTimeout(openSearch, 60)
}

export function BroadcastHud() {
  const focus = useUi((s) => s.focus)
  const captions = useUi((s) => s.captions)
  const paused = useUi((s) => s.paused)

  const [phase, setPhase] = useState(() => currentPhase().id)
  const [tx, setTx] = useState(null)
  const [lower, setLower] = useState(null)
  const [signal, setSignal] = useState(true)
  const [narrating, setNarrating] = useState(false)
  const [chrome, setChrome] = useState(true)

  const clockMain = useRef(null)
  const clockSub = useRef(null)
  const narration = useRef(null)
  const narrationUntil = useRef(0)
  const lowerTimer = useRef(0)
  const chromeTimer = useRef(0)

  const showLower = useCallback((id) => {
    const cap = eventCaption(id)
    clearTimeout(lowerTimer.current)
    if (!cap) {
      setLower(null)
      return
    }
    setLower({ ...cap, key: `${id}-${performance.now()}` })
    lowerTimer.current = setTimeout(() => setLower(null), LOWER_THIRD_MS)
  }, [])

  const narrate = useCallback(() => {
    const line = commentaryNow()
    if (!line) {
      setNarrating(false)
      return
    }
    narrationUntil.current = performance.now() / 1000 + readingSeconds(line)
    setNarrating(true)
  }, [])

  useEffect(() => {
    let last = currentPhase().id
    // The phase on screen when the feed comes up gets its caption too.
    showLower(last)
    narrate()
    const tick = () => {
      const now = performance.now() / 1000
      const s = uiStore.get()
      const rate = s.paused ? 0 : WARP_LEVELS[s.warp].rate
      const started = radioTick(now, rate)
      if (started) setTx(started)
      else if (!radio.current) setTx((prev) => (prev ? null : prev))
      setSignal(radio.signal)

      const id = currentPhase().id
      if (id !== last) {
        last = id
        setPhase(id)
        showLower(id)
        narrate()
      }

      const clock = missionClock()
      if (clockMain.current) clockMain.current.textContent = clock.main
      if (clockSub.current) clockSub.current.textContent = clock.sub ?? ''

      // The narration reads the flight live, like the instruments' copy.
      if (narration.current) {
        const line = commentaryNow()
        if (line) narration.current.textContent = line
      }
      if (now > narrationUntil.current) setNarrating((v) => (v ? false : v))
    }
    tick()
    const h = setInterval(tick, 100)
    return () => {
      clearInterval(h)
      clearTimeout(lowerTimer.current)
    }
  }, [showLower, narrate])

  // The controls: shown by the pointer, hidden by its absence.
  useEffect(() => {
    const wake = () => {
      setChrome(true)
      clearTimeout(chromeTimer.current)
      chromeTimer.current = setTimeout(() => setChrome(false), CHROME_MS)
    }
    wake()
    window.addEventListener('pointermove', wake)
    window.addEventListener('pointerdown', wake)
    return () => {
      window.removeEventListener('pointermove', wake)
      window.removeEventListener('pointerdown', wake)
      clearTimeout(chromeTimer.current)
    }
  }, [])

  // `/` from the feed: out to the cockpit, where the search lives, and open it.
  useEffect(() => {
    const onKey = (e) => {
      if (e.target instanceof HTMLInputElement) return
      if (e.key === '/' || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k')) {
        e.preventDefault()
        searchFromFeed()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const source = cameraSource(focus, phase)
  const apollo = FEED.era === 'apollo'
  const showChrome = chrome || paused

  return (
    <div className="pointer-events-none fixed inset-0 z-10 select-none" style={{ animation: 'pz-fade 900ms ease both' }}>
      {/* The camera, top left: which one, and whether it was one at all. */}
      {source && (
        <div key={source.label} className="absolute top-4 left-4 max-w-[60vw] sm:top-6 sm:left-7" style={{ animation: 'pz-fade 600ms ease both' }}>
          {apollo ? (
            <div className="font-sans text-[11px] font-bold tracking-[0.14em] text-white uppercase [text-shadow:0_1px_2px_rgba(0,0,0,0.9),0_0_8px_rgba(0,0,0,0.6)] sm:text-[13px]">
              {source.label}
            </div>
          ) : (
            <div className="flex items-stretch bg-black/55 backdrop-blur-[2px]">
              <span className="w-1 bg-[#4f8dd6]" />
              <span className="px-2.5 py-1.5 font-sans text-[10px] font-semibold tracking-[0.12em] text-white uppercase sm:text-[11.5px]">
                {source.label}
              </span>
            </div>
          )}
        </div>
      )}

      {/* The clock, top right. */}
      <div className="absolute top-4 right-4 text-right sm:top-6 sm:right-7">
        <div
          ref={clockMain}
          className={`font-mono text-[15px] leading-none text-white tabular-nums sm:text-[19px] ${
            apollo ? '[text-shadow:0_1px_2px_rgba(0,0,0,0.9),0_0_8px_rgba(0,0,0,0.6)]' : ''
          }`}
        />
        <div ref={clockSub} className="mt-1 font-mono text-[10px] text-white/70 tabular-nums [text-shadow:0_1px_2px_rgba(0,0,0,0.9)] empty:hidden" />
        <div className="mt-1.5 flex items-center justify-end gap-2">
          <span className="font-sans text-[9.5px] font-semibold tracking-[0.28em] text-white/80 uppercase [text-shadow:0_1px_2px_rgba(0,0,0,0.9)]">
            {FEED.programme}
          </span>
          {apollo ? (
            <span className="border border-white/80 px-1.5 py-px font-sans text-[9px] font-bold tracking-[0.2em] text-white">LIVE</span>
          ) : (
            <span className="flex items-center gap-1 font-sans text-[9px] font-bold tracking-[0.2em] text-white">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#e5484d]" />
              LIVE
            </span>
          )}
        </div>
        {!signal && (
          <div className="mt-2 inline-block animate-pulse bg-[#b3261e]/85 px-2 py-0.5 font-sans text-[9.5px] font-bold tracking-[0.22em] text-white uppercase">
            Loss of signal
          </div>
        )}
      </div>

      {/* The lower third, when something has just happened. */}
      {lower && (
        <div
          key={lower.key}
          className={`absolute left-4 max-w-[min(34rem,calc(100vw-2rem))] transition-[bottom] duration-500 sm:left-7 ${
            showChrome ? 'bottom-[17rem]' : 'bottom-[11rem]'
          }`}
          style={{ animation: 'pz-lower 700ms cubic-bezier(.2,.7,.3,1) both' }}
        >
          {apollo ? (
            <div className="[text-shadow:0_1px_2px_rgba(0,0,0,0.9),0_0_10px_rgba(0,0,0,0.6)]">
              <div className="font-sans text-[20px] leading-tight font-bold tracking-[0.06em] text-white uppercase sm:text-[26px]">
                {lower.title}
              </div>
              {lower.detail && (
                <div className="mt-1 font-sans text-[11px] font-semibold tracking-[0.18em] text-white/85 uppercase sm:text-[12.5px]">
                  {lower.detail}
                </div>
              )}
            </div>
          ) : (
            <div className="flex items-stretch bg-black/60 backdrop-blur-[3px]">
              <span className="w-1.5 bg-[#4f8dd6]" />
              <div className="px-4 py-2.5">
                <div className="font-sans text-[16px] leading-tight font-semibold text-white sm:text-[20px]">{lower.title}</div>
                {lower.detail && <div className="mt-0.5 font-sans text-[11px] tracking-wide text-white/75">{lower.detail}</div>}
              </div>
            </div>
          )}
        </div>
      )}

      {/* The foot of the frame: the loop, the narration, and the controls. */}
      <div className="absolute inset-x-0 bottom-4 flex flex-col items-center gap-2 px-4">
        <div className="pointer-events-auto">
          <GoForLaunch />
        </div>

        {/* The loop: whoever is on the air, named as the transcripts name them. */}
        {captions && tx && (
          <div
            key={`tx-${tx.text}`}
            data-caption="radio"
            role="status"
            aria-live="polite"
            className="max-w-[min(40rem,calc(100vw-2rem))] bg-black/75 px-3.5 py-2 text-center"
            style={{ animation: 'pz-fade 250ms ease both' }}
          >
            <p className="font-sans text-[13px] leading-snug text-white sm:text-[14.5px]">
              <span
                className={`mr-2 font-mono text-[10px] tracking-[0.18em] uppercase ${
                  tx.who === 'ground' ? 'text-[#f2c572]' : tx.who === 'pao' ? 'text-white/55' : 'text-[#9fd0ff]'
                }`}
              >
                {tx.speaker}
                {tx.onboard && <span className="ml-1.5 text-white/40">· onboard recorder</span>}
              </span>
              {tx.text}
            </p>
          </div>
        )}

        {/* The narration: its own caption, under the loop, so the two never
            take turns in one box and flicker between each other. */}
        {captions && narrating && (
          <div
            data-caption="narration"
            className="max-w-[min(36rem,calc(100vw-2rem))] bg-black/55 px-3.5 py-1.5 text-center"
            style={{ animation: 'pz-fade 600ms ease both' }}
          >
            <p
              ref={(el) => {
                // Filled on mount, not on the next tick: a caption box with
                // nothing in it for a tenth of a second is a flash.
                narration.current = el
                if (el) el.textContent = commentaryNow() ?? ''
              }}
              className="font-sans text-[11.5px] leading-relaxed text-white/80 sm:text-[12.5px]"
            />
          </div>
        )}

        {/* Folded away, not just faded, so the captions sit at the foot of the
            frame while nobody is reaching for the controls — and rise over
            them when somebody is, as a player's subtitles do. */}
        <div
          className={`flex flex-col items-center gap-1.5 overflow-hidden transition-[opacity,max-height] duration-500 ${
            showChrome ? 'pointer-events-auto max-h-40 opacity-100' : 'pointer-events-none max-h-0 opacity-0'
          }`}
        >
          {/* Neither row may shrink: folding the container to nothing would
              otherwise squash both into the same line on the way down. */}
          <div className="shrink-0">
            <TimeControls />
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button
              onClick={searchFromFeed}
              className="control min-h-9 px-3 py-2 font-mono text-[9px] tracking-[0.2em] text-hud/60 uppercase outline-none transition-colors hover:text-ember focus-visible:text-ember lg:min-h-0 lg:py-1.5"
            >
              search · /
            </button>
            <span className="h-3 w-px bg-hud/20" />
            <button
              onClick={() => setUi({ broadcast: false })}
              className="control min-h-9 px-3 py-2 font-mono text-[9px] tracking-[0.2em] text-hud/60 uppercase outline-none transition-colors hover:text-ember focus-visible:text-ember lg:min-h-0 lg:py-1.5"
            >
              instruments · b
            </button>
            <span className="h-3 w-px bg-hud/20" />
            <button
              onClick={() => setUi((s) => ({ captions: !s.captions }))}
              aria-pressed={captions}
              className="control min-h-9 px-3 py-2 font-mono text-[9px] tracking-[0.2em] text-hud/60 uppercase outline-none transition-colors hover:text-ember focus-visible:text-ember lg:min-h-0 lg:py-1.5"
            >
              captions {captions ? 'on' : 'off'}
            </button>
          </div>
        </div>
      </div>

      {/* The station's bug, where a broadcast keeps it — on a screen wide
          enough that the captions do not reach the corner it sits in. */}
      <Mark size={18} className="absolute right-4 bottom-4 hidden opacity-40 sm:right-7 sm:block" />
    </div>
  )
}
