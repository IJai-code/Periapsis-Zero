/**
 * How each world on rails is shaped, oriented and dressed.
 *
 * The rails table (`sim/rails.js`) says where a body is and how hard it pulls.
 * This says what it looks like, and every number that decides that is a
 * measurement rather than a choice:
 *
 *   `equatorial`, `polar`   radii, metres. The giants are visibly oblate —
 *                           Saturn is 10% flatter at the poles than round —
 *                           and drawing them round was the first thing wrong.
 *   `pole`                  the north pole's right ascension and declination,
 *                           ICRF, degrees (IAU WGCCRE 2015). This is what puts
 *                           Uranus on its side and Saturn's rings where the
 *                           Cassini images put them.
 *   `W0`, `Wdot`            the prime meridian's angle at J2000 and its rate,
 *                           degrees and degrees a day (same report). Negative
 *                           rates are retrograde: Venus, Uranus, Pluto.
 *   `locked`                a moon that keeps one face to its planet: its
 *                           orientation is taken from the geometry instead.
 *   `albedo`                Bond albedo, for the brightness of the lit face.
 *
 * Features placed by latitude and longitude (the Great Red Spot, Olympus Mons,
 * Tombaugh Regio) use planetographic east longitude in this body-fixed frame.
 */

export const LOOKS = {
  mercury: {
    recipe: 'mercury',
    equatorial: 2.4405e6,
    polar: 2.4383e6,
    pole: [281.0103, 61.4155],
    W0: 329.5988,
    Wdot: 6.1385108,
    albedo: 0.088,
  },
  venus: {
    recipe: 'venus',
    equatorial: 6.0518e6,
    polar: 6.0518e6,
    pole: [272.76, 67.16],
    W0: 160.2,
    Wdot: -1.4813688,
    albedo: 0.76,
    // The cloud deck, not the ground, is what is seen — and it super-rotates,
    // once in about four days, sixty times faster than the planet under it.
    cloudPeriodDays: -4.0,
    atmosphere: { height: 0.035, colour: [1.0, 0.86, 0.62], strength: 1.1 },
  },
  mars: {
    recipe: 'mars',
    equatorial: 3.3962e6,
    polar: 3.3762e6,
    pole: [317.269, 54.432],
    W0: 176.049863,
    Wdot: 350.891982443297,
    albedo: 0.25,
    atmosphere: { height: 0.018, colour: [0.95, 0.62, 0.42], strength: 0.45 },
  },
  jupiter: {
    recipe: 'jupiter',
    equatorial: 7.1492e7,
    polar: 6.6854e7,
    pole: [268.056595, 64.495303],
    W0: 284.95,
    Wdot: 870.536,
    albedo: 0.5,
    atmosphere: { height: 0.012, colour: [0.9, 0.82, 0.7], strength: 0.35 },
    ring: {
      // The main ring and the halo inside it: faint dust, forward-scattering.
      inner: 1.22e8,
      outer: 1.29e8,
      profile: 'jupiter',
    },
  },
  saturn: {
    recipe: 'saturn',
    equatorial: 6.0268e7,
    polar: 5.4364e7,
    pole: [40.589, 83.537],
    W0: 38.9,
    Wdot: 810.7939024,
    albedo: 0.47,
    atmosphere: { height: 0.012, colour: [0.95, 0.86, 0.66], strength: 0.3 },
    ring: {
      // D ring's inner edge to the F ring, as Cassini measured them.
      inner: 6.69e7,
      outer: 1.4061e8,
      profile: 'saturn',
    },
  },
  uranus: {
    recipe: 'uranus',
    equatorial: 2.5559e7,
    polar: 2.4973e7,
    pole: [257.311, -15.175],
    W0: 203.81,
    Wdot: -501.1600928,
    albedo: 0.3,
    atmosphere: { height: 0.02, colour: [0.62, 0.86, 0.9], strength: 0.55 },
    ring: { inner: 4.18e7, outer: 5.2e7, profile: 'uranus' },
  },
  neptune: {
    recipe: 'neptune',
    equatorial: 2.4764e7,
    polar: 2.4341e7,
    pole: [299.36, 43.46],
    W0: 249.978,
    Wdot: 541.1397757,
    albedo: 0.29,
    atmosphere: { height: 0.02, colour: [0.42, 0.62, 1.0], strength: 0.6 },
    ring: { inner: 4.19e7, outer: 6.3e7, profile: 'neptune' },
  },
  pluto: {
    recipe: 'pluto',
    equatorial: 1.1883e6,
    polar: 1.1883e6,
    pole: [132.993, -6.163],
    W0: 302.695,
    Wdot: -56.3625225,
    albedo: 0.72,
    atmosphere: { height: 0.05, colour: [0.45, 0.62, 1.0], strength: 0.35 },
  },
  halley: {
    recipe: 'nucleus',
    // 15 × 8 × 8 km: a peanut, darker than coal.
    equatorial: 5.5e3,
    polar: 4.0e3,
    triaxial: [7.5e3, 4.0e3, 4.0e3],
    pole: [0, 90],
    W0: 0,
    Wdot: 360 / 2.2,
    albedo: 0.04,
  },
  phobos: {
    recipe: 'phobos',
    equatorial: 11.267e3,
    polar: 9.1e3,
    triaxial: [13.0e3, 11.4e3, 9.1e3],
    locked: true,
    albedo: 0.071,
  },
  deimos: {
    recipe: 'deimos',
    equatorial: 6.2e3,
    polar: 5.1e3,
    triaxial: [7.8e3, 6.0e3, 5.1e3],
    locked: true,
    albedo: 0.068,
  },
  io: { recipe: 'io', equatorial: 1.8216e6, polar: 1.8216e6, locked: true, albedo: 0.63 },
  europa: { recipe: 'europa', equatorial: 1.5608e6, polar: 1.5608e6, locked: true, albedo: 0.68 },
  ganymede: { recipe: 'ganymede', equatorial: 2.6341e6, polar: 2.6341e6, locked: true, albedo: 0.44 },
  callisto: { recipe: 'callisto', equatorial: 2.4103e6, polar: 2.4103e6, locked: true, albedo: 0.22 },
  titan: {
    recipe: 'titan',
    equatorial: 2.5747e6,
    polar: 2.5747e6,
    locked: true,
    albedo: 0.22,
    // The haze is most of the moon: 1.5 radii of it extend a good way out.
    atmosphere: { height: 0.12, colour: [0.98, 0.72, 0.36], strength: 1.3 },
  },
}

/** Planets whose moons orbit in their equatorial plane, for `sim/rails.js`. */
export const PARENT_POLES = Object.fromEntries(
  Object.entries(LOOKS)
    .filter(([, l]) => l.pole)
    .map(([id, l]) => [id, l.pole]),
)
