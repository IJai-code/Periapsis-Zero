import * as THREE from 'three'
import { BODIES } from '../sim/constants.js'
import { scalarUniform } from './scalarUniform.js'

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
 * rest of the scene exaggerates radii. The scale heights are stretched by the
 * *same* factor, so the density profile keeps its shape and the scattering
 * coefficients stay untouched.
 *
 * That makes it taller and — the original comment here said otherwise — also
 * *thicker*, and from the ground the difference is the whole picture. A column
 * of air is its coefficient times its scale height, so stretching one and not
 * the other multiplies every vertical optical depth by 3.5: at the zenith, blue
 * goes from 0.27 to 0.93. Seen from space that is the price of a limb you can
 * see at all. Standing in it, it turns a Sun 38 degrees up into the colour of
 * one 10 degrees up — the sky rendered as dusk at mid-morning, pale green
 * overhead and orange along the horizon. So the stretch is not a constant: see
 * `stretchAtmosphere`, which takes it back to the true profile as the camera
 * descends into the real air.
 */
const X_SPACE = 3.5
export const THICKNESS_EXAGGERATION = X_SPACE

const REAL_TOP = 100e3

/** Atmosphere top, in planet radii, as rendered from space — the shell's own radius. */
export const ATMOSPHERE_RADIUS = (Re + REAL_TOP * THICKNESS_EXAGGERATION) / Re

/**
 * Scattering coefficients at sea level, per metre, converted to per planet
 * radius. Rayleigh's steep wavelength dependence — roughly 1/lambda^4 — is the
 * entire reason the sky is blue and the sunset is red; blue is scattered out of
 * the direct beam nearly six times as strongly as red.
 */
export const BETA_RAYLEIGH = new THREE.Vector3(5.8e-6, 13.5e-6, 33.1e-6).multiplyScalar(Re)
export const BETA_MIE = 21e-6 * Re

/** Mie asymmetry: how sharply the haze throws light forward, into the Sun's glare. */
export const MIE_G = 0.758

/**
 * Samples along the view ray, and along each sample's ray to the Sun. Exported
 * so `skyGlow.js`, which works out on the CPU how bright the sky over the
 * camera is, marches exactly the ray this does.
 */
export const VIEW_SAMPLES = 14
export const LIGHT_SAMPLES = 7

/** Density scale heights, in planet radii, as rendered from space. */
const H_RAYLEIGH = (8000 * THICKNESS_EXAGGERATION) / Re
const H_MIE = (1200 * THICKNESS_EXAGGERATION) / Re

/**
 * How the samples are spaced along a ray: `t = u^WARP` once the camera is in
 * the air, uniform from outside it. Standing on the ground, the air a ray
 * passes through is densest at its start — the true scale height is 8 km and
 * the march is hundreds long — and fourteen evenly spaced samples put the first
 * of them kilometres up, past most of what scatters. Measured against a march
 * of 3000 by 600 at the shader's own 14 by 7: evenly spaced is 18% out at the
 * zenith and up to 61% within 30 degrees of the Sun; `u^3` is 1 to 6% over
 * everything above 15 degrees, 10 to 15% at 5, and 22 to 27% at half a degree,
 * where a ray grazes a thousand kilometres of the densest air there is.
 *
 * The positions are the same for every pixel — they depend on the sample's
 * index and on how far into the air the camera is, and on nothing about the
 * ray — so they are worked out here once a frame and handed to the shader as
 * four short arrays, rather than recomputed at every sample of every pixel.
 * Recomputed in the shader they measured 15% of the frame: 11.5 to 11.9 ms
 * against the original's 9.8 to 11.1, the sky filling a 2048 x 1536 view from
 * the ground.
 */
const W = 3
export const WARP = W

/*
 * `near` for `spaceSamples`, in a slot rather than an argument: it is called
 * every frame of an ascent, and a double handed to a function V8 does not
 * inline is boxed at the call.
 */
const spacingNear = new Float64Array(1)

