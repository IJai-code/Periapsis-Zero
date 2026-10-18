#!/usr/bin/env node
/**
 * Bring shared art into the Godot project (game/assets): the NASA Earth
 * imagery and the music from public/, and ambientCG's CC0 materials. The
 * Godot game's own models are built by art/godot/*.py into game/art.
 * game/assets is gitignored and made again by this script before Godot
 * imports or exports.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs'
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
copy('public/textures', 'textures', (f) => /\.(jpg|png)$/.test(f))
copy('public/game/detail', 'detail', (f) => f.endsWith('.webp'))
copy('public/audio', 'audio', (f) => f === 'monume-space-ambient.mp3')

// The Reach's music is made by a script (art/audio/reach_music.py, about
// 15 s); the WAVs are gitignored and their import settings kept, so make
// them again only when missing or older than the script.
{
  const script = join(root, 'art/audio/reach_music.py')
  const dir = join(root, 'game/audio/reach')
  const parts = ['banjo', 'flute', 'harmonica', 'drums', 'choir', 'end', 'wake', 'launch'].map((p) => join(dir, `${p}.wav`))
  const stale = parts.some((f) => !existsSync(f) || statSync(f).mtimeMs < statSync(script).mtimeMs)
  if (stale) execFileSync('python3', [script, dir], { stdio: 'inherit' })
  else console.log('game/audio/reach: up to date')
}

// Surface materials: CC0 from ambientCG (no account, no credit required;
// credited in game/CREDITS.md). Downloaded once into art/sources (gitignored),
// and only the maps Godot uses are unpacked, recompressed, into
// game/assets/materials/<id>/.
const MATERIALS = ['MetalPlates006', 'MetalPlates013', 'PaintedMetal004', 'Metal027', 'DiamondPlate008C', 'Rubber004', 'Plastic013A', 'MetalWalkway014', 'CorrugatedSteel005', 'Rock030', 'Ground037', 'Rock044', 'Bark012',
  // Lowdeck, the city on Hearth's lower ring.
  'Asphalt025C', 'Concrete034', 'Facade006', 'Tiles074', 'PaintedPlaster017', 'Bricks076C',
  // Hearth village, in the Reach.
  'WoodSiding008', 'RoofingTiles006', 'Planks037A', 'Wood067']
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

// Leaves for the foliage cards Blender composes (art/godot/foliage_cards.py):
// unpacked into art/sources only; the game ships the rendered cards.
for (const id of ['LeafSet004', 'LeafSet001', 'LeafSet020']) {
  const zip = join(cache, `${id}.zip`)
  if (!existsSync(zip)) execFileSync('curl', ['-sfL', '-o', zip, `https://ambientcg.com/get?file=${id}_2K-JPG.zip`])
  const dir = join(cache, id)
  if (existsSync(dir)) continue
  mkdirSync(dir, { recursive: true })
  execFileSync('unzip', ['-o', '-q', '-j', zip, '*_Color.jpg', '*_Opacity.jpg', '*_NormalGL.jpg', '-d', dir], { stdio: 'ignore' })
}
