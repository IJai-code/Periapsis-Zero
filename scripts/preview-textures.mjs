/**
 * Dumps every generated texture to PNG so the procedural pipeline can be tuned
 * without round-tripping through the browser. Run: npm run textures:preview
 */
import fs from 'node:fs'
import path from 'node:path'
import { generateEarth } from '../src/gfx/earth.js'
import { generateMoon } from '../src/gfx/moon.js'
import { generateSky } from '../src/gfx/sky.js'
import { encodePNG, preview } from './png.mjs'

const OUT = process.argv[2] ?? 'texture-preview'
fs.mkdirSync(OUT, { recursive: true })

const time = (label, fn) => {
  const t = Date.now()
  const r = fn()
  console.log(`  ${String(Date.now() - t).padStart(5)}ms  ${label}`)
  return r
}

console.log('generating…')
const sets = {
  sky: time('sky', () => generateSky()),
  earth: time('earth', () => generateEarth()),
  moon: time('moon', () => generateMoon()),
}

for (const [group, maps] of Object.entries(sets)) {
  for (const [name, buf] of Object.entries(maps)) {
    let src = buf.data
    // Composite alpha over black so cloud coverage is actually visible.
    if (name === 'clouds') {
      src = new Uint8Array(buf.data.length)
      for (let i = 0; i < src.length; i += 4) {
        const a = buf.data[i + 3] / 255
        src[i] = buf.data[i] * a
        src[i + 1] = buf.data[i + 1] * a
        src[i + 2] = buf.data[i + 2] * a
        src[i + 3] = 255
      }
    }
    const p = preview(src, buf.width, buf.height, 1024)
    const file = path.join(OUT, `${group}_${name}.png`)
    fs.writeFileSync(file, encodePNG(p.data, p.w, p.h))
    console.log(`  wrote ${file}  (source ${buf.width}x${buf.height})`)
  }
}
