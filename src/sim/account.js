/**
 * Sign in to keep progress: the same surveys, story and logbook on any device.
 *
 * The site is static (GitHub Pages), so accounts live in a Supabase project:
 * its Auth for sign-in (an emailed link, or Google or GitHub when the project
 * enables them) and one table, `progress`, a row per player holding their
 * saved progress as JSON. Row-level security lets a player read and write
 * only their own row (docs/accounts.md has the table and policies).
 *
 * No client library: four documented HTTP endpoints (GoTrue's /otp,
 * /authorize, /token and /logout, PostgREST's /rest/v1/progress) are about a
 * hundred lines, against a dependency several times the size of this module.
 *
 * Nothing changes for anyone who does not sign in, and nothing here runs
 * unless the build was given a project: VITE_SUPABASE_URL and
 * VITE_SUPABASE_PUBLISHABLE_KEY (the publishable key is meant to be public;
 * the table's policies are what protect the data).
 *
 * Progress only grows. Signing in on a second device merges the two records:
 * a survey finished on either counts, the better landing is kept, every
 * logbook milestone either device reached is kept. Nothing is ever lost by
 * signing in, which is the one thing a player must be able to trust.
 */

const URL_ = (import.meta.env?.VITE_SUPABASE_URL ?? '').replace(/\/$/, '')
const KEY = import.meta.env?.VITE_SUPABASE_PUBLISHABLE_KEY ?? ''
export const accountsEnabled = Boolean(URL_ && KEY)

/** The browser-stored records an account carries. Device settings stay local. */
export const SYNCED = ['pz-expeditions-v1', 'pz-story', 'periapsis.logbook.v1', 'pz-pilot-v1']
const SESSION_KEY = 'pz-account-v1'
const PUSHED_KEY = 'pz-account-pushed'

const store = {
  get: (k) => { try { return localStorage.getItem(k) } catch { return null } },
  set: (k, v) => { try { localStorage.setItem(k, v) } catch { /* private mode: in memory only */ } },
  del: (k) => { try { localStorage.removeItem(k) } catch { /* nothing to remove */ } },
}

/* ------------------------------------------------------------------ *
 * State the interface reads
 * ------------------------------------------------------------------ */

let state = { session: readSession(), status: 'idle', message: '', providers: [] }
const listeners = new Set()
export const accountState = () => state
export function subscribeAccount(fn) { listeners.add(fn); return () => listeners.delete(fn) }
function set(patch) { state = { ...state, ...patch }; listeners.forEach((fn) => fn()) }

function readSession() {
  try { return JSON.parse(store.get(SESSION_KEY) ?? 'null') } catch { return null }
}
function writeSession(session) {
  if (session) store.set(SESSION_KEY, JSON.stringify(session))
  else store.del(SESSION_KEY)
  set({ session })
}

/** The user id and email inside an access token (a JWT), without a round trip. */
function claims(token) {
  try {
    const part = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
    const json = JSON.parse(decodeURIComponent(escape(atob(part.padEnd(part.length + ((4 - (part.length % 4)) % 4), '=')))))
    return { id: json.sub, email: json.email ?? '' }
  } catch {
    return null
  }
}

/* ------------------------------------------------------------------ *
 * HTTP
 * ------------------------------------------------------------------ */

