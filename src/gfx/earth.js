import {
  makeNoise,
  sampleField,
  sphereDir,
  directionField,
  clamp01,
  smoothstep,
  mix,
  mulberry32,
} from './noise.js'

/**
 * Procedural Earth texture set: albedo, normal, roughness, night lights and a
 * separate cloud sheet — all equirectangular, all generated from one shared
 * elevation field so the maps actually agree with each other (mountains in the
 * normal map are mountains in the albedo, cities sit in lowlands, oceans are
 * the only smooth thing on the planet).
 *
 * Row 0 is the south pole: DataTexture has flipY = false, and three's
 * SphereGeometry puts v = 0 at -Y.
 */

const FW = 1024 // field resolution — everything expensive happens at this size
const FH = 512
const TW = 2048 // output texture resolution
const TH = 1024

const SEED = 0x5eed

/** Fraction of the surface above sea level. Earth's real value is 0.292. */
const LAND_FRACTION = 0.29

const PALETTE = {
  abyss: [0.004, 0.02, 0.075],
  deep: [0.012, 0.07, 0.20],
  shelf: [0.05, 0.30, 0.44],
  beach: [0.72, 0.66, 0.48],
  tropical: [0.07, 0.20, 0.045],
  savanna: [0.38, 0.35, 0.14],
  desert: [0.66, 0.53, 0.31],
  temperate: [0.15, 0.28, 0.10],
  steppe: [0.40, 0.38, 0.21],
  taiga: [0.09, 0.17, 0.10],
  tundra: [0.33, 0.31, 0.26],
  rock: [0.30, 0.27, 0.24],
  snow: [0.93, 0.95, 0.97],
  ice: [0.84, 0.89, 0.94],
}

function mix3(a, b, t) {
  return [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)]
}

/**
 * Continuous biome lookup. Written as a chain of smoothstep blends rather than
 * a band table so there are no hard latitude seams anywhere on the planet.
 */
function biome(absLat, moist) {
  const warm = mix3(PALETTE.savanna, PALETTE.tropical, smoothstep(0.34, 0.74, moist))
  const sub = mix3(PALETTE.desert, PALETTE.temperate, smoothstep(0.40, 0.72, moist))
  const temp = mix3(PALETTE.steppe, PALETTE.temperate, smoothstep(0.28, 0.62, moist))
  const boreal = mix3(PALETTE.steppe, PALETTE.taiga, smoothstep(0.24, 0.58, moist))

  let c = warm
  c = mix3(c, sub, smoothstep(11, 25, absLat))
  c = mix3(c, temp, smoothstep(28, 41, absLat))
  c = mix3(c, boreal, smoothstep(45, 57, absLat))
  c = mix3(c, PALETTE.tundra, smoothstep(58, 67, absLat))
  c = mix3(c, PALETTE.ice, smoothstep(70, 79, absLat))
  return c
}

/** Elevation, moisture and urbanisation fields, shared by every output map. */
function buildFields() {
  const continents = makeNoise(SEED)
  const warp = makeNoise(SEED + 7)
  const wet = makeNoise(SEED + 13)
  const ridges = makeNoise(SEED + 29)
  const urban = makeNoise(SEED + 41)

  const height = new Float32Array(FW * FH)
  const moisture = new Float32Array(FW * FH)
  const urbanity = new Float32Array(FW * FH)
  const d = [0, 0, 0]

  for (let r = 0; r < FH; r++) {
    for (let x = 0; x < FW; x++) {
      sphereDir(x, r, FW, FH, d)
      const [dx, dy, dz] = d

      // Domain warp turns fBm's isotropic blobs into coastlines with capes,
      // bays and archipelagos instead of round islands.
      const wu = warp.fbm(dx * 1.6 + 11.3, dy * 1.6, dz * 1.6, 4)
      const wv = warp.fbm(dx * 1.6, dy * 1.6 + 43.7, dz * 1.6, 4)
      const ww = warp.fbm(dx * 1.6, dy * 1.6, dz * 1.6 + 71.1, 4)
      const q = 0.62

      let h = continents.fbm(dx * 1.9 + wu * q, dy * 1.9 + wv * q, dz * 1.9 + ww * q, 6)

      // Mountain belts, gated so they only rise on land.
      const belt = ridges.ridged(dx * 4.2, dy * 4.2, dz * 4.2, 5)
      h += 0.13 * belt * smoothstep(-0.02, 0.16, h)

      // Push the poles up so the ice caps sit on real ground.
      h += smoothstep(0.80, 0.995, Math.abs(dy)) * 0.30

      const i = r * FW + x
      height[i] = h
      moisture[i] = wet.fbm(dx * 2.5, dy * 2.5, dz * 2.5, 4) * 0.5 + 0.5
      urbanity[i] = clamp01(urban.fbm(dx * 3.4, dy * 3.4, dz * 3.4, 4) * 0.5 + 0.5)
    }
  }

  // Pick sea level by histogram so the land fraction is exactly right whatever
  // the noise happened to produce. Rows are sampled with a cos(lat) weighting
  // (via arcsin) so the over-represented polar rows don't skew the percentile.
  const rand = mulberry32(99)
  const sample = new Float64Array(40000)
  for (let i = 0; i < sample.length; i++) {
    const row = Math.min(FH - 1, Math.floor((Math.asin(2 * rand() - 1) / Math.PI + 0.5) * FH))
    sample[i] = height[row * FW + Math.floor(rand() * FW)]
  }
  sample.sort()
  const seaLevel = sample[Math.floor((1 - LAND_FRACTION) * sample.length)]

  for (let i = 0; i < height.length; i++) height[i] -= seaLevel

  return { height, moisture, urbanity }
}

