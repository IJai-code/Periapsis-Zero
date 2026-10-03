import * as THREE from 'three'
import { makeNoise, mulberry32 } from './noise.js'
import { REGIONS, terrainFor } from '../sim/expedition.js'

export const TERRAIN_RINGS = [{ extent: 768, step: 12, hole: 0 }, { extent: 3072, step: 48, hole: 768 }, { extent: 12288, step: 192, hole: 3072 }]
export function buildExpeditionTerrain(id) {
  const terrain = terrainFor(id), region = REGIONS[id], noise = makeNoise(region.seed + 8)
  return TERRAIN_RINGS.map(({ extent, step, hole }) => {
    const n = 2 * extent / step, count = (n + 1) ** 2
    const pos = new Float32Array(count * 3), colors = new Float32Array(count * 3), indices = []
    const base = new THREE.Color(region.color), color = new THREE.Color()
    for (let row = 0; row <= n; row++) for (let col = 0; col <= n; col++) {
      const x = col * step - extent, z = row * step - extent, y = terrain.height(x, z), i = (row * (n + 1) + col) * 3
      pos[i] = x; pos[i + 1] = y; pos[i + 2] = z
      const grain = noise.fbm(x / 90, 5, z / 90, 3)
      const layer = id === 'mars' ? Math.sin(y / 16) * 0.1 + Math.sin(y / 47) * 0.07 : 0
      const fracture = id === 'europa' ? Math.pow(Math.max(0, noise.noise3(x / 180, 2, z / 180)), 2) : 0
      color.copy(base).multiplyScalar(0.85 + grain * 0.28 + layer)
      if (id === 'europa') color.lerp(new THREE.Color('#604d3c'), Math.min(0.65, fracture * 3))
      colors[i] = color.r; colors[i + 1] = color.g; colors[i + 2] = color.b
    }
    for (let row = 0; row < n; row++) for (let col = 0; col < n; col++) {
      const x = (col + 0.5) * step - extent, z = (row + 0.5) * step - extent
      if (hole && Math.abs(x) < hole && Math.abs(z) < hole) continue
      const a = row * (n + 1) + col, b = a + 1, c = a + n + 1, d = c + 1
      indices.push(a, c, b, b, c, d)
    }
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    geometry.setIndex(indices); geometry.computeVertexNormals(); geometry.computeBoundingSphere()
    return geometry
  })
}

/** Shader detail is fixed in world metres, so neither UV repeats nor camera motion comb the soil. */
export function terrainMaterial(id) {
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96, metalness: 0 })
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vGround;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvGround = position;')
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
      varying vec3 vGround;
      float gHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float gNoise(vec2 p) { vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(gHash(i),gHash(i+vec2(1,0)),f.x),mix(gHash(i+vec2(0,1)),gHash(i+vec2(1,1)),f.x),f.y); }
    `).replace('#include <color_fragment>', `#include <color_fragment>
      float detail = gNoise(vGround.xz * 0.65) * 0.5 + gNoise(vGround.xz * 3.5) * 0.25;
      float fade = 1.0 - smoothstep(70.0, 700.0, length(vViewPosition));
      diffuseColor.rgb *= mix(1.0, 0.72 + detail * 0.68, fade);
    `)
  }
  material.customProgramCacheKey = () => `survey-ground-${id}`
  return material
}

export function buildRocks(id, count = 1300) {
  const rand = mulberry32(REGIONS[id].seed + 20), terrain = terrainFor(id)
  const geometry = new THREE.IcosahedronGeometry(1, 1)
  const p = geometry.attributes.position
  for (let i = 0; i < p.count; i++) {
    const k = 0.82 + 0.18 * Math.sin(p.getX(i) * 13 + p.getZ(i) * 9)
    p.setXYZ(i, p.getX(i) * k, p.getY(i) * k, p.getZ(i) * k)
  }
  geometry.computeVertexNormals()
  const material = new THREE.MeshStandardMaterial({ color: id === 'europa' ? '#b9c8cc' : id === 'mars' ? '#624535' : '#66615a', roughness: 0.95 })
  const mesh = new THREE.InstancedMesh(geometry, material, count), obj = new THREE.Object3D()
  for (let i = 0; i < count; i++) {
    const angle = rand() * Math.PI * 2, r = 18 + 760 * rand() ** 1.4, x = Math.cos(angle) * r, z = Math.sin(angle) * r
    const size = 0.13 + rand() ** 5 * 2.4
    obj.position.set(x, terrain.height(x, z) + size * 0.17, z)
    obj.rotation.set(rand(), rand() * 6.28, rand()); obj.scale.set(size, size * 0.65, size * 1.2); obj.updateMatrix()
    mesh.setMatrixAt(i, obj.matrix)
  }
  mesh.instanceMatrix.needsUpdate = true; mesh.computeBoundingSphere(); mesh.castShadow = true; mesh.receiveShadow = true
  return mesh
}
