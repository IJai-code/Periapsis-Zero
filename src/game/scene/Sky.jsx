import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame, useLoader, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { decodeStars, equatorialToScene } from '../../gfx/stars.js'
import { tierOf } from '../core/quality.js'
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

  // How many noise octaves the air, the land and the cloud are drawn with,
  // and how deep into the star catalogue to go: one table, in core/quality.js,
  // read by both canvases, so the film and the game cannot disagree about
  // what Fast gives up.
  const cfg = tierOf(quality)
  const octaves = cfg.octaves
  const earthMat = useMemo(() => earthMaterial(day, night, spec, octaves), [day, night, spec, octaves])
  const cloudMat = useMemo(() => cloudMaterial(cloudTex, octaves), [cloudTex, octaves])
  const atmoMat = useMemo(() => atmosphereMaterial(), [])
  const moonMat = useMemo(() => new THREE.MeshStandardMaterial({ map: moonColor, normalMap: moonNormal, normalScale: new THREE.Vector2(1.4, 1.4), roughness: 0.96, metalness: 0 }), [moonColor, moonNormal])
  // One sphere, shared by the Earth, its clouds, its air and the Moon. On Fast
  // it is a third of the vertices for a silhouette nobody can see at these
  // distances: the limb of a 96-segment sphere is under a pixel wide from any
  // camera in the game.
  const sphere = useMemo(() => new THREE.SphereGeometry(1, cfg.segments[0], cfg.segments[1]), [cfg])

  const stars = useStars(cfg.stars)
  const milky = useMemo(() => milkyWay(), [])
  const sunTex = useMemo(() => glowTexture(), [])
  const streakTex = useMemo(() => streakTexture(), [])
  const streak = useRef()

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
    streak.current.position.copy(sun.current.position)
    earthMat.uniforms.uSun.value.copy(SUN_DIR)
    cloudMat.uniforms.uSun.value.copy(SUN_DIR)
    atmoMat.uniforms.uSun.value.copy(SUN_DIR)
  })

  return <group ref={group}>
    {stars && <points geometry={stars.geometry} material={stars.material} renderOrder={-20} frustumCulled={false} />}
    <mesh geometry={milky.geometry} material={milky.material} renderOrder={-30} frustumCulled={false} />
    <sprite ref={sun} scale={[SUN_R * 0.045, SUN_R * 0.045, 1]} renderOrder={-15}><spriteMaterial map={sunTex} color="#fff6e8" blending={THREE.AdditiveBlending} depthWrite={false} transparent toneMapped={false} /></sprite>
    {/* A lens streak across the Sun, as a camera sees it: always level on screen. */}
    <sprite ref={streak} scale={[SUN_R * 0.42, SUN_R * 0.011, 1]} renderOrder={-14}><spriteMaterial map={streakTex} color="#ffe2bf" opacity={0.55} blending={THREE.AdditiveBlending} depthWrite={false} transparent toneMapped={false} /></sprite>
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
 * The stars: Hipparcos, to magnitude 7.8 (high) or 6.5 (fast)
 * ------------------------------------------------------------------ */
