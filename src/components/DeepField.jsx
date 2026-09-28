import { useEffect, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { AU } from '../sim/constants.js'
import { CMB_DISTANCE, GALAXY_CLUSTERS, MEGAPARSEC, MILKY_WAY_FRAME, icrsUnit, galacticToIcrs } from '../sim/cosmos.js'
import { equatorialToScene, blackbodyRGB } from '../gfx/stars.js'
import { NOISE_GLSL } from '../gfx/glsl/noise.js'
import { VIEW } from '../gfx/cosmicView.js'
import { QUALITY } from '../sim/device.js'
import { live } from '../sim/live.js'

/**
 * The largest scales: the cosmic web, the microwave background, and — at the
 * other end — the Sun's own outermost structures, the heliosphere and the
 * Oort cloud. Each is drawn only across the range of distances at which it is
 * the subject, so none of it clutters a mission.
 *
 * ── what is measured, what is statistical ─────────────────────────────
 *
 * The galaxy clusters named in `sim/cosmos.js` are where they are; their
 * member galaxies, and the filaments and walls between them, are a
 * statistical realisation — galaxies placed on the edges and faces of a
 * Voronoi foam, which is the geometry large-scale structure grows into
 * (Icke & van de Weygaert 1987), at the observed density of bright galaxies,
 * about one per 100 Mpc³ brighter than a tenth of L-star, with the foam's contrast.
 * The microwave background's dipole — 3.362 mK toward (l, b) = (264.02°,
 * 48.25°), our motion through it (Planck 2018) — is measured; its
 * small-scale anisotropy is a Gaussian random field with the right
 * amplitude (tens of microkelvin) and its power concentrated near the first
 * acoustic peak's degree scale, not Planck's map.
 */

const MPC = MEGAPARSEC

/** Seeded uniforms. */
function rng(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Galaxies on a Voronoi foam: nuclei on a jittered 100 Mpc grid out to the
 * web's edge; a candidate survives by how close it is to being equidistant
 * from its two (a wall) or three (a filament) nearest nuclei. Returns
 * positions in the galactic frame (Mpc, centred on the Milky Way) and a kind
 * per galaxy — 1 for the old red galaxies that crowd clusters and
 * filaments, 0 for the blue spirals of the walls and field.
 */
function buildWeb(count, reach) {
  const r = rng(90210)
  const cell = 100
  const n = Math.ceil(reach / cell) + 1
  const S = 2 * n + 1
  // One nucleus per cell, in a flat array indexed by cell: [x, y, z] Mpc.
  const nuclei = new Float32Array(S * S * S * 3)
  for (let i = -n; i <= n; i++)
    for (let j = -n; j <= n; j++)
      for (let k = -n; k <= n; k++) {
        const o = (((i + n) * S + (j + n)) * S + (k + n)) * 3
        nuclei[o] = (i + r()) * cell
        nuclei[o + 1] = (j + r()) * cell
        nuclei[o + 2] = (k + r()) * cell
      }
  const pos = []
  const kind = []
  let tries = 0
  while (pos.length < count * 3 && tries < count * 40) {
    tries++
    const x = (2 * r() - 1) * reach
    const y = (2 * r() - 1) * reach
    const z = (2 * r() - 1) * reach
    if (x * x + y * y + z * z > reach * reach) continue
    const ci = Math.floor(x / cell)
    const cj = Math.floor(y / cell)
    const ck = Math.floor(z / cell)
    let d1 = Infinity
    let d2 = Infinity
    let d3 = Infinity
    for (let a = -1; a <= 1; a++)
      for (let b = -1; b <= 1; b++)
        for (let c = -1; c <= 1; c++) {
          const ii = ci + a + n
          const jj = cj + b + n
          const kk = ck + c + n
          if (ii < 0 || jj < 0 || kk < 0 || ii >= S || jj >= S || kk >= S) continue
          const o = ((ii * S + jj) * S + kk) * 3
          const dx = x - nuclei[o]
          const dy = y - nuclei[o + 1]
          const dz = z - nuclei[o + 2]
          const d = Math.sqrt(dx * dx + dy * dy + dz * dz)
          if (d < d1) [d1, d2, d3] = [d, d1, d2]
          else if (d < d2) [d2, d3] = [d, d2]
          else if (d < d3) d3 = d
        }
    const wall = Math.exp(-(((d2 - d1) / 6) ** 2))
    const filament = Math.exp(-(((d3 - d1) / 9) ** 2))
    const keep = 0.004 + 0.28 * wall + 1.0 * filament
    if (r() > keep) continue
    pos.push(x, y, z)
    kind.push(filament > 0.5 ? (r() < 0.6 ? 1 : 0) : r() < 0.2 ? 1 : 0)
  }
  return { pos, kind }
}

const WEB_VERT = /* glsl */ `
  attribute float kind;
  attribute float lum;
  uniform float uBright;
  uniform float uPx;
  uniform vec3 uCam;
  varying vec3 vCol;
  varying float vSoft;
  void main() {
    vec3 rel = position - uCam;
    float d = max(length(rel), 1e-3);
    // Apparent brightness falls as 1/d^2; the exposure opens with the scale
    // the camera is looking at, so a filament 50 Mpc off reads like a
    // filament, not like nothing.
    float b = lum / (d * d) * uBright;
    vCol = mix(vec3(0.62, 0.72, 1.0), vec3(1.0, 0.8, 0.55), kind) * min(pow(b, 0.5), 3.0);
    // A galaxy is 30 kpc across: a disc once that is more than a pixel.
    float size = (0.03 / d) / uPx;
    vSoft = clamp(size / 3.0, 0.0, 1.0);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_Position.z = 0.5 * gl_Position.w;
    gl_PointSize = clamp(size, 2.0, 24.0);
  }
`
const WEB_FRAG = /* glsl */ `
  varying vec3 vCol;
  varying float vSoft;
  void main() {
    vec2 q = gl_PointCoord - 0.5;
    float r2 = dot(q, q) * 4.0;
    if (r2 > 1.0) discard;
    float core = exp(-r2 * mix(9.0, 3.0, vSoft));
    gl_FragColor = vec4(vCol * core, 1.0);
  }
`

const CMB_VERT = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_Position.z = 0.5 * gl_Position.w;
  }
`
const CMB_FRAG = /* glsl */ `
  ${NOISE_GLSL}
  uniform vec3 uDipole;   // unit direction of the dipole's hot pole, in this frame
  uniform float uFade;
  varying vec3 vDir;
  // The Planck map's colours: cold blue through white to hot red.
  vec3 ramp(float x) {
    x = clamp(x * 0.5 + 0.5, 0.0, 1.0);
    vec3 c = mix(vec3(0.0, 0.12, 0.55), vec3(0.2, 0.55, 0.95), smoothstep(0.0, 0.3, x));
    c = mix(c, vec3(0.98, 0.95, 0.85), smoothstep(0.3, 0.5, x));
    c = mix(c, vec3(1.0, 0.6, 0.1), smoothstep(0.5, 0.7, x));
    c = mix(c, vec3(0.75, 0.08, 0.02), smoothstep(0.7, 1.0, x));
    return c;
  }
  void main() {
    vec3 d = normalize(vDir);
    // Anisotropy: most power near a degree (the first acoustic peak), less at
    // larger scales — layered noise weighted accordingly, in units of ~70 uK.
    float t = 0.0;
    t += 0.25 * snoise(d * 3.0);
    t += 0.45 * snoise(d * 22.0 + 3.1);
    t += 0.7 * snoise(d * 60.0 + 7.7);
    t += 0.4 * snoise(d * 140.0 - 2.2);
    t += 0.2 * snoise(d * 200.0 + 5.5);
    // The dipole, 3.36 mK, is fifty times the anisotropy; it is shown at a
    // twentieth of that so both read.
    t = t * 0.75 + 0.45 * dot(d, uDipole);
    gl_FragColor = vec4(ramp(t) * 0.55 * uFade, 1.0);
  }
`

const OORT_VERT = /* glsl */ `
  uniform float uFade;
  varying float vB;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vB = uFade;
    gl_Position = projectionMatrix * mv;
    gl_Position.z = 0.5 * gl_Position.w;
    gl_PointSize = 1.6;
  }
