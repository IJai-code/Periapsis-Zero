import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { carGeometry, personGeometry } from '../gfx/siteSurround.js'
import { makeFacadeMaterial } from '../gfx/facade.js'
import { attachGroundLook } from '../gfx/groundLook.js'
import { SPECIES, scatterFlora } from '../gfx/flora.js'
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

/** One species: its instances, from the scatter's [x, y, z, yaw, scale, tint] rows. */
function Species({ geometry, material, data, hue }) {
  const ref = useRef(null)
  const count = data.length / 6
  useLayoutEffect(() => {
    const mesh = ref.current
    if (!mesh) return
    for (let i = 0; i < count; i++) {
      const o = i * 6
      const s = data[o + 4]
      _v.set(data[o], data[o + 1], data[o + 2])
      _s.set(s, s * (0.9 + data[o + 5] * 0.2), s)
      _q.setFromEuler(_e.set((data[o + 5] - 0.5) * 0.08, data[o + 3], (data[o + 5] - 0.5) * 0.06))
      mesh.setMatrixAt(i, _m.compose(_v, _q, _s))
      hue(_c, data[o + 5])
      mesh.setColorAt(i, _c)
    }
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    mesh.computeBoundingSphere()
  }, [data, count, hue])
  if (!count) return null
  return <instancedMesh ref={ref} args={[geometry, material, count]} castShadow={false} receiveShadow />
}

/** A little variety in every plant's green: some lusher, some sun-bleached. */
const plantHue = (c, w) => c.setRGB(0.86 + w * 0.26, 0.88 + w * 0.2, 0.84 + (1 - w) * 0.2)

export function SiteSurround({ site, world, groundAt, wetAt, eye }) {
  const facade = useMemo(() => makeFacadeMaterial(), [])
  const flora = useMemo(() => makeFloraMaterial(), [])
  const shapes = useMemo(() => Object.fromEntries(Object.entries(SPECIES).map(([k, f]) => [k, f()])), [])
  useEffect(
    () => () => {
      facade.dispose()
      flora.dispose()
      Object.values(shapes).forEach((g) => g.dispose())
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

  useFrame(({ clock }) => {
    WIND.value = clock.elapsedTime % 1000
  })

  if (!world) return null
  const { solid, instances } = world
  return (
    <group>
      {solid && <mesh geometry={solid} material={facade} castShadow receiveShadow />}
      <Instances geometry={CARS} material={PAINT_CAR} rows={instances.car} scale={1} jitter={0.12} hueFrom={carHue} />
      <Instances geometry={PEOPLE} material={SKIN} rows={instances.crowd} scale={1} jitter={0.16} hueFrom={crowdHue} />
      {Object.entries(plants).map(([species, data]) => (
        <Species key={species} geometry={shapes[species]} material={flora} data={data} hue={plantHue} />
      ))}
    </group>
  )
}
