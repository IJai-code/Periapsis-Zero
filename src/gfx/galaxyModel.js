import * as THREE from 'three'
import { GALAXY_GLSL } from './glsl/galaxy.js'
import { blackbodyRGB } from './stars.js'
import { GALAXY, icrsToGalactic, toGalactocentric } from '../sim/cosmos.js'

/**
 * The numbers behind every galaxy the volume renderer draws.
 *
 * The Milky Way's are measurements taken from inside it; the others' come
 * from each galaxy's own photometry and are mapped onto the same model. What
 * is *not* measured is said so where it is set: which knot of star formation
 * sits where is seeded noise, because no survey could supply it at the
 * resolution a flight past needs.
 */

const DEG = Math.PI / 180

/** Linear sRGB of a blackbody, peak channel 1 — the same Planck-through-CIE path the stars use. */
const bb = (T) => {
  const o = [0, 0, 0]
  blackbodyRGB(o, T)
  return new THREE.Color(o[0], o[1], o[2])
}

/**
 * Stellar populations as light. An old disc and a bulge are K giants and
 * dwarfs — integrated light near 4,700 K and 4,200 K; young arm populations are
 * dominated by B stars, ~16,000 K. Ionised hydrogen shines mostly in H-alpha
 * at 656 nm with H-beta and [O III] beside it, which reads as the pink of
 * every H II region in a true-colour photograph.
 */
export const POPULATION = {
  old: bb(4700),
  bulge: bb(4200),
  young: bb(16000),
  hii: new THREE.Color(1.0, 0.33, 0.5),
}

/* ---------------------------------------------------------------- *
 * The Milky Way
 * ---------------------------------------------------------------- */

/**
 * The Galaxy's structure. Every radius is kiloparsecs, galactocentric.
 *
 * Disc: scale length 2.6 kpc and scale height 300 pc (Bland-Hawthorn &
 * Gerhard 2016), thick disc 12% of the local density at 900 pc. Bar: the
 * long bar's half-length of 4.5 kpc at 27° to the Sun–centre line, near end
 * at positive longitude (Wegg, Gerhard & Portail 2015). Arms: four
 * logarithmic spirals of pitch 12.5°, each placed by where it crosses the
 * Sun's azimuth — Norma 3.47, Scutum–Centaurus 4.9, Sagittarius–Carina 6.95,
 * Perseus 9.85 kpc, the maser-parallax positions of Reid et al. (2019) —
 * which then puts every arm tangent on the sky within a few degrees of where
 * it is observed (`verify-galaxy`). The two stellar arms (Scutum–Centaurus,
 * Perseus) carry the old-star density wave; the other two are gas and young
 * stars (Churchwell et al. 2009). The Local Arm crosses the Sun's azimuth at
 * 8.4 kpc with pitch 12.8° (Reid et al. 2014), the Sun on its inner edge.
 * Dust: scale height 100 pc and scale length 2.3 kpc (0.28 R0; Drimmel &
 * Spergel 2001), about 1 mag/kpc of A_V at the Sun on average — which puts
 * ~32 magnitudes between the Sun and Sgr A*, against the ~30 observed
 * (`verify-galaxy` integrates it).
 */
export const MILKY_WAY = {
  box: [19, 19, 4.5],
  disc: [1.0, 2.6, 0.3, 16],
  thick: [0.12, 0.9],
  bulge: [5.5, 1.1, 0.62, 1.0],
  bar: [1.6, 4.5, 0.55, 153 * DEG],
  armR: [3.47, 4.9, 6.95, 9.85],
  armOld: [0.1, 0.5, 0.1, 0.5],
  armShape: [Math.tan(12.5 * DEG), 0.34, 3.4, 16],
  localArm: [8.4, Math.tan(12.8 * DEG), 0.3, 0.55],
  ring: [0, 1, 1, 0],
  young: [1.5, 0.55, 0, 0.55],
  dust: [1.35, 2.3, 0.1, GALAXY.R0],
  dust2: [3.0, 0.55, 0.85, 0.07],
  extra: [0, 0, 0, 0],
  seed: 7.31,
}

/**
 * The dark clouds of the solar neighbourhood: galactic longitude, latitude
 * and distance of each complex's centre, its horizontal and vertical extent
 * (1 sigma, pc) and the extinction through its middle (A_V, mag). Positions
 * from the CO survey of Dame, Hartmann & Thaddeus (2001), distances from the
 * 3D dust maps of Zucker et al. (2019, 2020); the extents and extinctions are
 * round numbers of the right size, not fits. Together they are what makes the
 * Great Rift split the band from Cygnus to Sagittarius, and the Coalsack a
 * hole beside the Southern Cross.
 */
