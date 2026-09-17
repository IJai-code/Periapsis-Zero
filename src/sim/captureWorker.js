import { solveHaloCapture } from './capture.js'
import { nrhoGatewayMember } from './cr3bp.js'

/**
 * Run the halo capture search in a worker, from the page.
 *
 * Resolves with exactly what `solveHaloCapture` returns, and reports progress
 * as a fraction. Where there is no `Worker` — under Node, which is where every
 * gate runs — it solves in place instead, so a caller never needs to know which
 * it got.
 *
 * Only data crosses to the worker: a copy of the state, the family member, and
 * the numeric options. A null member asks for the Gateway's orbit, built on
 * whichever side of the call the search runs. A caller's `shoot` override is a function and cannot be
 * sent, so the worker always shoots with `shootHalo`.
 */

/** The options a worker can be sent; everything else is dropped rather than failing to clone. */
const SENDABLE = ['apolunes', 'transfers', 'mirrors', 'revolutions', 'step', 'probe', 'tolerance']

let worker = null
let nextId = 1

export function solveHaloCaptureInWorker(sim, member, options = {}, onProgress = null) {
  const snapshot = { state: Float64Array.from(sim.state), t: sim.t, testSoftening2: sim.testSoftening2 }
  const onCell = onProgress ? (done, total) => onProgress(done / total) : null

  if (typeof Worker === 'undefined') {
    try {
      return Promise.resolve(solveHaloCapture(snapshot, member ?? nrhoGatewayMember(), { ...options, onCell }))
    } catch (error) {
      return Promise.reject(error)
    }
  }

  const sent = {}
  for (const key of SENDABLE) if (options[key] !== undefined) sent[key] = options[key]
  if (!worker) worker = new Worker(new URL('./workers/capture.worker.js', import.meta.url), { type: 'module' })
  const id = nextId++

  return new Promise((resolve, reject) => {
    const finish = () => {
      worker.removeEventListener('message', listen)
      worker.removeEventListener('error', fail)
    }
    const listen = (event) => {
      const data = event.data
      if (data.id !== id) return
      if (data.type === 'progress') {
        if (onCell) onCell(data.done, data.total)
        return
      }
      finish()
      if (data.type === 'done') resolve(data.solution)
      else reject(new Error(data.message))
    }
    // A worker that fails to load or throws outside its handler reports here,
    // and without this the promise would never settle.
    const fail = (event) => {
      finish()
      reject(new Error(event.message || 'the capture worker failed'))
    }
    worker.addEventListener('message', listen)
    worker.addEventListener('error', fail)
    worker.postMessage({ id, sim: snapshot, member, options: sent })
  })
}
