import { NOISE_GLSL } from './glsl/noise.js'
import { WORLD_COMMON } from './glsl/worlds.js'
import { scalarUniform } from './scalarUniform.js'
import { QUALITY } from '../sim/device.js'

/**
 * Detail below the photograph.
 *
 * Earth's day map is 5,400 pixels round the equator — 7.4 km a pixel — and
 * the Moon's 4,096, 2.7 km. From orbit that is plenty; from a few hundred
 * kilometres up it is a blur, and it was the thing that made every close
 * approach look pixelated. A bigger photograph only moves the edge. So the
 * photograph is kept for what it is good at — where the continents, the
 * deserts, the maria are — and everything finer is synthesised per pixel,
 * octave by octave, only where the pixel is small enough to hold it
 * (`octaveFade`, see `glsl/noise.js`). At orbital distances nothing here draws
 * at all and the imagery is exactly what it was.
 *
 * What is synthesised is chosen to be the right *kind* of detail for what the
 * photograph shows at that spot: relief and mottling on land, weighted by how
 * bright and dry the land is; wind-driven wave normals on water, which is what
 * turns the sun glint from a smooth blob into a field of sparkle; crisper,
 * torn edges on cloud; and on the Moon, the crater population that continues
 * below the map's resolution down to metres.
 *
 * Each attach chains the material's existing `onBeforeCompile` — the night
 * lights, the eclipse, the ground cut — rather than replacing it.
 */

function chain(material, key, patch) {
  const previous = material.onBeforeCompile
  material.onBeforeCompile = (shader, renderer) => {
    previous?.call(material, shader, renderer)
    patch(shader)
  }
  const prevKey = material.customProgramCacheKey
  material.customProgramCacheKey = () => `${prevKey ? prevKey.call(material) : ''}|${key}`
}

const VERTEX_VARYING = (shader) => {
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nvarying vec3 vDetailP;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvDetailP = position;')
}

const HEADER = /* glsl */ `
varying vec3 vDetailP;
${NOISE_GLSL}
${WORLD_COMMON}
`

/** Earth's surface: land relief and mottling, and wind waves on the sea. */
export function attachEarthDetail(material) {
  chain(material, 'earth-detail', (shader) => {
    shader.uniforms.uOct = scalarUniform(QUALITY.octaves + 1)
    shader.uniforms.uTime = material.userData.detailTime ?? (material.userData.detailTime = scalarUniform(0))
    shader.uniforms.uRadius = scalarUniform(6.371e6)
    VERTEX_VARYING(shader)
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${HEADER}`)
      .replace(
        '#include <roughnessmap_fragment>',
        /* glsl */ `#include <roughnessmap_fragment>
        vec3 dP = normalize(vDetailP);
        float dFp = max(length(fwidth(dP)), 1e-9);
        int dOct = int(uOct);
        // Water from the roughness the specular map gave it: smooth is sea.
        float dWater = 1.0 - smoothstep(0.32, 0.62, roughnessFactor);
        // Land: relief from ridged and billowed noise, starting just below the
        // photograph's own resolution (7.4 km) and going as fine as the pixel.
        float dRidge = ridgedAA(dP, 520.0, dOct, dFp, 0.52);
        float dBill = fbmAA(dP + 3.7, 700.0, dOct, dFp, 0.55);
        float dLum = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
        float dDry = smoothstep(0.05, 0.25, dLum);
        float dLand = (1.0 - dWater);
        diffuseColor.rgb *= 1.0 + dLand * ((dRidge - 0.28) * 0.34 + dBill * 0.22) * mix(0.8, 1.2, dDry);
        // A little hue: vegetation greener in the hollows, rock paler on the crests.
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.92, 1.03, 0.9), dLand * clamp(-dBill, 0.0, 1.0) * 0.5);
        float dLandH = dLand * (dRidge * 900.0 + dBill * 300.0);
        // Sea: wind waves, a few metres at kilometre wavelengths and finer.
        float dWave = fbmAA(dP * vec3(1.0, 1.3, 1.0) + vec3(uTime * 2e-6, 0.0, uTime * 1.3e-6), 9000.0, dOct, dFp, 0.62);
        float dSeaH = dWater * dWave * 18.0;
        diffuseColor.rgb *= 1.0 + dWater * fbmAA(dP - 1.1, 240.0, dOct, dFp, 0.5) * 0.08;
        float dH = dLandH + dSeaH;
        roughnessFactor = mix(roughnessFactor, clamp(roughnessFactor + dWave * 0.12, 0.02, 1.0), dWater);`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        /* glsl */ `#include <normal_fragment_maps>
        {
          vec3 dpx = dFdx(-vViewPosition);
          vec3 dpy = dFdy(-vViewPosition);
          float dhx = dFdx(dH);
          float dhy = dFdy(dH);
          vec3 r1 = cross(dpy, normal);
          vec3 r2 = cross(normal, dpx);
          float det = dot(dpx, r1);
          vec3 grad = sign(det) * (dhx * r1 + dhy * r2);
          vec3 nb = abs(det) * normal - grad;
          float nl = length(nb);
          if (nl > 1e-20) normal = nb / nl;
        }`,
      )
  })
}

/** Cloud: torn, crisp edges and texture below the map's 39 km pixel. */
export function attachCloudDetail(material) {
  chain(material, 'cloud-detail', (shader) => {
    shader.uniforms.uOct = scalarUniform(QUALITY.octaves)
    shader.uniforms.uTime = material.userData.detailTime ?? (material.userData.detailTime = scalarUniform(0))
    shader.uniforms.uRadius = scalarUniform(6.371e6)
    VERTEX_VARYING(shader)
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${HEADER}`)
      .replace(
        '#include <map_fragment>',
        /* glsl */ `#include <map_fragment>
        {
          vec3 cP = normalize(vDetailP);
          float cFp = max(length(fwidth(cP)), 1e-9);
          int cOct = int(uOct);
          float cov = diffuseColor.a;
          float drift = uTime * 4e-6;
          float n = fbmAA(cP + vec3(drift, 0.0, -drift), 160.0, cOct, cFp, 0.56);
          float n2 = fbmAA(cP * 1.7 - vec3(drift, 0.0, drift), 900.0, cOct, cFp, 0.6);
          // How much sharpening the pixel can hold: none from orbit, crisp edges up close.
          float zoom = octaveFade(400.0, cFp);
          float edge = clamp((cov - 0.5) * mix(1.0, 2.4, zoom) + 0.5 + (n * 0.42 + n2 * 0.18) * zoom, 0.0, 1.0);
          diffuseColor.a = mix(cov, edge, zoom);
          diffuseColor.rgb *= 1.0 + (n2 * 0.18 - abs(n) * 0.1) * zoom;
        }`,
      )
  })
}

