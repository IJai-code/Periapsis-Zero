/**
 * Real physical constants, in SI units. The integrator works exclusively in
 * these units (metres, kilograms, seconds) — nothing here is "game scaled".
 * Display scaling happens later and only ever touches what you look at,
 * never what the integrator sees. See ./scale.js.
 */

/** Newtonian constant of gravitation, m^3 kg^-1 s^-2 (CODATA 2018). */
export const G = 6.6743e-11

export const AU = 1.495978707e11 // metres
export const DAY = 86400 // seconds
export const YEAR = 365.25 * DAY

/**
 * Masses are the real GM-derived values; radii are the IAU mean/equatorial
 * radii. `tilt` is obliquity to its orbit, `spin` is the sidereal rotation
 * period in seconds (negative would mean retrograde).
 */
export const BODIES = {
  sun: {
    id: 'sun',
    name: 'Sol',
    mass: 1.98892e30,
    radius: 6.957e8,
    spin: 25.38 * DAY,
    tilt: (7.25 * Math.PI) / 180,
  },
  earth: {
    id: 'earth',
    name: 'Terra',
    mass: 5.97219e24,
    radius: 6.371e6,
    spin: 86164.0905, // sidereal day, not solar
    tilt: (23.4392811 * Math.PI) / 180,
  },
  moon: {
    id: 'moon',
    name: 'Luna',
    mass: 7.34767309e22,
    radius: 1.7374e6,
    spin: 27.321661 * DAY, // tidally locked to its orbital period
    tilt: (6.68 * Math.PI) / 180,
  },
}

/**
 * Gravitationally active bodies, in state-vector order. Everything from here to
 * `BODY_ORDER`'s end is a test particle: pulled by these, pulling on nothing.
 */
export const ORDER = ['sun', 'earth', 'moon']

/** Massless craft, appended after the massive set. */
export const TEST_PARTICLES = ['ship', 'iss', 'hubble']

/** Full state-vector order. Slot k occupies offsets 6k .. 6k+5. */
export const BODY_ORDER = [...ORDER, ...TEST_PARTICLES]

export const MASSIVE_COUNT = ORDER.length

/** Standard gravity, for converting specific impulse to mass flow. */
export const G0 = 9.80665

/**
 * The spacecraft. Sized for a small orbital manoeuvring vehicle: roughly
 * 1.75 km/s of delta-v and about 0.4 g at full throttle on a full tank, which
 * makes orbital changes felt in seconds rather than minutes.
 */
