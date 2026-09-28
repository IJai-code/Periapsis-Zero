import * as THREE from 'three'
import { NOISE_GLSL } from './glsl/noise.js'
import { scalarUniform } from './scalarUniform.js'
import { attachGroundLook, GROUND_AIR } from './groundLook.js'

/**
 * The ground a launch complex stands on, seen from a person's height.
 *
 * The heights are real (SRTM, 130 m a sample — see `Terrain.jsx`), and at 130 m
 * a sample a height field says nothing about what the ground *is*: from 380 m
 * away the old surface was one flat olive plane to the horizon. So the cover
 * is synthesised in the pad's own frame, in metres, at every scale a pixel can
 * resolve from where the camera stands (the same octave-by-pixel cut the
 * planets use): kilometre-scale patches of the site's vegetation types, then
 * clumps, then tussocks, then individual blades a metre in front of the lens.
 * Each site has its own cover — Merritt Island's palmetto scrub and wet
 * prairie, the Kazakh steppe, the Guianan forest floor and savanna, Vandenberg's
 * chaparral grass — with the colours of the real vegetation as it photographs.
 *
 * Water is a different material under the same draw: calm lagoon and open sea
 * with wind waves in its normals, a Fresnel reflection of the sky that turns
 * a lagoon into a mirror of it at a low angle, and the sun glint the waves
 * break up. `wet` is a per-vertex attribute the terrain builder writes from
 * the same sea-level test that flattened the water.
 */

const PALETTES = {
  ksc: {
    grassA: [0.33, 0.43, 0.22],
    grassB: [0.42, 0.49, 0.27],
    dry: [0.6, 0.57, 0.4],
    scrub: [0.22, 0.31, 0.17],
    soil: [0.5, 0.46, 0.36],
    water: [0.07, 0.16, 0.17],
  },
  baikonur: {
    grassA: [0.62, 0.58, 0.42],
    grassB: [0.7, 0.64, 0.46],
    dry: [0.78, 0.72, 0.56],
    scrub: [0.5, 0.5, 0.36],
    soil: [0.72, 0.65, 0.5],
    water: [0.1, 0.18, 0.22],
  },
  kourou: {
    grassA: [0.3, 0.42, 0.2],
    grassB: [0.38, 0.47, 0.24],
    dry: [0.5, 0.5, 0.3],
    scrub: [0.16, 0.28, 0.14],
    soil: [0.52, 0.36, 0.26],
    water: [0.12, 0.17, 0.12],
  },
  vandenberg: {
    grassA: [0.62, 0.56, 0.38],
    grassB: [0.7, 0.62, 0.42],
    dry: [0.78, 0.7, 0.5],
    scrub: [0.32, 0.36, 0.22],
    soil: [0.6, 0.52, 0.4],
    water: [0.05, 0.13, 0.2],
  },
}

const srgb = (c) => new THREE.Color().setRGB(c[0], c[1], c[2], THREE.SRGBColorSpace)

