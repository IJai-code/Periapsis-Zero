# Periapsis Zero: 3091 product review

Review: 7 October 2026 local time. This is a verified first product slice, not a claim that a GTA-sized world or EVE-quality renderer has been finished.

## Acceptance criteria for this slice

- The game setting, opening captions, generated narration, and career clock say **3091**. Historical simulator scenarios retain their own dates and science.
- Teach one skill per flight-clearance check. A player can read the action, key, reason, and completion condition without relying on a disappearing comms line.
- Training targets are volumes, not precise invisible points: display their range and radius, guide off-screen turns, advise braking, and visibly announce arrival once.
- Preserve existing saves, routes, legacy historical query links, and both story branches. Migrate old tutorial step indices exactly once.
- Let a cleared pilot choose story work, a paid job, or flight school. Save before changing mode and return to the same career. Use existing simulator licence records, not a competing progression store.
- Repair confirmed surface steering/render-heading and help-dialog bugs. Keep gravity, force limits, collision, and all thirteen surface missions tested.
- Do not add art downloads, dependencies, external services, or heavier rendering effects. Measure before claiming performance improvements.
- Save reproducible checks and an honest assessment. Leave unrelated Blender changes untouched; no commit, push, or deployment in this slice.

## What changed

### A understandable first session

The opening now introduces a millennium of settlement: humans live on Earth, the Moon, and in orbital cities; medicine extends lives, but recycled air, lunar water, and passage still have costs. This is original fiction, not a scientific forecast. The convoy attack, recorder, Rook debt, Mara, and Chen remain the playable campaign's through-line. The narration was regenerated from the caption source so it no longer says 2091.

Flight clearance is ten sequential checks: launch, thrust, braking, first waypoint, short boost, second waypoint, momentum/assist, selecting a harmless drone, firing, and docking. The HUD has a named lesson, 21 px primary desktop instruction, 19 px keycaps, explanation, and navigation status. Tutorial waypoint radii increased from 70/90 m to 250/350 m and use the same values for display and completion. There is no invisible dwell requirement. The docking instruction accurately states the existing 350 m / below-70 m/s rule.

After clearance, Contacts offers three explicit next moves. The story is optional; paid courier, salvage, bounty, race, trade, and survey systems already existed, rather than being invented for this review. Flight school now saves the career and opens the simulator in the same tab, with a Career return button. Simulator licences, bonuses, and suit unlocks remain the existing shared progression bridge. This is a coherent mode connection, **not** a merged physics engine or seamless orbit-to-ground transition.

### Confirmed repairs

- The visible New Game button could be blocked by the timed boot splash. The title now dismisses the splash when React has painted the front door.
- Surface help reopened after time had advanced could pause the scene behind a non-dismissible strip. It always opens a real dismissible dialog now.
- Focusing the surface dialog's Start button scrolled past its first instruction. Focus preserves scroll position now.
- Removed unreachable A/D steering branches and repeated surface CSS; scoped surface keycap styles so they do not leak into other modes.
- Rover positive heading means toward +X, but a model facing -Z rotated by positive Three.js yaw points toward -X. The renderer now uses negative heading and the correct terrain-pitch sign. D turns right, A left.
- Added bounded lateral wheel traction, `mu * gravity * dt`, instead of letting residual velocity ignore the wheels. Low gravity still has less grip; the velocity is not instantly rotated into the nose. This remains a simplified six-wheel skid-steer model, not full suspension/tire simulation.
- Arrow-key steering now works even after pointer-capture fails and drag steering is enabled.
- Map and Jobs overlays stop physics rather than letting the ship drift or fight behind the menu. Paused/hidden gameplay stops recurring 3D rendering. A demand-rendering attempt still drew because a frequently rerendered Canvas invalidated itself; the verified fix uses `never` while stopped and `always` on resume.
- Replaced a per-frame ship-membership Set with generation stamps. This removes that allocation; it does not make every game frame allocation-free.
- Moved the steering hint away from completion toasts. Corrected the story completion denominator to twelve missions on the chosen branch, not thirteen mutually exclusive missions.

## Graphics research: what is transferable, and what is not

### SpaceEngine

