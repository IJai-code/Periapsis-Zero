/**
 * Hulls. Numbers in SI: kg, N, m/s, rad/s. Thrust is given as acceleration
 * (m/s^2) because that is what a pilot feels, and what the flight assist
 * spends: a Kestrel's 24 m/s^2 is about two and a half g.
 *
 * `drive` is the torch drive's cruise acceleration for transfers (0.3 g),
 * and `tank` the propellant in delta-v (m/s), which a brachistochrone spends
 * at a rate of `drive` for the whole trip.
 */
export const HULLS = {
  kestrel: {
    id: 'kestrel', name: 'Kestrel', role: 'Light freighter', price: 0, radius: 9, mass: 18e3,
    accel: 24, lateral: 12, maxSpeed: 220, boost: 1.9, rates: [1.5, 1.2, 2.4],
    shield: 120, hull: 160, guns: 2, cargo: 8, drive: 2.94, tank: 150e3,
    blurb: 'Old, honest and forgiving. Two guns, a small hold, and it will get you home.',
  },
  mule: {
    id: 'mule', name: 'Mule', role: 'Hauler', price: 48000, radius: 16, mass: 64e3,
    accel: 15, lateral: 7, maxSpeed: 170, boost: 1.6, rates: [0.9, 0.75, 1.4],
    shield: 220, hull: 380, guns: 1, cargo: 32, drive: 2.94, tank: 190e3,
    blurb: 'Thirty-two units of hold and a hidden compartment the scanners do not see.',
    hidden: 6,
  },
  lance: {
    id: 'lance', name: 'Lance', role: 'Interceptor', price: 86000, radius: 10, mass: 15e3,
    accel: 34, lateral: 18, maxSpeed: 310, boost: 2.0, rates: [2.1, 1.7, 3.2],
    shield: 180, hull: 200, guns: 4, cargo: 4, drive: 3.92, tank: 160e3,
    blurb: 'Built to catch things. Four guns, a fast drive and nowhere to put anything.',
  },
}
export const PLAYER_HULLS = ['kestrel', 'mule', 'lance']

/** Everyone else in the sky. */
export const NPC_HULLS = {
  raider: { id: 'raider', name: 'Hollow raider', radius: 7, accel: 26, lateral: 14, maxSpeed: 250, boost: 1.7, rates: [1.7, 1.4, 2.6], shield: 50, hull: 70, guns: 1, bounty: 1800 },
  warden: { id: 'warden', name: 'The Warden', radius: 14, accel: 22, lateral: 12, maxSpeed: 270, boost: 1.8, rates: [1.3, 1.1, 2.0], shield: 420, hull: 520, guns: 3, bounty: 25000 },
  cutter: { id: 'cutter', name: 'Compact cutter', radius: 11, accel: 26, lateral: 14, maxSpeed: 245, boost: 1.6, rates: [1.6, 1.3, 2.4], shield: 160, hull: 220, guns: 2 },
  freighter: { id: 'freighter', name: 'Freighter', radius: 42, accel: 4, lateral: 2, maxSpeed: 90, boost: 1, rates: [0.25, 0.2, 0.3], shield: 400, hull: 1600, guns: 0 },
  wing: { id: 'wing', name: 'Compact wingman', radius: 11, accel: 28, lateral: 15, maxSpeed: 290, boost: 1.8, rates: [1.6, 1.3, 2.4], shield: 200, hull: 260, guns: 2 },
}

/** The pulse laser: a visible bolt, not a hitscan beam, so it can be dodged. */
export const LASER = { speed: 2200, life: 1.4, damage: 8, rate: 7, spread: 0.002 }

/** Outfitting: each level costs more; each multiplies one number. */
export const UPGRADES = {
  engines: { name: 'Engines', effect: '+10% thrust and top speed', costs: [6000, 14000, 30000] },
  shields: { name: 'Shields', effect: '+25% shield, faster recharge', costs: [5000, 12000, 26000] },
  armor: { name: 'Armour', effect: '+25% hull', costs: [4000, 10000, 22000] },
  guns: { name: 'Gun cooling', effect: '+15% fire rate and damage', costs: [7000, 16000, 34000] },
  jammer: { name: 'Scan jammer', effect: 'Patrol scans miss 30% more often', costs: [15000, 32000] },
}

/** A hull with its upgrades applied. */
export function shipStats(hullId, up = {}) {
  const h = HULLS[hullId] ?? NPC_HULLS[hullId]
  const e = 1 + 0.1 * (up.engines ?? 0), sh = 1 + 0.25 * (up.shields ?? 0), ar = 1 + 0.25 * (up.armor ?? 0), gn = 1 + 0.15 * (up.guns ?? 0)
  return {
    ...h,
    accel: h.accel * e, lateral: h.lateral * e, maxSpeed: h.maxSpeed * e,
    shield: h.shield * sh, recharge: 0.06 * sh, hull: h.hull * ar,
    // Other pilots' guns are softer than yours: a fight should be lost to skill, not arithmetic.
    fireRate: LASER.rate * gn * (HULLS[hullId] ? 1 : 0.7), damage: LASER.damage * gn * (HULLS[hullId] ? 1 : 0.55),
    scanMiss: 0.3 * (up.jammer ?? 0),
  }
}
