import * as THREE from 'three'
import { scalarUniform } from './scalarUniform.js'
import { DRAWN_HALF_ANGLE_CAP, plumeAt } from './plume.js'

/**
 * Drawing the plume `plume.js` works out.
 *
 * The physics module says four things about an exhaust plume at a given ambient
 * pressure: how wide it opens, how strong its shock diamonds are, how far from
 * matched it is, and how far it carries. This turns those into a mesh.
 *
 * ── the geometry is a unit tube, deformed in the vertex shader ────────
 *
 * The plume's shape changes every time the ambient pressure does, and rebuilding
 * a cone geometry for that would allocate a buffer a frame. So the geometry is
 * built once — a unit cylinder, open at both ends, radius 1 and height 1 — and
 * the vertex shader maps it onto the real plume:
 *
 *   d = s * length                     how far down the plume this ring is
 *   r = exitRadius + d * tan(theta)    and how wide the plume is there
 *
 * which is the straight-sided cone a Prandtl-Meyer expansion actually makes.
 * Changing the shape is then four uniform writes and no allocation at all.
 *
 * ── why it looks like a volume without being one ──────────────────────
 *
 * The tube is drawn double-sided and additively, so a ray through the middle
 * crosses two surfaces and a ray near the silhouette crosses two nearly
 * tangentially. Weighting each fragment by `1 / |N . V|` — the path length
 * through a thin shell at that angle — turns that into the limb brightening a
 * real plume has, for the cost of a dot product. It is not a volume integral and
 * does not claim to be; it is the first term of one.
 *
 * ── the diamonds ─────────────────────────────────────────────────────
 *
 * Shock diamonds are standing waves: the over-expanded jet is squeezed by
 * ambient pressure, over-corrects, and rings. So they are drawn as a periodic
 * node train along the plume, raised to a power so the nodes are tight rather
 * than sinusoidal, decaying with distance because the shock train loses strength
 * to each reflection. Their amplitude is `plume.js`'s `diamonds`, which is zero
 * at and above the nozzle's matched altitude — so they fade out on their own as
 * the vehicle climbs, with no separate altitude rule here.
 */

/** Plume lengths, in exit diameters. A drawing decision, stated rather than tuned. */
export const LENGTH_IN_DIAMETERS = 7

/** Node spacing along the plume, in units of the plume's own length. */
const DIAMOND_NODES = 6.0

/**
 * ── the plume is not still, and it was drawn still ────────────────────
 *
 * Everything above describes a shape, and the shape is right: it opens by the
 * Prandtl-Meyer turn, it rings where the jet is over-expanded, it fades as the
 * exhaust cools. What it did not have is *time*. The only thing that moved was
 * a single sine on the overall brightness at 7.5 Hz, which is a periodic pulse
 * and reads as one — a smooth cone with a throb in it, under a vehicle that is
 * supposed to be tearing itself off a pad.
 *
 * Three things are added, and each is a real feature of a jet rather than an
 * effect:
 *
 * **The shear layer.** A jet's boundary is a free shear layer, and it rolls up
 * into Kelvin–Helmholtz structures that convect downstream. Their spacing
 * follows from the jet's preferred mode: the Strouhal number of a round jet is
 * St = f De / Ue ~ 0.3, and large-scale structures convect at Uc ~ 0.6 Ue, so
 * their wavelength is
 *
 *   lambda = Uc / f = 0.6 De / St ~ 2 De
 *
 * — two exit diameters, and note that the velocity cancels, so this is the
 * same answer for an F-1 and an RL10. The drawn plume is
 * `LENGTH_IN_DIAMETERS` long, so `uCycles` is how many structures fit on it.
 *
 * **Its growth.** A mixing layer thickens with distance from the lip, so the
 * structure is nothing at the exit plane and everything at the tip; it is
 * scaled by `s` for that reason and no other. (The incompressible growth rate
 * is about 0.16; compressibility cuts it several-fold at these convective Mach
 * numbers, which is why a rocket plume has a far cleaner edge than a subsonic
 * jet, and why `EDDY_DEPTH` is as small as it is.)
 *
 * **The chamber.** The shock train's node positions ride on chamber pressure,
 * and a large liquid engine's chamber pressure is broadband and a few per cent
 * deep — never a tone. `uBreath` carries that signal in from the caller.
 *
 * ── the one number that is a drawing decision, stated as one ──────────
 *
 * `CONVECT` is *not* the physical convection speed and cannot be. Those
 * structures move at ~0.6 Ue — around 1.5 km/s for a first stage — and cross
 * the drawn plume in about 16 ms, which is one frame at 60 Hz: timed honestly,
 * they alias into noise and the plume looks like television static. So they are
 * drawn at a rate a frame can carry. This is the same kind of declared
 * compromise as `DRAWN_HALF_ANGLE_CAP` in `plume.js` — the shape is physical,
 * the *tempo* is chosen so the shape can be seen — and it is named here rather
 * than buried as a coefficient.
 */
