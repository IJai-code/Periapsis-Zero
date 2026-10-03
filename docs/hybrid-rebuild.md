# Hybrid rebuild: playable first release

## Acceptance criteria

- One product with shareable `#flight`, `#story`, and `#expedition/moon|mars|europa` routes. Existing simulator query links must continue to work. No divergent Git forks.
- A visibly new, responsive front door with three named experiences. No tutorial or hardware prompt blocking the new front door.
- A full-screen, authored three-chapter surface campaign: brief, stakes, objectives, debrief, sequential unlocks. Completion comes from landing, collecting field samples, and returning them to the vehicle, never a completion button.
- Three distinct procedural regions: lunar impact terrain, Martian layered mesas, Europan ridged ice. Actual gravity values, a blue-black vacuum sky on airless bodies, a dusty sky on Mars. Procedural regions must be labeled; these are not reconstructed survey maps.
- A fictional reusable survey lander with inertia, gravity, mass-dependent thrust, finite propellant, manual controls, optional landing assistance, safe-touchdown criteria, crash/retry, EVA, and takeoff. Assistance applies thrust through the same integrator; it cannot teleport or set completion flags.
- Explore on foot with terrain collision, low-gravity jumps, nearby sample interactions, a compass/distance guide, and return-to-vehicle interaction. Touch controls must offer the same essential actions.
- Persist surveyed sites and campaign progress locally with a versioned, validated schema and an in-memory fallback when storage is unavailable. Do not claim a full-flight save.
- Quiet the simulator's initial instrument layout and provide a visible path back to the mode selector. Preserve the existing measured orbital model and all historical mission links.
- Bound terrain geometry and instancing, dispose scene resources on mode changes, pause hidden tabs and menu overlays, and cap catch-up so a suspended tab cannot fast-forward a landing.
- Verify simulation behavior with a new gate registered in `verify:all`; build production output; play-test modes, assistance, landing, samples, return, retry, navigation, mobile layout, and console/network errors through the browser.

## Boundaries

The expedition renderer uses local, metre-scale regional coordinates for close terrain and a fictional vehicle. It does **not** currently implement seamless orbital approach to every surface, interplanetary transfer, planetary terrain streaming, multiplayer, combat, or a GTA-scale inhabited world. The historical simulator keeps its N-body system and measured ephemerides; expedition gravity is derived from the same body data. Switching modes is a deliberate handoff, not a claim that the fictional lander exists in a historical mission.

The attached game video informs chase-camera weight and legible navigation. The SpaceEngine image informs geology and horizon scale, not impossible skies on known bodies. Neither attachment is redistributed as a game asset.

## Delivery notes

### Delivered and verified on 3 October 2026

- Production build succeeds. Full suite: **70/70 gates pass**, including the 19-check expedition gate and the 7-check `verify-pilot` gate. No dedicated typecheck/lint script exists in this JavaScript project; none is claimed.
- Actual browser play-throughs used mouse, keyboard, and touch-button pointer input. No simulation state was teleported or completion flags set in the browser tests. Development-state inspection was read-only; production play-throughs navigated with the visible range, bearing, and heading.
- All three production campaign chapters completed: assisted touchdown, EVA, both samples, return to lander, debrief. Sequential unlocks and the final 3/3 record survived reload.
- Also checked: free-play Europa landing, manual throttle input, zero-input engine-off crash and retry in the development build, takeoff, pause, dialog keyboard focus containment, 390×844 touch movement/overflow, simulator mission-library entry, an Apollo 8 launch deep link, intro skip, and Escape exit from the broadcast.
- Final production run captured **zero console/page errors and zero failed network requests**. It uncovered a pre-existing `stopScore is not defined` error in mission-intro cleanup; the dead calls were removed and the audio gate now checks for them. The historical flow was rerun after repair.
- Three terrain rings total **49,923 vertices / 94,208 triangles**, plus 1,300 instanced rocks. Construction measured approximately 117–226 ms per body on this workstation in the final terrain harness. Runtime uses 120 Hz fixed steps, a maximum 12 substeps per frame, and caps suspended-frame catch-up at 0.1 s.
- Sample local measurement: production Mars at 1440×900, headless Chrome on this workstation, 180 animation frames after warm-up: median **16.7 ms**, p95 **16.7 ms**, mean **16.58 ms**. This is a local frame-cadence observation, not a cross-device 60 fps guarantee or a measured speedup.

| Body | Assisted descent | Vertical contact | Horizontal contact | Propellant used |
| --- | ---: | ---: | ---: | ---: |
| Moon | 30.61 s | 0.700 m/s | 1.030 m/s | 107.0 kg |
| Mars | 30.34 s | 0.700 m/s | 1.058 m/s | 202.6 kg |
| Europa | 30.77 s | 0.700 m/s | 1.013 m/s | 93.4 kg |

Screenshots: [mode select](screenshots/hybrid-home.jpg), [story](screenshots/hybrid-story.jpg), [Mars](screenshots/hybrid-mars.jpg), [Europa](screenshots/hybrid-europa.jpg), [mobile EVA](screenshots/hybrid-mobile.jpg).

### Remaining limits and honest tradeoffs

- The renderer is regional, not a spherical quadtree planet. The playable radius is 700 m; landing/EVA collision follows the rendered inner lattice. Outer rings exist for the horizon, not unlimited traversal. Out-of-sector flight ends the attempt with an explicit retry message; foot travel stops at the sector edge.
- The same sample layout is used on each body, although geology, briefings, gravity, skies, and material appearance differ. There are no settlements, roaming NPCs, economy, rovers, docking in Expedition mode, or dynamic encounters yet.
- Graphics are bounded procedural meshes, not SpaceEngine-quality surveyed terrain or photogrammetry. Earth/Jupiter in the expedition sky are stylized with catalog-scale angular sizes and authored sky placement, not the historical simulator's live ephemeris.
- Character movement is an assisted game controller with terrain collision and body-specific ballistic jump gravity. It is not a full pressure-suit biomechanics model or rock-obstacle rigid-body simulation. Lander pitch/roll are rate-smoothed commanded tilts, not a six-degree-of-freedom torque integrator.
- Survey progress is local and versioned; in-progress flights are not saved. Exiting an expedition or reloading retries the approach. Switching back to Simulator retains its in-memory flight state but rebuilds its renderer/texture baseline; historical mission query links remain page-load choices.
- Existing large JavaScript bundle warnings remain: the shared production entry is approximately 320 kB gzip and the lazy historical chunk approximately 307 kB gzip. No new runtime dependency or remote service was added.
- Desktop Chromium and a narrow viewport were tested. Actual iOS/Android hardware, Safari, and gamepads were not tested. The shared preview webview could not produce screenshots; independent local Chrome screenshots were used for visual inspection.
- The supplied video and image were inspected as references and are not redistributed. The work is local, uncommitted, and not deployed.

### Next major milestones

1. Streamed spherical terrain and a rigorous orbital-to-surface handoff for the fictional survey craft.
2. A surface mobility loop: rover, deployable science instruments, persistent field camps, and distinct destinations rather than repeated paired samples.
3. Deeper authored campaign with branching crew decisions and instrument-driven evidence, plus hand-authored environment/vehicle art rather than additional generic panels.
4. Device profiling, configurable quality, full-flight checkpoint saves, accessibility/touch hardware checks, and production browser smoke tests in CI.
