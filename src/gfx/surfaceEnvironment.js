import * as THREE from 'three'

/**
 * What a surface vehicle's metal reflects: the world it stands on.
 *
 * The expeditions rendered without an environment map, so any metal had
 * nothing to reflect and came out black. The Blender-built vehicles were
 * given 70% metalness on their foil as a compromise for exactly that reason.
 * The baked surfaces (art/lib/surfacing.py) are physically based, foil and
 * machined aluminium at full metalness, and they need a world to reflect.
 *
 * This is that world, reduced to what dominates a reflection on another
 * body: the ground below the horizon, lit by the Sun at the albedo the
 * terrain shader paints it; the sky above it (black on airless worlds, the
 * dusty gradient on Mars); and the Sun itself, small and very bright. Drawn
 * once into a cube and pre-filtered for roughness by PMREM. Nothing per frame.
 */
const LOOK = {
  moon: { ground: '#8c8780', sky: '#000000', horizon: '#05060a', light: 1.0 },
  mars: { ground: '#b8693c', sky: '#6c5347', horizon: '#d6a982', light: 0.85 },
  europa: { ground: '#d9e1e2', sky: '#000000', horizon: '#06080c', light: 0.55 },
}

export function buildSurfaceEnvironment(renderer, id, sunDirection) {
  const look = LOOK[id] ?? LOOK.moon
  const scene = new THREE.Scene()
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      uGround: { value: new THREE.Color(look.ground).multiplyScalar(look.light) },
      uSky: { value: new THREE.Color(look.sky) },
      uHorizon: { value: new THREE.Color(look.horizon) },
      uSun: { value: sunDirection.clone().normalize() },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uGround, uSky, uHorizon, uSun;
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        // The ground: brightest toward the down-Sun side, where a rough
        // surface throws its light back; darker under the vehicle's horizon.
        float lit = 0.75 + 0.25 * max(0.0, dot(normalize(vec3(-uSun.x, 0.0, -uSun.z)), normalize(vec3(d.x, 0.0, d.z) + 1e-5)));
        vec3 ground = uGround * lit * smoothstep(-1.0, -0.02, d.y) * 0.9;
        vec3 sky = mix(uHorizon, uSky, smoothstep(0.0, 0.5, d.y));
        vec3 col = d.y < 0.0 ? mix(ground, uHorizon, smoothstep(-0.06, 0.0, d.y)) : sky;
        // The Sun: about four degrees across after filtering, and very bright.
        col += vec3(1.0, 0.96, 0.9) * 60.0 * smoothstep(0.9975, 0.9992, dot(d, uSun));
        gl_FragColor = vec4(col, 1.0);
      }`,
  })
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(10, 48, 24), material))
  const pmrem = new THREE.PMREMGenerator(renderer)
  const target = pmrem.fromScene(scene, 0, 0.1, 100)
  pmrem.dispose()
  material.dispose()
  scene.children[0].geometry.dispose()
  return target
}
