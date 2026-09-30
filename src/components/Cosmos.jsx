import { useEffect, useMemo } from 'react'
import { useThree } from '@react-three/fiber'
import * as THREE from 'three'
import '../sim/cosmos.js'
import { DEEP_SKY, GALAXIES, GLOBULAR_VOLUMES, KILOPARSEC, MILKY_WAY_FRAME, PARSEC, SGR_A_FRAME, SGR_A_RS } from '../sim/cosmos.js'
import { makeBlackHoleMaterial } from '../gfx/blackHole.js'
import { LOOKS, makeNebulaMaterial, nebulaBasis } from '../gfx/nebulae.js'
import { MILKY_WAY, MILKY_WAY_ABS_V, aimVolume, externalParams, makeGalaxyMaterial, modelLuminosity } from '../gfx/galaxyModel.js'
import { VIEW } from '../gfx/cosmicView.js'
import { live } from '../sim/live.js'
import { daySky } from '../gfx/skyGlow.js'
import { QUALITY } from '../sim/device.js'
import { DeepStars } from './DeepStars.jsx'
import { DeepField } from './DeepField.jsx'

/**
 * Everything beyond the planets: the Milky Way around and below the camera,
 * the galaxies past it, and the stars with names.
 *
 * The Galaxy is one volume model (`gfx/glsl/galaxy.js`) drawn two ways. From
 * inside it — which is everywhere the missions go — the sky is the same model
 * marched from where the camera stands into a cube map, once, and kept: the
 * band, the bulge behind the Sagittarius star clouds, the Great Rift's dark
 * clouds in front of it, all from one structure measured from inside. It is
 * marched again only when the camera has moved far enough for the sky to
 * change, which near the Sun is a parsec — never, on a mission. From outside
 * it is marched every frame like any other galaxy, from wherever the camera
 * is, at a fraction of the screen's resolution (it is soft) and upscaled.
 *
 * Draw order is the whole of the depth logic, as it is for the star field:
 * the sky at −1001, the volumes at −1000, the stars after, and every real
 * body drawn over the lot. The per-frame work runs in the sky's
 * `onBeforeRender`, with the camera the frame is actually drawn with: a
 * callback that runs at some other point in the frame can read a camera that
 * has since moved, and the painted skybox this replaces was measured doing
 * exactly that — sitting 500 units from a camera inside a 400-unit sky.
 */

/** Distance moved before the sky cube is marched again, kpc (a parsec). */
const CUBE_MOVE = 0.001
/** Low-resolution cube marched every frame while the camera is travelling. */
const CUBE_LO = 128
/** Tiles per cube-face side for the full-resolution march: one `skyTile`-texel tile a frame (see sim/device.js). */
// Computed when built, after the user selects a tier (not at module load).

const _v = new THREE.Vector3()
const _s = new THREE.Vector3()
const _size = new THREE.Vector2()
const _clear = new THREE.Color()

/** Camera position in a volume's frame, in its units (kpc by default), from its basis (columns) and centre. */
function toLocal(out, basis, centre, cam, unit = KILOPARSEC) {
  const e = basis.elements
  const dx = (cam.x - centre.x) / unit
  const dy = (cam.y - centre.y) / unit
  const dz = (cam.z - centre.z) / unit
  out.x = e[0] * dx + e[1] * dy + e[2] * dz
  out.y = e[4] * dx + e[5] * dy + e[6] * dz
  out.z = e[8] * dx + e[9] * dy + e[10] * dz
  return out
}

/** Place a volume's box: its basis, scaled from its units to metres, at its rebased centre. */
function placeBox(mesh, basis, centre, unit = KILOPARSEC) {
  mesh.matrixWorld.copy(basis)
  _s.setScalar(unit)
  mesh.matrixWorld.scale(_s)
  _v.subVectors(centre, live.origin)
  mesh.matrixWorld.setPosition(_v)
}

const SKY_VERT = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = position;
    // Rotation only: a direction at infinity, as the star field does it.
    vec4 p = projectionMatrix * vec4(mat3(viewMatrix) * position * 100.0, 1.0);
    p.z = 0.5 * p.w;
    gl_Position = p;
  }