/** The Moon: the crater population below the map's 2.7 km, down to metres. */
export function attachMoonDetail(material) {
  chain(material, 'moon-detail', (shader) => {
    shader.uniforms.uOct = scalarUniform(QUALITY.octaves)
    shader.uniforms.uTime = scalarUniform(0)
    shader.uniforms.uRadius = scalarUniform(1.7374e6)
    VERTEX_VARYING(shader)
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${HEADER}`)
      .replace(
        '#include <map_fragment>',
        /* glsl */ `#include <map_fragment>
        vec3 mP = normalize(vDetailP);
        float mFp = max(length(fwidth(mP)), 1e-9);
        vec2 mk1 = craters(mP, 260.0, 0.55, mFp);
        vec2 mk2 = craters(mP, 640.0, 0.6, mFp);
        vec2 mk3 = craters(mP, 1600.0, 0.62, mFp);
        vec2 mk4 = craters(mP, 4000.0, 0.62, mFp);
        vec2 mk5 = craters(mP, 10000.0, 0.62, mFp);
        float mRough = fbmAA(mP + 2.3, 900.0, int(uOct), mFp, 0.55);
        float mH = mk1.x + mk2.x + mk3.x + mk4.x + mk5.x + mRough * 60.0;
        diffuseColor.rgb *= 1.0 + (mk1.y + mk2.y + mk3.y + mk4.y + mk5.y) * 0.18 + mRough * 0.05;`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        /* glsl */ `#include <normal_fragment_maps>
        {
          vec3 dpx = dFdx(-vViewPosition);
          vec3 dpy = dFdy(-vViewPosition);
          float dhx = dFdx(mH);
          float dhy = dFdy(mH);
          vec3 r1 = cross(dpy, normal);
          vec3 r2 = cross(normal, dpx);
          float det = dot(dpx, r1);
          vec3 grad = sign(det) * (dhx * r1 + dhy * r2);
          vec3 nb = abs(det) * normal - grad;
          float nl = length(nb);
          if (nl > 1e-20) normal = nb / nl;
        }`,
      )
  })
}
