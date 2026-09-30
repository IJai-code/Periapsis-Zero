/** Bound fill rate and transient GPU/encoder memory, not scene content. */
export const FRAME_PIXELS = 4_000_000
export const PHOTO_PIXELS = 8_294_400
export const FILM_PIXELS = 1280 * 720
export const FILM_FPS = 24
export const FILM_MAX_BYTES = 24 * 1024 * 1024

export function boundedRatio(width, height, wanted, pixels = FRAME_PIXELS, maxEdge = 8192) {
  const w = Math.max(1, width)
  const h = Math.max(1, height)
  return Math.min(wanted, Math.sqrt(pixels / (w * h)), maxEdge / Math.max(w, h))
}

export function filmSize(width, height) {
  const scale = boundedRatio(width, height, 1, FILM_PIXELS, 1280)
  return {
    width: Math.max(2, Math.floor(width * scale) & ~1),
    height: Math.max(2, Math.floor(height * scale) & ~1),
  }
}
