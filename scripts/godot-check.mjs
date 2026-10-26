#!/usr/bin/env node
/**
 * The Godot game's own checks:  npm run godot:check
 *
 * Runs the game once per check and reads what it prints. Headless by
 * default: no window, so a run never takes the screen or the keyboard from
 * whoever is using the machine (on macOS a windowed Godot brings itself to
 * the front however it is launched). PZ_GODOT_HEADFUL=1 shows the window.
 * What it prints: the HUD sequences that used to hide text, walks along every route
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
    const window = process.env.PZ_GODOT_HEADFUL ? [] : ['--headless']
    const p = spawn(GODOT, [...window, '--path', game, `res://scenes/${scene}.tscn`, '--', ...args, '--result', result])
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
  'prologue_arrival', 'act1_hearth', 'act1_bay', 'act1_test_flight', 'act1_blackbox', 'act1_descent', 'act1_end',
  'act2_lowdeck', 'act2_rim', 'reach']

const checks = [
  // Every scene loads and runs ten seconds without a script error.
  ...SCENES.map((scene) => [`runs ${scene}`, async () => {
    const out = await run(scene, ['--shot', join(tmpdir(), `pz-smoke-${scene}.png`), '--at', '10'], /shot:/, 60000)
    const errors = (out.match(/SCRIPT ERROR: [^\n]*/g) ?? [])
    return [/shot:/.test(out) && errors.length === 0, errors.length ? errors.slice(0, 2).join('; ') : (/shot:/.test(out) ? 'no script errors' : 'did not finish')]
  }]),
  ['rendezvous: docks with the Calla by her orbit', async () => {
    const out = await run('act2_rim', ['--act2stage', '2', '--job', 'dock', '--near', '--autofight'], /RENDEZVOUS (docked|struck)/, 180000)
    return [/RENDEZVOUS docked/.test(out), (out.match(/RENDEZVOUS \w+/g) ?? ['no result']).join(', ')]
  }],
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
  ['the Reach: walk round Hearthstone and never fall through', async () => {
    const out = await run('reach', ['--reachwalk'], /REACHWALK/)
    const m = out.match(/REACHWALK walked (\d+) m, lowest (-?[\d.]+) m above ground, on floor (\w+), health (\d+), dead (\w+)/)
    return [Boolean(m) && Number(m[1]) > 80 && Number(m[2]) > -1.5 && m[3] === 'true' && m[5] === 'false', m ? m[0] : 'no result']
  }],
  ['the Reach: walk round Hearthstone in third person and never fall through', async () => {
    const out = await run('reach', ['--reachwalk', '--third'], /REACHWALK/)
    const m = out.match(/REACHWALK walked (\d+) m, lowest (-?[\d.]+) m above ground, on floor (\w+), health (\d+), dead (\w+)/)
    return [Boolean(m) && Number(m[1]) > 80 && Number(m[2]) > -1.5 && m[3] === 'true' && m[5] === 'false', m ? m[0] : 'no result']
  }],
  ['the Reach: the map marks sphere-of-influence crossings', async () => {
    const out = await run('reach', ['--maptest'], /MAPTEST approaches/)
    const near = out.match(/MAPTEST path (\d+) crossings (\d+) inside '(\w*)'/)
    const far = out.match(/MAPTEST far path (\d+) crossings (\d+) first '([^']*)' inside '(\w*)'/)
    const appr = out.match(/MAPTEST approaches (\d+) \[([^\]]*)\]/)
    const names = appr ? appr[2].split(', ') : []
    const ok = Boolean(near) && Number(near[1]) > 0 && near[3] === 'hearthstone'
      && Boolean(far) && Number(far[2]) >= 1 && far[3] === 'Hearthstone' && far[4] === ''
      && Boolean(appr) && names.includes('hearthstone') && names.includes('wanderer')
    return [ok, near && far && appr ? `${near[0]}; ${far[0]}; ${appr[0]}` : 'no result']
  }],
  ['the Reach: lift off, leave Hearthstone, the frame switch is seamless', async () => {
    const out = await run('reach', ['--reachfly'], /REACHFLY/)
    const m = out.match(/REACHFLY rested on the pad (\w+), left Hearthstone (\w+) after (\d+) s, frame now (\w+), jump at switch ([\d.-]+) m ([\d.-]+) m\/s, hull (\d+)/)
    return [Boolean(m) && m[1] === 'true' && m[2] === 'true' && Number(m[5]) >= 0 && Number(m[5]) < 0.01 && Number(m[6]) < 0.01 && m[7] === '100', m ? m[0] : 'no result']
  }],
  ...[
    ['mara', ['hearth_crash']],
    ['okafor', ['hearth_codes', 'hearth_lantern', 'hearth_choir']],
    ['fen', ['hearth_phantom', 'ph_photo']],
  ].map(([who, facts]) => [`the Reach: talk to ${who} and learn ${facts.join(', ')}`, async () => {
    const out = await run('reach', ['--talktest', who, '--talkauto'], /TALKTEST/)
    const line = (out.match(/TALKTEST [^\n]*/) ?? ['no result'])[0]
    return [facts.every(f => line.includes(`"${f}"`)) && /player enabled true/.test(line), line]
  }]),
  ['the Reach: sit by the fire, sleep, wake, stand', async () => {
    const out = await run('reach', ['--firetest'], /FIRETEST/)
    const m = out.match(/FIRETEST slept (\d+) s warp after (\d+) stood (\w+) talking (\w+)/)
    const ok = Boolean(m) && Number(m[1]) > 20 && m[2] === '1' && m[3] === 'true' && m[4] === 'false'
    return [ok, m ? m[0] : (out.match(/FIRETEST[^\n]*/) ?? ['no result'])[0]]
  }],
  ['the Reach: the campfire burns down, and a new morning relights it', async () => {
    const out = await run('reach', ['--burntest'], /BURNTEST/)
    const m = out.match(/BURNTEST logs ([\d.]+) ([\d.]+) ([\d.]+) twigs (\w+) (\w+) flames (\w+) light ([\d.]+) ([\d.]+) reset ([\d.]+) relit (\w+)/)
    const ok = Boolean(m) && Number(m[1]) > 0.98 && Number(m[2]) < 0.9 && Number(m[3]) < 0.65
      && m[4] === 'true' && m[5] === 'false' && m[6] === 'false'
      && Number(m[8]) < Number(m[7]) * 0.5 && Number(m[9]) > 0.98 && m[10] === 'true'
    return [ok, m ? m[0] : (out.match(/BURNTEST[^\n]*/) ?? ['no result'])[0]]
  }],
  ['the Reach: stepping out on Ashfall never drops you through the world', async () => {
    const out = await run('reach', ['--leavetest'], /LEAVETEST/, 180000)
    const m = out.match(/LEAVETEST ref (\w+) planet (\w+) above (-?[\d.]+) under (-?[\d.]+) on floor (\w+) enabled (\w+) died (\w+) solid (\w+)/)
    const ok = Boolean(m) && m[1] === 'ashfall' && m[2] === 'true' && Number(m[3]) > -0.6
      && Number(m[4]) > -1.0 && m[5] === 'true' && m[6] === 'true' && m[7] === 'false' && m[8] === 'true'
    return [ok, m ? m[0] : (out.match(/LEAVETEST[^\n]*/) ?? ['no result'])[0]]
  }],
  ['the Reach: the map opens, paints and closes', async () => {
    const out = await run('reach', ['--mapui'], /MAPUI/)
    const m = out.match(/MAPUI opened (\w+) painted (\w+) closed (\w+) enabled (\w+)/)
    const ok = Boolean(m) && m[2] === 'true' && m[3] === 'true' && m[4] === 'true'
    return [ok, m ? m[0] : (out.match(/MAPUI[^\n]*/) ?? ['no result'])[0]]
  }],
  ['the Reach: the villagers keep their own routines', async () => {
    const out = await run('reach', ['--npctest'], /NPCTEST/)
    const m = out.match(/NPCTEST people (\d+) moved (\d+) grounded (\d+) greeted (\w+) held (\d+)\/150/)
    const ok = Boolean(m) && Number(m[1]) >= 4 && Number(m[2]) >= 2 && Number(m[3]) === Number(m[1])
      && m[4] === 'true' && Number(m[5]) < 75
    return [ok, m ? m[0] : (out.match(/NPCTEST[^\n]*/) ?? ['no result'])[0]]
  }],
  ['the Reach: night brings a falling stone, and only near lamps burn', async () => {
    const out = await run('reach', ['--skytest'], /SKYTEST/)
    const m = out.match(/SKYTEST night ([\d.]+) stars (\w+) day ([\d.]+) lamps near (\d+)\/(\d+) far (\d+)\/(\d+)/)
    if (!m) return [false, (out.match(/SKYTEST[^\n]*/) ?? ['no result'])[0]]
    // Dark brings a falling stone; day takes it away; a lamp burns near the
    // camera and none three kilometres up. (No aurora: Hearth's night is
    // the sky's own stars and the stones that come down through them.)
    const ok = Number(m[1]) > 0.6 && m[2] === 'true' && Number(m[3]) < 0.15
      && Number(m[4]) > 0 && Number(m[6]) === 0
    return [ok, m[0]]
  }],
  ['the Reach: the first morning opens on the Kestrel on her tower, then hands over by the fire', async () => {
    const out = await run('reach', ['--waketest'], /WAKETEST/, 200000)
    const m = out.match(/WAKETEST star (\d+) ship (\d+) fire (\d+) at ([\d.]+) s, star above ([-\d.]+) blocked (\w+), handed (\w+), stood ([\d.]+) m from the fire/)
    if (!m) return [false, (out.match(/WAKETEST[^\n]*/) ?? ['no result'])[0]]
    // The eyes open on the ship on her tower, not the fire: she is in the
    // middle of the shot and the fire is behind you. The morning begins at
    // first light and ends standing by the fire, in control.
    const ok = Number(m[2]) < 34 && Number(m[3]) > 60 && Number(m[4]) >= 40
      && m[7] === 'true' && Number(m[8]) < 5
    return [ok, m[0]]
  }],
  ['the Reach: nothing in the village can be walked through (with a control)', async () => {
    const out = await run('reach', ['--walltest'], /WALLTEST/, 480000)
    const m = out.match(/WALLTEST tried (\d+) inside (\d+) (\[[^\]]*\]) control (\w+)/)
    return [Boolean(m) && Number(m[1]) > 30 && m[2] === '0' && m[4] === 'true', m ? m[0] : 'no result']
  }],
  ['the Reach: Space on the deck lights her and she flies off it (no cutscene), then holds still when let go', async () => {
    const out = await run('reach', ['--launchtest'], /LAUNCHTEST/)
    const m = out.match(/LAUNCHTEST dust (\d+), rose ([\d.]+) m in 3 s, climbing ([-\d.]+) m\/s, then held at ([\d.]+) m\/s, gear up (\w+), airborne (\w+)/)
    if (!m) return [false, (out.match(/LAUNCHTEST[^\n]*/) ?? ['no result'])[0]]
    return [Number(m[1]) > 0 && Number(m[2]) > 15 && Number(m[3]) > 5 && Number(m[4]) < 1.5 && m[5] === 'true' && m[6] === 'true', m[0]]
  }],
  ['the Reach: arriving at Verdance sliding at 40 m/s, she stops when let go and Shift lands her whole', async () => {
    const out = await run('reach', ['--arrivetest'], /ARRIVETEST/, 400000)
    const m = out.match(/ARRIVETEST still after ([-\d.]+) s \(drift ([\d.]+) m\/s\), landed (\w+) after (\d+) s, crashed (\w+), hull (\d+)/)
    if (!m) return [false, (out.match(/ARRIVETEST[^\n]*/) ?? ['no result'])[0]]
    return [Number(m[1]) > 0 && Number(m[1]) < 10 && Number(m[2]) < 0.5 && m[3] === 'true' && m[5] === 'false' && m[6] === '100', m[0]]
  }],
  ['the Reach: the assist catches a fall, Shift sets her down gently, the ground throws its dust', async () => {
    const out = await run('reach', ['--landtest'], /LANDTEST/)
    const m = out.match(/LANDTEST held ([\d.]+) m\/s at (\d+) m, landed (\w+) after ([\d.]+) s, touched at ([\d.]+) m\/s, dust (\d+), hull (\d+)%/)
    if (!m) return [false, (out.match(/LANDTEST[^\n]*/) ?? ['no result'])[0]]
    // Held still in the air with nothing pressed, then down on her feet,
    // softly (no hull lost), the ground throwing dust as she touched.
    return [Number(m[1]) < 0.5 && m[3] === 'true' && Number(m[5]) < 4 && Number(m[6]) > 0 && m[7] === '100', m[0]]
  }],
  ...['verdance', 'ashfall'].map((to) => [`the Reach: the autopilot flies to ${to}, round anything in the way, and holds her there`, async () => {
    const out = await run('reach', ['--aptest', to], /APTEST/, 400000)
    const m = out.match(/APTEST to (\w+) arrived (\w+) in (\d+) s, (\d+) m over it, ([\d.]+) m\/s, then ([\d.]+) m\/s held, frame (\w+), nearest the Lantern (\d+) m, hull (\d+)/)
    if (!m) return [false, (out.match(/APTEST[^\n]*/) ?? ['no result'])[0]]
    return [m[2] === 'true' && Number(m[6]) < 1 && m[7] === to && Number(m[8]) > 1300 && m[9] === '100', m[0]]
  }]),
  ['the Reach: flown at a cliff at 45 m/s with W held, the assist stops her short; without it she crashes (the control)', async () => {
    const out = await run('reach', ['--walltestfly'], /FLYWALL/)
    const m = out.match(/assist: warned (\w+), touched at ([\d.]+) m\/s, bounced back ([-\d.]+) m\/s, crashed (\w+); no assist: warned \w+, touched at ([\d.]+) m\/s, bounced back [-\d.]+ m\/s, crashed (\w+)/)
    if (!m) return [false, (out.match(/FLYWALL[^\n]*/) ?? ['no result'])[0]]
    return [m[1] === 'true' && Number(m[2]) < 4 && Number(m[3]) < 2 && m[4] === 'false' && Number(m[5]) > 30 && m[6] === 'true', m[0]]
  }],
  ['the Reach: land on the Phantom (whose pull is small) from 600 m with Shift; out, look away: it stays underfoot', async () => {
    const out = await run('reach', ['--phantomtest'], /PHANTOMTEST/, 300000)
    const m = out.match(/PHANTOMTEST landed (\w+), moon jumped (\d+) times, frame (\w+), lowest ([-\d.]+) m over its middle radius, player alive (\w+)/)
    if (!m) return [false, (out.match(/PHANTOMTEST[^\n]*/) ?? ['no result'])[0]]
    return [m[1] === 'true' && m[2] === '0' && m[3] === 'phantom' && Number(m[4]) > -6 && m[5] === 'true', m[0]]
  }],
  ['the Reach: the observatory steps can be walked up (no jumping) and in through its door', async () => {
    const out = await run('reach', ['--stairtest'], /STAIRTEST/)
    const m = out.match(/STAIRTEST inside (\w+) after ([\d.]+) s, height ([-\d.]+) m/)
    if (!m) return [false, (out.match(/STAIRTEST[^\n]*/) ?? ['no result'])[0]]
    return [m[1] === 'true' && Number(m[2]) < 6, m[0]]
  }],
  ['the Reach: no gravity in the Zero-G cave, and its five rings teach the jetpack', async () => {
    const out = await run('reach', ['--zerogtest'], /ZEROGTEST/)
    const m = out.match(/ZEROGTEST floating (\w+), sank ([-\d.]+) m in 3 s, rings (\d+) of (\d+), learned (\w+)/)
    if (!m) return [false, (out.match(/ZEROGTEST[^\n]*/) ?? ['no result'])[0]]
    return [m[1] === 'true' && Math.abs(Number(m[2])) < 0.5 && m[3] === m[4] && m[5] === 'true', m[0]]
  }],
  ['the Reach: into the pond with a splash, float, dive under (the view goes under too), come back up', async () => {
    const out = await run('reach', ['--swimtest'], /SWIMTEST/)
    const m = out.match(/SWIMTEST floating head ([-\d.]+) m over the water, dived (\w+), fog (\w+), back up (\w+), alive (\w+)/)
    if (!m) return [false, (out.match(/SWIMTEST[^\n]*/) ?? ['no result'])[0]]
    return [Number(m[1]) > 0.1 && Number(m[1]) < 1.2 && m[2] === 'true' && m[3] === 'true' && m[4] === 'true' && m[5] === 'true', m[0]]
  }],
  ['the Reach: ride the lift up the launch tower and board the Kestrel', async () => {
    const out = await run('reach', ['--lifttest'], /LIFTTEST/)
    const m = out.match(/LIFTTEST risen ([\d.]+) m, on deck (\w+), piloted (\w+)/)
    return [Boolean(m) && Number(m[1]) > 28 && m[2] === 'true' && m[3] === 'true', m ? m[0] : 'no result']
  }],
  ['the Reach: a tapped jump is small, a charged one big, the jetpack lifts', async () => {
    const out = await run('reach', ['--jumptest'], /JUMPTEST/)
    const m = out.match(/JUMPTEST tap ([\d.]+) m charged ([\d.]+) m jetpack ([\d.]+) m fuel used (\d+)/)
    const ok = Boolean(m) && Number(m[1]) > 0.4 && Number(m[2]) > Number(m[1]) * 2.5 && Number(m[3]) > 2.0 && Number(m[4]) > 0
    return [ok, m ? m[0] : 'no result']
  }],
  ...[['at its door\'s hour, near the Lantern', []], ['while it runs through Verdance\'s sphere', ['100']]].map(([when, extra]) => [`the Reach: land on the Wanderer ${when}: Shift sets her down, nothing pushes her off, and you can stand on it`, async () => {
    const out = await run('reach', ['--wandertest', ...extra], /WANDERTEST/, 300000)
    const m = out.match(/WANDERTEST landed (\w+) after (\d+) s, pushed away at most ([\d.]+) m\/s, frames ([\w,]+), hull (\d+), standing (-?[\d.]+) m over the ground, frame (\w+), alive (\w+)/)
    return [Boolean(m) && m[1] === 'true' && Number(m[3]) < 4 && m[5] === '100' && Math.abs(Number(m[6])) < 4 && m[7] === 'wanderer' && m[8] === 'true', m ? m[0] : (out.match(/WANDERTEST[^\n]*/) ?? ['no result'])[0]]
  }]),
  ...['hearthstone', 'verdance', 'ashfall', 'wanderer'].map((w) => [`the Reach: on ${w}, nowhere to fall through (dropped and walked all round it), and through it anyway, caught at once`, async () => {
    const out = await run('reach', ['--groundtest', w], /GROUNDTEST/, 600000)
    const m = out.match(/GROUNDTEST \w+ points (\d+) fell (\d+) worst (-?[\d.]+) m, through it caught after (-?[\d.]+) s/)
    return [Boolean(m) && Number(m[1]) > 40 && m[2] === '0' && Number(m[4]) >= 0 && Number(m[4]) < 1.0, (out.match(/GROUNDTEST[^\n]*/) ?? ['no result'])[0]]
  }]),
  ['the Reach: the Rim Run: through the first ring the clock starts, every ring counts in order, the finish keeps the best, no ring is blocked', async () => {
    const out = await run('reach', ['--racetest'], /RACETEST/, 300000)
    const m = out.match(/RACETEST started (\w+), rings (\d+), splits (\d+), finished (\w+), best ([\d.]+) s, learned (\w+), medal (\d), thrust x([\d.]+)/)
    const blocked = (out.match(/RACE blocked: \[([^\]]*)\]/) ?? [null, 'x'])[1]
    return [Boolean(m) && m[1] === 'true' && m[2] === m[3] && m[4] === 'true' && Number(m[5]) > 0 && m[6] === 'true' && m[7] === '3' && m[8] === '1.3' && blocked === '', (m ? m[0] : 'no result') + ` blocked [${blocked}]`]
  }],
  ['the Reach: the morning\'s falling stones come down, leave glowing craters and a starstone to take', async () => {
    const out = await run('reach', ['--meteortest'], /METEORTEST/, 300000)
    const m = out.match(/METEORTEST impacts (\d+), craters (\d+), starstone taken (\w+), learned (\w+), explorer alive (\w+)/)
    return [Boolean(m) && Number(m[1]) >= 4 && m[3] === 'true' && m[4] === 'true' && m[5] === 'true', m ? m[0] : 'no result']
  }],
  ['the Reach: the core, once taken, comes back through a death with you (the vault stays empty, the lead goes to the Engine)', async () => {
    const out = await run('reach', ['--corelooptest'], /CORELOOP/, 200000)
    const m = out.match(/CORELOOP had (\w+), after death carrying (\w+), cradle empty (\w+), lead to engine (\w+)/)
    return [Boolean(m) && m.slice(1).every((x) => x === 'true'), m ? m[0] : 'no result']
  }],
  ['the Reach: a morning after the first, you wake in the Kestrel\'s seat on the tower, and Space lifts her off', async () => {
    const out = await run('reach', ['--cockpitwaketest'], /COCKPITWAKE/, 200000)
    const m = out.match(/COCKPITWAKE loop (\d+) seated (\w+), rose ([\d.]+) m, hull (\d+)/)
    return [Boolean(m) && m[2] === 'true' && Number(m[3]) > 10 && m[4] === '100', m ? m[0] : 'no result']
  }],
  ['the Reach: woken in the Kestrel on the tower, you get out beside her, walk, and the lift is waiting to take you down', async () => {
    const out = await run('reach', ['--cockpitwaketest', '--walkout'], /WALKOUTTEST/, 300000)
    const m = out.match(/WALKOUTTEST walked ([\d.]+) m on the deck, lift waiting at the top (\w+), down to (-?[\d.]+) m over the ground, enabled (\w+)/)
    return [Boolean(m) && Number(m[1]) > 1.5 && m[2] === 'true' && Math.abs(Number(m[3])) < 3 && m[4] === 'true', m ? m[0] : 'no result']
  }],
  ['the Reach: L opens the ship log', async () => {
    const out = await run('reach', ['--logtest'], /LOGTEST/)
    return [/LOGTEST open true/.test(out), (out.match(/LOGTEST[^\n]*/) ?? ['no result'])[0]]
  }],
  ['the Reach: the story by teleport, mine to Engine to the end', async () => {
    const out = await run('reach', ['--storytest', '--talkauto'], /ENDING done|STORY finished false/, 180000)
    const want = ['STORY songlines placed 6 of 6 []', 'STORY songline mine read true, learned true', 'STORY recorder learned true', 'STORY vault open true',
      'STORY core carried true, learned true', 'STORY engine door open true', 'STORY finished true', 'ENDING done']
    const missing = want.filter((w) => !out.includes(w))
    const died = out.match(/LOOP ended: [^\n]*/)
    return [missing.length === 0 && !died, died ? died[0] : missing.length ? `missing: ${missing.join('; ')}` : 'mine, recorder, vault, core, Engine, ending']
  }],
  ['HUD text survives cutscenes and clears', async () => {
    const out = await run('ship_preview', ['--hudtest'], /HUDTEST \d+ failed/)
    const m = out.match(/HUDTEST (\d+) failed/)
    return [m && m[1] === '0', (out.match(/HUDTEST (FAIL.*)/g) ?? []).join('; ') || (m ? 'all ok' : 'no result')]
  }],
  ...[
    ['prologue_corridor', 'corridor_door', 'DOOR passed'],
    ['prologue_corridor', 'corridor_back', null],
    ['prologue_bridge', 'bridge_hale', 'Talk to Captain Hale'],
    ['prologue_bridge', 'bridge_chair', 'Sit in'],
    ['prologue_hangar', 'hangar_ladder', 'BOARD climbing'],
    ['act1_hearth', 'hearth_mara', 'Talk to Mara'],
  ].map(([scene, plan, prompt]) => [`walk ${plan}`, async () => {
    const out = await run(scene, ['--walktest', plan], /WALKTEST final/)
    const line = (out.match(/WALKTEST final .*/) ?? [''])[0].replace(/\[[^\]]*\]/g, '')
    if (!line) return [false, 'no result']
    // corridor_back walks at the aft wall: passing means it held (z stays < 0).
    if (!prompt) return [/\(-?[\d.]+, -?[\d.]+, -[\d.]+\)/.test(line), line]
    // Doors and the ladder report what happened (DOOR passed, BOARD
    // climbing) rather than offering a prompt.
    if (/^[A-Z]+ /.test(prompt)) return [out.includes(prompt), out.includes(prompt) ? prompt : line]
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
