import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { QUALITY } from '../sim/device.js'
import { useUi } from '../sim/store.js'

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
 */

/** Frames sampled before each decision, and the shorter window used until the first one. */
const WINDOW = 90
const FIRST_WINDOW = 24
/**
 * Slower than this on average and the machine is missing frames; faster and it
 * has room.
 *
 * These sit either side of one refresh rather than around some frame rate to
 * aim at, because the signal is `requestAnimationFrame` and that is quantised
 * to the display: a machine that misses every other frame reports 33 ms, never
 * 20. A threshold between the two steps quantities that do not exist, and the
 * first pair tried — 26 and 18.5 — sat inside the gap and parked a Retina Mac
 * at thirty frames a second when it could hold sixty two steps lower down.
 */
const SLOW_MS = 21
const FAST_MS = 17.2
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

export function Resolution() {
  const setDpr = useThree((s) => s.setDpr)
  const dpr = useThree((s) => s.viewport.dpr)
  const full = useUi((s) => s.fullRes)
  // A photograph raises the ratio on purpose; judging the machine on those
  // frames would read a deliberate expense as a machine in trouble.
  const photo = useUi((s) => s.photo)
  const s = useRef({ n: 0, sum: 0, last: 0, settle: 0, window: FIRST_WINDOW, ceiling: Infinity, hold: 0, panic: 0 })

  // Pinned by hand: give the machine the whole range and stop judging it.
  useEffect(() => {
    if (!full) return
    s.current.ceiling = Infinity
    s.current.hold = 0
    setDpr(QUALITY.dpr[1])
  }, [full, setDpr])

  useFrame(() => {
    const c = s.current
    const now = performance.now()
    const dt = c.last ? now - c.last : 0
    c.last = now
    if (full || photo) {
      c.last = 0
      return
    }
    // Ignore the frames either side of a change: the first of them pays for
    // reallocating every render target, which is not the new steady state.
    if (c.settle > 0) {
      c.settle--
      return
    }
    if (dt <= 0 || dt > STALL_MS) return

    const [tierMin, max] = QUALITY.dpr
    const min = Math.min(tierMin, FLOOR)
    const down = () => {
      c.ceiling = Math.max(min, dpr - STEP)
      c.hold = Math.min(HOLD_MAX, Math.max(HOLD, c.hold * 2))
      c.settle = 3
      c.n = 0
      c.sum = 0
      c.panic = 0
      setDpr(c.ceiling)
    }

    // A machine in real trouble should not have to wait out a whole window of
    // two-frames-a-second to be rescued.
    if (dt > PANIC_MS) {
      if (++c.panic >= 3 && dpr > min) {
        down()
        return
      }
    } else {
      c.panic = 0
    }

    c.sum += dt
    c.n++
    if (c.n < c.window) return
    const mean = c.sum / c.n
    c.sum = 0
    c.n = 0
    c.window = WINDOW

    if (mean > SLOW_MS) {
      if (dpr > min) down()
    } else if (mean < FAST_MS) {
      if (dpr < Math.min(max, c.ceiling)) {
        c.settle = 3
        setDpr(Math.min(max, c.ceiling, dpr + STEP))
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
