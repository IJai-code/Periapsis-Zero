import * as THREE from 'three'
import { NOISE_GLSL } from './glsl/noise.js'
import { PHOTOMETRY, RECIPES, WORLD_COMMON } from './glsl/worlds.js'
import { scalarUniform } from './scalarUniform.js'

/**
 * Materials for the worlds on rails: the surface, the rings, the air.
 *
 * All three are lit in view space by the direction to the Sun, written every
 * frame by `components/Planets.jsx`, at an irradiance that follows the light
 * the way a camera's exposure does (see `SUN_ADAPTATION` there). Each writes
 * logarithmic depth like everything else in the scene, so a moon passes behind
 * its planet and a ring in front of it without either having to know.
 *
 * Shadows are analytic, because there is no shadow map at these distances
 * (Sun.jsx explains why there cannot be one): the rings' shadow on the planet
 * and the planet's on the rings are ray–plane and ray–sphere tests against the
 * same ring profile the rings are drawn from, and a moon's shadow on its
 * planet is a ray's distance from the moon's centre. Io's shadow crosses
 * Jupiter's cloud tops the way it does in the Voyager films.
 */

/* ------------------------------------------------------------------ *
 * Ring profiles — shared by the rings and by the planet they shadow
 * ------------------------------------------------------------------ */

/**
 * Optical depth and colour against radius, metres. Saturn's from Cassini's
 * occultations: the faint D and C rings, the dense B ring, the Cassini
 * Division, the A ring with the Encke and Keeler gaps, the narrow F ring.
 * Uranus's are the nine narrow rings Elliot found in 1977 plus the epsilon,
 * dark as charcoal. Neptune's are the Galle, Le Verrier and Adams rings, the
 * last with its arcs. Jupiter's is the faint main ring. Radial structure below
 * a ring's own scale is noise in radius — ringlets, density waves.
 */
/**
 * `ringBlur` is the radial width of one pixel, km, set by the caller from
 * `fwidth` of the radius. Every profile is filtered by it — a narrow ring is
 * widened and dimmed to the pixel it falls in, keeping its integrated opacity —
 * because a 2 km ring sampled by a 400 km pixel is otherwise a row of dots.
 */
const RING_BLUR = /* glsl */ `
  float ringBlur = 0.0;
  float thin(float r, float c, float w) {
    float we = sqrt(w * w + ringBlur * ringBlur);
    return exp(-pow((r - c) / we, 2.0)) * (w / we);
  }
`

