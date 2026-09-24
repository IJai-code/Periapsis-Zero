import { BETA_MIE, BETA_RAYLEIGH, MIE_G } from './atmosphereShader.js'
import { MAGNITUDE_LIMIT } from './stars.js'

/**
 * How bright the sky is over the camera, and which stars that hides.
 *
 * The starfield is drawn for space: a hundred thousand catalogue stars down to
 * eleventh magnitude and the Milky Way behind them, at the brightness a
 * dark-adapted eye would report. That is right from orbit and from the Moon,
 * and it is what made the ground view read as dusk at mid-morning — stars
 * scattered across a blue sky, because nothing told them the sky had become
 * bright. The atmosphere shell adds its light over them; it cannot take theirs
 * away.
 *
 * What hides stars in daylight is not the air in front of them — a clear sky
 * transmits most of their light — but the air *lit up* around them: an eye
 * adapted to a sky that bright cannot find a point that faint against it. So
 * the rule is the one observers use, from the sky's surface brightness to the
 * faintest star visible against it:
 *
 *   NELM = 7.93 − 5 log₁₀(10^(4.316 − B/5) + 1)
 *
 * with B in magnitudes per square arcsecond — the relation sky-quality meters
 * are read with, after Schaefer's visibility model. At a dark site's 21.7 it
 * gives 6.4, the textbook naked-eye limit; under a daytime sky near 5 it gives
 * about −9, fainter than nothing in the catalogue, so every star goes.
 *
 * B comes from the same single-scattering integral the shell is drawn with,
 * marched here on the CPU up the camera's own vertical: the radiance of the
 * zenith sky per unit of sunlight, times the Sun's illuminance, is a luminance,
 * and a luminance converts to magnitudes per square arcsecond through
 * 1 cd/m² = 12.58. Plus the glow the night sky has with no Sun at all —
 * airglow, zodiacal light, the unresolved galaxy — because without it a
 * midnight sky would be infinitely dark and the limit would run off the end of
 * the catalogue.
 *
 * The march is a line-for-line copy of `atmosphereShader.js`'s, from its own
 * exported constants and the very sample positions the shader is handed that
 * frame, so the sky a star is judged against is the sky that is drawn.
 *
 * From above the real atmosphere nothing here applies: there is no air over
 * the camera, the sky is black whatever the Sun is doing, and the stars are
 * drawn exactly as they always were. Between the ground and 100 km the limit
 * eases from the one to the other with the atmosphere's own blend.
 */

/*
 * Module-local copies of everything the per-frame path reads. V8 folds a local
 * const into the function that uses it; a read of another module's export it
 * will not fold, and `gfx/sunlight.js` measured the difference at 16 bytes a
 * call.
 */
const BR0 = BETA_RAYLEIGH.x
const BR1 = BETA_RAYLEIGH.y
const BR2 = BETA_RAYLEIGH.z
const BM = BETA_MIE
const G = MIE_G
const PI = Math.PI

/** Solar illuminance above the atmosphere at 1 AU, lux (Darula, Kittler & Gueymard 2005). */
const SOLAR_LUX = 133.8e3

/** Luminance of a surface of 0 mag/arcsec², cd/m² — so 1 cd/m² is 12.58. */
const ZERO_MAG_NITS = 108e3

/** A dark site's zenith with no Sun, mag/arcsec²: airglow, zodiacal light, the unresolved galaxy. */
const NIGHT_SKY = 21.7
const NIGHT_NITS = ZERO_MAG_NITS * Math.pow(10, -0.4 * NIGHT_SKY)

/**
 * The Milky Way's own brightness, as the sky passes it. The Bortle scale puts
 * it gone from a sky brighter than about 19.5 mag/arcsec² and fully there,
 * structured, darker than about 21.5 — so it fades across that range rather
 * than by a threshold picked to look right.
 */
const MILKY_WAY_GONE = 19.5
const MILKY_WAY_FULL = 21.5

/** The faintest catalogue star plus one magnitude: a limit that hides nothing. */
const NO_LIMIT = MAGNITUDE_LIMIT + 1

/**
 * What the sky over the camera is hiding, rewritten each frame by
 * `measureSky`. `limitFlux` is in the starfield's own units — 10^(−0.4 m), so
 * magnitude zero is 1 — and `milkyWay` multiplies the backdrop.
 */
export const daySky = {
  /** Luminance of the zenith sky over the camera, cd/m². */
  zenith: 0.5,
  /** The same, as a surface brightness, mag/arcsec². */
  brightness: 99.5,
  /** Faintest magnitude visible against it. */
  limitMagnitude: NO_LIMIT + 0.5,
  limitFlux: Math.pow(10, -0.4 * (NO_LIMIT + 0.5)),
  milkyWay: 0.5,
}
daySky.limitMagnitude = NO_LIMIT
daySky.limitFlux = Math.pow(10, -0.4 * NO_LIMIT)
daySky.milkyWay = 1

