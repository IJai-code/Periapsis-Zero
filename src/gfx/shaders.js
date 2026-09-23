import * as THREE from 'three'
import { scalarUniform } from './scalarUniform.js'

/** Compact 3D value noise + fBm, shared by the sun's photosphere and corona. */
const GLSL_NOISE = /* glsl */ `
  float hash13(vec3 p) {
    p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419));
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }
  float vnoise(vec3 x) {
    vec3 i = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(hash13(i + vec3(0,0,0)), hash13(i + vec3(1,0,0)), f.x),
          mix(hash13(i + vec3(0,1,0)), hash13(i + vec3(1,1,0)), f.x), f.y),
      mix(mix(hash13(i + vec3(0,0,1)), hash13(i + vec3(1,0,1)), f.x),
          mix(hash13(i + vec3(0,1,1)), hash13(i + vec3(1,1,1)), f.x), f.y), f.z);
  }
  float fbm(vec3 p, int octaves) {
    float s = 0.0, a = 0.5, n = 0.0;
    for (int i = 0; i < 7; i++) {
      if (i >= octaves) break;
      s += a * vnoise(p);
      n += a;
      a *= 0.5;
      p *= 2.03;
    }
    return s / n;
  }
`

const SUN_VERT = /* glsl */ `
  varying vec3 vObj;
  varying vec3 vWorldPos;
  varying vec3 vWorldNormal;
  void main() {
    vObj = normalize(position);
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorldPos = wp.xyz;
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`

/**
 * Photosphere. Two noise scales standing in for supergranulation and
 * granulation, drifting at different rates, plus limb darkening — which is the
 * single cue that makes a sphere read as a star rather than a lamp.
 */
const SUN_FRAG = /* glsl */ `
  ${GLSL_NOISE}
  uniform float uTime;
  uniform vec3 uDeep;
  uniform vec3 uMid;
  uniform vec3 uHot;
  uniform float uIntensity;
  varying vec3 vObj;
  varying vec3 vWorldPos;
  varying vec3 vWorldNormal;

  void main() {
    vec3 p = vObj;
    float super = fbm(p * 6.0 + vec3(0.0, uTime * 0.012, 0.0), 4);
    float gran  = fbm(p * 26.0 - vec3(uTime * 0.05, 0.0, uTime * 0.03), 4);
    float t = super * 0.62 + gran * 0.38;

    // Sunspot-ish cool patches, rare and slow.
    float spots = smoothstep(0.80, 0.92, fbm(p * 5.2 + vec3(uTime * 0.004), 4));

    vec3 V = normalize(cameraPosition - vWorldPos);
    float mu = max(dot(normalize(vWorldNormal), V), 0.0);
    float limb = 0.40 + 0.60 * pow(mu, 0.52);

    vec3 col = mix(uDeep, uMid, smoothstep(0.30, 0.54, t));
    col = mix(col, uHot, smoothstep(0.54, 0.78, t));
    col *= limb;
    col = mix(col, uDeep * 0.5, spots * 0.55);

    gl_FragColor = vec4(col * uIntensity, 1.0);
  }
`

export function makeSunMaterial() {
  return new THREE.ShaderMaterial({
    vertexShader: SUN_VERT,
    fragmentShader: SUN_FRAG,
    uniforms: {
      // Rewritten every frame: see gfx/scalarUniform.js.
      uTime: scalarUniform(0),
      uDeep: { value: new THREE.Color('#c2410c') },
      uMid: { value: new THREE.Color('#fb923c') },
      uHot: { value: new THREE.Color('#fff9e8') },
      uIntensity: { value: 3.4 },
    },
    toneMapped: false,
  })
}

/** Radius of the corona shell, in stellar radii. Must match the mesh's scale. */
export const CORONA_SHELL = 1.85

/** Corona: a soft, animated additive shell that gives the star its bloom seed. */
const CORONA_FRAG = /* glsl */ `
  ${GLSL_NOISE}
  uniform float uTime;
  uniform vec3 uColor;
  uniform float uIntensity;
  uniform float uShell;
  uniform float uScaleHeight;
  varying vec3 vObj;
  varying vec3 vWorldPos;
  varying vec3 vWorldNormal;

  void main() {
    vec3 V = normalize(cameraPosition - vWorldPos);
    float ndv = abs(dot(normalize(vWorldNormal), V));

    // Fade with height above the photosphere rather than with the Fresnel term,
    // which would peak exactly at the shell's silhouette and draw a hard ring
    // around the star.
    float sinT = sqrt(max(0.0, 1.0 - ndv * ndv));
    float falloff = exp(-max(0.0, uShell * sinT - 1.0) / uScaleHeight);

    float flare = fbm(vObj * 4.5 + vec3(uTime * 0.03), 4);
    float a = falloff * (0.5 + 0.8 * flare) * uIntensity;
    gl_FragColor = vec4(uColor * a, a);
  }
`