Primary source: [Terrain 2.0, developer article (2019)](https://spaceengine.org/news/blog190328/); [user manual](https://spaceengine.org/manual/user-manual).

The developer describes fixed pools of texture arrays, semi-static RAM pools, shader displacement from heightmaps, and a trade between terrain-generation speed and frame rate. Their reported RTX 2080/4K example falls from at least 60 fps at one loading setting to 18 fps at a faster one. They explicitly discuss cache exhaustion, several GB of video memory, and weak-hardware limitations. “100% stability” and “tenfold loading” are the author's historical claims, not promises adopted here.

**Cut:** reuse/pool resources, bound background generation per frame, select terrain detail by projected pixels, and stream only a measured working set. **Not yet:** allocating gigabytes of arrays at browser startup or building spherical terrain before the current 700 m regional surface loop is engaging. Existing terrain rings and instanced rocks are a good starting point, not a whole-planet streamer.

### Orbiter

Primary source: [official source repository](https://github.com/orbitersim/orbiter). Supporting older documentation: [D3D9Client setup](https://www.orbiterwiki.org/wiki/D3D9Client_Project).

Orbiter separates a Newtonian simulation from its graphics client; the source repository identifies the native Direct3D 9 client and separately installed planetary textures, with 5–10 GB normal storage and about 80 GB for high-resolution textures. The older client guide recommends loading surface textures on demand. This review did not successfully inspect the tile-manager source, so it does not present a specific quadtree algorithm or performance number as verified Orbiter internals.

**Cut:** keep pure testable physics separate from rendering, load imagery on demand, and expose accuracy as training rather than requiring expert orbital flight before the player understands the game. **Reject:** shipping desktop-scale planetary archives to first paint or claiming a native DirectX client can be dropped into Three.js.

### Kerbal Space Program

Primary sources: [Squad's Unite 2013 presentation](https://www.youtube.com/watch?v=mXTxQko-JH0) and [KSP2 Developer Insights #18, archived official Steam announcement (2023)](https://store.steampowered.com/news/posts/?feed=steam_community_announcements&appids=954850&enddate=1678493635).

The presentation is available, but this review could not extract its transcript, so it is not used as evidence of uninspected implementation details. The written developer article states that KSP2's PQS+ derives from KSP1's terrain system, swaps expensive local shaders for efficient scaled shaders at distance, and profiles GPU calls with RenderDoc. It reports terrain taking 29.94 ms in one scene and explains how texture anti-tiling costs bandwidth. It proposes a concurrent-binary-tree terrain replacement and HDRP; those are proposals in that article, not evidence that those plans shipped or guarantee performance.

**Cut:** measure milliseconds, attribute cost to passes, separate nearby physical/rendering detail from far representations, and gate each visual feature. **Reject:** assuming Unity or a terrain-system rewrite inherently fixes frame rate. KSP2's article is a warning about adding features past the architecture's budget.

### EVE Online

Primary announcements: [More FPS for less CPU (March 2025)](https://www.eveonline.com/news/view/eve-evolved-more-fps-for-less-cpu), [GPU-driven rendering launch](https://www.eveonline.com/news/view/more-fps-for-you-new-rendering-tech-now-live), [upscaling and ray-traced shadows](https://www.eveonline.com/news/view/upscaling-and-ray-traced-shadows-now-live), [controller optimization](https://www.eveonline.com/news/view/graphical-controller-optimization-mass-test).

The official titles/descriptions/search excerpts identify CPU-bound rendering, a GPU-driven pipeline for DirectX 12 and macOS, lower-resolution upscaling, and removal of unnecessary background calculations. Readable-page extraction returned unrelated navigation text for two posts, so this report does **not** pretend to have reviewed their full technical implementation. Community explanations of instancing are not treated as authoritative engine documentation.

**Cut:** profile repeated draw submission; instance repeated rocks/props; stop unseen and paused work; spend visual budget on the visible hero ship. **Not yet:** WebGPU/compute rewrite, ray tracing, or claiming DLSS/FSR-class temporal reconstruction from a reduced pixel ratio. The browser stack and native EVE renderer have different capabilities.

### The six supplied screenshots

Useful art direction: readable industrial silhouettes, hull material separation, a restrained engine core, planetary rims, foreground/midground/background depth, and strong composition. Spectacle should have a clear focal point. They are references, not reusable licensed assets or real-time performance evidence. A screenshot cannot establish input responsiveness, frame pacing, or its scene's rendering cost.

**Cut now:** preserve existing authored craft and bay, keep HUD away from the focal point, improve navigation readability, and eliminate waste before more effects. **Next measured art slice:** hero-hull material/readability and station silhouette at the player's actual flight camera. **Reject now:** gigantic volumetric nebulae, dense fleet battles, seamless inhabited planets, and cinematic effects that hide the target or exceed measured budgets.

## Measurements and evidence

Baseline: [3091-frame-baseline.json](3091-frame-baseline.json). Post-change: [browser results](3091-checks/results.json). Same headless Chrome/ANGLE Metal, High graphics, 1280 × 713 CSS viewport on this Mac. Roughly 480 samples per eight-second scene window. These are vsync-limited CPU/browser-frame measurements, **not GPU-pass timings, thermal-duration tests, or a visible M4 guarantee**.

| Scene | Baseline p50 / p95 / p99 | Post-change p50 / p95 / p99 |
| --- | --- | --- |
| Hearth bay | 16.7 / 16.7 / 16.8 ms | 16.7 / 16.8 / 16.8 ms |
| Local flight | 16.7 / 16.8 / 16.8 ms | about 16.7 / 16.7 / 16.8 ms |

No flight-speedup claim: vsync masks available headroom. The verified resource saving is idle rendering: while the map is open, game time and the renderer's render counter remain unchanged over two seconds, whereas the initial demand-mode attempt continued rendering. Removing the Set is an allocation reduction, not a demonstrated FPS gain. No heavier assets or postprocess effects were added.

The desktop Preview pane stopped compositing during checks and subsequently closed. Its text accessibility tree was inspected, but screenshot/frame evidence comes from the repository's Chrome harness. A visible-tab reference-hardware measurement, sustained combat, software-WebGL gameplay, and touch-device testing are still owed.

## Playthrough: what actually ran

- `verify:all`: all 78 registered gates, including science/physics, save behaviour, both campaign branches, new migration/arrival/traction checks, art budgets, and lint. An earlier full run passed 78/78. A later concurrent run passed 77/78: the existing horizon-projection timing ratio was 5.00 versus its limit of 4 while builds/browser jobs competed for the machine. Three isolated unchanged reruns measured 3.13, 3.11, and 3.11 and passed; the final isolated full suite passed **78/78**. No assertion or simulator code was changed to hide the failure.
- `verify:game`: a seeded pilot plays twelve missions through both Chen and Rook branches. Last direct run: Chen 62.8 game hours / 21 transfers / 29 kills / one retry; Rook 60.5 hours / 23 transfers / 30 kills / one retry. The surface handoff bot now runs an actual complete Moon survey instead of supplying a fabricated successful result.
- `verify:expeditions`: all thirteen full surveys, with gravity/thrust/drag, walking, collision, scanner, return, and scoring checks. All pass after the steering and traction changes.
- `check-game-controls`: real browser input for pause/skip, boarding, launch, pointer fallback, W/release braking, advanced latched throttle, and settings. No browser errors.
- `check-product-3091`: real Launch/W/X and arrow input; exact arrival boundary staging and visible confirmation; HUD type sizes; stopped map; story/job/school choice panel; career save/return; assisted Moon landing; actual A/D/W rover input; help reopen/dismiss and top-of-dialog scroll. [Screenshots/results](3091-checks/results.json).
- `check-campaign-browser`: both complete branches run the same scripted scenarios through Vite, yielding at each mission to present state through the mounted React UI/Three.js renderer. [Mission-by-mission results](3091-checks/campaign-results.json). The final browser run completed Chen in 62.9 game hours with four retries and Rook in 69.7 hours with two retries. Both cleared the debt and completed twelve missions. The difference from Node's one retry on each branch shows why random mission difficulty must be assessed separately from mere reachability. The mounted scene's physics loop is disabled during scripted commands so it cannot add extra steps between checkpoints. Checkpoint state is deliberately staged; this is **not** a manual end-to-end keyboard playthrough, nor proof a novice can win the combat/race. It catches rendering/UI exceptions and shows the campaign can reach both endings.
- Final production build passed (5.96 s), with existing >500 kB chunk warnings. Final eight-route Chrome smoke passed with no errors. This JavaScript/JSX project has no configured typecheck; ESLint and the numerical/browser gates provide the available checks.

## Brutal reality check

**There is now a clearer playable product loop, but this is still a small space-career game, not GTA in space.**

1. **Biggest remaining gap: ordinary life.** Stations are service menus and a scripted boarding sequence, not walkable communities. No housing, social routines, persistent city population, or meaningful non-pilot life. Build one small station district with a reason to return before promising a living civilization.
2. **Freedom is broader than the feedback.** Jobs, markets, upgrades and heat already work, but there is no strong ongoing “here are three opportunities near you” director. The new post-training panel is a start; use player state to recommend concrete profitable choices next.
3. **Navigation is repaired first in training, not everywhere.** Later precision recorder/tagging/dead-drop steps still have their own radii, speeds, or dwell rules. Expose a shared navigation contract for every interaction before advertising universal clear arrival feedback. Consider an opt-in approach assistant using finite thruster commands, not position teleporting.
4. **Teaching combat still needs novice observation.** Selecting a moving contact, leading shots, controlling range, and reading incoming damage remain cognitively expensive. The harmless drone helps, but a competent bot is not a new human. Add a retryable practice space and observe completion without coaching.
5. **The simulator and career are connected, not physically identical.** The historical sim is N-body; the game's torch transfers use simplified fixed anchors and analytic brachistochrones. 3091 is a story calendar, not a verified ephemeris forecast. The training framing makes the difference explicit; wholesale merging would risk existing scientific behaviour.
6. **Surface scale is regional.** A ~700 m playable radius, not a planet; the Moon survey is shared by the career and simulator. More worlds do not solve repetitive activities. Give one region meaningful mission variation before adding landmass.
7. **3091 lore is still thin.** The introduction now explains settlement and life support, but politics, livelihoods, technology limits, and how a millennium changes everyday life need a coherent short world bible reflected in missions. Changing a date alone is not enough.
8. **Visual coherence is ahead of visual spectacle.** Existing hull/bay art is useful but the front-page key art and flight silhouettes are much simpler than the EVE references. No new EVE-like assets were made in this slice. A measured hero-readability art pass beats unbounded detail and expensive full-screen glow.
9. **Performance coverage is narrow.** No universal “flawless/no lag” claim. Build emits existing large-chunk warnings. Cold loads, shader compilation, long sessions, combat load, low-end GPUs, touch layouts, and context recovery need tracked budgets and representative browser measurements.
10. **Persistence means return to the last station.** Going to flight school saves mission/economy state, not the exact in-flight location. This existing safehouse rule is still in force; communicate it more prominently before players use school midflight.
11. **Shared sky depends on configuration.** Landing-page multiplayer language still needs a configuration-aware pass; local offline builds do not establish networked reliability.
12. **Full manual play remains unfinished.** Both branches were scripted through the browser and key interactions were exercised. A candid report cannot turn that into a human-quality, beginning-to-end review. That is the next usability gate, not a box ticked by passing Node tests.

## Next slices, in order

1. Generalize approach/arrival/interact feedback to every mission and job; add novice end-to-end browser acceptance scenarios and reachable-target recovery.
2. One persistent station hub with a few meaningful jobs, a livelihood choice, and consequences. Integrate shared career progression, not multiple disconnected campaign menus.
3. EVE-inspired hero/station readability within a measured draw/pixel/texture budget, with a visible reference-device before/after capture.
4. Only then evaluate streamed spherical terrain, a broader solar-system career, and more ambitious multiplayer. Those must earn their cost with gameplay.

## Second pass, 7 October: every route at five sizes

The first review could only claim what the gates it wrote happened to cover. This
pass drove the site itself. `verify:devices` visits the title, the career, the
squadron lobby, the simulator and a landing at 1600x900, 1280x800, 820x1180,
390x844 and 360x740, opens the simulator's map, settings drawer and mission
library on touch sizes, and screenshots all of it into `docs/device-sweep` —
31 combinations, each checked for uncaught errors, horizontal overflow and
sub-36 px touch targets. What it found was real and is fixed:

- **A landing waited for the solar system.** `#land/moon` was gated behind the
  simulator's imagery even though `Scene` does not draw during a surface
  expedition. Time to a surface that answers the keyboard went from 3684 ms to
  430 ms at 1280x800 and from 3106 ms to 656 ms at 390x844 (dev server, headless
  Chrome, measured both ways by `measure:load`). The phone is the device the
  title sends to a landing, so this was the worst case for the smallest screen.
- **The keyart could not be cropped to a portrait window.** At 820x1180 `cover`
  magnified the 16:9 art until the ship was a white wedge across the headline
  (the window showed 39% of the frame). On portrait it is now a band at its own
  scale that scrolls away with the hero.
- **Glass was the second-class pointer.** Nav rows were 20 px tall on the title
  and 27-32 px in the simulator; job, flight and preset rows were 27-28 px;
  the mission drawer's filters 29 px; the search field's clear button 28 px.
  The floor is now set once, in the `control` utility under `pointer: coarse`,
  rather than chased button by button, and the title bar, the squadron link, the
  per-row buttons and the model selector were raised individually.
- **The loading screen was unformatted.** "Preparing the solar system." ran to
  the very edge of a 360 px window. It is padded, centred, clamped and announced
  (`role="status"`), and the mode fallback is no longer default-body type.
- **A 390 px phone spent half its navigation on the wordmark** the visitor had
  just read. The wordmark drops below 640 px, the row keeps 40 more pixels of
  doors, and its last visible item fades rather than being cut.

Two of the first run's "problems" were the checker's fault, not the site's, and
saying so matters more than the count: `innerText` carries `text-transform`, so
"HOLD THE SKY" never matched "Hold the sky"; and the simulator parks off-screen
markers inside clipping parents, which are neither visible nor a layout fault.
The probe now matches without case, counts only unclipped escapees, measures a
field by the label that focuses it, and exempts inline links in a sentence under
WCAG 2.5.8. It ends green: no overflow, no undersized target, no console error.

### What is still not top notch

1. **No manual, human playthrough.** Both branches render end to end under the
   scripted browser, and the tutorial, arrival, career round trip and rover are
   driven through real input. A novice with a keyboard is still untested, and no
   automated check can tell you whether the game is *fun*.
2. **No visible-device performance certification.** The 16.7 ms samples are
   headless Chrome with ANGLE Metal, and vsync masks headroom. A phone, a low-end
   laptop and software WebGL remain unmeasured end to end.
3. **The simulator still waits.** About 3.3 s on the dev server to a usable
   simulator, and the cold, built, throttled number is worse. `verify-assets`
   bounds the imagery (3.96 MB to first flight) but not this.
4. **The phones' navigation is still a scrolling strip.** It fits four doors plus
   a fade now, not ten. A real small-screen navigation is a design job, not a
   class change.
5. **Landings still load the simulator chunk.** The wait is gone, but the
   download is not: `#land/*` pulls the whole simulator, including the solar
   system it does not use.
6. **The bundle is large.** The build still warns about chunks over 500 kB. The
   prefetch added on the title page shortens the wait by moving it earlier; it
   does not reduce what has to arrive.
7. **The device sweep is not in CI.** It takes minutes and needs a server, so it
   is a script to run, not a gate that can fail a build. A regression in a touch
   target will not stop a deploy until someone runs it.
8. **Everything the first pass listed about life, freedom, combat teaching,
   surface scale and lore still stands.** None of it was addressed here.

### What this pass changed, honestly

Four files in the simulator's chrome, one lookup in the page's asset gate, one
idle prefetch, one hero composition and a checker. No new art, no new dependency,
no new service, and no claim that any device is now guaranteed smooth. The
measurable wins are a landing that arrives in under a second instead of three and
a half, and a touch interface that meets the floor the project set for itself.
