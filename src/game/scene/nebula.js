import * as THREE from 'three'

/**
 * A coloured nebula across the sky: banks of glowing gas, brighter toward
 * a heart, cut by darker lanes of dust, drawn additively behind everything
 * (the stars show through). One per Squadron battlefield, so each has its
 * own sky: red and ember over the Drift, teal over Gateway, violet and
 * rose over Harbor.
 */
export const NEBULAE = {
  drift: { hot: [1.0, 0.62, 0.3], deep: [0.72, 0.14, 0.06], dust: [0.2, 0.05, 0.02], heart: [0.35, 0.15, -1.0], gain: 0.85 },
  gateway: { hot: [0.55, 0.95, 1.0], deep: [0.08, 0.32, 0.58], dust: [0.02, 0.06, 0.1], heart: [-0.6, 0.3, -0.8], gain: 0.8 },
  harbor: { hot: [1.0, 0.6, 0.86], deep: [0.4, 0.16, 0.74], dust: [0.08, 0.02, 0.12], heart: [0.8, 0.25, -0.5], gain: 0.85 },
  lobby: { hot: [1.0, 0.62, 0.3], deep: [0.72, 0.14, 0.06], dust: [0.2, 0.05, 0.02], heart: [-0.2, 0.1, -1.0], gain: 1.2 },
}

export function nebulaMaterial(kind = 'drift', octaves = 5) {
  const n = NEBULAE[kind] ?? NEBULAE.drift
  return new THREE.ShaderMaterial({
    defines: { OCTAVES: octaves },
    uniforms: {
      uHot: { value: new THREE.Color(...n.hot) },
      uDeep: { value: new THREE.Color(...n.deep) },
      uDust: { value: new THREE.Color(...n.dust) },
      uHeart: { value: new THREE.Vector3(...n.heart).normalize() },
      uGain: { value: n.gain },
    },
    vertexShader: `varying vec3 vDir;
      #include <common>
      #include <logdepthbuf_pars_vertex>
      void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: `varying vec3 vDir; uniform vec3 uHot, uDeep, uDust, uHeart; uniform float uGain;
      #include <logdepthbuf_pars_fragment>
      float hash3(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
      float vnoise(vec3 x) {
        vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(mix(hash3(i), hash3(i + vec3(1, 0, 0)), f.x), mix(hash3(i + vec3(0, 1, 0)), hash3(i + vec3(1, 1, 0)), f.x), f.y),
                   mix(mix(hash3(i + vec3(0, 0, 1)), hash3(i + vec3(1, 0, 1)), f.x), mix(hash3(i + vec3(0, 1, 1)), hash3(i + vec3(1, 1, 1)), f.x), f.y), f.z);
      }
      float fbm(vec3 p) { float s = 0.0, a = 0.5; for (int i = 0; i < OCTAVES; i++) { s += a * vnoise(p); p = p * 2.03 + 7.31; a *= 0.5; } return s; }
      void main() {
        #include <logdepthbuf_fragment>
        vec3 d = normalize(vDir);
        // Billows, warped by a slower field so they curl rather than tile.
        vec3 w = vec3(fbm(d * 1.6), fbm(d * 1.6 + 3.7), fbm(d * 1.6 + 8.1));
        float n = fbm(d * 2.4 + w * 1.8);
        float m = fbm(d * 5.5 + w * 2.4 + 2.0);
        float heart = smoothstep(-0.35, 0.95, dot(d, uHeart));
        float body = smoothstep(0.38, 0.8, n * 0.75 + m * 0.35) * (0.25 + 0.75 * heart);
        vec3 col = mix(uDeep, uHot, smoothstep(0.5, 0.85, m * 0.6 + n * 0.5) * heart);
        // Dust lanes: dark threads through the brightest gas.
        float lanes = smoothstep(0.52, 0.66, fbm(d * 9.0 + w * 3.0));
        col = mix(col, uDust, lanes * 0.7);
        // A faint wash over the whole sky, so it is never flat black.
        vec3 wash = uDeep * 0.06 * (0.5 + n);
        gl_FragColor = vec4((col * body * body * 1.6 + wash) * uGain, 1.0);
      }`,
    side: THREE.BackSide, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false,
  })
}