export function makeCoronaMaterial() {
  return new THREE.ShaderMaterial({
    vertexShader: SUN_VERT,
    fragmentShader: CORONA_FRAG,
    uniforms: {
      uTime: scalarUniform(0),
      uColor: { value: new THREE.Color('#ffb054') },
      uIntensity: { value: 1.5 },
      uShell: { value: CORONA_SHELL },
      uScaleHeight: { value: 0.30 },
    },
    side: THREE.BackSide,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  })
}

/**
 * Day/night terminator for the Earth's surface material.
 *
 * Patched into meshStandardMaterial rather than replacing it, so the planet
 * keeps real PBR shading, real shadow-map reception and the specular ocean
 * highlight — and only gains one thing: city lights that are masked off wherever
 * the sun is up. Without the mask the emissive map glows straight through
 * daylight, which is the usual giveaway of a fake night-lights planet.
 */
export function attachNightLights(material, sunDirUniform) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uSunDir = sunDirUniform

    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n varying vec3 vNightNormal;')
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\n vNightNormal = normalize(mat3(modelMatrix) * objectNormal);',
      )

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\n uniform vec3 uSunDir;\n varying vec3 vNightNormal;',
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
         float sunAngle = dot(normalize(vNightNormal), uSunDir);
         // Lights fade in through the dusk band, not at a hard line.
         float night = smoothstep(0.12, -0.22, sunAngle);
         totalEmissiveRadiance *= night;`,
      )
  }
  // Force a distinct program so the patched shader is not shared with other
  // standard materials in the scene.
  material.customProgramCacheKey = () => 'earth-night-lights'
}

/**
 * Blood moon — refracted sunlight inside Earth's shadow.
 *
 * A shadow map can only subtract light, so an eclipsed Moon renders black. The
 * copper glow is not attenuated sunlight at all: it is light refracted through
 * Earth's atmosphere, Rayleigh-scattered toward red on the way, and it reaches
 * the Moon along a path the shadow map knows nothing about. So this is injected
 * as an *additive* irradiance term rather than as an override of the shadow
 * attenuation — which is both the honest physical structure and far more robust
 * than trying to reverse-engineer three's lighting chain.
 *
 * The geometry is the classical two-cone construction for an extended source:
 *
 *     rU(t) = Re - t (Rs - Re) / d      umbra, converging
 *     rP(t) = Re + t (Rs + Re) / d      penumbra, diverging
 *
 * with t measured along the Sun->Earth axis behind Earth and r perpendicular to
 * it. Those reproduce the published figures exactly (umbra cone 1.382 M km,
 * umbra radius at the Moon 4599 km, spanning 2.65 lunar radii).
 *
 * The reason this registers against the existing shadows without a fudge factor
 * is that three's point light draws its hard edge at rS(t) = Re (d + t) / d,
 * and
 *
 *     ( rU(t) + rP(t) ) / 2  =  Re + t Re / d  =  rS(t)
 *
 * identically, for every t. The renderer's approximation sits exactly on the
 * midpoint of the physical penumbra band, so smoothstep(rU, rP, r) crosses 0.5
 * precisely where the drawn shadow begins.
 *
 * @param {import('three').MeshStandardMaterial} material
 * @param {Record<string, {value: unknown}>} uniforms  created by the caller and
 *   mutated per frame; the same objects are handed to the compiled program.
 */
export function attachBloodMoon(material, uniforms) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uSunPosition = uniforms.sunPosition
    shader.uniforms.uEarthPosition = uniforms.earthPosition
    shader.uniforms.uEarthRadius = uniforms.earthRadius
    shader.uniforms.uSunRadius = uniforms.sunRadius
    shader.uniforms.uCoreColor = uniforms.coreColor
    shader.uniforms.uEdgeColor = uniforms.edgeColor
    shader.uniforms.uIntensity = uniforms.intensity

    // World position and normal are carried on private varyings rather than
    // reusing `worldPosition` from <worldpos_vertex>, which is only compiled in
    // under USE_ENVMAP / USE_SHADOWMAP and would vanish if shadows were toggled
    // off. `objectNormal` and `transformed` are both in scope here because
    // <beginnormal_vertex> precedes <begin_vertex>.
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vEclipseWorldPos;
        varying vec3 vEclipseNormal;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vEclipseWorldPos = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
        vEclipseNormal = normalize( mat3( modelMatrix ) * objectNormal );`,
      )

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform vec3 uSunPosition;
        uniform vec3 uEarthPosition;
        uniform float uEarthRadius;
        uniform float uSunRadius;
        uniform vec3 uCoreColor;
        uniform vec3 uEdgeColor;
        uniform float uIntensity;
        varying vec3 vEclipseWorldPos;
        varying vec3 vEclipseNormal;`,
      )
      // <aomap_fragment> sits after the lighting is assembled and before the
      // diffuse and specular totals are summed. Its body is USE_AOMAP-guarded
      // but the include itself is unconditional, so it is always a valid anchor.
      // Every local is bm-prefixed so nothing shadows a name in the outer scope.
      .replace(
        '#include <aomap_fragment>',
        `#include <aomap_fragment>
        {
          vec3 bmAxis = uEarthPosition - uSunPosition;
          float bmD = max( length( bmAxis ), 1e-6 );
          bmAxis /= bmD;

          vec3 bmV = vEclipseWorldPos - uEarthPosition;
          float bmT = dot( bmV, bmAxis );              // behind Earth, along the axis
          float bmR = length( bmV - bmAxis * bmT );    // off-axis distance

          float bmUmbra = max( uEarthRadius - bmT * ( uSunRadius - uEarthRadius ) / bmD, 0.0 );
          float bmPenumbra = uEarthRadius + bmT * ( uSunRadius + uEarthRadius ) / bmD;

          float bmShadow = 1.0 - smoothstep( bmUmbra, bmPenumbra, bmR );
          // Nothing on the sunward side of Earth: that is a solar eclipse, not
          // a lunar one. Softened over half an Earth radius rather than a hard
          // step so a body straddling the plane cannot seam.
          bmShadow *= smoothstep( 0.0, uEarthRadius * 0.5, bmT );

          // The refracted light comes from the ring of Earth's sunlit limb, so
          // it only reaches the hemisphere facing Earth. This doubles as a soft
          // N.L, which keeps the disc reading as a sphere instead of a decal.
          //
          // The terminator's softness is derived rather than dialled in: an
          // extended source of angular radius asin(Re / dist) wraps light that
          // far past the geometric terminator, so the ramp is +/- that sine. It
          // then stays correct on its own if the display scale is retuned.
          vec3 bmToEarth = normalize( uEarthPosition - vEclipseWorldPos );
          float bmSoft = clamp(
            uEarthRadius / max( length( uEarthPosition - vEclipseWorldPos ), 1e-4 ),
            0.02,
            0.5
          );
          float bmFacing = smoothstep( -bmSoft, bmSoft, dot( normalize( vEclipseNormal ), bmToEarth ) );

          // Deepest red on the axis, where the refracted light has crossed the
          // most atmosphere; brighter and more orange out toward the umbra edge,
          // where more of the lit limb is visible through less air.
          float bmEdge = clamp( bmR / max( bmUmbra, 1e-4 ), 0.0, 1.0 );
          vec3 bmTint = mix( uCoreColor, uEdgeColor, bmEdge );

          // Biased hard toward the umbra. Anywhere in the penumbra the Moon
          // still sees part of the solar disc directly, and that light is orders
          // of magnitude brighter than the refracted component — so the copper
          // is only perceptible once direct sunlight is essentially gone. A
          // linear ramp instead washes the penumbral band milky pink.
          float bmAmount = pow( bmShadow, 2.2 ) * bmFacing * uIntensity;

          // Scaling by diffuseColor is what keeps the albedo map in play, so the
          // maria stay darker than the highlands through totality.
          reflectedLight.indirectDiffuse += bmTint * diffuseColor.rgb * bmAmount;
        }`,
      )
  }

  // Without this three may hand the Moon a program compiled for a different
  // standard material with matching defines, and the injection is silently lost.
  material.customProgramCacheKey = () => 'moon-blood-eclipse'
}