export const SHIP = {
  name: 'Artemis',
  /**
   * Stages burn and separate in order. Numbers are close to the real Artemis
   * stack above Earth orbit: the ICPS performs trans-lunar injection, then is
   * discarded, leaving Orion's service module for everything after.
   *
   * A stage's `dryMass` is carried until it separates, so dropping a spent
   * booster is a genuine step change in vehicle mass — which is the point of
   * staging and shows up immediately in acceleration and in drag.
   */
  stages: [
    // SLS Block 1. The boosters and core burn together off the pad, so the
    // boost phase is modelled as one stage with the combined thrust and a
    // flow-weighted effective Isp — the staging engine burns one stage at a
    // time, and a parallel-burn model would buy accuracy this does not need.
    {
      name: 'SRB + Core',
      dryMass: 190_000, // two spent five-segment boosters
      propellant: 1_523_000, // booster load plus the core's share over 126 s
      thrust: 39_440_000, // 2 x 16.0 MN + 4 x 1.86 MN at sea level
      isp: 283, // flow-weighted across boosters and core
      drag: { cd: 0.35, area: 90 }, // streamlined stack, continuum flow
    },
    {
      name: 'Core',
      dryMass: 85_000,
      propellant: 718_000,
      thrust: 9_120_000, // 4 x RS-25 in vacuum
      isp: 452,
      drag: { cd: 0.35, area: 55 },
    },
    {
      name: 'ICPS',
      dryMass: 3490,
      propellant: 26_853,
      thrust: 110_100,
      isp: 462,
      // Above the sensible atmosphere the flow is free-molecular, where a blunt
      // body's drag coefficient is far higher than its streamlined value.
      drag: { cd: 2.2, area: 20 },
    },
    {
      name: 'Orion ESM',
      // The service module's own structure only. The 6185 kg this used to carry
      // was the whole Orion dry mass with no crew module in it — nothing to
      // re-enter. Splitting it at the real ESM:CM ratio (6185 : 10387) is exact
      // to the kilogram in total, so every result from the pad through lunar
      // orbit is bit-identical; it just gives the capsule a mass of its own.
      dryMass: 2308,
      propellant: 8600,
      thrust: 25_700,
      isp: 316,
      drag: { cd: 2.2, area: 20 },
    },
    /**
     * The re-entry vehicle. No engine and no propellant: once the service
     * module is gone the capsule is ballistic, and everything after that is
     * aerodynamics.
     *
     * The area is chosen to hold the **ballistic coefficient**, not the
     * diameter. Entry depends on beta = m / (Cd A) and on nothing else about
     * mass and area separately — it is the only vehicle property in
     * a = rho v^2 / (2 beta) — so preserving Orion's real 420 kg/m^2 against
     * this lighter capsule reproduces the real deceleration and heating
     * altitudes. Matching the 5.02 m diameter instead would give 157 kg/m^2,
     * which brakes far too high and turns a lunar-return entry into a gentle
     * one. 3877 / (1.25 x 7.385) = 420.0 kg/m^2.
     */
    {
      name: 'Orion CM',
      dryMass: 3877,
      propellant: 0,
      thrust: 0,
      isp: 1, // never used — no propellant, so no mass flow
      drag: { cd: 1.25, area: 7.385 },
    },
  ],

  /**
   * Parachutes, as an *added* Cd·A on top of the capsule's own.
   *
   * Two stages because one is not survivable. Going straight to the main
   * canopies at 8 km and Mach 0.8 would be about 390 g; real capsules deploy
   * drogues first and then disreef the mains over several seconds, which is
   * what `tau` models — a first-order opening rather than a step.
   */
  chutes: {
    drogue: { cdA: 25, tau: 1.5, altitude: 8000, mach: 0.8 },
    main: { cdA: 860, tau: 6.0, altitude: 3000 },
  },
  /** Isotropic, so Euler's gyroscopic term vanishes identically. */
  inertia: 18000, // kg m^2
  rcsTorque: 6000, // N m  -> about 0.33 rad/s^2 authority
  /** How hard the stability assist fights residual rotation, as a fraction of RCS authority. */
  assistGain: 2.2,
  /** Fallback orbit, used when spawning in flight rather than on the pad. */
  orbit: { altitude: 400e3, inclination: 28.5, phase: 0 },
  visual: 0.022,
  /**
   * Ballistic properties, for drag only. These craft remain gravitationally
   * massless — a mass here says how hard the air pushes them, not how hard they
   * pull on a planet.
   */
  drag: { cd: 2.2, area: 30 },
}

/**
 * Uncontrolled craft, flown as additional test particles. Real orbits: the ISS
 * at 51.6 degrees because that is what a launch from Baikonur can reach, Hubble
 * at 28.5 because that is the latitude of the Kennedy Space Center.
 *
 * `phase` spaces them around their orbits so they do not all start stacked
 * above the same point.
 */
export const SATELLITES = {
  iss: {
    name: 'ISS',
    orbit: { altitude: 400e3, inclination: 51.6, phase: 140 },
    visual: 0.030,
    // 419 t, and roughly 1500 m^2 of solar array broadside to the flow.
    mass: 419725,
    drag: { cd: 2.2, area: 1500 },
  },
  hubble: {
    name: 'Hubble',
    orbit: { altitude: 540e3, inclination: 28.5, phase: 245 },
    visual: 0.016,
    mass: 11110,
    drag: { cd: 2.2, area: 30 },
  },
}

/** Everything with a hull, keyed by state-vector id. */
export const CRAFT = { ship: SHIP, ...SATELLITES }

/**
 * Keplerian elements at J2000.0. `a` metres, angles in degrees.
 * Earth's are heliocentric-ecliptic; the Moon's are geocentric-ecliptic,
 * which is why it gets composed onto Earth's state in ./system.js.
 */
export const ELEMENTS = {
  earth: {
    a: 1.495978707e11,
    e: 0.0167086,
    i: 0.00005,
    lonAscNode: -11.26064,
    argPeri: 114.20783,
    meanAnomaly: 358.617,
  },
  moon: {
    a: 3.84399e8,
    e: 0.0549,
    i: 5.145,
    lonAscNode: 125.08,
    argPeri: 318.15,
    meanAnomaly: 135.27,
  },
}

/** Epoch the elements are valid for, as a JS timestamp (2000-01-01T12:00Z). */
export const J2000_MS = Date.UTC(2000, 0, 1, 12, 0, 0)
