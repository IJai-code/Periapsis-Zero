import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { Line2, LineGeometry, LineMaterial } from 'three-stdlib'
import { live } from '../sim/live.js'
import { INDEX, readPosition } from '../sim/system.js'
import { underSky } from '../gfx/instruments.js'

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
/** Milliseconds of backwards integration a trail may spend per frame while it seeds. */
const SEED_BUDGET_MS = 3

export function Trail({
  body,
  reference,
  period, // seconds — sets how much history the trail holds
  span = 0.95, // fraction of one orbit
  points = 420,
  /*
   * Steel, not cyan.
   *
   * These were a neon set — cyan for Earth, cyan for the Moon, green for the
   * ship, orange for the ISS, purple for Hubble — chosen when the interface
   * around them was itself neon. Five saturated hues drawn as long curves
   * across a dark frame is most of what made the scene read as a light show,
   * and the trails are the largest thing in it by area.
   *
   * They still have to be told apart, so the hues stay and the chroma goes:
   * each body keeps a direction on the wheel and loses the shout. This default
   * is Earth's, a cool steel that says "the planet you came from" without
   * competing with the planet itself.
   */
  head = '#9fb3c0',
  tail = '#26333c',
  width = 1.7,
  visible = true,
  /**
   * Whether this trail survives being seen from inside a sky.
   *
   * A trail is an orbit drawn across the whole frame, and from a chase camera
   * on an ascent the frame is a blue sky with a rocket in it. Earth's
   * heliocentric trail, the Moon's geocentric one, the ISS's and Hubble's are
   * then four bright lines in four unrelated directions over a photograph —
   * the thing a viewer described as random lines around the sky. The craft's
   * own trail is the exception and sets this: it comes out of the vehicle the
   * shot is about, and it is the one line on screen that is saying something
   * about what is happening.
   */
  inSky = false,
  /**
   * Fade the trail out when the camera is closer than this to its body, in
   * metres. A heliocentric orbit seen from beside its own planet is a straight
   * line drawn through the globe (the curve is a year across; from 30,000 km
   * none of it bends), which reads as a glitch over the most-watched view in
   * the product. Out past a few lunar distances the curve resolves and the
   * trail returns. Zero leaves the trail on at every range.
   */
  nearFade = 0,
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

    return { line: l, buffer: new Float32Array(points * 3), cursor: { head: 0, last: -Infinity, seeded: false } }
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
  // therefore real integrated history from the first frame it shows, not an
  // empty line that takes a simulated year to draw itself in.
  //
  // The history is integrated a few milliseconds per frame, not all at once.
  // Earth's trail is most of a year, and integrating it in one go stalled the
  // page for 1.6 s on an M4 the moment the trails came on (three trails, three
  // stalls), which on slower machines was the lag people reported. Spread out,
  // the same steps take a handful of frames and the line appears when its
  // history is complete; nothing about the drawn path changes.
  const seeding = useMemo(() => ({ clone: null, i: -1, t0: 0, a: new THREE.Vector3(), b: new THREE.Vector3() }), [])
  const seed = useCallback(() => {
    if (!seeding.clone) {
      seeding.clone = live.sim.clone()
      seeding.i = points - 1
      seeding.t0 = live.sim.t
    }
    const { clone, a, b } = seeding
    const until = performance.now() + SEED_BUDGET_MS
    while (seeding.i >= 0) {
      const i = seeding.i
      readPosition(clone.state, INDEX[body], a)
      readPosition(clone.state, INDEX[reference], b)
      a.sub(b)
      buffer[i * 3] = a.x
      buffer[i * 3 + 1] = a.y
      buffer[i * 3 + 2] = a.z
      seeding.i--
      if (seeding.i >= 0) clone.advance(-interval)
      if (performance.now() > until) break
    }
    if (seeding.i >= 0) return false
    seeding.clone = null
    cursor.head = points - 1
    cursor.last = seeding.t0
    cursor.seeded = true
    return true
  }, [body, reference, interval, points, buffer, cursor, seeding])

  // Hidden presentation trails need no backwards integration at startup.
  useEffect(() => { cursor.seeded = false; seeding.clone = null }, [seed, cursor, seeding])

  const rel = useMemo(() => new THREE.Vector3(), [])

  useFrame(({ camera }) => {
    group.current.position.copy(live.pos[reference])
    const near = nearFade > 0 ? THREE.MathUtils.smoothstep(camera.position.distanceTo(live.pos[body]), nearFade * 0.4, nearFade) : 1
    line.material.opacity = near

    // A trail can only sample once per frame, so under heavy time compression a
    // fast orbit collapses to a handful of points a quarter-revolution apart —
    // a jagged polygon that misrepresents the path rather than showing it. Below
    // roughly sixteen samples per revolution, draw nothing.
    const resolvable = live.simDtLastFrame * MIN_SAMPLES_PER_ORBIT <= period
    const shown = visible && resolvable && near > 0.01 && (inSky || !underSky())
    line.visible = shown
    // Hidden is not stopped: the ring keeps filling, so a trail that comes
    // back at 40 km comes back with the history it would have had.
    if (!visible || !resolvable) return

    const elapsed = live.sim.t - cursor.last

    // Time ran backwards (a reset), or jumped further than the whole window is
    // wide: the stored history no longer connects to the present, so rebuild it
    // rather than drawing a chord across the gap. A merely large forward step is
    // normal at high time warp and just samples more coarsely.
    if (!cursor.seeded || elapsed < -interval || elapsed > interval * points) {
      // A seed in progress that the clock has jumped away from starts over.
      if (seeding.clone && (live.sim.t < seeding.t0 - interval || live.sim.t - seeding.t0 > interval * points)) seeding.clone = null
      cursor.seeded = false
      if (!seed()) {
        line.visible = false
        return
      }
    } else if (elapsed >= interval) {
      cursor.head = (cursor.head + 1) % points
      rel.copy(live.pos[body]).sub(live.pos[reference])
      buffer[cursor.head * 3] = rel.x
      buffer[cursor.head * 3 + 1] = rel.y
      buffer[cursor.head * 3 + 2] = rel.z
      cursor.last = live.sim.t
    } else {
      return // No new sample: keep the GPU buffer, even when its parent moves.
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