const RING_PROFILES = {
  saturn: /* glsl */ `
    ${RING_BLUR}
    float band(float r, float a, float b, float soft) {
      float s = max(soft, ringBlur);
      return smoothstep(a - s, a + s, r) * (1.0 - smoothstep(b - s, b + s, r));
    }
    vec4 ringAt(float rm) {
      float r = rm * 1e-3; // km
      float keep1 = 1.0 - smoothstep(20.0, 90.0, ringBlur);
      float keep2 = 1.0 - smoothstep(5.0, 25.0, ringBlur);
      float fine = snoise(vec3(r * 0.011, 0.5, 0.2)) * 0.5 + (snoise(vec3(r * 0.047, 1.7, -0.4)) * 0.3) * keep1 + (snoise(vec3(r * 0.19, -2.1, 0.9)) * 0.2) * keep2;
      float tau = 0.0;
      vec3 col = vec3(0.0);
      float d = band(r, 66900.0, 74510.0, 300.0) * 0.004;
      float c = band(r, 74658.0, 92000.0, 150.0) * (0.09 + 0.05 * fine + 0.1 * band(r, 84500.0, 90500.0, 400.0));
      float bRing = band(r, 92000.0, 117580.0, 80.0) * (1.6 + 0.9 * fine + 1.2 * band(r, 99000.0, 104500.0, 800.0));
      float cas = band(r, 117580.0, 122170.0, 60.0) * (0.08 + 0.05 * fine);
      float aRing = band(r, 122170.0, 136775.0, 60.0) * (0.55 + 0.2 * fine);
      aRing *= 1.0 - band(r, 133423.0, 133745.0, 15.0) * 0.97;   // Encke gap
      aRing *= 1.0 - band(r, 136485.0, 136527.0, 6.0) * 0.95;    // Keeler gap
      float f = thin(r, 140180.0, 45.0) * 0.5;
      tau = d + c + bRing + cas + aRing + f;
      col += SRGB(0.62, 0.58, 0.54) * (d + c) + SRGB(0.86, 0.79, 0.66) * bRing + SRGB(0.55, 0.53, 0.52) * cas + SRGB(0.80, 0.75, 0.66) * aRing + SRGB(0.85, 0.83, 0.80) * f;
      col /= max(tau, 1e-4);
      return vec4(col, tau);
    }
  `,
  uranus: /* glsl */ `
    ${RING_BLUR}
    vec4 ringAt(float rm) {
      float r = rm * 1e-3;
      float tau = 0.0;
      tau += thin(r, 41837.0, 2.0) + thin(r, 42234.0, 2.0) + thin(r, 42571.0, 2.0);
      tau += thin(r, 44718.0, 5.0) + thin(r, 45661.0, 5.0) + thin(r, 47176.0, 1.5);
      tau += thin(r, 47627.0, 2.0) + thin(r, 48300.0, 3.0) + thin(r, 50023.0, 1.5) * 0.3;
      tau += thin(r, 51149.0, 30.0) * 1.8;
      return vec4(SRGB(0.30, 0.30, 0.30), tau * 0.9);
    }
  `,
  neptune: /* glsl */ `
    ${RING_BLUR}
    vec4 ringAt(float rm) {
      float r = rm * 1e-3;
      float tau = thin(r, 41900.0, 800.0) * 0.004 + thin(r, 53200.0, 60.0) * 0.02 + thin(r, 55200.0, 1600.0) * 0.002 + thin(r, 62932.0, 25.0) * 0.03;
      return vec4(SRGB(0.45, 0.43, 0.42), tau);
    }
  `,
  jupiter: /* glsl */ `
    ${RING_BLUR}
    vec4 ringAt(float rm) {
      float r = rm * 1e-3;
      float tau = smoothstep(122000.0, 123500.0, r) * (1.0 - smoothstep(128000.0, 129200.0, r)) * 0.004;
      return vec4(SRGB(0.62, 0.52, 0.44), tau);
    }
  `,
}

/* ------------------------------------------------------------------ *
 * The surface
 * ------------------------------------------------------------------ */

const SURFACE_VERT = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>
  varying vec3 vObj;
  varying vec3 vPosV;
  varying vec3 vNormalV;
  void main() {
    vObj = position;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vPosV = mv.xyz;
    vNormalV = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * mv;
    #include <logdepthbuf_vertex>
  }
