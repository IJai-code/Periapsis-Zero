#!/usr/bin/env node
/**
 * Bring the shipped art into the Godot project (game/assets). The web build's
 * files stay the single source: the Blender-built models in public/authored
 * and the NASA imagery in public/textures. game/assets is gitignored and made
 * again by this script, locally and in CI, before Godot imports or exports.
 */
import { cpSync, existsSync, mkdirSync, readdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'

const root = new URL('..', import.meta.url).pathname
const out = join(root, 'game/assets')
const copy = (from, to, keep) => {
  mkdirSync(join(out, to), { recursive: true })
  let n = 0
  for (const f of readdirSync(join(root, from))) {
    if (!keep(f)) continue
    cpSync(join(root, from, f), join(out, to, f))
    n++
  }
  console.log(`${from} -> game/assets/${to}: ${n} files`)
}
// Models: each shipped GLB, decoded out of Draco by Blender (Godot cannot
// read Draco) with its baked atlas kept. Without Blender they are copied as
// they are, and only the uncompressed ones (the pilot) will import.
const BLENDER = process.env.BLENDER ?? '/Applications/Blender.app/Contents/MacOS/Blender'
mkdirSync(join(out, 'models'), { recursive: true })
let models = 0
for (const f of readdirSync(join(root, 'public/authored')).filter((f) => f.startsWith('game-') && f.endsWith('.glb'))) {
  const src = join(root, 'public/authored', f)
  if (existsSync(BLENDER)) execFileSync(BLENDER, ['-b', '--factory-startup', '--python', join(root, 'art/godot_export.py'), '--', src, join(out, 'models', f)], { stdio: 'ignore' })
  else cpSync(src, join(out, 'models', f))
  models++
}
console.log(`public/authored -> game/assets/models: ${models} files`)
copy('public/textures', 'textures', (f) => /\.(jpg|png)$/.test(f))
copy('public/game/detail', 'detail', (f) => f.endsWith('.webp'))

// Surface materials: CC0 from ambientCG (no account, no credit required;
// credited in game/CREDITS.md). Downloaded once into art/sources (gitignored),
// and only the maps Godot uses are unpacked, recompressed, into
// game/assets/materials/<id>/.
const MATERIALS = ['MetalPlates006', 'MetalPlates013', 'PaintedMetal004', 'Metal027', 'DiamondPlate008C', 'Rubber004', 'Plastic013A', 'MetalWalkway014']
const cache = join(root, 'art/sources/ambientcg')
mkdirSync(cache, { recursive: true })
for (const id of MATERIALS) {
  const zip = join(cache, `${id}.zip`)
  if (!existsSync(zip)) execFileSync('curl', ['-sfL', '-o', zip, `https://ambientcg.com/get?file=${id}_2K-JPG.zip`])
  const dir = join(out, 'materials', id)
  if (existsSync(dir)) continue
  mkdirSync(dir, { recursive: true })
  // unzip exits 11 when a pattern matches nothing; not every material has every map.
  try {
    execFileSync('unzip', ['-o', '-q', '-j', zip, '*_Color.jpg', '*_NormalGL.jpg', '*_Roughness.jpg', '*_Metalness.jpg', '*_AmbientOcclusion.jpg', '*_Opacity.jpg', '-d', dir], { stdio: 'ignore' })
  } catch (e) {
    if (e.status !== 11) throw e
  }
}
console.log(`ambientCG -> game/assets/materials: ${MATERIALS.length} materials`)
