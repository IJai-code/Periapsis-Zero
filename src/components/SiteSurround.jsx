import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { carGeometry, personGeometry } from '../gfx/siteSurround.js'
import { makeFacadeMaterial } from '../gfx/facade.js'
import { attachGroundLook } from '../gfx/groundLook.js'
import { DETAIL, SPECIES, facetSize, scatterFlora } from '../gfx/flora.js'
import { QUALITY } from '../sim/device.js'

/**
 * The world around the pad, mounted beside `LaunchPad` in the terrain group.
 *
 * Every structure is one merged geometry drawn by one facade material (see
 * `gfx/facade.js`); cars and people are instanced families with per-instance
 * colour; and the plants are one instanced mesh per species (see
 * `gfx/flora.js`), which is how thirty thousand palmettos, palms and pines cost
 * a handful of draw calls. Everything is built once in a memo — the frame loop
 * only advances the wind.
 */

const PAINT_CAR = attachGroundLook(new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.4, metalness: 0.5 }))
const SKIN = attachGroundLook(new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.85, metalness: 0 }))

const _v = new THREE.Vector3()
const _s = new THREE.Vector3()
const _q = new THREE.Quaternion()
const _e = new THREE.Euler()
const _m = new THREE.Matrix4()
const _c = new THREE.Color()

/** One instanced family: [x, y, z, w] rows → a single draw call. */
function Instances({ geometry, material, rows, scale = 1, jitter = 0, hueFrom }) {
  const ref = useRef(null)
  useLayoutEffect(() => {
    const mesh = ref.current
    if (!mesh) return
    for (let i = 0; i < rows.length; i++) {
      const [x, y, z, w] = rows[i]
      const s = scale * (1 + (w - 0.5) * jitter)
      _v.set(x, y, z)
      _s.set(s, s, s)
      _q.setFromEuler(_e.set(0, w * Math.PI * 2, 0))
      mesh.setMatrixAt(i, _m.compose(_v, _q, _s))
      if (hueFrom) {
        hueFrom(_c, w)
        mesh.setColorAt(i, _c)
      }
    }
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    mesh.computeBoundingSphere()
  }, [rows, scale, jitter, hueFrom])
  if (!rows.length) return null
  return <instancedMesh ref={ref} args={[geometry, material, rows.length]} castShadow={false} receiveShadow={false} />
}

// Per-instance colour: the crowd in summer clothes, the lot in dealer colours.
const crowdHue = (c, w) => c.setHSL(0.06 + w * 0.62, 0.35 + w * 0.3, 0.42 + w * 0.3)
const carHue = (c, w) => c.setHSL(w * 0.9, 0.08 + w * 0.35, 0.3 + w * 0.5)

const CARS = carGeometry()
const PEOPLE = personGeometry()

/**
 * The plants' material: vertex colours, both faces (a frond is one sheet),
 * and the wind — each vertex sways by the square of its `sway` weight, at a
 * phase set by where its plant stands, so a stand of palms moves as a field
 * does rather than in unison.
 */
