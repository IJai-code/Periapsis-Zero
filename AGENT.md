# AGENT.md

Working notes for anyone, human or agent, who changes Periapsis Zero. It says
what the codebase is today, the rules that keep it honest, and the engineering
plan for raising the web product with Blender-authored art.

Last reviewed: 3 October 2026, at `4320475` on `main`.

---

## 1. What the product is now

Periapsis Zero started as a true-scale solar-system simulator. It is now a
sim/game hybrid with one front door and three experiences:

| Route | Experience | What it is |
| --- | --- | --- |
| `/` | Front door | `src/ui/Landing.jsx` over a live Mars backdrop (`ScenicBackdrop.jsx`). Picks an experience. |
| `#expedition/moon\|mars\|europa` | Expeditions | Fly a fictional survey lander down, walk, drive a rover, deploy three instruments, collect two samples, return, take off. |
| `#expedition/<id>/campaign`, `#story` | The ground truth | Three authored chapters (Moon, Mars, Europa). A chapter unlocks only when the previous survey is actually delivered. |
| `#flight` | Simulator | The original N-body simulator: Apollo 8, Apollo 11, Artemis presets, mission library, planner, contracts, story chapters, Almanac, walk mode. |

Old simulator deep links (`?preset=…&vessel=…&site=…#flight`) still work and
must keep working.

### What changed between 26 September and 3 October

Read the commit bodies for detail; this is the shape of it.

- **Game layer on the simulator.** Planner with routes priced by the rocket
  equation (`sim/programs.js`), pilot "wings", contracts, a six-chapter story,
  the Almanac (missions generated from the live sky, `sim/almanac.js`), a
  logbook and personal bests (`sim/logbook.js`), an optional pilot name
  (`sim/pilot.js`, local only, gate forbids network calls).
- **Expeditions and the campaign.** `sim/expedition.js` (lander, EVA, rover,
  instruments, 120 Hz fixed step), `gfx/expeditionTerrain.js` (three
  procedural terrain rings), `components/ExpeditionScene.jsx`,
  `ui/Expedition.jsx`, `ui/StoryCampaign.jsx`.
- **Accuracy.** The sim boots at the real date (`createSimulation(NOW_T)`), the
  Moon uses a truncated Meeus ch. 47 theory, masses are GM/G. Sun within
  0.003 deg of the almanac, Moon within 0.03 deg (`verify-clock`).
- **Identity.** Four colours only: void `#120b22`, bone `#f4e8cf`, ember
  `#ff6b2c`, ion `#2fd3ff`. Rubik Dirt display, Bricolage Grotesque prose,
  Space Mono figures. No em dashes in interface text.
- **Interface.** Top menu bar of destinations (`ui/Nav.jsx`), a camera hotbar
  for the number keys (`ui/Hotbar.jsx`), setup panels behind one drawer
  (`ui/Setup.jsx`, key `S`), quieter default cockpit.
- **Cameras.** Pad crane drift, flyover-then-final arrivals, short clicks glide
  instead of zooming out (`gfx/shotPoses.js`, `gfx/zoomPath.js`).
- **Robustness.** Context-loss recovery that spends the governor's levers;
  governor needs two windows of evidence before moving (`components/Resolution.jsx`).
- **Audio.** The generated score is gone at the owner's word. The only audio is
  the owner's ambient bed (`sfx/ambience.js`, `public/audio/monume-space-ambient.mp3`),
  started only by a click. `verify-audio` holds both facts.
- **Bundles.** Entry is 51 kB plus React; three.js, drei and postprocessing
  load behind dynamic imports (`vite.config.js` `manualChunks`).
- **Assets.** 56 NASA public-domain meshes in the curated catalogue.

### Review findings worth acting on

Found while reviewing for this document. None is urgent; all are cheap.

1. **Two walking models disagreed.** *Fixed in Phase 0.* The expedition EVA
   used a fixed 2.8 m/s walk, 5.2 m/s run and 2.5 m/s jump on every world
   while `sim/walk.js` derived the Moon's gait limit as 1.21 m/s. The EVA now
   steps `sim/walk.js`; `verify-expeditions` holds every world to sqrt(gL).
