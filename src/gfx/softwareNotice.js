/*
 * A browser drawing without the graphics card (acceleration switched off,
 * or a driver it refuses) runs every 3D page here at a crawl, and nothing
 * the site does can fix that. Say so once, plainly, with the fix.
 */
const DISMISSED = 'pz-software-notice'

export function softwareRenderer() {
  try {
    const gl = document.createElement('canvas').getContext('webgl2') || document.createElement('canvas').getContext('webgl')
    if (!gl) return 'none'
    const ext = gl.getExtension('WEBGL_debug_renderer_info')
    const name = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : ''
    gl.getExtension('WEBGL_lose_context')?.loseContext()
    return /swiftshader|llvmpipe|basic render|software/i.test(name) ? name : ''
  } catch {
    return ''
  }
}

export function showSoftwareNotice() {
  try { if (localStorage.getItem(DISMISSED)) return } catch { /* private mode */ }
  const which = softwareRenderer()
  if (!which) return
  const bar = document.createElement('div')
  bar.setAttribute('role', 'alert')
  bar.style.cssText = 'position:fixed;left:50%;top:12px;transform:translateX(-50%);z-index:9999;max-width:min(680px,calc(100% - 32px));padding:12px 44px 12px 16px;border-radius:12px;background:#2a1d14;border:2px solid #e8853d;color:#fbf1dc;font:400 15px/1.45 Fredoka,system-ui,sans-serif;box-shadow:0 8px 30px rgba(0,0,0,.5)'
  bar.textContent = which === 'none'
    ? 'Your browser has 3D graphics (WebGL) switched off, so the simulator and the game cannot run. Turn on "Use graphics acceleration when available" (Chrome or Edge: Settings, System) and restart the browser.'
    : 'Your browser is drawing without your graphics card, so everything here will be very slow. Turn on "Use graphics acceleration when available" (Chrome or Edge: Settings, System) and restart the browser. The desktop download avoids this.'
  const x = document.createElement('button')
  x.textContent = '×'
  x.setAttribute('aria-label', 'Dismiss')
  x.style.cssText = 'position:absolute;right:10px;top:6px;background:none;border:0;color:#fbf1dc;font-size:24px;cursor:pointer'
  x.onclick = () => { bar.remove(); try { localStorage.setItem(DISMISSED, '1') } catch { /* private mode */ } }
  bar.appendChild(x)
  document.body.appendChild(bar)
}
