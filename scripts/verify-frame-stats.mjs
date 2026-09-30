/**
 * The frame-stats gate: one sampler, an honest summary, and no second loop.
 *
 * Frame times are now measured once — by the resolution governor, which
 * already computed every delta — into a fixed ring, and Diagnostics reads a
 * summary of it. This gate holds the ring's arithmetic and the claims the UI
 * makes about it: percentiles of a distribution that skips sleeping-tab gaps,
 * wraparound, the reset, and the copyable report containing what the panel
 * shows. The DOM doubles are the same pattern the render-budget gate uses.
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

const stats = await import(join(ROOT, 'src/gfx/frameStats.js'))

/* 1. The empty ring says nothing. */
if (stats.summarizeFrameTimes() === null) pass('empty ring: no summary')
else fail('empty ring produced a summary')
if (stats.frameCount() === 0) pass('empty ring: count zero')
else fail('empty ring not empty')

/* 2. Percentiles of a known distribution. */
for (let i = 0; i < 100; i++) stats.pushFrameTime(16 + (i % 10)) // 16..25 ms, 10 each
{
  const s = stats.summarizeFrameTimes()
  // p50 lands inside the middle decile; p95 inside the top.
  if (s && s.p50 >= 20 && s.p50 <= 21 && s.p95 === 25 && s.fps === Math.round(1000 / s.p50))
    pass(`percentiles of a known distribution: p50 ${s.p50} ms, p95 ${s.p95} ms`)
  else fail(`summary wrong: ${JSON.stringify(s)}`)
  if (s.kept === 100) pass('every sample kept when none are outliers')
  else fail(`kept ${s.kept}, want 100`)
}

/* 3. Gaps are excluded, not clamped: a slept tab is not a slow frame. */
stats.resetFrameTimes()
for (let i = 0; i < 50; i++) stats.pushFrameTime(16.7)
stats.pushFrameTime(45000) // the tab slept here
for (let i = 0; i < 50; i++) stats.pushFrameTime(16.7)
{
  const s = stats.summarizeFrameTimes()
  if (s && s.kept === 100 && s.p95 <= 17 && s.p50 <= 17)
    pass('a 45 s gap is excluded, not averaged in')
  else fail(`gap handling wrong: ${JSON.stringify(s)}`)
}

/* 4. The cut is a dial, not a rule: a half-second stutter sits between the
      default cut and a tight one, so tightening the dial drops exactly it. */
{
  stats.resetFrameTimes()
  for (let i = 0; i < 50; i++) stats.pushFrameTime(16.7)
  stats.pushFrameTime(500) // real stutter: kept at the 2 s cut, dropped at 17 ms
  for (let i = 0; i < 50; i++) stats.pushFrameTime(16.7)
  const loose = stats.summarizeFrameTimes(2000)
  const tight = stats.summarizeFrameTimes(17)
  if (loose && tight && loose.kept === 101 && tight.kept === 100 && tight.p95 <= 17)
    pass(`the cut trims only what it is asked to (${loose.kept} kept at 2 s, ${tight.kept} at 17 ms)`)
  else fail(`cut behaviour wrong: ${JSON.stringify({ loose, tight })}`)
}

/* 5. The ring wraps and stays fixed-size. */
stats.resetFrameTimes()
for (let i = 0; i < 2000; i++) stats.pushFrameTime(16.7)
{
  const s = stats.summarizeFrameTimes()
  // Float32 storage rounds 16.7 to 16.70000076…: compared with a tolerance,
  // because the ring is typed on purpose and the test should know that.
  if (stats.frameCount() === 512 && s && s.kept === 512 && Math.abs(s.p50 - 16.7) < 1e-3)
    pass('2,000 pushes later the ring holds exactly 512 good samples')
  else fail(`wrap wrong: count=${stats.frameCount()} kept=${s?.kept} p50=${s?.p50}`)
}

/* 6. Reset forgets. */
stats.resetFrameTimes()
if (stats.summarizeFrameTimes() === null && stats.frameCount() === 0) pass('reset forgets everything')
else fail('reset left state behind')

/* 7. The wiring: the governor feeds it, Diagnostics reads it, and the old
      second rAF loop is gone. */
const res = readFileSync(join(ROOT, 'src/components/Resolution.jsx'), 'utf8')
if (res.includes('pushFrameTime(dt)')) pass('the governor feeds the shared ring from the delta it already computed')
else fail('governor does not feed the ring')
if (res.includes('resetFrameTimes()')) pass('a waking tab resets the ring')
else fail('no reset on visibility change')
const diag = readFileSync(join(ROOT, 'src/ui/Diagnostics.jsx'), 'utf8')
if (diag.includes('summarizeFrameTimes()')) pass('Diagnostics reads the shared summary')
else fail('Diagnostics does not read the summary')
if (!diag.includes('requestAnimationFrame')) pass('the second rAF loop is gone from Diagnostics')
else fail('Diagnostics still runs its own rAF loop')
if (diag.includes('p95')) pass('the report carries the p95 the audit asked for')
else fail('no p95 in the report')

console.log(failures ? `\n  ${failures} failure${failures === 1 ? '' : 's'}` : '\n  PASS')
process.exit(failures ? 1 : 0)