export function generateEarth(report = () => {}) {
  report('elevation', 0.0)
  const { height, moisture, urbanity } = buildFields()

  const grain = makeNoise(SEED + 53)
  const cloudN = makeNoise(SEED + 67)
  const cloudWarp = makeNoise(SEED + 83)
  const d = [0, 0, 0]

  const day = new Uint8Array(TW * TH * 4)
  const normal = new Uint8Array(TW * TH * 4)
  const rough = new Uint8Array(TW * TH * 4)
  const night = new Uint8Array(TW * TH * 4)
  const clouds = new Uint8Array(TW * TH * 4)

  report('surface', 0.3)
  for (let r = 0; r < TH; r++) {
    const v = (r + 0.5) / TH
    const lat = v * 180 - 90
    const absLat = Math.abs(lat)

    for (let x = 0; x < TW; x++) {
      const u = (x + 0.5) / TW
      const i = (r * TW + x) * 4

      const elev = sampleField(height, FW, FH, u, v)
      const moist = sampleField(moisture, FW, FH, u, v)

      sphereDir(x, r, TW, TH, d)
      const fine = grain.fbm(d[0] * 26, d[1] * 26, d[2] * 26, 2)

      let c
      let roughness

      if (elev < 0) {
        const depth = clamp01(-elev / 0.34)
        c = mix3(PALETTE.shelf, PALETTE.deep, smoothstep(0.0, 0.30, depth))
        c = mix3(c, PALETTE.abyss, smoothstep(0.28, 0.85, depth))
        // Sea ice, following the same latitude line as the land ice.
        c = mix3(c, PALETTE.ice, smoothstep(74, 82, absLat) * 0.90)
        // Open water is the only genuinely smooth surface on the planet, which
        // is what produces the specular sun-glint highlight.
        roughness = mix(0.10, 0.34, smoothstep(74, 82, absLat))
      } else {
        const alt = clamp01(elev / 0.40)
        c = biome(absLat, moist)
        c = mix3(PALETTE.beach, c, smoothstep(0.0, 0.035, elev))
        c = mix3(c, PALETTE.rock, smoothstep(0.40, 0.62, alt))
        const snowLine = 0.74 - smoothstep(0, 72, absLat) * 0.62
        c = mix3(c, PALETTE.snow, smoothstep(snowLine, snowLine + 0.13, alt))
        const g = 0.90 + 0.20 * fine
        c = [c[0] * g, c[1] * g, c[2] * g]
        roughness = mix(0.94, 0.62, smoothstep(0.5, 0.9, alt))
      }

      day[i] = c[0] * 255
      day[i + 1] = c[1] * 255
      day[i + 2] = c[2] * 255
      day[i + 3] = 255

      const rq = clamp01(roughness + fine * 0.04) * 255
      rough[i] = rq
      rough[i + 1] = rq
      rough[i + 2] = rq
      rough[i + 3] = 255
    }
    if ((r & 255) === 0) report('surface', 0.3 + 0.32 * (r / TH))
  }

  report('terrain relief', 0.62)
  buildNormalMap(height, normal)

  report('city lights', 0.78)
  buildNightLights(height, urbanity, night)

  report('cloud sheet', 0.89)
  buildClouds(cloudN, cloudWarp, clouds)

  return {
    day: { data: day, width: TW, height: TH },
    normal: { data: normal, width: TW, height: TH },
    rough: { data: rough, width: TW, height: TH },
    night: { data: night, width: TW, height: TH },
    clouds: { data: clouds, width: TW, height: TH },
  }
}

