/**
 * The Periapsis Zero favicon, drawn by code rather than by hand.
 *
 * The mark: a trajectory chart rendered as a mission patch. A shaded planet
 * with a lit limb and a night side that falls into the ground; an orbit drawn
 * as an honest ellipse with that planet at its focus; and at the one point the
 * ellipse grazes the planet's limb — closest approach — an ember marker and
 * the chart's chevron naming it. Periapsis. The sim is named for that moment;
 * the mark *is* the name.
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
 * disagree — every coordinate the mark has is computed once here.
 *
 * The composition is arithmetic, not taste: the orbit is an ellipse with the
 * planet at its focus, offset by 0.115 S, semi-axes 0.375 S and 0.235 S — so
 * its lower vertex lands at cy + 0.12 S against a planet of radius 0.13 S.
 * Closest approach touches the limb: the periapsis marker sits on the planet's
 * edge because that is where periapsis *is*. A contact achieved by the numbers
 * holds at 16 px and at 512 without either being tuned for the other.
 */
function geom(width, height) {
  const S = Math.min(width, height)
  const cx = 0.5 * S
  const cy = 0.5 * S
  return {
    S,
    cx,
    cy,
    pr: 0.13 * S,
    // The orbit: the planet sits at the focus, so the ellipse is lifted away
    // from periapsis by c = 0.115 S.
    ex: 0.5 * S,
    ey: 0.5 * S - 0.115 * S,
    ea: 0.375 * S,
    eb: 0.235 * S,
    periX: cx,
    periY: cy + 0.12 * S,
    periR: 0.03 * S,
    strokeNear: Math.max(1, 0.028 * S),
    strokeFar: Math.max(1, 0.02 * S),
    tick: 0.085 * S,
    tipY: cy + 0.205 * S,
    tickStroke: Math.max(1, 0.032 * S),
  }
}

/**
 * The stars: six, in the corners the ellipse leaves empty. Fractions of the
 * frame and a radius at the 512 reference size, so one table feeds both
 * renderers and the two cannot disagree about where the sky is.
 */
const STARS = [
  [0.145, 0.155, 2.6, 0.75],
  [0.845, 0.115, 1.9, 0.6],
  [0.905, 0.34, 2.3, 0.7],
  [0.085, 0.375, 1.7, 0.5],
  [0.72, 0.875, 2.0, 0.55],
  [0.185, 0.86, 1.6, 0.5],
]

