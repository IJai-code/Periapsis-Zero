import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { VIEW } from '../gfx/cosmicView.js'
import { projectedRadius, sphereLevel, SPHERE_SEGMENTS } from '../gfx/sphereDetail.js'
import { DETAIL_STEPS, cappedLevel, detailStep } from '../gfx/detailBudget.js'
import { Html } from '@react-three/drei'
import * as THREE from 'three'
import { AdditiveBlending, DoubleSide, Vector3 } from 'three'
import { live } from '../sim/live.js'
import { RAILS } from '../sim/rails.js'
import { AU, BODIES } from '../sim/constants.js'
import { setUi, useUi } from '../sim/store.js'
import { QUALITY } from '../sim/device.js'
import { daySky } from '../gfx/skyGlow.js'
import { LOOKS } from '../gfx/bodyLooks.js'
import { bodyAxes, lockedAxes, poleDirection } from '../gfx/bodyFrame.js'
import { makeAirMaterial, makeRingMaterial, makeSurfaceMaterial } from '../gfx/planetMaterial.js'
import { deimosGeometry, nucleusGeometry, phobosGeometry } from '../gfx/smallBodies.js'
import { SOLAR_ILLUMINANCE_AT_1AU } from '../gfx/sunlight.js'

/**
 * The worlds the integrator does not carry: seven planets, Pluto, Halley, and
 * the moons worth naming.
 *
 * Each is drawn at its real size and shape — the giants oblate, Phobos a lump
 * — turned to its real pole and spinning at its real rate from the IAU's
 * rotational elements (`gfx/bodyFrame.js`), with a surface that is computed
 * per pixel rather than painted (`gfx/glsl/worlds.js`), so a close approach
 * resolves more detail instead of running out of it. Saturn's rings are the
 * Cassini radii with the Cassini Division and the Encke gap in them, they
 * shadow the planet and the planet shadows them; Io's shadow crosses Jupiter;
 * a moon passing into its planet's shadow goes dark.
 *
 * From anywhere useful most of them are still nothing at all — Jupiter at
 * five astronomical units subtends four hundredths of an arcsecond — so each
 * also carries a beacon, a small additive point held at a constant angular
 * size: a statement about how *bright* a planet is, not how large. It fades out
 * as the real disc grows past it, so the two never draw over each other.
 */

/** Angular radius the beacon holds, radians. About five arcminutes. */
const BEACON_ANGLE = 0.0015

/** The beacon's own opacity, before any sky has had its say. */
const BEACON_OPACITY = 0.8

/**
 * The brightest any planet gets from Earth: Venus near greatest brilliancy, a
 * little under magnitude −4.9. A beacon obeys the sky the stars do.
 */
const BRIGHTEST_PLANET = -4.9
/** And the click target, which has to be comfortable rather than truthful. */
const PICK_ANGLE = 0.02

/**
 * How far a moon has to be from its planet, as seen from the camera, before
 * its name tag is shown, radians — a tag's own height at the 45° lens.
 */
const LABEL_SEPARATION = 0.025

/**
 * How much of the fall of sunlight with distance a camera pointed at a planet
 * compensates for.
 *
 * Sunlight at Neptune is a nine-hundredth of what it is at Earth, and drawn
 * at Earth's exposure Neptune is black — which is what every body out here
 * was. No camera photographs it at Earth's exposure: Voyager's were set for
 * the light at the target. So the irradiance a world is drawn with is the
 * physical one with most of the distance taken out, `(AU / r)^(2(1 − k))`:
 * at k = 0.875 Jupiter draws at 0.66 of Earth's light, Saturn 0.57, Neptune
 * 0.43. Enough of the falloff is kept that the outer planets read as further
 * from the Sun — as the inner ones read nearer — without any of them being
 * too dark to see.
 */
const SUN_ADAPTATION = 0.875

/**
 * And the camera exposes for its subject: a world brighter than Earth is drawn
 * a little down, so Venus's cloud deck reads as cream rather than clipping to
 * white. `(albedo / 0.4)^0.6`, floored at 1 — nothing is brightened by it, and
 * Earth, which is the scene's reference, is untouched.
 */
