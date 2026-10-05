import { isLandable } from './worlds.js'

/**
 * Where an address leads.
 *
 *   (nothing)        the title screen: the game
 *   #play            the game
 *   #sim, #flight    the solar system simulator
 *   #land/<world>    the simulator, straight onto that world's surface
 *
 * Older links keep working: the campaign and the story are the game now,
 * and an expedition link is a landing on the same world.
 */
export function experienceFromHash(hash) {
  if (hash === '#play' || hash === '#campaign' || hash === '#story') return { mode: 'play' }
  if (hash === '#sim' || hash === '#flight') return { mode: 'simulator' }
  const land = /^#land\/([a-z]+)$/.exec(hash)
  if (land) return isLandable(land[1]) ? { mode: 'land', id: land[1] } : { mode: 'home' }
  const old = /^#expedition\/([a-z]+)(\/campaign)?$/.exec(hash)
  if (old) return old[2] ? { mode: 'play' } : isLandable(old[1]) ? { mode: 'land', id: old[1] } : { mode: 'home' }
  return { mode: 'home' }
}
export function landHash(id) {
  if (!isLandable(id)) throw new Error(`Not a landable world: ${id}`)
  return `#land/${id}`
}
