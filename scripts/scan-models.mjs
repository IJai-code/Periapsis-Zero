/**
 * Scans public/models/ and regenerates src/gfx/modelsManifest.js.
 *
 * Vite serves public/ statically with no directory listing, so the catalogue has
 * to be static at runtime. Generating it from whatever is actually on disk keeps
 * it honest without hand-maintaining an entry per vehicle: drop files in, re-run
 * `npm run models:scan`, and the HUD picks them up.
 *
 * Only web-loadable formats are emitted. NASA's archives also ship .max, .blend
 * and .7z, none of which a browser can open — those are reported as skipped
 * rather than written out as entries that would fail at load time.
 */
import fs from 'node:fs'
import path from 'node:path'

const ROOT = 'public/models'
const OUT = 'src/gfx/modelsManifest.js'
const LOADABLE = new Set(['.glb', '.gltf'])

/** Curated labels and grouping for the headline fleet; everything else is derived. */
const CURATED = {
  'Hubble Space Telescope (A)/hubble.glb': { id: 'hubble', label: 'Hubble Space Telescope', group: 'Observatories' },
  'James Webb Space Telescope (A)/James Webb Space Telescope (A).glb': { id: 'jwst', label: 'James Webb Space Telescope', group: 'Observatories' },
  'Nancy Grace Roman Space Telescope (A)/Nancy Grace Roman Space Telescope (A).glb': { id: 'roman', label: 'Nancy Grace Roman Telescope', group: 'Observatories' },
  'Kepler (A)/Kepler (A).glb': { id: 'kepler', label: 'Kepler', group: 'Observatories' },
  'Fermi Gamma-ray Large Area Space Telescope/Fermi Gamma-ray Large Area Space Telescope.glb': { id: 'fermi', label: 'Fermi Gamma-ray Telescope', group: 'Observatories' },

  'Apollo Soyuz/apollo_csm.glb': { id: 'apollo_csm', label: 'Apollo CSM', group: 'Crewed' },
  'Apollo Lunar Module.glb': { id: 'apollo_lm', label: 'Apollo Lunar Module', group: 'Crewed' },
  'Space Shuttle (A)/Space Shuttle (A).glb': { id: 'shuttle', label: 'Space Shuttle', group: 'Crewed' },
  'Gemini/Gemini.glb': { id: 'gemini', label: 'Gemini', group: 'Crewed' },
  'Gateway/Gateway Core.glb': { id: 'gateway', label: 'Gateway Core', group: 'Crewed' },

  'Voyager Probe (A)/Voyager Probe (A).glb': { id: 'voyager', label: 'Voyager Probe', group: 'Deep space' },
  'Cassini-Huygens (A)/Cassini-Huygens (A).glb': { id: 'cassini', label: 'Cassini-Huygens', group: 'Deep space' },
  'Juno (A)/Juno (A).glb': { id: 'juno', label: 'Juno', group: 'Deep space' },
  'Parker Solar Probe/Parker Solar Probe.glb': { id: 'parker', label: 'Parker Solar Probe', group: 'Deep space' },
  'Deep Space 1/Deep Space 1.glb': { id: 'deepspace1', label: 'Deep Space 1', group: 'Deep space' },
  'Saturn V/Saturn V.glb': { id: 'saturn_v', label: 'Saturn V', group: 'Launch vehicles' },

  '1999 RQ36 asteroid/1999 RQ36 asteroid.glb': { id: 'bennu', label: 'Bennu (101955)', group: 'Small bodies' },
  'Mars 2020 Perseverance Rover/Mars 2020 Perseverance Rover.glb': { id: 'perseverance', label: 'Perseverance Rover', group: 'Planetary' },
  'Mars Odyssey/Mars Odyssey.glb': { id: 'odyssey', label: 'Mars Odyssey', group: 'Planetary' },
  'Aura (A)/Aura (A).glb': { id: 'aura', label: 'Aura', group: 'Earth science' },
}

const slug = (s) =>
  s
    .toLowerCase()
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')

function groupFor(rel) {
  if (rel.includes('International Space Station')) return 'ISS modules'
  if (rel.startsWith('Space Shuttle Parts')) return 'Shuttle parts'
  if (rel.includes('Canadarm')) return 'Shuttle parts'
  return 'Other'
}

