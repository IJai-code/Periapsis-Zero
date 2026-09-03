import { useMemo } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Matrix4, Vector3 } from 'three'
import { lagrange, markerNodes } from '../sim/lagrange.js'
import { useUi } from '../sim/store.js'

/**
 * Projects the libration points to screen space and drives the HUD markers.
 *
 * The markers are DOM, not geometry, so this writes straight into the nodes the
 * overlay registers — no React state at 60 Hz and nothing added to the scene
 * graph.
 *
 * The camera's own inverse is recomputed here rather than reading
 * `camera.matrixWorldInverse`, which R3F refreshes just before draw and is
 * therefore a frame stale at useFrame time. One matrix inversion is far cheaper
 * than making this depend on subscription ordering.
 */
const OFFSCREEN = 'translate3d(-9999px,-9999px,0)'

export function LagrangeProjector() {
  const camera = useThree((s) => s.camera)
  const size = useThree((s) => s.size)
  const show = useUi((s) => s.lagrange)
  const scratch = useMemo(() => ({ v: new Vector3(), inv: new Matrix4() }), [])

  useFrame(() => {
    if (!show) {
      for (const node of markerNodes) if (node) node.style.transform = OFFSCREEN
      return
    }

    camera.updateMatrixWorld()
    scratch.inv.copy(camera.matrixWorld).invert()

    for (let i = 0; i < markerNodes.length; i++) {
      const node = markerNodes[i]
      if (!node) continue

      scratch.v.copy(lagrange.points[i]).applyMatrix4(scratch.inv)
      // The camera looks down its own -Z, so positive z here is behind it —
      // worth testing before the projection, which folds behind-camera points
      // back onto the screen mirrored.
      const behind = scratch.v.z > 0
      scratch.v.applyMatrix4(camera.projectionMatrix)

      const x = (scratch.v.x * 0.5 + 0.5) * size.width
      const y = (-scratch.v.y * 0.5 + 0.5) * size.height
      const margin = 60
      const hidden =
        behind || x < -margin || y < -margin || x > size.width + margin || y > size.height + margin

      node.style.transform = hidden ? OFFSCREEN : `translate3d(${x}px, ${y}px, 0)`
    }
  })

  return null
}
