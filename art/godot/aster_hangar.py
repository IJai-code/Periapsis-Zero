"""The Aster's flight deck: a bay for one escort fighter.

    blender -b --factory-startup --python art/godot/aster_hangar.py -- game/art/aster_hangar.glb

A long, tall bay: a walkway down the port side at the door from the
bridge, the launch cradle and its rails down the middle, gantry arms, fuel
lines and crates, ribbed walls with light strips, and the outer doors
standing open on space at the far end. Surfaces are named for
game/scripts/art/surfaces.gd. Blender Z-up along +Y (Godot -Z); the
entrance is at y = 0, the open end at y = 34.
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import bmesh  # noqa: E402
import bpy  # noqa: E402
from mathutils import Matrix, Vector as V  # noqa: E402

import kit  # noqa: E402

OUT = sys.argv[sys.argv.index('--') + 1]
W, D, H = 9.0, 34.0, 10.0

kit.reset()

# Shell: open at the far end (that is the door to space).
bm = bmesh.new()
prof = [(-W, 0.0), (W, 0.0), (W, H - 2.5), (W - 2.5, H), (-W + 2.5, H), (-W, H - 2.5)]
kit.loft(bm, [kit.ring_y(kit.densify(prof, 3.0), y) for y in kit.frange(0.0, D, 4.25)], cap_start=True, cap_end=False)
for f in bm.faces:
    c = f.calc_center_median()
    if f.normal.dot(V((-c.x, 0.0 if c.y > 0.1 else 1.0, H / 2 - c.z))) < 0:
        f.normal_flip()
kit.panelize(bm, inset=0.06, depth=-0.04, seam=1, paint=lambda c, n: 0)
kit.part('shell', bm, ['hull', 'seam'])

# Ribs every few metres, light strips between them high on the walls.
ribs, lights = bmesh.new(), bmesh.new()
for y in kit.frange(2.0, D - 1.0, 4.0):
    for x in (-W + 0.2, W - 0.2):
        kit.box(ribs, (x, y, (H - 2.5) / 2), (0.4, 0.6, H - 2.5))
    kit.box(ribs, (0, y, H - 0.2), (2 * W - 5.0, 0.6, 0.4))
for y in kit.frange(4.0, D - 2.0, 4.0):
    for x in (-W + 0.1, W - 0.1):
        kit.box(lights, (x, y, 6.2), (0.08, 2.4, 0.25))
    kit.box(lights, (0, y, H - 0.08), (1.4, 2.6, 0.06))
kit.part('ribs', ribs, 'frame', bevel=0.03)
kit.part('lights', lights, 'light')

# The floor: deck plate, a hazard border round the launch lane, the rails.
bm = bmesh.new()
kit.box(bm, (0, D / 2, 0.02), (2 * W, D, 0.04))
kit.part('deck', bm, 'floor', bevel=0.004)
bm = bmesh.new()
for x in (-3.4, 3.4):
    kit.box(bm, (x, D / 2 + 3, 0.05), (0.3, D - 6, 0.03))
kit.part('lane_edges', bm, 'hazard')
bm = bmesh.new()
for x in (-1.6, 1.6):
    kit.box(bm, (x, D / 2 + 3, 0.12), (0.3, D - 6, 0.18))
kit.part('rails', bm, 'metal', bevel=0.01)
# The cradle the Kestrel sits on.
bm = bmesh.new()
kit.box(bm, (0, 14.0, 0.45), (4.4, 7.0, 0.5))
for x in (-1.5, 1.5):
    for y in (11.5, 16.5):
        kit.box(bm, (x, y, 1.0), (0.4, 0.4, 0.9))
kit.part('cradle', bm, 'paint_dark', bevel=0.03)

# The port walkway at the bridge door: grating on legs, a rail.
bm = bmesh.new()
kit.box(bm, (-6.5, 6.0, 0.06), (4.0, 12.0, 0.06))
kit.part('walkway', bm, 'grate')
bm = bmesh.new()
for y in kit.frange(0.5, 11.5, 1.5):
    kit.cylinder(bm, V((-4.55, y, 0.1)), V((-4.55, y, 1.1)), 0.035, 8)
kit.cylinder(bm, V((-4.55, 0.3, 1.1)), V((-4.55, 11.7, 1.1)), 0.035, 8)
kit.part('rail', bm, 'paint_ember')

# Gantry arms over the cradle, fuel lines, crates along the starboard wall.
bm = bmesh.new()
for side in (-1, 1):
    kit.box(bm, (side * 7.2, 14.0, 4.0), (0.6, 0.6, 8.0))
    kit.box(bm, (side * 4.6, 14.0, 7.6), (5.2, 0.5, 0.5))
    kit.box(bm, (side * 2.4, 14.0, 6.8), (0.4, 0.4, 1.4))
kit.part('gantries', bm, 'paint_bone', bevel=0.02)
bm = bmesh.new()
kit.cylinder(bm, V((8.6, 9.0, 0.3)), V((3.0, 12.0, 0.3)), 0.12, 10)
kit.cylinder(bm, V((8.6, 9.5, 0.6)), V((3.2, 12.5, 0.5)), 0.08, 10)
kit.part('fuel_lines', bm, 'pipe_ember')
bm = bmesh.new()
for i, (y, n) in enumerate(((20.0, 3), (23.0, 2), (26.0, 3))):
    for k in range(n):
        kit.box(bm, (7.4 - (k % 2) * 1.3, y + (k // 2) * 1.3, 0.6 + (k // 2) * 0.0), (1.2, 1.2, 1.2))
kit.part('crates', bm, 'container_grey', bevel=0.03)

# The outer doors, slid open to either side of the opening.
bm = bmesh.new()
for side in (-1, 1):
    kit.box(bm, (side * (W - 1.0), D - 0.6, H / 2), (2.0, 0.8, H))
kit.part('outer_doors', bm, 'door', bevel=0.04)
bm = bmesh.new()
kit.box(bm, (0, D - 0.3, 0.3), (2 * W, 0.6, 0.6))
kit.box(bm, (0, D - 0.3, H - 0.4), (2 * W, 0.6, 0.8))
kit.part('door_frame', bm, 'hazard', bevel=0.02)
# The door back to the bridge.
bm = bmesh.new()
kit.box(bm, (-6.5, 0.06, 1.1), (1.2, 0.1, 2.2))
kit.part('inner_door', bm, 'door', bevel=0.02)

kit.export(OUT)
print('hangar:', OUT, len(bpy.data.objects), 'objects')
