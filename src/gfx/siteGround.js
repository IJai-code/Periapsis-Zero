import * as THREE from 'three'

/**
 * How far a launch site's own ground reaches, for anything that would
 * otherwise draw underneath it.
 *
 * `Terrain.jsx` builds seventy kilometres of real relief round each pad, and
 * while the camera is standing on it the planet's own globe is behind that
 * relief in every direction — completely, not mostly. Measured at Kennedy with
 * the clock frozen so the comparison was exact: hiding the globe changed 0.000%
 * of the pixels in the ground view, the tracking view and the chase view, and
 * saved 8 ms of a 33 ms frame. It is drawn, shaded through its night lights and
 * its surface detail, and then covered.
 *
 * It is covered rather than culled because `logarithmicDepthBuffer` writes
 * `gl_FragDepth`, which switches off early-Z on every GPU there is: a hidden
 * fragment runs its whole shader and is thrown away at the end. Until the
 * renderer is split into near and far frustums that can afford a plain depth
 * buffer, the globe has to be told.
 *
 * The test is the horizon. From height h on a sphere of radius R the horizon is
 * √(2Rh) away, so the patch hides the globe entirely while the camera's
 * distance from the site plus its horizon still falls inside the patch — about
 * ninety metres up at Kennedy, after which the ground's far edge comes into
 * view and the globe is needed again. `MARGIN` keeps it honest near the
 * boundary; the cost of being wrong in one direction is a frame of wasted
 * shading, and in the other a hole in the world.
 */
export const siteGround = {
  /** True while the patch is built and being drawn. */
  drawn: false,
  /** The site's centre in world space, written each frame. */
  centre: new THREE.Vector3(),
  /** The distance from the site to the nearest edge of the patch, in metres. */
  reach: 0,
}

/**
 * How much of the patch is trusted to cover.
 *
 * Only a little is held back, because the condition is not really about the
 * patch's edge: once the horizon falls inside the patch, the edge is below the
 * horizon and cannot be seen at all. What the margin covers is relief — the
 * formula is for a smooth sphere, and a hill some kilometres out stands above
 * the horizon a smooth sphere would give.
 */
const MARGIN = 0.95

/**
 * Whether the site's ground hides the globe completely from where the camera
 * is standing. False whenever there is any doubt.
 */
export function groundHidesGlobe(cameraPosition, planetCentre, planetRadius) {
  if (!siteGround.drawn || siteGround.reach <= 0) return false
  const height = cameraPosition.distanceTo(planetCentre) - planetRadius
  if (!(height >= 0) || height > siteGround.reach) return false
  const horizon = Math.sqrt(2 * planetRadius * height)
  return cameraPosition.distanceTo(siteGround.centre) + horizon < siteGround.reach * MARGIN
}