2. **Stale deploy variable.** *Fixed in Phase 0.* `PERIAPSIS_BASE` is gone
   from the workflow; `vite.config.js` sets `base: '/'` itself.
3. **Expedition art is primitives.** `SurveyLander` and `SurfaceRover` in
   `ExpeditionScene.jsx` are boxes, cylinders and spheres. These are the first
   Blender targets (section 4.6).
4. **Expedition terrain is regional and flat-mapped.** 700 m playable radius on
   a 12 m lattice; outer rings are horizon only. Fine for now; it is the main
   blocker for any orbit-to-surface handoff.
5. **Large lazy chunk.** The simulator chunk (`App-*.js`) is about 750 kB raw.
   The entry is lean; the simulator is not yet split further.

---

## 2. Repository map

```
index.html            Page shell, OG/Twitter card, boot splash (owned by make-favicon)
vite.config.js        Build: chunking, model pruning, Draco copy, dev build stamp
src/main.jsx          Mounts ExperienceApp
src/ExperienceApp.jsx Router: hash -> home | story | expedition | simulator (lazy)
src/App.jsx           The simulator app (canvas, HUD, presets, intro)
src/index.css         Tailwind v4 tokens, the four colours, @utility control/lit/readout
src/ui/experiences.css Front door, expedition and campaign styles (same four colours)

src/sim/      Physics and game state. No React, no three.js rendering. Testable in Node.
  constants.js system.js rk4.js       Bodies, GM values, state vector, integrator
  live.js                             Per-frame shared state, floating origin, nearest surface
  rails.js lunar.js moonFrame.js      Planets on rails, Meeus Moon, lunar body frame
  ship.js vessels.js mission.js       Vehicle model, stage tables, phase sequencer
  director.js warp.js fastForward.js  Camera direction, time warp, preset fast-forward
  predict.js nodes.js targeting.js    Trajectory projection, manoeuvre nodes, targeting
  atmosphere.js decay.js prem.js      Atmosphere, drag, Earth interior
  halo.js cr3bp.js lagrange.js        Gateway NRHO, three-body, Lagrange points
  presets.js launchsite.js            Historical presets, pads (Earth and Moon)
  programs.js almanac.js story.js     Game layer: routes, contracts, story, generated missions
  expedition.js experiences.js        Expedition sim, routes, campaign record
  walk.js                             On-foot physics from four human measurements
  logbook.js pilot.js                 Local persistence (versioned, validated on read)
  store.js                            UI store (useSyncExternalStore)

src/gfx/      Rendering helpers: materials, shaders, budgets, camera math. Allocation-free on the frame path.
  renderBudget.js detailBudget.js groundBudget.js frameStats.js   Governor levers and measurement
  sphereDetail.js planetMaterial.js atmosphereShader.js           Planets
  galaxyModel.js nebulae.js blackHole.js cosmicView.js glsl/      Deep sky (ray-marched volumes)
  plume.js plumeShader.js plasma.js padParticles.js               Exhaust, entry plasma, pad
  groundView.js shotPoses.js introFlights.js zoomPath.js          Cameras
  expeditionTerrain.js moonTerrain.js flora.js siteSurround.js    Terrain and vegetation
  models.js modelsManifest.js                                     GLB catalogue (generated)
  filmRecorder.js plateShelf.js photoCaption.js                   Films and photographs
  brand.js                                                        Generated by make-favicon

src/components/  React Three Fiber scene graph (Scene.jsx, CameraRig.jsx, Driver.jsx, …)
src/ui/          DOM interface (Hud, Nav, Hotbar, Landing, Expedition, Planner, …)
src/sfx/         ambience.js only

public/models    1.1 GB NASA archives, gitignored; 56 GLB/GLTF referenced, pruned at build
public/textures  NASA imagery; public/terrain, public/stars: real data sets
scripts/         70 verification gates (verify-all.mjs), fetch/scan tools, flight harness
docs/            hybrid-rebuild.md, performance-audit.md, development-branches.md
```

