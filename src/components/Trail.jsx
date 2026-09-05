import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { Line2, LineGeometry, LineMaterial } from 'three-stdlib'
import { live } from '../sim/live.js'
import { INDEX, readPosition } from '../sim/system.js'

/**
 * Fading orbit trail, drawn from the integrator's own output.
 *
 * Samples are stored *relative to the reference body* and the whole line is then
 * parented to that body. Two consequences worth stating: the Moon's path reads
 * as a clean geocentric ellipse instead of the epitrochoid it traces in
 * heliocentric coordinates, and once a full orbit has accumulated, further laps
 * land on top of the existing curve rather than smearing across the screen.
 *
 * Buffers are written in place. Line2's geometry helpers reallocate their
 * interleaved buffers on every call, which is not something to do per frame.
 */
const MIN_SAMPLES_PER_ORBIT = 16

export function Trail({
  body,
  reference,
  period, // seconds — sets how much history the trail holds
  span = 0.95, // fraction of one orbit
  points = 420,
  head = '#7df9ff',
  tail = '#0b3f9e',
  width = 1.7,
  visible = true,
}) {
  const size = useThree((s) => s.size)
  const group = useRef()

  const interval = (period * span) / (points - 1)

  const { line, buffer, cursor } = useMemo(() => {
    const geometry = new LineGeometry()
    geometry.setPositions(new Float32Array(points * 3))
    geometry.setColors(new Float32Array(points * 4), 4)

    const material = new LineMaterial({
      vertexColors: true,
      transparent: true, // this is what switches on per-vertex alpha
      linewidth: width,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    })

    const l = new Line2(geometry, material)
    l.frustumCulled = false // the bounding volume changes every frame

    // The fade is a fixed function of age, and samples are always written
    // oldest-first, so the colours only need computing once.
    const colors = geometry.attributes.instanceColorStart.data.array
    const a = new THREE.Color(tail)
    const b = new THREE.Color(head)
    const c = new THREE.Color()
    const rgba = new Float32Array(points * 4)
    for (let i = 0; i < points; i++) {
      const t = i / (points - 1)
      c.copy(a).lerp(b, t * t)
      rgba[i * 4] = c.r
      rgba[i * 4 + 1] = c.g
      rgba[i * 4 + 2] = c.b
      rgba[i * 4 + 3] = Math.pow(t, 2.1) // most of the length is nearly gone
    }
    for (let s = 0; s < points - 1; s++) {
      colors.set(rgba.subarray(s * 4, s * 4 + 4), s * 8)
      colors.set(rgba.subarray((s + 1) * 4, (s + 1) * 4 + 4), s * 8 + 4)
    }
    geometry.attributes.instanceColorStart.data.needsUpdate = true

    return { line: l, buffer: new Float32Array(points * 3), cursor: { head: 0, last: -Infinity } }
  }, [points, width, head, tail])

  // Braces matter: the concise-body form returns the Vector2 from .set(), which
  // React then tries to invoke as a cleanup function.
  useEffect(() => {
    line.material.resolution.set(size.width, size.height)
  }, [line, size])
  useEffect(() => () => {
    line.geometry.dispose()
    line.material.dispose()
  }, [line])

  // Seed the buffer by running a copy of the system *backwards*. The trail is
  // therefore real integrated history from the first frame, not an empty line
  // that takes a simulated year to draw itself in.
  const seed = useCallback(() => {
    const clone = live.sim.clone()
    const a = new THREE.Vector3()
    const b = new THREE.Vector3()
    for (let i = points - 1; i >= 0; i--) {
      readPosition(clone.state, INDEX[body], a)
      readPosition(clone.state, INDEX[reference], b)
      a.sub(b)
      buffer[i * 3] = a.x
      buffer[i * 3 + 1] = a.y
      buffer[i * 3 + 2] = a.z
      clone.advance(-interval)
    }
    cursor.head = points - 1
    cursor.last = live.sim.t
  }, [body, reference, interval, points, buffer, cursor])

  useEffect(seed, [seed])

  const rel = useMemo(() => new THREE.Vector3(), [])

  useFrame(() => {
    group.current.position.copy(live.pos[reference])

    // A trail can only sample once per frame, so under heavy time compression a
    // fast orbit collapses to a handful of points a quarter-revolution apart —
    // a jagged polygon that misrepresents the path rather than showing it. Below
    // roughly sixteen samples per revolution, draw nothing.
    const resolvable = live.simDtLastFrame * MIN_SAMPLES_PER_ORBIT <= period
    line.visible = visible && resolvable
    if (!visible || !resolvable) return

    const elapsed = live.sim.t - cursor.last

    // Time ran backwards (a reset), or jumped further than the whole window is
    // wide: the stored history no longer connects to the present, so rebuild it
    // rather than drawing a chord across the gap. A merely large forward step is
    // normal at high time warp and just samples more coarsely.
    if (elapsed < -interval || elapsed > interval * points) {
      seed()
    } else if (elapsed >= interval) {
      cursor.head = (cursor.head + 1) % points
      rel.copy(live.pos[body]).sub(live.pos[reference])
      buffer[cursor.head * 3] = rel.x
      buffer[cursor.head * 3 + 1] = rel.y
      buffer[cursor.head * 3 + 2] = rel.z
      cursor.last = live.sim.t
    }

    // Unroll the ring buffer into chronological order, straight into the
    // interleaved segment buffer: [start.xyz, end.xyz] per segment, stride 6.
    const positions = line.geometry.attributes.instanceStart.data
    const arr = positions.array
    const oldest = cursor.head + 1
    for (let s = 0; s < points - 1; s++) {
      const p0 = ((oldest + s) % points) * 3
      const p1 = ((oldest + s + 1) % points) * 3
      const o = s * 6
      arr[o] = buffer[p0]
      arr[o + 1] = buffer[p0 + 1]
      arr[o + 2] = buffer[p0 + 2]
      arr[o + 3] = buffer[p1]
      arr[o + 4] = buffer[p1 + 1]
      arr[o + 5] = buffer[p1 + 2]
    }
    positions.needsUpdate = true
  }, -2)

  return (
    <group ref={group}>
      <primitive object={line} />
    </group>
  )
}
