import * as THREE from 'three'
import { scalarUniform } from './scalarUniform.js'

/**
 * Steam and vapour on the pad, moved entirely on the GPU.
 *
 * Three effects share this: the white vapour the liquid-oxygen vents pour down
 * the side of the vehicle through the count, the water spray of the
 * sound-suppression deluge, and the steam that explodes out of the flame
 * trench when the exhaust hits that water. All three are the same physical
 * thing at different scales — gas and droplets launched from a point, slowed by
 * the air, rising or sinking with their temperature — so one system with
 * different numbers draws all of them.
 *
 * ── why nothing here runs on the CPU per frame ────────────────────────
 *
 * The render loop allocates nothing, and a particle system is the classic way
 * to break that: a pool of objects, each with a position integrated in
 * JavaScript and copied into a buffer every frame. Here there is no per-particle
 * JavaScript at all. Each particle is born with four random numbers and an
 * emitter, and its whole life is a *closed-form function of time* evaluated in
 * the vertex shader — so the per-frame work is a handful of uniform writes, and
 * a thousand particles cost the CPU exactly what one does.
 *
 * The motion is exponentially damped launch plus a constant rise:
 *
 *   x(t) = x0 + d (v0 / k)(1 - e^{-kt}) + rise t
 *
 * which is the exact solution for a particle launched at v0 into air that
 * drags it at rate k, and drifting at its buoyant terminal velocity. Hot steam
 * rises; liquid-oxygen vapour is far colder and denser than the air around it
 * and *sinks*, which is why the real vents pour down the vehicle rather than
 * up it, and why `rise` here is negative for them.
 *
 * ── why quads and not points ──────────────────────────────────────────
 *
 * `THREE.Points` would be simpler and is capped by the GPU's maximum point
 * size, which is 64 px on some hardware. A steam cloud sixty metres across seen
 * from a few hundred metres is far larger than that on screen, and a point
 * sprite clamped to its maximum shrinks exactly when it should be filling the
 * view. Each particle is instead a camera-facing quad, sized in metres in view
 * space, with no ceiling.
 *
 * ── the log depth buffer ──────────────────────────────────────────────
 *
 * Not optional, and found the hard way on the engine plume: this renderer runs
 * `logarithmicDepthBuffer`, and a raw shader that does not write the same depth
 * as everything else loses every depth comparison and draws nothing.
 */

const VERT = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>

  attribute vec2 corner;
  attribute vec4 aSeed;
  attribute vec3 aEmitter;
  attribute vec3 aDir;

  uniform float uTime;
  uniform float uLevel;
  uniform float uLife;
  uniform float uSpeed;
  uniform float uSpread;
  uniform float uDrag;
  uniform float uRise;
  uniform float uSize0;
  uniform float uSize1;

  varying vec2 vCorner;
  varying float vAlpha;
  varying float vShade;

  void main() {
    // Each particle recycles on its own phase, so emission is continuous and
    // the pool never has to be refilled.
    float age = fract(uTime / uLife + aSeed.x) * uLife;
    float u = age / uLife;

    // A particle is live if its rank is under the current level: raising the
    // level brings more of the pool in, rather than making the same ones denser.
    float live = step(aSeed.y, uLevel);

    // Launch direction, jittered in a cone about the emitter's own.
    vec3 j = vec3(aSeed.z, aSeed.w, fract(aSeed.z * 7.13 + aSeed.w * 3.71)) - 0.5;
    vec3 dir = normalize(aDir + j * 2.0 * uSpread);

    float travel = uSpeed * (1.0 - exp(-uDrag * age)) / max(uDrag, 1e-3);
    vec3 p = aEmitter + dir * travel;
    p.y += uRise * age;

    vec4 mv = modelViewMatrix * vec4(p, 1.0);

    // A slow individual spin, so a cloud of identical sprites does not read as
    // a grid of identical sprites.
    float spin = aSeed.w * 6.2831853 + age * (aSeed.z - 0.5) * 0.6;
    float cs = cos(spin), sn = sin(spin);
    vec2 c = vec2(cs * corner.x - sn * corner.y, sn * corner.x + cs * corner.y);

    float size = mix(uSize0, uSize1, sqrt(u)) * (0.7 + 0.6 * aSeed.z);
    mv.xy += c * size * 0.5 * live;

    vCorner = corner;
    // Fade in fast, out slow: a puff appears at the nozzle and thins as it grows.
    vAlpha = live * smoothstep(0.0, 0.06, u) * (1.0 - smoothstep(0.45, 1.0, u));
    // Denser near the source and paler as it spreads — thinning, not dimming.
    vShade = 1.0 - 0.35 * u;

    gl_Position = projectionMatrix * mv;
    #include <logdepthbuf_vertex>
  }
