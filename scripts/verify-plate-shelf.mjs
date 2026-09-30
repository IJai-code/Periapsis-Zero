/**
 * The plate-shelf gate: photographs come home, degrade to nothing, and stay
 * at eight.
 *
 * The shelf is an IndexedDB database behind a guard-rail: every path resolves
 * to a shelf shape, never rejects, and an environment without storage gets
 * the empty shelf — which is why this gate runs fine in Node, where there is
 * no `indexedDB` at all. The doubles here install a minimal in-memory
 * IndexedDB faithful enough for the one store the shelf uses, the same
 * doubles-over-ESM pattern the render-budget gate established, and then hold
 * the semantics: depth trimming, ordering, delete, and the empty-store
 * contract the gallery's "no plates yet" state rests on.
 */

import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(here, '..')
let failures = 0
const fail = (msg) => {
  failures++
  console.log(`  FAIL  ${msg}`)
}
const pass = (msg) => console.log(`  ok    ${msg}`)

/* 1. No indexedDB at all: the shelf is empty, and nothing throws. */
const shelf = await import(join(ROOT, 'src/gfx/plateShelf.js'))
{
  const all = await shelf.plateAll()
  if (Array.isArray(all.items) && all.items.length === 0) pass('no storage: an empty shelf, not an error')
  else fail(`no-storage shelf wrong: ${JSON.stringify(all)}`)
  const saved = await shelf.plateSave('data:image/png;base64,iVBORw0KGgo=', 'Apollo 8 · TLI', 'T+02:50:00')
  if (Array.isArray(saved.items) && saved.items.length === 0) pass('a save without storage degrades to empty')
  else fail(`no-storage save wrong: ${JSON.stringify(saved)}`)
  const del = await shelf.plateDelete('p-nope')
  if (Array.isArray(del.items)) pass('a delete without storage degrades to empty')
  else fail('no-storage delete threw')
}

/* 2. With a minimal in-memory IndexedDB: the real semantics. */
function installFakeIdb() {
  const stores = new Map()
  const listeners = { success: [], complete: [] }
  const fakeRequest = (impl) => {
    const req = { result: undefined, onsuccess: null }
    queueMicrotask(() => {
      try {
        req.result = impl()
        req.onsuccess?.()
      } catch (e) {
        req.onerror?.(e)
      }
    })
    return req
  }
  const store = () => ({
    put(entry) {
      return fakeRequest(() => {
        stores.set(entry.id, { ...entry })
        return entry.id
      })
    },
    get(id) {
      return fakeRequest(() => stores.get(id))
    },
    getAll() {
      return fakeRequest(() => [...stores.values()])
    },
    delete(id) {
      return fakeRequest(() => stores.delete(id))
    },
  })
  globalThis.indexedDB = {
    open(name, version) {
      if (!stores.size) stores.__opened = `${name}@${version}`
      const req = {
        result: {
          objectStoreNames: { contains: () => true },
          createObjectStore: () => store(),
          transaction: (_name, _mode) => {
            const tx = {
              objectStore: store,
              oncomplete: null,
              onerror: null,
              onabort: null,
              error: null,
            }
            /*
             * Completion on a macrotask, requests on microtasks: real IDB
             * fires a request's success before its transaction's complete,
             * and the shelf reads `req.result` inside that success handler.
             * Fired the other way round, the transaction resolves before
             * the request has run and every read comes back undefined.
             */
            setTimeout(() => tx.oncomplete?.(), 0)
            return tx
          },
          close() {},
        },
        onsuccess: null,
        onerror: null,
        onupgradeneeded: null,
      }
      queueMicrotask(() => req.onsuccess?.())
      return req
    },
  }
  return () => delete globalThis.indexedDB
}

const restore = installFakeIdb()
try {
  for (let i = 1; i <= 10; i++) {
    await shelf.plateSave(`data:png,${i}`, `Plate ${i}`, `T+00:0${i}`)
  }
  {
    const all = await shelf.plateAll()
    if (all.items.length === shelf.PLATE_SHELF_SIZE)
      pass(`ten saves leave exactly ${shelf.PLATE_SHELF_SIZE} on the shelf`)
    else fail(`depth wrong: ${all.items.length}`)
    if (all.items[0].title === 'Plate 10' && all.items[all.items.length - 1].title === 'Plate 3')
      pass('newest first, oldest trimmed')
    else fail(`order wrong: ${all.items.map((p) => p.title).join(', ')}`)
    if (all.items.every((p) => p.dataUrl && p.facts && typeof p.at === 'number'))
      pass('entries carry the image, the caption and the time')
    else fail('entry fields missing')
  }
  {
    const all = await shelf.plateAll()
    const victim = all.items[0]
    const after = await shelf.plateDelete(victim.id)
    if (after.items.length === shelf.PLATE_SHELF_SIZE - 1 && !after.items.some((p) => p.id === victim.id))
      pass('a delete removes exactly its own plate')
    else fail('delete wrong')
  }
  {
    await shelf.plateSave('data:png,fresh', 'Fresh', 'T+09:99')
    const all = await shelf.plateAll()
    if (all.items.length === shelf.PLATE_SHELF_SIZE && all.items[0].title === 'Fresh')
      pass('the shelf refills to depth after a delete')
    else fail(`refill wrong: ${all.items.length}`)
  }
} finally {
  restore()
}

/* 3. The wiring: the shutter shelves the plate, the gallery shows it. */
const photo = readFileSync(join(ROOT, 'src/components/Photograph.jsx'), 'utf8')
if (photo.includes('plateSave(url, title, facts)'))
  pass('the shutter shelves the captioned plate with its caption lines')
else fail('Photograph does not shelve plates')
if (photo.includes('captionLines()')) pass('the caption lines are read from the same instant the file is composed')
else fail('shelf caption not taken from captionLines()')
const logbook = readFileSync(join(ROOT, 'src/ui/Logbook.jsx'), 'utf8')
for (const [needle, why] of [
  ['plateAll()', 'the gallery reads the shelf'],
  ['plateDownload(p)', 'a plate can be taken home from the gallery'],
  ['plateDelete(', 'a plate can be removed from the shelf'],
]) {
  if (logbook.includes(needle)) pass(`Logbook: ${why}`)
  else fail(`Logbook lost ${needle}`)
}

console.log(failures ? `\n  ${failures} failure${failures === 1 ? '' : 's'}` : '\n  PASS')
process.exit(failures ? 1 : 0)
