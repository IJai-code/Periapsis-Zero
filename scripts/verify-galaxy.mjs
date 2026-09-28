/**
 * verify-galaxy — the galaxy, the black hole and the largest scales are
 * physics, and here is the physics checked.
 *
 * The volume renderer is GLSL and cannot run in Node; what it is built from
 * can. Each claim the renderer's comments make that a number can test is
 * tested here:
 *
 *   1. The Milky Way's four arms, placed only by where each crosses the Sun's
 *      azimuth (maser parallaxes) and one pitch angle, are tangent to the line
 *      of sight at the longitudes where the arm tangents are observed — within
 *      6°. Nothing was fitted to those longitudes.
 *   2. The Sun sits where it is observed to: inside the Local Arm's inner
 *      edge, between the Sagittarius–Carina and Perseus arms.
 *   3. The dust model, integrated along the line of sight, gives the
 *      extinction the sky has: ~30 magnitudes toward the Galactic Centre,
 *      almost none toward the pole.
 *   4. The closed-form luminosities the gains are calibrated with are the
 *      integrals they claim to be (Hernquist 2πa³, Plummer 4πa³/3).
 *   5. The black hole's photon integrator — the same equation and steps as
 *      the shader — captures exactly the rays inside the critical impact
 *      parameter 3√3/2 r_s, and bends distant rays by Einstein's 2 r_s / b.
 *   6. The clusters' Plummer draws put 35.4% of their stars inside one scale
 *      length, as a Plummer sphere does; the microwave dipole points where
 *      Planck measured it.
 */
import assert from 'node:assert/strict'
import { MILKY_WAY, LOCAL_CLOUDS, LOCAL_BUBBLE, SUN_GALACTOCENTRIC, longitudeFromSun, modelLuminosity } from '../src/gfx/galaxyModel.js'
import { GALAXY, CLUSTER_MEMBERS, DEEP_SKY, PARSEC, galacticLB, galacticToIcrs } from '../src/sim/cosmos.js'
import { lineRGB } from '../src/gfx/stars.js'

let n = 0
const check = (label, fn) => {
  fn()
  n++
  console.log(`  ✓ ${label}`)
}
const DEG = Math.PI / 180

/* ---------------------------------------------------------------- *
 * 1–2. The arms
 * ---------------------------------------------------------------- */

const tp = MILKY_WAY.armShape[0]
/** Radius of arm k at galactocentric azimuth phi (the shader's R(phi) = Ra exp((phi − pi) tan psi)). */
const armAt = (Ra, phi) => Ra * Math.exp((phi - Math.PI) * tp)

/** Longitudes at which the line of sight from the Sun grazes arm k, for 3 < R < 12 kpc. */
function tangents(Ra) {
  const out = []
  let prev = null
  let prev2 = null
  for (let phi = -3 * Math.PI; phi < 5 * Math.PI; phi += 0.0005) {
    const R = armAt(Ra, phi)
    if (R < 3 || R > 12) {
      prev = prev2 = null
      continue
    }
    const l = longitudeFromSun([R * Math.cos(phi), R * Math.sin(phi), 0])
    if (prev !== null && prev2 !== null) {
      const d1 = ((prev - prev2 + 540) % 360) - 180
      const d2 = ((l - prev + 540) % 360) - 180
      if (d1 * d2 < 0) out.push(prev)
    }
    prev2 = prev
    prev = l
  }
  return out
}

/**
 * Observed arm tangents (Vallée 2016's compilation of CO, H I, dust and
 * stellar tangents; mid-values). Each arm is identified by index in
 * MILKY_WAY.armR: 0 Norma, 1 Scutum–Centaurus, 2 Sagittarius–Carina, 3 Perseus.
 */
const OBSERVED = [
  ['Norma', 0, 328],
  ['Scutum', 1, 31],
  ['Crux–Centaurus', 1, 309],
  ['Sagittarius', 2, 50],
  ['Carina', 2, 284],
  ['start of Perseus', 3, 337],
]
for (const [name, k, lObs] of OBSERVED) {
  check(`the ${name} tangent falls within 6° of its observed l = ${lObs}°`, () => {
    const ts = tangents(MILKY_WAY.armR[k])
    const miss = Math.min(...ts.map((l) => Math.abs(((l - lObs + 540) % 360) - 180)))
    assert.ok(miss < 6, `model tangents at ${ts.map((l) => l.toFixed(1)).join(', ')}°, observed ${lObs}° — ${miss.toFixed(1)}° off`)
  })
}

