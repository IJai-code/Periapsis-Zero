"""Hearth village, on Hearthstone in the Reach: timber space-punk.

    blender -b --factory-startup --python art/godot/hearth_village.py -- <out dir>

Writes one GLB per piece into <out dir> (village-<name>.glb), each with its
origin on the ground at its footprint's centre, front toward -Y (Godot -Z).
The game stands them on the sphere round the village landmark
(game/scripts/reach/village.gd). Surfaces are material names only
(game/scripts/art/surfaces.gd); every object is flat-shaded and merged per
material.

Pieces: cabin_a (a log cabin with a porch and a stone chimney), cabin_b (a
smaller one with a lean-to), tower (the launch tower: a timber scaffold with
a gantry arm), observatory (a stone drum under a dome, a telescope through
its slit), lookout (a tall tower with a roofed platform), lamp (a post with a
hanging lantern), fence, crate, barrel, bench (a split log), sign, mast (a
radio mast with guy wires), mine (a timber mouth for a tunnel), table.
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


class Mats:
    def __init__(self):
        self.b = {}

    def __call__(self, name):
        if name not in self.b:
            self.b[name] = bmesh.new()
        return self.b[name]

    def done(self, prefix):
        for name, bm in self.b.items():
            o = kit.part(f'{prefix}_{name}', bm, name)
            for mod in list(o.modifiers):
                o.modifiers.remove(mod)
            for p in o.data.polygons:
                p.use_smooth = False
        self.b = {}


def beam(bm, a, b, w):
    """A square timber from a to b."""
    a, b = V(a), V(b)
    d = b - a
    rot = d.normalized().to_track_quat('Z', 'Y').to_matrix()
    kit.box(bm, (a + b) / 2, (w, w, d.length), rot)


def gable(m, w, d, h, over, mat='roof_tiles', pitch=0.55):
    """A pitched roof over a w x d plan whose walls stop at height h."""
    bm = m(mat)
    ridge = h + (w / 2 + over) * pitch
    for side in (-1, 1):
        x0 = side * (w / 2 + over)
        verts = [
            bm.verts.new((x0, -d / 2 - over, h - over * pitch)),
            bm.verts.new((x0, d / 2 + over, h - over * pitch)),
            bm.verts.new((0, d / 2 + over, ridge)),
            bm.verts.new((0, -d / 2 - over, ridge)),
        ]
        top = bmesh.ops.extrude_face_region(bm, geom=[bm.faces.new(verts)])
        moved = [e for e in top['geom'] if isinstance(e, bmesh.types.BMVert)]
        bmesh.ops.translate(bm, verts=moved, vec=(0, 0, 0.12))
    # Gable ends.
    g = m('wood_siding')
    for y in (-d / 2, d / 2):
        tri = [g.verts.new((-w / 2, y, h)), g.verts.new((w / 2, y, h)), g.verts.new((0, y, h + w / 2 * pitch))]
        g.faces.new(tri)
        g.faces.new(list(reversed([g.verts.new(v.co) for v in tri])))
    return ridge


def cabin_a():
    m = Mats()
    w, d, h = 6.4, 5.2, 3.0
    kit.box(m('stone'), (0, 0, 0.2), (w + 0.4, d + 0.4, 0.4))
    kit.box(m('wood_siding'), (0, 0, 0.4 + h / 2), (w, d, h))
    # Corner posts and a sill beam, darker.
    for x in (-w / 2, w / 2):
        for y in (-d / 2, d / 2):
            kit.box(m('beam'), (x, y, 0.4 + h / 2), (0.3, 0.3, h + 0.05))
    for y in (-d / 2 - 0.02, d / 2 + 0.02):
        kit.box(m('beam'), (0, y, 0.45), (w + 0.2, 0.18, 0.2))
        kit.box(m('beam'), (0, y, 0.4 + h), (w + 0.2, 0.2, 0.22))
    gable(m, w, d, 0.4 + h, 0.6)
    # Door and windows on the front (-Y), lit windows round the sides.
    kit.box(m('beam'), (0.9, -d / 2 - 0.06, 1.45), (1.1, 0.12, 2.1))
    kit.box(m('metal_dark'), (1.3, -d / 2 - 0.14, 1.4), (0.08, 0.06, 0.08))
    for x in (-1.7,):
        kit.box(m('window_glow'), (x, -d / 2 - 0.04, 2.0), (1.1, 0.06, 0.9))
        kit.box(m('beam'), (x, -d / 2 - 0.1, 1.5), (1.4, 0.16, 0.12))
    for y in (-0.8, 1.2):
        kit.box(m('window_glow'), (w / 2 + 0.04, y, 2.0), (0.06, 0.9, 0.8))
        kit.box(m('window_glow'), (-w / 2 - 0.04, y, 2.0), (0.06, 0.9, 0.8))
    # The porch: a plank deck on stumps, two posts, a rail.
    kit.box(m('planks'), (0, -d / 2 - 1.1, 0.35), (w + 0.4, 2.2, 0.14))
    for x in (-w / 2, w / 2):
        kit.box(m('beam'), (x, -d / 2 - 2.05, 1.9), (0.22, 0.22, 3.1))
    kit.box(m('roof_tiles'), (0, -d / 2 - 1.2, 3.35), (w + 0.6, 2.6, 0.12), Matrix.Rotation(-0.22, 3, 'X'))
    for x in (-w / 2 + 0.6, w / 2 - 0.6):
        kit.box(m('beam'), (x, -d / 2 - 2.05, 0.95), (1.4, 0.1, 0.1))
    kit.box(m('planks'), (0.9, -d / 2 - 2.5, 0.18), (1.2, 0.6, 0.12))
    # The chimney.
    kit.box(m('stone'), (-w / 2 + 0.6, d / 2 - 0.7, 3.3), (0.8, 0.8, 5.2))
    kit.box(m('stone'), (-w / 2 + 0.6, d / 2 - 0.7, 5.95), (1.0, 1.0, 0.2))
    m.done('cabin_a')


def cabin_b():
    m = Mats()
    w, d, h = 4.6, 4.0, 2.8
    kit.box(m('stone'), (0, 0, 0.18), (w + 0.3, d + 0.3, 0.36))
    kit.box(m('wood_siding'), (0, 0, 0.36 + h / 2), (w, d, h))
    for x in (-w / 2, w / 2):
        for y in (-d / 2, d / 2):
            kit.box(m('beam'), (x, y, 0.36 + h / 2), (0.26, 0.26, h + 0.05))
    gable(m, w, d, 0.36 + h, 0.5, pitch=0.65)
    kit.box(m('beam'), (-0.8, -d / 2 - 0.06, 1.35), (1.0, 0.12, 2.0))
    kit.box(m('window_glow'), (1.0, -d / 2 - 0.04, 1.9), (1.3, 0.06, 1.0))
    kit.box(m('beam'), (1.0, -d / 2 - 0.1, 1.35), (1.6, 0.16, 0.12))
    # A lean-to on the side: a woodpile under a slanted roof.
    kit.box(m('roof_tiles'), (w / 2 + 1.0, 0, 2.3), (2.4, d, 0.1), Matrix.Rotation(0.35, 3, 'Y'))
    for y in (-d / 2 + 0.2, d / 2 - 0.2):
        kit.box(m('beam'), (w / 2 + 2.0, y, 1.0), (0.18, 0.18, 2.0))
    for k in range(5):
        for j in range(3):
            kit.cylinder(m('bark'), (w / 2 + 0.4 + j * 0.42, -1.4, 0.2 + k * 0.38), (w / 2 + 0.4 + j * 0.42, 1.4, 0.2 + k * 0.38), 0.18, 7)
    m.done('cabin_b')


def tower():
    """The launch tower: four legs braced every three metres, a platform at
    the top, a gantry arm reaching out over the pad, lamps."""
    m = Mats()
    s = 2.2
    top = 13.0
    for x in (-s, s):
        for y in (-s, s):
            beam(m('beam'), (x * 1.15, y * 1.15, 0), (x, y, top), 0.32)
    z = 0.4
    while z < top:
        for (a, b) in (((-s, -s), (s, -s)), ((s, -s), (s, s)), ((s, s), (-s, s)), ((-s, s), (-s, -s))):
            beam(m('beam'), (a[0], a[1], z), (b[0], b[1], z), 0.2)
            beam(m('beam'), (a[0], a[1], z), (b[0], b[1], z + 3.0), 0.14)
        z += 3.0
    kit.box(m('planks'), (0, 0, top), (2 * s + 1.0, 2 * s + 1.0, 0.25))
    for x in (-s - 0.4, s + 0.4):
        kit.box(m('beam'), (x, 0, top + 0.6), (0.12, 2 * s + 0.8, 0.08))
    kit.box(m('beam'), (0, -s - 0.4, top + 0.6), (2 * s + 0.8, 0.12, 0.08))
    # The arm over the pad (+X), and a hose hanging from it.
    beam(m('metal'), (s, 0, top - 0.5), (s + 9.0, 0, top - 0.5), 0.4)
    beam(m('metal'), (s, 0, top - 2.6), (s + 6.0, 0, top - 0.7), 0.18)
    kit.cylinder(m('rubber'), (s + 8.6, 0, top - 0.6), (s + 8.6, 0, top - 4.5), 0.09, 8)
    # Lamps on the corners.
    for x in (-s, s):
        for y in (-s, s):
            kit.sphere(m('lantern'), (x, y, top + 0.35), 0.16, 8)
    kit.box(m('roof_tiles'), (0, 0, top + 2.6), (2 * s + 1.6, 2 * s + 1.6, 0.14))
    for x in (-s, s):
        for y in (-s, s):
            kit.box(m('beam'), (x, y, top + 1.35), (0.18, 0.18, 2.5))
    m.done('tower')


def observatory():
    m = Mats()
    r = 3.6
    kit.cylinder(m('stone'), (0, 0, 0), (0, 0, 3.2), r, 24)
    kit.cylinder(m('beam'), (0, 0, 3.1), (0, 0, 3.4), r + 0.25, 24)
    # The dome: a half sphere of metal.
    bm = m('metal')
    res = bmesh.ops.create_uvsphere(bm, u_segments=24, v_segments=12, radius=r)
    bmesh.ops.delete(bm, geom=[v for v in res['verts'] if v.co.z < -0.01], context='VERTS')
    bmesh.ops.translate(bm, verts=[v for v in bm.verts if v.co.z > -0.02 and v.co.length < r + 0.01], vec=(0, 0, 3.4))
    # The slit and the telescope out of it.
    kit.box(m('metal_dark'), (0, -r * 0.55, 6.0), (0.9, r * 1.1, 1.4), Matrix.Rotation(-0.6, 3, 'X'))
    beam(m('metal'), (0, -0.5, 4.6), (0, -r - 1.0, 7.2), 0.7)
    kit.cylinder(m('metal_dark'), (0, -r - 0.9, 7.15), (0, -r - 1.2, 7.35), 0.42, 12)
    kit.box(m('beam'), (0, -r - 0.05, 1.2), (1.2, 0.2, 2.3))
    kit.box(m('window_glow'), (r * 0.7, -r * 0.7, 2.0), (0.8, 0.08, 0.7), Matrix.Rotation(math.radians(45), 3, 'Z'))
    kit.box(m('planks'), (0, -r - 1.0, 0.12), (2.2, 1.8, 0.14))
    m.done('observatory')


def lookout():
    m = Mats()
    s = 1.3
    top = 9.0
    for x in (-s, s):
        for y in (-s, s):
            beam(m('beam'), (x * 1.25, y * 1.25, 0), (x, y, top + 2.4), 0.24)
    z = 0.5
    while z < top:
        for (a, b) in (((-s, -s), (s, -s)), ((s, -s), (s, s)), ((s, s), (-s, s)), ((-s, s), (-s, -s))):
            beam(m('beam'), (a[0], a[1], z), (b[0], b[1], z + 2.2), 0.12)
        z += 2.2
    kit.box(m('planks'), (0, 0, top), (2 * s + 1.4, 2 * s + 1.4, 0.2))
    for x in (-s - 0.6, s + 0.6):
        kit.box(m('beam'), (x, 0, top + 0.55), (0.1, 2 * s + 1.2, 0.08))
    for y in (-s - 0.6, s + 0.6):
        kit.box(m('beam'), (0, y, top + 0.55), (2 * s + 1.2, 0.1, 0.08))
    gable(m, 2 * s + 0.6, 2 * s + 0.6, top + 2.4, 0.4, pitch=0.7)
    # A ladder up one side.
    for x in (-0.3, 0.3):
        beam(m('beam'), (x, -s * 1.35, 0), (x, -s - 0.05, top), 0.08)
    for k in range(1, int(top / 0.4)):
        t = k * 0.4 / top
        y = -s * 1.35 + (s * 0.35 - 0.05) * t
        kit.box(m('beam'), (0, y, k * 0.4), (0.6, 0.06, 0.05))
    kit.sphere(m('lantern'), (0, 0, top + 2.0), 0.18, 8)
    m.done('lookout')


def lamp():
    m = Mats()
    beam(m('beam'), (0, 0, 0), (0, 0, 2.6), 0.16)
    beam(m('beam'), (0, 0, 2.45), (0, -0.55, 2.45), 0.1)
    kit.box(m('metal_dark'), (0, -0.55, 2.12), (0.28, 0.28, 0.06))
    kit.box(m('lantern'), (0, -0.55, 1.95), (0.22, 0.22, 0.32))
    kit.box(m('metal_dark'), (0, -0.55, 1.77), (0.26, 0.26, 0.04))
    m.done('lamp')


def fence():
    m = Mats()
    for x in (-1.5, 1.5):
        kit.box(m('beam'), (x, 0, 0.55), (0.14, 0.14, 1.1))
    for z in (0.45, 0.95):
        kit.box(m('planks'), (0, 0, z), (3.2, 0.08, 0.14))
    m.done('fence')


def crate():
    m = Mats()
    kit.box(m('planks'), (0, 0, 0.4), (0.8, 0.8, 0.8))
    for z in (0.08, 0.72):
        kit.box(m('beam'), (0, 0, z), (0.86, 0.86, 0.1))
    m.done('crate')


def barrel():
    m = Mats()
    kit.cylinder(m('planks'), (0, 0, 0), (0, 0, 1.0), 0.38, 12)
    for z in (0.15, 0.85):
        kit.cylinder(m('metal_dark'), (0, 0, z - 0.03), (0, 0, z + 0.03), 0.4, 12)
    m.done('barrel')


def bench():
    m = Mats()
    kit.cylinder(m('bark'), (-1.2, 0, 0.3), (1.2, 0, 0.3), 0.26, 9)
    kit.box(m('planks'), (0, 0, 0.5), (2.3, 0.42, 0.1))
    m.done('bench')


def sign():
    m = Mats()
    beam(m('beam'), (0, 0, 0), (0, 0, 2.2), 0.12)
    kit.box(m('planks'), (0.55, -0.08, 1.85), (1.2, 0.06, 0.32))
    kit.box(m('planks'), (-0.5, -0.08, 1.45), (1.1, 0.06, 0.3))
    m.done('sign')


def mast():
    m = Mats()
    beam(m('metal'), (0, 0, 0), (0, 0, 12.0), 0.18)
    for k in range(4):
        z = 3.0 + k * 2.5
        kit.box(m('metal'), (0, 0, z), (1.2 - k * 0.2, 0.06, 0.06))
    kit.sphere(m('lantern'), (0, 0, 12.1), 0.14, 8)
    for a in (0, 2.1, 4.2):
        beam(m('cable'), (0, 0, 9.0), (math.cos(a) * 5.0, math.sin(a) * 5.0, 0.05), 0.025)
    m.done('mast')


def mine():
    m = Mats()
    for x in (-1.4, 1.4):
        kit.box(m('beam'), (x, 0, 1.4), (0.32, 0.32, 2.8))
    kit.box(m('beam'), (0, 0, 2.85), (3.4, 0.36, 0.32))
    for y in (1.2, 2.4, 3.6):
        for x in (-1.4, 1.4):
            kit.box(m('beam'), (x, y, 1.4), (0.26, 0.26, 2.8))
        kit.box(m('beam'), (0, y, 2.8), (3.2, 0.28, 0.26))
    kit.box(m('planks'), (0, -0.5, 3.4), (1.8, 0.08, 0.5), Matrix.Rotation(-0.15, 3, 'X'))
    for k in range(9):
        kit.box(m('metal_dark'), (0, -1.5 + k * 0.7, 0.05), (1.2, 0.1, 0.06))
    for x in (-0.45, 0.45):
        kit.box(m('metal'), (x, 1.3, 0.1), (0.06, 6.0, 0.06))
    kit.sphere(m('lantern'), (1.2, -0.25, 2.5), 0.14, 8)
    m.done('mine')


def table():
    m = Mats()
    kit.box(m('planks'), (0, 0, 0.78), (1.8, 0.9, 0.08))
    for x in (-0.75, 0.75):
        for y in (-0.35, 0.35):
            kit.box(m('beam'), (x, y, 0.38), (0.1, 0.1, 0.76))
    m.done('table')


os.makedirs(OUT, exist_ok=True)
for fn in (cabin_a, cabin_b, tower, observatory, lookout, lamp, fence, crate, barrel, bench, sign, mast, mine, table):
    kit.reset()
    fn()
    kit.export(os.path.join(OUT, f'village-{fn.__name__}.glb'))
print('village: done', OUT)
