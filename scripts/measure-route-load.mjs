/**
 * How long a route takes to become usable, measured rather than assumed.
 *
 * The number that matters to a visitor is not when the JavaScript arrives but
 * when the thing they asked for is on screen and answerable. This drives a
 * route at a given viewport and reports the wall-clock time until a selector
 * for that thing exists, plus when the page stopped showing a loading screen.
 *
 *   PZ_URL=http://127.0.0.1:5175 node scripts/measure-route-load.mjs
 */
import { launch, wait } from './lib/chrome.mjs'

const url = process.env.PZ_URL ?? 'http://127.0.0.1:5175'
const SAVE = JSON.stringify({
  version: 1, pilot: { name: 'Measure' }, credits: 5000, debt: 40000,
  ship: { hull: 'kestrel', up: {}, hp: 1, prop: 150000, cargo: {} },
  home: 'hearth', time: 0, heat: 0,
  story: { active: 'arrival', step: 0, done: [], choice: null, offered: [] },
  jobs: [], flags: {}, stats: { kills: 0, earned: 0, jobs: 0, trips: 0, deaths: 0, fines: 0 },
})

// "Ready" means the thing asked for exists AND nothing is covering it: a modal
// mounted behind the loading screen is not usable, and an earlier version of
// this probe counted that as success.
const COVERED = "document.querySelector('.simulator-loading, .mode-loading')"
const TARGETS = [
  { name: 'landing on the Moon', hash: '#land/moon', ready: `!!document.querySelector('.sv-modal') && !${COVERED}` },
  { name: 'the simulator', hash: '#sim', ready: `!${COVERED} && !!document.body.innerText.match(/INSTRUMENTS|career · 3091/i)` },
  { name: 'the game at Hearth', hash: '#play', ready: `!!document.querySelector('.st-root, .np-card') && !${COVERED}`, save: true },
]

const VIEWPORTS = [
  { name: 'desktop 1280x800', width: 1280, height: 800, mobile: false },
  { name: 'phone 390x844', width: 390, height: 844, mobile: true },
]

const p = await launch({ width: 1280, height: 800 })
const rows = []
try {
  for (const vp of VIEWPORTS) {
    await p.send('Emulation.setDeviceMetricsOverride', { width: vp.width, height: vp.height, deviceScaleFactor: 1, mobile: vp.mobile })
    for (const target of TARGETS) {
      // A cold, empty stall: every route is measured from the same place.
      await p.goto(url, 500)
      await p.evaluate(target.save ? `localStorage.setItem('pz-game-v1', ${JSON.stringify(SAVE)})` : "localStorage.removeItem('pz-game-v1')")
      const started = Date.now()
      await p.send('Page.navigate', { url: `${url}/${target.hash}` })
      let ready = null
      let loadingGone = null
      for (let i = 0; i < 200; i++) {
        if (ready === null && await p.evaluate(target.ready).catch(() => false)) ready = Date.now() - started
        if (loadingGone === null && await p.evaluate("!document.querySelector('.simulator-loading, .mode-loading')").catch(() => false)) loadingGone = Date.now() - started
        if (ready !== null && loadingGone !== null) break
        await wait(100)
      }
      const row = { viewport: vp.name, route: target.name, readyMs: ready, loadingGoneMs: loadingGone }
      rows.push(row)
      console.log(`  ${vp.name} · ${target.name}: usable in ${ready ?? '>20000'} ms (loading screen gone at ${loadingGone ?? '>20000'} ms)`)
    }
  }
} finally {
  p.close()
}
console.log('\n' + JSON.stringify(rows, null, 2))
