import { NOISE_GLSL } from './glsl/noise.js'

/**
 * The pad's concrete, as it weathers.
 *
 * A pad's hardstand is poured in slabs, and a slab edge is an expansion joint
 * — a dark sealed line every few metres — so the top of the mound reads as a
 * grid, each slab a slightly different grey from its own pour. Rain and
 * exhaust stain it; the flame trench's walls and the ground beside the trench
 * mouths are black with soot. The mound's sloped sides at Kennedy's 39 pads
 * are not concrete at all but grassed embankment, and are drawn so.
 *
 * All of it from the fragment's position and normal in the pad's own frame
 * (y up), fading each pattern once it is finer than a pixel, the way the
 * facades do (`gfx/facade.js`) — no texture, nothing to run out of resolution.
 */
export function attachPadConcrete(material, { trenchAxis = 'ns', trench = 0 } = {}) {
  const prior = material.onBeforeCompile
  material.onBeforeCompile = (shader, renderer) => {
    prior?.(shader, renderer)
    shader.uniforms.uTrench = { value: trench }
    shader.uniforms.uTrenchNS = { value: trenchAxis === 'ew' ? 0 : 1 }
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vPadP;
        varying vec3 vPadN;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vPadP = position;
        vPadN = normal;`,
      )
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        ${NOISE_GLSL}
        uniform float uTrench;
        uniform float uTrenchNS;
        varying vec3 vPadP;
        varying vec3 vPadN;
        float padRough;`,
      )
      .replace(
        '#include <color_fragment>',
        /* glsl */ `#include <color_fragment>
        {
          vec3 p = vPadP;
          vec3 n = normalize(vPadN);
          float px = max(length(fwidth(p)), 1e-3);
          float slope = 1.0 - abs(n.y);
          // Slabs: 6 m pours, sealed joints between them.
          vec2 g = p.xz / 6.0;
          vec2 f = fract(g);
          float edge = min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y)) * 6.0;
          float jointFade = clamp(0.08 / px - 0.5, 0.0, 1.0);
          float joint = (1.0 - smoothstep(0.02, 0.06 + px, edge)) * jointFade * step(0.9, n.y);
          float tint = 0.9 + 0.16 * pz_hash33(vec3(floor(g), 7.0)).x;
          float stain = fbmAA(p * vec3(1.0, 0.25, 1.0), 0.35, 5, px * 0.35, 0.55);
          float streak = fbmAA(vec3(p.x * 2.0, p.y * 0.2, p.z * 2.0), 0.6, 4, px * 0.6, 0.5) * slope;
          vec3 c = diffuseColor.rgb * tint * (1.0 - joint * 0.45) * (0.9 + 0.16 * stain) * (1.0 - max(streak, 0.0) * 0.25);
          padRough = 0.95;
          // Soot: the trench walls, and the apron round its two mouths.
          float across = uTrenchNS > 0.5 ? abs(p.x) : abs(p.z);
          float along = uTrenchNS > 0.5 ? abs(p.z) : abs(p.x);
          float inTrench = uTrench > 0.0 ? (1.0 - smoothstep(uTrench * 0.5, uTrench * 0.5 + 1.5, across)) * step(p.y, 13.0) : 0.0;
          float mouth = uTrench > 0.0 ? exp(-pow(across / (uTrench * 1.4), 2.0)) * smoothstep(40.0, 70.0, along) * (1.0 - smoothstep(90.0, 160.0, along)) * step(p.y, 1.0) : 0.0;
          float soot = max(inTrench * 0.85, mouth * 0.6) * (0.75 + 0.35 * stain);
          c = mix(c, vec3(0.05, 0.045, 0.04), soot);
          // Grassed embankment on the mound's slopes, above the apron.
          // The mound's sides slope at about 1 in 2.4 (23°), so a normal a few
          // degrees off vertical is already bank, not slab.
          float bank = smoothstep(0.015, 0.04, slope) * (1.0 - smoothstep(0.75, 0.9, slope)) * smoothstep(0.6, 1.6, p.y) * (1.0 - inTrench);
          vec3 grass = mix(vec3(0.17, 0.25, 0.09), vec3(0.3, 0.33, 0.15), smoothstep(-0.4, 0.5, fbmAA(p, 0.9, 5, px, 0.6)));
          c = mix(c, grass, bank);
          padRough = mix(padRough, 0.98, bank);
          diffuseColor.rgb = c;
        }`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        roughnessFactor = padRough;`,
      )
  }
  const priorKey = material.customProgramCacheKey?.bind(material)
  material.customProgramCacheKey = () => `pad-concrete-${trenchAxis}-${priorKey ? priorKey() : ''}`
  return material
}
