# Observatory Terminal (Vector Orrery & Signalscope)

**Status:** Implemented in `src/ui/TerminalView.jsx`. Visible across the UI and routed via `#terminal`.
**Author:** Antigravity (Advanced Agentic Coding)
**Last Updated:** November 2026

---

## 1. Overview & In-Universe Diegesis

The **Observatory Terminal** is an in-universe, diegetic computer terminal (`Terminal 3091`) located in Okafor's Observatory / Lookout above Hearthstone crater in the Reach.

In the Reach, the star (the Lantern) dies every twenty-two minutes, resetting time to the same morning at Hearth's campfire. The Observatory Terminal allows the pilot, Okafor, or any researcher to inspect the real Keplerian mechanics of the five celestial bodies orbiting the Lantern, scrub through the 22-minute timeline to analyze orbital windows (such as the Wanderer's close dive at T+20:30), track patched-conic spheres of influence (SOI), and listen to radio frequency signatures with the Signalscope oscilloscope.

---

## 2. Routes & Entry Points

The terminal is integrated cleanly into the web app without disturbing the Godot game, the N-body orbital simulator, or Squadron:

| Route | Handler | Purpose |
| --- | --- | --- |
| `#terminal` | `src/ExperienceApp.jsx` | Primary route to launch the terminal |
| `#observatory` | `src/sim/experiences.js` | In-universe alias |
| `#reach-terminal` | `src/sim/experiences.js` | Direct Reach alias |
| `#orrery` | `src/sim/experiences.js` | Descriptive alias |

### Visible Entry Points in the UI:
1. **Front Page Hero Menu (`src/ui/Title.jsx`)**: Prominent action link `Observatory Terminal (Live Vector Orrery)` directly beneath "Play in your browser".
2. **Landing Page Top Bar (`src/ui/Title.jsx`)**: Header button `Observatory Terminal` next to `How to play`.
3. **Landing Page Footer (`src/ui/Title.jsx`)**: Added to the "More from this project" list.
4. **Flight Operations Header Bar (`src/ui/Title.jsx`)**: Dedicated `Terminal` tab alongside `Career`, `Flight school`, and `Explore`.
5. **Simulator Navigation Bar (`src/ui/Nav.jsx`)**: `terminal · 3091` option on the main cockpit HUD top bar.

---

## 3. Architecture & File Structure

```
src/ui/TerminalView.jsx      Standalone 60 FPS React/Canvas terminal view
src/ExperienceApp.jsx        Lazy-loaded route switch for mode: 'terminal'
src/sim/experiences.js       Hash parser mapping #terminal, #observatory, etc.
src/ui/Title.jsx             Landing page buttons & entry links
src/ui/Nav.jsx               Top nav link in orbital simulator
docs/observatory-terminal.md This specification and implementation guide
```

---

## 4. Key Systems & Features

### A. Keplerian Vector Orrery (60 FPS Canvas)
- **Analytical Orbit Propagation:** Computes eccentric and true anomalies using Newton-Raphson approximation of Kepler's equation for arbitrary time offsets without floating point drift.
- **Reach Solar System Bodies:**
  - **The Lantern (Star):** Central body with dynamic coronal pulsing, solar flares, and gravitational lensing corona.
  - **Hearthstone (Home):** Semimajor axis $a=280$, eccentricity $e=0.04$. The starting village, launch tower, and observatory.
  - **Verdance (Jungle):** $a=420$, $e=0.08$. Waterfalls and sandstone pillars.
  - **Ashfall (Wreck):** $a=160$, $e=0.12$. Volcanic moon and Aster wreckage.
  - **The Phantom (Quantum Moon):** $a=340$, $e=0.22$. Unstable orbital phase shifts.
  - **The Wanderer (Comet):** $a=580$, $e=0.72$. High-eccentricity parabolic dive passing periapsis near the Lantern at $T=20\text{m }30\text{s}$.
- **Patched Conics & Telemetry Vectors:** Renders each body's sphere of influence (SOI), instantaneous prograde velocity vector, periapsis/apoapsis markers, and true-scale distance readouts.
- **Zero Allocations per Frame:** Coordinate projections reuse static internal buffers to guarantee stable 60 FPS performance.

### B. 22-Minute Loop Timeline Scrubber
- Interactive temporal slider scrubbing between $T=00:00$ and $T=22:00$.
- **Real-time playback speed controls:** Pause, $1\times$, $5\times$, and $30\times$ time warp.
- **Supernova Collapse Simulation:** At $T \ge 21\text{m }30\text{s}$, the Lantern shifts from golden-orange to violent blue-white collapse, triggering gravitational lensing distortions, chromatic aberration ripples, and complete viewport collapse at $T=22:00$ before resetting.

### C. Signalscope Audio Oscilloscope
- Diegetic frequency tuner scanning the electromagnetic band across the Reach:
  - `54.2 MHz`: Hearth Campfire (Banjo signal & Mara's voice)
  - `72.8 MHz`: Verdance Pillars (Harmonica signal)
  - `108.4 MHz`: Ashfall Crater (Captain Hale's emergency flight recorder beacon)
  - `142.0 MHz`: Lookout Observatory (Okafor's flute & astronomical telemetry)
  - `198.6 MHz`: Deep Void / Hollow frequency (Encrypted transmissions)
- Mathematical real-time waveform generator displaying harmonic Lissajous patterns and Fourier frequency bars on a green/ion-phosphor oscilloscope grid.
- Web Audio API synthesizer generating clean diegetic feedback tones when engaged.

### D. Diegetic Avionics Reticle & CRT Shaders
- Switchable target lock on any of the five Reach bodies with velocity relative to Hearthstone, true anomaly $\nu$, current distance $R$, and time-to-closest-approach.
- CRT phosphor raster lines, vignette shadow, subtle screen curvature, and vector beam persistence.
- Adheres strictly to the project's 4-color palette:
  - Void: `#120b22`
  - Bone: `#f4e8cf`
  - Ember: `#ff6b2c`
  - Ion: `#2fd3ff`

---

## 5. Potential Next Steps for Future LLMs

If continuing work or expanding this feature, consider:

1. **Godot Game State Bridge:**
   - Bridge live game state from the Godot Reach build (`game/`) into `TerminalView` via `postMessage` or `window.__reachState` (e.g. syncing player's actual in-game loop timer and unlocked ship log discoveries).
2. **Choir Songline Translator:**
   - Add a sub-panel decoding spiral songline texts discovered across Hearthstone and Ashfall.
3. **Flight Trajectory Plotter:**
   - Allow plotting burn vectors for the Kestrel from Hearthstone to Verdance or Ashfall directly on the orrery map, calculating required $\Delta v$ using the simulator's rocket equation math (`src/sim/programs.js`).
4. **Integration with Monume Sound Bed:**
   - Optionally cross-fade the signalscope frequencies into the game's ambient bed (`public/audio/monume-space-ambient.mp3`).
