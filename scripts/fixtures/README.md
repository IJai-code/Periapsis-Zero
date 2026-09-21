# Flight fixtures

One checked-in state, so the gates that need a mission already in progress can
run with no arguments and no manual step before them.

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
