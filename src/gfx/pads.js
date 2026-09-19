import { SECTIONS } from './hulls.js'
import { stageLength } from './framing.js'
import { ACTIVE_VESSEL } from '../sim/vessels.js'
import { ship } from '../sim/ship.js'
import { live } from '../sim/live.js'

/**
 * The pads, as dimensions.
 *
 * Nothing here is a mesh. This is the contract between the ground structure
 * (components/LaunchPad.jsx), the vehicle standing on it (components/Craft.jsx)
 * and the ground it is built on (components/Terrain.jsx): all three read the
 * same numbers, so the vehicle's base, the deck it stands on and the flattened
 * ground under the apron cannot drift apart. It is also what
 * scripts/verify-pads.mjs holds the geometry to.
 *
 * Everything is in metres in the pad's local frame — x east, y up, z north,
 * origin at the site's coordinates on the terrain datum — and everything that
 * scales with the vehicle is expressed against `L`, the full-stack length, so
 * the same pad fits a 110.6 m Saturn V and a 98.1 m SLS.
 *
 * **Why the vehicle needs lifting at all.** The integrator's ship state is the
 * centre of mass, and the pad clamp puts it at exactly one Earth radius, which
 * is also the terrain datum. The hull is drawn symmetrically about that point,
 * so with nothing else done a Saturn V stands with 55 m of first stage
 * underground — invisible while there was no ground, obvious the moment a
 * launch tower stood next to it. The physics is right: a vehicle's centre of
 * mass *is* half a stack above the pad. So the correction is visual and lives
 * here — the drawn hull is raised by half its length plus the height of the
 * deck it stands on, and that lift is faded out over the first few hundred
 * metres of flight, where the stack climbs far faster than the offset shrinks.
 * The clamp, the cameras' targets and every verify script see the same state
 * they always did.
 */

/**
 * Per-site pad. `deck` is the height of the surface the vehicle's base sits
 * on above the terrain datum — mound plus launch platform. `style` picks the
 * silhouette LaunchPad.jsx builds, and the rest are the dimensions that style
 * reads. Unspecified dimensions fall back to DEFAULT_PAD.
 */
export const PADS = {
  /**
   * LC-39B as Apollo left it: a raised pad with the flame trench cut through
   * it running north-south, the mobile launcher on top, and the umbilical
   * tower standing on the launcher's north end with its swing arms out to the
   * vehicle. The mound at 39A/B is about 15 m of fill; the launcher's deck
   * added another 7.6 m.
   */
  ksc: {
    deck: 14 + 7.6,
    mound: 14,
    platform: 7.6,
    style: 'umbilical',
    trench: 17.7, // width, m: the 39 trenches are 58 ft
    trenchAxis: 'ns',
    towerScale: 1.2, // tower height in stack lengths
    arms: 9,
    apron: 130, // half-side of the flat concrete apron, m
    steel: '#8e1c1c', // the LUT's primer red
    concrete: '#a8a49b',
  },
  /**
   * Gagarin's Start. No mound and no tower in the American sense — the pad
   * is a concrete apron cantilevered over an enormous flame pit, and the
   * vehicle is held up by four counterweighted trusses that tilt back like
   * petals as it lifts, which is why the Russians call the structure the
   * tulip. Two service masts stand off to either side.
   */
  baikonur: {
    deck: 4.5,
    mound: 0,
    platform: 4.5,
    style: 'tulip',
    trench: 0,
    trenchAxis: 'ns',
    pit: 60, // half-width of the pit opening, m
    towerScale: 0.62,
    apron: 110,
    steel: '#5d7a63', // Soviet gantry green
    concrete: '#a9a397',
  },
  /**
   * ELA-3 as Ariane 5 flew from it: a low pad with the trench under it, a
   * huge enclosed mobile gantry that rolls back before launch, an umbilical
   * mast beside the vehicle and four lightning masts round the apron.
   */
  kourou: {
    deck: 6 + 4,
    mound: 6,
    platform: 4,
    style: 'gantry',
    trench: 14,
    trenchAxis: 'ew',
    towerScale: 1.05,
    masts: 4,
    mastScale: 0.85,
    apron: 150,
    steel: '#d8d3c8', // the gantry's white cladding
    concrete: '#9d9a93',
  },
  /**
   * SLC-6, "Slick Six": built for a Shuttle that never flew from it. A tall
   * enclosed mobile service tower, a payload changeout room beside it, an
   * open access tower, and the trench running east-west toward the Pacific.
   */
  vandenberg: {
    deck: 6 + 5,
    mound: 6,
    platform: 5,
    style: 'service',
    trench: 16,
    trenchAxis: 'ew',
    towerScale: 0.92,
    arms: 6,
    apron: 140,
    steel: '#8b949c',
    concrete: '#a19c92',
  },
}

