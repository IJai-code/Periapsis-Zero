import { useEffect, useMemo, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { MAGNITUDE_LIMIT, decodeStars } from '../gfx/stars.js'
import { daySky } from '../gfx/skyGlow.js'
import { scalarUniform } from '../gfx/scalarUniform.js'

/**
 * The real sky: 115,000 Hipparcos stars, where they are and what colour they are.
 *
 * The backdrop underneath this is still procedural, and deliberately — the
 * Milky Way's band is unresolved starlight, hundreds of millions of stars no
 * catalogue lists individually, so it stays a painted diffuse field. What was
 * painted *on* it was 52,000 invented stars, and those are gone: everything
 * that reads as a star is now a measurement.
 *
 * ── how bright a star is drawn ────────────────────────────────────────
 *
 * The data is flux, straight from the definition of a magnitude. The *display*
 * of it is a compression, and it has to be: the drawn range runs from Sirius at
 * 3.8 to an eleventh-magnitude star at 4e-5, which is a hundred thousand to one
 * into a channel with 256 levels in it.
 *
 * Feeding the renderer raw flux was tried first, on the argument that linear
 * radiance is the honest thing to hand a tone mapper. Measured by reading the
 * frame back, it put **103 lit pixels on a 3.1-megapixel screen**: everything
 * fainter than about second magnitude fell under one part in 255 and the sky was
 * empty. Linear radiance is the honest thing to hand a tone mapper when the
 * display can reach the luminances involved, and a monitor cannot reach the
 * luminance of Sirius or the darkness between stars.
 *
 * So the compression is stated rather than smuggled in as an exposure. Perceived
 * brightness of a point source in a dark-adapted eye follows a power law —
 * Stevens' law, with an exponent near a third — which is the same fact that made
 * the magnitude scale logarithmic in the first place. The shader raises flux to
 * that power, so what the screen shows is proportional to what an eye would
 * report, and the ordering, the ratios and the catalogue behind them are
 * untouched.
 *
 * The point is one fixed size, because a star is unresolved and its image is the
 * instrument's point-spread function however bright it is; what makes Sirius
 * look bigger than a sixth-magnitude star on a photograph is saturation and
 * bloom, not angular size. So the size here is the PSF, the shader gives it a
 * Gaussian profile, and `Effects.jsx`'s bloom pass does the spreading — which is
 * the same pass that spreads the Sun and the engine plumes, so a bright star
 * blooms by the same rule as everything else in the frame. With the exponent
 * below, that threshold falls at about second magnitude.
 *
 * ── where the points sit ──────────────────────────────────────────────
 *
 * At infinity, and by construction rather than by keeping up. The obvious way to
 * pin a sky is to copy the camera's position onto it every frame, which is what
 * `Skybox.jsx` did and what this did first — and measured in the running app,
 * the shell ends up **500 units from a camera that is not moving**, every frame,
 * against a shell radius of 400. The camera sits outside its own sky. Whatever
 * the ordering that produces it, a sky that depends on being told where the
 * camera is has a way to be wrong, and one that does not cannot be.
 *
 * So the vertex shader drops the translation: it rotates the catalogue direction
 * into view space with `mat3(viewMatrix)` and places it at a fixed distance
 * there. That is exactly what a point at infinity projects to, it needs no
 * per-frame update at all, and no camera position appears in it. Drawn before
 * everything with `depthWrite` off, so the planets occlude the stars simply by
 * being drawn after them.
 */

/** Radius of the sphere the stars are placed on. Arbitrary: see above. */
const RADIUS = 400

/**
 * Point-spread width, in pixels at a device pixel ratio of 1.
 *
 * Three pixels is a little wider than a real PSF and is chosen so the Gaussian
 * has something to fall off across; below about 2.5 the profile aliases into a
 * hard square and every star looks like a pixel, which is the thing this is
 * replacing.
 */
const PSF_PIXELS = 3.0

/**
 * Stevens' brightness exponent for a point source seen by a dark-adapted eye.
 *
 * Reported between about 0.3 and 0.5 depending on the experiment; a third is
 * taken here, and what it buys is measurable rather than a matter of taste. At
 * this exponent a sixth-magnitude star — the naked-eye limit — lands at 0.16 of
 * unit brightness where raw flux puts it at 0.004, and the faintest star drawn
 * at 0.03 rather than 0.00004.
 */
const STEVENS = 1 / 3

const VERT = /* glsl */ `
  attribute float flux;
  varying vec3 vColour;
  uniform float uPointScale;
  uniform float uRadius;
  uniform float uStevens;
  uniform float uLimitFlux;

  void main() {
    // Gone below the faintest magnitude the sky over the camera lets through,
    // and brought in over the magnitude above it — see gfx/skyGlow.js. From
    // space the limit is past the catalogue's end and this is 1 for every star.
    float seen = smoothstep(uLimitFlux, uLimitFlux * 2.512, flux);
    vColour = color * pow(flux, uStevens) * seen;
    /*
     * Rotation only: no model matrix, no view translation. The attribute is the
     * catalogue's unit direction and stays that way — scaling it into place on
     * the CPU looked tidier and was wrong twice over, once because React invokes
     * a useMemo twice in development and squared the radius, and once because a
     * position is a thing that can be stale.
     */
    vec4 mv = vec4(mat3(viewMatrix) * position * uRadius, 1.0);
    gl_Position = projectionMatrix * mv;
    // A star the sky has hidden is not rasterised at all.
    gl_PointSize = seen > 0.0 ? uPointScale : 0.0;
  }
`

const FRAG = /* glsl */ `
  varying vec3 vColour;

  void main() {
    // Gaussian point-spread function, normalised at the centre. The 0.5 offset
    // puts the peak in the middle of the point sprite rather than its corner.
    vec2 d = gl_PointCoord - vec2(0.5);
    float r2 = dot(d, d);
    if (r2 > 0.25) discard;
    float psf = exp(-r2 * 18.0);
    gl_FragColor = vec4(vColour * psf, 1.0);
  }
`

export function Starfield({ limit = MAGNITUDE_LIMIT }) {
  const [field, setField] = useState(null)

  useEffect(() => {
    let alive = true
    const base = import.meta.env.BASE_URL
    ;(async () => {
      try {
        const manifest = await fetch(`${base}stars/manifest.json`).then((r) => r.json())
        const buffer = await fetch(`${base}stars/${manifest.file}`).then((r) => r.arrayBuffer())
        if (alive) setField(decodeStars(buffer, limit))
      } catch {
        /* No catalogue: the painted backdrop is still there, as it was before. */
      }
    })()
    return () => {
      alive = false
    }
  }, [limit])

  const geometry = useMemo(() => {
    if (!field) return null
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(field.position, 3))
    g.setAttribute('color', new THREE.BufferAttribute(field.colour, 3))
    g.setAttribute('flux', new THREE.BufferAttribute(field.flux, 1))
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), RADIUS * 1.01)
    return g
  }, [field])

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FRAG,
        uniforms: {
          // Both rewritten every frame: see gfx/scalarUniform.js.
          uPointScale: scalarUniform(PSF_PIXELS),
          uRadius: { value: RADIUS },
          uStevens: { value: STEVENS },
          uLimitFlux: scalarUniform(daySky.limitFlux),
        },
        vertexColors: true,
        /*
         * `transparent: false`, and this one flag is the difference between a
         * sky and a bug.
         *
         * The shell sits 400 units from the camera in view space, and this is a
         * simulator where a unit is a metre — so every star is 400 m away and
         * Earth's own surface is 6,378 km. The sky is *inside* everything. That
         * is fine, because a sky is not at a distance, it is a direction; what
         * has to be true instead is that it is drawn first and painted over.
         *
         * `depthTest: false` is half of that and was the whole of it, which is
         * why the planets came out see-through. three keeps transparent objects
         * in their own queue and renders it **after** all opaque geometry, and
         * `renderOrder` only sorts within a queue — so a transparent starfield
         * with depth testing off is drawn last, over the top of every body in
         * the scene, additively. The bodies were never transparent. The sky was
         * in front of them.
         *
         * Marking it opaque moves it into the opaque queue, where renderOrder
         * -999 puts it immediately after `Skybox.jsx`'s -1000 and before
         * everything real. Additive blending survives the change: three only
         * drops blending when it is `NormalBlending` *and* the material is
         * opaque, and this is neither. The fragment shader carries the point
         * spread in its colour and writes alpha 1, so nothing depended on the
         * transparent queue in the first place.
         */
        transparent: false,
        blending: THREE.AdditiveBlending,
        depthTest: false,
        depthWrite: false,
        toneMapped: true,
      }),
    [],
  )

  /*
   * The per-frame work is the point size, which follows the device pixel ratio
   * so a star is the same angular size on a retina display as on a cheap one,
   * and the faintest star the sky over the camera lets through. Nothing is
   * allocated and nothing is positioned.
   */
  useFrame(({ gl }) => {
    material.uniforms.uPointScale.value = PSF_PIXELS * gl.getPixelRatio()
    material.uniforms.uLimitFlux.value = daySky.limitFlux
  }, -2)

  useEffect(() => () => geometry?.dispose(), [geometry])
  useEffect(() => () => material.dispose(), [material])

  if (!geometry) return null
  return <points geometry={geometry} material={material} renderOrder={-999} frustumCulled={false} />
}
