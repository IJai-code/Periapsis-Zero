import * as THREE from 'three'
import { makeNoise } from './noise.js'
import { REGIONS, rockField, terrainFor } from '../sim/expedition.js'

export const TERRAIN_RINGS = [{ extent: 768, step: 12, hole: 0 }, { extent: 3072, step: 32, hole: 768 }, { extent: 12288, step: 128, hole: 3072 }]
export function buildExpeditionTerrain(id) {
  const terrain = terrainFor(id), region = REGIONS[id], noise = makeNoise(region.seed + 8)
  return TERRAIN_RINGS.map(({ extent, step, hole }) => {
    const n = 2 * extent / step, count = (n + 1) ** 2
    const pos = new Float32Array(count * 3), colors = new Float32Array(count * 3), indices = new Uint32Array(n * n * 6)
    let k = 0
    /*
     * Per-vertex *factors*, composed in the shader with the world's palette:
     * r is broad brightness variation, g is Europa's fracture stain, b is the
     * world's own feature mask (a lake, a groove band, a cell edge, the
     * tessera highlands: sim/expedition.js terrain.mask).
     */
    for (let row = 0; row <= n; row++) for (let col = 0; col <= n; col++) {
      const x = col * step - extent, z = row * step - extent, y = terrain.height(x, z), i = (row * (n + 1) + col) * 3
      pos[i] = x; pos[i + 1] = y; pos[i + 2] = z
      const grain = noise.fbm(x / 90, 5, z / 90, 3)
      const fracture = region.style === 'ridged' ? Math.min(1, Math.pow(Math.max(0, noise.noise3(x / 180, 2, z / 180)), 2) * 4) : 0
      colors[i] = 0.86 + grain * 0.28; colors[i + 1] = fracture; colors[i + 2] = terrain.mask(x, z)
    }
    for (let row = 0; row < n; row++) for (let col = 0; col < n; col++) {
      const x = (col + 0.5) * step - extent, z = (row + 0.5) * step - extent
      if (hole && Math.abs(x) < hole && Math.abs(z) < hole) continue
      const a = row * (n + 1) + col, b = a + 1, c = a + n + 1, d = c + 1
      indices[k++] = a; indices[k++] = c; indices[k++] = b; indices[k++] = b; indices[k++] = c; indices[k++] = d
    }
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    geometry.setAttribute('ground', new THREE.BufferAttribute(colors, 3))
    geometry.setIndex(new THREE.BufferAttribute(indices.slice(0, k), 1)); geometry.computeVertexNormals(); geometry.computeBoundingSphere()
    return geometry
  })
}

/**
 * Ground detail baked in Blender (art/ground/build.py): a 4 m tile of each
 * world's real small-scale ground, as a colour-detail map (linear mean 0.5, so
 * 2x it is a multiplier around 1) and a normal map (+U along +x, +V along -z).
 * Worlds share tiles where their ground is alike (`tile` in sim/worlds.js).
 * Sampled at two scales, the second rotated, so the repeat does not show; on
 * steep ground also from the side, so cliffs are not a smear of the ground's
 * own texture; faded with distance, where it would only shimmer.
 */
