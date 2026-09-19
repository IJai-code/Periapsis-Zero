import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { buildPad } from '../gfx/padGeometry.js'

/**
 * The ground structures at a launch site, built rather than loaded.
 *
 * Four pads, four silhouettes: Kennedy's umbilical tower on its mobile
 * launcher over the 39 flame trench; Baikonur's apron cantilevered over a pit
 * with the tulip's petals round the vehicle; Kourou's enclosed gantry rolled
 * back on its rails past four lightning masts; Vandenberg's service tower and
 * changeout room beside an open access tower. Every dimension either comes
 * from gfx/pads.js or is derived from the vehicle standing there, so a pad
 * fits whichever vehicle was chosen at load and nothing stands where the
 * boosters are drawn.
 *
 * Low-poly deliberately, and low draw-call by construction: every box, post
 * and lattice member is baked into one BufferGeometry per material, so the
 * whole complex — several hundred members in a tower — is four draw calls.
 * Built once per site in a memo; the frame loop touches none of it, because
 * the pad rides the same group as the terrain and moves with it.
 *
 * Frame: x east, y up, z north, origin at the pad's coordinates on the terrain
 * datum, which Terrain.jsx flattens for FLAT_RADIUS around the site. The
 * vehicle's base is at `pad.deck`, which is also the lift Craft.jsx applies to
 * the hull — see pads.js for why the hull needs lifting.
 *
 * The geometry itself lives in gfx/padGeometry.js, where Node can build it:
 * scripts/verify-pad-geometry.mjs constructs all four and measures them.
 */

const MATERIALS = {
  steel: (pad) => ({ color: pad.steel, roughness: 0.62, metalness: 0.35, side: THREE.DoubleSide }),
  concrete: (pad) => ({ color: pad.concrete, roughness: 0.96, metalness: 0.0 }),
  dark: () => ({ color: '#2a2724', roughness: 0.9, metalness: 0.1 }),
  white: () => ({ color: '#dfe2e4', roughness: 0.5, metalness: 0.2 }),
}

export function LaunchPad({ site }) {
  const built = useMemo(() => buildPad(site.id), [site.id])
  useEffect(() => () => built.meshes.forEach((m) => m.geometry.dispose()), [built])

  return (
    <group>
      {built.meshes.map((m) => (
        <mesh key={m.key} geometry={m.geometry} castShadow receiveShadow>
          <meshStandardMaterial {...MATERIALS[m.key](built.pad)} />
        </mesh>
      ))}
    </group>
  )
}
