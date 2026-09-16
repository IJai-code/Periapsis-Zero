# SpxSim — Sol · Terra · Luna

A real-time three-body simulation of the Sun, Earth and Moon, integrated with a
4th-order Runge-Kutta scheme and rendered with React Three Fiber.

```bash
npm install
npm run dev
```

Then open <http://localhost:5173>. The front door is the simulation — the
planet behind the text is the live scene at the real sun angle, and *Begin
flight* hands you that camera rather than loading anything. <http://localhost:5173/#flight>
goes straight in.

There used to be a separate `landing.html`. It had to be found at its own URL,
went stale whenever the scene changed, and made a promise the simulator then had
to keep somewhere else.

Real NASA imagery is what you get: Blue Marble, Black Marble and the CGI Moon
Kit, committed in `public/textures/` and loaded at startup. There is no switch
for it — it used to be one, which meant the simulator looked like its own
fallback to anyone who did not go hunting through a render panel.

The 13 MB is committed rather than fetched because the two Moon maps are
converted from TIFF with `sips`, which is macOS-only; downloading them is not
reproducible on Linux or Windows, and the failure is silent.

Underneath it there is still a complete procedural set, synthesised in a Web
Worker at load, and the two are layered rather than swapped. Any slot without a
real image keeps its generated version, so a partial download, an offline
machine or a fresh clone with no network all still fly — against generated
ground rather than photographed. The fetch cannot break the build for the same
reason; if it fails, the run continues.

One slot is never filled from the network: there is no public-domain Milky Way
panorama among the sources, so the skybox is always the procedural one unless
you supply `milkyway.jpg` yourself. See
[public/textures/README.md](public/textures/README.md) for the file names.

## Mission profile

The sequencer flies the whole thing hands-off from the pad. Every figure below
is measured from an actual run, not estimated.

| Phase | Trigger to leave | Result |
| --- | --- | --- |
| `PRE_LAUNCH` | countdown | clamped to Kennedy LC-39B, 28.58° N, `q` = 0 by construction |
| `LIFTOFF` | 600 m | SLS Block 1, 2561 t, TWR 1.568 |
| `PITCH_KICK` | 2 km | 3° off vertical, orbital plane frozen |
| `GRAVITY_TURN` | perigee ≥ 150 km | pitch scheduled on **velocity**; Max-Q 25.3 kPa |
| `STAGING` | 2.5 s | interrupt, not a step — returns to whatever it preempted |
| `MECO` | 3 s | T+483 s (real SLS core MECO ≈ T+480 s) |
| `COAST_TO_APOAPSIS` | t ≤ ½ burn | warp ladder 3600× → 60× → 1× |
| `CIRCULARISE` | eccentricity minimum | 7841 × 7845 km, **e = 0.00012** |
| `TLI_ALIGN` | phase angle + node | 3D nodal window, not planar phase alone |
| `TLI_BURN` | apoapsis ≥ lunar radius | ~2084 m/s |
| `TRANS_LUNAR` | TLI + 24 h | cheapest correction point, measured |
| `MCC_SOLVE` | pointing < 0.005 rad | Gauss-Newton, minimum-norm, ~20 ms |
| `MCC_BURN` | burnout mass | 74.35 m/s solved, delivered to 0.018 m/s |
| `LUNAR_APPROACH` | periapsis within a burn lead | enters the lunar SOI, 98.35 km periapsis |
| `LOI_ALIGN` | pointing < 0.005 rad **and** the clock | 180° flip in 20.9 s, held 39 s |
| `LOI_BURN` | **selenocentric eccentricity minimum** | 818.3 m/s over 149.4 s |
| `LUNAR_ORBIT` | one revolution | **88.5 × 105.7 km, e = 0.0047**, period 117.49 min |
| `TEI_ALIGN` | departure asymptote + pointing | waits 81.1 min for the window |
| `TEI_BURN` | **selenocentric C3 target** | 829.9 m/s over 413.9 s |
| `TRANS_EARTH` | TEI + 12 h, then 120 km | 4.9-day return |
| `EI_SOLVE` | pointing < 0.005 rad | Gauss-Newton, 11 iterations |
| `EI_BURN` | burnout mass | **23.02 m/s** |
| `SM_SEP` | 2 s | ESM discarded at 120 km |
| `RE_ENTRY` | 8 km **and** subsonic | 10.533 km/s at the interface, guided to **6.28 g** |
| `DROGUE` | 3 km | Mach 0.50, 155 m/s |
| `MAIN_CHUTES` | surface | 53 m/s at deployment |
| `SPLASHDOWN` | — | **8.44 m/s descent rate** |

Delta-v remaining in lunar orbit: **2,719 m/s**, all of it on the Orion ESM —
the ICPS ends the insertion with 73 kg in it. Pad to splashdown is **18.81
days**, hands off throughout.

Every row is reproducible from the command line:

```bash
node scripts/flight.mjs --until LUNAR_ORBIT
```

### The six results worth not re-deriving

**Recovering the branch of E from the radial velocity sign.** `acos` cannot
distinguish an outbound leg from an inbound one, so time-to-apoapsis needs
`if (radialVelocity < 0) E = 2π − E`. Without it the clock is right for half
of every orbit and wrong for the other half. Verified exact against Kepler at
every point, to 0.0001 s.

**Escaping the planar phase-angle trap.** A phase angle alone puts the craft at
the Moon's *radius* at the right *time* and still misses, because apoapsis lies
in the craft's plane and the Moon lies in its own — 39.5° apart here. The two
coincide only on the line of nodes, so the window needs **both** the phase angle
and a node crossing, and the burn is placed so apoapsis lands on the opposite
node.

**Anchoring the LVLH frame on velocity, not position.** The textbook triad pairs
radial with prograde directly. A day after injection the craft is climbing
almost straight out and those two are nearly parallel — a Jacobian conditioned
on them is degenerate exactly where the solve happens. Building the triad from
`v̂`, `ĥ = r × v`, `ĥ × v̂` keeps all three axes independent.

**Slew-rate pointing gates before ignition.** The autopilot slews at 0.15 rad/s
and the MCC is a ~15 s burn. Igniting on a fixed one-second pause sprayed the
impulse across a wide arc while still rotating and flew to 35,968 km instead of
1,837 — a correct solve, wrongly delivered. Every commanded burn now waits on
`forward.angleTo(target) < 0.005` with a timeout backstop.

**Cutting off on a turning point, not a target value.** A prograde burn at
apoapsis drives eccentricity through a *minimum*. Watching for the turn is
self-correcting: it lands on the roundest orbit the vehicle can actually reach
and cannot overshoot into a worse one. The same shape applies to any burn whose
objective is extremal rather than a threshold — the lunar capture below is the
second instance, and there the turn carries a second meaning as well.

**Osculating elements about the wrong body are a fiction, not an approximation.**
The selenocentric conic is only a trajectory while the Moon is the dominant
attractor. On this approach it reported a 187,143 km lunar periapsis 71 hours
out — while the craft was still 286,000 km from the Moon and firmly Earth's.
Anything reading those elements has to be gated on the sphere of influence,
which is 68,766 km here and computed from the live separation, because the
Moon's distance in this simulation is emergent.

## Architectural constraints

These are not preferences. Breaking one has broken the simulation before.

**The render loop allocates nothing.** Verified by heap delta under
`--expose-gc`: −10 KB over 60,000 full frames of physics, rebase, Lagrange and
sequencing. Preallocated scratch vectors at module scope, flat `Float64Array`
state, no `.map`/`.filter`/destructuring in per-frame paths, no string building
below the HUD's own ~9 Hz refresh. One-shot solvers (targeting) are exempt and
run on phase entry, never in the loop.

Caveat, found later: a heap delta read after `gc()` measures what is *retained*,
and garbage is not retained — a projection made to allocate an object per
sample passed that gate at 0.02 KB. It was hiding real garbage: on V8 12.4
`Math.hypot` allocates on every call (56 B; `Math.sqrt` of the sum of squares,
0), and V8 drops an array's storage on `length = 0`. The planner — projection,
sphere test, gizmo — is now measured in bytes per call across the loop with
`scripts/allocation.mjs`, against a positive control; the figure above predates
that and the remaining paths still need re-measuring.

**A burn is measured against the body whose sphere of influence it happens in,
at its own instant, and the map and the flight computer ask with the same
function.** The map drew a capture burn against the Moon while the autopilot
flew it against Earth once already — 23.5° off retrograde, periselene 112.5 km
underground. Deciding "which body" from the craft's *present* position, or at
ignition, reintroduces the disagreement at every sphere boundary.

**A function call cannot carry a double for free.** Anything in a per-step or
per-frame path passes and returns its scalars through a preallocated
`Float64Array` slot, not as arguments and return values. A double crossing a
call boundary the optimiser does not inline comes back boxed as a heap number:
bisected on the forward projection, one small shared helper cost **32 B a step,
33 KB a projection**, and returning an angular rate cost another 16 KB. The same
call on the other side of the same rule would have put an allocation inside the
render loop.

A *rare* call is worse than a frequent one, and that is the counter-intuitive
half. The per-node vis-viva that reports what each burn leaves behind runs once
per projection, so its own call count never lifts it out of the tier where
intermediate doubles are boxed — some sixty of them, **1,088 B a call**, while
its caller was fully optimised around it. Passing only numbers and typed arrays
changed nothing, because the boxes are the callee's own; inlining it removed all
of them. Small arithmetic helpers that *are* hot enough to inline —
`timestepLimit`, `density` — measure zero. So this is a rule about what to
check, not a ban on factoring: measure with `bytesPerCall`, and reach for a slot
or for inlining only once the measurement says to.

**No `useFrame` subscriber may take a positive priority.** In R3F, any priority
above zero hands the render loop to that subscriber and `gl.render` is never
called again — the scene simply stops updating while every callback keeps
running, which reads as a frozen picture rather than an error. Driver's
nearest-surface pass hit this once; the node editor hit it a second time,
wanting to run after the camera rig. Anything needing this frame's camera
composes the matrices itself (`camera.updateMatrixWorld(true)`) and stays at
zero.

**The integrator's step ceiling lives on the instance, and knows about every
attractor.** `sim.maxDt` is refreshed each frame from the *fastest* craft in the
fleet. A caller who passes nothing gets the 900 s planetary default — eight steps
per revolution for low orbit, enough to tear a satellite off the planet. The same
trap exists one body over: a craft in a 100 km lunar orbit is 400,000 km from
Earth, so the geocentric form returns that same 900 s ceiling against a two-hour
orbit. The limit is therefore taken over Earth *and* the Moon, per craft, and the
tightest wins. Measured over ten revolutions of the achieved lunar orbit at
1 day/s:

| step | steps/rev | Δa | Δe |
| --- | --- | --- | --- |
| 1440 s | 4.9 | −1814 km | 0.995 |
| 720 s | 9.8 | −548 km | 0.166 |
| 288 s | 24.5 | −3.6 km | 1.9e−5 |
| 96 s | 73.4 | −12 m | 1.7e−6 |
| ≤ 30 s | ≥ 235 | +2 m | 1.2e−6 |

Note the honest caveat: the live ceiling in that orbit is **13.86 s, set by the
ISS**, whose geocentric limit is tighter than the Moon's 17.50 s. So the lunar
term changes no number today — it removes the dependence of lunar-orbit fidelity
on an unrelated satellite in low Earth orbit.

**A vehicle inside a planet stops the run.** `updateMission` checks height above
the nearest body before any phase steers, and a craft below the surface goes to
`LOST` and holds. Not a `done()` on the phases that can reach it: the phase that
needed it was `TLI_ALIGN`, a coast that does nothing but wait, which is the last
place anyone would have put a crash test. Without it a decayed parking orbit
integrated down to `r = 0` and the sequencer flew the corpse for another 32
hours, ran a translunar injection from Earth's centre, and produced a delta-v
number that was believed and written down. The descent phases carry
`landing: true`, because `MAIN_CHUTES` reaches zero altitude on purpose and the
guard would otherwise report every returning capsule lost one frame before it
splashed.

**A gate that cannot run is worse than a gate that fails.** `verify-loi-sweep`
declared `const WARP = 4` beside an imported `WARP`, and had been a syntax error
since 72a3f56 — the commit that added rungs to the warp ladder, after which the
literal `4` no longer meant the 1 day/s its own comment claimed. Nobody noticed,
because nothing runs it: it takes two snapshot arguments, and its usage line
named one. When it was repaired it turned out to have been measuring a
trans-Earth injection rather than a coast — the sequencer departs at revolution
1.7 — so every row of a step-size experiment reported the same number, which is
exactly the tell. The step-ceiling table above is what it says once it runs.

**A planned burn is never stepped over.** The frame loop reads `stepCeiling`
from the sequencer before the sequencer runs, so no step carries the clock past
the moment a node has to start turning. Without it a node inside a 6 h/s coast
was caught only if a frame boundary landed in its one-minute alignment window,
and five placements in six were skipped. The ceiling and the preemption share one
definition of which node is next, `nodeAhead`, because a clock held still for a
node that nothing will hand over to — during staging, or with the vehicle lost —
is a deadlock.

**A burn cuts off once, and one shorter than a frame ends on its own mass.** The
halo maintenance pass cut off on `ship.thrust`, which is last frame's, so the
frame after a cutoff relit the engine: a 2.1e-6 m/s correction delivered 166 m/s
and put the craft into the Moon. And a 1x frame of the service module's engine is
0.0505 m/s, longer than most of those corrections, so each step of the burn is
held to the time left to its cutoff mass (see *Holding a halo orbit*).

**A reset discards the flight plan.** Node times are absolute simulated seconds
and a reset returns the clock to the epoch, so a plan that survives one is a set
of burns scheduled into the next flight.

**Test particles are structurally massless.** Tier one is pair-symmetric among
Sun/Earth/Moon; tier two reads gravity and writes none. The planetary solution
is bit-identical with the fleet aboard — verified, max difference exactly `0`.

