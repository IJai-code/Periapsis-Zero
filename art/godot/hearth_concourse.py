"""Hearth Station's concourse: the station's main street.

    blender -b --factory-startup --python art/godot/hearth_concourse.py -- game/art/hearth_concourse.glb

A long hall, 12 m wide and 8 m tall: on the port side a window wall
floor to ceiling looking out at Earth; on the starboard side two levels,
shop fronts and kiosks below and a gallery with a railing above. Benches
face the window, planters and columns run down the middle, and light
strips line the ceiling. The medical bay door is at the aft end (y = 0),
the docking bay door at the fore end (y = 44). Surfaces are named for
game/scripts/art/surfaces.gd. Blender Z-up along +Y (Godot -Z).
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
W, D, H = 6.0, 44.0, 8.0   # half width, length, height
GAL = 4.0                  # gallery floor height

kit.reset()

# Floor, ceiling and the end walls (the long walls are built below).
bm = bmesh.new()
kit.box(bm, (0, D / 2, -0.1), (2 * W + 6, D, 0.2))
kit.part('floor', bm, 'floor_clean')
bm = bmesh.new()
inlay = bmesh.new()
for y in kit.frange(2.0, D - 2.0, 4.0):
    kit.box(inlay, (-1.0, y, 0.005), (0.08, 3.6, 0.01))
kit.box(inlay, (-1.0, D / 2, 0.006), (1.6, D - 1.0, 0.004))
kit.part('floor_inlay', inlay, 'paint_dark')
kit.box(bm, (0, D / 2, H + 0.1), (2 * W + 6, D, 0.2))
kit.part('ceiling', bm, 'panel')
bm = bmesh.new()
kit.box(bm, (0, 0.0, H / 2), (2 * W + 6, 0.3, H))
# The fore wall stands round the docking bay's doorway (x -2.6 to 0.6,
# 3.2 high): the game's door slides open on it.
left, right = -(W + 3), W + 3
kit.box(bm, ((left - 2.6) / 2, D, H / 2), (-2.6 - left, 0.3, H))
kit.box(bm, ((0.6 + right) / 2, D, H / 2), (right - 0.6, 0.3, H))
kit.box(bm, (-1.0, D, (3.2 + H) / 2), (3.2, 0.3, H - 3.2))
kit.part('end_walls', bm, 'wall_clean')

# The window wall: mullions and transoms, open between (the sky shows).
bm = bmesh.new()
for y in kit.frange(0.0, D, 4.0):
    kit.box(bm, (-W, y, H / 2), (0.3, 0.3, H))
for z in (0.4, H * 0.55, H - 0.2):
    kit.box(bm, (-W, D / 2, z), (0.3, D, 0.2))
kit.part('window_frame', bm, 'frame', bevel=0.02)
bm = bmesh.new()
kit.box(bm, (-W + 0.05, D / 2, 0.2), (0.6, D, 0.4))
kit.part('window_sill', bm, 'paint_dark', bevel=0.02)

# The starboard side: shop fronts below, the gallery above.
bm = bmesh.new()
kit.box(bm, (W + 3.0, D / 2, H / 2), (0.3, D, H))
kit.part('back_wall', bm, 'wall_clean')
shops, signs, glass = bmesh.new(), bmesh.new(), bmesh.new()
for i, y in enumerate(kit.frange(3.0, D - 5.0, 6.5)):
    kit.box(shops, (W + 0.15, y - 2.8, GAL / 2), (0.3, 0.4, GAL))
    kit.box(shops, (W + 1.5, y + 0.5, 0.5), (2.4, 2.6, 1.0))
    kit.box(glass, (W + 0.05, y + 0.4, 2.1), (0.04, 5.0, 2.6))
    kit.box(signs, (W + 0.06, y + 0.4, 3.6), (0.05, 4.0, 0.5))
kit.part('shop_fronts', shops, 'paint_bone', bevel=0.02)
kit.part('shop_glass', glass, 'shopglass')
kit.part('shop_signs', signs, 'sign_glow')
bm = bmesh.new()
kit.box(bm, (W + 1.5, D / 2, GAL - 0.15), (3.0, D, 0.3))
kit.part('gallery_floor', bm, 'paint_dark', bevel=0.02)
bm = bmesh.new()
for y in kit.frange(0.5, D - 0.5, 1.2):
    kit.cylinder(bm, V((W + 0.05, y, GAL)), V((W + 0.05, y, GAL + 1.05)), 0.025, 6)
kit.cylinder(bm, V((W + 0.05, 0.2, GAL + 1.05)), V((W + 0.05, D - 0.2, GAL + 1.05)), 0.04, 8)
kit.part('gallery_rail', bm, 'metal')
bm = bmesh.new()
kit.box(bm, (W + 0.05, D / 2, GAL + 0.5), (0.03, D - 0.4, 0.9))
kit.part('gallery_glass', bm, 'shopglass')

# Columns down the middle, with planters between them.
cols, pots, green = bmesh.new(), bmesh.new(), bmesh.new()
for y in kit.frange(4.0, D - 4.0, 8.0):
    kit.cylinder(cols, V((1.4, y, 0)), V((1.4, y, H)), 0.32, 16)
    kit.cylinder(cols, V((1.4, y, H - 0.6)), V((1.4, y, H)), 0.6, 16, r2=0.32)
for y in kit.frange(8.0, D - 8.0, 8.0):
    kit.box(pots, (1.4, y, 0.4), (1.2, 2.6, 0.8))
    for k in range(9):
        kit.sphere(green, (1.4 + math.sin(k * 2.1) * 0.35, y + math.cos(k * 1.7) * 0.9, 1.0 + (k % 3) * 0.15), 0.35, 8)
kit.part('columns', cols, 'paint_bone', bevel=0.01)
kit.part('planters', pots, 'paint_dark', bevel=0.03)
kit.part('plants', green, 'plant')

# Benches facing the window.
bm = bmesh.new()
for y in kit.frange(6.0, D - 6.0, 8.0):
    kit.box(bm, (-3.4, y, 0.45), (0.55, 2.4, 0.08))
    kit.box(bm, (-3.1, y, 0.8), (0.08, 2.4, 0.6))
    for dy in (-1.0, 1.0):
        kit.box(bm, (-3.3, y + dy, 0.22), (0.4, 0.08, 0.44))
kit.part('benches', bm, 'paint_ember', bevel=0.02)

# Ceiling light strips, and a hanging station board.
bm = bmesh.new()
for x in (-3.0, 0.0, 3.0):
    kit.box(bm, (x, D / 2, H - 0.05), (0.3, D - 2.0, 0.06))
kit.part('ceiling_lights', bm, 'light')
bm = bmesh.new()
kit.box(bm, (0, D / 2, H - 1.4), (0.2, 6.0, 1.6))
kit.part('board', bm, 'screen')
bm = bmesh.new()
kit.cylinder(bm, V((0, D / 2 - 2.5, H - 0.6)), V((0, D / 2 - 2.5, H)), 0.03, 6)
kit.cylinder(bm, V((0, D / 2 + 2.5, H - 0.6)), V((0, D / 2 + 2.5, H)), 0.03, 6)
kit.part('board_hangers', bm, 'metal')

# Doors at either end, in hazard frames.
bm = bmesh.new()
kit.box(bm, (-1.0, 0.18, 1.3), (2.0, 0.1, 2.6))
kit.box(bm, (-1.0, D - 0.18, 1.6), (3.2, 0.1, 3.2))
kit.part('doors', bm, 'door', bevel=0.02)
bm = bmesh.new()
for x in (-2.2, 0.2):
    kit.box(bm, (x, 0.25, 1.4), (0.2, 0.2, 2.8))
kit.box(bm, (-1.0, 0.25, 2.8), (2.6, 0.2, 0.2))
for x in (-2.8, 0.8):
    kit.box(bm, (x, D - 0.25, 1.7), (0.25, 0.2, 3.4))
kit.box(bm, (-1.0, D - 0.25, 3.4), (3.8, 0.2, 0.25))
kit.part('door_frames', bm, 'hazard', bevel=0.015)

kit.export(OUT)
print('concourse:', OUT, len(bpy.data.objects), 'objects')
