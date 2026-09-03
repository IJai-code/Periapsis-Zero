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
    name: 'spxsim:prune-unused-models',
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

export default defineConfig({
  plugins: [react(), tailwindcss(), pruneUnusedModels()],
  server: { port: 5173, host: true },
})
