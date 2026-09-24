import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { live } from '../sim/live.js'
import { BODIES } from '../sim/constants.js'
import { activeSite, isLunar } from '../sim/launchsite.js'
import { mission } from '../sim/mission.js'
import { lunar, writeBasis } from '../sim/lunarMission.js'
import { moonAxes, moonClock } from '../sim/moonFrame.js'
import { buildSiteTerrain, forgetGround, groundProbe, loadSiteTerrain, lunarGround, probeGround } from '../gfx/moonTerrain.js'
import { lunarPhotometry } from '../gfx/lunarPhotometry.js'
import { groundGlare } from '../gfx/skyGlow.js'
import { useActiveTextures } from '../gfx/hdTextures.js'
import { getModel, loadModel, makePart, useModel } from '../gfx/models.js'
import { makeNoise, mulberry32 } from '../gfx/noise.js'

/**
 * The ground at a lunar site: Tranquility Base as LRO measured it, and what
 * Apollo 11 left on it.
 *
 * The heights are real — see gfx/moonTerrain.js for the three levels and how
 * they are stitched. What is drawn on them at human scale, below the 2 m the
 * NAC model resolves, is not data, and is kept to what the site is known to
 * carry: the descent stage Eagle lifted off from, the flag the ascent engine
 * blew over, a scatter of rocks, and the two marks LROC sees round every Apollo
 * site — a bright halo where the descent engine swept the dust, and darker
 * ground where the crew walked.
 *
 * Everything is placed in the site's own frame, x east, y up, z south, which
 * turns with the Moon; the group that carries it is re-placed each frame from
 * the Moon's rotation, the same one the clamp holds the LM with.
 */

const R = BODIES.moon.radius
/** Nearer than this, the ground is drawn and the globe is cut away for it, m. */
const VISIBLE_RANGE = 2.0e6
/** How far round the site the rocks lie, m. */
const ROCK_FIELD = 260
/** Solar illuminance at 1 AU, lux — as skyGlow.js. */
const SOLAR_LUX = 133.8e3
/** Normal albedo of Tranquility's mare regolith. */
const MARE_ALBEDO = 0.1

export function LunarSurface({ textures }) {
  const site = mission.site ?? activeSite()
  if (!isLunar(site)) return null
  return <LunarGround site={site} textures={textures} />
}

/* ---------------------------------------------------------------- *
 * The site frame, placed each frame
 * ---------------------------------------------------------------- */

const _ax = new Float64Array(9)
const _e = new THREE.Vector3()
const _u = new THREE.Vector3()
const _s = new THREE.Vector3()
const _m = new THREE.Matrix4()
const _toSun = new THREE.Vector3()
const _toCam = new THREE.Vector3()

/**
 * Put `group` on the site: the Moon's body axes at this instant, and the site's
 * east, up and south in them. The same rotation the clamp holds the LM with, so
 * the ground and the vehicle cannot drift apart. Allocation-free.
 */
function placeOnSite(group, A) {
  moonClock[0] = live.sim.t
  moonAxes(_ax)
  _e.set(A[0] * _ax[0] + A[1] * _ax[3] + A[2] * _ax[6], A[0] * _ax[1] + A[1] * _ax[4] + A[2] * _ax[7], A[0] * _ax[2] + A[1] * _ax[5] + A[2] * _ax[8])
  _u.set(A[3] * _ax[0] + A[4] * _ax[3] + A[5] * _ax[6], A[3] * _ax[1] + A[4] * _ax[4] + A[5] * _ax[7], A[3] * _ax[2] + A[4] * _ax[5] + A[5] * _ax[8])
  _s.set(A[6] * _ax[0] + A[7] * _ax[3] + A[8] * _ax[6], A[6] * _ax[1] + A[7] * _ax[4] + A[8] * _ax[7], A[6] * _ax[2] + A[7] * _ax[5] + A[8] * _ax[8])
  group.position.copy(live.pos.moon).addScaledVector(_u, R)
  group.quaternion.setFromRotationMatrix(writeBasis(_m, _e, _u, _s))
}

