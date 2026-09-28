import * as THREE from 'three'
import { blackbodyRGB } from './stars.js'

/**
 * Sagittarius A*, ray-traced.
 *
 * Light near a black hole does not go straight, and nothing about how it
 * looks can be painted on: the shadow, the photon ring round it, the far side
 * of the accretion disc lifted into view over the top, the sky behind folded
 * into an Einstein ring — all of it is the paths photons take. So every pixel
 * inside the lensing sphere integrates its own null geodesic of the
 * Schwarzschild metric, backwards from the camera.
 *
 * In units of the Schwarzschild radius r_s = 2GM/c², a photon's path obeys,
 * exactly, the Newtonian-looking equation
 *
 *     d²x/dλ² = −(3/2) h² x / r⁵,     h = |x × dx/dλ| (conserved),
 *
 * which reproduces the Binet equation u'' + u = (3/2) r_s u² of the
 * Schwarzschild orbit (Misner, Thorne & Wheeler §25.6). It is integrated with
 * velocity Verlet at a step proportional to r, so the photon sphere at 1.5 r_s
 * is resolved and the far field is crossed in a few dozen steps. A path that
 * falls inside r_s is captured and is black; one that crosses the disc plane
 * between the innermost stable orbit (3 r_s) and the disc's edge picks up the
 * disc's light; one that leaves the sphere samples the sky in the direction it
 * leaves in — the real Milky Way sky round the Galactic Centre, from the same
 * cube the rest of the sky is drawn from.
 *
 * The disc is a thin disc with the Shakura–Sunyaev temperature profile,
 * T ∝ r^(−3/4) (1 − √(3/r))^(1/4), orbiting at the Keplerian speed of the
 * Schwarzschild metric, v = √(r_s / 2(r − r_s)); what reaches the camera is
 * shifted by g = √(1 − r_s/r) / γ(1 − v·n), the gravitational and Doppler
 * factors together, and brightened as g⁴ — which is why the approaching side
 * blazes and the receding side fades. Sgr A* itself is far fainter than this
 * — it accretes almost nothing — and its disc's orientation is not known; the
 * disc drawn is what a black hole of its mass looks like while feeding.
 */

const VERT = /* glsl */ `
  void main() {
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_Position.z = 0.5 * gl_Position.w;
  }
`