/**
 * Tangent-space normals from central differences on the elevation field.
 *
 * Two details matter. The longitude derivative is divided by cos(lat), or every
 * feature shears sideways as it approaches the poles. And the +V axis points
 * north while increasing row index also points north (row 0 is the south pole),
 * so green is -dh/dv, i.e. the *negated* forward row difference.
 */
function buildNormalMap(height, out) {
  const LAND_RELIEF = 2.6
  const OCEAN_RELIEF = 0.18 // the sea floor should barely register

  for (let r = 0; r < TH; r++) {
    const v = (r + 0.5) / TH
    const lat = (v - 0.5) * Math.PI
    const invCos = 1 / Math.max(0.30, Math.cos(lat))
    const dv = 1 / TH

    for (let x = 0; x < TW; x++) {
      const u = (x + 0.5) / TW
      const du = 1 / TW

      const h = sampleField(height, FW, FH, u, v)
      const hx0 = sampleField(height, FW, FH, u - du, v)
      const hx1 = sampleField(height, FW, FH, u + du, v)
      const hy0 = sampleField(height, FW, FH, u, Math.max(0, v - dv))
      const hy1 = sampleField(height, FW, FH, u, Math.min(1, v + dv))

      const relief = h > 0 ? LAND_RELIEF : OCEAN_RELIEF
      const dhdu = (hx1 - hx0) * 0.5 * relief * invCos
      const dhdv = (hy1 - hy0) * 0.5 * relief

      const nx = -dhdu * TW * 0.02
      const ny = -dhdv * TH * 0.02
      const inv = 1 / Math.sqrt(nx * nx + ny * ny + 1)

      const i = (r * TW + x) * 4
      out[i] = (nx * inv * 0.5 + 0.5) * 255
      out[i + 1] = (ny * inv * 0.5 + 0.5) * 255
      out[i + 2] = (inv * 0.5 + 0.5) * 255
      out[i + 3] = 255
    }
  }
}

/**
 * Night side. Cities are rejection-sampled against a likelihood built from
 * lowland land, a clustering noise field and a latitude weighting biased to the
 * northern hemisphere — which is roughly how the real Black Marble mosaic looks.
 */
function buildNightLights(height, urbanity, out) {
  const rand = mulberry32(2024)
  const ATTEMPTS = 1600000

  const latWeight = (lat) =>
    Math.exp(-((lat - 40) ** 2) / (2 * 26 ** 2)) +
    0.42 * Math.exp(-((lat + 26) ** 2) / (2 * 18 ** 2)) +
    0.30 * Math.exp(-((lat - 12) ** 2) / (2 * 14 ** 2))

  for (let a = 0; a < ATTEMPTS; a++) {
    const u = rand()
    // arcsin gives points uniform per unit *area*, not per unit row.
    const v = Math.asin(2 * rand() - 1) / Math.PI + 0.5
    const elev = sampleField(height, FW, FH, u, v)
    if (elev <= 0.004) continue

    const lat = v * 180 - 90
    if (Math.abs(lat) > 74) continue

    const cluster = sampleField(urbanity, FW, FH, u, v)
    const p =
      Math.pow(cluster, 3.0) * smoothstep(0.28, 0.03, elev) * latWeight(lat) * 1.5
    if (rand() > p) continue

    const cx = Math.floor(u * TW)
    const cy = Math.floor(v * TH)
    const big = rand() < 0.06
    const radius = big ? 2 + Math.floor(rand() * 3) : rand() < 0.35 ? 1 : 0
    // Sodium-vapour orange through mercury white, the way real cities read.
    const warm = rand()
    const cr = mix(1.0, 0.72, warm)
    const cg = mix(0.72, 0.80, warm)
    const cb = mix(0.34, 1.0, warm)
    const peak = (big ? 255 : 150 + rand() * 105) * (0.5 + 0.5 * cluster)

    for (let dy = -radius; dy <= radius; dy++) {
      const y = cy + dy
      if (y < 0 || y >= TH) continue
      for (let dx = -radius; dx <= radius; dx++) {
        const dist = Math.sqrt(dx * dx + dy * dy)
        if (dist > radius + 0.5) continue
        const fall = 1 / (1 + dist * dist * 1.6)
        const x = (((cx + dx) % TW) + TW) % TW
        const i = (y * TW + x) * 4
        out[i] = Math.min(255, out[i] + peak * cr * fall)
        out[i + 1] = Math.min(255, out[i + 1] + peak * cg * fall)
        out[i + 2] = Math.min(255, out[i + 2] + peak * cb * fall)
        out[i + 3] = 255
      }
    }
  }
  for (let i = 3; i < out.length; i += 4) out[i] = 255
}

