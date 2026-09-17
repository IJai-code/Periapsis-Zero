import { requested } from './requested.js'
/**
 * Flyable vessels, as data.
 *
 * The vehicle used to be a single hard-coded object with the mission sequencer
 * built around it. That was tolerable while there was one, and stopped being
 * tolerable for a reason that has nothing to do with tidiness: the catalogue of
 * 48 NASA meshes contains no SLS and no Orion, so the headline vehicle had no
 * hull it could honestly wear and rendered as a cone. Meanwhile it does contain
 * a Saturn V and an Apollo CSM, and the sequencer's own phase list — ascent,
 * TLI, lunar orbit, TEI, entry, and no landing — is not a generic profile. It
 * is Apollo 8.
 *
 * So the default vessel is Apollo 8 and the numbers below are that vehicle's,
 * with sources given per stage. Artemis is kept because its figures were
 * verified against the SLS/Orion stack and are worth not throwing away; it
 * simply has no faithful mesh yet.
 *
 * Per-stage `visual` and `model` mean the vehicle changes shape as it flies,
 * which is the point of staging and was previously invisible: one length and
 * one mesh for a stack that sheds 96% of its mass and 97% of its length.
 */

/**
 * Ascent shaping. Vehicle-specific, and previously global in PROFILE, which
 * only worked while there was one vehicle: Saturn V lifts off at a
 * thrust-to-weight of 1.16 against SLS's 1.57 and cannot fly the same pitch
 * programme.
 */
const ASCENT_DEFAULTS = {
  kickAltitude: 600, // m — start tipping over
  kickAngle: 3, // deg from vertical
  turnStart: 2000, // m — altitude at which the programme takes over
  targetSpeed: 7400, // m/s — pitch reaches horizontal here
  turnExponent: 0.45, // lower pitches over sooner, keeping the ascent flat
  qThrottle: 22e3, // Pa — throttle down above this dynamic pressure
  qThrottleLevel: 0.7,
  gLimit: 4 * 9.80665, // m/s^2 — structural acceleration ceiling
}

/**
 * Apollo 8 — Saturn V SA-503 with CSM-103, December 1968.
 *
 * The first crewed flight to leave Earth orbit, and the only Apollo profile
 * that matches this sequencer exactly: ten lunar orbits and home, with no
 * lunar module and no landing. Masses are the vehicle's own; where a figure is
 * a modelling choice rather than a measurement it says so.
 */