**Finite burns straddle their target point.** Ignition is scheduled half a burn
early, from the rocket equation. A burn applied entirely after apoapsis raises
periapsis on one side only and leaves the orbit lopsided.

**Successors are named, never implied — and a cycle is still a named successor.**
`done()` may return `true`, which hands over to the phase's own `next()`, or a
**string** naming the successor directly, for the case where `done()` has already
worked out where to go and `next()` would only re-derive it. What it cannot do is
fall through to `index + 1`; a routing key that names nothing throws rather than
going somewhere adjacent. Holding an unstable orbit is a loop rather than a step,
and `NRHO_COAST ⇄ NRHO_STATION_KEEP` is the first one — but loops needed no new
mechanism, since a `next()` naming an earlier phase was always a cycle. That is
how `TRANS_EARTH` is flown twice.

**Successors are named, never implied.** `phase.next()` is explicit on every
phase. Falling through to `index + 1` lets array *layout* encode control flow,
which is how `STAGING` — an interrupt, not a step — once wedged itself between
the gravity turn and cutoff and ping-ponged forever.

**A frame's step is committed before the sequencer runs, so the sequencer cannot
be the only thing guarding it.** Burning under time compression hands out absurd
delta-v, so the driver drops to real time while the engines are lit. That check
used to read `ship.thrust`, which `applyThrust()` writes *later in the same
frame* — so it reported the previous frame, and the frame that actually lights
the engines escaped it entirely. A phase's `enter()` opens the throttle inside
`updateMission`, by which point `simDt` is already fixed: released from the
store's default of 1 day/s, liftoff integrated **1440 s of full-throttle SLS in
one step** and the vehicle left at 13.2 km/s on a heliocentric trajectory.

Three things now hold the invariant, and it needs all three. The test reads the
*commanded* throttle, which is current. The step itself is clamped where it is
used, since lowering the warp only reaches `rate` next frame — and the mission
clock is wound back by the same amount, so flight time and simulated time stay
one quantity. And the pilot's pre-burn warp is handed back only when the
sequencer is not asking for one, because restoring over the top of it dropped a
day-long step into the phase *after* cutoff: MECO's three-second hold became a
single frame and the mission clock jumped 24 minutes.

**An interrupt has to be transparent in all three directions.** `STAGING` was
only ever half of one. It substituted the *ascent pitch programme* for whatever
it preempted, which is invisible while separations only happen during ascent and
wrong the moment one does not; it suspended the preempted phase's `done()` for
2.5 s, which is several m/s of overshoot on a burn cutting off closed-loop; and
returning through `setPhase` re-ran the resumed phase's `enter()`, which is where
both the circularisation and capture burns initialise the eccentricity minimum
their cutoffs watch — so a separation after the turn would discard the very
observation being waited for. It now delegates control *and* the cutoff test to
the phase it preempted, and resumes without re-entering. The insertion burn
stages with about 18 m/s of margin against an 818 m/s burn, so this is not
hypothetical. Forced by shorting the stage, the capture still lands 74.2 × 114.3 km
with the thrust axis never more than 0.028 mrad off retrograde.

**HUD row keys must be unique.** The telemetry panel writes into DOM nodes
selected by `data-*` key; a duplicate silently leaves one field frozen, which
looks exactly like a stale value. `assertUniqueKeys` in `ShipTelemetry.jsx` runs
at module load over every row group and throws on a collision — keep it. It was
described here as existing for some time before it did; a comment cannot fail.

**The plane lock is ascent-only.** It holds the launch azimuth. Left engaged it
projects the out-of-plane component straight out of a mid-course correction,
which is where most of that burn lives.

**Patches assert their anchors.** Silent no-op string replacement has caused
four separate runtime failures in this codebase (`shells`, `this.maxDt`, the
mission import, the ship-import drift). Assert, then verify the identifier
actually landed.

## Controls

| Input           | Action                                              |
| --------------- | --------------------------------------------------- |
| drag / scroll   | orbit and zoom (damped)                              |
| `1` `2` `3` `4` | camera lock: free · Sol · Terra · Luna               |
| click a body    | lock onto it                                         |
| `space`         | pause                                                |
| `[` `]`         | time warp down / up                                  |
| `Enter`         | separate the burning stage                           |
| Start countdown | releases the pad hold; the autopilot flies the ascent |
| `h`             | hide the panels                                      |
| click the path  | plan a burn at that instant                          |
| drag a handle   | add delta-v along one axis of the orbital frame      |
| `shift` `ctrl`  | fine / coarse while dragging a handle                 |
| drag the centre | slide the burn along the orbit                       |
| `esc` `del`     | deselect / delete the selected node                  |
| click a plan row | open that burn and fly the camera to it             |
| `m`             | the map: pull back until the whole orbit is in frame  |

Locking flies the camera in over ~1.2s and then follows, translating the camera
and the orbit target by the same vector each frame — so your zoom and viewing
angle survive the body moving underneath you.

## Flight planning

The cyan line is where the craft goes if nothing is commanded; the amber one is
where the planned burns would take it. Both are the *same RK4* that flies the
mission — see `src/sim/predict.js` — so the map cannot disagree with the flight
about the physics, and it inherits every perturbation for free. A node is stored
as `{ t, prograde, normal, radial }`, which is what a burn *means*; the
sequencer picks up pending nodes on its own and flies them.

### How far it looks, and how finely it steps

Two separate questions, and answering them with one number is what broke four
different things. The horizon is an **event**: one revolution about the body the
craft orbits, counted from the last thing that changed the orbit — now, or the
last planned burn, after which the count restarts about *that* burn's body. It
ends earlier at any body's surface, and has a backstop of eight days and 8,192
integration steps for paths that never close. The step is the **local orbital
timescale**: the circular period at the craft's current distance over Earth and
the Moon, divided by 1,024, which is the criterion `timestepLimit` has always
given the flight integrator at 400 — plus the same 2%-per-step drag limit, so a
projected entry is stepped like a flown one.

Measured on a translunar-sized ellipse, e 0.916, over one revolution:

| | |
| --- | --- |
| 2,048 steps, each a fixed fraction of the period | **252.5 km** of error |
| 2,048 steps, each a fraction of the *local* period | **1.7 m** — what a 2 s fixed step gives at 53x the cost |
| the projection as built, 1,427 steps | **9.9 m** against a 0.5 s integration |
| halving the step | 17.8x better: fourth order, as RK4 should be |

The drawing is a separate budget from the integration: every step is kept, and
512 of them are chosen by how much the line turns there and how much time
passes, so half the points follow curvature and half follow the clock. Spreading
the same 512 points evenly in time instead draws a chord **31 km underground**
while every sample on it sits 168 km up — the projection's own lowest chord is
168.4 km against a lowest sample of 168.6 km.

What that buys, end to end:

- A burn ten minutes out and another three days later are **both** folded into
  one plan, and the second lands **1 m** from an independent two-second
  integration. The old fixed window reached 132 minutes ahead and dropped the
  second burn without a word; stretched to cover it, it was 91 km out.
- A **lunar orbit** is projected about the Moon for one lunar revolution, 117
  minutes. It used to be handed the craft's *geocentric* period, which in lunar
  orbit measures **134 days**.
- Cost is 1,024 steps and 0.66 ms for a parking orbit, 3,302 steps and 1.65 ms
  for the three-day two-burn plan, and 5 ms in the worst case, where a burn a
  month away exhausts the step budget and the projection says `truncated`
  instead of taking as long as it takes inside a render frame.

### The map

`m` opens it, and it is not a second scene — it is the same one, pulled back far
enough to see the whole orbit, with the flight instruments out of the way and
the planning ones kept. The two paths, the gizmo, the flight-plan list and the
clock all work identically in both, because they are the same objects.

How far back comes from the *path*, not from the body it orbits: a parking orbit
and a translunar coast differ by three decades while Earth does not change at
all. `pathFramingDistance` takes the greatest radius the projection drew and
opens it out by the vertical field of view, with a 15% margin. Gated in
verify-geometry across three decades of orbit — the path subtends 19.1°, 19.8°
and 19.8° of the 22.5° available, so it fits with room and the room does not
grow.

Entering from a camera that rides the vehicle — chase, pad, free flight, the
opening shot — moves to whichever body the path is drawn around, because an
orbit cannot be read from inside it. Any other lock is left alone.

What the map adds is a frame to read the orbit *against*. An orbit on its own
shows its shape and says nothing about its orientation, so the overlay draws the
equator of the body it goes round as a ring grid, the line where the two planes
cross, and — on Earth — the pads. That last one is what turns an inclination
from a number in a panel into *where you launched from*: Kennedy's 28.6° track
passes over its own pad, and Vandenberg's 80.6° one does not go near it.

The line of nodes is hidden rather than drawn when the two planes coincide,
because an equatorial orbit has no nodes and the cross product that defines them
degenerates — the same collinear collapse that tilted the vehicle on the pad,
caught in advance this time.

### The plan as a list

A plan is a sequence — burn, coast, burn — and a gizmo can only ever show one of
them. The flight-plan panel is where the sequence lives: every planned burn in
the order it fires, the body it is measured against, the time to it, its size,
and the orbit it leaves behind. The selected one opens in place rather than
replacing the list, so editing a burn never costs sight of the rest, and
clicking a row flies the camera to that burn — a planned burn is a point that
moves, so the rig follows it exactly the way it follows a body.

Each burn's "leaves" is osculating, taken at the instant of the impulse, rather
than read off the integrated path afterwards. Two reasons, and the second is the
load-bearing one: a burn's result is a fact about that burn and should not change
because a *later* node was added; and a plan whose next burn comes before the
orbit reaches an apsis — a Hohmann transfer is exactly that — has no apsis on the
path between them to read. Checked against the closed form in
scripts/verify-nodes.mjs: a 162.24 m/s burn at a 171.7 km periapsis reports
171.7 x 1000.0 km, the 222.24 m/s burn 48 minutes later reports 1000 x 1000, and
a 3,200 m/s burn reports no far side at all.

### Planning a burn on the result of another

Both drawn paths are pickable, and the nearest pixel decides between them. That
is what makes a second burn possible at all: it is planned on the orbit the
first one produces, and that orbit exists only as the amber line — measured at
the point tested, the two paths have parted by 3,347 km, so reading such a click
off the cyan line would put the node on a trajectory the craft is no longer
going to fly.

Two details make it land where it was clicked:

- **Each pass records the instant it started from.** The two are refreshed on
  different triggers — the ballistic path on a fifth-of-a-second clock, the plan
  whenever it changes — so their epochs are measured from instants that far
  apart. Converting a click through the live clock instead of through its own
  pass is 0.2 s out, which at 7.81 km/s is **1.56 km** of arc. Through the pass
  it is exact to well under the float32 floor of the drawn buffer.
- **A node being dragged through time is held out of the plan.** Its frame is
  still recorded, so the gizmo stays on it, but its impulse is withheld — so the
  amber line draws the path it is *sliding along* rather than the one it
  produces. Otherwise the pilot scrubs along a trajectory that only exists while
  the node stays where it already is.

In the running app, a click on the amber line lands a node 0.2 m from the click
and 28 µs from that point's own instant.

Editing one is three gestures, and all three are coordinate round trips with
somewhere to be quietly wrong. `scripts/verify-gizmo.mjs` runs each of them
through the *real* `Line2` raycaster on a real camera against the same packed
buffer the renderer draws — a reimplementation of the raycast would be testing
the test.

| what | measured |
| --- | --- |
| click → instant, 41 points round the orbit | worst error **0.019 ms**, samples 10.32 s apart |
| the float32 floor that limits it | 0.100 ms |
| grab width asked / delivered | 14.00 px / grabs to **13.91**, misses from **14.01** |
| recorded orbital frame, orthonormality | **1.11e−16** |
| …against an independent integration to the same instant | **2.98e−8 rad** |
| a 120 px pull on prograde | 468.51 m/s → apoapsis within **2 m** of vis-viva |

Three things are worth stating because each cost a wrong version first.

**The frame is recorded, not recomputed.** A node fires mid-step, between
samples, so anything reconstructing prograde from the drawn polyline would be
reading a slightly different orbit than the one the impulse is applied to. The
projection writes the basis it actually used, and the gizmo draws that.

**Drag sensitivity is a fraction of orbital speed**, not metres per second per
pixel. The burns this plans span three decades — an RCS trim is 2 m/s and a
translunar injection is 3,100 — and one fixed constant has to be wrong at one
end. A 600 px pull spends 30% of the craft's speed at the node, which is a TLI
in one gesture at 7.7 km/s and correspondingly finer in a slow lunar orbit,
without being told.

**An axis pointing at the camera is refused, not mis-picked.** Prograde does it
constantly, because the natural way to look at a trajectory is along it:
measured head-on, the prograde and retrograde handles landed 6 and 7 pixels from
the node's centre — inside each other's grab radius and inside the time-scrub
ball's. Below 32 px of screen separation a handle is drawn as a ghost and
refuses to be grabbed, a dead cone of asin(32/88) ≈ **21°** either side of the
axis. Orbit a little, or type the number into the panel, which carries the same
three components for exactly this reason.

Two bugs this turned up, both invisible until something tried to click:

- `LineGeometry.setPositions` computes the bounding volume **once**, from the
  buffer it is handed — a zero-filled placeholder in both the renderer and the
  test. Writing the real path in afterwards left a bounding sphere of radius
  zero, and `raycast` rejects against that before looking at a single segment.
  The line drew perfectly the whole time, because it is marked
  `frustumCulled = false`.
- The planned path is only re-projected while there *is* a plan. Delete the last
  node and the amber line is hidden — but `plan.applied` went on naming it, with
  a recorded frame still sitting where it used to be, and the editor picks from
  exactly those. A deleted node left an invisible marker that swallowed clicks
  indefinitely, since with nothing pending there was never another projection to
  overwrite it.

### Frames of reference

