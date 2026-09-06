import { useEffect, useState } from 'react'
import * as THREE from 'three'
import { configureTexture } from './textureSettings.js'
import { loadHdTextures } from './hdTextures.js'
import { setUi } from '../sim/store.js'

/**
 * Generates the procedural texture set in a worker and wraps the raw pixel
 * buffers in DataTextures.
 *
 * The procedural set is the *baseline*, not the product: real NASA imagery is
 * fetched at the same time and layered over it, and the load waits for both.
 * It used to be an opt-in switch in a panel, which meant the sim looked like
 * its fallback to anyone who did not find the switch — and most people do not
 * go looking for a render panel before deciding what a thing looks like.
 *
 * The two run in parallel because they contend for nothing: one is a worker
 * grinding noise on the CPU, the other is bytes off disk or the network. Doing
 * them in sequence would add the download to a load that is already long.
 *
 * Missing imagery is not an error. Any slot without a real image keeps its
 * generated version, so an offline machine, a fresh clone, or a partial set all
 * still fly — they just fly against procedural ground.
 */
function toDataTexture(buf, slot) {
  const tex = new THREE.DataTexture(buf.data, buf.width, buf.height, THREE.RGBAFormat)
  return configureTexture(tex, slot)
}

export function useAssets() {
  const [state, setState] = useState({
    ready: false,
    progress: 0,
    label: 'booting',
    textures: null,
    imagery: { found: 0, missing: [] },
  })

  useEffect(() => {
    // No mount guard: cleanup terminates the worker, so under StrictMode's
    // double-mount the second effect must be free to start a fresh one. Guarding
    // instead leaves the first worker killed and no replacement running.
    let cancelled = false

    setUi({ hdStatus: 'loading', hdLoaded: 0, hdTotal: 0 })
    const imagery = loadHdTextures((loaded, total) => {
      if (!cancelled) setUi({ hdLoaded: loaded, hdTotal: total })
    })
      .then((r) => {
        if (!cancelled) setUi({ hdStatus: r.found > 0 ? 'ready' : 'unavailable' })
        return r
      })
      .catch((err) => {
        // Not fatal, and not silent either: the scene is still flyable on the
        // procedural set, but a failed fetch should be findable.
        console.error('[spxsim] NASA imagery failed to load', err)
        if (!cancelled) setUi({ hdStatus: 'error' })
        return { textures: {}, found: 0, missing: [] }
      })

    const worker = new Worker(new URL('./generate.worker.js', import.meta.url), { type: 'module' })

    worker.onmessage = async (event) => {
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

      // Wait for the imagery too, so the first frame is the finished article
      // rather than a procedural one that swaps under the viewer a beat later.
      setState((s) => ({ ...s, label: 'imagery' }))
      const hd = await imagery
      if (cancelled) return

      setState({
        ready: true,
        progress: 1,
        label: 'ready',
        textures,
        imagery: { found: hd.found, missing: hd.missing },
      })
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
