import * as THREE from 'three'
import { BODIES } from '../sim/constants.js'
import { scalarUniform } from './scalarUniform.js'

/**
 * The ground at a lunar site: three levels of real height data, stitched.
 *
 * The data is scripts/fetch-moon-terrain.mjs's — LROC's 2 m NAC terrain model
 * of the landing site, inside LOLA at 30 m, inside LOLA at 118 m out past the
 * horizon an ascending LM sees. This module turns it into geometry. It is the
 * lunar counterpart of Terrain.jsx, with three differences that each follow
 * from something the Earth pads never needed.
 *
 * ── three levels, one surface ─────────────────────────────────────────
 *
 * Each level is a grid in latitude and longitude. A coarser level leaves a hole
 * exactly where the next finer one is drawn: the hole is the set of its own
 * cells that lie wholly inside the finer level, so its edge runs along its own
 * grid lines. The finer level is then fitted to that edge — its vertices clamped
 * into the hole, which folds the part of it outside into zero-area triangles —
 * and its heights are blended, over a band inside the edge, onto the coarser
 * level's surface. On the edge itself the finer level's vertices therefore lie on
 * the coarser level's triangle edges, which are straight lines between its
 * vertices, and bilinear interpolation along a grid line is that same straight
 * line: the seam is closed by construction rather than hidden by a skirt.
 *
 * The outermost level is blended, the same way, onto height zero — the sphere
 * the Moon is drawn as — and the sphere is cut away underneath it (Moon.jsx), so
 * the real ground replaces the drawn globe rather than fighting it for depth.
 *
 * ── the datum ─────────────────────────────────────────────────────────
 *
 * The site sits at exactly one lunar radius, the rule the Earth pads follow and
 * for the same reason: the flight model's surface is a sphere. Tranquility Base
 * is 1,927 m below LOLA's 1737.4 km reference, so every level is shifted up by
 * its own height at the site — the three agree on that height to 8 m, the NAC
 * model and the 30 m LOLA grid to 0.3 — and relief is preserved exactly.
 *
 * ── the frame ─────────────────────────────────────────────────────────
 *
 * Built in the site's own frame: x east, y up, z south. That is right-handed
 * (east × up = south), so unlike the Earth pads, whose "z north" needed a
 * mirrored group, this one is a plain rotation. The frame is fixed to the
 * Moon, which turns rigidly, so the geometry is built once and only the group
 * that carries it moves.
 */

const R = BODIES.moon.radius
const DEG = Math.PI / 180

/**
 * What the rest of the scene needs to know about the ground: the globe, where
 * to cut itself away (Moon.jsx), and the cameras, how high the ground is.
 * Written by LunarSurface.jsx; `hole` every frame, the rest once the data is in.
 */
export const lunarGround = {
  /** 1 while the ground is drawn and the globe is cut away under it. */
  hole: scalarUniform(0),
  /** The cut, in the globe's map coordinates: west, east, south, north. */
  bounds: new THREE.Vector4(),
  /** Height above the datum at `east`, `south` metres from the site, or null before the data is in. For set-up. */
  heightAt: null,
}

/*
 * The same lookup for frame paths: east and south into slots 0 and 1, height
 * out in slot 2, from `probeGround()`. Slots rather than arguments and a return
 * value, because a double crossing a call V8 does not inline is boxed — see the
 * README's allocation rule. Height 0 on a sphere, curvature included, until the
 * data is in.
 */
export const groundProbe = new Float64Array(3)
let _levels = null
let _siteLat = 0
let _siteLon = 0
let _cosLat = 1

/**
 * The ground's height above the datum at a point `east`, `south` metres from
 * the site along its own axes — the drawn surface, from the finest level that
 * covers it, less the curvature: the datum is the sphere, and the site frame
 * is its tangent plane. Allocation-free.
 */
/** Drop the loaded ground: the probe answers with the bare sphere again. */
export function forgetGround() {
  _levels = null
}