`
/*
 * The sky's display curve. Seen from the Sun the model's band is about ten
 * times brighter than its galactic poles, which is the measured contrast —
 * and which, drawn linearly, is a grey haze over the whole sky with a
 * brighter stripe in it, because the poles' integrated starlight is far from
 * nothing. A dark-adapted eye does not see it that way and neither does a
 * photograph: both stretch. So the band is mapped through a declared power,
 * L_display = A (L / L_ref)^gamma with gamma = 1.35, L_ref the band's
 * 99th-percentile radiance: the brightest star clouds land where the old
 * painted band was, the median sky goes to within a few levels of black, and
 * the ordering of every part of the sky is untouched. The curve acts on
 * luminance and keeps the colour.
 */
const SKY_FRAG = /* glsl */ `
  uniform samplerCube uHi;
  uniform samplerCube uLo;
  uniform float uMix;
  uniform float uSky;
  uniform vec3 uCurve;  // A, L_ref, gamma
  varying vec3 vDir;

  vec3 sk_hash(vec3 p) {
    p = fract(p * vec3(0.1031, 0.1030, 0.0973));
    p += dot(p, p.yxz + 33.33);
    return fract((p.xxy + p.yxx) * p.zyx);
  }

  /*
   * The grain of the band. What the cube holds is the light of stars too faint
   * to list, averaged over a texel; up close that light is not smooth, it is
   * stars. So each cube face carries a grid of candidate stars, one per cell,
   * present with a probability that follows the band's own brightness here and
   * with brightnesses from a power law — a few bright, many faint — and they
   * fade out once a cell is smaller than a pixel, where they are the glow again.
   */
  vec3 grain(vec3 d, float cells, float band, float seed) {
    vec3 a = abs(d);
    vec2 uv;
    float face;
    if (a.x >= a.y && a.x >= a.z) { uv = d.yz / a.x; face = d.x > 0.0 ? 1.0 : 2.0; }
    else if (a.y >= a.z) { uv = d.xz / a.y; face = d.y > 0.0 ? 3.0 : 4.0; }
    else { uv = d.xy / a.z; face = d.z > 0.0 ? 5.0 : 6.0; }
    vec2 g = (uv * 0.5 + 0.5) * cells;
    float px = length(fwidth(g));
    float vis = 1.0 - smoothstep(0.6, 1.6, px);
    if (vis <= 0.0 || band <= 0.0) return vec3(0.0);
    vec2 cell = floor(g);
    vec3 acc = vec3(0.0);
    for (int j = -1; j <= 1; j++) {
      for (int i = -1; i <= 1; i++) {
        vec2 c = cell + vec2(float(i), float(j));
        vec3 h = sk_hash(vec3(c, face * 131.0 + seed));
        if (h.z > band) continue;
        vec2 q = g - (c + 0.15 + 0.7 * h.xy);
        float r2 = dot(q, q) / max(px * px, 0.2);
        float b = pow(h.x, 6.0) * 1.6 + 0.12;
        vec3 col = mix(vec3(1.0, 0.8, 0.62), vec3(0.8, 0.88, 1.0), h.y);
        acc += col * b * exp(-r2 * 2.2);
      }
    }
    return acc * vis;
  }

  void main() {
    vec3 d = normalize(vDir);
    // The cube holds the stretched sky already; undo the stretch on luminance
    // to know how bright the band really is here.
    vec3 c = mix(textureCube(uLo, d).rgb, textureCube(uHi, d).rgb, uMix);
    float Ld = max(dot(c, vec3(0.2126, 0.7152, 0.0722)), 1e-7);
    float n = pow(Ld / uCurve.x, 1.0 / uCurve.z);
    // Stars in proportion to the band's light: dense in the star clouds, a
    // scatter at the poles — two sizes of cell, so the grain holds as the lens narrows.
    float amp = uCurve.x * clamp(pow(n, 0.8), 0.0, 3.0);
    c += grain(d, 1500.0, clamp(n * 0.5, 0.0, 0.85), 1.0) * amp * 1.8;
    c += grain(d, 4800.0, clamp(n * 0.7, 0.0, 0.95), 7.0) * amp * 1.1;
    gl_FragColor = vec4(c * uSky, 1.0);
  }
