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
  varying vec3 vNormalView;
  varying vec3 vPosView;

  void main() {
    // The unit cylinder runs y in [-0.5, 0.5] with a unit circle in xz.
    float s = position.y + 0.5;
    float d = s * uLength;
    float r = uExitRadius + d * uTanAngle;

    vAlong = s;
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
  uniform vec3  uCore;
  uniform vec3  uTip;

  varying float vAlong;
  varying vec3 vNormalView;
  varying vec3 vPosView;

  void main() {
    #include <logdepthbuf_fragment>
    float s = vAlong;

    // Path length through a thin shell at this viewing angle: the limb of the
    // plume is where you are looking along the most gas.
    float ndv = abs(dot(normalize(vNormalView), normalize(-vPosView)));
    float thickness = 1.0 / max(ndv, 0.18);

    // Exhaust cools and thins as it goes, so brightness falls along the plume.
    float fade = exp(-s * 2.2);

    // The shock train: tight nodes, losing strength to each reflection.
    float node = 0.5 + 0.5 * cos(s * ${DIAMOND_NODES.toFixed(1)} * 6.2831853);
    float diamonds = uDiamonds * pow(node, 8.0) * exp(-s * 2.6);

    vec3 colour = mix(uTip, uCore, fade) + vec3(0.55, 0.42, 0.30) * diamonds;
    float alpha = uThrottle * thickness * (fade * 0.42 + diamonds * 0.55);

    gl_FragColor = vec4(colour * (fade + diamonds), alpha);
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
export function aimPlume(material, slot, ambient, exitRadius, throttle) {
  plumeAt(_state, slot, ambient)
  const u = material.uniforms
  u.uTanAngle.value = Math.tan(_state[0])
  u.uDiamonds.value = _state[1]
  u.uLength.value = exitRadius * 2 * LENGTH_IN_DIAMETERS * _state[3]
  u.uExitRadius.value = exitRadius
  u.uThrottle.value = throttle
  return _state
}

export { DRAWN_HALF_ANGLE_CAP }
