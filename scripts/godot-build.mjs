#!/usr/bin/env node
/**
 * Build the Godot game:  node scripts/godot-build.mjs web|desktop [--no-sync]
 *
 * One project, two kinds of texture. The browser build (Compatibility
 * renderer) is downloaded before it plays, so its textures are capped at
 * 1024 px (Earth 2048) and stored as lossy WebP. The desktop build keeps full
 * resolution in GPU-compressed form. Each run rewrites the [params] of every
 * texture's .import file in game/assets and game/art for its target,
 * reimports, and exports. Those .import files are generated (game/assets by
 * scripts/godot-sync.mjs, game/art's by Godot from the GLBs) and gitignored,
 * so nothing tracked changes.
 *
 * Output: build/play (web, published as the `play` release asset) or
 * build/desktop.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const target = process.argv[2]
if (!['web', 'desktop'].includes(target)) {
  console.error('usage: node scripts/godot-build.mjs web|desktop [--no-sync]')
  process.exit(1)
}
const root = new URL('..', import.meta.url).pathname
const game = join(root, 'game')
const GODOT = process.env.GODOT ?? '/Applications/Godot.app/Contents/MacOS/Godot'
const godot = (...args) => execFileSync(GODOT, ['--headless', '--path', game, ...args], { stdio: ['ignore', 'ignore', 'inherit'] })

if (!process.argv.includes('--no-sync')) execFileSync('node', [join(root, 'scripts/godot-sync.mjs')], { stdio: 'inherit' })
// The first import writes the .import files this script then adjusts.
godot('--import')

const walk = (dir) => readdirSync(dir).flatMap((f) => {
  const p = join(dir, f)
  return statSync(p).isDirectory() ? walk(p) : [p]
})
const textures = [...walk(join(game, 'assets')), ...walk(join(game, 'art'))].filter((f) => f.endsWith('.import') && readFileSync(f, 'utf8').includes('importer="texture"'))

let changed = 0
for (const file of textures) {
  const name = file.split('/').pop()
  const big = /earth_(day|night)/.test(name)
  const normal = /normal/i.test(name)
  const want = target === 'web'
    ? { 'compress/mode': 1, 'compress/lossy_quality': 0.78, 'mipmaps/generate': 'true', 'process/size_limit': big ? 2048 : 1024, 'compress/normal_map': 0 }
    : { 'compress/mode': 2, 'mipmaps/generate': 'true', 'process/size_limit': 0, 'compress/normal_map': normal ? 1 : 0 }
  let text = readFileSync(file, 'utf8')
  const before = text
  for (const [k, v] of Object.entries(want)) {
    const re = new RegExp(`^${k.replace('/', '\\/')}=.*$`, 'm')
    text = re.test(text) ? text.replace(re, `${k}=${v}`) : text.replace('[params]\n', `[params]\n\n${k}=${v}`)
  }
  if (text !== before) { writeFileSync(file, text); changed++ }
}
console.log(`${target}: ${changed} of ${textures.length} textures set for this target`)
if (changed) godot('--import')

const out = join(root, 'build', target === 'web' ? 'play' : 'desktop')
rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })
if (target === 'web') {
  godot('--export-release', 'Web', join(out, 'index.html'))
} else {
  for (const [preset, file] of [['macOS', 'PeriapsisZero-mac.zip'], ['Windows', 'PeriapsisZero.exe'], ['Linux', 'PeriapsisZero.x86_64']]) {
    try { godot('--export-release', preset, join(out, file)) } catch { console.log(`  ${preset}: export failed`) }
  }
}
for (const f of readdirSync(out)) console.log(`  ${f}  ${(statSync(join(out, f)).size / 1e6).toFixed(1)} MB`)