export const LOCAL_CLOUDS = [
  ['Aquila Rift', 28, 4, 240, 40, 25, 3.0],
  ['Serpens', 19, 3, 260, 28, 18, 2.5],
  ['Cygnus Rift', 78, 1, 650, 120, 45, 3.0],
  ['Ophiuchus', 354, 16, 138, 12, 10, 5.0],
  ['Pipe Nebula', 0, 5, 145, 12, 5, 3.0],
  ['Lupus', 340, 14, 160, 18, 10, 2.0],
  ['Coalsack', 301, -1, 180, 12, 9, 1.8],
  ['Chamaeleon', 300, -16, 190, 12, 8, 2.0],
  ['Corona Australis', 0, -19, 150, 6, 4, 3.0],
  ['Taurus', 172, -15, 145, 22, 10, 3.0],
  ['Perseus', 160, -19, 295, 20, 12, 3.0],
  ['Orion A', 211, -19, 430, 30, 15, 4.0],
  ['Orion B', 206, -15, 410, 20, 12, 3.0],
  ['Cepheus Flare', 110, 15, 350, 30, 20, 1.5],
]

/** Galactocentric kpc of a (l, b, d pc) point. */
export function lbdToGalactocentric(l, b, dpc) {
  const d = dpc / 1000
  const g = [d * Math.cos(b * DEG) * Math.cos(l * DEG), d * Math.cos(b * DEG) * Math.sin(l * DEG), d * Math.sin(b * DEG)]
  return toGalactocentric([0, 0, 0], g)
}

/** Where the Sun is in the Galaxy's frame, kpc. */
export const SUN_GALACTOCENTRIC = toGalactocentric([0, 0, 0], [0, 0, 0])

/** The Local Bubble: the hot cavity the Sun sits in, ~150 pc across, nearly free of dust. */
export const LOCAL_BUBBLE = { centre: SUN_GALACTOCENTRIC, radius: 0.12 }

/* ---------------------------------------------------------------- *
 * Everyone else, mapped onto the same model
 * ---------------------------------------------------------------- */