export function makeTerrainMaterial(siteId, flatRadius) {
  const pal = PALETTES[siteId] ?? PALETTES.ksc
  const material = new THREE.MeshStandardMaterial({
    vertexColors: false,
    roughness: 0.95,
    metalness: 0,
    color: '#ffffff',
  })
  const uniforms = {
    uGrassA: { value: srgb(pal.grassA) },
    uGrassB: { value: srgb(pal.grassB) },
    uDry: { value: srgb(pal.dry) },
    uScrub: { value: srgb(pal.scrub) },
    uSoil: { value: srgb(pal.soil) },
    uWater: { value: srgb(pal.water) },
    uFlat: scalarUniform(flatRadius),
    uWaveTime: scalarUniform(0),
  }
  material.userData.terrain = uniforms
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms)
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        attribute float wet;
        varying vec3 vGroundP;
        varying float vWet;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vGroundP = position;
        vWet = wet;`,
      )
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        ${NOISE_GLSL}
        uniform vec3 uGrassA;
        uniform vec3 uGrassB;
        uniform vec3 uDry;
        uniform vec3 uScrub;
        uniform vec3 uSoil;
        uniform vec3 uWater;
        uniform float uFlat;
        uniform float uWaveTime;
        varying vec3 vGroundP;
        varying float vWet;
        float gH;
        float gWet;`,
      )
      .replace(
        '#include <color_fragment>',
        /* glsl */ `#include <color_fragment>
        {
          vec3 q = vec3(vGroundP.x, 0.0, vGroundP.z);
          float fp = max(length(fwidth(vGroundP)), 1e-4);
          gWet = smoothstep(0.35, 0.65, vWet);
          // Land cover, from kilometre patches to blades underfoot.
          float big = fbmAA(q, 1.0 / 1400.0, 4, fp, 0.55);
          float mid = fbmAA(q + 31.0, 1.0 / 160.0, 5, fp, 0.55);
          float fine = fbmAA(q - 17.0, 1.0 / 11.0, 6, fp, 0.6);
          float micro = fbmAA(q + 5.0, 1.0 / 0.7, 5, fp, 0.66);
          float blade = fbmAA(vec3(q.x * 7.0, 0.0, q.z) + 2.0, 1.0 / 0.35, 3, fp, 0.6);
          vec3 c = mix(uGrassA, uGrassB, smoothstep(-0.35, 0.35, big + mid * 0.5));
          c = mix(c, uDry, smoothstep(0.1, 0.55, mid + fine * 0.35) * 0.55);
          float scrub = smoothstep(0.12, 0.42, big * 0.7 + mid * 0.45 + fine * 0.25);
          c = mix(c, uScrub, scrub * 0.75);
          c = mix(c, uSoil, smoothstep(0.55, 0.75, fine * 0.8 - big * 0.4) * 0.5);
          c *= 1.0 + fine * 0.16 + micro * 0.09 + blade * 0.06;
          // The graded complex round the pad: mown, even, and paler.
          float r = length(vGroundP.xz);
          float graded = 1.0 - smoothstep(uFlat * 0.8, uFlat * 1.05, r);
          // Mown in passes: blades laid one way on one pass and the other way
          // on the next, which is the light-and-dark striping every mown field
          // shows — 4 m passes along the site's own grid, the joins soft.
          float pass = vGroundP.x * 0.25 + vGroundP.z * 0.02;
          float stripe = smoothstep(0.35, 0.65, abs(fract(pass) - 0.5) * 2.0);
          float stripeFade = clamp(1.0 / (fp * 0.5) - 0.5, 0.0, 1.0);
          vec3 lawn = mix(uGrassA, uGrassB, 0.6) * (1.0 + micro * 0.1 + (stripe - 0.5) * 0.09 * stripeFade);
          c = mix(c, lawn, graded * 0.7);
          // Water.
          float wave = fbmAA(vec3(q.x + uWaveTime * 0.9, 0.0, q.z + uWaveTime * 0.4), 1.0 / 7.0, 5, fp, 0.6);
          c = mix(c, uWater * (1.0 + mid * 0.2), gWet);
          diffuseColor.rgb *= c;
          gH = mix(fine * 0.35 + micro * 0.12 + blade * 0.06 + scrub * mid * 0.6, wave * 0.18, gWet);
        }`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.06, gWet);`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        /* glsl */ `#include <normal_fragment_maps>
        {
          vec3 dpx = dFdx(-vViewPosition);
          vec3 dpy = dFdy(-vViewPosition);
          float dhx = dFdx(gH);
          float dhy = dFdy(gH);
          vec3 r1 = cross(dpy, normal);
          vec3 r2 = cross(normal, dpx);
          float det = dot(dpx, r1);
          vec3 grad = sign(det) * (dhx * r1 + dhy * r2);
          vec3 nb = abs(det) * normal - grad;
          float nl = length(nb);
          if (nl > 1e-20) normal = nb / nl;
        }`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        /* glsl */ `#include <emissivemap_fragment>
        {
          // The sky, mirrored in the water: Schlick's Fresnel at the view angle.
          vec3 V = normalize(vViewPosition);
          float cosV = clamp(dot(normal, V), 0.0, 1.0);
          float fres = 0.02 + 0.98 * pow(1.0 - cosV, 5.0);
          totalEmissiveRadiance += uSkyColor * uSkyIrradiance * 0.55 / PI * fres * gWet;
        }`,
      )
  }
  material.customProgramCacheKey = () => `terrain-${siteId}`
  attachGroundLook(material)
  return material
}

/** Advance the water. Called per frame with wall seconds, kept small for float32. */
export function tickTerrain(material, seconds) {
  const u = material.userData.terrain
  if (u) u.uWaveTime.value = seconds % 3600
}

export { GROUND_AIR }