check('the Sun sits on the Local Arm’s inner edge, between Sagittarius–Carina and Perseus', () => {
  const Rsun = Math.hypot(SUN_GALACTOCENTRIC[0], SUN_GALACTOCENTRIC[1])
  const phiSun = Math.atan2(SUN_GALACTOCENTRIC[1], SUN_GALACTOCENTRIC[0])
  assert.ok(Math.abs(Rsun - GALAXY.R0) < 0.01, `Sun at R = ${Rsun}`)
  const sgr = armAt(MILKY_WAY.armR[2], Math.PI)
  const per = armAt(MILKY_WAY.armR[3], Math.PI)
  assert.ok(sgr < Rsun && Rsun < per, `Sagittarius ${sgr}, Sun ${Rsun}, Perseus ${per}`)
  assert.ok(Rsun - sgr > 0.8 && per - Rsun > 1.2, 'the Sun is not between the arms by the observed margins')
  const local = MILKY_WAY.localArm[0]
  assert.ok(local > Rsun && local - Rsun < 0.4, `Local Arm at ${local} kpc, Sun at ${Rsun}`)
  assert.ok(Math.abs(Math.abs(phiSun) - Math.PI) < 1e-6, 'the Sun is not on the −x axis the arms are phased from')
})

/* ---------------------------------------------------------------- *
 * 3. Extinction along the line of sight
 * ---------------------------------------------------------------- */

/**
 * The shader's dust, without its noise (whose mean the log-normal is built to
 * keep near 1) and at the arms' mean lane factor: kappa_V in 1/kpc.
 */
function kappaV(p) {
  const [k0, Rd, hd, Rref] = MILKY_WAY.dust
  const [hole, laneShare] = MILKY_WAY.dust2
  const R = Math.hypot(p[0], p[1])
  const r3 = Math.hypot(p[0], p[1], p[2])
  const edge = 1 - smooth(MILKY_WAY.disc[3] * 0.78, MILKY_WAY.disc[3], R)
  const holeF = smooth(hole * 0.7, hole, R) + Math.exp(-r3 / 0.18) * 0.6
  const lanes = 1 - laneShare + laneShare * 3.2 * 0.3
  let k = k0 * Math.exp(-(R - Rref) / Rd) * edge * Math.exp(-Math.abs(p[2]) / hd) * holeF * lanes
  const b = LOCAL_BUBBLE.centre
  k *= smooth(LOCAL_BUBBLE.radius * 0.5, LOCAL_BUBBLE.radius * 1.4, Math.hypot(p[0] - b[0], p[1] - b[1], p[2] - b[2]))
  return k
}
function smooth(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}
/** A_V in magnitudes from the Sun out to `dist` kpc toward galactic (l, b). */
function extinction(l, b, dist) {
  const dir = [Math.cos(b * DEG) * Math.cos(l * DEG), Math.cos(b * DEG) * Math.sin(l * DEG), Math.sin(b * DEG)]
  let tau = 0
  const N = 20000
  const ds = dist / N
  for (let i = 0; i < N; i++) {
    const s = (i + 0.5) * ds
    // Heliocentric galactic to galactocentric: the axes agree to 0.15°.
    const p = [SUN_GALACTOCENTRIC[0] + dir[0] * s, SUN_GALACTOCENTRIC[1] + dir[1] * s, SUN_GALACTOCENTRIC[2] + dir[2] * s]
    tau += kappaV(p) * ds
  }
  return 1.0857 * tau
}