/** Uniform values for a galaxy row from sim/cosmos.js. */
export function externalParams(g) {
  const m = g.model
  const R = g.radiusKpc
  const tp = Math.tan((m.pitch ?? 15) * DEG)
  // Arm phase: seeded. Arm i is arm 0 turned by 2 pi i / N.
  const phase = ((m.seed * 0.618) % 1) * 2 * Math.PI
  const Ra0 = (m.Rd ?? 2) * 2.2 * Math.exp(phase * tp)
  const N = m.arms ?? 0
  const armR = [0, 1, 2, 3].map((i) => (i < N ? Ra0 * Math.exp((-i * 2 * Math.PI * tp) / N) : 0))
  const p = {
    box: [R, R, Math.max(R * 0.25, 1.2)],
    // The old disc is what a photograph's outer glow is made of, and it is
    // faint beside the arms in blue light: a third of the young weight's
    // scale, so the outer disc is a haze the arms are drawn on.
    disc: [0.38, m.Rd ?? 2, m.hz ?? 0.3, R],
    thick: [0.1, (m.hz ?? 0.3) * 3],
    bulge: [0, 1, 0.7, 0],
    bar: [0, 1, 0.3, 0],
    armR,
    armOld: [0.7, 0.7, 0.7, 0.7].map((v) => v * (1 - 0.6 * (m.flocculent ?? 0))),
    armShape: [tp, m.armW ?? 0.6, Math.max(0.6, (m.rb ?? 0.5) * 2.2), R],
    localArm: [0, 0, 0, 0],
    ring: m.ring ? [1.0, m.ring, m.ringW ?? 1, 1] : [0, 1, 1, 0],
    young: [3.6, 2.2 * (m.hii ?? 1), m.flocculent ?? 0, Math.max(0.25, (m.Rd ?? 2) * 0.22)],
    dust: [1.3 * (m.dust ?? 1), (m.Rd ?? 2) * 1.2, (m.hz ?? 0.3) * 0.35, (m.Rd ?? 2) * 2],
    dust2: [(m.Rd ?? 2) * 0.35, 0.6, 0.8, 0.07],
    extra: [m.wind ?? 0, 0, 0, 0],
    field: [0.12, 2.0],
    seed: m.seed * 1.37,
  }
  const bulgeA = (m.rb ?? 0.5) / 1.8153
  if (m.bulge) p.bulge = [m.bulge * 9, bulgeA, 0.72, 0]
  if (m.bar) p.bar = [0.9 + (m.bulge ?? 0) * 2, m.bar, m.bar * 0.3, (m.barAngle ?? 0) * DEG]

  if (m.type === 'elliptical' || m.type === 'dsph') {
    // All bulge: a Hernquist sphere, flattened to the observed axis ratio.
    // A Hernquist sphere of scale a = r_e / 1.8153 projects to the observed
    // de Vaucouleurs light; a dwarf spheroidal is a Plummer sphere, whose
    // projected half-light radius is its scale, and faint — central surface
    // brightnesses of 24 to 26 mag/arcsec², a hundredth of an elliptical's.
    const dwarf = m.type === 'dsph'
    const a = dwarf ? m.re : m.re / 1.8153
    // Big enough that the window at its edge falls where the light is faint.
    const B = Math.max(R, (dwarf ? 5 : 12) * a)
    p.box = [B, B, B * Math.max(m.q ?? 0.8, 0.5)]
    p.disc = [0, 1, 0.3, R]
    p.thick = [0, 1]
    // Ellipticals are the densest light there is; at the exposure a spiral's
    // outer disc needs, their r^-4 haloes would fill the frame.
    p.bulge = dwarf ? [1, a, m.q ?? 0.8, 2] : [1.4, a, m.q ?? 0.8, 0]
    p.field = [0, 1]
    p.armR = [0, 0, 0, 0]
    p.young = [0, 0, 0, 1]
    p.dust = [m.dustLane ? 2.5 * m.dustLane : 0, 1, 0.08, 0.5]
    if (m.dustLane) {
      p.disc = [0.02, m.re, 0.1, m.re * 2]
    }
    if (m.jet) p.extra = [0, ((m.jet - g.pa) * Math.PI) / 180, 3.0, 0]
  } else if (m.type === 'irregular') {
    // An irregular is a lumpy, cored ellipsoid of old stars with young
    // clusters and ionised gas scattered through it — not a disc. A Plummer
    // body, knots from the young population wherever the noise puts gas.
    p.box = [R, R, R]
    p.armR = [0, 0, 0, 0]
    p.disc = [0.05, m.Rd ?? 1, m.hz ?? 0.5, R]
    p.thick = [0, 1]
    p.bulge = [0.22, (m.Rd ?? 1) * 1.1, 0.62, 2]
    p.young = [5.0, 4.0 * (m.hii ?? 1), 0, 0.18]
    p.ring = [0, 1, 1, 0]
    p.field = [1.0, 2.2]
  } else if (m.type === 'magellanic') {
    // One arm, and a bar off the disc's centre.
    p.bar = [2.2, m.bar, m.bar * 0.35, (m.barAngle ?? 0) * DEG]
    p.young = [2.0, 1.5 * (m.hii ?? 1), 0.5, 0.3]
  } else if (m.type === 'starburst') {
    p.box = [R, R, R]
    p.armR = [0, 0, 0, 0]
    p.young = [2.4, 2.0 * (m.hii ?? 1), 1.0, 0.2]
    p.ring = [1.2, R * 0.25, R * 0.3, 1]
    p.bulge = [1.5, 0.2, 0.6, 0]
  } else if (m.type === 'sombrero') {
    p.bulge = [m.bulge * 3.2, (m.rb ?? 2.5) / 1.8153, 0.78, 0]
    p.box = [R, R, R]
    p.young = [0.25, 0.1, 0, 0.4]
    p.dust = [3.5 * (m.dust ?? 1), 3, 0.12, m.ring]
    p.dust2 = [m.ring * 0.75, 0.2, 0.7, 0.07]
  } else if (m.type === 'lenticular-dust') {
    // Centaurus A: a giant elliptical with a young, dusty disc through its middle.
    const a = m.re / 1.8153
    p.box = [R, R, R]
    p.bulge = [1.4, a, m.q ?? 0.9, 0]
    p.disc = [0.15, 1.3, 0.12, m.dustR * 1.2]
    p.thick = [0, 1]
    p.armR = [0, 0, 0, 0]
    p.young = [1.1, 0.9, 0.8, 0.2]
    p.ring = [1, m.dustR * 0.55, m.dustR * 0.35, 1]
    p.dust = [6, 2.5, 0.09, 1]
    p.dust2 = [0.2, 0.3, 0.9, 0.05]
    p.extra = [0, ((55 - g.pa) * Math.PI) / 180, m.jets ? 1.2 : 0, 0]
  }
  return p
}

