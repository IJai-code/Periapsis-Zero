/**
 * Open the built site in a real browser and fail on any error it reports.
 *
 *   npm run build && npm run smoke
 *
 * The gates in verify-all check the physics and the data; none of them run a
 * page. A shader that fails to compile, a component that throws on mount, or a
 * module that 404s passes every one of them and ships a black screen. This
 * opens each part of the site from `dist`, lets it run, and fails if the page
 * logged an error or threw, or if a canvas never appeared.
 *
 * In CI there is no GPU, so WebGL is Chrome's software renderer: slow, but the
 * same shader compiler front end and the same JavaScript, which is what this
 * is checking. Frame rate and looks are not judged here.
 */
import { launch, preview, wait } from './lib/chrome.mjs'

const PAGES = [
  { name: 'title screen', hash: '', canvas: false, text: 'Periapsis' },
  { name: 'new game', hash: '#play', canvas: false, text: 'Who is flying', setup: "localStorage.removeItem('pz-game-v1')" },
  { name: 'the game, from a save (docked at Hearth)', hash: '#play', canvas: true, text: 'Hearth Station', settle: 20000, setup: "localStorage.setItem('pz-game-v1', JSON.stringify({version:1,pilot:{name:'Smoke'},credits:5000,debt:40000,ship:{hull:'kestrel',up:{},hp:1,prop:150000,cargo:{}},home:'hearth',time:0,heat:0,story:{active:'arrival',step:0,done:[],choice:null,offered:[]},jobs:[],flags:{},stats:{kills:0,earned:0,jobs:0,trips:0,deaths:0,fines:0}}))" },
  { name: 'old campaign link, now the game', hash: '#campaign', canvas: true, text: 'Hearth Station', settle: 20000, setup: "localStorage.setItem('pz-game-v1', JSON.stringify({version:1,pilot:{name:'Smoke'},credits:5000,debt:40000,ship:{hull:'kestrel',up:{},hp:1,prop:150000,cargo:{}},home:'hearth',time:0,heat:0,story:{active:'arrival',step:0,done:[],choice:null,offered:[]},jobs:[],flags:{},stats:{kills:0,earned:0,jobs:0,trips:0,deaths:0,fines:0}}))" },
  { name: 'Moon landing (simulator)', hash: '#land/moon', canvas: true, text: 'Moon' },
  { name: 'Titan landing (haze, lake)', hash: '#land/titan', canvas: true, text: 'Titan' },
  { name: 'simulator', hash: '#sim', canvas: true, text: 'PERIAPSIS ZERO', settle: 15000 },
]
/**
 * Messages that are the environment talking, not the site. Each is a browser
 * notice about the software renderer or the headless window, never one of ours.
 */
const BENIGN = [
  /GPU stall due to ReadPixels/i,
  /Automatic fallback to software WebGL/i,
  /WebGL.*performance/i,
  /AudioContext was not allowed to start/i,
]

const server = await preview()
let failed = 0
try {
  for (const p of PAGES) {
    const page = await launch({ width: 1280, height: 800 })
    try {
      await page.goto(`${server.url}/`)
      // Skip the first-run cards so the mission actually runs.
      await page.evaluate("localStorage.setItem('pz-surface-howto-v1', '1')")
      if (p.setup) await page.evaluate(p.setup)
      await page.goto(`${server.url}/${p.hash}`)
      await wait(p.settle ?? 9000)
      const state = await page.evaluate(`({ canvas: !!document.querySelector('canvas'), text: document.body.innerText })`)
      const errors = page.logs().filter((l) => /^error/.test(l) && !BENIGN.some((b) => b.test(l)))
      const problems = [
        ...errors,
        ...(p.canvas && !state.canvas ? ['no canvas was drawn'] : []),
        ...(p.text && !state.text.toLowerCase().includes(p.text.toLowerCase()) ? [`expected text "${p.text}" not on the page`] : []),
      ]
      if (problems.length) {
        failed++
        console.log(`  ✗ ${p.name}`)
        for (const e of problems.slice(0, 6)) console.log(`      ${e.slice(0, 400)}`)
      } else console.log(`  ✓ ${p.name}`)
    } finally {
      page.close()
    }
  }
} finally {
  server.stop()
}
if (failed) {
  console.log(`${failed} of ${PAGES.length} pages reported problems.`)
  process.exit(1)
}
console.log(`${PAGES.length} pages load in a browser with no errors.`)
// Explicitly: a stray child or socket must not keep a passing check running.
process.exit(0)