const subjectExposure = (albedo) => Math.pow(Math.max(1, albedo / 0.4), 0.6)

/** The Sun's radius, for the penumbrae of shadows cast across a world. */
const SUN_R = BODIES.sun.radius

/** Moons whose shadows fall on their planets, by planet. */
const CASTERS = {
  jupiter: ['io', 'europa', 'ganymede', 'callisto'],
  saturn: ['titan'],
  mars: ['phobos', 'deimos'],
}

/*
 * A comet's tail — see CometTail. Two tails, as every photograph of Halley
 * shows: the dust tail, broad, yellowish, curving back along the orbit; the
 * ion tail, narrow, blue, straight out from the Sun. Both are functions of the
 * comet's distance from the Sun, because a nucleus only boils once it is
 * inside about three astronomical units — at the J2000 epoch Halley is near
 * aphelion, 26 AU out, and has no tail at all.
 */
const TAIL_ON_AU = 3.5
const TAIL_LAYERS = [
  { r: 8e9, h: 6e10, opacity: 0.12, colour: '#d9cfb8' },
  { r: 3.5e9, h: 3.2e10, opacity: 0.18, colour: '#e6dcc6' },
  { r: 1.2e9, h: 9e10, opacity: 0.16, colour: '#8fb4ff' },
]

const _dir = new Vector3()
const _up = new Vector3(0, 1, 0)
const _v = new Vector3()
const _w = new Vector3()
const _m = new THREE.Matrix4()
const _x = new Vector3()
const _y = new Vector3()
const _z = new Vector3()
const _axes = new Float64Array(9)
const _pole = new Float64Array(3)

function CometTail({ onRef }) {
  return (
    <group ref={onRef} visible={false}>
      {TAIL_LAYERS.map(({ r, h, opacity, colour }, i) => (
        <mesh key={i} position={[0, -h / 2, 0]} rotation={[Math.PI, 0, 0]}>
          <coneGeometry args={[r, h, 16, 1, true]} />
          <meshBasicMaterial
            color={colour}
            transparent
            opacity={opacity}
            blending={AdditiveBlending}
            depthWrite={false}
            side={DoubleSide}
            toneMapped={false}
          />
        </mesh>
      ))}
    </group>
  )
}

/** Everything a body needs built once: geometry, materials, and its fixed facts. */
function buildBody(p, sphere) {
  const look = LOOKS[p.id]
  if (!look) return null
  let geometry = sphere
  let scale = [look.equatorial, look.polar, look.equatorial]
  if (look.triaxial) {
    const make = p.id === 'phobos' ? phobosGeometry : p.id === 'deimos' ? deimosGeometry : nucleusGeometry
    geometry = make(look.triaxial)
    scale = [1, 1, 1]
  }
  const surface = makeSurfaceMaterial(look, { hasParent: Boolean(p.parent) })
  const ring = look.ring
    ? {
        geometry: new THREE.RingGeometry(look.ring.inner, look.ring.outer, 384, 16),
        material: makeRingMaterial(look),
      }
    : null
  const air = look.atmosphere ? makeAirMaterial(look) : null
  const parentPole = p.parent && LOOKS[p.parent]?.pole ? poleDirection(new Float64Array(3), ...LOOKS[p.parent].pole) : null
  return {
    id: p.id,
    rail: p,
    look,
    geometry,
    ownsGeometry: geometry !== sphere,
    scale,
    surface,
    ring,
    air,
    parentPole,
    casters: CASTERS[p.id] ?? [],
    radius: look.equatorial,
    airScale: look.atmosphere ? 1 + look.atmosphere.height : 1,
  }
}

/**
 * The per-render half: everything expressed in view space, taken from the
 * camera that is about to draw — `onBeforeRender` runs after the rig has put
 * the camera where it will be, so the light cannot lag the view by a frame.
 */