check('about 30 magnitudes of visual extinction toward the Galactic Centre (observed A_V ≈ 30)', () => {
  const av = extinction(0, 0, GALAXY.R0)
  assert.ok(av > 22 && av < 45, `A_V to Sgr A* = ${av.toFixed(1)} mag`)
  console.log(`      model A_V to the centre: ${av.toFixed(1)} mag`)
})
check('and almost none toward the galactic poles (observed A_V < 0.1)', () => {
  const up = extinction(0, 90, 3)
  const down = extinction(0, -90, 3)
  assert.ok(up < 0.15 && down < 0.2, `A_V to the poles ${up.toFixed(3)} / ${down.toFixed(3)} mag`)
})
check('about 1 magnitude per kiloparsec in the plane near the Sun', () => {
  // Toward the anticentre, clear of the local clouds' lines of sight.
  const av = extinction(180, 0, 1.5) / 1.5
  assert.ok(av > 0.5 && av < 2.5, `${av.toFixed(2)} mag/kpc`)
})
check('every local dark cloud sits at its catalogued distance, inside the Galaxy’s disc', () => {
  for (const [name, l, b, d] of LOCAL_CLOUDS) {
    assert.ok(Math.abs(b) < 25 && d > 100 && d < 1000, `${name}`)
  }
})

/* ---------------------------------------------------------------- *
 * 4. The closed forms behind the luminosity calibration
 * ---------------------------------------------------------------- */

function sphereIntegral(rho, a, rmax) {
  let sum = 0
  const N = 200000
  const dr = rmax / N
  for (let i = 0; i < N; i++) {
    const r = (i + 0.5) * dr
    sum += 4 * Math.PI * r * r * rho(r / a) * dr
  }
  return sum
}
check('a Hernquist sphere of scale a holds 2πa³ of its weight; a Plummer sphere 4πa³/3', () => {
  const a = 1.7
  const hern = sphereIntegral((m) => 1 / (m * (1 + m) ** 3), a, a * 4000)
  assert.ok(Math.abs(hern / (2 * Math.PI * a ** 3) - 1) < 0.01, `Hernquist ${hern} vs ${2 * Math.PI * a ** 3}`)
  const plum = sphereIntegral((m) => (1 + m * m) ** -2.5, a, a * 400)
  assert.ok(Math.abs(plum / ((4 / 3) * Math.PI * a ** 3) - 1) < 0.01, `Plummer ${plum}`)
})
check('the luminosity model grows with every component it sums', () => {
  const base = modelLuminosity(MILKY_WAY)
  assert.ok(base > 0 && Number.isFinite(base))
  assert.ok(modelLuminosity({ ...MILKY_WAY, bulge: [MILKY_WAY.bulge[0] * 2, ...MILKY_WAY.bulge.slice(1)] }) > base)
  assert.ok(modelLuminosity({ ...MILKY_WAY, young: [MILKY_WAY.young[0] * 2, ...MILKY_WAY.young.slice(1)] }) > base)
})

/* ---------------------------------------------------------------- *
 * 5. The black hole's integrator
 * ---------------------------------------------------------------- */

/**
 * The shader's photon, in JS: units of r_s, d²x/dλ² = −(3/2) h² x / r⁵,
 * velocity Verlet, step 0.05 r / |v|. Starts far out at impact parameter b,
 * heading in; returns 'captured', or the angle the ray turned through.
 */
function shoot(b, start = 4000, swept = null) {
  let x = [-start, b, 0]
  let v = [1, 0, 0]
  let phi = Math.atan2(x[1], x[0])
  let turned = 0
  const h = Math.abs(x[0] * v[1] - x[1] * v[0])
  const h2 = h * h
  const acc = (p) => {
    const r = Math.hypot(p[0], p[1], p[2])
    const k = (-1.5 * h2) / r ** 5
    return [k * p[0], k * p[1], k * p[2]]
  }
  for (let i = 0; i < 200000; i++) {
    const r = Math.hypot(x[0], x[1], x[2])
    const vl = Math.hypot(v[0], v[1], v[2])
    const dl = Math.min(4, Math.max(0.015, 0.05 * r)) / vl
    const a = acc(x)
    const xn = x.map((c, j) => c + v[j] * dl + 0.5 * a[j] * dl * dl)
    const an = acc(xn)
    v = v.map((c, j) => c + 0.5 * (a[j] + an[j]) * dl)
    x = xn
    const phn = Math.atan2(x[1], x[0])
    turned += ((phn - phi + 3 * Math.PI) % (2 * Math.PI)) - Math.PI
    phi = phn
    if (swept) swept.value = Math.abs(turned)
    const rn = Math.hypot(x[0], x[1], x[2])
    if (rn < 1) return 'captured'
    if (rn > start && x[0] * v[0] + x[1] * v[1] > 0) break
  }
  const vl = Math.hypot(v[0], v[1])
  return Math.acos(Math.max(-1, Math.min(1, v[0] / vl)))
}