async function call(path, { method = 'GET', body, token, headers = {} } = {}) {
  const res = await fetch(`${URL_}${path}`, {
    method,
    headers: {
      apikey: KEY,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  const data = text ? (() => { try { return JSON.parse(text) } catch { return text } })() : null
  if (!res.ok) throw new Error(data?.msg ?? data?.message ?? data?.error_description ?? `${res.status}`)
  return data
}

/** Where a sign-in link or a provider sends the player back to: this page, no hash. */
const returnTo = () => `${location.origin}${location.pathname}`

/* ------------------------------------------------------------------ *
 * Signing in and out
 * ------------------------------------------------------------------ */

/** Which sign-in providers the project has switched on, besides email. */
export async function loadProviders() {
  if (!accountsEnabled) return
  try {
    const settings = await call('/auth/v1/settings')
    const external = settings?.external ?? {}
    set({ providers: ['google', 'github', 'apple', 'discord'].filter((p) => external[p]) })
  } catch {
    set({ providers: [] })
  }
}

export async function emailLink(email) {
  set({ status: 'sending', message: '' })
  try {
    await call(`/auth/v1/otp?redirect_to=${encodeURIComponent(returnTo())}`, {
      method: 'POST',
      body: { email, create_user: true },
    })
    set({ status: 'sent', message: `Check ${email} for a sign-in link. It opens this page signed in.` })
  } catch (error) {
    set({ status: 'error', message: `The link could not be sent (${error.message}). Try again in a minute.` })
  }
}

export function providerSignIn(provider) {
  location.assign(`${URL_}/auth/v1/authorize?provider=${encodeURIComponent(provider)}&redirect_to=${encodeURIComponent(returnTo())}`)
}

export async function signOut() {
  const token = state.session?.access_token
  writeSession(null)
  store.del(PUSHED_KEY)
  set({ status: 'idle', message: 'Signed out. Your progress stays saved in this browser too.' })
  if (token) call('/auth/v1/logout', { method: 'POST', token }).catch(() => {})
}

/**
 * A sign-in link or provider lands here with the session in the URL's hash:
 * `#access_token=...&refresh_token=...&expires_in=3600&type=magiclink`. The
 * site routes on the hash too, so this runs before the router reads it, keeps
 * the session, and puts the address back to a plain home page. Returns true
 * when it took a session.
 */
export function takeSessionFromUrl() {
  if (!accountsEnabled) return false
  const hash = location.hash.replace(/^#/, '')
  if (!hash.includes('access_token=') && !hash.includes('error_description=')) return false
  const p = new URLSearchParams(hash)
  history.replaceState(null, '', returnTo())
  if (p.get('error_description')) {
    set({ status: 'error', message: `Sign-in did not complete: ${p.get('error_description')}` })
    return false
  }
  const access = p.get('access_token')
  const who = claims(access)
  if (!access || !who) return false
  writeSession({
    access_token: access,
    refresh_token: p.get('refresh_token'),
    expires_at: Date.now() + Number(p.get('expires_in') ?? 3600) * 1000,
    user: who,
  })
  set({ status: 'signed-in', message: '' })
  return true
}

/** A valid access token, refreshed when it is within a minute of expiring. */
async function token() {
  const s = state.session
  if (!s) return null
  if (Date.now() < s.expires_at - 60_000) return s.access_token
  try {
    const fresh = await call('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: s.refresh_token } })
    writeSession({
      access_token: fresh.access_token,
      refresh_token: fresh.refresh_token,
      expires_at: Date.now() + (fresh.expires_in ?? 3600) * 1000,
      user: claims(fresh.access_token) ?? s.user,
    })
    return fresh.access_token
  } catch {
    // A refresh token that no longer works means signing in again.
    writeSession(null)
    set({ status: 'idle', message: 'Your sign-in expired. Sign in again to keep syncing.' })
    return null
  }
}

/* ------------------------------------------------------------------ *
 * Progress: read, merge, write
 * ------------------------------------------------------------------ */

const isDate = (v) => typeof v === 'string' && /^\d{4}-\d\d-\d\dT/.test(v)

/**
 * Two progress records into one that loses nothing either had. Objects merge
 * key by key; arrays become their union; of two numbers the larger is kept
 * (more fuel left, later in the mission, more plates); of two timestamps the
 * later; a text field keeps this device's value unless it is empty.
 */
export function mergeProgress(local, remote) {
  if (local === undefined || local === null) return remote
  if (remote === undefined || remote === null) return local
  if (Array.isArray(local) && Array.isArray(remote)) {
    const seen = new Set(local.map((v) => JSON.stringify(v)))
    return [...local, ...remote.filter((v) => !seen.has(JSON.stringify(v)))]
  }
  if (typeof local === 'object' && typeof remote === 'object' && !Array.isArray(local) && !Array.isArray(remote)) {
    const out = {}
    for (const k of new Set([...Object.keys(local), ...Object.keys(remote)])) out[k] = mergeProgress(local[k], remote[k])
    return out
  }
  if (typeof local === 'number' && typeof remote === 'number') return Math.max(local, remote)
  if (typeof local === 'boolean' && typeof remote === 'boolean') return local || remote
  if (isDate(local) && isDate(remote)) return local > remote ? local : remote
  if (typeof local === 'string') return local.length ? local : remote
  return local
}

function localProgress() {
  const out = {}
  for (const k of SYNCED) {
    const raw = store.get(k)
    if (raw) { try { out[k] = JSON.parse(raw) } catch { /* unreadable: leave it out */ } }
  }
  return out
}

/**
 * Pull the account's progress, merge it with this browser's, and write the
 * merge both ways. Returns true when this browser's records changed, so the
 * caller can reload the page and every store reads the merged values.
 */
export async function syncNow() {
  const t = await token()
  if (!t) return false
  const id = state.session.user.id
  set({ status: 'syncing' })
  try {
    const rows = await call(`/rest/v1/progress?select=data&user_id=eq.${encodeURIComponent(id)}`, { token: t })
    const remote = rows?.[0]?.data ?? {}
    const local = localProgress()
    const merged = mergeProgress(local, remote)
    let changed = false
    for (const k of SYNCED) {
      if (merged[k] === undefined) continue
      const value = JSON.stringify(merged[k])
      if (value !== JSON.stringify(local[k])) { store.set(k, value); changed = true }
    }
    const body = JSON.stringify(merged)
    if (body !== JSON.stringify(remote)) {
      await call('/rest/v1/progress', {
        method: 'POST',
        token: t,
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: { user_id: id, data: merged, updated_at: new Date().toISOString() },
      })
    }
    store.set(PUSHED_KEY, body)
    set({ status: 'signed-in', message: '', synced: Date.now() })
    return changed
  } catch (error) {
    set({ status: 'signed-in', message: `Could not sync just now (${error.message}). Your progress is safe in this browser.` })
    return false
  }
}

/**
 * Keep the account current while signed in: a sync when the page is hidden
 * (closing a tab, switching away) and every two minutes if anything changed.
 */
export function startAutoSync() {
  if (!accountsEnabled) return () => {}
  const maybe = () => {
    if (!state.session) return
    if (JSON.stringify(localProgress()) === JSON.stringify(JSON.parse(store.get(PUSHED_KEY) ?? 'null'))) return
    syncNow()
  }
  const onHide = () => { if (document.visibilityState === 'hidden') maybe() }
  // A session can also arrive without a page load: the same tab sent to a
  // link that differs from this page only in its hash.
  const onHash = () => { if (location.hash.includes('access_token=')) bootAccount() }
  document.addEventListener('visibilitychange', onHide)
  window.addEventListener('hashchange', onHash)
  const timer = setInterval(maybe, 120_000)
  return () => { document.removeEventListener('visibilitychange', onHide); window.removeEventListener('hashchange', onHash); clearInterval(timer) }
}

/**
 * At startup: take a session from the URL if one just arrived, then merge
 * with the account. A merge that changed this browser's records reloads the
 * page once, so every store starts from the merged values.
 */
export async function bootAccount() {
  if (!accountsEnabled) return
  const arrived = takeSessionFromUrl()
  loadProviders()
  if (!state.session) return
  if (state.status === 'idle') set({ status: 'signed-in' })
  const changed = await syncNow()
  if (changed && arrived) location.reload()
  else if (changed) set({ message: 'Progress from your other devices is in. Reload to see it everywhere.' })
}
