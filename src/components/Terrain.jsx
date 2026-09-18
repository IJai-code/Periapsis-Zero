import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { live } from '../sim/live.js'
import { BODIES } from '../sim/constants.js'
import { activeSite, siteDirection } from '../sim/launchsite.js'
import { SPIN_AXIS } from '../sim/atmosphere.js'
import { mission } from '../sim/mission.js'

/**
 * The ground the vehicle actually leaves.
 *
 * Real heights, from the Terrarium tiles fetched by scripts/fetch-terrain.mjs —
 * about 70 km across each pad at 130 m a sample. Built on the sphere rather
 * than on a plane, because at that size the curvature is not a detail: the far
 * edge of the patch drops 96 m below the pad's tangent plane, and a horizon
 * drawn flat would sit in the wrong place by more than the relief it is drawing.
 *
 * Two deliberate departures from the data:
 *
 * The pad sits at exactly one Earth radius. The simulator's launch site is a
 * point on a sphere — there is no ellipsoid and no elevation in the flight model
 * — so the whole field is shifted to put the pad's own sample at zero. Relief is
 * preserved exactly; only the datum moves, and the alternative is a vehicle
 * standing three metres underground at Kennedy and ninety above the ground at
 * Baikonur.
 *
 * Below zero is sea. Terrarium carries bathymetry, so the Pacific west of
 * Vandenberg arrives as a 3,532 m trench. What a person standing on that pad
 * sees is water at sea level, so anything under the datum is drawn flat and
 * shaded as sea.
 */

const R = BODIES.earth.radius
/** How close the camera has to be before this is worth building at all. */
const VISIBLE_RANGE = 220e3
/** Samples dropped on each axis. 2 gives a 256-square mesh over the same ground. */
const STRIDE = 2

const xToLon = (x, z) => (x / 2 ** z) * 360 - 180
const yToLat = (y, z) => {
  const n = Math.PI - (2 * Math.PI * y) / 2 ** z
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)))
}

/** Per-site ground palette: sea, low ground, high ground. Shaded, not photographed. */
const PALETTE = {
  ksc: { sea: '#0b2436', low: '#3f4a33', high: '#6b6a4a' },
  baikonur: { sea: '#12283a', low: '#7a6b4a', high: '#9c8b62' },
  kourou: { sea: '#0d2b3a', low: '#24401f', high: '#4a5c30' },
  vandenberg: { sea: '#0a2030', low: '#4a4632', high: '#7d7355' },
}

/** Decode one Terrarium PNG into metres. */
async function loadHeights(url, samples) {
  const img = new Image()
  img.src = url
  await img.decode()
  const canvas = document.createElement('canvas')
  canvas.width = samples
  canvas.height = samples
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(img, 0, 0)
  const { data } = ctx.getImageData(0, 0, samples, samples)
  const out = new Float32Array(samples * samples)
  for (let i = 0; i < out.length; i++) {
    const o = i * 4
    out[i] = data[o] * 256 + data[o + 1] + data[o + 2] / 256 - 32768
  }
  return out
}

