# Flight fixtures

Three checked-in states, so the gates and instruments that need a mission already
in progress can run with no arguments and no manual step before them.

Two are 114 hours and a capture burn apart, and that is why there is a pair:
`lunar-orbit` cannot answer a question about the approach, because a state that
has already been captured carries no evidence about what the approach looked like.
The third is the same phase as the second flown by the other vehicle — **a state
carries no vessel**, so a fixture is only coherent under the stack it was flown
with.

## `lunar-orbit.json` — 2.3 KB

The vehicle in lunar orbit at MET 184.747 h, stage 3, 20.767 t, having flown
ascent, TLI, midcourse and LOI. It is `scripts/flight.mjs`'s own `--save`
output, so it is the same object `snapshot()` writes and `restore()` reads;
nothing here is hand-authored.

Regenerate it with:

    npm run fixture:lunar

which is `node scripts/flight.mjs --until LUNAR_ORBIT --save
scripts/fixtures/lunar-orbit.json`.

### Why a file rather than flying to it

Flying from the pad to lunar orbit takes 0.36 s, so the file is not saving
time — it is holding the corridor still. `verify-heating` checks two heating
correlations against each other down one entry. If it flew fresh each run, a
change to TLI targeting or the LOI solution would move the entry corridor and
the heating gate would go red for a reason that has nothing to do with heating.
Pinning the state means that gate fails when the heating model changes and not
when something upstream of it does.

The cost of that choice is staleness: the file is a state this code produced on
2026-09-20, and nothing makes it follow the code. So `verify-heating` asserts on
load that the fixture still restores into `LUNAR_ORBIT` under the current
simulator, rather than assuming it. If that check goes red the fixture has
drifted out of the regime the gate is written for and wants regenerating — the
gate says so in those words.

### Reproducibility

Four independent processes on the authoring machine wrote byte-identical files
(sha256 `f599945f…`). That is same-machine determinism and is not a claim about
other platforms; the runner reads this file rather than regenerating it, so it
does not depend on one.

## `lunar-approach.json` — 2.3 KB

The same vehicle on the translunar coast at MET 70.713 h, stage 3, 27.114 t, having
flown ascent, TLI and the midcourse correction. It is the state `LUNAR_APPROACH`
opens in — the phase is entered when the midcourse burn ends — which is 196,571 km
from Earth and so **130,381 km outside the Moon's 66,190 km sphere of influence**.
That is not incidental: it is the only regime in which the selenocentric conic is
still a fiction, which is exactly what `verify-approach` exists to show, and no
state recovered from lunar orbit can stand in for it.

Regenerate it with:

    npm run fixture:approach

which is `node scripts/flight.mjs --until LUNAR_APPROACH --save
scripts/fixtures/lunar-approach.json`.

### What it is for

`verify-approach`, `verify-loi`, `verify-loi-sweep` and `verify-staging` all need
a pre-capture state, and all four had previously required one as a command-line
argument — so none of them could run without someone first capturing a snapshot by
hand, and `verify-loi-sweep` needed two states at once.

Two of the four are now gates in `verify-all` (`verify-loi` and `verify-staging`)
and two are instruments that print and assert nothing (`verify-approach` and
`verify-loi-sweep`). Pinning the fixture is what let either happen.

### Reproducibility

Three independent processes wrote byte-identical files (sha256 `85dd0a8c…`), by
the same same-machine-only standard as `lunar-orbit.json` above.

## `lunar-approach-artemis.json` — 2.3 KB

The same phase flown by Artemis: MET 70.782 h, stage 2 (the ICPS), 29.360 t. It
exists because `verify-staging` is written against the Artemis stack — its ICPS
shorting addresses `stageProp[2]`, and for Apollo 8 that index is the S-IVB, gone
since TLI.

**Why a second approach state rather than one.** `restore()` fills the state vector
and the ship's own fields; it does not know what vessel they belong to, because the
vehicle comes from `PERIAPSIS_VESSEL` and the pad from `PERIAPSIS_SITE`, read once
at load. So an Apollo-8 state loaded under Artemis is a coherent-looking run of the
wrong vehicle — and it was, until it was measured: `verify-staging` reported green
while exercising no staging at all. `verify-staging` therefore pins its own vessel
and uses this file, and the pair is what makes it a gate rather than a printout.

Regenerate it with:

    npm run fixture:approach:artemis

### Reproducibility

Two independent processes wrote byte-identical files (sha256 `2a081f23…`).
