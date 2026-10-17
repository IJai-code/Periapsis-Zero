"""The Kestrel's cockpit, seen from the pilot's seat.

    blender -b --factory-startup --python art/godot/kestrel_cockpit.py -- game/art/kestrel-cockpit.glb

In the ship's own space (ships.py: +Y forward, the pilot's eye at
(0, 3.35, 1.12)), so the game hangs it on the ship as it is. A dash of
wood and brass: the main screen in the middle, the ship's status screen
on the left (green), three round knobs and a fuel dial on the right, the
master alarm, a curved yoke on its column, the throttle by the right
hand, riveted side panels, the seat. The live parts are named for the
game to drive: screen_main, screen_status, dial_needle (turns about +Y),
alarm_lamp, knob_*.
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
kit.reset()
mats = {}


def m(name):
    if name not in mats:
        mats[name] = bmesh.new()
    return mats[name]


def beam(bm, a, b, w):
    a, b = V(a), V(b)
    d = b - a
    rot = d.normalized().to_track_quat('Z', 'Y').to_matrix()
    kit.box(bm, (a + b) / 2, (w, w, d.length), rot)


# The dash and everything on it sit this much further forward and lower
# than written below (room in front of the pilot).
SHIFT = V((0.0, 0.3, -0.06))
# And all of it this much higher, above the hull's deck under the canopy
# (the pilot's eye is at 1.3 in the game).
LIFT = V((0.0, 0.0, 0.18))


def shift(bm):
    for v in bm.verts:
        if v.co.y > 3.6:
            v.co += SHIFT
        v.co += LIFT


def own(name, mat, build):
    """A separate object the game can find by name."""
    bm = bmesh.new()
    build(bm)
    shift(bm)
    o = kit.part(name, bm, mat)
    for mod in list(o.modifiers):
        o.modifiers.remove(mod)
    for p in o.data.polygons:
        p.use_smooth = False
    return o


TILT = Matrix.Rotation(math.radians(-32), 3, 'X')
# The dash: a wooden shelf sloping toward the pilot, a dark front, brass trim.
kit.box(m('planks'), (0, 4.25, 0.88), (1.16, 0.62, 0.06), Matrix.Rotation(math.radians(14), 3, 'X'))
kit.box(m('paint_dark'), (0, 3.96, 0.64), (1.14, 0.08, 0.44))
kit.box(m('trim'), (0, 3.93, 0.87), (1.18, 0.05, 0.035))
kit.box(m('paint_dark'), (0, 4.4, 0.55), (1.1, 0.8, 0.5))
# The main screen's housing, its bezel, the screen itself.
kit.box(m('beam'), (0, 4.12, 1.0), (0.46, 0.08, 0.34), TILT)
kit.box(m('trim'), (0, 4.09, 1.0), (0.44, 0.02, 0.31), TILT)
own('screen_main', 'screen_main', lambda bm: kit.box(bm, (0, 4.075, 1.0), (0.38, 0.01, 0.25), TILT))
# The status screen, left, turned toward the pilot.
L = Matrix.Rotation(math.radians(24), 3, 'Z') @ Matrix.Rotation(math.radians(-22), 3, 'X')
kit.box(m('beam'), (-0.4, 4.02, 0.95), (0.3, 0.08, 0.27), L)
kit.box(m('trim'), (-0.395, 4.0, 0.95), (0.28, 0.02, 0.25), L)
own('screen_status', 'screen_status', lambda bm: kit.box(bm, (-0.392, 3.987, 0.95), (0.23, 0.01, 0.2), L))
# The master alarm: a red lamp in a brass cup, top left.
kit.box(m('trim'), (-0.44, 4.18, 1.13), (0.12, 0.07, 0.08))
own('alarm_lamp', 'alarm_lamp', lambda bm: kit.box(bm, (-0.44, 4.145, 1.13), (0.09, 0.02, 0.055)))
# Right: three knobs on a little box, a fuel dial under them.
R = Matrix.Rotation(math.radians(-24), 3, 'Z') @ Matrix.Rotation(math.radians(-22), 3, 'X')
kit.box(m('beam'), (0.4, 4.04, 0.97), (0.3, 0.1, 0.13), R)
for i, (col, x) in enumerate((('knob_blue', 0.32), ('knob_teal', 0.4), ('knob_cream', 0.48))):
    own(col, col, lambda bm, x=x: kit.sphere(bm, (x, 3.98 + (x - 0.32) * 0.35, 1.05), 0.022, 10))
kit.cylinder(m('trim'), (0.4, 3.99, 0.84), (0.4, 3.95, 0.84), 0.075, 20)
kit.cylinder(m('paint_bone'), (0.4, 3.95, 0.84), (0.4, 3.945, 0.84), 0.065, 20)
own('dial_needle', 'paint_ember', lambda bm: kit.box(bm, (0.4, 3.94, 0.865), (0.006, 0.004, 0.05)))
# The yoke: a curved bar on a column.
kit.cylinder(m('paint_dark'), (0, 3.85, 0.45), (0, 3.72, 0.8), 0.04, 10)
pts = []
for i in range(13):
    a = math.radians(-70 + 140 * i / 12)
    pts.append(V((math.sin(a) * 0.17, 3.7, 0.82 + math.cos(a) * 0.08 - 0.08)))
for a, b in zip(pts, pts[1:]):
    kit.cylinder(m('rubber'), a, b, 0.018, 8)
kit.box(m('trim'), (0, 3.71, 0.8), (0.06, 0.04, 0.05))
# The throttle by the right hand.
kit.box(m('paint_dark'), (0.43, 3.45, 0.6), (0.12, 0.4, 0.1))
beam(m('metal'), (0.43, 3.45, 0.64), (0.43, 3.55, 0.85), 0.018)
kit.sphere(m('paint_ember'), (0.43, 3.56, 0.87), 0.03, 10)
# Side panels, riveted, a grab handle each side.
for sx in (-1, 1):
    kit.box(m('paint_grey'), (sx * 0.6, 3.6, 0.72), (0.05, 1.3, 0.55))
    for k in range(6):
        for z in (0.5, 0.95):
            kit.sphere(m('trim'), (sx * 0.575, 3.05 + k * 0.22, z), 0.01, 6)
    beam(m('metal'), (sx * 0.57, 3.2, 1.0), (sx * 0.57, 3.7, 1.02), 0.02)
    kit.box(m('planks'), (sx * 0.56, 3.75, 0.98), (0.1, 0.5, 0.03))
# Little switches along the dash's lip.
for i in range(7):
    x = -0.24 + i * 0.08
    kit.box(m('paint_bone'), (x, 3.94, 0.78), (0.03, 0.015, 0.05))
    beam(m('metal'), (x, 3.93, 0.79), (x, 3.9, 0.82), 0.008)
# The seat.
kit.box(m('paint_dark'), (0, 3.15, 0.5), (0.6, 0.6, 0.12))
kit.box(m('blanket'), (0, 3.15, 0.58), (0.52, 0.52, 0.06))
kit.box(m('paint_dark'), (0, 2.85, 0.95), (0.6, 0.12, 0.9), Matrix.Rotation(math.radians(10), 3, 'X'))
kit.box(m('floor'), (0, 3.5, 0.42), (1.1, 1.5, 0.04))

for name, bm in mats.items():
    shift(bm)
    o = kit.part(f'cockpit_{name}', bm, name)
    for mod in list(o.modifiers):
        o.modifiers.remove(mod)
    for p in o.data.polygons:
        p.use_smooth = False
kit.export(OUT)
print('cockpit: done', OUT)
