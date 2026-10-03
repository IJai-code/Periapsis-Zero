/**
 * verify-pilot — the optional profile.
 *
 * This gate holds two promises that are easy to break quietly. The first is
 * that the profile never gates play: a blank profile has to be a perfectly
 * valid state, not a disabled one. The second is that whatever arrives from
 * storage is shape-checked on read, so a hand-edited or corrupt value degrades
 * to "no profile" rather than throwing inside a render.
 *
 * It also pins the property that makes this a profile and not an account: there
 * is no network call anywhere in the module, so nothing can be sent off the
 * machine, and no field that a player would have to fill in.
 */
import assert from 'node:assert/strict'
import { blankProfile, hasProfile, pilotLabel, pilotProfile, saveProfile, subscribePilot, validateProfile } from '../src/sim/pilot.js'

let n = 0
const check = (label, fn) => { fn(); console.log(`  ✓ ${label}`); n++ }

check('a blank profile is valid and never blocks anything', () => {
  const fresh = validateProfile(null)
  assert.equal(fresh.version, 1)
  assert.equal(fresh.name, '')
  assert.equal(fresh.callsign, '')
  assert.deepEqual(blankProfile(), fresh)
  assert.equal(pilotLabel(), null, 'no name means no label, not a placeholder')
})

check('corrupt and hostile storage shapes all fall back to blank', () => {
  for (const bad of [null, undefined, 0, '', 'a string', [], { version: 2 }, { version: 1, name: 42 }, { nope: true }]) {
    const out = validateProfile(bad)
    assert.equal(out.version, 1)
    assert.equal(typeof out.name, 'string')
    assert.equal(typeof out.callsign, 'string')
  }
  assert.equal(validateProfile({ version: 1, created: 'now' }).created, '', 'an unparseable date is dropped')
  assert.equal(validateProfile({ version: 1, created: '2026-10-03' }).created, '2026-10-03')
})

check('names are trimmed, collapsed and bounded to what the badge shows', () => {
  const long = 'x'.repeat(90)
  const out = validateProfile({ version: 1, name: `  Ada   Lovelace  ` })
  assert.equal(out.name, 'Ada Lovelace')
  assert.equal(validateProfile({ version: 1, name: long }).name.length, 24)
  assert.equal(validateProfile({ version: 1, callsign: ' isa-7 ' }).callsign, 'ISA-7')
  assert.equal(validateProfile({ version: 1, name: '   ' }).name, '')
})

check('an empty pair clears the profile rather than storing a ghost', () => {
  saveProfile({ name: 'Amelia', callsign: 'AE-1' })
  assert.equal(hasProfile(), true)
  assert.equal(pilotLabel(), 'AE-1', 'the callsign is what a pilot signs with')
  assert.equal(pilotProfile().name, 'Amelia')
  saveProfile({ name: '', callsign: '' })
  assert.equal(hasProfile(), false, 'clearing is not an error state')
  assert.equal(pilotLabel(), null)
  assert.deepEqual(pilotProfile(), blankProfile())
})

check('subscribers see every change and can unsubscribe', () => {
  let seen = 0
  const off = subscribePilot(() => { seen++ })
  saveProfile({ name: 'Grace', callsign: '' })
  assert.equal(seen, 1)
  assert.equal(pilotLabel(), 'Grace', 'with no callsign the name is the label')
  off()
  saveProfile({ name: 'Hedy', callsign: '' })
  assert.equal(seen, 1, 'an unsubscribed listener is not called again')
  saveProfile({ name: '', callsign: '' })
})

check('the profile keeps its created stamp across edits', () => {
  saveProfile({ name: 'Katherine' })
  const created = pilotProfile().created
  assert.ok(created, 'the first save records when the profile began')
  saveProfile({ name: 'Katherine Johnson', callsign: 'KJ' })
  assert.equal(pilotProfile().created, created, 'editing a name does not restart the history')
  saveProfile({ name: '', callsign: '' })
  assert.equal(pilotProfile().created, '', 'clearing clears the whole record')
})

check('nothing in the pilot module touches the network', async () => {
  const { readFileSync } = await import('node:fs')
  const source = readFileSync(new URL('../src/sim/pilot.js', import.meta.url), 'utf8')
  for (const forbidden of ['fetch(', 'XMLHttpRequest', 'WebSocket', 'import.meta.env.VITE']) {
    assert.ok(!source.includes(forbidden), `${forbidden} must not appear in a local profile`)
  }
  assert.ok(source.includes('localStorage'), 'persistence is local storage and nothing else')
})

console.log(`\n${n} pilot checks pass.`)