`
/** The sky's stretch: A, L_ref, gamma — see SKY_FRAG. */
const SKY_CURVE = new THREE.Vector3(0.06, 0.154, 1.35)
const QUAD_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = position.xy * 0.5 + 0.5;
    gl_Position = vec4(position.xy, 0.5, 1.0);
  }
`
/*
 * Galaxies are displayed the way astronomers display them: an asinh stretch
 * on total intensity with the colour carried along (Lupton et al. 2004,
 * "Preparing red-green-blue images from CCD data"). It is linear where the
 * light is faint and logarithmic where it is bright, so a bulge ten thousand
 * times the surface brightness of the outer disc is a bright core rather than
 * a white hole, and the colour of every pixel is the colour of its light.
 * beta is the intensity where the curve turns over.
 */
const QUAD_FRAG = /* glsl */ `
  uniform sampler2D tVol;
  uniform sampler2D tVolHi;
  uniform float uHiMix;
  uniform float uBeta;
  uniform float uDay;
  varying vec2 vUv;
  void main() {
    vec4 c = mix(texture2D(tVol, vUv), texture2D(tVolHi, vUv), uHiMix);
    float I = max((c.r + c.g + c.b) / 3.0, 1e-9);
    float F = uBeta * log(I / uBeta + sqrt(1.0 + (I / uBeta) * (I / uBeta)));
    // A daylit sky hides a galaxy as it hides the band: the same sky factor.
    gl_FragColor = vec4(c.rgb * (F / I) * uDay, c.a * uDay);
  }
`