function viewUniforms(body, camera, centreW) {
  const inv = camera.matrixWorldInverse
  const u = body.surface.uniforms
  // Direction to the Sun, and the pole, as directions in view space.
  _dir.subVectors(live.pos.sun, centreW).normalize()
  u.uSunDirV.value.copy(_dir).transformDirection(inv)
  u.uCenterV.value.copy(centreW).applyMatrix4(inv)
  u.uPoleV.value.copy(body.poleW).transformDirection(inv)
  let n = 0
  for (let i = 0; i < body.casters.length; i++) {
    const q = live.railPos[body.casters[i]]
    const look = LOOKS[body.casters[i]]
    if (q === undefined || look === undefined) continue
    const c = u.uCasters.value[n]
    _w.copy(q).applyMatrix4(inv)
    c.set(_w.x, _w.y, _w.z, look.equatorial)
    n++
  }
  u.uCasterCount.value = n
  if (body.rail.parent) {
    const q = live.railPos[body.rail.parent]
    const parent = LOOKS[body.rail.parent]
    _w.copy(q).applyMatrix4(inv)
    u.uParentV.value.set(_w.x, _w.y, _w.z, parent?.equatorial ?? 0)
    // Planetshine: the parent's albedo, the solid angle it fills, and how much
    // of its face the moon sees lit.
    _v.subVectors(q, centreW)
    const dist = _v.length()
    u.uShineDirV.value.copy(_v).divideScalar(dist).transformDirection(inv)
    _x.subVectors(live.pos.sun, q).normalize()
    _y.subVectors(centreW, q).normalize()
    const litFraction = 0.5 * (1 + _x.dot(_y))
    const R = parent?.equatorial ?? 0
    u.uShine.value = (parent?.albedo ?? 0.3) * (R / dist) * (R / dist) * litFraction
  }
  if (body.ring) {
    const r = body.ring.material.uniforms
    r.uSunDirV.value.copy(u.uSunDirV.value)
    r.uCenterV.value.copy(u.uCenterV.value)
    r.uPoleV.value.copy(u.uPoleV.value)
  }
  if (body.air) {
    const a = body.air.uniforms
    a.uSunDirV.value.copy(u.uSunDirV.value)
    a.uCenterV.value.copy(u.uCenterV.value)
    a.uPoleV.value.copy(u.uPoleV.value)
  }
}

