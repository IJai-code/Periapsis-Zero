# Spacecraft models

This folder holds NASA's public-domain 3D assets. The catalogue is **generated,
not hand-maintained** — add or remove files and re-run:

```bash
npm run models:extract   # unpack any .7z archives (optional)
npm run models:scan      # regenerate src/gfx/modelsManifest.js
```

`models:scan` also copies the Draco decoder out of three into `public/draco/`.

## What is loadable

Only `.glb` and `.gltf` can be opened by a browser. NASA's archives also ship
`.max` (3ds Max), `.blend` and `.7z`, which the scanner reports and skips —
those need converting in a DCC tool first.

Current state of this folder: **48 loadable models**, plus these that are not:

| Asset | Status |
| --- | --- |
| Space Launch System Block 1 | `.max` / `.blend` only — needs conversion |
| International Space Station | ships as ~16 separate module files, with no assembled station |

Because there is no single assembled ISS mesh, the ISS craft keeps its
procedural placeholder by default; the individual modules are selectable under
*ISS modules* if you want them.

## Draco compression

22 of the 48 models declare `KHR_draco_mesh_compression` as **required** —
Hubble, JWST, the Shuttle, Cassini, Juno and others. Without a decoder they fail
with `THREE.GLTFLoader: No DRACOLoader instance provided`. The decoder is served
from `public/draco/` rather than a CDN so the app still runs offline.

## Scale and orientation

Models are auto-centred on their bounding box and scaled so the longest
dimension matches the craft's rendered size, with bounds recomputed afterwards.
Source units and origin offsets therefore do not matter — the catalogue spans a
4000× range (Voyager is 0.34 source units across, Bennu is 1350).

Orientation is *not* corrected: the craft convention is **+Z forward, +Y up**.
A model that points the wrong way needs rotating at source, or a per-entry
correction in `normalize()` in `src/gfx/models.js`.

## Production builds

Vite copies `public/` into `dist` wholesale. A Vite plugin prunes everything
except `.glb`/`.gltf` from `dist/models` at build time — without it this folder
alone makes a 1.1 GB build. Originals here are never touched.
