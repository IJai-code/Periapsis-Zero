/**
 * Budgets that bound transient GPU and encoder memory, never scene content.
 */

/**
 * The *opening* frame's pixel budget — a first guess, never a ceiling.
 *
 * Nothing has been measured when the canvas is created, so the first frame is
 * drawn inside a budget rather than at whatever ratio the panel asks for: a
 * 5K iMac would otherwise open by asking for 14.7 megapixels of atmosphere
 * shader before anyone knows whether the machine can draw one.
 *
 * It is emphatically not what the machine is held to. Used as a ceiling — as
 * it was — it costs a 16-inch MacBook Pro 48% of its pixels, a 4K monitor 52%
 * of its, and a 5K iMac **73%** of its, permanently, on hardware that can draw
 * every one of them. `components/Resolution.jsx` measures real frames and is
 * the only thing entitled to say what a machine can afford; this is where it
 * starts from, and `maxRatio` below is where it may climb to.
 */
export const FRAME_PIXELS = 4_000_000
export const PHOTO_PIXELS = 8_294_400

/**
 * The film: what a recording of a flight is actually worth keeping at.
 *
 * It was 720p at 24 frames and 3.5 Mbit — a quarter of the area of the
 * picture it was recorded from, at a bit rate a sky full of stars eats in a
 * frame, and it looked it. Every number here is measured rather than picked:
 *
 *   **Area.** 1080p, because that is where the composite stops being free.
 *   Timed in the page against the live canvas, one composited frame costs
 *   0.5 ms at 720p, **2.6 ms at 1080p** and 10.1 ms at 2160p. The first two
 *   fit inside a 30 fps film's half-frame budget; the third does not, and a
 *   film is not worth a frame of the flight it is recording. `filmSize` never
 *   scales *up* either — a film is bounded by the drawing buffer it is copied
 *   from, because there are no pixels there that were not drawn.
 *
 *   **Rate.** 30 frames, not 24. The intro is one continuous camera move
 *   across fourteen decades, which is the exact content judder is visible in.
 *
 *   **Bit rate.** 16 Mbit is a *ceiling*, not a target: measured on a calm
 *   two-second capture the encoder spent 0.1 Mbit of it. H.264 spends bits on
 *   motion, and the frames that need them are the ones crossing a star field.
 *
 *   **Size.** A 45-second flight at the ceiling is 90 MB, so the cap is well
 *   clear of it — and reaching the cap now *keeps* the film that fits instead
 *   of discarding the whole recording, which is what it used to do.
 */
export const FILM_PIXELS = 1920 * 1080
export const FILM_EDGE = 1920
export const FILM_FPS = 30
export const FILM_BITRATE = 16_000_000
export const FILM_MAX_BYTES = 256 * 1024 * 1024

/**
 * How dear a composited film frame may be before the recorder steps down,
 * and how many rungs it may step.
 *
 * A 30 fps film riding a 60 Hz loop composites every other frame, so its
 * amortised cost per rendered frame is half of this. Four milliseconds is
 * therefore two milliseconds a frame — about an eighth of a 60 Hz budget, and
 * the most a recording should ever take from the flight it is recording.
 *
 * Measured on an M4 against the live canvas, a composite costs 0.5 ms at
 * 720p, 2.6 ms at 1080p and 10.1 ms at 2160p. `FILM_EDGE` already keeps the
 * film at 1080p, so this valve does not fire on a healthy machine at all —
 * it fires on the machine where even 1080p is dear, which is the machine the
 * ladder exists for.
 */
export const FILM_FRAME_MS = 4
export const FILM_STEPS = 3

export function boundedRatio(width, height, wanted, pixels = FRAME_PIXELS, maxEdge = 8192) {
  const w = Math.max(1, width)
  const h = Math.max(1, height)
  return Math.min(wanted, Math.sqrt(pixels / (w * h)), maxEdge / Math.max(w, h))
}

/**
 * The highest ratio the hardware can actually be asked for.
 *
 * Bounded by one thing only: a drawing buffer's edge, which is a real limit —
 * past `GL_MAX_TEXTURE_SIZE` the context refuses the allocation and the tab
 * goes black. Fill rate is not bounded here, because fill rate is what the
 * governor measures; a machine with the headroom gets its pixels.
 */
export function maxRatio(width, height, wanted, maxEdge = 8192) {
  const w = Math.max(1, width)
  const h = Math.max(1, height)
  return Math.min(wanted, maxEdge / Math.max(w, h))
}

/**
 * The film's frame, at distress step `step`.
 *
 * Step 0 is the full budget; each further step halves the area, which is one
 * rung of the same ladder the resolution governor walks — 1080p, then 760p,
 * then 540p, all at the drawing buffer's own aspect. Dimensions are forced
 * even because every video encoder here wants chroma-subsamplable ones.
 */
export function filmSize(width, height, step = 0) {
  // The budget first, then the step. Dividing the *budget* would make a step
  // a no-op on any window already inside it — a 1024x768 pane never reaches
  // 1080p, so halving 1080p leaves it exactly where it was, and the step-down
  // the recorder is asking for would not happen on the small windows most
  // likely to need it. Halving the area it actually got always moves.
  const scale = boundedRatio(width, height, 1, FILM_PIXELS, FILM_EDGE) / Math.pow(Math.SQRT2, Math.max(0, step))
  return {
    width: Math.max(2, Math.floor(width * scale) & ~1),
    height: Math.max(2, Math.floor(height * scale) & ~1),
  }
}
