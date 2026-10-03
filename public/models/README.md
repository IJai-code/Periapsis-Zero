# Spacecraft models

This folder holds NASA's public-domain 3D assets. The catalogue is **generated,
not hand-maintained** — add or remove files and re-run:

```bash
npm run models:extract   # unpack any .7z archives (optional)
npm run models:scan      # regenerate src/gfx/modelsManifest.js
```

`models:scan` also copies the Draco decoder out of three into `public/draco/`.

## Supplied on 3 October 2026

Eight meshes arrived as individual `.glb` files rather than from an archive,
and are added here one directory each, the way the scanner expects:

| Asset | Curated id | Group |
| --- | --- | --- |
| Astronaut | `astronaut` | Crewed |
| Advanced Crew Escape Suit | `aces` | Crewed |
| Chandra X-ray Observatory | `chandra` | Observatories |
| Cassini assembly | `cassini_assembly` | Deep space |
| Cassiopeia A (2025) | `cas_a` | Deep space |
| Aeronomy of Ice in the Mesosphere | `aim` | Earth science |
| Aquarius | `aquarius` | Earth science |
| ASTRE | `astre` | Earth science |

All are NASA public domain, and the interface says so where meshes are picked.
Adding them takes the catalogue from 48 to 56 loadable files.

**They do not ship until the release asset is republished.** CI restores
`public/models` from the `models` release, so a new mesh is invisible to the
pipeline until the pruned archive is rebuilt from `dist` and uploaded, and the
workflow's cache key is bumped:

```bash
npm run build
tar -czf models.tar.gz -C dist/models .
gh release upload models models.tar.gz --clobber
# then bump `models-release-vN` in .github/workflows/deploy.yml
```

The archive is made from `dist` rather than `public` because the build prunes
`public` down to the entries the manifest actually refers to. As of this
release the asset carries 56 files at 129 MB, against 1.1 GB unpruned.

## What is loadable

Only `.glb` and `.gltf` can be opened by a browser. NASA's archives also ship
`.max` (3ds Max), `.blend` and `.7z`, which the scanner reports and skips —
those need converting in a DCC tool first.

Current state of this folder: **56 loadable models**, plus these that are not:

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
