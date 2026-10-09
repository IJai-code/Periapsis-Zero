import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { launch, wait } from './lib/chrome.mjs'

// Reuse the exact campaign scenarios asserted by verify-game. The browser
// runs the same core through Vite, yielding after each mission so React and
// the real renderer must present it before continuing. This is scripted play,
// not proof that a first-time human can complete every combat or race.
const source = readFileSync('scripts/verify-game.mjs', 'utf8')
const start = source.indexOf('function playStory(choice) {')
const end = source.indexOf('\nfor (const choice of', start)
assert.ok(start > 0 && end > start, 'campaign scenario source is present')
const runner = source.slice(start, end)
  .replace('function playStory(choice)', 'async function playStory(choice)')
  .replace("const b = createPilot('Bot')", "const b = createPilot('Browser pilot'); window.__game = b.g; window.__campaignGame = b.g")
  .replace('        break\n', '        await checkpoint(g, id)\n        break\n')
  .replace('process.env.STORY_DEBUG', 'false')
const url = process.env.PZ_URL ?? 'http://127.0.0.1:5175'
const out = 'docs/3091-checks'
mkdirSync(out, { recursive: true })
const report = { kind: 'Scripted full-branch browser play; numerical flight commands, not manual keyboard play', branches: {} }
const p = await launch()
try {
  await p.goto(url, 1000)
  await p.evaluate("(async()=>{const {newSave}=await import('/src/game/core/game.js');localStorage.setItem('pz-game-v1',JSON.stringify(newSave('Browser pilot')));localStorage.setItem('pz-game-quality','low');localStorage.setItem('pz-sky','off')})()")
  await p.goto(`${url}/#play`, 5000)
  // Bot commands drive physics. Prevent the mounted frame loop from adding
  // extra pilot steps while it presents checkpoint states.
  await p.evaluate("__game.step=()=>{}")
  for (const choice of ['chen', 'rook']) {
    const expression = `(async()=>{
      const THREE=await import('/node_modules/three/build/three.module.js');
      const {createPilot:originalPilot}=await import('/scripts/lib/gameBot.mjs');
      const {startStory,chooseStory,STORY}=await import('/src/game/core/story.js');
      const {buyUpgrade,respawn}=await import('/src/game/core/game.js');
      const V3=(x,y,z)=>new THREE.Vector3(x,y,z);
      let seed=0x2091;Math.random=()=>{seed=(seed+0x6d2b79f5)|0;let t=seed;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return ((t^(t>>>14))>>>0)/4294967296};
      // Copy each checkpoint into the mounted game's object so React and
      // its renderer present the bot's actual state.
      const mounted=__game;
      const checkpoint=async(g,id)=>{Object.assign(mounted,g);window.__campaignCheckpoint={id,done:g.story.done.slice(),choice:g.story.choice,mode:g.mode,credits:g.credits,place:g.place};await new Promise(r=>{window.__campaignContinue=r})};
      ${runner.replace("const b = createPilot('Browser pilot'); window.__game = b.g; window.__campaignGame = b.g", "const b = originalPilot('Browser pilot'); window.__campaignGame = b.g")}
      const result=await playStory(${JSON.stringify(choice)});Object.assign(mounted,result.g);
      window.__campaignResult={done:result.g.story.done.slice(),choice:result.g.story.choice,debt:result.g.debt,hours:result.g.time/3600,trips:result.g.stats.trips,kills:result.g.stats.kills,retries:result.deaths};return window.__campaignResult;
    })()`
    // Start asynchronously; checkpoint continuation is driven by this process.
    await p.evaluate(`window.__campaignCheckpoint=null;window.__campaignResult=null;window.__campaignError=null;(${expression}).catch(e=>{window.__campaignError=e.stack});true`)
    const missions = []
    let previous = ''
    for (let i = 0; i < 240; i++) {
      await wait(300)
      const state = await p.evaluate('({checkpoint:window.__campaignCheckpoint,result:window.__campaignResult,error:window.__campaignError})')
      if (state.error) throw Error(state.error)
      if (state.result) { report.branches[choice] = { ...state.result, missions }; break }
      const c = state.checkpoint
      if (c && c.id !== previous) {
        previous = c.id
        await wait(400)
        const ui = await p.evaluate("({text:document.body.innerText.slice(0,2200),canvas:!!document.querySelector('canvas')})")
        assert.ok(ui.canvas)
        missions.push({ ...c, ui: ui.text })
        if (['arrival', 'periapsis', 'apoapsis'].includes(c.id)) writeFileSync(`${out}/${choice}-${c.id}.png`, await p.shot())
        console.log(`  ✓ ${choice}: ${c.id} presented (${c.mode}, ${c.place})`)
        await p.evaluate('window.__campaignContinue();true')
      }
    }
    const result = report.branches[choice]
    assert.ok(result, `branch ${choice} did not finish`)
    assert.equal(result.done.length, 15); assert.equal(result.choice, choice); assert.equal(result.debt, 0)
  }
  report.errors = p.logs().filter(l => /^error/.test(l)); assert.deepEqual(report.errors, [])
  writeFileSync(`${out}/campaign-results.json`, JSON.stringify(report, null, 2) + '\n')
  console.log('Both complete branches rendered, with no browser errors.')
} finally { p.close() }