/* ---------------------------------------------------------------- *
 * The ground's material
 * ---------------------------------------------------------------- */

/**
 * Regolith below the data's 2 m: a tiling of small relief and albedo, faded out
 * with distance before it can shimmer. Red and blue carry the slope east and
 * south, alpha the albedo.
 *
 * Value noise on a lattice that wraps, so the tile has no seam and no
 * direction — the first version built its period from circles through 3D noise
 * and came out combed, like wind-blown sand, which is the one thing the Moon
 * has none of. On top of it, what the surface at a metre is actually made of:
 * small craters, rimmed, and clods of soil.
 */
function periodicNoise(rand, N, period) {
  const lattice = new Float32Array(period * period)
  for (let i = 0; i < lattice.length; i++) lattice[i] = rand() * 2 - 1
  const out = new Float32Array(N * N)
  for (let y = 0; y < N; y++) {
    const fy = (y / N) * period
    const y0 = Math.floor(fy)
    const ty = fy - y0
    const sy = ty * ty * (3 - 2 * ty)
    const y1 = (y0 + 1) % period
    for (let x = 0; x < N; x++) {
      const fx = (x / N) * period
      const x0 = Math.floor(fx)
      const tx = fx - x0
      const sx = tx * tx * (3 - 2 * tx)
      const x1 = (x0 + 1) % period
      const a = lattice[y0 * period + x0] + (lattice[y0 * period + x1] - lattice[y0 * period + x0]) * sx
      const b = lattice[y1 * period + x0] + (lattice[y1 * period + x1] - lattice[y1 * period + x0]) * sx
      out[y * N + x] = a + (b - a) * sy
    }
  }
  return out
}

function regolithTexture() {
  const N = 512
  const rand = mulberry32(0x7a11)
  const h = new Float32Array(N * N)
  const a = new Float32Array(N * N)
  // Heights in tile units: a tile's relief is a few thousandths of its width.
  for (let o = 0, amp = 0.004, period = 8; o < 6; o++, amp *= 0.55, period *= 2) {
    const n = periodicNoise(rand, N, period)
    for (let i = 0; i < N * N; i++) h[i] += n[i] * amp
  }
  for (let o = 0, amp = 0.5, period = 6; o < 4; o++, amp *= 0.5, period *= 2) {
    const n = periodicNoise(rand, N, period)
    for (let i = 0; i < N * N; i++) a[i] += n[i] * amp
  }
  const stamp = (cx, cy, r, fn) => {
    const reach = Math.ceil(r * 1.8)
    for (let dy = -reach; dy <= reach; dy++) {
      for (let dx = -reach; dx <= reach; dx++) {
        const t = Math.hypot(dx, dy) / r
        if (t > 1.8) continue
        const x = (((Math.round(cx) + dx) % N) + N) % N
        const y = (((Math.round(cy) + dy) % N) + N) % N
        fn(y * N + x, t)
      }
    }
  }
  // Craters, sized as the Moon's are: the cumulative count larger than a
  // diameter falls as its inverse square, the equilibrium a surface reaches
  // once new craters erase old ones as fast as they form — so most are tiny
  // and a few are large. Most are old and softened, a bowl a tenth as deep as
  // it is wide; a few are fresh, a fifth, with brighter floors. (Depth over
  // *radius* below, so twice those.)
  for (let k = 0; k < 520; k++) {
    const r = Math.min(70, 1.4 / Math.sqrt(1 - rand()))
    const fresh = rand() < 0.15
    const depth = (r / N) * (fresh ? 0.4 : 0.16 + 0.08 * rand())
    const bright = fresh ? 0.1 : 0
    stamp(rand() * N, rand() * N, r, (i, t) => {
      if (t < 1) {
        h[i] += -depth * (1 - t * t) + depth * 0.3 * Math.exp(-(((t - 0.92) / 0.12) ** 2))
        a[i] += bright * (1 - t)
      } else h[i] += depth * 0.15 * Math.exp(-(t - 1) * 4)
    })
  }
  // Clods: small, low lumps of soil.
  for (let k = 0; k < 500; k++) {
    const r = 1 + Math.pow(rand(), 3) * 3
    const lift = (r / N) * (0.12 + rand() * 0.18)
    stamp(rand() * N, rand() * N, r, (i, t) => {
      if (t < 1) h[i] += lift * (1 - t * t)
    })
  }
  const data = new Uint8Array(N * N * 4)
  const k = N * 0.5 // central difference in tile units
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const gx = (h[y * N + ((x + 1) % N)] - h[y * N + ((x + N - 1) % N)]) * k
      const gz = (h[((y + 1) % N) * N + x] - h[((y + N - 1) % N) * N + x]) * k
      const o = (y * N + x) * 4
      data[o] = Math.max(0, Math.min(255, Math.round((0.5 + 0.5 * gx) * 255)))
      data[o + 1] = 128
      data[o + 2] = Math.max(0, Math.min(255, Math.round((0.5 + 0.5 * gz) * 255)))
      data[o + 3] = Math.max(0, Math.min(255, Math.round((0.5 + 0.35 * a[y * N + x]) * 255)))
    }
  }
  const tex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat)
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.magFilter = THREE.LinearFilter
  tex.minFilter = THREE.LinearMipmapLinearFilter
  tex.generateMipmaps = true
  tex.anisotropy = 8
  tex.colorSpace = THREE.NoColorSpace
  tex.needsUpdate = true
  return tex
}

