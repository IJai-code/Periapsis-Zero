import * as THREE from 'three'
import { makeNoise, mulberry32 } from './noise.js'
import { REGIONS, terrainFor } from '../sim/expedition.js'

export const TERRAIN_RINGS = [{ extent: 768, step: 12, hole: 0 }, { extent: 3072, step: 48, hole: 768 }, { extent: 12288, step: 192, hole: 3072 }]
export function buildExpeditionTerrain(id) {
  const terrain = terrainFor(id), region = REGIONS[id], noise = makeNoise(region.seed + 8)
  return TERRAIN_RINGS.map(({ extent, step, hole }) => {
    const n = 2 * extent / step, count = (n + 1) ** 2
    const pos = new Float32Array(count * 3), colors = new Float32Array(count * 3), indices = []
    /*
     * Per-vertex *factors*, composed in the shader with the world's palette:
     * r is broad brightness variation (and the Martian layering), g is how
     * much of Europa's brown fracture material lies here. Colours used to be
     * finished here, which left the shader nothing to work with but a grey
     * multiply, and every world read as one tinted plaster.
     */
    for (let row = 0; row <= n; row++) for (let col = 0; col <= n; col++) {
      const x = col * step - extent, z = row * step - extent, y = terrain.height(x, z), i = (row * (n + 1) + col) * 3
      pos[i] = x; pos[i + 1] = y; pos[i + 2] = z
      const grain = noise.fbm(x / 90, 5, z / 90, 3)
      const layer = id === 'mars' ? Math.sin(y / 16) * 0.1 + Math.sin(y / 47) * 0.07 : 0
      const fracture = id === 'europa' ? Math.min(1, Math.pow(Math.max(0, noise.noise3(x / 180, 2, z / 180)), 2) * 4) : 0
      colors[i] = 0.86 + grain * 0.28 + layer; colors[i + 1] = fracture; colors[i + 2] = 0
    }
    for (let row = 0; row < n; row++) for (let col = 0; col < n; col++) {
      const x = (col + 0.5) * step - extent, z = (row + 0.5) * step - extent
      if (hole && Math.abs(x) < hole && Math.abs(z) < hole) continue
      const a = row * (n + 1) + col, b = a + 1, c = a + n + 1, d = c + 1
      indices.push(a, c, b, b, c, d)
    }
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    geometry.setAttribute('ground', new THREE.BufferAttribute(colors, 3))
    geometry.setIndex(indices); geometry.computeVertexNormals(); geometry.computeBoundingSphere()
    return geometry
  })
}

/**
 * Each world's ground, by slope and height rather than one tinted colour.
 *
 * Three colours a world: the dust that settles on flats, the rock that shows
 * where the ground is too steep to hold dust, and an accent (Martian strata,
 * Europan fracture stain, lunar fresh ejecta). Slope comes from the surface
 * normal, so it is the drawn geometry's own steepness, not a guess. Colours
 * are sRGB as a person reads them and converted for the lighting maths.
 */
export const GROUND = {
  moon: { dust: '#8c8780', rock: '#55524e', accent: '#b7b1a6', bump: 0.07 },
  mars: { dust: '#b8693c', rock: '#6a3523', accent: '#d39a6a', bump: 0.06 },
  europa: { dust: '#d9e1e2', rock: '#9fb4bd', accent: '#7c4a32', bump: 0.035 },
}

/**
 * Shader detail is fixed in world metres, so neither UV repeats nor camera
 * motion comb the soil. The fine relief is a bump on the lighting, not
 * geometry: it is what makes the ground read as grit and clods at walking
 * distance, and it fades out by a few hundred metres, where it would only
 * shimmer.
 */
/**
 * Ground detail baked in Blender (art/ground/build.py): a 4 m tile of each
 * world's real small-scale ground, its pebbles, craterlets, ripples or
 * cracks, as a colour-detail map (mean 0.5 linear, so 2x it is a multiplier
 * around 1) and a normal map (+U along +x, +V along -z). Sampled at two
 * scales, the second rotated, so the repeat does not show; faded out with
 * distance, where it would only shimmer. Until the files arrive, uDetail is 0
 * and the ground is drawn as it was without them.
 */
