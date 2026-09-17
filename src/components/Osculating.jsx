import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { Html } from '@react-three/drei'
import { Line2, LineGeometry, LineMaterial } from 'three-stdlib'
import { live } from '../sim/live.js'
import { BODIES, G } from '../sim/constants.js'
import { SAMPLES, packPolyline } from '../sim/predict.js'
import { dominantBody, soiRadius } from '../sim/soi.js'
import { INDEX } from '../sim/system.js'
import { useUi } from '../sim/store.js'

/**
 * The osculating conic: the orbit the craft would keep if every body but the
 * one it is falling round vanished this instant.
 *
 * Drawn beside the trajectory, never instead of it. The trajectory is the path
 * the integrator will actually fly — sim/predict.js explains why a conic was
 * replaced there — and the gap between the two lines is what this one is for: it
 * is the perturbation, made visible. In low orbit they lie on top of each other;
 * on a lunar approach the Earth bends the real path away from the Moon's conic
 * well before periselene.
 *
 * About the same body the trajectory is drawn around, chosen by the same
 * function, and coloured for that body. Dashed, so it never reads as a path.
 */

/** Seconds between redraws, the trajectory's own cadence. */
const REFRESH = 0.2
const COLOUR = { sun: '#ffc46b', earth: '#6fb7ff', moon: '#c9b8ff' }
const NAME = { sun: 'Sol', earth: 'Terra', moon: 'Luna' }
/**
 * How far an open conic is drawn: to the edge of the sphere of influence it is a
 * conic about, which is also as far as it means anything. The Sun has no sphere,
 * so there it stops at this multiple of the craft's present distance.
 */
const REACH = 4
/** Samples to a dash, and to the gap after it: about thirty dashes round a closed orbit. */
const DASH = 8

/**
 * The line, with its dashes written into the colours once. Line2 can dash for
 * itself, but only by recomputing and reallocating its distance buffers on every
 * update; a segment's alpha costs nothing and never changes.
 */
function makeLine() {
  const geometry = new LineGeometry()
  geometry.setPositions(new Float32Array(SAMPLES * 3))
  geometry.setColors(new Float32Array(SAMPLES * 4), 4)
  const material = new LineMaterial({
    vertexColors: true,
    transparent: true,
    linewidth: 1.5,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  })
  const line = new Line2(geometry, material)
  line.frustumCulled = false
  return line
}

const _colour = new THREE.Color()

/** Paint the line in a body's colour, dashes included. Only when the body changes. */
function paint(line, body) {
  _colour.set(COLOUR[body] ?? COLOUR.earth)
  const data = line.geometry.attributes.instanceColorStart.data
  const colours = data.array
  for (let s = 0; s < SAMPLES - 1; s++) {
    const alpha = Math.floor(s / DASH) % 2 === 0 ? 0.9 : 0
    for (let end = 0; end < 2; end++) {
      const o = s * 8 + end * 4
      colours[o] = _colour.r
      colours[o + 1] = _colour.g
      colours[o + 2] = _colour.b
      colours[o + 3] = alpha
    }
  }
  data.needsUpdate = true
}