`
const OORT_FRAG = /* glsl */ `
  varying float vB;
  void main() {
    vec2 q = gl_PointCoord - 0.5;
    if (dot(q, q) > 0.25) discard;
    gl_FragColor = vec4(vec3(0.55, 0.65, 0.8) * vB * 0.22, 1.0);
  }
`

const HELIO_VERT = /* glsl */ `
  varying vec3 vN;
  varying vec3 vView;
  varying vec3 vObj;
  void main() {
    vObj = position;
    vN = normalize(normalMatrix * normal);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vView = -mv.xyz;
    gl_Position = projectionMatrix * mv;
    gl_Position.z = 0.5 * gl_Position.w;
  }
`
const HELIO_FRAG = /* glsl */ `
  ${NOISE_GLSL}
  uniform float uFade;
  uniform vec3 uCol;
  varying vec3 vN;
  varying vec3 vView;
  varying vec3 vObj;
  void main() {
    float mu = abs(dot(normalize(vN), normalize(vView)));
    // A bubble shows at its limb, where the line of sight grazes the most of it.
    float rim = pow(1.0 - mu, 3.0);
    float tex = 0.7 + 0.6 * fbmAA(normalize(vObj) * 3.0, 1.0, 4, 0.01, 0.55);
    gl_FragColor = vec4(uCol * rim * tex * uFade * 0.5, 1.0);
  }
