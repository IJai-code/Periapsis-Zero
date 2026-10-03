# Changelog

Notation: a claim stated as a number is one a gate measures. Anything measured
but not yet fixed is under *Known limitations* rather than left out.

## Unreleased — targeting 1.0.0

### The face, the four colours, and the sky that writes its own missions: 2 October 2026

The identity, the camera and the game layer, in one pass.

**The identity.** The old face was champagne serif over charcoal: a light
Cormorant Garamond with wide tracking, Inter for prose, hairline borders,
soft glass. Pretty, and the same pretty every tooling demo wears. Display is
now **Rubik Dirt** (eroded, blotchy, printed rather than generated), prose is
**Bricolage Grotesque**, figures are **Space Mono**. The serif and the clean
sans are gone. The palette is four colours and only four: **void**
(#120b22), **bone** (#f4e8cf), **ember** (#ff6b2c) and **ion** (#2fd3ff),
enforced by remapping the stock white, black, amber and red tokens so the
200-plus existing call sites fold into the four without a single edit. Ion
cyan is not decoration: the flight plan is drawn cyan in the scene, so the
plan's numbers wear the same colour on the glass. Panels carry the blotch:
borders of two weights (thick where the light comes from), corners that do
not match, a hard offset shadow like a sticker, and a grain plate over every
surface. Motion is rationed: every hover and press answers in 120 ms with 60
ms of physical travel, the entrance fades are gone, and the em dash is
retired across the interface (prose uses commas, colons and full stops;
readouts use a middle dot where a dash sat).

**The camera.** The pad camera was a mount bolted to one spot on one
bearing, which is the shot every low-budget launch scene has. It is a crane
now: a slow lateral arc, a few degrees of bearing, a fifth of its height, on
three incommensurate periods that read as a shot that lives rather than as
motion (shared with the mission intro's arrival frame on the same clock, so
the hand-off is seamless). The lens holds the vehicle at a shrinking
fraction of frame as it climbs, so ground and horizon stay in the shot.
Arrivals at the ground are shaped like a flyover that turns final: the pan
happens first at altitude, the descent happens last along the shot's own
axis, the horizon in frame the whole way down. The old move dove radially
along the chord, which over a rotating Earth meant a long slide across open
ocean and the pad arriving from nowhere. And a click is a glance again: when
the pan is inside a few view widths the zoom-pan geodesic straightens into a
glide instead of zooming the world out, pinning across it and zooming back
in (one constant, `DIRECT_RHO`, in `gfx/zoomPath.js`).

**The Almanac: missions the sky writes.** Every board in this product lists
work a person invented. This one is generated from the solar system as it
actually stands: the gap between the vehicle and the station right now, how
far out the Moon is this hour, whether an eclipse is in the sky at this
moment. Read it on another night and the numbers are different, because the
sky is different. What it arms is a program like any other: legs priced by
the rocket equation, objectives from the same vocabulary, the same
checklist. One new check joins that vocabulary, `eclipsePlate`, which reads
what the sky was doing when the shutter opened (the plate log is the only
thing that remembers that), and the eclipse briefing is generated only when
an eclipse is actually in the sky: a board that invents events is a board
that lies. `verify-programs` holds the generator to its own arithmetic with
a fixed sky, and is nine checks.

**The story continues.** A flown chapter now offers the next one on the
checklist itself ("Chapter flown", and the button right there), the record
written by the same tick that latches the last objective. Arming a story
chapter or an Almanac briefing goes through one path (`ui/beginDef.js`), so
the pad choice, the fuel load and the hand-off to the ground camera behave
identically wherever the flight was begun from.

Nothing in the flight model changed; the same 68 gates hold it.

### The clock catches up with the sky, and the cockpit keeps still: 2 October 2026

Two reports, one redesign, and a story.

**The clock catches up with the sky.** A pilot at midday local opened the page
to a night side. The sim's clock was correct for the J2000 epoch it was pinned
to — and nothing advanced that pin to now, so the terminator on screen was
right for 1 January 2000 and wrong for every day since. The simulation now
boots at real time (`sim/system.js`: `createSimulation(t)` takes the moment,
`live.js` passes `NOW_T`), with Earth and the Moon placed at that instant by
the same mean-element rates the Moon's own fit uses — carried from the J2000
constants, so a gate's fixtures are byte-identical at t=0. And booting at now
exposed a second, older bug the old boot had hidden: the Earth element's mean
anomaly was 358.617° where J2000 says 357.517°, so the Sun in this sim had run
1.9° hot since the first commit. With both fixed, the Sun measures 0.85° from
the almanac, the Moon 0.8°, and the terminator agrees with mean solar time to
7.6 minutes — inside the equation of time's own 16.4-minute swing. The claim
is held by a new gate, `verify-clock` (7 checks), which embeds the USNO and
truncated-Meeus almanac formulas itself and shares no code with the sim; the
three flight fixtures and the Moon's mean fit were regenerated against the
corrected system, and `verify-rails` was re-measured — its old 1.1° phase
tolerance was the very error this entry retires, and the integrated and
tabulated Earths now start 0.0007° apart. 68 gates.

**The context that comes back.** A second pilot reported the graphics API
"losing randomly regardless of platform." Random-looking context losses are
near always memory pressure, and the browser restores the context on its own
in almost every case — so the recovery now spends the governor's own levers
on restoration: a first loss gives back a quarter of the pixels, two in one
session is a pattern and gives back the dearest things first (the shadow map,
then a third of the pixels), and the comfort refund earns them back only if
the machine is genuinely fine. The dialog exists for the seconds in between,
and no longer for longer.

**A quieter cockpit.** The first impression was six stacked panels over two
rails over the Earth — furniture, not a view. The instrument rails now start
closed on every viewport: what a flight needs in its first minute is the
flight strip, the clock and the count, and everything else is a question the
pilot asks when they ask it. The six setup panels — missions, contracts, the
pad, the craft catalogue, the planet's interior, the display switches — move
behind one drawer (`S`, or its button in the control bar), composed rather
than re-implemented; the mission checklist moves out of the panels and rides
the rail on its own, whenever a program is armed, because a plan you have to
summon is a plan you fly past; and the Lagrange markers and the planet's
interior join the ambience as things a visitor asks for. `H` keeps its
rail. The dead `shipPanel` flag is gone.

**The governor learns to keep still.** The same report called it "crappy
tweaking lag": the resolution governor, judging every 1.5-second window
alone, stepped the pixel ratio down and back at the threshold's edge forever,
and each step reallocated every render target — the visible hitch. It now
asks for two consecutive windows of evidence before any comfort-path move
(four seconds, not one and a half), ignores a third of a second after any
lever change instead of three frames (the old window counted the machine's
own reallocation into its next decision, which is how one step became
three), and pays the same hold on an up-step that a down-step pays — the
anti-oscillation clause. The panic path is unchanged: three 60-ms frames
still get rescued instantly. `verify-ui-pace` holds the lever order and the
refund order as before.

**The story.** Six chapters, in order — First Orbit, Rendezvous, Alone in
the Sky, The Crossing, Far Side, Contact — the career of a pilot in
miniature. Each is a program in every mechanical sense: legs priced by the
rocket equation, objectives evaluated from the live state, the checklist
riding the rail. What makes it a story is that each chapter unlocks the one
before it by having been *flown* — the record is written by `tickProgram`
the tick the last objective latches, and kept in this browser — and that the
briefs say what the flight is for. Every chapter arms at the Trainee wing;
`verify-programs` holds the chapters to everything it holds the routes and
the jobs to, plus a check that the chain is honest.

### The door opens outward — 1 October 2026

Three things asked for by the first people to visit, and one thing they
shouldn't have to ask for.

**The generated score is gone.** The mission intros played a soundtrack written
by the tooling that built them, and the owner wanted it out: the one piece of
music in the product is now the bed the owner themselves supplied, behind the
ambience toggle. The intro films are silent — the way real footage of the
missions is silent until a narrator speaks — and the films' recorder no longer
reaches for an audio track that no longer exists. `verify-audio` gained the
check that keeps it gone, and lost none of its teeth: five checks now.

**The search arrives.** Choosing Andromeda from the search used to begin a
pilot-speed move toward a target 2.5 million light-years out — the visitor
watched nothing happen for their trouble, which is the fairest complaint the
site has received. The warp ladder cannot cross intergalactic space and was
never meant to, so a search choice beyond the planets now does what a shared
link always did: it arrives. The camera lands in range of the object, framed
at the distance its own photometry says it is best seen from, and the
observatory card — which never spoke for anything past Saturn — now carries
the deep sky: live camera range, diameter in the units the catalogue speaks,
and the arrival fact, how long the object's light was in the air before it
reached the camera. Planets keep their real transits; the journey through the
system is the sim.

**The contracts board.** Jobs a pilot takes, riding exactly the machinery the
routes ride — objectives evaluated from the simulation, the checklist riding
the instruments, arming through the same gate. The realism is the point and
not a limit: nothing shoots at anybody, because the work of spaceflight *is*
the game. Six jobs at launch — First Light (orbit and a photograph of Earth
from it), Station Approach (close to within 100 km of the station; the phasing
is the work), Polar Sentinel (past 95°, from Vandenberg), The High Road (an
ellipse a tenth of the way to the Moon), Far-Side Solo (the Apollo 8 loop as a
job) — each priced against the same stack, each held by the same flown checks.
Four objective checks join the vocabulary: photograph (this flight's plates,
not a lifetime total), proximity (read off the integrator's own state vector,
so there is no shortcut around the phasing), inclination, and apoapsis.
`verify-programs` holds the contracts to everything it holds the routes to —
both budgets and tables iterate them now — and is six checks going on seven.

**The source is on the front door.** The colophon carries the repository —
integrator, flight computer, the sixty-seven gates, this page — where a
colophon says where the type came from.

### The pilot's own mission — 1 October 2026

Until now every flight in this simulator was somebody else's: nine missions in a
library, flown by a sequencer, watched from a broadcast camera. This adds the
fourth thing a visitor could want from a solar system and could not yet do here —
plan a flight of their own, fly it themselves, and land somewhere.

**The planner.** A full-page room reachable from the front door (*Plan your own
flight*), from the missions drawer, and from a link (`?program=`). Four decisions
in the order they bind — the route, the wing, the fuel load, the pad — and
everything else derived: the route's cost priced leg by leg, the vessel's budget
from its own stage table through the rocket equation, and the margin in ember the
moment the plan does not close. Choosing a wing is not choosing a difficulty
slider in disguise: the wings change *who holds the stick*, never what the physics
is. The routes are named for the contract they sign — **Orbit Run** (orbit the
Earth and come home), **Free Return** (behind the Moon without capture), **Lunar
Orbit** (the Apollo 8 loop), and **Descent** — and Descent is honest about itself:
priced at 15.34 km/s one-way it is the only route that closes on the full stack,
because a landing *and* a return costs 18.24 km/s, which is more Δv than the
vehicle carries and the reason Apollo needed a second spacecraft. The planner
shows the negative margin rather than selling a round trip the stack cannot fly.

**The wings.** A freedom ladder over a vocabulary the code already had. **Trainee**
flies the ascent and insertion and hands over in the parking orbit; **Aviator**
takes the stick at the pitch kick and holds it through MECO; **Aldrin** — after
the man who landed manually — takes nothing from the sequencer after the count,
every burn planned by hand and the powered-warp ceiling left to respect; and
**Kármán** is Aldrin at 84% of the propellant load, the margin the budget bar
shows being the fuel actually aboard. Three phases join the sequencer to carry
this — `PILOT_ASCENT`, `PILOT_FLIGHT`, `PILOT_DOWN` — and a gate inside
`setPhase` reads the wing before entering a phase the wing does not hold, routing
around it so the *sequence* still visits the same physics with the pilot at the
stick instead.

**The flight.** On the ground the pilot stands where the presets' cameras stood;
`G` walks, `G` again returns. In `PILOT_FLIGHT` the step ceiling is lifted —
a pilot's own pace is the pilot's own — while node preemption still fires, and a
program's objectives are evaluated from the simulation every frame, never from a
UI flag: liftoff from the pad's hold releasing, orbit from the osculating
perigee and apogee, landing from the selenocentric altitude and descent rate,
splashdown from the phase itself. A checklist rides the instruments column
(`ProgramStrip`) showing which leg of the pilot's own plan is running and how far
along it is. Landing holds the vehicle at its touchdown point against the surface
(`applyLandedHold`), so an Aldrin descent ends standing on the Moon with the
Earth overhead — the view the whole simulator was built for, now earned.

**The room tone.** The user-supplied ambient bed (`public/audio/monume-space-
ambient.mp3`) returns as ambience: a toggle in the panels, gesture-gated like the
removed score was, fetched and decoded on first enable only. It runs through a
lowpass whose cutoff is the atmosphere — 420 Hz at sea level opening to 14 kHz
by 140 km, open on the Moon — so a vacuum is finally *heard* as a vacuum rather
than rendered as silence, and the filter follows the flight with one
`setTargetAtTime` per clock tick. This is deliberately the only audio: no engine
sound, no staging, no chutes — the sim makes no sound, the broadcast is captioned,
and the room tone is the one layer that is the place and not an event in it. The
flight path stays provably silent: `verify-audio` asserts no flight-path module
imports an sfx module, that the ambience is a leaf reachable only from the HUD
clock and the toggle, and that the `AudioContext` is constructed inside the
gesture.

**The snapshot format learned to name its phases.** The three new phases shifted
every positional `mission.index` in the checked-in flight fixtures by three, and
both failures were the same bug wearing two coats: `verify-heating`'s fixture
restored into `LUNAR_APPROACH` instead of `LUNAR_ORBIT`, and `verify-allocation`'s
steady loop — which its own header says begins and ends in one phase — started
three early, crossed a boundary mid-measurement, and reported the transition cost
as a 1.92 B/frame leak. The state vectors were perfect; the labels were
positional. Snapshots now record `mission.phase` / `mission.resume` ids beside
the indices, restore resolves the id first with the raw index as the fallback for
older files, and the fixtures are regenerated at the same METs as before
(184.747 h orbit, 70.713/70.782 h approach) — byte-identical across repeat runs,
so the reproducibility claims in `scripts/fixtures/README.md` keep their standard.

**Gates.** Two join the suite, bringing it to 67: `verify-programs` (five checks:
the wings form a freedom ladder, every program closes its Δv budget with margin
at its freest wing's load, Descent stays honestly one-way, arming a program
actually drives the wing gate and the live fuel load, and every program names
real vessels, sites and checks) and `verify-audio` (four, above). The harness
runs the plain and Aldrin wings headlessly end to end; the Kármán load measures
1,805,580 kg on the pad, exactly 84% of the S-IC load.

**The handoff the planner promised.** The Trainee's copy says *from the parking
orbit, the spacecraft is yours* — and the code did not keep it: nothing routed
`CIRCULARISE`'s exit anywhere but `COAST`, so the sequencer rolled on flying
(window solutions, the injection itself) while the checklist's later legs asked
for burns the pilot was never handed the stick to make. The handoff now lives on
that door and reads the armed contract (`handsOffAfterInsertion()`), because the
obvious capability read cannot distinguish a Trainee whose computer has just
finished its last burn from a preset with nothing armed — the same answer meaning
opposite things, and a scripted mission must never land in the pilot's cockpit.
Both directions are held by a flown check in `verify-programs` (the sixth), which
caught the inverted first draft before a pilot could. A preset also stands any
armed program down — `startPreset` disarms — because the broadcast is nobody's
plan.

**The checks the harness had never run.** The landing objective read
`live.index`, which does not exist — a TypeError the first Descent pilot would
have met at the surface, invisible to a suite that never lands; it reads `INDEX`
now, the slot map the integrator itself is laid out by. And the `tli` and
`lunarOrbit` objectives latched on phase positions a hand-flying pilot never
walks through (the sequencer holds `PILOT_FLIGHT` from MECO to the Moon), so
their checklist could never tick; they read the conics now — apogee carried past
55% of the live Earth–Moon span is an injection, a bound selenocentric conic with
perigee above the surface is lunar orbit — the same rule the orbit check already
kept: a fact about the flight, not the phase table.

**The door and the bed.** A `?program=` link landing on the front door armed
nothing: *Enter* gave a plain flight and the plan died in the address bar. The
link is re-read on the way in now, and arms on the route's freest wing — which
also fixes a deep-linked Descent being silently armed Trainee, a wing the route
does not offer and the sequencer gate would not have honoured. The ambience's
first enable fetches 3 MB across an await, and a second click inside that window
could leave the bed playing under a toggle reading OFF; the await fence, the
flag rebalance and a closed context on every abandoned path fix that, and
`pagehide` disposes the graph — the caller its comment always claimed.

**The polish the first outside visitors earned.** The front door carried five
near-identical creams where the palette has one — `#f5efe6`, `#f0e7da`,
`#e8e0d5`, `#efe7db`, `#f2ebe0`, raw hexes scattered across ten files, each a
little wrong against `hud`, the champagne the rest of the interface is mixed
from. They are all `text-hud` now, and the oddball sizes that rode in beside
them (10.5, 11.5, 12.5, 13.5, 16.5 px) sit on the ladder the panels already
used. The Earth texture manifest named a file this install deliberately does
not ship, so every visitor's console printed a 404 before the fallback
answered — the specular map is declared as the slot's primary now, inverted on
load, and the loader probes only files that exist. The planner's Close button
was a 29 px tap target on a phone; it gets the house's 36 px minimum like every
other control.

*Known limitations.* The descent program's legs are priced from the Apollo 8
stage table; no dedicated lander vessel exists yet, so the one-way descent is the
only honest landing this stack can sell. The ambience filter models absorption
as a single pole and the bed as one loop; the crossfade at the 140 km boundary is
a square curve, not a measured lapse rate. The walk yields its keys to the pause
bar rather than sharing them.

### The dial the pilot keeps, and the sky that finishes in daylight — 1 October 2026

A pilot reported the Milky Way looking "like a google image, with a rectangle
border," and time warp "not working properly." Both were the page deciding it
knew better than the person holding it, in two different departments.

**The warp dial.** The camera director re-asserted each phase's pace on every
phase cut, so between two ascent cuts a pilot's 1 day/s was silently taken back
to real time, cut after cut — the ladder lit, the clock unmoved. The shot's
pace is now a *boundary condition*: laid down once when a watched sequence
begins (and only downward — the powered-warp cap already holds the physics at
real time when the throttle is open), then the dial is the pilot's for the rest
of the sequence. The powered cap's own restore was repaired beside it: it read
a React prop that could hold the pre-ignition level on the frame the cap fired,
so it would have undone a faster warp chosen *during* a burn, and it now reads
the store — the one authority about what the dial says — and stands down while
a watched sequence is holding the dial inside its boundary.

**The sky.** The sharp sky cube only marched while `daySky.milkyWay ≥ 0.02` —
suspended entirely in daylight — and the front door's cinematic camera orbits
the day side, so the first sky a visitor saw was the permanent 128-texel draft:
a soft, photograph-like band whose bilinear block edges and per-face grain
seams read as a pasted picture with a border on it. Daylight now *throttles*
the march (a tile every fourth frame, the whole cube done in ~4 minutes)
rather than stopping it, and skips the draft's six-face re-marches that were
being spent on an invisible sky; `verify-cosmos` (which times the whole
progression) holds the budget's ceiling unchanged. The volumes were never the
border — their emission already fades by radius and height before the box that
bounds the march is reached — so they are untouched.

**The tour.** Opening the tour, its first beat pointed the camera at the Sun,
and then the page's own effect — which runs after a child's on mount — reset
the camera to the cinematic shot, so the opening caption described a move the
camera never made; the tour now owns the camera while it is open. And Space or
Enter on the tour's own buttons bubbled to the window handler and advanced the
tour a second time, so one click moved two slides and every second caption
flashed past unread. The beat rail is now something a cursor can find.

**The name.** "Sol · Terra · Luna" is gone from the tab title, the masthead,
the instruments' rule and the loading line — the front door now says what the
product is ("The solar system, at true scale") where it said what a 1960s
brochure said. The mark the site wears was verified against the tab icon
(`make-favicon --check`): one drawing, four surfaces, byte-identical.



A pilot reported the animations "quite literally laggy" and asked whether the
answer was a downloadable app. It is not — a wrapper runs the same WebGL — so
the answer is the same discipline the resolution governor already applies,
extended to the two costs it could not reach. **The timeouts:** thirteen HUD
components (telemetry, flight strip, burn panel, fly HUD, commentary, the
broadcast's clocks, and six more) each owned a `setInterval` between 80 and
250 ms, a dozen alarm clocks going off beside the frame loop on schedules
nothing coordinated. One 110 ms pulse now serves them all (`ui/uiClock.js`),
each reader hearing exactly the steps it asks for, the timer existing only
while someone listens; the fastest readout keeps its cadence. **The shadow
map:** the ground beam's 4,096-texel depth pass was the one always-on per-frame
cost the distress ladder could not spend — pixels and tessellation had levers,
it ran at full size regardless. `gfx/groundBudget.js` adds the last rung,
spent only after both are spent, halving the map to 2,048 (a quarter of the
depth fill) and refunding out of comfort like every other lever; a pad shadow
stays hard-edged at the doubled texel, `GroundLight` remounts its light on a
change because three fixes the map at creation, and *Full resolution* releases
it. The ceiling is asserted unchanged: nothing was toned down, on a machine
with headroom none of this ever runs. Diagnostics' Detail row carries the
spend, so the bug-report copy is the whole diagnosis. New gate
`verify-ui-pace` (26 checks): the pulse's arithmetic and lifecycle under a
faked timer, no migrated component owning an interval, the lever order pixels →
tessellation → shadow and refunds in reverse, and the 4,096 ceiling untouched.
65/65 gates.

### Personal bests, the plate gallery, and one sampler — 30 September 2026

The logbook grew the two things engagement actually asks for. **Personal
bests** (`recordBest` in `sim/logbook.js`): the records the sim already
measures at the moment they are final — touchdown vertical speed (lower is
better), entry peak load (higher), the closest a trans-lunar crossing came to
the Moon — each with one call site at the phase boundary where its number is
finished, a running minimum held in the mission object and only the result
crossing into the record. A record's label, unit and clock carry forward when
a barer call re-writes it (the gate caught the clobber); equal or worse values
are refused, so no chatter. The progress strip announces a new record with its
number; the drawer holds the bests cards. **The plate gallery**: the last
eight photographs in their own IndexedDB database (`gfx/plateShelf.js`),
newest first, each downloadable or removable — a plate still downloads at the
shutter, a copy now stays too, and every path degrades to an empty shelf in
private mode. `verify-plate-shelf` runs the shelf against a minimal in-memory
IndexedDB (the fake's first draft fired tx.oncomplete before the request
succeeded — real IDB guarantees the reverse); `verify-frame-stats` pins the
new shared sampler: the resolution governor pushes every delta it already
computes into a 512-sample ring, Diagnostics reads p50/p95 from it and its
own second rAF loop is gone — two opinions of the same frames, and one more
callback the frame budget paid for, retired. 64/64 gates.

### The detail budget, and the first deploy of all of it — 30 September 2026

The resolution governor's last unsolved case — a machine still missing frames
at the pixel floor — has a lever now. `gfx/detailBudget.js` lets the governor
spend tessellation: one step of distress caps every body's LOD ladder at 256
segments, a second at 128, each sub-pixel silhouette error by the ladder's own
target, the Moon's near field exempt, the spend refunded only once pixels are
back at their ceiling and frames are comfortable. Diagnostics reports the
spend so a lag report is a diagnosis. `verify-detail-budget` (26 checks) holds
the policy and caught nothing after the gate's own first draft did — its
hysteresis and binding-edge assertions were sharpened to what the cap actually
guarantees. Separately: `verify-presets` now exits each child as soon as its
claims are proven, because the halo preset's background capture search outlives
a two-core runner's 30 s child timeout — the first CI run of that gate died on
it, and a slow machine must change how long the suite takes, not whether it
passes. All five development branches are merged to `main` and pushed; CI runs
the full suite and publishes every push to periapsiszero.dev.

### The logbook and a sharper mark — 29 September 2026

The sim gained a memory. `sim/logbook.js` records milestones from the mission
sequencer's own phase transition — 19 moments from liftoff to docking, each
once per browser — plus plates taken, films kept and pads flown from, in
`localStorage` with every write user-visible and nothing on the frame path. The
HUD's progress strip shows the count and the moment the current flight is about
to give you next (derived from `PHASE_IDS` order, so an Eagle flight is never
offered "liftoff"); earned moments announce themselves once; the logbook drawer
holds the full record; the front door greets returning visitors with one line
computed from what was actually done. `verify-logbook` (31 checks) pins the
semantics, the process-level persistence, the phase-order invariant across all
three flight tracks, the four call sites, and the 16 px icon's legibility —
that gate caught a reader that hid undated milestones and a "next" ordering
that mis-advertised past the Apollo 8 return, both fixed. The tab icon is
redrawn within the same mission-patch concept: planet up 0.13→0.155 S so the
world is five pixels at 16 rather than four, the periapsis marker seated on the
limb with the orbit vertex, stroke floors of 1.25 px on the near arc and chevron,
and the six stars suppressed below 128 px where their sub-pixel radii were
smudge — verified by decoding the PNGs, not by looking away. mark.svg keeps its
field; brand.js and the boot splash follow the same geometry.

### Integrated validation — 29 September 2026

The combined local `dev/integrated` version passes the production build and
60/60 gates. Integration also invalidates cached sky targets after context
restoration or buffer resize, skips unresolved ice creases before computing
noise, and handles encoder stop exceptions. Hidden-tab suspension is owned by
the Canvas prop so an App re-render cannot restart it. Actual preset tests
caught an underground Kennedy approach; the path now enforces host clearance.
Browser DOM confirmed the new docking curtain and direct mission hand-off;
visual FPS/driver stability are still unmeasured because Preview was hidden.

### Mission chapters — 29 September 2026

Six more cinematic starting points bring the archive to 15: Artemis launch,
Apollo 8 parking orbit and captured lunar survey, Apollo 11 coelliptic initiation
and final docking, and Apollo 8 main canopies. Each has an original five-beat
dossier. `verify-presets` flies every actual vessel/site in a fresh process;
all 15 reached their advertised phase in 0.1–0.9 s on this machine. The intro
geometry gate now exercises 75 checks. Fixed mismatched polar-window specs and
labelled the LC-39B reconstruction separately from Apollo 8's historical 39A.
Library film controls now work by touch/keyboard as well as hover.

### Celestial exploration — 29 September 2026

- Reusable Moon/planet sphere ladders spend geometry on visible curvature,
  retaining full lunar terrain-edge precision and refining nearby planets.
- Added three footprint-filtered lunar crater decades and fine synthetic
  fractured/frosted relief for Europa, Ganymede, Callisto and Pluto.
- Observatory cards report live physical scale/light-travel geometry and link
  to neighbouring moons; measured imagery and synthetic detail are identified.
- `verify-sphere-detail` asserts mesh selection, screen-space silhouette error,
  monotonic refinement and >250× geometry savings for an unresolved lunar disc.

### Performance audit — 29 September 2026

- Recording is opt-in, capped by area in portrait and landscape, sampled at
  24 fps after rendering, and releases every stream track on stop/error.
- Library films no longer autoplay together. Download and mission links are
  separate controls, rather than a button nested in an anchor.
- Screen/photograph buffers have pixel-area bounds. Long stalls trigger the
  resolution governor instead of being excluded from its emergency response.
- Photography no longer owns the R3F render loop when bloom is off.
- Hidden tabs stop rendering; procedural/material resources are disposed on
  unmount; diagnostics reuse the existing GL context and include p95 latency.
- Sky tiles/strips are smaller without reducing final detail. Atmosphere avoids
  duplicate front/back integration outside its shell.
- `verify-render-budget` exercises budgets and recorder lifecycle/error paths.
  Full suite: 58/58 gates. No new device FPS claim: the preview was hidden and
  did not deliver animation frames. OS crash cause remains unconfirmed.

### Fixed

**A launch site ran at eight frames a second on a Retina display, and nobody
was choosing the pixel ratio.** `device.js` has offered `dpr: [1, 2]` since the
device question went in and nothing ever picked within it, so every Retina Mac
and every Windows laptop at 200% scaling asked for four times the pixel area.
The ground scene is fragment-bound: measured on an Apple M4 at Kennedy's pad,
55 ms a frame at one device pixel per CSS pixel and 127 ms at two. A visitor
reported being unable to click the buttons, which is what two or three frames a
second looks like on a machine slower than this one. `components/Resolution.jsx`
now moves the ratio from the frame times themselves — down within three frames
when a machine is in real trouble, back up when it stops being — and the same
pad now reaches 60 fps within five seconds of loading. Nothing leaves the scene
to achieve it; *Full resolution* under Display pins the ratio for anyone who
would rather have the pixels. Two further faults fell out of fixing it: the
post-processing composer sizes its buffers on canvas *size* changes only, so
lowering the ratio had been shrinking the canvas while every buffer the scene is
drawn into stayed as large as it was; and the first thresholds tried sat inside
the gap that vsync quantisation leaves between 16.7 ms and 33.3 ms, parking a
machine at 30 fps that could hold 60 two steps lower down.

**The scrub round a pad was drawn whole, everywhere, always.** Each species was
one instanced mesh spanning five kilometres, and three frustum-culls such a mesh
as a single object — so of 36,540 plants at Kennedy, 8.6 million triangles a
frame, 25,247 were being transformed behind the camera's back and 10,266 of the
rest covered fewer than twelve pixels. Each species is now cut into tiles of
about 60,000 triangles, which the renderer culls for nothing, and a tile drops
to a coarser build of its plant once one of that build's own facets would cover
under four pixels. The coarse build re-tessellates and never removes: a crown
keeps every blob at the same place and size, scaled so its mean silhouette is
unchanged by Cauchy's theorem, and the full build is identical to the vertex.
Plants cost 34 ms a frame before, 9.8 ms tiled, 3.7 ms tiled and coarsened; the
whole frame at the pad went from 71 ms to 23. An earlier cut of this reduced
crown blobs by count instead, and the new `verify-flora` gate caught a live oak
losing a fifth of its height when it swapped — which is why it re-tessellates.

**The planet's globe was drawn underneath the launch site's ground, in full.**
Seventy kilometres of real relief stands round each pad, and from inside it the
globe is behind that relief in every direction — measured with the clock frozen
so the comparison was exact, hiding it changed 0.000% of the pixels in the
ground, tracking and chase views while costing 8 ms of a 33 ms frame. The depth
test could not save it: the logarithmic depth buffer writes `gl_FragDepth`,
which switches off early-Z, so every hidden fragment ran the whole surface
shader — night lights, surface detail and all — before being thrown away.
`gfx/siteGround.js` now skips it on the one condition that makes it safe, that
the horizon from where the camera stands still falls inside the patch, which at
Kennedy holds to about ninety metres up. The frame at the pad went from 33 ms to
27.4. `verify-site-ground` sweeps every height and offset a camera can take and
checks the property itself, because the failure to avoid is a hole in the world
rather than a slow frame.

**A visitor waited for the Moon before they could leave the pad.** The imagery is
13.42 MB and all of it blocked the first frame; the Moon's colour and normal maps
are 9.47 MB of that, downloaded before anything could be flown by people who
never leave Earth. They are deferred now — fetched behind the first frame, with
the Moon drawn from its procedural maps until they land and rebound when they
do, which the layered imagery design already supported. **3.96 MB now stands
between opening the page and flying.** On a connection throttled to 1.5 Mbps the
Earth set finished at 26 seconds with the Moon's still arriving; before, that
was the point where the wait started. New gate `verify-assets` holds the blocking
set under 6 MB, checks the largest single file is never one a visitor waits for,
and checks every deferred slot has a generated stand-in. Fixing it turned up a
StrictMode trap worth recording: the loading effect runs twice, the second run
receives the first run's in-flight promise instead of registering its own
callback, so the only late-arrival callback belonged to the cancelled run — and
guarding it with `cancelled`, which is the reflex, discarded the one
notification there was and left the Moon procedural for the session.

**The Display panel says what the machine is, and will copy it out.** A
performance report arrives as "it was laggy", which is a symptom with a dozen
causes that want different fixes. It now reads back the graphics hardware, the
screen and its density, the ratio the renderer settled on and the frame rate
being achieved — and says plainly when a browser is drawing without a graphics
card at all, which no setting in here can rescue. *Copy for a bug report* puts
all of it on the clipboard. Nothing is sent anywhere: the person who saw the
problem can read the four lines before deciding where they go.

**The first night sky cost eleven seconds of 15 fps.** The sky cube's
full-resolution march ran a 256-texel tile at 240 steps a frame — 50 ms each,
216 of them — and did so in daylight on the ground, where the band is not
visible at all. It now marches `skyTile` texels a frame by device (64–128),
at 112–176 steps, and not at all while the sky hides it: the ground view went
from ~75 ms a frame to ~22 in the measurement.

**The telemetry strip was cut off on a phone.** Four figures in a row are ~390 px
and a phone's column is 358; the strip takes no touches, so the last figure
could not be scrolled to. It is two by two on a phone.

**All sound is gone.** Once it was working it was described as terrifying,
horrifying and extremely scary, and it went: the engine and pad voices, the
staging, ignition, parachute and splashdown one-shots, the intro's generative
score, and the broadcast's Quindar tones, static, squelch and spoken lines.
`src/sfx/`, `components/Audio.jsx`, the *Engine audio* toggle and `verify-audio`
are deleted; the broadcast captions the loop instead. (It had been silent
anyway until this release, for a different reason: `build()` returned a node it
no longer declared and the error was swallowed. Fixing that is what made it
audible.)

**The pad presets were handed over at T-13, not T-60.** A held phase runs its
count on the wall clock, and it kept doing so under a pause — which nothing
noticed until the mission intro paused the page for 42 seconds. Measured in the
page: hand-off at T-13.0 before, T-58.4 after. On the Moon it was worse than a
missed minute: Columbia is placed for a liftoff one count of *simulated* time
after the count begins, so a count that ran through the intro lifted Eagle off
42 s early for a rendezvous timed for the planned moment. The driver passes a
zero wall delta while paused, and the lunar count now runs in simulated seconds,
so no warp can separate it from Columbia's placement either;
`verify-lunar-ascent` still passes every check.

**The title curtain could not be read.** Its letterbox left the middle quarter
of the screen open onto whatever the camera faced before the flight — at a pad
at noon, the sky's glare — straight behind the title, blurb and dossier. The
curtain is black now and lifts off the bars as the flight begins.

**The tour printed over the front door.** It opened on top of the page's own
title, button, flight rows and claims, drew the pilot's instruments (apsis tags,
trails, planet labels) into its shots, left the page parked on the Sun with
PHOBOS/DEIMOS across the title when skipped, and — left through the library —
never recorded being seen, so it reopened every visit. The front door steps aside
while the tour runs, the tour's shots are bare, closing it restores the opening
shot, and every way out marks it seen. Its vehicle stop was a grey slab (the
orbit lock on a pad frames the deck's underside); it stands at eye height now.

**"Open the mission library" in the flight HUD opened it inside a 190 px
panel.** The drawer is `fixed inset-0`, and the Missions panel's glass is a
`backdrop-filter`, which makes it the containing block for fixed descendants.
The library is portalled to the body.

**Name tags printed across the panels.** drei ranks tags with z-indexes up to 20
in the page's shared stacking context, above the HUD's z-10: HALLEY'S COMET over
the telemetry, URANUS through a row of figures, COLUMBIA inside the commentary.
The canvas is its own stacking context now. And a moon's tag waits until the moon
is 1.4° off its planet as seen from the camera, so PHOBOS and DEIMOS stop printing
as one smear.

**"Start countdown" was below the fold.** "Begin flight" lands on a vehicle held
on its pad and the only go was the fourth panel down the right rail, 996 px from
the top at a 713 px window. It is at the foot of the frame now, above the
commentary, for as long as the count has not started.

A commentary line printed its Markdown emphasis as literal asterisks; it no
longer does.

**The sky pulled on every solver.** `ownRails` — the private rails table each
shooting solver runs against — read `count: RAIL_COUNT`, so the day the table
outgrew the seven planets the moons and comets began contributing *gravity*
inside every capture, halo and keeping solve. Measured: an NRHO reference that
should hold within 5 m drifted 7.94 m at one apolune; with the split restored
it holds 0.08–0.75 m. The force/sky boundary is now drawn in one place
(`FORCE_COUNT` in `rails.js`, read by `system.js` and `ownRails` alike), and
`verify-cosmos` asserts the sky pulls on nothing.

**The halo capture never ran.** `shootHalo` records the field it solved against on
the returned reference, and a rails table carries its `refresh` as a closure —
which structured clone does not degrade but *throws* on. The capture is solved in
a worker, so the `postMessage` was rejected outright and no solution ever came
back: `mission.capture.error` read `(t) => updateRails(t, helio) could not be
cloned`, `planned` stayed false, and the only symptom was a capture that never
happened. No gate saw it because every gate runs the search in its own process.
`railsRecipe` (`src/sim/rails.js`) reduces a table to the two fields `ownRails`
reads, so the content crosses and the closure is rebuilt where the clock is.
Verified in the page: solved in 14.5 s, 174.4 / 269.5 / 105.8 m/s, and the craft
reached `HALO_CAPTURE` and flew its first burn at real time.

**Presets landed on the wrong camera.** A preset naming no `focus` kept the
store's default, `earth`, because the driver applies the director's shot only on
change and seeds its memory of the request on the first frame *without applying
it*. `apollo8-lunar-orbit` was handed over in `LOI_ALIGN` at 398,081 km locked on
Earth — and since `LOI_BURN` carries the same shot, the request never changed and
the capture was never shown at all; `artemis-halo` was handed over at
`LUNAR_APPROACH` with the Moon 313,936 km away, also on Earth. `startPreset` now
resolves the shot from the director for the phase the flight arrived in. All six
presets land where the table says.

**And the lunar-orbit preset landed at the wrong pace.** Unset, it inherited the
fast-forward's standing six hours a second, so the capture burn its blurb
promises was over in a couple of frames. It now names real time.

**The ascent ran at 60×.** On a flight started from the pad the ascent *is* the
thing, and eight minutes became eight seconds of 60×: every camera move in it a
smear. A `groundSequence` launch holds real time through the gravity turn.

**The ground launch camera could not follow the vehicle.** A fixed eye-height
viewpoint with a 65° frame loses a rocket above about 240 m of stand-off, and by
2 km it is not a visible object at all. It now pushes in as the vehicle clears
the ground — the camera stays put, the lens moves, as a broadcast does — holding
the stack at 30% of frame (fov 65° → 12° measured) before handing to the chase at
2 km, where it locks at 16%.

**Shot changes were flights of the camera.** Entering the chase blends over
1.5 s, right when the shots are near — a ground camera is under one hull length
of 110.6 m. From Earth's lock at 5.2 radii it meant flying 33,791 km in 1.5 s, and
that is the shot both `COAST_TO_APOAPSIS` and `CIRCULARISE` are cut to. The gap
decides now: eight chase lengths or less is a move, beyond that a cut.

### Added

**Photographs.** `P`, or *photograph* beside the panel toggle. The interface
steps out of the picture, the frame is re-rendered with its long edge at 3,840
pixels, and the file carries a caption naming the flight, the mission time, the
date, and the height above whichever body it is over — read from the state the
instrument strip reads, so the plate cannot drift from the panel. A browser
screenshot gets you the window, at the window's resolution, with the
instruments printed over the picture; this gets you the picture. It costs
nothing per frame: one render, once, when it is asked for, with the resolution
governor standing down so it does not mistake a deliberate expense for a
machine in trouble. New gate `verify-plate` holds the caption, which is the
part of this simulator most likely to be read by someone who never opens it.

**Links to places.** `L` copies an address that opens this flight looking at
the same thing — `?focus=sagittarius-a` for the black hole at the centre of the
Galaxy, and the same for all 148 places the camera can be sent. The search
could always reach them; there was no way to tell anyone about one except by
describing the route. It does not carry the mission clock, because the state of
a flight is the output of an integration from the start and a link that
silently landed somewhere else would teach people not to trust the next one.
A link arrives rather than travels: choosing a place in the search flies you
there, which across the Galaxy is most of a minute and is the point when you
chose it, but a link is a promise about where you will be. New gate
`verify-share` writes an address for every place and reads it back,
and checks that a name this build does not know is refused rather than obeyed.

**The sky beyond the planets.** Search for a star, a nebula, a galaxy or the edge
of the observable universe and the camera flies there in one continuous zoom
(README, *Beyond the planets*). Sixty-seven named stars at their parallax
distances, each as bright as the inverse-square law makes it from wherever the
camera is, drawn as a granulating, limb-darkened sphere once close enough to
have a disc; the Milky Way as a volume model — disc, bar-bulge, four arms whose
tangents land within 6° of the observed ones, dust giving 32 magnitudes toward
Sgr A* against ~30 observed, the Local Bubble and fourteen local dark clouds —
seen from inside as the sky (which replaces the painted panorama and its 4096 ×
2048 generation at load) and from outside as a barred spiral; twenty-three
galaxies scaled to their absolute magnitudes; eleven nebulae whose colours are
their emission lines through the CIE observer; three globular clusters and two
open ones; Sagittarius A* ray-traced through the Schwarzschild metric; the
galaxy clusters out to Shapley, a statistical cosmic web, the microwave
background with its measured dipole; the heliosphere and the Oort cloud. Two
new gates: `verify-deep-sky` (33 checks — frames, every named star against
Hipparcos, search) and `verify-galaxy` (19 — arm tangents, extinction, the
closed-form luminosities, the black hole's photon orbits).

**Search, instead of the camera-lock list.** One box finds planets, moons, craft,
camera views, sites, missions and the deep sky, forgiving typos and matching
word by word; `/` or ⌘K opens it, and so does *search* in the broadcast. On a
phone its results take their own place in the left column — floated, they were
clipped by the column and a tap on a result landed on the canvas.

**The search answers when it does not have the thing.** Three hundred and
thirty-eight names it recognises and has not built are written down with a line
each (`sim/comingSoon.js`), so *Ceres*, *Voyager 1*, *Enceladus*, *Kepler-452b*
and *Cassiopeia* are told what they are and that they are not in yet, rather
than being answered with the nearest entry that shares some letters — and
nonsense is told it is nonsense. They are consulted only where the catalogue has
nothing solid, so none of them can shadow a real destination as the catalogue
grows. Two matching rules were tightened to make that safe: a clipped-name match
must now start where a word does and stay tight (*ceres* had been finding
Her**c**ul**es** Clust**er**, *triton* the **I**nte**r**na**t**i**o**nal Space
Statio**n**), and a substring that begins mid-word scores below one that begins a
word (*taurus* had been Cen**taurus** A). A member of a named cluster no longer
outranks the cluster, so *seven sisters* is the Pleiades rather than Alcyone.
New gate: `verify-search` (20 checks — every catalogue name and alias still
answers as a place, every planet survives any one deleted letter, and under 2%
of random letter strings match anything).

**The device question.** The first visit asks whether it is on a phone, a tablet
or a computer and sets pixel ratio, antialiasing, detail, vegetation, shadow
maps and the deep sky's march budgets to suit; *Display* changes it later.

**Every planet, drawn as itself.** Mercury to Neptune, Pluto, Halley and the
named moons with procedural surfaces that keep adding detail as the camera
closes (no more magnified texels), their real poles and rotation (IAU elements),
oblateness, ring systems that shadow and are shadowed, atmospheres, and moons in
their planet's equatorial plane.

**Camera moves are flights.** Every change of view is a zoom out, a pan and a zoom
in (van Wijk & Nuij), re-planned every frame against moving endpoints; director
cuts during a mission are capped at about three seconds.

**The mission intro is one shot.** A log-scale flight from 25 AU that ends on the
mission's own first frame — `verify-intro` now asserts the last frame equals
the rig's resting pose to a millimetre, that the flight only ever closes on its
destination, and that the lens never leaves it (45 checks).

**Launch sites, built out.** Sky light and haze on the ground, textured terrain
with water, the VAB, the LCC, the crawlerway, pad 39A, propellant spheres,
fence, camera stands and the press site; vegetation by species (palms, pines,
oaks, saw palmetto, grass) placed where the terrain draws scrub; the pad's
hardstand now weathers — slab joints, stains, soot at the trench, grassed
embankments — and the lawn inside the perimeter is mown in stripes.

**The broadcast.** The flight as it was watched rather than flown
(`src/ui/Broadcast.jsx`, `src/sim/broadcast.js`, `src/sim/radio.js`,
`src/gfx/filmLook.js`). The presets hand over to it after
their film; `B` switches between it and the instruments, and so does a *feed*
button beside the map's. It carries:

- **The camera, captioned honestly.** A pad's remote and tracking cameras and the
  lunar surface television were cameras; a view of Apollo 8 from outside Apollo 8
  was not, and is captioned SIMULATION, as the networks captioned their models
  (Artemis's say ANIMATION, and Orion's hull view is its solar array wing
  camera, which it carries).
- **What it was recorded on.** One post-processing effect with five sets of
  numbers — 16 mm film (grain at 24 fps, gate weave, halation, dust, a warm
  fade), the Apollo surface camera's television (interlace, a rolling hum bar,
  chroma smear, bloom), 1968 network video for simulations, and present-day HD
  and clean renders. A cut changes the numbers, never the program.
- **Apollo's clock.** GET in hhh:mm:ss from liftoff, or the count before it; on
  the Moon the GET Eagle actually lifted off at, 124:22:00.79 (Mission Report),
  plus the simulated seconds since, with the count to liftoff underneath.
- **Lower thirds** on every event worth one, with the flight's own figures —
  the orbit Eagle reached here, not the Mission Report's — and "Behind the Moon"
  only when the geometry puts it there.
- **The loop**, captioned: Houston, the spacecraft, the other spacecraft and
  Launch Control. Where a line is Apollo's own the script says when it was
  said. The count is read on its second. Nothing crosses the far side: a
  spacecraft behind the Moon — decided by the segment to the Earth against the
  Moon's sphere — has its air-to-ground lines held until acquisition of signal,
  while the two spacecraft's own VHF exchanges are captioned *onboard
  recorder*. A reply from the Moon waits a round trip of light, 2.6 s.

**The film of the flight** (`src/gfx/filmRecorder.js`, `MissionIntro`,
`MissionLibrary`) — the intro is a pure function of its clock, so it is
recorded as it plays and kept. The WebGL scene and the film's own titles (the
opening card, the dossier's pages, the letterbox, the hairline) are composited
into one hidden canvas. Originally this ran automatically on its own rAF;
that did not make capture free or guarantee background recording. The audit
above replaces it with explicit, budgeted capture after the renderer. At
arrival the take comes off the recorder onto IndexedDB's shelf, where the
mission library's card plays it back and hands it over as a file — measured:
the 42-second Apollo 8 flight keeps as a 473 KB VP9 WebM at 880 × 1650. Skip
discards the take; a browser that records nothing flies exactly as before.

**The mission intro** (`src/gfx/introFlights.js`, `src/ui/MissionIntro.jsx`,
`src/sfx/music.js`) — every mission now opens like the reference film: a black
curtain holding the mission's name and its own numbers, one continuous
42-second camera flight from half an AU out down to the hull, the dossier's
pages turning on the flight's beats, and the score swelling at the reveals.
Nothing is recorded — the camera flies the live scene, so the flight is sharp
at any resolution, and it lands exactly where the mission hands over, on the
frame the fast-forward left. The path is four quadratic Béziers (a Catmull-Rom
through anchors four decades apart borrows its tangent from the AU-long leg
and is flung through the planet it approaches; a Bézier cannot leave the hull
of its own three points), the anchors are taken from the live ephemeris in
**absolute** coordinates with the sim paused through the flight, and the frame
path allocates nothing. The settle is built around the vehicle's *host* world
— at a near-side lunar site the Earth's radial points into the Moon, which
buried Eagle's intro 600 m underground until `verify-intro` caught it. Each of
the nine dossiers carries five title beats and a spec table of the flight's
own numbers — the vehicle, the window, the measured waits and burns.

**Cosmic music** (`src/sfx/music.js`) — a generative score on the engine's own
AudioContext, no sound files: per-mission profiles (ascent, lunar, rendezvous,
arrival, deep, vigil, departure, return, fire — each a root and a mode), two
detuned saws under a low filter, four triangle voices gliding sevenths with
`setTargetAtTime`, a sub swell felt before it is heard, and shimmer plucks
echoing through a ping-pong delay into a synthesised reverb. Cues (`reveal`,
`tension`, `swell`, `hold`) only move targets; `musicTick` eases them in the
frame path and mutates AudioParams only. The gesture that begins the flight is
the gesture that unlocks the sound, and the score carries on under the mission
after the film ends.

**A premium mark** (`scripts/make-favicon.mjs`, `src/gfx/brand.js`,
`src/ui/Mark.jsx`) — the line-and-dot drawing is replaced by a mission-patch
composition: a per-pixel Lambert-shaded planet with surface mottles, a night
side that falls into the ground, and a sunward atmosphere limb; an honest
ellipse with the planet at its focus, its lower vertex grazing the planet's
limb by construction (cy + 0.12 S against r = 0.13 S) — closest approach,
with the ember marker on the contact point and the chart's chevron naming it;
six stars and a halo behind the body. The SVG is layered to match (radial
gradients for the planet and the marker's glow), `brand.js` carries the full
shape, and `verify-icons` validates the new schema. Probes at 512 and 16 px
both read: the periapsis point measures exact ember, the limb lit and dark.

**A wider cosmos** (`src/sim/rails.js`, `src/components/Planets.jsx`) —
Pluto (the Standish table the planets already come from), Halley's Comet
(anchored to its observed 1986 perihelion), and seven moons — Phobos, Deimos,
the four Galileans and Titan — ride their planets as circular offsets with
JPL mean elements. All of it is *sky*: drawn, labelled, steerable as a camera
target, and pulling on nothing (`FORCE_COUNT` — see Fixed). Halley carries a
three-layer additive tail that points anti-sunward and breathes with solar
distance. The belt stays out: its J2000 mean anomalies are not in the sources
reachable here, and a beacon in the wrong place is worse than none.

**The world around the pad** (`src/gfx/siteSurround.js`,
`src/components/SiteSurround.jsx`, `Terrain.jsx`) — each Earth complex gains
its real surroundings: Kennedy the VAB 4.9 km down the crawlerway, the LCC,
water towers, fuel farm, press-site grandstands, causeway and parking lots;
Baikonur the MIK, the rail spur and the town; Kourou the Jupiter centre and
jungle canopy; Vandenberg the hangar and chaparral — plus hundreds of
spectators, cars and trees as three instanced families (three draw calls). All
of it stands on the same 130 m-sampled relief the terrain draws, via a
nearest-vertex sampler over the mesh, with every structure sunk to a skirt
below the height at its own centre — contact by construction. The build keeps
a per-structure base ledger; `verify-surround` asserts each base crosses its
own ground and falsifies by naming the building that floats when a skirt is
flipped.

**A mission library, and three new flights** (`src/ui/MissionLibrary.jsx`,
`src/sim/presets.js`) — the missions move into a premium catalogue drawer with
craft, pad, hand-over moment and pace on each card, filterable by kind (*From
the pad*, *To the Moon*, *In orbit*, *Coming home*), arrow-key walkable, from
the front door and the HUD alike. The three new presets were probed headlessly
to their advertised phases: `apollo8-tli` (`TLI_BURN`, 134 ms), `apollo8-tei`
(`TEI_BURN`, 529 ms), `apollo8-reentry` (`SM_SEP`, 632 ms) — each handed over
at ignition or minutes before, at real time.

**A cosmic guide on open** (`src/ui/Guide.jsx`) — a once-per-browser, skippable
tour that steers the *live* camera through five beats (Sun, Earth, Moon,
vehicle, hand-over), with the final beat opening the library or the pad
mission. Not a slideshow: each beat is one `setUi({ focus })` on the same rig
the simulator flies with.

**A mark for the sim, derived like everything else here** (`scripts/make-favicon.mjs`,
`public/icons/`, `src/gfx/brand.js`, `src/ui/Mark.jsx`) — a periapsis tick on an
orbital arc: the champagne arc bending at the bottom of an obsidian field, the
orbiting body sitting at the bend, an ember chevron beneath pointing up at it.
Drawn by code, not by hand: one geometry (`geom()`) feeds the raster, an exact
quadratic Bézier SVG, and a generated module for React; colours are converted
from the CSS's own oklch values so the mark cannot drift from the palette; a
hand-rolled PNG encoder (stored-block deflate, CRC32/adler32) and a multi-image
`.ico` carrying 16/32/48. Rasterised once at 512 and box-downsampled to every
size, plus `npm run icons -- --check` proving the committed set matches the
source byte-for-byte. `index.html` grows a boot splash carrying the mark —
dismissed on the driver's first rendered frame in flight, on a 2.5 s fuse on the
landing page where no driver mounts, 12 s as the safety net either way — and the
mark echoes in the HUD lockup, a bottom-right watermark that hides with the map,
and the landing masthead. The favicon set plus `theme-color` replaces the
browser's default globe in the tab bar.

**An aerodynamic rush and the pad's own noise** (`src/sfx/engine.js`) — the rush
is driven by dynamic pressure rather than thrust, so it is loudest at max Q and
again through entry and silent in a vacuum however fast anything moves through
it; the vents and deluge are read off the same `countdown.js` timeline that draws
them. Three one-shots: ignition held on the pad, the drogues, splashdown. The air
voices live in a second function, `mixAir`, because V8 inlines a seven-argument
call and does not inline a nine-argument one — measured at 47.50 bytes a call
before the split, 0.00 after.

**`structuredClone` on the solved capture** (`verify-nrho-capture`) — the check
that would have caught the worker bug: the same algorithm `postMessage` uses, and
it throws on a function rather than dropping one. Falsified both ways.

**Earth's interior, from PREM** (`src/sim/prem.js`) — the Preliminary Reference
Earth Model (Dziewonski & Anderson, 1981), oceanless, as eleven shells carrying
their published polynomial density fits: crust, upper mantle, transition zone,
lower mantle, D″ layer, outer core, inner core. Integrating the profile encloses
5.9756e24 kg, within 0.06% of the mass the guidance flies, and a moment of
inertia C/MR² = 0.3309 against the 0.3307 quoted for the real planet. The gravity
it produces peaks *inside* the body — 10.689 m/s² at the 3,480 km core–mantle
boundary, then falls away — and Darwin–Radau turns the same C/MR² into a
hydrostatic flattening of 1/298.7 and a hydrostatic J₂ that is 0.9956 of the
observed one, the remaining 0.44% being the ice age.

**J₂–J₄ zonal harmonics on the craft's field** (`src/sim/prem.js`,
`src/sim/rk4.js`) — J₂ = 1.08262668e-3, J₃ = −2.53241052e-6,
J₄ = −1.61962159e-6, referenced to the 6,378,137 m equatorial radius about the
same spin axis the atmosphere turns on. The field is installed on the simulation
rather than built into the solver, exactly as the planetary rails are, so the
planetary solution stays bit-identical to the three-point-mass one and only the
craft feels the oblateness. Low orbits no longer close: an ISS-height orbit
precesses at −5.02°/day against the real station's −5.0, and a parking orbit's
apsidal line walks +3.7°/day.

**Mean eccentricity from the J₂ short-period series** (`meanEccentricity`,
`src/sim/prem.js`) — the companion of `meanSemiMajor`: the osculating
eccentricity vector with its first-order short-period term taken off, in the node
frame, where `u` is the argument of latitude. Verified against a numerically
averaged vector rather than a closed form: 1.409e-3 against 1.528e-3 on a pad's
committed orbit, and the vector's spread cut by 8× there and up to 205× across
inclinations. Averaged over a revolution it reads 1.532e-3 against the
radius's own first harmonic of 1.530e-3, which is the eccentricity a drag
integral wants; it is what the planner uses, and see *Changed* for why it was not
for a while.

**Per-pad surface gravity** (`src/sim/launchsite.js`, `src/ui/LaunchSite.jsx`) —
g(r, φ) from the same profile, per pad: 9.799 m/s² at Kennedy, 9.795 at
Baikonur, 9.802 at Kourou, giving a liftoff thrust-to-weight of 1.167 rather
than the single value 9.80665 produces. The deflection of the vertical is
reported with it — 0.078° of plumb line off the geocentric radius at Kennedy,
with a J₃ residual two thousandths of a degree wide at the equator, where J₂ and
J₄ contribute nothing radial at all.

**The `Terra interior` panel** (`src/ui/Geophysics.jsx`) — density and gravity
against radius on separate scales, shell boundaries ticked along the axis, the
craft's own radius as a cursor, with the pad's gravity and T/W beneath. In flight
it adds the two rates the field puts on the live orbit — nodal regression and
apsidal drift — and refuses to draw either for a craft that is not on an orbit:
held to its pad the stack reads as a bound orbit with its periapsis inside the
planet, which returned three and a half million degrees a day until it was
gated. Toggled from the RENDER column, on by default.

**Launch station substructures** (`src/gfx/padGeometry.js`, `src/gfx/pads.js`,
`src/components/LaunchPad.jsx`) — built rather than loaded. Kennedy's umbilical
tower on its mobile launcher over the 39 flame trench, Baikonur's tulip round the
vehicle over the pit, Kourou's enclosed gantry rolled back past its lightning
masts, Vandenberg's service tower and changeout room; every member merged to one
mesh per material, four draw calls a complex, every standoff measured from the
vehicle actually loaded. The ground is graded to the datum for 400 m round each
pad so the foundations neither float nor sink into the slope the nearest SRTM
sample carried, and the drawn hull is lifted by half a stack plus the deck height
while on the pad — a visual correction only, faded out over the first few hundred
metres of climb, with the clamp, the cameras and every gate reading the state
they always did.

**SRTM ground at each pad** (`public/terrain`, `scripts/fetch-terrain.mjs`,
`src/components/Terrain.jsx`) — real heights about 70 km across each of the four
launch sites at roughly 130 m a sample, fetched once by `npm run terrain:fetch`
and committed as 1.3 MB. They come from the Terrarium tiles on AWS Open Data,
which are SRTM repackaged as PNG and need no key and no account, so the
repository stays self-contained. The patch is built on the sphere rather than on
a plane, because at 70 km the far edge drops 96 m below the pad's tangent plane.
Imagery is not fetched and cannot be: ground-resolution satellite pictures of a
launch complex are commercial, and the keyless sets top out near 250 m a pixel,
which is an entire pad inside one pixel.

**Synthesised engine acoustics** (`src/sfx/engine.js`, `src/components/Audio.jsx`)
— no sound files. Brown noise through a lowpass whose corner follows mass flow, a
detuned sub pair for the throb, bandpassed crackle for a large exhaust, and a
rendered clunk at every separation, all scaled by the density of the air at the
vehicle so the ascent goes quiet as the sky goes black. Five numbers are written
into the graph each frame — parameter mutations and scheduled ramps, no new
objects — and `verify:audio` measures both the mix and the parameter writes at
zero bytes a call. The context is created on the first click, as browsers
require.

**The Moon turns** (`src/sim/moonFrame.js`, `scripts/measure-moon.mjs`,
`src/sim/moonMean.js`) — a body-fixed frame, by Cassini's three laws: uniform
rotation locked to the orbit, the equator tilted 1.535° to the ecliptic, and its
pole leaning away from the orbit's across the ecliptic's. Libration comes out of
it: flown against a year of the integrated orbit, Earth wanders up to 7.09° east
and west in the lunar sky and 6.74° north and south, centred to within 0.33° each
month. It is what a site on the lunar surface will stand in, and the drawn Moon
is turned by it.

**The last minute, from the ground** (`src/sim/countdown.js`,
`src/gfx/groundView.js`, `src/gfx/padParticles.js`, `src/components/PadEffects.jsx`)
— the *Apollo 8 · from the pad* preset now counts from T−60 on LC-39B with the
camera standing on the ground. Liquid-oxygen vapour pours down the hull through
the hold and stops at T−8, the swing arms retract through 90° from T−10, the
deluge opens at T−6, the engines light at T−3 and come up to thrust over 2.4 s
against the clamp, and release is at zero. The clamp holds under thrust to
1.21e-5 m, below what a heliocentric coordinate resolves, while the burn costs
21.6 t against 21.3 t predicted; the vehicle leaves at full throttle and still
parks in a 171.8 × 184.9 km orbit. Only this preset counts from sixty; every
flight a gate flies keeps its ten-second count. The eye-level camera (`0`) stands
1.75 m up, 380 m out, behind a 65° lens with its head level — across the flame
trench, on the side the vehicle flies away from, on the Sun's side where that is
still open, which at Kennedy is due west — and tilts up after the vehicle on a
critically damped spring at release. Vapour, spray and steam are 3,240 GPU
particles moved by a closed form in the vertex shader, four uniform writes an
effect a frame and no draw call when idle, lit by the Sun's illuminance at the
pad so a puff is as bright as the hull beside it.

**The sky from the ground** (`src/gfx/atmosphereShader.js`, `src/gfx/skyGlow.js`)
— blue at mid-morning, where it was dusk. The atmosphere's 3.5× thickness
exaggeration eases to the true profile below 100 km, and the samples bunch toward
the eye so fourteen of them resolve an 8 km scale height: within 6.6% of a
3000 × 600 march above 15° of elevation, against 61% evenly spaced. From 100 km
out every uniform is bit-for-bit what it was. And the sky now hides what an eye
adapted to it could not find: the zenith's luminance, from the same integral and
the same sample positions, through the sky-quality relation to a naked-eye
limiting magnitude — −8.7 under a 38° Sun, so no star, planet beacon or Milky
Way; 6.5 at night; the whole catalogue from orbit.

### Changed

- **A second flight fixture, and the four instruments it unblocked**
  (`scripts/fixtures/lunar-approach.json`, `scripts/flight.mjs`, `package.json`) —
  the vehicle on the translunar coast at MET 70.713 h, 130,381 km outside the
  Moon's sphere of influence, which is the one regime no captured state can stand
  in for. `verify-approach`, `verify-loi`, `verify-loi-sweep` and `verify-staging`
  each used to require such a state as an argument, so none could run without
  someone capturing a snapshot by hand and `verify-loi-sweep` needed two at once;
  all four now default to it and run unaided. They remain **out of `verify-all`**,
  and that is the finding rather than an omission: none of them asserts anything —
  no `checks` array, no verdict line, no exit code but zero — so registering them
  would have added four green lines that can never turn red. Three processes wrote
  the file byte-identically (sha256 `85dd0a8c…`, 2,325 bytes).

- **Fixed two errors that made `verify-loi`'s headline comparison read as a
  36,255 km failure** (`scripts/verify-loi.mjs`) — its "flown orbit" section
  claimed to fly the achieved orbit for three revolutions and compare that against
  the elements at cutoff. It ran for up to six periods regardless of the sequencer,
  whose next phase is `TEI_ALIGN`: measured with a probe, the craft left
  `LUNAR_ORBIT` 1.86 h in, burned for home, and the loop kept sampling the
departure, so it reported an apoapsis of 36,365 km against the claimed 109.45 km —
  all of it the return leg, in the one section meant to check the capture. It also
  asked for three revolutions when `LUNAR_ORBIT` holds exactly one by design
  (`PROFILE.lunarDwell`, 7,050 s against this orbit's 7,037 s), so three were never
  available. Stopped at the phase boundary, the apsides agree with the elements to
  **13 m** — periapsis 80.34 against 80.33 km, apoapsis 109.45 against 109.43 — the
  period is reported as unmeasured rather than as a zero, and the capture stands.

- **The Moon shows Earth its near side** (`src/components/Moon.jsx`,
  `src/gfx/moon.js`) — it showed longitude 90°E, the limb: pointed at Earth, with
  the imagery's 0° on three's +x and the mesh turned half a turn. The generated
  maps put their maria on the same wrong face. Both are turned by the Moon's frame
  now, with 0° longitude on its prime meridian.

- **The swing arms reach the vehicle** (`src/gfx/pads.js`, `src/gfx/padGeometry.js`,
  `scripts/measure-hulls.mjs`, `src/gfx/hullProfiles.js`) — every arm ended at
  the vehicle's widest point, 5.15 m from the axis on a Saturn V: 2.5 m short of
  the command module, and 0.46 m inside the model actually drawn at the S-IC,
  which runs 5 to 10% wider than the published diameters. Each carrier stops
  0.25 m short of the hull as drawn at its own height now — the sections, and the
  model where the stack is one, measured from the file by clipping every
  triangle to a hundred bands along its length and committed as data, because
  the model catalogue is not.

- **The Saturn V stands up** (`src/gfx/models.js`, `src/components/Craft.jsx`) —
  glTF is +Y up and the ship's nose is +Z, and nothing turned one onto the other,
  so the full stack stood on its pad lying on its side from the day the model was
  bound. Hull models are turned onto the nose axis now, from a table of the files
  that break the convention, measured by profiling each along its longest axis.

- **Apollo 8's CSM is drawn from its sections** (`src/sim/vessels.js`) — the
  catalogue's "Apollo CSM" is the 1975 Apollo–Soyuz stack, Soyuz, arrays and all,
  and it flew Apollo 8 to the Moon squeezed from 21.65 m into 11. The model stays
  in the catalogue, relabelled *Apollo–Soyuz*.

- **The ground and every pad on it were tilted** (`src/components/Terrain.jsx`) —
  oriented by a left-handed basis, which `setFromRotationMatrix` cannot
  represent, so the terrain and the complex stood 40 to 84 degrees off the local
  vertical depending on the hour, with the vehicle true-vertical beside them. A
  right-handed rotation and a mirror in z; 0° as rendered.

- **Mission time runs through the hold** (`src/sim/mission.js`) — it sat at minus
  the count until liftoff wrote zero, then jumped.

- **Per-frame uniforms no longer allocate** (`src/gfx/scalarUniform.js`) — every
  `{ value }` literal shares one hidden class that three's uniform library fills
  with objects, so each fraction written into one boxed a heap number: 16.81 B a
  write, every frame, in the Sun's two shaders, the plume's five uniforms while an
  engine burns, the entry sheath and every new uniform in this release. Built
  with `scalarUniform`, 0.06 B.

- **The eye-level view carries no instrumentation** — no predicted orbit, trails,
  osculating ellipse, markers or planet labels, as the opening shot carries none.
  The director keeps it through liftoff when a launch is being watched from the
  ground.

- **The pad and ground cameras aim from the first frame** — seeded when the focus
  changed, before a preset's five-hour hold had been rendered, the ground view
  spent its first second looking at the dirt while the aim swung up.


- **The entry plasma sheath** (`src/gfx/plasma.js`, `src/components/Plasma.jsx`)
  — keyed to `live.heatFlux` and `live.radiativeFlux`, the two the heating gate
  already checks, rather than to a q/v threshold that would be a second answer
  to the same question. Visible from the **Draper point**, 798 K, which is
  23.0 kW/m² through Stefan–Boltzmann; coloured by the effective radiating
  temperature through the same Planck-through-CIE integral the star catalogue
  uses, tabulated into a 256-step ramp at load. Two lobes, a bow shock on the
  windward face and a dimmer wake behind, both from `live.windDir` — which is
  the relative wind the drag term is built on, so the glow is on the face the
  air is actually hitting.

- **The exhaust plume is drawn from the nozzle's gas dynamics**
  (`src/gfx/plumeShader.js`, `src/components/Plume.jsx`) — a unit tube deformed
  in the vertex shader to the straight-sided cone a Prandtl-Meyer expansion
  makes, so changing its shape is four uniform writes and no allocation.
  Measured in pixels at Kennedy: **28,066 px with shock diamonds at sea level**,
  the diamonds gone by the F-1's matched altitude of 4.7 km, opening through
  10.5° at 10 km and 38° at 30 km to the declared 60° cap in vacuum, where the
  footprint is largest at 37,706 px. Ambient pressure comes from
  `live.ambientPressure`, computed once a frame beside the drag term rather than
  once per engine bell.
- **A plume belongs to the stage that is burning.** Sections are drawn whenever
  `s.stage >= ship.stage`, so the whole stack is on screen at liftoff, and the
  flame this replaces keyed off `ship.thrust` alone — lighting the S-II's bells,
  the S-IVB's and the service module's while the S-IC was still on the pad. Four
  plumes on a Saturn V, one of them real.
- **The plume is attached to the glTF stages too** (`src/components/Craft.jsx`).
  A loaded mesh carries no exhaust, and the stage that flies one is the S-IC —
  the only stage with shock diamonds. Both draw paths now place the bells from
  one shared `bellSeats` in `gfx/hulls.js`.

- **Ambient static pressure, derived rather than tabulated** (`src/sim/atmosphere.js`)
  — `p = rho a^2 / gamma`, the ideal-gas identity on the density table and
  temperature profile already there, so it cannot drift from either. 101,325 Pa
  at sea level against the standard atmosphere's 101,325; 26% low at 11 km,
  which is the density table's own single 0-25 km scale height showing through
  and is measured by `verify-plume` rather than left implied.
- **Plume shape from nozzle gas dynamics** (`src/gfx/plume.js`, `src/sim/vessels.js`)
  — exit Mach from the area ratio by the isentropic area relation, exit pressure
  from that and the chamber pressure, opening angle from the Prandtl-Meyer turn
  between exit and ambient. No fitted constants. The F-1 comes out at Mach 3.60
  and 47.4 kPa, which puts the S-IC over-expanded on the pad — Mach diamonds —
  matched at 4.7 km, and flaring past it; the RL10B-2 on ICPS is matched at
  32.5 km, which is what a 280:1 vacuum nozzle should say. **Not** keyed to
  `live.dynamicPressure`, which is the obvious state to reach for and reads zero
  on the pad by construction.

- **The launch pad casts a shadow** (`src/gfx/sunlight.js`,
  `src/components/GroundLight.jsx`, `src/components/Sun.jsx`) — and the
  `castShadow` flags on 98 meshes stop being inert. Within `GROUND_RANGE` of a
  pad the Sun's point light drops to zero and a parallel beam of the same
  illuminance replaces it, which is a substitution rather than an addition: two
  lights delivering the same illuminance to the same ground would light it twice.
  Exact where it matters — the handover ratio measures 1.000000000000 at all four
  sites, the convergence the beam flattens moves a shadow 1.5e-6 m against a
  0.586 m texel, and the falloff it drops is 3.0e-6 across the terrain. Measured
  in the renderer at Kennedy's local noon: 255,654 pixels change, all darker.

- **The sky is the Hipparcos catalogue** (`scripts/fetch-stars.mjs`,
  `src/gfx/stars.js`, `src/components/Starfield.jsx`) — 117,955 real stars
  replacing 52,000 invented ones splatted into the backdrop texture. Positions
  carried from J1991.25 to J2000.0 with the catalogue's own proper motions
  (13,005 stars move more than an arcsecond; Barnard's Star moves 90.6″), stored
  equatorial so the rotation into the scene comes out of `SPIN_AXIS` rather than
  being baked in, and coloured by integrating Planck's law against the CIE 1931
  observer. The Milky Way band stays procedural, because it is unresolved
  starlight no catalogue lists. 1.18 MB, keyless, `npm run stars:fetch`.
- **Star brightness is compressed by a stated law rather than an exposure.**
  Feeding the tone mapper raw flux measured 103 lit pixels on a 3.1-megapixel
  frame — the drawn range is 10⁵:1 into 256 levels. The shader raises flux to
  Stevens' brightness exponent for a dark-adapted point source, about 1/3, which
  is the same psychophysics that made the magnitude scale logarithmic. Measured
  after: 20,205 lit pixels.

- **The decay theory reads the air at the craft's own radius.** `rates`
  (`src/sim/decay.js`) is written about a *mean* orbit — `meanSemiMajor`, the
  two-body orbit carrying the craft's total energy — and sampled the density at
  `a_mean (1 − e cos E)`, which is where the craft would be if J₂ did not hold it
  anywhere else. Carrying J₂'s radial and transverse terms through the linearised
  radial equation gives, for a near-circular orbit,

  ```
  r = a_mean [ 1 + ε ( 3/4 sin²i − 1/2 + 1/4 sin²i cos 2u ) ],  ε = J₂R²/a_mean²
  ⟨Φ_J⟩ = μ ⟨δr⟩ / a_mean²
  ```

  the same offset twice, once as height and once as the potential holding the
  craft at it, so the speed picks up `4μ⟨δr⟩/a²` rather than `2`. Checked against
  a flown revolution by `verify:radial`: the form predicts a mean offset of
  +1.549 km and a second harmonic of 1.638 km where the flight measures +1.554
  and 1.638, and the drag integral goes from 1.037 of the flown arc's to **0.999**.
  Flown, the Vandenberg lifetime forecast goes from 191.4 h to **204.8 h** against
  206.5 h of flight, −7.3% to −0.8%, with no sample along the decay worse than
  0.5%.
- **`assessOrbit` plans on the mean eccentricity as well as the mean axis.**
  Pairing a mean semi-major axis with an osculating eccentricity was a mixed
  quantity: the osculating value swings 0.000555 to 0.002926 within one
  revolution, fifteen kilometres of perigee on an orbit whose perigee does not
  move 72 m in five revolutions. It was kept because feeding the mean one in
  measured *worse* — and that was a measurement of the radius error above, which
  gave the theory too much drag and so favoured the smallest candidate. With the
  air read in the right place, mean axis with mean eccentricity measures −0.48%
  against +0.89% for the mixed pair.
- **The injection floor's margin is derived from J₃ rather than fixed.** A flat
  kilometre stood on a worst measured perigee error of 0.43 km, taken when the
  two errors above were cancelling under it. What a forecast actually misses is
  how far the J₃-forced eccentricity *turns* inside the wait, bounded by
  `2 a e_J3 |sin(ω̇ Δt / 2)|` — nothing for a wait of an hour, the full
  `2 a e_J3` for one long enough to turn perigee half round. Kennedy at +96 h
  waits 215 h, in which perigee turns 117°: 6.1 km, against 4.7 km of error
  measured on that flight. A fixed margin is wrong at both ends of that range.
- **The TLI window forecast carries the craft's own nodal precession.**
  `predictTLIWindow` held the craft's orbital plane fixed while it marched the
  Moon — exact on a point mass, wrong on an oblate planet, where the node
  regresses 7.9°/day at parking altitude. The fleet injected 9–88 hours early
  against its own forecast; the plane normal is now carried forward about the
  spin axis at that rate, and every injection lands within a march step of it
  (−19.27 → +0.81 h at Kennedy, −87.57 → −0.13 h at Baikonur). A spherical field
  makes the rate zero, so a point-mass comparison forecasts exactly as before.
- **The loiter planner plans on mean elements.** `assessOrbit`
  (`src/sim/mission.js`) now takes its semi-major axis from the energy invariant
  `ā = −μ/(2E)` rather than the osculating value, which J₂ swings ±10 km with the
  argument of latitude — an order of magnitude more than drag moves it in a day.
  Measured after: 191.4 h forecast against 206.5 h flown for the case that read
  319.8 h against 405.8 h before. A consequence is recorded in `verify:loiter`:
  with the short-period term gone, no pad falls short of its window at its
  nominal launch hour any more, so the gate's shortfall scenarios are found by
  sweeping the launch hour rather than assumed.
- **Five gates re-baselined against the flown result.** `verify:nodes`,
  `verify:predict`, `verify:gizmo`, `verify:horizon` and `verify:warp` encoded
  two-body closed forms as exact claims — vis-viva transfers, "the apsides match
  the analytic conic to ten metres", "the parking apogee is on target to 200 m" —
  and a real oblateness makes those claims false rather than approximately true.
  Where they compared mean theory against an oscillating quantity they now
  compare like with like.
- **`verify:gizmo` is deterministic.** Its per-frame allocation bound was
  measuring three calls in a single loop body, where they share a caller's
  inlining budget and V8 boxes whichever one it declines to inline — 16 B,
  varying per process, failing the gate about one run in three. Each call is now
  measured at its own call site, which is also the faithful shape; the sum of the
  three is held under half a heap number, tighter than the old bound.

### Gates

**`verify-broadcast`**, 26 checks: every view in every phase of every mission
captioned, only real cameras called cameras; the clocks' formats and Eagle's
GET; every lower third evaluating; the far side, synthetically (behind, near
side, 2% past and inside the limb) and on a flown orbit, where the fraction of
each revolution spent hidden matches acos(√(1−R²/r²)/cos b)/π to 2% and agrees
sample for sample with the limb seen from the vehicle; the script's phases and
speakers; the count read within 0.15 s of each second; a reply waiting a light
round trip to a tick; nothing through the far side and the held call played at
AOS; no burst from a phase crossed at an hour a second; every film look
complete; and the far-side test allocating nothing.

- **`verify-intro` (45 checks) joins the suite — 49 of 49.** Drives the whole
  intro flight for every dossier under Node and asserts what the shot
  promises: the camera never enters anything drawn — swept over four lunar
  phases and four hand-over worlds (the pad, both lunar hemispheres, lunar
  orbit), which is the sweep that caught the settle direction burying Eagle's
  intro 600 m inside a near-side Moon; the absolute flight is invariant under
  floating-origin moves to under a micron; it opens ≥ 0.4 AU from the Sun and
  settles `arc.settle` off the hull *above* the host world's horizon; the lens
  tightens 52° → 40°; every page turns in order; and the `viaMoon` arcs really
  pass the Moon. Falsified before use: restoring the Earth-radial settle puts
  the camera 3 km inside the Moon and reds the gate on the first dossier.

- **`verify-cosmos` (8 checks) joins the suite — 48 of 48.** Holds the sky
  against observed facts rather than against itself: Halley's elements must
  walk the Kepler machinery back to its observed perihelion of **1986-02-09**
  (found within 0.31 d) and its observed **0.5860 AU**; Pluto's mean motion
  must give its **248.0-year** period; every moon's offset and period must
  match the measured orbit; and the force/sky split must hold — exactly seven
  pullers, sky pulls on nothing. `verify-rails` was taught the same boundary
  (moons are planetocentric, not solar conics; the small-e mean-speed series
  has no authority at Halley's e = 0.967 and gets no column there), and
  `verify-icons` validates the new mark's schema.

- **`verify-surround` (21 checks) joins the suite — 47 of 47.** Builds every
  site's surroundings under Node against a *sloped* heightfield and asserts the
  property that matters: no structure floats and none is buried past its skirt,
  per structure from the build's own base ledger; every tree, car and person
  stands exactly on the sampled ground; all geometry finite and inside the
  terrain patch. Falsified before use: flipping one building's skirt reds the
  gate with the building named and located.

- **`verify-loi` and `verify-staging` are gates now, and both were lying** — each
  ran, printed numbers, and exited zero whatever those numbers said. Converted to
  a `checks` array, a PASS/FAIL verdict and `process.exit(1)` on failure; both
  verified to actually go red — `verify-staging` on a state whose capture crosses
  no separation (4 of 7 fail), `verify-loi` with its apsis bar tightened to a
  millimetre (both fail). The suite runs **36 of 36**.

  `verify-loi` asserts what its own section is for: the apsides of the orbit the
  *elements* describe, against the apsides *flown*, to 100 m — measured 12 and
  13 m, so about eight times the headroom, and no tighter than a few metres
  because the flown extremes are sampled at the frame rate. **Not** the brief's
  `|dv_delivered − dv_target| ≤ 0.5 m/s`: the cutoff is on **eccentricity
  minimum**, not on a delta-v target, so the two are not meant to be equal and the
  gap is 0.89 m/s (0.11%). It is held to 1% of the estimate instead, which is a
  claim about the burn model rather than about a target that does not exist.

  `verify-staging` needed a state **and a vessel**, and the vessel was the bug. It
  is written against the Artemis stack, whose capture burns stage 2, the ICPS; on
  an Apollo-8 state that index is the S-IVB, jettisoned back at TLI, so the
  shorting did nothing and the script never exercised staging at all. Measured:
  delivered delta-v identical to two decimals for *every* shorting value, and
  `STAGING seen: false`. On Artemis's own approach state it separates mid-burn —
  151 frames of interrupt, worst pointing 0.028 mrad, and the mass drop is
  3,490.038 kg: 0.038 kg burnt that frame plus the ICPS's 3,490 kg of dry
  structure, off the arithmetic by 1.8e-12 kg. What it asserts: the stage really
  goes, the interrupt is brief, the vehicle holds retrograde through it, the drop
  is bookkeeping rather than an event in the trajectory (the craft travels no
  further across that frame than the one before), and the capture still closes
  into a bound low lunar orbit afterwards. Three of the brief's other proposed
  checks were not written, and the reasons are physical: a separation applies **no
  velocity impulse** (`separate()` touches no state), so an impulse check is
  vacuous; and staging here is triggered by propellant depletion rather than a
  schedule, so `±0.01 s` against a flight profile has no referent.

- **Three gates that ran but were never registered** — `verify-lunar-ascent`
  (written with this release, and absent from both `verify-all`'s gate list and
  `package.json`), `verify-tei-timing` and `verify-return`. The last two each name
  a *lunar-orbit* snapshot in their own usage line and the checked-in fixture is
  exactly that, so both now default to `scripts/fixtures/lunar-orbit.json` the way
  `verify-heating` already did, and accept a path to any other state as before.
  Registering them also made the boundary explicit:
  `verify-all`'s header now says which gates are out and why — four waiting on a
  lunar-*approach* fixture that does not exist, one on an attitude capture, and
  four that are red (below).

- **`verify-lunar-ascent`** — Eagle from Tranquility Base to the latch, held to
  three kinds of claim. The clamp stands the LM at its stand height over the site
  and carries it round at the Moon's spin there to a part in 10⁹; Columbia is
  placed on Apollo 11's 56.6 × 62.5 nmi orbit by solving for that mission's own
  TPI time, and the conic reads back to a millimetre. The ascent cuts off on its
  horizontal speed to the step the ceiling holds (0.02 m/s), climbing at P12's
  rate and at P12's height, and flown at the 60× powered cap it reaches the same
  orbit as at 1× — 16.733 × 87.602 km against 16.724 × 87.582. CSI, CDH and TPI
  deliver exactly the Δv they were loaded with; TPI lands within 30 s of Apollo
  11's 2:41:51 and the docking within 40 s of 3:41:00, closing at 0.096 m/s, with
  the ascent stage's RCS left more than half full. Thirteen frame paths are
  measured at 0.06 B against the 6 B bar. It cost one measurement to get there:
  its pad paths need a **40,000-call** warm-up rather than the harness's default,
  because returning to the pad after the flights above makes the optimiser
  recompile them and the new code lands at about 4,000 calls — the clamp read
  16 B while its code was the one compiled mid-flight and 0.06 B recompiled, on
  identical work. A 2,000-call warm-up would have sat under that threshold.

- **`verify-moon-frame`** — the frame is a rotation and obeys the three laws; the
  recorded mean orbit is a fresh measurement of the simulated one; flown against
  a year of the integrated orbit, Earth stays centred in the lunar sky and
  wanders by the real Moon's libration; and the drawn Moon shows Earth the
  longitude the frame says it does, where the old construction showed 90°E. Its
  first draft measured the spin as the prime meridian's ecliptic longitude and
  saw a 3.6e-4 wobble that is only a tilted circle's projection.

- **`verify-ground-view`** — what a person by the pad sees. The atmosphere true
  on the ground, eased without a step to the exaggeration at 100 km, and
  bit-for-bit unchanged from there out; the zenith blue and the low sky blue-white
  where the old construction drew it orange; the eye-bunched samples beating even
  spacing in every direction; no star, planet or Milky Way in daylight, the
  naked-eye sky at night, every star from orbit; every model nose axis onto +Z
  and the Saturn V file's escape tower up, where the file is present (CI fetches
  the catalogue after the gates, and the gate says so); the pad particles
  double-sided inside the terrain's mirror. And allocation: the sky, the pad
  particles, the plume and the Sun's clock at 0.06 B beside a literal uniform
  that has to be seen at 16 — which is how its first run found the uniforms.

- **`verify-countdown`** — the minute as functions and as flown at real time:
  events in order, the clamp holding under thrust to the coordinates'
  resolution against a free vehicle that would have risen 0.85 m by release, the
  pad burn's propellant, mission time monotone through zero, a parking orbit
  afterwards; the ground drawn in the true local frame at every hour; the
  observer's height, stand-off and ranked placement at every pad, with the Sun
  put north and south of each pad in its own frame. Its first draft compared the
  hold against one frame of free flight and got it wrong twice.

- **`verify-pad-geometry`** gains the swing arms: every triangle of every arm
  swept through the swing a degree at a time, measured exactly in plan against
  the hull as drawn at that triangle's own heights — never inside it, 0.250 m
  from it mated, at least 16 m from the axis swung back — and the recorded
  model profile re-measured against the file wherever the file is present. Its
  first form tested vertices, which overstate the gap to a box whose nearest
  point is mid-face, and eleven angles nine degrees apart, which stepped over
  the closest approach.

- **`verify-plasma`** — the Draper point and Stefan–Boltzmann round-trip, the
  sheath colour against the star catalogue's own blackbody, and the sheath flown
  down an entry corridor: dark at 120 km, lit through peak heating, monotone on
  the way in. It caught two of its own author's mistakes — a saturation constant
  quoted from a different vehicle's stagnation point, which kept the sheath under
  a third of its opacity, and a darkness check placed at 100 km where a faint
  glow is correct.

- **`verify-j3`** — the two closed forms `mission.js` decides a parking orbit's
  survival on, held to the field `rk4.js` actually integrates. The apsidal rate
  `ω̇ = ¾ n J₂ (R/p)²(5cos²i − 1)` matches the integrated orbit to **0.38 deg/day,
  11% where the rate is large enough for a ratio to mean anything**, across five
  inclinations; at the critical inclination — computed as the root of
  5cos²i = 1, not quoted — the apsis turns 0.11 deg/day against 2.75 anywhere
  else, and reverses across it. The J₃ forced eccentricity is isolated by flying
  the same state twice with J₃ on and off and differencing, over an apsidal cycle
  each: **0.3% to 6.1%** of the closed form. Nothing is compared to published
  tracking, which is not available offline.

  It caught two mistakes in its own first draft. It read the eccentricity
  vector's angle against a fixed direction — the longitude of perigee, with the
  node regressing underneath it — and got −2.02 deg/day where theory says +3.57,
  which looked like a sign error in the physics and was a sign error in the
  measurement. And it flew circular orbits, where the eccentricity vector is the
  J₂ ripple, so the "apsidal rate" came out at 360 deg/day at every inclination:
  the orbital period, aliased.

- **`verify-csm`** — what cascaded shadow maps would cost, measured before any
  material was touched. Written first on purpose, and it changed the design.
  `three-stdlib`'s CSM is **broken against three 0.180**: its `injectInclude()`
  assigns `ShaderChunk.lights_pars_begin = CSMShader.lights_pars_begin`, a
  property that does not exist, so constructing one sets a chunk every lit shader
  includes to `undefined` process-wide. three's own `examples/jsm/csm` extends it
  correctly. And `setupMaterial` overwrites `onBeforeCompile`, which
  `gfx/shaders.js` already uses for the Earth's night lights and the Moon's
  eclipse shading — patching those deletes their shaders, not patching them makes
  them N times too bright.

  The measurement that decided it: a cascade's shadow box is sized from its
  frustum slice's far-plane **diagonal**, 1.690x its far distance at this
  camera, not from the slice's depth. So the specified 800 m near split gives a
  1,352 m box and **0.330 m a texel, not 0.195** — and does not resolve the 0.3 m
  lattice tie it was specified for. Deriving the split from the texel instead
  gives 473/1021/2200 m and 0.195/0.421/0.908 m, which does. That configuration
  was not built: three 4096-square maps is 300-400 MB of GPU memory on a public
  web page, against 100-134 MB now.

- **`verify-heating` is in the suite**, which it could not be while it took its
  flight state as a command-line argument — the npm script passed none, so
  `npm run verify:heating` printed a usage line and exited, and the same was
  true of `npm run verify:alloc`. Both now default to one checked-in state,
  `scripts/fixtures/lunar-orbit.json` (2.3 KB, `npm run fixture:lunar` to
  regenerate), and the suite is 25 gates at 1 s more.

  The point is what it closes. The sheath `verify-plasma` draws is lit from the
  Sutton–Graves and Tauber–Sutton fluxes, and until now nothing in CI checked
  those fluxes themselves — the downstream gate assumed them. Peak on the
  fixture's corridor is **494 W/cm² total, radiative over convective by 2.46×,
  356 W/cm² radiative peaking at 60.8 km against 145 W/cm² convective at
  57.9 km**, over a 23.8 kJ/cm² integrated load.

  A checked-in state does not follow the code that made it, so the gate's first
  check is that the fixture still restores into `LUNAR_ORBIT` under the current
  simulator; a drifted one fails there rather than passing meaninglessly. The
  fixture is pinned rather than re-flown on purpose — flying to lunar orbit takes
  0.36 s, so this buys no time, it holds the entry corridor still so the gate
  fails when the heating model changes and not when TLI targeting does. Flown
  from a different state the same entry peaks at 439 W/cm², which is the size of
  what pinning it removes.

- **`verify-plume`** — the derived ambient pressure against the standard
  atmosphere, Prandtl-Meyer and the isentropic relations against theory and
  against their own inverses, and every nozzle in the fleet against what a
  sea-level or vacuum engine should do. It also records an allocation the
  render-loop rule is not met by: see *Known limitations*.

- **`verify-shadows`** — the parallel-beam substitution against the resolution it
  serves, the handover against the point light's own falloff, and the shadow box
  against what has to fit in it. It caught two things while being written: a doc
  comment claiming the substitution's error was a thousandth of a texel when the
  pairing was wrong twice over (it is 1/380,000, and over a different span), and
  a shadow box that clipped every shadow below 41 degrees of sun elevation.

- **`verify-stars`** — the catalogue against published positions (worst 3.5″
  after 16-bit quantisation), the frame against the planet (**Polaris 0.736° off
  `SPIN_AXIS`**, where the real pole star is), the colours against physics
  (Planck-through-CIE against the Kim et al. Planckian locus: 0.0001 in x, y at
  5772 K, worst 0.0036 at 2000 K), and the sky against the ephemeris (the
  simulator's own Sun at RA 282.520° against the almanac's 281.286°, inside the
  1.0996° Earth-position offset `verify-rails` measures independently).

- **`verify-radial` verifies two short-period forms, and keeps them apart.** The
  semi-major axis's term and the radius's are both first order in J₂, both
  derived, and behave nothing alike over a flown revolution: the axis's content
  is second harmonic at 9.807 km with 0.016 of first, the radius's is first
  harmonic at 10.010 km — its eccentricity — with 1.638 of second. Substituting
  one for the other takes the drag integral from 4% out to 25% out, and that
  measurement is kept as a counter-example so it is not tried a fourth time.
- **`verify-loiter` checks the eccentric decays with J₃ lifted**, which is the
  field the theory is a theory of, and measures beside them what the odd zonal
  adds: 0.10% and 1.39% against 1.11% and 7.75%. It also asserts that J₃ moves
  the eccentricity by what `J₃ R sin i / 2 J₂ p` says, to a fifth, so the
  explanation has to stay the explanation.
- **Two of `verify-loiter`'s checks had been deleted by a comment.** An
  unterminated `/*` opened inside one entry of the checks array and was closed by
  the doc comment of the entry two below it. That is valid JavaScript: the array
  went on holding twenty entries, the label of the first was printed against the
  expression of the last, and the gate reported PASS for a check it was no longer
  making. Both are restored, and the gate is at 26 checks.

- **The allocation harness cannot be read as a pass when it did not measure.**
  `bytesPerCall` (`scripts/allocation.mjs`) returned nothing in two situations —
  no `--expose-gc`, so the heap cannot be read across the loop, and no clean
  window, so a scavenge landed in every one — and the two arrived as `null` and
  as `Infinity`, which nine gates handled nine ways. Five printed
  `.bytes.toFixed()` on a sample that could be absent and threw a TypeError; the
  rest wrote `!sample || sample.bytes < limit`, where a missing measurement is
  falsy and therefore **passes**. That is the blind-gate failure this module's
  own header is about, in thirteen checks at once. Every sample now carries
  `measured`, `bytes` is NaN when it is false, and `seesAllocation` /
  `allocatesNothing` are the only supported way to turn one into a verdict: both
  fail on an absent sample and print the reason in the label. The shrink stops at
  64 calls rather than halving to one, because a one-call window reports the
  harness's own few kilobytes as the call's cost. Unchanged where it measures —
  `verify-horizon` reads 235 B / 209 B with a 56 B control, reproducibly — and
  red where it cannot, instead of green.
- **`verify:horizon`'s cost ratios are deterministic.** The two-node and
  capped-plan costs were a mean over ten calls, nearly all of them the first the
  process had made down that path, so the figure included a JIT tier-up whose
  arrival inside the timed window is not deterministic. Measured back to back on
  one machine: 2.16 ms against 5.84 ms for the same work, while the parking-orbit
  cost sat still at 0.80 against 0.82 — the ratio read 2.69 on one run and 7.16
  on the next against a bar of 4, which is the failure that had been reported as
  a flake. All three costs now warm the path, then take the **median** of seven
  short loops, the same remedy the allocation harness uses over its windows. The
  ratios are 3.06–3.12 and 7.56–7.71 across six runs, a 2% spread where the old
  figure varied by 166%. Warming also moved the released figure: the
  parking-orbit cost is 0.56 ms warm, not the 0.80 ms a mean carrying its own
  warm-up reported, so the ratios above are the honest ones. A separate pair of
  `verify-horizon` failures, also reported as flake, were invocations of the gate
  by hand without `--expose-gc`: those threw a TypeError on a null sample rather
  than skipping it, and now go red naming the flag.
- **Every clock the suite reads is audited, and there were two.** `costOf` now
  lives in `scripts/timing.mjs` with the sweep recorded in its header, because an
  audit you have to redo is one that gets redone differently. `verify-horizon`
  reaches it for all three of its costs, and `verify-predict` for its only
  asserted figure — `a projection costs under 10 ms`, which was a mean of twenty
  calls that were the first the process had ever made down that path. Measured
  over ten fresh processes it read 1.20–1.24 ms, a 3% spread against a 10 ms bar,
  so unlike `verify-horizon` it was never at risk; warmed it reads **0.55 ms**,
  a 2.2× correction to a figure the gate quotes. The remaining four clocks —
  `verify-all`'s per-gate summary and the three NRHO gates — are printed and
  asserted nowhere, so a slow gate reads as `20 s` rather than as a failure.
  Absolute bars are kept where the claim is a real-time budget and ratios where
  the claim is relative, which the audit states.
- `verify:prem` (38 checks) added to `verify:all`: the profile against published
  mass, inertia and shell densities; dg/dr = 4πGρ − 2GM/r³ between the steps; the
  field against a numerical gradient of its own potential; the integrator's
  inlined copy of the arithmetic against `prem.js` by differencing; the
  closed-form nodal and apsidal rates; Darwin–Radau; the deflection of the
  vertical; every pad's gravity; and what the panel draws, including its refusal
  to draw a rate for a craft on the ground.
- `verify:pads`, `verify:pad-geometry` and `verify:audio` cover the new ground
  structures and the audio engine. All three were added to the suite and to CI,
  where they had not previously run: the chain stopped before them.
- `verify:radial` (11 checks, 1 s) is new, and it exists because three separate
  proposals to close the loiter lifetime error by correcting the short-period
  radial term have been argued rather than measured. It flies the same commitment
  and pins what the argument needs: the first-order form
  `a_osc − a_mean = −(J₂R²/a_mean)(3 sin²φ − 1)` matches the flight to 82 m at its
  worst sample across a 26.4 km swing; the semi-major axis's short-period content
  is second-harmonic at 9.8 km while the radius's is first-harmonic at 10.0 km
  with only 1.6 km of the second; the shipped profile's drag integrand is 1.0373×
  the flown one; adding the radial term alone takes that to 1.2470, further from
  flight rather than closer; and the mean eccentricity brackets the answer either
  way. It runs *after* `verify-loiter` in the suite only because it is newer.
- `verify:all` is a runner rather than a `&&` chain. Every gate runs whether or
  not an earlier one failed, the log ends with a per-gate summary, and the exit
  code is the suite's rather than the first gate's — so a red gate still fails
  the build but cannot hide the eighteen behind it.

- **The entry autopilot's lateral law could not converge**
  (`updateEntryGuidance`, `src/sim/mission.js`). It flipped the bank sign whenever
  the cross-range was past its deadband *and still growing*. That is not a control
  law: the first excursion past the deadband leaves the vehicle permanently
  outside it, so every dwell expiry then finds a growing error and flips again.
  Measured, it degenerated into a 15 s square wave with a near-zero mean lateral
  acceleration — **19 reversals that still let the cross-range reach 237 km,
  against 306 km with the loop switched off entirely**. It was removing a fifth of
  the drift and reporting the rest as guidance.

  The law is now the sliding mode on `sw = cross + lead · crossRate`, where the
  sign of that sum is the direction the lateral acceleration must have, and on
  the surface where it vanishes the error decays as `exp(−t / lead)` — so the lead
  is not a gain but the time constant the controller drives it to zero with, 60 s
  against a 400 s entry. It is set with the deadband, jointly, off a grid, and at
  the point with the best **worst neighbour** rather than the best centre, because
  the ridge is narrow: 60 s / 40 km holds within 51 km across a ±15 s and ±10 km
  perturbation, where the grid's outright minimum reached 52 km at a neighbour.
  Both values are refits — the 60 km deadband had been fitted to the law that did
  not work. Cross-range at splashdown: **27 km against 83 km** for the same law on
  the old gains.

  The direction the error moves for a given bank is derived rather than assumed,
  because an earlier version reasoned from the roll convention and had it
  backwards: with the lateral axis the integrator rolls lift onto, the factor is
  `−|r̂ × v̂|` — always negative, magnitude the cosine of the flight-path angle.
  0.994 across this entry. And the drift is **self-inflicted**: the entry is
  exactly on its arrival plane, `cross = 0` at separation, and the 306 km is
  created by having to fly banked at all.

- **`verify-entry-guidance`'s no-skip check was not reachable, and it is now one
  that is.** It asserted the vertical rate is never positive while the craft is
  above 7.5 km/s. A reversing entry cannot satisfy that: the bank sign is reversed
  by rolling, and rolling from `+bank` to `−bank` sweeps the lift vector through
  full-up, so the rate must go positive for a few seconds — **+72 m/s** out of an
  11 km/s entry, at the moment of the reversal, and it scales with the roll rate
  (133, 279, 383 m/s at 0.20, 0.10, 0.05 rad/s). What is asserted instead is
  **altitude regained below 95 km**: zero for a monotone descent, however much the
  bank rolls, and falsifiable rather than merely true — hold the roll rate to
  0.05 rad/s and the same entry regains **48 km**, climbing back out of the
  atmosphere. The gate's ten checks pass; the peak climb is still printed, as a
  diagnostic rather than a bar.

- **`verify-approach` is a gate and not an instrument.** It printed a table and a
  closest approach and asserted nothing, so it could never go red. It now holds
  the lunar approach to the conic it is on, measured at the sphere of influence:
  **v_inf 0.8076 km/s**, flight-path angle **−85.85°**, B-plane miss **5,574.342
  km** against a lunar radius of 1,737 km. And it holds the flyby to the conic's
  own prediction, which is the claim with teeth — B is read 69,823 km out and the
  periapsis is 81 km above the surface.

  Measured rather than assumed, twice. The prediction error falls from **23.196 km
  (1.28%)** at the sphere of influence to **16.339 km** and then **stops**: the
  readings inside 5,000 km and 2,500 km agree with each other to **32 m** while
  both sit 16 km from the flyby. That floor is the Sun and the Earth bending the
  approach, not a truncation error, so the gate asserts convergence *to a floor*
  and would be asserting a two-body problem if it asked for zero. And γ is
  reported at each reading rather than bounded, because at a stated range
  `(v_inf, B)` and `(|v|, γ)` are the same two numbers in different coordinates;
  its one independent use is as a cross-check on the construction — for a
  straight-line approach `γ = −acos(B/r)`, asserted to agree within 1°, which is
  what would catch an axis error in the B-plane. Falsified both ways: on a state
  that is already in lunar orbit it fails, and with the B-plane bar moved from
  `R + 100 km` to 6,500 km it fails too.

- **Four gates that were red are green and registered**, so no gate that runs is
  left out of the build: `verify-vessels` (9 checks — published mass,
  thrust-to-weight and ballistic coefficient per stack, and that each vehicle can
  lift itself off the world it launches from), `verify-nrho-capture` (18),
  `verify-nrho-keeping` (19) and `verify-entry-guidance` (10).

  The NRHO pair is the field. The four-body scratch integrators in `capture.js`,
  `halo.js` and `targeting.js` were flying point-mass gravity while the craft
  flies an oblate Earth with seven planets on rails, so a "reference" was not a
  trajectory of the field it was compared against. They now adopt it
  (`adoptFieldFrom`), with the rails as a **private table** — a scratch that
  spans a hundred days must move the planets itself, and doing it through the
  shared buffer would leave the live run reading a sky a season ahead of its own
  clock — and with each segment's **clock set explicitly**, because the rails are
  solved against `t` and a scratch that only accumulates it carries the offset of
  every propagation before it. Under the live field the keeping gate's own
  reference law holds every flight with every solve converging, and the capture
  reaches the reference within 10 km and 1 m/s and stays inside 100 km of it for
  seven revolutions.

- **`verify-allocation`'s crossing bound was re-derived, and the drift is
  attributed rather than absorbed.** The reading moved from a sample of 228.28 KB
  to 261.39 KB, so the bound went from 256 KB to 296 KB by the same rule it was
  first set by — seven runs (253.39 to 270.26, sd 5.59), mean + 6.2 sd — with the
  checks themselves untouched. A worktree at the last commit reads 218.24 KB
  through the same harness; copying the working tree in one file at a time puts
  the whole of it in `targeting.js` (+40 KB: 219.93 KB without it, 260.29 KB with
  it, the same three other files either way), the edit that gives the projection
  scratch the live field. Three times the frames retains 257.95 KB, so it is still
  paid once rather than leaked (1.336 → 0.440 B/frame), and the steady regime —
  the actual zero-allocation mandate — is unchanged at −0.028 B/frame.

- **Four gates that passed had never been registered** — `verify-predict`,
  `verify-nrho-cycle`, `verify-nrho-ephemeris` and `verify-nrho-family`. They run
  unaided, assert 18, 6, 3 and 10 checks, and cost 5.3, 0.7, 2.8 and 2.4 s
  between them, so there was nothing to weigh against registering them. The suite
  runs **45 of 45**.

- **`verify-icons`** — one gate over every brand surface. It re-runs the
  generator's `--check` (all 10 files byte-for-byte against a fresh render),
  asserts PNG magic bytes and manifest icon dimensions from the decoded headers,
  confirms `index.html` references only files that exist (this server's SPA
  fallback answers 200 with HTML for anything missing, so 200 alone can lie),
  checks `brand.js` imports cleanly into node, and proves the boot splash
  markers balanced. Falsified by removing `mark.svg`: red with the missing file
  named, green once restored. The suite runs **46 of 46**.

### Known limitations

- **A recorded film carries no duration in its container.** MediaRecorder's
  WebM has no duration header until it is remuxed — measured `video.duration`
  of `null` on a finished take. The film plays from the first frame and the
  file is a valid VP9 WebM (decoded and measured here), but a player that
  needs the duration before playing, or seeking within it, may treat it as
  unknown-length until it is re-wrapped. Remuxing on save would fix it and is
  the obvious next step.

- **The Earth-launched mission timeline is about twice the real flight, and the
  lunar approach arrives near apogee.** Measured: TLI at MET **46.62 h** (Apollo
  8's was 2.83), lunar periselene at **184.7 h** (69.0), splashdown at **303.9 h**
  (147.0). The parking orbit waits 46.4 h for its window, and the transfer's
  apogee is a little beyond the Moon's distance, so the craft spends the last
  third of the coast crawling towards it — 201,512 km covered in 114.0 h, an
  average 491 m/s, entering the sphere of influence at 1.41 km/s. Both legs are
  affected symmetrically (return coast 115.6 h against a real 57). The README's
  preset table measures these figures rather than promising different ones, so
  nothing here is a regression — but the flight is a week where the real one was
  six days, and a fix means re-solving the TLI window, not adjusting a constant.
  `verify-loiter`'s own window scenario is unaffected (it flies its own hour).

- **Vandenberg's polar loiter measures exactly as documented and no fault was
  found in it.** Reported as broken; measured at `PERIAPSIS_SITE=vandenberg`,
  hour 144: the parking orbit waits **282.3 h** for a window its **204.8 h** of
  life cannot reach, and the flight computer plans the two-node raise the preset
  comment claims — **2.515 m/s and 8.008 m/s, 10.52 m/s in total**, the first
  9.6 min after hand-over. Hours 0 through 120 all *reach* their window and plan
  nothing, which is the contrast the preset exists to show. The one fault it did
  share was the camera default, which for this preset already agreed with the
  director (`earth`).

- **The Earth's surface detail does not change with distance.** The surface is a
  set of full-globe maps — day, night, clouds, normal, roughness — at a single
  resolution, so closing on it resolves nothing new however close the camera
  gets. *Hyper detail from the inside* would need a second level to switch to —
  a tiled or quad-tree surface, or at least a detail overlay keyed on range — and
  there is no such level in the pipeline today. This is a capability gap, not a
  defect: nothing is broken, the surface is simply drawn at one scale.

- **`earth_roughness.jpg` is not in the repository**, and the roughness slot is
  filled by an inverted `earth_specular.jpg` instead. Worth recording because the
  probe *works*: under Vite's SPA fallback every unknown path answers `200` with
  `index.html`, so an existence check on the status code alone would accept a map
  that does not exist — `exists()` in `gfx/hdTextures.js` also requires an
  `image/` content type, correctly rejects the fallback, and takes the alternate,
  which `invertToRoughness` flips because three multiplies by the green channel
  and specular maps are bright where roughness maps are dark. The rendering is
  right; adding the real map is a one-file change to `public/textures/`.

- **The simulated Moon runs 1% slow.** Its J2000 elements are mean values used as
  the osculating state, and the Sun's tide moves the osculating semi-major axis
  by about a per cent either side of the mean, so the integrated orbit's sidereal
  month is 27.614 d against the real 27.322, and its mean longitude at J2000 is
  216.83° against 218.32°. Missions are flown against the simulated Moon, so they
  are consistent with it; against a real ephemeris it falls 0.14° a day behind.
  Starting it from a real J2000 state vector would fix the orbit and move every
  mission figure the gates hold.

- **A single frame of about 900 ms was seen twice in four traced counts** — once
  between T−4.5 and T+0.5, once at T−7.35 — neither a shader compile (a forced
  fresh compile of the plume's program measured 15.7 ms) and not reproduced in a
  clean 1,400-frame trace. Its cause is not found.
- **The daylight sky is single scattering**, so it is darker than a real one:
  1,090 cd/m² at the zenith under a 38° Sun, where a clear sky is roughly three
  times that. It reads a deeper blue than a photograph exposed for the ground.
- **The count is a presentation.** Ignition at T−3 with a 2.4 s ramp; a Saturn V's
  ignition sequence began near T−8.9 s.
- **The frame rate was measured on one machine.** At 2048 × 1536 with the GPU made
  to finish each frame: 9.6 to 17 ms through the count and liftoff, the
  particles within the run-to-run spread of free, the sky 7 to 8 ms of it.
- **The guided entry lands with a cross-range residual it cannot drive to
  zero.** Splashdown is **27 km** off the arrival plane, against 306 km with the
  lateral loop switched off. The switching law is not the limit: the bank
  *magnitude* is fixed by the vertical demand, so there is no "stop rolling" state
  to settle in — the vehicle can only choose which way to push, and what is left
  over is whatever the last reversal left. Driving it further down would mean
  modulating the bank magnitude against the lateral error, which is a different
  control law than the one Apollo flew (magnitude for vertical, sign for lateral)
  and was not adopted. The residual is also why the gate's bar is 150 km rather
  than tens: tightening it to 20 km would be asserting a schedule this design does
  not have.

- **What the surface-engine brief still leaves unbuilt:** a *powered descent* to
  the lunar surface — the LM is placed standing on its descent stage and flown up
  from there, not flown down to it — Mars surface views (Mars is an ephemeris body
  on rails), Starbase (no pad), SRTM beyond the existing tiles and normal-mapped
  structures. A 500 km far plane was not adopted: it would clip the Sun, the Moon
  and every star from the ground, and the logarithmic depth buffer already covers
  0.1 m to 10¹³ m. The lunar surface and the ascent from it are no longer on this
  list: `tranquility` is a site like the Earth pads, with the ground in three
  levels of real height data (LROC NAC DTM at 2 m a sample inside ±1 km, LOLA at
  29.6 m to ±15 km and 118 m to ±121 km, fetched by `scripts/fetch-moon-terrain.mjs`
  into `public/terrain/tranquility/`), and `src/sim/lunarMission.js` flies Eagle
  from a count on the descent stage to Columbia's docking port — held to Apollo
  11's own numbers by `verify-lunar-ascent` in the suite.

- **The decay theory cannot carry J₃, and that is what now limits it.** The odd
  zonal forces an eccentricity that turns with perigee, `e_J3 = J₃ R sin i /
  (2 J₂ p)` — 5.7e-4 at 30° of inclination, which is 3.7 km of perigee — and
  `rates(a, e, dragK, cos i)` has no argument of perigee to receive it. Measured
  directly: the mean eccentricity of an undisturbed 150 × 250 km orbit wanders
  ±6.19e-4 over 30 days with the odd zonal in the field and ±7.0e-5 with it
  lifted, against ±5.68e-4 from the closed form. With J₃ lifted the same theory,
  unchanged, holds the eccentric cases to 0.10% on a near-circle and 1.39% at
  e = 0.0064, where the full field gives 1.11% and 7.75%; `verify:loiter` makes
  its tight check in the field the theory is a theory of and measures what J₃
  adds beside it. Carrying it would mean threading the argument of perigee and
  its J₂ secular rate through `decayTime`, `decayAfter`, `orbitalLifetime` and
  `circularOrbitDecayingTo`. The **injection floor's margin** is derived from the
  same quantity in the meantime, `2 a e_J3 |sin(ω̇Δt/2)|`, so the floor stays hard
  without it.
- **The second harmonic of the short-period radial term is not represented.**
  `rates` is handed no argument of latitude, so it applies the revolution mean of
  `r − a_mean` and not its 2u part. Measured on a flown revolution that part is
  1.638 km against a 22.5 km scale height, worth **0.11%** of the drag integral,
  where the mean it does carry is worth seven per cent. `verify:radial` asserts
  both numbers, so the omission stays a decision rather than becoming an
  oversight.
- **Ascent guidance still cuts off on osculating elements.** `GRAVITY_TURN` and
  `CIRCULARISE` target osculating quantities, so each pad's *mean* parking orbit
  lands 8–21 km below the 185 km design and differs per pad (167.3 km at Kennedy,
  176.5 at Baikonur, 164.4 at Kourou, 164.7 at Vandenberg), because the commit
  lands at a different point in the J₂ swing. The refactor is scoped in the
  README.
- **A sky pinned by copying `camera.position` in a frame callback is 500 units
  out.** Measured in the running app against a shell radius of 400 — the camera
  sat outside its own backdrop. Fixed in both places that did it, and fixed so
  that neither can drift again: `Starfield.jsx` drops the view translation in its
  own vertex shader, `Skybox.jsx` positions itself in `onBeforeRender`, which
  three calls before it composes `modelViewMatrix`. Measured after: 0.00.
- **`renderer.autoClear` is false, and a probe that calls `gl.render` without
  clearing measures the wrong frame.** This was briefly written up here as a 3%
  brightness anomaly around Earth's limb when the backdrop was hidden. It was not
  one: the extra `gl.render` call the measurement made accumulated additive
  geometry — trails, the atmosphere shell, the star points — on top of the frame
  the app had already drawn, wherever nothing opaque overwrote it, and the
  backdrop is what overwrites it. The pixels showed it plainly at 2.00x exactly.
  Clearing first, the backdrop *adds* 16.06 of mean level rather than subtracting
  0.74, which is the sign physics requires. Destination alpha was 255 in every
  configuration measured and the composer was not in the path, so neither alpha
  nor bloom was involved.
- **One shadow map cannot hold a dawn shadow and resolve the tower casting it.**
  At 1,200 m of half-extent and 4,096 texels, shadows are whole down to 10.6
  degrees of sun elevation and a texel is 0.586 m; below that the tip of the
  longest shadow leaves the box, and a lattice tie narrower than a texel casts
  the tower's shadow rather than its own. The penumbra is hard where the Sun's
  0.53 degrees should make it 1.8 m soft at a 190 m tower's tip. All three want
  cascades, which is a larger change.
- **`plumeAt` boxes one double a call in its under-expanded branch.** 16.8 bytes
  there, 0.8 in the other two regimes, 11.8 across a climb — reproducibly, in a
  branch that is pure arithmetic on `Float64Array` elements. Which value V8 tags
  was not found; `Math.pow` to `exp(e log x)` moved nothing, removing every
  unreachable guard moved nothing, and caching the answer behind a comparison
  made it worse at 23.4. What *did* work, taking it from 33 to 11.8, was
  removing the object argument — a `Map.get` returns a shape V8 cannot pin, so
  every double read off it boxed — and removing the call to `atmosphere.pressure`
  so the caller reads the air once a frame rather than once an engine. Those two
  also made the measurement repeatable: before them the same unchanged code read
  48.80 and 17.61 bytes on alternating runs, and several intermediate "fixes"
  were chasing that variance rather than the code.
- **The shadow box is sized to the shadow, not to the worst case** — and slid
  down the sun azimuth to sit on it rather than on the pad, which is worth a
  factor approaching two because a shadow falls one way and a box centred on the
  pad pays for both. Measured, at 4,096 texels: **0.195 m a texel at 23.7 deg of
  sun elevation and above, 0.337 m at 10.6 deg where the fixed box gave 0.586,
  0.467 m at 7 deg**, and whole shadows down to **5.33 deg against 10.6**, worst
  pad Kennedy. Never coarser than the box it replaces, at any elevation.

  `shadowExtentFor` boxed **16.62 bytes a call** until the cap it reads became a
  module-local `const` rather than the exported `SHADOW_EXTENT`; then **0.83**.
  V8 will fold a plain local into the function and will not fold a module cell,
  so the returned double was being tagged. The likelier-looking culprits were all
  tried and all wrong — the mixed Smi/double return that the plume hit,
  `Math.min` for the ternary, nudging the cap off an integer — and every one
  measured 31.86 B, worse than the fault. The literal appears once; the export is
  an alias of it.

- **Crossing the mission's phase boundaries retains ~220 KB, once.**
  `verify-allocation` measures −1.5 KB over 60,000 frames of steady state, which
  is the render-loop rule holding. Let the same run cross TEI, entry and
  splashdown instead and it retains 219 KB at 200,000 frames and 224 KB at
  600,000 — three times the frames for 2% more, so it is a one-time cost paid at
  the transitions and not a per-frame leak (0.0115 bytes a frame between those
  two points). What allocates, and whether it is the guidance solutions being
  built once per phase, has not been established.
- **A raw `ShaderMaterial` must write log depth or it draws nothing.** This
  renderer runs `logarithmicDepthBuffer: true`, and a shader that does not
  include three's `logdepthbuf` chunks leaves its fragments encoded linearly
  while the rest of the scene is logarithmic — so they lose every depth
  comparison. Measured on the plume before the chunks went in: **0 pixels with
  depth testing on, 25,928 with it off**. Disabling depth testing is the wrong
  repair; it draws the plume over the vehicle it comes out of.
- **`plasmaState` boxes one double a call**: 13.5 bytes averaged over an entry
  corridor, repeatable to the hundredth of a byte over four processes. Inlining
  the helpers — the fix that took the plume from 33 bytes to 11.8 — moved
  nothing, and replacing `Math.pow(x, 0.25)` with `Math.sqrt(Math.sqrt(x))`,
  which is exactly equal and two machine instructions instead of a runtime call,
  made it **worse at 45.4 bytes**. That is not variance; the measurement is
  stable either way, so the file keeps the slower-looking call.
- Eclipse shadow resolution, as documented in the README.

### Deployment

GitHub Pages, via `.github/workflows/deploy.yml`, live at
**https://periapsiszero.dev/**. The workflow runs `npm run verify:all` before it
builds, so a red suite publishes nothing and the previous deployment stays up.
The pruned model catalogue — the 48 meshes the generated manifest refers to,
152 MB of the 1.1 GB of NASA sources — is published once as the **`models`**
release asset and cached by every build thereafter; without it the build still
succeeds and deploys, with every craft in its placeholder hull.