function buildCosmos(gl) {
  // Eight-bit sRGB: the cube holds the stretched sky (SKY_CURVE), which is
  // display-referred, and sRGB spends its levels where the eye does.
  const cubeOpts = {
    type: THREE.UnsignedByteType,
    colorSpace: THREE.SRGBColorSpace,
    generateMipmaps: false,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
  }
  const TILES = Math.ceil(QUALITY.skyCube / (QUALITY.skyTile ?? 64))
  const hi = new THREE.WebGLCubeRenderTarget(QUALITY.skyCube, cubeOpts)
  const lo = new THREE.WebGLCubeRenderTarget(CUBE_LO, cubeOpts)
  const camHi = new THREE.CubeCamera(1, 1e30, hi)
  const camLo = new THREE.CubeCamera(1, 1e30, lo)
  for (const c of [camHi, camLo]) {
    c.coordinateSystem = gl.coordinateSystem
    c.updateCoordinateSystem()
  }

  /* The Milky Way: one box, two materials — the cube's, rich and marched
     once, and the outside view's, redrawn every frame. */
  const box = new THREE.BoxGeometry(2 * MILKY_WAY.box[0], 2 * MILKY_WAY.box[1], 2 * MILKY_WAY.box[2])
  const mwSkyMat = makeGalaxyMaterial(MILKY_WAY, { milkyWay: true, steps: QUALITY.skySteps, octaves: 5, gain: 1 })
  mwSkyMat.uniforms.uCurve.value.set(SKY_CURVE.x, SKY_CURVE.y, SKY_CURVE.z, 1)
  // From outside the ionised gas is what marks the arms, and a sky that hid
  // it would hide them; the seen-from-inside cube keeps it at the level the
  // band shows it.
  const mwOutParams = {
    ...MILKY_WAY,
    young: [MILKY_WAY.young[0] * 2.6, 2.2, MILKY_WAY.young[2], MILKY_WAY.young[3]],
    armOld: [0.15, 0.9, 0.15, 0.9],
    disc: [0.8, ...MILKY_WAY.disc.slice(1)],
    dust: [MILKY_WAY.dust[0] * 2, ...MILKY_WAY.dust.slice(1)],
  }
  const mwOutMat = makeGalaxyMaterial(mwOutParams, { milkyWay: true, steps: QUALITY.volumeSteps, octaves: 3, gain: 1 })
  // Every other galaxy is as bright, beside the Milky Way, as its absolute
  // magnitude says: its model's total light scaled to 10^(-0.4 M_V).
  const perLight = Math.pow(10, -0.4 * MILKY_WAY_ABS_V) / modelLuminosity(mwOutParams)
  const mwSky = new THREE.Mesh(box, mwSkyMat)
  const mwOut = new THREE.Mesh(box, mwOutMat)
  for (const m of [mwSky, mwOut]) {
    m.matrixAutoUpdate = false
    m.frustumCulled = false
  }
  const cubeScene = new THREE.Scene()
  cubeScene.add(mwSky)
  cubeScene.matrixWorldAutoUpdate = false

  /* The volumes drawn every frame, into a buffer a fraction of the screen's size. */
  const volScene = new THREE.Scene()
  volScene.matrixWorldAutoUpdate = false
  volScene.add(mwOut)
  // The globulars' unresolved light rides the same calibrated renderer.
  const galaxies = [...GALAXIES, ...GLOBULAR_VOLUMES].map((g) => {
    const p = externalParams(g)
    const geo = new THREE.BoxGeometry(2 * p.box[0], 2 * p.box[1], 2 * p.box[2])
    const mat = makeGalaxyMaterial(p, { steps: QUALITY.volumeSteps, octaves: 3, gain: 1 })
    const mesh = new THREE.Mesh(geo, mat)
    mesh.matrixAutoUpdate = false
    mesh.frustumCulled = false
    volScene.add(mesh)
    const gain = Math.pow(10, -0.4 * g.absV) / modelLuminosity(p) / perLight
    return { g, mesh, mat, gain, reach: Math.hypot(p.box[0], p.box[1], p.box[2]) * KILOPARSEC }
  })
  /*
   * Two buffers for the volumes. A march is expensive — the Milky Way filling
   * the screen is ~20 ms at full resolution on a desktop GPU — so while the
   * view is changing it is marched into `volRT` at a fraction of the screen's
   * resolution every frame, and once the view holds still it is marched into
   * `volHi` at full resolution a strip per frame, crossfaded in when complete,
   * and then not marched again until something moves. Looking costs nothing.
   */
  /* Nebulae: a unit box each, in a frame facing the Sun, radius the unit. */
  const nebBox = new THREE.BoxGeometry(2, 2, 2)
  const nebulae = DEEP_SKY.filter((o) => LOOKS[o.look]).map((o) => {
    const basis = nebulaBasis(o.abs)
    const mat = makeNebulaMaterial(o, basis, { steps: Math.min(72, QUALITY.volumeSteps + 16), octaves: 5 })
    const mesh = new THREE.Mesh(nebBox, mat)
    mesh.matrixAutoUpdate = false
    mesh.frustumCulled = false
    volScene.add(mesh)
    return { o, basis, mesh, mat, unit: o.radiusPc * PARSEC }
  })
  const nCam = new THREE.Vector3()

  const volRT = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, depthBuffer: false })
  const volHi = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, depthBuffer: false })
  const vol = { key: new Float64Array(36), next: 0, done: false, mix: 0, strips: 8, near: 1 }

  /* The sky, and the layer the volumes are laid down in. */
  const skyMat = new THREE.ShaderMaterial({
    vertexShader: SKY_VERT,
    fragmentShader: SKY_FRAG,
    uniforms: { uHi: { value: hi.texture }, uLo: { value: lo.texture }, uMix: { value: 0 }, uSky: { value: 1 }, uCurve: { value: SKY_CURVE } },
    side: THREE.BackSide,
    depthTest: false,
    depthWrite: false,
    // Added, not written: outside the Galaxy it draws black, and anything
    // behind it — the microwave background from far enough out — must show.
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  })
  const skyGeo = new THREE.SphereGeometry(1, 48, 24)
  const quadGeo = new THREE.BufferGeometry()
  quadGeo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3))
  const quadMat = new THREE.ShaderMaterial({
    vertexShader: QUAD_VERT,
    fragmentShader: QUAD_FRAG,
    uniforms: { tVol: { value: volRT.texture }, tVolHi: { value: volHi.texture }, uHiMix: { value: 0 }, uBeta: { value: 0.06 }, uDay: { value: 1 } },
    depthTest: false,
    depthWrite: false,
    transparent: false,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    toneMapped: false,
  })

  /*
   * Sagittarius A*: the only thing here drawn after the stars, because it
   * bends them. Its sphere is ray-traced (gfx/blackHole.js) and opaque, so
   * inside it the sky is the lensed sky and nothing drawn before shows
   * through. Its frame is in sim/cosmos.js (SGR_A_FRAME).
   */
  const sgr = DEEP_SKY.find((o) => o.look === 'black-hole')
  const bhMat = makeBlackHoleMaterial(hi.texture)
  const bhGeo = new THREE.SphereGeometry(1, 48, 24)
  const bh = new THREE.Mesh(bhGeo, bhMat)
  bh.frustumCulled = false
  bh.matrixAutoUpdate = false
  bh.matrixWorldAutoUpdate = false
  bh.renderOrder = -997
  const bhBasis = SGR_A_FRAME.basis
  const bhCam = new THREE.Vector3()
  const bhSize = new THREE.Vector2()

  const cube = { at: new THREE.Vector3(1e9, 0, 0), next: 0, done: false, mix: 0, lastLo: new THREE.Vector3(1e9, 0, 0) }
  const mwCam = new THREE.Vector3()
  const gCam = new THREE.Vector3()

  /** March the next tile of the full-resolution cube. */
  function tileHi(renderer) {
    const face = Math.floor(cube.next / (TILES * TILES))
    const k = cube.next % (TILES * TILES)
    const n = QUALITY.skyCube / TILES
    hi.scissor.set((k % TILES) * n, Math.floor(k / TILES) * n, n, n)
    hi.scissorTest = true
    renderer.setRenderTarget(hi, face)
    renderer.clear(true, false, false)
    aimVolume(mwSkyMat, camHi.children[face], MILKY_WAY_FRAME.basis, QUALITY.skyCube, QUALITY.skyCube)
    renderer.render(cubeScene, camHi.children[face])
    hi.scissorTest = false
    cube.next++
    if (cube.next >= 6 * TILES * TILES) cube.done = true
  }

  /** The whole low-resolution cube, now. */
  function wholeLo(renderer) {
    for (let f = 0; f < 6; f++) {
      renderer.setRenderTarget(lo, f)
      renderer.clear(true, false, false)
      aimVolume(mwSkyMat, camLo.children[f], MILKY_WAY_FRAME.basis, CUBE_LO, CUBE_LO)
      renderer.render(cubeScene, camLo.children[f])
    }
  }

  /** The frame's work, run with the camera it is rendered with. */
  function beforeSky(renderer, scene, camera) {
    VIEW.frame++
    // Dev only: the build that is actually mounted (StrictMode builds two).
    if (handle) {
      window.__cosmos = handle
      window.__THREE = THREE
    }
    VIEW.abs.copy(camera.position).add(live.origin)
    VIEW.fromSun = VIEW.abs.distanceTo(live.abs.sun)
    toLocal(mwCam, MILKY_WAY_FRAME.basis, MILKY_WAY_FRAME.centre, VIEW.abs)
    VIEW.inGalaxy[0] = mwCam.x
    VIEW.inGalaxy[1] = mwCam.y
    VIEW.inGalaxy[2] = mwCam.z
    const inside =
      Math.abs(mwCam.x) < MILKY_WAY.box[0] && Math.abs(mwCam.y) < MILKY_WAY.box[1] && Math.abs(mwCam.z) < MILKY_WAY.box[2]
    VIEW.inside = inside
    // The Hipparcos sky is a sky of directions; it holds while the camera is
    // near enough the Sun that its stars' parallaxes do not show.
    const pc = VIEW.fromSun / PARSEC
    VIEW.catalogueSky = pc < 20 ? 1 : pc > 1500 ? 0 : 1 - Math.log(pc / 20) / Math.log(1500 / 20)
    // Out of the disc a galaxy is a thing to be photographed; the exposure
    // opens as the camera leaves the plane, the way a camera's would.
    const out = Math.max(Math.abs(mwCam.z) - 0.6, Math.hypot(mwCam.x, mwCam.y) - 15, 0)
    const k = Math.min(1, out / 12)
    VIEW.exposure = 1 + 9 * k * k * (3 - 2 * k)

    const prevTarget = renderer.getRenderTarget()
    const prevFace = renderer.getActiveCubeFace()
    const prevMip = renderer.getActiveMipmapLevel()
    const prevAuto = renderer.autoClear
    renderer.getClearColor(_clear)
    const prevAlpha = renderer.getClearAlpha()
    renderer.autoClear = false
    renderer.setClearColor(0x000000, 0)

    /* The Milky Way from inside: the cube, marched where the camera is. The
       sky mesh stays in the frame either way — this callback is its — and
       simply draws nothing from outside. */
    skyMat.uniforms.uSky.value = 0
    if (inside) {
      placeBox(mwSky, MILKY_WAY_FRAME.basis, MILKY_WAY_FRAME.centre)
      mwSkyMat.uniforms.uCam.value.copy(mwCam)
      const moved = cube.at.distanceTo(mwCam)
      if (moved > CUBE_MOVE) {
        // Somewhere new: start the full march over, and show the quick one meanwhile.
        cube.at.copy(mwCam)
        cube.next = 0
        cube.done = false
        cube.mix = 0
      }
      // In daylight on the ground the band is not there to see: keep the quick
      // cube, and spend nothing refining a sky nobody can see until dusk.
      const hidden = daySky.milkyWay < 0.02
      if (!cube.done) {
        if (cube.lastLo.distanceTo(mwCam) > CUBE_MOVE * 0.25) {
          camLo.position.copy(camera.position)
          camLo.updateMatrixWorld(true)
          mwSkyMat.uniforms.uSteps.value = Math.min(QUALITY.skySteps, 72)
          mwSkyMat.uniforms.uOctaves.value = 3
          wholeLo(renderer)
          cube.lastLo.copy(mwCam)
        }
        if (!hidden) {
          camHi.position.copy(camera.position)
          camHi.updateMatrixWorld(true)
          mwSkyMat.uniforms.uSteps.value = QUALITY.skySteps
          mwSkyMat.uniforms.uOctaves.value = 5
          tileHi(renderer)
        }
      }
      cube.mix = cube.done ? Math.min(1, cube.mix + 0.08) : 0
      skyMat.uniforms.uMix.value = cube.mix
      skyMat.uniforms.uSky.value = daySky.milkyWay * VIEW.exposure * (handle ? handle.show.sky : 1)
    }

    /* Everything marched this frame, or not at all if nothing has moved. */
    const dpr = renderer.getPixelRatio()
    renderer.getDrawingBufferSize(_size)
    const movingScale = Math.min(QUALITY.volumeScale, Math.sqrt(400_000 / (_size.x * _size.y)))
    const w = Math.max(4, Math.floor(_size.x * movingScale))
    const h = Math.max(4, Math.floor(_size.y * movingScale))
    let resized = false
    if (volRT.width !== w || volRT.height !== h) { volRT.setSize(w, h); resized = true }
    // Full resolution, capped near 2.4 megapixels — a retina panel's every
    // pixel is not worth a quarter of a second of marching.
    const cap = Math.min(1, Math.sqrt(2.4e6 / (_size.x * _size.y)))
    const W = Math.max(4, Math.floor(_size.x * cap))
    const H = Math.max(4, Math.floor(_size.y * cap))
    if (volHi.width !== W || volHi.height !== H) {
      volHi.setSize(W, H)
      vol.done = false
      vol.next = 0
      vol.mix = 0
    }
    // Same final detail, smaller slices: never queue a 300k-pixel raymarch
    // just because an 8K panel happens to be attached.
    vol.strips = Math.max(8, Math.ceil((W * H) / 65536))
    const pxAngle = ((camera.fov * Math.PI) / 180 / (_size.y / dpr)) * 1.0

    let near = Infinity
    mwOut.visible = !inside
    if (!inside) {
      placeBox(mwOut, MILKY_WAY_FRAME.basis, MILKY_WAY_FRAME.centre)
      mwOutMat.uniforms.uCam.value.copy(mwCam)
      mwOutMat.uniforms.uGain.value = VIEW.exposure
      const d = VIEW.abs.distanceTo(MILKY_WAY_FRAME.centre)
      near = Math.min(near, d)
      mwOut.renderOrder = -Math.round(Math.log10(Math.max(d, 1)) * 1000)
    }
    let any = !inside
    for (let i = 0; i < galaxies.length; i++) {
      const G = galaxies[i]
      const d = VIEW.abs.distanceTo(G.g.abs)
      // Under a pixel is a job for the points, not a volume.
      const show = G.reach / d > pxAngle * 0.6
      G.mesh.visible = show
      if (!show) continue
      any = true
      near = Math.min(near, d)
      placeBox(G.mesh, G.g.basis, G.g.abs)
      toLocal(gCam, G.g.basis, G.g.abs, VIEW.abs)
      G.mat.uniforms.uCam.value.copy(gCam)
      G.mat.uniforms.uGain.value = VIEW.exposure * G.gain
      G.mesh.renderOrder = -Math.round(Math.log10(Math.max(d, 1)) * 1000)
    }
    for (let i = 0; i < nebulae.length; i++) {
      const N = nebulae[i]
      const d = VIEW.abs.distanceTo(N.o.abs)
      // A nebula is a thing inside the Galaxy; from beyond it, or under a
      // pixel, it is not drawn.
      const show = (N.unit * 1.7) / d > pxAngle * 0.6 && d < 20 * KILOPARSEC
      N.mesh.visible = show
      if (!show) continue
      any = true
      near = Math.min(near, d)
      placeBox(N.mesh, N.basis, N.o.abs, N.unit)
      toLocal(nCam, N.basis, N.o.abs, VIEW.abs, N.unit)
      N.mat.uniforms.uCam.value.copy(nCam)
      N.mat.uniforms.uGain.value = VIEW.exposure
      N.mesh.renderOrder = -Math.round(Math.log10(Math.max(d, 1)) * 1000)
    }
    quad.visible = any && (!handle || handle.show.vol > 0)
    if (quad.visible) {
      // Has the view changed? Rotation and lens exactly; position to within a
      // millionth of the distance to the nearest volume — a camera riding a
      // planet round the Sun has not moved, as far as Andromeda is concerned.
      const k = vol.key
      const m = camera.matrixWorld.elements
      const pr = camera.projectionMatrix.elements
      let changed = resized
      for (let i = 0; i < 16; i++) {
        if (i < 12 && Math.abs(m[i] - k[i]) > 1e-9) changed = true
        if (Math.abs(pr[i] - k[16 + i]) > 1e-9 * (1 + Math.abs(pr[i]))) changed = true
      }
      const tol = near * 1e-6
      if (Math.abs(VIEW.abs.x - k[32]) > tol || Math.abs(VIEW.abs.y - k[33]) > tol || Math.abs(VIEW.abs.z - k[34]) > tol) changed = true
      if (inside !== (k[35] > 0.5)) changed = true
      if (changed) {
        for (let i = 0; i < 16; i++) {
          k[i] = m[i]
          k[16 + i] = pr[i]
        }
        k[32] = VIEW.abs.x
        k[33] = VIEW.abs.y
        k[34] = VIEW.abs.z
        k[35] = inside ? 1 : 0
        vol.done = false
        vol.next = 0
        vol.mix = 0
        // Moving: the whole frame, quickly, jittered anew.
        aimAll(camera, w, h, (VIEW.frame % 64) * 7.0)
        renderer.setRenderTarget(volRT)
        renderer.clear(true, false, false)
        renderer.render(volScene, camera)
      } else if (!vol.done) {
        // Still: the next strip of the full-resolution march.
        aimAll(camera, W, H, 3.0)
        const y0 = Math.floor((vol.next * H) / vol.strips)
        const y1 = Math.floor(((vol.next + 1) * H) / vol.strips)
        volHi.scissor.set(0, y0, W, y1 - y0)
        volHi.scissorTest = true
        renderer.setRenderTarget(volHi)
        renderer.clear(true, false, false)
        renderer.render(volScene, camera)
        volHi.scissorTest = false
        vol.next++
        if (vol.next >= vol.strips) vol.done = true
      }
      vol.mix = vol.done ? Math.min(1, vol.mix + 0.15) : 0
      quadMat.uniforms.uHiMix.value = vol.mix
      quadMat.uniforms.uDay.value = daySky.milkyWay
    }

    renderer.setRenderTarget(prevTarget, prevFace, prevMip)
    renderer.autoClear = prevAuto
    renderer.setClearColor(_clear, prevAlpha)

    /* The black hole, when the camera is near enough for it to be more than a pixel. */
    const lens = bhMat.uniforms.uLens.value
    const dBh = VIEW.abs.distanceTo(sgr.abs)
    bh.visible = (lens * SGR_A_RS) / dBh > pxAngle * 2
    if (bh.visible) {
      placeBox(bh, bhBasis, sgr.abs, SGR_A_RS * lens)
      toLocal(bhCam, bhBasis, sgr.abs, VIEW.abs, SGR_A_RS)
      const u = bhMat.uniforms
      u.uCam.value.copy(bhCam)
      aimVolume(bhMat, camera, bhBasis, 1, 1)
      renderer.getDrawingBufferSize(bhSize)
      const target = renderer.getRenderTarget()
      if (target) u.uViewport.value.set(target.width, target.height)
      else u.uViewport.value.copy(bhSize)
      u.uLocalToWorld.value.setFromMatrix4(bhBasis)
      u.uTime.value = (VIEW.frame / 60) % 1000
      u.uSteps.value = QUALITY.volumeSteps * 4
      u.uSkyOn.value = inside ? 1 : 0
    }
  }

  /** Point every visible volume at this camera and target size. */
  function aimAll(camera, width, height, seed) {
    if (mwOut.visible) {
      aimVolume(mwOutMat, camera, MILKY_WAY_FRAME.basis, width, height)
      mwOutMat.uniforms.uJitterSeed.value = seed
    }
    for (let i = 0; i < galaxies.length; i++) {
      const G = galaxies[i]
      if (!G.mesh.visible) continue
      aimVolume(G.mat, camera, G.g.basis, width, height)
      G.mat.uniforms.uJitterSeed.value = seed
    }
    for (let i = 0; i < nebulae.length; i++) {
      const N = nebulae[i]
      if (!N.mesh.visible) continue
      aimVolume(N.mat, camera, N.basis, width, height)
      N.mat.uniforms.uJitterSeed.value = seed
    }
  }

  const handle = import.meta.env.DEV
    ? { cube, hi, lo, volRT, volHi, vol, mwSkyMat, mwOutMat, skyMat, quadMat, galaxies, nebulae, mwSky, mwOut, cubeScene, volScene, camHi, camLo, show: { sky: 1, vol: 1 }, quality: QUALITY }
    : null
  const sky = new THREE.Mesh(skyGeo, skyMat)
  sky.frustumCulled = false
  sky.renderOrder = -1001
  sky.onBeforeRender = beforeSky
  const quad = new THREE.Mesh(quadGeo, quadMat)
  quad.frustumCulled = false
  quad.renderOrder = -1000

  return {
    sky,
    quad,
    bh,
    invalidate() {
      // Context restoration recreates blank render targets; cached sky/volume
      // completion flags must not make those blank targets permanent.
      cube.at.set(1e9, 0, 0)
      cube.lastLo.set(1e9, 0, 0)
      cube.next = 0
      cube.done = false
      cube.mix = 0
      vol.key.fill(Infinity)
      vol.next = 0
      vol.done = false
      vol.mix = 0
    },
    dispose() {
      hi.dispose()
      lo.dispose()
      volRT.dispose()
      volHi.dispose()
      box.dispose()
      mwSkyMat.dispose()
      mwOutMat.dispose()
      skyMat.dispose()
      skyGeo.dispose()
      quadGeo.dispose()
      quadMat.dispose()
      for (const G of galaxies) {
        G.mesh.geometry.dispose()
        G.mat.dispose()
      }
      nebBox.dispose()
      for (const N of nebulae) N.mat.dispose()
      bhGeo.dispose()
      bhMat.dispose()
    },
  }
}

export function Cosmos() {
  const gl = useThree((s) => s.gl)
  const cosmos = useMemo(() => buildCosmos(gl), [gl])
  useEffect(() => {
    const restored = () => cosmos.invalidate()
    gl.domElement.addEventListener('webglcontextrestored', restored)
    return () => {
      gl.domElement.removeEventListener('webglcontextrestored', restored)
      cosmos.dispose()
    }
  }, [cosmos, gl])
  return (
    <>
      <primitive object={cosmos.sky} />
      <primitive object={cosmos.quad} />
      <DeepStars />
      <DeepField />
      <primitive object={cosmos.bh} />
    </>
  )
}
