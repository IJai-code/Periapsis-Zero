/**
 * The whole site, at the sizes people actually hold.
 *
 * A route that passes at 1280x800 can still be broken on a phone or a tablet:
 * a fixed-width panel, a button under 36 px, a HUD that runs off the edge. This
 * drives every route at five viewports, screenshots each one, and asserts the
 * three things a screenshot alone does not tell you:
 *
 *   - no uncaught exception or console error on any route,
 *   - no horizontal overflow (the page is never wider than the window),
 *   - on touch-sized viewports, every visible button and link is at least
 *     36x36 CSS px, the floor AGENT.md sets for a touch target.
 *
 * It reports; it does not repair. Run it against the dev server or a preview:
 *   PZ_URL=http://127.0.0.1:5175 node scripts/check-device-sweep.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { launch, wait } from './lib/chrome.mjs'

const url = process.env.PZ_URL ?? 'http://127.0.0.1:5175'
const out = process.env.PZ_SHOTS ?? 'docs/device-sweep'
mkdirSync(out, { recursive: true })

const VIEWPORTS = [
  { name: 'desktop', width: 1600, height: 900, touch: false },
  { name: 'laptop', width: 1280, height: 800, touch: false },
  { name: 'tablet', width: 820, height: 1180, touch: true },
  { name: 'phone', width: 390, height: 844, touch: true },
  { name: 'small', width: 360, height: 740, touch: true },
]

const SAVE = JSON.stringify({
  version: 1, pilot: { name: 'Sweep' }, credits: 5000, debt: 40000,
  ship: { hull: 'kestrel', up: {}, hp: 1, prop: 150000, cargo: {} },
  home: 'hearth', time: 0, heat: 0,
  story: { active: 'arrival', step: 0, done: [], choice: null, offered: [] },
  jobs: [], flags: {}, stats: { kills: 0, earned: 0, jobs: 0, trips: 0, deaths: 0, fines: 0 },
})

const ROUTES = [
  { name: 'title', hash: '', text: 'PERIAPSIS', setup: null, settle: 2500 },
  // The boards behind the bar are screens a visitor opens, not shots of one:
  // without them the sweep never sees the map, the drawer or the library.
  { name: 'simulator', hash: '#sim', text: 'career · 3091', setup: null, settle: 6000, panels: ['map · m', 'settings · s', 'missions'] },
  { name: 'squadron', hash: '#squadron', text: 'Hold the sky', setup: null, settle: 3500 },
  { name: 'game', hash: '#play', text: 'Hearth', setup: SAVE, settle: 14000 },
  { name: 'surface', hash: '#land/moon', text: 'Moon', setup: null, settle: 9000 },
]
/** Panels are opened on touch viewports, where the target size is the point. */
const PANEL_VIEWPORTS = new Set(['tablet', 'phone'])

const p = await launch({ width: 1600, height: 900 })
const report = { date: new Date().toISOString(), url, environment: 'Headless Chrome', rows: [], problems: [] }

// An element outside the window only matters if nothing clips it: the sim parks
// off-screen markers inside overflow-hidden parents on purpose, and those are
// neither a layout fault nor anything a visitor can see. Only unclipped
// escapees can widen the page, so only those are reported.
const overflow = `(() => {
  const de = document.documentElement
  const w = innerWidth
  const clipped = (el) => {
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const s = getComputedStyle(p)
      if (s.position === 'fixed') return true
      if (s.overflowX !== 'visible' || s.overflowY !== 'visible') return true
    }
    return false
  }
  const wide = []
  for (const el of document.querySelectorAll('body *')) {
    const s = getComputedStyle(el)
    if (s.display === 'none' || s.visibility === 'hidden' || s.position === 'fixed') continue
    const r = el.getBoundingClientRect()
    if (r.width < 2 || r.height < 2) continue
    if (r.right > w + 2 || r.left < -2) {
      if (clipped(el)) continue
      wide.push({ tag: el.tagName, cls: (el.className || '').toString().slice(0, 40), left: Math.round(r.left), right: Math.round(r.right) })
    }
  }
  return { scrollWidth: de.scrollWidth, innerWidth: w, wide: wide.slice(0, 8), wideCount: wide.length }
})()`