`

function photometryGlsl(recipe) {
  const ph = PHOTOMETRY[recipe] ?? { model: 'lambert' }
  const wrap = (ph.wrap ?? 0).toFixed(3)
  if (ph.model === 'cloud') {
    const k = ph.minnaert.toFixed(3)
    return /* glsl */ `
      float photometry(float mu0, float mu, float cosPhase) {
        float i = max((mu0 + ${wrap}) / (1.0 + ${wrap}), 0.0);
        return pow(i, ${k}) * pow(max(mu, 0.02), ${k} - 1.0);
      }`
  }
  if (ph.model === 'regolith' || ph.model === 'ice') {
    // Lommel–Seeliger blended with Lambert, and an opposition surge.
    const ls = ph.model === 'ice' ? '0.45' : '0.75'
    return /* glsl */ `
      float photometry(float mu0, float mu, float cosPhase) {
        if (mu0 <= 0.0) return 0.0;
        float lsl = 2.0 * mu0 / (mu0 + max(mu, 1e-3));
        float phase = acos(clamp(cosPhase, -1.0, 1.0));
        float surge = 1.0 + 0.45 * exp(-phase / 0.06);
        return mix(mu0, lsl * 0.5, ${ls}) * surge;
      }`
  }
  return /* glsl */ `
    float photometry(float mu0, float mu, float cosPhase) {
      return max((mu0 + ${wrap}) / (1.0 + ${wrap}), 0.0);
    }`
}

function surfaceFrag(recipe, ringProfile, flags) {
  return /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_fragment>
  ${NOISE_GLSL}
  ${WORLD_COMMON}
  ${flags}
  ${ringProfile ?? ''}
  ${RECIPES[recipe]}
  ${photometryGlsl(recipe)}

  uniform vec3 uSunDirV;
  uniform float uIrradiance;
  uniform vec3 uCenterV;
  uniform vec3 uPoleV;
  uniform vec2 uRingRadii;
  uniform vec4 uCasters[4];
  uniform int uCasterCount;
  uniform float uSunAngle;
  uniform vec4 uParentV;
  uniform vec3 uShineDirV;
  uniform float uShine;
  varying vec3 vObj;
  varying vec3 vPosV;
  varying vec3 vNormalV;

  /** Normal from a height field in metres, by screen-space derivatives. */
  vec3 bump(vec3 pos, vec3 n, float h) {
    vec3 dpdx = dFdx(pos);
    vec3 dpdy = dFdy(pos);
    float dhdx = dFdx(h);
    float dhdy = dFdy(h);
    vec3 r1 = cross(dpdy, n);
    vec3 r2 = cross(n, dpdx);
    float det = dot(dpdx, r1);
    vec3 grad = sign(det) * (dhdx * r1 + dhdy * r2);
    vec3 b = abs(det) * n - grad;
    float l = length(b);
    return l > 1e-20 ? b / l : n;
  }

  /** How much of the Sun a sphere of radius r at c hides from p: a soft disc. */
  float occultation(vec3 p, vec3 L, vec3 c, float r) {
    vec3 d = c - p;
    float t = dot(d, L);
    if (t <= 0.0) return 0.0;
    float miss = length(d - L * t);
    float pen = t * uSunAngle; // penumbra width at that distance
    return 1.0 - smoothstep(r - pen, r + pen, miss);
  }

  void main() {
    #include <logdepthbuf_fragment>
    vec3 p = normalize(vObj);
    float fp = max(length(fwidth(p)), 1e-7);
    vec3 albedo;
    float h;
    surface(p, fp, albedo, h);
    #ifdef ICE_DETAIL
    // Fractured/frosted relief below the regional recipe, anti-aliased by
    // footprint. This is synthetic ice texture, not mapped geology.
    float frost = fbmAA(p + 19.7, 2400.0, int(uOct) + 2, fp, 0.55);
    float cracks = crease(p + 7.1, 1800.0, 0.035, fp);
    albedo *= 1.0 + frost * 0.08 - cracks * 0.08;
    h += frost * 12.0 - cracks * 18.0;
    #endif
    vec3 N = normalize(vNormalV);
    if (!gl_FrontFacing) N = -N;
    N = bump(vPosV, N, h);
    vec3 L = normalize(uSunDirV);
    vec3 V = normalize(-vPosV);
    float mu0 = dot(N, L);
    float mu = max(dot(N, V), 0.0);
    float light = photometry(mu0, mu, dot(L, V));

    float shade = 1.0;
    #ifdef HAS_RING
    {
      // The rings' shadow: where the ray to the Sun crosses the ring plane.
      // Radius and its footprint are taken before any branch, where
      // derivatives are still defined.
      float den = dot(L, uPoleV);
      float sden = abs(den) > 1e-4 ? den : 1e-4;
      float t = dot(uCenterV - vPosV, uPoleV) / sden;
      float r = length(vPosV + L * t - uCenterV);
      ringBlur = fwidth(r) * 1e-3;
      if (t > 0.0 && abs(den) > 1e-4 && r > uRingRadii.x && r < uRingRadii.y) {
        vec4 ring = ringAt(r);
        shade *= exp(-ring.w / max(abs(den), 0.05));
      }
    }
    #endif
    for (int i = 0; i < 4; i++) {
      if (i >= uCasterCount) break;
      shade *= 1.0 - occultation(vPosV, L, uCasters[i].xyz, uCasters[i].w);
    }
    #ifdef HAS_PARENT
    shade *= 1.0 - occultation(vPosV, L, uParentV.xyz, uParentV.w);
    #endif

    vec3 col = albedo * uIrradiance * light * shade / PI;
    #ifdef HAS_PARENT
    // Planetshine: the lit face of the planet, lighting its moon's night side.
    col += albedo * uIrradiance * uShine * max(dot(N, normalize(uShineDirV)), 0.0) / PI;
    #endif
    gl_FragColor = vec4(col, 1.0);
  }
  `
}

