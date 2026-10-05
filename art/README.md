# Authored art

Models for Periapsis Zero, built by scripts that drive Blender. The script is
the source of truth; the `.blend` beside it is output, regenerated on every
build and ignored by Git. The shipped file lands in `public/authored/<id>.glb`.
AGENT.md, section 4, has the full conventions.

## Build

```bash
npm run art:build -- survey-lander
```

Runs `art/survey-lander/build.py` in headless Blender (factory settings, so no
local preference changes the result), writes `public/authored/survey-lander.glb`
and `art/survey-lander/survey-lander.blend`. Blender is found at `$BLENDER` or
`/Applications/Blender.app`.

```bash
npm run art:build -- survey-lander --check
```

Rebuilds into a temporary folder and fails unless the bytes match the shipped
file: the build is deterministic, and this is how you prove it.

```bash
npm run verify:art
```

Holds every shipped asset to its `spec.json`: budget, bounds, the named points
the runtime reads, which materials are double-sided, and (for the lander) that
it stands where the physics says it stands. Needs no Blender, so it runs in CI.

## Surfaces: procedural in Blender, baked for the web

`lib/surfacing.py` builds what each material is made of as a Blender shader
graph (nothing downloaded): crinkled multi-layer foil, painted panels with
seams and grime, brushed aluminium, solar cells with busbars, a heat-tinted
niobium nozzle, woven-wire wheels, and dust that thins upward from the ground.
Cycles then bakes every material on an asset into one atlas:

| Image    | Contents                                                    |
| -------- | ----------------------------------------------------------- |
| `base`   | colour, sRGB (baked through emission: the diffuse pass is black for metal) |
| `orm`    | occlusion R, roughness G, metalness B (glTF's packing)      |
| `normal` | tangent space: crinkle, seams, grain, Cycles-rounded edges  |

and swaps the asset's materials for one glTF material (plus a `_ds` twin for
open shells). The images ship inside the `.glb` as WebP. A vehicle that was
nine materials is now one draw call each for one- and two-sided parts.

Three other kinds of asset use the same machinery:

- `rocks/`: six stones, each built at 82,000 faces and at 320, the first
  baked onto the second (selected to active), for the instanced rock field.
- `ground/`: a real 4 m patch of each world's ground (periodic heightfield,
  craterlets, ripples or cracks, half-buried 3D pebbles) baked onto a flat
  tile as `public/authored/ground/<world>-detail.webp` and `-normal.webp`.
  Nine tiles serve thirteen worlds (`tile` in `src/sim/worlds.js`); one bake
  takes about ten minutes on the CPU, so `PZ_WORLD=io` builds one.
- `worlds/`: a photograph of each of the thirteen landable worlds, path traced
  in Cycles from the shipped models, rock set and that world's ground tile, on
  a landscape of its own geology with its parent planet at its true size.
  Not bit-reproducible, so `--check` skips it; `verify:art` still holds its
  files and budget.

A quick look while working on a surface:

```bash
/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup \
  --python art/survey-lander/build.py -- --fast --preview /tmp/lander.png
```

`--fast` bakes at half size with few samples; `--preview` renders a Cycles
beauty shot of the result. Full bakes run on the CPU with a fixed seed so
`--check` can compare bytes; the lander takes about four minutes.

## Live, in an open Blender

With the Blender MCP add-on running (scripts/blender-mcp.mjs), any build
script can run inside the open window, so the model appears and changes as
the script is edited. Run it through `blender_execute_python` with the
modules reloaded:

```python
import sys
for k in ['pz', 'surfacing']: sys.modules.pop(k, None)
sys.argv = ['blender']
path = '/Users/ishaan/Documents/SpxSim/art/survey-lander/build.py'
exec(compile(open(path).read(), path, 'exec'), {'__name__': '__main__', '__file__': path})
```

In a live session `pz.reset_scene` empties the open file instead of a factory
reset (which would unload the add-on itself), the bake is skipped so the
procedural materials stay to be looked at, and the story script builds its
scene and stops before rendering. The shipped files still come from the
headless `npm run art:build`.

## Look at it

Open `art/<id>/<id>.blend` in Blender after a build. Changes made there are
lost on the next build, by design: change `build.py` (or `spec.json`) instead.
When an asset needs hand-sculpted detail a script cannot reproduce, its `.blend`
becomes a tracked source; that decision is open in AGENT.md, 4.9.

## Layout

```
lib/pz.py                 helpers every asset shares (units, axes, materials,
                          meshes from explicit geometry, empties, export)
lib/surfacing.py          shader recipes, the UV atlas, the bake, the glTF material
<asset>/build.py          the source
<asset>/spec.json         dimensions the build, the runtime and the gate share,
                          in the runtime's coordinates (three.js, Y-up, metres)
```

## Conventions in one breath

One Blender unit is a metre. Author Z-up; the export delivers Y-up, so a
three.js point (x, y, z) is Blender (x, -z, y) and a vehicle's front, three.js
-Z, is Blender +Y. Principled BSDF only, baked to textures before export. Materials are single-sided unless
`double_sided=True` (open shells only). Named empties for every point the
runtime reads. Draco compression, because the page already ships the decoder.
