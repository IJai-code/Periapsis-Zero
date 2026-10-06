import * as THREE from 'three'

/**
 * Close-up surface detail: a tiling normal and roughness map (CC0, Poly
 * Haven; public/game/detail/CREDITS.txt) laid over a model's own baked
 * surface. The baked atlas carries the panels and paint at a few centimetres
 * a texel; this carries the plate grain, scratches and wear underneath it,
 * so a hull or a deck plate still has something to show at arm's length.
 *
 * Projected triplanar in the model's own frame, so it needs no UVs and does
 * not swim as the model moves. A patch on MeshStandardMaterial, shared by
 * every material with the same set (one program per set).
 */
const BASE = import.meta.env.BASE_URL
const cache = new Map()
function maps(set) {
  if (cache.has(set)) return cache.get(set)
  const load = (f) => {
    const t = new THREE.TextureLoader().load(`${BASE}game/detail/${f}`)
    t.wrapS = t.wrapT = THREE.RepeatWrapping
    t.colorSpace = THREE.NoColorSpace
    t.anisotropy = 8
    return t
  }
  const m = { normal: load(`${set}-normal.webp`), rough: load(`${set}-rough.webp`) }
  cache.set(set, m)
  return m
}

/**
 * Add detail to a material. `scale` is repeats per metre; `strength` how far
 * the detail normal bends the surface (0..1); `wear` how much the roughness
 * map varies the shine.
 */
export function addDetail(material, set, { scale = 0.5, strength = 0.5, wear = 0.5 } = {}) {
  if (!material?.isMeshStandardMaterial || material.userData.detail) return material
  const m = maps(set)
  material.userData.detail = set
  material.customProgramCacheKey = () => `detail:${set}`
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uDetailN = { value: m.normal }
    shader.uniforms.uDetailR = { value: m.rough }
    shader.uniforms.uDetail = { value: new THREE.Vector3(scale, strength, wear) }
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        uniform vec3 uDetail;
        varying vec3 vDP; varying vec3 vDN; varying vec3 vAX; varying vec3 vAY; varying vec3 vAZ;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vDP = position * uDetail.x; vDN = normalize(normal);
        vAX = normalize(normalMatrix * vec3(1.0, 0.0, 0.0)); vAY = normalize(normalMatrix * vec3(0.0, 1.0, 0.0)); vAZ = normalize(normalMatrix * vec3(0.0, 0.0, 1.0));`)
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform sampler2D uDetailN; uniform sampler2D uDetailR; uniform vec3 uDetail;
        varying vec3 vDP; varying vec3 vDN; varying vec3 vAX; varying vec3 vAY; varying vec3 vAZ;
        vec3 dTri; float dRough;`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        {
          vec3 dn = normalize(vDN);
          vec3 w = pow(abs(dn), vec3(4.0)); w /= (w.x + w.y + w.z);
          float r = texture2D(uDetailR, vDP.zy).r * w.x + texture2D(uDetailR, vDP.xz).r * w.y + texture2D(uDetailR, vDP.xy).r * w.z;
          roughnessFactor = clamp(roughnessFactor * mix(1.0, 0.55 + 0.9 * r, uDetail.z), 0.04, 1.0);
        }`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        {
          // Whiteout-blended triplanar normal, in the model's frame, then to view space.
          vec3 dn = normalize(vDN);
          vec3 w = pow(abs(dn), vec3(4.0)); w /= (w.x + w.y + w.z);
          vec3 tX = texture2D(uDetailN, vDP.zy).xyz * 2.0 - 1.0;
          vec3 tY = texture2D(uDetailN, vDP.xz).xyz * 2.0 - 1.0;
          vec3 tZ = texture2D(uDetailN, vDP.xy).xyz * 2.0 - 1.0;
          vec3 nX = vec3(tX.xy + dn.zy, abs(tX.z) * dn.x);
          vec3 nY = vec3(tY.xy + dn.xz, abs(tY.z) * dn.y);
          vec3 nZ = vec3(tZ.xy + dn.xy, abs(tZ.z) * dn.z);
          vec3 obj = normalize(nX.zyx * w.x + nY.xzy * w.y + nZ.xyz * w.z);
          vec3 dView = normalize(obj.x * vAX + obj.y * vAY + obj.z * vAZ);
          vec3 base = normalize(dn.x * vAX + dn.y * vAY + dn.z * vAZ);
          // Only the difference the detail makes, added to the surface's own normal.
          normal = normalize(normal + (dView - base) * uDetail.y);
        }`)
  }
  material.needsUpdate = true
  return material
}

/** Every eligible material in a model: not glass, not lamps, not the pilot. */
export function detailModel(root, set, opts) {
  root.traverse((o) => {
    if (!o.isMesh) return
    for (const mat of [o.material].flat()) {
      const n = mat?.name ?? ''
      if (/glass|canopy|glow|lights|navred|navgreen|ion|pilot/.test(n) || mat?.transparent) continue
      addDetail(mat, set, opts)
    }
  })
}