const DETAIL_TILE = 4
const DETAIL_TILE_B = 17.3
const DETAIL_TURN = 0.6
function detailTextures(tile, uniforms, material) {
  if (typeof document === 'undefined') return []
  const base = import.meta.env.BASE_URL ?? '/'
  const loader = new THREE.TextureLoader()
  let pending = 2
  // A scene drawn on demand (the front page) is told, so it draws again.
  const ready = () => { if (--pending === 0) { uniforms.uDetail.value = 1; material.dispatchEvent({ type: 'detailready' }) } }
  const load = (name, colour) => {
    const t = loader.load(`${base}authored/ground/${tile}-${name}.webp`, ready, undefined, () => { pending = 99 })
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

/**
 * Each world's ground, by slope, height and its own geology rather than one
 * tinted colour. Three colours a world (sim/worlds.js `ground`): the dust that
 * settles on flats, the rock that shows where it is too steep to hold dust,
 * and an accent the style uses its own way.
 */
function styleGlsl(style) {
  switch (style) {
    case 'mesa': return `
        // The beds the cliffs are cut from, at the heights the ground model
        // (sim/expedition.js) puts its benches, of uneven thickness and each
        // split into a few sub-beds of its own colour. They show only where
        // rock is exposed: dust drapes the gentler faces, talus aprons bury
        // the foot of every cliff, and dark varnish streaks run down from the
        // rims. The first two versions were ruled stripes round every butte.
        float wy = vGround.y + (gFbm(vGround.xz * 0.0016) - 0.5) * 50.0 + (gFbm(vGround.xz * 0.011) - 0.5) * 8.0 + dot(vGround.xz, vec2(0.006, -0.004));
        float t = wy / 38.0 + 0.7 * sin(wy / 91.0);
        float bed = floor(t), f = fract(t);
        float parts = 2.0 + floor(gHash(vec2(bed, 5.3)) * 3.0);
        float sub = floor(pow(f, 0.8 + gHash(vec2(bed, 2.9))) * parts) + bed * 7.0;
        vec3 bedCol = mix(uRock, uAccent, gHash(vec2(bed, 7.7)) * 0.55) * (0.88 + 0.2 * gHash(vec2(bed, 1.3)));
        bedCol = mix(bedCol, uDust, 0.35 * gHash(vec2(bed, 9.1)));
        float subs = 1.0 - smoothstep(0.1, 0.35, fwidth(t * parts));
        bedCol *= 1.0 + subs * (gHash(vec2(sub, 4.4)) - 0.5) * 0.16;
        float ledge = (1.0 - smoothstep(0.0, 0.07, f)) * (1.0 - smoothstep(0.1, 0.4, fwidth(t)));
        float streak = gFbm(vec2((vGround.x * 0.7 + vGround.z * 0.7) * 0.09, vGround.y * 0.004));
        float resolved = 1.0 - smoothstep(0.2, 0.6, fwidth(t));
        vec3 wall = bedCol * (1.0 - 0.2 * ledge) * (0.72 + 0.46 * streak);
        float drape = gFbm(vec2(dot(vGround.xz, vec2(0.7, 0.7)) * 0.006, vGround.y * 0.004 + vGround.x * 0.002));
        float exposed = smoothstep(0.26, 0.52, slope + (gFbm(vGround.xz * 0.012 + vGround.y * 0.008) - 0.5) * 0.8) * smoothstep(0.3, 0.55, drape);
        vec3 talus = mix(uDust, uRock, 0.45) * (0.8 + 0.35 * gNoise(vGround.xz * 0.4));
        col = mix(col, talus, rocky * (1.0 - exposed));
        col = mix(col, mix(mix(uRock, uAccent, 0.3), wall, resolved), exposed);`
    case 'ridged': return `
        col = mix(col, uAccent, clamp(vFactor.g, 0.0, 1.0) * 0.75);
        col = mix(col, col * vec3(0.84, 0.95, 1.06), rocky);`
    case 'cratered': return `
        // Bright fresh ejecta scattered on the flats.
        float fresh = smoothstep(0.72, 0.9, gFbm(vGround.xz * 0.05 + 11.0));
        col = mix(col, uAccent, fresh * (1.0 - rocky) * 0.5);`
    case 'small': return `
        float streak = smoothstep(0.55, 0.85, gFbm(vec2(dot(vGround.xz, vec2(0.62, 0.78)) * 0.02, dot(vGround.xz, vec2(-0.78, 0.62)) * 0.004)));
        col = mix(col, uAccent, streak * 0.35);`
    case 'grooved': return `
        // Bright grooved terrain where the band mask is, old dark ice elsewhere.
        col = mix(col * 0.8, uAccent, vFactor.b * (0.55 + 0.35 * gFbm(vGround.xz * 0.03)));`
    case 'volcanic': return `
        // Sulfur in its colours: yellow frost, orange and red deposits, black
        // silicate lava. The lake mask is molten (see the emissive pass).
        float s1 = gFbm(vGround.xz * 0.004), s2 = gFbm(vGround.xz * 0.013 + 4.0);
        col = mix(col, uAccent, smoothstep(0.55, 0.75, s1) * 0.8);
        col = mix(col, vec3(0.05, 0.045, 0.04), smoothstep(0.62, 0.78, s2) * 0.85);
        col = mix(col, vec3(0.04, 0.035, 0.03), vFactor.b);`
    case 'dunes': return `
        // Dark organic sand on the dunes, brighter ice-rich ground between.
        float crest = smoothstep(-2.0, 18.0, vGround.y - gFbm(vGround.xz * 0.002) * 30.0);
        col = mix(uAccent * 1.6, col, crest);
        col = mix(col, vec3(0.03, 0.025, 0.02), vFactor.b);`
    case 'tessera': return `
        // Tessera highlands lighter and crumpled; the plains dark basalt.
        col = mix(col * 0.75, mix(uDust, uAccent, 0.5), vFactor.b * 0.8);`
    case 'cells': return `
        // Tholin gathers in the troughs between nitrogen cells.
        col = mix(col, uAccent, vFactor.b * 0.6);
        col = mix(col, uRock, rocky);`
    default: return ''
  }
}

export function terrainMaterial(id) {
  const w = REGIONS[id]
  const look = w.ground
  const material = new THREE.MeshStandardMaterial({ roughness: 0.94, metalness: 0 })
  const lin = (hex) => new THREE.Color(hex)
  const detailUniforms = { uDetailMap: { value: null }, uDetailNormal: { value: null }, uDetail: { value: 0 }, uTime: { value: 0 } }
  const textures = detailTextures(w.tile, detailUniforms, material)
  material.userData.uniforms = detailUniforms
  material.addEventListener('dispose', () => textures.forEach((t) => t.dispose()))
  const molten = w.style === 'volcanic', glossy = w.style === 'dunes'
  const flatMask = glossy || molten ? '1.0' : '0.0'
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
      uniform float uBump, uTime;
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
        ${styleGlsl(w.style)}
        float fine = gNoise(vGround.xz * 0.65) * 0.5 + gNoise(vGround.xz * 3.5) * 0.25;
        float near = 1.0 - smoothstep(70.0, 700.0, length(vViewPosition));
        #ifdef PZ_RELIEF
        // The Blender-baked ground, where it is close enough to resolve; on
        // steep ground sampled from the side as well (a cheap triplanar).
        float close = (1.0 - smoothstep(60.0, 260.0, length(vViewPosition))) * uDetail * (1.0 - vFactor.b * ${flatMask});
        vec3 detail = texture2D(uDetailMap, detailA(vGround)).rgb * 2.0;
        detail *= mix(vec3(1.0), texture2D(uDetailMap, detailB(vGround)).rgb * 2.0, 0.45);
        vec3 nUp = abs(normalize(vUpN));
        vec3 side = nUp.x > nUp.z ? texture2D(uDetailMap, vec2(vGround.z, vGround.y) / 7.0).rgb * 2.0 : texture2D(uDetailMap, vec2(vGround.x, vGround.y) / 7.0).rgb * 2.0;
        detail = mix(detail, side, smoothstep(0.35, 0.7, 1.0 - nUp.y));
        col *= mix(vec3(1.0), detail, close * (1.0 - rocky * 0.2));
        near *= 1.0 - close;
        #endif
        diffuseColor.rgb = col * vFactor.r * mix(1.0, 0.76 + fine * 0.6, near);
      }
    `).replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
      ${glossy ? 'roughnessFactor = mix(roughnessFactor, 0.06, vFactor.b);' : ''}
    `).replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>
      {
        // Derivative bump (Mikkelsen 2010, as three's perturbNormalArb), in metres.
        // Off on the lowest quality tiers (gfx/surfaceQuality.js).
        #ifdef PZ_RELIEF
        float near = 1.0 - smoothstep(18.0, 240.0, length(vViewPosition));
        #else
        float near = 0.0;
        #endif
        near *= 1.0 - vFactor.b * ${flatMask};
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
        // The baked normal map, two scales blended (UDN), in the surface's frame.
        float close = (1.0 - smoothstep(25.0, 160.0, length(vViewPosition))) * uDetail * (1.0 - vFactor.b * ${flatMask});
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
    `).replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      ${molten ? `
      {
        // Molten rock in the lake: a crust that cracks and glows, slowly churning.
        float crust = gFbm(vGround.xz * 0.06 + vec2(uTime * 0.02, -uTime * 0.013));
        float cracks = 1.0 - smoothstep(0.0, 0.08, abs(crust - 0.5));
        vec3 glow = mix(vec3(1.0, 0.25, 0.04), vec3(1.0, 0.75, 0.3), cracks) * (0.4 + 1.8 * cracks);
        totalEmissiveRadiance += glow * vFactor.b * 1.6;
      }` : ''}
    `)
  }
  material.defines = { PZ_RELIEF: '' }
  material.customProgramCacheKey = () => `survey-ground-v5-${id}-${'PZ_RELIEF' in material.defines}`
  return material
}