/*
 * The detail, as GLSL. `vSite` is the fragment's position in the site frame
 * (the ground's object space), so the tiling is fixed to the ground.
 *
 * Every level carries it, each at its own two scales — the regolith tile at
 * 9.1 m and 1.37 m on the NAC level, 160 m and 24 m on the 30 m level, 700 m
 * and 110 m on the 118 m one — so there are craters below every level's
 * resolution, as there are on the Moon at every scale. The larger of each pair
 * keeps its features under a few samples of the data, so it adds to what was
 * measured rather than inventing what was not; each layer fades out with
 * distance before its texels shrink under a pixel. None of it is data.
 *
 * Near the LM, two things that are — in kind, not in detail: LROC's images
 * show every Apollo site ringed by ground a few per cent brighter out to
 * 75-175 m, where the descent engine scoured the finest, most weathered dust
 * away (Clegg-Watkins et al. 2016), and darker ground where the crew walked
 * and turned up less mature soil. Both albedo only.
 */
const DETAIL_ALBEDO = /* glsl */ `
	float lgD = length( vViewPosition );
	float lgWc = 1.0 - smoothstep( 0.5 * uFade.x, uFade.x, lgD );
	float lgWf = 1.0 - smoothstep( 0.5 * uFade.y, uFade.y, lgD );
	// A slow variation over seven tiles, so the repeat does not read as one.
	float lgPatch = smoothstep( 0.25, 0.75, texture2D( uRegolith, vSite.xz / ( 7.3 * uTile.x ) + vec2( 0.53, 0.19 ) ).a );
	lgWc *= 0.35 + 0.65 * lgPatch;
	lgWf *= 0.55 + 0.45 * ( 1.0 - lgPatch );
	vec4 lgA = texture2D( uRegolith, vSite.xz / uTile.x );
	vec4 lgB = texture2D( uRegolith, vSite.xz / uTile.y + vec2( 0.31, 0.77 ) );
	float lgAlbedo = mix( 1.0, 0.72 + 0.56 * lgA.a, lgWc ) * mix( 1.0, 0.86 + 0.28 * lgB.a, lgWf );
	#ifdef LUNAR_SITE_MARKS
		float lgR = length( vSite.xz );
		lgAlbedo *= 1.0 + 0.07 * smoothstep( 7.0, 22.0, lgR ) * ( 1.0 - smoothstep( 60.0, 170.0, lgR ) );
		lgAlbedo *= 1.0 - 0.14 * ( 1.0 - smoothstep( 9.0, 17.0, lgR + 7.0 * ( lgA.a - 0.5 ) ) );
	#endif
	diffuseColor.rgb *= lgAlbedo;`

