import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame, useLoader, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { decodeStars, equatorialToScene } from '../../gfx/stars.js'
import { BODIES, EARTH, SUN_DIR } from '../core/world.js'

/**
 * Everything that is not near you: the stars, the Milky Way, the Sun, the
 * Earth and the Moon.
 *
 * Bodies hundreds of thousands of kilometres away cannot be drawn at their
 * real distance, and do not need to be: what the eye sees is a direction and
 * an angular size. Each frame every body is placed along its true direction
 * from the camera, at a stand-in distance, scaled so it subtends exactly the
 * angle it really does. The stand-in distances are chosen nearest-first so
 * that no body can poke in front of a nearer one, and the nearest surface is
 * always beyond anything in local flight. The depth buffer is logarithmic,
 * so all of it, from a cockpit to the Moon, sorts in one pass.
 */
const BASE = import.meta.env.BASE_URL
const STAR_R = 3.0e6, MILKY_R = 3.4e6, SUN_R = 3.2e6

export function Sky({ game, quality }) {
  const { camera } = useThree()
  const group = useRef()
  const earth = useRef(), atmo = useRef(), clouds = useRef(), moon = useRef(), sun = useRef()
  const [day, night, spec, cloudTex, moonColor, moonNormal] = useLoader(THREE.TextureLoader, [
    `${BASE}game/earth-day.webp`, `${BASE}game/earth-night.webp`, `${BASE}game/earth-spec.webp`, `${BASE}game/earth-clouds.webp`, `${BASE}game/moon-color.webp`, `${BASE}game/moon-normal.webp`,
  ])
  useMemo(() => { for (const t of [day, night, cloudTex, moonColor]) t.colorSpace = THREE.SRGBColorSpace; for (const t of [day, night, cloudTex, moonColor, moonNormal, spec]) t.anisotropy = 4 }, [day, night, cloudTex, moonColor, moonNormal, spec])

  const earthMat = useMemo(() => earthMaterial(day, night, spec), [day, night, spec])
  const cloudMat = useMemo(() => cloudMaterial(cloudTex), [cloudTex])
  const atmoMat = useMemo(() => atmosphereMaterial(), [])
  const moonMat = useMemo(() => new THREE.MeshStandardMaterial({ map: moonColor, normalMap: moonNormal, normalScale: new THREE.Vector2(1.4, 1.4), roughness: 0.96, metalness: 0 }), [moonColor, moonNormal])
  const sphere = useMemo(() => new THREE.SphereGeometry(1, 128, 96), [])

  const stars = useStars(quality)
  const milky = useMemo(() => milkyWay(), [])
  const sunTex = useMemo(() => glowTexture(), [])

  const tmp = useMemo(() => ({ cam: new THREE.Vector3(), rel: new THREE.Vector3(), list: BODIES.map((b) => ({ b, D: 0, dir: new THREE.Vector3() })) }), [])

  useFrame(() => {
    const g = game.current
    if (!g || !group.current) return
    // The camera's place in the world: the place's anchor plus where it is locally.
    tmp.cam.copy(g.anchor).add(camera.position)
    group.current.position.copy(camera.position)
    for (const it of tmp.list) {
      it.dir.copy(it.b.position).sub(tmp.cam)
      it.D = it.dir.length()
      it.dir.divideScalar(it.D)
    }
    tmp.list.sort((a, b) => a.D - b.D)
    let prevFar = 0
    for (const it of tmp.list) {
      const k = it.b.radius / it.D
      const S = Math.max(60e3 / Math.max(1e-3, 1 - k), prevFar * 1.05 / Math.max(1e-3, 1 - k))
      const R = it.b.radius * S / it.D
      prevFar = S + R
      const mesh = it.b === EARTH ? earth.current : moon.current
      mesh.position.copy(it.dir).multiplyScalar(S)
      mesh.scale.setScalar(R)
      if (it.b === EARTH) {
        clouds.current.position.copy(mesh.position); clouds.current.scale.setScalar(R * 1.006)
        atmo.current.position.copy(mesh.position); atmo.current.scale.setScalar(R * 1.012)
        // Earth turns once a sidereal day, on the game clock.
        mesh.rotation.y = (g.time / 86164) * Math.PI * 2 + 1.2
        clouds.current.rotation.y = mesh.rotation.y * 1.04
      }
    }
    sun.current.position.copy(SUN_DIR).multiplyScalar(SUN_R)
    earthMat.uniforms.uSun.value.copy(SUN_DIR)
    cloudMat.uniforms.uSun.value.copy(SUN_DIR)
    atmoMat.uniforms.uSun.value.copy(SUN_DIR)
  })

  return <group ref={group}>
    {stars && <points geometry={stars.geometry} material={stars.material} renderOrder={-20} frustumCulled={false} />}
    <mesh geometry={milky.geometry} material={milky.material} renderOrder={-30} frustumCulled={false} />
    <sprite ref={sun} scale={[SUN_R * 0.045, SUN_R * 0.045, 1]} renderOrder={-15}><spriteMaterial map={sunTex} color="#fff6e8" blending={THREE.AdditiveBlending} depthWrite={false} transparent toneMapped={false} /></sprite>
    <mesh ref={earth} geometry={sphere} material={earthMat} frustumCulled={false} />
    <mesh ref={clouds} geometry={sphere} material={cloudMat} frustumCulled={false} />
    <mesh ref={atmo} geometry={sphere} material={atmoMat} frustumCulled={false} />
    {/* Turned about the Earth-Moon line: the near side still faces Earth, and the
        texture's pinched poles move to the limbs, out of the way of a view straight
        down at the south pole from Shackleton. */}
    <mesh ref={moon} geometry={sphere} material={moonMat} frustumCulled={false} rotation={[Math.PI / 2, Math.PI, 0]} />
  </group>
}

