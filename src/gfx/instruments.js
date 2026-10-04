import { live } from '../sim/live.js'
import { ship } from '../sim/ship.js'
import { currentPhase } from '../sim/mission.js'

/**
 * When the pilot's instruments belong in the frame, and when they are scratches
 * on a photograph.
 *
 * A trail, a predicted path and an osculating conic are drawn as additive
 * hairlines across the whole sky, which is right when the subject of the shot
 * is an orbit and wrong when it is a vehicle leaving a pad. Watched from the
 * chase camera on an Earth launch, the frame carried Earth's heliocentric
 * trail, the Moon's geocentric one, the ISS's and Hubble's, the forward
 * projection and the osculating ellipse — six lines in six unrelated
 * directions, drawn over a blue sky, none of them about the rocket climbing
 * through it. `Scene.jsx` already keeps them off the ground view, the lunar
 * chase, the intro, the broadcast and every deep-sky shot; the ascent was the
 * gap, because a non-lunar chase camera did not match any of those rules.
 *
 * Both tests below are about physics rather than taste, which is what makes
 * them safe to apply without a switch.
 */

/**
 * The top of the sky, in metres.
 *
 * The scattering that makes a sky is Rayleigh scattering in a layer with a
 * scale height of about 8.5 km, so the sky's surface brightness falls as
 * exp(-h/H): it is 1% of its sea-level value at 4.6 scale heights, or 39 km.
 * That is the altitude balloon crews describe the sky going black at and the
 * stars coming out in daylight, and it is the altitude above which an
 * additive hairline is drawn on black rather than on a photograph.
 */
export const SKY_TOP = 40e3

/**
 * Is the camera inside a sky?
 *
 * Read off `live.nearest`, which the driver computes from the camera every
 * frame as the distance to the nearest *surface* — so this is an altitude,
 * and it costs a comparison. Only Earth has one: the Moon's sky is black from
 * the ground up, which is exactly why the lunar chase needed its own rule.
 */
export function underSky() {
  return live.nearest.id === 'earth' && live.nearest.distance < SKY_TOP
}

/**
 * How hard the vehicle is being pushed by something other than gravity, in g.
 *
 * Thrust over mass plus the aerodynamic load the atmosphere model already
 * works out for the drag term. Both are accelerations the two-body problem
 * does not contain.
 */
export function nonGravityG() {
  const push = ship.mass > 0 ? ship.thrust / ship.mass / 9.80665 : 0
  return push + Math.abs(live.decelG)
}

/**
 * Above this, in g, the craft is not falling freely and its osculating conic
 * is not an orbit.
 *
 * An osculating conic is defined as the orbit the craft *would keep* if every
 * body but one vanished — which presumes it is in free fall. Under a Saturn
 * V's first stage it is not: the conic is recomputed every frame from a state
 * being driven hard across it, so it swings from a shallow ellipse through a
 * hyperbola and back within a second, and what the screen shows is a line
 * thrashing about a rocket. A tenth of a g is two orders below the 1.15 g a
 * Saturn V leaves the pad at and an order below the drag peak on an entry, so
 * it separates powered and braking flight from coasting without argument, and
 * a coast with the RCS trimming attitude stays on the coasting side of it.
 */
export const FREE_FALL_G = 0.1

/** Is the craft falling freely, so that a conic about one body means anything? */
export const freeFall = () => nonGravityG() < FREE_FALL_G

/**
 * Is the vehicle still held on its pad?
 *
 * A clamped vehicle is not on an orbit at all: projected ballistically from the
 * pad its "path" dives into the planet at once, so the predicted line, its
 * apsis tags and the osculating label all collapse onto the launch site and
 * pile up as overlapping text in the middle of the planet. Measured on the
 * simulator's opening view at T-10 s, the tags read "RP" and "OSCULATING"
 * stacked over each other on Terra. There is nothing to draw until release.
 */
export const onPad = () => Boolean(currentPhase()?.clamped)
