import * as THREE from 'three'

/**
 * Where the camera is, for everything beyond the planets — written once a
 * frame by `Cosmos.jsx` from the camera the frame is actually rendered with,
 * and read by the star layers and the sky.
 *
 * `abs` is the camera in the absolute scene frame (metres, the solar-system
 * barycentre at the origin) — `live.origin + camera.position`, in doubles —
 * and `fromSun` its distance from the Sun. `inGalaxy` is the camera's place in
 * the Milky Way's own frame (kiloparsecs), which is what decides whether the
 * Galaxy is drawn from inside, as a sky, or from outside, as a volume.
 */
export const VIEW = {
  abs: new THREE.Vector3(),
  fromSun: 0,
  inGalaxy: new Float64Array(3),
  inside: true,
  /** How far the Hipparcos sky still holds: 1 near the Sun, 0 once its stars' distances matter. */
  catalogueSky: 1,
  /** Photographic exposure for extended light, 1 inside the disc. */
  exposure: 1,
  frame: 0,
}