export function probeGround() {
  const east = groundProbe[0]
  const south = groundProbe[1]
  const drop = (east * east + south * south) / (2 * R)
  groundProbe[2] = -drop
  if (_levels === null) return
  const lat = _siteLat - south / (R * DEG)
  const lon = _siteLon + east / (R * DEG * _cosLat)
  for (let k = 0; k < _levels.length; k++) {
    const l = _levels[k]
    const g = l.grid
    const n = l.samples
    const fy = (lat - g.latTop) / g.latStep
    const fx = (lon - g.lonLeft) / g.lonStep
    if (fy < 1 || fx < 1 || fy > n - 2 || fx > n - 2) continue
    const j = Math.floor(fy)
    const i = Math.floor(fx)
    const ty = fy - j
    const tx = fx - i
    const h = l.shaped
    const a = h[j * n + i] * (1 - tx) + h[j * n + i + 1] * tx
    const b = h[(j + 1) * n + i] * (1 - tx) + h[(j + 1) * n + i + 1] * tx
    groundProbe[2] = a * (1 - ty) + b * ty - drop
    return
  }
}

/** Radius around the LM held at the datum, m — the stage it stands on, and a little ground round its pads. */
export const FLAT_RADIUS = 6
/** Where the flattened ground has blended back into the data, m. */
export const FLAT_BLEND = 11

/**
 * How each level is built: vertex stride over its samples, the width of the
 * band over which its heights blend into the next level out, m, and the
 * distance at which it stops being worth drawing.
 */
const BUILD = {
  near: { stride: 2, blend: 160 },
  mid: { stride: 4, blend: 2500 },
  far: { stride: 8, blend: 12000 },
}

/* ---------------------------------------------------------------- *
 * Loading
 * ---------------------------------------------------------------- */

/** Decode one packed level into metres relative to the reference sphere. */
async function loadLevel(base, entry) {
  const img = new Image()
  img.src = `${base}${entry.file}`
  await img.decode()
  const n = entry.samples
  const canvas = document.createElement('canvas')
  canvas.width = n
  canvas.height = n
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(img, 0, 0)
  const { data } = ctx.getImageData(0, 0, n, n)
  const heights = new Float32Array(n * n)
  const { base: b, step } = entry.encoding
  for (let i = 0; i < n * n; i++) heights[i] = b + (data[i * 4] * 256 + data[i * 4 + 1]) * step
  return heights
}

/** The site's manifest and every level's heights, or null if the site has none. */
export async function loadSiteTerrain(siteId) {
  const base = `${import.meta.env.BASE_URL}terrain/${siteId}/`
  const res = await fetch(`${base}manifest.json`)
  if (!res.ok) return null
  // Vite answers a missing file with its index page; a manifest is JSON.
  if (!(res.headers.get('content-type') ?? '').includes('json')) return null
  const manifest = await res.json()
  const levels = await Promise.all(
    manifest.levels.map(async (entry) => ({ ...entry, heights: await loadLevel(base, entry) })),
  )
  return { manifest, levels }
}

/* ---------------------------------------------------------------- *
 * The site frame
 * ---------------------------------------------------------------- */

/**
 * The site's axes in the Moon's body frame (moonFrame.js: +x prime meridian,
 * +y 90°E, +z north): east, up, south, nine numbers.
 */
export function siteAxes(latitude, longitude) {
  const p = latitude * DEG
  const l = longitude * DEG
  const cp = Math.cos(p)
  const sp = Math.sin(p)
  const cl = Math.cos(l)
  const sl = Math.sin(l)
  return new Float64Array([-sl, cl, 0, cp * cl, cp * sl, sp, sp * cl, sp * sl, -cp])
}

/**
 * A point at (lat, lon, height above the datum) in the site frame, into `out`
 * at `o`. The body-frame position is the unit direction times R + h, less the
 * site's own point, projected on the three axes.
 */
function toSite(out, o, axes, lat, lon, h) {
  const p = lat * DEG
  const l = lon * DEG
  const cp = Math.cos(p)
  const r = R + h
  const bx = cp * Math.cos(l) * r - axes[3] * R
  const by = cp * Math.sin(l) * r - axes[4] * R
  const bz = Math.sin(p) * r - axes[5] * R
  out[o] = bx * axes[0] + by * axes[1] + bz * axes[2]
  out[o + 1] = bx * axes[3] + by * axes[4] + bz * axes[5]
  out[o + 2] = bx * axes[6] + by * axes[7] + bz * axes[8]
}

