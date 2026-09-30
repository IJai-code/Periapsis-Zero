import { useEffect, useRef } from 'react'
import { addAfterEffect, useFrame, useThree } from '@react-three/fiber'
import { captureFilmFrame } from '../gfx/filmRecorder.js'
import { boundedRatio, PHOTO_PIXELS } from '../gfx/renderBudget.js'
import { setUi, useUi } from '../sim/store.js'
import { captionPhotograph } from '../gfx/photoCaption.js'

/**
 * A plate of what is on screen, at the size a plate should be.
 *
 * Everything in here is drawn at true scale from measured tables, and the one
 * thing a person can do with that is show someone. A browser screenshot gets
 * them the window, at the window's resolution, with the instruments printed
 * over the picture. This gets them the picture: the panels out of the way, the
 * frame re-rendered at four to eight times the pixels, and a caption saying
 * what they are looking at and when.
 *
 * Three things have to be true at the moment of capture, and each is why a step
 * exists:
 *
 *   The drawing buffer is not preserved, because preserving it costs memory on
 *   every frame of a simulator that has other uses for it. So the read has to
 *   happen inside the same task as the render, which is what the priority here
 *   buys: r3f runs frame subscribers in priority order and the composer renders
 *   at 1, so 2 is after it and still inside the frame.
 *
 *   The sky is progressive. The Milky Way is marched into a cube one tile at a
 *   time and the volume layer refines in strips when the camera stops, so a
 *   frame grabbed the instant the resolution changes is a frame of half-drawn
 *   sky. It waits for the tiles to settle.
 *
 *   `Resolution` is watching the frame rate and would read a deliberately
 *   expensive frame as a machine in trouble and start giving away pixels. It
 *   stands down while this runs.
 */

/** The long edge to aim for. Four times a 1080p window, and a real print size. */
const TARGET_LONG_EDGE = 3840
/** Frames to let the sky finish after the resolution changes. */
const SETTLE_FRAMES = 40

/** The ratio that gets closest to the target without asking for more than the GPU has. */
function captureRatio(gl, width, height) {
  const longEdge = Math.max(width, height)
  const wanted = TARGET_LONG_EDGE / longEdge
  // A render target may not exceed the driver's limit, and the composer keeps
  // several the size of the canvas, so half the limit is the honest ceiling.
  const byDriver = (gl.capabilities.maxTextureSize * 0.5) / longEdge
  // Never below what is already on screen: a photograph may not be worse than
  // the view it was taken of.
  return boundedRatio(width, height, Math.max(gl.getPixelRatio(), Math.min(wanted, byDriver, 8)), PHOTO_PIXELS, gl.capabilities.maxTextureSize * 0.5)
}

export function Photograph() {
  const gl = useThree((s) => s.gl)
  const size = useThree((s) => s.size)
  const setDpr = useThree((s) => s.setDpr)
  const stage = useUi((s) => s.photo)
  const held = useRef({ dpr: null, waited: 0 })

  // Arming: put the pixels up, and let the sky catch up before the shutter.
  useEffect(() => {
    if (stage !== 'arming') return
    held.current.dpr = gl.getPixelRatio()
    held.current.waited = 0
    setDpr(captureRatio(gl, size.width, size.height))
  }, [stage, gl, size.width, size.height, setDpr])

  // After-effects do not take render-loop ownership. A positive useFrame
  // priority would stop R3F's default render when bloom is switched off.
  useEffect(() => addAfterEffect(() => {
    captureFilmFrame()
    const h = held.current
    if (stage !== 'capture') return
    let url = null
    try { url = gl.domElement.toDataURL('image/png') } catch (err) {
      console.error('[periapsis] the photograph could not be read back', err)
    }
    if (h.dpr != null) setDpr(h.dpr)
    h.dpr = null
    setUi({ photo: null })
    if (url) captionPhotograph(url)
  }), [stage, gl, setDpr])

  useFrame(() => {
    const h = held.current
    if (stage === 'arming') {
      if (++h.waited < SETTLE_FRAMES) return
      setUi({ photo: 'capture' })
      return
    }
  })

  return null
}

/** Ask for a photograph. The panels get out of the way on their own. */
export function takePhotograph() {
  setUi((s) => (s.photo ? {} : { photo: 'arming' }))
}
