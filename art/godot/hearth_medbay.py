"""Hearth's medical bay: where the player wakes after the Aster.

    blender -b --factory-startup --python art/godot/hearth_medbay.py -- game/art/hearth_medbay.glb

A small clean room: a recovery bed with a monitor arm and an IV stand,
cabinets and a counter on the far side, soft ceiling panels, and a window
on the end wall with Earth in it. Surfaces are named for
game/scripts/art/surfaces.gd. Blender Z-up, the room along +Y (Godot -Z);
the door is at y = 0, the window at y = 7.
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
W, D, H = 3.0, 7.0, 3.0

kit.reset()

# Shell: a chamfered box, faces inward.
bm = bmesh.new()
prof = [(-W, 0.0), (W, 0.0), (W, H - 0.4), (W - 0.4, H), (-W + 0.4, H), (-W, H - 0.4)]
# Built as a closed solid (normals out) so the window can be cut from it,
# then turned inside out to be seen from within.
kit.loft(bm, [kit.ring_y(prof, 0.0), kit.ring_y(prof, D)])
shell = kit.part('shell', bm, 'wall_clean')
# The window: cut through the end wall.
cut = bmesh.new()
kit.box(cut, (0.6, D, 1.55), (2.6, 0.6, 1.3))
cutter = kit.part('cut', cut, 'panel')
b = shell.modifiers.new('window', 'BOOLEAN')
b.object = cutter
b.operation = 'DIFFERENCE'
b.solver = 'EXACT'
with bpy.context.temp_override(object=shell, active_object=shell):
    bpy.ops.object.modifier_apply(modifier='window')
bpy.data.objects.remove(cutter)
inside = bmesh.new()
inside.from_mesh(shell.data)
bmesh.ops.reverse_faces(inside, faces=inside.faces)
inside.to_mesh(shell.data)
inside.free()

bm = bmesh.new()
for x0, x1 in ((-0.7, -0.62), (1.82, 1.9)):
    kit.box(bm, ((x0 + x1) / 2, D - 0.05, 1.55), (0.14, 0.2, 1.5))
kit.box(bm, (0.6, D - 0.05, 0.86), (2.8, 0.2, 0.12))
kit.box(bm, (0.6, D - 0.05, 2.24), (2.8, 0.2, 0.12))
kit.part('window_frame', bm, 'frame', bevel=0.012)

# Floor and a skirting of trim; wall panels with frames between.
bm = bmesh.new()
kit.box(bm, (0, D / 2, 0.01), (2 * W - 0.05, D - 0.05, 0.02))
kit.part('floor', bm, 'floor_clean')
bm = bmesh.new()
for x in (-W + 0.03, W - 0.03):
    kit.box(bm, (x, D / 2, 0.08), (0.06, D, 0.16))
kit.part('skirting', bm, 'trim')
bm = bmesh.new()
for y in (1.2, 2.6, 4.0, 5.4):
    for x in (-W + 0.05, W - 0.05):
        kit.box(bm, (x, y, 1.4), (0.08, 0.12, 2.6))
kit.part('ribs', bm, 'frame', bevel=0.01)

# Ceiling light panels.
bm = bmesh.new()
for y in (1.9, 4.7):
    kit.box(bm, (0, y, H - 0.03), (1.6, 1.6, 0.04))
kit.part('ceiling_lights', bm, 'light_soft')

# The bed, along the room, head to the window wall.
x0, ya, yb = -1.2, 3.6, 5.8
bm = bmesh.new()
kit.box(bm, (x0, (ya + yb) / 2, 0.42), (1.05, yb - ya, 0.14))
for yy in (ya + 0.1, yb - 0.1):
    for xx in (x0 - 0.45, x0 + 0.45):
        kit.cylinder(bm, V((xx, yy, 0.0)), V((xx, yy, 0.42)), 0.035, 8)
kit.box(bm, (x0, yb + 0.02, 0.75), (1.1, 0.06, 0.8))
kit.box(bm, (x0 - 0.56, (ya + yb) / 2, 0.62), (0.04, 1.4, 0.04))
kit.box(bm, (x0 + 0.56, (ya + yb) / 2, 0.62), (0.04, 1.4, 0.04))
kit.part('bed_frame', bm, 'trim', bevel=0.008)
bm = bmesh.new()
kit.box(bm, (x0, (ya + yb) / 2, 0.56), (0.95, yb - ya - 0.06, 0.16))
kit.part('mattress', bm, 'linen', bevel=0.04, segments=3)
bm = bmesh.new()
kit.box(bm, (x0, yb - 0.32, 0.7), (0.62, 0.36, 0.13))
kit.part('pillow', bm, 'linen', bevel=0.05, segments=3)
bm = bmesh.new()
kit.box(bm, (x0, ya + 0.75, 0.66), (1.0, 1.3, 0.05))
kit.part('blanket', bm, 'blanket', bevel=0.02, segments=2)
# Monitor arm and screen over the bed's head; an IV stand.
bm = bmesh.new()
kit.box(bm, (-W + 0.1, yb - 0.3, 1.9), (0.1, 0.2, 0.3))
kit.cylinder(bm, V((-W + 0.12, yb - 0.3, 1.9)), V((x0 - 0.2, yb - 0.5, 1.8)), 0.035, 8)
kit.cylinder(bm, V((x0 + 0.85, yb - 0.4, 0.02)), V((x0 + 0.85, yb - 0.4, 1.9)), 0.018, 8)
kit.cylinder(bm, V((x0 + 0.65, yb - 0.4, 1.9)), V((x0 + 1.05, yb - 0.4, 1.9)), 0.012, 6)
kit.part('med_gear', bm, 'metal', bevel=0.004)
bm = bmesh.new()
kit.box(bm, (x0 - 0.2, yb - 0.52, 1.78), (0.62, 0.05, 0.4), Matrix.Rotation(math.radians(-30), 3, 'Z'))
kit.part('monitor', bm, 'screen')
bm = bmesh.new()
kit.box(bm, (x0 + 0.85, yb - 0.4, 1.72), (0.12, 0.05, 0.22))
kit.part('iv_bag', bm, 'glass')

# Cabinets and a counter on the starboard wall, a screen above.
bm = bmesh.new()
for y in (1.6, 2.4, 3.2, 4.0):
    kit.box(bm, (W - 0.32, y, 0.45), (0.6, 0.76, 0.9))
    kit.box(bm, (W - 0.22, y, 2.2), (0.4, 0.76, 0.7))
kit.part('cabinets', bm, 'paint_bone', bevel=0.012)
bm = bmesh.new()
kit.box(bm, (W - 0.32, 2.8, 0.92), (0.66, 3.3, 0.05))
kit.part('counter', bm, 'paint_dark', bevel=0.008)
bm = bmesh.new()
kit.box(bm, (W - 0.03, 2.8, 1.5), (0.04, 1.2, 0.6))
kit.part('wall_screen', bm, 'screen')

# The door.
bm = bmesh.new()
kit.box(bm, (0.9, 0.05, 1.05), (1.1, 0.1, 2.1))
kit.part('door', bm, 'door', bevel=0.02)
bm = bmesh.new()
for x in (0.28, 1.52):
    kit.box(bm, (x, 0.1, 1.1), (0.14, 0.14, 2.3))
kit.box(bm, (0.9, 0.1, 2.3), (1.38, 0.14, 0.14))
kit.part('door_frame', bm, 'frame', bevel=0.01)

# A scanner arch over the bed, with a lit strip on its underside.
bm = bmesh.new()
for k in range(13):
    a0, a1 = math.pi * k / 13, math.pi * (k + 1) / 13
    p0 = V((x0 + math.cos(a0) * 0.85, 3.8, 0.55 + math.sin(a0) * 1.05))
    p1 = V((x0 + math.cos(a1) * 0.85, 3.8, 0.55 + math.sin(a1) * 1.05))
    kit.cylinder(bm, p0, p1, 0.04, 10)
kit.part('scanner', bm, 'paint_bone', bevel=0.01)
bm = bmesh.new()
for k in range(1, 12):
    a = math.pi * k / 12
    kit.box(bm, (x0 + math.cos(a) * 0.81, 3.8, 0.55 + math.sin(a) * 1.0), (0.03, 0.03, 0.03))
kit.part('scanner_lights', bm, 'light_floor')

# Wall inserts between the ribs, and a strip of ion light at hand height.
bm = bmesh.new()
glow = bmesh.new()
for y0, y1 in ((0.3, 1.15), (1.25, 2.55), (2.65, 3.95), (4.05, 5.35), (5.45, 6.9)):
    for x in (-W + 0.03, W - 0.03):
        kit.box(bm, (x, (y0 + y1) / 2, 1.9), (0.04, y1 - y0 - 0.06, 1.3))
        kit.box(glow, (x * 0.995, (y0 + y1) / 2, 1.12), (0.02, y1 - y0 - 0.06, 0.03))
kit.part('wall_inserts', bm, 'panel', bevel=0.008)
kit.part('wall_glow', glow, 'light_floor')

# A curtain on a ceiling rail between the bed and the door.
bm = bmesh.new()
kit.cylinder(bm, V((-W + 0.1, 2.9, H - 0.25)), V((0.4, 2.9, H - 0.25)), 0.02, 8)
kit.part('curtain_rail', bm, 'metal')
bm = bmesh.new()
pts = []
for k in range(16):
    x = -W + 0.2 + k * 0.14
    pts.append((x, 2.9 + 0.05 * math.sin(k * 1.7)))
top = [bm.verts.new(V((x, y, H - 0.3))) for x, y in pts]
bot = [bm.verts.new(V((x, y, 0.35))) for x, y in pts]
for i in range(len(pts) - 1):
    bm.faces.new((top[i], top[i + 1], bot[i + 1], bot[i]))
kit.part('curtain', bm, 'curtain')

# An equipment cart beside the bed.
bm = bmesh.new()
kit.box(bm, (x0 + 1.05, 3.4, 0.82), (0.5, 0.4, 0.04))
kit.box(bm, (x0 + 1.05, 3.4, 0.45), (0.5, 0.4, 0.04))
for dx in (-0.22, 0.22):
    for dy in (-0.17, 0.17):
        kit.cylinder(bm, V((x0 + 1.05 + dx, 3.4 + dy, 0.05)), V((x0 + 1.05 + dx, 3.4 + dy, 0.84)), 0.015, 6)
kit.part('cart', bm, 'metal', bevel=0.004)
bm = bmesh.new()
kit.box(bm, (x0 + 0.95, 3.35, 0.9), (0.18, 0.12, 0.12))
kit.box(bm, (x0 + 1.16, 3.45, 0.88), (0.12, 0.18, 0.08))
kit.part('cart_kit', bm, 'paint_ember', bevel=0.01)

kit.export(OUT)
print('medbay:', OUT, len(bpy.data.objects), 'objects')
