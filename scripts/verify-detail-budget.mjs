/**
 * The detail-budget gate: the last lever is spent honestly and refunds itself.
 *
 * The resolution governor now has a second lever — tessellation — and this
 * gate holds the three claims that make it safe to ship. First, the spend is
 * ordered and bounded: the steps are a strict ladder, out-of-range writes are
 * refused, and a no-op write tells nobody. Second, the cap composes with the
 * LOD ladder exactly as documented — clamping refinement without fighting the
 * ladder's hysteresis, and never capping the Moon below its near-field floor.
 * Third, the policy is what the comment says it is: escalation only at the
 * pixel floor, relief only back at the pixel ceiling.
 *
 * The wiring checks pin the four surfaces: the governor that spends it, the
 * two LOD sites that honour it (Planets, which also re-aims every body when
 * the cap moves, and Moon, whose near field is exempt), and the Diagnostics
 * row that reports it. Everything runs on the real modules — the same
 * doubles-over-ESM pattern the logbook gate uses.
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

/* 1. The budget module: ladder, bounds, subscription. */
const budget = await import(join(ROOT, 'src/gfx/detailBudget.js'))
const ladder = budget.DETAIL_STEPS
if (ladder.length === budget.MAX_DETAIL_STEP + 1 && ladder.every((v, i) => i === 0 || v < ladder[i - 1]))
  pass(`detail ladder is strict and descending: [${ladder.join(', ')}]`)
else fail(`detail ladder wrong: [${ladder.join(', ')}]`)
if (ladder[0] === 4) pass('step 0 is the full ladder (no cap)')
else fail(`step 0 caps at ${ladder[0]}, want 4 (uncapped)`)

let hits = 0
const un = budget.subscribeDetail(() => hits++)
budget.setDetailStep(99) // out of range: refused, no emit
budget.setDetailStep(budget.detailStep()) // no-op: no emit
if (budget.detailStep() === 0 && hits === 0) pass('out-of-range and no-op writes change and emit nothing')
else fail(`out-of-range write leaked: step=${budget.detailStep()} hits=${hits}`)
budget.setDetailStep(2)
budget.setDetailStep(1)
budget.setDetailStep(0)
un()
budget.setDetailStep(1)
if (hits === 3) pass('subscribers hear real changes, exactly once, until they leave')
else fail(`subscription hits = ${hits}, want 3`)
budget.setDetailStep(0)

/* 2. The cap composes with the LOD ladder. */
const { SPHERE_SEGMENTS, SILHOUETTE_ERROR } = await import(join(ROOT, 'src/gfx/sphereDetail.js'))
// A body whose silhouette asks for the top of the ladder.
const pixelsForTop = 1e6
{
  const full = budget.cappedLevel(pixelsForTop, -1, 4)
  const capped = budget.cappedLevel(pixelsForTop, -1, 2)
  if (full === 4 && capped === 2) pass('cap clamps refinement: 512-segment body draws 128 under the cap')
  else fail(`cap composition wrong: full=${full} capped=${capped}`)
  // A cap is enforced immediately, bypassing the ladder's coarsening
  // hysteresis — that is what "applied after the ladder" means, and it is
  // what makes a cap spend take effect in one frame everywhere.
  const held = budget.cappedLevel(pixelsForTop, 1, 2)
  if (held === 2) pass('the cap overrides hysteresis: a withdrawn rung is withdrawn at once')
  else fail(`cap did not override hysteresis: held=${held}`)
  // With no cap (step 0), the ladder's own hysteresis is untouched: a body
  // whose silhouette shrank just inside the hysteresis band stays put.
  // 224 px of silhouette puts the raw level at 1 with its error (0.27 px)
  // inside the 0.24–0.30 px hold band.
  const px = 224
  const heldNoCap = budget.cappedLevel(px, 2, 4)
  if (heldNoCap === 2) pass('with no cap, the ladder hysteresis still holds a shrinking body')
  else fail(`hysteresis broken with no cap: held=${heldNoCap}`)
  // The binding-edge guarantee: at the silhouette size where the cap starts
  // to bind, the capped level's error is still within the ladder's own
  // tolerance — the cap never costs more than sub-pixel error at the edge
  // where it takes over.
  const bindingPx = SILHOUETTE_ERROR / (1 - Math.cos(Math.PI / SPHERE_SEGMENTS[2]))
  const atEdge = budget.cappedLevel(bindingPx, -1, 2)
  const edgeErr = bindingPx * (1 - Math.cos(Math.PI / SPHERE_SEGMENTS[atEdge]))
  if (atEdge === 2 && edgeErr <= SILHOUETTE_ERROR * 1.5)
    pass(`at the binding edge the capped error is still sub-pixel (${edgeErr.toFixed(2)} px)`)
  else fail(`binding edge wrong: level=${atEdge} err=${edgeErr.toFixed(2)} px`)
}
// The Moon's exemption is a property of the call site, not the budget — check
// the call site passes the near-field floor by construction.
{
  const moonSrc = readFileSync(join(ROOT, 'src/components/Moon.jsx'), 'utf8')
  const m = moonSrc.match(/const next = near \? 4 : cappedLevel\([^)]*\)/)
  if (m) pass(`Moon near field exempt from the cap: ${m[0].slice(0, 60)}…`)
  else fail('Moon.jsx lost its near-field exemption')
}