/**
 * Rocks: six broken-stone shapes, displaced icosahedra flat-shaded the way
 * stone fractures, until the Blender-baked set (art/rocks) arrives and
 * applyRockSet swaps it in. Placements are the simulation's (rockField), which
 * also collides with them: what is drawn is exactly what blocks.
 */
function rockShape(seed) {
  const noise = makeNoise(seed)
  const g = new THREE.IcosahedronGeometry(1, 2)
  const p = g.attributes.position
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i)
    let k = 0.78 + 0.32 * noise.noise3(x * 1.3, y * 1.3 + seed, z * 1.3) + 0.12 * noise.noise3(x * 3.1, y * 3.1, z * 3.1)
    const plane = Math.max(x * 0.8 + y * 0.6, -x * 0.5 + z * 0.85, y * -0.3 + z * -0.95)
    if (plane > 0.62) k *= 0.62 / plane + 0.25 * (1 - 0.62 / plane)
    p.setXYZ(i, x * k, Math.max(y * k, -0.28), z * k)
  }
  g.computeVertexNormals()
  return g
}
export function buildRocks(id) {
  const f = rockField(id), count = f.n
  const group = new THREE.Group()
  const shapes = [0, 1, 2, 3, 4, 5].map((k) => rockShape(REGIONS[id].seed * 7 + k * 31))
  const material = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.93, metalness: 0, flatShading: true })
  const base = new THREE.Color(REGIONS[id].rockTint), tint = new THREE.Color()
  const per = Math.ceil(count / shapes.length)
  const meshes = shapes.map((geometry) => {
    const mesh = new THREE.InstancedMesh(geometry, material, per)
    mesh.castShadow = true; mesh.receiveShadow = true
    return mesh
  })
  const obj = new THREE.Object3D()
  for (let i = 0; i < count; i++) {
    obj.position.set(f.x[i], f.y[i], f.z[i])
    obj.rotation.set(f.rx[i], f.ry[i], f.rz[i])
    obj.scale.set(f.sx[i], f.sy[i], f.sz[i]); obj.updateMatrix()
    const mesh = meshes[i % meshes.length], slot = Math.floor(i / meshes.length)
    mesh.setMatrixAt(slot, obj.matrix)
    tint.copy(base).multiplyScalar(f.tint[i])
    mesh.setColorAt(slot, tint)
  }
  meshes.forEach((mesh, k) => { mesh.count = Math.ceil((count - k) / meshes.length) })
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
 * buildRocks: same placements, same per-instance tints, new geometry and a
 * material with baked colour, normal and occlusion. The baked colour is
 * normalised to a 0.5 linear mean, so the material colour doubles it back.
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
