import { makeNoise, sampleField, sphereDir, clamp01, smoothstep, mix } from './noise.js'

/**
 * Equirectangular Milky Way skybox.
 *
 * Two passes. The diffuse galaxy — band, central bulge, dust lanes, emission
 * nebulae — is generated small and bilinearly upscaled, because it has no high
 * frequency content worth paying for. The stars are then splatted at full
 * resolution on top, since they are nothing but high frequency content.
 */

const W = 4096
const H = 2048
const FW = 1024 // diffuse field resolution
const FH = 512
const SEED = 0xa17e

/**
 * North galactic pole, rotated into the scene's y-up ecliptic frame. The galaxy
 * cuts across the ecliptic at roughly 60 degrees, which is why the band runs
 * diagonally past the orbital plane instead of lying flat in it.
 */
const POLE = (() => {
  const l = (180.02 * Math.PI) / 180
  const b = (29.81 * Math.PI) / 180
  const cb = Math.cos(b)
  return [cb * Math.cos(l), Math.sin(b), -cb * Math.sin(l)]
})()

/** Direction of the galactic centre (Sagittarius A*), same frame. */
const CENTRE = (() => {
  const l = (266.84 * Math.PI) / 180
  const b = (-5.54 * Math.PI) / 180
  const cb = Math.cos(b)
  return [cb * Math.cos(l), Math.sin(b), -cb * Math.sin(l)]
})()

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

export function generateSky(report = () => {}) {
  report('galactic structure', 0.0)

  const dust = makeNoise(SEED)
  const glow = makeNoise(SEED + 3)
  const neb = makeNoise(SEED + 9)

  const fr = new Float32Array(FW * FH)
  const fg = new Float32Array(FW * FH)
  const fb = new Float32Array(FW * FH)
  const d = [0, 0, 0]

  for (let r = 0; r < FH; r++) {
    for (let x = 0; x < FW; x++) {
      sphereDir(x, r, FW, FH, d)
      const i = r * FW + x

      // Angular distance from the galactic plane, and from the core.
      const fromPlane = Math.abs(Math.asin(clamp01(Math.abs(dot(d, POLE))) * Math.sign(1)))
      const toCentre = Math.acos(Math.max(-1, Math.min(1, dot(d, CENTRE))))

      // The disc is thicker and brighter toward the core, thin and faint toward
      // the anticentre — that asymmetry is most of what makes it read as *ours*.
      const coreProx = Math.exp(-((toCentre / 1.15) ** 2))
      const thickness = mix(0.075, 0.20, coreProx)
      const band = Math.exp(-((fromPlane / thickness) ** 2))
      const halo = Math.exp(-((fromPlane / (thickness * 3.4)) ** 2)) * 0.30
      const bulge = Math.exp(-((toCentre / 0.34) ** 2)) * 0.85

      // Mottling: unresolved star clouds.
      const clumps = glow.fbm(d[0] * 5.5, d[1] * 5.5, d[2] * 5.5, 5) * 0.5 + 0.5

      let lum = (band * mix(0.55, 1.0, coreProx) + halo + bulge) * mix(0.45, 1.35, clumps)

      // Dark nebulae. Ridged noise gives the filamentary lanes that cut the
      // band in two along its spine, rather than soft blotches.
      const lane = Math.pow(clamp01(dust.ridged(d[0] * 7, d[1] * 13, d[2] * 7, 5) * 0.5 + 0.5), 1.7)
      const laneMask = Math.exp(-((fromPlane / (thickness * 1.5)) ** 2))
      lum *= 1 - laneMask * lane * 0.82

      // Slightly warm toward the dust-reddened core, cool in the outer arms.
      let cr = lum * mix(0.72, 1.0, coreProx)
      let cg = lum * mix(0.76, 0.86, coreProx)
      let cb2 = lum * mix(1.0, 0.78, coreProx)

      // Emission nebulae: H-alpha red and O-III teal, hugging the plane.
      const nb = neb.fbm(d[0] * 3.2 + 40, d[1] * 3.2, d[2] * 3.2, 4) * 0.5 + 0.5
      const emission = Math.pow(smoothstep(0.62, 0.95, nb), 2) * band * 1.9
      const hue = neb.fbm(d[0] * 2.1, d[1] * 2.1 + 17, d[2] * 2.1, 2) * 0.5 + 0.5
      cr += emission * mix(0.95, 0.12, hue)
      cg += emission * mix(0.18, 0.55, hue)
      cb2 += emission * mix(0.30, 0.60, hue)

      fr[i] = cr
      fg[i] = cg
      fb[i] = cb2
    }
  }

  report('starfield', 0.55)
  const out = new Uint8Array(W * H * 4)

  // Upscale the diffuse galaxy. Kept deliberately dim: the skybox is backdrop,
  // not subject, and a bright one washes out the planets in front of it.
  const GAIN = 62
  for (let r = 0; r < H; r++) {
    const v = (r + 0.5) / H
    for (let x = 0; x < W; x++) {
      const u = (x + 0.5) / W
      const o = (r * W + x) * 4
      out[o] = Math.min(255, sampleField(fr, FW, FH, u, v) * GAIN)
      out[o + 1] = Math.min(255, sampleField(fg, FW, FH, u, v) * GAIN)
      out[o + 2] = Math.min(255, sampleField(fb, FW, FH, u, v) * GAIN)
      out[o + 3] = 255
    }
  }

  /*
   * The stars this used to splat here are gone. There were 52,000 of them,
   * invented, and `components/Starfield.jsx` now draws 115,000 real ones out of
   * the Hipparcos catalogue in front of this backdrop. What is left is the part
   * a catalogue cannot supply: the band itself is the light of hundreds of
   * millions of stars too faint to list, so it stays a diffuse field.
   */
  return { sky: { data: out, width: W, height: H } }
}

const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
]
const norm = (a) => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1
  return [a[0] / l, a[1] / l, a[2] / l]
}