"Prograde" means nothing until a centre is chosen, and two things chose it
wrongly. `scripts/verify-frames.mjs` flies the real mission and checks both.

The drawn trajectory picked whichever body pulled hardest, m/r². The Sun
out-pulls Earth on anything beyond ~259,000 km — but it pulls on Earth almost as
hard, so what the craft feels *relative to Earth* is only the difference. The
right criterion is Laplace's sphere of influence, r = d(m/M)^(2/5), which
`live.js` already used for the Moon. Flown from TLI to ninety minutes before
periselene:

| criterion | Earth | Sun | Moon | hands over to the Moon |
| --- | --- | --- | --- | --- |
| largest raw pull (old) | 28.5% | **67.7%** | 3.8% | 28,269 km out |
| sphere of influence | 87.8% | 0% | 12.2% | 65,978 km — 17 km inside its 65,995 km sphere |

And every node — in the projection and in both places the flight computer turns
a node into a direction — was measured against Earth. At lunar periselene,
Earth's prograde axis is 23.5° off the Moon's and its normal 91.3° off.

Now there is one function, `sim/soi.js`, asked at the node's *own instant*: by
the projection as it integrates through the node, and by the flight computer,
which coasts a scratch copy forward to the node to ask it. Fixing the frame
exposed a second error behind it — the flight computer re-resolved the burn at
ignition, half a burn early, and at periselene the frame turns 1.35 mrad/s.
Solving once at the node's instant and holding that inertial vector fixed both.
An 839.1 m/s circularisation at 95.7 km:

| | lunar orbit |
| --- | --- |
| map (and closed form) | 95.7 × 95.7 km |
| on Earth's axes, as it was flown before | −112.5 × 843.1 km — into the Moon |
| on the Moon's axes, frozen at ignition | 48.4 × 161.5 km |
| on the Moon's axes, solved at the node | **93.6 × 103.7 km** |

The last row is inside the ~13.4 km a centred 216 s burn sweeping ±8.4° of arc
should leave (cosine loss Δv·θ²/6, carried round to the far apsis), and the
vector the map applied and the vector the autopilot held differ by 2.0e−11 rad.

## The physics

`src/sim/rk4.js` is a classical RK4 integrator over a flat `Float64Array` of
`[x, y, z, vx, vy, vz]` per body, in **SI units**, with no softening term.
Accelerations come straight from Newton's law, evaluated once per pair and
applied to both bodies with opposite sign.

Initial conditions (`src/sim/system.js`) are built from real J2000.0 orbital
elements, the way the elements are actually defined: the Earth–Moon *barycentre*
follows the heliocentric ellipse, and Earth and Moon are placed either side of
it from the geocentric lunar elements. The whole system is then shifted into its
own barycentric rest frame.

It reproduces the real thing closely — perihelion distance 147,101,548 km,
Earth's perihelion velocity 30.296 km/s, a lunar distance in the correct
356,000–407,000 km range, and a sidereal month within 1% of 27.32 days (the
period is emergent here, not prescribed). Total energy is conserved to better
than one part in 10¹²; the HUD reports the live drift in parts per billion.

Steps are subdivided so none exceeds 900s, capped at 96 substeps per frame so
extreme time warp degrades accuracy gracefully rather than stalling the frame.

## The spacecraft

A controllable craft flies in the same integrator as the planets, as a **test
particle**: pulled by Sol, Terra and Luna, exerting nothing back. That is a
structural guarantee rather than a small mass — the massive bodies' accelerations
never read its slot, and the planetary solution is bit-identical to the 3-body
version over 14 simulated days.

| Input | |
| --- | --- |
| `W` / `S` | throttle up / down |
| `Z` / `X` | full throttle / cut |
| `I` / `K` | pitch |
| `J` / `L` | yaw |
| `Q` / `E` | roll |
| `T` | stability hold |
| `5` / `6` | orbit lock / chase camera |

Thrust enters as an acceleration term inside `derivative()`, alongside gravity —
not as a per-frame velocity impulse, which would collapse the whole thing to
Euler order. Control input is held constant across the four RK4 stages, a
zero-order hold; since RK4 integrates a constant acceleration *exactly*, a steady
burn contributes no integration error. A 30 s full-throttle prograde burn raises
apogee 400 → 833 km with perigee pinned at the burn point, spends exactly the
Tsiolkovsky delta-v, and leaves the planetary energy drift untouched.

Attitude lives beside the state vector rather than inside it, because the array's
value is that every slot is an identical six-wide block. It costs nothing:
without gravity-gradient torque the rotational equation is independent of
position, so the split is exact under the same zero-order hold. The inertia
tensor is isotropic, which makes Euler's gyroscopic term vanish identically, and
the quaternion advances by the closed-form exponential map — exact for constant
angular velocity, and unit-norm by construction rather than by renormalisation
(|q| = 1.000000000000000 after 100,000 updates).

Burning is locked to real time. A few seconds of engine stretched across a
simulated week would hand out absurd delta-v, so opening the throttle drops the
warp and closing it restores what the pilot had.

### Two traps this sprung

**The timestep.** A 400 km orbit closes in 92 minutes — 426× faster than the
Moon — so the 900 s ceiling tuned for the planets left it with *eight steps per
revolution*. `maxDt` is now self-tuning from the craft's local circular period
(`T/400`, clamped), with the substep cap raised to 2048. Measured: 512 substeps
costs 105 µs, 0.63% of a frame budget; even 1 month/s keeps ~260 steps per orbit.
Accuracy plateaus early — at 370 steps/orbit the semi-major axis drifts 0.66 m
over 50 orbits.

**The display scale.** Positions use `POSITION_SCALE` but Earth's *radius* is
exaggerated ×225. Placed naively, a 400 km orbit renders 3.2×10⁻⁴ units above
Earth's centre against a globe drawn at 1.15 — buried some three thousand times
deeper than the surface it orbits. The craft's geocentric offset is therefore
scaled by that same ×225, putting it at 6.3% of an Earth radius above the
surface, which is the true ratio. Note this is deliberately *not* `MOON_BOOST`:
the Moon is pushed out to be legible, the ship is scaled to stay honest.

Osculating elements for the HUD use the eccentricity-*vector* form, which has no
singularity as e approaches zero — the case a near-circular orbit spends all its
time in — and they are computed in plain scalars, so the whole readout allocates
nothing. Measured heap growth across 60,000 full frames of attitude, thrust,
integration and derived state: 12 KB.

## Floating origin

The scene origin is pinned to whatever the camera is looking at, so the focused
body sits at exactly `(0,0,0)`. `toScene()` takes an *optional* origin and stays
absolute without one — which is what the trail seeder needs, since it runs
against a cloned simulation where the live origin is meaningless. The rebase
itself happens in one place, `refreshDerived()`, as two allocation-free passes:
absolute positions into `live.abs`, then a single subtraction into `live.pos`.

**This is not about mesh jitter.** three computes `modelViewMatrix` on the CPU in
float64, so an object near the camera already renders precisely however far the
world origin is. The float32 boundary is world-space maths done *inside* a
shader — `cameraPosition`, `modelMatrix * position`, the varyings the atmosphere
and blood-moon passes carry. At Earth's 118 units that quantises in steps of
42 m. Rebased onto the focus body it becomes about 41 mm, a factor of 1024, and
it is a prerequisite for volumetric scattering rather than a fix for anything
visible today.

Shifting the origin requires shifting the camera by the same vector or the view
jumps. That turns out to be free: the camera rig already translates the camera
and the orbit target together to keep the target locked, which *is* the
compensation. Everything built from differences — trails, eclipse geometry,
osculating elements, every exaggeration factor — is origin-invariant and needed
no change.

## The fleet

Three craft fly as test particles: the controllable ship, the ISS (400 km,
51.6°) and Hubble (540 km, 28.5°), all phase-offset so they do not start
stacked. `maxDt` is taken from the **fastest** craft present, not the one being
flown, or adding a lower satellite would silently under-resolve it. It also
lives on the integrator instance rather than only at the call site — a caller
who forgets it gets the 900 s planetary default, which is eight steps per
revolution and enough to tear a satellite off the planet.

Hulls come from `public/models/` when present and from procedural compound
placeholders otherwise — see [public/models/README.md](public/models/README.md).
Uncontrolled craft hold the local-vertical/local-horizontal attitude real
satellites fly: nose along velocity, one face to the ground.

Every craft in Earth orbit shares one display-scaling rule rather than matching
on an id, because matching on a single id is exactly how the ISS and Hubble
first ended up rendering *inside* the planet.

## Launch sites

Four pads, and the picker is the small half. A site is a latitude, a longitude
and a heading, and each one reaches into the flight: latitude sets how much of
the planet's rotation the vehicle starts with and the lowest inclination it can
reach, the heading sets how much of that rotation points where it is going.

The guidance carries no site-specific constants — one vertical-acceleration law
for all four — so the test is whether it still parks the vehicle in the same
orbit when the ground under it moves 140 m/s slower and the plane is tilted 53
degrees further over. Flown, in `scripts/verify-launch-sites.mjs`:

| pad | latitude | azimuth | parking orbit | inclination | Δv left |
| --- | --- | --- | --- | --- | --- |
| Kennedy LC-39B | 28.58°N | 90° | 172.0 × 185.1 km | 28.58° | 5,825 m/s |
| Baikonur 1/5 | 45.92°N | 61.9° | 172.0 × 185.1 km | 51.29° | 5,647 m/s |
| Kourou ELA-3 | 5.24°N | 90° | 172.0 × 185.0 km | 5.24° | 5,894 m/s |
| Vandenberg SLC-6 | 34.74°N | 170° | 172.0 × 185.1 km | 80.61° | 5,208 m/s |

All four park within 0.1 km of the same orbit, and none beats its own latitude
floor — the hard bound a launch cannot steer around.

**What is left in the tanks follows the rotation that points *downrange*, not
the rotation.** ω·R·cos φ predicts the wrong order: it puts Vandenberg above
Baikonur, and the flights say otherwise. Vandenberg leaves at 170 degrees, so of
its 382 m/s only 66 point where the vehicle is going — `ω·R·cos φ·sin β` orders
the four correctly, and the gate asserts both that it does and that the raw
bonus does not.

### The bug this exposed

A vehicle on a pad points along its own local vertical. This one pointed
wherever `makeBasis` made of a fallback axis that was not perpendicular to it.

`aimThrust` builds its frame as `x = up × z`. Commanded straight up — which is
exactly what a stack on a pad is commanded — that cross product vanishes, and
the fallback was the fixed world axis `(1,0,0)`, which is *not* perpendicular to
the local vertical. `makeBasis` was handed three vectors that were not a basis,
and the quaternion came out tilted by however far that axis happened to sit from
the local horizontal. Measured at release: **1.4° off vertical at Kennedy**,
where the profile was tuned, **0.9° at Baikonur — and 27.7° at Kourou, 29.8° at
Vandenberg**. A stack that lifts off leaning thrusts sideways: Kourou gave back
38 m/s of the very eastward speed its latitude exists to provide, and climbed to
134 m in the time Kennedy reached 239. The fallback is now `east`, which is
perpendicular to up by construction. All four now leave the pad at 0.0°.

It had been invisible because the one pad in the simulator sat where the error
was nearly harmless.

### The whole mission, from all four

Launch → parking orbit → translunar injection → lunar capture, flown end to end:

| pad | reached lunar orbit at | selenocentric | Δv left |
| --- | --- | --- | --- |
| Kennedy | MET 348.8 h | 73 × 104 km | 1,721 m/s |
| Kourou | MET 413.3 h | 76 × 108 km | 1,828 m/s |
| Baikonur | MET 270.2 h | 77 × 106 km | 1,533 m/s |
| Vandenberg | MET 400.2 h | 83 × 110 km | 1,014 m/s |

Kennedy's row has moved twice: 73 × 103 km when the table was written, 80 × 110
km when it was flown again beside Vandenberg's, and 73 × 104 km once the ascent's
cutoffs stopped depending on the length of a frame, which moved its parking orbit
by 0.6 km — capture is sensitive to where the parking orbit starts. Vandenberg
goes on to fly the return too — trans-Earth injection, entry, splashdown at MET
506.8 h — with 187 m/s left after the entry corridor trim.

The mission elapsed times differ by 143 hours and nothing in the sequencer says
so: each site's plane lines up with the Moon's at a different time, and the
sequencer waits in the parking orbit until it does. Kourou, which climbs
cheapest, also arrives with the most left.

Vandenberg was the exception, and it took five explanations to find out why.
The first four were wrong. They are kept here in order, because each one was
believed, and the fourth was committed.

It is tempting to call that physics — a polar parking orbit, no lunar window —
and that explanation is wrong. Two great circles always intersect: the Moon's
path crosses *any* parking plane twice a lunar month, whatever its inclination.
Measured over sixty days, the Moon comes within 0.01° of all four planes,
Vandenberg's included, so a window is available there as much as anywhere.

That mechanism turned out to be real, and to affect every site rather than
this one. The ignition test wants apoapsis within 0.6° of where the Moon will
be, and apoapsis sweeps the whole plane every 88 minutes — so the instantaneous
alignment dives toward zero and climbs again twice an orbit whether or not a
window is open. The warp ladder read its time-to-window from how fast that
angle was closing, so it saw a window arriving every few minutes and held real
time indefinitely: measured, **every pad spent essentially every frame at 1×**,
buying four simulated seconds each, and Kennedy took 720,697 frames to reach a
window nine days out.

The ladder now steers by how far the Moon's arrival point lies out of the
parking plane — the half of the problem that moves on the timescale the window
lives on, and which forbids a window outright while it is large. Same windows,
same days, same burns:

| pad | window at | frames before | frames after |
| --- | --- | --- | --- |
| Kennedy | day 9.2 | 720,697 | 23,629 |
| Kourou | day 12.0 | 1,585,455 | 23,750 |
| Baikonur | day 5.7 | 568,654 | 21,545 |
| Vandenberg | ~~day 12.8~~ | 420,600 | 11,385 |

