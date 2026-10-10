"""The Aster's bridge: where the player meets the captain.

    blender -b --factory-startup --python art/godot/aster_bridge.py -- game/art/aster_bridge.glb

A wide, low room with a raked window band forward, two rows of consoles
with angled screens, the captain's chair on a step, ribbed walls and
ceiling light strips. The entry from deck 2 is aft (y = 0); the hatch to
the flight deck is on the starboard wall. Surfaces are named for
game/scripts/art/surfaces.gd, like the corridor; screens are named
`screen` and drawn by a shader in Godot.

Blender is Z-up and the room runs along +Y; in Godot it runs along -Z.
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
W, D, H = 5.2, 9.0, 3.5   # half width, depth, height

kit.reset()

# The shell: floor, walls, a sloped ceiling running down to the window band.
bm = bmesh.new()
profile = [(-W, 0.0), (W, 0.0), (W, 2.6), (W - 1.0, H), (-W + 1.0, H), (-W, 2.6)]
kit.loft(bm, [kit.ring_y(profile, 0.0), kit.ring_y(profile, D - 1.6)], cap_start=True, cap_end=False)
# The forward bay narrows and lowers to the window frame.
fwd = [(-W + 0.6, 0.0), (W - 0.6, 0.0), (W - 0.6, 2.2), (W - 1.4, 2.9), (-W + 1.4, 2.9), (-W + 0.6, 2.2)]
kit.loft(bm, [kit.ring_y(profile, D - 1.6), kit.ring_y(fwd, D)], cap_start=False, cap_end=False)
# Every face, the aft wall included, faces the middle of the room.
for f in bm.faces:
    c = f.calc_center_median()
    if f.normal.dot(V((0.0, D / 2, 1.75)) - c) < 0:
        f.normal_flip()
# Cut the window band out of the forward face (it has no end cap) by removing
# nothing: the open end is the window, framed and glazed below.
kit.part('bridge_shell', bm, 'hull')

# The deck: plates at the sides, grating down the middle aisle.
bm = bmesh.new()
for x in (-3.3, 3.3):
    kit.box(bm, (x, D / 2, 0.02), (3.6, D, 0.04))
kit.part('deck', bm, 'floor', bevel=0.004)
bm = bmesh.new()
kit.box(bm, (0, D / 2, 0.03), (3.0, D, 0.03))
kit.part('aisle', bm, 'grate')
# The captain's step and chair.
bm = bmesh.new()
kit.box(bm, (0, 2.6, 0.03), (3.0, 2.2, 0.06))
kit.part('step', bm, 'paint_dark', bevel=0.01)
bm = bmesh.new()
kit.box(bm, (0, 2.5, 0.55), (0.75, 0.7, 0.14))
kit.box(bm, (0, 2.2, 1.15), (0.75, 0.16, 1.1))
kit.box(bm, (-0.42, 2.55, 0.75), (0.1, 0.6, 0.3))
kit.box(bm, (0.42, 2.55, 0.75), (0.1, 0.6, 0.3))
kit.cylinder(bm, V((0, 2.5, 0.24)), V((0, 2.5, 0.5)), 0.12, 12)
kit.part('chair', bm, 'paint_dark', bevel=0.03)
bm = bmesh.new()
kit.box(bm, (0, 2.5, 0.64), (0.62, 0.6, 0.04))
kit.box(bm, (0, 2.27, 1.15), (0.62, 0.04, 0.95))
kit.part('chair_pad', bm, 'rubber', bevel=0.01)

# Consoles: two rows angled toward the window, a screen on each.
desks, screens, trim = bmesh.new(), bmesh.new(), bmesh.new()
tilt = Matrix.Rotation(math.radians(-35), 3, 'X')
for row, y in ((0, 5.0), (1, 6.9)):
    for x in (-3.9, -2.2, 2.2, 3.9):
        kit.box(desks, (x, y, 0.45), (1.5, 0.8, 0.9))
        kit.box(desks, (x, y + 0.15, 0.95), (1.5, 0.55, 0.1), tilt)
        kit.box(trim, (x, y - 0.42, 0.45), (1.5, 0.04, 0.9))
        kit.box(screens, (x, y + 0.2, 1.35), (1.25, 0.04, 0.6), Matrix.Rotation(math.radians(-14), 3, 'X'))
        kit.box(trim, (x, y + 0.24, 1.35), (1.35, 0.03, 0.7), Matrix.Rotation(math.radians(-14), 3, 'X'))
kit.part('consoles', desks, 'paint_bone', bevel=0.02)
kit.part('console_trim', trim, 'paint_dark', bevel=0.006)
kit.part('screens', screens, 'screen')
# The big plot table in front of the chair.
bm = bmesh.new()
kit.cylinder(bm, V((0, 3.9, 0)), V((0, 3.9, 0.85)), 0.32, 20)
kit.cylinder(bm, V((0, 3.9, 0.85)), V((0, 3.9, 0.92)), 0.6, 32)
kit.part('plot_table', bm, 'paint_dark', bevel=0.01)
bm = bmesh.new()
kit.cylinder(bm, V((0, 3.9, 0.92)), V((0, 3.9, 0.935)), 0.52, 32)
kit.part('plot_glass', bm, 'screen_round')

# Window band: frames and glass across the open forward end.
fr, gl = bmesh.new(), bmesh.new()
xs = [-W + 0.6, -2.4, 0.0, 2.4, W - 0.6]
for x in xs:
    kit.box(fr, (x, D - 0.05, 1.45), (0.22, 0.25, 2.9))
kit.box(fr, (0, D - 0.05, 0.55), (2 * W - 1.2, 0.3, 1.1))
kit.box(fr, (0, D - 0.05, 2.85), (2 * W - 1.2, 0.25, 0.22))
kit.part('window_frames', fr, 'frame', bevel=0.02)
kit.box(gl, (0, D + 0.02, 1.85), (2 * W - 1.2, 0.02, 1.9))
kit.part('window_glass', gl, 'glass')

# Ribs on the walls and ceiling, light strips between them.
ribs, lights = bmesh.new(), bmesh.new()
for y in (1.0, 2.8, 4.6, 6.4):
    for x in (-W + 0.08, W - 0.08):
        kit.box(ribs, (x, y, 1.3), (0.16, 0.3, 2.6))
    kit.box(ribs, (0, y, H - 0.08), (2 * W - 2.0, 0.3, 0.16))
for y in (1.9, 3.7, 5.5, 7.1):
    kit.box(lights, (-1.6, y, H - 0.06), (0.25, 1.2, 0.04))
    kit.box(lights, (1.6, y, H - 0.06), (0.25, 1.2, 0.04))
kit.part('ribs', ribs, 'frame', bevel=0.015)
kit.part('ceiling_lights', lights, 'light')
# Wall panels between the ribs.
bm = bmesh.new()
for y in (1.9, 3.7, 5.5):
    for x in (-W + 0.04, W - 0.04):
        if x > 0 and y == 3.7:
            continue  # the hatch
        kit.box(bm, (x, y, 1.25), (0.05, 1.5, 2.1))
kit.part('wall_panels', bm, 'wall', bevel=0.01)

# Doors: aft to deck 2, starboard hatch to the flight deck.
bm = bmesh.new()
kit.box(bm, (0, 0.05, 1.05), (1.2, 0.1, 2.1))
kit.box(bm, (W - 0.06, 3.7, 1.05), (0.1, 1.2, 2.1))
kit.part('doors', bm, 'door', bevel=0.02)
bm = bmesh.new()
for x in (-0.72, 0.72):
    kit.box(bm, (x, 0.1, 1.1), (0.2, 0.16, 2.3))
kit.box(bm, (0, 0.1, 2.3), (1.64, 0.16, 0.2))
for y in (3.0, 4.4):
    kit.box(bm, (W - 0.1, y, 1.1), (0.16, 0.2, 2.3))
kit.box(bm, (W - 0.1, 3.7, 2.3), (0.16, 1.6, 0.2))
kit.part('door_frames', bm, 'hazard', bevel=0.015)

kit.export(OUT)
print('bridge:', OUT, len(bpy.data.objects), 'objects')