const CONVECT = 2.6
/** How deep the shear layer cuts into the plume's brightness at the tip. */
const EDDY_DEPTH = 0.55

/*
 * The log-depth chunks are not optional here, and finding that out cost a
 * measurement. This renderer runs `logarithmicDepthBuffer: true` — one camera
 * spanning fourteen decades depends on it — and a raw `ShaderMaterial` that does
 * not write `gl_FragDepth` leaves its fragments encoded linearly while every
 * other object in the scene is encoded logarithmically. They then lose every
 * depth comparison: measured, the plume drew **0 pixels with depth testing on
 * and 25,928 with it off**. Turning depth testing off is the wrong repair,
 * because then the plume draws over the vehicle it comes out of. Writing the
 * same depth as everything else is the right one.
 */
const VERT = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>

  uniform float uLength;
  uniform float uExitRadius;
  uniform float uTanAngle;

  varying float vAlong;
  varying float vAzimuth;
  varying vec3 vNormalView;
  varying vec3 vPosView;

  void main() {
    // The unit cylinder runs y in [-0.5, 0.5] with a unit circle in xz.
    float s = position.y + 0.5;
    float d = s * uLength;
    float r = uExitRadius + d * uTanAngle;

    vAlong = s;
    // Where round the plume this vertex is. The shear layer's structures are
    // not axisymmetric — they are lumps, not rings — so the noise needs an
    // angle as well as a station along the jet.
    vAzimuth = atan(position.z, position.x);
    vec3 p = vec3(position.x * r, position.z * r, -d);

    // The surface normal of the deformed cone, not of the cylinder it came from.
    vec3 radial = normalize(vec3(position.x, position.z, 0.0));
    vec3 n = normalize(vec3(radial.xy, uTanAngle));

    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    vPosView = mv.xyz;
    vNormalView = normalize(normalMatrix * n);
    gl_Position = projectionMatrix * mv;
    #include <logdepthbuf_vertex>
  }
`

const FRAG = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_fragment>

  uniform float uDiamonds;
  uniform float uThrottle;
  uniform float uTime;
  uniform float uBreath;
  uniform float uCycles;
  uniform vec3  uCore;
  uniform vec3  uTip;

  varying float vAlong;
  varying float vAzimuth;
  varying vec3 vNormalView;
  varying vec3 vPosView;

  /* Value noise, two dimensions, no texture. Cheap enough to take twice. */
  float pzHash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }
  float pzNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(pzHash(i), pzHash(i + vec2(1.0, 0.0)), f.x),
               mix(pzHash(i + vec2(0.0, 1.0)), pzHash(i + vec2(1.0, 1.0)), f.x), f.y);
  }

  void main() {
    #include <logdepthbuf_fragment>
    float s = vAlong;

    // Path length through a thin shell at this viewing angle: the limb of the
    // plume is where you are looking along the most gas.
    float ndv = abs(dot(normalize(vNormalView), normalize(-vPosView)));
    float thickness = 1.0 / max(ndv, 0.18);

    // Exhaust cools and thins as it goes, so brightness falls along the plume.
    float fade = exp(-s * 2.2);

    /*
     * The shear layer, convecting downstream. Two octaves: the preferred mode
     * at uCycles structures along the plume, and a half-scale one over it, both
     * carried down the jet by the same clock so they move together as one flow
     * rather than two effects. Nothing at the exit plane, everything at the
     * tip — a mixing layer starts at the lip with no thickness at all.
     */
    float travel = uTime * ${CONVECT.toFixed(2)};
    float eddy = pzNoise(vec2(vAzimuth * 2.4, s * uCycles - travel)) * 2.0 - 1.0;
    eddy += 0.5 * (pzNoise(vec2(vAzimuth * 5.3, s * uCycles * 2.1 - travel * 1.7)) * 2.0 - 1.0);
    float shear = 1.0 + ${EDDY_DEPTH.toFixed(2)} * s * eddy;

    // The shock train: tight nodes, losing strength to each reflection, and
    // riding on chamber pressure — the nodes sit where the jet's pressure
    // puts them, and a chamber breathes.
    float node = 0.5 + 0.5 * cos((s * ${DIAMOND_NODES.toFixed(1)} + uBreath * 0.22) * 6.2831853);
    float diamonds = uDiamonds * pow(node, 8.0) * exp(-s * 2.6);

    /*
     * Colour across the jet, not only along it. Looking down the middle you
     * see through the core, which is hot exhaust glowing from its own
     * molecular bands; looking at the limb you see along the mixing layer,
     * where entrained air finishes burning the soot and the emission is a
     * warm continuum. That is why a sea-level plume has a pale centre and an
     * orange sheath, and the thickness above already knows which of the two a
     * fragment is looking through.
     */
    float limb = clamp((thickness - 1.0) * 0.85, 0.0, 1.0);
    vec3 colour = mix(uTip, uCore, fade * (1.0 - 0.6 * limb)) + vec3(0.55, 0.42, 0.30) * diamonds;
    float alpha = uThrottle * thickness * (fade * 0.42 * shear + diamonds * 0.55);

    gl_FragColor = vec4(colour * (fade * shear + diamonds), max(alpha, 0.0));
  }
`

