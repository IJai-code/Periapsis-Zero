import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { QUALITY } from '../sim/device.js'
import { setUi, useUi } from '../sim/store.js'
import { maxRatio } from '../gfx/renderBudget.js'
import {
  MAX_DETAIL_STEP,
  detailStep as detailCap,
  nextDetailStep,
  setDetailStep,
} from '../gfx/detailBudget.js'
import { FAST_MS, SLOW_MS, pushFrameTime, resetFrameTimes } from '../gfx/frameStats.js'
import { setShadowRelief, shadowRelief } from '../gfx/groundBudget.js'

/**
 * As many pixels as the machine can actually draw.
 *
 * The scene is fragment-bound on the ground: measured at Kennedy's pad on an
 * Apple M4, a frame costs 55 ms at one device pixel per CSS pixel and 127 ms at
 * two. That second figure is not an exotic case — it is every Retina Mac and
 * every Windows laptop at 200% scaling, which ask for a buffer four times the
 * area and got one, because `device.js` offers `dpr: [1, 2]` and nothing was
 * ever choosing within it. A machine a few times slower than this one lands at
 * two or three frames a second, which is where a visitor reported being unable
 * to click the buttons.
 *
 * So something has to choose, and the only honest judge is the frame itself.
 * This watches how long frames actually take and moves the ratio within the
 * tier's range: down when the machine is missing frames, back up when it has
 * room again — a view from orbit costs a fraction of a view from the grass, and
 * the ratio should follow. A machine with the headroom sits at the top of its
 * range and never sees any of this happen.
 *
 * What it does *not* do is take anything out of the scene. Every plant, every
 * building, every octave of surface noise and every animation is drawn either
 * way; this is the resolution they are drawn at, and nothing else. *Full
 * resolution* under Display pins it to the top of the range for anyone who
 * would rather have the pixels than the frames.
 *
 * Below the pixel floor the levers continue in `gfx/detailBudget.js` —
 * tessellation, the geometry behind the pixels — and one rung further in
 * `gfx/groundBudget.js`: the ground beam's shadow map, the last always-on
 * cost the ladder could not reach. Each lever is spent only when the one
 * before it is spent, and each refunds itself out of comfort the same way.
 */

/** Frames sampled before each decision, and the shorter window used until the first one. */
const WINDOW = 120
const FIRST_WINDOW = 24
/**
 * Two consecutive windows on the same side of a threshold before any comfort-
 * path move. One window of evidence moved the ratio every two seconds at the
 * band's edge, and a machine hovering near 19 ms spent its day stepping down
 * and back — each step reallocating every render target, each reallocation a
 * visible hitch, and the hitches were what a visitor reported as tweaking.
 * Two windows is four seconds of sustained signal before the picture changes,
 * which is the difference between an instrument and a metronome.
 */
const CONFIRM = 2
/**
 * Frames ignored after any lever move: the first of them pays for
 * reallocating every render target, which is not the new steady state, and
 * judging the machine on its own reallocation is how one step became three.
 * A third of a second — the scene settles, the targets refill, and only then
 * does the measuring resume.
 */
const SETTLE = 24
/*
 * Slower than SLOW_MS on average and the machine is missing frames; faster
 * than FAST_MS and it has room. Both come from `gfx/frameStats.js`, beside
 * the ring they are read against — the sky's progressive march and the detail
 * budget ask the same question of the same numbers.
 */
/** Three frames this slow is not a hiccup, and waiting out a window of them helps nobody. */
const PANIC_MS = 60
/** A frame longer than this was a texture upload or a shader compile, not the steady state. */
const STALL_MS = 250
/** The ratio moves in the steps the tiers are written in. */
const STEP = 0.25
/**
 * How far below one device pixel per CSS pixel this will go, and only for a
 * machine that is still missing frames at one. A tier's floor is 1 because
 * that is the sharp picture; this is lower because a machine that cannot draw
 * the sharp picture at all is better served by a slightly soft one at thirty
 * frames than a perfect one at three. The scene is untouched either way — the
 * same plants, the same buildings, the same noise — and *Full resolution*
 * under Display switches the whole arrangement off.
 */
const FLOOR = 0.6
/** Windows to wait before trying a ratio that has already proved too dear — then twice that. */
const HOLD = 5
const HOLD_MAX = 40

const LOSS_KEY = 'pz-gpu-losses'

/** How many contexts this session has already lost, for the escalation below. */
function lossesSoFar() {
  try {
    return Number(sessionStorage.getItem(LOSS_KEY) ?? 0)
  } catch {
    return 0
  }
}

