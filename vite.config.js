import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import fs from 'node:fs'
import path from 'node:path'

/**
 * Vite copies public/ into dist wholesale, and the NASA model archives carry a
 * great deal that no browser can open: .7z originals, .max and .blend source
 * files, reference renders, loose texture folders. Left alone that is 570 MB of
 * a 1.1 GB build.
 *
 * This prunes dist/models down to exactly the files the generated manifest
 * refers to. It only ever touches the build output — public/ keeps the
 * originals, so nothing the user dropped in is lost.
 */
function pruneUnusedModels() {
  return {
    name: 'periapsis:prune-unused-models',
    apply: 'build',
    closeBundle() {
      const dir = path.resolve('dist/models')
      if (!fs.existsSync(dir)) return

      // The rule is simply "can a browser open it": the generated manifest only
      // ever lists these two extensions, so matching on them keeps exactly the
      // referenced set without needing to read the manifest back in.
      const keep = new Set(['.glb', '.gltf'])

      let removed = 0
      let bytes = 0
      const sweep = (current) => {
        for (const name of fs.readdirSync(current)) {
          const full = path.join(current, name)
          if (fs.statSync(full).isDirectory()) {
            sweep(full)
            if (fs.readdirSync(full).length === 0) fs.rmdirSync(full)
          } else if (!keep.has(path.extname(name).toLowerCase())) {
            bytes += fs.statSync(full).size
            fs.unlinkSync(full)
            removed++
          }
        }
      }
      sweep(dir)
      this.info(`pruned ${removed} unreferenced files (${(bytes / 1048576).toFixed(0)} MB) from dist/models`)
    },
  }
}

/**
 * The Draco decoders, kept present without being kept in the repository.
 *
 * Nearly half the model catalogue is `KHR_draco_mesh_compression`, and
 * `public/draco` is gitignored — so a clone that has not run `models:scan`, and
 * any machine building this from a fresh checkout, silently loads no compressed
 * mesh at all. The files are 1.0 MB and already on disk inside three, at the
 * version three expects, so the honest fix is to take them from there whenever
 * they are missing rather than to commit a second copy or reach for a CDN.
 *
 * Only when missing: `models:scan` still owns the copy, and this does not
 * overwrite what it put there.
 */
function provideDraco() {
  const from = path.resolve('node_modules/three/examples/jsm/libs/draco')
  const to = path.resolve('public/draco')
  const NEEDED = ['draco_decoder.js', 'draco_decoder.wasm', 'draco_wasm_wrapper.js']
  return {
    name: 'periapsis:provide-draco',
    buildStart() {
      if (!fs.existsSync(from)) return
      const missing = NEEDED.filter((f) => !fs.existsSync(path.join(to, f)))
      if (missing.length === 0) return
      fs.mkdirSync(to, { recursive: true })
      for (const f of missing) {
        if (fs.existsSync(path.join(from, f))) fs.copyFileSync(path.join(from, f), path.join(to, f))
      }
      this.info(`copied ${missing.length} Draco decoder files out of three into public/draco`)
    },
  }
}

/**
 * A stamp the running page can be asked for.
 *
 * Vite's dependency pre-bundle lives in `node_modules/.vite` and outlives the
 * server; when it goes stale the page keeps executing code that is no longer on
 * disk. That failure is *silent* — the source reads correctly, the edit is
 * saved, the browser shows the old behaviour — and it has cost this project
 * several rounds of diagnosing a bug that had already been fixed. `npm run
 * predev` clears the cache, which prevents most of it. This is the other half:
 * asking the page which code it is actually running.
 *
 * The stamp has to come from the modules the page *executed*, not from the
 * server. The first attempt was a `define` computed when the config loaded,
 * which is the newest source mtime at server start — and that cannot tell a
 * stale page from one that hot-updated correctly since, because both report a
 * time older than the file on disk. Every module carrying its own mtime and the
 * page keeping the maximum does distinguish them: a module replaced over HMR
 * runs its line again and raises the figure, a stale one never does. Compare
 * what the page reports against the newest file under `src/`; if the page is
 * behind, it is behind.
 *
 * Serve only. A production build is a fixed artefact and has nothing to be
 * stale against.
 */
function stampModules() {
  const root = path.resolve('src')
  return {
    name: 'periapsis:build-stamp',
    apply: 'serve',
    transform(code, id) {
      const file = id.split('?')[0]
      if (!file.startsWith(root) || !/\.[jt]sx?$/.test(file)) return null
      // Appended, so every line above keeps its number and the existing source
      // map stays honest without this having to rewrite one.
      const stamp = fs.statSync(file).mtimeMs
      return {
        code: `${code}\n;globalThis.__PERIAPSIS_BUILD__ = Math.max(globalThis.__PERIAPSIS_BUILD__ ?? 0, ${stamp});`,
        map: null,
      }
    },
  }
}

/**
 * Where the site is served from: the root.
 *
 * Every asset the app fetches at runtime — models, textures, the Draco decoders
 * — is already built on `import.meta.env.BASE_URL`, so the whole of it follows
 * this one value. The site is published to periapsiszero.dev, and a custom
 * domain serves from the root rather than from a project sub-path, so the
 * repository name has no business appearing in an asset URL. Written here
 * rather than derived: `PERIAPSIS_BASE` in the workflow no longer reaches this.
 */
const base = '/'

export default defineConfig({
  base,
  plugins: [react(), tailwindcss(), provideDraco(), pruneUnusedModels(), stampModules()],
  server: { port: 5173, host: true },
})
