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
 * measurements that gate's lifetime checks depend on. `verify-heating` sits
 * immediately before `verify-plasma` for the same kind of reason: the sheath is
 * lit from the two heat fluxes, so the gate on those fluxes runs first and a
 * red one says which of the two to read.
 *
 * `verify-heating` could not be in this list until it had a state to fly from
 * that did not arrive as a command-line argument. It has one now —
 * `scripts/fixtures/lunar-orbit.json`, 2.3 KB — and costs the suite 0.5 s.
 * `verify-allocation` joins it from the same fixture, and goes last because it
 * is the slowest thing here: it flies 280,000 frames to measure two regimes.
 *
 * Three more gates were in the same position and are now here for the same
 * reason. That fixture *is* a lunar-orbit state, which is what `verify-return`
 * and `verify-tei-timing` each name in their own usage line, so both default to
 * it rather than requiring it. `verify-lunar-ascent` needs no state at all — it
 * flies Eagle off Tranquility Base — so it only ever needed registering; it sits
 * beside `verify-moon-frame` because the frame is what its clamp is written in.
 *
 * `verify-loi` and `verify-staging` joined them once each had a claim worth
 * asserting. `verify-staging` needed two things, not one: a state, and the vessel
 * that state belongs to — it is written against the Artemis stack, whose capture
 * burns the ICPS at stage 2, and on an Apollo-8 state that index is the S-IVB and
 * the script silently stops exercising staging altogether.
 *
 * `verify-approach` joined once the conic became something to assert rather than
 * report: its B-plane and v_inf at the sphere of influence, and the flyby the
 * conic goes on to predict. `verify-entry-guidance`, `verify-vessels`,
 * `verify-nrho-capture` and `verify-nrho-keeping` were red and are not any more.
 * `verify-predict` and the three NRHO gates — `cycle`, `ephemeris`, `family` —
 * run with no state, pass, and were simply never registered; they cost 0.7 to
 * 5.3 s between them, so there was nothing to weigh.
 *
 * `verify-broadcast` checks the broadcast's claims — which views were cameras,
 * the clocks, the far-side geometry flown from the same lunar-orbit fixture the
 * heating gates use, and the loop's timing. `verify-audio` returned with sound
 * in the product, but only the sound the visitor brings: it holds the ambient
 * bed to being a real recording, the flight path to importing none of it, and
 * the AudioContext to its gesture. `verify-programs` holds the planner's
 * promises — the wings' freedom ladder, every program's delta-v budget closed
 * on the vehicle's own rocket equation, the fuel drains real.
 *
 * `verify-deep-sky` and `verify-galaxy` sit beside `verify-cosmos`, the rest of
 * the sky: the first holds every named star, nebula and galaxy to the
 * catalogues and the frames they are placed in, the second the physics the
 * volume renderer is built from — arm tangents, extinction, the black hole's
 * photon orbits. `verify-search` covers the one part of the simulator with no
 * physics to be held against: what the search bar answers, including when the
 * honest answer is that it has never heard of the thing. `verify-flora` holds
 * the launch sites' scrub to the bargain it makes: the full build of every
 * plant identical to the vertex, the coarse one a real saving that keeps the
 * plant's outline, and never swapped while the plant is still large on screen.
 * `verify-site-ground` holds the one rule that lets the planet's globe be
 * skipped from inside a launch site's own ground: never while the horizon from
 * where the camera stands still runs past the patch's edge. `verify-assets`
 * measures the one number a visitor on a slow connection actually feels: how
 * many megabytes of imagery stand between opening the page and flying.
 * `verify-plate` holds the caption a photograph carries, which is the part of
 * this simulator most likely to be read by someone who never opens it, and
 * `verify-share` the round trip of a link to a place: all 148 of them write an
 * address that names them back, and a name this build does not know is refused
 * rather than obeyed.
 *
 * What is deliberately *not* here is as informative as what is, and only two
 * scripts are left out. `verify-loi-sweep` is an *instrument*: it prints and
 * asserts nothing, so registering it would add a green line that can never turn
 * red — it is the last one, and the four others that were in that state are now
 * gates above. `verify-camera-filter` replays an attitude recording and wants a
 * path to one, so it cannot start unaided.
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
  ['verify-clock', false],
  ['verify-moon-frame', true],
  ['verify-lunar-ascent', true],
  ['verify-loi', false],
  ['verify-staging', false],
  ['verify-stars', false],
  ['verify-icons', false],
  ['verify-loiter', false],
  ['verify-radial', false],
  ['verify-j3', false],
  ['verify-pads', true],
  ['verify-pad-geometry', false],
  ['verify-surround', false],
  ['verify-cosmos', false],
  ['verify-deep-sky', false],
  ['verify-galaxy', false],
  ['verify-intro', false],
  ['verify-presets', false],
  ['verify-render-budget', false],
  ['verify-sphere-detail', false],
  ['verify-search', false],
  ['verify-flora', false],
  ['verify-site-ground', false],
  ['verify-assets', false],
  ['verify-plate', false],
  ['verify-share', false],
  ['verify-logbook', false],
  ['verify-detail-budget', false],
  ['verify-frame-stats', false],
  ['verify-plate-shelf', false],
  ['verify-ui-pace', false],
  ['verify-shadows', true],
  ['verify-countdown', true],
  ['verify-ground-view', true],
  ['verify-csm', false],
  ['verify-plume', true],
  ['verify-tei-timing', false],
  ['verify-return', false],
  ['verify-heating', false],
  ['verify-plasma', true],
  ['verify-broadcast', true],
  ['verify-approach', false],
  ['verify-entry-guidance', false],
  ['verify-vessels', false],
  ['verify-predict', false],
  ['verify-nrho-cycle', false],
  ['verify-nrho-ephemeris', false],
  ['verify-nrho-family', false],
  ['verify-nrho-capture', false],
  ['verify-nrho-keeping', false],
  ['verify-allocation', true],
  ['verify-programs', false],
  ['verify-audio', false],
  ['verify-expeditions', false],
  ['verify-game', false],
  ['verify-game-opening', false],
  ['verify-product-remake', false],
  ['verify-game-onboarding', false],
  ['verify-game-quality', false],
  ['verify-squadron', false],
  ['verify-pilot', false],
  ['verify-art', false],
  ['verify-preset-clock', false],
  ['verify-lint', false],
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
