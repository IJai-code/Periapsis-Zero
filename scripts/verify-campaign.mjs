import assert from 'node:assert/strict'
import { bank, buyUpgrade, campaignState, CHAPTERS, completedCount, finaleOpen, FINALE, nextWorld, recordMission, resetCampaign, totalStars, unlocked, upgradeCost, UPGRADES, validateCampaign } from '../src/sim/campaign.js'
import { CAMPAIGN_ORDER, WORLDS } from '../src/sim/worlds.js'
import { playMission } from './lib/surfaceBot.mjs'

/*
 * The campaign's rules: worlds open in order, science pays only for beating
 * your best, upgrades cost what they say and change the lander, the finale
 * opens after nine surveys, and saved progress that is malformed or forged is
 * cleaned rather than trusted. Then one real mission, played by the scripted
 * player, is recorded the way the game records it.
 */
let checks = 0
const check = (name, fn) => { fn(); console.log(`  ✓ ${name}`); checks++ }
const result = (total, stars, complete = stars > 0) => ({ total, stars, complete, science: Math.round(total / 10), anomaly: stars === 3 })

check('every campaign world has a chapter, and the order is the one the briefings tell', () => {
  assert.equal(CAMPAIGN_ORDER[0], 'moon')
  assert.equal(CAMPAIGN_ORDER.at(-1), 'halley')
  for (const id of CAMPAIGN_ORDER) assert.ok(CHAPTERS[id]?.brief && WORLDS[id], id)
  assert.ok(FINALE.minimum <= CAMPAIGN_ORDER.length)
})

check('worlds open one at a time, and a failed survey opens nothing', () => {
  resetCampaign()
  assert.ok(unlocked('moon') && !unlocked('mars'))
  assert.equal(nextWorld(), 'moon')
  assert.equal(recordMission('mars', result(2000, 2)).earned, 0, 'a locked world records nothing')
  assert.equal(campaignState().worlds.mars, undefined)
  recordMission('moon', result(900, 0, false))
  assert.ok(!unlocked('mars'), 'an unfinished survey does not unlock the next world')
  recordMission('moon', result(1900, 2))
  assert.ok(unlocked('mars') && !unlocked('phobos'))
  assert.equal(nextWorld(), 'mars')
})

check('science pays only the improvement on your best; replaying the same score pays nothing', () => {
  resetCampaign()
  assert.equal(recordMission('moon', result(1900, 2)).earned, 190)
  assert.equal(recordMission('moon', result(1900, 2)).earned, 0)
  assert.equal(recordMission('moon', result(1500, 1)).earned, 0, 'a worse run pays nothing and keeps the best')
  assert.equal(campaignState().worlds.moon.best, 1900)
  assert.equal(campaignState().worlds.moon.stars, 2)
  assert.equal(recordMission('moon', result(2600, 3)).earned, 70)
  assert.equal(bank(), 260)
  assert.equal(totalStars(), 3)
})

check('upgrades cost what the shop says, in order, and run out', () => {
  resetCampaign({ version: 2, worlds: {}, science: 1000, spent: 0, upgrades: {} })
  const engine = UPGRADES.find((u) => u.id === 'engine')
  let spent = 0
  for (const cost of engine.costs) {
    assert.equal(upgradeCost('engine'), cost)
    assert.ok(buyUpgrade('engine'))
    spent += cost
  }
  assert.equal(upgradeCost('engine'), null)
  assert.equal(buyUpgrade('engine'), false, 'no fourth level')
  assert.equal(bank(), 1000 - spent)
  resetCampaign({ version: 2, worlds: {}, science: 10, spent: 0, upgrades: {} })
  assert.equal(buyUpgrade('scanner'), false, 'not without the science')
})

check('the finale opens after nine surveys, on a world you surveyed', () => {
  resetCampaign()
  for (const id of CAMPAIGN_ORDER.slice(0, FINALE.minimum - 1)) recordMission(id, result(2000, 2))
  assert.equal(completedCount(), FINALE.minimum - 1)
  assert.equal(finaleOpen(), false)
  recordMission('mars', result(2000, 2), { finale: true })
  assert.equal(campaignState().finale, null, 'the finale cannot be flown early')
  recordMission(CAMPAIGN_ORDER[FINALE.minimum - 1], result(2000, 2))
  assert.ok(finaleOpen())
  recordMission('callisto', result(2400, 2), { finale: true })
  assert.deepEqual(campaignState().finale, { site: 'callisto', done: true, stars: 2 })
})

check('saved progress is cleaned: unknown worlds, impossible stars and overspending are dropped', () => {
  const v = validateCampaign({
    version: 2, science: 100, spent: 500,
    worlds: { moon: { best: 2000, stars: 2, science: 200 }, mars: { best: 'lots', stars: 2 }, venus: { best: 10, stars: 9 }, jupiter: { best: 1, stars: 1 } },
    upgrades: { engine: 7, teleporter: 1, tanks: -1 },
    finale: { site: 'jupiter', done: true },
  })
  assert.deepEqual(Object.keys(v.worlds), ['moon'])
  assert.equal(v.spent, 100, 'cannot have spent more than was earned')
  assert.deepEqual(v.upgrades, { engine: 3 })
  assert.equal(v.finale, null)
  assert.deepEqual(validateCampaign({ version: 1, worlds: { moon: { best: 1, stars: 1 } } }).worlds, {}, 'another version starts clean')
  assert.deepEqual(validateCampaign(null).worlds, {})
})

check('a real mission, played to the end with upgrades bought, records and pays out', () => {
  resetCampaign({ version: 2, worlds: {}, science: 200, spent: 0, upgrades: {} })
  assert.ok(buyUpgrade('motor'))
  const { s, why } = playMission('moon', { upgrades: campaignState().upgrades })
  assert.equal(s.mode, 'complete', why ?? '')
  assert.ok(s.roverSpec.maxSpeed > 3.4, 'the upgrade reached the rover')
  const { earned } = recordMission('moon', s.result)
  assert.equal(earned, s.result.science)
  assert.ok(unlocked('mars'))
  console.log(`    ${s.result.total} points, ${s.result.stars} stars, ${earned} science`)
})

resetCampaign()
console.log(`\n${checks} campaign checks pass.`)
