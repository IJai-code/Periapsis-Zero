import { useEffect, useMemo, useState } from 'react'
import { useThree } from '@react-three/fiber'
import { EffectComposer, Bloom, Vignette } from '@react-three/postprocessing'
import { useUi } from '../sim/store.js'
import { currentPhase } from '../sim/mission.js'
import { cameraSource } from '../sim/broadcast.js'
import { FilmLookEffect } from '../gfx/filmLook.js'

/**
 * The look the broadcast wants on the picture, or null outside a broadcast.
 *
 * The camera decides it — a pad camera's film, the lunar surface camera's
 * scan lines, a render's clean frame — and the camera depends on the phase as
 * well as the view (Eagle's window only has Columbia in it from braking on),
 * so the phase is polled while the feed is up. Four times a second: a cut is
 * an event, and a quarter-second is inside any cut a viewer could notice.
 */
function useFeedLook() {
  const broadcast = useUi((s) => s.broadcast)
  const focus = useUi((s) => s.focus)
  const [phase, setPhase] = useState(() => currentPhase().id)
  useEffect(() => {
    if (!broadcast) return
    const id = setInterval(() => {
      const now = currentPhase().id
      setPhase((was) => (was === now ? was : now))
    }, 250)
    return () => clearInterval(id)
  }, [broadcast])
  if (!broadcast) return null
  return cameraSource(focus, phase)?.look ?? null
}

/**
 * Bloom is doing real work here rather than decorating: it is what separates the
 * photosphere's HDR values from a merely bright disc, and what gives the neon
 * trails their glow instead of leaving them as aliased hairlines.
 *
 * The film look rides the same composer, last, so the grain and the grade land
 * on the finished picture — bloom included — the way an emulsion would have
 * received it. It is one effect whose numbers change on a cut; see
 * `gfx/filmLook.js`.
 */
export function Effects({ enabled }) {
  const look = useFeedLook()
  const dpr = useThree((s) => s.viewport.dpr)
  const film = useMemo(() => new FilmLookEffect(), [])
  useEffect(() => {
    film.setLook(look ?? 'clean', dpr)
  }, [film, look, dpr])
  useEffect(() => () => film.dispose(), [film])

  const filmed = look !== null && look !== 'clean'
  if (!enabled && !filmed) return null
  return (
    <EffectComposer disableNormalPass multisampling={0}>
      {enabled ? <Bloom mipmapBlur intensity={1.15} luminanceThreshold={0.55} luminanceSmoothing={0.32} radius={0.72} /> : null}
      {enabled ? <Vignette offset={0.28} darkness={0.62} /> : null}
      <primitive object={film} dispose={null} />
    </EffectComposer>
  )
}
