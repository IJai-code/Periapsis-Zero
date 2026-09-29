/**
 * verify-assets — what a visitor waits for before anything can be flown.
 *
 * The imagery is 13.4 MB, and every visitor used to wait for all of it: the
 * Moon's colour and normal maps are 9.5 MB of that total and were blocking the
 * first frame for people who never leave Earth. On a 1.5 Mbps connection,
 * measured in the browser, the Earth set alone took 26 seconds and the whole
 * set would have taken well over a minute.
 *
 * So the manifest marks slots `defer`, and `loadHdTextures` resolves once the
 * rest are in. That only stays true if nothing large creeps back into the
 * blocking set, which is what this measures — against the files on disk, since
 * those are what a browser will actually be asked for.
 *
 * The one rule underneath it: a deferred slot must have something to draw with
 * in the meantime. HD imagery is layered over a procedural baseline rather than
 * replacing it (`useActiveTextures`), so a slot that has not arrived keeps its
 * generated version. A slot deferred without a generated version would be a
 * hole, so the generator's slot list is checked to cover every deferred one.
 */
import assert from 'node:assert/strict'
import { readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { HD_MANIFEST } from '../src/gfx/hdTextures.js'

const here = dirname(fileURLToPath(import.meta.url))
const textures = join(here, '..', 'public', 'textures')

let n = 0
const check = (label, fn) => {
  fn()
  n++
  console.log(`  ✓ ${label}`)
}

/** The bytes a file actually costs, or 0 when it is not installed. */
const size = (file) => {
  try {
    return statSync(join(textures, file)).size
  } catch {
    return 0
  }
}

/** The size a slot costs, counting the alternate when the first is absent. */
function slotBytes(entry) {
  const a = size(entry.file)
  if (a) return a
  return entry.alt ? size(entry.alt) : 0
}

const MB = 1048576
const blocking = HD_MANIFEST.filter((e) => !e.defer)
const deferred = HD_MANIFEST.filter((e) => e.defer)
const bytes = (list) => list.reduce((a, e) => a + slotBytes(e), 0)

check('the manifest still defers something, and still blocks on something', () => {
  assert.ok(blocking.length > 0, 'nothing is loaded up front')
  assert.ok(deferred.length > 0, 'nothing is deferred; the first frame waits for everything again')
})

check('every manifest file is installed and has real bytes', () => {
  for (const e of HD_MANIFEST) {
    assert.ok(slotBytes(e) > 1024, `${e.slot}: ${e.file} is missing or empty`)
  }
})

check('what a visitor waits for is under 6 MB', () => {
  const b = bytes(blocking)
  assert.ok(
    b < 6 * MB,
    `the blocking set is ${(b / MB).toFixed(2)} MB across ${blocking.length} slots — a slow connection will feel it`,
  )
  // And it is genuinely smaller than it was: the whole set is much larger.
  const all = bytes(HD_MANIFEST)
  assert.ok(b < all * 0.5, `blocking ${(b / MB).toFixed(2)} MB of ${(all / MB).toFixed(2)} MB is not a deferral`)
})

check('the deferral moves the weight, not a rounding error', () => {
  const d = bytes(deferred)
  assert.ok(d > 4 * MB, `only ${(d / MB).toFixed(2)} MB is deferred, which is not worth the machinery`)
  // The biggest single file must not be one a visitor waits for.
  const biggest = HD_MANIFEST.slice().sort((a, b) => slotBytes(b) - slotBytes(a))[0]
  assert.ok(biggest.defer, `the largest file (${biggest.file}) is still blocking the first frame`)
})

check('every deferred slot has a generated version to stand in for it', () => {
  // The worker's slot names, read from its source rather than imported: it is a
  // module worker full of OffscreenCanvas and cannot be loaded here.
  const worker = readFileSync(join(here, '..', 'src', 'gfx', 'generate.worker.js'), 'utf8')
  for (const e of deferred) {
    const [body] = e.slot.split('.')
    assert.ok(
      new RegExp(`['"\`]${body}`, 'i').test(worker),
      `${e.slot} is deferred but the generator never mentions "${body}" — it would be a hole, not a stand-in`,
    )
  }
})

check('no slot is listed twice, and every slot names a body and a channel', () => {
  const seen = new Set()
  for (const e of HD_MANIFEST) {
    assert.ok(/^[a-z]+\.[a-z]+$/.test(e.slot), `${e.slot} is not a body.channel name`)
    assert.ok(!seen.has(e.slot), `${e.slot} appears twice`)
    seen.add(e.slot)
  }
})

const b = bytes(blocking)
const d = bytes(deferred)
console.log(
  `\n${n} checks pass — a visitor waits for ${(b / MB).toFixed(2)} MB, not ${((b + d) / MB).toFixed(2)}.`,
)