The Vandenberg row is not a window. By day 11.4 that vehicle was inside the
planet (below), and "day 12.8" was the alignment test passing by chance against a
craft sitting at r = 0, where the direction of apoapsis is noise. It was read at
the time as Vandenberg finding its window in *fewer* frames than Kennedy. Its
real window — measured with drag removed after commitment and nothing else
changed — is day 11.75.

That made the injection itself look like the problem, and it was written up as
one: the vehicle "reached the window" at MET 306.6 h with 5,208 m/s against
Kennedy's 5,825, staged twice during the burn where Kennedy stages once, and cut
off on propellant exhaustion. Recorded here as a delta-v shortfall the polar
azimuth had caused. That was the fourth wrong explanation for this pad, and
unlike the first three it had been committed.

**The vehicle is not there.** It reentered on day 11.4 and the sequencer kept
flying it.

A 172 x 185 km parking orbit is not somewhere to wait. Drag takes perigee at
1.62 km a day to begin with and faster as it drops, and the figure is the air
rather than the integrator: the same 24-hour coast loses 1.624 km at 60x warp
and 1.624 km at 21,600x, a 360-fold change in step size that moves nothing. The
sequencer waits in that orbit for the Moon to cross its orbital plane, and at
this epoch that wait is:

| pad | window opens | lowest altitude reached | outcome |
| --- | --- | --- | --- |
| Baikonur | 137.1 h | 163.6 km | injects |
| Kennedy | 219.7 h | 156.4 km | injects |
| Kourou | 286.9 h | 148.8 km | injects |
| Vandenberg | 282.1 h | — | **lost at MET 274.7 h** |

Vandenberg's craft crosses the surface 7.5 hours before its window opens. With
nothing checking, it kept integrating down to r = 0 and sat at Earth's centre —
and the sequencer, which only ever asked whether the Moon was in the plane,
went on to run a translunar injection out of the middle of the planet. 5,208 m/s
spent; apoapsis raised to 15 km. That window was first written here as 306.4 h,
31.7 hours after the loss, and it came from the same corpse: 282.1 h is the one
flown with drag removed after commitment.

There was never a delta-v anomaly. Kennedy's injection, traced burn-frame by
burn-frame, costs **3,146 m/s of ideal delta-v** — the textbook figure — of
which 3,022 m/s becomes speed and 124 m/s is paid climbing, with steering loss
below 1 m/s because the burn is held prograde. Nothing about that depends on
inclination and nothing about it was ever wrong.

What is wrong is the profile, and not only from Vandenberg. Three pads out of
four survive the wait, and they survive it by where the Moon happened to be:
Kourou reaches its window at 148.8 km, which is an altitude Vandenberg passed
through with about two days left to live. The mission parks low and loiters for
between six and thirteen days. Apollo parked at this altitude and injected
within three orbits, for exactly this reason.

Two things followed. The first is a `LOST` phase and an altitude check that
runs before any phase steers, so a vehicle inside a planet stops the run and says
where instead of being flown on — `verify-launch-sites` puts a craft under the
surface and asserts it. The second is the profile, below.

### Waiting out the window

The wait cannot move to the pad. Commitment to the Moon is the pilot's, made in
orbit at a time of their choosing, so the flight computer has to survive
whatever wait it is handed, from wherever it is handed it. At commitment it now
asks two questions, and both are answered by models the simulation already
runs on.

**How long until the window?** The Moon is propagated, not extrapolated: a
drag-free copy of the simulation marched in half-hour steps, asking at each one
the question `updateTLI` will ask when the day comes. The Hohmann flight time and
the arrival direction are shared functions now, so the forecast cannot drift
from the ignition test. The moment a window opens is interpolated between the
samples either side of it, and what follows an opening is the craft coming round
to the right point of its own orbit, within one parking orbit — 1.47 h:

| pad | forecast | injected | late by |
| --- | --- | --- | --- |
| Baikonur | 135.96 h | 137.05 h | 1.10 h |
| Kennedy | 218.41 h | 219.70 h | 1.29 h |
| Kourou | 286.41 h | 286.78 h | 0.36 h |
| Vandenberg | 281.38 h | 282.60 h | 1.22 h |

A window already open at commitment is a different question, because open is
not the same as usable. Ignition needs the arrival point within tolerance at the
moment the craft passes the point opposite it, and that comes round once an
orbit. So inside an open window the forecast finds the pass itself — craft and
Moon propagated together in 20 s steps — and counts on it only if it falls 0.05°
inside the tolerance. The bias is deliberate: a pass counted on that then misses
leaves the vehicle waiting half a month with no raise planned, and a pass not
counted on that then fires costs a raise that is withdrawn at ignition.

**How long will the orbit last?** `decay.js` takes King-Hele's equations for one
revolution as they stand — da/dE and de/dE over the eccentric anomaly — and
integrates them numerically over the density table the integrator flies through,
with the same `dragK` and the along-track part of the same rotating air at each
point, marching semi-major axis and eccentricity together. Nothing about the
atmosphere is approximated. Against Vandenberg's orbit left to decay:

| flown | semi-major axis altitude | theory | error |
| --- | --- | --- | --- |
| 25 h | 176.58 km | 25.00 h | 0.02% |
| 100 h | 169.49 km | 100.06 h | 0.06% |
| 200 h | 154.35 km | 200.24 h | 0.12% |
| 250 h | 138.36 km | 250.21 h | 0.09% |
| lost at 269.90 h | — | 269.31 h | −0.22% |

The last row is taken to the 100 km floor the theory stops at, 0.6 h before the
craft reaches the surface.

Two textbook forms came first and were replaced. Both treat the air as one
exponential about a reference height and integrate analytically into Bessel
functions. About the mean altitude it held 0.2–1% on these parking orbits and
misled on anything else: 25% long at 150 × 250 km, 88% at 180 × 447 km, and an
orbit that never came down at 180 × 1,636 km. About perigee it was 7–31% long
across the same range, because no single scale height describes air whose scale
height doubles over the first few hundred kilometres. Integrating the table
removes the approximation instead of moving it:

| orbit | e | flown | theory within |
| --- | --- | --- | --- |
| 172.5 × 185.2 km | 0.0010 | down at 299.2 h | 0.0% |
| 150 × 250 km | 0.0076 | down at 408.3 h | 0.1% |
| 180 × 312 km | 0.0100 | down at 2,074 h | 0.1% |
| 160 × 400 km | 0.0180 | down at 2,035 h | 0.1% |
| 180 × 870 km | 0.0500 | 3,000 h | 0.2% |
| 180 × 1,636 km | 0.1000 | 3,000 h | 0.2% |

If the orbit will not last the wait plus one more orbit and the injection burn —
with 2% taken off the lifetime for the theory's error, a figure `verify-loiter`
checks against flown decay, near-circular and eccentric — the flight computer
plans a raise to the circular orbit that decays back down into the one it started
from *just as the window opens*. So injection is flown from the orbit it always
was, and the margin at the window is not a tolerance but that orbit's whole
remaining life. The burns are ordinary manoeuvre nodes, in the flight plan like
any other, placed at the apsides where the transfer formulas are true: a transfer
from perigee rounded off at the target when the target lies above apogee, and a
single burn at apogee, sized exactly, when lifting perigee is enough. After the
last burn the orbit is assessed again, and the plan remade if it still falls
short — at most twice.

The plan follows the pilot. Any burn during the wait that was not the plan's — a
node of their own, or thrust by hand — remakes it from the orbit being flown and
withdraws raise burns that have not flown. A 25 m/s retrograde trim six hours in
takes Vandenberg's raised orbit to about 110 × 194 km, with 9.3 h of life against
275 h to the window; it is replanned into a single 19.7 m/s burn at apogee and
injects. The first raise design burned wherever the craft happened to be,
treating the orbit as a circle, and after that same trim it replanned correctly
and lost the vehicle at MET 181.7 h. 33 m/s by hand before the raise has flown
leaves 1,667 h of life, and the raise is withdrawn unflown. Anything still
pending when the window arrives is withdrawn at ignition, so it cannot preempt
the injection.

At this epoch Kennedy, Kourou and Baikonur last their waits and plan nothing, and
the loiter work left their flights bit-identical: injection time to seventeen
significant figures, and delta-v left and apoapsis to the twelve they were
compared at. Vandenberg forecasts 281.4 h against a lifetime of 269.3 h, raises
from 178.5 to 193.9 km for 2.63 + 6.51 m/s starting at perigee, has decayed back
to 178.8 km at ignition — 0.3 km from where it aimed — and flies the whole
mission. Planning
takes 9–18 ms at commitment, the most when a single burn is sized by bisection:
about a frame.

**The injection floor.** No injection starts from under 140 km of perigee. That is
a policy rather than a derivation, and what it guards is the steepness of a
decaying orbit's last day: a Baikonur launch at +563.3 h, on the parking orbit the
ascent reached then, lasted its 319 h wait and would have injected from a 126 km
perigee with seven hours of life left. It is not
drag during the burn, which measured 0.04 m/s from there — though the low start
does cost more, because a lower circular orbit is deeper in the well: that
injection spent 3,159 m/s from 126 km, against 3,149 m/s for the same pad from
164 km.

Perigee at ignition comes from the same decay theory, marched to the latest
ignition, and matches flight to 0.04 km on the pads that do not raise. The flight
computer judges and aims a kilometre above the floor, more than the theory's worst
measured error of 0.43 km, so an orbit predicted just over it cannot inject just
under it. An orbit that would reach its window lower is raised by the least that
clears it, even with life to spare. When one burn at apogee is enough it is sized
exactly, by bisection over the eccentric orbit the burn actually leaves: sized as
if it left a circle, that Baikonur launch's raise cost 2.12 m/s and arrived at 152 km, because
an orbit that keeps its high apogee decays far more slowly than a circle at its
perigee; sized exactly, 0.87 m/s and 142.0 km. `verify-loiter` now flies a Kourou
launch at +623.5 h instead, which lasts its 331 h wait with 13 h to spare but
would reach the window with a 134 km perigee: it raises for the floor with a
single 0.55 m/s burn and injects from 141.3 km.

The floor holds when there is no time to raise first. If the window comes with
perigee under it and the raise has not flown, ignition waits and the window goes.
A Vandenberg launch trimmed 15 m/s just before committing into a window that opens
minutes later lets it go, raises at apogee an orbit on, and injects 320 h later
from 161.5 km.

**Every launch time.** One epoch proves little about a wait that depends on where
the Moon is and which way the plane faces, so the four pads were flown from 156
launch times each, every 4.3 hours across 27.8 days — a sidereal month, the
period on which the Moon crosses a plane fixed against the stars, at a spacing
that does not line up with the day. Each flight goes from the pad to lunar orbit.

| | first sweep | after the fixes | with the 140 km floor | ascent cutoffs stepped |
| --- | --- | --- | --- | --- |
| reached lunar orbit | 623 of 624 | 624 of 624 | 624 of 624 | 624 of 624 |
| injected more than a minute before its forecast | 96 | 0 | 0 | 0 |
| injected more than an orbit after it | 1 | 0 | 0 | 0 |
| raised for lifetime | 36 | 37 | 37 | 43 |
| raised for the floor | — | — | 39 | 49 |
| least life left at ignition, unraised | 7.8 h | 7.0 h | 31.5 h | 33.3 h |

The first sweep is what found the open-window case. Seven launches committed
inside a window; five caught their pass and two did not — one Vandenberg vehicle
lost, and one Kennedy vehicle that waited 326.8 h and injected from 137.7 km with
23 h of life left. The early injections were the forecast returning the half-hour
sample after a window opened instead of the moment it did.

With the floor in, the longest wait is 348.2 h, 14.5 days. The 37 raises for
lifetime cost 8.7–10.6 m/s and reach the window within 0.87 km of their aim; the 39
for the floor cost 0.01–0.87 m/s and inject from 141.0–142.8 km of perigee. No
injection in the month starts under 140 km, and the least life an unraised vehicle
still has at ignition is 31.5 h, where before the floor it was 7.0 h. Otherwise
nothing moved: 39 flights changed, as many as raised for the floor, and the least
delta-v left in lunar orbit went from 920 to 918 m/s.

Stepping the ascent's cutoffs, described below, moved every parking orbit down by
up to 0.8 km, and with it the decisions nearest their boundaries. Flown again, 43
launches raise for lifetime and 49 for the floor, at 8.7–10.7 m/s and
0.02–0.88 m/s; the longest wait is 348.3 h; no injection starts under 141.1 km of
perigee; the least life left at an unraised ignition is 33.3 h; and the least
delta-v in lunar orbit is 919 m/s.

### Planned burns under time warp

The raise exposed that a planned burn inside a warped coast was usually never
flown. The sequencer checks once a frame whether a node is inside its 60-second
alignment margin, and at 6 h/s a frame is 360 s, so a node was caught only when a
frame boundary happened to land in that minute. Measured during TLI_ALIGN, a
5 m/s node was skipped outright at five of six placements across the frame
cycle — the sequencer flew on through injection to lunar approach with the burn
never made and the map still drawing it — and the sixth lit 332 s late, because
the frame that caught it had already committed to its whole step.

The frame loop now takes a step ceiling from the sequencer before the sequencer
runs, and no frame carries the clock past the moment a burn has to start
turning. All six placements ignite within 0.033 s of plan and deliver 5.148 m/s
of 5, which is one frame of thrust. `verify-nodes` repeats the measurement in a
coast the pilot has warped, where it is the dial and not the sequencer that sets
the 360 s frame, and `verify-loiter`'s raise burns are flown through the
sequencer's.

Burns that were no longer skipped then showed where a plan was being kept too
long. Node times are absolute, and a reset puts the clock back to the epoch, so
nodes left over from one flight were scheduled into the next: choosing a new pad
left the old plan in place. `verify-horizon` added a 3,000 m/s node in one
section and flew the next section's mission with it still in the plan; once it
was flown, that vehicle left for interplanetary space and the lunar checks
failed. A reset now clears the plan.

