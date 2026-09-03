import * as THREE from 'three'
import { BODIES } from '../sim/constants.js'

/**
 * Single-scattering volumetric atmosphere — Rayleigh plus Mie, raymarched.
 *
 * Two decisions shape this.
 *
 * It is a **shell mesh**, not a post-process. A fullscreen pass would have to
 * reconstruct world position from the depth buffer, and this renderer runs a
 * *logarithmic* depth buffer — so that reconstruction would mean inverting
 * three's log encoding and would break silently if that setting ever changed.
 * A shell is depth-tested by the GPU for free, so geometry in front of the
 * atmosphere occludes it correctly with no depth maths at all, and it only
 * shades the pixels the atmosphere actually covers.
 *
 * And the march runs in **planet radii**, not scene units. Every length below is
 * normalised by Earth's radius, so the shader never handles a large coordinate
 * and float32 precision is a non-issue regardless of where the planet sits.
 *
 * The model is the standard Nishita/O'Neil single-scattering integral: march the
 * view ray, and at each sample march a second ray toward the sun to find how
 * much light survives to that point.
 */

const Re = BODIES.earth.radius

/**
 * The real atmosphere is 100 km on a 6371 km planet — 1.57% of the radius, and
 * under two pixels wide at the distance you normally view Earth from here. That
 * is truthful and invisible.
 *
 * So the shell is rendered thicker by this factor, in the same declared way the
 * rest of the scene exaggerates radii. Crucially the scale heights are stretched
 * by the *same* factor, so the density profile keeps its shape and the
 * scattering coefficients stay untouched: the atmosphere is taller, not
 * differently coloured.
 */
export const THICKNESS_EXAGGERATION = 3.5

const REAL_TOP = 100e3

/** Atmosphere top, in planet radii, as rendered. */
export const ATMOSPHERE_RADIUS = (Re + REAL_TOP * THICKNESS_EXAGGERATION) / Re

/**
 * Scattering coefficients at sea level, per metre, converted to per planet
 * radius. Rayleigh's steep wavelength dependence — roughly 1/lambda^4 — is the
 * entire reason the sky is blue and the sunset is red; blue is scattered out of
 * the direct beam nearly six times as strongly as red.
 */
const BETA_RAYLEIGH = new THREE.Vector3(5.8e-6, 13.5e-6, 33.1e-6).multiplyScalar(Re)
const BETA_MIE = 21e-6 * Re

/** Density scale heights, in planet radii. */
const H_RAYLEIGH = (8000 * THICKNESS_EXAGGERATION) / Re
const H_MIE = (1200 * THICKNESS_EXAGGERATION) / Re

const VERT = /* glsl */ `
  varying vec3 vWorldPos;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorldPos = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`