/**
 * Luminance of sunlit ground the eye is adapted to where there is no air to
 * brighten the sky, cd/m² — the lunar surface, written by LunarSurface.jsx.
 *
 * The Moon's sky is black at noon, and still nobody on its sunlit surface saw
 * stars: every Apollo crew said so, and every surface photograph agrees. What
 * hides them is not the sky but the ground, 1,600 cd/m² of it at Tranquility's
 * liftoff sun, filling half the view — the eye, or a camera exposed for the
 * scene, is adapted to that. So where the air is gone, this stands in for the
 * sky's luminance in the same visibility law, and a black sky over lit
 * regolith hides the catalogue — the Milky Way with it — for the same reason a
 * blue one does. A slot, not an argument, for the boxing reason above.
 */
export const groundGlare = new Float64Array(1)

/*
 * The march's inputs and outputs, in one preallocated array rather than as
 * arguments: a double handed to a function V8 does not inline is boxed at the
 * call, and this one is far too large to inline.
 *
 *   0–2 ray origin, planet radii   3–5 direction   6–8 Sun direction
 *   9 Rayleigh scale height   10 Mie scale height   11 top
 *   13–15 radiance per unit solar irradiance, per steradian, R G B
 *
 * And the shader's own sample positions, by reference: the four arrays it is
 * handed, as fractions of each ray's span. References, so reading them
 * allocates nothing.
 */
const io = new Float64Array(16)
let viewMid = null
let viewSeg = null
let lightMid = null
let lightSeg = null

function march() {
  const rox = io[0]
  const roy = io[1]
  const roz = io[2]
  const rdx = io[3]
  const rdy = io[4]
  const rdz = io[5]
  const sx = io[6]
  const sy = io[7]
  const sz = io[8]
  const hr = io[9]
  const hm = io[10]
  const top = io[11]
  const VS = viewMid.length
  const LS = lightMid.length
  io[13] = 0
  io[14] = 0
  io[15] = 0

  // The shell, then the ground: both as the shader's raySphere.
  const b = rox * rdx + roy * rdy + roz * rdz
  const rr = rox * rox + roy * roy + roz * roz
  let d = b * b - (rr - top * top)
  if (d < 0) return
  d = Math.sqrt(d)
  const a0 = -b - d
  const a1 = -b + d
  if (a1 <= 0 || a0 > a1) return
  const tStart = a0 > 0 ? a0 : 0
  let tEnd = a1
  const dg = b * b - (rr - 1)
  if (dg >= 0) {
    const sg = Math.sqrt(dg)
    const g0 = -b - sg
    const g1 = -b + sg
    if (g0 > 0 && g0 < g1 && g0 < tEnd) tEnd = g0
  }
  if (tEnd <= tStart) return
  const span = tEnd - tStart

  let sr0 = 0
  let sr1 = 0
  let sr2 = 0
  let sm0 = 0
  let sm1 = 0
  let sm2 = 0
  let odR = 0
  let odM = 0
  for (let i = 0; i < VS; i++) {
    const segment = viewSeg[i] * span
    const t = tStart + viewMid[i] * span
    const px = rox + rdx * t
    const py = roy + rdy * t
    const pz = roz + rdz * t
    const h = Math.sqrt(px * px + py * py + pz * pz) - 1
    const dR = Math.exp(-h / hr) * segment
    const dM = Math.exp(-h / hm) * segment
    odR += dR
    odM += dM

    const lb = px * sx + py * sy + pz * sz
    const ld = lb * lb - (px * px + py * py + pz * pz - top * top)
    const far = ld < 0 ? -1 : -lb + Math.sqrt(ld)
    let odLR = 0
    let odLM = 0
    let blocked = false
    for (let j = 0; j < LS; j++) {
      const lSeg = lightSeg[j] * far
      const lt = lightMid[j] * far
      const qx = px + sx * lt
      const qy = py + sy * lt
      const qz = pz + sz * lt
      const lh = Math.sqrt(qx * qx + qy * qy + qz * qz) - 1
      if (lh < 0) {
        blocked = true
        break
      }
      odLR += Math.exp(-lh / hr) * lSeg
      odLM += Math.exp(-lh / hm) * lSeg
    }
    if (!blocked) {
      const k = odR + odLR
      const m = BM * 1.1 * (odM + odLM)
      const t0 = Math.exp(-(BR0 * k + m))
      const t1 = Math.exp(-(BR1 * k + m))
      const t2 = Math.exp(-(BR2 * k + m))
      sr0 += t0 * dR
      sr1 += t1 * dR
      sr2 += t2 * dR
      sm0 += t0 * dM
      sm1 += t1 * dM
      sm2 += t2 * dM
    }
  }

  const mu = rdx * sx + rdy * sy + rdz * sz
  const mu2 = mu * mu
  const g2 = G * G
  const phR = (3 / (16 * PI)) * (1 + mu2)
  const q = 1 + g2 - 2 * G * mu
  const phM = ((3 / (8 * PI)) * ((1 - g2) * (1 + mu2))) / ((2 + g2) * Math.pow(q > 1e-4 ? q : 1e-4, 1.5))
  io[13] = sr0 * BR0 * phR + sm0 * BM * phM
  io[14] = sr1 * BR1 * phR + sm1 * BM * phM
  io[15] = sr2 * BR2 * phR + sm2 * BM * phM
}

