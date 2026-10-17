#!/usr/bin/env node
/**
 * Build the Godot game:  node scripts/godot-build.mjs web|desktop [--no-sync]
 *
 * One project, two kinds of texture. The browser build (Compatibility
 * renderer) is downloaded before it plays, so its textures are capped at
 * 1024 px (Earth 2048) and stored as lossy WebP. The desktop build keeps full
 * GPU-compressed form at 1024 px (Earth and skin 4096): the scans are drawn
 * triplanar at metres a tile, where 1K holds up, and it keeps the download
 * to a size people will fetch. Each run rewrites the [params] of every
 * texture's .import file in game/assets and game/art for its target,
 * reimports, and exports. Those .import files are generated (game/assets by
 * scripts/godot-sync.mjs, game/art's by Godot from the GLBs) and gitignored,
 * so nothing tracked changes.
 *
 * Output: build/play (web, published as the `play` release asset) or
 * build/desktop (published to the `desktop` release by
 * scripts/godot-publish-desktop.mjs).
 *
 * The desktop build also makes the game's updates (game/scripts/core/
 * updater.gd). Beside the apps it writes, for each platform, a patch: the
 * files that differ from a base pack, which is the whole game as of some
 * earlier build. A copy of the app downloads the base once (unless it is
 * that build) and then only patches. The base is kept in build/desktop-base
 * (fetched back from the release if it is missing) and made again with
 * `--rebase`, or by itself when the engine changes; rebase when the patches
 * grow to a sizeable part of the whole. update.json names all of it.
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
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
  const big = /earth_(day|night|clouds_hd)/.test(name)
  const normal = /normal/i.test(name)
  // Sky panoramas stay plain RGBA everywhere: never block-compressed (a GPU
  // that misreads the format, or a guess that it is a normal map, shows a
  // green sky), never picked up for VRAM by the "used in 3D" detector.
  const sky = file.includes('/art/sky/')
  const want = sky
    ? { 'compress/mode': target === 'web' ? 1 : 0, 'compress/lossy_quality': 0.85, 'mipmaps/generate': 'true', 'process/size_limit': 2048, 'compress/normal_map': 2, 'detect_3d/compress_to': 0 }
    : target === 'web'
    ? { 'compress/mode': 1, 'compress/lossy_quality': 0.78, 'mipmaps/generate': 'true', 'process/size_limit': big ? 2048 : 1024, 'compress/normal_map': 0 }
    : { 'compress/mode': 2, 'mipmaps/generate': 'true', 'process/size_limit': big || /skin|male_diffuse|female_diffuse/i.test(name) ? 4096 : 1024, 'compress/normal_map': normal ? 1 : 0 }
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

// Stamp the build with its commit's time; the web build publishes the same
// stamp, so a downloaded copy can see that a newer one is out.
const stamp = Number(process.env.SOURCE_DATE_EPOCH ?? execFileSync('git', ['log', '-1', '--format=%ct'], { cwd: root }).toString().trim())
if (!Number.isSafeInteger(stamp) || stamp <= 0) throw new Error('SOURCE_DATE_EPOCH must be a positive integer timestamp')
const buildFile = join(game, 'scripts/core/build.gd')
writeFileSync(buildFile, readFileSync(buildFile, 'utf8').replace(/const STAMP := \d+/, `const STAMP := ${stamp}`))

const out = join(root, 'build', target === 'web' ? 'play' : 'desktop')
rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })
if (target === 'web') {
  godot('--export-release', 'Web', join(out, 'index.html'))
  writeFileSync(join(out, 'version.json'), JSON.stringify({ build: stamp, date: new Date(stamp * 1000).toISOString().slice(0, 10), pck_sha256: createHash('sha256').update(readFileSync(join(out, 'index.pck'))).digest('hex') }))
} else {
  const engine = execFileSync(GODOT, ['--version']).toString().trim().split('.').slice(0, 4).join('.')
  // Read by the updater before it mounts anything (game/.gitignore).
  writeFileSync(join(game, 'build.json'), JSON.stringify({ build: stamp, engine }))
  const PLATFORMS = [['macOS', 'mac', 'PeriapsisZero-mac.zip'], ['Windows', 'windows', 'PeriapsisZero.exe'], ['Linux', 'linux', 'PeriapsisZero.x86_64']]
  for (const [preset, , file] of PLATFORMS) godot('--export-release', preset, join(out, file))
  execFileSync('zip', ['-q', '-X', '-j', join(out, 'PeriapsisZero-windows.zip'), join(out, 'PeriapsisZero.exe')])
  execFileSync('tar', ['-czf', join(out, 'PeriapsisZero-linux.tar.gz'), '-C', out, 'PeriapsisZero.x86_64'])

  const sha = (f) => createHash('sha256').update(readFileSync(f)).digest('hex')
  const entry = (f) => ({ file: f.split('/').pop(), sha256: sha(f), size: statSync(f).size })
  const baseDir = join(root, 'build', 'desktop-base')
  const readBase = () => existsSync(join(baseDir, 'base.json')) ? JSON.parse(readFileSync(join(baseDir, 'base.json'), 'utf8')) : null
  if (!readBase() && !process.argv.includes('--rebase')) {
    // The published base, if there is one.
    try {
      mkdirSync(baseDir, { recursive: true })
      execFileSync('gh', ['release', 'download', 'desktop', '-p', 'update.json', '-D', baseDir, '--clobber'], { cwd: root })
      const m = JSON.parse(readFileSync(join(baseDir, 'update.json'), 'utf8'))
      for (const [preset, key] of PLATFORMS) {
        const b = m.platforms[preset].base
        execFileSync('gh', ['release', 'download', 'desktop', '-p', b.file, '-D', baseDir, '--clobber'], { cwd: root })
        if (sha(join(baseDir, b.file)) !== b.sha256) throw new Error(`${b.file}: checksum`)
        copyFileSync(join(baseDir, b.file), join(baseDir, `${key}.pck`))
        rmSync(join(baseDir, b.file))
      }
      writeFileSync(join(baseDir, 'base.json'), JSON.stringify({ build: m.base, engine: m.engine }))
    } catch (e) {
      console.log(`  no published base (${e.message.split('\n')[0]}); making one`)
      rmSync(baseDir, { recursive: true, force: true })
    }
  }
  let base = readBase()
  if (!base || base.engine !== engine || process.argv.includes('--rebase')) {
    rmSync(baseDir, { recursive: true, force: true })
    mkdirSync(baseDir, { recursive: true })
    for (const [preset, key] of PLATFORMS) godot('--export-pack', preset, join(baseDir, `${key}.pck`))
    base = { build: stamp, engine }
    writeFileSync(join(baseDir, 'base.json'), JSON.stringify(base))
  }
  const platforms = {}
  for (const [preset, key] of PLATFORMS) {
    const basePack = join(out, `PeriapsisZero-base-${base.build}-${key}.pck`)
    copyFileSync(join(baseDir, `${key}.pck`), basePack)
    platforms[preset] = { base: entry(basePack) }
    if (base.build !== stamp) {
      const patch = join(out, `PeriapsisZero-${stamp}-${key}.patch.pck`)
      godot('--export-patch', preset, patch, '--patches', join(baseDir, `${key}.pck`))
      platforms[preset].patch = entry(patch)
    }
  }
  // Where the platforms' packs are the same bytes (they have been: one
  // texture set serves all three), publish one file under a shared name.
  for (const kind of ['base', 'patch']) {
    const groups = {}
    for (const p of Object.values(platforms)) if (p[kind]) (groups[p[kind].sha256] ??= []).push(p)
    for (const group of Object.values(groups)) {
      if (group.length < 2) continue
      const shared = group[0][kind].file.replace(/-(mac|windows|linux)(\.patch)?\.pck$/, '$2.pck')
      copyFileSync(join(out, group[0][kind].file), join(out, shared))
      for (const p of group) { rmSync(join(out, p[kind].file), { force: true }); p[kind] = { ...p[kind], file: shared } }
    }
  }
  // The release's project settings travel with it: the updater hands them
  // to the engine as an override at the next start.
  writeFileSync(join(out, 'update.json'), JSON.stringify({
    build: stamp, date: new Date(stamp * 1000).toISOString().slice(0, 10), engine, base: base.build,
    settings: readFileSync(join(game, 'project.godot'), 'utf8'), platforms,
  }, null, 1))
}
for (const f of readdirSync(out)) console.log(`  ${f}  ${(statSync(join(out, f)).size / 1e6).toFixed(1)} MB`)