const FRAG = /* glsl */ `
  #define PI 3.141592653589793

  uniform vec3  uCamToPlanet;   // camera relative to planet centre, in planet radii
  uniform vec3  uPlanetCentre;  // scene units, for building the view ray
  uniform float uSceneRadius;   // rendered planet radius, scene units
  uniform vec3  uSunDir;
  uniform float uAtmosRadius;
  uniform vec3  uBetaR;
  uniform float uBetaM;
  uniform float uHr;
  uniform float uHm;
  uniform float uG;
  uniform float uIntensity;

  varying vec3 vWorldPos;

  /** Entry and exit parameters of a ray against a sphere at the origin. */
  vec2 raySphere(vec3 ro, vec3 rd, float radius) {
    float b = dot(ro, rd);
    float c = dot(ro, ro) - radius * radius;
    float d = b * b - c;
    if (d < 0.0) return vec2(1.0, -1.0); // miss: far < near
    d = sqrt(d);
    return vec2(-b - d, -b + d);
  }

  void main() {
    // Direction only, so this is scale-invariant and can be taken in scene units.
    vec3 rd = normalize(vWorldPos - cameraPosition);
    vec3 ro = uCamToPlanet;

    vec2 atmos = raySphere(ro, rd, uAtmosRadius);
    if (atmos.y <= 0.0 || atmos.x > atmos.y) discard;

    float tStart = max(atmos.x, 0.0);
    float tEnd = atmos.y;

    // The ground truncates the march. Solving this analytically rather than
    // from the depth buffer is what keeps the whole pass independent of the
    // logarithmic depth encoding.
    vec2 ground = raySphere(ro, rd, 1.0);
    if (ground.x > 0.0 && ground.x < ground.y) tEnd = min(tEnd, ground.x);
    if (tEnd <= tStart) discard;

    float segment = (tEnd - tStart) / float(VIEW_SAMPLES);
    float t = tStart + segment * 0.5;

    vec3 sumR = vec3(0.0);
    vec3 sumM = vec3(0.0);
    float odR = 0.0;
    float odM = 0.0;

    for (int i = 0; i < VIEW_SAMPLES; i++) {
      vec3 p = ro + rd * t;
      float h = length(p) - 1.0;

      float dR = exp(-h / uHr) * segment;
      float dM = exp(-h / uHm) * segment;
      odR += dR;
      odM += dM;

      // Second march toward the sun: how much light reaches this sample.
      vec2 lightSpan = raySphere(p, uSunDir, uAtmosRadius);
      float lSeg = lightSpan.y / float(LIGHT_SAMPLES);
      float lt = lSeg * 0.5;
      float odLR = 0.0;
      float odLM = 0.0;
      bool blocked = false;

      for (int j = 0; j < LIGHT_SAMPLES; j++) {
        float lh = length(p + uSunDir * lt) - 1.0;
        if (lh < 0.0) { blocked = true; break; } // the planet is in the way
        odLR += exp(-lh / uHr) * lSeg;
        odLM += exp(-lh / uHm) * lSeg;
        lt += lSeg;
      }

      if (!blocked) {
        // Extinction along the full path: sun to sample, then sample to eye.
        // Mie's extinction runs about 10% above its scattering coefficient.
        vec3 tau = uBetaR * (odR + odLR) + uBetaM * 1.1 * (odM + odLM);
        vec3 attenuation = exp(-tau);
        sumR += attenuation * dR;
        sumM += attenuation * dM;
      }
      t += segment;
    }

    float mu = dot(rd, uSunDir);
    float mu2 = mu * mu;
    float g = uG;
    float g2 = g * g;

    // Rayleigh scatters nearly symmetrically; Mie throws light sharply forward,
    // which is what puts the white glare around the sun near the horizon.
    float phaseR = (3.0 / (16.0 * PI)) * (1.0 + mu2);
    float phaseM =
      (3.0 / (8.0 * PI)) * ((1.0 - g2) * (1.0 + mu2)) /
      ((2.0 + g2) * pow(max(1.0 + g2 - 2.0 * g * mu, 1e-4), 1.5));

    vec3 colour = (sumR * uBetaR * phaseR + sumM * uBetaM * phaseM) * uIntensity;
    gl_FragColor = vec4(colour, 1.0);
  }
`

export function makeVolumetricAtmosphere({ viewSamples = 14, lightSamples = 7 } = {}) {
  const material = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    defines: { VIEW_SAMPLES: viewSamples, LIGHT_SAMPLES: lightSamples },
    uniforms: {
      uCamToPlanet: { value: new THREE.Vector3(0, 0, 2) },
      uPlanetCentre: { value: new THREE.Vector3() },
      uSceneRadius: { value: 1 },
      uSunDir: { value: new THREE.Vector3(1, 0, 0) },
      uAtmosRadius: { value: ATMOSPHERE_RADIUS },
      uBetaR: { value: BETA_RAYLEIGH.clone() },
      uBetaM: { value: BETA_MIE },
      uHr: { value: H_RAYLEIGH },
      uHm: { value: H_MIE },
      uG: { value: 0.758 },
      uIntensity: { value: 6 },
    },
    // Inscattered light adds to whatever is behind it, and the shell must never
    // occlude the planet it wraps. DoubleSide so a fragment still exists once
    // the camera descends inside the atmosphere.
    side: THREE.DoubleSide,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  })
  return material
}
