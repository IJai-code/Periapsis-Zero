import * as THREE from 'three'
import { NOISE_GLSL } from './glsl/noise.js'
import { blackbodyRGB } from './stars.js'

/**
 * The surface of a star close enough to have one.
 *
 * Three things make a photosphere look like one, and all three follow from
 * what the star is:
 *
 *   - **Colour** is the blackbody at its effective temperature, through the
 *     same Planck-and-CIE path the star field uses.
 *   - **Limb darkening**: the disc's edge shows cooler, higher layers. The
 *     linear law I(mu) = 1 − u (1 − mu) with u running from about 0.45 for a
 *     hot star to 0.8 for a cool giant in the visible (Claret 2000), read here
 *     off the temperature, and the edge reddens with it.
 *   - **Granulation** is convection, and its cell size scales with the
 *     pressure scale height, H ∝ T / g. A dwarf like the Sun has millions of
 *     cells a thousand kilometres across; a red supergiant has a handful, each
 *     a sizeable fraction of the star — which is what interferometric images
 *     of Betelgeuse show. So the cell count across the disc is set from the
 *     surface gravity, and a supergiant boils in a few great patches.
 *
 * Cool stars carry starspots; hot ones do not. The output is HDR, as the Sun's
 * is, so the bloom pass does the glare.
 */

const VERT = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>
  varying vec3 vN;
  varying vec3 vObj;
  varying vec3 vView;
  void main() {
    vObj = position;
    vN = normalize(normalMatrix * normal);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vView = -mv.xyz;
    gl_Position = projectionMatrix * mv;
    #include <logdepthbuf_vertex>
  }
`

const FRAG = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_fragment>
  ${NOISE_GLSL}
  uniform vec3 uColor;
  uniform vec3 uCool;
  uniform float uIntensity;
  uniform float uLimb;
  uniform float uCells;
  uniform float uSpots;
  uniform float uTime;
  varying vec3 vN;
  varying vec3 vObj;
  varying vec3 vView;
  void main() {
    vec3 N = normalize(vN);
    vec3 V = normalize(vView);
    float mu = clamp(dot(N, V), 0.0, 1.0);
    vec3 d = normalize(vObj);
    float fp = length(fwidth(d));
    // Convection: cells that turn over slowly, bright centres and dark lanes.
    vec4 w = worley(d * uCells + vec3(0.0, uTime * 0.02, 0.0));
    float cell = smoothstep(0.0, 0.9, w.x);
    float fade = clamp(1.0 / (uCells * fp * 4.0) - 0.2, 0.0, 1.0);
    float gran = mix(1.0, 1.12 - 0.3 * cell, fade);
    gran *= 0.92 + 0.16 * fbmAA(d * uCells * 0.35, 1.0, 4, fp * uCells * 0.35, 0.55);
    // Starspots on cool stars: dark umbrae in the active latitudes.
    float spot = uSpots * smoothstep(0.35, 0.6, fbmAA(d * 3.0 + 11.0, 1.0, 3, fp * 3.0, 0.5)) * (1.0 - smoothstep(0.3, 0.8, abs(d.y)));
    float limb = 1.0 - uLimb * (1.0 - mu);
    vec3 c = mix(uCool, uColor, pow(mu, 0.45)) * limb * gran * (1.0 - spot * 0.7);
    gl_FragColor = vec4(c * uIntensity, 1.0);
    #include <logdepthbuf_fragment>
  }
`

/*
 * The glare round a star: a billboard behind it, falling off with height
 * above the limb as the Sun's corona does in eclipse photographs — steeply,
 * then slowly — drawn first so the photosphere covers its middle. A shell
 * round the sphere did this before and, with no depth precision left at ten
 * million kilometres, drew its far side straight through the disc.
 */
const GLOW_VERT = /* glsl */ `
  varying vec2 vP;
  uniform float uReach;
  void main() {
    vP = position.xy * uReach;
    vec4 c = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
    float s = length(modelMatrix[0].xyz);
    c.xy += position.xy * uReach * s;
    gl_Position = projectionMatrix * c;
    gl_Position.z = 0.999 * gl_Position.w;
  }
`
const GLOW_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uIntensity;
  varying vec2 vP;
  void main() {
    float r = length(vP);
    if (r < 0.98) discard;
    float h = r - 1.0;
    float g = 0.22 * exp(-h / 0.05) + 0.25 * exp(-h / 0.5) + 0.05 / (1.0 + h * h * 4.0);
    g *= 1.0 - smoothstep(0.8, 1.0, r / 7.0);
    gl_FragColor = vec4(uColor * g * uIntensity, 1.0);
  }
`

/** The glare material; its quad spans uReach stellar radii each way. */
export function makeGlowMaterial() {
  return new THREE.ShaderMaterial({
    vertexShader: GLOW_VERT,
    fragmentShader: GLOW_FRAG,
    uniforms: { uColor: { value: new THREE.Color(1, 1, 1) }, uIntensity: { value: 0.6 }, uReach: { value: 7 } },
    transparent: false,
    depthTest: false,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  })
}

const _rgb = [0, 0, 0]

/** A photosphere material for a star of effective temperature T and surface gravity log g (cgs). */
export function makeStarMaterial() {
  return new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      uColor: { value: new THREE.Color(1, 1, 1) },
      uCool: { value: new THREE.Color(1, 0.6, 0.3) },
      uIntensity: { value: 3 },
      uLimb: { value: 0.6 },
      uCells: { value: 60 },
      uSpots: { value: 0 },
      uTime: { value: 0 },
    },
    toneMapped: false,
  })
}

/**
 * Set a star material for a star. `logg` from mass and radius; the cell count
 * scales as the inverse of the pressure scale height in stellar radii,
 * pinned at the Sun's ~2 x 10^6 granules — about 1,400 across the disc — and
 * held between a handful and what a pixel can show.
 */
export function tuneStar(material, T, radiusSun, massSun = 1) {
  const u = material.uniforms
  blackbodyRGB(_rgb, T)
  u.uColor.value.setRGB(_rgb[0], _rgb[1], _rgb[2])
  blackbodyRGB(_rgb, T * 0.82)
  u.uCool.value.setRGB(_rgb[0], _rgb[1], _rgb[2])
  u.uLimb.value = Math.min(0.85, Math.max(0.4, 0.6 + (5772 - T) / 12000))
  // H / R ∝ T R / M: the Sun's granules are ~1/700 of its radius across.
  const hOverR = (T / 5772) * (radiusSun / massSun) / 700
  u.uCells.value = Math.min(240, Math.max(3, 1 / Math.max(hOverR, 1e-6) / 12))
  u.uSpots.value = T < 4500 ? 0.6 : T < 5400 ? 0.25 : 0
  // Surface brightness climbs as T^4 — Sirius's is ten times the Sun's,
  // Betelgeuse's a sixth — which no display holds with a limb and a granule
  // left in it. So it is compressed hard, as T to the quarter, around a level
  // the renderer's ACES curve still passes with its hue — much brighter and
  // ACES bleaches an orange giant to tan — and the glare billboard carries
  // the rest.
  u.uIntensity.value = 0.95 * Math.pow(T / 5772, 0.25)
}
