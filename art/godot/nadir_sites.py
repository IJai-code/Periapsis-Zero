"""The Nadir's places, built from code: the Tern, the survey skiff the
Founders sent after the gleam a century ago, holding station on its engines
three hundred metres over the Nadir; the relay buoy at the well's lip where
Tock, the family's robot, has waited ever since; and Tock.

    blender -b --factory-startup --python art/godot/nadir_sites.py -- <out dir> [piece ...]

Writes nadir-<name>.glb into <out dir>, each with its origin on its deck (or,
for Tock, at his feet) and its front toward Blender -Y (Godot +Z). Surfaces
are material names only (game/scripts/art/surfaces.gd).

Pieces:
  tern        the skiff: a walkable deck, a glass cabin with a doorway, a
              long hull under it, four engine bells firing down
  buoy        a round relay deck, its mast, dish and beacon, a tank under it
  tock_body   Tock: a stout rounded body on a ring thruster, two long arms
  tock_head   his head: a wide amber eye under a brow, two antennae
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import bmesh  # noqa: E402
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

    def done(self, prefix, smooth=()):
        for name, bm in self.b.items():
            o = kit.part(f'{prefix}_{name}', bm, name)
            for mod in list(o.modifiers):
                if mod.type == 'BEVEL':
                    o.modifiers.remove(mod)
            if name not in smooth:
                for p in o.data.polygons:
                    p.use_smooth = False
        self.b = {}


def beam(bm, a, b, w):
    a, b = V(a), V(b)
    d = b - a
    rot = d.normalized().to_track_quat('Z', 'Y').to_matrix()
    kit.box(bm, (a + b) / 2, (w, w, d.length), rot)


def ring(bm, centre, r, tube, segments=32, axis='Z'):
    """A torus round `axis`, as boxes: cheap, and flat-shaded it reads as metal."""
    cx, cy, cz = centre
    for i in range(segments):
        a0 = 2 * math.pi * i / segments
        a1 = 2 * math.pi * (i + 1) / segments
        if axis == 'Z':
            p0 = V((cx + math.cos(a0) * r, cy + math.sin(a0) * r, cz))
            p1 = V((cx + math.cos(a1) * r, cy + math.sin(a1) * r, cz))
        else:
            p0 = V((cx + math.cos(a0) * r, cy, cz + math.sin(a0) * r))
            p1 = V((cx + math.cos(a1) * r, cy, cz + math.sin(a1) * r))
        beam(bm, p0, p1, tube)


def railing(bm, pts, h=1.05, post=0.07, closed=True):
    n = len(pts)
    for i in range(n if closed else n - 1):
        a, b = V(pts[i]), V(pts[(i + 1) % n])
        beam(bm, (a.x, a.y, h), (b.x, b.y, h), 0.06)
        beam(bm, (a.x, a.y, h * 0.5), (b.x, b.y, h * 0.5), 0.04)
    for p in pts:
        beam(bm, (p[0], p[1], 0.0), (p[0], p[1], h), post)


def octagon(w, d, c):
    """An elongated octagon, w across x, d along y, corners cut by c."""
    return [(-w / 2 + c, -d / 2), (w / 2 - c, -d / 2), (w / 2, -d / 2 + c), (w / 2, d / 2 - c),
            (w / 2 - c, d / 2), (-w / 2 + c, d / 2), (-w / 2, d / 2 - c), (-w / 2, -d / 2 + c)]


def slab(bm, pts, z0, z1):
    """A prism on a polygon, from z0 to z1."""
    bottom = [bm.verts.new((x, y, z0)) for x, y in pts]
    top = [bm.verts.new((x, y, z1)) for x, y in pts]
    bm.faces.new(list(reversed(bottom)))
    bm.faces.new(top)
    n = len(pts)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((bottom[i], bottom[j], top[j], top[i]))


def tern():
    m = Mats()
    deck = octagon(18.0, 34.0, 3.5)
    # The deck: plates over a thick rim, walkable from end to end.
    slab(m('floor'), [(x * 0.98, y * 0.98) for x, y in deck], -0.25, 0.0)
    slab(m('hull'), deck, -0.9, -0.25)
    for i in range(-7, 7):
        kit.box(m('seam'), (0, i * 2.3, 0.005), (16.0, 0.06, 0.02))
    # The landing pad ahead of the cabin: a ring of soft light, clear of
    # everything (the Kestrel is 15 m long, 13 m across the wings).
    ring(m('light_soft'), (0, -5.5, 0.02), 7.0, 0.08, 40)
    railing(m('metal'), [(x * 0.97, y * 0.97) for x, y in deck])
    # The cabin, aft: a glass dome on a ring, its doorway toward the bow.
    cx, cy, cr = 0.0, 11.0, 4.4
    segs = 28
    for i in range(segs):
        a0 = 2 * math.pi * i / segs
        a1 = 2 * math.pi * (i + 1) / segs
        mid = (a0 + a1) / 2
        # The doorway: the two segments facing -Y left open.
        if abs(math.atan2(math.sin(mid + math.pi / 2), math.cos(mid + math.pi / 2))) < 0.24:
            continue
        p0 = (cx + math.cos(a0) * cr, cy + math.sin(a0) * cr)
        p1 = (cx + math.cos(a1) * cr, cy + math.sin(a1) * cr)
        kit.box(m('paint_bone'), ((p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2, 0.5), (math.dist(p0, p1) + 0.04, 0.3, 1.0),
                Matrix.Rotation(mid + math.pi / 2, 3, 'Z'))
        # Glass above the sill, in panes up to the crown.
        for k in range(5):
            e0 = k / 5 * math.pi / 2
            e1 = (k + 1) / 5 * math.pi / 2
            if k < 2 and abs(math.atan2(math.sin(mid + math.pi / 2), math.cos(mid + math.pi / 2))) < 0.45:
                continue
            q = [
                (cx + math.cos(a0) * cr * math.cos(e0), cy + math.sin(a0) * cr * math.cos(e0), 1.0 + math.sin(e0) * cr * 0.8),
                (cx + math.cos(a1) * cr * math.cos(e0), cy + math.sin(a1) * cr * math.cos(e0), 1.0 + math.sin(e0) * cr * 0.8),
                (cx + math.cos(a1) * cr * math.cos(e1), cy + math.sin(a1) * cr * math.cos(e1), 1.0 + math.sin(e1) * cr * 0.8),
                (cx + math.cos(a0) * cr * math.cos(e1), cy + math.sin(a0) * cr * math.cos(e1), 1.0 + math.sin(e1) * cr * 0.8),
            ]
            bm = m('dome_glass')
            vs = [bm.verts.new(p) for p in q]
            if len({tuple(round(c, 4) for c in p) for p in q}) == 4:
                bm.faces.new(vs)
            # Ribs between the panes.
            beam(m('metal'), q[0], q[3], 0.07)
    ring(m('metal'), (cx, cy, 1.0), cr, 0.12, segs)
    # The doorway's frame, a lintel over it.
    door_a = -math.pi / 2
    dx, dy = cx + math.cos(door_a) * cr, cy + math.sin(door_a) * cr
    for s in (-1, 1):
        beam(m('metal_dark'), (dx + s * 1.05, dy, 0.0), (dx + s * 1.05, dy, 2.4), 0.16)
    beam(m('metal_dark'), (dx - 1.1, dy, 2.4), (dx + 1.1, dy, 2.4), 0.18)
    kit.box(m('nav_green'), (dx, dy - 0.1, 2.55), (0.5, 0.08, 0.08))
    # Inside: Pip's seat at the console, facing the glass over the bow; the
    # console's screens; two bunks aft, two sleepers under blankets.
    kit.box(m('panel'), (0.0, cy - 2.0, 0.5), (2.6, 0.7, 1.0))
    kit.box(m('screen'), (-0.6, cy - 2.25, 1.12), (0.9, 0.06, 0.5), Matrix.Rotation(-0.5, 3, 'X'))
    kit.box(m('screen'), (0.6, cy - 2.25, 1.12), (0.9, 0.06, 0.5), Matrix.Rotation(-0.5, 3, 'X'))
    kit.box(m('paint_dark'), (0.0, cy - 0.9, 0.3), (0.7, 0.7, 0.6))
    kit.box(m('paint_dark'), (0.0, cy - 0.55, 0.85), (0.7, 0.12, 0.9))
    for s in (-1, 1):
        x = s * 2.4
        kit.box(m('metal_dark'), (x, cy + 1.4, 0.35), (1.0, 2.2, 0.7))
        kit.box(m('blanket'), (x, cy + 1.5, 0.78), (0.9, 1.8, 0.18))
        kit.sphere(m('linen'), (x, cy + 0.55, 0.85), 0.28, 10, (1.2, 0.8, 0.5))
        kit.sphere(m('blanket'), (x, cy + 1.3, 0.92), 0.36, 10, (1.0, 2.0, 0.55))
    kit.cylinder(m('light'), (0, cy, 4.3), (0, cy, 4.45), 0.5, 16)
    # Little things on the deck: crates lashed down, a cable reel, a toolbox.
    for (x, y, s) in ((-6.6, 6.5, 1.0), (-6.6, 7.9, 0.8), (6.6, 6.8, 0.9)):
        kit.box(m('container_bone'), (x, y, 0.5 * s), (1.1 * s, 1.1 * s, 1.0 * s))
        kit.box(m('seam'), (x, y, 0.5 * s), (1.14 * s, 0.08, 1.04 * s))
    kit.cylinder(m('cable'), (6.2, 4.6, 0.5), (7.0, 4.6, 0.5), 0.5, 16)
    # The mast at the bow: antenna, nav lights.
    beam(m('metal'), (0, -16.0, 0), (0, -16.0, 6.5), 0.18)
    beam(m('metal'), (-1.2, -16.0, 5.0), (1.2, -16.0, 5.0), 0.1)
    kit.sphere(m('nav_red'), (-1.3, -16.0, 5.0), 0.14, 8)
    kit.sphere(m('nav_green'), (1.3, -16.0, 5.0), 0.14, 8)
    kit.sphere(m('nav_white'), (0, -16.0, 6.7), 0.16, 8)
    # Under the deck: the hull, a long faceted spindle, nose forward.
    prof = [(-24.0, 0.4), (-21.0, 2.6), (-15.0, 4.2), (-5.0, 4.8), (6.0, 4.8), (14.0, 4.3), (18.5, 3.4), (20.0, 0.6)]
    bm = m('hull')
    rings_ = []
    for y, r in prof:
        rr = []
        for i in range(10):
            a = 2 * math.pi * i / 10
            rr.append(bm.verts.new((math.cos(a) * r, y, -4.6 + math.sin(a) * r * 0.8)))
        rings_.append(rr)
    for k in range(len(rings_) - 1):
        for i in range(10):
            j = (i + 1) % 10
            bm.faces.new((rings_[k][i], rings_[k][j], rings_[k + 1][j], rings_[k + 1][i]))
    bm.faces.new(list(reversed(rings_[0])))
    bm.faces.new(rings_[-1])
    for y in (-15.0, -5.0, 6.0, 14.0):
        kit.cylinder(m('seam'), (0, y - 0.06, -4.6), (0, y + 0.06, -4.6), 4.9, 10)
    # Struts from deck to hull.
    for (x, y) in ((-6.0, -10.0), (6.0, -10.0), (-6.0, 9.0), (6.0, 9.0)):
        beam(m('metal_dark'), (x, y, -0.8), (x * 0.5, y, -2.2), 0.4)
    # Windows down her flanks, lit.
    for y in range(-13, 14, 2):
        for s in (-1, 1):
            kit.box(m('window_glow'), (s * 4.65, y, -4.0), (0.08, 0.7, 0.35))
    # Radiator wings, out and down.
    for s in (-1, 1):
        kit.box(m('radiator'), (s * 10.5, 2.0, -5.5), (9.0, 8.0, 0.12), Matrix.Rotation(s * 0.25, 3, 'Y'))
        beam(m('metal_dark'), (s * 4.5, 2.0, -4.8), (s * 14.8, 2.0, -6.6), 0.2)
    # Four engine bells under her, firing down (at the Nadir), and their light.
    for (x, y) in ((-2.6, -8.0), (2.6, -8.0), (-2.6, 9.0), (2.6, 9.0)):
        kit.cylinder(m('engine'), (x, y, -7.6), (x, y, -10.4), 0.7, 14, 1.5)
        kit.cylinder(m('glow_engine'), (x, y, -10.3), (x, y, -10.45), 1.35, 14)
        kit.cylinder(m('metal_dark'), (x, y, -7.0), (x, y, -7.7), 0.9, 12)
    # The name, in plates on the bow's flank (a stripe, read from afar).
    for s in (-1, 1):
        kit.box(m('paint_ember'), (s * 4.85, -16.0, -4.4), (0.06, 6.0, 0.5))
    m.done('tern')


def buoy():
    m = Mats()
    pts = [(math.cos(2 * math.pi * i / 20) * 12.5, math.sin(2 * math.pi * i / 20) * 12.5) for i in range(20)]
    slab(m('floor'), [(x * 0.98, y * 0.98) for x, y in pts], -0.2, 0.0)
    slab(m('metal_dark'), pts, -1.2, -0.2)
    railing(m('metal'), [(x * 0.97, y * 0.97) for x, y in pts])
    ring(m('light_soft'), (0, 0, 0.02), 7.5, 0.08, 40)
    # The mast, the dish on it turned toward the deep, the beacon on top.
    kit.cylinder(m('metal'), (0, 12.2, 0.0), (0, 12.2, 13.0), 0.3, 10, 0.18)
    for z in (4.0, 7.5, 11.0):
        kit.cylinder(m('metal_dark'), (0, 12.2, z), (0, 12.2, z + 0.3), 0.5, 10)
    dish = kit.sphere(m('metal'), (0, 0, 0), 2.6, 20, (1, 1, 0.32))
    bm = m('metal')
    for v in list(dish):
        if v.co.z > 0.0:
            v.co.z = -v.co.z * 0.6
    bmesh.ops.transform(bm, matrix=Matrix.Translation((0, 14.4, 9.5)) @ Matrix.Rotation(1.9, 4, 'X'), verts=dish)
    beam(m('metal'), (0, 14.4, 9.5), (0, 12.2, 10.3), 0.08)
    kit.sphere(m('lamp'), (0, 12.2, 13.4), 0.45, 12)
    kit.sphere(m('nav_red'), (0, 12.2, 12.4), 0.15, 8)
    # Tock's corner: a bench, a crate of tools, a tally scratched on a plate.
    kit.box(m('paint_grey'), (-10.2, -2.0, 0.25), (0.8, 2.4, 0.5))
    kit.box(m('container_dark'), (10.0, -3.5, 0.45), (1.1, 1.1, 0.9))
    kit.box(m('panel'), (-11.2, 1.2, 1.0), (0.08, 3.0, 2.0))
    for i in range(14):
        beam(m('seam'), (-11.14, 0.1 + i * 0.16, 0.4), (-11.14, 0.1 + i * 0.16, 1.5), 0.025)
    # Under: a fuel sphere and four thrusters holding her at the lip.
    kit.sphere(m('container_grey'), (0, 0, -4.0), 4.2, 20)
    kit.cylinder(m('seam'), (0, 0, -4.05), (0, 0, -3.95), 4.25, 20)
    for a in (0.8, 2.4, 3.9, 5.5):
        x, y = math.cos(a) * 9.0, math.sin(a) * 9.0
        beam(m('metal_dark'), (x * 0.6, y * 0.6, -1.1), (x, y, -2.6), 0.3)
        kit.cylinder(m('engine'), (x, y, -2.4), (x, y, -3.6), 0.35, 10, 0.7)
        kit.cylinder(m('glow_engine'), (x, y, -3.55), (x, y, -3.65), 0.62, 10)
    m.done('buoy')


def tock_body():
    m = Mats()
    # A rounded body, wider than tall, worn: paint gone to rust at the edges.
    kit.sphere(m('paint_bone'), (0, 0, 1.05), 0.55, 20, (1.0, 0.85, 1.05))
    kit.cylinder(m('seam'), (0, 0, 1.02), (0, 0, 1.08), 0.565, 20)
    kit.sphere(m('rust'), (0.22, -0.3, 0.75), 0.22, 10, (1.0, 0.6, 0.7))
    kit.sphere(m('rust'), (-0.35, 0.1, 1.35), 0.15, 8)
    # His chest plate: a panel of small lights, the tally he keeps.
    kit.box(m('panel'), (0, -0.46, 1.08), (0.46, 0.08, 0.36), Matrix.Rotation(0.15, 3, 'X'))
    for i in range(4):
        for j in range(3):
            kit.box(m('window_glow') if (i + j) % 3 else m('nav_green'), (-0.15 + i * 0.1, -0.505, 0.98 + j * 0.09), (0.06, 0.03, 0.05))
    # The neck collar.
    kit.cylinder(m('metal_dark'), (0, 0, 1.52), (0, 0, 1.64), 0.2, 14)
    # Arms: long, thin, three joints, three-fingered hands.
    for s in (-1, 1):
        sh = V((s * 0.55, 0, 1.25))
        el = V((s * 0.75, -0.12, 0.85))
        wr = V((s * 0.7, -0.3, 0.5))
        kit.sphere(m('metal_dark'), sh, 0.12, 10)
        beam(m('metal'), sh, el, 0.07)
        kit.sphere(m('metal_dark'), el, 0.08, 8)
        beam(m('metal'), el, wr, 0.06)
        for f in (-1, 0, 1):
            beam(m('metal_dark'), wr, wr + V((f * 0.05, -0.08, -0.14)), 0.03)
    # The ring he hovers on, and its glow.
    kit.cylinder(m('metal_dark'), (0, 0, 0.42), (0, 0, 0.5), 0.36, 18, 0.42)
    ring(m('metal'), (0, 0, 0.32), 0.34, 0.06, 18)
    kit.cylinder(m('glow_engine'), (0, 0, 0.27), (0, 0, 0.3), 0.3, 18)
    m.done('tock_body', smooth=('paint_bone', 'rust'))


def tock_head():
    m = Mats()
    # The head turns on the neck (origin at its pivot); its eye looks -Y.
    kit.sphere(m('paint_bone'), (0, 0, 0.22), 0.3, 18, (1.25, 1.0, 0.8))
    kit.box(m('paint_dark'), (0, -0.2, 0.25), (0.62, 0.2, 0.2))
    kit.box(m('window_glow'), (0, -0.3, 0.25), (0.48, 0.04, 0.09))
    kit.box(m('metal_dark'), (0, -0.27, 0.37), (0.66, 0.12, 0.05))
    for s in (-1, 1):
        beam(m('metal'), (s * 0.18, 0.05, 0.42), (s * 0.28, 0.12, 0.72), 0.025)
        kit.sphere(m('nav_red') if s < 0 else m('nav_green'), (s * 0.28, 0.12, 0.74), 0.04, 6)
    m.done('tock_head', smooth=('paint_bone',))


os.makedirs(OUT, exist_ok=True)
PIECES = (tern, buoy, tock_body, tock_head)
only = sys.argv[sys.argv.index('--') + 2:] if len(sys.argv) > sys.argv.index('--') + 2 else []
for fn in PIECES:
    if only and fn.__name__ not in only:
        continue
    kit.reset()
    fn()
    kit.export(os.path.join(OUT, f'nadir-{fn.__name__}.glb'))
print('nadir: done', OUT)
