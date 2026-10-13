#!/usr/bin/env node
/**
 * Publish build/desktop (node scripts/godot-build.mjs desktop) to the
 * `desktop` release:  node scripts/godot-publish-desktop.mjs
 *
 * The apps and the update packs go up first and are checked against the
 * release's own listing (GitHub has answered an upload with a 502 and
 * dropped the asset), then update.json, last, so a copy of the game never
 * reads a manifest naming a file that is not there yet. A base pack already
 * published (same name, same size) is not sent again. Patches and bases no
 * manifest names any more are deleted afterwards.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const root = new URL('..', import.meta.url).pathname
const out = join(root, 'build', 'desktop')
const gh = (...args) => execFileSync('gh', args, { cwd: root, encoding: 'utf8' })
const listing = () => Object.fromEntries(JSON.parse(gh('release', 'view', 'desktop', '--json', 'assets')).assets.map((a) => [a.name, a.size]))

const manifest = JSON.parse(readFileSync(join(out, 'update.json'), 'utf8'))
const packs = Object.values(manifest.platforms).flatMap((p) => [p.base, p.patch].filter(Boolean))
const files = ['PeriapsisZero-mac.zip', 'PeriapsisZero-windows.zip', 'PeriapsisZero-linux.tar.gz', ...packs.map((p) => p.file)]

const upload = (file) => {
  const size = statSync(join(out, file)).size
  for (let attempt = 1; attempt <= 4; attempt++) {
    try { gh('release', 'upload', 'desktop', join(out, file), '--clobber') } catch (e) { console.log(`  ${file}: ${e.message.split('\n')[0]}`) }
    if (listing()[file] === size) { console.log(`  ${file}  ${(size / 1e6).toFixed(1)} MB`); return }
    console.log(`  ${file}: not there after attempt ${attempt}, again`)
  }
  throw new Error(`${file} did not upload`)
}

const before = listing()
for (const file of files) {
  if (file.includes('-base-') && before[file] === statSync(join(out, file)).size) { console.log(`  ${file}  already published`); continue }
  upload(file)
}
upload('update.json')

const keep = new Set([...files, 'update.json'])
for (const name of Object.keys(listing())) {
  if (name.endsWith('.pck') && !keep.has(name)) { gh('release', 'delete-asset', 'desktop', name, '--yes'); console.log(`  removed ${name}`) }
}
console.log(`desktop: build ${manifest.build} published (base ${manifest.base})`)