/** Each path segment encoded separately — spaces and parentheses are everywhere here. */
const encodePath = (rel) => rel.split('/').map(encodeURIComponent).join('/')

/**
 * Draco decoders are copied out of three into public/ rather than pulled from a
 * CDN. Nearly half this catalogue requires KHR_draco_mesh_compression, and the
 * rest of the app already runs with no network dependency at all — a mesh
 * loader that silently needs one would be the odd exception.
 */
function syncDraco() {
  const from = 'node_modules/three/examples/jsm/libs/draco'
  const to = 'public/draco'
  if (!fs.existsSync(from)) return console.log('  draco: source missing, skipped')
  fs.mkdirSync(to, { recursive: true })
  let copied = 0
  for (const f of fs.readdirSync(from)) {
    if (!/^draco_(decoder|wasm_wrapper)\.(js|wasm)$/.test(f)) continue
    fs.copyFileSync(path.join(from, f), path.join(to, f))
    copied++
  }
  console.log(`  draco: ${copied} decoder files -> ${to}/`)
}

const entries = []
const skipped = []

function walk(dir) {
  for (const name of fs.readdirSync(dir).sort()) {
    if (name === '.DS_Store' || name.startsWith('.')) continue
    const full = path.join(dir, name)
    const stat = fs.statSync(full)
    if (stat.isDirectory()) {
      walk(full)
      continue
    }
    const ext = path.extname(name).toLowerCase()
    const rel = path.relative(ROOT, full)
    if (!LOADABLE.has(ext)) {
      if (['.max', '.blend', '.7z', '.001', '.002', '.obj', '.fbx'].includes(ext)) skipped.push(rel)
      continue
    }
    const curated = CURATED[rel]
    entries.push({
      id: curated?.id ?? slug(rel.replace(/\//g, '_')),
      label: curated?.label ?? path.basename(name, ext),
      group: curated?.group ?? groupFor(rel),
      file: encodePath(rel),
      bytes: stat.size,
    })
  }
}

walk(ROOT)
syncDraco()

// Curated fleet first, then everything else alphabetically inside its group.
const GROUP_ORDER = [
  'Observatories',
  'Crewed',
  'Deep space',
  'Launch vehicles',
  'Planetary',
  'Earth science',
  'Small bodies',
  'Shuttle parts',
  'ISS modules',
  'Other',
]
entries.sort((a, b) => {
  const g = GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group)
  return g !== 0 ? g : a.label.localeCompare(b.label)
})

const body = `// GENERATED by scripts/scan-models.mjs — do not edit by hand.
// Re-run \`npm run models:scan\` after adding or removing files in public/models/.
//
// ${entries.length} loadable models, ${(entries.reduce((s, e) => s + e.bytes, 0) / 1048576).toFixed(0)} MB total.
// Paths are URL-encoded per segment: NASA's folder names contain spaces and
// parentheses, and an unencoded request for them fails outright.

/** @typedef {{id: string, label: string, group: string, file: string, bytes: number}} ModelEntry */

/** @type {ModelEntry[]} */
export const MODEL_CATALOG = ${JSON.stringify(entries, null, 2)}

export const MODEL_GROUPS = ${JSON.stringify(GROUP_ORDER.filter((g) => entries.some((e) => e.group === g)), null, 2)}

export const MODEL_BY_ID = Object.fromEntries(MODEL_CATALOG.map((m) => [m.id, m]))

/** Assigned to each craft on first load, when the file is present. */
export const DEFAULT_ASSIGNMENT = {
  ship: 'apollo_csm',
  hubble: 'hubble',
  iss: null,
}
`

fs.writeFileSync(OUT, body)
console.log(`wrote ${OUT}`)
console.log(`  ${entries.length} loadable models across ${new Set(entries.map((e) => e.group)).size} groups`)
for (const g of GROUP_ORDER) {
  const n = entries.filter((e) => e.group === g)
  if (n.length) console.log(`    ${g.padEnd(16)} ${n.length}`)
}
if (skipped.length) {
  console.log(`  skipped ${skipped.length} non-web formats (.max/.blend/.7z — a browser cannot open these):`)
  for (const s of skipped.slice(0, 8)) console.log(`    ${s}`)
}
