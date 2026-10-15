#!/usr/bin/env node
/**
 * See the browser build as a player does, without a window on screen:
 *
 *   node scripts/godot-webshot.mjs <chapter[/beat]> <out-prefix> [seconds...]
 *   node scripts/godot-webshot.mjs blackbox/ambush /tmp/bb 12 20 30
 *
 * Serves build/play (node scripts/godot-build.mjs web) on a local port,
 * opens /index.html#<chapter> in headless Chrome (the real GPU on a Mac,
 * through ANGLE, as a Chromebook's browser draws), and saves a PNG at each
 * time given, counted from the page load. Prints the page's console
 * errors at the end. A headless browser never takes the screen or the
 * keyboard, so this can run while someone works at the machine; the
 * windowed Godot editor binary cannot.
 *
 * PZ_WEBSHOT_KEYS="10:click 12:KeyW:down 14:KeyW:up" clicks the middle of
 * the page and presses keys at given times.
 * PZ_WEBSHOT_SIZE=1280x720 sets the window.
 */
import { createServer } from 'node:http'
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { extname, join, normalize } from 'node:path'
import { launch, wait } from './lib/chrome.mjs'

const [chapter = 'title', prefix = '/tmp/pz-webshot', ...rest] = process.argv.slice(2)
const times = rest.map(Number).filter((n) => n > 0)
if (!times.length) times.push(15)
const root = join(new URL('..', import.meta.url).pathname, 'build', 'play')
if (!existsSync(join(root, 'index.html'))) {
  console.error('no build/play: run node scripts/godot-build.mjs web first')
  process.exit(1)
}
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.wasm': 'application/wasm', '.pck': 'application/octet-stream', '.png': 'image/png', '.json': 'application/json' }
const server = createServer((req, res) => {
  const path = normalize(decodeURIComponent(req.url.split('?')[0])).replace(/^\/+/, '')
  const file = join(root, path || 'index.html')
  if (!file.startsWith(root) || !existsSync(file) || statSync(file).isDirectory()) { res.writeHead(404); res.end(); return }
  res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream' })
  res.end(readFileSync(file))
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const port = server.address().port

const [w, h] = (process.env.PZ_WEBSHOT_SIZE ?? '1280x720').split('x').map(Number)
const page = await launch({ width: w, height: h })
const keys = (process.env.PZ_WEBSHOT_KEYS ?? '').split(/\s+/).filter(Boolean).map((s) => {
  const [t, code, dir] = s.split(':')
  return { t: Number(t), code, dir }
})
try {
  const start = Date.now()
  await page.goto(`http://127.0.0.1:${port}/index.html#${chapter}`, 500)
  const events = [...times.map((t) => ({ t, shot: true })), ...keys].sort((a, b) => a.t - b.t)
  for (const e of events) {
    const left = e.t * 1000 - (Date.now() - start)
    if (left > 0) await wait(left)
    if (e.shot) {
      const out = `${prefix}-${e.t}s.png`
      writeFileSync(out, await page.shot())
      console.log(`shot ${out}`)
    } else if (e.code === 'click') {
      for (const type of ['mousePressed', 'mouseReleased']) await page.send('Input.dispatchMouseEvent', { type, x: w / 2, y: h / 2, button: 'left', clickCount: 1 })
    } else {
      const name = e.code.replace(/^Key/, '').toLowerCase()
      await page.send('Input.dispatchKeyEvent', { type: e.dir === 'up' ? 'keyUp' : 'keyDown', code: e.code, key: name, windowsVirtualKeyCode: name.toUpperCase().charCodeAt(0) })
    }
  }
  const logs = await page.logs()
  const errors = logs.filter((l) => /error/i.test(l.level ?? '') || /error/i.test(l.text ?? ''))
  for (const l of errors.slice(0, 12)) console.log(`console: ${(l.text ?? '').slice(0, 240)}`)
} finally {
  await page.close?.()
  server.close()
}
process.exit(0)
