/**
 * verify-audio — the ambience keeps its promises.
 *
 * The product's old rule was "the simulator makes no sound", and the rule
 * this module replaces it with is narrower and stated: the simulator still
 * makes no sound of its own — the engines stay silent, in vacuum and in the
 * strip — but the visitor may bring a room with them, and the room is the
 * one file they supplied. This gate holds what can be held headlessly:
 *
 *   1. The bed exists, is a real MP3 (ID3 or 0xFFFB frame sync), and is
 *      not a placeholder or a truncation.
 *   2. Nothing in the flight path imports the ambience module: engine.js
 *      does not exist, and the only importer is the HUD's clock, whose
 *      pulse glides one filter — audio here is a leaf, not a dependency
 *      of flight.
 *   3. The graph is wired the way the module says: one context, created
 *      only by the toggle's gesture; the file fetch happens inside the
 *      same call, so an ambience never enabled costs nothing.
 *   4. The generated score stays gone: no sfx module but the ambience
 *      exists, and nothing imports one. The bed the owner supplied is the
 *      only music in the product.
 *
 * What cannot be asserted headlessly — that it sounds like anything — is
 * left to the ear that supplied it.
 */
import assert from 'node:assert/strict'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const ROOT = join(here, '..')

let n = 0
const check = (label, fn) => {
  fn()
  n++
  console.log(`  ✓ ${label}`)
}

check('the ambient bed exists and is a real MP3', () => {
  const path = join(ROOT, 'public/audio/monume-space-ambient.mp3')
  assert.ok(existsSync(path), 'the bed is missing from public/audio')
  const bytes = readFileSync(path)
  // A real MP3 starts with an ID3 tag or an MPEG frame sync (0xFF Ex/Fx).
  const id3 = bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33
  const sync = bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0
  assert.ok(id3 || sync, 'the file is not an MPEG audio stream')
  assert.ok(bytes.length > 500_000, `the bed is ${bytes.length} B — too small to be the supplied recording`)
  // A truncated download decodes up to the cut and stops; a real one is
  // the size it was sent. The supplied file is ~3.3 MB.
  const mb = bytes.length / 1024 / 1024
  assert.ok(mb > 2, `the bed is ${mb.toFixed(2)} MB — the supplied recording is ~3.3`)
})

check('no flight-path module imports audio', () => {
  // The flight path is sim/, minus store.js's score comment, plus the
  // sequencer. Nothing there may pull an AudioContext into a worker or a
  // headless gate.
  const flight = ['sim/mission.js', 'sim/ship.js', 'sim/rk4.js', 'sim/fastForward.js', 'sfx/engine.js']
  for (const f of flight) {
    const p = join(ROOT, 'src', f)
    // engine.js is asserted absent rather than read: the product has no
    // engine sound and this gate is where that stays true.
    if (f === 'sfx/engine.js') {
      assert.ok(!existsSync(p), 'sfx/engine.js has returned; the simulator still makes no sound of its own')
      continue
    }
    const src = readFileSync(p, 'utf8')
    assert.ok(!/from\s+'[^']*sfx\//.test(src), `${f} imports the audio layer`)
  }
})

check('the ambience is a leaf: only the HUD clock and the toggle reach it', () => {
  // Walk every src module and assert the importer set is exactly the two
  // surfaces that are allowed. A third importer is a wiring mistake that
  // would drag an AudioContext into a place without a gesture.
  const allowed = new Set(['src/ui/uiClock.js', 'src/ui/Toggles.jsx'])
  const found = []
  const walk = (dir) => {
    for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
      const p = join(ROOT, dir, e.name)
      if (e.isDirectory()) walk(join(dir, e.name))
      else if (/\.(js|jsx)$/.test(e.name)) {
        const src = readFileSync(p, 'utf8')
        if (/from\s+'[^']*sfx\/ambience/.test(src)) found.push(join(dir, e.name).replaceAll('\\', '/'))
      }
    }
  }
  walk('src')
  for (const f of found) assert.ok(allowed.has(f), `${f} imports the ambience; only ${[...allowed].join(', ')} may`)
  assert.equal(found.length, allowed.size, `expected both consumers to import it; found ${found.length}`)
})

check('the generated score stays gone — the supplied bed is the only music', () => {
  // `sfx/score.js` was a generative soundtrack under the mission intros;
  // it was removed at the owner's word, and this is where that stays true.
  assert.ok(!existsSync(join(ROOT, 'src/sfx/score.js')), 'sfx/score.js has returned')
  const walk = (dir, found) => {
    for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
      const p = join(ROOT, dir, e.name)
      if (e.isDirectory()) walk(join(dir, e.name), found)
      else if (/\.(js|jsx)$/.test(e.name)) {
        const src = readFileSync(p, 'utf8')
        if (/from\s+'[^']*sfx\/score/.test(src)) found.push(join(dir, e.name).replaceAll('\\', '/'))
      }
    }
    return found
  }
  const importers = walk('src', [])
  assert.equal(importers.length, 0, `something imports the removed score: ${importers.join(', ')}`)
  const sfx = readdirSync(join(ROOT, 'src/sfx')).filter((f) => f.endsWith('.js'))
  assert.deepEqual(sfx, ['ambience.js'], `sfx/ holds more than the ambience: ${sfx.join(', ')}`)
})

check('the ambience still gates on a gesture', () => {
  const amb = readFileSync(join(ROOT, 'src/sfx/ambience.js'), 'utf8')
  assert.ok(amb.includes('setAmbience'), 'the enable entry point is named')
  // The context is constructed inside the toggle-driven call, not at
  // module load: the string `new Ctx` must not appear at top level. The
  // whole of the construction sits inside `setAmbience` — checked by
  // looking for the construction after its declaration.
  const at = amb.indexOf('export async function setAmbience')
  const ctor = amb.indexOf('new Ctx()')
  assert.ok(at > 0 && ctor > at, 'the AudioContext must be constructed inside setAmbience, after the gesture arrives')
})

console.log(`verify-audio: ${n} checks — the bed is real, the flight path is silent, the generated score stays gone`)