/** Fill a march's midpoints and lengths, as fractions of its span, for `spacingNear`. */
function spaceSamples(mid, seg) {
  const near = spacingNear[0]
  const n = mid.length
  let a = 0
  for (let i = 0; i < n; i++) {
    const u = (i + 1) / n
    const b = u * (1 - near) + Math.pow(u, W) * near
    mid[i] = 0.5 * (a + b)
    seg[i] = b - a
    a = b
  }
}

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
  // Where each sample falls along its ray, and how much of it it stands for,
  // as fractions of the span: see WARP.
  uniform float uViewMid[VIEW_SAMPLES];
  uniform float uViewSeg[VIEW_SAMPLES];
  uniform float uLightMid[LIGHT_SAMPLES];
  uniform float uLightSeg[LIGHT_SAMPLES];

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

    float span = tEnd - tStart;

    vec3 sumR = vec3(0.0);
    vec3 sumM = vec3(0.0);
    float odR = 0.0;
    float odM = 0.0;

    for (int i = 0; i < VIEW_SAMPLES; i++) {
      // The midpoint of the i-th interval. Evenly spaced, as it always was from
      // outside; bunched toward the eye from within.
      float segment = uViewSeg[i] * span;
      float t = tStart + uViewMid[i] * span;
      vec3 p = ro + rd * t;
      float h = length(p) - 1.0;

      float dR = exp(-h / uHr) * segment;
      float dM = exp(-h / uHm) * segment;
      odR += dR;
      odM += dM;

      // Second march toward the sun: how much light reaches this sample.
      vec2 lightSpan = raySphere(p, uSunDir, uAtmosRadius);
      float odLR = 0.0;
      float odLM = 0.0;
      bool blocked = false;

      for (int j = 0; j < LIGHT_SAMPLES; j++) {
        float lSeg = uLightSeg[j] * lightSpan.y;
        float lh = length(p + uSunDir * (uLightMid[j] * lightSpan.y)) - 1.0;
        if (lh < 0.0) { blocked = true; break; } // the planet is in the way
        odLR += exp(-lh / uHr) * lSeg;
        odLM += exp(-lh / uHm) * lSeg;
      }

      if (!blocked) {
        // Extinction along the full path: sun to sample, then sample to eye.
        // Mie's extinction runs about 10% above its scattering coefficient.
        vec3 tau = uBetaR * (odR + odLR) + uBetaM * 1.1 * (odM + odLM);
        vec3 attenuation = exp(-tau);
        sumR += attenuation * dR;
        sumM += attenuation * dM;
      }
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

export function makeVolumetricAtmosphere({ viewSamples = VIEW_SAMPLES, lightSamples = LIGHT_SAMPLES } = {}) {
  const viewMid = new Float32Array(viewSamples)
  const viewSeg = new Float32Array(viewSamples)
  const lightMid = new Float32Array(lightSamples)
  const lightSeg = new Float32Array(lightSamples)
  spacingNear[0] = 0
  spaceSamples(viewMid, viewSeg)
  spaceSamples(lightMid, lightSeg)
  const material = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    defines: { VIEW_SAMPLES: viewSamples, LIGHT_SAMPLES: lightSamples },
    uniforms: {
      uCamToPlanet: { value: new THREE.Vector3(0, 0, 2) },
      uPlanetCentre: { value: new THREE.Vector3() },
      uSceneRadius: { value: 1 },
      uSunDir: { value: new THREE.Vector3(1, 0, 0) },
      // The four stretchAtmosphere rewrites every frame, built so writing them
      // allocates nothing — see gfx/scalarUniform.js.
      uAtmosRadius: scalarUniform(ATMOSPHERE_RADIUS),
      uBetaR: { value: BETA_RAYLEIGH.clone() },
      uBetaM: { value: BETA_MIE },
      uHr: scalarUniform(H_RAYLEIGH),
      uHm: scalarUniform(H_MIE),
      uG: { value: MIE_G },
      uIntensity: { value: 6 },
      // Not read by the shader, which takes the spacing it implies from the
      // four arrays below; kept as the record of it, for skyGlow.js and gates.
      uNear: scalarUniform(0),
      uViewMid: { value: viewMid },
      uViewSeg: { value: viewSeg },
      uLightMid: { value: lightMid },
      uLightSeg: { value: lightSeg },
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

const REAL_TOP_R = REAL_TOP / Re

/**
 * Set the stretch for where the camera is. Call after `uCamToPlanet` is written.
 *
 * At and above the real atmosphere's top, 100 km, it is the 3.5 the shell was
 * always drawn with — the same three expressions as the constants above, so
 * every uniform is bit-for-bit what it was and nothing seen from orbit or from
 * the Moon changes. On the ground it is 1, the true profile: optical depths are
 * the real ones and the sky is the colour the real one is. In between it eases
 * across the 100 km with a smoothstep, so a camera riding a vehicle up through
 * the air watches the one become the other rather than seeing it switch.
 *
 * The top of the march comes down with it, from 350 km to the real 100, which
 * is what lets fourteen samples resolve an 8 km scale height at all; the shell
 * mesh stays at its full radius, and a ray from inside it simply starts in air
 * and finishes above it.
 *
 * Reads the camera from the uniform rather than taking an altitude argument,
 * for the reason `gfx/groundView.js` gives: a double handed to a function V8
 * does not inline is boxed at the call.
 */
export function stretchAtmosphere(material) {
  const u = material.uniforms
  const c = u.uCamToPlanet.value
  const h = (Math.sqrt(c.x * c.x + c.y * c.y + c.z * c.z) - 1) / REAL_TOP_R
  let x = X_SPACE
  let near = 0
  if (h < 1) {
    const k = h > 0 ? h : 0
    const up = k * k * (3 - 2 * k)
    near = 1 - up
    x = 1 + (X_SPACE - 1) * up
  }
  // Written as the constants are, operation for operation, so that at 3.5
  // they round to the same bits rather than to within one of them.
  u.uHr.value = (8000 * x) / Re
  u.uHm.value = (1200 * x) / Re
  u.uAtmosRadius.value = (Re + REAL_TOP * x) / Re
  // The sample positions follow `near`, and are rewritten only when it moves —
  // never in orbit, where it is exactly zero; on the ground it moves in its
  // tenth decimal as the camera's height wobbles by the metre it is resolved
  // to, which costs twenty-one powers.
  if (near !== u.uNear.value) {
    u.uNear.value = near
    spacingNear[0] = near
    spaceSamples(u.uViewMid.value, u.uViewSeg.value)
    spaceSamples(u.uLightMid.value, u.uLightSeg.value)
  }
}
