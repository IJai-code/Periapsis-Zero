/**
 * The Almanac: missions the sky writes.
 *
 * Every board in this product lists work a person invented. This one is
 * generated from the solar system as it actually stands: the gap between the
 * vehicle and the station *right now*, how far out the Moon is *this hour*,
 * whether an eclipse is in the sky *at this moment*. Read the board on
 * another night and the numbers are different, because the sky is different.
 * That is the game half of this simulator: quests written by ephemeris
 * rather than by a designer, on a world that is honest about its own scale.
 *
 * What comes out is a program like any other: legs priced against the stack
 * by the rocket equation, objectives from the same vocabulary every gate
 * holds, the same checklist on the rail. Nothing here is scored, nothing
 * shoots at anybody; the work of spaceflight is the game.
 *
 * Pure by construction: the caller passes the sky in (`skyOf` reads the live
 * state at boot), so `verify-programs` holds the generator to its own
 * arithmetic with a fixed sky and can catch a briefing that lies about the
 * number it names.
 */

/**
 * A briefing's raw sky: three measurements and a fact.
 * All distances in metres, exactly as the integrator carries them.
 */
export function skyOf(live, INDEX) {
  const s = live.sim.state
  const ship = INDEX.ship * 6
  const iss = INDEX.iss * 6
  const moon = INDEX.moon * 6
  const earth = INDEX.earth * 6
  return {
    issGap: Math.hypot(s[ship] - s[iss], s[ship + 1] - s[iss + 1], s[ship + 2] - s[iss + 2]),
    moonSpan: Math.hypot(
      s[moon] - s[earth],
      s[moon + 1] - s[earth + 1],
      s[moon + 2] - s[earth + 2],
    ),
    eclipse: Boolean(live.eclipse),
  }
}

/** Round a distance to whole kilometres the way a brief would quote it. */
const km = (m) => Math.round(m / 1000)

/**
 * The board, written from the sky passed in.
 *
 * Every number quoted in a brief is computed here and carried again in the
 * objective it names, so the gate can hold one against the other: a brief
 * that says "close to within 34,200 km" arms an objective measured at
 * 34,200 km, and both come from the same line of arithmetic.
 */
export function almanacBriefings(sky) {
  const gapKm = km(sky.issGap)
  const closeKm = Math.max(5, Math.round(gapKm * 0.15))
  const moonKm = km(sky.moonSpan)
  const highKm = Math.round(moonKm * 0.55)

  const briefings = [
    {
      id: 'almanac-gap',
      name: 'Close the Gap',
      group: 'Almanac',
      almanac: true,
      brief: `The station stands ${gapKm.toLocaleString('en-US')} km away right now, and the gap is closing only because both of you are falling. Close to within ${closeKm.toLocaleString('en-US')} km: phasing is the work, and it is flown at the launch window, not at the throttle.`,
      vessel: 'apollo8',
      sites: ['ksc', 'kourou', 'baikonur', 'vandenberg'],
      target: 'earth-orbit',
      wings: ['trainee', 'aviator', 'aldrin'],
      legs: [
        { name: 'Ascent to parking orbit', dv: 9_400 },
        { name: 'Phasing burns', dv: 120 },
      ],
      objectives: [
        { id: 'orbit', label: 'Reach a parking orbit', check: 'orbit' },
        {
          id: 'close',
          label: `Close to within ${closeKm.toLocaleString('en-US')} km of the station`,
          check: 'proximity',
          body: 'iss',
          km: closeKm,
        },
      ],
      basis: { gapKm, closeKm },
      order: 1,
    },
    {
      id: 'almanac-high',
      name: 'The High Ground',
      group: 'Almanac',
      almanac: true,
      brief: `The Moon stands ${moonKm.toLocaleString('en-US')} km out tonight, which is the ruler this brief is written with. Raise apoapsis past ${highKm.toLocaleString('en-US')} km, a little over half that span, and look back at a planet that stops being a place and becomes a body.`,
      vessel: 'apollo8',
      sites: ['ksc', 'kourou', 'baikonur', 'vandenberg'],
      target: 'earth-orbit',
      wings: ['trainee', 'aviator', 'aldrin'],
      legs: [
        { name: 'Ascent to parking orbit', dv: 9_400 },
        { name: 'Raise the ellipse', dv: 2_400 },
      ],
      objectives: [
        { id: 'orbit', label: 'Reach a parking orbit', check: 'orbit' },
        {
          id: 'high',
          label: `Raise apoapsis past ${highKm.toLocaleString('en-US')} km`,
          check: 'apoapsis',
          km: highKm,
        },
      ],
      basis: { moonKm, highKm },
      order: 2,
    },
    {
      id: 'almanac-crossing',
      name: "Tonight's Crossing",
      group: 'Almanac',
      almanac: true,
      brief: `Injected tonight, the Moon does the navigating: ${moonKm.toLocaleString('en-US')} km of falling toward a body that is moving too. Cross into its reach and let its gravity finish the approach. The burn commits you.`,
      vessel: 'apollo8',
      sites: ['ksc', 'kourou', 'baikonur', 'vandenberg'],
      target: 'free-return',
      wings: ['trainee', 'aviator', 'aldrin'],
      legs: [
        { name: 'Ascent to parking orbit', dv: 9_400 },
        { name: 'Trans-lunar injection', dv: 3_050 },
        { name: 'Mid-course corrections', dv: 60 },
      ],
      objectives: [
        { id: 'orbit', label: 'Reach a parking orbit', check: 'orbit' },
        { id: 'tli', label: 'Injected toward the Moon', check: 'tli' },
        { id: 'soi', label: "Into the Moon's reach", check: 'lunarSoi' },
      ],
      basis: { moonKm },
      order: 3,
    },
  ]

  /*
   * An eclipse is happening *now*. This one is generated only when the sky
   * actually holds one, which is most of the honesty of the board: a briefing
   * offered every day for an event that happens twice a year is a board that
   * lies. The check is what the simulator saw through the shutter.
   */
  if (sky.eclipse) {
    briefings.push({
      id: 'almanac-shadows',
      name: 'The Shadows',
      group: 'Almanac',
      almanac: true,
      brief: 'There is an eclipse in the sky this moment, and it will not wait for a launch window. Get above the weather and photograph it: the plate is the record of a geometry that is over in minutes.',
      vessel: 'apollo8',
      sites: ['ksc', 'kourou', 'baikonur', 'vandenberg'],
      target: 'earth-orbit',
      wings: ['trainee', 'aviator', 'aldrin'],
      legs: [{ name: 'Ascent to parking orbit', dv: 9_400 }],
      objectives: [{ id: 'shadow', label: 'Photograph the eclipse', check: 'eclipsePlate' }],
      basis: { eclipse: true },
      order: 4,
    })
  }

  return briefings
}