/* ---------------------------------------------------------------- *
 * Heights
 * ---------------------------------------------------------------- */

const smooth = (e0, e1, x) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)))
  return t * t * (3 - 2 * t)
}

/** Bilinear height of a level's *drawn* surface at (lat, lon), relative to its datum. */
function surfaceHeight(level, lat, lon) {
  const n = level.samples
  const g = level.grid
  const s = level.stride
  // In vertex-grid units, so this is the surface the triangles actually carry.
  const fy = (lat - g.latTop) / g.latStep / s
  const fx = (lon - g.lonLeft) / g.lonStep / s
  const m = Math.floor((n - 1) / s)
  const j = Math.min(m - 1, Math.max(0, Math.floor(fy)))
  const i = Math.min(m - 1, Math.max(0, Math.floor(fx)))
  const ty = Math.min(1, Math.max(0, fy - j))
  const tx = Math.min(1, Math.max(0, fx - i))
  const h = level.shaped
  const a = h[j * s * n + i * s] * (1 - tx) + h[j * s * n + (i + 1) * s] * tx
  const b = h[(j + 1) * s * n + i * s] * (1 - tx) + h[(j + 1) * s * n + (i + 1) * s] * tx
  return a * (1 - ty) + b * ty
}

/**
 * The hole a coarse level leaves for a finer one: the latitude and longitude
 * bounds of the block of its own cells that lies wholly inside the finer
 * level's samples. Returned on the coarse grid's vertex lines.
 */
function holeFor(coarse, fine) {
  const g = coarse.grid
  const s = coarse.stride
  const f = fine.grid
  const n = fine.samples
  const lat0 = f.latTop
  const lat1 = f.latTop + (n - 1) * f.latStep // south edge
  const lon0 = f.lonLeft
  const lon1 = f.lonLeft + (n - 1) * f.lonStep
  // Vertex lines of the coarse grid inside [lat1, lat0] x [lon0, lon1].
  const rowOf = (lat) => (lat - g.latTop) / (g.latStep * s)
  const colOf = (lon) => (lon - g.lonLeft) / (g.lonStep * s)
  const j0 = Math.ceil(rowOf(lat0))
  const j1 = Math.floor(rowOf(lat1))
  const i0 = Math.ceil(colOf(lon0))
  const i1 = Math.floor(colOf(lon1))
  return {
    j0,
    j1,
    i0,
    i1,
    north: g.latTop + j0 * g.latStep * s,
    south: g.latTop + j1 * g.latStep * s,
    west: g.lonLeft + i0 * g.lonStep * s,
    east: g.lonLeft + i1 * g.lonStep * s,
  }
}

/**
 * Each level's heights as drawn: shifted to its datum, held flat under the LM,
 * and blended over its outer band onto the level it sits in — or, for the
 * outermost, onto the sphere. Written into `level.shaped`, full resolution, so
 * the normal maps shade the same surface the triangles carry.
 *
 * Coarse to fine, because each level blends onto the one outside it.
 */
