/**
 * The campaign: the Station Zero survey.
 *
 * The story in one line: humanity is choosing where to build its first
 * station beyond the Moon, Station Zero, and you fly the survey that decides.
 * Twelve worlds in order, each a landing and a survey (sim/expedition.js);
 * each finished survey unlocks the next and earns science to spend on the
 * lander and rover. When nine are done, the finale opens: choose the site,
 * and land the station's first module there.
 *
 * Progress is saved in this browser under one key, and follows a signed-in
 * player to other devices (sim/account.js merges it; numbers keep their
 * best, which is the rule the merge already applies).
 */
import { CAMPAIGN_ORDER, WORLDS } from './worlds.js'

const KEY = 'pz-campaign-v2'

/** Mission control, and what each world's survey is for. */
export const CHAPTERS = {
  moon: { title: 'A place to stand', from: 'Mara Voss, flight director', brief: 'First survey of the program, close to home. Land on the pad, collect three samples, set up the station, and come back. The rest of the solar system depends on this lander working.' },
  mars: { title: 'The layers below', from: 'Elias Chen, field geologist', brief: 'The canyon walls are layered like a cake. Sample the beds, set up the station on the plain, and find the outcrop that looks like an old lakebed.' },
  phobos: { title: 'A moon you could throw a ball off', from: 'Mara Voss, flight director', brief: 'Gravity here is a thousandth of Earth\'s: a jump would never come down. No rover. Hop the lander from site to site, and watch Mars fill half the sky.' },
  mercury: { title: 'Ice in the shadows', from: 'Elias Chen, field geologist', brief: 'The closest world to the Sun still keeps ice in its polar craters. Survey the plains, then find the hollows, where the ground itself is boiling away into space.' },
  venus: { title: 'Eight minutes', from: 'Amara Okafor, mission scientist', brief: 'Ninety times Earth\'s air pressure and 465 °C. The air is so thick the lander floats down on it. You have eight minutes on the surface before the heat wins. Work fast.' },
  io: { title: 'Fire and sulfur', from: 'Amara Okafor, mission scientist', brief: 'Io never stops erupting. Land beside Loki Patera, survey the sulfur plains, and get a reading at the edge of the lava lake. Jupiter will be watching.' },
  europa: { title: 'Under the ice', from: 'Amara Okafor, mission scientist', brief: 'An ocean lies under this ice, with more water than all of Earth\'s seas. Somewhere on these plains it has leaked to the surface. Find the vent.' },
  ganymede: { title: 'The magnetic moon', from: 'Elias Chen, field geologist', brief: 'The largest moon in the solar system, and the only one with its own magnetic field. Survey the grooved bands where the crust has been torn open.' },
  callisto: { title: 'The oldest ground', from: 'Elias Chen, field geologist', brief: 'Nothing has changed here for four billion years except craters on craters. Far from Jupiter\'s radiation, it is a candidate for the station itself.' },
  titan: { title: 'Rivers of methane', from: 'Amara Okafor, mission scientist', brief: 'Thick orange air, dunes of organic sand, and lakes of liquid methane. Fly the lander down through the haze and get to the shoreline.' },
  pluto: { title: 'The heart of ice', from: 'Mara Voss, flight director', brief: 'Six light-hours from home. Survey the nitrogen glacier on Sputnik Planitia and find where it is still flowing. The Sun here is a very bright star.' },
  halley: { title: 'A visitor', from: 'Mara Voss, flight director', brief: 'The last survey: a comet, five kilometres of dust and ice falling back toward the Sun. Hop to the sites, and get close to an active jet without being blown off.' },
}

export const FINALE = {
  title: 'Station Zero',
  from: 'Mara Voss, flight director',
  brief: 'The surveys are in. You choose where the station goes. Land its first module on the world you pick, set up the station, and the program has a home.',
  minimum: 9,
}

/** What science buys: each level costs more than the last. */
export const UPGRADES = [
  { id: 'engine', name: 'Engine', effect: '+10% thrust a level', costs: [60, 140, 260] },
  { id: 'tanks', name: 'Tanks', effect: '+15% propellant a level', costs: [60, 140, 260] },
  { id: 'motor', name: 'Rover motor', effect: '+15% top speed a level', costs: [50, 120, 220] },
  { id: 'battery', name: 'Rover battery', effect: '+30% range a level', costs: [50, 120, 220] },
  { id: 'scanner', name: 'Scanner', effect: '+120 m range a level', costs: [70, 160, 280] },
]