const DETAIL_NORMAL = /* glsl */ `
	{
		vec2 lgS = ( texture2D( uRegolith, vSite.xz / uTile.x ).rb * 2.0 - 1.0 ) * lgWc
			+ ( texture2D( uRegolith, vSite.xz / uTile.y + vec2( 0.31, 0.77 ) ).rb * 2.0 - 1.0 ) * 0.6 * lgWf;
		normal = normalize( normal + normalMatrix * vec3( -lgS.x, 0.0, -lgS.y ) );
	}`

/**
 * Each level's two detail scales, m. The coarse layer is faded out at 80 tiles'
 * distance — its largest craters, about a quarter of a tile across, still a
 * few pixels there, and everything smaller filtered away by the mipmaps rather
 * than shimmering — and the fine layer at 20.
 */
const DETAIL_TILES = {
  near: [9.1, 1.37],
  mid: [160, 24],
  far: [700, 110],
}

/*
 * Colour, near to. The Moon's map is LROC's colour mosaic, which is stretched
 * to show composition — Tranquility's titanium-rich basalt comes out blue — and
 * the globe wants that. Standing on it, the soil is the grey-brown every Apollo
 * crew photographed, so within a few kilometres of the eye the ground is drawn
 * toward that, by distance, the same on every level so no seam can show.
 */
const NEAR_COLOUR = /* glsl */ `
	{
		float lgNear = 1.0 - smoothstep( 600.0, 6000.0, length( vViewPosition ) );
		float lgGrey = dot( diffuseColor.rgb, vec3( 0.3, 0.55, 0.15 ) );
		diffuseColor.rgb = mix( diffuseColor.rgb, lgGrey * vec3( 1.07, 1.0, 0.9 ), 0.75 * lgNear );
	}`