const tapTargets = `(() => {
  const small = []
  for (const el of document.querySelectorAll('button, a[href], [role="button"], input, select')) {
    const s = getComputedStyle(el)
    if (s.display === 'none' || s.visibility === 'hidden' || s.pointerEvents === 'none') continue
    // A field inside its own label is as big as the label, and clicking the
    // label focuses the field: measure what a thumb actually hits.
    const hit = (el.tagName === 'INPUT' || el.tagName === 'SELECT') && el.closest('label') ? el.closest('label') : el
    const r = hit.getBoundingClientRect()
    if (r.width < 1 || r.height < 1) continue
    if (r.bottom < 0 || r.top > innerHeight * 4) continue
    // WCAG 2.5.8 exempts a link sitting inline in a sentence: it cannot grow
    // without pushing the words around it. An inline button is not exempt.
    if (el.tagName === 'A' && s.display === 'inline') {
      const sentence = (el.parentElement?.textContent ?? '').trim().length
      if (sentence > el.textContent.trim().length + 8) continue
    }
    const label = (el.getAttribute('aria-label') || el.textContent || el.type || el.tagName).trim().slice(0, 30)
    if (r.width < 35.5 || r.height < 35.5) small.push({ label, w: Math.round(r.width), h: Math.round(r.height) })
  }
  return small.slice(0, 10)
})()`

const scrollable = `(() => {
  const out = []
  for (const el of document.querySelectorAll('body *')) {
    const s = getComputedStyle(el)
    if (s.display === 'none' || s.visibility === 'hidden') continue
    if (s.overflowY === 'auto' || s.overflowY === 'scroll') {
      const r = el.getBoundingClientRect()
      if (r.height > 40) out.push({ cls: (el.className || '').toString().slice(0, 40), scrollHeight: el.scrollHeight, clientHeight: el.clientHeight })
    }
  }
  return out.slice(0, 6)
})()`

