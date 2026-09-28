import * as THREE from 'three'
import { makeNoise } from './noise.js'

/**
 * The bodies too small to be round.
 *
 * Self-gravity pulls anything much over 400 km across into a sphere; below
 * that a body keeps whatever shape its impacts left it. Phobos is 27 × 22 ×
 * 18 km, Deimos 15 × 12 × 11 km, Halley's nucleus 15 × 8 × 8 km — so each is
 * built as its triaxial ellipsoid, roughened by low-frequency noise at the
 * scale of its largest impacts, with its signature craters pressed in. Built
 * once, in metres, on the CPU; the surface shader then adds the craters and
 * grooves too small for geometry.
 */

const DEG = Math.PI / 180

/** Press a bowl into radius r at direction c, angular radius `a`, depth fraction `d`. */
function crater(r, dir, c, a, d) {
  const cos = dir.x * c.x + dir.y * c.y + dir.z * c.z
  const ang = Math.acos(Math.max(-1, Math.min(1, cos)))
  if (ang > a * 1.4) return r
  const t = ang / a
  if (t < 1) return r * (1 - d * (1 - t * t)) + r * d * 0.35 * Math.exp(-(((t - 0.92) / 0.12) ** 2))
  return r * (1 + d * 0.2 * Math.exp(-(t - 1) * 5))
}

const unit = (lat, lon) =>
  new THREE.Vector3(Math.cos(lat * DEG) * Math.cos(lon * DEG), Math.sin(lat * DEG), -Math.cos(lat * DEG) * Math.sin(lon * DEG))

/**
 * @param {[number, number, number]} axes  semi-axes along object x, z (east) and y (north), metres
 * @param {object} opts  seed, roughness, and named craters
 */
export function irregularBody(axes, { seed = 7, rough = 0.12, craters = [], detail = 5 } = {}) {
  const geo = new THREE.IcosahedronGeometry(1, detail)
  const pos = geo.attributes.position
  const noise = makeNoise(seed)
  const dir = new THREE.Vector3()
  const [ax, ay, az] = [axes[0], axes[2], axes[1]]
  const named = craters.map((k) => ({ c: unit(k.lat, k.lon), a: k.radius, d: k.depth }))
  for (let i = 0; i < pos.count; i++) {
    dir.fromBufferAttribute(pos, i).normalize()
    // Ellipsoid radius along this direction.
    const e = 1 / Math.sqrt((dir.x / ax) ** 2 + (dir.y / ay) ** 2 + (dir.z / az) ** 2)
    let r = e * (1 + rough * noise.fbm(dir.x * 1.6, dir.y * 1.6, dir.z * 1.6, 4))
    for (const k of named) r = crater(r, dir, k.c, k.a, k.d)
    pos.setXYZ(i, dir.x * r, dir.y * r, dir.z * r)
  }
  geo.computeVertexNormals()
  geo.computeBoundingSphere()
  return geo
}

/** Phobos: Stickney, 9 km across, at 1°S 49°W. */
export const phobosGeometry = (axes) =>
  irregularBody(axes, { seed: 0x9b0, rough: 0.1, craters: [{ lat: -1, lon: 311, radius: 0.42, depth: 0.14 }] })

export const deimosGeometry = (axes) =>
  irregularBody(axes, { seed: 0xde1, rough: 0.07, craters: [{ lat: -10, lon: 60, radius: 0.5, depth: 0.08 }] })

/** Halley: a peanut, two lobes and a waist. */
export function nucleusGeometry(axes) {
  const geo = irregularBody(axes, { seed: 0x1986, rough: 0.16 })
  const pos = geo.attributes.position
  const v = new THREE.Vector3()
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i)
    const x = v.x / axes[0]
    const pinch = 1 - 0.28 * Math.exp(-((x / 0.3) ** 2))
    pos.setXYZ(i, v.x, v.y * pinch, v.z * pinch)
  }
  geo.computeVertexNormals()
  geo.computeBoundingSphere()
  return geo
}