/**
 * Cloud sheet, written to the alpha channel.
 *
 * The latitude weighting is the general circulation in miniature: a dense band
 * on the ITCZ at the equator, clear subtropics near +/-25 where the Hadley cells
 * subside, and the mid-latitude storm tracks around +/-52. Sampling at a much
 * higher frequency in Y than in X stretches the noise zonally, which is what
 * gives the banded, sheared look instead of a bag of cotton wool.
 */
function buildClouds(noise, warp, out) {
  const dirs = directionField(TW, TH)
  const d = [0, 0, 0]

  // The shear and regional-variation fields are deliberately low frequency
  // (1.15 and 2.2), so sampling them per output texel is pure waste. Build them
  // small and read back bilinearly, as with every other field here.
  const SW = 512
  const SH = 256
  const small = directionField(SW, SH)
  const shearX = new Float32Array(SW * SH)
  const shearY = new Float32Array(SW * SH)
  const regionalF = new Float32Array(SW * SH)
  for (let i = 0; i < SW * SH; i++) {
    const dx = small[i * 3]
    const dy = small[i * 3 + 1]
    const dz = small[i * 3 + 2]
    shearX[i] = warp.fbm(dx * 2.2, dy * 3.0, dz * 2.2, 3) * 0.55
    shearY[i] = warp.fbm(dx * 2.2 + 19, dy * 3.0, dz * 2.2, 3) * 0.16
    regionalF[i] = warp.fbm(dx * 1.15, dy * 1.15, dz * 1.15, 3)
  }

  const circulation = (lat) => {
    const a = Math.abs(lat)
    return (
      0.15 * Math.exp(-(a ** 2) / (2 * 11 ** 2)) - // ITCZ
      0.10 * Math.exp(-((a - 26) ** 2) / (2 * 13 ** 2)) + // subtropical high
      0.11 * Math.exp(-((a - 54) ** 2) / (2 * 15 ** 2)) - // storm track
      0.07 * smoothstep(74, 89, a)
    )
  }

  for (let r = 0; r < TH; r++) {
    const lat = ((r + 0.5) / TH) * 180 - 90
    const zonal = circulation(lat)
    const v = (r + 0.5) / TH

    for (let x = 0; x < TW; x++) {
      const i3 = (r * TW + x) * 3
      const dx = dirs[i3]
      const dy = dirs[i3 + 1]
      const dz = dirs[i3 + 2]
      const u = (x + 0.5) / TW

      // Break the zonal bands up longitudinally, or the planet reads as Jupiter.
      const regional = sampleField(regionalF, SW, SH, u, v)
      const bias = zonal * (0.45 + 0.95 * (regional * 0.5 + 0.5)) + regional * 0.085

      // Shear the sample longitudinally so systems curl into fronts.
      const sx = sampleField(shearX, SW, SH, u, v)
      const sy = sampleField(shearY, SW, SH, u, v)

      const n =
        noise.fbm((dx + sx) * 4.6, (dy + sy) * 7.0, (dz + sx) * 4.6, 6, 2.11, 0.55) * 0.5 + 0.5
      const wisp = noise.fbm(dx * 15, dy * 30, dz * 15, 3) * 0.5 + 0.5

      const cover = smoothstep(0.355, 0.70, n + bias) * mix(0.5, 1.0, wisp)
      const i = (r * TW + x) * 4
      const shade = 232 + 23 * wisp
      out[i] = shade
      out[i + 1] = shade
      out[i + 2] = 255
      out[i + 3] = clamp01(cover) * 255
    }
  }
}
