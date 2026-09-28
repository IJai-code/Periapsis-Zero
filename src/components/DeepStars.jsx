import { useEffect, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { CLUSTER_MEMBERS, NAMED_STARS, PARSEC, SOLAR_RADIUS } from '../sim/cosmos.js'
import { colourTemperature, blackbodyRGB, DEFAULT_TEMPERATURE } from '../gfx/stars.js'
import { makeGlowMaterial, makeStarMaterial, tuneStar } from '../gfx/starSurface.js'
import { daySky } from '../gfx/skyGlow.js'
import { scalarUniform } from '../gfx/scalarUniform.js'
import { VIEW } from '../gfx/cosmicView.js'
import { live } from '../sim/live.js'

/**
 * The stars with names, where they are.
 *
 * The Hipparcos field (`Starfield.jsx`) is a sky of directions, right from
 * anywhere near the Sun and wrong from anywhere else. These are the same stars
 * — the field leaves them out — placed in three dimensions from their
 * parallaxes, each carrying its absolute magnitude, so the brightness each
 * one is drawn at is the inverse-square law from wherever the camera is. From
 * Earth that reproduces the catalogue magnitude exactly (`verify-deep-sky`);
 * from Alpha Centauri it puts the Sun in Cassiopeia at magnitude 0.5, which
 * is where it is.
 *
 * The Sun is the last point, moving with the ephemeris: from the planets its
 * sphere is drawn by `Sun.jsx`, and past a few hundred AU it is this point.
 *
 * ── precision ─────────────────────────────────────────────────────────
 *
 * A star is 1e17 m away and the camera may be 1e10 m from it. A float32 at
 * 1e17 resolves 1e10 m, so position − camera in single precision loses the
 * whole answer. Each position and the camera are split into a float32 and the
 * float32 of what it left over, and the difference is taken part by part —
 * the double-single trick — which keeps it to about 1e-14 of the distance.
 *
 * ── resolved ──────────────────────────────────────────────────────────
 *
 * A star whose disc spans more than a pixel or so is drawn as a sphere —
 * photosphere, limb darkening, granulation sized by its surface gravity (see
 * `gfx/starSurface.js`) — and its point fades as the disc grows.
 */

const PSF_PIXELS = 3.0
const STEVENS = 1 / 3
/** Resolved spheres in use at once: the star you are at, and a close companion. */
const POOL = 3

const VERT = /* glsl */ `
  attribute vec3 posHi;
  attribute vec3 posLo;
  attribute float absMag;
  attribute float radius;
  uniform vec3 uCamHi;
  uniform vec3 uCamLo;
  uniform float uPointScale;
  uniform float uStevens;
  uniform float uLimitFlux;
  uniform float uPx;
  varying vec3 vColour;
  void main() {
    vec3 rel = (posHi - uCamHi) + (posLo - uCamLo);
    float d = max(length(rel), 1.0);
    // Distance modulus, in parsecs: m = M + 5 log10(d / 10 pc).
    float m = absMag + 5.0 * log2(d / (10.0 * ${PARSEC.toExponential(10)})) * 0.30103;
    float flux = exp2(-0.4 * 3.321928 * m);
    float seen = smoothstep(uLimitFlux, uLimitFlux * 2.512, flux);
    // The point gives way to the sphere once the disc spans a pixel or two.
    float rpx = (radius / d) / uPx;
    float point = 1.0 - smoothstep(1.2, 3.5, rpx);
    vColour = color * min(pow(flux, uStevens), 60.0) * seen * point;
    vec4 mv = vec4(mat3(viewMatrix) * (rel / d) * 400.0, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = (seen > 0.0 && point > 0.0) ? uPointScale : 0.0;
  }
`

const FRAG = /* glsl */ `
  varying vec3 vColour;
  void main() {
    vec2 d = gl_PointCoord - vec2(0.5);
    float r2 = dot(d, d);
    if (r2 > 0.25) discard;
    gl_FragColor = vec4(vColour * exp(-r2 * 18.0), 1.0);
  }
`

const split = (x) => {
  const hi = Math.fround(x)
  return [hi, Math.fround(x - hi)]
}

function temperatureOf(s) {
  if (s.teff) return s.teff
  return s.bv == null ? DEFAULT_TEMPERATURE : colourTemperature(s.bv)
}

/** A rough mass for granulation only: L = R^2 T^4, and M ~ L^0.28 across the classes. */
function massOf(s, T) {
  const L = s.radius * s.radius * Math.pow(T / 5772, 4)
  return Math.min(40, Math.max(0.1, Math.pow(L, 0.28)))
}

export function DeepStars() {
  /*
   * The named stars, then the clusters' members, then the Sun last (its
   * position is rewritten every frame). Only the named stars are candidates
   * for a resolved disc: a member is a kind of star placed by chance, and
   * nobody flies to one.
   */
  const stars = useMemo(
    () => [
      ...NAMED_STARS,
      ...CLUSTER_MEMBERS.map((m) => ({ radius: 1, absMag: m.absMag, teff: m.teff, abs: m.abs })),
      { id: 'sun', name: 'Sun', radius: 1, absMag: 4.83, bv: 0.65, abs: live.abs.sun },
    ],
    [],
  )
  const n = stars.length
  const named = NAMED_STARS.length

  const { geometry, material, hiAttr, loAttr } = useMemo(() => {
    const posHi = new Float32Array(n * 3)
    const posLo = new Float32Array(n * 3)
    const absMag = new Float32Array(n)
    const radius = new Float32Array(n)
    const colour = new Float32Array(n * 3)
    const rgb = [0, 0, 0]
    stars.forEach((s, i) => {
      for (let k = 0; k < 3; k++) {
        const [h, l] = split(s.abs.getComponent(k))
        posHi[i * 3 + k] = h
        posLo[i * 3 + k] = l
      }
      absMag[i] = s.absMag
      radius[i] = s.radius * SOLAR_RADIUS
      blackbodyRGB(rgb, Math.min(40000, Math.max(1500, temperatureOf(s))))
      colour.set(rgb, i * 3)
    })
    const g = new THREE.BufferGeometry()
    // `position` is unused by the shader but three wants one for the draw count.
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3))
    const hiAttr = new THREE.BufferAttribute(posHi, 3)
    const loAttr = new THREE.BufferAttribute(posLo, 3)
    g.setAttribute('posHi', hiAttr)
    g.setAttribute('posLo', loAttr)
    g.setAttribute('absMag', new THREE.BufferAttribute(absMag, 1))
    g.setAttribute('radius', new THREE.BufferAttribute(radius, 1))
    g.setAttribute('color', new THREE.BufferAttribute(colour, 3))
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e30)
    const m = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        uCamHi: { value: new THREE.Vector3() },
        uCamLo: { value: new THREE.Vector3() },
        uPointScale: scalarUniform(PSF_PIXELS),
        uStevens: { value: STEVENS },
        uLimitFlux: scalarUniform(0),
        uPx: scalarUniform(1e-3),
      },
      vertexColors: true,
      transparent: false,
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
    })
    return { geometry: g, material: m, hiAttr, loAttr }
  }, [stars, n])

  /* The spheres, for whichever stars are close enough to have a disc. */
  const pool = useMemo(
    () =>
      Array.from({ length: POOL }, () => {
        const surface = makeStarMaterial()
        const corona = makeGlowMaterial()
        const body = new THREE.Mesh(new THREE.SphereGeometry(1, 96, 48), surface)
        const halo = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), corona)
        // The glare first, the photosphere over it.
        halo.renderOrder = 1
        body.renderOrder = 2
        halo.frustumCulled = false
        const group = new THREE.Group()
        group.add(body, halo)
        group.visible = false
        return { group, body, halo, surface, corona, star: null }
      }),
    [],
  )
  const tuned = useMemo(() => new Map(), [])

  useEffect(
    () => () => {
      geometry.dispose()
      material.dispose()
      for (const p of pool) {
        p.body.geometry.dispose()
        p.halo.geometry.dispose()
        p.surface.dispose()
        p.corona.dispose()
      }
    },
    [geometry, material, pool],
  )

  useFrame(({ gl, camera, clock }) => {
    const u = material.uniforms
    // The camera, split the same way the positions were.
    const cx = camera.position.x + live.origin.x
    const cy = camera.position.y + live.origin.y
    const cz = camera.position.z + live.origin.z
    let h = Math.fround(cx)
    u.uCamHi.value.x = h
    u.uCamLo.value.x = Math.fround(cx - h)
    h = Math.fround(cy)
    u.uCamHi.value.y = h
    u.uCamLo.value.y = Math.fround(cy - h)
    h = Math.fround(cz)
    u.uCamHi.value.z = h
    u.uCamLo.value.z = Math.fround(cz - h)
    u.uPointScale.value = PSF_PIXELS * gl.getPixelRatio()
    u.uLimitFlux.value = daySky.limitFlux
    const px = (camera.fov * Math.PI) / 180 / Math.max(1, gl.domElement.clientHeight)
    u.uPx.value = px

    // The Sun rides the ephemeris.
    const o = (n - 1) * 3
    const s = live.abs.sun
    let a = Math.fround(s.x)
    hiAttr.array[o] = a
    loAttr.array[o] = Math.fround(s.x - a)
    a = Math.fround(s.y)
    hiAttr.array[o + 1] = a
    loAttr.array[o + 1] = Math.fround(s.y - a)
    a = Math.fround(s.z)
    hiAttr.array[o + 2] = a
    loAttr.array[o + 2] = Math.fround(s.z - a)
    hiAttr.clearUpdateRanges()
    loAttr.clearUpdateRanges()
    hiAttr.addUpdateRange(o, 3)
    loAttr.addUpdateRange(o, 3)
    hiAttr.needsUpdate = true
    loAttr.needsUpdate = true

    // Resolved discs: at most POOL, nearest first — in practice the star you are at.
    let used = 0
    for (let i = 0; i < named && used < POOL; i++) {
      const st = stars[i]
      const dx = st.abs.x - cx
      const dy = st.abs.y - cy
      const dz = st.abs.z - cz
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz)
      const r = st.radius * SOLAR_RADIUS
      if (r / d < px * 0.8) continue
      const slot = pool[used++]
      if (slot.star !== st) {
        slot.star = st
        const T = temperatureOf(st)
        tuneStar(slot.surface, T, st.radius, massOf(st, T))
        let t = tuned.get(st.id)
        if (!t) {
          const c = [0, 0, 0]
          blackbodyRGB(c, T)
          t = c
          tuned.set(st.id, t)
        }
        slot.corona.uniforms.uColor.value.setRGB(t[0], t[1], t[2])
      }
      slot.group.visible = true
      slot.group.position.set(st.abs.x - live.origin.x, st.abs.y - live.origin.y, st.abs.z - live.origin.z)
      slot.group.scale.setScalar(r)
      slot.surface.uniforms.uTime.value = clock.elapsedTime % 1000
    }
    for (let i = used; i < POOL; i++) {
      pool[i].group.visible = false
      pool[i].star = null
    }
    VIEW.resolved = used
  }, -2)

  return (
    <>
      <points geometry={geometry} material={material} renderOrder={-998} frustumCulled={false} />
      {pool.map((p, i) => (
        <primitive key={i} object={p.group} />
      ))}
    </>
  )
}
