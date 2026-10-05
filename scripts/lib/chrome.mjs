/**
 * Drive a headless Chrome over the DevTools protocol, with nothing installed.
 *
 * Node 22 has a WebSocket client built in and Chrome speaks the protocol on a
 * local port, so the smoke test and the stills script need no Puppeteer and no
 * download: they use the Chrome already on the machine (or on the CI runner,
 * where `google-chrome` comes with the image).
 *
 * `logs()` returns the browser's own log entries *and* the page's console
 * calls and uncaught exceptions. Log.entryAdded alone never carries a page's
 * console.error, so a harness that reads only it reports shader and runtime
 * errors as a clean run. That happened once; this is the version that doesn't.
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CANDIDATES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter(Boolean)

export const chromePath = () => CANDIDATES.find((p) => existsSync(p)) ?? null
export const wait = (ms) => new Promise((r) => setTimeout(r, ms))

export async function launch({ width = 1280, height = 800 } = {}) {
  const chrome = chromePath()
  if (!chrome) throw new Error('no Chrome found; set CHROME_PATH')
  const profile = mkdtempSync(join(tmpdir(), 'pz-chrome-'))
  const child = spawn(chrome, [
    '--headless=new',
    // Port 0: Chrome picks a free one and writes it to DevToolsActivePort, so a
    // browser still shutting down from the previous page is never in the way.
    '--remote-debugging-port=0',
    `--user-data-dir=${profile}`,
    `--window-size=${width},${height}`,
    '--no-first-run', '--no-default-browser-check',
    // The real GPU on a Mac; SwiftShader's software WebGL anywhere without one,
    // or anywhere PZ_SOFTWARE_GL=1 asks to see what CI sees.
    ...(process.platform === 'darwin' && !process.env.PZ_SOFTWARE_GL ? ['--use-angle=metal'] : ['--use-angle=swiftshader']),
    ...(process.platform === 'linux' ? ['--no-sandbox'] : []),
    '--enable-unsafe-swiftshader',
    '--autoplay-policy=no-user-gesture-required',
    '--mute-audio',
    'about:blank',
  ], { stdio: ['ignore', 'ignore', 'ignore'] })

  let target = null
  for (let i = 0; i < 200 && !target; i++) {
    try {
      const port = readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0].trim()
      const list = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json())
      target = list.find((t) => t.type === 'page')
    } catch { /* not up yet */ }
    if (!target) await wait(150)
  }
  if (!target) { child.kill(); throw new Error('Chrome did not open a debuggable page') }

  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
  let id = 0
  const pending = new Map()
  const events = []
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data)
    if (msg.id && pending.has(msg.id)) {
      const { res, rej } = pending.get(msg.id)
      pending.delete(msg.id)
      msg.error ? rej(new Error(msg.error.message)) : res(msg.result)
    } else if (msg.method) events.push(msg)
  }
  // Every call has a deadline: a renderer pegged by software WebGL can sit on
  // a request indefinitely, and a check that waits forever is not a check.
  const send = (method, params = {}, ms = 60000) =>
    new Promise((res, rej) => {
      const n = ++id
      const timer = setTimeout(() => { pending.delete(n); rej(new Error(`${method} did not answer within ${ms / 1000} s`)) }, ms)
      pending.set(n, { res: (v) => { clearTimeout(timer); res(v) }, rej: (e) => { clearTimeout(timer); rej(e) } })
      ws.send(JSON.stringify({ id: n, method, params }))
    })

  await send('Page.enable')
  await send('Runtime.enable')
  await send('Log.enable')

  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? 'evaluation threw')
    return r.result.value
  }
  const goto = async (url, settle = 1200) => { await send('Page.navigate', { url }); await wait(settle) }
  const key = async (code, name, text) => {
    const base = { code, key: name, windowsVirtualKeyCode: text ? text.toUpperCase().charCodeAt(0) : 32 }
    await send('Input.dispatchKeyEvent', { type: 'keyDown', ...base, ...(text ? { text } : {}) })
    await send('Input.dispatchKeyEvent', { type: 'keyUp', ...base })
  }
  const mouse = (type, x, y, extra = {}) =>
    send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, ...extra })
  /** A screenshot as a Buffer: 'png', or 'webp'/'jpeg' at a quality. */
  const shot = async (format = 'png', quality) =>
    Buffer.from((await send('Page.captureScreenshot', { format, ...(quality ? { quality } : {}) })).data, 'base64')
  const logs = () => events.flatMap((e) => {
    if (e.method === 'Log.entryAdded') return [`${e.params.entry.level}: ${e.params.entry.text}`]
    if (e.method === 'Runtime.consoleAPICalled') {
      const level = e.params.type === 'warning' ? 'warning' : e.params.type
      return [`${level}: ${e.params.args.map((a) => a.value ?? a.description ?? '').join(' ')}`]
    }
    if (e.method === 'Runtime.exceptionThrown') return [`error: ${e.params.exceptionDetails?.exception?.description ?? e.params.exceptionDetails?.text}`]
    return []
  })
  const close = () => {
    try { ws.close() } catch { /* already closed */ }
    child.kill()
    try { rmSync(profile, { recursive: true, force: true }) } catch { /* Chrome may still hold it */ }
  }
  return { send, evaluate, goto, key, mouse, shot, logs, close }
}

/** Serve `dist` with Vite's preview server on a port; returns a stop function. */
export async function preview(port = 4180) {
  // Vite's own entry, run by this Node: through `npx` the kill below reached
  // npx and not the server it started, whose open pipes then held the parent
  // alive after every check had passed (a CI step that never ended).
  const taken = await fetch(`http://localhost:${port}/`).then(() => true, () => false)
  if (taken) throw new Error(`port ${port} already answers; stop that server so this checks the current build`)
  const vite = join(process.cwd(), 'node_modules', 'vite', 'bin', 'vite.js')
  const child = spawn(process.execPath, [vite, 'preview', '--port', String(port), '--strictPort'], { stdio: 'ignore' })
  // If the port is taken the server exits at once; answering on that port is
  // then someone else's server, and checking it would check the wrong build.
  let exited = false
  child.on('exit', () => { exited = true })
  for (let i = 0; i < 100; i++) {
    if (exited) throw new Error(`vite preview could not start on port ${port}; is something else using it?`)
    try { if ((await fetch(`http://localhost:${port}/`)).ok && !exited) return { url: `http://localhost:${port}`, stop: () => child.kill() } } catch { /* starting */ }
    await wait(150)
  }
  child.kill()
  throw new Error('vite preview did not start')
}

/** Wait until a surface mission reports touchdown, or give up after `ms`. */
export async function waitForLanding(page, ms = 60000) {
  for (let t = 0; t < ms; t += 1000) {
    if (/Down\. /.test(await page.evaluate('document.body.innerText'))) return true
    await wait(1000)
  }
  return false
}
