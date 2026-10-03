import { chapterUnlocked, REGIONS } from './expedition.js'

export function experienceFromHash(hash) {
  if (hash === '#flight') return { mode: 'simulator' }
  if (hash === '#story') return { mode: 'story' }
  const match = /^#expedition\/(moon|mars|europa)(\/campaign)?$/.exec(hash)
  if (match) {
    const campaign = Boolean(match[2])
    if (campaign && !chapterUnlocked(match[1])) return { mode: 'story' }
    return { mode: 'expedition', id: match[1], campaign }
  }
  return { mode: 'home' }
}
export function expeditionHash(id, campaign = false) {
  if (!REGIONS[id]) throw new Error(`Unknown expedition destination: ${id}`)
  return `#expedition/${id}${campaign ? '/campaign' : ''}`
}