export const DEFAULT_PAD = PADS.ksc

/** The pad for a site, falling back to Kennedy for an id nothing knows. */
export const padFor = (siteId) => PADS[siteId] ?? DEFAULT_PAD

/**
 * The vehicle's footprint on the pad, from its own sections.
 *
 * `radius` is the core's, which sizes the hold-down ring and the exhaust
 * opening. `reach` is how far the widest thing on the vehicle sticks out from
 * its axis — for SLS that is the boosters, which Hull.jsx draws centred at
 * core radius + booster radius — and every structure has to stand off further
 * than that or the vehicle is drawn through it.
 */
export function vehicleFootprint(vessel = ACTIVE_VESSEL) {
  const sections = SECTIONS[vessel] ?? []
  // Sections run base-first, so the first thing in the stack that is not a
  // strap-on is the core the vehicle stands on — whatever stage index it
  // carries. On SLS the boosters are stage 0 and the core is stage 1.
  const bottom = sections.find((s) => s.kind !== 'boosters')
  const core = bottom ? bottom.diameter / 2 : 5
  let reach = core
  for (const s of sections) {
    // Hull.jsx centres a booster at core radius + its own, so its outer edge
    // is a full booster diameter out from the core's skin.
    if (s.kind === 'boosters') reach = Math.max(reach, core + s.diameter)
    else reach = Math.max(reach, s.diameter / 2)
  }
  return { radius: core, reach, length: stageLength(0) }
}

/**
 * Half-size of the launch platform's exhaust opening, m: wide enough that the
 * boosters clear it and the hold-downs still reach the core. The platform,
 * the hold-downs and every tower's standoff are measured from this.
 */
export const exhaustOpening = (foot) => Math.max(foot.radius * 1.8, foot.reach * 1.15)

/**
 * How far the drawn hull is raised above the ship state while the vehicle is
 * standing on its pad: half the stack, so the base is at the deck, plus the
 * deck itself. Constant per site — the vessel is fixed at load.
 */
export const hullLift = (siteId) => stageLength(0) / 2 + padFor(siteId).deck

/**
 * The lift, faded out with altitude, as a factor in [0, 1].
 *
 * Held at 1 through the first stack length of climb, then eased to 0 over the
 * next three. That is about 15 s of a Saturn V's ascent, during which the
 * vehicle rises 440 m and the drawn hull slides 77 m back toward the state it
 * was raised from — a drift of a sixth of the motion, and against a pad camera
 * whose lens is opening at the same time it is not visible. It is a smoothstep
 * rather than a linear ramp so the slide begins and ends at zero rate; a
 * kink in the hull's apparent acceleration is exactly what the eye picks out.
 *
 * `altitude` is the state's altitude above the mean sphere, which is 0 on the
 * pad by construction of the clamp. Pure and allocation-free: read once per
 * frame.
 */
export const LIFT_HOLD = 1 // stack lengths of climb before the fade starts
export const LIFT_FADE = 3 // stack lengths the fade takes

export function liftFactor(altitude) {
  const L = stageLength(0)
  const t = (altitude - LIFT_HOLD * L) / (LIFT_FADE * L)
  if (t <= 0) return 1
  if (t >= 1) return 0
  return 1 - t * t * (3 - 2 * t)
}

/**
 * The lift to draw the hull with this frame, metres along the body axis.
 *
 * Only the full stack is ever on a pad, so the first staging ends it outright;
 * before that it fades with altitude. Read by the hull and by the pad camera's
 * aim, so the two agree on where the vehicle is drawn. Allocation-free.
 */
export function currentHullLift(siteId) {
  if (ship.stage !== 0) return 0
  return hullLift(siteId) * liftFactor(live.elements.altitude)
}

/**
 * Radius around the pad within which the terrain is flattened to the datum,
 * metres. Real launch complexes are graded flat for exactly this reason, and
 * a mound standing on a 130 m-sampled heightfield would otherwise sit on
 * whichever slope the nearest sample happened to carry. Comfortably larger
 * than any apron above, so nothing structural ever meets unflattened ground.
 */
export const FLAT_RADIUS = 400
