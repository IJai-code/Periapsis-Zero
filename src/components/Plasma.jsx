import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { scalarUniform } from '../gfx/scalarUniform.js'
import { live } from '../sim/live.js'
import { plasmaState } from '../gfx/plasma.js'

/**
 * The shock layer at entry, drawn around whatever is entering.
 *
 * `gfx/plasma.js` turns the two heat fluxes the simulator already computes into
 * a colour and an opacity; this puts them on a shell. What the shell has to get
 * right is *where* on the vehicle the glow is, and that is a question about the
 * relative wind rather than about the camera or the planet: a capsule entering
 * at 40 degrees of angle of attack glows on the heat shield, which is not the
 * side facing down.
 *
 * So the shell is a plain sphere and the shape of the glow is entirely in the
 * shader, out of `live.windDir`. A sphere needs no orientation, so there is no
 * quaternion to set and nothing to keep in sync — the only per-frame work is
 * four uniform writes and one vector rotated into view space.
 *
 * Two lobes, because an entry has two. The **bow shock** sits on the windward
 * face and is the bright one. The **wake** trails behind, dimmer and broader,
 * which is the part that makes a re-entry visible from the ground for hundreds
 * of kilometres. Both are modulated by a Fresnel term so the shell reads as a
 * thin envelope rather than a painted ball: at grazing incidence a ray crosses
 * more of the layer, which is the same first-order argument the plume's limb
 * brightening uses.
 */

const VERT = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>

  varying vec3 vNormalView;
  varying vec3 vPosView;

  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vPosView = mv.xyz;
    vNormalView = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * mv;
    #include <logdepthbuf_vertex>
  }
`

const FRAG = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_fragment>

  uniform vec3  uColour;
  uniform vec3  uWind;     // where the air comes from, in view space
  uniform float uOpacity;

  varying vec3 vNormalView;
  varying vec3 vPosView;

  void main() {
    #include <logdepthbuf_fragment>

    vec3 n = normalize(vNormalView);
    vec3 v = normalize(-vPosView);

    // A thin shell seen edge-on has more of itself in the way.
    float rim = pow(1.0 - abs(dot(n, v)), 2.5);

    // Windward: the bow shock, tight and bright.
    float facing = dot(n, uWind);
    float bow = pow(max(facing, 0.0), 3.0);

    // Leeward: the wake, broad and dim, and the part you see from the ground.
    float wake = pow(max(-facing, 0.0), 1.4) * 0.35;

    float body = bow + wake;
    float a = uOpacity * (body * 0.75 + rim * body * 1.4);
    if (a <= 0.002) discard;

    gl_FragColor = vec4(uColour * (body + rim * body * 1.2), a);
  }
`

/** [r, g, b, opacity, temperature]. Module-level; the frame path writes through it. */
const _state = new Float64Array(5)

export function Plasma({ size = 4 }) {
  const mesh = useRef()
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FRAG,
        uniforms: {
          uColour: { value: new THREE.Color(1, 0.3, 0.1) },
          uWind: { value: new THREE.Vector3(0, 0, 1) },
          // Rewritten every frame of an entry: see gfx/scalarUniform.js.
          uOpacity: scalarUniform(0),
        },
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.BackSide,
        toneMapped: true,
      }),
    [],
  )

  useFrame(({ camera }) => {
    const m = mesh.current
    if (!m) return
    plasmaState(_state, live.heatFlux, live.radiativeFlux)
    const on = _state[3] > 0.002
    m.visible = on
    if (!on) return
    const u = material.uniforms
    u.uColour.value.setRGB(_state[0], _state[1], _state[2])
    u.uOpacity.value = _state[3]
    // The wind, rotated into view space so the shader can compare it with a
    // view-space normal. `transformDirection` normalises and allocates nothing.
    u.uWind.value.copy(live.windDir).transformDirection(camera.matrixWorldInverse)
  }, -2)

  return (
    <mesh ref={mesh} visible={false} material={material} frustumCulled={false}>
      {/* Comfortably outside the hull: a shock layer stands off, it does not cling. */}
      <sphereGeometry args={[size * 0.9, 32, 24]} />
    </mesh>
  )
}