/* 3. The policy: escalate only at the floor, relieve only at the ceiling. */
const SLOW = 21
const FAST = 17.2
const slow = (step, atFloor, atCeiling) =>
  budget.nextDetailStep(step, SLOW + 1, { atFloor, atCeiling, slowMs: SLOW, fastMs: FAST })
const fast = (step, atFloor, atCeiling) =>
  budget.nextDetailStep(step, FAST - 1, { atFloor, atCeiling, slowMs: SLOW, fastMs: FAST })
const mid = (step) => budget.nextDetailStep(step, 19, { atFloor: true, atCeiling: true, slowMs: SLOW, fastMs: FAST })

if (slow(0, false, false) === 0) pass('slow but not at the pixel floor: pixels move first, budget untouched')
else fail('budget spent while pixels were still available')
if (slow(0, true, false) === 1) pass('slow at the floor: one rung spent')
else fail('budget did not escalate at the floor')
if (slow(1, true, false) === 2) pass('still slow at the floor: second rung spent')
else fail('budget did not escalate to step 2')
if (slow(2, true, false) === 2) pass('the ladder has a bottom: step 2 is the last spend')
else fail('policy escalated past the ladder')
if (fast(2, false, true) === 1) pass('fast at the pixel ceiling: one rung refunded')
else fail('budget did not relieve at the ceiling')
if (fast(1, false, true) === 0) pass('still fast: fully refunded')
else fail('budget did not relieve to zero')
if (fast(2, false, false) === 2) pass('fast but pixels are not back at the ceiling: no refund')
else fail('budget refunded while pixels were still spent')
if (mid(1) === 1) pass('comfortable frames change nothing')
else fail('policy moved in the comfortable band')
if (
  slow(1, false, false) === 1 &&
  fast(1, true, true) === 0 &&
  fast(1, false, false) === 1 &&
  slow(1, true, false) === 2
)
  pass('the flags decide: the same frame time escalates only at the floor and relieves only at the ceiling')
else fail('policy is not flag-gated as documented')

/* 4. The wiring: governor, LOD sites, Diagnostics. */
const wiring = [
  ['src/components/Resolution.jsx', 'setDetailStep', 'the governor spends and refunds the budget'],
  ['src/components/Resolution.jsx', 'nextDetailStep', 'the governor uses the shared policy'],
  ['src/components/Planets.jsx', 'cappedLevel', 'planets honour the cap'],
  ['src/components/Planets.jsx', 'cap !== b.cap', 'a cap change re-aims every body the same frame'],
  ['src/components/Moon.jsx', 'cappedLevel', 'the Moon honours the cap in its far field'],
  ['src/components/Moon.jsx', 'near ? 4 :', 'the near Moon keeps full tessellation'],
  ['src/ui/Diagnostics.jsx', 'subscribeDetail', 'the report shows what the machine spent'],
]
for (const [file, needle, why] of wiring) {
  const text = readFileSync(join(ROOT, file), 'utf8')
  if (text.includes(needle)) pass(`${file}: ${why}`)
  else fail(`${file} lost its wiring (${needle})`)
}

/* 5. The full ladder stays the default on every surface a pilot touches. */
const resSrc = readFileSync(join(ROOT, 'src/components/Resolution.jsx'), 'utf8')
if (!resSrc.includes('setDetailStep(1)') && !resSrc.includes('setDetailStep(2)'))
  pass('the governor never ships a hard-coded distress level')
else fail('governor hard-codes a distress level')

console.log(failures ? `\n  ${failures} failure${failures === 1 ? '' : 's'}` : '\n  PASS')
process.exit(failures ? 1 : 0)
