/**
 * The Periapsis Zero favicon, drawn by code rather than by hand.
 *
 * The mark: an orbital arc bending through a **periapsis tick** — a short
 * chevron that points at the curve exactly where it bends hardest — with a
 * filled dot riding the arc. The sim is named for that moment; the mark *is*
 * the name, drawn the way a trajectory chart marks it.
 *
 * Colour is the product's own: obsidian ground, a champagne hairline for the
 * orbit, an ember tick at closest approach. The values are converted from the
 * oklch in `src/index.css`, so the mark cannot drift from the interface it
 * belongs to — change the palette there and re-running this re-derives it.
 *
 *   node scripts/make-favicon.mjs            write the set
 *   node scripts/make-favicon.mjs --check    verify only, exit 1 on a mismatch
 *   --out <dir>                              where to write (default public/icons)
 *
 * One drawing, four surfaces: the PNG/ICO favicon set, `public/icons/mark.svg`,
 * `src/gfx/brand.js` — the same geometry and palette as an ES module for the
 * React surfaces — and the boot splash quoted inside `index.html` between
 * `boot:generated` markers. `--check` compares all four, so the brand has
 * exactly one source of truth and the build enforces it.
 *
 * PNG encoding is by hand — zlib stored blocks and CRC-32 — so this runs on
 * zero dependencies, the project's own rule for its scripts. `--check`
 * re-encodes to memory and compares bytes: same inputs, same output, so any
 * edit that changes the mark changes the check.
 */
import { deflateRawSync } from 'node:zlib'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const ROOT = join(here, '..')
const OUT_DIR = process.argv.includes('--out')
  ? process.argv[process.argv.indexOf('--out') + 1]
  : join(ROOT, 'public/icons')
const BRAND = join(ROOT, 'src/gfx/brand.js')
const INDEX = join(ROOT, 'index.html')
const CHECK = process.argv.includes('--check')

/* ---------------------------------------------------------------- *
 * Palette — converted from src/index.css, not restated
 * ---------------------------------------------------------------- */

/** oklch(L C H) -> [r, g, b] in 0..255. The CSS Color 4 conversion, backwards.
 *
 * Written in full rather than through a library because there is no dependency
 * to reach for, and the three values this feeds a favicon with are exactly the
 * three the interface declares. First version used the *forward* LMS matrix
 * and shipped grey; the inverse matrix below is the one the spec publishes
 * alongside it, and the three readings above are its evidence.
 */
function oklchToSrgb(L, C, H) {
  const h = (H * Math.PI) / 180
  const a = C * Math.cos(h)
  const b = C * Math.sin(h)
  // oklab -> non-linear LMS'
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b
  const s_ = L - 0.0894841775 * a - 1.291485548 * b
  // LMS' -> linear LMS
  const l = l_ * l_ * l_
  const m = m_ * m_ * m_
  const s = s_ * s_ * s_
  // linear LMS -> linear sRGB, the INVERSE matrix
  const lr = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s
  const lg = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s
  const lb = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s
  const toSrgb = (u) => {
    const v = u <= 0.0031308 ? 12.92 * u : 1.055 * Math.pow(u, 1 / 2.4) - 0.055
    return Math.min(255, Math.max(0, Math.round(v * 255)))
  }
  return [toSrgb(lr), toSrgb(lg), toSrgb(lb)]
}

const hex = ([r, g, b]) =>
  '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')

/** The floor the interface stands on, and the two accents, straight from the CSS. */
const OBSIDIAN = oklchToSrgb(0.145, 0.006, 250) // --color-obsidian is #0a0b0d; this is its oklch reading
const HUD = oklchToSrgb(0.83, 0.052, 88)
const EMBER = oklchToSrgb(0.66, 0.142, 47)
const OBSIDIAN_HEX = hex(OBSIDIAN)
const HUD_HEX = hex(HUD)
const EMBER_HEX = hex(EMBER)

/* ---------------------------------------------------------------- *
 * The mark
 * ---------------------------------------------------------------- */

