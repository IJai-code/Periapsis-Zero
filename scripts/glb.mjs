/**
 * Reading a .glb's geometry under Node, for the scripts that measure models.
 *
 * Not GLTFLoader: that wants a DOM to decode textures, and nothing here needs a
 * texture. This walks the scene graph with each node's own transform and reads
 * positions and indices straight out of the binary chunk. A primitive that is
 * Draco-compressed carries no plain accessor to read, and one that is not a
 * triangle list has no surface; both are skipped, and counted, rather than
 * guessed at.
 */
import { readFileSync } from 'node:fs'
import { Matrix4, Quaternion, Vector3 } from 'three'

const INDEX_READERS = {
  5121: (b, o) => b.readUInt8(o),
  5123: (b, o) => b.readUInt16LE(o),
  5125: (b, o) => b.readUInt32LE(o),
}
const INDEX_BYTES = { 5121: 1, 5123: 2, 5125: 4 }

function nodeMatrix(n) {
  if (n.matrix) return new Matrix4().fromArray(n.matrix)
  return new Matrix4().compose(
    new Vector3(...(n.translation ?? [0, 0, 0])),
    new Quaternion(...(n.rotation ?? [0, 0, 0, 1])),
    new Vector3(...(n.scale ?? [1, 1, 1])),
  )
}

/**
 * Every triangle in the file's default scene, in the scene root's frame: a
 * Float64Array of nine numbers a triangle. `skipped` counts primitives that
 * could not be read as triangles.
 */
export function glbTriangles(file) {
  const buf = readFileSync(file)
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error(`${file} is not a binary glTF`)
  const jsonLen = buf.readUInt32LE(12)
  const gltf = JSON.parse(buf.subarray(20, 20 + jsonLen).toString())
  const bin = buf.subarray(20 + jsonLen + 8)
  const out = []
  let skipped = 0
  const v = new Vector3()

  const position = (acc, k, m) => {
    const view = gltf.bufferViews[acc.bufferView]
    const at = (view.byteOffset ?? 0) + (acc.byteOffset ?? 0) + k * (view.byteStride ?? 12)
    return v.set(bin.readFloatLE(at), bin.readFloatLE(at + 4), bin.readFloatLE(at + 8)).applyMatrix4(m)
  }

  const visit = (i, parent) => {
    const n = gltf.nodes[i]
    const m = parent.clone().multiply(nodeMatrix(n))
    for (const prim of n.mesh !== undefined ? gltf.meshes[n.mesh].primitives : []) {
      const mode = prim.mode ?? 4
      const acc = gltf.accessors[prim.attributes.POSITION]
      if (mode !== 4 || acc.bufferView === undefined || prim.extensions?.KHR_draco_mesh_compression) {
        skipped++
        continue
      }
      let index = null
      if (prim.indices !== undefined) {
        const ia = gltf.accessors[prim.indices]
        const iv = gltf.bufferViews[ia.bufferView]
        const base = (iv.byteOffset ?? 0) + (ia.byteOffset ?? 0)
        const read = INDEX_READERS[ia.componentType]
        const size = INDEX_BYTES[ia.componentType]
        index = (k) => read(bin, base + k * size)
      }
      const count = index ? gltf.accessors[prim.indices].count : acc.count
      for (let t = 0; t + 2 < count; t += 3) {
        for (let c = 0; c < 3; c++) {
          const p = position(acc, index ? index(t + c) : t + c, m)
          out.push(p.x, p.y, p.z)
        }
      }
    }
    for (const c of n.children ?? []) visit(c, m)
  }
  for (const r of gltf.scenes[gltf.scene ?? 0].nodes) visit(r, new Matrix4())
  return { triangles: Float64Array.from(out), skipped }
}

/**
 * How far a model stands out from its long axis, band by band, once turned by
 * `turn` so that axis is +Z.
 *
 * The model is cut into `bins` equal bands from its tail to its nose, and each
 * band's figure is the furthest any part of the surface inside it reaches from
 * the axis — found by clipping every triangle to the band, because distance from
 * an axis is convex and so is a clipped triangle, and a convex function over a
 * convex polygon peaks at a corner. Vertices alone will not do: a low-poly
 * cylinder has them only at its two ends, and most bands would come out empty.
 *
 * The axis is the centre of the turned bounding box in x and y. Returned as
 * fractions of the model's longest dimension, which is the figure the craft
 * scales a model by, so a band's radius in metres is its fraction times the
 * length the hull is drawn at.
 */
export function radiusProfile(triangles, turn, bins) {
  const n = triangles.length / 3
  const p = new Float64Array(n * 3)
  const v = new Vector3()
  const lo = [Infinity, Infinity, Infinity]
  const hi = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < n; i++) {
    v.set(triangles[i * 3], triangles[i * 3 + 1], triangles[i * 3 + 2]).applyMatrix4(turn)
    p[i * 3] = v.x
    p[i * 3 + 1] = v.y
    p[i * 3 + 2] = v.z
    for (let a = 0; a < 3; a++) {
      const c = a === 0 ? v.x : a === 1 ? v.y : v.z
      if (c < lo[a]) lo[a] = c
      if (c > hi[a]) hi[a] = c
    }
  }
  const cx = (lo[0] + hi[0]) / 2
  const cy = (lo[1] + hi[1]) / 2
  const z0 = lo[2]
  const length = hi[2] - lo[2]
  const longest = Math.max(hi[0] - lo[0], hi[1] - lo[1], length)
  const radius = new Float64Array(bins)
  const r = (x, y) => Math.hypot(x - cx, y - cy)

  for (let t = 0; t < n; t += 3) {
    const zs = [p[t * 3 + 2], p[t * 3 + 5], p[t * 3 + 8]]
    const zMin = Math.min(...zs)
    const zMax = Math.max(...zs)
    const first = Math.max(0, Math.floor(((zMin - z0) / length) * bins))
    const last = Math.min(bins - 1, Math.floor(((zMax - z0) / length) * bins))
    for (let b = first; b <= last; b++) {
      const a = z0 + (b / bins) * length
      const c = z0 + ((b + 1) / bins) * length
      let best = 0
      // Corners inside the band.
      for (let k = 0; k < 3; k++) {
        const z = p[(t + k) * 3 + 2]
        if (z >= a && z <= c) best = Math.max(best, r(p[(t + k) * 3], p[(t + k) * 3 + 1]))
      }
      // Where each edge crosses the band's two faces.
      for (let k = 0; k < 3; k++) {
        const i = (t + k) * 3
        const j = (t + ((k + 1) % 3)) * 3
        const za = p[i + 2]
        const zb = p[j + 2]
        if (za === zb) continue
        for (const face of [a, c]) {
          const f = (face - za) / (zb - za)
          if (f > 0 && f < 1) best = Math.max(best, r(p[i] + f * (p[j] - p[i]), p[i + 1] + f * (p[j + 1] - p[i + 1])))
        }
      }
      if (best > radius[b]) radius[b] = best
    }
  }
  return { radius: Array.from(radius, (x) => x / longest), longest, length }
}