const WIND = { value: 0 }
function makeFloraMaterial() {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.86, metalness: 0, side: THREE.DoubleSide })
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uWind = WIND
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        attribute float sway;
        uniform float uWind;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        {
          #ifdef USE_INSTANCING
          float ph = dot(instanceMatrix[3].xz, vec2(0.071, 0.113));
          #else
          float ph = 0.0;
          #endif
          float s2 = sway * sway;
          float gust = 0.6 + 0.4 * sin(uWind * 0.31 + ph * 0.5);
          transformed.x += sin(uWind * 1.7 + ph) * s2 * 0.16 * gust;
          transformed.z += cos(uWind * 1.29 + ph * 1.7) * s2 * 0.11 * gust;
        }`,
      )
  }
  m.customProgramCacheKey = () => 'flora-wind'
  return attachGroundLook(m)
}

/**
 * A species' plants, cut into tiles.
 *
 * One InstancedMesh is one object to the renderer: it is frustum-culled as a
 * whole, by a bounding sphere that here spans five kilometres of scrub, so it
 * is never culled at all. Measured standing at Kennedy's pad, of 36,540 plants
 * 11,293 were inside the camera's frustum — the other 25,247 were transformed
 * and rasterised every frame behind the camera's back, for 8.6 million
 * triangles of which two thirds could not be seen.
 *
 * Cutting each species into tiles of roughly `TILE_TRIANGLES` fixes that
 * without changing a single plant: every tile is an InstancedMesh with its own
 * tight bounding sphere, holding the instances it always held, and three culls
 * the ones behind you for nothing. A tile also chooses which build of the plant
 * to draw — `gfx/flora.js` builds each species at three detail levels — by how
 * large its plants stand on screen. The full build is used until a plant is
 * under `MID_PX` pixels tall and is bit-identical to what was drawn before, so
 * nothing you can see the fronds on is ever drawn with fewer of them.
 */
const TILE_TRIANGLES = 60000
/**
 * A plant this cheap keeps every triangle, however far away it is. Grass is
 * twelve triangles a tussock and saw palmetto ninety: dropping either saves
 * almost nothing and thins the ground cover you are standing in, which is the
 * one part of the scrub close enough to look at.
 */
const LOD_MIN_TRIANGLES = 120
/**
 * The coarse build is used once one of its own triangles would cover fewer
 * than this many pixels. Measured against the facets rather than the plant,
 * because the facets are what give a coarse build away — see `facetSize`.
 */
const SWAP_PX = 4
/** Switching back up happens later than switching down, so a tile cannot flicker. */
const HYSTERESIS = 1.25

/** Cut instance rows into a grid of tiles, each about `budget` triangles. */
function tileFlora(data, trisEach, budget) {
  const n = data.length / 6
  if (!n) return []
  let minX = Infinity
  let maxX = -Infinity
  let minZ = Infinity
  let maxZ = -Infinity
  for (let i = 0; i < n; i++) {
    const x = data[i * 6]
    const z = data[i * 6 + 2]
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (z < minZ) minZ = z
    if (z > maxZ) maxZ = z
  }
  // Enough tiles that each is worth culling, few enough that the draw calls
  // stay cheaper than the triangles they save.
  const g = Math.max(1, Math.min(24, Math.round(Math.sqrt((n * trisEach) / budget))))
  const sx = (maxX - minX) / g || 1
  const sz = (maxZ - minZ) / g || 1
  const cells = new Map()
  for (let i = 0; i < n; i++) {
    const cx = Math.min(g - 1, Math.floor((data[i * 6] - minX) / sx))
    const cz = Math.min(g - 1, Math.floor((data[i * 6 + 2] - minZ) / sz))
    const k = cx * 64 + cz
    let a = cells.get(k)
    if (!a) cells.set(k, (a = []))
    a.push(i)
  }
  const out = []
  for (const idx of cells.values()) {
    const rows = new Float32Array(idx.length * 6)
    for (let j = 0; j < idx.length; j++) rows.set(data.subarray(idx[j] * 6, idx[j] * 6 + 6), j * 6)
    out.push(rows)
  }
  return out
}

/** One tile of one species: a single draw call, culled and detailed on its own. */
function FloraTile({ lods, material, rows, hue, facet, tiles }) {
  const ref = useRef(null)
  const count = rows.length / 6
  useLayoutEffect(() => {
    const mesh = ref.current
    if (!mesh) return
    for (let i = 0; i < count; i++) {
      const o = i * 6
      const s = rows[o + 4]
      _v.set(rows[o], rows[o + 1], rows[o + 2])
      _s.set(s, s * (0.9 + rows[o + 5] * 0.2), s)
      _q.setFromEuler(_e.set((rows[o + 5] - 0.5) * 0.08, rows[o + 3], (rows[o + 5] - 0.5) * 0.06))
      mesh.setMatrixAt(i, _m.compose(_v, _q, _s))
      hue(_c, rows[o + 5])
      mesh.setColorAt(i, _c)
    }
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    mesh.computeBoundingSphere()
    // The builds this tile can draw, where anything inspecting the scene can
    // find them — which is how `verify-flora` proves the picture is unchanged.
    mesh.userData.floraLods = lods
    // Start from the full build, so the entry's idea of which one is on the
    // mesh is true even when this runs again over a mesh that had dropped.
    mesh.geometry = lods[0]
    const entry = { mesh, lods, facet, level: 0 }
    tiles.current.push(entry)
    return () => {
      const i = tiles.current.indexOf(entry)
      if (i >= 0) tiles.current.splice(i, 1)
    }
  }, [rows, count, hue, lods, facet, tiles])
  if (!count) return null
  return <instancedMesh ref={ref} args={[lods[0], material, count]} castShadow={false} receiveShadow />
}

/** One species: its scatter, tiled. */
function Species({ lods, material, data, hue, tiles }) {
  const tris = lods[0].attributes.position.count / 3
  // The builds this species may be drawn at — only one, if it is cheap enough
  // that the full plant costs nothing to keep.
  const ladder = useMemo(() => (tris >= LOD_MIN_TRIANGLES ? lods : [lods[0]]), [lods, tris])
  const parts = useMemo(() => tileFlora(data, tris, TILE_TRIANGLES), [data, tris])
  // How large a facet of the coarsest build is, in metres.
  const facet = useMemo(() => facetSize(ladder[ladder.length - 1]), [ladder])
  return parts.map((rows, i) => (
    <FloraTile key={i} lods={ladder} material={material} rows={rows} hue={hue} facet={facet} tiles={tiles} />
  ))
}

/** A little variety in every plant's green: some lusher, some sun-bleached. */
const plantHue = (c, w) => c.setRGB(0.86 + w * 0.26, 0.88 + w * 0.2, 0.84 + (1 - w) * 0.2)

export function SiteSurround({ site, world, groundAt, wetAt, eye }) {
  const facade = useMemo(() => makeFacadeMaterial(), [])
  const flora = useMemo(() => makeFloraMaterial(), [])
  // Every species at every detail level, built once. The first is the plant as
  // it has always been built; the rest are the same plant with the parts too
  // small to resolve left out.
  const shapes = useMemo(
    () => Object.fromEntries(Object.entries(SPECIES).map(([k, f]) => [k, DETAIL.map((d) => f(d))])),
    [],
  )
  const tiles = useRef([])
  useEffect(
    () => () => {
      facade.dispose()
      flora.dispose()
      Object.values(shapes).forEach((gs) => gs.forEach((g) => g.dispose()))
    },
    [facade, flora, shapes],
  )

  const plants = useMemo(() => {
    if (!world) return {}
    try {
      return scatterFlora(site, {
        budget: QUALITY.trees,
        groundAt,
        wetAt,
        keepOut: world.keepOut ?? [],
        clearRadius: 440,
        eye,
      })
    } catch (err) {
      console.warn('[flora] scatter failed', err)
      return {}
    }
  }, [site, world, groundAt, wetAt, eye])

  /*
   * The wind, and which build of each plant a tile draws.
   *
   * A tile's plants are all about as far away as each other, so one decision
   * serves the tile: how many pixels one facet of the coarse build would cover
   * at the tile's near edge. The near edge, not its centre, so a tile you are
   * standing in keeps its full build for the whole of it. Nothing is allocated
   * here.
   */
  useFrame(({ clock, camera, size }) => {
    WIND.value = clock.elapsedTime % 1000
    const perRadian = size.height / (2 * Math.tan((camera.fov * Math.PI) / 360))
    for (const t of tiles.current) {
      const bs = t.mesh.boundingSphere
      if (!bs) continue
      _v.copy(bs.center).applyMatrix4(t.mesh.matrixWorld)
      const near = Math.max(1, camera.position.distanceTo(_v) - bs.radius)
      const px = (t.facet / near) * perRadian
      // Hysteresis: a tile drops detail at the threshold and takes it back
      // only well above it, so a camera drifting across one cannot flicker.
      const up = t.level > 0 ? HYSTERESIS : 1
      const level = Math.min(px > SWAP_PX * up ? 0 : 1, t.lods.length - 1)
      if (level !== t.level) {
        t.level = level
        t.mesh.geometry = t.lods[level]
      }
    }
  })

  if (!world) return null
  const { solid, instances } = world
  return (
    <group>
      {solid && <mesh geometry={solid} material={facade} castShadow receiveShadow />}
      <Instances geometry={CARS} material={PAINT_CAR} rows={instances.car} scale={1} jitter={0.12} hueFrom={carHue} />
      <Instances geometry={PEOPLE} material={SKIN} rows={instances.crowd} scale={1} jitter={0.16} hueFrom={crowdHue} />
      {Object.entries(plants).map(([species, data]) => (
        <Species key={species} lods={shapes[species]} material={flora} data={data} hue={plantHue} tiles={tiles} />
      ))}
    </group>
  )
}