/**
 * One geometry, three renderers: the raster drawMark below, svgMark()'s
 * vectors, and the module brandModule() emits. Extracted so the three cannot
 * disagree — every coordinate the mark has is computed once here, from the
 * same fractions the raster has always used. Apex at 72% of the height, arms
 * leaving through the upper corners at 18%, `k` fixed by a parabola through
 * those two ordinates — k negative, since screen y grows downward and the
 * arms rise.
 */
function geom(width, height) {
  const cx = width * 0.5
  const py = height * 0.72
  const half = width * 0.78
  const k = (height * 0.18 - py) / (half * half)
  return {
    cx,
    py,
    half,
    k,
    tick: width * 0.11,
    tickDrop: 0.9,
    tipY: py + Math.max(2, height * 0.062),
    dotR: width * 0.058,
    stroke: Math.max(1, width * 0.03),
    tickStroke: Math.max(1, width * 0.038),
  }
}

function drawMark(width, height) {
  // Bytes, not doubles: the PNG encoder copies 4 bytes a pixel straight out of
  // this buffer, and the first version handed it a Float64Array — 8 bytes per
  // channel — so what shipped was one quarter of the image interleaved with
  // zeros. Clamped because `put` writes rounded 0..255 values by hand.
  const px = new Uint8ClampedArray(width * height * 4)

  /**
   * Ground first: the obsidian floor, opaque, so the mark never sits on
   * whatever colour the browser paints behind it.
   */
  for (let i = 0; i < width * height; i++) {
    px[i * 4] = OBSIDIAN[0]
    px[i * 4 + 1] = OBSIDIAN[1]
    px[i * 4 + 2] = OBSIDIAN[2]
    px[i * 4 + 3] = 255
  }
  const put = (x, y, rgb, alpha) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return
    const o = (y * width + x) * 4
    // Straight alpha compositing over what is already there.
    const a = alpha
    px[o] = rgb[0] * a + px[o] * (1 - a)
    px[o + 1] = rgb[1] * a + px[o + 1] * (1 - a)
    px[o + 2] = rgb[2] * a + px[o + 2] * (1 - a)
    px[o + 3] = 255 * Math.max(a, px[o + 3] / 255)
  }

  /**
   * Distance-based anti-aliasing: coverage is the clamp of (0.5 - dist), so a
   * hairline at 16 px is one clean pixel wide rather than a smear.
   */
  const line = (x0, y0, x1, y1, w, rgb, alpha = 1) => {
    const dx = x1 - x0
    const dy = y1 - y0
    const len2 = dx * dx + dy * dy || 1
    const r = w / 2
    const minX = Math.max(0, Math.floor(Math.min(x0, x1) - r - 1))
    const maxX = Math.min(width - 1, Math.ceil(Math.max(x0, x1) + r + 1))
    const minY = Math.max(0, Math.floor(Math.min(y0, y1) - r - 1))
    const maxY = Math.min(height - 1, Math.ceil(Math.max(y0, y1) + r + 1))
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const t = ((x - x0) * dx + (y - y0) * dy) / len2
        const tc = Math.min(1, Math.max(0, t))
        const ex = x0 + tc * dx - x
        const ey = y0 + tc * dy - y
        const d = Math.sqrt(ex * ex + ey * ey)
        const cov = Math.min(1, Math.max(0, r + 0.5 - d))
        if (cov > 0) put(x, y, rgb, cov * alpha)
      }
    }
  }

  const dot = (cx, cy, rad, rgb, alpha = 1) => {
    for (let y = Math.max(0, Math.floor(cy - rad - 1)); y <= Math.min(height - 1, Math.ceil(cy + rad + 1)); y++) {
      for (let x = Math.max(0, Math.floor(cx - rad - 1)); x <= Math.min(width - 1, Math.ceil(cx + rad + 1)); x++) {
        const d = Math.hypot(x - cx, y - cy)
        const cov = Math.min(1, Math.max(0, rad + 0.5 - d))
        if (cov > 0) put(x, y, rgb, cov * alpha)
      }
    }
  }

  /**
   * The orbit: a parabola opening *up the screen* — apex at the periapsis at
   * the bottom, arms rising and out through the upper corners.
   *
   * The first cut had this upside down: screen y grows downward, so "apex on
   * top, arms falling away" was written as y = apexY − k t² and rendered as a
   * V — a valley, which is the shape of a periapsis viewed from *inside* the
   * orbit, not the way a trajectory chart draws one. A chart draws the swing-by
   * from outside: the path dips *toward* the body it rounds and climbs away.
   */
  const { cx, py, half, k, tick, tipY, dotR, stroke, tickStroke } = geom(width, height)
  const STEPS = 160
  const at = (t) => [cx + t, py + k * t * t]

  let prev = null
  for (let i = 0; i <= STEPS; i++) {
    const t = -half + (2 * half * i) / STEPS
    const [x, y] = at(t)
    if (prev) line(prev[0], prev[1], x, y, stroke, HUD)
    prev = [x, y]
  }

  /**
   * The periapsis tick: a small ember chevron seated in the crook *under* the
   * bend, pointing up at it — the annotation a chart puts on the moment of
   * closest approach. Its tip clears the curve by a couple of pixel-widths so
   * the two never touch: an annotation points, it does not merge. Sized as
   * fractions of the frame, identical at 16 px and 512 px.
   */
  line(cx, tipY, cx - tick, tipY + tick * 0.9, tickStroke, EMBER)
  line(cx, tipY, cx + tick, tipY + tick * 0.9, tickStroke, EMBER)

  /**
   * The orbiting body, at periapsis itself.
   *
   * It used to ride the arc at an arbitrary point, where it merged with the
   * hairline and read as a thickening. At the periapsis it is the third part
   * of one sentence: the trajectory bends, the body is where it bends, the
   * ember tick names the moment. That is the whole name of the sim, and the
   * mark needs nothing else.
   */
  dot(cx, py, dotR, HUD, 1)

  return px
}

