import {
  makeNoise,
  sampleField,
  directionField,
  clamp01,
  smoothstep,
  mix,
  mulberry32,
} from './noise.js'

/**
 * Procedural Luna: heavily cratered highlands, dark smooth maria, and bright
 * ejecta ray systems around the youngest large impacts.
 *
 * Craters are rasterised rather than evaluated per-pixel — each one only touches
 * the pixels inside its own bounding box, so ~11,000 of them cost less than one
 * full-surface noise pass.
 */

const W = 2048
const H = 1024
const SEED = 0x10ba

/**
 * Impact crater elevation profile, as a function of t = distance / radius.
 * Returns { excavate, deposit }: the floor is carved with a min() so overlapping
 * craters don't dig an ever-deeper pit, while rims and ejecta simply add.
 */
function craterProfile(t) {
  if (t < 1) {
    const bowl = -(1 - t * t)
    const rim = Math.exp(-(((t - 0.93) / 0.11) ** 2))
    return { excavate: bowl, deposit: rim * 0.55 }
  }
  if (t < 3.2) {
    return { excavate: 0, deposit: Math.exp(-(t - 1) * 2.4) * 0.5 }
  }
  return null
}

/** Stamp one crater into the height field. */
function stampCrater(height, dirs, lon0, lat0, radius, depth, rand) {
  const cd = [Math.cos(lat0) * Math.cos(lon0), Math.sin(lat0), Math.cos(lat0) * Math.sin(lon0)]
  const reach = radius * 3.2

  // Tangent basis at the crater centre, so the rim's azimuth can be read off as
  // a dot product instead of an atan2.
  const ex = [-Math.sin(lon0), 0, Math.cos(lon0)]
  const ey = [
    -Math.sin(lat0) * Math.cos(lon0),
    Math.cos(lat0),
    -Math.sin(lat0) * Math.sin(lon0),
  ]

  const r0 = Math.max(0, Math.floor(((lat0 - reach) / Math.PI + 0.5) * H))
  const r1 = Math.min(H - 1, Math.ceil(((lat0 + reach) / Math.PI + 0.5) * H))
  // Longitude spreads with 1/cos(lat); near the poles just sweep the whole row.
  const lonSpan = Math.abs(Math.cos(lat0)) < 0.08 ? Math.PI : Math.min(Math.PI, reach / Math.cos(lat0))
  const halfCols = Math.ceil((lonSpan / (2 * Math.PI)) * W) + 2
  const c0 = Math.floor(((lon0 + Math.PI) / (2 * Math.PI)) * W)

  // Sample the pre-impact surface once, so the floor is flat at the local level.
  const floorRef = height[Math.min(H - 1, Math.max(0, Math.floor(((lat0 / Math.PI) + 0.5) * H))) * W + ((c0 % W) + W) % W]
  // Real craters are slightly elliptical rather than scalloped, so first and
  // second azimuthal harmonics are both cheaper and more faithful than the
  // higher ones — and they need no trig at all here.
  const wobble = 0.035 + rand() * 0.055
  const w1 = rand() * 2 - 1
  const w2 = rand() * 2 - 1
  const w3 = rand() * 2 - 1
  const invRadius = 1 / radius

  for (let r = r0; r <= r1; r++) {
    const row = r * W
    for (let k = -halfCols; k <= halfCols; k++) {
      const x = (((c0 + k) % W) + W) % W
      const o = (row + x) * 3
      const dx = dirs[o]
      const dy = dirs[o + 1]
      const dz = dirs[o + 2]

      let cosAng = dx * cd[0] + dy * cd[1] + dz * cd[2]
      cosAng = cosAng > 1 ? 1 : cosAng < -1 ? -1 : cosAng
      // Chord approximation to the great-circle angle. Every crater here spans
      // well under half a radian, where this tracks acos to better than 1%.
      const ang = Math.sqrt(2 * (1 - cosAng))

      // Azimuth as (cos, sin) from the tangent basis — no atan2 needed.
      const px = dx - cd[0] * cosAng
      const py = dy - cd[1] * cosAng
      const pz = dz - cd[2] * cosAng
      const pl = Math.sqrt(px * px + py * py + pz * pz) || 1
      const ca = (px * ex[0] + py * ex[1] + pz * ex[2]) / pl
      const sa = (px * ey[0] + py * ey[1] + pz * ey[2]) / pl

      const t = ang * invRadius * (1 - wobble * (w1 * ca + w2 * sa + w3 * (2 * ca * ca - 1)))

      const prof = craterProfile(t)
      if (!prof) continue

      const i = r * W + x
      if (prof.excavate < 0) {
        const target = floorRef + prof.excavate * depth
        const blend = smoothstep(1.0, 0.86, t)
        height[i] = mix(height[i], Math.min(height[i], target), blend)
      }
      height[i] += prof.deposit * depth * 0.75
    }
  }
}