function shapeLevels(levels) {
  for (let k = levels.length - 1; k >= 0; k--) {
    const L = levels[k]
    const outer = levels[k + 1] ?? null
    const n = L.samples
    const g = L.grid
    const datum = L.site.height
    const shaped = new Float32Array(n * n)
    const hole = outer ? holeFor(outer, L) : null
    L.hole = hole
    const band = BUILD[L.id].blend
    const mLat = R * DEG
    for (let j = 0; j < n; j++) {
      const lat = g.latTop + j * g.latStep
      const mLon = mLat * Math.cos(lat * DEG)
      for (let i = 0; i < n; i++) {
        const lon = g.lonLeft + i * g.lonStep
        let h = L.heights[j * n + i] - datum
        // Distance inside the edge this level is fitted to, m.
        const north = hole ? hole.north : g.latTop
        const south = hole ? hole.south : g.latTop + (n - 1) * g.latStep
        const west = hole ? hole.west : g.lonLeft
        const east = hole ? hole.east : g.lonLeft + (n - 1) * g.lonStep
        const inside = Math.min((north - lat) * mLat, (lat - south) * mLat, (lon - west) * mLon, (east - lon) * mLon)
        const w = 1 - smooth(0, band, inside)
        if (w > 0) h += ((outer ? surfaceHeight(outer, lat, lon) : 0) - h) * w
        shaped[j * n + i] = h
      }
    }
    L.shaped = shaped
  }
  // And the ground under the stage, held at the datum, on the finest level —
  // after the blending, so nothing further out is disturbed by it.
  const near = levels[0]
  const n = near.samples
  const g = near.grid
  const mLat = R * DEG
  for (let j = 0; j < n; j++) {
    const dy = (j - near.site.row) * g.latStep * mLat
    for (let i = 0; i < n; i++) {
      const dx = (i - near.site.col) * g.lonStep * mLat * Math.cos(near.grid.latTop * DEG)
      const d = Math.hypot(dx, dy)
      if (d < FLAT_BLEND) near.shaped[j * n + i] *= smooth(FLAT_RADIUS, FLAT_BLEND, d)
    }
  }
}

/* ---------------------------------------------------------------- *
 * Geometry and normals
 * ---------------------------------------------------------------- */

/**
 * One level's mesh in the site frame. Vertices outside the level's own fitted
 * edge are clamped onto it; cells inside the hole left for the next level in
 * are dropped. `uv` addresses the Moon's colour map — the same texel the drawn
 * globe shows at that point, through the same texture — and `uv1` the level's
 * own normal map.
 */
