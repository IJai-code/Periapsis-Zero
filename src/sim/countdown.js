/**
 * The last minute on the pad, as a timeline.
 *
 * A launch is not a switch. The minute before it is the most orchestrated
 * sixty seconds of the whole mission: the tanks are still being topped and the
 * liquid oxygen boils off through vents in plumes you can see from miles away;
 * the swing arms carrying propellant and power pull back from the hull; water
 * floods the pad so the sound of the engines does not shake the vehicle apart;
 * the engines light while the vehicle is still held down, so it can be
 * shut down if they do not all come up; and only then do the hold-downs let go.
 *
 * Everything here is a pure function of one number, `T`: seconds relative to
 * release, negative before it. No state, no allocation, nothing that can drift
 * — the renderer asks "how far is the arm swung at T" and gets the same answer
 * the gate does. The mission supplies T; nothing here keeps a clock.
 *
 * ── what this is and is not ───────────────────────────────────────────
 *
 * It is a *presented* sequence, run only when a mission is started from the
 * pad for someone to watch. The flights the verification suite pins —
 * `verify-loiter`'s lifetimes, `verify-radial`'s arcs, `verify-heating`'s
 * corridor — launch the way they always have, with full thrust arriving at
 * release. Burning on the pad costs propellant (below), so running this in
 * every flight would move every one of those verified numbers for no gain in
 * what they test. The sequence is real; it is scoped to where it is seen.
 *
 * The event times are the ones the directive for this feature specified —
 * arms at T-10, deluge at T-6, ignition at T-3 — and are data rather than
 * physics, so they live in one table. For the record, and from recollection
 * rather than a source checked here: the real Saturn V started its ignition
 * sequence nearer T-9 and brought the five F-1s up in a staggered 1-2-2 order.
 * If that is wanted, it is one number.
 */

/** Length of the presented count, s. The harness keeps its own ten. */
export const COUNT_LENGTH = 60

/** The events, in seconds relative to release. */
export const EVENTS = Object.freeze({
  /** LOX boil-off is vented from the start of the count until the tanks are pressurised. */
  ventStart: -60,
  ventEnd: -8,
  /** Swing arms begin to retract, and take this long to swing clear. */
  armsAway: -10,
  armSwing: 5,
  /** Sound-suppression water comes on. */
  deluge: -6,
  /** Main engine ignition, still held down. */
  ignition: -3,
  /** Seconds for the engines to come up to full thrust. */
  spinUp: 2.4,
  /** Hold-downs release. */
  release: 0,
})

/** Clamp to [0, 1] without allocating or branching on NaN. */
const unit = (x) => (x > 0 ? (x < 1 ? x : 1) : 0)

/** Smooth 0 → 1 across [a, b]: zero slope at both ends, so nothing starts or stops with a jerk. */
const ease = (x, a, b) => {
  const t = unit((x - a) / (b - a))
  return t * t * (3 - 2 * t)
}

/**
 * How hard the LOX vents are running, 0 to 1.
 *
 * Full through the hold, then falling away over the last couple of seconds as
 * the tanks are closed up and pressurised for flight — vents that are still
 * pouring vapour at ignition would mean the tank was not pressurised.
 */
export function ventLevel(T) {
  return unit((EVENTS.ventEnd - T) / 2) * (T >= EVENTS.ventStart ? 1 : 0)
}

/**
 * How far the swing arms have retracted, 0 (mated) to 1 (swung clear).
 *
 * Eased, because a 20-tonne arm on a hinge accelerates and decelerates rather
 * than jumping to a rate — and a linear ramp reads as a mechanical toy.
 */
export function armRetraction(T) {
  return ease(T, EVENTS.armsAway, EVENTS.armsAway + EVENTS.armSwing)
}

/**
 * How much deluge water is flowing, 0 to 1.
 *
 * On at T-6 and ramping to full over two seconds, then held through liftoff
 * and for fifteen seconds after — the water is there to absorb the acoustic
 * load of the exhaust reflecting off the pad, and that load is worst in the
 * seconds after release while the engines are still close to the ground.
 */
export function delugeLevel(T) {
  const on = ease(T, EVENTS.deluge, EVENTS.deluge + 2)
  const off = 1 - ease(T, 15, 25)
  return on * off
}

/**
 * The engines' throttle while held down, 0 to 1.
 *
 * Zero until ignition, then a smoothstep to full over `spinUp` — the
 * turbopumps have to come up to speed, and an engine does not produce full
 * thrust the instant its valves open. Reaches 1 before release, so the vehicle
 * leaves the pad at full thrust rather than still spooling.
 */
export function ignitionThrottle(T) {
  return ease(T, EVENTS.ignition, EVENTS.ignition + EVENTS.spinUp)
}

/**
 * How much steam the pad is making, 0 to 1.
 *
 * Steam is exhaust meeting deluge water, so it needs both: the product of the
 * two, and it keeps rising after release as the plume digs into the trench.
 * With no water it is zero however hard the engines burn — which is the honest
 * reading, and the reason the deluge exists.
 */
export function steamLevel(T, throttle) {
  return delugeLevel(T) * unit(throttle * 1.25)
}

/** The event that most recently happened at T, for commentary to name. */
export function stageOfCount(T) {
  if (T >= EVENTS.release) return 'release'
  if (T >= EVENTS.ignition) return 'ignition'
  if (T >= EVENTS.deluge) return 'deluge'
  if (T >= EVENTS.armsAway) return 'arms'
  return 'hold'
}