export function Terrain() {
  const [field, setField] = useState(null)
  const group = useRef()
  const site = mission.site ?? activeSite()

  // One fetch per site, and only for the site that is actually being flown.
  useEffect(() => {
    let alive = true
    const base = import.meta.env.BASE_URL
    ;(async () => {
      try {
        const manifest = await fetch(`${base}terrain/manifest.json`).then((r) => r.json())
        const entry = manifest.sites.find((s) => s.id === site.id)
        if (!entry) return
        const heights = await loadHeights(`${base}terrain/${site.id}.png`, entry.samples)
        if (alive) setField({ entry, heights })
      } catch {
        /* No terrain for this site: the scene simply has no ground, as before. */
      }
    })()
    return () => {
      alive = false
    }
  }, [site.id])

  const mesh = useMemo(() => {
    if (!field) return null
    const { entry, heights } = field
    const n = entry.samples
    const N = Math.floor((n - 1) / STRIDE) + 1
    const dir = new THREE.Vector3()
    const pad = new THREE.Vector3()
    const east = new THREE.Vector3()
    const north = new THREE.Vector3()
    const axis = new THREE.Vector3(...SPIN_AXIS)

    /* The pad's own frame at t = 0. The patch rotates with Earth rigidly, so the
       geometry is built once here and only the group's transform moves. */
    siteDirection(pad, site, 0)
    east.crossVectors(axis, pad).normalize()
    north.crossVectors(pad, east).normalize()

    // Height at the pad, which becomes the datum.
    const padX = ((site.longitude - xToLon(entry.tileX, entry.zoom)) /
      (xToLon(entry.tileX + entry.tileSpan, entry.zoom) - xToLon(entry.tileX, entry.zoom))) * (n - 1)
    const padY = (() => {
      // Invert Mercator for the pad's own row.
      const top = entry.tileY
      const span = entry.tileSpan
      let lo = 0
      let hi = n - 1
      for (let k = 0; k < 40; k++) {
        const mid = (lo + hi) / 2
        const lat = yToLat(top + (mid / (n - 1)) * span, entry.zoom)
        if (lat > site.latitude) lo = mid
        else hi = mid
      }
      return (lo + hi) / 2
    })()
    const sample = (x, y) => {
      const xi = Math.min(n - 1, Math.max(0, Math.round(x)))
      const yi = Math.min(n - 1, Math.max(0, Math.round(y)))
      return heights[yi * n + xi]
    }
    const datum = sample(padX, padY)

    const positions = new Float32Array(N * N * 3)
    const colours = new Float32Array(N * N * 3)
    const palette = PALETTE[site.id] ?? PALETTE.ksc
    const sea = new THREE.Color(palette.sea)
    const low = new THREE.Color(palette.low)
    const high = new THREE.Color(palette.high)
    const c = new THREE.Color()
    const p = new THREE.Vector3()
    const d = new THREE.Vector3()
    const probe = { latitude: 0, longitude: 0 }

    let relief = 1
    for (let i = 0; i < heights.length; i++) {
      relief = Math.max(relief, heights[i] - datum)
    }

    for (let j = 0; j < N; j++) {
      const sy = j * STRIDE
      probe.latitude = yToLat(entry.tileY + (sy / (n - 1)) * entry.tileSpan, entry.zoom)
      for (let i = 0; i < N; i++) {
        const sx = i * STRIDE
        probe.longitude =
          xToLon(entry.tileX, entry.zoom) +
          (sx / (n - 1)) * (xToLon(entry.tileX + entry.tileSpan, entry.zoom) - xToLon(entry.tileX, entry.zoom))

        const raw = heights[sy * n + sx] - datum
        const h = Math.max(raw, 0)
        siteDirection(d, probe, 0)
        p.copy(d).multiplyScalar(R + h).sub(pad.clone().multiplyScalar(R))

        const o = (j * N + i) * 3
        // Into the pad's local frame: x east, y up, z north.
        positions[o] = p.dot(east)
        positions[o + 1] = p.dot(pad)
        positions[o + 2] = p.dot(north)

        if (raw <= 0) c.copy(sea)
        else c.copy(low).lerp(high, Math.min(1, raw / relief))
        colours[o] = c.r
        colours[o + 1] = c.g
        colours[o + 2] = c.b
      }
    }

    const index = new Uint32Array((N - 1) * (N - 1) * 6)
    let k = 0
    for (let j = 0; j < N - 1; j++) {
      for (let i = 0; i < N - 1; i++) {
        const a = j * N + i
        const b = a + 1
        const cIdx = a + N
        const dIdx = cIdx + 1
        index[k++] = a
        index[k++] = cIdx
        index[k++] = b
        index[k++] = b
        index[k++] = cIdx
        index[k++] = dIdx
      }
    }

    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geometry.setAttribute('color', new THREE.BufferAttribute(colours, 3))
    geometry.setIndex(new THREE.BufferAttribute(index, 1))
    geometry.computeVertexNormals()
    geometry.computeBoundingSphere()
    return geometry
  }, [field, site])

  const scratch = useMemo(
    () => ({
      up: new THREE.Vector3(),
      east: new THREE.Vector3(),
      north: new THREE.Vector3(),
      axis: new THREE.Vector3(...SPIN_AXIS),
      basis: new THREE.Matrix4(),
    }),
    [],
  )

  useFrame(({ camera }) => {
    const g = group.current
    if (!g || !mesh) return
    const { up, east, north, axis, basis } = scratch
    siteDirection(up, site, live.sim.t)
    east.crossVectors(axis, up).normalize()
    north.crossVectors(up, east).normalize()
    g.position.copy(live.pos.earth).addScaledVector(up, R)
    basis.makeBasis(east, up, north)
    g.quaternion.setFromRotationMatrix(basis)
    // 70 km of ground is worth drawing only from close to it.
    g.visible = camera.position.distanceTo(g.position) < VISIBLE_RANGE
  }, -2)

  useEffect(() => () => mesh?.dispose(), [mesh])

  if (!mesh) return null
  return (
    <group ref={group} visible={false}>
      <mesh geometry={mesh} receiveShadow>
        <meshStandardMaterial vertexColors roughness={0.95} metalness={0.0} />
      </mesh>
    </group>
  )
}
