/**
 * The UI-pace gate: one clock for the HUD's readouts, and the last rung of
 * the distress ladder is spent honestly.
 *
 * Two claims are held here, both born of the same report — a machine lagging
 * on animations.
 *
 * First, the pace. Thirteen components outside the canvas each owned a
 * `setInterval` between 80 and 250 ms, each firing React updates from its own
 * timer. Individually small; together, a dozen alarm clocks going off beside
 * the frame loop, waking the main thread on schedules nothing coordinated.
 * They share one 110 ms pulse now (`ui/uiClock.js`), each reader taking the
 * steps that are its own. This gate holds the pulse's arithmetic (a reader
 * with `every = n` hears exactly every nth step), the lifecycle (one interval
 * while anyone listens, none when the last leaves), and the wiring: no
 * migrated component still owns an interval, and the clock owns exactly one.
 *
 * Second, the rung. The resolution governor could walk pixels to their floor
 * and tessellation to its, and then give up — while the ground beam's shadow
 * map, the one always-on per-frame cost it could never reach, ran at its full
 * 4,096 texels regardless. `gfx/groundBudget.js` adds the last lever: relief
 * halves the map to 2,048 after pixels and tessellation are both spent,
 * refunds out of comfort like every other lever, and *Full resolution*
 * releases it. The ceiling in `sunlight.js` is asserted unchanged — this is
 * an emergency lever, not a lowering of the default; the sim keeps every
 * detail a machine can pay for. The order is pinned: pixels, then geometry,
 * then the shadow, and refunds in the reverse order.
 */

import { readFileSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(here, '..')
let failures = 0
const fail = (msg) => {
  failures++
  console.log(`  FAIL  ${msg}`)
}
const pass = (msg) => console.log(`  ok    ${msg}`)

/* ---------------------------------------------------------------- *
 * 1. The clock: arithmetic, lifecycle, one interval.
 * ---------------------------------------------------------------- */

/* Fake the timer globals so the pulse is pumped by hand, deterministically. */
const realSetInterval = globalThis.setInterval
const realClearInterval = globalThis.clearInterval
let pump = null
let cleared = false
globalThis.setInterval = (fn) => {
  pump = fn
  return 1
}
globalThis.clearInterval = () => {
  cleared = true
}

const clock = await import(join(ROOT, 'src/ui/uiClock.js'))

if (clock.UI_PULSE_MS === 110) pass('the pulse is 110 ms — the fastest reader the HUD had')
else fail(`UI_PULSE_MS is ${clock.UI_PULSE_MS}, want 110`)
if (typeof clock.subscribeUiTick === 'function') pass('subscribeUiTick is exported')
else fail('subscribeUiTick is not exported')

/* Lifecycle: the first reader starts the one timer. */
let soloCount = 0
const unSolo = clock.subscribeUiTick(() => soloCount++, 1)
if (pump !== null) pass('the first subscriber starts the one timer')
else fail('no timer started for the first subscriber')

/* every = 1 hears every step. */
let n1 = 0
const un1 = clock.subscribeUiTick(() => n1++, 1)
for (let i = 0; i < 6; i++) pump()
if (n1 === 6) pass('every = 1 hears every pulse')
else fail(`every = 1 heard ${n1} of 6 pulses`)

/* every = 2 hears every second step; a late joiner still gets its own steps. */
let n2 = 0
const un2 = clock.subscribeUiTick(() => n2++, 2)
for (let i = 0; i < 6; i++) pump()
if (n2 === 3) pass('every = 2 hears exactly every second pulse')
else fail(`every = 2 heard ${n2} of 6 pulses`)

/* every = 3, a third reader, independence. */
let n3 = 0
const un3 = clock.subscribeUiTick(() => n3++, 3)
for (let i = 0; i < 6; i++) pump()
if (n3 === 2) pass('every = 3 hears exactly every third pulse')
else fail(`every = 3 heard ${n3} of 6 pulses`)

un1()
un2()
un3()
pump()
/* n1, n2, n3 froze at their totals (18, 6, 2) while the still-subscribed reader advanced. */
if (n1 === 18 && n2 === 6 && n3 === 2 && soloCount === 19)
  pass('unsubscribed readers hear nothing further; the remaining reader keeps hearing')
else fail(`an unsubscribe did not take effect: ${n1}/${n2}/${n3}, solo=${soloCount}`)

/* The last reader leaving stops the timer; a new one restarts it. */
unSolo()
if (cleared) pass('the last reader leaving clears the one timer')
else fail('the timer survived its last reader')
cleared = false
pump = null
clock.subscribeUiTick(() => {}, 1)
if (pump !== null && !cleared) pass('a new reader restarts the timer')
else fail('the timer did not restart for a new reader')

globalThis.setInterval = realSetInterval
globalThis.clearInterval = realClearInterval

/* The clock owns exactly one interval and one clear. */
const clockSrc = readFileSync(join(ROOT, 'src/ui/uiClock.js'), 'utf8')
const intervals = clockSrc.match(/setInterval\(/g)?.length ?? 0
const clears = clockSrc.match(/clearInterval\(/g)?.length ?? 0
if (intervals === 1) pass('the clock file contains exactly one setInterval')
else fail(`uiClock.js has ${intervals} setInterval calls, want exactly 1`)
if (clears === 1) pass('the clock file contains exactly one clearInterval')
else fail(`uiClock.js has ${clears} clearInterval calls, want exactly 1`)

/* ---------------------------------------------------------------- *
 * 2. The wiring: no migrated component owns an interval any more.
 * ---------------------------------------------------------------- */

const MIGRATED = [
  'src/ui/Telemetry.jsx',
  'src/ui/FlightStrip.jsx',
  'src/ui/BurnPanel.jsx',
  'src/ui/FlyHud.jsx',
  'src/ui/Commentary.jsx',
  'src/ui/CaptureStatus.jsx',
  'src/ui/GoForLaunch.jsx',
  'src/ui/LagrangeMarkers.jsx',
  'src/ui/Hud.jsx',
  'src/ui/ShipTelemetry.jsx',
  'src/ui/Broadcast.jsx',
  'src/ui/Geophysics.jsx',
  'src/ui/NodePanel.jsx',
]
let migrated = 0
for (const file of MIGRATED) {
  const text = readFileSync(join(ROOT, file), 'utf8')
  if (!text.includes('subscribeUiTick(')) {
    fail(`${file} does not ride the shared pulse`)
    continue
  }
  if (text.includes('setInterval(')) {
    fail(`${file} still owns its own interval`)
    continue
  }
  migrated++
}
if (migrated === MIGRATED.length)
  pass(`all ${MIGRATED.length} readers ride the shared pulse and own no timer`)

/* Diagnostics keeps its own 1 Hz panel refresh — deliberately not a HUD readout. */
const diagSrc = readFileSync(join(ROOT, 'src/ui/Diagnostics.jsx'), 'utf8')
if (!diagSrc.includes('subscribeUiTick(') && diagSrc.includes('setInterval'))
  pass('Diagnostics keeps its once-a-second panel refresh, outside the readout pulse')
else fail('Diagnostics was migrated or lost its refresh')

/* ---------------------------------------------------------------- *
 * 3. The shadow rung: the flag, the order, the unchanged ceiling.
 * ---------------------------------------------------------------- */

const budget = await import(join(ROOT, 'src/gfx/groundBudget.js'))
if (budget.shadowRelief() === false) pass('relief starts unspent — the default is the full map')
else fail('relief did not start unspent')

let hits = 0
const un = budget.subscribeShadowRelief(() => hits++)
budget.setShadowRelief(false) // no-op: no emit
if (budget.shadowRelief() === false && hits === 0) pass('a no-op write tells nobody')
else fail(`no-op write emitted: relief=${budget.shadowRelief()} hits=${hits}`)
budget.setShadowRelief(true)
budget.setShadowRelief(true) // no-op
if (budget.shadowRelief() === true && hits === 1) pass('spending emits exactly once')
else fail(`spend emitted ${hits} times`)
if (budget.shadowRelief() === true) pass('the flag stays boolean through re-writes')
else fail('the flag broke')
budget.setShadowRelief(false)
budget.setShadowRelief(0)
if (budget.shadowRelief() === false && hits === 2) pass('refunding emits exactly once')
else fail(`refund emitted wrongly: relief=${budget.shadowRelief()} hits=${hits}`)
un()
budget.setShadowRelief(true)
if (hits === 2) pass('subscribers hear real changes, exactly once, until they leave')
else fail(`subscription hits = ${hits}, want 2`)
budget.setShadowRelief(false)

/* The ceiling is untouched: relief is an emergency lever, not a new default. */
const sunSrc = readFileSync(join(ROOT, 'src/gfx/sunlight.js'), 'utf8')
if (/SHADOW_TEXELS\s*=\s*4096/.test(sunSrc))
  pass('the shadow map ceiling is still 4,096 texels — nothing was toned down')
else fail('sunlight.js no longer fixes SHADOW_TEXELS at 4096')

/* The governor spends it last, refunds it first, and releases it under Full resolution.
   Scoped to the governor's own loop: the context-loss recovery also spends the
   shadow rung, deliberately first, because a driver that just dropped its
   context is known to be in trouble in a way a slow window does not prove. */
const resSrc = readFileSync(join(ROOT, 'src/components/Resolution.jsx'), 'utf8')
const governorBody = resSrc.slice(resSrc.indexOf('useFrame(() => {'))
const panicSpend = governorBody.indexOf('setShadowRelief(true)')
const tessSpend = governorBody.indexOf('detailCap() < MAX_DETAIL_STEP')
if (panicSpend > -1 && tessSpend > -1 && panicSpend > tessSpend)
  pass('the shadow is spent only after tessellation is spent')
else fail('the lever order is wrong or missing')

const refundShadow = resSrc.indexOf('else if (shadowRelief())')
const refundTess = resSrc.indexOf('else if (detailCap() > 0)')
if (refundShadow > -1 && refundTess > -1 && refundShadow < refundTess)
  pass('the shadow is refunded first, out of comfort, before tessellation')
else fail('the refund order is wrong or missing')

const fullBlock = resSrc.slice(resSrc.indexOf('if (!full) return'), resSrc.indexOf('}, [full, maxDpr, setDpr])'))
if (fullBlock.includes('setShadowRelief(false)') && fullBlock.includes('setDetailStep(0)'))
  pass('Full resolution releases the shadow rung with everything else')
else fail('Full resolution does not release the shadow rung')

/* The light remounts on a relief change, and Diagnostics reports the spend. */
const glSrc = readFileSync(join(ROOT, 'src/components/GroundLight.jsx'), 'utf8')
if (glSrc.includes('key={shadowKey}') && glSrc.includes('subscribeShadowRelief'))
  pass('GroundLight remounts its light when the map size changes — three fixes it at creation')
else fail('GroundLight lost the relief remount')
if (diagSrc.includes('shadow map halved') && diagSrc.includes('subscribeShadowRelief'))
  pass('Diagnostics reports the shadow rung in the bug-report copy')
else fail('Diagnostics does not report the shadow rung')

/* The ladder below is still guarded by its own gate; this one only adds. */
const detailSrc = readFileSync(join(ROOT, 'src/gfx/detailBudget.js'), 'utf8')
if (/DETAIL_STEPS\s*=\s*\[4,\s*3,\s*2\]/.test(detailSrc))
  pass('the tessellation ladder is unchanged — the new rung sits below it, not instead of it')
else fail('detailBudget.js ladder changed under this gate')

console.log(failures ? `\n  ${failures} failure${failures === 1 ? '' : 's'}` : '\n  PASS')
process.exit(failures ? 1 : 0)