const APOLLO8 = {
  id: 'apollo8',
  name: 'Apollo 8',
  vehicle: 'Saturn V SA-503 · CSM-103',
  era: 'December 1968',

  stages: [
    {
      name: 'S-IC',
      dryMass: 130_422,
      propellant: 2_149_500, // RP-1 and LOX
      thrust: 33_400_000, // 5 x F-1 at sea level
      /**
       * Flow-weighted, not sea-level.
       *
       * The F-1 runs 263 s at sea level and 304 s in vacuum, and this model
       * carries one number per stage. The S-IC burns 168 s and is above the
       * bulk of the atmosphere by about 100 s of that, so roughly 60% of the
       * burn is effectively vacuum: 0.4 x 263 + 0.6 x 304 = 288. Quoting 263
       * would under-fly the real vehicle by most of a stage.
       */
      isp: 288,
      drag: { cd: 0.35, area: 80 }, // 10.1 m diameter, streamlined, continuum flow
      visual: 110.6, // full stack, pad to the tip of the escape tower
      model: 'saturn_v',
    },
    {
      name: 'S-II',
      dryMass: 36_000,
      propellant: 443_200, // LH2 and LOX
      thrust: 5_141_000, // 5 x J-2, vacuum
      isp: 421,
      drag: { cd: 0.35, area: 80 },
      visual: 81.6, // S-II base to escape tower tip
      model: 'saturn_v',
    },
    {
      name: 'S-IVB',
      /**
       * Carries more than the stage. The instrument unit (2,000 kg) rides on
       * top of it, and on Apollo 8 the lunar module's place in the adapter was
       * taken by LTA-B, 9,026 kg of ballast — both discarded with the stage
       * after trans-lunar injection, so both belong to its dry mass here.
       */
      dryMass: 24_500,
      propellant: 106_600,
      thrust: 1_033_000, // 1 x J-2, vacuum
      isp: 421,
      drag: { cd: 2.2, area: 30 }, // free-molecular above the sensible atmosphere
      visual: 35.1,
      model: 'saturn_v',
    },
    {
      name: 'Service Module',
      dryMass: 6_110,
      propellant: 18_410,
      thrust: 91_190, // SPS
      isp: 314,
      drag: { cd: 2.2, area: 12 },
      visual: 11.0, // CSM, docking probe to engine bell
      model: 'apollo_csm',
    },
    {
      /**
       * The command module, and the only part that comes home.
       *
       * Unlike the Orion figures this replaces, the ballistic coefficient here
       * needs no adjustment: the real 3.91 m diameter and 5,560 kg give
       * 5560 / (1.35 x 12.01) = 343 kg/m^2, against a published hypersonic
       * value of about 350. The Orion entry had to be given a fictitious area
       * to hold its beta, because its mass had been split off a stack that
       * never had a capsule in it. This one is just the vehicle.
       */
      name: 'Command Module',
      dryMass: 5_560,
      propellant: 0,
      thrust: 0,
      isp: 1, // never used — no propellant, so no mass flow
      /** `ld` is the trimmed lift-to-drag ratio; Apollo flew about 0.30. */
      drag: { cd: 1.35, area: 12.01, ld: 0.3 },
      visual: 3.47, // heat shield to docking tunnel
      /**
       * No mesh. The catalogue has the CSM but nothing that is the command
       * module alone, and scaling a CSM down to 3.47 m would draw a service
       * module that is not there. The procedural placeholder is the honest
       * answer until a capsule exists.
       */
      model: null,
    },
  ],

  /**
   * Apollo's recovery sequence, sized from what the vehicle actually did.
   *
   * Two 5.0 m conical ribbon drogues at 24,000 ft, then three 25.4 m ringsail
   * mains at 10,000 ft. The mains' Cd.A is derived from the descent rate rather
   * than from a Cd nobody agrees on: Apollo came down at about 9.1 m/s at sea
   * level, so Cd.A = 2mg / (rho v^2) = 2 x 5560 x 9.81 / (1.225 x 9.1^2)
   * = 1,076 m^2.
   */
  chutes: {
    drogue: { cdA: 19.6, tau: 1.5, altitude: 7315, mach: 0.7 },
    main: { cdA: 1076, tau: 6.0, altitude: 3050 },
  },

  inertia: 45_000, // kg m^2 — CSM, isotropic so Euler's gyroscopic term vanishes
  rcsTorque: 9_000, // N m — the SM's four quads
  assistGain: 2.2,
  orbit: { altitude: 185e3, inclination: 32.5, phase: 0 },
  /**
   * The parking orbit the real flight reached: Apollo 8 circularised at 185 km,
   * 32.5 degrees.
   *
   * The altitude is a target, not only a comparison. The ascent's closed loop
   * (`aimAscent` in sim/mission.js) holds apoapsis to it, and the gravity turn
   * cuts off when apoapsis reaches it at better than half circular speed. The
   * inclination is not targeted — the pad's azimuth sets the plane — so from
   * Kennedy, flying due east, this stack parks at 28.58 degrees.
   *
   * Measured, it parks at 172.0 x 185.1 km from Kennedy, and within 0.1 km of
   * that from all four pads (verify-launch-sites). It did not
   * always. When this vessel was added the ascent was open loop, with no
   * altitude feedback, and parked it at 1,318 x 1,323 km — Artemis, at a higher
   * thrust-to-weight, at 7,602. The very next commit closed the loop, and this
   * comment went on quoting the old numbers until it was checked against a
   * flight.
   */
  parkingOrbit: { altitude: 185e3, inclination: 32.5 },
  drag: { cd: 2.2, area: 12 },
  ascent: { ...ASCENT_DEFAULTS },
}

/**
 * Artemis I — SLS Block 1 with Orion.
 *
 * Kept intact: every figure here was verified against the real stack, and the
 * whole mission from pad to splashdown was flown against it. It has no mesh in
 * the catalogue, so it renders as a placeholder and says so.
 */
