import * as THREE from 'three'

/**
 * How the Moon reflects sunlight, in place of how paint does.
 *
 * three lights every standard material by Lambert's law: a surface's brightness
 * goes as the cosine of the sun's angle off its normal and not at all with the
 * angle it is seen from. That is a matte, bright, multiply-scattering surface —
 * snow, paper — and the regolith is none of those. It is dark (a mare reflects
 * about a tenth of the light on it), so most light that gets in is absorbed
 * before it can scatter twice, and it is porous, so a grain in shadow is hidden
 * from the viewer unless the viewer is where the light came from.
 *
 * Single scattering in a dark medium is the Lommel–Seeliger law,
 *
 *   I ∝ μ₀ / (μ₀ + μ),        μ₀ = cos incidence,  μ = cos emission,
 *
 * doubled here so a surface lit and seen square-on reflects what Lambert's
 * would, which keeps the exposure the rest of the scene is set for. It is why
 * the full Moon is a flat disc rather than a ball darkening to its limb, and why
 * the lunar ground looks the same brightness out to the horizon when the Sun is
 * behind the observer.
 *
 * The hiding of shadows adds the **opposition surge**: as the phase angle g —
 * between the sun and the viewer, seen from the ground — closes, the shadows
 * each grain casts slide behind it and the surface brightens steeply. The
 * Apollo crews saw it as the glow around their own shadows' heads. Hapke's form,
 *
 *   B(g) = 1 + B₀ / (1 + tan(g/2) / h),
 *
 * with B₀ 0.6 and h 0.05 — the width lunar photometry fits for the regolith's
 * porosity — is 1.6 at zero phase, 1.22 at 10°, 1.09 at 30° and 1.03 at 90°.
 *
 * The emission angle is the *surface's*, not the normal map's. A normal map
 * tilts facets smaller than a pixel, and a facet turned away from the eye is,
 * on real ground, behind the one in front of it — hidden, not seen edge-on. Read
 * off the perturbed normal, μ goes to zero on every such facet and the law
 * lights it at twice its brightness: crater rims came out glossy. So incidence
 * is the facet's, which is what shades the relief, and emission is the surface
 * the facets sit on.
 *
 * Applied by rewriting the one line of three's physical lighting that forms the
 * direct irradiance, so shadows, the normal map and everything else a standard
 * material does are untouched. Chained onto any `onBeforeCompile` already set.
 */
const B0 = 0.6
const H = 0.05

const LUNAR_IRRADIANCE = /* glsl */ `
	float lunarNV = saturate( dot( lunarSurfaceNormal, geometryViewDir ) );
	float lunarLS = 2.0 * dotNL / max( dotNL + lunarNV, 1e-3 );
	float lunarCosG = clamp( dot( directLight.direction, geometryViewDir ), -1.0, 1.0 );
	float lunarTanHalf = sqrt( max( 1.0 - lunarCosG, 0.0 ) / max( 1.0 + lunarCosG, 1e-4 ) );
	float lunarSurge = 1.0 + ${B0.toFixed(3)} / ( 1.0 + lunarTanHalf / ${H.toFixed(3)} );
	vec3 irradiance = lunarLS * lunarSurge * directLight.color;`

const PARS =
  '\nvec3 lunarSurfaceNormal;\n' +
  THREE.ShaderChunk.lights_physical_pars_fragment.replace('vec3 irradiance = dotNL * directLight.color;', LUNAR_IRRADIANCE)
if (!PARS.includes('lunarSurge')) {
  // three moved the line: fail loudly rather than light the Moon as paint.
  throw new Error('lunarPhotometry: the direct irradiance line was not found in three')
}

/** Light a standard material as regolith. Returns the material. */
export function lunarPhotometry(material) {
  const previous = material.onBeforeCompile
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer)
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <lights_physical_pars_fragment>', PARS)
      // The interpolated surface normal, before any map has tilted it.
      .replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\nlunarSurfaceNormal = normal;')
  }
  const key = material.customProgramCacheKey
  material.customProgramCacheKey = () => `${key.call(material)}|lunar`
  material.needsUpdate = true
  return material
}

/** The surge, for a gate: B(g) at phase angle g, radians. */
export const oppositionSurge = (g) => 1 + B0 / (1 + Math.tan(g / 2) / H)