### Data flow in one frame (simulator)

`Driver.jsx` (priority -3) advances the integrator, runs the sequencer and the
director, rebases the floating origin, and computes the nearest surface. The
rig (`CameraRig.jsx`) places the camera. Components read `live` and write
uniforms. `Effects.jsx` composes. `Resolution.jsx` measures the frame and moves
pixel ratio, tessellation cap and shadow size. UI reads `live` on one shared
clock (`ui/uiClock.js`), not per frame.

### Expedition frame

`ExpeditionScene.jsx` steps `stepExpedition` at a fixed 120 Hz (max 12 substeps,
0.1 s catch-up cap) and renders local metre-scale coordinates. Gravity comes
from the same body catalogue the orbital model uses.

---

## 3. Rules that hold in this repo

These are not preferences. Every one exists because breaking it once cost
something.

**Physics**
- Derive from physics and published figures. Do not fit constants to make
  something look right. When a number is a drawing decision, name it as one in
  a comment (see `DRAWN_HALF_ANGLE_CAP` in `gfx/plume.js`).
- Verify numerically. A claim in a commit or comment is backed by a gate or a
  measurement, and the measurement says where it was taken.
- One metre is one scene unit. True scale is the product.

**Performance**
- The render loop allocates nothing. `verify-allocation` and several gates
  measure it. No `.clone()`, no object literals, no closures in `useFrame`.
- Do not cut detail to fix lag. Find the waste: pixels nobody resolves,
  geometry nobody sees, work repeated per frame. The governor's levers are
  pixel ratio, then tessellation, then shadow size, refunded only out of comfort.
- Budgets live in `gfx/renderBudget.js` and `gfx/frameStats.js`; thresholds are
  shared, not restated.

**Gates**
- `npm run verify:all` runs 70 gates and must pass before a commit. CI runs it
  before every deploy.
- New behaviour gets a gate registered in `scripts/verify-all.mjs`. A gate that
  can only pass is not a gate: include a positive control where it matters.

**Interface**
- Four colours only, through the tokens in `index.css`. No raw hex in components.
- No em dashes in interface text.
- Controls use the `control` utility; minimum 36 px touch targets.

**Data and privacy**
- Persistence is local (`localStorage`, IndexedDB), versioned, validated on read,
  with an in-memory fallback. No accounts, no server, no analytics.
- `sim/pilot.js` must never make a network call (`verify-pilot` reads the source).

**Assets**
- Only public-domain or owner-supplied assets. Do not download third-party
  files without the owner's explicit permission. Procedural is the default.
- Procedural terrain and synthetic detail are labelled as such in the UI.

**Git**
- Commit only when asked. Stage files explicitly; never `git add -A`.
- `.freebuff/` and `.git-commit-msg.tmp` are not project files. Never commit them.
- Commit messages end with the attribution line in use for the agent.
- Pushing to `main` deploys to periapsiszero.dev. Do not push without the
  owner's go-ahead.

### Commands

```bash
npm run dev            # Vite on :5173 (predev clears the stale dep cache)
npm run build          # Production build into dist/
npm run verify:all     # All 70 gates
npm run icons          # Regenerate favicon set, mark.svg, brand.js, boot splash
npm run models:scan    # Regenerate gfx/modelsManifest.js from public/models
```

The browser pane in the desktop app stops compositing when hidden (`document.hidden`
becomes true and rAF stops). For visual checks, drive headless Chrome over CDP
with `--use-angle=metal`; it reports the real GPU. Timings from headless runs
are not representative of user hardware.

---


## 4. The roadmap: web and Blender

The product stays a web product. Everything ships through the browser, to
anyone with a link, on the three.js renderer that already exists. Blender is
the art tool that raises what that renderer draws.

### 4.1 Goals

**G1. Scripted art, reviewable like code.** Each asset is built by a Python
script that drives Blender (`art/<asset>/build.py`). The script is the source of
truth: it is diffable, it reproduces the same model on any machine, and it
encodes the asset's real dimensions instead of eyeballing them. Hand-sculpted
detail can be layered on later, and when it is, that asset's `.blend` becomes a
tracked source (section 4.6).

