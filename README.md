# SpxSim — Sol · Terra · Luna

A real-time three-body simulation of the Sun, Earth and Moon, integrated with a
4th-order Runge-Kutta scheme and rendered with React Three Fiber.

```bash
npm install
npm run dev
```

The scene is entirely self-contained: every texture — Earth, Moon and the Milky
Way skybox — is synthesised procedurally in a Web Worker at load (~4s), so there
are no asset downloads and nothing to break offline.

Real NASA imagery is opt-in:

```bash
npm run textures:fetch
```

That pulls Blue Marble, Black Marble and the CGI Moon Kit into
`public/textures/` (~13 MB). Then switch on **HD textures** in the Render panel:
nothing is fetched until you click it, the maps are layered over the procedural
set so partial installs work, and toggling back is instant because neither set
is ever discarded. See [public/textures/README.md](public/textures/README.md)
for the file names if you would rather supply your own.

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

**Test particles are structurally massless.** Tier one is pair-symmetric among
Sun/Earth/Moon; tier two reads gravity and writes none. The planetary solution
is bit-identical with the fleet aboard — verified, max difference exactly `0`.

**Finite burns straddle their target point.** Ignition is scheduled half a burn
early, from the rocket equation. A burn applied entirely after apoapsis raises
periapsis on one side only and leaves the orbit lopsided.

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

Locking flies the camera in over ~1.2s and then follows, translating the camera
and the orbit target by the same vector each frame — so your zoom and viewing
angle survive the body moving underneath you.

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
| seconds within 1 g of target | 20 | 30 |
| bank reversals | 0 | 15 |
| peak cross-range | — | −133 km |
| splashdown | 8.44 m/s | 8.44 m/s |

Peak load halves and lands within 0.22 g of the 6.5 g target. Peak pressure
halves. But the integrated flux goes **up**, by 15%, and that is not a defect —
it is the trade. Lift holds the capsule high, which lowers the instantaneous
rate and lengthens the exposure, so the shield sees a gentler fire for longer and
absorbs more total energy. It is why a lifting re-entry vehicle carries a thick
ablator rather than a thin one, and it is the sort of result that only falls out
of flying both cases through the same integrator.

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
| `verify-warp.mjs` | the ascent from every warp level, and a pilot meddling mid-count |
| `verify-return.mjs` | departure, corridor trim, entry loads and splashdown |
| `verify-tei-timing.mjs` | when the corridor trim is cheapest |
| `verify-heating.mjs` | convective against radiative, down the whole entry |
| `verify-entry-guidance.mjs` | lifting entry against ballistic, same trajectory |
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