try {
  for (const vp of VIEWPORTS) {
    await p.send('Emulation.setDeviceMetricsOverride', {
      width: vp.width, height: vp.height, deviceScaleFactor: 1, mobile: vp.touch,
    })
    await p.send('Emulation.setTouchEmulationEnabled', vp.touch ? { enabled: true, maxTouchPoints: 5 } : { enabled: false })
    for (const route of ROUTES) {
      await p.goto(`${url}/${route.hash}`, 800)
      if (route.setup) { await p.evaluate(`localStorage.setItem('pz-game-v1', ${JSON.stringify(route.setup)})`); await p.goto(`${url}/${route.hash}`, 800) }
      else await p.evaluate("localStorage.removeItem('pz-game-v1')")
      // Let the route settle: lazy chunks, warmup, and the first suspended frames.
      const start = Date.now()
      let found = false
      while (Date.now() - start < route.settle) {
        const text = await p.evaluate('document.body.innerText').catch(() => '')
        // innerText carries text-transform, so a heading styled uppercase is
        // uppercase here too: match without case.
        if (text.toLowerCase().includes(route.text.toLowerCase()) && text.length > 40) { found = true; break }
        await wait(400)
      }
      await wait(1200)
      const row = { viewport: vp.name, route: route.name, size: `${vp.width}x${vp.height}`, found, checks: {} }
      const text = await p.evaluate('document.body.innerText').catch(() => '')
      row.text = text.slice(0, 120)
      row.checks.noText = text.trim().length < 40
      if (!found) report.problems.push(`${vp.name}/${route.name}: expected "${route.text}" never appeared`)
      if (row.checks.noText) report.problems.push(`${vp.name}/${route.name}: page rendered almost no text`)
      try {
        const ov = await p.evaluate(overflow)
        row.overflow = ov
        if (ov.scrollWidth > ov.innerWidth + 2) report.problems.push(`${vp.name}/${route.name}: page scrolls sideways (${ov.scrollWidth} > ${ov.innerWidth}); wide: ${JSON.stringify(ov.wide)}`)
      } catch (e) { report.problems.push(`${vp.name}/${route.name}: overflow probe failed: ${e.message}`) }
      if (vp.touch) {
        try {
          const small = await p.evaluate(tapTargets)
          row.smallTargets = small
          if (small.length) report.problems.push(`${vp.name}/${route.name}: ${small.length} tap target(s) under 36 px: ${JSON.stringify(small)}`)
        } catch (e) { report.problems.push(`${vp.name}/${route.name}: tap probe failed: ${e.message}`) }
      }
      try { row.scrollers = await p.evaluate(scrollable) } catch { /* fine */ }
      const errors = p.logs().filter((l) => /^error/.test(l))
      row.errors = errors
      if (errors.length) report.problems.push(`${vp.name}/${route.name}: console errors ${JSON.stringify(errors.slice(0, 3))}`)
      writeFileSync(`${out}/${vp.name}-${route.name}.png`, await p.shot())
      report.rows.push(row)
      console.log(`  ${vp.name} ${route.name}: ${found ? 'ok' : 'TEXT MISSING'}${errors.length ? ' ERRORS' : ''}`)
      for (const panel of (vp.touch && PANEL_VIEWPORTS.has(vp.name) ? route.panels ?? [] : [])) {
        const opened = await p.evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((b) => b.textContent.trim().toLowerCase().startsWith(${JSON.stringify(panel.toLowerCase())})); if (!b) return false; b.click(); return true })()`).catch(() => false)
        await wait(1400)
        const panelRow = { viewport: vp.name, route: `${route.name}/${panel}`, size: `${vp.width}x${vp.height}`, checks: {} }
        if (!opened) report.problems.push(`${vp.name}/${route.name}: panel "${panel}" has no button to open it`)
        try {
          const ov = await p.evaluate(overflow)
          panelRow.overflow = ov
          if (ov.scrollWidth > ov.innerWidth + 2) report.problems.push(`${vp.name}/${route.name}/${panel}: page scrolls sideways (${ov.scrollWidth} > ${ov.innerWidth})`)
        } catch (e) { report.problems.push(`${vp.name}/${route.name}/${panel}: overflow probe failed: ${e.message}`) }
        try {
          panelRow.smallTargets = await p.evaluate(tapTargets)
          if (panelRow.smallTargets.length) report.problems.push(`${vp.name}/${route.name}/${panel}: ${panelRow.smallTargets.length} tap target(s) under 36 px: ${JSON.stringify(panelRow.smallTargets)}`)
        } catch (e) { report.problems.push(`${vp.name}/${route.name}/${panel}: tap probe failed: ${e.message}`) }
        const panelErrors = p.logs().filter((l) => /^error/.test(l))
        panelRow.errors = panelErrors
        if (panelErrors.length) report.problems.push(`${vp.name}/${route.name}/${panel}: console errors ${JSON.stringify(panelErrors.slice(0, 3))}`)
        writeFileSync(`${out}/${vp.name}-${route.name}-${panel.replace(/[^a-z0-9]+/gi, '-')}.png`, await p.shot())
        report.rows.push(panelRow)
        console.log(`  ${vp.name} ${route.name} / ${panel}: ${opened ? 'open' : 'NO BUTTON'}${panelRow.smallTargets?.length ? ' SMALL' : ''}`)
      }
    }
  }
} finally {
  writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 2) + '\n')
  p.close()
}

console.log(`\n${report.rows.length} route/viewport combinations captured into ${out}`)
if (report.problems.length) {
  console.log(`\n${report.problems.length} problem(s):`)
  for (const problem of report.problems) console.log(`  - ${problem}`)
  process.exitCode = 1
} else {
  console.log('No overflow, tap-target, or console-error problems found.')
}
