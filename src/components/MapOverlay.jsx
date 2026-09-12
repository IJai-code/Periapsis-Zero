import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { Html } from '@react-three/drei'
import { live } from '../sim/live.js'
import { BODIES } from '../sim/constants.js'
import { prediction } from '../sim/predict.js'
import { INDEX } from '../sim/system.js'
import { LAUNCH_SITES, activeSite, siteDirection } from '../sim/launchsite.js'
import { useUi } from '../sim/store.js'

/**
 * What the map draws that the flight does not.
 *
 * An orbit on its own tells you its shape and nothing about its orientation.
 * These give it a frame to be read against: the equator of the body it goes
 * round, the line where the two planes cross, and — on Earth — the pads, which
 * is what makes an inclination legible as *where you launched from* rather than
 * as a number in a panel.
 *
 * All of it is reference, so all of it is drawn thin, unlit and behind the
 * things it is a reference for.
 */

/** Rings at these fractions of the drawn path's extent. */
const RINGS = [0.25, 0.5, 0.75, 1]
const SPOKES = 12

/**
 * A body's equatorial axis, in the same convention `atmosphere.js` uses for
 * Earth: the obliquity taken about the ecliptic's x-y plane. The Moon's 6.68
 * degrees is small, which is the point — its equator is nearly the ecliptic,
 * and Earth's visibly is not.
 */
function equatorAxis(out, id) {
  const tilt = BODIES[id]?.tilt ?? 0
  return out.set(Math.sin(tilt), Math.cos(tilt), 0).normalize()
}

const UP_Y = new THREE.Vector3(0, 1, 0)
const RIGHT_X = new THREE.Vector3(1, 0, 0)

