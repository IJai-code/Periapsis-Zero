/**
 * The plate shelf: photographs that come home, like the films do.
 *
 * A plate is downloaded the moment it is taken — that was always the point of
 * the caption living on the file — but a download is a thing that leaves. The
 * shelf is the copy that stays: the last eight plates, in the browser, shown
 * in the logbook drawer, so a session's pictures are still here tomorrow.
 *
 * Eight, deliberately: a plate is a four-megapixel PNG, so the shelf's worst
 * case is tens of megabytes — the same order as one film. Films get their own
 * database and their own quota negotiation; plates ride in a *separate*
 * database so an old film database's version history is never reopened (and
 * so a plate write can fail without taking the film shelf down with it).
 *
 * Every path degrades to "no shelf": private mode, quota, an embedded webview
 * — the download still happens, the logbook still counts the plate, and
 * nothing user-facing reports an error, because a photograph that downloads
 * is not made worse by a shelf that couldn't keep a copy.
 */

const DB = 'periapsis-plates'
const STORE = 'plates'
/** The shelf's depth. Oldest out when a new one arrives. */
export const PLATE_SHELF_SIZE = 8

function withStore(mode, fn) {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('no shelf here'))
    const open = indexedDB.open(DB, 1)
    open.onupgradeneeded = () => {
      if (!open.result.objectStoreNames.contains(STORE)) {
        open.result.createObjectStore(STORE, { keyPath: 'id' })
      }
    }
    open.onerror = () => reject(open.error)
    open.onsuccess = () => {
      const tx = open.result.transaction(STORE, mode)
      const req = fn(tx.objectStore(STORE))
      let result
      req.onsuccess = () => { result = req.result }
      tx.oncomplete = () => { open.result.close(); resolve(result) }
      tx.onabort = tx.onerror = () => { open.result.close(); reject(tx.error ?? req.error) }
    }
  })
}

/** Empty when there is no shelf: the callers all treat that as "nothing kept". */
const EMPTY = { items: [] }

/**
 * Keep a plate. `dataUrl` is the captioned PNG as taken; `title` and `facts`
 * are the caption's own lines, so the gallery can show them without
 * re-parsing the image. Returns the shelf after the write, or EMPTY.
 */
export async function plateSave(dataUrl, title, facts) {
  try {
    const entry = {
      id: `p${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
      dataUrl,
      title: String(title ?? ''),
      facts: String(facts ?? ''),
      at: Date.now(),
    }
    const db = await withStore('readwrite', (store) => store.put(entry))
    // Trim to the depth: newest PLATE_SHELF_SIZE stay, the rest go.
    const all = await withStore('readonly', (store) => store.getAll())
    const stale = (all ?? [])
      .sort((a, b) => b.at - a.at)
      .slice(PLATE_SHELF_SIZE)
      .map((e) => e.id)
    for (const id of stale) {
      await withStore('readwrite', (store) => store.delete(id))
    }
    return plateAll()
  } catch {
    return EMPTY
  }
}

/** The whole shelf, newest first. EMPTY when there is nothing or no shelf. */
export async function plateAll() {
  try {
    const all = await withStore('readonly', (store) => store.getAll())
    return { items: (all ?? []).sort((a, b) => b.at - a.at) }
  } catch {
    return EMPTY
  }
}

/** Take a plate home again — one download, then the URL is given back. */
export function plateDownload(entry) {
  if (!entry?.dataUrl) return
  const a = document.createElement('a')
  a.href = entry.dataUrl
  a.download = `periapsis-${entry.id}.png`
  document.body.appendChild(a)
  a.click()
  a.remove()
}

/** Drop one plate. Returns the shelf after, or EMPTY. */
export async function plateDelete(id) {
  try {
    await withStore('readwrite', (store) => store.delete(id))
    return plateAll()
  } catch {
    return EMPTY
  }
}