/* ------------------------------------------------------------------ *
 * The stars: Hipparcos, to magnitude 7.5 (high) or 6.5 (low)
 * ------------------------------------------------------------------ */
function useStars(quality) {
  const [stars, setStars] = useState(null)
  useEffect(() => {
    let dead = false
    fetch(`${BASE}stars/hipparcos.bin`).then((r) => r.arrayBuffer()).then((buf) => {
      if (dead) return
      const s = decodeStars(buf, quality === 'low' ? 6.5 : 7.8)
      const geo = new THREE.BufferGeometry()
      const pos = new Float32Array(s.count * 3)
      const size = new Float32Array(s.count)
      for (let i = 0; i < s.count; i++) {
        pos[i * 3] = s.position[i * 3] * STAR_R; pos[i * 3 + 1] = s.position[i * 3 + 1] * STAR_R; pos[i * 3 + 2] = s.position[i * 3 + 2] * STAR_R
        size[i] = Math.pow(s.flux[i], 0.42)
      }
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
      geo.setAttribute('color', new THREE.BufferAttribute(s.colour, 3))
      geo.setAttribute('size', new THREE.BufferAttribute(size, 1))
      setStars({ geometry: geo, material: starMaterial() })
    }).catch(() => {})
    return () => { dead = true }
  }, [quality])
  return stars
}

function starMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uScale: { value: Math.min(2, window.devicePixelRatio || 1) } },
    vertexShader: `
      attribute float size; attribute vec3 color; varying vec3 vColor; varying float vI; uniform float uScale;
      #include <common>
      #include <logdepthbuf_pars_vertex>
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        float s = clamp(size * 3.4, 0.0, 6.0);
        gl_PointSize = max(1.0, s) * uScale;
        vI = min(1.0, size * 3.0) * min(1.0, s);
        vColor = color;
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: `
      varying vec3 vColor; varying float vI;
      #include <logdepthbuf_pars_fragment>
      void main() {
        #include <logdepthbuf_fragment>
        vec2 d = gl_PointCoord - 0.5; float r = length(d);
        float a = smoothstep(0.5, 0.0, r);
        gl_FragColor = vec4(vColor * vI * a * 1.6, 1.0);
      }`,
    blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false,
  })
}

/* ------------------------------------------------------------------ *
 * The Milky Way: unresolved starlight along the real galactic plane
 * ------------------------------------------------------------------ */
function milkyWay() {
  // Galactic north pole and centre, equatorial (J2000), into the scene frame.
  const unit = (ra, dec) => { const a = ra * Math.PI / 180, d = dec * Math.PI / 180; return [Math.cos(d) * Math.cos(a), Math.cos(d) * Math.sin(a), Math.sin(d)] }
  const pole = [0, 0, 0], centre = [0, 0, 0]
  equatorialToScene(pole, ...unit(192.859, 27.128))
  equatorialToScene(centre, ...unit(266.405, -28.936))
  const material = new THREE.ShaderMaterial({
    uniforms: { uPole: { value: new THREE.Vector3(...pole).normalize() }, uCentre: { value: new THREE.Vector3(...centre).normalize() } },
    vertexShader: `varying vec3 vDir;
      #include <common>
      #include <logdepthbuf_pars_vertex>
      void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      #include <logdepthbuf_vertex>
      }`,
    fragmentShader: `varying vec3 vDir; uniform vec3 uPole, uCentre;
      #include <logdepthbuf_pars_fragment>
      float h(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 45.164))) * 43758.5453); }
      float n3(vec3 p) { vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(mix(h(i), h(i + vec3(1,0,0)), f.x), mix(h(i + vec3(0,1,0)), h(i + vec3(1,1,0)), f.x), f.y),
                   mix(mix(h(i + vec3(0,0,1)), h(i + vec3(1,0,1)), f.x), mix(h(i + vec3(0,1,1)), h(i + vec3(1,1,1)), f.x), f.y), f.z); }
      float fbm(vec3 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 6; i++) { s += a * n3(p); p *= 2.07; a *= 0.5; } return s; }
      void main() {
        #include <logdepthbuf_fragment>
        float lat = dot(vDir, uPole);
        float core = dot(vDir, uCentre) * 0.5 + 0.5;
        float band = exp(-pow(lat / (0.11 + 0.08 * core), 2.0));
        float clouds = fbm(vDir * 7.0);
        float dust = smoothstep(0.45, 0.75, fbm(vDir * 14.0 + 3.0)) * exp(-pow(lat / 0.035, 2.0));
        float glow = band * (0.35 + 0.9 * clouds) * (0.35 + 1.2 * pow(core, 3.0)) * (1.0 - 0.75 * dust);
        vec3 col = mix(vec3(0.5, 0.58, 0.9), vec3(0.95, 0.82, 0.7), pow(core, 3.0));
        gl_FragColor = vec4(col * glow * 0.022, 1.0);
      }`,
    side: THREE.BackSide, depthWrite: false, blending: THREE.AdditiveBlending, transparent: true, toneMapped: false,
  })
  return { geometry: new THREE.SphereGeometry(MILKY_R, 64, 32), material }
}

/* ------------------------------------------------------------------ *
 * Earth: day, night lights, ocean glint, clouds, air
 * ------------------------------------------------------------------ */
const LOG_V = `
  #include <common>
  #include <logdepthbuf_pars_vertex>`
