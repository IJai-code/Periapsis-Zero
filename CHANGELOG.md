# Changelog

Notation: a claim stated as a number is one a gate measures. Anything measured
but not yet fixed is under *Known limitations* rather than left out.

## Unreleased — targeting 1.0.0

### Added

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

### Changed

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
- `verify:all` is a runner rather than a `&&` chain. Every gate runs whether or
  not an earlier one failed, the log ends with a per-gate summary, and the exit
  code is the suite's rather than the first gate's — so a red gate still fails
  the build but cannot hide the eighteen behind it.

### Known limitations

- **The eccentricity is still osculating**, and it is the largest term left in
  the loiter forecast: J₂'s short-period term on `e` is the same order as `e`
  itself at parking altitude (0.000997 at commitment, against a mean nearer
  0.0005), and two kilometres of perigee is seven per cent of the drag. A
  revolution average was measured as a candidate and rejected — 155.8 h, worse
  than the osculating answer. See *Physics core & future roadmap* in the README.
- **`verify:loiter` is red, for two reasons, and lifting the oblateness
  separates them.** Five of its seven failures are also red on a point-mass
  Earth, so they are the gate's own re-baselining rather than the field. The two
  the field decides are the lifetime at the end of a decay (7.3% against a 2%
  bar) and the injection timing: the pads inject 9–88 hours *early* against their
  forecast window, because `predictTLIWindow` holds the craft's plane fixed while
  it propagates the Moon and J₂ regresses the node several degrees over a wait
  that long.
- **Ascent guidance still cuts off on osculating elements.** `GRAVITY_TURN` and
  `CIRCULARISE` target osculating quantities, so each pad's *mean* parking orbit
  lands 8–21 km below the 185 km design and differs per pad (167.3 km at Kennedy,
  176.5 at Baikonur, 164.4 at Kourou, 164.7 at Vandenberg), because the commit
  lands at a different point in the J₂ swing. The refactor is scoped in the
  README.
- Eclipse shadow resolution, as documented in the README.

### Deployment

GitHub Pages, via `.github/workflows/deploy.yml`, live at
**https://periapsiszero.dev/**. The workflow runs `npm run verify:all` before it
builds, so a red suite publishes nothing and the previous deployment stays up.
The pruned model catalogue — the 48 meshes the generated manifest refers to,
152 MB of the 1.1 GB of NASA sources — is published once as the **`models`**
release asset and cached by every build thereafter; without it the build still
succeeds and deploys, with every craft in its placeholder hull.