/* ---------------------------------------------------------------- *
 * Brightness from luminosity
 * ---------------------------------------------------------------- */

/**
 * The model's total light, integrated component by component in closed form
 * (the noise averages out; the arms' share is their width over the spacing
 * between them). An exponential disc holds 2 pi Rd^2 x 2h; a Hernquist sphere
 * of scale a holds 2 pi a^3 of its own weight; a Plummer sphere (4/3) pi a^3.
 * Good to tens of per cent — which is what lets each galaxy's gain be set so
 * that its total is its catalogued absolute magnitude, and one photographic
 * exposure then serves every galaxy: the Andromeda Galaxy outshines the
 * Triangulum by the 2.7 magnitudes it does, and a dwarf spheroidal is as
 * faint as it is.
 */
export function modelLuminosity(p) {
  const [wd, Rd, hz] = p.disc
  const disc = 2 * Math.PI * Rd * Rd
  let L = wd * disc * 2 * hz * (1 + 0.25 * p.armOld[0]) + wd * p.thick[0] * disc * 2 * p.thick[1]
  const nArms = p.armR.filter((r) => r > 0).length
  const armShare = Math.min(1, (nArms * p.armShape[1] * 1.35 * Math.sqrt(Math.PI)) / (2 * Math.PI * Math.max(Rd * 2, 0.5)))
  const ring = p.ring[0] > 0 ? (p.ring[0] * p.ring[2] * Math.sqrt(Math.PI)) / Math.max(p.ring[1], p.ring[2]) : 0
  const field = (p.field ?? [0.12])[0] * 0.25
  const young = 2 * Math.PI * (1.35 * Rd) ** 2 * ((2 * hz) / 3) * (armShare + ring + field) * 0.6
  L += (p.young[0] + 0.4 * p.young[1]) * young
  const [wb, a, q, profile] = p.bulge
  if (wb > 0) L += wb * q * a ** 3 * (profile > 1.5 ? (4 / 3) * Math.PI : profile > 0.5 ? 4.2 : 2 * Math.PI)
  if (p.bar[0] > 0) L += p.bar[0] * 2 * p.bar[1] * 2 * p.bar[2] * 2 * hz * 1.4 * 0.45
  return L
}

/** The Milky Way's integrated absolute V magnitude (Licquia, Newman & Brinchmann 2015). */
export const MILKY_WAY_ABS_V = -20.9

/* ---------------------------------------------------------------- *
 * The material
 * ---------------------------------------------------------------- */

const VERT = /* glsl */ `
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    // A volume is a direction to march, not a depth: it is ordered by hand, and
    // never clipped for being a hundred million light-years off.
    gl_Position.z = 0.5 * gl_Position.w;
  }
`

/*
 * The ray is built from the pixel, not from the box. The box is only there to
 * say which pixels to march; interpolating its corners into a direction is
 * exact while the box is wholly in front of the camera and garbage once the
 * camera is inside it, because the triangles that cross the camera plane are
 * clipped at w = 0 and their attributes interpolated through a division by
 * nothing — which drew every cube face of the first sky in a different shade.
 * The inverse projection and the camera's rotation into the galaxy's frame
 * make the direction exact for every pixel of every face.
 */
const FRAG = /* glsl */ `
  ${GALAXY_GLSL}
  uniform mat4 uInvProj;
  uniform mat3 uViewToLocal;
  uniform vec2 uViewport;
  uniform vec4 uCurve; // A, L_ref, gamma, on
  void main() {
    vec2 ndc = gl_FragCoord.xy / uViewport * 2.0 - 1.0;
    vec4 v = uInvProj * vec4(ndc, -1.0, 1.0);
    vec3 rd = normalize(uViewToLocal * (v.xyz / v.w));
    float j = ign(gl_FragCoord.xy + uJitterSeed);
    vec4 c = marchGalaxy(uCam, rd, j);
    // The sky cube stores the stretched sky (see Cosmos.jsx), so eight bits a
    // channel hold it without banding and the cube costs half the memory.
    if (uCurve.w > 0.5) {
      float L = max(dot(c.rgb, vec3(0.2126, 0.7152, 0.0722)), 1e-9);
      c.rgb *= uCurve.x * pow(L / uCurve.y, uCurve.z) / L;
      c.a = 1.0;
    }
    gl_FragColor = c;
  }
`