function earthMaterial(day, night, spec) {
  return new THREE.ShaderMaterial({
    uniforms: { uDay: { value: day }, uNight: { value: night }, uSpec: { value: spec }, uSun: { value: new THREE.Vector3() } },
    vertexShader: `varying vec3 vN; varying vec3 vW; varying vec2 vUv; ${LOG_V}
      void main() { vUv = uv; vN = normalize(mat3(modelMatrix) * normal); vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: `varying vec3 vN; varying vec3 vW; varying vec2 vUv; uniform sampler2D uDay, uNight, uSpec; uniform vec3 uSun;
      #include <logdepthbuf_pars_fragment>
      void main() {
        #include <logdepthbuf_fragment>
        vec3 N = normalize(vN), V = normalize(cameraPosition - vW);
        float ndl = dot(N, uSun);
        float lit = smoothstep(-0.08, 0.22, ndl);
        vec3 dayc = texture2D(uDay, vUv).rgb * (0.01 + 0.62 * max(ndl, 0.0));
        vec3 nightc = texture2D(uNight, vUv).rgb * vec3(1.0, 0.82, 0.55) * (1.0 - lit) * 1.4;
        float ocean = texture2D(uSpec, vUv).r;
        vec3 H = normalize(uSun + V);
        float glint = pow(max(dot(N, H), 0.0), 120.0) * ocean * lit * 0.9;
        float fres = pow(1.0 - max(dot(N, V), 0.0), 2.5);
        vec3 air = mix(vec3(0.25, 0.5, 1.0), vec3(1.0, 0.55, 0.3), smoothstep(0.35, -0.05, ndl)) * fres * smoothstep(-0.25, 0.3, ndl) * 0.45;
        gl_FragColor = vec4(dayc + nightc + glint * vec3(1.0, 0.95, 0.85) + air, 1.0);
      }`,
  })
}
function cloudMaterial(tex) {
  return new THREE.ShaderMaterial({
    uniforms: { uClouds: { value: tex }, uSun: { value: new THREE.Vector3() } },
    vertexShader: `varying vec3 vN; varying vec2 vUv; ${LOG_V}
      void main() { vUv = uv; vN = normalize(mat3(modelMatrix) * normal); gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: `varying vec3 vN; varying vec2 vUv; uniform sampler2D uClouds; uniform vec3 uSun;
      #include <logdepthbuf_pars_fragment>
      void main() {
        #include <logdepthbuf_fragment>
        float c = texture2D(uClouds, vUv).r;
        float ndl = dot(normalize(vN), uSun);
        float lit = smoothstep(-0.1, 0.3, ndl);
        gl_FragColor = vec4(vec3(0.02 + 0.68 * max(ndl, 0.0)) * mix(vec3(1.0, 0.7, 0.5), vec3(1.0), smoothstep(0.0, 0.25, ndl)), c * (0.25 + 0.75 * lit) * 0.6);
      }`,
    transparent: true, depthWrite: false,
  })
}
function atmosphereMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uSun: { value: new THREE.Vector3() } },
    vertexShader: `varying vec3 vN; varying vec3 vW; ${LOG_V}
      void main() { vN = normalize(mat3(modelMatrix) * normal); vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w;
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: `varying vec3 vN; varying vec3 vW; uniform vec3 uSun;
      #include <logdepthbuf_pars_fragment>
      void main() {
        #include <logdepthbuf_fragment>
        vec3 N = normalize(vN), V = normalize(cameraPosition - vW);
        float rim = pow(1.0 - abs(dot(N, V)), 5.0);
        float ndl = dot(N, uSun);
        vec3 col = mix(vec3(0.3, 0.6, 1.0), vec3(1.0, 0.5, 0.25), smoothstep(0.3, -0.1, ndl));
        gl_FragColor = vec4(col * rim * smoothstep(-0.3, 0.25, ndl) * 0.9, 1.0);
      }`,
    blending: THREE.AdditiveBlending, transparent: true, depthWrite: false,
  })
}

function glowTexture() {
  const c = document.createElement('canvas')
  c.width = c.height = 256
  const x = c.getContext('2d')
  const r = x.createRadialGradient(128, 128, 0, 128, 128, 128)
  r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.06, 'rgba(255,250,235,1)'); r.addColorStop(0.12, 'rgba(255,225,180,0.45)')
  r.addColorStop(0.35, 'rgba(255,190,120,0.08)'); r.addColorStop(1, 'rgba(255,170,100,0)')
  x.fillStyle = r; x.fillRect(0, 0, 256, 256)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

