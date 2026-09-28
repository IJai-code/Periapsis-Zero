import * as THREE from 'three'
import { NEBULA_GLSL } from './glsl/nebula.js'
import { blackbodyRGB, equatorialToScene, lineRGB } from './stars.js'
import { NAMED_STARS, PARSEC } from '../sim/cosmos.js'

/**
 * The deep-sky volumes' materials and frames. The shapes are in
 * `glsl/nebula.js`; this says which shape each object is, where its stars
 * are, and which way it faces.
 */

/** The shape families, as the shader's LOOK numbers. */
export const LOOKS = {
  'hii-blister': 1,
  'hii-pillars': 2,
  'hii-lagoon': 3,
  'hii-carina': 4,
  'hii-shell': 5,
  'planetary-ring': 6,
  'planetary-helix': 7,
  'remnant-crab': 8,
  'remnant-shell': 9,
  'dark-pillar': 10,
  'open-reflection': 11,
}

/**
 * Stars inside each nebula, in its unit frame, with a brightness: the
 * clusters whose light the gas is glowing in. Positions are where each
 * family's shape puts the cavity's source, not astrometry — the shapes are
 * seeded families (see glsl/nebula.js).
 */
const EMBEDDED = {
  'hii-blister': [[0.08, 0.12, 0.25, 3], [0.1, 0.1, 0.26, 2], [0.06, 0.14, 0.24, 1.6], [0.09, 0.15, 0.27, 1.3]],
  'hii-pillars': [[0.05, 0.62, 0.3, 2.5], [-0.1, 0.7, 0.2, 1.8], [0.2, 0.55, 0.35, 1.5]],
  'hii-lagoon': [[0.08, 0.02, 0.12, 2.5], [-0.12, 0.1, 0.05, 1.5], [0.3, -0.1, 0.0, 1.0], [-0.35, -0.05, 0.1, 0.8]],
  'hii-carina': [[0.02, 0.05, 0.1, 4], [-0.25, 0.15, 0.0, 2], [0.3, -0.1, 0.1, 1.8]],
  'hii-shell': [[0, 0, 0, 2.5], [0.06, 0.05, 0.02, 1.8], [-0.05, -0.04, 0.03, 1.6], [0.02, -0.07, -0.02, 1.4]],
  'planetary-ring': [[0, 0, 0, 1.2]],
  'planetary-helix': [[0, 0, 0, 1.2]],
}

const DEG = Math.PI / 180

/**
 * A nebula's frame: +z from it toward the Sun, +y toward celestial north
 * (projected), so the object faces us the way its photographs do — the Ring
 * down its barrel, the Horsehead in profile.
 */
export function nebulaBasis(abs) {
  const z = abs.clone().negate().normalize()
  const n = equatorialToScene([0, 0, 0], 0, 0, 1)
  const north = new THREE.Vector3(n[0], n[1], n[2])
  const x = new THREE.Vector3().crossVectors(north, z)
  if (x.lengthSq() < 1e-8) x.set(1, 0, 0)
  x.normalize()
  const y = new THREE.Vector3().crossVectors(z, x).normalize()
  return new THREE.Matrix4().makeBasis(x, y, z)
}

const VERT = /* glsl */ `
  void main() {
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_Position.z = 0.5 * gl_Position.w;
  }
`
const FRAG = /* glsl */ `
  ${NEBULA_GLSL}
  uniform mat4 uInvProj;
  uniform mat3 uViewToLocal;
  uniform vec2 uViewport;
  void main() {
    vec2 ndc = gl_FragCoord.xy / uViewport * 2.0 - 1.0;
    vec4 v = uInvProj * vec4(ndc, -1.0, 1.0);
    vec3 rd = normalize(uViewToLocal * (v.xyz / v.w));
    gl_FragColor = marchNebula(uCam, rd, nebJitter(gl_FragCoord.xy + uJitterSeed));
  }
`

const colour = (fn, arg) => {
  const o = [0, 0, 0]
  fn(o, arg)
  return new THREE.Color(o[0], o[1], o[2])
}

/** Stars for a deep-sky object, in its unit frame. */
function starsFor(o, basis) {
  if (o.look === 'open-reflection') {
    // The Pleiades light their dust with their own named stars.
    const e = basis.elements
    const r = o.radiusPc * PARSEC
    return NAMED_STARS.filter((s) => s.cluster === o.id).map((s) => {
      const d = s.abs.clone().sub(o.abs)
      return [
        (e[0] * d.x + e[1] * d.y + e[2] * d.z) / r,
        (e[4] * d.x + e[5] * d.y + e[6] * d.z) / r,
        (e[8] * d.x + e[9] * d.y + e[10] * d.z) / r,
        Math.pow(10, -0.4 * (s.v - 3)),
      ]
    })
  }
  return EMBEDDED[o.look] ?? []
}

export function makeNebulaMaterial(o, basis, { steps = 48, octaves = 5 } = {}) {
  const stars = starsFor(o, basis)
  const uStars = Array.from({ length: 9 }, (_, i) => new THREE.Vector4(...(stars[i] ?? [0, 0, 0, 0])))
  return new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    defines: { LOOK: LOOKS[o.look] ?? 3 },
    uniforms: {
      uCam: { value: new THREE.Vector3() },
      uInvProj: { value: new THREE.Matrix4() },
      uViewToLocal: { value: new THREE.Matrix3() },
      uViewport: { value: new THREE.Vector2(1, 1) },
      uSteps: { value: steps },
      uGain: { value: 1 },
      uJitterSeed: { value: 0 },
      uSeed: { value: (o.id.length * 7.3 + o.pc * 0.013) % 97 },
      uOct: { value: octaves },
      uStars: { value: uStars },
      uNStars: { value: stars.length },
      H_ALPHA: { value: colour(lineRGB, 656.28) },
      H_BETA: { value: colour(lineRGB, 486.13) },
      O_III: { value: colour(lineRGB, 500.68) },
      N_II: { value: colour(lineRGB, 658.35) },
      // Synchrotron: a power-law continuum rising to the blue, much like a
      // very hot body's in the visible — 25,000 K through the same path.
      SYNCHROTRON: { value: colour(blackbodyRGB, 25000) },
      // Scattered starlight is the stars' own light, bluer by lambda^-4.
      REFLECTION: { value: colour(blackbodyRGB, 40000) },
      STARLIGHT: { value: colour(blackbodyRGB, 20000) },
    },
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

export { DEG }
