import { isLandable } from './worlds.js'

/**
 * Where an address leads. Two ways in, both the simulator:
 *
 *   #flight          the simulator, free: the real solar system, and a landing
 *                    on any world that is in view
 *   #campaign        the same simulator with the Station Zero campaign over it
 *   #land/<world>    the simulator, straight onto that world's surface
 *
 * Older links keep working: #story is the campaign now, and an expedition link
 * is a landing on the same world.
 */
export function experienceFromHash(hash) {
  if (hash === '#flight') return { mode: 'simulator' }
  if (hash === '#campaign' || hash === '#story') return { mode: 'campaign' }
  const land = /^#land\/([a-z]+)$/.exec(hash)
  if (land) return isLandable(land[1]) ? { mode: 'land', id: land[1] } : { mode: 'home' }
  const old = /^#expedition\/([a-z]+)(\/campaign)?$/.exec(hash)
  if (old) return old[2] ? { mode: 'campaign' } : isLandable(old[1]) ? { mode: 'land', id: old[1] } : { mode: 'home' }
  return { mode: 'home' }
}
export function landHash(id) {
  if (!isLandable(id)) throw new Error(`Not a landable world: ${id}`)
  return `#land/${id}`
}