export function Resolution() {
  const gl = useThree((s) => s.gl)
  const setDpr = useThree((s) => s.setDpr)
  useEffect(() => {
    /*
     * A lost context is not an error state to wall off; it is the driver
     * asking for less. The browser restores it on its own in almost every
     * case — the dialog exists for the seconds in between — and what the
     * recovery does with the chance decides whether there is a next one.
     *
     * So restoration spends the governor's own levers: the pixel ceiling
     * drops a step and the machine re-measures from there, exactly as if the
     * frames had gone slow, and a second loss in one session drops further
     * and sheds the shadow map. Random-looking losses across platforms are
     * near always memory pressure; the response that works is the one this
     * component already knows how to make.
     */
    const lost = (e) => {
      e.preventDefault()
      try {
        sessionStorage.setItem(LOSS_KEY, String(lossesSoFar() + 1))
      } catch {
        /* private mode; the escalation just stays local */
      }
      setUi({ graphicsLost: true })
    }
    const restored = () => {
      const losses = lossesSoFar()
      if (losses >= 2) {
        // Twice in one session is a pattern, not an accident. Give back the
        // dearest things first — the shadow pass, then a third of the pixels —
        // and let the comfort refund earn them back only if the machine is
        // genuinely fine.
        setShadowRelief(true)
        setDpr(Math.max(QUALITY.dpr[0], (window.devicePixelRatio || 1) * 0.66))
      } else {
        setDpr(Math.max(QUALITY.dpr[0], (window.devicePixelRatio || 1) - 0.25))
      }
      setUi({ graphicsLost: false })
    }
    gl.domElement.addEventListener('webglcontextlost', lost)
    gl.domElement.addEventListener('webglcontextrestored', restored)
    return () => {
      gl.domElement.removeEventListener('webglcontextlost', lost)
      gl.domElement.removeEventListener('webglcontextrestored', restored)
    }
  }, [gl, setDpr])

  useEffect(() => {
    const visibility = () => {
      s.current.last = 0
      s.current.n = 0
      s.current.sum = 0
      // The ring, too: a sleeping tab's gap is not a slow frame, and the
      // summary should describe the machine *now*.
      resetFrameTimes()
    }
    document.addEventListener('visibilitychange', visibility)
    visibility()
    return () => document.removeEventListener('visibilitychange', visibility)
  }, [])
  const dpr = useThree((s) => s.viewport.dpr)
  const size = useThree((s) => s.size)
  /*
   * The ceiling is the panel's own ratio, bounded only by what the hardware
   * can allocate.
   *
   * It used to be bounded by the opening frame's four-megapixel budget as
   * well, which made that budget a permanent cap: measured, a 16-inch
   * MacBook Pro was held to 52% of its pixels, a 4K monitor to 48%, and a 5K
   * iMac to **27%** — on machines that draw every one of them at sixty frames
   * a second. The budget exists so the *first* frame is safe before anything
   * has been measured (see App.jsx), and this loop is the thing that measures.
   * Letting a guess outrank the measurement is how a fast machine ends up
   * looking soft forever, which is what a visitor reported as lost detail.
   */
  const maxDpr = maxRatio(size.width, size.height, Math.min(window.devicePixelRatio || 1, QUALITY.dpr[1]))
  const full = useUi((s) => s.fullRes)
  // A photograph raises the ratio on purpose; judging the machine on those
  // frames would read a deliberate expense as a machine in trouble.
  const photo = useUi((s) => s.photo)
  const s = useRef({ n: 0, sum: 0, last: 0, settle: 0, window: FIRST_WINDOW, ceiling: Infinity, hold: 0, panic: 0, over: 0, under: 0 })

  // Pinned by hand: give the machine the whole range and stop judging it.
  // The pilot has taken the dial, so any distress cap the governor had spent
  // is refunded — it is the governor's lever, not a setting.
  useEffect(() => {
    if (!full) return
    s.current.ceiling = Infinity
    s.current.hold = 0
    setDetailStep(0)
    setShadowRelief(false)
    setDpr(maxDpr)
  }, [full, maxDpr, setDpr])

  useEffect(() => {
    if (!photo && dpr > maxDpr) setDpr(maxDpr)
  }, [dpr, maxDpr, photo, setDpr])

  useFrame(() => {
    const c = s.current
    const now = performance.now()
    const dt = c.last ? now - c.last : 0
    c.last = now
    if (document.hidden || full || photo) {
      c.last = 0
      return
    }
    // The shared sample. One ring, fed from the delta this effect already
    // computed — Diagnostics reads its p50/p95 from here instead of running
    // its own rAF loop beside the render loop.
    if (dt > 0) pushFrameTime(dt)
    // Ignore the frames either side of a change: the first of them pays for
    // reallocating every render target, which is not the new steady state.
    if (c.settle > 0) {
      c.settle--
      return
    }
    if (dt <= 0) return

    const tierMin = QUALITY.dpr[0]
    const max = maxDpr
    const min = Math.min(tierMin, FLOOR, max)
    const down = () => {
      c.ceiling = Math.max(min, dpr - STEP)
      c.hold = Math.min(HOLD_MAX, Math.max(HOLD, c.hold * 2))
      c.settle = SETTLE
      c.n = 0
      c.sum = 0
      c.panic = 0
      c.over = 0
      c.under = 0
      setDpr(c.ceiling)
    }

    // A machine in real trouble should not have to wait out a whole window of
    // two-frames-a-second to be rescued.
    if (dt > PANIC_MS) {
      if (++c.panic >= 3) {
        c.panic = 0
        if (dpr > min) {
          down()
          return
        }
        // Already at the pixel floor: the next lever is tessellation, spent
        // immediately rather than after another window of two frames a second.
        if (detailCap() < MAX_DETAIL_STEP) {
          setDetailStep(detailCap() + 1)
          c.settle = SETTLE
          c.n = 0
          c.sum = 0
          return
        }
        // At the bottom of tessellation: the shadow map is the last lever,
        // and it is a boolean — spent once, refunded only out of comfort.
        if (!shadowRelief()) {
          setShadowRelief(true)
          c.settle = SETTLE
          c.n = 0
          c.sum = 0
        }
      }
    } else {
      c.panic = 0
    }

    // Long frames still trigger panic above; cap only their statistical weight.
    c.sum += Math.min(dt, STALL_MS)
    c.n++
    if (c.n < c.window) return
    const mean = c.sum / c.n
    c.sum = 0
    c.n = 0
    c.window = WINDOW

    if (mean > SLOW_MS) {
      /*
       * One slow window is weather; two in a row is climate. The confirmation
       * costs four seconds on a struggling machine — the panic path above
       * still answers instantly — and it is what stops the ratio from
       * sawing at the threshold.
       */
      c.under = 0
      if (++c.over < CONFIRM) return
      c.over = 0
      if (dpr > min) {
        down()
      } else {
        /*
         * Pixels are spent. The last lever is tessellation — one rung a
         * window, each decision followed by its measurement, and a rung is
         * sub-pixel silhouette error by the ladder's own construction. The
         * ceiling is recorded so the refund knows what it is refunding to.
         */
        const next = nextDetailStep(detailCap(), mean, {
          atFloor: true,
          atCeiling: false,
          slowMs: SLOW_MS,
          fastMs: FAST_MS,
        })
        if (next !== detailCap()) {
          setDetailStep(next)
          c.settle = SETTLE
          c.n = 0
          c.sum = 0
        }
      }
    } else if (mean < FAST_MS) {
      c.over = 0
      if (++c.under < CONFIRM) return
      c.under = 0
      if (dpr < Math.min(max, c.ceiling) && c.hold > 0) {
        /*
         * The pixels are being paid back out of a debt the last down-step
         * left — hold windows of it — and the climb is not due until the
         * debt is cleared. The coarser refunds below still run while the
         * hold decays: they are refunds, and a machine that has proved
         * comfortable twice gets its shadow map back without further ado.
         */
        c.hold--
      } else if (dpr < Math.min(max, c.ceiling)) {
        c.settle = SETTLE
        setDpr(Math.min(max, c.ceiling, dpr + STEP))
        // Re-arm the hold: an up-step is the same act a down-step is, and it
        // waits the same way before doing it again. This is the anti-
        // oscillation clause — without it a machine at the band's edge steps
        // up this window and down the next, forever.
        c.hold = HOLD
      } else if (shadowRelief()) {
        /*
         * The shadow rung is refunded first, and for the same reason it is
         * spent last: it is the coarsest lever. The tessellation cap above it
         * stays until the machine has room for the pixels *and* the geometry.
         * Refunds are paid only out of comfort — a machine that stabilised at
         * the floor keeps its spend until it genuinely has room, so no lever
         * oscillates against itself.
         */
        setShadowRelief(false)
        c.settle = SETTLE
      } else if (detailCap() > 0) {
        /*
         * Back at the pixel ceiling and comfortable: refund one rung. The
         * refund is paid only out of comfort — a machine that stabilised at
         * the floor keeps its cap until it genuinely has room, so the lever
         * never oscillates against itself.
         */
        const next = nextDetailStep(detailCap(), mean, {
          atFloor: false,
          atCeiling: true,
          slowMs: SLOW_MS,
          fastMs: FAST_MS,
        })
        setDetailStep(next)
        c.settle = SETTLE
      } else if (c.hold > 0) {
        c.hold--
      } else if (c.ceiling < max) {
        // It has been comfortable for a long time — the scene may simply have
        // got cheaper. Let it try for one more step next time round.
        c.ceiling = Math.min(max, c.ceiling + STEP)
      }
    }
  })

  return null
}
