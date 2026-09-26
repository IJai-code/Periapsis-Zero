import { useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import {
  buildSurround,
  treeGeometry,
  carGeometry,
  personGeometry,
} from '../gfx/siteSurround.js'

/**
 * The world around the pad, mounted beside `LaunchPad` in the terrain group.
 *
 * Buildings bake to one merged geometry per material (four draw calls); the
 * trees, cars and people are three `InstancedMesh`es with per-instance colour,
 * which is how a crowd of hundreds costs what a single box costs. Everything
 * is built once in a memo and never touched again — the frame loop stays at
 * zero allocation.
 */

const PAINT = {
  solid: new THREE.MeshStandardMaterial({ color: '#b3ada1', roughness: 0.82, metalness: 0.06 }),
  glass: new THREE.MeshStandardMaterial({ color: '#5d7590', roughness: 0.32, metalness: 0.55 }),
  green: new THREE.MeshStandardMaterial({ color: '#47633a', roughness: 0.92, metalness: 0 }),
  dark: new THREE.MeshStandardMaterial({ color: '#22252a', roughness: 0.94, metalness: 0.02 }),
}

const LEAF = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.9, metalness: 0 })
const PAINT_CAR = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.45, metalness: 0.5 })
const SKIN = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.85, metalness: 0 })

const _v = new THREE.Vector3()
const _s = new THREE.Vector3()
const _q = new THREE.Quaternion()
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
      _q.setFromEuler(new THREE.Euler(0, w * Math.PI * 2, 0))
      mesh.setMatrixAt(i, new THREE.Matrix4().compose(_v, _q, _s))
      if (hueFrom) {
        hueFrom(_c, w)
        mesh.setColorAt(i, _c)
      }
    }
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  }, [rows, scale, jitter, hueFrom])
  return (
    <instancedMesh
      ref={ref}
      args={[geometry, material, rows.length]}
      castShadow={false}
      receiveShadow={false}
      frustumCulled={false}
    />
  )
}

// Per-instance colour: the crowd in summer clothes, the lot in dealer colours,
// the canopy in shades of green.
const crowdHue = (c, w) => c.setHSL(0.06 + w * 0.62, 0.35 + w * 0.3, 0.42 + w * 0.3)
const carHue = (c, w) => c.setHSL(w * 0.9, 0.08 + w * 0.35, 0.3 + w * 0.5)
const leafHue = (c, w) => c.setHSL(0.22 + w * 0.11, 0.38 + w * 0.18, 0.26 + w * 0.18)

// Instance geometry is identical for every site — build it once.
const TREES = treeGeometry()
const CARS = carGeometry()
const PEOPLE = personGeometry()

export function SiteSurround({ site, groundAt }) {
  const world = useMemo(() => {
    try {
      return buildSurround(site, groundAt)
    } catch (err) {
      console.warn('[siteSurround] build failed', err)
      return null
    }
  }, [site, groundAt])

  if (!world) return null
  const { solid, glass, green, dark, instances } = world
  return (
    <group>
      {solid && <mesh geometry={solid} material={PAINT.solid} />}
      {glass && <mesh geometry={glass} material={PAINT.glass} />}
      {green && <mesh geometry={green} material={PAINT.green} />}
      {dark && <mesh geometry={dark} material={PAINT.dark} />}
      <Instances geometry={TREES} material={LEAF} rows={instances.tree} scale={2.6} jitter={0.5} hueFrom={leafHue} />
      <Instances geometry={CARS} material={PAINT_CAR} rows={instances.car} scale={1} jitter={0.12} hueFrom={carHue} />
      <Instances geometry={PEOPLE} material={SKIN} rows={instances.crowd} scale={1} jitter={0.16} hueFrom={crowdHue} />
    </group>
  )
}
