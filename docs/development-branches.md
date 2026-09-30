# Local development versions

These branches are local only. Nothing was pushed or deployed; `main` remains
at the starting commit `2f12e32`. `.freebuff/` is user/client state and excluded.

| Branch | Purpose | Includes |
| --- | --- | --- |
| `dev/performance` | Safe rendering and capture baseline | Pixel budgets, recorder/shelf lifecycle, visibility suspension, diagnostics, audit and regression tests |
| `dev/celestial-detail` | Celestial exploration workstream | Performance baseline + screen-space globe meshes, lunar/icy-world detail and Observatory cards |
| `dev/missions` | Mission archive workstream | Performance baseline + six chapters, dossiers, real-preset validation and intro path clearance |
| `dev/integrated` | Combined version; current checkout | Both feature branches and integration fixes |

The detail and mission branches are siblings built on the same performance
baseline, so they can be developed independently without undoing safety fixes.
Use a separate worktree if running more than one version simultaneously; do not
switch the shared checkout while another person or agent is editing it.

## Validation

Run `npm run build` and `npm run verify:all`. No separate typecheck/lint command
is configured. The suite includes positive-control allocation checks, 15 actual
preset flights and 75 cinematic geometry checks. Browser visual/GPU validation
must still happen on an active visible tab, including affected user devices;
Node tests cannot certify smooth rendering, film playback or driver stability.

See [the performance audit](performance-audit.md) for measured bounds, identified
bottlenecks, and outstanding device testing. Increased surface relief is clearly
labelled synthetic rather than represented as additional measured lunar data.