/** Uniforms every body carries, written per frame by Planets.jsx. */
function bodyUniforms(look) {
  return {
    uSunDirV: { value: new THREE.Vector3(1, 0, 0) },
    uIrradiance: scalarUniform(1),
    uOct: scalarUniform(6),
    uTime: scalarUniform(0),
    uRadius: scalarUniform(look.equatorial),
    uCenterV: { value: new THREE.Vector3() },
    uPoleV: { value: new THREE.Vector3(0, 1, 0) },
    uRingRadii: { value: new THREE.Vector2(look.ring?.inner ?? 0, look.ring?.outer ?? 0) },
    uCasters: { value: [new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4()] },
    uCasterCount: { value: 0 },
    uSunAngle: scalarUniform(0.00465),
    uParentV: { value: new THREE.Vector4() },
    uShineDirV: { value: new THREE.Vector3(0, 1, 0) },
    uShine: scalarUniform(0),
    uCloudTurn: scalarUniform(0),
  }
}

export function makeSurfaceMaterial(look, { hasParent = false } = {}) {
  const recipe = look.recipe
  const flags = [
    look.ring ? '#define HAS_RING' : '',
    hasParent ? '#define HAS_PARENT' : '',
    recipe === 'phobos' ? '#define PHOBOS' : '',
    ['europa', 'ganymede', 'callisto', 'pluto'].includes(recipe) ? '#define ICE_DETAIL' : '',
  ].join('\n')
  const ringProfile = look.ring ? RING_PROFILES[look.ring.profile] : null
  return new THREE.ShaderMaterial({
    uniforms: bodyUniforms(look),
    vertexShader: SURFACE_VERT,
    fragmentShader: surfaceFrag(recipe, ringProfile, flags),
    toneMapped: false,
  })
}

/* ------------------------------------------------------------------ *
 * Rings
 * ------------------------------------------------------------------ */

const RING_VERT = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>
  varying vec3 vLocal;
  varying vec3 vPosV;
  void main() {
    vLocal = position;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vPosV = mv.xyz;
    gl_Position = projectionMatrix * mv;
    #include <logdepthbuf_vertex>
  }
`

function ringFrag(profile) {
  return /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_fragment>
  ${NOISE_GLSL}
  #define SRGB(r, g, b) pow(vec3(r, g, b), vec3(2.2))
  ${RING_PROFILES[profile]}
  uniform vec3 uSunDirV;
  uniform float uIrradiance;
  uniform vec3 uCenterV;
  uniform vec3 uPoleV;
  uniform float uPlanetRadius;
  uniform float uPlanetFlat;
  uniform float uSunAngle;
  varying vec3 vLocal;
  varying vec3 vPosV;

  void main() {
    #include <logdepthbuf_fragment>
    float r = length(vLocal.xy);
    ringBlur = fwidth(r) * 1e-3;
    vec4 ring = ringAt(r);
    float tau = ring.w;
    if (tau < 1e-5) discard;
    vec3 L = normalize(uSunDirV);
    vec3 V = normalize(-vPosV);
    float mu0 = dot(L, uPoleV);
    float mu = dot(V, uPoleV);
    float amu0 = max(abs(mu0), 0.02);
    float amu = max(abs(mu), 0.02);
    // Single scattering in a thin layer: lit face reflects, far face transmits.
    float cosPhase = dot(L, V);
    float forward = 1.0 + 3.5 * pow(max(-cosPhase, 0.0), 8.0);
    float sameSide = step(0.0, mu0 * mu);
    float reflectF = amu0 / (amu0 + amu) * (1.0 - exp(-tau * (1.0 / amu0 + 1.0 / amu)));
    float transF = abs(amu0 - amu) > 1e-3
      ? amu0 / (amu0 - amu) * (exp(-tau / amu0) - exp(-tau / amu))
      : tau / amu * exp(-tau / amu);
    float lit = mix(max(transF, 0.0) * forward, reflectF, sameSide);
    // The planet's shadow across the rings.
    vec3 d = uCenterV - vPosV;
    float t = dot(d, L);
    float shadow = 1.0;
    if (t > 0.0) {
      vec3 closest = d - L * t;
      // Flatten along the pole so the shadow has the oblate planet's shape.
      float along = dot(closest, uPoleV);
      vec3 rounded = closest + uPoleV * along * (1.0 / (1.0 - uPlanetFlat) - 1.0);
      float miss = length(rounded);
      float pen = t * uSunAngle;
      shadow = smoothstep(uPlanetRadius - pen, uPlanetRadius + pen, miss);
    }
    vec3 col = ring.rgb * uIrradiance * lit * shadow * 0.5 / PI * 3.0;
    float alpha = 1.0 - exp(-tau / amu);
    gl_FragColor = vec4(col, alpha);
  }
  `
}

