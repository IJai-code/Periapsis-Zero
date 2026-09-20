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

### Changed

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

### Known limitations

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
- Eclipse shadow resolution, as documented in the README.

### Deployment

GitHub Pages, via `.github/workflows/deploy.yml`, live at
**https://periapsiszero.dev/**. The workflow runs `npm run verify:all` before it
builds, so a red suite publishes nothing and the previous deployment stays up.
The pruned model catalogue — the 48 meshes the generated manifest refers to,
152 MB of the 1.1 GB of NASA sources — is published once as the **`models`**
release asset and cached by every build thereafter; without it the build still
succeeds and deploys, with every craft in its placeholder hull.
