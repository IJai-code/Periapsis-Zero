import { useEffect, useRef, useState } from 'react'
import { DEVICE, QUALITY } from '../sim/device.js'

/**
 * What this machine actually is, and what it is actually managing.
 *
 * Performance reports arrive as "it was laggy", which is a symptom with a
 * dozen causes that want different fixes: a software renderer, a high-density
 * display asking for four times the pixels, a thermally throttled laptop, or
 * the scene genuinely being too much. None of them can be told apart from
 * here, and all of them can be read off the machine in a second. So this reads
 * them off and puts them somewhere a visitor can copy.
 *
 * The GPU string comes from `WEBGL_debug_renderer_info`, which some browsers
 * withhold; when it is withheld this says so rather than guessing. The frame
 * time is the median of the last few seconds of real frames, not a benchmark —
 * what the machine is doing right now, on whatever is on screen right now.
 */

/** The renderer's own name for the hardware, read once. */
function gpuName() {
  try {
    const c = document.createElement('canvas')
    const gl = c.getContext('webgl2') ?? c.getContext('webgl')
    if (!gl) return 'no WebGL'
    const ext = gl.getExtension('WEBGL_debug_renderer_info')
    const name = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : null
    return name || 'hidden by the browser'
  } catch {
    return 'unavailable'
  }
}

/** What the renderer settled on, which is half of any performance question. */
const QUALITY_LABEL = () => {
  const c = document.querySelector('canvas')
  const g = c && (c.getContext('webgl2') || c.getContext('webgl'))
  const ratio = g && c.clientWidth ? (g.drawingBufferWidth / c.clientWidth).toFixed(2) : '?'
  return `${ratio}x pixels, tuned for ${DEVICE}, up to ${QUALITY.dpr[1]}x`
}

/** Software rasterisers, which no amount of tuning will rescue. */
const SOFTWARE = /swiftshader|llvmpipe|softpipe|software|microsoft basic/i

export function Diagnostics() {
  const [gpu] = useState(gpuName)
  const [fps, setFps] = useState(null)
  const frames = useRef([])

  useEffect(() => {
    let raf = 0
    let last = 0
    const tick = (t) => {
      if (last) {
        const f = frames.current
        f.push(t - last)
        if (f.length > 180) f.shift()
      }
      last = t
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    const id = setInterval(() => {
      const f = frames.current.filter((x) => x < 2000).sort((a, b) => a - b)
      if (f.length > 20) setFps(Math.round(1000 / f[f.length >> 1]))
    }, 1000)
    return () => {
      cancelAnimationFrame(raf)
      clearInterval(id)
    }
  }, [])

  const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio
  const soft = SOFTWARE.test(gpu)
  const rows = [
    ['Graphics', gpu],
    ['Screen', `${window.screen?.width ?? '?'} x ${window.screen?.height ?? '?'} at ${dpr}x`],
    ['Drawing', fps == null ? 'measuring…' : `${fps} frames a second`],
  ]

  /*
   * Copying, rather than sending.
   *
   * Nothing here leaves the machine on its own. A report of "it was laggy" is
   * a symptom with a dozen causes, and the fastest way to tell them apart is
   * for the person who saw it to paste these four lines — which they can read
   * before they do, and which go wherever they choose to put them.
   */
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    const text = [
      'Periapsis Zero — this machine',
      ...rows.map(([k, v]) => `${k}: ${v}`),
      `Rendering at: ${QUALITY_LABEL()}`,
      `Browser: ${navigator.userAgent}`,
    ].join('\n')
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      // No clipboard permission, or an insecure origin: put it where it can be
      // selected by hand instead of failing silently.
      window.prompt('Copy this and send it on:', text)
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="mt-2.5 border-t border-white/10 pt-2.5">
      <div className="rule mb-1.5">This machine</div>
      <dl className="space-y-1">
        {rows.map(([k, v]) => (
          <div key={k} className="flex gap-2 text-[9.5px] leading-tight">
            <dt className="w-14 shrink-0 text-white/30">{k}</dt>
            <dd className="min-w-0 flex-1 break-words text-white/55">{v}</dd>
          </div>
        ))}
      </dl>
      {soft && (
        <p className="mt-1.5 text-[9.5px] leading-tight text-ember/80">
          This browser is drawing without a graphics card, which no setting here can make fast. Turning on
          hardware acceleration in the browser’s settings is the fix.
        </p>
      )}
      <button
        onClick={copy}
        className="control mt-2 min-h-8 w-full border border-white/10 px-2 py-1 text-[9px] tracking-[0.14em] text-white/40 uppercase transition-colors duration-300 outline-none hover:border-ember/50 hover:text-ember focus-visible:border-ember lg:min-h-0"
      >
        {copied ? 'Copied' : 'Copy for a bug report'}
      </button>
    </div>
  )
}