export function makeRingMaterial(look) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uSunDirV: { value: new THREE.Vector3(1, 0, 0) },
      uIrradiance: scalarUniform(1),
      uCenterV: { value: new THREE.Vector3() },
      uPoleV: { value: new THREE.Vector3(0, 1, 0) },
      uPlanetRadius: scalarUniform(look.equatorial),
      uPlanetFlat: scalarUniform(1 - look.polar / look.equatorial),
      uSunAngle: scalarUniform(0.00465),
    },
    vertexShader: RING_VERT,
    fragmentShader: ringFrag(look.ring.profile),
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  })
}

/* ------------------------------------------------------------------ *
 * The air: a limb glow and a haze over the disc
 * ------------------------------------------------------------------ */

const AIR_VERT = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>
  varying vec3 vPosV;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vPosV = mv.xyz;
    gl_Position = projectionMatrix * mv;
    #include <logdepthbuf_vertex>
  }
`

/**
 * An exponential atmosphere, integrated along the view ray in closed form.
 * The column a ray passes through grows like the Chapman function as it grazes
 * the limb, which is what makes a limb glow a thin bright ring rather than a
 * uniform halo; the light it scatters is the sunlight reaching the point of
 * closest approach, softened across the terminator, and brightened toward the
 * Sun where small particles scatter forward — a backlit Titan wears a ring.
 */
const AIR_FRAG = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_fragment>
  uniform vec3 uSunDirV;
  uniform float uIrradiance;
  uniform vec3 uCenterV;
  uniform float uRadius;
  uniform float uTop;
  uniform float uScale;
  uniform vec3 uColour;
  uniform float uStrength;
  uniform vec3 uPoleV;
  uniform float uStretch;
  varying vec3 vPosV;

  /** Undo the oblateness: along the pole, stretch by a/b, so the body is round. */
  vec3 unsquash(vec3 v) { return v + uPoleV * dot(v, uPoleV) * (uStretch - 1.0); }

  void main() {
    #include <logdepthbuf_fragment>
    // The view ray, relative to the centre, in the space where the body is a sphere.
    vec3 o = unsquash(-uCenterV);
    vec3 dir = unsquash(normalize(vPosV));
    float dd = dot(dir, dir);
    vec3 D = dir / sqrt(dd);
    float t = -dot(o, D);
    vec3 cp = o + D * t;
    float b = length(cp);
    if (b > uTop) discard;
    float H = uScale;
    float column;
    vec3 at;
    vec3 V = D;
    if (b > uRadius) {
      // A grazing ray: the Chapman column through the whole shell.
      column = exp(-(b - uRadius) / H) * sqrt(2.0 * PI * uRadius * H);
      at = cp;
    } else {
      // Over the disc: the column down to the surface along this line of sight.
      float depth = sqrt(max(uRadius * uRadius - b * b, 0.0));
      vec3 surf = o + D * (t - depth);
      float mu = max(dot(normalize(surf), -D), 0.05);
      column = H / mu;
      at = surf;
    }
    vec3 L = normalize(uSunDirV);
    float cosZ = dot(normalize(at), L);
    float lit = smoothstep(-0.18, 0.25, cosZ);
    float g = dot(V, L);
    float phase = 0.6 + 0.4 * g * g + 1.6 * pow(max(g, 0.0), 6.0);
    float tau = column / (H * 22.0);
    float amount = (1.0 - exp(-tau)) * lit * phase * uStrength;
    vec3 col = uColour * amount * uIrradiance / PI;
    gl_FragColor = vec4(col, 1.0);
  }
`

export function makeAirMaterial(look) {
  const a = look.atmosphere
  const R = look.equatorial
  return new THREE.ShaderMaterial({
    uniforms: {
      uSunDirV: { value: new THREE.Vector3(1, 0, 0) },
      uIrradiance: scalarUniform(1),
      uCenterV: { value: new THREE.Vector3() },
      uRadius: scalarUniform(R),
      uTop: scalarUniform(R * (1 + a.height)),
      uScale: scalarUniform(R * a.height * 0.22),
      uColour: { value: new THREE.Color(...a.colour) },
      uStrength: scalarUniform(a.strength),
      uPoleV: { value: new THREE.Vector3(0, 1, 0) },
      uStretch: scalarUniform(look.equatorial / look.polar),
    },
    vertexShader: AIR_VERT,
    fragmentShader: AIR_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.FrontSide,
    toneMapped: false,
  })
}
