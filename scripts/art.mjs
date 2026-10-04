/**
 * Build an authored asset in headless Blender.
 *
 *   npm run art:build -- survey-lander           build art/<id>/build.py
 *   npm run art:build -- survey-lander --check   build to a temp file and fail
 *                                                if it differs from the shipped one
 *
 * Each asset's build script is its source of truth (AGENT.md, section 4); this
 * runs it with Blender's factory settings so nothing on the machine — a
 * startup file, an add-on, a preference — can change the result, writes the
 * shipped `.glb` into `public/authored/` and a `.blend` beside the script for
 * anyone who wants to open the model and look at it.
 *
 * Blender is found at `$BLENDER`, or at the standard macOS install path. It is
 * not needed by `verify:all` or by CI: the gate reads the committed `.glb`.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const BLENDER = process.env.BLENDER ?? '/Applications/Blender.app/Contents/MacOS/Blender'

const args = process.argv.slice(2)
const id = args.find((a) => !a.startsWith('--'))
const check = args.includes('--check')
if (!id) {
  console.error('usage: npm run art:build -- <asset> [--check]')
  process.exit(2)
}
const script = join(ROOT, 'art', id, 'build.py')
if (!existsSync(script)) {
  console.error(`no build script at ${script}`)
  process.exit(2)
}
if (!existsSync(BLENDER)) {
  console.error(`Blender not found at ${BLENDER}; set BLENDER to its executable`)
  process.exit(2)
}

const shipped = join(ROOT, 'public', 'authored', `${id}.glb`)
const scratch = check ? mkdtempSync(join(tmpdir(), 'pz-art-')) : null
const out = check ? join(scratch, `${id}.glb`) : shipped
const blend = check ? join(scratch, `${id}.blend`) : join(ROOT, 'art', id, `${id}.blend`)

const run = spawnSync(BLENDER, ['-b', '--factory-startup', '--python-exit-code', '1', '--python', script, '--', '--out', out, '--blend', blend], {
  cwd: ROOT,
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
})
const lines = `${run.stdout}\n${run.stderr}`.split('\n')
for (const line of lines) if (line.startsWith('PZ-') || /Error|Traceback|^\s+File /.test(line)) console.log(line)
if (run.status !== 0 || !existsSync(out)) {
  console.error(`blender exited ${run.status}; nothing written`)
  process.exit(1)
}

if (check) {
  const same = existsSync(shipped) && readFileSync(shipped).equals(readFileSync(out))
  rmSync(scratch, { recursive: true, force: true })
  console.log(same ? `${id}: rebuilt byte-identical to public/authored/${id}.glb` : `${id}: rebuild DIFFERS from the shipped file`)
  process.exit(same ? 0 : 1)
}
console.log(`${id}: ${readFileSync(out).length.toLocaleString()} bytes -> public/authored/${id}.glb`)
