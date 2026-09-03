import { EffectComposer, Bloom, Vignette } from '@react-three/postprocessing'

/**
 * Bloom is doing real work here rather than decorating: it is what separates the
 * photosphere's HDR values from a merely bright disc, and what gives the neon
 * trails their glow instead of leaving them as aliased hairlines.
 */
export function Effects({ enabled }) {
  if (!enabled) return null
  return (
    <EffectComposer disableNormalPass multisampling={0}>
      <Bloom mipmapBlur intensity={1.15} luminanceThreshold={0.55} luminanceSmoothing={0.32} radius={0.72} />
      <Vignette offset={0.28} darkness={0.62} />
    </EffectComposer>
  )
}
