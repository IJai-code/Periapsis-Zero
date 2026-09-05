/**
 * Real physical constants, in SI units. The integrator works exclusively in
 * these units (metres, kilograms, seconds) — nothing here is "game scaled".
 *
 * Neither is anything else, now. There used to be a display scale between this
 * file and the renderer, exaggerating body radii, craft altitudes and the
 * Moon's offset by three independent factors. Two of them disagreed, and the
 * ship spent every lunar phase drawn 201 lunar radii from the Moon it was
 * orbiting. The scene is 1:1 in metres and there is no second set of numbers.
 */

import { ACTIVE_VESSEL, VESSELS } from './vessels.js'

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
/**
 * The vehicle being flown, chosen from the vessel library.
 *
 * A live binding rather than a literal: everything downstream reads `SHIP` and
 * none of it writes, so swapping which vessel this points at is enough to
 * change the vehicle. The stack itself lives in ./vessels.js with its sources.
 */
export const SHIP = VESSELS[ACTIVE_VESSEL]

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
    visual: 108.5, // truss end to truss end
    // 419 t, and roughly 1500 m^2 of solar array broadside to the flow.
    mass: 419725,
    drag: { cd: 2.2, area: 1500 },
  },
  hubble: {
    name: 'Hubble',
    orbit: { altitude: 540e3, inclination: 28.5, phase: 245 },
    visual: 13.2, // overall length
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