The same ceiling now covers the two burns that reach orbit. Each ends on a test
made once a frame of something racing at the end — apoapsis rising to the parking
altitude, eccentricity falling to circular — and with the engines lit a frame at
60x is a second of flight. Artemis's Core stage, held at the 4 g limit, reaches
orbital speed at 152 km rather than Apollo 8's 174, where apoapsis rises 20 km/s:
flown at 60x it parked at 188.7 × 200.4 km, and at 1x at 174.0 × 185.1.
Circularising on the same stage raises perigee 174 km/s, 2.9 km in a single 1x
frame. The ceiling holds each burn's last steps to half the time its cutoff
quantity needs to close the gap at the rate it is closing now, down to the time to
close 50 m, and both vehicles now reach the same parking orbit at 60x and at 1x to
within 0.06 km, which `verify-warp` checks by flying each vessel both ways. It
moved every pad's parking orbit down by up to 0.8 km, and the figures in this
document are flown on it.

## Surface launch

The vehicle starts clamped to Kennedy LC-39B (28.58 N) and flies itself to orbit
under a mission sequencer. `src/sim/launchsite.js` holds the site in a body-fixed
frame built on the same spin axis the renderer and the drag model use:

```
r = R⊕ [cos φ (cos θ e₁ + sin θ e₂) + sin φ e₃],   θ = λ + ω t
v = v⊕ + ω⃗ × r
```

The hold is a **constraint, not a force** — the six state slots are overwritten
after each step rather than balanced against a modelled pad reaction, which
would be the stiffest term in the system and would collapse the step size for
everything else. Two consequences fall out for free: the craft lands on exactly
`1.150000` scene units against a rendered radius of `1.150000` (because
`ORBIT_ALTITUDE_SCALE` *is* the radius exaggeration), and dynamic pressure on the
pad is machine-zero, because the clamp velocity and the drag model's wind use the
same ω⃗.

Latitude is load-bearing, longitude is not: 28.58° is why a due-east launch
reaches 28.58° inclination and collects 408 m/s of free eastward velocity, while
on a procedurally generated Earth there is no real Florida for longitude to
point at.

### Sequencer

`PRE_LAUNCH → LIFTOFF → PITCH_KICK → GRAVITY_TURN → MECO → COAST`, with `STAGING`
as an interrupt. Zero allocation: the phase table and its closures are built at
module load, scratch vectors are module-level, and the HUD formats strings at its
own refresh rate. Transitions are evaluated at the top of the frame, which is
current rather than stale — the derived state there is the result of the previous
step.

Four things this took to get right:

- **Successors are named explicitly.** Falling through to `index + 1` lets the
  array's *layout* encode control flow, which wedged `STAGING` — an interrupt —
  between the gravity turn and cutoff, so the two ping-ponged and MECO never
  fired.
- **Cutoff is on perigee, not apogee.** A ballistic lob reaches 200 km apogee at
  under 2 km/s, so an apogee trigger cuts the engines three minutes in on a
  trajectory whose perigee is 6000 km underground. Perigee rising above the
  atmosphere is what actually means "in orbit".
- **The pitch programme schedules on velocity, not altitude.** Scheduling on
  altitude reaches horizontal around 130 km while the vehicle is still doing
  2 km/s — far too slow to hold itself up, so it lofts and sinks back through
  90 km. The vehicle may only lie down once it is going fast enough to stay up.
- **The orbital plane is locked at liftoff.** Steering to a fixed compass azimuth
  every frame follows a *rhumb line*, not a great circle, and drifts a 28.58°
  launch to 41°.

Flight timing and attitude advance on **simulated** time, not the wall clock.
At 60× the two differ by a factor of sixty, and a vehicle whose autopilot slews
sixty times too slowly relative to its own trajectory never finishes pitching to
vertical and flies into the ground. Verified warp-invariant: 1× and 60× agree to
0.01° of inclination and 2 s of MECO time.

### Circularisation

`MECO → COAST_TO_APOAPSIS → CIRCULARISE → COAST`. Three things carry it:

**Time to apoapsis comes from the anomalies, not from watching for the vertical
speed to flip.** A finite burn has to *straddle* apoapsis, so the sequencer needs
to know how long it has left while still climbing — being told it has arrived is
already too late.

```
cos E = (1 - r/a)/e     E from the sign of the radial velocity
M = E - e sin E         Kepler, forward
t = (π - M)/n           apoapsis sits at M = π
```

Verified exact against Kepler at every point on the orbit, to within 0.0001 s,
including telling the outbound leg from the inbound one.

**Ignition is scheduled half a burn early.** Duration comes from the rocket
equation — `m₁ = m₀ exp(-Δv/vₑ)`, `t = (m₀-m₁)/ṁ` — and the burn starts at
`t_apo - t_burn/2`. A burn applied entirely *after* apoapsis raises periapsis on
one side only and leaves the orbit lopsided. Predicted 393 s, flown 393 s.

**Cutoff is the eccentricity minimum, not a fixed target.** A prograde burn at
apoapsis drives eccentricity down, through a minimum, and back up as it
continues past the optimum. Watching for the turn is self-correcting: it lands on
the roundest orbit the vehicle can actually reach, whether or not any particular
tolerance was achievable, and it cannot overshoot into a worse orbit than it
started with.

The coast requests time warp on a ladder — 1 hr/s while far out, 1 min/s inside
20 minutes, real time for the last 5 — because at 1 hr/s a frame covers 60
simulated seconds and would overshoot the ignition point by up to a minute.
Warp control returns to the pilot on reaching orbit.

Result from the pad, hands off: MECO into **150 × 7838 km at e = 0.371**, then a
393 s burn at apoapsis to **7841 × 7845 km, e = 0.00012** — a 3.5 km spread
between apoapsis and periapsis, with 5617 m/s still aboard.

Note this circularises at the transfer orbit's *apoapsis*, which is where the
over-performing stack puts it. A low circular parking orbit would want a
two-burn Hohmann instead: the same phases, with an intermediate periapsis-raise.

### Trans-lunar injection

`COAST → TLI_ALIGN → TLI_BURN → TRANS_LUNAR`, committed from the HUD rather
than entered automatically. The Hohmann solution is rebuilt every frame from
live state, because the Moon's radius here is emergent and swings some 45,000 km
over a month — which moves both the flight time and the lead angle:

```
a  = (r_ship + r_moon)/2      T = π√(a³/μ)
Δθ = n_moon T                 target phase = π − Δθ
```

Typical solution from the 7,845 km parking orbit: **TOF 5.4 days, Moon travels
67°, target phase angle 113°, Δv 2,078 m/s.**

**The planar phase angle is not sufficient, and the miss distance says exactly
why.** Implemented literally, the burn puts apoapsis at 402,277 km against the
Moon's 400,506 km and arrives on the right day — and misses by **261,533 km**.
That number is `sin(39.5°) × 400,000 km`: our parking orbit sits 39.5° off the
lunar plane, apoapsis is pinned to *our* plane, and nothing in the phase angle
constrains it.

Stated in three dimensions the same condition also fixes the plane. Apoapsis
points opposite the ignition point, so fire when that direction lines up with
where the Moon will *actually be* after the flight — which forces ignition onto
a node, the constraint the planar form drops. Same physics, one dimension more
honest, and the miss falls to **25,212 km — inside the Moon's 66,100 km sphere
of influence.**

Both figures are worth keeping in mind: the planar form is the classical
textbook condition and it is what the HUD reports, but it is a planar answer to
a three-dimensional problem.

The residual 25,000 km is genuine patched-conic error — this simulation has the
Moon's gravity acting throughout the transfer, which a Hohmann solution does
not model. A mid-course correction is the natural next phase, and cheap: a few
tens of m/s at the right point, against the 3,611 m/s still aboard.

### Mid-course correction

`TRANS_LUNAR → MCC_SOLVE → MCC_BURN → LUNAR_APPROACH`, targeting a 1837 km
lunar periapsis (1737 km surface + 100 km).

There is no closed form for "what lunar altitude does this trajectory reach" in
an n-body field — the Moon pulls on the craft for the whole transfer, which is
exactly what the Hohmann solution omits. So `src/sim/targeting.js` evaluates the
objective by *flying* the trajectory in a scratch integrator carrying only Sun,
Earth, Moon and the craft. Dropping the other satellites is not just a saving:
the live step ceiling is set by the *lowest* craft in the fleet, so propagating
with the ISS aboard would run a four-day projection at a 14-second step sized
for low Earth orbit. As built, one projection costs **3 ms**, and predicted
closest approach lands within **2.6 km of the flown result over eight days**.

The solve is Gauss-Newton on a single residual with three variables. That is
underdetermined — a two-parameter family of burns hits the same periapsis — so
the step is taken through the minimum-norm pseudo-inverse `Δx = −r Jᵀ/|J|²`,
which picks the cheapest of that family, followed by a null-space descent that
walks off the excess a wandering Gauss-Newton path accumulates.

The manoeuvre frame is anchored on **velocity**, not position. The textbook
triad pairs radial with prograde directly, but a day after injection the craft
is climbing almost straight out and those two are nearly parallel — a basis that
would leave the Jacobian badly conditioned exactly where the solve happens.

Two results worth keeping:

**MCC-1 at TLI+24 h is genuinely the cheapest**, which is not obvious — earlier
corrections have more leverage but sit deeper in Earth's well, and the cost
curve turns over:

| when | Δv | converged |
| --- | --- | --- |
| TLI+6 h | 98.85 m/s | yes |
| TLI+12 h | 81.41 m/s | yes |
| **TLI+24 h** | **74.35 m/s** | yes |
| TLI+48 h | 84.92 m/s | yes |

**Ignition has to wait for the attitude to converge.** The correction is a
~15 second burn and the autopilot slews at 0.15 rad/s, so igniting on a fixed
one-second pause sprayed the impulse across a wide arc while the craft was still
rotating — the solve was right and the delivery was not, and it flew to
35,968 km instead of 1,837. Gated on a 0.005 rad pointing error the slew takes
17.6 s and delivery matches the solution to **0.018 m/s**.

End to end: a 25,214 km lunar miss corrected to a **98.35 km flown periapsis**
for 74.35 m/s, with 3,537 m/s still aboard for insertion. The solver's own
projection said 99.99 km, so the scratch integrator runs 1.6 km optimistic over
this 4.3-day arrival, in line with the 2.6 km quoted above for an eight-day one.

That residual is worth a note, because it is the whole case for what follows. It
is not solver error — the solve converges to under a kilometre — it is the
projector's, and it moves with the launch epoch: a *one second* shift in liftoff
moves the flown lunar periapsis by about three kilometres, through the TLI window
phasing. The mission is deterministic and the harness reproduces any run exactly,
but nothing upstream can hand the insertion a periapsis it can trust to better
than a few km. So the insertion does not use one, for anything but scheduling.

### Lunar orbit insertion

`LUNAR_APPROACH → LOI_ALIGN → LOI_BURN → LUNAR_ORBIT`, capturing out of a
hyperbolic arrival into low lunar orbit. The vehicle arrives with
**v∞ = 818 m/s** on an **e = 1.251** selenocentric hyperbola, and the capture is
818 m/s of retrograde burn at periapsis — for comparison, Apollo's LOI-1 was
about 890 m/s.

Four things carry it.

**The elements are computed about the Moon, and only believed inside the SOI.**
`computeLunarElements` is the same eccentricity-vector formulation as the
geocentric set, reparameterised on μ☾ and the Moon's slot in the state vector,
into a second preallocated element block. Both are refreshed every frame; the
selenocentric one is only *used* while the craft is inside Laplace's radius,

```
r_SOI = d (m☾ / m⊕)^(2/5)
```

scaled by the live Earth–Moon separation rather than frozen at 66,100 km, since
that separation swings some 45,000 km over a month. It measures 66,218 km on this
arrival, crossed at MET 326.15 h. Outside it the conic is not a trajectory at
all — see above.

**Ignition is scheduled on the hyperbolic Kepler equation.** The elliptic apsis
clock could not answer "how long until periapsis" on an arrival hyperbola, so the
same derivation is carried onto the other branch, with the circular functions
replaced by their hyperbolic counterparts and |a| for the negative semi-major
axis:

```
cosh H = (r/|a| + 1) / e     hyperbolic anomaly
M = e sinh H − H             Kepler, hyperbolic form
t = −M / n,   n = √(μ/|a|³)
```

The branch is recovered from the sign of the radial velocity exactly as it is on
the ellipse — `acosh` is even, so it cannot tell an inbound leg from an outbound
one, and getting that wrong puts periapsis in the future when it is already
behind. Checked against an independent two-body propagation at 22 states across
three hyperbolas and two ellipses: **worst timing error 2.3 × 10⁻⁷ s**, periapsis
radius to under a millimetre.

**Cutoff is the eccentricity minimum of the achieved selenocentric orbit.** Not a
burn time, not a burnout mass. Both of those are open loop — they say how much
impulse to spend, not what orbit resulted — and an 818 m/s burn magnifies
everything a 74 m/s correction absorbed. Flown against a burnout-mass cutoff with
a 2% error in exhaust velocity:

| dispersion | closed loop | burnout mass |
| --- | --- | --- |
| nominal | 88.5 × 105.7 km | 89.8 × 107.0 km |
| thrust −3% | 88.3 × 106.0 km | 89.6 × 107.3 km |
| thrust +3% | 88.9 × 105.6 km | 90.1 × 106.8 km |
| **Isp −2%** | **88.4 × 105.8 km** | 96.8 × **175.3 km** |
| **Isp +2%** | **88.6 × 105.7 km** | **26.4** × 98.8 km |