export function Planets() {
  const labels = useUi((s) => s.labels)
  const focus = useUi((s) => s.focus)
  /** The tour, the intro and the broadcast are shots with captions; name tags are the pilot's. */
  const tour = useUi((s) => s.tour || s.broadcast)
  const groups = useRef({})
  /** Every body's parts register under their own names — nothing is indexed. */
  const reg = (id, key) => (el) => {
    const entry = (groups.current[id] ??= {})
    entry[key] = el
  }

  const bodies = useMemo(() => {
    /*
     * The LOD ladder, one rung built the first time a body asks for it.
     *
     * It has to span the whole of `SPHERE_SEGMENTS`, and a shorter array is
     * not a cheaper ladder — it is an out-of-range read. `sphereLevel` returns
     * the top rung for any body whose projected radius passes about 4,000
     * drawing-buffer pixels, and returns it unconditionally from *inside* a
     * body, where `projectedRadius` is Infinity by construction. Built over
     * four rungs, approaching Mars closer than about 1.2 radii therefore
     * assigned `undefined` to the mesh; measured in the page, the next frame
     * threw `Cannot read properties of undefined (reading 'boundingSphere')`
     * and took the render loop with it. The ladder's length is the ladder's,
     * not a number restated here.
     *
     * Lazy because the top rung is 131,000 vertices and most visitors never
     * fly close enough to a planet to need it, and shared because one unit
     * sphere is every body — a radius is a scale on the mesh, not a mesh.
     */
    const spheres = new Array(SPHERE_SEGMENTS.length)
    const rung = (level) => {
      const seg = SPHERE_SEGMENTS[level]
      return (spheres[level] ??= new THREE.SphereGeometry(1, seg, seg / 2))
    }
    const sphere = rung(0)
    const list = RAILS.map((p) => buildBody(p, sphere)).filter(Boolean)
    for (const b of list) { b.poleW = new Vector3(0, 1, 0); b.level = -1 }
    return { sphere, spheres, rung, list, byId: Object.fromEntries(list.map((b) => [b.id, b])) }
  }, [])

  useEffect(
    () => () => {
      // Holes are rungs nobody ever climbed to; there is nothing to free.
      for (const g of bodies.spheres) g?.dispose()
      for (const b of bodies.list) {
        if (b.ownsGeometry) b.geometry.dispose()
        b.surface.dispose()
        b.ring?.geometry.dispose()
        b.ring?.material.dispose()
        b.air?.dispose()
      }
    },
    [bodies],
  )

  /*
   * The parts are named, not indexed. They used to be `g.children[1]` and
   * `g.children[2]`, which broke the day a ring or a tail changed the child
   * order — the beacon silently started scaling a planet's ring instead.
   */
  useFrame(({ camera, gl }) => {
    let seen = daySky.limitMagnitude - BRIGHTEST_PLANET
    seen = seen > 0 ? (seen < 1 ? seen : 1) : 0
    /*
     * And from far enough out a planet is not a point any more, it is nothing:
     * reflected light falls as the square of the distance, and from 2,000 AU
     * Jupiter is fifteenth magnitude. The beacons hold a constant angular size
     * by design, so without this they would all sit on the Sun as one bright
     * dot seen from another galaxy. Faded over 60 to 2,000 AU, logarithmically.
     */
    const au = VIEW.fromSun / AU
    if (au > 60) seen *= au > 2000 ? 0 : 1 - Math.log(au / 60) / Math.log(2000 / 60)
    const t = live.sim.t
    const days = t / 86400
    for (let k = 0; k < bodies.list.length; k++) {
      const b = bodies.list[k]
      const p = b.rail
      const entry = groups.current[p.id]
      if (!entry || !entry.g) continue
      const { g, orient, beacon, pick, tail } = entry
      g.position.copy(live.railPos[p.id])
      const d = camera.position.distanceTo(g.position)
      if (!b.ownsGeometry && entry.surface) {
        const pixels = projectedRadius(b.radius, d, gl.domElement.height, camera.fov)
        /*
         * The cap, read as a plain number. It changes only when the resolution
         * governor spends or refunds it (see gfx/detailBudget.js) — a few
         * times a minute at most — and when it does, the `cap !== b.cap`
         * branch below forces every body through a re-selection that same
         * frame, so a withdrawn rung is withdrawn everywhere at once.
         */
        const cap = DETAIL_STEPS[detailStep()]
        const level = cappedLevel(pixels, cap !== b.cap ? -1 : b.level, cap)
        if (level !== b.level || cap !== b.cap) {
          const geometry = bodies.rung(level)
          entry.surface.geometry = geometry
          if (entry.air) entry.air.geometry = geometry
          b.level = level
          b.cap = cap
        }
      }

      // Orientation: the IAU pole and meridian, or locked to the parent.
      const look = b.look
      if (look.locked && b.parentPole) {
        const q = live.railPos[p.parent]
        lockedAxes(_axes, b.parentPole, q.x - g.position.x, q.y - g.position.y, q.z - g.position.z)
      } else if (look.pole) {
        const W = (look.W0 + look.Wdot * days) % 360
        bodyAxes(_axes, look.pole[0], look.pole[1], W)
      }
      if (orient) {
        _x.set(_axes[0], _axes[1], _axes[2])
        _y.set(_axes[3], _axes[4], _axes[5])
        _z.set(_axes[6], _axes[7], _axes[8])
        _m.makeBasis(_x, _y, _z)
        orient.quaternion.setFromRotationMatrix(_m)
        b.poleW.copy(_y)
      }

      // Light: the Sun's irradiance here, with the camera's adaptation.
      const r = _v.subVectors(g.position, live.pos.sun).length()
      const E =
        (SOLAR_ILLUMINANCE_AT_1AU * Math.pow(AU / r, 2 * (1 - SUN_ADAPTATION))) / subjectExposure(look.albedo ?? 0.3)
      const su = b.surface.uniforms
      su.uIrradiance.value = E
      su.uOct.value = QUALITY.octaves
      su.uTime.value = t % 1e6
      su.uSunAngle.value = SUN_R / r
      if (look.cloudPeriodDays) su.uCloudTurn.value = ((days / look.cloudPeriodDays) % 1) * Math.PI * 2
      if (b.ring) {
        b.ring.material.uniforms.uIrradiance.value = E
        b.ring.material.uniforms.uSunAngle.value = SUN_R / r
      }
      if (b.air) b.air.uniforms.uIrradiance.value = E

      // The beacon: a point of light while the disc is smaller than it, gone as the disc grows.
      const angular = b.radius / d
      if (beacon) {
        const fade = 1 - Math.min(1, Math.max(0, (angular - BEACON_ANGLE * 0.35) / (BEACON_ANGLE * 0.65)))
        beacon.scale.setScalar(Math.max(1, (d * BEACON_ANGLE) / b.radius))
        beacon.material.opacity = BEACON_OPACITY * seen * fade
        beacon.visible = seen > 0 && fade > 0
      }
      if (pick) pick.scale.setScalar(Math.max(1, (d * PICK_ANGLE) / b.radius))

      if (p.parent && entry.label) {
        const q = live.railPos[p.parent]
        const hide = q !== undefined && g.position.distanceTo(q) < d * LABEL_SEPARATION
        if (hide === (entry.label.style.visibility !== 'hidden')) {
          entry.label.style.visibility = hide ? 'hidden' : 'visible'
        }
      }
      // The tail points anti-sunward, and only exists inside a few AU.
      if (tail) {
        _dir.subVectors(g.position, live.pos.sun)
        const sunDist = _dir.length() || 1
        _dir.divideScalar(sunDist)
        tail.quaternion.setFromUnitVectors(_up, _dir)
        const au = sunDist / AU
        tail.visible = au < TAIL_ON_AU
        tail.scale.setScalar(Math.min(1.6, Math.max(0.2, (1.0 / Math.max(au, 0.3)) ** 2)))
      }
    }
  }, -2)

  return bodies.list.map((b) => {
    const p = b.rail
    const centre = new Vector3()
    const before = (renderer, scene, camera) => {
      const g = groups.current[p.id]?.g
      if (!g) return
      centre.setFromMatrixPosition(g.matrixWorld)
      viewUniforms(b, camera, centre)
    }
    return (
      <group key={p.id} ref={reg(p.id, 'g')}>
        <group ref={reg(p.id, 'orient')}>
          <mesh ref={reg(p.id, 'surface')} geometry={b.geometry} material={b.surface} scale={b.scale} onBeforeRender={before} dispose={null} />
          {b.ring && (
            <mesh
              geometry={b.ring.geometry}
              material={b.ring.material}
              rotation={[-Math.PI / 2, 0, 0]}
              renderOrder={3}
            />
          )}
          {b.air && (
            <mesh
              ref={reg(p.id, 'air')}
              geometry={bodies.sphere}
              material={b.air}
              dispose={null}
              scale={[b.scale[0] * b.airScale, b.scale[1] * b.airScale, b.scale[2] * b.airScale]}
              renderOrder={2}
            />
          )}
        </group>

        <mesh ref={reg(p.id, 'beacon')}>
          <sphereGeometry args={[b.radius, 8, 6]} />
          <meshBasicMaterial
            color={p.colour}
            transparent
            opacity={BEACON_OPACITY}
            blending={AdditiveBlending}
            depthWrite={false}
            toneMapped={false}
          />
        </mesh>

        <mesh
          ref={reg(p.id, 'pick')}
          onClick={(e) => {
            e.stopPropagation()
            setUi({ focus: p.id })
          }}
          onPointerOver={() => (document.body.style.cursor = 'pointer')}
          onPointerOut={() => (document.body.style.cursor = 'auto')}
        >
          <sphereGeometry args={[b.radius, 12, 8]} />
          <meshBasicMaterial visible={false} />
        </mesh>

        {p.comet && <CometTail onRef={reg(p.id, 'tail')} />}

        {labels && focus !== 'ground' && focus !== 'intro' && !tour && (
          <Html center zIndexRange={[19, 9]} style={{ pointerEvents: 'none', transform: 'translateY(-34px)' }}>
            <div
              ref={reg(p.id, 'label')}
              className={`whitespace-nowrap font-mono text-[9px] tracking-[0.22em] uppercase transition-colors ${
                focus === p.id ? 'text-ember' : 'text-white/35'
              }`}
            >
              <span className="mr-1.5 opacity-50">+</span>
              {p.name}
            </div>
          </Html>
        )}
      </group>
    )
  })
}
