import * as THREE from 'three'
import { NOISE_GLSL } from './glsl/noise.js'
import { attachGroundLook } from './groundLook.js'

/**
 * Surfaces for everything built at a launch site, in one material.
 *
 * `siteSurround.js` builds the masses — boxes, cylinders, spheres — and stamps
 * each vertex with a colour and a `style`. This draws what a surface of that
 * style looks like at every scale the pixel can hold: the vertical ribs of
 * industrial cladding and the seams between its sheets, an office front's
 * floors of windows and their mullions, the lane markings on asphalt and the
 * tyre-darkened wheel paths, river gravel, board-formed concrete, glass that
 * mirrors the sky, painted steel. Rain streaks run down from every parapet.
 *
 * All of it is from the fragment's position in the pad frame and its normal,
 * so it costs no texture and cannot run out of resolution; and each pattern
 * fades to its own average once its period drops under a couple of pixels,
 * so the VAB five kilometres away is a clean grey block rather than a moiré.
 */
export function makeFacadeMaterial() {
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.82,
    metalness: 0.05,
  })
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        attribute float style;
        varying float vStyle;
        varying vec3 vFacP;
        varying vec3 vFacN;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vStyle = style;
        vFacP = position;
        vFacN = normal;`,
      )
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        ${NOISE_GLSL}
        varying float vStyle;
        varying vec3 vFacP;
        varying vec3 vFacN;
        float fGlass;
        float fMetal;
        float fRough;
        float fBump;`,
      )
      .replace(
        '#include <color_fragment>',
        /* glsl */ `#include <color_fragment>
        {
          int st = int(floor(vStyle + 0.5));
          vec3 p = vFacP;
          vec3 n = normalize(vFacN);
          float px = max(length(fwidth(p)), 1e-3);
          // A pattern of period L fades to its mean once L < 3 px.
          #define FADE(L) clamp((L) / (px * 3.0) - 1.0, 0.0, 1.0)
          bool roof = n.y > 0.7;
          vec3 t = normalize(cross(vec3(0.0, 1.0, 0.0), n) + vec3(1e-4, 0.0, 0.0));
          float u = dot(p, t);
          float v = p.y;
          vec3 c = diffuseColor.rgb;
          fGlass = 0.0;
          fMetal = 0.0;
          fRough = 0.82;
          fBump = 0.0;
          float grime = fbmAA(vec3(u * 0.35, v * 0.035, dot(p, n) * 0.1), 1.0, 4, px * 0.35, 0.55);
          if (roof && st <= 2) {
            // Gravel-and-membrane roofs, ponding stains.
            float g = fbmAA(p * vec3(1.0, 0.0, 1.0), 0.5, 5, px, 0.6);
            c *= 0.82 + 0.18 * g;
            fRough = 0.95;
          } else if (st == 0) {
            // Industrial cladding: vertical ribs every 0.9 m, sheet seams every 7.5 m, streaks.
            float rib = abs(fract(u / 0.9) - 0.5);
            c *= 1.0 - (smoothstep(0.38, 0.47, rib) * 0.16) * FADE(0.9);
            float seam = 1.0 - smoothstep(0.0, 0.04, fract(v / 7.5));
            c *= 1.0 - seam * 0.18 * FADE(7.5);
            c *= 1.0 - smoothstep(0.1, 0.7, grime) * 0.16;
            fBump = (rib - 0.25) * 0.08 * FADE(0.9);
            fRough = 0.62;
            fMetal = 0.25;
          } else if (st == 1) {
            // Office front: 3.8 m floors, a window band in each, mullions every 1.5 m.
            float fv = fract(v / 3.8);
            float band = smoothstep(0.34, 0.37, fv) * (1.0 - smoothstep(0.78, 0.81, fv));
            float mull = 1.0 - smoothstep(0.0, 0.06, abs(fract(u / 1.5) - 0.5) - 0.44);
            float win = band * (1.0 - mull * FADE(1.5)) * FADE(3.8);
            float lit = step(0.72, pz_hash33(floor(vec3(u / 1.5, v / 3.8, 3.0))).x);
            vec3 glassC = mix(vec3(0.05, 0.07, 0.09), vec3(0.22, 0.2, 0.16), lit * 0.35);
            c = mix(c * (1.0 - smoothstep(0.2, 0.8, grime) * 0.1), glassC, win);
            fGlass = win;
            fRough = mix(0.8, 0.12, win);
          } else if (st == 2) {
            // Concrete: board marks, stains, the odd patch.
            float boards = 1.0 - smoothstep(0.0, 0.05, abs(fract(v / 0.6) - 0.5) - 0.45);
            c *= 1.0 - boards * 0.05 * FADE(0.6);
            c *= 0.9 + 0.2 * fbmAA(p, 0.8, 6, px, 0.55);
            fRough = 0.95;
          } else if (st == 3) {
            // Asphalt: aggregate, patching, oil-darkened lanes.
            float agg = fbmAA(p * vec3(1.0, 0.0, 1.0), 6.0, 4, px, 0.6);
            float patchy = smoothstep(0.35, 0.5, fbmAA(p * vec3(1.0, 0.0, 1.0), 0.08, 3, px, 0.5));
            c *= (0.85 + 0.25 * agg) * (1.0 - patchy * 0.12);
            fRough = 0.9;
          } else if (st == 4) {
            // Gravel: river stone, pale, with the tracks worn into it.
            float stones = fbmAA(p * vec3(1.0, 0.0, 1.0), 3.0, 6, px, 0.65);
            c *= 0.84 + 0.3 * stones;
            fRough = 0.97;
            fBump = stones * 0.05;
          } else if (st == 5) {
            fGlass = 1.0;
            fRough = 0.08;
          } else if (st == 6) {
            // Painted tanks: glossy white, weld seams, a little rust at the seams.
            float weld = 1.0 - smoothstep(0.0, 0.03, abs(fract(v / 3.0) - 0.5) - 0.47);
            c *= 1.0 - weld * 0.08 * FADE(3.0);
            c = mix(c, c * vec3(0.9, 0.78, 0.66), smoothstep(0.55, 0.85, grime) * 0.3);
            fRough = 0.35;
          } else {
            // Bare and painted steel.
            c *= 0.92 + 0.12 * fbmAA(p, 2.0, 4, px, 0.55);
            fRough = 0.5;
            fMetal = 0.55;
          }
          diffuseColor.rgb = c;
        }`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        roughnessFactor = fRough;`,
      )
      .replace(
        '#include <metalnessmap_fragment>',
        `#include <metalnessmap_fragment>
        metalnessFactor = fMetal;`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        /* glsl */ `#include <normal_fragment_maps>
        {
          vec3 dpx = dFdx(-vViewPosition);
          vec3 dpy = dFdy(-vViewPosition);
          float dhx = dFdx(fBump);
          float dhy = dFdy(fBump);
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
          // Glass shows the sky it faces, more of it the more obliquely it is seen.
          vec3 V = normalize(vViewPosition);
          float cosV = clamp(abs(dot(normal, V)), 0.0, 1.0);
          float fres = 0.04 + 0.96 * pow(1.0 - cosV, 5.0);
          totalEmissiveRadiance += uSkyColor * uSkyIrradiance * 0.5 / PI * fres * fGlass;
        }`,
      )
  }
  material.customProgramCacheKey = () => 'site-facade'
  return attachGroundLook(material)
}
