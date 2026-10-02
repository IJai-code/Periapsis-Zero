import { BODIES, G } from './constants.js'
import { RAILS } from './rails.js'

/**
 * Boots on the ground: standing on a world, and moving about on it.
 *
 * Every other viewpoint in this simulator is a camera — a chase behind a hull,
 * a tracking lens on a pad, a free camera that crosses an astronomical unit in
 * forty-seven seconds. This one is a *body*: it has mass it cannot ignore, feet
 * that can only push as hard as friction lets them, and legs of a fixed length.
 * It falls when it is not held up, and what it feels like is decided entirely by
 * which world it is standing on.
 *
 * That is the whole design. There is not one number in this file chosen to make
 * walking feel a particular way; there are four measurements about a human
 * being, and everything else is the world's own gravity acting on them. A step
 * on Mars and a step on the Moon differ because Mars pulls at 3.73 m/s² and the
 * Moon at 1.63, and for no other reason.
 *
 * ── the four human numbers ────────────────────────────────────────────
 *
 * **Take-off speed.** A standing vertical jump raises an adult's centre of mass
 * about 0.40 m on Earth, which needs v = sqrt(2 g h) = 2.80 m/s off the ground.
 * That speed is a property of legs, not of planets — the same push everywhere —
 * so the *height* it buys is v²/2g and the hang time 2v/g. On the Moon that is
 * 2.41 m and three and a half seconds in the air. On Halley's comet it is more
 * than escape velocity, and the jump does not come back.
 *
 * **Leg length.** About 0.9 m, hip to sole. It sets the fastest a person can
 * *walk*, as opposed to run: in a walking gait the body vaults over a straight
 * leg, and it stays on the ground only while the centripetal demand v²/L is
 * under the gravity holding it there. The dimensionless group is the Froude
 * number, Fr = v²/(gL), and the walk-run transition is Fr ≈ 1 in every
 * measurement anyone has made of it, in people and in other animals.
 *
 *   v_walk = sqrt(g L)
 *
 * On Earth that is 2.97 m/s. On the Moon it is **1.21 m/s** — slower than a
 * stroll — and that is not a rule invented here, it is why the Apollo crews
 * gave up walking and hopped. Getting that out of the simulator for free, from
 * two measurements and a square root, is the reason this file exists.
 *
 * **Boot friction.** Call it 0.6 on rock and regolith. Horizontal acceleration
 * on foot cannot exceed what friction can transmit, a = mu g, so a sixth of the
 * gravity is a sixth of the grip: 5.9 m/s² on Earth and 0.98 on the Moon. It is
 * why low gravity feels like ice — not slippery, but slow to start and slow to
 * stop, with turns that have to be planned.
 *
 * **Eye height.** 1.68 m, the same figure `gfx/groundView.js` stands its
 * observer at, so a person who walks away from the launch viewpoint sees the
 * pad from the height they were just seeing it from.
 *
 * ── what this deliberately does not model ─────────────────────────────
 *
 * A pressure suit. Apollo crews were carrying 90 kg of suit and backpack at a
 * sixth of Earth's weight, and the suit's own stiffness — not gravity — is what
 * kept their jumps under a metre. Modelling that would make every world feel
 * like the Moon, which is the opposite of the point: this is a person in
 * shirtsleeves who has been put somewhere impossible, and the impossibility is
 * the subject.
 */

/** Rise of an adult's centre of mass in a standing vertical jump, m. */
const JUMP_RISE = 0.4
/** And therefore the speed the legs leave the ground at, m/s. Earth's g, once. */
export const TAKEOFF = Math.sqrt(2 * 9.80665 * JUMP_RISE)

/** Hip to sole, m: the pendulum a walking gait vaults over. */
export const LEG = 0.9
/** Coefficient of friction, boot on rock or regolith. */
export const MU = 0.6
/** Eye above the soles, m — the same standing height `gfx/groundView.js` uses. */
export const EYE = 1.68

/**
 * Every world with a surface to stand on, by id: its mass and its radius.
 *
 * Both registries, because the simulator keeps its integrated bodies in
 * `constants.js` and its rail planets and moons in `rails.js`, and a person
 * standing on Europa does not care which array it came out of. The Sun is
 * excluded for the obvious reason.
 */
