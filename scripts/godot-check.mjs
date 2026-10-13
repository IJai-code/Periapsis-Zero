#!/usr/bin/env node
/**
 * The Godot game's own checks:  npm run godot:check
 *
 * Runs the game headful (it needs a GPU) once per check and reads what it
 * prints: the HUD sequences that used to hide text, walks along every route
 * a player must take, and full-thrust rams into the big ships. Each check
 * passes or fails on numbers, not screenshots. Needs Godot (GODOT or
 * /Applications/Godot.app) and the assets from scripts/godot-sync.mjs.
 */
import { spawn } from 'node:child_process'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const GODOT = process.env.GODOT ?? '/Applications/Godot.app/Contents/MacOS/Godot'
// A copied project can isolate test progress from the player's real save.
const game = process.env.PZ_GODOT_PROJECT ?? join(new URL('..', import.meta.url).pathname, 'game')

// Every test tool quits the game when it has its answer; output is read
// when the process ends (Godot's stdout is buffered through a pipe). A run
// that has not finished in `ms` is stopped and counts as no result.
let runs = 0
function run(scene, args, until, ms = 120000) {
  const result = join(tmpdir(), `pz-godot-check-${process.pid}-${runs++}.txt`)
  rmSync(result, { force: true })
  return new Promise((resolve) => {
    const p = spawn(GODOT, ['--path', game, `res://scenes/${scene}.tscn`, '--', ...args, '--result', result])
    let out = ''
    let finished = false
    let exitTimer
    const done = (code, signal) => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      clearTimeout(exitTimer)
      clearInterval(poll)
      if (existsSync(result)) out += readFileSync(result, 'utf8')
      if (code !== 0 || signal) out += `\nCHECK ERROR: exit ${code}, signal ${signal}`
      resolve(out)
    }
    const poll = setInterval(() => {
      if (!exitTimer && existsSync(result) && until.test(readFileSync(result, 'utf8'))) {
        exitTimer = setTimeout(() => {
          out += '\nCHECK ERROR: hung after reporting its result'
          p.kill('SIGKILL')
        }, 10000)
      }
    }, 500)
    const timer = setTimeout(() => {
      out += '\nCHECK ERROR: timed out'
      p.kill('SIGKILL')
    }, ms)
    p.stdout.on('data', (d) => { out += d })
    p.stderr.on('data', (d) => { out += d })
    p.on('error', (error) => { out += `\nCHECK ERROR: ${error.message}`; done(null, null) })
    p.on('close', done)
  }).then((out) => {
    const errors = out.match(/(?:SCRIPT ERROR:|CHECK ERROR:|^ERROR:)[^\n]*/gm) ?? []
    if (errors.length) throw new Error(errors.slice(0, 3).join('; '))
    return out
  })
}

const SCENES = ['title', 'prologue_intro', 'prologue_corridor', 'prologue_bridge', 'prologue_hangar', 'prologue_flight',
  'prologue_arrival', 'act1_hearth', 'act1_bay', 'act1_test_flight', 'act1_blackbox', 'act1_descent', 'act1_end']