/** Blend two [r,g,b] colours, t toward b. */
const mix = (a, b, t) => [0, 1, 2].map((i) => Math.round(a[i] + (b[i] - a[i]) * t))

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

  /** Soft radial falloff: a halo, a star's bloom, the marker's glow. */
  const glow = (gx, gy, rad, rgb, alpha) => {
    for (let y = Math.max(0, Math.floor(gy - rad * 2)); y <= Math.min(height - 1, Math.ceil(gy + rad * 2)); y++) {
      for (let x = Math.max(0, Math.floor(gx - rad * 2)); x <= Math.min(width - 1, Math.ceil(gx + rad * 2)); x++) {
        const d = Math.hypot(x + 0.5 - gx, y + 0.5 - gy) / rad
        const a = alpha * Math.exp(-d * d * 2.2)
        if (a > 0.003) put(x, y, rgb, a)
      }
    }
  }

  const { S, cx, cy, pr, ex, ey, ea, eb, periX, periY, periR, strokeNear, strokeFar, tick, tipY, tickStroke } =
    geom(width, height)

  /*
   * Drawn back to front: the field's halo, the stars, the far half of the
   * orbit, the planet, the periapsis marker, the near half, the annotation.
   */

  // A halo behind the planet, biased to the light — a patch printed on a
  // ground, not a hole punched in the page.
  glow(cx - 0.06 * S, cy - 0.06 * S, 0.38 * S, HUD, 0.085)

  for (const [fx, fy, fr, fa] of STARS) {
    glow(fx * S, fy * S, (fr * S) / 512, HUD, fa * 0.5)
    dot(fx * S, fy * S, (fr * S) / 512, HUD, fa)
  }

  /** The ellipse, sampled. from..to are radians; y grows downward. */
  const arc = (from, to, w, rgb, alpha) => {
    const STEPS = 140
    let prev = null
    for (let i = 0; i <= STEPS; i++) {
      const th = from + ((to - from) * i) / STEPS
      const x = ex + ea * Math.cos(th)
      const y = ey + eb * Math.sin(th)
      if (prev) line(prev[0], prev[1], x, y, w, rgb, alpha)
      prev = [x, y]
    }
  }

  // The far half: behind everything, and the drawing says so — thinner, dimmer.
  arc(Math.PI, 2 * Math.PI, strokeFar, HUD, 0.45)

  /**
   * The planet: a lit sphere, per pixel.
   *
   * Lambert from the upper left; a night side with just enough ambient to keep
   * its shape before it falls into the ground; two darker mottles so the sphere
   * is a world and not a ball; and a sunward atmosphere limb — the fresnel
   * crescent every photograph of a planet against black carries. The edge is
   * coverage-antialiased like the strokes: half a pixel in, half out.
   */
  const L = (() => {
    const v = [-0.55, -0.62, 0.56]
    const n = Math.hypot(v[0], v[1], v[2])
    return v.map((u) => u / n)
  })()
  const rMax = pr + 1
  for (let y = Math.max(0, Math.floor(cy - rMax)); y <= Math.min(height - 1, Math.ceil(cy + rMax)); y++) {
    for (let x = Math.max(0, Math.floor(cx - rMax)); x <= Math.min(width - 1, Math.ceil(cx + rMax)); x++) {
      const dx = (x + 0.5 - cx) / pr
      const dy = (y + 0.5 - cy) / pr
      const rad = Math.hypot(dx, dy)
      const cov = Math.min(1, Math.max(0, (1 - rad) * pr + 0.5))
      if (cov <= 0) continue
      const z = Math.sqrt(Math.max(0, 1 - rad * rad))
      const lam = Math.max(0, dx * L[0] + dy * L[1] + z * L[2])
      const m1 = Math.exp(-(((dx - 0.32) ** 2 + (dy + 0.28) ** 2) / 0.16))
      const m2 = Math.exp(-(((dx + 0.38) ** 2 + (dy - 0.12) ** 2) / 0.1))
      const albedo = 0.66 * (1 - 0.16 * m1 - 0.11 * m2)
      const ambient = 0.075
      const rim = Math.pow(1 - z, 3.2) * (0.3 + 0.7 * lam)
      const lit = albedo * (ambient + 1.02 * lam)
      const rgb = [
        HUD[0] * lit + HUD[0] * rim * 0.9,
        HUD[1] * lit + HUD[1] * rim * 0.82,
        HUD[2] * lit + HUD[2] * rim * 0.62,
      ]
      put(x, y, rgb, cov)
    }
  }

  // The near half, over the planet where they meet: the closest thing in the
  // picture. Drawn before the marker so the ember point caps the arc exactly
  // where closest approach happens — the marker is *on* the orbit, at the
  // moment the sim is named for, and a probe at that point reads ember.
  arc(0, Math.PI, strokeNear, HUD, 1)

  // Periapsis: the marker on the limb, with the glow a hot point carries.
  glow(periX, periY, periR * 3, EMBER, 0.4)
  dot(periX, periY, periR, EMBER, 1)

  /**
   * The periapsis tick: the chart's chevron, seated below the marker and
   * pointing up at it — an annotation points, it does not touch.
   */
  line(cx, tipY, cx - tick, tipY + tick * 0.9, tickStroke, EMBER)
  line(cx, tipY, cx + tick, tipY + tick * 0.9, tickStroke, EMBER)

  return px
}

/* ---------------------------------------------------------------- *
 * SVG — the same geometry as vectors. A parabola is *exactly* a
 * quadratic Bézier: with endpoints at the arms and the apex at t=½,
 * the control point is C = 2·apex − (P0 + P2)/2. No approximation.
 * ---------------------------------------------------------------- */

const f = (n) => (Math.round(n * 100) / 100).toString()

/** The two ellipse halves as SVG arcs: the far (upper) and near (lower) paths. */
function orbitPaths(g) {
  const x0 = g.ex - g.ea
  const x1 = g.ex + g.ea
  return {
    // sweep 1 turns through the top (y down), sweep 0 through the bottom.
    far: `M ${f(x0)} ${f(g.ey)} A ${f(g.ea)} ${f(g.eb)} 0 0 1 ${f(x1)} ${f(g.ey)}`,
    near: `M ${f(x0)} ${f(g.ey)} A ${f(g.ea)} ${f(g.eb)} 0 0 0 ${f(x1)} ${f(g.ey)}`,
  }
}

