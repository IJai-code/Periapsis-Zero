import * as THREE from 'three'
import { scalarUniform } from './scalarUniform.js'

/**
 * Light and air at a launch site: what the sky adds that the Sun does not.
 *
 * On the ground the scene was lit by the Sun and nothing else — a parallel
 * beam, and an ambient term a sixtieth of it put there so night sides were not
 * pure black. Out in space that is right: there is nothing to scatter light
 * back. Standing on a pad it is the thing that made every photograph of the
 * site look like a model on a table. A clear daytime sky delivers about an
 * eighth of the Sun's illuminance again onto a horizontal surface, from every
 * direction above it, and the ground returns some of that upward — so shadows
 * are blue-grey rather than black, and the sides of a tower facing away from
 * the Sun still read as steel. And the air between the eye and anything
 * kilometres away scatters sunlight into the line of sight: the VAB five
 * kilometres off is bluer and paler than the tower four hundred metres off,
 * which is most of how the eye knows how far away each one is.
 *
 * Both are applied only to the materials that stand on the ground — terrain,
 * vegetation, buildings, the pad, the vehicle — through `attachGroundLook`,
 * rather than as scene lights and scene fog: a hemisphere light would also
 * light the Moon's night side in the sky above the pad, and fog would swallow
 * every planet in the scene. `GroundLight.jsx` writes the uniforms each frame
 * from the Sun's elevation at the site, and zeroes them when the camera leaves.
 */
export const GROUND_AIR = {
  uSkyColor: { value: new THREE.Color(0.55, 0.68, 0.9) },
  uBounceColor: { value: new THREE.Color(0.32, 0.3, 0.22) },
  uSkyUpV: { value: new THREE.Vector3(0, 1, 0) },
  uSkyIrradiance: scalarUniform(0),
  uHazeColor: { value: new THREE.Color(0.6, 0.68, 0.8) },
  uHazeDensity: scalarUniform(0),
}

const PARS = /* glsl */ `
uniform vec3 uSkyColor;
uniform vec3 uBounceColor;
uniform vec3 uSkyUpV;
uniform float uSkyIrradiance;
uniform vec3 uHazeColor;
uniform float uHazeDensity;
`

/**
 * Add skylight and aerial perspective to a standard or physical material,
 * chaining whatever `onBeforeCompile` it already has.
 */
export function attachGroundLook(material, { sky = true, haze = true } = {}) {
  const previous = material.onBeforeCompile
  material.onBeforeCompile = (shader, renderer) => {
    previous?.call(material, shader, renderer)
    Object.assign(shader.uniforms, GROUND_AIR)
    let f = shader.fragmentShader.replace('#include <common>', `#include <common>\n${PARS}`)
    if (sky) {
      f = f.replace(
        '#include <lights_fragment_end>',
        /* glsl */ `
        {
          // The sky's irradiance from above and the ground's from below, by
          // how far this surface faces up — the hemisphere-light integral.
          float up = dot(normal, uSkyUpV) * 0.5 + 0.5;
          vec3 skyIrr = mix(uBounceColor, uSkyColor, up) * uSkyIrradiance;
          irradiance += skyIrr;
        }
        #include <lights_fragment_end>`,
      )
    }
    if (haze) {
      f = f.replace(
        '#include <fog_fragment>',
        /* glsl */ `#include <fog_fragment>
        {
          float hd = length(vViewPosition);
          float air = 1.0 - exp(-hd * uHazeDensity);
          gl_FragColor.rgb = mix(gl_FragColor.rgb, uHazeColor, air);
        }`,
      )
    }
    shader.fragmentShader = f
  }
  const prevKey = material.customProgramCacheKey
  material.customProgramCacheKey = () =>
    `${prevKey ? prevKey.call(material) : ''}|ground-look-${sky ? 's' : ''}${haze ? 'h' : ''}`
  return material
}