const FRAG = /* glsl */ `
  uniform vec3 uCam;            // camera, black-hole frame, units of r_s
  uniform mat4 uInvProj;
  uniform mat3 uViewToLocal;
  uniform mat3 uLocalToWorld;
  uniform vec2 uViewport;
  uniform samplerCube uSky;
  uniform float uSkyOn;
  uniform float uLens;          // lensing-sphere radius, r_s
  uniform float uSteps;
  uniform float uTime;
  uniform float uDiscOuter;
  uniform vec3 uDiscHot;

  vec3 bh_hash(vec3 p) {
    p = fract(p * vec3(0.1031, 0.1030, 0.0973));
    p += dot(p, p.yxz + 33.33);
    return fract((p.xxy + p.yxx) * p.zyx);
  }

  /** Stars in the sky behind, lensed with it: a grid of candidates on the cube. */
  vec3 skyStars(vec3 d) {
    vec3 a = abs(d);
    vec2 uv;
    float face;
    if (a.x >= a.y && a.x >= a.z) { uv = d.yz / a.x; face = d.x > 0.0 ? 1.0 : 2.0; }
    else if (a.y >= a.z) { uv = d.xz / a.y; face = d.y > 0.0 ? 3.0 : 4.0; }
    else { uv = d.xy / a.z; face = d.z > 0.0 ? 5.0 : 6.0; }
    vec2 g = (uv * 0.5 + 0.5) * 900.0;
    vec2 c = floor(g);
    vec3 h = bh_hash(vec3(c, face * 57.0));
    if (h.z > 0.35) return vec3(0.0);
    vec2 q = g - c - 0.2 - 0.6 * h.xy;
    return mix(vec3(1.0, 0.85, 0.7), vec3(0.8, 0.9, 1.0), h.y) * pow(h.x, 5.0) * 2.5 * exp(-dot(q, q) * 30.0);
  }

  /** Disc light at radius r, seen at direction n with the gas moving along phi-hat. */
  vec3 discLight(vec3 x, vec3 n) {
    float r = length(x.xz);
    if (r < 3.0 || r > uDiscOuter) return vec3(0.0);
    float T = pow(r / 3.0, -0.75) * pow(max(1.0 - sqrt(3.0 / r), 0.0), 0.25) / 0.488;
    float v = sqrt(0.5 / (r - 1.0));
    vec3 phi = normalize(vec3(-x.z, 0.0, x.x));
    float gamma = 1.0 / sqrt(1.0 - v * v);
    // n points from the camera along the ray; the light travels back along -n.
    float g = sqrt(1.0 - 1.0 / r) / (gamma * (1.0 + v * dot(phi, n)));
    float Tobs = T * g;
    // Turbulence, sheared into spiral streaks by the differential rotation:
    // value noise in (ln r, angle - Keplerian phase), so every streak winds.
    float ang = atan(x.z, x.x);
    float wind = ang + uTime * 0.3 * pow(r, -1.5) * 30.0;
    vec2 sp = vec2(log(r) * 9.0, wind * 6.0 + 4.0 * log(r));
    vec2 ci = floor(sp);
    vec2 cf = fract(sp);
    cf = cf * cf * (3.0 - 2.0 * cf);
    float n00 = bh_hash(vec3(ci, 1.0)).x, n10 = bh_hash(vec3(ci + vec2(1.0, 0.0), 1.0)).x;
    float n01 = bh_hash(vec3(ci + vec2(0.0, 1.0), 1.0)).x, n11 = bh_hash(vec3(ci + vec2(1.0, 1.0), 1.0)).x;
    float streak = 0.65 + 0.7 * mix(mix(n00, n10, cf.x), mix(n01, n11, cf.x), cf.y);
    float edge = smoothstep(uDiscOuter, uDiscOuter * 0.55, r);
    // Thermal colour: deep orange where cool, through gold to white where hot
    // and blueshifted — the observed temperature, not the emitted one.
    vec3 col = mix(vec3(1.0, 0.32, 0.06), vec3(1.0, 0.78, 0.45), smoothstep(0.25, 0.85, Tobs));
    col = mix(col, uDiscHot, smoothstep(1.0, 1.6, Tobs));
    // Flux falls as T^4 in a real disc; T^3 keeps the outer disc in view.
    return col * pow(g, 4.0) * pow(T, 3.0) * 1.1 * streak * edge;
  }

  void main() {
    vec2 ndc = gl_FragCoord.xy / uViewport * 2.0 - 1.0;
    vec4 v4 = uInvProj * vec4(ndc, -1.0, 1.0);
    vec3 rd = normalize(uViewToLocal * (v4.xyz / v4.w));
    vec3 x = uCam;
    // Start on the lensing sphere if the camera is outside it.
    float b = dot(x, rd);
    float c = dot(x, x) - uLens * uLens;
    if (c > 0.0) {
      float disc = b * b - c;
      if (disc < 0.0 || b > 0.0) discard;
      x += rd * (-b - sqrt(disc));
    }
    vec3 v = rd;
    vec3 hv = cross(x, v);
    float h2 = dot(hv, hv);
    vec3 col = vec3(0.0);
    float through = 1.0;
    bool captured = false;
    bool escaped = false;
    for (int i = 0; i < 400; i++) {
      if (float(i) >= uSteps) break;
      float r = length(x);
      // The Newtonian form conserves h only while the speed is left free to
      // change, so the step is sized in distance: a twentieth of r.
      float dl = clamp(0.05 * r, 0.015, 4.0) / length(v);
      vec3 acc = -1.5 * h2 * x / pow(r, 5.0);
      vec3 xn = x + v * dl + 0.5 * acc * dl * dl;
      vec3 accn = -1.5 * h2 * xn / pow(length(xn), 5.0);
      vec3 vn = v + 0.5 * (acc + accn) * dl;
      // Through the disc plane?
      if (x.y * xn.y < 0.0) {
        float f = x.y / (x.y - xn.y);
        vec3 hit = mix(x, xn, f);
        vec3 L = discLight(hit, normalize(v));
        col += through * L;
        if (length(L) > 0.0) through *= 0.15;
      }
      x = xn;
      v = vn;
      float rn = length(x);
      if (rn < 1.0) { captured = true; break; }
      if (rn > uLens && dot(x, v) > 0.0) { escaped = true; break; }
    }
    if (!captured) {
      vec3 dw = normalize(uLocalToWorld * v);
      vec3 sky = uSkyOn * textureCube(uSky, dw).rgb + skyStars(dw) * 0.08;
      col += through * sky;
    }
    gl_FragColor = vec4(col, 1.0);
  }
`

export function makeBlackHoleMaterial(sky) {
  const hot = [0, 0, 0]
  blackbodyRGB(hot, 9000)
  return new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      uCam: { value: new THREE.Vector3() },
      uInvProj: { value: new THREE.Matrix4() },
      uViewToLocal: { value: new THREE.Matrix3() },
      uLocalToWorld: { value: new THREE.Matrix3() },
      uViewport: { value: new THREE.Vector2(1, 1) },
      uSky: { value: sky },
      uSkyOn: { value: 1 },
      uLens: { value: 40 },
      uSteps: { value: 220 },
      uTime: { value: 0 },
      uDiscOuter: { value: 12 },
      uDiscHot: { value: new THREE.Color(hot[0], hot[1], hot[2]) },
    },
    side: THREE.BackSide,
    depthTest: false,
    depthWrite: false,
    transparent: false,
    toneMapped: false,
  })
}
