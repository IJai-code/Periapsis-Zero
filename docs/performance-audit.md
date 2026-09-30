# Simulator performance audit — 29 September 2026

Baseline: `2f12e32` on main. The tracked checkout was clean; `.freebuff/` was
untracked and excluded from all commits. Reviewed history since the intro/film
changes (`9602959`): 107 changed files, including the later removal of audio,
procedural planets, galaxy/nebula/black-hole rendering, vegetation LOD,
resolution governor, terrain hiding, deferred imagery, photographs and links.
No audio restoration or physics simplification is part of this work.

## Findings and fixes

| Path | Finding | Treatment |
| --- | --- | --- |
| Intro recording | Automatic extra canvas copy/encoding every display frame; width-only cap let portrait exceed 720p area; streams leaked | Explicit checkbox; ≤921,600 pixels, ≤1280 long edge, ≤24 capture requests/s; VP8 preferred; track/canvas cleanup and 24 MiB chunk ceiling |
| Drawing-buffer capture | Independent rAF did not prove buffer availability | R3F after-effect reads within the completed render task |
| Film shelf | Every saved video autoplayed; invalid nested interactive elements | No preload/autoplay; hover preview; independent mission/download controls; URLs revoked |
| IndexedDB | Request success is not transaction durability | Resolve only after transaction complete; reject abort/error |
| Resolution | >250 ms frames excluded before emergency response; large panels unbounded | Start ≤1×; 4 MP safety ceiling; long-frame panic; adapt density, not scene content |
| Photograph | Permanent priority-2 subscriber could suppress default rendering without composer; 4K portrait/ultrawide transient buffers | After-effect capture; 8.29 MP and driver bounds |
| Background | Heavy scene continuously rendered when not being viewed | Visibility-based render suspension; clocks resume without a giant intro step |
| Sky | Large progressive work slices could monopolize GPU | Smaller cube tiles, ≤65,536 pixels per final-volume strip; moving volume target ≤400k pixels; unchanged final cube/volume detail |
| Atmosphere | Transparent double-sided shell risked duplicate complete-column integration | Single geometry pass; back face discarded outside shell |
| Trails | Hidden trails seeded by backwards integration; unchanged buffers uploaded every frame | Lazy seeding when shown; upload only when a sample changes |
| Resource lifetime | Missing disposal for external Earth/Moon materials and lunar/procedural textures | Explicit owned-resource disposal |
| Diagnostics | Opened another GL context just to query GPU; median concealed stutters | Reuse scene context; include p95 frame latency and drawing dimensions |

## Quantified bounds (not device benchmarks)

- Previous portrait example: 880 × 1650 = 1,452,000 pixels. New size:
  682 × 1280 = 872,960 pixels, keeping orientation/aspect within rounding.
- A 3840 × 2160 desktop at DPR 2 requested 33,177,600 screen pixels;
  normal rendering now never exceeds 4,000,000 (~88% fewer in that case).
- The desktop sky tile changes from 128² to 64² pixels: one quarter of the
  raymarch pixels per refinement slice, with the same final 1024² cube faces.
- Existing physical gates include actual projection timings and allocation
  controls; these are CPU solver tests, not GPU render benchmarks.

## Verification and limitations

`npm run build` and all 58 gates passed after the performance changes. The
combined celestial-detail/mission version passes 60/60 gates, including 15 real
preset starts and 75 intro geometry checks. The actual-state gate caught a
Kennedy intro dipping inside Earth; a radial envelope now keeps the approach
outside its host while preserving the exact resting endpoint. There
is no configured TypeScript/lint check in this JS/JSX project. The new recorder
gate uses API doubles to assert pacing, bounds, stop, fallback, start failure,
encoder failure and size-limit cleanup. It does **not** prove a real browser
encoder's playback quality or WebM seeking. Existing intro gates sample geometry
and origin invariance, not perceptual film quality or real GPU cost.

The owned preview server runs on loopback port 5173. The shared Preview reported
`document.visibilityState === 'hidden'`, no animation frames, a 300×150
uninitialized Canvas, and screenshot capture returned an empty image. No rAF
shim was used to manufacture FPS evidence. DOM checks did confirm the final-
docking curtain, unchecked recording control, and direct hand-off into the
broadcast UI without console errors. Consequently no before/after GPU
FPS, heap-growth soak or all-device crash reproduction is claimed. The reported
computer crashes are not diagnosed as an OS/driver fault from source review.

Remaining risk: uncompressed texture/model GPU footprint, shader compilation,
full-resolution atmosphere/planet fragment work, hardware acceleration settings,
thermal throttling and driver-specific context loss. WebM unknown duration is
still browser-dependent. Benchmark the production build on affected devices at
Kennedy, lunar ground, Saturn/Europa, a nebula and Sagittarius A*, with recording
both off and on; include p50/p95/p99 frame time and a long session memory trace.