export const GROUNDS = (() => {
  const out = {}
  for (const id of ['earth', 'moon']) {
    const b = BODIES[id]
    if (b?.mass && b?.radius) out[id] = { mass: b.mass, radius: b.radius }
  }
  for (const r of RAILS) {
    if (r.mass && r.radius) out[r.id] = { mass: r.mass, radius: r.radius }
  }
  return out
})()

/** Is this a world a person could be put down on? */
export const standable = (id) => Object.prototype.hasOwnProperty.call(GROUNDS, id)

/** Surface gravity, m/s². */
export function surfaceGravity(id) {
  const b = GROUNDS[id]
  return b ? (G * b.mass) / (b.radius * b.radius) : 0
}

/** Escape speed from the surface, m/s. */
export function escapeSpeed(id) {
  const b = GROUNDS[id]
  return b ? Math.sqrt((2 * G * b.mass) / b.radius) : 0
}

/** The fastest a person can walk here before the gait has to break, m/s. */
export const walkSpeed = (g) => Math.sqrt(Math.max(g, 0) * LEG)

/** The hardest a foot can push horizontally here, m/s². */
export const footAcceleration = (g) => MU * g

/** How high a standing jump reaches here, m, and how long it lasts, s. */
export const jumpHeight = (g) => (g > 0 ? (TAKEOFF * TAKEOFF) / (2 * g) : Infinity)
export const jumpTime = (g) => (g > 0 ? (2 * TAKEOFF) / g : Infinity)

/**
 * One step of the walker, in the tangent plane of wherever it is standing.
 *
 * `state` is mutated in place and holds no vectors: two tangent speeds, a
 * radial one, and a height above the ground. The caller owns the frame — it
 * knows which way is up and where the ground is — and this owns the physics.
 * Nothing is allocated.
 *
 * @param {object} state  {east, north, up, height, onGround, airborne}
 * @param {number} dt     seconds, already clamped by the caller
 * @param {number} g      surface gravity here, m/s²
 * @param {number} wantE  desired tangent direction, east component, unit-ish
 * @param {number} wantN  and north
 * @param {boolean} jump  the jump key is down
 * @param {number} ground height of the ground under the walker, m
 */
export function stepWalk(state, dt, g, wantE, wantN, jump, ground = 0) {
  const top = walkSpeed(g)
  const grip = footAcceleration(g)

  // Where the feet are trying to get to. A direction, at the fastest this
  // world allows a gait to carry a person.
  const want = Math.hypot(wantE, wantN)
  const targetE = want > 0 ? (wantE / want) * top : 0
  const targetN = want > 0 ? (wantN / want) * top : 0

  /*
   * Feet can only push while they are on the ground, and only as hard as
   * friction allows. In the air there is nothing to push against at all —
   * no mid-air steering, which is the single most important thing about
   * moving in low gravity and the thing every game gets wrong.
   */
  if (state.onGround) {
    const dE = targetE - state.east
    const dN = targetN - state.north
    const need = Math.hypot(dE, dN)
    const can = grip * dt
    if (need > 0) {
      const k = need <= can ? 1 : can / need
      state.east += dE * k
      state.north += dN * k
    }
    if (jump) {
      state.up = TAKEOFF
      state.onGround = false
    }
  }

  // Gravity, always.
  state.up -= g * dt
  state.height += state.up * dt

  // The ground stops the fall. Landing keeps horizontal speed — a person who
  // lands running is still running — and gives up the vertical.
  if (state.height <= ground) {
    state.height = ground
    if (state.up < 0) state.up = 0
    state.onGround = true
  } else {
    state.onGround = false
  }
  return state
}

/** A walker at rest on the ground. */
export const restingWalker = () => ({ east: 0, north: 0, up: 0, height: 0, onGround: true })

/**
 * Has this walker left for good?
 *
 * On a small enough body a jump is an escape trajectory, and the honest answer
 * is to say so rather than to quietly cap the jump. `speed` is the total speed
 * relative to the body's centre.
 */
export const escaping = (id, speed) => speed >= escapeSpeed(id)