const ARTEMIS = {
  id: 'artemis',
  name: 'Artemis',
  vehicle: 'SLS Block 1 · Orion',
  era: 'November 2022',
  stages: [
    {
      /**
       * The boosters and core burn together off the pad, so the boost phase is
       * one stage with the combined thrust and a flow-weighted effective Isp —
       * the staging engine burns one stage at a time, and a parallel-burn model
       * would buy accuracy this does not need.
       */
      name: 'SRB + Core',
      dryMass: 190_000, // two spent five-segment boosters
      propellant: 1_523_000, // booster load plus the core's share over 126 s
      thrust: 39_440_000, // 2 x 16.0 MN + 4 x 1.86 MN at sea level
      isp: 283,
      drag: { cd: 0.35, area: 90 },
      visual: 98.1,
      model: null,
    },
    {
      name: 'Core',
      dryMass: 85_000,
      propellant: 718_000,
      thrust: 9_120_000, // 4 x RS-25 in vacuum
      isp: 452,
      drag: { cd: 0.35, area: 55 },
      visual: 65.0,
      model: null,
    },
    {
      name: 'ICPS',
      dryMass: 3_490,
      propellant: 26_853,
      thrust: 110_100,
      isp: 462,
      drag: { cd: 2.2, area: 20 },
      visual: 20.0,
      model: null,
    },
    {
      /**
       * The service module's own structure only. The 6,185 kg this used to
       * carry was the whole Orion dry mass with no crew module in it — nothing
       * to re-enter. Splitting it at the real ESM:CM ratio (6185 : 10387) is
       * exact to the kilogram in total, so every result from the pad through
       * lunar orbit is unchanged; it just gives the capsule a mass of its own.
       */
      name: 'Orion ESM',
      dryMass: 2_308,
      propellant: 8_600,
      thrust: 25_700,
      isp: 316,
      drag: { cd: 2.2, area: 20 },
      visual: 8.0,
      model: null,
    },
    {
      /**
       * Area chosen to hold the **ballistic coefficient**, not the diameter.
       * Entry depends on beta = m / (Cd A) and on nothing else about mass and
       * area separately, so preserving Orion's real 420 kg/m^2 against this
       * lighter capsule reproduces the real deceleration and heating altitudes.
       * Matching the 5.02 m diameter instead would give 157 kg/m^2, which
       * brakes far too high. 3877 / (1.25 x 7.385) = 420.0 kg/m^2.
       */
      name: 'Orion CM',
      dryMass: 3_877,
      propellant: 0,
      thrust: 0,
      isp: 1,
      drag: { cd: 1.25, area: 7.385, ld: 0.3 },
      visual: 3.3,
      model: null,
    },
  ],
  chutes: {
    drogue: { cdA: 25, tau: 1.5, altitude: 8000, mach: 0.8 },
    main: { cdA: 860, tau: 6.0, altitude: 3000 },
  },
  inertia: 18_000,
  rcsTorque: 6_000,
  assistGain: 2.2,
  orbit: { altitude: 400e3, inclination: 28.5, phase: 0 },
  /**
   * Artemis I inserted at 185 km before raising apogee on the ICPS.
   *
   * Measured, this stack parks at 172.0 x 185.0 km from Kennedy — Apollo 8's
   * orbit — at any warp (verify-warp). It used to park at 188.7 x 200.4 km with
   * the ascent flown at 60x, and the cause was the step rather than the stack.
   * Its Core stage, held at the 4 g limit, reaches orbital speed at 152 km where
   * Apollo 8's S-IVB reaches it at 174, and that close to circular speed apoapsis
   * was rising 20 km/s when a cutoff tested once per one-second frame caught it,
   * 15 km past. Circularising on the same stage raised perigee 174 km/s, with the
   * same result on a smaller scale. `updateStepCeiling` in sim/mission.js now
   * shortens the step as either cutoff approaches.
   */
  parkingOrbit: { altitude: 185e3, inclination: 28.5 },
  drag: { cd: 2.2, area: 30 },
  ascent: { ...ASCENT_DEFAULTS },
}

const VESSELS_BY_ID = { apollo8: APOLLO8, artemis: ARTEMIS }
/**
 * Nominal length of the whole vehicle, in metres — the first stage's, since
 * that is the full stack on the pad.
 *
 * Derived rather than written, so it cannot disagree with the stage it comes
 * from. Consumers that want *the vehicle's* size use this; consumers that care
 * what is on screen right now should read the active stage instead, because a
 * vehicle this one is 110.6 m at liftoff and 3.47 m at splashdown.
 *
 * Removing this when stages took over the length broke three things at once and
 * in the same way: `CRAFT.ship.visual` became undefined, which is NaN in
 * arithmetic, and NaN never wins a `<` comparison — so the nearest-surface
 * search silently returned Infinity with no nearest body at all.
 */
for (const v of Object.values(VESSELS_BY_ID)) {
  v.visual = v.stages[0].visual
}

export const VESSELS = VESSELS_BY_ID

/**
 * Which vessel is flown: `PERIAPSIS_VESSEL` under Node, `?vessel=` in a browser,
 * Apollo 8 otherwise. Read once, at load, because every stage figure is built
 * from it before anything flies — see `requested` for how each source fails.
 */
export const ACTIVE_VESSEL = requested('PERIAPSIS_VESSEL', 'vessel', VESSELS_BY_ID, 'apollo8', 'vessel')

/* Every stage must carry what the flight model reads off it. */
for (const [id, v] of Object.entries(VESSELS)) {
  v.stages.forEach((s, i) => {
    for (const key of ['name', 'dryMass', 'propellant', 'thrust', 'isp', 'drag', 'visual']) {
      if (s[key] === undefined) throw new Error(`${id} stage ${i} (${s.name}) has no ${key}`)
    }
  })
  // The last stage is what comes home, so it is the one entry needs a lift
  // vector and a parachute from.
  const last = v.stages.at(-1)
  if (!(last.drag.ld > 0)) throw new Error(`${id}: the re-entry stage has no lift-to-drag`)
  if (last.propellant !== 0) throw new Error(`${id}: the re-entry stage should be ballistic`)
}
