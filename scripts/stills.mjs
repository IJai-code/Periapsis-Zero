/**
 * Photograph each world from the game itself, for the story and front pages.
 *
 *   npm run build && npm run art:stills
 *
 * Lands the survey lander with the assist on, unloads the rover, swings the
 * chase camera down toward the horizon and takes a frame with the interface
 * hidden. The pictures are the game's own renderer and the game's own scene,
 * not paintings of it, so they can only promise what a player will see. Re-run
 * this whenever the surface graphics change; the files are committed.
 *
 * With --simulator, also the simulator's Earth view for the front page's third card.
 *
 * Needs Chrome and a GPU, so it is an authoring step, not a CI one.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { launch, preview, wait, waitForLanding } from './lib/chrome.mjs'

const WORLDS = ['moon', 'mars', 'europa']
const OUT = 'public/stills'
/** The camera move after landing: drag up (pixels), wheel (zoom in), drag sideways. */
const FRAMING = { lift: 320, wheel: -150, swing: -150 }

const server = await preview()
mkdirSync(OUT, { recursive: true })
try {
  for (const id of WORLDS) {
    const page = await launch({ width: 1600, height: 900 })
    try {
      await page.goto(`${server.url}/`)
      await page.evaluate("localStorage.setItem('pz-expedition-howto-v1', '1')")
      await page.goto(`${server.url}/#expedition/${id}`)
      if (!(await waitForLanding(page))) throw new Error(`${id}: the assist did not land`)
      await page.key('KeyG', 'g', 'g')
      await wait(2500)
      await page.mouse('mousePressed', 800, 600, { clickCount: 1 })
      for (let k = 1; k <= 20; k++) await page.mouse('mouseMoved', 800 + FRAMING.swing * k / 20, 600 - FRAMING.lift * k / 20)
      await page.mouse('mouseReleased', 800 + FRAMING.swing, 600 - FRAMING.lift)
      await page.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 800, y: 450, deltaX: 0, deltaY: FRAMING.wheel })
      await wait(3000)
      await page.evaluate(`(() => { const s = document.createElement('style'); s.textContent = '.expedition-overlay { display: none !important }'; document.head.appendChild(s); return 1 })()`)
      await wait(600)
      const image = await page.shot('webp', 80)
      writeFileSync(`${OUT}/${id}.webp`, image)
      console.log(`${OUT}/${id}.webp  ${(image.length / 1024).toFixed(0)} KB`)
      if (id === 'mars') {
        // The link preview: 1200 x 630, the size every unfurler crops to, as
        // JPEG because not every crawler takes WebP.
        const { data } = await page.send('Page.captureScreenshot', { format: 'jpeg', quality: 84, clip: { x: 100, y: 60, width: 1400, height: 735, scale: 1200 / 1400 } })
        writeFileSync(`${OUT}/share.jpg`, Buffer.from(data, 'base64'))
        console.log(`${OUT}/share.jpg`)
      }
    } finally {
      page.close()
    }
  }
  // The simulator's Earth view, everything but the canvas hidden. Only with
  // --simulator: it is the real sky at the moment of capture, so whether Earth
  // shows its day side depends on the hour, and a good frame is worth keeping.
  const page = process.argv.includes('--simulator') ? await launch({ width: 1600, height: 900 }) : null
  if (page) try {
    await page.goto(`${server.url}/#flight`)
    await wait(9000)
    await page.key('Digit3', '3', '3')
    await wait(6000)
    await page.evaluate(`(() => { for (const el of document.body.querySelectorAll('*')) if (el.tagName !== 'CANVAS' && !el.querySelector('canvas')) el.style.visibility = 'hidden'; return 1 })()`)
    await wait(600)
    const image = await page.shot('webp', 80)
    writeFileSync(`${OUT}/simulator.webp`, image)
    console.log(`${OUT}/simulator.webp  ${(image.length / 1024).toFixed(0)} KB`)
  } finally {
    page.close()
  }
} finally {
  server.stop()
}
process.exit(0)
