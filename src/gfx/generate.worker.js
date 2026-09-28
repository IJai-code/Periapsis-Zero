import { generateEarth } from './earth.js'
import { generateMoon } from './moon.js'

/**
 * All texture synthesis runs here so the main thread stays free to paint the
 * loading screen. Buffers come back as transferables — nothing is copied.
 */

/*
 * The sky is no longer a texture: the Milky Way is marched from a volume model
 * on the GPU (components/Cosmos.jsx), so the 4096x2048 painted panorama that
 * was generated here first is gone, and with it an eighth of the load.
 */
const STAGES = [
  { key: 'earth', weight: 0.57, run: generateEarth },
  { key: 'moon', weight: 0.43, run: generateMoon },
]

self.onmessage = () => {
  const result = {}
  const transfer = []
  let done = 0

  for (const stage of STAGES) {
    const base = done
    const out = stage.run((label, frac = 0) => {
      self.postMessage({ type: 'progress', label, value: base + stage.weight * frac })
    })
    for (const key of Object.keys(out)) {
      result[`${stage.key}.${key}`] = out[key]
      transfer.push(out[key].data.buffer)
    }
    done += stage.weight
    self.postMessage({ type: 'progress', label: stage.key, value: done })
  }

  self.postMessage({ type: 'done', result }, transfer)
}