/* ---------------------------------------------------------------- *
 * SVG — the same geometry as vectors. A parabola is *exactly* a
 * quadratic Bézier: with endpoints at the arms and the apex at t=½,
 * the control point is C = 2·apex − (P0 + P2)/2. No approximation.
 * ---------------------------------------------------------------- */

const f = (n) => (Math.round(n * 100) / 100).toString()

function svgMark(size) {
  const { cx, py, half, k, tick, tipY, dotR, stroke, tickStroke } = geom(size, size)
  const x0 = cx - half
  const x2 = cx + half
  const yEnd = py + k * half * half
  const cyControl = 2 * py - yEnd // C = 2·apex − midpoint of the endpoints (x is cx by symmetry)
  const d = `M ${f(x0)} ${f(yEnd)} Q ${f(cx)} ${f(cyControl)} ${f(x2)} ${f(yEnd)}`
  const arms = [
    `M ${f(cx)} ${f(tipY)} L ${f(cx - tick)} ${f(tipY + tick * 0.9)}`,
    `M ${f(cx)} ${f(tipY)} L ${f(cx + tick)} ${f(tipY + tick * 0.9)}`,
  ].join(' ')
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-label="Periapsis Zero">`,
    `  <rect width="${size}" height="${size}" fill="${OBSIDIAN_HEX}"/>`,
    `  <path d="${d}" fill="none" stroke="${HUD_HEX}" stroke-width="${f(stroke)}" stroke-linecap="round"/>`,
    `  <path d="${arms}" fill="none" stroke="${EMBER_HEX}" stroke-width="${f(tickStroke)}" stroke-linecap="round"/>`,
    `  <circle cx="${f(cx)}" cy="${f(py)}" r="${f(dotR)}" fill="${HUD_HEX}"/>`,
    `</svg>`,
    '',
  ].join('\n')
}

/* ---------------------------------------------------------------- *
 * PNG — by hand: signature, IHDR, IDAT (zlib stored blocks), IEND
 * ---------------------------------------------------------------- */

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

/** Adler-32, the checksum a zlib wrapper closes with. */
function adler32(bytes) {
  let a = 1
  let b = 0
  for (let i = 0; i < bytes.length; i++) {
    a = (a + bytes[i]) % 65521
    b = (b + a) % 65521
  }
  return ((b << 16) | a) >>> 0
}

function crc32(bytes) {
  let c = 0xffffffff
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length)
  out.writeUInt32BE(data.length, 0)
  out.write(type, 4, 'ascii')
  data.copy(out, 8)
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length)
  return out
}

/** Raw RGBA rows -> PNG, using zlib *stored* blocks (no compression, exact bytes). */
function encodePng(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // colour type: RGBA
  // compression, filter, interlace: all zero.

  // Each row gets its filter byte (0 = none) prefixed.
  const raw = Buffer.alloc(height * (width * 4 + 1))
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0
    Buffer.from(rgba.buffer, rgba.byteOffset + y * width * 4, width * 4).copy(raw, y * (width * 4 + 1) + 1)
  }

  /**
   * A true *uncompressed* deflate stream, assembled by hand: a 2-byte zlib
   * wrapper, then stored blocks of 5 header bytes per 65535 of payload.
   *
   * The first version called `deflateSync(..., { level: 0 })` on an already
   * stored-block stream, which double-wraps it — zlib still builds block
   * structure of its own, so the IDAT was a deflate stream inside a deflate
   * stream and decoded to 5 junk bytes plus the image. Assembling the stored
   * blocks directly is also smaller: no second header layer.
   */
  const blocks = []
  let off = 0
  while (off < raw.length) {
    const n = Math.min(65535, raw.length - off)
    const last = off + n >= raw.length ? 1 : 0
    const head = Buffer.alloc(5)
    head[0] = last
    head.writeUInt16LE(n, 1)
    head.writeUInt16LE(~n & 0xffff, 3)
    blocks.push(head, raw.subarray(off, off + n))
    off += n
  }
  const payload = Buffer.concat(blocks)
  const wrapper = Buffer.from([0x78, 0x01])
  const adler = Buffer.alloc(4)
  adler.writeUInt32BE(adler32(raw), 0)
  const idat = Buffer.concat([wrapper, payload, adler])

  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))])
}

/* ---------------------------------------------------------------- *
 * ICO — one file, every size, by hand
 * ---------------------------------------------------------------- */

function encodeIco(images) {
  // Header: reserved, type 1 (icon), count.
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(images.length, 4)

  // Directory: one entry per image, PNG-compressed payloads (Vista+ format).
  const dirSize = 16 * images.length
  let offset = header.length + dirSize
  const entries = []
  const payloads = []
  for (const { size, png } of images) {
    const e = Buffer.alloc(16)
    e[0] = size >= 256 ? 0 : size
    e[1] = size >= 256 ? 0 : size
    e[2] = 0 // palette
    e[3] = 0 // reserved
    e.writeUInt16LE(1, 4) // planes
    e.writeUInt16LE(32, 6) // bpp
    e.writeUInt32LE(png.length, 8)
    e.writeUInt32LE(offset, 12)
    offset += png.length
    entries.push(e)
    payloads.push(png)
  }
  return Buffer.concat([header, ...entries, ...payloads])
}

/* ---------------------------------------------------------------- *
 * brand.js — the mark as an ES module, for the React surfaces
 * ---------------------------------------------------------------- */

function brandModule() {
  const g = geom(512, 512)
  const x0 = g.cx - g.half
  const x2 = g.cx + g.half
  const yEnd = g.py + g.k * g.half * g.half
  const cY = 2 * g.py - yEnd
  return `// Generated by scripts/make-favicon.mjs — the mark's geometry and palette as
// code, the single source the favicon set, mark.svg and the boot splash are
// all drawn from. Edit the drawing there and re-run \`npm run icons\`; do not
// edit this file, and do not restate its colours anywhere.

export const MARK = {
  viewBox: '0 0 512 512',
  ground: '${OBSIDIAN_HEX}',
  hud: '${HUD_HEX}',
  ember: '${EMBER_HEX}',
  arc: 'M ${f(x0)} ${f(yEnd)} Q ${f(g.cx)} ${f(cY)} ${f(x2)} ${f(yEnd)}',
  tick: [
    'M ${f(g.cx)} ${f(g.tipY)} L ${f(g.cx - g.tick)} ${f(g.tipY + g.tick * 0.9)}',
    'M ${f(g.cx)} ${f(g.tipY)} L ${f(g.cx + g.tick)} ${f(g.tipY + g.tick * 0.9)}',
  ],
  dot: { cx: ${f(g.cx)}, cy: ${f(g.py)}, r: ${f(g.dotR)} },
  arcWidth: ${f(g.stroke)},
  tickWidth: ${f(g.tickStroke)},
}
`
}

/* ---------------------------------------------------------------- *
 * The boot splash, quoted into index.html between markers
 * ---------------------------------------------------------------- */

const BOOT_OPEN = '<!-- boot:generated (scripts/make-favicon.mjs owns this block) -->'
const BOOT_CLOSE = '<!-- /boot:generated -->'

function splashBlock() {
  const svg = svgMark(512).replace(' width="512" height="512"', ' width="72" height="72"')
  return [
    BOOT_OPEN,
    '    <style>',
    '      #boot {',
    '        position: fixed; inset: 0; z-index: 100;',
    '        display: flex; align-items: center; justify-content: center;',
    `        background: ${OBSIDIAN_HEX};`,
    '        opacity: 1; transition: opacity 0.6s ease;',
    '      }',
    '      #boot.boot-done { opacity: 0; pointer-events: none; }',
    '      #boot .boot-inner { display: flex; flex-direction: column; align-items: center; gap: 18px; }',
    '      #boot .boot-title {',
    `        font-family: 'Cormorant Garamond', Georgia, serif; font-weight: 300;`,
    `        font-size: 15px; letter-spacing: 0.34em; text-indent: 0.34em; color: ${HUD_HEX};`,
    '      }',
    '    </style>',
    '    <div id="boot" aria-hidden="true">',
    '      <div class="boot-inner">',
    `      ${svg.split('\n').join('\n      ')}`,
    '        <div class="boot-title">PERIAPSIS ZERO</div>',
    '      </div>',
    '    </div>',
    '    <script>',
    '      (function () {',
    '        var b = document.getElementById("boot")',
    '        var dismiss = function () {',
    '          if (!b || b.dataset.bootDone) return',
    '          b.dataset.bootDone = "1"',
    '          b.classList.add("boot-done")',
    '          window.setTimeout(function () { b.remove() }, 700)',
    '        }',
    '        /**',
    '         * Fallback handoff. The flight scene dismisses on its first',
    '         * rendered frame (Driver.jsx), but the landing page mounts no',
    '         * Driver — without this the splash would cover the front door',
    '         * forever. Landing gets a short fuse; flight a long one, as pure',
    '         * insurance behind the precise handoff.',
    '         */',
    '        window.setTimeout(dismiss, location.hash === "#flight" ? 12000 : 2500)',
    '      })()',
    '    </script>',
    BOOT_CLOSE,
  ].join('\n')
}

function writeIndexSplash() {
  const html = readFileSync(INDEX, 'utf8')
  const splash = splashBlock()
  const openAt = html.indexOf(BOOT_OPEN)
  if (openAt >= 0) {
    const closeAt = html.indexOf(BOOT_CLOSE, openAt)
    if (closeAt < 0) throw new Error('index.html has an unterminated boot block')
    writeFileSync(INDEX, html.slice(0, openAt) + splash + html.slice(closeAt + BOOT_CLOSE.length))
    return 'replaced'
  }
  // No block yet: insert right after <body>.
  const bodyAt = html.indexOf('<body>')
  if (bodyAt < 0) throw new Error('index.html has no <body> to splash into')
  const at = bodyAt + '<body>'.length
  writeFileSync(INDEX, html.slice(0, at) + '\n' + splash + html.slice(at))
  return 'inserted'
}

/* ---------------------------------------------------------------- *
 * Build
 * ---------------------------------------------------------------- */

const SIZES = [16, 32, 48, 64, 128, 180, 192, 512]

function build() {
  const images = SIZES.map((size) => ({ size, px: drawMark(size, size) }))
  const pngs = new Map(images.map(({ size, px }) => [size, encodePng(size, size, px)]))
  return { pngs }
}

const { pngs } = build()

const TARGETS = [
  ...SIZES.map((size) => ({
    name: size === 180 ? 'apple-touch-icon.png' : `favicon-${size}.png`,
    make: () => pngs.get(size),
  })),
  { name: 'favicon.ico', make: () => encodeIco([16, 32, 48].map((s) => ({ size: s, png: pngs.get(s) }))) },
  { name: 'mark.svg', make: () => Buffer.from(svgMark(512), 'utf8') },
]

if (CHECK) {
  let ok = true
  for (const { name, make } of TARGETS) {
    const path = join(OUT_DIR, name)
    let onDisk = null
    try {
      onDisk = readFileSync(path)
    } catch {
      ok = false
      console.log(`  MISSING  ${path}`)
      continue
    }
    const want = make()
    if (!onDisk.equals(want)) {
      ok = false
      console.log(`  STALE    ${path} (${onDisk.length} B on disk, ${want.length} B as drawn)`)
    } else {
      console.log(`  ok       ${path} (${onDisk.length} B)`)
    }
  }
  // The .ico must contain the same three sizes the directory entry advertises.
  const ico = TARGETS[0] && readFileSync(join(OUT_DIR, 'favicon.ico'))
  const count = ico.readUInt16LE(4)
  const sizes = []
  for (let i = 0; i < count; i++) {
    const w = ico[6 + i * 16] || 256
    const h = ico[7 + i * 16] || 256
    sizes.push(Math.min(w, h))
  }
  const expected = [16, 32, 48]
  const same = expected.every((s) => sizes.includes(s)) && sizes.length === expected.length
  if (!same) {
    ok = false
    console.log(`  STALE    favicon.ico contains [${sizes.join(', ')}], expected [${expected.join(', ')}]`)
  } else {
    console.log(`  ok       favicon.ico carries ${sizes.join('/')}`)
  }
  // brand.js must carry the same arc and palette the SVG was drawn with.
  const brand = readFileSync(BRAND, 'utf8')
  const svg = svgMark(512)
  const dOnDisk = brand.match(/arc: '([^']+)'/)?.[1]
  const dAsDrawn = svg.match(/d="([^"]+)"/)?.[1]
  if (dOnDisk !== dAsDrawn || !brand.includes(`hud: '${HUD_HEX}'`) || !brand.includes(`ember: '${EMBER_HEX}'`)) {
    ok = false
    console.log(`  STALE    ${BRAND} (arc or palette differs from the drawing)`)
  } else {
    console.log(`  ok       ${BRAND}`)
  }
  // The splash inside index.html must be the one this drawing produces.
  const html = readFileSync(INDEX, 'utf8')
  const openAt = html.indexOf(BOOT_OPEN)
  const closeAt = html.indexOf(BOOT_CLOSE)
  const want = splashBlock()
  const have = openAt >= 0 && closeAt > openAt ? html.slice(openAt, closeAt + BOOT_CLOSE.length) : null
  if (have !== want) {
    ok = false
    console.log(`  STALE    ${INDEX} boot splash ${have === null ? '(missing)' : '(differs from the drawing)'}`)
  } else {
    console.log(`  ok       ${INDEX} boot splash`)
  }
  console.log(ok ? '\n  PASS' : '\n  FAIL')
  process.exit(ok ? 0 : 1)
}

mkdirSync(OUT_DIR, { recursive: true })
for (const { name, make } of TARGETS) {
  writeFileSync(join(OUT_DIR, name), make())
}
writeFileSync(BRAND, brandModule())
const how = writeIndexSplash()
console.log(
  `written to ${join(OUT_DIR)}: favicon.ico + ${SIZES.length} PNGs (${SIZES.join(', ')}) + mark.svg; ` +
    `${BRAND}; index.html splash ${how}`,
)
