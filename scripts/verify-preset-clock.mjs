/**
 * Presets run on the clock they were designed on, whatever time the page booted.
 *
 * The browser boots the simulation at the real current instant; Node — where
 * every other gate runs — boots it at J2000, because `NOW_T` is 0 when there
 * is no `window`. A preset's `launchHour` is measured from J2000 (Apollo 8's
 * 5 h is the Sun 38 degrees up over Kennedy; Apollo 11's 305.29 h is the Sun
 * 21.8 degrees over Tranquility Base). When the boot moved to the present, the
 * ground presets silently began counting their hours from *today*, opened at
 * night, and drew a black pad and an unlit Moon on the live site while every
 * gate stayed green — none of them ever booted anywhere but J2000.
 *
 * So this gate boots where a browser does — decades after J2000 — and starts
 * each ground preset in a child process of its own (a preset starts once per
 * page), then checks the clock it arrived at is the one the preset names.
 */
import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
// 2026-10-03, the day this bug reached the live site: what the browser boots at.
const BROWSER_BOOT = (Date.UTC(2026, 9, 3, 12) - Date.UTC(2000, 0, 1, 12)) / 1000

// The presets' own modules reset the simulation as they load, so the boot is
// set *after* importing them, which is also the order a page runs in: modules
// first, then the clock the browser hands the app.
const child = (id) => `
  const { PRESETS, startPreset } = await import('./src/sim/presets.js')
  const { live, resetSimulation } = await import('./src/sim/live.js')
  resetSimulation(${BROWSER_BOOT})
  if (Math.abs(live.sim.t - ${BROWSER_BOOT}) > 1) throw new Error('the boot clock did not take')
  const preset = PRESETS.find((p) => p.id === '${id}')
  startPreset(preset)
  console.log(JSON.stringify({ t: live.sim.t, hour: preset.launchHour }))
`

let failures = 0
for (const id of ['apollo8-launch', 'artemis-launch', 'apollo11-liftoff']) {
  const run = spawnSync(process.execPath, ['--input-type=module', '-e', child(id)], { cwd: ROOT, encoding: 'utf8', timeout: 120_000 })
  const line = run.stdout.trim().split('\n').pop()
  let got
  try { got = JSON.parse(line) } catch { got = null }
  if (!got) {
    failures++
    console.log(`  FAIL  ${id}: no result (${(run.stderr || '').split('\n').slice(-3).join(' ')})`)
    continue
  }
  const want = got.hour * 3600
  const off = got.t - want
  // standOnPad holds to the hour exactly, then the count runs a frame or two.
  if (Math.abs(off) <= 60) console.log(`  ok    ${id}: booted ${(BROWSER_BOOT / 86400 / 365.25).toFixed(1)} years after J2000, starts at J2000 + ${(got.t / 3600).toFixed(3)} h as designed`)
  else {
    failures++
    console.log(`  FAIL  ${id}: started at J2000 + ${(got.t / 3600).toFixed(1)} h, designed for ${got.hour.toFixed(3)} h (${(off / 86400).toFixed(0)} days off)`)
  }
}
console.log(failures ? `\n  ${failures} failure${failures === 1 ? '' : 's'}` : '\n  PASS')
process.exit(failures ? 1 : 0)
