import { CATALOG } from './catalog.js'

/**
 * A link to what you are looking at.
 *
 * The search will take you to two hundred-odd places, from the flame trench to
 * the edge of the observable universe, and until now the only way to tell
 * someone about one of them was to describe the route. An address that opens
 * looking at Sagittarius A* is the difference between "search for the black
 * hole and wait for the flight" and a link somebody clicks.
 *
 * What it carries is deliberately small: the flight already in the address —
 * preset, vessel, pad — and one more parameter for where the camera is looking.
 * It does not carry the mission clock. That would be a promise this cannot
 * keep: the state of a flight is the output of an integration from the start,
 * so an arbitrary instant cannot be restored by writing a number in a URL, and
 * a link that silently landed somewhere else would be worse than one that is
 * honest about starting the flight where the preset starts it.
 *
 * An unknown name is not fatal. A link is something a person was sent or typed,
 * and the same rule `sim/requested.js` sets out applies: a warning and the
 * default beats a blank page.
 */

const PARAM = 'focus'

/** The name in the address, if it is one this build actually knows. */
export function requestedFocus() {
  if (typeof window === 'undefined' || !window.location) return null
  const id = new URLSearchParams(window.location.search).get(PARAM)
  if (!id) return null
  const entry = CATALOG.find((e) => e.focus === id && !e.href)
  if (!entry) {
    console.warn(`[periapsis] unknown place "${id}" in the address; staying where the flight starts`)
    return null
  }
  return entry.focus
}

/** The address for what the camera is on now, absolute so it can be pasted anywhere. */
export function viewHref(focus) {
  if (typeof window === 'undefined') return ''
  const url = new URL(window.location.href)
  if (focus) url.searchParams.set(PARAM, focus)
  else url.searchParams.delete(PARAM)
  // The flight lives behind the hash, and a link to a view is a link to a flight.
  if (!url.hash) url.hash = '#flight'
  return url.toString()
}

/** What the link is a link to, for the line that confirms it was copied. */
export function viewName(focus) {
  const entry = CATALOG.find((e) => e.focus === focus && !e.href)
  return entry?.name ?? null
}