const DETAIL_TILE = 4
const DETAIL_TILE_B = 17.3
const DETAIL_TURN = 0.6
function detailTextures(id, uniforms, material) {
  if (typeof document === 'undefined') return []
  const base = import.meta.env.BASE_URL ?? '/'
  const loader = new THREE.TextureLoader()
  let pending = 2
  // A scene drawn on demand (the front page) is told, so it draws again.
  const ready = () => { if (--pending === 0) { uniforms.uDetail.value = 1; material.dispatchEvent({ type: 'detailready' }) } }
  const load = (name, colour) => {
    const t = loader.load(`${base}authored/ground/${id}-${name}.webp`, ready)
    t.wrapS = t.wrapT = THREE.RepeatWrapping
    t.colorSpace = colour ? THREE.SRGBColorSpace : THREE.NoColorSpace
    t.anisotropy = 8
    return t
  }
  const detail = load('detail', true)
  const normal = load('normal', false)
  uniforms.uDetailMap.value = detail
  uniforms.uDetailNormal.value = normal
  return [detail, normal]
}

export function terrainMaterial(id) {
  const look = GROUND[id] ?? GROUND.moon
  const material = new THREE.MeshStandardMaterial({ roughness: 0.94, metalness: 0 })
  const lin = (hex) => new THREE.Color(hex)
  const detailUniforms = { uDetailMap: { value: null }, uDetailNormal: { value: null }, uDetail: { value: 0 } }
  const textures = detailTextures(id, detailUniforms, material)
  material.addEventListener('dispose', () => textures.forEach((t) => t.dispose()))
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, detailUniforms)
    shader.uniforms.uDust = { value: lin(look.dust) }
    shader.uniforms.uRock = { value: lin(look.rock) }
    shader.uniforms.uAccent = { value: lin(look.accent) }
    shader.uniforms.uBump = { value: look.bump }
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 ground;\nvarying vec3 vGround;\nvarying vec3 vFactor;\nvarying vec3 vUpN;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGround = position;\nvFactor = ground;\nvUpN = normal;')
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
      varying vec3 vGround;
      varying vec3 vFactor;
      varying vec3 vUpN;
      uniform vec3 uDust, uRock, uAccent;
      uniform float uBump;
      uniform sampler2D uDetailMap, uDetailNormal;
      uniform float uDetail;
      const float DETAIL_TILE = ${DETAIL_TILE.toFixed(1)};
      const float DETAIL_TILE_B = ${DETAIL_TILE_B.toFixed(1)};
      const mat2 DETAIL_TURN = mat2(${Math.cos(DETAIL_TURN).toFixed(6)}, ${Math.sin(DETAIL_TURN).toFixed(6)}, ${(-Math.sin(DETAIL_TURN)).toFixed(6)}, ${Math.cos(DETAIL_TURN).toFixed(6)});
      vec2 detailA(vec3 p) { return vec2(p.x, -p.z) / DETAIL_TILE; }
      vec2 detailB(vec3 p) { return DETAIL_TURN * vec2(p.x, -p.z) / DETAIL_TILE_B + 0.37; }
      float gHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float gNoise(vec2 p) { vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(gHash(i),gHash(i+vec2(1,0)),f.x),mix(gHash(i+vec2(0,1)),gHash(i+vec2(1,1)),f.x),f.y); }
      float gFbm(vec2 p) { return gNoise(p) * 0.5 + gNoise(p * 2.13 + 7.1) * 0.27 + gNoise(p * 4.61 + 3.3) * 0.15 + gNoise(p * 9.7 + 1.9) * 0.08; }
    `).replace('#include <color_fragment>', `#include <color_fragment>
      {
        float slope = 1.0 - clamp(normalize(vUpN).y, 0.0, 1.0);
        float blotch = gFbm(vGround.xz * 0.012);
        float rocky = smoothstep(0.16, 0.42, slope + (blotch - 0.5) * 0.18);
        vec3 col = mix(uDust, uRock, rocky);
        ${id === 'mars' ? `
        // Layered sediment where the walls are steep enough to show it: beds
        // about 30 m thick, gently warped so they are not ruled lines, and
        // faded out wherever one band would fall inside a pixel or two (the
        // first version aliased into moire contours on distant mesas).
        float bed = (vGround.y + (gFbm(vGround.xz * 0.0025) - 0.5) * 36.0) / 31.0;
        float band = 0.5 + 0.5 * sin(bed * 6.2831853) * 0.7 + 0.5 * sin(bed * 17.3) * 0.3;
        float resolved = 1.0 - smoothstep(0.12, 0.4, fwidth(bed));
        float strata = mix(0.5, band, resolved);
        col = mix(col, uAccent, rocky * smoothstep(0.4, 1.0, strata) * 0.32);
        col *= mix(1.0, 0.86 + 0.14 * strata, rocky);` : ''}
        ${id === 'europa' ? `
        // Brown fracture material, and blue where the ice is exposed and steep.
        col = mix(col, uAccent, clamp(vFactor.g, 0.0, 1.0) * 0.75);
        col = mix(col, col * vec3(0.84, 0.95, 1.06), rocky);` : ''}
        ${id === 'moon' ? `
        // Bright fresh ejecta scattered on the flats.
        float fresh = smoothstep(0.72, 0.9, gFbm(vGround.xz * 0.05 + 11.0));
        col = mix(col, uAccent, fresh * (1.0 - rocky) * 0.5);` : ''}
        float fine = gNoise(vGround.xz * 0.65) * 0.5 + gNoise(vGround.xz * 3.5) * 0.25;
        float near = 1.0 - smoothstep(70.0, 700.0, length(vViewPosition));
        #ifdef PZ_RELIEF
        // The Blender-baked ground, where it is close enough to resolve.
        float close = (1.0 - smoothstep(60.0, 260.0, length(vViewPosition))) * uDetail;
        vec3 detail = texture2D(uDetailMap, detailA(vGround)).rgb * 2.0;
        detail *= mix(vec3(1.0), texture2D(uDetailMap, detailB(vGround)).rgb * 2.0, 0.45);
        col *= mix(vec3(1.0), detail, close * (1.0 - rocky * 0.4));
        near *= 1.0 - close;
        #endif
        diffuseColor.rgb = col * vFactor.r * mix(1.0, 0.76 + fine * 0.6, near);
      }
    `).replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>
      {
        // Derivative bump (Mikkelsen 2010, as three's perturbNormalArb), in metres.
        // Off on the lowest quality tiers (gfx/surfaceQuality.js).
        #ifdef PZ_RELIEF
        float near = 1.0 - smoothstep(18.0, 240.0, length(vViewPosition));
        #else
        float near = 0.0;
        #endif
        if (near > 0.0) {
          float h = (gFbm(vGround.xz * 0.9) - 0.5) * 2.0 + (gNoise(vGround.xz * 6.0) - 0.5) * 0.35;
          h *= uBump * near;
          vec3 dpdx = dFdx(-vViewPosition), dpdy = dFdy(-vViewPosition);
          vec3 r1 = cross(dpdy, normal), r2 = cross(normal, dpdx);
          float det = dot(dpdx, r1);
          vec3 grad = sign(det) * (dFdx(h) * r1 + dFdy(h) * r2);
          normal = normalize(abs(det) * normal - grad);
        }
        #ifdef PZ_RELIEF
        // The baked normal map, two scales blended (UDN), in the frame of
        // the drawn surface: U along world +x, V along world -z.
        float close = (1.0 - smoothstep(25.0, 160.0, length(vViewPosition))) * uDetail;
        if (close > 0.0) {
          vec3 a = texture2D(uDetailNormal, detailA(vGround)).xyz * 2.0 - 1.0;
          vec3 b = texture2D(uDetailNormal, detailB(vGround)).xyz * 2.0 - 1.0;
          b.xy = transpose(DETAIL_TURN) * b.xy;
          vec3 t = normalize(vec3((a.xy + b.xy * 0.5) * close, a.z));
          vec3 up = normalize(vUpN);
          vec3 T = normalize(vec3(1.0, 0.0, 0.0) - up * up.x);
          vec3 Tv = normalize((viewMatrix * vec4(T, 0.0)).xyz);
          Tv = normalize(Tv - normal * dot(Tv, normal));
          vec3 Bv = cross(normal, Tv);
          normal = normalize(Tv * t.x + Bv * t.y + normal * t.z);
        }
        #endif
      }
    `)
  }
  material.defines = { PZ_RELIEF: '' }
  material.customProgramCacheKey = () => `survey-ground-v3-${id}-${'PZ_RELIEF' in material.defines}`
  return material
}