`

const FRAG = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_fragment>

  uniform vec3 uColour;
  uniform float uOpacity;
  uniform vec3 uSunView;
  uniform float uDaylight;
  uniform float uLight;

  varying vec2 vCorner;
  varying float vAlpha;
  varying float vShade;

  void main() {
    #include <logdepthbuf_fragment>
    float r2 = dot(vCorner, vCorner);
    if (r2 > 1.0) discard;

    // A soft ball, with a normal read off the quad so the sun side of each
    // puff is brighter than the shade side. Cheap, and it is most of what
    // makes steam read as a volume rather than as a pile of discs.
    vec3 n = normalize(vec3(vCorner, sqrt(max(1.0 - r2, 0.0)) + 0.35));
    // A high floor on the shaded side, because steam is not a solid: it
    // scatters light many times over before it leaves, so the side away from
    // the Sun is still bright. At 0.42 the shade side rendered dark grey and a
    // cloud read as smoke.
    float lit = 0.7 + 0.3 * max(dot(n, uSunView), 0.0);

    float a = vAlpha * uOpacity * (1.0 - r2) * (1.0 - r2);
    if (a < 0.004) discard;
    // uLight is the Sun's illuminance at the pad over pi: what a white
    // diffuser facing the Sun sends back, in the units the pad's own light
    // uses, so a puff in sunlight is as bright as the hull beside it.
    vec3 colour = uColour * vShade * mix(0.22, 1.0, uDaylight) * lit * uLight;
    gl_FragColor = vec4(colour, a);
  }
`

/**
 * Build one effect: a pool of `count` particles spread over `emitters`.
 *
 * Built once. `emitters` is a list of `{ pos: [x,y,z], dir: [x,y,z] }` in the
 * pad frame — x east, y up, z north, origin at the pad on the datum.
 */
export function makePadParticles({ emitters, count, colour, opacity, life, speed, spread, drag, rise, size0, size1 }) {
  const geometry = new THREE.InstancedBufferGeometry()
  geometry.setAttribute(
    'corner',
    new THREE.BufferAttribute(new Float32Array([-1, -1, 1, -1, 1, 1, -1, 1]), 2),
  )
  geometry.setIndex([0, 1, 2, 0, 2, 3])

  const seed = new Float32Array(count * 4)
  const emit = new Float32Array(count * 3)
  const dir = new Float32Array(count * 3)
  /*
   * A fixed-seed generator rather than Math.random, so the same pad makes the
   * same cloud every time it is built — and a test that inspects it sees what
   * a viewer sees.
   */
  let state = 0x9e3779b9
  const rand = () => {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    return ((state >>> 0) % 1_000_003) / 1_000_003
  }
  for (let i = 0; i < count; i++) {
    const e = emitters[i % emitters.length]
    for (let k = 0; k < 4; k++) seed[i * 4 + k] = rand()
    for (let k = 0; k < 3; k++) {
      emit[i * 3 + k] = e.pos[k] + (e.jitter ? (rand() - 0.5) * e.jitter[k] : 0)
      dir[i * 3 + k] = e.dir[k]
    }
  }
  geometry.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 4))
  geometry.setAttribute('aEmitter', new THREE.InstancedBufferAttribute(emit, 3))
  geometry.setAttribute('aDir', new THREE.InstancedBufferAttribute(dir, 3))
  geometry.instanceCount = count
  // The cloud moves in the shader, so no bounding volume the CPU could compute
  // would be right; the mesh is marked never to be culled instead.

  const material = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      // The four written every frame, built so writing them allocates nothing —
      // see gfx/scalarUniform.js.
      uTime: scalarUniform(0),
      uLevel: scalarUniform(0),
      uLife: { value: life },
      uSpeed: { value: speed },
      uSpread: { value: spread },
      uDrag: { value: drag },
      uRise: { value: rise },
      uSize0: { value: size0 },
      uSize1: { value: size1 },
      /*
       * An albedo, and lit by `uLight` below. It used to be multiplied by a
       * `gain` of 1.55 instead, chosen in a standalone render where the steam
       * came out grey beside the hull; in the scene, where the hull is lit by
       * the pad's real sunlight, that put the vapour at one and a half times a
       * white surface's brightness — past the bloom threshold, so every vent
       * glowed like a lamp. Lit by the same illuminance as the hull, it is as
       * bright as the hull by construction and nothing needs choosing.
       */
      uColour: { value: new THREE.Color(colour) },
      uOpacity: { value: opacity },
      uSunView: { value: new THREE.Vector3(0, 1, 0) },
      uDaylight: scalarUniform(1),
      uLight: scalarUniform(1),
    },
    transparent: true,
    depthWrite: false,
    // Steam is lit and scatters; it is not a light source, so it blends over
    // what is behind it rather than adding to it.
    blending: THREE.NormalBlending,
    /*
     * Both sides, because a billboard has no back — and because this one is
     * drawn inside a mirror. The pad is built x east, y up, z north, which is a
     * left-handed frame, and `Terrain.jsx` carries it into the scene with a
     * scale of -1 in z. three answers a mirrored object by treating clockwise
     * triangles as the front. Every other mesh on the pad was modelled in the
     * mirrored frame and comes out facing the right way; these quads are built
     * in *view* space, after the mirror, where their winding is whatever the
     * corner order made it. On the default front side the renderer culled
     * every one of them: the vents were at full level, 900 particles live, and
     * nothing on screen.
     */
    side: THREE.DoubleSide,
  })

  return { geometry, material }
}

/**
 * Point an effect at a moment. Allocation-free: uniform writes, and the sun
 * direction rotated into view space in a vector that already exists. `light`
 * is the Sun's illuminance at the pad over pi, in the pad light's own units.
 */
export function aimPadParticles(material, time, level, sunView, daylight, light) {
  const u = material.uniforms
  u.uTime.value = time
  u.uLevel.value = level
  u.uSunView.value.copy(sunView)
  u.uDaylight.value = daylight
  u.uLight.value = light
}
