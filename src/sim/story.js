/**
 * The story's record, in this browser.
 *
 * Six chapters, flown in order; this is where a completed chapter is written
 * and read back. It exists as its own module because the record is not view
 * state and not flight state, it outlives the page the way the logbook does,
 * and both `programs.js` (which writes, the moment a chapter's last objective
 * latches) and the story board (which reads, to decide what is unlocked) need
 * one small store neither should own.
 *
 * The shape follows `logbook.js`: subscribe/get for `useSyncExternalStore`,
 * localStorage for persistence, and a silent no-op everywhere the platform
 * says no (private browsing, SSR, a gate running under Node). A chapter that
 * cannot be recorded has still been flown, the board will just offer it
 * again next visit, which is the honest failure mode.
 */

const KEY = 'pz-story'

function load() {
  try {
    const raw = globalThis.localStorage?.getItem(KEY)
    const parsed = raw ? JSON.parse(raw) : null
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

let record = load()
const listeners = new Set()

/** The whole record: chapter id → mission time it was completed at. */
export const storyState = () => record

/** Has this chapter been flown to its last objective in this browser? */
export const storyDone = (id) => Boolean(record[id])

/** Subscribe to story changes; returns the unsubscribe function. */
export function subscribeStory(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/**
 * Record a completed chapter. Idempotent, `tickProgram` calls this every
 * frame once the checklist is full, and the first write wins.
 */
export function recordStory(id, missionT) {
  if (!id || record[id]) return
  record = { ...record, [id]: Number.isFinite(missionT) ? missionT : null }
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(record))
  } catch {
    /* private mode; the record just stays local */
  }
  listeners.forEach((l) => l())
}
