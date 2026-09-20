/**
 * Every gate, whether or not an earlier one failed.
 *
 * `verify:all` was a `&&` chain, and a chain stops at the first red gate. That
 * is fine while the suite is green and misleading the moment it is not: on 19
 * September a platform tolerance in `verify-nodes` went red first and hid the
 * ten gates behind it, so `verify:pads`, `verify:pad-geometry` and
 * `verify:audio` — the three covering the newest work — had never run on the
 * Linux runner at all. The gates nobody could see were the ones nobody was
 * checking.
 *
 * This runs all of them, streams every gate's output in order, and ends with a
 * summary and an exit code that belongs to the suite rather than to whichever
 * gate happened to sit first. A red gate still fails the build; it just cannot
 * hide the others, and a count of what is red is the first thing in the log.
 *
 *   node scripts/verify-all.mjs              all of them
 *   node scripts/verify-all.mjs nodes prem   only those whose name matches
 *
 * `verify-radial` is newer than the order it sits in and was put beside
 * `verify-loiter` on purpose: it flies the same commitment and pins the
 * measurements that gate's lifetime checks depend on.
 */

import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

/**
 * The suite, in the order it has always run in, with the one thing that varies
 * per gate: the allocation gates need `--expose-gc` or they cannot measure.
 */
const GATES = [
  ['verify-anomalies', false],
  ['verify-warp', false],
  ['verify-cr3bp', false],
  ['verify-rails', true],
  ['verify-geometry', false],
  ['verify-navigation', true],
  ['verify-director', true],
  ['verify-gizmo', true],
  ['verify-nodes', true],
  ['verify-frames', true],
  ['verify-horizon', true],
  ['verify-launch-sites', false],
  ['verify-prem', true],
  ['verify-terrain', false],
  ['verify-solar', false],
  ['verify-loiter', false],
  ['verify-radial', false],
  ['verify-pads', true],
  ['verify-pad-geometry', false],
  ['verify-audio', true],
]

const wanted = process.argv.slice(2)
const selected = wanted.length
  ? GATES.filter(([name]) => wanted.some((w) => name.includes(w)))
  : GATES

if (!selected.length) {
  console.error(
    `no gate matches ${wanted.join(', ')} — the suite is:\n  ${GATES.map(([n]) => n).join('\n  ')}`,
  )
  process.exit(2)
}

const results = []
for (const [name, exposeGc] of selected) {
  const file = join(here, `${name}.mjs`)
  const args = exposeGc ? ['--expose-gc', file] : [file]
  const started = Date.now()
  // `inherit`, so a gate's own output lands in the log where it happened rather
  // than being replayed after the next one has already run.
  const { status, signal } = spawnSync(process.execPath, args, { stdio: 'inherit' })
  results.push({ name, ok: status === 0, status, signal, seconds: (Date.now() - started) / 1000 })
}

const failed = results.filter((r) => !r.ok)
const width = Math.max(...results.map((r) => r.name.length))
console.log('\n=== the suite ===')
for (const r of results) {
  const why = r.signal
    ? `killed by ${r.signal}`
    : r.status === null
      ? 'no exit status'
      : `exit ${r.status}`
  console.log(
    `  ${r.ok ? 'PASS' : 'FAIL'}  ${r.name.padEnd(width)}  ${r.seconds.toFixed(0).padStart(4)} s   ${r.ok ? '' : why}`,
  )
}
console.log(`\n  ${results.length - failed.length} of ${results.length} gates pass`)
if (failed.length) console.log(`  failing: ${failed.map((r) => r.name).join(', ')}`)
process.exit(failed.length ? 1 : 0)