export function Osculating() {
  const show = useUi((s) => s.osculating)
  const cinematic = useUi((s) => s.focus === 'cinematic')
  const size = useThree((s) => s.size)
  const group = useRef()
  const label = useRef()
  const labelText = useRef()
  const clock = useRef(REFRESH)
  const painted = useRef('')
  const paintedLine = useRef(null)
  const body = useRef('earth')

  const line = useMemo(makeLine, [])
  const points = useMemo(() => new Float64Array(SAMPLES * 3), [])

  useEffect(() => {
    line.material.resolution.set(size.width, size.height)
  }, [line, size])
  useEffect(
    () => () => {
      line.geometry.dispose()
      line.material.dispose()
    },
    [line],
  )

  useFrame((_, delta) => {
    const g = group.current
    if (!g || !show || cinematic) return
    clock.current += delta
    if (clock.current >= REFRESH) {
      clock.current = 0
      g.visible = draw()
    }
    g.position.copy(live.pos[body.current])
  }, -2)

  /** Recompute the conic from the craft's state about its dominant body. False when there is nothing to draw. */
  function draw() {
    const around = dominantBody(live.sim, 'ship') ?? 'earth'
    body.current = around
    // Keyed on the line as well as the body. Fast Refresh recomputes useMemo on
    // every edit but keeps refs, so a body-only key left a fresh line unpainted —
    // drawn, and invisible, because its colours were all zero.
    if (painted.current !== around || paintedLine.current !== line) {
      paint(line, around)
      painted.current = around
      paintedLine.current = line
    }

    const s = live.sim.state
    const c = INDEX.ship * 6
    const b = INDEX[around] * 6
    const rx = s[c] - s[b]
    const ry = s[c + 1] - s[b + 1]
    const rz = s[c + 2] - s[b + 2]
    const vx = s[c + 3] - s[b + 3]
    const vy = s[c + 4] - s[b + 4]
    const vz = s[c + 5] - s[b + 5]
    const mu = G * BODIES[around].mass
    const r = Math.sqrt(rx * rx + ry * ry + rz * rz)

    // Angular momentum, and the eccentricity vector (v x h)/mu - r/|r|, which
    // points at periapsis.
    const hx = ry * vz - rz * vy
    const hy = rz * vx - rx * vz
    const hz = rx * vy - ry * vx
    const h2 = hx * hx + hy * hy + hz * hz
    if (!(h2 > 0) || !(r > 0)) return false
    const ex = (vy * hz - vz * hy) / mu - rx / r
    const ey = (vz * hx - vx * hz) / mu - ry / r
    const ez = (vx * hy - vy * hx) / mu - rz / r
    const e = Math.sqrt(ex * ex + ey * ey + ez * ez)
    const p = h2 / mu

    // The orbit's own axes: P toward periapsis, Q ninety degrees on in the
    // direction of motion. A circle has no periapsis, so P is where the craft is.
    let px = rx / r
    let py = ry / r
    let pz = rz / r
    if (e > 1e-9) {
      px = ex / e
      py = ey / e
      pz = ez / e
    }
    const h = Math.sqrt(h2)
    const qx = (hy * pz - hz * py) / h
    const qy = (hz * px - hx * pz) / h
    const qz = (hx * py - hy * px) / h

    // Which true anomalies to draw: what lies above the surface and, for an open
    // conic, within reach — the approach alone if it ends in the ground.
    const R = BODIES[around].radius
    const rp = p / (1 + e)
    let from
    let to
    if (e < 1) {
      if (rp >= R) {
        from = -Math.PI
        to = Math.PI
      } else {
        const cosR = (p / R - 1) / e
        if (!(cosR > -1)) return false // the whole ellipse is underground
        const nuR = Math.acos(Math.min(1, cosR))
        from = nuR
        to = 2 * Math.PI - nuR
      }
    } else {
      const nuInf = Math.acos(-1 / e)
      const sphere = soiRadius(s, around)
      const limit = Number.isFinite(sphere) && sphere > r ? sphere : REACH * r
      const cosReach = (p / limit - 1) / e
      const reach = cosReach >= 1 ? 0 : Math.min(Math.acos(Math.max(-1, cosReach)), nuInf * 0.999)
      from = -reach
      to = reach
      if (rp < R) {
        const nuR = Math.acos(Math.min(1, Math.max(-1, (p / R - 1) / e)))
        to = -nuR
      }
      if (!(to > from)) return false
    }

    let far = 0
    let farIndex = 0
    for (let i = 0; i < SAMPLES; i++) {
      const nu = from + ((to - from) * i) / (SAMPLES - 1)
      const radius = p / (1 + e * Math.cos(nu))
      const cos = Math.cos(nu)
      const sin = Math.sin(nu)
      points[i * 3] = radius * (cos * px + sin * qx)
      points[i * 3 + 1] = radius * (cos * py + sin * qy)
      points[i * 3 + 2] = radius * (cos * pz + sin * qz)
      if (radius > far) {
        far = radius
        farIndex = i
      }
    }
    const attr = line.geometry.attributes.instanceStart.data
    packPolyline(attr.array, points, SAMPLES, SAMPLES)
    attr.needsUpdate = true
    line.geometry.computeBoundingBox()
    line.geometry.computeBoundingSphere()

    // The legend sits at the far end of the conic, where it is least in the way.
    if (label.current) {
      label.current.position.set(points[farIndex * 3], points[farIndex * 3 + 1], points[farIndex * 3 + 2])
    }
    if (labelText.current) {
      labelText.current.textContent = `${NAME[around] ?? around} · e ${e.toFixed(e < 0.1 ? 4 : 3)}`
      labelText.current.style.color = COLOUR[around] ?? COLOUR.earth
    }
    return true
  }

  if (!show || cinematic) return null

  return (
    <group ref={group} visible={false}>
      <primitive object={line} />
      <group ref={label}>
        <Html center zIndexRange={[17, 7]} style={{ pointerEvents: 'none' }}>
          <div className="translate-y-3 whitespace-nowrap font-mono text-[9px] tracking-[0.16em] uppercase opacity-80">
            <span className="mr-1 text-white/40">osculating</span>
            <span ref={labelText}>—</span>
          </div>
        </Html>
      </group>
    </group>
  )
}
