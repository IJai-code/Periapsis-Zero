"""The Kestrel's cockpit and the well behind it, seen from the pilot's seat.

    blender -b --factory-startup --python art/godot/kestrel_cockpit.py -- game/art/kestrel-cockpit.glb

In the ship's own space (ships.py: +Y forward, +Z up), so the game hangs
it on the ship as it is; the pilot's eye is at (0, 3.35, 1.30), which is
(0, 1.3, -3.35) in the game.

A small working cockpit of wood, brass and painted steel, wrapped round
the pilot: a three-panel dash under the canopy (the main screen in the
middle under a hood; the ship's status screen and the master alarm on the
left; a big dial, three knobs and a row of switches on the right), a wooden
shelf along its top with a brass lip, quilted side walls with a pipe and a
cable run along them, a side console with levers by each hand, a yoke, the
pedals, a bucket seat with a harness, and behind it the well the belly
hatch opens into: a ladder down, a striped rim, a back wall with the ship
log's terminal, a lamp, a shelf with a mug and a carved bird.

The live parts are named for the game: screen_main, screen_status (the
game lays its drawn screens over them), dial_needle (its origin at the
dial's centre, turning about its own +Z), alarm_lamp, knob_*. The script
prints where the two screens are, in the game's axes, for the game to use.
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


def own(name, mat, build):
    """A separate object the game can find by name."""
    bm = bmesh.new()
    build(bm)
    return kit.part(name, bm, mat)


def rx(deg):
    return Matrix.Rotation(math.radians(deg), 3, 'X')


def rz(deg):
    return Matrix.Rotation(math.radians(deg), 3, 'Z')


class Panel:
    """One face of the dash: a frame whose -Y faces the pilot and whose +Z
    runs up the face. at(u, v, out) is a point on it, `out` toward the pilot."""

    def __init__(self, face, turn, tilt, w, h, d):
        self.face = V(face)
        self.rot = rz(turn) @ rx(-tilt)
        self.w, self.h, self.d = w, h, d

    def at(self, u, v, out=0.0):
        return self.face + self.rot @ V((u, -out, v))

    def normal(self):
        return self.rot @ V((0, -1, 0))

    def body(self, bm):
        kit.box(bm, self.at(0, 0, -self.d / 2), (self.w, self.d, self.h), self.rot)

    def plate(self, bm, u, v, w, h, out, thick):
        kit.box(bm, self.at(u, v, out + thick / 2), (w, thick, h), self.rot)

    def disc(self, bm, u, v, r, out, thick, seg=20):
        a = self.at(u, v, out)
        b = self.at(u, v, out + thick)
        kit.cylinder(bm, a, b, r, seg)


# --- The dash -----------------------------------------------------------------

TILT = 20.0
centre = Panel((0.0, 4.1, 0.96), 0.0, TILT, 0.64, 0.44, 0.34)
hinge_l = V((-0.31, 4.1, 0.96))
left = Panel(hinge_l + V((-math.cos(math.radians(30)), -math.sin(math.radians(30)), 0)) * 0.18, 30.0, TILT, 0.36, 0.44, 0.34)
right = Panel(V((-left.face.x, left.face.y, left.face.z)), -30.0, TILT, 0.36, 0.5, 0.34)

for p in (centre, left, right):
    p.body(m('paint_dark'))
    # The console under the face, down to the floor.
    base = p.at(0, -p.h / 2, -p.d / 2)
    kit.box(m('paint_dark'), (base.x, base.y + 0.04, (base.z + 0.42) / 2), (p.w * 0.98, p.d, base.z - 0.42), rz(30.0 if p is left else (-30.0 if p is right else 0.0)))
    # A brass frame round each face, screwed at its corners.
    for u, v, w, h in ((0, p.h / 2 - 0.012, p.w, 0.024), (0, -p.h / 2 + 0.012, p.w, 0.024),
                       (p.w / 2 - 0.012, 0, 0.024, p.h), (-p.w / 2 + 0.012, 0, 0.024, p.h)):
        p.plate(m('trim'), u, v, w, h, 0.0, 0.012)
    for su in (-1, 1):
        for sv in (-1, 1):
            p.disc(m('metal'), su * (p.w / 2 - 0.012), sv * (p.h / 2 - 0.012), 0.007, 0.012, 0.006, 8)

# The shelf along the top: oiled planks, a brass lip toward the pilot.
for p, turn in ((centre, 0.0), (left, 30.0), (right, -30.0)):
    top = p.at(0, p.h / 2, -0.15) + V((0, 0, 0.03))
    rot = rz(turn) @ rx(6)
    kit.box(m('planks'), top, (p.w + 0.01, 0.42, 0.035), rot)
    lip = p.at(0, p.h / 2, 0.03) + V((0, 0, 0.035))
    kit.box(m('trim'), lip, (p.w + 0.01, 0.025, 0.02), rz(turn))

# Main screen, centre: bezel, the glass, a hood over it against the glare.
SCREEN_MAIN = (0.0, 0.01, 0.48, 0.3)
u, v, w, h = SCREEN_MAIN
centre.plate(m('beam'), u, v, w + 0.07, h + 0.07, 0.0, 0.03)
centre.plate(m('trim'), u, v, w + 0.035, h + 0.035, 0.03, 0.006)
own('screen_main', 'screen_main', lambda bm: centre.plate(bm, u, v, w, h, 0.036, 0.004))
hood_c = centre.at(0, v + h / 2 + 0.03, 0.07)
kit.box(m('paint_dark'), hood_c, (w + 0.08, 0.15, 0.018), centre.rot @ rx(-55))
for su in (-1, 1):
    kit.box(m('paint_dark'), centre.at(su * (w / 2 + 0.035), v + h / 2 - 0.02, 0.06), (0.014, 0.12, 0.1), centre.rot)
# Under it: a row of toggle switches on a bone label strip, two push buttons.
centre.plate(m('paint_bone'), 0, -0.172, 0.46, 0.03, 0.0, 0.004)
for i in range(7):
    x = -0.18 + i * 0.06
    centre.disc(m('trim'), x, -0.195, 0.011, 0.0, 0.008, 10)
    a = centre.at(x, -0.195, 0.008)
    b = centre.at(x, -0.185 + (0.01 if i % 3 else -0.015), 0.045)
    kit.cylinder(m('metal'), a, b, 0.0035, 6)
for x, col in ((-0.27, 'paint_ember'), (0.27, 'pipe_ion')):
    centre.disc(m('trim'), x, -0.17, 0.02, 0.0, 0.01, 14)
    centre.disc(m(col), x, -0.17, 0.014, 0.01, 0.012, 14)

# Left: the status screen, two little gauges, a row of breakers.
SCREEN_STATUS = (0.0, 0.04, 0.27, 0.22)
u2, v2, w2, h2 = SCREEN_STATUS
left.plate(m('beam'), u2, v2, w2 + 0.06, h2 + 0.06, 0.0, 0.028)
left.plate(m('trim'), u2, v2, w2 + 0.03, h2 + 0.03, 0.028, 0.006)
own('screen_status', 'screen_status', lambda bm: left.plate(bm, u2, v2, w2, h2, 0.034, 0.004))
for uu in (-0.085, 0.085):
    left.disc(m('trim'), uu, -0.15, 0.045, 0.0, 0.016, 20)
    left.disc(m('paint_bone'), uu, -0.15, 0.037, 0.016, 0.004, 20)
    a = left.at(uu, -0.15, 0.021)
    b = left.at(uu + 0.022, -0.15 + 0.02, 0.021)
    kit.cylinder(m('paint_ember'), a, b, 0.003, 4)
for i in range(5):
    left.plate(m('paint_bone' if i % 2 else 'metal'), -0.12 + i * 0.06, -0.2, 0.03, 0.018, 0.0, 0.012)
# The master alarm: a red dome in a brass cup on the shelf's left end.
alarm_at = left.at(-0.1, left.h / 2, -0.06) + V((0, 0, 0.07))
kit.cylinder(m('trim'), alarm_at - V((0, 0, 0.03)), alarm_at, 0.05, 16)
own('alarm_lamp', 'alarm_lamp', lambda bm: kit.sphere(bm, alarm_at + V((0, 0, 0.005)), 0.04, 14, (1, 1, 0.75)))

# Right: the big dial (speed), three knobs, a bank of switches.
DIAL = (0.0, 0.06, 0.09)
du, dv, dr = DIAL
right.disc(m('trim'), du, dv, dr + 0.012, 0.0, 0.03, 28)
right.disc(m('paint_bone'), du, dv, dr, 0.03, 0.004, 28)
for k in range(11):
    a = math.radians(210 - k * 24)
    p0 = right.at(du + math.cos(a) * dr * 0.78, dv + math.sin(a) * dr * 0.78, 0.035)
    p1 = right.at(du + math.cos(a) * dr * 0.92, dv + math.sin(a) * dr * 0.92, 0.035)
    kit.cylinder(m('paint_dark'), p0, p1, 0.0035, 4)
right.disc(m('metal'), du, dv, 0.012, 0.034, 0.01, 10)
# Glass over it.
right.disc(m('glass'), du, dv, dr, 0.05, 0.003, 28)
for i, (col, x) in enumerate((('knob_blue', -0.09), ('knob_teal', 0.0), ('knob_cream', 0.09))):
    right.disc(m('trim'), x, -0.115, 0.024, 0.0, 0.01, 14)
    own(col, col, lambda bm, x=x: right.disc(bm, x, -0.115, 0.018, 0.01, 0.026, 14))
for i in range(6):
    x = -0.125 + i * 0.05
    right.plate(m('paint_bone'), x, -0.19, 0.034, 0.02, 0.0, 0.004)
    a = right.at(x, -0.19, 0.004)
    b = right.at(x, -0.18, 0.04)
    kit.cylinder(m('metal'), a, b, 0.0035, 6)

# The yoke on its column, low enough to see the screen over.
col_base = V((0, 3.7, 0.44))
col_top = V((0, 3.58, 0.74))
kit.cylinder(m('paint_dark'), col_base, col_top, 0.035, 12)
kit.cylinder(m('rubber'), col_base, col_base + V((0, 0.04, 0.06)), 0.07, 14)
pts = []
for i in range(15):
    a = math.radians(-75 + 150 * i / 14)
    pts.append(V((math.sin(a) * 0.17, 3.56, 0.76 + (math.cos(a) - 1) * 0.07)))
for a, b in zip(pts, pts[1:]):
    kit.cylinder(m('rubber'), a, b, 0.017, 8)
kit.box(m('trim'), (0, 3.565, 0.745), (0.07, 0.04, 0.05))
for sx in (-1, 1):
    kit.cylinder(m('paint_ember'), pts[0 if sx < 0 else -1], pts[0 if sx < 0 else -1] + V((0, 0, 0.05)), 0.01, 8)
# Pedals.
for sx in (-1, 1):
    kit.box(m('metal_dark'), (sx * 0.16, 3.98, 0.52), (0.09, 0.03, 0.16), rx(-35))
    kit.cylinder(m('metal'), (sx * 0.16, 3.98, 0.45), (sx * 0.16, 4.08, 0.45), 0.01, 6)

# --- The tub: floor, side walls, sills, consoles -------------------------------

FLOOR_Z = 0.42
kit.box(m('grate'), (0, 3.25, FLOOR_Z), (1.12, 1.3, 0.03))
kit.box(m('floor'), (0, 4.15, FLOOR_Z - 0.01), (1.12, 0.7, 0.03))
for sx in (-1, 1):
    x = sx * 0.6
    # The wall, quilted: a padded panel per bay between ribs.
    kit.box(m('paint_grey'), (x + sx * 0.02, 2.65, 0.68), (0.03, 3.3, 0.56))
    for k in range(8):
        y = 1.22 + k * 0.36
        kit.box(m('blanket'), (x, y, 0.7), (0.035, 0.3, 0.42))
        for zz in (0.58, 0.7, 0.82):
            kit.sphere(m('trim'), (x - sx * 0.02, y, zz), 0.008, 6)
        beam(m('paint_dark'), (x - sx * 0.005, y + 0.18, 0.44), (x - sx * 0.005, y + 0.18, 0.96), 0.035)
    # The sill under the canopy's edge: a wooden rail, a grab handle.
    kit.box(m('planks'), (sx * 0.57, 2.55, 0.97), (0.12, 3.1, 0.04))
    kit.box(m('trim'), (sx * 0.51, 2.55, 0.985), (0.012, 3.1, 0.02))
    beam(m('metal'), (sx * 0.53, 2.75, 1.03), (sx * 0.53, 3.25, 1.05), 0.018)
    for y in (2.75, 3.25):
        beam(m('metal'), (sx * 0.53, y, 0.98), (sx * 0.53, y, 1.04), 0.016)
    # A pipe and a bundle of cable run along each wall.
    kit.cylinder(m('pipe_steel'), (x - sx * 0.04, 2.2, 0.5), (x - sx * 0.04, 3.95, 0.5), 0.022, 10)
    for yy in (2.4, 3.0, 3.6):
        kit.cylinder(m('trim'), (x - sx * 0.04, yy - 0.015, 0.5), (x - sx * 0.04, yy + 0.015, 0.5), 0.028, 10)
    for c, dz in (('cable', 0.0), ('rubber', 0.03), ('cable', 0.055)):
        kit.cylinder(m(c), (x - sx * 0.03, 2.2, 0.9 - dz), (x - sx * 0.03, 3.9, 0.9 - dz), 0.009, 6)
    # A side console under each hand.
    kit.box(m('paint_dark'), (sx * 0.5, 3.3, 0.66), (0.16, 0.7, 0.12))
    kit.box(m('planks'), (sx * 0.5, 3.3, 0.725), (0.17, 0.72, 0.02))
    kit.box(m('trim'), (sx * 0.43, 3.3, 0.73), (0.012, 0.72, 0.016))

# Right hand: the throttle quadrant, three levers with coloured knobs.
for i, col in enumerate(('paint_ember', 'pipe_ion', 'paint_bone')):
    x = 0.46 + i * 0.04
    kit.box(m('metal_dark'), (x, 3.38, 0.745), (0.012, 0.22, 0.012))
    a = V((x, 3.32 + i * 0.04, 0.745))
    b = a + V((0, 0.05, 0.13))
    kit.cylinder(m('metal'), a, b, 0.006, 6)
    kit.sphere(m(col), b, 0.02, 10)
# Left hand: the landing gear lever (a wheel on its knob) and a row of buttons.
kit.cylinder(m('metal'), (-0.48, 3.45, 0.74), (-0.48, 3.5, 0.86), 0.007, 6)
kit.cylinder(m('rubber'), (-0.48, 3.5, 0.86), (-0.48, 3.5, 0.885), 0.026, 14)
for i in range(4):
    kit.cylinder(m('paint_bone' if i % 2 else 'paint_ember'), (-0.52 + 0.0, 3.08 + i * 0.07, 0.735), (-0.52, 3.08 + i * 0.07, 0.745), 0.014, 10)
# A map clipped to the left wall; a mug in a ring on the right console.
kit.box(m('paint_bone'), (-0.575, 2.85, 0.76), (0.004, 0.24, 0.18), rx(4))
kit.box(m('trim'), (-0.57, 2.85, 0.86), (0.01, 0.07, 0.02))
kit.cylinder(m('trim'), (0.53, 3.05, 0.735), (0.53, 3.05, 0.75), 0.045, 14)
kit.cylinder(m('paint_ember'), (0.53, 3.05, 0.745), (0.53, 3.05, 0.84), 0.035, 14)
kit.cylinder(m('paint_dark'), (0.53, 3.05, 0.838), (0.53, 3.05, 0.842), 0.031, 14)

# --- The seat --------------------------------------------------------------------

SEAT_Y = 3.08
kit.box(m('metal_dark'), (0, SEAT_Y, 0.5), (0.36, 0.42, 0.14))
kit.box(m('paint_dark'), (0, SEAT_Y + 0.02, 0.6), (0.54, 0.52, 0.08))
kit.box(m('canvas'), (0, SEAT_Y + 0.03, 0.66), (0.46, 0.46, 0.06))
for sx in (-1, 1):
    kit.box(m('canvas'), (sx * 0.24, SEAT_Y + 0.03, 0.7), (0.07, 0.46, 0.08))
back = rx(12)
kit.box(m('paint_dark'), (0, SEAT_Y - 0.27, 1.0), (0.54, 0.08, 0.8), back)
kit.box(m('canvas'), (0, SEAT_Y - 0.22, 0.98), (0.44, 0.05, 0.66), back)
for sx in (-1, 1):
    kit.box(m('canvas'), (sx * 0.24, SEAT_Y - 0.2, 0.98), (0.07, 0.1, 0.66), back)
kit.box(m('canvas'), (0, SEAT_Y - 0.36, 1.46), (0.3, 0.1, 0.2), back)
# The harness: two shoulder straps over the back, a lap belt, a buckle.
for sx in (-1, 1):
    kit.box(m('canvas'), (sx * 0.1, SEAT_Y - 0.19, 1.1), (0.05, 0.012, 0.6), back)
kit.box(m('canvas'), (0, SEAT_Y + 0.18, 0.7), (0.46, 0.012, 0.05))
kit.box(m('trim'), (0, SEAT_Y + 0.19, 0.7), (0.07, 0.016, 0.06))

# --- Behind the seat: the well, the ladder, the back wall --------------------------
# The hatch (made by the game, hinged at y 1.0, 1.6 m long) opens into a
# shaft from the belly (z -0.5) up to the floor; a striped rim round it.

WELL_Y0, WELL_Y1 = 1.0, 2.6
for sx in (-1, 1):
    kit.box(m('paint_grey'), (sx * 0.54, (WELL_Y0 + WELL_Y1) / 2, -0.04), (0.03, WELL_Y1 - WELL_Y0, 0.92))
kit.box(m('paint_grey'), (0, WELL_Y0 - 0.02, -0.04), (1.1, 0.03, 0.92))
kit.box(m('paint_grey'), (0, WELL_Y1 + 0.02, -0.04), (1.1, 0.03, 0.92))
# A lamp in the well's front wall, over the ladder.
kit.box(m('trim'), (0, WELL_Y1, 0.2), (0.16, 0.03, 0.08))
kit.box(m('floor'), (0, (WELL_Y1 + SEAT_Y - 0.4) / 2 + 0.05, FLOOR_Z), (1.12, 0.3, 0.03))
for sx in (-1, 1):
    kit.box(m('hazard'), (sx * 0.5, (WELL_Y0 + WELL_Y1) / 2, FLOOR_Z + 0.005), (0.08, WELL_Y1 - WELL_Y0, 0.02))
kit.box(m('hazard'), (0, WELL_Y1 - 0.03, FLOOR_Z + 0.005), (1.08, 0.06, 0.02))
kit.box(m('hazard'), (0, WELL_Y0 + 0.05, FLOOR_Z + 0.005), (1.08, 0.08, 0.02))
# The ladder up the back of the well and on up the bulkhead.
for sx in (-1, 1):
    kit.box(m('metal'), (sx * 0.2, WELL_Y0 + 0.07, 0.25), (0.03, 0.03, 1.5))
for k in range(7):
    kit.cylinder(m('metal'), (-0.2, WELL_Y0 + 0.08, -0.35 + k * 0.22), (0.2, WELL_Y0 + 0.08, -0.35 + k * 0.22), 0.014, 8)
# The back wall over the well, up under the canopy's tail.
kit.box(m('paint_grey'), (0, WELL_Y0 - 0.02, 0.9), (1.16, 0.04, 0.96))
for x in (-0.4, 0.0, 0.4):
    beam(m('paint_dark'), (x, WELL_Y0 + 0.01, 0.44), (x, WELL_Y0 + 0.01, 1.36), 0.04)
# The ship log's terminal: a screen in a wooden case, a keyboard shelf.
kit.box(m('planks'), (0.32, WELL_Y0 + 0.08, 1.04), (0.36, 0.12, 0.3))
kit.box(m('beam'), (0.32, WELL_Y0 + 0.145, 1.05), (0.3, 0.012, 0.22))
own('screen_log', 'screen_status', lambda bm: kit.box(bm, (0.32, WELL_Y0 + 0.153, 1.05), (0.26, 0.004, 0.18)))
kit.box(m('planks'), (0.32, WELL_Y0 + 0.2, 0.86), (0.34, 0.2, 0.025))
for i in range(8):
    kit.box(m('paint_bone'), (0.2 + i * 0.034, WELL_Y0 + 0.22, 0.877), (0.026, 0.05, 0.012))
# A shelf on the left: a lamp, a mug, a carved bird.
kit.box(m('planks'), (-0.3, WELL_Y0 + 0.1, 1.0), (0.4, 0.16, 0.025))
for sx in (-1, 1):
    kit.box(m('trim'), (-0.3 + sx * 0.18, WELL_Y0 + 0.06, 0.96), (0.015, 0.08, 0.07))
kit.cylinder(m('trim'), (-0.42, WELL_Y0 + 0.1, 1.013), (-0.42, WELL_Y0 + 0.1, 1.12), 0.01, 8)
own('cabin_lamp', 'lamp', lambda bm: kit.sphere(bm, (-0.42, WELL_Y0 + 0.1, 1.15), 0.04, 12))
kit.cylinder(m('paint_ember'), (-0.3, WELL_Y0 + 0.1, 1.013), (-0.3, WELL_Y0 + 0.1, 1.09), 0.03, 12)
kit.sphere(m('planks'), (-0.17, WELL_Y0 + 0.1, 1.05), 0.03, 10, (1.4, 0.8, 0.9))
kit.sphere(m('planks'), (-0.13, WELL_Y0 + 0.1, 1.08), 0.018, 8)
kit.cylinder(m('paint_ember'), (-0.115, WELL_Y0 + 0.1, 1.08), (-0.095, WELL_Y0 + 0.1, 1.078), 0.006, 6, r2=0.001)

# The canopy's frame seen from inside: a pillar up each side from the
# dash's ends toward the top of the glass behind the head.
for sx in (-1, 1):
    kit.cylinder(m('paint_dark'), (sx * 0.56, 4.02, 1.1), (sx * 0.47, 3.0, 1.42), 0.024, 8)
    kit.cylinder(m('trim'), (sx * 0.56, 4.02, 1.1), (sx * 0.55, 3.9, 1.14), 0.03, 8)

for name, bm in mats.items():
    o = kit.part(f'cockpit_{name}', bm, name)
    for mod in list(o.modifiers):
        o.modifiers.remove(mod)
    for p in o.data.polygons:
        p.use_smooth = False

# The needle: its own object, origin at the dial's centre, turning about its
# local +Z (the dial's face normal).
bm = bmesh.new()
kit.box(bm, (0, dr * 0.42, 0), (0.008, dr * 0.84, 0.004))
kit.cylinder(bm, (0, 0, -0.002), (0, 0, 0.004), 0.014, 10)
needle = kit.part('dial_needle', bm, 'paint_ember')
for mod in list(needle.modifiers):
    needle.modifiers.remove(mod)
n = right.normal()
pivot = right.at(du, dv, 0.04)
basis = n.to_track_quat('Z', 'Y').to_matrix()
# Point the needle's zero (local +Y) up the dial's face.
up_face = right.rot @ V((0, 0, 1))
yl = basis @ V((0, 1, 0))
ang = math.atan2((yl.cross(up_face)).dot(n), yl.dot(up_face))
basis = Matrix.Rotation(ang, 3, n) @ basis
needle.matrix_world = Matrix.Translation(pivot) @ basis.to_4x4()

def game(p):
    return (round(p.x, 4), round(p.z, 4), round(-p.y, 4))

for label, panel, (uu, vv, ww, hh), out in (('main', centre, SCREEN_MAIN, 0.04), ('status', left, SCREEN_STATUS, 0.038)):
    print('SCREEN', label, 'at', game(panel.at(uu, vv, out)), 'normal', game(panel.normal()), 'size', (ww, hh))
kit.export(OUT)
print('cockpit: done', OUT)
