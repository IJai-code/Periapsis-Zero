import { useEffect, useState } from 'react'
import * as THREE from 'three'
import { configureTexture } from './textureSettings.js'

/**
 * Generates the procedural texture set in a worker and wraps the raw pixel
 * buffers in DataTextures.
 *
 * This is the offline-first baseline and the only thing the initial load waits
 * on. Real NASA imagery is layered over it on demand — see ./hdTextures.js.
 */
function toDataTexture(buf, slot) {
  const tex = new THREE.DataTexture(buf.data, buf.width, buf.height, THREE.RGBAFormat)
  return configureTexture(tex, slot)
}

export function useAssets() {
  const [state, setState] = useState({ ready: false, progress: 0, label: 'booting', textures: null })

  useEffect(() => {
    // No mount guard: cleanup terminates the worker, so under StrictMode's
    // double-mount the second effect must be free to start a fresh one. Guarding
    // instead leaves the first worker killed and no replacement running.
    let cancelled = false
    const worker = new Worker(new URL('./generate.worker.js', import.meta.url), { type: 'module' })

    worker.onmessage = (event) => {
      const msg = event.data
      if (cancelled) return

      if (msg.type === 'progress') {
        setState((s) => ({ ...s, progress: msg.value, label: msg.label }))
        return
      }

      setState((s) => ({ ...s, progress: 1, label: 'uploading' }))
      const textures = {}
      for (const [slot, buf] of Object.entries(msg.result)) {
        textures[slot] = toDataTexture(buf, slot)
      }

      worker.terminate()
      setState({ ready: true, progress: 1, label: 'ready', textures })
    }

    worker.onerror = (err) => {
      console.error('[spxsim] texture generation failed', err)
      setState((s) => ({ ...s, label: 'generation failed' }))
    }

    worker.postMessage('start')
    return () => {
      cancelled = true
      worker.terminate()
    }
  }, [])

  return state
}