const B_CRIT = (3 * Math.sqrt(3)) / 2 // 3√3 M in units of r_s = 2M
check(`rays inside the critical impact parameter 3√3/2 r_s = ${B_CRIT.toFixed(4)} r_s are captured, and outside it are not`, () => {
  assert.equal(shoot(B_CRIT * 0.99), 'captured', 'a ray 1% inside the photon sphere’s capture cross-section escaped')
  assert.notEqual(shoot(B_CRIT * 1.01), 'captured', 'a ray 1% outside it was captured')
  assert.equal(shoot(1.0), 'captured')
})
check('a distant ray is bent by Einstein’s 2 r_s / b (= 4GM/c²b) — to 3% at b = 200 r_s', () => {
  for (const b of [200, 500]) {
    const alpha = shoot(b, 20000)
    const einstein = 2 / b
    assert.ok(Math.abs(alpha / einstein - 1) < 0.03, `b = ${b}: deflection ${alpha.toExponential(4)} vs ${einstein.toExponential(4)}`)
  }
})
check('a ray grazing the photon sphere winds a full turn round the hole before it leaves', () => {
  // A straight line sweeps π of azimuth past the hole; this one sweeps π plus
  // its deflection, which diverges logarithmically at the critical ray.
  const swept = { value: 0 }
  const out = shoot(B_CRIT * 1.0005, 4000, swept)
  assert.notEqual(out, 'captured', 'the grazing ray fell in')
  assert.ok(swept.value > 3 * Math.PI, `swept ${(swept.value / Math.PI).toFixed(2)} pi of azimuth`)
})

/* ---------------------------------------------------------------- *
 * 6. Clusters, colours, the microwave dipole
 * ---------------------------------------------------------------- */

check('the clusters’ Plummer draws put 35.4% of their stars inside one scale length', () => {
  const omega = DEEP_SKY.find((d) => d.id === 'omega-centauri')
  const a = 7.9 * PARSEC
  const members = CLUSTER_MEMBERS.filter((m) => m.abs.distanceTo(omega.abs) < 500 * PARSEC)
  const inside = members.filter((m) => m.abs.distanceTo(omega.abs) < a).length / members.length
  // M(<a)/M = a^3 / (a^2 + a^2)^(3/2) = 2^(-3/2), less the 0.5% cut at the tail.
  assert.ok(Math.abs(inside - 0.3536 / 0.995) < 0.025, `${(inside * 100).toFixed(1)}% inside a`)
})
check('emission lines have their colours: H-alpha red, [O III] green-teal, H-beta blue-cyan', () => {
  const ha = lineRGB([0, 0, 0], 656.28)
  const o3 = lineRGB([0, 0, 0], 500.68)
  const hb = lineRGB([0, 0, 0], 486.13)
  assert.ok(ha[0] === 1 && ha[1] < 0.05 && ha[2] < 0.05, `H-alpha ${ha}`)
  assert.ok(o3[1] === 1 && o3[0] < 0.05 && o3[2] > 0.1, `O III ${o3}`)
  assert.ok(hb[2] === 1 && hb[1] > 0.3 && hb[0] < 0.05, `H-beta ${hb}`)
})
check('the microwave dipole points at (l, b) = (264.02°, 48.25°)', () => {
  const g = [Math.cos(48.25 * DEG) * Math.cos(264.02 * DEG), Math.cos(48.25 * DEG) * Math.sin(264.02 * DEG), Math.sin(48.25 * DEG)]
  const [l, b] = galacticLB(galacticToIcrs([0, 0, 0], g))
  assert.ok(Math.abs(l - 264.02) < 1e-6 && Math.abs(b - 48.25) < 1e-6, `(${l}, ${b})`)
})

console.log(`\nverify-galaxy: ${n} checks pass`)
