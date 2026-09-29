/**
 * verify-plate — what a photograph says under it is true, and says it once.
 *
 * The plate is the part of this simulator most likely to be seen by someone
 * who never opens it: a picture gets posted, and the caption travels with the
 * file. So a caption that says "NaN km" or "T+undefined", or that quietly
 * disagrees with the instrument panel it was taken beside, is worse than no
 * caption — it is a wrong claim with a photograph attached.
 *
 * The two formatters are pure for exactly this reason, and the assembled line
 * is checked for the failure that actually happened in development: the height
 * gained its own "over Terra" while the assembler was still appending the word
 * "altitude", and the plate read *163 km over Terra altitude*.
 */
import assert from 'node:assert/strict'
import { captionLines, heightLabel, metLabel } from '../src/gfx/photoCaption.js'

let n = 0
const check = (label, fn) => {
  fn()
  n++
  console.log(`  ✓ ${label}`)
}

check('mission elapsed time counts both ways, in fixed columns', () => {
  assert.equal(metLabel(0), 'T+00:00:00')
  assert.equal(metLabel(-52), 'T−00:00:52')
  assert.equal(metLabel(59), 'T+00:00:59')
  assert.equal(metLabel(3600), 'T+01:00:00')
  assert.equal(metLabel(167831), 'T+46:37:11')
  // A count runs past a day without wrapping: Apollo 8 was away for six.
  assert.equal(metLabel(6 * 86400), 'T+144:00:00')
  // Every field is two digits or more, so the figure never changes width
  // below a hundred hours — the whole reason the panel uses tabular numerals.
  for (const t of [0, 5, 61, 3599, 3601, 86399]) {
    assert.match(metLabel(t), /^T[+−]\d{2,}:\d{2}:\d{2}$/, `at ${t}`)
  }
})

check('a time that is not a number produces nothing, not "NaN"', () => {
  for (const bad of [NaN, Infinity, -Infinity, undefined, null, 'x']) {
    assert.equal(metLabel(bad), null, String(bad))
  }
})

check('heights are given in units a person can picture', () => {
  assert.equal(heightLabel(0), '0 m over Terra')
  assert.equal(heightLabel(842), '842 m over Terra')
  assert.equal(heightLabel(999), '999 m over Terra')
  assert.equal(heightLabel(1000), '1.0 km over Terra')
  assert.equal(heightLabel(163000), '163 km over Terra')
  assert.equal(heightLabel(384400000, true), '384,400 km over Luna')
  assert.equal(heightLabel(110000, true), '110 km over Luna')
})

check('a height that is not a number, or is below the ground, produces nothing', () => {
  for (const bad of [NaN, Infinity, undefined, null, -5]) {
    assert.equal(heightLabel(bad), null, String(bad))
  }
})

check('the assembled caption names the flight and the instant', () => {
  const { title, facts } = captionLines()
  assert.ok(title && title.length > 3, `title was ${JSON.stringify(title)}`)
  assert.match(facts, /T[+−]\d{2,}:\d{2}:\d{2}/, 'no mission time in the caption')
  assert.match(facts, /\d{4}/, 'no year in the caption')
})

check('the caption never carries a broken value', () => {
  const { title, facts } = captionLines()
  const whole = `${title} ${facts}`
  for (const bad of ['undefined', 'NaN', 'null', 'Infinity', '[object']) {
    assert.ok(!whole.includes(bad), `the caption reads "${whole}"`)
  }
})

check('the caption says each thing once', () => {
  // The bug this exists for: the height formatter names its body, and the
  // assembler was also appending "altitude" — "163 km over Terra altitude".
  const { facts } = captionLines()
  const words = facts.toLowerCase().split(/[\s·]+/).filter(Boolean)
  const seen = new Map()
  for (const w of words) seen.set(w, (seen.get(w) ?? 0) + 1)
  for (const noise of ['altitude', 'over', 'terra', 'luna']) {
    assert.ok((seen.get(noise) ?? 0) <= 1, `"${noise}" appears ${seen.get(noise)} times in "${facts}"`)
  }
})

check('the facts are separated so they can be read apart', () => {
  const { facts } = captionLines()
  const parts = facts.split('·').map((p) => p.trim()).filter(Boolean)
  assert.ok(parts.length >= 2, `only ${parts.length} fact(s): "${facts}"`)
  for (const p of parts) assert.ok(p.length > 0 && p.length < 60, `a fact reads "${p}"`)
})

console.log(`\n${n} checks pass — a photograph's caption is true, complete and says each thing once.`)