export function MapOverlay() {
  const map = useUi((s) => s.map)
  const show = useUi((s) => s.trajectory)
  const group = useRef()
  const plane = useRef()
  const nodes = useRef()
  const pads = useRef([])
  const [siteList] = useMemo(() => [Object.values(LAUNCH_SITES)], [])

  const kit = useMemo(() => {
    /* A unit circle in the x-z plane, scaled per ring. */
    const circle = new THREE.BufferGeometry()
    const n = 128
    const ring = new Float32Array((n + 1) * 3)
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * Math.PI * 2
      ring[i * 3] = Math.cos(a)
      ring[i * 3 + 2] = Math.sin(a)
    }
    circle.setAttribute('position', new THREE.BufferAttribute(ring, 3))

    /* Spokes, from a little out to the rim. */
    const spokes = new THREE.BufferGeometry()
    const spoke = new Float32Array(SPOKES * 2 * 3)
    for (let i = 0; i < SPOKES; i++) {
      const a = (i / SPOKES) * Math.PI * 2
      spoke[i * 6] = Math.cos(a) * 0.12
      spoke[i * 6 + 2] = Math.sin(a) * 0.12
      spoke[i * 6 + 3] = Math.cos(a)
      spoke[i * 6 + 5] = Math.sin(a)
    }
    spokes.setAttribute('position', new THREE.BufferAttribute(spoke, 3))

    /* The line of nodes: a diameter along x, scaled to the path. */
    const nodeLine = new THREE.BufferGeometry()
    nodeLine.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array([-1, 0, 0, 1, 0, 0]), 3),
    )

    const grid = new THREE.LineBasicMaterial({
      color: '#3f6f8c',
      transparent: true,
      opacity: 0.32,
      depthWrite: false,
      toneMapped: false,
    })
    const nodeMat = new THREE.LineBasicMaterial({
      color: '#ffb35c',
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
      toneMapped: false,
    })
    const pad = new THREE.SphereGeometry(1, 10, 8)
    const padMat = new THREE.MeshBasicMaterial({
      color: '#ffd98a',
      transparent: true,
      opacity: 0.9,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    })
    return { circle, spokes, nodeLine, grid, nodeMat, pad, padMat }
  }, [])

  useEffect(
    () => () => {
      kit.circle.dispose()
      kit.spokes.dispose()
      kit.nodeLine.dispose()
      kit.grid.dispose()
      kit.nodeMat.dispose()
      kit.pad.dispose()
      kit.padMat.dispose()
    },
    [kit],
  )

  const s = useMemo(
    () => ({
      axis: new THREE.Vector3(),
      orbit: new THREE.Vector3(),
      node: new THREE.Vector3(),
      dir: new THREE.Vector3(),
      r: new THREE.Vector3(),
      v: new THREE.Vector3(),
    }),
    [],
  )

  useFrame(() => {
    const g = group.current
    if (!g || !map || !show) return

    const body = prediction.reference
    const anchor = live.pos[body]
    if (!anchor) return
    g.position.copy(anchor)

    /* How far out to draw: the same extent the camera framed. */
    let extent = 0
    for (let i = 0; i < prediction.count; i++) {
      const o = i * 3
      const r = Math.hypot(prediction.points[o], prediction.points[o + 1], prediction.points[o + 2])
      if (r > extent) extent = r
    }
    const surface = BODIES[body]?.radius ?? BODIES.earth.radius
    if (extent < surface * 1.2) extent = surface * 1.2

    /* The equator, as a disc the orbit can be read against. */
    equatorAxis(s.axis, body)
    const p = plane.current
    if (p) {
      p.quaternion.setFromUnitVectors(UP_Y, s.axis)
      p.scale.setScalar(extent)
    }

    /**
     * The line of nodes: where the craft's plane cuts the equator. Undefined
     * when the two coincide — an equatorial orbit has no nodes — so it is
     * hidden rather than drawn along whatever the cross product degenerates to.
     */
    const n = nodes.current
    if (n) {
      // Straight from the state vector, both halves from the same place: the
      // craft relative to the body the path is drawn around.
      const st = live.sim.state
      const c = INDEX.ship * 6
      const b = INDEX[body] * 6
      s.r.set(st[c] - st[b], st[c + 1] - st[b + 1], st[c + 2] - st[b + 2])
      s.v.set(st[c + 3] - st[b + 3], st[c + 4] - st[b + 4], st[c + 5] - st[b + 5])
      s.orbit.crossVectors(s.r, s.v)
      if (s.orbit.lengthSq() > 0) {
        s.orbit.normalize()
        s.node.crossVectors(s.axis, s.orbit)
        const tilt = s.node.length()
        // Below a tenth of a degree of inclination the nodes are noise.
        n.visible = tilt > 1.7e-3
        if (n.visible) {
          s.node.divideScalar(tilt)
          n.quaternion.setFromUnitVectors(RIGHT_X, s.node)
          n.scale.setScalar(extent)
        }
      } else {
        n.visible = false
      }
    }

    /* The pads, where there are any: Earth only. */
    const onEarth = body === 'earth'
    for (let i = 0; i < siteList.length; i++) {
      const mark = pads.current[i]
      if (!mark) continue
      mark.visible = onEarth
      if (!onEarth) continue
      siteDirection(s.dir, siteList[i], live.sim.t)
      mark.position.copy(s.dir).multiplyScalar(surface * 1.01)
      mark.scale.setScalar(surface * 0.02)
    }
  }, -2)

  if (!map || !show) return null

  return (
    <group ref={group}>
      <group ref={plane}>
        {RINGS.map((f) => (
          <lineLoop key={f} geometry={kit.circle} material={kit.grid} scale={f} />
        ))}
        <lineSegments geometry={kit.spokes} material={kit.grid} />
      </group>
      <line ref={nodes} geometry={kit.nodeLine} material={kit.nodeMat} />
      {siteList.map((site, i) => (
        <mesh
          key={site.id}
          ref={(el) => (pads.current[i] = el)}
          geometry={kit.pad}
          material={kit.padMat}
          renderOrder={880}
        >
          <Html center zIndexRange={[16, 6]} style={{ pointerEvents: 'none' }}>
            <div
              className={`translate-y-3 font-mono text-[8px] tracking-[0.16em] whitespace-nowrap uppercase ${
                site.id === activeSite().id ? 'text-amber-200/90' : 'text-white/30'
              }`}
            >
              {site.name}
            </div>
          </Html>
        </mesh>
      ))}
    </group>
  )
}