function useStars(magnitude) {
  const [stars, setStars] = useState(null)
  useEffect(() => {
    let dead = false
    fetch(`${BASE}stars/hipparcos.bin`).then((r) => r.arrayBuffer()).then((buf) => {
      if (dead) return
      const s = decodeStars(buf, magnitude)
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
  }, [magnitude])
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
        // Emission nebulae along the plane, where the real ones are: hydrogen
        // red and oxygen teal in patches, faint, under the dust lanes.
        float hII = smoothstep(0.56, 0.86, fbm(vDir * 4.0 + 11.0)) * exp(-pow(lat / 0.2, 2.0));
        float oIII = smoothstep(0.6, 0.9, fbm(vDir * 5.5 + 29.0)) * exp(-pow(lat / 0.28, 2.0));
        vec3 neb = (vec3(1.0, 0.32, 0.3) * hII + vec3(0.22, 0.72, 0.92) * oIII * 0.75) * (0.6 + 0.8 * clouds) * (1.0 - 0.6 * dust);
        gl_FragColor = vec4(col * glow * 0.026 + neb * 0.015, 1.0);
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
/**
 * Detail below the imagery. The maps are 4096 (land) and 1024 (cloud) texels
 * round the equator, so from Harbor's 420 km one cloud texel spans a hundred
 * pixels: a soft haze. Value-noise octaves on the unit sphere add the
 * structure the maps cannot hold, and each octave fades out as it shrinks
 * below a pixel (by its screen footprint), so from far off nothing shimmers.
 */
const NOISE = `
  float hash3(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  float vnoise(vec3 x) {
    vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash3(i), hash3(i + vec3(1, 0, 0)), f.x), mix(hash3(i + vec3(0, 1, 0)), hash3(i + vec3(1, 1, 0)), f.x), f.y),
               mix(mix(hash3(i + vec3(0, 0, 1)), hash3(i + vec3(1, 0, 1)), f.x), mix(hash3(i + vec3(0, 1, 1)), hash3(i + vec3(1, 1, 1)), f.x), f.y), f.z);
  }
  // Octaves from frequency F0 up, each half the amplitude; 'foot' is the
  // pixel's size on the unit sphere. Returns about 0..1, centred on 0.5.
  float fbmAA(vec3 p, float F0, float foot) {
    float sum = 0.0, amp = 0.5, F = F0;
    for (int i = 0; i < OCTAVES; i++) {
      float keep = 1.0 - smoothstep(0.2, 0.5, foot * F);
      sum += amp * mix(0.5, vnoise(p * F + float(i) * 7.31), keep);
      amp *= 0.5; F *= 2.03;
    }
    return sum / (1.0 - pow(0.5, float(OCTAVES)));
  }`
function earthMaterial(day, night, spec, octaves) {
  return new THREE.ShaderMaterial({
    defines: { OCTAVES: octaves },
    uniforms: { uDay: { value: day }, uNight: { value: night }, uSpec: { value: spec }, uSun: { value: new THREE.Vector3() } },
    vertexShader: `varying vec3 vN; varying vec3 vW; varying vec2 vUv; varying vec3 vP; ${LOG_V}
      void main() { vUv = uv; vP = position; vN = normalize(mat3(modelMatrix) * normal); vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: `varying vec3 vN; varying vec3 vW; varying vec2 vUv; varying vec3 vP; uniform sampler2D uDay, uNight, uSpec; uniform vec3 uSun;
      #include <logdepthbuf_pars_fragment>
      ${NOISE}
      void main() {
        #include <logdepthbuf_fragment>
        vec3 N = normalize(vN), V = normalize(cameraPosition - vW);
        float ndl = dot(N, uSun);
        float lit = smoothstep(-0.08, 0.22, ndl);
        float ocean = texture2D(uSpec, vUv).r;
        float foot = length(fwidth(vP));
        // Land: terrain-scale light and dark from 50 km down to a few km.
        float n = fbmAA(vP, 200.0, foot);
        vec3 albedo = texture2D(uDay, vUv).rgb;
        albedo *= mix(1.0, 0.7 + 0.6 * n, (1.0 - ocean) * 0.85);
        // The sea: a faint swell of colour so it is not one flat blue.
        albedo *= mix(1.0, 0.9 + 0.2 * n, ocean);
        // Daylight scattered back up by the air: the sea seen from orbit is lighter than its albedo.
        vec3 dayc = albedo * (0.01 + 0.62 * max(ndl, 0.0)) + vec3(0.025, 0.055, 0.11) * max(ndl, 0.0);
        vec3 nightc = texture2D(uNight, vUv).rgb * vec3(1.0, 0.82, 0.55) * (1.0 - lit) * 1.4 * (0.6 + 0.8 * n);
        vec3 H = normalize(uSun + V);
        float glint = pow(max(dot(N, H), 0.0), 320.0) * ocean * lit * 0.35;
        float fres = pow(1.0 - max(dot(N, V), 0.0), 2.5);
        vec3 air = mix(vec3(0.25, 0.5, 1.0), vec3(1.0, 0.55, 0.3), smoothstep(0.35, -0.05, ndl)) * fres * smoothstep(-0.25, 0.3, ndl) * 0.45;
        gl_FragColor = vec4(dayc + nightc + glint * vec3(1.0, 0.95, 0.85) + air, 1.0);
      }`,
  })
}
function cloudMaterial(tex, octaves) {
  return new THREE.ShaderMaterial({
    defines: { OCTAVES: octaves },
    uniforms: { uClouds: { value: tex }, uSun: { value: new THREE.Vector3() } },
    vertexShader: `varying vec3 vN; varying vec2 vUv; varying vec3 vP; ${LOG_V}
      void main() { vUv = uv; vP = position; vN = normalize(mat3(modelMatrix) * normal); gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: `varying vec3 vN; varying vec2 vUv; varying vec3 vP; uniform sampler2D uClouds; uniform vec3 uSun;
      #include <logdepthbuf_pars_fragment>
      ${NOISE}
      void main() {
        #include <logdepthbuf_fragment>
        float foot = length(fwidth(vP));
        float near = 1.0 - smoothstep(0.0015, 0.012, foot);
        // Up close the map's texels (39 km each) would show as round blobs.
        // A warp noise bends where the map is read, and a finer noise
        // decides where each cloud's edge falls: streets, swirls, ragged edges.
        float w1 = fbmAA(vP, 70.0, foot), w2 = fbmAA(vP.yzx, 70.0, foot);
        float n = fbmAA(vP + vec3(w1 - 0.5, w2 - 0.5, w1 - w2) * 0.02, 300.0, foot);
        vec2 uv = vUv + vec2(w1 - 0.5, w2 - 0.5) * vec2(0.006, 0.008) * near;
        // Cover is the map's alpha (its colour is white wherever it is clear).
        float c0 = smoothstep(0.004, 0.42, texture2D(uClouds, uv).a);
        // The old low-resolution mask alone formed continent-shaped white
        // cutouts. Synthetic weather structure supplies soft, broken cover;
        // the source mask contributes only a small broad-scale bias.
        float weather = fbmAA(vP + vec3(w1 - 0.5, w2 - 0.5, 0.0) * 0.16, 9.0, foot);
        float c = smoothstep(0.50, 0.74, weather + (n - 0.5) * 0.16 + c0 * 0.03);
        float ndl = dot(normalize(vN), uSun);
        float lit = smoothstep(-0.1, 0.3, ndl);
        vec3 col = vec3(0.02 + 0.72 * max(ndl, 0.0)) * mix(vec3(1.0, 0.7, 0.5), vec3(1.0), smoothstep(0.0, 0.25, ndl)) * mix(1.0, 0.72 + 0.4 * n, near);
        gl_FragColor = vec4(col, c * (0.25 + 0.75 * lit) * 0.92);
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

function streakTexture() {
  const c = document.createElement('canvas')
  c.width = 256; c.height = 16
  const x = c.getContext('2d')
  const h = x.createLinearGradient(0, 0, 256, 0)
  h.addColorStop(0, 'rgba(255,220,180,0)'); h.addColorStop(0.5, 'rgba(255,245,230,1)'); h.addColorStop(1, 'rgba(255,220,180,0)')
  x.fillStyle = h; x.fillRect(0, 0, 256, 16)
  x.globalCompositeOperation = 'destination-in'
  const v = x.createLinearGradient(0, 0, 0, 16)
  v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(0.5, 'rgba(0,0,0,1)'); v.addColorStop(1, 'rgba(0,0,0,0)')
  x.fillStyle = v; x.fillRect(0, 0, 256, 16)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
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

