/**
 * A pilot profile, and why it is not an account.
 *
 * Every flight simulator that asks for a login before you can fly has made the
 * same trade: the person who wants to look around has to hand over an email
 * address first, and most of them leave. This does the opposite. The profile is
 * a name and a callsign stored in this browser, and the game is fully playable
 * before it exists, during it, and if it never exists at all. There is no
 * server, so there is nothing to sign into, nothing to leak, and nothing to
 * forget. If storage is unavailable the profile simply does not persist and the
 * rest of the app carries on.
 *
 * The name is not decoration: it is what the logbook is signed with and what
 * the debrief reads back to you. A survey record that says "flown by" is worth
 * something precisely because nobody was asked for a password.
 *
 * Everything is validated on read the same way the expedition records are. A
 * hand-edited or corrupt value falls back to a blank profile rather than
 * throwing inside a render.
 */

const KEY = 'pz-pilot-v1'
const MAX_NAME = 24

/** Trim, collapse whitespace, and cut at the length the badge can show. */
const clean = (value) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME) : '')

/** A blank profile, used for the default and as the fallback for anything invalid. */
export const blankProfile = () => ({ version: 1, name: '', callsign: '', created: '' })

/**
 * Validate anything into a well-formed profile. Unknown shapes, wrong versions
 * and out-of-range strings all become blank rather than exceptions.
 */
export function validateProfile(value) {
  if (!value || typeof value !== 'object' || value.version !== 1) return blankProfile()
  const name = clean(value.name)
  const callsign = clean(value.callsign).toUpperCase()
  const created = typeof value.created === 'string' && Number.isFinite(Date.parse(value.created)) ? value.created : ''
  return { version: 1, name, callsign, created }
}

let profile = blankProfile()
try {
  profile = validateProfile(JSON.parse(globalThis.localStorage?.getItem(KEY) ?? 'null'))
} catch {
  profile = blankProfile()
}
if (!profile.created && (profile.name || profile.callsign)) profile.created = new Date().toISOString()

const listeners = new Set()
export const pilotProfile = () => profile
export const subscribePilot = (fn) => { listeners.add(fn); return () => listeners.delete(fn) }

/**
 * True when the pilot has put a name to it. Used only to decide whether the
 * interface addresses someone by name, never whether it lets them play.
 */
export const hasProfile = () => Boolean(profile.name)

/** Write a new profile. Both fields are optional; an empty pair clears it. */
export function saveProfile(next) {
  const validated = validateProfile({ version: 1, ...next, created: profile.created || new Date().toISOString() })
  const cleared = !validated.name && !validated.callsign
  profile = cleared ? blankProfile() : validated
  try {
    if (cleared) globalThis.localStorage?.removeItem(KEY)
    else globalThis.localStorage?.setItem(KEY, JSON.stringify(profile))
  } catch {
    /* Storage refused: the profile stays in memory for this session only. */
  }
  listeners.forEach((fn) => fn())
  return profile
}

/**
 * The line the interface signs with: the callsign if there is one, otherwise
 * the name, otherwise null so the caller falls back to its own default wording.
 */
export function pilotLabel() {
  if (profile.callsign) return profile.callsign
  if (profile.name) return profile.name
  return null
}