/**
 * Rocks: four broken-stone shapes, each a displaced icosahedron, flat-shaded
 * because real rock fractures into planes. They were one lumpy shape at
 * detail 1 (80 faces), scaled and squashed, which read as the same pebble
 * thirteen hundred times. Four shapes at 320 faces each, a per-instance tint,
 * and a flat underside so they sit on the ground instead of balancing on it.
 * Returns a group of instanced meshes; disposal walks its children.
 */
export const ROCK_TINT = { moon: '#857f77', mars: '#7a4632', europa: '#c4d0d4' }
function rockShape(seed) {
  const noise = makeNoise(seed)
  const g = new THREE.IcosahedronGeometry(1, 2)
  const p = g.attributes.position
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i)
    let k = 0.78 + 0.32 * noise.noise3(x * 1.3, y * 1.3 + seed, z * 1.3) + 0.12 * noise.noise3(x * 3.1, y * 3.1, z * 3.1)
    // Cleave: snap some of the surface onto a few planes, the way stone breaks.
    const plane = Math.max(x * 0.8 + y * 0.6, -x * 0.5 + z * 0.85, y * -0.3 + z * -0.95)
    if (plane > 0.62) k *= 0.62 / plane + 0.25 * (1 - 0.62 / plane)
    p.setXYZ(i, x * k, Math.max(y * k, -0.28), z * k)
  }
  g.computeVertexNormals()
  return g
}
export function buildRocks(id, count = 1300) {
  const rand = mulberry32(REGIONS[id].seed + 20), terrain = terrainFor(id)
  const group = new THREE.Group()
  // Six shapes, one for each stone in the Blender-built set (art/rocks), which
  // replaces them when it arrives (applyRockSet below).
  const shapes = [0, 1, 2, 3, 4, 5].map((k) => rockShape(REGIONS[id].seed * 7 + k * 31))
  const material = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.93, metalness: 0, flatShading: true })
  const base = new THREE.Color(ROCK_TINT[id] ?? ROCK_TINT.moon), tint = new THREE.Color()
  const per = Math.ceil(count / shapes.length)
  const meshes = shapes.map((geometry) => {
    const mesh = new THREE.InstancedMesh(geometry, material, per)
    mesh.castShadow = true; mesh.receiveShadow = true
    return mesh
  })
  const obj = new THREE.Object3D()
  for (let i = 0; i < count; i++) {
    const angle = rand() * Math.PI * 2, r = 18 + 760 * rand() ** 1.4, x = Math.cos(angle) * r, z = Math.sin(angle) * r
    const size = 0.13 + rand() ** 5 * 2.4
    obj.position.set(x, terrain.height(x, z) + size * 0.12, z)
    obj.rotation.set((rand() - 0.5) * 0.4, rand() * 6.28, (rand() - 0.5) * 0.4)
    obj.scale.set(size * (0.8 + rand() * 0.5), size * (0.5 + rand() * 0.35), size * (0.8 + rand() * 0.5)); obj.updateMatrix()
    const mesh = meshes[i % meshes.length], slot = Math.floor(i / meshes.length)
    mesh.setMatrixAt(slot, obj.matrix)
    tint.copy(base).multiplyScalar(0.78 + rand() * 0.4)
    mesh.setColorAt(slot, tint)
  }
  // Only the slots actually filled are drawn; an unfilled slot is an identity
  // matrix, a one-metre rock at the origin.
  meshes.forEach((mesh, k) => { mesh.count = Math.ceil((count - k) / meshes.length) })
  // The filled counts, so a quality tier can draw a fraction of each (the
  // placement order is random, so dropping the tail thins evenly).
  group.userData.full = meshes.map((mesh) => mesh.count)
  for (const mesh of meshes) {
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    mesh.computeBoundingSphere()
    group.add(mesh)
  }
  group.userData.dispose = () => { shapes.forEach((g) => g.dispose()); material.dispose() }
  return group
}

/**
 * Swap the Blender-baked stones (art/rocks/build.py) into a rock group made by
 * `buildRocks`: same placements, same per-instance tints, new geometry and a
 * material with baked colour, normal and occlusion. The baked colour is
 * normalised to a 0.5 mean, so the material colour doubles it back.
 */
export function applyRockSet(group, authored) {
  if (!authored || group.userData.authored) return
  let material = null
  group.children.forEach((mesh, k) => {
    const node = authored.scene.getObjectByName(`rock_${k}`)
    const source = node?.isMesh ? node : node?.children?.find((c) => c.isMesh)
    if (!source) return
    if (!material) {
      material = source.material.clone()
      material.color.setScalar(2)
      material.flatShading = false
    }
    mesh.geometry = source.geometry
    mesh.material = material
    mesh.computeBoundingSphere()
  })
  if (material) {
    const dispose = group.userData.dispose
    group.userData.dispose = () => { dispose?.(); material.dispose() }
    group.userData.authored = true
  }
}
