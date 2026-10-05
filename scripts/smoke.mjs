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
  { name: 'front page', hash: '', canvas: true, text: 'Land anywhere in the solar system' },
  { name: 'campaign', hash: '#campaign', canvas: true, text: 'Station Zero', settle: 15000 },
  { name: 'old story link, now the campaign', hash: '#story', canvas: true, text: 'Station Zero', settle: 15000 },
  { name: 'Moon landing', hash: '#land/moon', canvas: true, text: 'Moon' },
  { name: 'Venus landing (air, heat timer)', hash: '#land/venus', canvas: true, text: 'Venus' },
  { name: 'Io landing (lava)', hash: '#land/io', canvas: true, text: 'Io' },
  { name: 'Titan landing (haze, lake)', hash: '#land/titan', canvas: true, text: 'Titan' },
  { name: 'Halley landing (hopper)', hash: '#land/halley', canvas: true, text: 'Halley' },
  { name: 'simulator', hash: '#flight', canvas: true, text: 'PERIAPSIS ZERO', settle: 15000 },
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
      await page.evaluate("localStorage.setItem('pz-surface-howto-v1', '1'); localStorage.setItem('pz-campaign-intro-v1', '1')")
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
