/**
 * The GPU's simplex noise, on the CPU, bit for bit in structure.
 *
 * The terrain shader decides where the scrub, the dry grass and the bare soil
 * are from 3D simplex noise (`glsl/noise.js`). Plants placed on the CPU from a
 * *different* noise would stand in the open grass and leave the drawn scrub
 * bare. So this is the same Gustavson–McEwan formulation, the same constants,
 * the same octave offsets and the same lacunarity, evaluated in doubles: close
 * enough to the float32 GPU result that a palmetto stands where the ground
 * under it is drawn as palmetto.
 */

const mod289 = (x) => x - Math.floor(x * (1 / 289)) * 289
const permute = (x) => mod289((x * 34 + 1) * x)
const taylorInvSqrt = (r) => 1.79284291400159 - 0.85373472095314 * r

export function snoise(vx, vy, vz) {
  const sk = (vx + vy + vz) / 3
  const i0 = Math.floor(vx + sk)
  const i1 = Math.floor(vy + sk)
  const i2 = Math.floor(vz + sk)
  const t = (i0 + i1 + i2) / 6
  const x0 = [vx - i0 + t, vy - i1 + t, vz - i2 + t]
  const g = [x0[0] >= x0[1] ? 1 : 0, x0[1] >= x0[2] ? 1 : 0, x0[2] >= x0[0] ? 1 : 0]
  const l = [1 - g[0], 1 - g[1], 1 - g[2]]
  const a = [Math.min(g[0], l[2]), Math.min(g[1], l[0]), Math.min(g[2], l[1])]
  const b = [Math.max(g[0], l[2]), Math.max(g[1], l[0]), Math.max(g[2], l[1])]
  const X = [
    x0,
    [x0[0] - a[0] + 1 / 6, x0[1] - a[1] + 1 / 6, x0[2] - a[2] + 1 / 6],
    [x0[0] - b[0] + 1 / 3, x0[1] - b[1] + 1 / 3, x0[2] - b[2] + 1 / 3],
    [x0[0] - 0.5, x0[1] - 0.5, x0[2] - 0.5],
  ]
  const im = [mod289(i0), mod289(i1), mod289(i2)]
  const oz = [0, a[2], b[2], 1]
  const oy = [0, a[1], b[1], 1]
  const ox = [0, a[0], b[0], 1]
  let sum = 0
  for (let k = 0; k < 4; k++) {
    const p = permute(permute(permute(im[2] + oz[k]) + im[1] + oy[k]) + im[0] + ox[k])
    const j = p - 49 * Math.floor(p / 49)
    const xq = Math.floor(j / 7)
    const yq = Math.floor(j - 7 * xq)
    const gx = xq * (2 / 7) + (0.5 / 7 - 1)
    const gy = yq * (2 / 7) + (0.5 / 7 - 1)
    const h = 1 - Math.abs(gx) - Math.abs(gy)
    const sh = h <= 0 ? -1 : 0
    let Gx = gx + (Math.floor(gx) * 2 + 1) * sh
    let Gy = gy + (Math.floor(gy) * 2 + 1) * sh
    let Gz = h
    const n = taylorInvSqrt(Gx * Gx + Gy * Gy + Gz * Gz)
    Gx *= n
    Gy *= n
    Gz *= n
    const x = X[k]
    const m = Math.max(0.6 - (x[0] * x[0] + x[1] * x[1] + x[2] * x[2]), 0)
    sum += m * m * m * m * (Gx * x[0] + Gy * x[1] + Gz * x[2])
  }
  return 42 * sum
}

/** `fbmAA` without the pixel cut — every octave, as seen from close up. */
export function fbm(x, y, z, freq, octaves, gain) {
  let sum = 0
  let amp = 0.5
  for (let i = 0; i < octaves; i++) {
    sum += amp * snoise(x * freq + i * 17.13, y * freq + i * -9.71, z * freq + i * 3.37)
    amp *= gain
    freq *= 2.03
  }
  return sum
}

/** The terrain shader's land cover at a point in the pad frame: the scrub mask, 0..1. */
export function scrubAt(x, z) {
  const big = fbm(x, 0, z, 1 / 1400, 4, 0.55)
  const mid = fbm(x + 31, 31, z + 31, 1 / 160, 5, 0.55)
  const fine = fbm(x - 17, -17, z - 17, 1 / 11, 3, 0.6)
  const v = big * 0.7 + mid * 0.45 + fine * 0.25
  return Math.min(1, Math.max(0, (v - 0.12) / 0.3))
}
