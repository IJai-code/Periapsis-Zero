/**
 * Seeded 3D value-gradient (Perlin) noise, plus the fBm variants the texture
 * generators are built from.
 *
 * Everything is sampled in *three dimensions on the unit sphere* rather than in
 * 2D across the equirectangular image. That costs a little more per sample and
 * buys two things for free: no seam down the antimeridian, and no smeared
 * pinching at the poles.
 */

/** Deterministic 32-bit PRNG, so every reload produces the same planet. */
export function mulberry32(seed) {
  let a = seed >>> 0
  return function () {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10)
const lerp = (a, b, t) => a + t * (b - a)

function grad(hash, x, y, z) {
  const h = hash & 15
  const u = h < 8 ? x : y
  const v = h < 4 ? y : h === 12 || h === 14 ? x : z
  return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v)
}

/** A noise instance owns its own permutation table, so seeds stay independent. */
export function makeNoise(seed) {
  const rand = mulberry32(seed)
  const perm = new Uint8Array(512)
  const src = new Uint8Array(256)
  for (let i = 0; i < 256; i++) src[i] = i
  for (let i = 255; i > 0; i--) {
    const j = (rand() * (i + 1)) | 0
    const t = src[i]
    src[i] = src[j]
    src[j] = t
  }
  for (let i = 0; i < 512; i++) perm[i] = src[i & 255]

  function noise3(x, y, z) {
    const fx = Math.floor(x)
    const fy = Math.floor(y)
    const fz = Math.floor(z)
    const X = fx & 255
    const Y = fy & 255
    const Z = fz & 255
    x -= fx
    y -= fy
    z -= fz
    const u = fade(x)
    const v = fade(y)
    const w = fade(z)

    const A = perm[X] + Y
    const AA = perm[A] + Z
    const AB = perm[A + 1] + Z
    const B = perm[X + 1] + Y
    const BA = perm[B] + Z
    const BB = perm[B + 1] + Z

    return lerp(
      lerp(
        lerp(grad(perm[AA], x, y, z), grad(perm[BA], x - 1, y, z), u),
        lerp(grad(perm[AB], x, y - 1, z), grad(perm[BB], x - 1, y - 1, z), u),
        v,
      ),
      lerp(
        lerp(grad(perm[AA + 1], x, y, z - 1), grad(perm[BA + 1], x - 1, y, z - 1), u),
        lerp(grad(perm[AB + 1], x, y - 1, z - 1), grad(perm[BB + 1], x - 1, y - 1, z - 1), u),
        v,
      ),
      w,
    )
  }

  /** Fractional Brownian motion. Roughly -1..1. */
  function fbm(x, y, z, octaves = 5, lacunarity = 2.03, gain = 0.5) {
    let amp = 1
    let freq = 1
    let sum = 0
    let norm = 0
    for (let o = 0; o < octaves; o++) {
      sum += amp * noise3(x * freq, y * freq, z * freq)
      norm += amp
      amp *= gain
      freq *= lacunarity
    }
    return sum / norm
  }

  /**
   * Ridged multifractal — the |n| fold turns smooth hills into sharp crests,
   * which is what makes mountain ranges and crater ejecta read correctly.
   */
  function ridged(x, y, z, octaves = 5, lacunarity = 2.07, gain = 0.5) {
    let amp = 1
    let freq = 1
    let sum = 0
    let norm = 0
    for (let o = 0; o < octaves; o++) {
      const n = 1 - Math.abs(noise3(x * freq, y * freq, z * freq))
      sum += amp * n * n
      norm += amp
      amp *= gain
      freq *= lacunarity
    }
    return (sum / norm) * 2 - 1
  }

  return { noise3, fbm, ridged }
}

/**
 * Bilinear sample of a low-resolution scalar field, with longitude wrapping and
 * latitude clamping. Every expensive noise field is generated small and read
 * back through this, which is what keeps generation under a couple of seconds.
 */
export function sampleField(field, w, h, u, v) {
  const x = u * w - 0.5
  const y = v * h - 0.5
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const tx = x - x0
  const ty = y - y0
  const x1 = (((x0 + 1) % w) + w) % w
  const xa = ((x0 % w) + w) % w
  const y0c = y0 < 0 ? 0 : y0 > h - 1 ? h - 1 : y0
  const y1c = y0 + 1 < 0 ? 0 : y0 + 1 > h - 1 ? h - 1 : y0 + 1
  const r0 = y0c * w
  const r1 = y1c * w
  return lerp(
    lerp(field[r0 + xa], field[r0 + x1], tx),
    lerp(field[r1 + xa], field[r1 + x1], tx),
    ty,
  )
}

/** Unit sphere direction for an equirectangular pixel. Row 0 is the south pole. */
export function sphereDir(col, row, w, h, out) {
  const lon = ((col + 0.5) / w) * Math.PI * 2 - Math.PI
  const lat = ((row + 0.5) / h) * Math.PI - Math.PI / 2
  const cl = Math.cos(lat)
  out[0] = cl * Math.cos(lon)
  out[1] = Math.sin(lat)
  out[2] = cl * Math.sin(lon)
  return out
}

export const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x)
export const smoothstep = (e0, e1, x) => {
  const t = clamp01((x - e0) / (e1 - e0))
  return t * t * (3 - 2 * t)
}
export const mix = lerp

/**
 * Cached table of unit-sphere directions for an equirectangular grid.
 *
 * Every generator walks the same grids, and `sphereDir` costs three trig calls
 * per pixel. Computing the table once and reading it back turns the inner loops
 * into pure arithmetic — the crater rasteriser alone visits several million
 * pixels, and it was spending most of its time in sin/cos.
 */
const dirCache = new Map()

export function directionField(w, h) {
  const key = `${w}x${h}`
  let field = dirCache.get(key)
  if (field) return field

  field = new Float32Array(w * h * 3)
  const d = [0, 0, 0]
  for (let r = 0; r < h; r++) {
    for (let x = 0; x < w; x++) {
      sphereDir(x, r, w, h, d)
      const o = (r * w + x) * 3
      field[o] = d[0]
      field[o + 1] = d[1]
      field[o + 2] = d[2]
    }
  }
  dirCache.set(key, field)
  return field
}
