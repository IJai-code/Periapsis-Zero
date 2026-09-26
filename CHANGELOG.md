# Changelog

Notation: a claim stated as a number is one a gate measures. Anything measured
but not yet fixed is under *Known limitations* rather than left out.

## Unreleased — targeting 1.0.0

### Fixed

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

**The film of the flight** (`src/gfx/filmRecorder.js`, `MissionIntro`,
`MissionLibrary`) — the intro is a pure function of its clock, so it is
recorded as it plays and kept. The WebGL scene and the film's own titles (the
opening card, the dossier's pages, the letterbox, the hairline) are composited
into one hidden canvas and recorded at the browser's best codec — VP9 where it
will, VP8 if it must, MP4 on the engines that only do that — with the frames
pushed by the recorder's own tick (`requestFrame`) rather than paced by the
compositor, so a throttled or backgrounded tab still makes a whole film. At
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
