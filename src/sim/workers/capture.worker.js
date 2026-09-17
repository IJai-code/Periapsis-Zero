/**
 * The halo capture search, off the page's main thread.
 *
 * `solveHaloCapture` shoots a reference for every cell it tries, and on the main
 * thread that is about 19 s in which the page draws nothing and answers nothing.
 * Here the search takes the same time while the scene keeps rendering.
 *
 * A request carries a copy of the simulation's state rather than the simulation:
 * a worker shares no memory with the page, and the search needs only the bodies,
 * the craft and the epoch. Progress is posted after every cell.
 */
import { solveHaloCapture } from '../capture.js'

self.onmessage = (event) => {
  const { id, sim, member, options } = event.data
  try {
    const solution = solveHaloCapture(sim, member, {
      ...options,
      onCell: (done, total) => self.postMessage({ id, type: 'progress', done, total }),
    })
    self.postMessage({ id, type: 'done', solution })
  } catch (error) {
    self.postMessage({ id, type: 'error', message: error instanceof Error ? error.message : String(error) })
  }
}