function svgMark(size) {
  const g = geom(size, size)
  const { far, near } = orbitPaths(g)
  const arms = [
    `M ${f(g.cx)} ${f(g.tipY)} L ${f(g.cx - g.tick)} ${f(g.tipY + g.tick * 0.9)}`,
    `M ${f(g.cx)} ${f(g.tipY)} L ${f(g.cx + g.tick)} ${f(g.tipY + g.tick * 0.9)}`,
  ].join(' ')
  // The raster's Lambert is a gradient here: the key light sits upper-left,
  // the night side falls to the ground colour at the rim.
  const tint = hex(mix(HUD, [255, 255, 255], 0.22))
  const mid = hex(mix(HUD, OBSIDIAN, 0.35))
  const night = hex(mix(HUD, OBSIDIAN, 0.86))
  const stars = STARS.map(
    ([fx, fy, fr, fa]) =>
      `  <circle cx="${f(fx * size)}" cy="${f(fy * size)}" r="${f((fr * size) / 512)}" fill="${HUD_HEX}" opacity="${f(fa)}"/>`,
  ).join('\n')
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-label="Periapsis Zero">`,
    '  <defs>',
    `    <radialGradient id="pz-halo" cx="0.44" cy="0.43" r="0.52">`,
    `      <stop offset="0" stop-color="${HUD_HEX}" stop-opacity="0.16"/>`,
    `      <stop offset="1" stop-color="${HUD_HEX}" stop-opacity="0"/>`,
    '    </radialGradient>',
    `    <radialGradient id="pz-planet" cx="0.36" cy="0.30" r="0.92">`,
    `      <stop offset="0" stop-color="${tint}"/>`,
    `      <stop offset="0.52" stop-color="${mid}"/>`,
    `      <stop offset="1" stop-color="${night}"/>`,
    '    </radialGradient>',
    `    <radialGradient id="pz-peri">`,
    `      <stop offset="0" stop-color="${EMBER_HEX}" stop-opacity="0.55"/>`,
    `      <stop offset="1" stop-color="${EMBER_HEX}" stop-opacity="0"/>`,
    '    </radialGradient>',
    '  </defs>',
    `  <rect width="${size}" height="${size}" fill="${OBSIDIAN_HEX}"/>`,
    `  <rect width="${size}" height="${size}" fill="url(#pz-halo)"/>`,
    stars,
    `  <path id="orbit-far" d="${far}" fill="none" stroke="${HUD_HEX}" stroke-width="${f(g.strokeFar)}" stroke-linecap="round" opacity="0.45"/>`,
    `  <circle cx="${f(g.cx)}" cy="${f(g.cy)}" r="${f(g.pr)}" fill="url(#pz-planet)"/>`,
    `  <circle cx="${f(g.cx)}" cy="${f(g.cy)}" r="${f(g.pr)}" fill="none" stroke="${tint}" stroke-width="${f(Math.max(1, g.S * 0.005))}" opacity="0.35"/>`,
    `  <circle cx="${f(g.periX)}" cy="${f(g.periY)}" r="${f(g.periR * 3)}" fill="url(#pz-peri)"/>`,
    `  <circle cx="${f(g.periX)}" cy="${f(g.periY)}" r="${f(g.periR)}" fill="${EMBER_HEX}"/>`,
    `  <path id="orbit-near" d="${near}" fill="none" stroke="${HUD_HEX}" stroke-width="${f(g.strokeNear)}" stroke-linecap="round"/>`,
    `  <path d="${arms}" fill="none" stroke="${EMBER_HEX}" stroke-width="${f(g.tickStroke)}" stroke-linecap="round"/>`,
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
  const { far, near } = orbitPaths(g)
  const tint = hex(mix(HUD, [255, 255, 255], 0.22))
  const mid = hex(mix(HUD, OBSIDIAN, 0.35))
  const night = hex(mix(HUD, OBSIDIAN, 0.86))
  const stars = STARS.map(([fx, fy, fr, fa]) => `[${f(fx * 512)}, ${f(fy * 512)}, ${f((fr * 512) / 512)}, ${f(fa)}]`)
  return `// Generated by scripts/make-favicon.mjs — the mark's geometry and palette as
// code, the single source the favicon set, mark.svg and the boot splash are
// all drawn from. Edit the drawing there and re-run \`npm run icons\`; do not
// edit this file, and do not restate its colours anywhere.

export const MARK = {
  viewBox: '0 0 512 512',
  ground: '${OBSIDIAN_HEX}',
  hud: '${HUD_HEX}',
  ember: '${EMBER_HEX}',
  // The planet's gradient: lit upper-left, night side toward the ground.
  tint: '${tint}',
  mid: '${mid}',
  night: '${night}',
  planet: { cx: ${f(g.cx)}, cy: ${f(g.cy)}, r: ${f(g.pr)} },
  orbit: { cx: ${f(g.ex)}, cy: ${f(g.ey)}, a: ${f(g.ea)}, b: ${f(g.eb)} },
  orbitFar: '${far}',
  orbitNear: '${near}',
  orbitFarWidth: ${f(g.strokeFar)},
  orbitNearWidth: ${f(g.strokeNear)},
  periapsis: { cx: ${f(g.periX)}, cy: ${f(g.periY)}, r: ${f(g.periR)} },
  tick: [
    'M ${f(g.cx)} ${f(g.tipY)} L ${f(g.cx - g.tick)} ${f(g.tipY + g.tick * 0.9)}',
    'M ${f(g.cx)} ${f(g.tipY)} L ${f(g.cx + g.tick)} ${f(g.tipY + g.tick * 0.9)}',
  ],
  tickWidth: ${f(g.tickStroke)},
  // [x, y, radius, opacity] at the 512 reference size.
  stars: [${stars.join(', ')}],
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
  // brand.js must carry the same orbit and palette the SVG was drawn with.
  const brand = readFileSync(BRAND, 'utf8')
  const svg = svgMark(512)
  const dOnDisk = brand.match(/orbitNear: '([^']+)'/)?.[1]
  const dAsDrawn = svg.match(/id="orbit-near" d="([^"]+)"/)?.[1]
  if (dOnDisk !== dAsDrawn || !brand.includes(`hud: '${HUD_HEX}'`) || !brand.includes(`ember: '${EMBER_HEX}'`)) {
    ok = false
    console.log(`  STALE    ${BRAND} (orbit or palette differs from the drawing)`)
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