const blank = () => ({ version: 2, worlds: {}, science: 0, spent: 0, upgrades: {}, finale: null })

export function validateCampaign(v) {
  const out = blank()
  if (!v || v.version !== 2 || typeof v !== 'object') return out
  for (const id of CAMPAIGN_ORDER) {
    const w = v.worlds?.[id]
    if (w && Number.isFinite(w.best) && Number.isInteger(w.stars) && w.stars >= 0 && w.stars <= 3) out.worlds[id] = { best: Math.max(0, w.best), stars: w.stars, science: Math.max(0, w.science ?? 0), completed: typeof w.completed === 'string' ? w.completed : null }
  }
  out.science = Number.isFinite(v.science) ? Math.max(0, v.science) : 0
  out.spent = Number.isFinite(v.spent) ? Math.max(0, Math.min(v.spent, out.science)) : 0
  for (const u of UPGRADES) {
    const lvl = v.upgrades?.[u.id]
    if (Number.isInteger(lvl) && lvl > 0) out.upgrades[u.id] = Math.min(lvl, u.costs.length)
  }
  if (v.finale && WORLDS[v.finale.site] && typeof v.finale.done === 'boolean') out.finale = { site: v.finale.site, done: v.finale.done, stars: Number.isInteger(v.finale.stars) ? v.finale.stars : 0 }
  return out
}

let state
try { state = validateCampaign(JSON.parse(globalThis.localStorage?.getItem(KEY) ?? 'null')) } catch { state = blank() }
const listeners = new Set()
const save = () => {
  try { globalThis.localStorage?.setItem(KEY, JSON.stringify(state)) } catch { /* in memory only */ }
  listeners.forEach((fn) => fn())
}
export const campaignState = () => state
export const subscribeCampaign = (fn) => { listeners.add(fn); return () => listeners.delete(fn) }
/** For tests: start over. */
export function resetCampaign(next = blank()) { state = validateCampaign(next); save() }

export const completedCount = (s = state) => CAMPAIGN_ORDER.filter((id) => (s.worlds[id]?.stars ?? 0) >= 1).length
export const totalStars = (s = state) => CAMPAIGN_ORDER.reduce((n, id) => n + (s.worlds[id]?.stars ?? 0), 0)
export const bank = (s = state) => s.science - s.spent
/** A world opens when the one before it in the order has a completed survey. */
export function unlocked(id, s = state) {
  const i = CAMPAIGN_ORDER.indexOf(id)
  return i === 0 || (i > 0 && (s.worlds[CAMPAIGN_ORDER[i - 1]]?.stars ?? 0) >= 1)
}
export const nextWorld = (s = state) => CAMPAIGN_ORDER.find((id) => unlocked(id, s) && !(s.worlds[id]?.stars >= 1)) ?? null
export const finaleOpen = (s = state) => completedCount(s) >= FINALE.minimum

/**
 * A finished mission's result into the campaign. Science counts only what
 * beats your best on that world, so replaying for a better score pays the
 * difference, and replaying the same score pays nothing.
 */
export function recordMission(id, result, { finale = false } = {}) {
  if (!WORLDS[id] || !result) return { earned: 0 }
  if (finale) {
    if (!finaleOpen()) return { earned: 0 }
    state = { ...state, finale: { site: id, done: result.complete, stars: Math.max(result.stars, state.finale?.site === id ? state.finale.stars : 0) } }
    save()
    return { earned: 0 }
  }
  if (!unlocked(id)) return { earned: 0 }
  const prior = state.worlds[id] ?? { best: 0, stars: 0, science: 0, completed: null }
  const earned = Math.max(0, result.science - prior.science)
  state = {
    ...state,
    science: state.science + earned,
    worlds: {
      ...state.worlds,
      [id]: {
        best: Math.max(prior.best, result.total),
        stars: Math.max(prior.stars, result.stars),
        science: Math.max(prior.science, result.science),
        completed: result.complete ? new Date().toISOString() : prior.completed,
      },
    },
  }
  save()
  return { earned }
}

export function upgradeCost(id, s = state) {
  const u = UPGRADES.find((x) => x.id === id)
  const level = s.upgrades[id] ?? 0
  return u && level < u.costs.length ? u.costs[level] : null
}
export function buyUpgrade(id) {
  const cost = upgradeCost(id)
  if (cost === null || bank() < cost) return false
  state = { ...state, spent: state.spent + cost, upgrades: { ...state.upgrades, [id]: (state.upgrades[id] ?? 0) + 1 } }
  save()
  return true
}