function patchGround(material, texture, id) {
  const tile = DETAIL_TILES[id]
  material.defines = { ...(material.defines ?? {}), ...(id === 'near' ? { LUNAR_SITE_MARKS: '' } : {}) }
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uRegolith = { value: texture }
    shader.uniforms.uTile = { value: new THREE.Vector2(tile[0], tile[1]) }
    shader.uniforms.uFade = { value: new THREE.Vector2(80 * tile[0], 20 * tile[1]) }
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vSite;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSite = position;')
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform sampler2D uRegolith;\nuniform vec2 uTile;\nuniform vec2 uFade;\nvarying vec3 vSite;',
      )
      .replace('#include <map_fragment>', `#include <map_fragment>\n${NEAR_COLOUR}\n${DETAIL_ALBEDO}`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\n${DETAIL_NORMAL}`)
  }
  material.customProgramCacheKey = () => `lunar-ground-${id}`
}

function groundMaterial(level, map, regolith) {
  const m = new THREE.MeshStandardMaterial({
    map,
    normalMap: level.normalMap,
    normalMapType: THREE.ObjectSpaceNormalMap,
    roughness: 1,
    metalness: 0,
  })
  patchGround(m, regolith, level.id)
  return lunarPhotometry(m)
}

/* ---------------------------------------------------------------- *
 * The ground
 * ---------------------------------------------------------------- */

function LunarGround({ site, textures }) {
  const [terrain, setTerrain] = useState(null)
  const group = useRef()
  const active = useActiveTextures(textures)
  const moonMap = active['moon.color']

  useEffect(() => {
    let alive = true
    loadSiteTerrain(site.id)
      .then((loaded) => {
        if (!alive || !loaded) return
        const built = buildSiteTerrain(loaded, site)
        const b = built.bounds
        lunarGround.bounds.set(0.5 + b.west / 360, 0.5 + b.east / 360, 0.5 + b.south / 180, 0.5 + b.north / 180)
        lunarGround.heightAt = built.heightAt
        setTerrain(built)
      })
      .catch((err) => console.error('[periapsis] lunar terrain failed to load', err))
    return () => {
      alive = false
      forgetGround()
      lunarGround.heightAt = null
      lunarGround.hole.value = 0
      groundGlare[0] = 0
    }
  }, [site])

  const regolith = useMemo(() => regolithTexture(), [])
  const materials = useMemo(
    () => (terrain ? terrain.levels.map((l) => groundMaterial(l, moonMap, regolith)) : null),
    [terrain, moonMap, regolith],
  )
  useEffect(() => () => materials?.forEach((m) => m.dispose()), [materials])
  useEffect(
    () => () => {
      for (const l of terrain?.levels ?? []) {
        l.geometry.dispose()
        l.normalMap.dispose()
      }
    },
    [terrain],
  )

  useFrame(({ camera }) => {
    const g = group.current
    if (!g || !terrain) return
    placeOnSite(g, terrain.axes)
    const on = camera.position.distanceToSquared(g.position) < VISIBLE_RANGE * VISIBLE_RANGE
    g.visible = on
    lunarGround.hole.value = on ? 1 : 0

    /*
     * What the eye is adapted to: the lit ground under the camera, while the
     * camera is close enough for it to fill half the view. Lommel–Seeliger at
     * the eye's grazing view is about twice the sun's sine, times the albedo
     * over π — 1,600 cd/m² at Eagle's liftoff sun. See skyGlow.js.
     */
    _toCam.copy(camera.position).sub(live.pos.moon)
    const altitude = _toCam.length() - R
    _toCam.normalize()
    _toSun.copy(live.pos.sun).sub(live.pos.moon).normalize()
    const mu0 = _toCam.dot(_toSun)
    const near = altitude < 150e3 ? 1 : altitude > 2e6 ? 0 : 1 - (altitude - 150e3) / (2e6 - 150e3)
    groundGlare[0] = mu0 > 0 ? (near * SOLAR_LUX * MARE_ALBEDO * Math.min(1, 2 * mu0)) / Math.PI : 0
  }, -2)

  return (
    <group ref={group} visible={false}>
      {terrain &&
        terrain.levels.map((l, k) => (
          <mesh key={l.id} geometry={l.geometry} material={materials[k]} receiveShadow frustumCulled />
        ))}
      <DescentStage />
      {terrain && <Flag heightAt={terrain.heightAt} />}
      {terrain && <Rocks heightAt={terrain.heightAt} />}
      <LiftoffDebris />
    </group>
  )
}

/* ---------------------------------------------------------------- *
 * The descent stage
 * ---------------------------------------------------------------- */

/**
 * Eagle's descent stage, where it has stood since 102:45:40: on its footpads,
 * facing west, the way it landed and the way the ascent stage above it lifts
 * off. The file's front is +z; in the site frame west is -x, a quarter-turn.
 */
function DescentStage() {
  const source = useModel('apollo_lm')
  useEffect(() => {
    if (!getModel('apollo_lm')) loadModel('apollo_lm')
  }, [])
  const part = useMemo(() => (source ? makePart(source, 'apollo_lm:descent') : null), [source])
  if (!part) return null
  return (
    <group rotation={[0, -Math.PI / 2, 0]}>
      <primitive object={part} />
    </group>
  )
}

/* ---------------------------------------------------------------- *
 * The flag
 * ---------------------------------------------------------------- */

function flagTexture() {
  const W = 380
  const H = 200
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  const g = c.getContext('2d')
  for (let i = 0; i < 13; i++) {
    g.fillStyle = i % 2 ? '#f4f1ea' : '#b22234'
    g.fillRect(0, (i * H) / 13, W, H / 13 + 1)
  }
  const cw = W * 0.4
  const ch = (H * 7) / 13
  g.fillStyle = '#3c3b6e'
  g.fillRect(0, 0, cw, ch)
  g.fillStyle = '#f4f1ea'
  for (let r = 0; r < 9; r++) {
    const n = r % 2 ? 5 : 6
    for (let k = 0; k < n; k++) {
      const x = (cw / 12) * (2 * k + 1 + (r % 2))
      const y = (ch / 10) * (r + 1)
      g.beginPath()
      g.arc(x, y, 2.2, 0, 2 * Math.PI)
      g.fill()
    }
  }
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  return tex
}

/** Where the flag stood: about seven metres out, west-north-west of the LM. */
const FLAG_AT = [-6.4, 0, -2.6]
/** The pole above the ground, m, and the flag, 5 ft by 3. */
const POLE = 2.1
const FLAG_W = 1.52
const FLAG_H = 0.91

/**
 * The flag, planted by Armstrong and Aldrin and knocked flat by the ascent
 * engine: Aldrin watched it go over at liftoff. It falls as a rod pivoting on
 * its base, pushed away from the LM by the exhaust and then by the Moon's
 * gravity, θ'' = (3 g / 2 L) sin θ — about two and a half seconds to the
 * ground. Reset with the mission.
 */
function Flag({ heightAt }) {
  const texture = useMemo(() => flagTexture(), [])
  const cloth = useMemo(() => {
    const geom = new THREE.PlaneGeometry(FLAG_W, FLAG_H, 16, 8)
    const p = geom.attributes.position
    // The crossbar was never fully extended, so the cloth hung rippled.
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i) + FLAG_W / 2
      p.setZ(i, 0.045 * Math.sin(x * 7.1) * (0.4 + 0.6 * (x / FLAG_W)))
    }
    geom.computeVertexNormals()
    geom.translate(FLAG_W / 2, -FLAG_H / 2, 0)
    return geom
  }, [])
  const pivot = useRef()
  const fall = useRef({ angle: 0, rate: 0, seen: 0 })
  const ground = heightAt(FLAG_AT[0], FLAG_AT[2])
  // The pivot's +x turned to point away from the LM: a y-turn θ carries +x to
  // (cos θ, 0, -sin θ). It falls by tipping +y toward that +x.
  const away = Math.atan2(-FLAG_AT[2], FLAG_AT[0])

  useFrame(() => {
    const f = fall.current
    const p = pivot.current
    if (!p) return
    if (!(lunar.liftoffTime > 0) || live.sim.t < lunar.liftoffTime + 0.3) {
      f.angle = 0
      f.rate = 0
    } else if (f.angle < Math.PI / 2) {
      // Stepped in sim time, in pieces short enough for the swing.
      let dt = Math.min(live.simDtLastFrame, 1)
      while (dt > 0) {
        const h = Math.min(dt, 1 / 120)
        const g = (3 * 1.62) / (2 * POLE)
        // The exhaust's shove for the first half-second, then gravity alone.
        const push = live.sim.t - lunar.liftoffTime < 0.8 ? 1.6 : 0
        f.rate += (g * Math.sin(f.angle + 0.02) + push) * h
        f.angle = Math.min(Math.PI / 2 - 0.03, f.angle + f.rate * h)
        dt -= h
        if (f.angle >= Math.PI / 2 - 0.03) break
      }
    }
    p.rotation.set(0, away, -f.angle)
  })

  return (
    <group position={[FLAG_AT[0], ground, FLAG_AT[2]]}>
      <group ref={pivot}>
        {/* The cloth faces a little east of south, whatever way it falls. */}
        <group rotation={[0, -away + 0.3, 0]}>
          <mesh position={[0, POLE / 2, 0]} castShadow>
            <cylinderGeometry args={[0.0127, 0.0127, POLE, 8]} />
            <meshStandardMaterial color="#c9c6bf" metalness={0.8} roughness={0.35} />
          </mesh>
          <mesh position={[FLAG_W / 2, POLE - 0.02, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
            <cylinderGeometry args={[0.009, 0.009, FLAG_W, 6]} />
            <meshStandardMaterial color="#c9c6bf" metalness={0.8} roughness={0.35} />
          </mesh>
          <mesh geometry={cloth} position={[0, POLE - 0.03, 0]} castShadow>
            <meshStandardMaterial map={texture} side={THREE.DoubleSide} roughness={0.9} metalness={0} />
          </mesh>
        </group>
      </group>
    </group>
  )
}

/* ---------------------------------------------------------------- *
 * Rocks
 * ---------------------------------------------------------------- */

/**
 * A scatter of rocks, below what the 2 m model resolves. The crew described the
 * site as pocked with small craters and strewn with rocks up to a couple of feet
 * across — more toward West crater, whose ejecta they had flown over. Sizes run
 * as a power law, as fragment populations do; each is half buried, as rocks in
 * regolith are. Seeded, so the site is the same every time.
 */
function Rocks({ heightAt }) {
  const mesh = useMemo(() => {
    // Eighty faces: a rock a few centimetres across needs no more, and angular
    // is what fresh fragments are.
    const geom = new THREE.IcosahedronGeometry(1, 1)
    const p = geom.attributes.position
    const noise = makeNoise(0xb0)
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i)
      const y = p.getY(i)
      const z = p.getZ(i)
      const k = 0.78 + 0.34 * (noise.fbm(x * 1.7, y * 1.7, z * 1.7, 3) * 0.5 + 0.5)
      p.setXYZ(i, x * k, y * k, z * k)
    }
    geom.computeVertexNormals()
    const material = lunarPhotometry(new THREE.MeshStandardMaterial({ color: '#8a8378', roughness: 0.92, metalness: 0 }))
    const rand = mulberry32(0x11)
    const COUNT = 3200
    const m = new THREE.InstancedMesh(geom, material, COUNT)
    const q = new THREE.Quaternion()
    const e = new THREE.Euler()
    const s = new THREE.Vector3()
    const t = new THREE.Vector3()
    const mat = new THREE.Matrix4()
    let placed = 0
    while (placed < COUNT) {
      // Most of them near the LM, where there is someone to see them.
      const r = 4 + (rand() < 0.55 ? 70 : ROCK_FIELD) * Math.sqrt(rand())
      const a = rand() * 2 * Math.PI
      const x = r * Math.cos(a)
      const z = r * Math.sin(a)
      // Thicker toward West crater, to the east.
      if (x < 0 && rand() < 0.35) continue
      const size = Math.min(0.9, 0.035 * Math.pow(1 - rand(), -0.62))
      e.set(rand() * 6.3, rand() * 6.3, rand() * 6.3)
      q.setFromEuler(e)
      s.set(size, size * (0.55 + 0.3 * rand()), size * (0.75 + 0.3 * rand()))
      t.set(x, heightAt(x, z) - 0.25 * s.y, z)
      mat.compose(t, q, s)
      m.setMatrixAt(placed++, mat)
    }
    m.instanceMatrix.needsUpdate = true
    m.castShadow = true
    m.receiveShadow = true
    m.computeBoundingSphere()
    return m
  }, [heightAt])
  useEffect(
    () => () => {
      mesh.geometry.dispose()
      mesh.material.dispose()
    },
    [mesh],
  )
  return <primitive object={mesh} />
}

/* ---------------------------------------------------------------- *
 * Liftoff debris
 * ---------------------------------------------------------------- */

const DEBRIS = 320
/** Height of the interstage the ascent engine fires into, m. */
const INTERSTAGE = 3.23
const LUNAR_G = 1.62

/**
 * "Fire in the hole": the ascent engine lights against the descent stage's top
 * deck, and the blast strips the deck's gold and silver insulation. With no air
 * to slow them, the flakes fly out on clean ballistic arcs in a sixth of a g,
 * tumbling and catching the sun, and land tens of metres away — the thing every
 * later liftoff camera saw. Stepped in sim time; allocation-free per frame.
 */
function LiftoffDebris() {
  const state = useMemo(() => {
    const geom = new THREE.PlaneGeometry(1, 1)
    const material = new THREE.MeshStandardMaterial({
      color: '#d6a33c',
      metalness: 0.85,
      roughness: 0.32,
      side: THREE.DoubleSide,
    })
    const mesh = new THREE.InstancedMesh(geom, material, DEBRIS)
    mesh.frustumCulled = false
    const colour = new THREE.Color()
    const rand = mulberry32(0xf1e)
    for (let i = 0; i < DEBRIS; i++) {
      // Two gold for every silver-black, as the deck's blankets were.
      colour.set(rand() < 0.66 ? '#d8a441' : rand() < 0.5 ? '#c8ccd0' : '#2b2724')
      mesh.setColorAt(i, colour)
    }
    mesh.count = 0
    return {
      mesh,
      pos: new Float32Array(DEBRIS * 3),
      vel: new Float32Array(DEBRIS * 3),
      spin: new Float32Array(DEBRIS * 4),
      size: new Float32Array(DEBRIS),
      landed: new Uint8Array(DEBRIS),
      launched: 0,
      q: new THREE.Quaternion(),
      e: new THREE.Euler(),
      v: new THREE.Vector3(),
      s: new THREE.Vector3(),
      m: new THREE.Matrix4(),
      rand: mulberry32(0xdeb),
    }
  }, [])
  useEffect(
    () => () => {
      state.mesh.geometry.dispose()
      state.mesh.material.dispose()
    },
    [state],
  )

  useFrame(() => {
    const st = state
    const t0 = lunar.liftoffTime
    if (!(t0 > 0) || live.sim.t < t0) {
      st.launched = 0
      st.mesh.count = 0
      return
    }
    if (st.launched !== t0) {
      // Seeded at the interstage, flung outward and up.
      st.launched = t0
      const r = st.rand
      for (let i = 0; i < DEBRIS; i++) {
        const a = r() * 2 * Math.PI
        const out = 3 + r() * 22
        const up = r() * 14 - 1
        st.pos[i * 3] = Math.cos(a) * 2
        st.pos[i * 3 + 1] = INTERSTAGE + r() * 0.4
        st.pos[i * 3 + 2] = Math.sin(a) * 2
        st.vel[i * 3] = Math.cos(a) * out
        st.vel[i * 3 + 1] = up
        st.vel[i * 3 + 2] = Math.sin(a) * out
        st.spin[i * 4] = r() * 6.3
        st.spin[i * 4 + 1] = r() * 6.3
        st.spin[i * 4 + 2] = r() * 6.3
        st.spin[i * 4 + 3] = 2 + r() * 14
        st.size[i] = 0.05 + Math.pow(r(), 3) * 0.35
        st.landed[i] = 0
      }
      st.mesh.count = DEBRIS
    }
    const dt = Math.min(live.simDtLastFrame, 2)
    for (let i = 0; i < DEBRIS; i++) {
      const o = i * 3
      if (!st.landed[i] && dt > 0) {
        st.vel[o + 1] -= LUNAR_G * dt
        st.pos[o] += st.vel[o] * dt
        st.pos[o + 1] += st.vel[o + 1] * dt
        st.pos[o + 2] += st.vel[o + 2] * dt
        st.spin[i * 4] += st.spin[i * 4 + 3] * dt
        st.spin[i * 4 + 1] += st.spin[i * 4 + 3] * 0.7 * dt
        groundProbe[0] = st.pos[o]
        groundProbe[1] = st.pos[o + 2]
        probeGround()
        const floor = groundProbe[2]
        if (st.pos[o + 1] < floor + 0.01 && st.vel[o + 1] < 0) {
          st.pos[o + 1] = floor + 0.01
          st.landed[i] = 1
          // Lying flat, whatever way it was turning.
          st.spin[i * 4] = Math.PI / 2
          st.spin[i * 4 + 1] = 0
        }
      }
      st.e.set(st.spin[i * 4], st.spin[i * 4 + 1], st.spin[i * 4 + 2])
      st.q.setFromEuler(st.e)
      st.v.set(st.pos[o], st.pos[o + 1], st.pos[o + 2])
      const z = st.size[i]
      st.s.set(z, z * 0.7, z)
      st.m.compose(st.v, st.q, st.s)
      st.mesh.setMatrixAt(i, st.m)
    }
    st.mesh.instanceMatrix.needsUpdate = true
  })

  return <primitive object={state.mesh} />
}
