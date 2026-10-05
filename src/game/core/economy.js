import { PLACES, STATIONS, placeDistance } from './world.js'

/**
 * Money: what each station pays for things, and the work it offers.
 *
 * Prices are a base, times what the station is short of or long on, times a
 * daily wobble that is the same for everyone on the same game day (a hash,
 * not a random draw), so a price you saw is a price you can plan on until
 * midnight.
 */
export const GOODS = {
  water: { name: 'Water ice', base: 90 },
  food: { name: 'Food', base: 160 },
  alloys: { name: 'Alloys', base: 260 },
  parts: { name: 'Machine parts', base: 420 },
  medical: { name: 'Medical supplies', base: 650 },
  helium3: { name: 'Helium-3', base: 1200 },
  chips: { name: 'Grey chips', base: 1800, contraband: true },
}
export const GOOD_ORDER = Object.keys(GOODS)

/** What each station is short of (>1) or long on (<1); null: will not trade it. */
const DEMAND = {
  hearth: { water: 1.35, food: 1.3, alloys: 1.0, parts: 0.85, medical: 1.1, helium3: 1.0, chips: 1.55 },
  harbor: { water: 1.0, food: 0.7, alloys: 1.2, parts: 0.8, medical: 0.75, helium3: 1.35, chips: null },
  shackle: { water: 1.15, food: 1.4, alloys: 0.8, parts: 1.25, medical: 1.6, helium3: 0.9, chips: 0.55 },
  gateway: { water: 1.45, food: 1.35, alloys: 0.85, parts: 1.15, medical: 1.2, helium3: 0.75, chips: null },
}

const DAY = 86400
export const dayOf = (time) => Math.floor(time / DAY)
function hash(...xs) {
  let h = 2166136261
  for (const x of xs) for (const ch of String(x)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) }
  return ((h >>> 0) % 100000) / 100000
}

/** Mid price of a good at a station today, or null if it does not trade it. */
export function price(station, good, time) {
  const m = DEMAND[station]?.[good]
  if (m == null) return null
  return Math.round(GOODS[good].base * m * (0.88 + 0.24 * hash(station, good, dayOf(time))))
}
export const buyPrice = (station, good, time) => { const p = price(station, good, time); return p == null ? null : Math.ceil(p * 1.04) }
export const sellPrice = (station, good, time) => { const p = price(station, good, time); return p == null ? null : Math.floor(p * 0.96) }

/* ------------------------------------------------------------------ *
 * The job board
 * ------------------------------------------------------------------ */

/** What each station posts. */
const BOARDS = {
  hearth: ['courier', 'haul', 'salvage', 'bounty', 'survey', 'courier'],
  harbor: ['courier', 'haul', 'race', 'bounty', 'haul'],
  shackle: ['smuggle', 'smuggle', 'salvage', 'courier'],
  gateway: ['bounty', 'haul', 'survey', 'courier'],
}
const DOCKABLE = Object.keys(STATIONS)
const placeOf = (stationId) => STATIONS[stationId].place
const km = (a, b) => (a === b ? 0 : placeDistance(placeOf(a), placeOf(b)) / 1000)

/**
 * Today's offers at a station: deterministic in (station, day), so leaving
 * and coming back shows the same board, and a new day brings new work.
 */
export function jobBoard(station, time) {
  const day = dayOf(time)
  return (BOARDS[station] ?? []).map((type, i) => makeJob(type, station, day, i, time)).filter(Boolean)
}

function makeJob(type, from, day, i, time) {
  const r = (k) => hash(from, day, i, k)
  const id = `${from}-${day}-${i}`
  const others = DOCKABLE.filter((s) => s !== from)
  const to = others[Math.floor(r('to') * others.length)]
  const dist = km(from, to)
  const travel = 2 * Math.sqrt(dist * 1000 / 2.94) // brachistochrone at 0.3 g, s
  const deadline = time + Math.max(6 * 3600, travel * 3 + 8 * 3600)
  const names = { hearth: 'Hearth', harbor: 'Harbor', shackle: 'the Shackle', gateway: 'Gateway' }
  switch (type) {
    case 'courier': {
      const reward = Math.round((1200 + 9 * Math.sqrt(dist)) / 50) * 50
      return { id, type, from, to, title: `Courier to ${names[to]}`, brief: `A sealed case for ${names[to]}. Do not open it. ${Math.round(dist).toLocaleString()} km.`, reward, deadline, legal: true }
    }
    case 'haul': {
      const goods = ['water', 'food', 'alloys', 'parts', 'medical']
      const good = goods[Math.floor(r('g') * goods.length)]
      const n = 4 + Math.floor(r('n') * 10)
      const reward = Math.round((n * 230 + 6 * Math.sqrt(dist)) / 50) * 50
      return { id, type, from, to, good, n, title: `Haul ${n} ${GOODS[good].name.toLowerCase()} to ${names[to]}`, brief: `${n} units, loaded here, delivered to ${names[to]}. Needs ${n} free hold.`, reward, deadline, legal: true }
    }
    case 'salvage': {
      const n = 4 + Math.floor(r('n') * 4)
      return { id, type, from, to: from, place: 'drift', n, title: `Salvage ${n} canisters`, brief: `Recover ${n} cargo canisters from the Drift and bring them back here. The Hollow call it theirs.`, reward: n * 700, deadline: time + 2 * 86400, legal: true }
    }
    case 'bounty': {
      const n = 2 + Math.floor(r('n') * 3)
      return { id, type, from, to: from, place: 'drift', n, title: `Bounty: ${n} Hollow raiders`, brief: `A raider pack is working the Drift. Destroy ${n}. Paid on proof, here.`, reward: n * 1900, deadline: time + 2 * 86400, legal: true }
    }
    case 'race': {
      return { id, type, from, to: from, place: 'harbor', par: 95, title: 'The Harbor Loop', brief: 'Eight rings round Harbor, against the clock. Under 95 seconds pays; under 75 pays double.', reward: 4000, deadline: time + 86400, legal: true }
    }
    case 'survey': {
      return { id, type, from, to: from, place: 'shackleton', title: 'Survey at Shackleton', brief: 'Land at the south pole, collect three samples, set a station, lift off. The ice consortium pays by the star.', reward: 5000, deadline: time + 3 * 86400, legal: true }
    }
    case 'smuggle': {
      const dests = ['hearth', 'gateway', 'harbor']
      const dest = dests[Math.floor(r('d') * dests.length)]
      const n = 2 + Math.floor(r('n') * 3)
      const reward = Math.round((n * 3200 + 12 * Math.sqrt(km(from, dest))) / 100) * 100
      return { id, type, from, to: dest, good: 'chips', n, title: `No questions: ${n} crates to ${names[dest]}`, brief: `${n} units of grey chips for a buyer at ${names[dest]}. The patrol scans near Compact stations. If they find it, it is yours, not ours.`, reward, deadline, legal: false }
    }
  }
  return null
}

/** Propellant (delta-v, m/s) and ship time (s) for a transfer: a brachistochrone. */
export function transferCost(fromPlace, toPlace, accel) {
  const d = placeDistance(fromPlace, toPlace)
  const t = 2 * Math.sqrt(d / accel)
  return { distance: d, time: t, dv: accel * t }
}

/** What a refill costs: propellant at Hearth's price, per km/s of delta-v. */
export const FUEL_PER_KMS = 14
export const REPAIR_PER_HP = 9

export { PLACES }
