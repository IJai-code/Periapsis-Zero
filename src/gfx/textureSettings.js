import * as THREE from 'three'

/**
 * One place for colour-space and sampling policy, shared by the procedural
 * generator and the HD loader.
 *
 * Getting this wrong is the classic washed-out-planet bug: colour maps are
 * authored in sRGB and must be decoded, while normal and roughness maps carry
 * data rather than colour and must not be touched. Keeping the rule in a single
 * table means the two loading paths cannot drift apart.
 */
export const SRGB_SLOTS = new Set([
  'earth.day',
  'earth.night',
  'earth.clouds',
  'moon.color',
  'sky.sky',
])

export function configureTexture(texture, slot) {
  texture.colorSpace = SRGB_SLOTS.has(slot) ? THREE.SRGBColorSpace : THREE.NoColorSpace
  texture.wrapS = THREE.RepeatWrapping // longitude wraps
  texture.wrapT = THREE.ClampToEdgeWrapping // latitude does not
  texture.minFilter = THREE.LinearMipmapLinearFilter
  texture.magFilter = THREE.LinearFilter
  texture.generateMipmaps = true
  texture.anisotropy = 8

  // flipY is deliberately left alone. DataTexture defaults to false and the
  // generators emit row 0 = south pole to suit it; an image texture defaults to
  // true and NASA equirectangular tiles are row 0 = north. Both therefore land
  // with north at v = 1, which is what three's SphereGeometry expects.
  texture.needsUpdate = true
  return texture
}