A mass cutoff is structurally immune to thrust error — Tsiolkovsky depends on the
mass ratio, not on how fast you get there — and structurally blind to an error in
exhaust velocity, because that is the constant it inverts. Two percent puts
apoapsis 70 km high or periapsis 62 km low — the latter 6 km above the abort
floor. The closed loop absorbs both to within 0.2 km, because whatever the engine
actually did is already in the state the criterion reads.

The *minimum* is the right extremum, and it means more here than roundness.
While v > v_circ the burn point is still periapsis and apoapsis is falling toward
it; past v_circ the burn point becomes **apoapsis** and periapsis starts dropping
away on the far side. So the eccentricity turn is precisely the moment at which
continuing would begin digging periapsis into the Moon. The safe-altitude floor
in the profile is a backstop that a correct cutoff never reaches — measured
minimum altitude through the burn is 97.62 km, against 98.35 km before it.

**The burn straddles periapsis, and that is measured rather than inherited.**
Circularisation straddles apoapsis to avoid a lopsided orbit, but minimum Δv and
minimum eccentricity are different objectives and it is not obvious they agree.
Sweeping the ignition point across the burn:

| lead fraction | Δv | achieved | e |
| --- | --- | --- | --- |
| 0.3 | 817.3 | 50.7 × 149.1 km | 0.0268 |
| 0.4 | 817.9 | 69.2 × 127.1 km | 0.0158 |
| **0.5** | **818.3** | **88.5 × 105.7 km** | **0.0047** |
| 0.6 | 818.9 | 84.1 × 107.5 km | 0.0064 |
| 0.8 | 820.1 | 41.9 × 146.3 km | 0.0285 |
| 1.0 | 811.6 | 19.8 × 211.1 km | 0.0516 |

They do agree, to within 1 m/s across the whole sweep — straddling is both the
cheapest and by a wide margin the roundest. The residual e = 0.0047 is the
irreducible cost of a finite burn: the vehicle sweeps 7.6° of true anomaly while
thrusting and cuts off with about 7.7 m/s of radial velocity still on it.

#### Gating the burn on attitude

The coast attitude is nose-along-velocity about the Moon, so the burn attitude is
a **180° flip** — the largest slew in the mission, against the mid-course
correction's few degrees. The alignment phase is therefore entered a slew margin
*ahead* of the ignition point, not at it:

```
enter LOI_ALIGN   at  t_periapsis ≤ ½·t_burn + 60 s
ignite            at  t_periapsis ≤ ½·t_burn   and  pointing < 0.005 rad
```

Measured: the flip converges to 5 mrad in **20.85 s** against a rate-limited
floor of π/0.15 = 20.94 s, then holds aligned for a further 39 s before the clock
comes round. Retrograde is re-read every frame rather than frozen at ignition,
which the autopilot tracks for free — the target turns at 1.3 mrad/s against a
150 mrad/s slew rate — and the worst pointing error anywhere in the burn is
0.028 mrad.

The backstop runs the *opposite* way from the correction's. There the hazard was
igniting too early; here it is not igniting at all, because periapsis arrives
whether or not the vehicle is ready. So the timeout fires a full margin *past*
the lead point: a slightly mis-pointed capture beats a clean flypast.

#### Result

**88.45 × 105.70 km at e = 0.004702**, period 117.49 minutes, for 818.3 m/s over
149.4 s, with 2,719 m/s remaining. Verified by flying the achieved orbit three
revolutions in the live integrator rather than by quoting the elements the cutoff
itself read — which would be circular:

| | osculating at cutoff | flown | difference |
| --- | --- | --- | --- |
| periapsis | 1825.85 km | 1825.83 km | 15 m |
| apoapsis | 1843.10 km | 1843.09 km | 15 m |
| period | 7049.7 s | 7049.3 s | 0.35 s |

A second trim burn at an apsis would take the remaining 17 km of spread out; one
burn was the objective here, and the residual is reported rather than polished
away.

## Holding a halo orbit

The near-rectilinear halo orbit is built in layers, each with its own gate. A
corrector finds periodic orbits in the circular restricted problem and a
continuation walks the L2 family into the NRHO regime (`verify-cr3bp`,
`verify-nrho-family`). Put into this simulation's field — eccentric Moon, Sun
included — a family member is not a natural trajectory: flown unguided its
perilune drift doubles every revolution and it is gone after six, with a period
of 7.15 days against the model's 6.56 (`verify-nrho-ephemeris`). Held on perilune
radius one revolution ahead it survives, at 6.1 m/s a revolution against the
0.1–1 m/s a real NRHO plan budgets — a recalled figure, not derived here. The gap
is that perilune radius is one number and the orbit has six.

### A reference the real field has

`shootHalo` in `sim/halo.js` finds a trajectory this field actually flies, near
the family member and continuous from one revolution to the next. The
trajectory is split at patch points, each segment is flown on its own in the
simulation's own integrator, and Newton's method moves the patch states until
every segment arrives where the next begins:

```
D_k = phi(X_k; t_k -> t_k+1) - X_k+1          dX = -J^T (J J^T)^-1 D
```

J is each segment's state transition matrix, by central differences, and the −I
that ties it to the next patch point. There are six more unknowns than
equations — the choice of trajectory — and the minimum-norm update spends none
of them, so the answer stays as close to the family member as continuity allows.

Three choices were measured before any of it was written:

- **Patch points at apolune only, a revolution apart.** Perilune is where the
  orbit moves 1.7 km/s and turns fastest, so a slightly early or late arrival
  there is a large mismatch: seeded from the member, segments ending at perilune
  missed by a median of 1,900–15,500 km and 520–1,580 m/s across five seed
  mappings, where apolune-to-apolune segments missed by 1,500 km and 7 m/s.
- **The member placed about the Moon, in fixed CR3BP units.** Scaling it by the
  instantaneous Earth–Moon separation, as `insertMember` does, seeded
  2,900–3,100 km out. An NRHO's size is set by the Moon's gravity, not by how far
  away the Earth happens to be.
- **A fixed 30 s step and a fixed step count per segment.** Through a perilune
  passage 30 s integrates to 0.04–0.19 m where 60 s is 0.8–2.8 m, and a
  finite-difference Jacobian taken across runs with different step grids would
  measure the grid.

Fifteen revolutions converge in five Newton iterations and 4.5 s — the worst
mismatch 3,813 km, then 234 km, 31 km, 59 m, 0.95 m and 4.6 cm — with the patch
points moving up to 1,507 km and 14.8 m/s from the member. Re-flown at 15 s the
segments still meet to 0.12 m. The result is quasi-periodic rather than a repeat:
in a 13-revolution reference perilune runs 3,030–3,306 km, apolune 70,865–71,872
km, and perilune to perilune 6.30–6.72 days. Flown unguided from its start, the
craft stays within 0.1 km of it for twelve revolutions.

### Keeping to it

`solveHaloKeeping` burns at apolune for the state the reference has one
revolution later — a three-component burn fitted in least squares to position
and velocity together, in CR3BP units where a metre per second weighs as much as
375 km. On the reference with nothing disturbing it there is nothing to correct,
and so no cost to measure: a station-keeping budget exists only against errors,
and this simulation has none of its own. `verify-nrho-keeping` supplies them. The
controller solves from an estimate carrying Gaussian navigation error while the
craft flies its true state, and every burn is delivered 1% and 1° off, one sigma
each. Over twelve revolutions from the reference's start:

| law | navigation error | per revolution | furthest from the reference |
| --- | --- | --- | --- |
| none | — | — | 0.1 km |
| perilune radius | none | 3.28 m/s | 17,603 km |
| reference | 0.1 km, 1 mm/s | 0.004 m/s | 1.8 km |
| reference | 1 km, 1 cm/s | 0.026 m/s | 7.2 km |
| reference | 10 km, 10 cm/s | 0.417 m/s | 125.5 km |

Held on perilune radius, the craft is dragged off the orbit the field wants: that
law forces perilune to a constant the real orbit does not keep. Matching position
alone cost 0.143 m/s a revolution at the middle level against 0.045 for the full
state, flown with the same errors. And each level is one seeded flight — a
different seed moved the middle one from 0.026 to 0.045 m/s — which is why the
gate's thresholds sit at twice the measured cost or more rather than at it.

`NRHO_STATION_KEEP` flies this law itself when `enterNrhoCycle` is handed a
reference: the coast finds apolune from its own range samples, and the pass
solves, slews and runs the service module's engine until the craft weighs what
the correction leaves. Flown that way nothing idealises the delivery, and the
first flight put the craft into the Moon. The pass cut off on last frame's
thrust, so the frame after a cutoff saw none and the engine relit on alternate
frames until the 120 s hold ran out: a 2.1e-6 m/s correction delivered 166 m/s.
Cut off once, on the commanded throttle, every burn was still a whole 1x frame
of engine, 0.0505 m/s, and with its state known exactly the craft cost 0.05 m/s
a revolution and strayed 15 km. Each step of the burn is now held to the time
left to its cutoff mass. Over twelve revolutions from the reference's start, on
the Apollo 8 service module:

| flown by the sequencer | burns | per revolution | off the reference at apolune |
| --- | --- | --- | --- |
| undisturbed | 6 in 11 passes, 1.1–2.2e-6 m/s each | 8e-7 m/s | 0.35 m at most |
| kicked 10 cm/s along track | 11 in 11, the first 0.205 m/s | 0.029 m/s | 35.2 km, back to 0.28 km |

Every burn delivers what it asked to within 1e-12 m/s and books that, and the
limit allocates nothing, 0.01 B a call against a 56 B control. A solve takes
34–38 ms on the reference and up to 86 ms off it, once a revolution.

### Not yet

Getting onto the reference. The gates place the craft with `insertMember`, and
from that insertion no single burn captured it: a reference pinned to the craft
at its first apolune started 5,635 km and 54 m/s out, Newton stalled 2,700 km
short, and the burn it gave put the vehicle into the Moon. Arriving on the
reference belongs with flying the vehicle onto the halo from lunar approach,
which is still unwritten, so nothing enters the cycle with a reference except a
test that places the craft on it. And a reference ends: past its last patch point
the solve reports failure and the pass flies nothing, and nothing extends one yet.

## Coming home

`LUNAR_ORBIT → TEI_ALIGN → TEI_BURN → TRANS_EARTH → EI_SOLVE → EI_BURN →
SM_SEP → RE_ENTRY → DROGUE → MAIN_CHUTES → SPLASHDOWN`, targeting a 40 km
vacuum perigee and the water.

### Departure is an asymptote problem, not a phase angle

Injection *to* the Moon needed a phase angle because the target moves. The Earth
does not, in the frame that matters, so what has to be right is the **direction
the craft leaves the lunar sphere of influence**. Take the return ellipse as
apogee-at-the-Moon and perigee-in-the-corridor, and ask what excess velocity that
needs:

```
a = (r_M + r_p)/2 = 193,575 km     v_apo = sqrt(mu_E (2/r_M - 1/a)) = 186.2 m/s
v_inf = v_geo_target - v_moon      = 848 m/s, 0.73 deg from -v_moon
```

The departure is essentially **retrograde relative to the Moon's own motion** —
the craft leaves backwards along the lunar path so that what survives
geocentrically is the 186 m/s that falls to Earth. That is nearly the same
direction it arrived on, which is the time symmetry of the transfer.

The ignition point follows from the escape hyperbola's asymptote angle:

```
e = 1 + r v_inf^2 / mu_moon = 1.268     nu_inf = acos(-1/e) = 142.05 deg
```

so the burn point sits 142 degrees *behind* the required direction, measured in
the direction of travel. The sequencer waits 81.1 minutes of a 117.5 minute
orbit for it.

### Cutoff is on characteristic energy

`C3 = v² − 2μ/r`, selenocentric, targeting the value a one-shot solve picks at
ignition. A **threshold** rather than a turning point, and that is the right
shape because the objective genuinely is a target value: the departure needs one
specific excess speed, not the extremum of anything. C3 is negative while bound
and rises monotonically through a prograde burn, so there is no branch to get
wrong. Achieved 0.72771 against 0.72765 km²/s² — six parts in 10⁵ — for 829.9 m/s
over 413.9 s, across a staging event.

What makes it closed-loop is what made the capture's eccentricity minimum
closed-loop: it reads the state the vehicle actually reached, so mass-flow drift,
the 21 degrees of arc the burn sweeps, its gravity loss and any residual pointing
error are already inside the number being tested.

### The plane is not free, and it costs 23 m/s

The required departure direction sits **9.37° out of the parking orbit's plane**,
which an in-plane burn cannot produce. It is tempting to argue the return's plane
is unconstrained — only perigee radius is asked for — and let the trajectory be
inclined. That is wrong, and the measurement says so: an out-of-plane component
is still perpendicular to **r**, so it counts in full toward the angular momentum,
and perigee goes as h². About 168 m/s of the Moon's velocity survives uncancelled
at right angles, and projected perigee bottoms out at 6,487 km:

| prograde Δv | 763 | 796 | **829** | 862 | 895 m/s |
| --- | --- | --- | --- | --- | --- |
| projected perigee | 18,185 | 8,897 | **6,487** | 9,127 | 15,941 km alt |

The corridor is at 6,411 km *radius*. The curve never reaches it, so the
departure solve is a **minimisation**, not a root-find — get as close as the
plane allows, then trim. Fixing it at the burn point is not worth it: out-of-plane
thrust there buys 4.5 km of perigee per m/s, and squaring the orbit up costs
`2v sin(θ/2)` = 267 m/s. Removing the same error after departure, where the craft
is down to 280 m/s and turning its velocity is cheap, costs **23 m/s**.

The underlying lesson is a mission-design one: this plane was inherited from
whatever the arrival hyperbola gave, because the capture had no reason to care.
Apollo chose its insertion plane with the departure already in mind. Ours pays
23 m/s for not having.

### Why the trim is mandatory, in one number

Perigee moves **68.9 km per m/s** of transverse velocity at lunar distance. A
±10 km corridor therefore demands the departure velocity to **±0.145 m/s** out of
827 — two parts in 10⁴, which no cutoff on a seven-minute burn can hold. The
flown result makes the point without any appeal to theory:

| | perigee |
| --- | --- |
| impulsive solve at ignition expected | +6,478 km |
| the flown finite burn actually gave | **−1,528 km** |

An 8,006 km swing, and the sign matters — the uncorrected trajectory strikes the
Earth well inside the surface. The 21° of arc the burn sweeps is the whole
difference. This is Apollo's MCC-5 through -7, for the same reason.

When to trim is measured, and unlike the outbound leg it has no minimum — the
craft only speeds up on the way home, so leverage falls monotonically:

| trim point | Δv | still inside lunar SOI |
| --- | --- | --- |
| TEI+3 h | 19.29 m/s | yes |
| TEI+6 h | 21.31 m/s | yes |
| **TEI+12 h** | **23.02 m/s** | yes |
| TEI+24 h | 24.90 m/s | no |
| TEI+48 h | 29.19 m/s | no |

The spread is 10 m/s against 1,887 m/s aboard, so the choice is not a cost one.
12 h is far enough past a 414 s burn for the state to be clean and still cheap.

### The corridor, derived rather than transcribed

Targeting 40 km of vacuum perigee, measured against this simulation's own
geometry at the 122 km interface:

| vacuum perigee | entry velocity | flight-path angle |
| --- | --- | --- |
| 20 km | 10.987 km/s | −7.139° |
| **40 km** | **10.987 km/s** | **−6.398°** |
| 60 km | 10.987 km/s | −5.560° |

Apollo's corridor was −6.5° ± 0.5°, and ±10 km of perigee is ∓0.39° — so the
corridor comes out of the geometry here rather than being copied in. **Flown:
41.93 km against 40 km targeted, a 1.93 km miss, entering at −6.322° and
10.533 km/s** surface-relative.

### The capsule

`SHIP.stages` used to end at "Orion ESM" carrying 6,185 kg of dry mass with no
crew module in it — nothing to re-enter. That is split at the real ESM:CM ratio
into 2,308 kg of service module and a 3,877 kg capsule, which is exact to the
kilogram in total, so **everything from the pad through lunar orbit is
bit-identical** and only the re-entry vehicle is new.

The capsule's area holds the **ballistic coefficient**, not the diameter. Entry
depends on β = m/(Cd·A) and on nothing else about mass and area separately — it
is the only vehicle property in `a = ρv²/2β` — so 1.25 × 7.385 m² against
3,877 kg reproduces Orion's real **420 kg/m²** and with it the real deceleration
and heating altitudes. Matching the 5.02 m diameter instead would give
157 kg/m², which brakes too high and turns a lunar return into a gentle entry.

Worth stating plainly: with a *true-mass* Orion this mission would not close.
ESM Δv would be 3098.9·ln(25172/16572) = **1,295 m/s** against LOI + TEI =
1,648 m/s. That gap is exactly why Artemis flies a near-rectilinear halo orbit
rather than a 100 km low lunar orbit — this vehicle only makes the round trip
because it is 10 t light.

### Entry, and why it is not Apollo's 6.5 g

| | measured | note |
| --- | --- | --- |
| interface velocity | 10.533 km/s | surface-relative, at 122 km |
| flight-path angle | −6.322° | Apollo corridor −6.5 ± 0.5 |
| peak deceleration | **12.17 g** at 44.2 km | ballistic — see below |
| peak dynamic pressure | 50.1 kPa | |
| peak convective flux | 156 W/cm² at 52.7 km | Sutton-Graves |
| peak radiative flux | 256 W/cm² at 59.8 km | Tauber-Sutton |
| **peak total flux** | **390 W/cm² at 59.3 km** | |
| integrated heat load | 17.6 kJ/cm² over 181 s | |

Those are the *ballistic* figures, and they are reproducible on demand by setting
`PROFILE.entryLiftToDrag = 0`. The capsule now flies lifting, which is the next
section — and which brings 12.17 g down to 6.28.

### Lift, and the one control a capsule has

A blunt body trims at a fixed angle of attack because its centre of mass is
deliberately offset from the axis of symmetry. So lift *magnitude* is not a
control at all: at L/D = 0.3 the capsule makes the lift it makes, and the only
authority the flight computer has is **which way it points**.

```
a_lift = liftK rho v_rel^2 (cos(sigma) u + sin(sigma) w)
u = local vertical, projected perpendicular to the relative wind
w = v x u                          sigma = 0 up, pi down, +-pi/2 lateral
```

The frame is built on the *wind*, not the position — the air is turning at
400 m/s and lift acts on the flow the vehicle meets. And the split between force
and command mirrors the one thrust already makes: `liftK` is a vehicle property
and the force is recomputed inside every RK4 stage, because it depends on
position through density and on velocity quadratically; `bank` is a command, held
constant across the four stages, because a control input that varied inside a
step corresponds to nothing a flight computer could issue.

This is the first time attitude is **dynamics** rather than presentation. Before
it, the capsule's orientation was drawn and ignored.

### The autopilot is a demand law, not an error law

Two demands blended about a nominal 60° bank: rising load pushes toward lift up,
an incipient skip pushes toward lift down, and neither does anything until its
hazard is real.

The obvious alternative is worth recording because it fails spectacularly.
Tracking `g − target` proportionally looks equivalent, and is not: *below* the
target it commands lift-down to build load, so from an interface where g is still
zero it rolls to full dive and holds there until the load arrives — by which time
the capsule is deep, fast, and the loop has no authority left. Measured, that law
peaked at **149 g** against ballistic's 12.

Cross-range is managed by reversing the bank's sign, which is free — the loop
only sets |cos σ|. The reversal test is stated on the cross-range *rate*, not on
the bank's sign, deliberately: whether a positive bank drives cross-range
positive depends on how the lateral axis was constructed, and a version that
reasoned from that convention had it backwards and never reversed at all,
flying 194 km off plane. Asking whether the vehicle is currently moving further
out cannot be got backwards.

### What lift actually buys, and what it costs

Same trajectory, same corridor, the only difference being L/D:

| | ballistic | guided |
| --- | --- | --- |
| lift-to-drag | 0 | 0.30 |
| **peak deceleration** | **12.17 g** at 44.2 km | **6.28 g** at 54.5 km |
| peak dynamic pressure | 50.1 kPa | 25.9 kPa |
| peak total flux | 390 W/cm² | 373 W/cm² |
| **integrated flux** | **17.6 kJ/cm²** | **20.3 kJ/cm²** |
| entry phase duration | 257 s | 404 s |
| seconds above 50 W/cm² | 88 s | 112 s |
| seconds within 1 g of target | 20 | 30 |
| bank reversals | 0 | 15 |
| peak cross-range | — | −133 km |
| splashdown | 8.44 m/s | 8.44 m/s |

Peak load halves and lands within 0.22 g of the 6.5 g target. Peak pressure
halves. But the integrated flux goes **up**, by 15%, and that is not a defect —
it is the trade.

The mechanism is measured rather than asserted, because the integral alone does
not establish it. Lift holds the capsule high, so the entry phase runs **257 s →
404 s** and the time above 50 W/cm² runs **88 s → 112 s**: 27% more time in the
fire at a lower rate, netting 15% more total energy absorbed. That is why a
lifting re-entry vehicle carries a thick ablator rather than a thin one, and it
is the sort of result that only falls out of flying both cases through the same
integrator.

### Heating is two terms, and the larger one is radiation

Sutton-Graves gives the convective flux out of the boundary layer. At orbital
speeds that is the whole story, which is why it is usually the only term modelled.
At 10.5 km/s it is not: the shock layer *radiates*, and by the Tauber-Sutton
correlation that term is the bigger one.

```
q_conv = k sqrt(rho/Rn) v^3            k = 1.7415e-4
q_rad  = C Rn^a rho^b f(V)             C = 4.736e4, b = 1.22
         a = 1.072e6 V^-1.88 rho^-0.325, capped at 1
```

The two peak in different places, and that is the point of carrying them
separately rather than summing into one number:

| altitude | convective | radiative | total | ratio |
| --- | --- | --- | --- | --- |
| 90 km | 15.4 | 5.4 | 20.8 | 0.35 |
| 80 km | 36.4 | 44.1 | 80.5 | 1.21 |
| 70 km | 76.6 | 128.2 | 204.8 | 1.67 |
| **60 km** | 132.0 | **255.6** | **387.7** | 1.94 |
| 55 km | 153.2 | 163.1 | 316.3 | 1.06 |
| 50 km | 150.9 | 0.0 | 150.9 | — |

Radiation peaks **higher and earlier**, where the craft is still fast and the air
still thin, because it goes as ρ^1.22·f(V) against convection's √ρ·v³ — and f(V)
climbs roughly as the ninth power of velocity. Convection peaks lower and later,
in the thick air. Neither peak is where the *total* peaks.

Three honest caveats, none of them cosmetic:

- **The zero below 9 km/s is the fit's floor, not physics.** Tauber-Sutton is
  tabulated from 9 to 16 km/s and has nothing to say underneath, so radiation is
  reported as zero there rather than extrapolated off the bottom of a very steep
  curve. The integrated load is therefore a slight underestimate; the peak is
  not, since it happens at 10 km/s.
- **The nose radius is outside the correlation's range.** It is fitted for
  roughly 0.3–3 m and Orion's heat shield is 6.03 m. The exponent cap at 1 is
  the paper's own acknowledgement that the R_n dependence saturates once the
  shock layer goes optically thick, which is the regime a 6 m radius is in, but
  this is an extrapolation and is flagged as one.
- **390 W/cm² belongs to *this* corridor.** Flux climbs steeply with entry angle,
  so a steeper lunar return would be materially hotter. The figure is not a
  general lunar-return constant.

The control case makes the case for carrying the term at all: the same capsule
returning from low Earth orbit at 7.8 km/s sees **zero** radiative flux by this
correlation — off the bottom of the fit entirely. An orbital-entry model can omit
radiation. A lunar-return one cannot.

### Parachutes open, they do not appear

Two stages, because one is not survivable. Stepping straight to the main canopies
at 8 km and Mach 0.8 would be about **390 g**. Drogues first, then mains, each
inflating on a first-order opening that models reefing rather than a step:

| | altitude | speed | Cd·A | peak load |
| --- | --- | --- | --- | --- |
| drogues | 8.00 km, Mach 0.50 | 155 m/s | 25 m² | |
| mains | 3.00 km | 53 m/s | 860 m² | |
| both | | | | **2.62 g** |

Splashdown at **8.44 m/s** of descent rate, against Orion's real ~9 m/s. The rate
is quoted vertically and surface-relative on purpose: inertially the capsule is
still doing 450 m/s, essentially all of it the ocean moving with the planet.

The capsule is then held on the surface by a constraint applied after the step,
exactly as the pad hold is and for the same reason — modelling flotation as a
force would be the stiffest term in the system and would collapse the step size
for everything else.

### Result


150 × 7600 km at 28.6° inclination, Max-Q 22.7 kPa, MECO at T+487s — against a
real SLS core MECO of about T+480s. The throttle bucket eases to 70% through
Max-Q and a 4 g limiter holds acceleration as the tanks empty, both of which a
real launch vehicle flies.

The stack is SLS Block 1: 2561 t at liftoff (real 2608 t), 39.44 MN, TWR 1.57.
The boosters and core burn together off the pad, modelled as one stage with the
combined thrust and a flow-weighted Isp — the staging engine burns one stage at a
time and a parallel-burn model would buy accuracy this does not need.

Circularisation is the natural next phase: MECO leaves an elliptical transfer
orbit, and the ICPS keeps 6780 m/s for it and for TLI.

## Volumetric atmosphere

Single-scattering Rayleigh + Mie, raymarched — `src/gfx/atmosphereShader.js`.
Two structural decisions:

**A shell mesh, not a post-process.** A fullscreen pass would have to
reconstruct world position from the depth buffer, and this renderer uses a
*logarithmic* depth buffer — so that reconstruction would mean inverting three's
log encoding, and would break silently if the setting ever changed. A shell is
depth-tested by the GPU for free, so anything in front occludes it correctly
with no depth maths at all, and only the covered pixels get shaded. The ground
truncating the march is solved analytically by ray-sphere intersection.

**The march runs in planet radii, not scene units.** Every length is normalised
by Earth's radius, so the shader never touches a large coordinate and float32
precision is a non-issue wherever the planet sits. The one quantity that could
be large — the camera's offset from the planet centre — is differenced on the
CPU in float64 and arrives already small.

Coefficients are real: β_Rayleigh (5.8, 13.5, 33.1)×10⁻⁶ m⁻¹, β_Mie 21×10⁻⁶,
scale heights 8 km and 1.2 km, Mie asymmetry g = 0.758. The λ⁻⁴ dependence
scatters blue nearly six times as hard as red, which is the whole reason the
limb is blue and grazing light goes orange.

The one exaggeration is declared: the atmosphere renders **3.5× thicker** than
reality. At true scale it is 1.57% of the planet radius — under two pixels at
normal viewing distance, truthful and invisible. The scale heights are stretched
by the *same* factor, so the density profile keeps its shape and the scattering
coefficients are untouched: taller, not differently coloured.

## Aerodynamics

`src/sim/atmosphere.js` is a piecewise-exponential density model (Vallado
Table 8-4) — 28 segments from sea level to 1000 km. A single exponential scale
height, the usual shortcut, is wrong by orders of magnitude above ~100 km, which
is exactly where satellites live.

Drag enters the RK4 derivative as

```
a_drag = −(Cd·A / 2m) · ρ(h) · |v_rel| · v_rel
```

Three things worth stating:

- **Drag is evaluated inside every RK4 stage, unlike thrust.** Thrust is a
  zero-order hold — constant across the step, which RK4 integrates exactly.
  Drag depends on position through density and on velocity quadratically, so
  freezing it would drop the integration to first order precisely where the
  dynamics are stiffest.
