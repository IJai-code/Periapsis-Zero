/** Same surface shaders at every level; tessellate only visible curvature. */
export const SPHERE_SEGMENTS = [32, 64, 128, 256, 512]
export const SILHOUETTE_ERROR = 0.3 // drawing-buffer pixels

export function projectedRadius(radius, distance, height, fov) {
  if (distance <= radius) return Infinity
  return radius * height / (2 * Math.tan(fov * Math.PI / 360) * Math.sqrt(distance * distance - radius * radius))
}

export function sphereLevel(radiusPixels, current = -1, max = SPHERE_SEGMENTS.length - 1) {
  let level = 0
  while (level < max && radiusPixels * (1 - Math.cos(Math.PI / SPHERE_SEGMENTS[level])) > SILHOUETTE_ERROR) level++
  // Refinement is immediate; coarsening has a 20% margin to avoid chatter.
  if (current > level && current <= max) {
    const error = radiusPixels * (1 - Math.cos(Math.PI / SPHERE_SEGMENTS[level]))
    if (error > SILHOUETTE_ERROR * 0.8) return current
  }
  return level
}