function buildGeometry(level, inner, axes) {
  const n = level.samples
  const s = level.stride
  const g = level.grid
  const m = Math.floor((n - 1) / s) + 1
  const pos = new Float32Array(m * m * 3)
  const uv = new Float32Array(m * m * 2)
  const uv1 = new Float32Array(m * m * 2)
  const hole = level.hole
  for (let j = 0; j < m; j++) {
    for (let i = 0; i < m; i++) {
      let lat = g.latTop + j * s * g.latStep
      let lon = g.lonLeft + i * s * g.lonStep
      let h = level.shaped[j * s * n + i * s]
      if (hole) {
        // Fitted to the coarser level's hole: outside it, onto its edge, at the
        // coarser surface's height there.
        const cl = Math.min(hole.north, Math.max(hole.south, lat))
        const cn = Math.min(hole.east, Math.max(hole.west, lon))
        if (cl !== lat || cn !== lon) {
          lat = cl
          lon = cn
          h = surfaceHeight(level.outer, lat, lon)
        }
      }
      const v = j * m + i
      toSite(pos, v * 3, axes, lat, lon, h)
      uv[v * 2] = 0.5 + lon / 360
      uv[v * 2 + 1] = 0.5 + lat / 180
      // On the normal map's texel centres, which is where its samples are.
      uv1[v * 2] = (i * s + 0.5) / n
      uv1[v * 2 + 1] = (j * s + 0.5) / n
    }
  }
  const skip = inner ? holeFor(level, inner) : null
  const index = []
  for (let j = 0; j < m - 1; j++) {
    for (let i = 0; i < m - 1; i++) {
      if (skip && j >= skip.j0 && j < skip.j1 && i >= skip.i0 && i < skip.i1) continue
      const a = j * m + i
      const b = a + 1
      const c = a + m
      const d = c + 1
      // Rows run north to south, columns west to east: in (east, up, south)
      // that is +x along a row and +z down a column, and a, c, b is
      // counter-clockwise seen from +y.
      index.push(a, c, b, b, c, d)
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
  geometry.setAttribute('uv1', new THREE.BufferAttribute(uv1, 2))
  geometry.setIndex(m * m > 65535 ? new THREE.Uint32BufferAttribute(index, 1) : new THREE.Uint16BufferAttribute(index, 1))
  // The surface at the vertices' scale: what the lunar photometry takes its
  // emission angle from, under the normal map's finer relief.
  geometry.computeVertexNormals()
  geometry.computeBoundingSphere()
  return geometry
}

/**
 * The level's normals at full resolution, in the site frame, as an RGBA8
 * texture: central differences in the sample's own east and south, then turned
 * from its own up into the site's, which over the far level is up to 4°.
 */
function buildNormalMap(level, axes) {
  const n = level.samples
  const g = level.grid
  const h = level.shaped
  const data = new Uint8Array(n * n * 4)
  const dy = Math.abs(g.latStep) * DEG * R
  for (let j = 0; j < n; j++) {
    const lat = (g.latTop + j * g.latStep) * DEG
    const dx = g.lonStep * DEG * R * Math.cos(lat)
    const cp = Math.cos(lat)
    const sp = Math.sin(lat)
    for (let i = 0; i < n; i++) {
      const lon = (g.lonLeft + i * g.lonStep) * DEG
      const cl = Math.cos(lon)
      const sl = Math.sin(lon)
      const iw = Math.max(0, i - 1)
      const ie = Math.min(n - 1, i + 1)
      const jn = Math.max(0, j - 1)
      const js = Math.min(n - 1, j + 1)
      const gx = (h[j * n + ie] - h[j * n + iw]) / ((ie - iw) * dx) // up per metre east
      const gs = (h[js * n + i] - h[jn * n + i]) / ((js - jn) * dy) // up per metre south
      // The sample's own east, up and south in the Moon's body frame.
      const ex = -sl
      const ey = cl
      const ux = cp * cl
      const uy = cp * sl
      const uz = sp
      const sx = sp * cl
      const sy = sp * sl
      const sz = -cp
      const bx = -gx * ex - gs * sx + ux
      const by = -gx * ey - gs * sy + uy
      const bz = -gs * sz + uz
      // Into the site frame.
      let nx = bx * axes[0] + by * axes[1] + bz * axes[2]
      let ny = bx * axes[3] + by * axes[4] + bz * axes[5]
      let nz = bx * axes[6] + by * axes[7] + bz * axes[8]
      const k = 1 / Math.sqrt(nx * nx + ny * ny + nz * nz)
      nx *= k
      ny *= k
      nz *= k
      const o = (j * n + i) * 4
      data[o] = Math.round((nx * 0.5 + 0.5) * 255)
      data[o + 1] = Math.round((ny * 0.5 + 0.5) * 255)
      data[o + 2] = Math.round((nz * 0.5 + 0.5) * 255)
      data[o + 3] = 255
    }
  }
  const tex = new THREE.DataTexture(data, n, n, THREE.RGBAFormat)
  tex.colorSpace = THREE.NoColorSpace
  tex.magFilter = THREE.LinearFilter
  tex.minFilter = THREE.LinearMipmapLinearFilter
  tex.generateMipmaps = true
  tex.anisotropy = 8
  // Read through the mesh's second set of coordinates: see buildGeometry.
  tex.channel = 1
  tex.needsUpdate = true
  return tex
}

/**
 * Everything the surface needs from the loaded data: per level, its geometry
 * and normal map; for the whole site, a height lookup in site metres and the
 * outermost level's bounds, which is where the globe is cut away.
 */
export function buildSiteTerrain(loaded, site) {
  const axes = siteAxes(site.latitude, site.longitude)
  const levels = loaded.levels.map((l) => ({ ...l, stride: BUILD[l.id].stride }))
  levels.forEach((l, k) => (l.outer = levels[k + 1] ?? null))
  shapeLevels(levels)
  const built = levels.map((l, k) => ({
    id: l.id,
    geometry: buildGeometry(l, levels[k - 1] ?? null, axes),
    normalMap: buildNormalMap(l, axes),
  }))
  _levels = levels
  _siteLat = site.latitude
  _siteLon = site.longitude
  _cosLat = Math.cos(site.latitude * DEG)
  const far = levels[levels.length - 1]
  const fg = far.grid
  const fn = far.samples
  return {
    axes,
    levels: built,
    heightAt: (east, south) => {
      groundProbe[0] = east
      groundProbe[1] = south
      probeGround()
      return groundProbe[2]
    },
    bounds: {
      north: fg.latTop,
      south: fg.latTop + (fn - 1) * fg.latStep,
      west: fg.lonLeft,
      east: fg.lonLeft + (fn - 1) * fg.lonStep,
    },
  }
}
