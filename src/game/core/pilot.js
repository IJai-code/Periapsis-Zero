/**
 * The pilot: the suit you wear, and the licences you hold.
 *
 * Licences are earned in the Simulator, not in the game: the two halves of
 * the site share one career. Each one reads the Simulator's own records in
 * this browser (or this account, once signed in: both stores are synced),
 * so flying Apollo to the Moon in the Simulator is what puts a Translunar
 * licence in your game pilot's pocket, a suit in the locker, and a signing
 * bonus in the account.
 *
 * Pure apart from reading those two stores; under Node they read as empty.
 */

/** Suits: shell, stripe and visor colours, shown on the pilot in the cockpit and in the hangar. */
export const SUITS = [
  { id: 'hearth', name: 'Hearth issue', suit: '#f4e8cf', stripe: '#ff6b2c', visor: '#ffb070', note: 'What the dock gives every new pilot.' },
  { id: 'ion', name: 'Ion', suit: '#eef3f7', stripe: '#2fd3ff', visor: '#7fe2ff', note: 'Clean lines for clean flying.' },
  { id: 'night', name: 'Night shift', suit: '#1d1b24', stripe: '#c9973c', visor: '#ffd27a', note: 'Black and gold. Runs cold.' },
  { id: 'ember', name: 'Ember', suit: '#ff6b2c', stripe: '#120b22', visor: '#3bffb0', note: 'Easy to find in the dark.' },
  { id: 'pad', name: 'Pad 39', suit: '#ffffff', stripe: '#1f4e9a', visor: '#ffcc66', licence: 'orbit', note: 'For pilots who have made orbit by hand.' },
  { id: 'translunar', name: 'Translunar', suit: '#d8c08a', stripe: '#3a3946', visor: '#ffe9a8', licence: 'lunar', note: 'Gold foil. Three days from home.' },
  { id: 'dock', name: 'Docking orange', suit: '#ff9a3c', stripe: '#f4e8cf', visor: '#9fe9ff', licence: 'rendezvous', note: 'Thirty metres of intuition.' },
  { id: 'regolith', name: 'Regolith', suit: '#8d8a84', stripe: '#ff6b2c', visor: '#e8f4ff', licence: 'lander', note: 'Grey dust that never comes out.' },
  { id: 'homecoming', name: 'Homecoming', suit: '#f2f2ee', stripe: '#d63a2a', visor: '#ffb070', licence: 'splashdown', note: 'For the ones who brought it home.' },
]
export const suitById = (id) => SUITS.find((s) => s.id === id) ?? SUITS[0]

/**
 * Licences: what the Simulator says you have done. `chapters` are the
 * Simulator's story chapters, `phases` its logbook milestones; any one counts.
 */
export const LICENCES = [
  { id: 'orbit', name: 'Orbital', earn: 'Reach a parking orbit in the Simulator.', chapters: ['story-first-orbit'], phases: ['CIRCULARISE'], bonus: 3000 },
  { id: 'lunar', name: 'Translunar', earn: 'Fly a trans-lunar injection burn in the Simulator.', chapters: ['story-crossing'], phases: ['TLI_BURN', 'LOI_BURN'], bonus: 5000 },
  { id: 'rendezvous', name: 'Rendezvous', earn: 'Dock with another craft in the Simulator.', chapters: ['story-rendezvous'], phases: ['DOCKED'], bonus: 5000 },
  { id: 'lander', name: 'Lander', earn: 'Lift off from the Moon in the Simulator.', chapters: ['story-far-side'], phases: ['LUNAR_LIFTOFF'], bonus: 6000 },
  { id: 'splashdown', name: 'Homecoming', earn: 'Bring a crew home to a splashdown in the Simulator.', chapters: ['story-contact'], phases: ['SPLASHDOWN'], bonus: 8000 },
]

function read(key) {
  try { return JSON.parse(globalThis.localStorage?.getItem(key) ?? 'null') ?? {} } catch { return {} }
}
/** Which licences the Simulator's records grant, as a set of ids. */
export function earnedLicences() {
  const story = read('pz-story')
  const book = read('periapsis.logbook.v1')
  const phases = book.milestones ?? {}
  return new Set(LICENCES.filter((l) => l.chapters.some((c) => story[c]) || l.phases.some((p) => phases[p] != null)).map((l) => l.id))
}
export const suitUnlocked = (suit, earned = earnedLicences()) => !suit.licence || earned.has(suit.licence)

/** Pay any licence bonus not yet paid. Returns the licences newly claimed. */
export function claimLicences(g) {
  const earned = earnedLicences()
  g.pilot.licences = g.pilot.licences ?? []
  const fresh = LICENCES.filter((l) => earned.has(l.id) && !g.pilot.licences.includes(l.id))
  for (const l of fresh) { g.pilot.licences.push(l.id); g.credits += l.bonus; g.stats.earned += l.bonus }
  return fresh
}