/** One unit tube, shared by every plume in the scene. */
let _geometry = null
export function plumeGeometry() {
  if (_geometry === null) {
    // Open-ended: the caps would be two flat discs of nothing.
    _geometry = new THREE.CylinderGeometry(1, 1, 1, 28, 24, true)
  }
  return _geometry
}

export function makePlumeMaterial() {
  return new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      // The five aimPlume rewrites every frame of a burn: see gfx/scalarUniform.js.
      uLength: scalarUniform(1),
      uExitRadius: scalarUniform(1),
      uTanAngle: scalarUniform(0),
      uDiamonds: scalarUniform(0),
      uThrottle: scalarUniform(0),
      // The unsteady set: a clock, the chamber's own breath, and how many
      // shear-layer structures fit on the plume at this altitude.
      uTime: scalarUniform(0),
      uBreath: scalarUniform(0),
      uCycles: scalarUniform(LENGTH_IN_DIAMETERS / 2),
      uCore: { value: new THREE.Color('#bfe4ff') },
      uTip: { value: new THREE.Color('#ff7a3c') },
    },
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: true,
  })
}

/** Scratch for the physics module's four numbers. Module-level, never allocated. */
const _state = new Float64Array(4)

/**
 * Point a plume material at an ambient pressure. No allocation: the only writes
 * are into uniform value slots that already exist.
 *
 * @param {number} slot      the nozzle's slot from `nozzleSlot`, held by the caller
 * @param {number} ambient   static pressure, Pa — `live.ambientPressure`
 * @param {number} exitRadius  the bell's own radius, m
 */
export function aimPlume(material, slot, ambient, exitRadius, throttle, time = 0, breath = 0) {
  plumeAt(_state, slot, ambient)
  const u = material.uniforms
  u.uTanAngle.value = Math.tan(_state[0])
  u.uDiamonds.value = _state[1]
  const length = exitRadius * 2 * LENGTH_IN_DIAMETERS * _state[3]
  u.uLength.value = length
  u.uExitRadius.value = exitRadius
  u.uThrottle.value = throttle
  u.uTime.value = time
  u.uBreath.value = breath
  /*
   * Structures every two exit diameters (see the note above), so the count on
   * the drawn plume is its length in exit diameters over two. Written from
   * `length` rather than restated as a constant because the plume's length is
   * itself a function of ambient pressure: a first stage's jet is short at sea
   * level and long in vacuum, and the structures on it are the same size
   * either way, so there are more of them as it climbs.
   */
  u.uCycles.value = length / (4 * Math.max(exitRadius, 1e-6))
  return _state
}

export { DRAWN_HALF_ANGLE_CAP }