- **The air co-rotates with the planet.** Relative wind subtracts ω × r, which
  is 465 m/s at the equator — 6% of orbital speed, and the difference between a
  prograde and a retrograde entry. The spin axis is shared with the renderer's
  obliquity, so the air turns with the planet you can see turning.
- **Ballistic mass is not gravitational mass.** These craft stay gravitationally
  massless test particles; the mass in the drag term says how hard the air pushes
  them, nothing more.

The step ceiling now takes whichever is tighter, the orbital period limit or a
drag limit holding velocity change under ~2% per step — a craft at 100 km sheds
velocity in seconds.

Validation: the ISS loses **4.5 km/month** and Hubble 0.95 km at 540 km. Real
ISS decay is ~2 km/month at low solar activity and well above 4 at high, and
this density model runs 1.33× high at that altitude — so both the magnitude and
the ~5× ordering between them come out right.

## Staging

`SHIP.stages` is an ordered list; each carries its own dry mass, propellant,
thrust and Isp. Mass flow is ṁ = F/(Isp·g₀), so acceleration climbs through a
burn as the tanks empty. A stage separates automatically on depletion — or on
`Enter` — and its dry structure stops being carried, which is a step change in
both acceleration and ballistic coefficient.

Δv is summed stage by stage rather than from one mass ratio, because each stage
has its own exhaust velocity and separating drops structure the stages above
never have to accelerate. The default stack is Artemis-like above Earth orbit:
ICPS (4096 m/s, enough for the ~3150 m/s TLI) then Orion's service module
(2701 m/s).

## Spacecraft meshes

`public/models/` holds NASA's public-domain assets; the catalogue in
`src/gfx/modelsManifest.js` is **generated** by `npm run models:scan` rather than
hand-written, so adding a file is enough to make it appear in the HUD selector.
Each craft has its own dropdown and loads only the mesh assigned to it — the
catalogue is 140 MB and one entry alone is 63 MB.

Three things this pipeline has to get right:

- **The probe is an allowlist, not a "not HTML" test.** Vite answers a request
  for a missing file with `200 text/html`, and one for an unknown extension such
  as `.7z` with `200` and *no* content-type. A negative test accepts both, and
  GLTFLoader then tries to parse markup or archive bytes as a mesh. Only
  `model/gltf-binary`, `model/gltf+json`, `application/octet-stream` and
  `application/json` pass.
- **Draco is not optional here.** 22 of 48 models require
  `KHR_draco_mesh_compression`, including most of the headline fleet. The
  decoder is copied out of three into `public/draco/` by `models:scan` and served
  locally, so the app keeps its no-network property.
- **Paths are URL-encoded per segment.** NASA's folder names are full of spaces
  and parentheses; unencoded requests fail outright.

Models are auto-centred and scaled to the craft's rendered size with bounds
recomputed. That matters more than it sounds: the catalogue spans a 4000× range
of source scales, from Voyager at 0.34 units across to Bennu at 1350.

## Lagrange points

L1–L5 for the Earth-Moon system, derived live in `src/sim/lagrange.js`. Our
Moon's orbit is emergent, so constants will not do: over 30 days the live
separation runs 362,558–406,733 km, swinging L1's distance from Earth by more
than 37,000 km.

The three collinear points are roots of one function, normalised so the
separation is 1 and the barycentre is 0:

```
f(x) = x − (1−μ)(x+μ)/|x+μ|³ − μ(x−1+μ)/|x−1+μ|³
```

separated by the poles at the two bodies, so each gets its own bracket and a
bisection that cannot diverge. Because μ is constant those roots are constant
too, so they are solved **once at module load** and per-frame work is a scale
and a rotation. In the elliptic restricted three-body problem the equilibria
stay at the same normalised positions and breathe with the instantaneous
separation, so scaling a fixed root by the live `r` is the ER3BP result rather
than an approximation. Solved values match published figures: L1 326,376 km,
L2 448,921 km, L3 −381,675 km.

L4 and L5 are exact — the Earth-Moon vector turned ±60° about `ĥ = r⃗ × v⃗`, so
they inherit the true instantaneous orbital plane, inclination and precession
included, with no constants at all.

They render as DOM waypoints in the HUD, not geometry. The projector recomputes
the camera's inverse itself rather than reading `matrixWorldInverse`, which R3F
refreshes just before draw and is a frame stale at `useFrame` time.

## Scale, and where it is honest

A true-to-scale system is unwatchable: at one screen-width per AU the Earth is a
third of a pixel. The renderer applies three exaggerations, all declared in
`src/sim/scale.js` and surfaced in the HUD:

- orbital positions, linear — 1 AU = 120 scene units, preserving orbit shape
- body radii, per body — Earth ×225, Sol ×8
- the Moon's *offset from Earth* ×24, to lift it clear of Earth's disc

**The integrator never sees any of this.** Only `toScene()` does.

## Rendering

- **Lighting** — a single point light inside the Sun, at 42,000 cd, with physical
  1/r² falloff. Shadows come from its cube shadow map, which produces genuine
  lunar eclipses (Earth's umbra swallowing the Moon) and solar eclipses (the
  Moon's shadow crossing Earth's disc). In the exaggerated display geometry
  these fall roughly every 15 days, so they are actually watchable.
- **Earth** — `meshStandardMaterial` with albedo, normal and roughness maps
  generated from one shared elevation field, so the maps agree with each other.
  City lights are patched into the emissive term via `onBeforeCompile` and masked
  by sun angle, so they only glow on the night side. Separate cloud sheet at
  1.06× the surface rotation rate, plus two atmosphere shells.
- **Atmosphere** — Fresnel rim gated by local sun angle, with sunset reddening
  keyed to the *phase angle* rather than the surface normal. That distinction
  matters: keying it off the normal paints a sunset ring around a fully lit
  planet, when a front-lit limb should be blue. The outer halo fades on an
  exponential density profile in the ray's impact parameter, so it decays to
  nothing instead of stopping at the shell's silhouette.
- **Blood moon** — a shadow map can only subtract light, so an eclipsed Moon
  would render black. The copper glow is not attenuated sunlight but light
  *refracted through Earth's atmosphere*, arriving along a path the shadow map
  knows nothing about, so it is injected as an additive irradiance term rather
  than as an override of the shadow attenuation. See below for the geometry.
- **Trails** — `Line2` with per-vertex RGBA, sampled from the integrator and
  stored relative to the parent body. The buffers are written in place; the
  geometry helpers reallocate on every call, which is not something to do per
  frame. On mount each trail is seeded by running a *copy of the system
  backwards*, so it shows real integrated history from the first frame rather
  than taking a simulated year to draw itself in.

### The blood-moon geometry

`attachBloodMoon` in `src/gfx/shaders.js` builds the classical two-cone shadow
of an extended source, in display space:

```
rU(t) = Re - t (Rs - Re) / d      umbra, converging
rP(t) = Re + t (Rs + Re) / d      penumbra, diverging
```

with `t` measured along the Sun→Earth axis behind Earth and `r` perpendicular to
it. These reproduce the published figures exactly — umbra cone 1.382 M km, umbra
radius at the Moon 4599 km, spanning 2.65 lunar radii.

What makes the tint register against the existing shadows with no fudge factor
is that three's *point* light draws its hard edge at `rS(t) = Re (d + t) / d`,
and

```
( rU(t) + rP(t) ) / 2  =  Re + t Re / d  =  rS(t)
```

identically, for every `t`. The renderer's approximation sits exactly on the
midpoint of the physical penumbra band, so `smoothstep(rU, rP, r)` crosses 0.5
precisely where the drawn shadow begins.

Three further details. The contribution is scaled by `diffuseColor`, so the
albedo map stays in play and the maria remain darker than the highlands through
totality. The colour ramps from deep red on the axis — where the refracted light
has crossed the most atmosphere — to brighter orange at the umbra edge. And the
terminator's softness is *derived* rather than dialled in, as `Re / |P - E|`:
an extended source of that angular radius wraps light exactly that far past the
geometric terminator, so the falloff stays correct if the display scale is
retuned.

### Known limitation: eclipse shadow resolution

three unwraps a point light's cube shadow into a single 4×2 atlas, so
`mapSize: 2048` already allocates an 8192×4096 depth texture — the practical
ceiling. At 120 scene units from the Sun that leaves a solar eclipse's umbra
spanning only a handful of texels, so `shadow.radius` does the remaining work.
The result is soft rather than crisp, which is also the more honest outcome: the
Sun is an extended source, and real eclipses have a penumbra far wider than the
umbra. A tight-frustum directional light would resolve it sharply, at the cost
of no longer being a single light source.

Note also that `PCFSoftShadowMap` is the wrong choice here — three only
implements soft filtering for 2D shadow maps, and a point light under it falls
through to a single hard sample. The scene uses `PCFShadowMap`.

## Layout

```
src/
  sim/       constants · scale · rk4 · system · ship · atmosphere · launchsite · mission · targeting · lagrange · live · store
  gfx/       procedural texture synthesis (worker) · shaders · asset loading
  components/ scene graph, physics driver, camera rig
  ui/        HUD, telemetry, controls
scripts/     headless flight harness + verifications · texture preview dump · HD fetch · minimal PNG codec
```

### Flying it headlessly

`scripts/flight.mjs` reproduces `Driver.jsx`'s frame loop exactly — same
ordering, same clamped delta, same warp ladder and powered-warp cap — with no
renderer attached. Every mission figure in this file comes from it, and can be
re-measured:

```bash
node scripts/flight.mjs --until LUNAR_ORBIT --save orbit.json
```

Alongside it are the checks each phase is claimed on. They take a snapshot so a
phase can be re-flown without re-flying the mission:

| script | what it establishes |
| --- | --- |
| `verify-anomalies.mjs` | apsis clocks against a two-body propagation, both branches |
| `verify-approach.mjs` | where the selenocentric conic becomes real |
| `verify-loi.mjs` | the capture, checked against an independent propagation |
| `verify-loi-sweep.mjs` | ignition placement, closed vs open loop, step ceiling |
| `verify-staging.mjs` | a separation forced into the middle of the capture |
| `verify-warp.mjs` | the ascent from every warp level, and a pilot meddling mid-count; the same parking orbit at 60x and at 1x |
| `verify-return.mjs` | departure, corridor trim, entry loads and splashdown |
| `verify-tei-timing.mjs` | when the corridor trim is cheapest |
| `verify-heating.mjs` | convective against radiative, down the whole entry |
| `verify-entry-guidance.mjs` | lifting entry against ballistic, same trajectory |
| `verify-nrho-cycle.mjs` | the sequencer's first cycle, and that it does not leak |
| `verify-cr3bp.mjs` | the halo corrector, against full-period closure |
| `verify-nrho-family.mjs` | continuation into the NRHO regime, and that it *is* one |
| `verify-nrho-ephemeris.mjs` | the CR3BP seed in the real field, and how fast it diverges |
| `verify-nrho-keeping.mjs` | station-keeping: the perilune law, then a real-field reference held against navigation and execution error, and by the sequencer's own cycle |
| `verify-director.mjs` | the camera director cuts on phases, not on frames |
| `record-attitude.mjs` | captures real attitude through the hardest phases to film |
| `verify-camera-filter.mjs` | replays it through both follow filters, and measures |
| `verify-allocation.mjs` | heap delta over 60,000 frames, under `--expose-gc` |

The harness starts at the store's own default of 1 day/s rather than at a safer
setting of its own, because that is exactly the case that used to break — see the
warp constraint above. `verify-warp.mjs` flies the ascent from all eight warp
levels and, separately, flies a pilot who winds the dial up *during* the count,
after the sequencer's one-shot request has already been applied. Every one
reaches a stable parking orbit; peak speed never exceeds 8.80 km/s, against the
13.2 km/s the broken case reached before the vehicle left the system.

`window.__spx` exposes the live simulation and the R3F state in dev builds.

## Fetching the real imagery

`npm run textures:fetch` pulls public-domain sources and does the two bits of
work they need:

| Slot | Source |
| --- | --- |
| Earth albedo | NASA Visible Earth — Blue Marble Next Generation, 5400×2700 |
| Earth night | NASA Earth Observatory — Black Marble / VIIRS, 3600×1800 |
| Earth normal, specular, clouds | three.js example assets, 2048/1024 |
| Moon albedo | NASA SVS CGI Moon Kit — LROC WAC colour, 4096×2048 |
| Moon normal | derived from CGI Moon Kit LOLA displacement, 5760×2880 |

The Moon needs both. The kit ships 16-bit TIFF, which no browser decodes, and it
provides a *displacement* map rather than a normal map — so the script converts
the format and derives tangent-space normals from the real LOLA elevation.
Pairing NASA's lunar albedo with the procedurally generated normals would put
invented crater relief underneath real maria; deriving them makes the two agree.
Slopes are computed in metres per texel with the longitude derivative divided by
cos(latitude), then exaggerated by a single documented `RELIEF` factor.

The Milky Way stays procedural: no public-domain equirectangular panorama had a
stable enough URL to hard-code.

## HD texture swapping

`src/gfx/hdTextures.js` probes the manifest with `HEAD` before fetching. The
content-type check is not defensive padding: Vite's SPA fallback answers `200`
with `text/html` for any missing file, so a plain `res.ok` test would "find"
every texture and then fail at decode.

Materials are built once from the procedural set and never rebuilt — the swap
rebinds `map` / `normalMap` / `roughnessMap` / `emissiveMap` in place and sets
`needsUpdate`. That matters because both `onBeforeCompile` patches (Earth's
night lights, the Moon's blood-moon term) hold live uniform objects; rebuilding
the materials would drop them, whereas a program rebuild simply re-runs the
patch against the same instances.

The swap cannot disturb the integrator. Loading is async and off the render
loop, and the physics driver clamps its frame delta to 1/20s, so even a stalled
frame during GPU upload advances the simulation by a bounded amount rather than
teleporting the planets.