**G2. Art that agrees with the physics.** A model's size, footpads, engine exit
and boarding points come from the same numbers the simulation uses
(`VEHICLE` in `sim/expedition.js`, `ROVER`, the walk model's eye height). A
lander drawn 10% too tall is a physics bug on screen, and the gate treats it as
one.

**G3. Better, not slower.** A Blender asset replaces primitives without
breaking the frame budget on the reference machine and without adding a byte
to the first-paint download.

**G4. Nothing the gates hold gets weaker.** The 70 gates keep passing; each new
asset class adds checks rather than exemptions.

### 4.2 Reference hardware

The owner's MacBook Air (Apple M4, 16 GB, macOS 26) is the reference machine
for both authoring and frame budget. Blender 5.2.2 LTS is installed at
`/Applications/Blender.app` and runs headless from scripts, which is how every
asset is built.

### 4.3 Layout

```
art/
  README.md                  How to build, open and change an asset
  lib/pz.py                  Shared helpers: units, axes, materials, empties, export
  survey-lander/
    build.py                 Source of truth for the lander
    spec.json                Dimensions the build, the runtime and the gate share
    survey-lander.blend      Generated; gitignored while the script is the source
public/authored/
  survey-lander.glb          Exported; committed and deployed with the site
scripts/art.mjs              `npm run art:build -- <asset>`: runs build.py in headless Blender
scripts/verify-art.mjs       Gate: decodes, budget, scale, axes, required empties
```

`public/authored/` is deliberately *not* under `public/models/`, which is
gitignored and holds the 1.1 GB NASA catalogue fetched in CI. Authored assets
are small and are part of the product, so they are committed.

### 4.4 Conventions every asset follows

- **Scale:** 1 Blender unit = 1 metre, scene unit scale 1.0, metric. The gate
  rejects an asset whose bounds disagree with `spec.json` by more than 1%.
- **Axes:** author Z-up in Blender; the glTF exporter converts to three.js
  Y-up. A three.js point (x, y, z) is Blender (x, -z, y). So a vehicle whose
  front faces three.js -Z (the direction the expedition camera looks at yaw 0)
  faces Blender **+Y**.
- **Origin:** at the point the runtime positions the object by. For the lander
  that is the group origin `ExpeditionScene` already uses, 2.65 m above the
  ground at rest (`VEHICLE.clearance`).
- **Named empties** the runtime reads instead of hard-coded offsets:
  `nozzle_0…n` (engine exit centre, -Z along the jet), `hatch`, `ladder_base`,
  `footpad_0…3`, `sample_bay`, `rover_mount`; `wheel_0…5` on the rover. The
  gate fails if a required empty is missing.
- **Materials:** Principled BSDF only (base colour, metallic, roughness, normal,
  emission), which glTF maps to three.js `MeshStandardMaterial` directly.
  Colours stay inside the product's palette discipline: hardware greys, foil
  gold, the one ember stripe; no new hues.
- **Compression:** Draco geometry through Blender's own exporter, because the
  runtime already ships the Draco decoder. Textures, when an asset first needs
  them, ship as WebP; KTX2 needs a separate encoder that is not installed
  (section 4.8).
- **No baked lighting.** The scene's sun and the planet's sky light the asset.

### 4.5 Budgets (starting values; adjust against measurement)

| Asset class | LOD0 triangles | Texture memory | GLB on the wire |
| --- | ---: | ---: | ---: |
| Hero vehicle (survey lander) | 150k | 8 MB | 3 MB |
| Rover | 80k | 4 MB | 2 MB |
| Props (instruments, sample cases) | 5k | 1 MB | 200 kB |
| Rock library (instanced) | 2k each | shared | 500 kB total |

A model that only matters near the camera gets LODs; the first lander does not
need them, because the expedition never shows it smaller than a few hundred
pixels tall.

### 4.6 The first asset: survey lander

Today it is 30-odd primitives in `SurveyLander` (`components/ExpeditionScene.jsx`).
The Blender model must keep every dimension the physics and camera depend on.
Measured from that component and `VEHICLE`, in three.js coordinates around the
group origin:

| Feature | Value | Why it is fixed |
| --- | --- | --- |
| Origin above ground at rest | 2.65 m | `VEHICLE.clearance`; touchdown and altitude use it |
| Footpad soles | y = -2.60, centres at (±3.2, ±3.2) in x/z, 0.5 m radius | Contact and slope checks assume this stance |
| Descent stage | ~1.8 m radius, 2.2 m tall, centred on the origin | Boarding radius (11 m) and camera framing |
| Crew module | 2.6 x 1.5 x 2.5 m, centred at y = 1.5 | |
| Engine exit plane | y = -1.85, radius 0.65 m | The plume is drawn from here |
| Top of antenna | about y = +3.75 | Overall height ~6.35 m |
| Front (window, ember stripe) | faces -Z | Camera and approach direction |
| Ladder and hatch | +Z side | Where EVA begins |
| Mass | 3,600 kg dry, 1,500 kg propellant, 32 kN, Isp 310 s | Unchanged; the model is visual only |

Detail the script adds that primitives cannot: chamfered and panelled stage
walls, foil-wrapped tank bays, a proper bell with a throat and a nozzle lip,
leg struts with shock-absorber sleeves and hinged footpads, RCS quads, a
hand-railed ladder, hatch frame, antenna dish with a feed, and the stripe.

**Exit criteria for the lander**

- `npm run art:build -- survey-lander` builds the `.blend` and the `.glb` from
  scratch, headless, deterministically (same bytes twice).
- `verify-art` (registered in `verify:all`): the GLB decodes; it sits inside
  the hero budget; its bounds match `spec.json` within 1%; footpad soles sit at
  -2.60 ± 0.02 m; the nozzle empty is at the exit plane; every required empty
  exists; `spec.json` agrees with `VEHICLE.clearance`.
- `ExpeditionScene` loads the GLB lazily with the expedition chunk, positions
  the plume from `nozzle_0`, and keeps the primitive lander as the fallback if
  the file fails to load.
- Assisted descent, touchdown, EVA and takeoff behave exactly as before
  (`verify-expeditions` unchanged and green).
- Frame time on the reference MacBook Air, in a visible browser tab, no worse
  than before; first-paint bytes unchanged.

### 4.7 Phases

| Phase | Work | Status / exit |
| --- | --- | --- |
| 0 | Fold the expedition EVA onto `sim/walk.js`; remove the stale deploy variable | **Done** in `4320475` |
| 1 | Survey lander, the pipeline (`art/`, `art.mjs`, `verify-art`) and its runtime swap | Section 4.6 criteria |
| 2 | Surface rover (wheel empties drive spin and suspension), three instruments, sample cases | Same gate, rover budget |
| 3 | Rock library for the three regions, replacing generated rock meshes | Instanced, inside the 2k-triangle budget |
| 4 | Simulator close-ups that read as primitives: LC-39B structures, the LM at Tranquility | Measured against the existing pad geometry gates |
| 5 | Expedition terrain beyond the 700 m regional patch | A design decision first (4.8) |

### 4.8 Open decisions

1. **Textures:** WebP from Blender is available now. KTX2 (GPU-compressed,
   kinder to memory and to context loss) needs an encoder such as `toktx` or
   `basisu`, which means installing a tool; do that only with the owner's go-ahead.
2. **Hand-edited `.blend` files:** when an asset gets sculpted detail the
   script cannot reproduce, its `.blend` becomes a tracked source. At that point
   decide between Git LFS (not installed today) and committing the file
   directly while it stays small.
3. **A third-person EVA view:** an astronaut model only pays off if the
   camera can see the walker. Today the EVA is first person.
4. **Terrain beyond the patch:** spherical, streamed terrain in three.js is
   possible but large. Decide whether expeditions need it before building it.
