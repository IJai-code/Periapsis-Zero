/**
 * Whether the camera is between two views right now, for anyone who has to
 * behave differently while it is.
 *
 * The floating origin is the reader that matters. It is normally pinned to the
 * body the camera is locked onto, and during a move between two bodies that is
 * the destination — which, crossing from Earth to Neptune, sits 4.3e12 m from
 * the camera at the start of the move, where a float32 `cameraPosition` is good
 * to half a megametre. So while a move is in progress the origin rides the
 * camera instead, and hands back to the body when the move lands. The rig
 * writes this; the driver reads it.
 */
export const TRANSIT = {
  active: false,
  /** 0 → 1 over the move, eased. For anything that wants to fade with it. */
  progress: 1,
  /** The focus being travelled to. */
  to: null,
  /**
   * Set by the driver just before it applies the director's shot, and read
   * once by the rig. A shot change during a mission is a cut in the film's
   * grammar, and however far apart the two frames are it has to be over while
   * the moment it cuts for is still happening — so the director's moves are
   * held to a few seconds, where a pilot's search may take its time.
   */
  quick: false,
  /**
   * Arrive rather than travel, once.
   *
   * A move between two views is a flight, and across the Galaxy that flight is
   * most of a minute — which is the right answer when a person chose the
   * destination and is watching the scale go by, and the wrong one when they
   * clicked a link somebody sent them. A link is a promise about where you
   * will be, not an invitation to a journey, so the rig treats a move marked
   * this way the way it treats its very first lock: it is simply there.
   *
   * Set immediately before the focus changes, and cleared by the rig when it
   * reads it, so it can never leak into the next move.
   */
  arrive: false,
}

/** Longest a director's move may take, s; and a pilot's. */
export const QUICK_MOVE = 3.2
export const PILOT_MOVE = 9