const v4 = (a) => new THREE.Vector4(a[0], a[1], a[2], a[3])

/**
 * A galaxy's volume material. `quality` sets the step budget and the finest
 * noise octave: the sky cube, rendered once, affords far more than a volume
 * redrawn every frame.
 */
export function makeGalaxyMaterial(p, { milkyWay = false, steps = 64, octaves = 4, gain = 1 } = {}) {
  const uniforms = {
    uCam: { value: new THREE.Vector3() },
    uInvProj: { value: new THREE.Matrix4() },
    uViewToLocal: { value: new THREE.Matrix3() },
    uViewport: { value: new THREE.Vector2(1, 1) },
    uCurve: { value: new THREE.Vector4(1, 1, 1, 0) },
    uBox: { value: new THREE.Vector3(...p.box) },
    uSteps: { value: steps },
    uOctaves: { value: octaves },
    uGain: { value: gain },
    uJitterSeed: { value: 0 },
    uDisc: { value: v4(p.disc) },
    uThick: { value: new THREE.Vector2(...p.thick) },
    uBulge: { value: v4(p.bulge) },
    uBar: { value: v4(p.bar) },
    uArmR: { value: v4(p.armR) },
    uArmOld: { value: v4(p.armOld) },
    uArmShape: { value: v4(p.armShape) },
    uLocalArm: { value: v4(p.localArm) },
    uRing: { value: v4(p.ring) },
    uYoung: { value: v4(p.young) },
    uDust: { value: v4(p.dust) },
    uDust2: { value: v4(p.dust2) },
    uColOld: { value: POPULATION.old },
    uColBulge: { value: POPULATION.bulge },
    uColYoung: { value: POPULATION.young },
    uColHii: { value: POPULATION.hii },
    uExtra: { value: v4(p.extra) },
    uField: { value: new THREE.Vector2(...(p.field ?? [0.12, 2])) },
    uSeed: { value: p.seed },
  }
  const defines = {}
  if (milkyWay) {
    defines.MILKY_WAY = ''
    uniforms.uCloud = {
      value: LOCAL_CLOUDS.map(([, l, b, d, sxy, sz, av]) => {
        const c = lbdToGalactocentric(l, b, d)
        // Peak kappa_V that gives this A_V through the middle of a Gaussian this
        // wide: A_V = 1.086 tau, and tau through exp(-(x/s)^2) is kappa s sqrt(pi).
        const sig = (sxy + sz) / 2 / 1000
        return new THREE.Vector4(c[0], c[1], c[2], (av / 1.086) / (sig * Math.sqrt(Math.PI)))
      }),
    }
    uniforms.uCloudShape = { value: LOCAL_CLOUDS.map(([, , , , sxy, sz]) => new THREE.Vector4(sxy / 1000, sxy / 1000, sz / 1000, 0)) }
    uniforms.uBubble = { value: new THREE.Vector4(...LOCAL_BUBBLE.centre, LOCAL_BUBBLE.radius) }
  }
  return new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms,
    defines,
    side: THREE.BackSide,
    transparent: false,
    depthTest: false,
    depthWrite: false,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    toneMapped: false,
  })
}

const _r = new THREE.Matrix3()
const _b = new THREE.Matrix3()

/**
 * Point a volume material at a camera: its inverse projection, the rotation
 * from the camera's view space into the galaxy's frame (basis transposed,
 * times the camera's world rotation), and the size of the target it draws
 * into. Allocation-free.
 */
export function aimVolume(material, camera, basis, width, height) {
  const u = material.uniforms
  u.uInvProj.value.copy(camera.projectionMatrixInverse)
  _r.setFromMatrix4(camera.matrixWorld)
  _b.setFromMatrix4(basis).transpose()
  u.uViewToLocal.value.multiplyMatrices(_b, _r)
  u.uViewport.value.set(width, height)
}

/** Galactic longitude of a galactocentric point as seen from the Sun, degrees — for the gate. */
export function longitudeFromSun(q) {
  const s = SUN_GALACTOCENTRIC
  // Galactocentric axes are galactic axes to 0.15°; that is below what this is for.
  let l = Math.atan2(q[1] - s[1], q[0] - s[0]) / DEG
  if (l < 0) l += 360
  return l
}

export { icrsToGalactic }