export function generateMoon(report = () => {}) {
  report('lunar highlands', 0.0)

  const terrain = makeNoise(SEED)
  const mariaN = makeNoise(SEED + 5)
  const albedoN = makeNoise(SEED + 11)
  const rayN = makeNoise(SEED + 17)
  const rand = mulberry32(SEED + 23)

  const dirs = directionField(W, H)
  const height = new Float32Array(W * H)
  const maria = new Float32Array(W * H)
  const d = [0, 0, 0]

  for (let r = 0; r < H; r++) {
    for (let x = 0; x < W; x++) {
      const i = r * W + x
      d[0] = dirs[i * 3]
      d[1] = dirs[i * 3 + 1]
      d[2] = dirs[i * 3 + 2]
      height[i] = terrain.fbm(d[0] * 2.4, d[1] * 2.4, d[2] * 2.4, 6) * 0.55

      // Maria are biased to one hemisphere, the way the real near/far side split
      // is — centred on 0° longitude, the middle of the map, as the NASA imagery
      // has it, so the generated Moon and the real one face Earth the same way.
      const facing = smoothstep(-0.35, 0.75, d[0])
      const basin = mariaN.fbm(d[0] * 1.35, d[1] * 1.35, d[2] * 1.35, 4) * 0.5 + 0.5
      maria[i] = clamp01(smoothstep(0.50, 0.68, basin) * facing)
    }
  }

  // Flood the basins: maria are flat, low-lying basalt.
  for (let i = 0; i < height.length; i++) {
    const m = maria[i]
    if (m > 0) height[i] = mix(height[i], -0.30 + height[i] * 0.10, m)
  }

  report('impact cratering', 0.22)
  const POPULATIONS = [
    { count: 34, min: 0.045, max: 0.125 },
    { count: 260, min: 0.014, max: 0.045 },
    { count: 1900, min: 0.0042, max: 0.014 },
    { count: 9000, min: 0.0013, max: 0.0042 },
  ]
  const rays = []
  for (const pop of POPULATIONS) {
    for (let n = 0; n < pop.count; n++) {
      const lon = rand() * Math.PI * 2 - Math.PI
      const lat = Math.asin(2 * rand() - 1)
      // Power law: small craters vastly outnumber large ones within each band too.
      const radius = mix(pop.min, pop.max, Math.pow(rand(), 2.2))
      // Maria are younger, so they are far less cratered.
      const onMaria = sampleField(maria, W, H, (lon + Math.PI) / (2 * Math.PI), lat / Math.PI + 0.5)
      if (onMaria > 0.45 && rand() < 0.78) continue

      const depth = radius * 3.1 * mix(0.7, 1.25, rand())
      stampCrater(height, dirs, lon, lat, radius, depth, rand)
      if (radius > 0.075 && rays.length < 9) {
        rays.push({
          lon,
          lat,
          radius,
          dir: [Math.cos(lat) * Math.cos(lon), Math.sin(lat), Math.cos(lat) * Math.sin(lon)],
          cosReach: Math.cos(Math.min(Math.PI, radius * 16)),
        })
      }
    }
  }

  report('lunar surface', 0.55)
  const color = new Uint8Array(W * H * 4)
  const normal = new Uint8Array(W * H * 4)

  // Ray systems vary slowly across the surface, so their combined contribution
  // is built on a coarse grid and read back bilinearly. Evaluating nine
  // great-circle distances per output texel was the single biggest cost here.
  const RW = 512
  const RH = 256
  const rayDirs = directionField(RW, RH)
  const rayField = new Float32Array(RW * RH)
  for (let i = 0; i < RW * RH; i++) {
    const dx = rayDirs[i * 3]
    const dy = rayDirs[i * 3 + 1]
    const dz = rayDirs[i * 3 + 2]
    let sum = 0
    for (const ray of rays) {
      const cd = ray.dir
      let ca = dx * cd[0] + dy * cd[1] + dz * cd[2]
      if (ca < ray.cosReach) continue
      ca = ca > 1 ? 1 : ca < -1 ? -1 : ca
      const t = Math.acos(ca) / ray.radius
      if (t < 1.5) continue

      const ex = [-Math.sin(ray.lon), 0, Math.cos(ray.lon)]
      const ey = [
        -Math.sin(ray.lat) * Math.cos(ray.lon),
        Math.cos(ray.lat),
        -Math.sin(ray.lat) * Math.sin(ray.lon),
      ]
      const az = Math.atan2(dx * ey[0] + dy * ey[1] + dz * ey[2], dx * ex[0] + dy * ex[1] + dz * ex[2])
      const streak = Math.pow(
        clamp01(rayN.fbm(Math.cos(az) * 6, Math.sin(az) * 6, ray.lon * 3, 3) * 0.5 + 0.5),
        4.5,
      )
      sum += streak * Math.exp(-(t - 1.5) * 0.30) * 0.55
    }
    rayField[i] = sum
  }

  for (let r = 0; r < H; r++) {
    for (let x = 0; x < W; x++) {
      const i = r * W + x
      const o = i * 4
      d[0] = dirs[i * 3]
      d[1] = dirs[i * 3 + 1]
      d[2] = dirs[i * 3 + 2]

      const m = maria[i]
      const grain = albedoN.fbm(d[0] * 22, d[1] * 22, d[2] * 22, 3) * 0.5 + 0.5

      // Highlands anorthosite is bright and slightly warm; mare basalt is dark
      // and slightly cool. The real contrast is about 2:1 in albedo.
      let lum = mix(0.62, 0.26, m)
      lum *= 0.86 + 0.28 * grain
      // Fresh rims expose bright unweathered regolith; floors collect dark dust.
      lum += smoothstep(0.0, 0.35, height[i]) * 0.16
      lum -= smoothstep(-0.05, -0.5, height[i]) * 0.13

      // Ejecta ray systems from the youngest big impacts.
      lum += sampleField(rayField, RW, RH, (x + 0.5) / W, (r + 0.5) / H)

      const c = clamp01(lum)
      color[o] = c * 255 * 1.0
      color[o + 1] = c * 255 * 0.985
      color[o + 2] = c * 255 * 0.95
      color[o + 3] = 255
    }
  }

  // Normals straight from the crater field — this is what sells the relief at
  // grazing sun angles near the terminator.
  const RELIEF = 30
  for (let r = 0; r < H; r++) {
    const lat = ((r + 0.5) / H - 0.5) * Math.PI
    const invCos = 1 / Math.max(0.3, Math.cos(lat))
    for (let x = 0; x < W; x++) {
      const xm = (x - 1 + W) % W
      const xp = (x + 1) % W
      const rm = Math.max(0, r - 1)
      const rp = Math.min(H - 1, r + 1)

      const nx = -(height[r * W + xp] - height[r * W + xm]) * 0.5 * RELIEF * invCos
      const ny = -(height[rp * W + x] - height[rm * W + x]) * 0.5 * RELIEF
      const inv = 1 / Math.sqrt(nx * nx + ny * ny + 1)

      const o = (r * W + x) * 4
      normal[o] = (nx * inv * 0.5 + 0.5) * 255
      normal[o + 1] = (ny * inv * 0.5 + 0.5) * 255
      normal[o + 2] = (inv * 0.5 + 0.5) * 255
      normal[o + 3] = 255
    }
  }

  return {
    color: { data: color, width: W, height: H },
    normal: { data: normal, width: W, height: H },
  }
}