function loadUniforms(u) {
  io[9] = u.uHr.value
  io[10] = u.uHm.value
  io[11] = u.uAtmosRadius.value
  viewMid = u.uViewMid.value
  viewSeg = u.uViewSeg.value
  lightMid = u.uLightMid.value
  lightSeg = u.uLightSeg.value
}

/**
 * The sky's radiance along any ray, per unit of solar irradiance, per
 * steradian — what the shader draws there, divided by its `uIntensity`. For
 * gates: this takes arrays and is not on the frame path.
 */
export function skyRadiance(out, origin, direction, sun, material) {
  io[0] = origin[0]
  io[1] = origin[1]
  io[2] = origin[2]
  io[3] = direction[0]
  io[4] = direction[1]
  io[5] = direction[2]
  io[6] = sun[0]
  io[7] = sun[1]
  io[8] = sun[2]
  loadUniforms(material.uniforms)
  march()
  out[0] = io[13]
  out[1] = io[14]
  out[2] = io[15]
  return out
}

/**
 * Work out the sky over the camera and what it hides. Call after
 * `stretchAtmosphere`, whose uniforms it reads — the camera, the Sun, the
 * stretch — so it judges the stars against the sky actually being drawn.
 * Allocation-free.
 */
export function measureSky(material) {
  const u = material.uniforms
  const near = u.uNear.value
  if (!(near > 0)) {
    // No air over the camera: a black sky, and the whole catalogue unless the
    // eye is adapted to lit ground — see groundGlare.
    daySky.zenith = 0
    daySky.brightness = 99
    const glare = groundGlare[0]
    if (glare > NIGHT_NITS) {
      const B = -2.5 * Math.log10(glare / ZERO_MAG_NITS)
      const nelm = 7.93 - 5 * Math.log10(Math.pow(10, 4.316 - B / 5) + 1)
      const limit = nelm < NO_LIMIT ? nelm : NO_LIMIT
      let w = (B - MILKY_WAY_GONE) / (MILKY_WAY_FULL - MILKY_WAY_GONE)
      w = w > 0 ? (w < 1 ? w : 1) : 0
      daySky.limitMagnitude = limit
      daySky.limitFlux = Math.pow(10, -0.4 * limit)
      daySky.milkyWay = w * w * (3 - 2 * w)
      return
    }
    daySky.limitMagnitude = NO_LIMIT
    daySky.limitFlux = Math.pow(10, -0.4 * NO_LIMIT)
    daySky.milkyWay = 1
    return
  }
  const c = u.uCamToPlanet.value
  const s = u.uSunDir.value
  const r = Math.sqrt(c.x * c.x + c.y * c.y + c.z * c.z)
  io[0] = c.x
  io[1] = c.y
  io[2] = c.z
  io[3] = c.x / r
  io[4] = c.y / r
  io[5] = c.z / r
  io[6] = s.x
  io[7] = s.y
  io[8] = s.z
  loadUniforms(u)
  march()

  // Photopic luminance from the three channels, then surface brightness.
  const nits = SOLAR_LUX * (0.2126 * io[13] + 0.7152 * io[14] + 0.0722 * io[15]) + near * NIGHT_NITS
  const B = -2.5 * Math.log10(nits / ZERO_MAG_NITS)
  const nelm = 7.93 - 5 * Math.log10(Math.pow(10, 4.316 - B / 5) + 1)
  const ground = nelm < NO_LIMIT ? nelm : NO_LIMIT
  // Eased toward space's limit with the atmosphere's own blend.
  const limit = NO_LIMIT + near * (ground - NO_LIMIT)
  let w = (B - MILKY_WAY_GONE) / (MILKY_WAY_FULL - MILKY_WAY_GONE)
  w = w > 0 ? (w < 1 ? w : 1) : 0
  const band = w * w * (3 - 2 * w)

  daySky.zenith = nits
  daySky.brightness = B
  daySky.limitMagnitude = limit
  daySky.limitFlux = Math.pow(10, -0.4 * limit)
  daySky.milkyWay = 1 + near * (band - 1)
}
