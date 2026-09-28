/**
 * The sky beyond the planets, by id: `{ abs: Vector3, radius, ... }`.
 *
 * Its own module, with no imports, because both `live.js` (which pins the
 * floating origin to whatever the camera is looking at, a star included) and
 * `where.js` (which answers where anything is) need it, and `live.js` is
 * imported by nearly everything — a registry that imported it back would be a
 * cycle waiting for an initialisation order to break it. Filled at load by
 * `sim/cosmos.js`; empty until then, which only means those names resolve to
 * nothing yet.
 */
export const COSMIC = {}