const checks = [
  // Every scene loads and runs ten seconds without a script error.
  ...SCENES.map((scene) => [`runs ${scene}`, async () => {
    const out = await run(scene, ['--shot', join(tmpdir(), `pz-smoke-${scene}.png`), '--at', '10'], /shot:/, 60000)
    const errors = (out.match(/SCRIPT ERROR: [^\n]*/g) ?? [])
    return [/shot:/.test(out) && errors.length === 0, errors.length ? errors.slice(0, 2).join('; ') : (/shot:/.test(out) ? 'no script errors' : 'did not finish')]
  }]),
  ['crowd never walks through anything', async () => {
    const out = await run('act1_hearth', ['--crowdtest'], /CROWDTEST frames/)
    const m = out.match(/CROWDTEST frames (\d+) inside solid (\d+)/)
    const sees = /probe sees bench true/.test(out)
    return [Boolean(m) && sees && Number(m[2]) === 0 && Number(m[1]) > 1000, m ? `${m[0]}, probe ${sees ? 'sees' : 'MISSES'} a bench` : 'no result']
  }],
  ['Black Box plays through: find, tractor, fight, reveal', async () => {
    const out = await run('act1_blackbox', ['--beat', 'field', '--autofight', '--verify-exit'], /BLACKBOX (reveal|ship lost)/, 240000)
    const errors = (out.match(/SCRIPT ERROR: [^\n]*/g) ?? [])
    const ok = /BLACKBOX recorder aboard/.test(out) && /BLACKBOX reveal after 4 kills/.test(out) && errors.length === 0
    return [ok, errors.length ? errors[0] : ((out.match(/BLACKBOX [^\n]*/g) ?? ['no result']).join(', '))]
  }],
  ['Down the Well plays through: every marker, no crash, lands, meets Renn', async () => {
    const out = await run('act1_descent', ['--autofly', '--verify-exit'], /DESCENT (passed|ship lost)/, 360000)
    const errors = (out.match(/SCRIPT ERROR: [^\n]*/g) ?? [])
    const m = out.match(/DESCENT markers (\d+) hit (\d+) missed, (\d+) bumps/)
    const ok = Boolean(m) && m[2] === '0' && m[3] === '0' && /DESCENT passed/.test(out) && /prompt '\[E\] Talk to Renn'/.test(out) && errors.length === 0
    return [ok, errors.length ? errors[0] : ((out.match(/DESCENT [^\n]*/g) ?? ['no result']).join(', '))]
  }],
  ['player movement and conversation headings', async () => {
    const out = await run('act1_hearth', ['--movementtest', '--nohd'], /MOVEMENTTEST \d+ failed/)
    const m = out.match(/MOVEMENTTEST (\d+) failed/)
    return [m && m[1] === '0', (out.match(/MOVEMENTTEST FAIL[^\n]*/g) ?? []).join('; ') || (m ? 'all ok' : 'no result')]
  }],
  ['HUD text survives cutscenes and clears', async () => {
    const out = await run('ship_preview', ['--hudtest'], /HUDTEST \d+ failed/)
    const m = out.match(/HUDTEST (\d+) failed/)
    return [m && m[1] === '0', (out.match(/HUDTEST (FAIL.*)/g) ?? []).join('; ') || (m ? 'all ok' : 'no result')]
  }],
  ...[
    ['prologue_corridor', 'corridor_door', 'Open the door'],
    ['prologue_corridor', 'corridor_back', null],
    ['prologue_bridge', 'bridge_hale', 'Talk to Captain Hale'],
    ['prologue_bridge', 'bridge_chair', 'Sit in'],
    ['prologue_hangar', 'hangar_ladder', 'Climb into the Kestrel'],
    ['act1_hearth', 'hearth_mara', 'Talk to Mara'],
  ].map(([scene, plan, prompt]) => [`walk ${plan}`, async () => {
    const out = await run(scene, ['--walktest', plan], /WALKTEST final/)
    const line = (out.match(/WALKTEST final .*/) ?? [''])[0].replace(/\[[^\]]*\]/g, '')
    if (!line) return [false, 'no result']
    // corridor_back walks at the aft wall: passing means it held (z stays < 0).
    if (!prompt) return [/\(-?[\d.]+, -?[\d.]+, -[\d.]+\)/.test(line), line]
    return [line.includes(prompt), line]
  }]),
  ...[
    ['act1_test_flight', 'ram_station', []],
    ['prologue_flight', 'ram_aster', ['--beat', 'ambush']],
  ].map(([scene, plan, extra]) => [`fly ${plan}`, async () => {
    const out = await run(scene, ['--flytest', plan, ...extra], /FLYTEST/)
    const m = out.match(/FLYTEST closest ([\d.]+) m, frames inside solid (\d+)/)
    return [m && Number(m[2]) === 0, m ? m[0] : 'no result']
  }]),
]

// Godot learns new script classes on import; a stale class list would make
// every test script fail to load and every check wait out its timeout.
await new Promise((resolve, reject) => {
  const p = spawn(GODOT, ['--headless', '--path', game, '--import'])
  let out = ''
  p.stdout.on('data', d => { out += d })
  p.stderr.on('data', d => { out += d })
  p.on('error', reject)
  p.on('close', code => {
    if (code !== 0 || /SCRIPT ERROR:|^ERROR:/m.test(out)) reject(new Error(`Godot import failed (${code}): ${out}`))
    else resolve()
  })
})

const filters = process.argv.slice(2)
const selected = checks.filter(([name]) => !filters.length || filters.some(f => name.includes(f)))
if (!selected.length) throw new Error('No Godot checks match the requested filters')
let failed = 0
for (const [name, check] of selected) {
  try {
    const [ok, detail] = await check()
    if (!ok) failed++
    console.log(`${ok ? '✓' : '✗'} ${name}  ${detail}`)
  } catch (error) {
    failed++
    console.log(`✗ ${name}  ${error.message}`)
  }
}
console.log(failed ? `${failed} of ${selected.length} Godot checks failed.` : `${selected.length} Godot checks passed.`)
process.exit(failed ? 1 : 0)