`

/** A scene-frame unit vector for galactic (l, b), degrees. */
function galacticDir(l, b) {
  const d = Math.PI / 180
  const g = [Math.cos(b * d) * Math.cos(l * d), Math.cos(b * d) * Math.sin(l * d), Math.sin(b * d)]
  const e = galacticToIcrs([0, 0, 0], g)
  const s = equatorialToScene([0, 0, 0], e[0], e[1], e[2])
  return new THREE.Vector3(s[0], s[1], s[2])
}

export function DeepField() {
  /* The web and the clusters, built the first time the camera is far enough out to see them. */
  const web = useMemo(() => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3), 3))
    const m = new THREE.ShaderMaterial({
      vertexShader: WEB_VERT,
      fragmentShader: WEB_FRAG,
      uniforms: { uBright: { value: 1 }, uPx: { value: 1e-3 }, uCam: { value: new THREE.Vector3() } },
      transparent: false,
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
    })
    const pts = new THREE.Points(g, m)
    pts.frustumCulled = false
    pts.renderOrder = -996
    pts.visible = false
    pts.matrixAutoUpdate = false
    pts.matrixWorldAutoUpdate = false
    return { g, m, pts, built: false }
  }, [])

  const cmb = useMemo(() => {
    const geo = new THREE.SphereGeometry(1, 96, 48)
    const dip = galacticDir(264.02, 48.25)
    const mat = new THREE.ShaderMaterial({
      vertexShader: CMB_VERT,
      fragmentShader: CMB_FRAG,
      uniforms: { uDipole: { value: dip }, uFade: { value: 0 } },
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false,
    })
    const mesh = new THREE.Mesh(geo, mat)
    mesh.renderOrder = -1002
    mesh.frustumCulled = false
    mesh.visible = false
    mesh.matrixAutoUpdate = false
    mesh.matrixWorldAutoUpdate = false
    return { geo, mat, mesh }
  }, [])

  /* The Oort cloud: a hundred thousand AU of comets, as a scatter; the heliosphere, a bubble. */
  const sun = useMemo(() => {
    const r01 = rng(1950)
    const n = QUALITY.galaxyStars ? Math.min(16000, Math.round(QUALITY.galaxyStars / 12)) : 12000
    const p = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) {
      // Inner (Hills) cloud flattened toward the ecliptic, outer cloud round.
      const outer = r01() < 0.7
      const rr = outer ? 20000 + 80000 * Math.pow(r01(), 0.6) : 2000 + 18000 * r01()
      const u = 2 * r01() - 1
      const ph = 2 * Math.PI * r01()
      const flat = outer ? 1 : 0.35
      const s = Math.sqrt(1 - u * u)
      p[i * 3] = rr * s * Math.cos(ph)
      p[i * 3 + 1] = rr * u * flat
      p[i * 3 + 2] = rr * s * Math.sin(ph)
    }
    const og = new THREE.BufferGeometry()
    og.setAttribute('position', new THREE.BufferAttribute(p, 3))
    const om = new THREE.ShaderMaterial({
      vertexShader: OORT_VERT,
      fragmentShader: OORT_FRAG,
      uniforms: { uFade: { value: 0 } },
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
    })
    const oort = new THREE.Points(og, om)
    oort.frustumCulled = false
    oort.renderOrder = -995
    oort.scale.setScalar(AU)

    /*
     * The heliosphere: the solar wind's bubble, blunt where it meets the
     * interstellar wind — which arrives from ecliptic longitude 255.7°,
     * latitude 5.1° — and drawn out downwind. The heliopause stands 120 AU
     * off at the nose, where both Voyagers crossed it (121 and 119 AU).
     */
    const hg = new THREE.SphereGeometry(1, 96, 48)
    const pos = hg.attributes.position
    const lam = (255.7 * Math.PI) / 180
    const bet = (5.1 * Math.PI) / 180
    const nose = new THREE.Vector3(Math.cos(bet) * Math.cos(lam), Math.sin(bet), -Math.cos(bet) * Math.sin(lam))
    const v = new THREE.Vector3()
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i)
      const c = v.dot(nose)
      // 120 AU at the nose, drawn smoothly out to about twice that downwind.
      const R = 120 * (1 + 0.95 * Math.pow((1 - c) / 2, 1.6))
      v.multiplyScalar(R)
      pos.setXYZ(i, v.x, v.y, v.z)
    }
    hg.computeVertexNormals()
    const col = [0, 0, 0]
    blackbodyRGB(col, 30000)
    const hm = new THREE.ShaderMaterial({
      vertexShader: HELIO_VERT,
      fragmentShader: HELIO_FRAG,
      uniforms: { uFade: { value: 0 }, uCol: { value: new THREE.Color(col[0] * 0.6, col[1] * 0.8, col[2]) } },
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
    })
    const helio = new THREE.Mesh(hg, hm)
    helio.frustumCulled = false
    helio.renderOrder = -995
    helio.scale.setScalar(AU)
    return { oort, og, om, helio, hg, hm }
  }, [])

  useEffect(
    () => () => {
      web.g.dispose()
      web.m.dispose()
      cmb.geo.dispose()
      cmb.mat.dispose()
      sun.og.dispose()
      sun.om.dispose()
      sun.hg.dispose()
      sun.hm.dispose()
    },
    [web, cmb, sun],
  )

  useFrame(({ camera, gl }) => {
    const mw = MILKY_WAY_FRAME.centre
    const fromMw = VIEW.abs.distanceTo(mw)
    const px = (camera.fov * Math.PI) / 180 / Math.max(1, gl.domElement.clientHeight)

    /* The web: from a few megaparsecs out, where the Local Group is a point. */
    // Beyond a few gigaparsecs the whole web is a few pixels, and a hundred
    // thousand galaxies added into them is a white blob, not a picture.
    const webOn = fromMw > 1.5 * MPC && fromMw < 4000 * MPC
    if (webOn && !web.built) {
      const { pos, kind } = buildWeb(Math.round((QUALITY.galaxyStars ?? 90000) * 0.6), 600)
      // The named clusters, populated: concentrated round their centres.
      const r01 = rng(4242)
      for (const c of GALAXY_CLUSTERS) {
        const centre = c.abs.clone().sub(mw).divideScalar(MPC)
        for (let i = 0; i < c.members; i++) {
          const rr = c.radiusMpc * 0.35 * Math.pow(r01(), 1.8) / Math.max(0.05, 1 - r01() * 0.6)
          const u = 2 * r01() - 1
          const ph = 2 * Math.PI * r01()
          const s = Math.sqrt(1 - u * u)
          pos.push(centre.x + rr * s * Math.cos(ph), centre.y + rr * u, centre.z + rr * s * Math.sin(ph))
          kind.push(r01() < 0.75 ? 1 : 0)
        }
      }
      const n = pos.length / 3
      const lum = new Float32Array(n)
      for (let i = 0; i < n; i++) lum[i] = Math.pow(10, -0.4 * ((kind[i] ? -21.2 : -20.4) + (r01() - 0.5) * 3 + 21))
      web.g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3))
      web.g.setAttribute('kind', new THREE.BufferAttribute(new Float32Array(kind), 1))
      web.g.setAttribute('lum', new THREE.BufferAttribute(lum, 1))
      web.g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e30)
      web.built = true
    }
    web.pts.visible = webOn && web.built
    if (web.pts.visible) {
      // Positions are Mpc from the Milky Way; the object sits there, scaled.
      web.pts.matrixWorld.makeScale(MPC, MPC, MPC).setPosition(mw.x - live.origin.x, mw.y - live.origin.y, mw.z - live.origin.z)
      const u = web.m.uniforms
      u.uCam.value.subVectors(VIEW.abs, mw).divideScalar(MPC)
      u.uPx.value = px
      // The exposure follows the scale in view — (distance / 5 Mpc)^2, faded
      // in — up to the web's own size: from beyond it the web is one object,
      // exposed as one.
      const k = Math.min(1, (fromMw / MPC - 1.5) / 3)
      const scale = Math.min(Math.max(fromMw / MPC, 1), 900)
      const out = fromMw / MPC > 2500 ? Math.max(0, 1 - (fromMw / MPC - 2500) / 1500) : 1
      u.uBright.value = Math.pow(scale / 5, 2) * 200 * k * out
    }

    /* The CMB: from beyond a gigaparsec, the shell round everything we can see. */
    const cmbOn = fromMw > 1500 * MPC
    cmb.mesh.visible = cmbOn
    if (cmbOn) {
      const s = CMB_DISTANCE
      cmb.mesh.matrixWorld.makeScale(s, s, s).setPosition(mw.x - live.origin.x, mw.y - live.origin.y, mw.z - live.origin.z)
      cmb.mat.uniforms.uFade.value = Math.min(1, (fromMw / MPC - 1500) / 4000)
    }

    /* The Sun's own outskirts: shown across the scales where they are the frame's subject. */
    const au = VIEW.fromSun / AU
    const helioFade = au < 150 ? 0 : au < 400 ? (au - 150) / 250 : au < 8000 ? 1 : au < 40000 ? 1 - (au - 8000) / 32000 : 0
    sun.helio.visible = helioFade > 0
    sun.hm.uniforms.uFade.value = helioFade
    const oortFade = au < 1500 ? 0 : au < 8000 ? (au - 1500) / 6500 : au < 600000 ? 1 : au < 3e6 ? 1 - (au - 6e5) / 2.4e6 : 0
    sun.oort.visible = oortFade > 0
    sun.om.uniforms.uFade.value = oortFade
    if (sun.helio.visible || sun.oort.visible) {
      const p = live.pos.sun
      sun.helio.position.copy(p)
      sun.oort.position.copy(p)
    }
  }, -2)

  return (
    <>
      <primitive object={cmb.mesh} />
      <primitive object={web.pts} />
      <primitive object={sun.oort} />
      <primitive object={sun.helio} />
    </>
  )
}

export { icrsUnit }
