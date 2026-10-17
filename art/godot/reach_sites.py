"""The Reach's other places, built from code: the Choir's stonework and their
Engine, Renn's camp under the falls, the Aster's wreck and what guards it,
and Hearth's old mine.

    blender -b --factory-startup --python art/godot/reach_sites.py -- <out dir>

Writes one GLB per piece into <out dir> (site-<name>.glb), each with its
origin on the ground at its footprint's centre and its front toward Blender
-Y, which is Godot +Z. The game stands them on their worlds
(game/scripts/reach/site.gd and the scripts beside it). Surfaces are
material names only (game/scripts/art/surfaces.gd); every object is
flat-shaded and merged per material.

The Choir carved their writing as spirals that branch, one speaker's verse
curling off another's (a glyph strand of raised stone, `choir_glyph`, which
the game lights as it is translated).

Pieces:
  songline       a standing stone with a branching spiral on its face
  songline_wall  a broken wall of the same stone, three spirals across it
  arch           a Choir gateway: two curved legs meeting high, collared
  column         a slim tapering column wound with a spiral band
  platform       a round stepped dais, a spiral inlaid on top
  shrine         the Phantom's shrine: a domed round room with a doorway
  engine         the Engine: a great domed hall inside a standing ring
  engine_door    the slab that seals it, which sinks to open
  core           the Choir core: a glowing heart in a stone cage
  pod            Renn's escape pod, hatch open
  tent           Renn's tent: a tarp over a ridge pole, a bedroll
  cliff          a curved rock wall with a notch where the falls pour
  vault          the Aster's cargo vault, a doorway in its front
  vault_door     the vault's sliding door
  drone          one of Rook's Hollow drones (its lamp looks along +Z)
  bridge_shell   the outside of the Aster's bridge section, torn off aft,
                 to fit round game/art/aster_bridge.glb
  debris_plate   bent hull plating on its ribs
  debris_truss   a broken truss
  mine_tunnel    Hearth's old mine: a timbered tunnel under a rocky mound
"""
import math
import os
import random
import sys

sys.path.insert(0, os.path.dirname(__file__))
import bmesh  # noqa: E402
import bpy  # noqa: E402
from mathutils import Matrix, Vector as V, noise  # noqa: E402

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
    """A square bar from a to b."""
    a, b = V(a), V(b)
    d = b - a
    rot = d.normalized().to_track_quat('Z', 'Y').to_matrix()
    kit.box(bm, (a + b) / 2, (w, w, d.length), rot)


def boulder(bm, centre, size, seed, rough=0.28):
    """A lumpy rock: an icosphere pushed about by noise."""
    r = bmesh.ops.create_icosphere(bm, subdivisions=2, radius=1.0)
    off = V((seed * 7.31, seed * 3.17, seed * 5.53))
    for v in r['verts']:
        n = noise.noise(v.co * 1.4 + off)
        v.co = v.co * (1.0 + n * rough)
        v.co = V((v.co.x * size[0], v.co.y * size[1], v.co.z * size[2])) + V(centre)
    return r['verts']


# --- The Choir's writing --------------------------------------------------------

def spiral(bm, at, plane, r0, r1, turns, start=0.0, sense=1, width=0.045, depth=0.03):
    """A raised spiral strand. `plane` 'XZ' stands it facing -Y (its face at
    at.y), 'XY' lays it face up (at at.z). Returns the outer end and the
    angle there, for a branch to grow from."""
    steps = max(8, int(turns * 30))
    pts = []
    th = start
    for i in range(steps + 1):
        t = i / steps
        th = start + sense * t * turns * 2 * math.pi
        r = r0 + (r1 - r0) * t
        pts.append((math.cos(th) * r, math.sin(th) * r))
    for a, b in zip(pts, pts[1:]):
        du, dv = b[0] - a[0], b[1] - a[1]
        length = math.hypot(du, dv) * 1.15
        mu, mv = (a[0] + b[0]) / 2, (a[1] + b[1]) / 2
        if plane == 'XZ':
            kit.box(bm, (at[0] + mu, at[1] - depth / 2, at[2] + mv), (length, depth, width), Matrix.Rotation(math.atan2(-dv, du), 3, 'Y'))
        else:
            kit.box(bm, (at[0] + mu, at[1] + mv, at[2] + depth / 2), (length, width, depth), Matrix.Rotation(math.atan2(dv, du), 3, 'Z'))
    end = pts[-1]
    return (at[0] + end[0], at[1], at[2] + end[1]) if plane == 'XZ' else (at[0] + end[0], at[1] + end[1], at[2]), th


def strand(bm, at, plane, size, rng):
    """A verse and the two that answer it: a spiral, and two smaller ones
    curling the other way off its outer end and its middle."""
    end, th = spiral(bm, at, plane, size * 0.06, size, 3.0, rng.uniform(0, 6.28), 1)
    for k, (reach, scale) in enumerate(((1.0, 0.45), (0.55, 0.32))):
        a = th + (0.9 if k == 0 else -1.6)
        r = size * scale
        if plane == 'XZ':
            c = (end[0] * reach + at[0] * (1 - reach) + math.cos(a) * r, at[1], end[2] * reach + at[2] * (1 - reach) + math.sin(a) * r)
        else:
            c = (end[0] * reach + at[0] * (1 - reach) + math.cos(a) * r, end[1] * reach + at[1] * (1 - reach) + math.sin(a) * r, at[2])
        spiral(bm, c, plane, r * 0.1, r, 2.0, a + math.pi, -1, width=0.035)


def slab_profile(w, h, n=10):
    pts = [(-w / 2, 0.0), (w / 2, 0.0)]
    r = w / 2
    for k in range(n + 1):
        a = math.pi * k / n
        pts.append((math.cos(a) * r, h - r + math.sin(a) * r))
    return pts


def songline():
    m = Mats()
    w, h, d = 1.5, 2.5, 0.32
    kit.box(m('choir_stone'), (0, 0, 0.12), (w + 0.4, d + 0.5, 0.24))
    prof = [(x, z + 0.24) for x, z in slab_profile(w, h)]
    kit.loft(m('choir_stone'), [kit.ring_y(prof, -d / 2), kit.ring_y(prof, d / 2)])
    strand(m('choir_glyph'), (0.0, -d / 2 + 0.01, 1.55), 'XZ', 0.48, random.Random(3))
    m.done('songline')


def songline_wall():
    m = Mats()
    rng = random.Random(5)
    # Courses of blocks, the top broken unevenly.
    for col in range(10):
        top = 3.2 - abs(col - 4.5) * 0.12 - rng.uniform(0.0, 0.9)
        x = -2.5 + col * 0.5 + 0.25
        z = 0.0
        while z < top:
            hgt = min(rng.uniform(0.45, 0.7), top - z)
            kit.box(m('choir_stone'), (x, rng.uniform(-0.03, 0.03), z + hgt / 2), (0.49, 0.6, hgt - 0.02))
            z += hgt
    for k, (x, z, s) in enumerate(((-1.5, 1.4, 0.5), (0.4, 1.7, 0.6), (1.8, 1.2, 0.38))):
        strand(m('choir_glyph'), (x, -0.31, z), 'XZ', s, random.Random(10 + k))
    for k in range(5):
        boulder(m('choir_stone'), (rng.uniform(-3, 3), rng.uniform(-1.4, -0.6), 0.1), (0.35, 0.3, 0.25), k + 20)
    m.done('songline_wall')


# --- Choir building --------------------------------------------------------------

def swept(bm, path, size):
    """A square section swept along a path of points in the XZ plane."""
    rings = []
    for i, p in enumerate(path):
        a = V(path[max(0, i - 1)])
        b = V(path[min(len(path) - 1, i + 1)])
        t = (b - a).normalized()
        n = t.cross(V((0, 1, 0))).normalized()
        s = size / 2
        c = V(p)
        rings.append([c + n * s + V((0, s, 0)), c + n * s - V((0, s, 0)), c - n * s - V((0, s, 0)), c - n * s + V((0, s, 0))])
    kit.loft(bm, rings)


def arch():
    m = Mats()
    span, rise = 2.7, 6.4
    for side in (-1, 1):
        path = []
        for i in range(17):
            t = i / 16
            x = side * span * (1.0 - t) ** 0.75
            z = rise * math.sin(t * math.pi / 2) ** 0.9
            path.append((x, 0.0, z))
        swept(m('choir_stone'), path, 0.55)
        kit.box(m('choir_stone'), (side * span, 0, 0.3), (1.1, 1.1, 0.6))
        for t in (0.18, 0.45):
            i = int(t * 16)
            beam(m('choir_glyph'), V(path[i]) + (V(path[i + 1]) - V(path[i])) * 0.2, V(path[i]) + (V(path[i + 1]) - V(path[i])) * 0.55, 0.64)
    kit.sphere(m('choir_glyph'), (0, 0, rise + 0.1), 0.32, 12)
    kit.cylinder(m('choir_stone'), (0, -0.2, rise + 0.1), (0, 0.2, rise + 0.1), 0.5, 16)
    m.done('arch')


def column():
    m = Mats()
    prof = [(0.62, 0.0), (0.62, 0.42), (0.46, 0.55), (0.36, 6.3), (0.52, 6.5), (0.62, 6.95), (0.5, 7.1)]
    kit.lathe(m('choir_stone'), prof, segments=8, axis='Z')
    pts = []
    for i in range(61):
        t = i / 60
        z = 0.8 + t * 5.3
        r = 0.46 + (0.36 - 0.46) * (z - 0.55) / (6.3 - 0.55) + 0.025
        a = t * 3.0 * 2 * math.pi
        pts.append(V((math.cos(a) * r, math.sin(a) * r, z)))
    for a, b in zip(pts, pts[1:]):
        beam(m('choir_glyph'), a, b, 0.07)
    m.done('column')


def platform():
    m = Mats()
    prof = [(4.2, 0.0), (4.2, 0.25), (3.7, 0.25), (3.7, 0.5), (3.2, 0.5), (3.2, 0.75)]
    kit.lathe(m('choir_stone'), prof, segments=28, axis='Z')
    strand(m('choir_glyph'), (0.0, 0.0, 0.75), 'XY', 1.6, random.Random(7))
    m.done('platform')


def round_room(m, radius, height, thick, segments, door_segments, dome=True, oculus=0.5):
    """A round room: wall stones in a ring with a doorway toward -Y, a dome
    over it (an oculus at its crown), a floor."""
    seg_w = 2 * math.pi * radius / segments
    for k in range(segments):
        a = -math.pi / 2 + 2 * math.pi * (k + 0.5) / segments
        if k < door_segments // 2 or k >= segments - (door_segments - door_segments // 2):
            continue
        rot = Matrix.Rotation(a + math.pi / 2, 3, 'Z')
        kit.box(m('choir_stone'), (math.cos(a) * radius, math.sin(a) * radius, height / 2), (seg_w * 1.04, thick, height), rot)
    if dome:
        outer = []
        inner = []
        crown = math.asin(min(0.98, oculus / (radius + thick / 2)))
        top = math.pi / 2 - crown
        for i in range(13):
            t = top * i / 12
            outer.append(((radius + thick / 2) * math.cos(t), height + (radius + thick / 2) * math.sin(t)))
        for i in range(12, -1, -1):
            t = top * i / 12
            inner.append(((radius - thick / 2) * math.cos(t), height + (radius - thick / 2) * math.sin(t)))
        kit.lathe(m('choir_stone'), outer + inner, segments=segments, axis='Z', cap_start=False, cap_end=False)
    # Over the doorway, a lintel; under the room, a floor.
    door_w = seg_w * door_segments
    kit.box(m('choir_stone'), (0, -radius, height - 0.4), (door_w + 0.6, thick * 1.2, 0.8))
    kit.lathe(m('choir_stone'), [(radius + thick / 2, -0.3), (radius + thick / 2, 0.15)], segments=segments, axis='Z')
    return door_w


def shrine():
    m = Mats()
    round_room(m, 4.2, 2.8, 0.5, 20, 3)
    kit.box(m('choir_stone'), (0, 1.0, 0.65), (1.0, 1.0, 1.0))
    strand(m('choir_glyph'), (0.0, 1.0, 1.15), 'XY', 0.36, random.Random(9))
    for x in (-1.6, 1.6):
        kit.box(m('choir_stone'), (x, -4.7, 1.6), (0.7, 0.7, 3.2))
        kit.sphere(m('choir_glyph'), (x, -4.7, 3.4), 0.22, 10)
    m.done('shrine')


def engine():
    m = Mats()
    radius, height = 7.5, 4.2
    round_room(m, radius, height, 0.6, 32, 2, oculus=1.2)
    # The standing ring, its foot buried, a glowing band round its face.
    ring = []
    for i in range(16):
        a = 2 * math.pi * i / 16
        ring.append((11.0 + math.cos(a) * 0.95, math.sin(a) * 0.95))
    kit.lathe(m('choir_stone'), ring, segments=64, at=V((0, 0.6, 4.0)), axis='Y', cap_start=False, cap_end=False)
    band = []
    for i in range(8):
        a = 2 * math.pi * i / 8
        band.append((11.0 + math.cos(a) * 0.14, math.sin(a) * 0.14))
    kit.lathe(m('choir_glyph'), band, segments=64, at=V((0, -0.42, 4.0)), axis='Y', cap_start=False, cap_end=False)
    # Buttresses where the ring meets the ground.
    for side in (-1, 1):
        kit.box(m('choir_stone'), (side * 9.6, 0.6, 1.2), (2.4, 2.2, 2.4), Matrix.Rotation(side * 0.5, 3, 'Y'))
    # Columns flanking the door.
    for x in (-2.4, 2.4):
        kit.lathe(m('choir_stone'), [(0.42, 0.0), (0.34, 4.6), (0.5, 4.8), (0.4, 5.0)], segments=8, at=V((x, -radius - 0.9, 0)), axis='Z')
        kit.sphere(m('choir_glyph'), (x, -radius - 0.9, 5.25), 0.28, 10)
    # Inside: the socket on its plinth, a spiral round it on the floor.
    kit.lathe(m('choir_stone'), [(0.9, 0.0), (0.9, 0.3), (0.6, 0.4), (0.5, 1.0), (0.7, 1.1), (0.5, 1.15)], segments=16, axis='Z')
    kit.lathe(m('choir_glyph'), [(0.42, 1.1), (0.46, 1.22), (0.3, 1.22), (0.26, 1.12)], segments=16, axis='Z')
    strand(m('choir_glyph'), (0.0, 0.0, 0.16), 'XY', 4.2, random.Random(11))
    m.done('engine')


def engine_door():
    m = Mats()
    w, h, d = 3.1, 4.0, 0.45
    kit.box(m('choir_stone'), (0, 0, h / 2), (w, d, h))
    strand(m('choir_glyph'), (0.0, -d / 2 + 0.01, 2.1), 'XZ', 1.0, random.Random(13))
    m.done('engine_door')


def core():
    m = Mats()
    kit.sphere(m('core_glow'), (0, 0, 0), 0.19, 16)
    for k in range(6):
        a = 2 * math.pi * k / 6
        pts = []
        for i in range(9):
            t = math.pi * i / 8
            pts.append(V((math.sin(t) * math.cos(a) * 0.28, math.sin(t) * math.sin(a) * 0.28, -math.cos(t) * 0.3)))
        for p, q in zip(pts, pts[1:]):
            beam(m('choir_stone'), p, q, 0.035)
    kit.lathe(m('choir_stone'), [(0.14, -0.33), (0.14, -0.28), (0.1, -0.26)], segments=12, axis='Z')
    m.done('core')


# --- Renn's camp ----------------------------------------------------------------

def pod():
    m = Mats()
    r, half = 1.0, 1.3
    kit.cylinder(m('paint_bone'), (-half, 0, r), (half, 0, r), r, 20)
    kit.sphere(m('paint_bone'), (-half, 0, r), r, 20, (0.55, 1, 1))
    kit.sphere(m('paint_dark'), (half, 0, r), r * 0.96, 20, (0.4, 1, 1))
    for x in (-0.6, 0.4, 1.2):
        kit.cylinder(m('seam'), (x - 0.04, 0, r), (x + 0.04, 0, r), r + 0.03, 20)
    # The hatch, blown open on its hinge, and the dark doorway it left.
    kit.box(m('paint_dark'), (-0.1, -r + 0.01, r + 0.05), (1.1, 0.04, 1.2))
    kit.box(m('paint_bone'), (-0.1, -r - 0.45, r + 0.95), (1.15, 0.12, 1.25), Matrix.Rotation(-1.1, 3, 'X'))
    kit.cylinder(m('glass'), (0.9, -0.55, r + 0.62), (0.98, -0.62, r + 0.68), 0.22, 12)
    # Scorched below, the beacon on top, fins aft.
    kit.box(m('rust'), (0, 0, 0.12), (2.5, 1.4, 0.25))
    kit.cylinder(m('metal_dark'), (0.2, 0, 2.0), (0.2, 0, 2.3), 0.08, 8)
    kit.sphere(m('nav_red'), (0.2, 0, 2.36), 0.1, 8)
    for a in (0.6, 2.6, 4.6):
        kit.box(m('paint_dark'), (half + 0.5, math.cos(a) * 0.8, r + math.sin(a) * 0.8), (0.7, 0.08, 0.5), Matrix.Rotation(a, 3, 'X'))
    m.done('pod')


def tent():
    m = Mats()
    L, W, H = 2.6, 2.4, 1.7
    for side in (-1, 1):
        ang = math.atan2(H, W / 2)
        kit.box(m('awning_ember'), (side * W / 4, 0, H / 2), (math.hypot(W / 2, H), L, 0.04), Matrix.Rotation(-side * ang, 3, 'Y'))
    beam(m('beam'), (0, -L / 2 - 0.2, H + 0.03), (0, L / 2 + 0.2, H + 0.03), 0.07)
    for y in (-L / 2 - 0.15, L / 2 + 0.15):
        for side in (-1, 1):
            beam(m('beam'), (side * 0.15, y, 0), (0, y, H + 0.05), 0.05)
    kit.box(m('blanket'), (0, 0, 0.02), (W - 0.2, L, 0.04))
    kit.cylinder(m('blanket'), (-0.5, -0.9, 0.18), (-0.5, 0.9, 0.18), 0.16, 10)
    beam(m('cable'), (0, -L / 2 - 0.2, H), (0, -L / 2 - 0.5, H - 0.35), 0.015)
    kit.sphere(m('lantern'), (0, -L / 2 - 0.5, H - 0.45), 0.1, 8)
    m.done('tent')


def cliff():
    """A curved wall of rock behind a pool, a notch at the top of it."""
    m = Mats()
    rng = random.Random(17)
    seed = 0
    for i in range(26):
        t = i / 25
        a = math.radians(205 + 130 * t)
        notch = math.exp(-((t - 0.5) / 0.07) ** 2)
        for layer in range(4):
            # A gorge through the front of it, where the falls come down.
            if abs(t - 0.5) < 0.05 and layer < 3:
                continue
            r = 15.0 + layer * 2.2 + rng.uniform(-0.8, 0.8)
            top = (19.0 - abs(t - 0.5) * 10.0) * (1.0 - 0.32 * notch)
            z = top * (layer + 0.6) / 4.0
            size = (rng.uniform(2.6, 3.6), rng.uniform(2.4, 3.2), top / 4.0 * rng.uniform(0.85, 1.15))
            boulder(m('stone'), (math.cos(a) * r, -math.sin(a) * r, z), size, seed)
            seed += 1
    # Round the pool in the gorge, smaller stones.
    for i in range(14):
        a = 2 * math.pi * i / 14
        if math.sin(a) < -0.6:
            continue  # its mouth, toward the camp
        boulder(m('stone'), (math.cos(a) * 3.4, 16.2 + math.sin(a) * 2.4, 0.1), (0.8, 0.7, 0.5), 300 + i)
    m.done('cliff')


# --- The Aster's wreck ------------------------------------------------------------

def vault():
    m = Mats()
    w, d, h, t = 6.0, 5.0, 3.4, 0.35
    kit.box(m('floor'), (0, 0, t / 2), (w, d, t))
    kit.box(m('paint_dark'), (0, 0, h - t / 2), (w, d, t))
    kit.box(m('paint_grey'), (0, d / 2 - t / 2, h / 2), (w, t, h))
    for x in (-w / 2 + t / 2, w / 2 - t / 2):
        kit.box(m('paint_grey'), (x, 0, h / 2), (t, d, h))
    dw, dh = 1.8, 2.5
    side = (w - dw) / 2
    for x in (-(dw / 2 + side / 2), dw / 2 + side / 2):
        kit.box(m('paint_grey'), (x, -d / 2 + t / 2, h / 2), (side, t, h))
    kit.box(m('paint_grey'), (0, -d / 2 + t / 2, (dh + h) / 2), (dw, t, h - dh))
    # Scorched where the hull burned against it.
    for x, z, sw, sh in ((-2.2, 2.4, 1.4, 0.9), (2.4, 0.8, 1.0, 1.2), (-1.8, 0.6, 0.9, 0.7)):
        kit.box(m('rust'), (x, -d / 2 - 0.01, z), (sw, 0.02, sh))
    # The frame round the door, the keypad beside it, ribs and a light.
    for x in (-dw / 2 - 0.08, dw / 2 + 0.08):
        kit.box(m('hazard'), (x, -d / 2 - 0.02, dh / 2 + t / 2), (0.16, 0.1, dh))
    kit.box(m('hazard'), (0, -d / 2 - 0.02, dh + 0.1), (dw + 0.32, 0.1, 0.16))
    kit.box(m('paint_dark'), (dw / 2 + 0.6, -d / 2 - 0.08, 1.45), (0.32, 0.12, 0.46))
    kit.box(m('screen'), (dw / 2 + 0.6, -d / 2 - 0.15, 1.5), (0.24, 0.02, 0.3))
    for x in (-2.0, 0.0, 2.0):
        kit.box(m('paint_dark'), (x, 0, h + 0.08), (0.3, d + 0.2, 0.16))
    kit.box(m('light'), (0, 0.4, h - t - 0.03), (0.2, 2.4, 0.05))
    # Inside, racks, and the cradle the core sits in.
    for x in (-2.2, 2.2):
        kit.box(m('paint_grey'), (x, 0.6, 1.1), (0.9, 2.8, 0.08))
        kit.box(m('paint_grey'), (x, 0.6, 2.0), (0.9, 2.8, 0.08))
    kit.box(m('paint_dark'), (0, 1.3, 0.75), (0.9, 0.9, 0.8))
    kit.cylinder(m('hazard'), (0, 1.3, 1.15), (0, 1.3, 1.2), 0.32, 16)
    m.done('vault')


def vault_door():
    m = Mats()
    kit.box(m('door'), (0, 0, 1.3), (1.9, 0.2, 2.6))
    for z in (0.4, 2.2):
        kit.box(m('hazard'), (0, -0.11, z), (1.9, 0.02, 0.18))
    m.done('vault_door')


def drone():
    m = Mats()
    kit.sphere(m('paint_hollow'), (0, 0, 0), 0.7, 16, (1.0, 1.3, 0.6))
    kit.cylinder(m('metal_dark'), (0, -0.86, 0), (0, -0.98, 0), 0.3, 14)
    kit.sphere(m('glow_hollow'), (0, -0.96, 0), 0.21, 12)
    for a in (0.0, math.pi / 2, math.pi, 3 * math.pi / 2):
        kit.box(m('rust'), (math.cos(a) * 0.72, 0.35, math.sin(a) * 0.4), (0.5, 0.7, 0.06), Matrix.Rotation(a, 3, 'Y'))
    beam(m('metal_dark'), (0.2, 0.4, 0.38), (0.25, 0.7, 0.85), 0.03)
    kit.sphere(m('nav_red'), (0.25, 0.7, 0.88), 0.05, 6)
    kit.box(m('seam'), (0, 0, 0), (1.42, 0.1, 0.1))
    m.done('drone')


def bridge_shell():
    """Round the bridge set (aster_bridge.py: half width 5.2, 9 deep, 3.5
    high, its window band forward, a hatch on the starboard wall), the hull
    outside it, 0.3 thick, torn ragged at the aft end."""
    m = Mats()
    g = 0.3
    aft = [(-5.2 - g, -g), (5.2 + g, -g), (5.2 + g, 2.6 + g * 0.5), (4.2 + g * 0.5, 3.5 + g), (-4.2 - g * 0.5, 3.5 + g), (-5.2 - g, 2.6 + g * 0.5)]
    fwd = [(-4.6 - g, -g), (4.6 + g, -g), (4.6 + g, 2.2 + g * 0.5), (3.8 + g * 0.5, 2.9 + g), (-3.8 - g * 0.5, 2.9 + g), (-4.6 - g, 2.2 + g * 0.5)]
    bm = m('paint_dark')
    kit.loft(bm, [kit.ring_y(aft, -g), kit.ring_y(aft, 7.4), kit.ring_y(fwd, 9.0)], cap_start=True, cap_end=False)
    kit.doorway(bm, 0, 5.2 + g, 1, (3.1, 4.3), (0.0, 2.1))
    # The rim round the window, from the hull in to the set's own edge.
    inner = [(-4.6, 0.0), (4.6, 0.0), (4.6, 2.2), (3.8, 2.9), (-3.8, 2.9), (-4.6, 2.2)]
    kit.loft(m('paint_dark'), [kit.ring_y(fwd, 9.0), kit.ring_y(inner, 9.0)], cap_start=False, cap_end=False)
    # The hatch's lining through the hull's thickness.
    kit.box(m('paint_dark'), (5.2 + g / 2, 3.7, 2.15), (g + 0.02, 1.3, 0.1))
    for y in (3.07, 4.33):
        kit.box(m('paint_dark'), (5.2 + g / 2, y, 1.05), (g + 0.02, 0.06, 2.2))
    kit.box(m('paint_dark'), (5.2 + g / 2, 3.7, -g / 2), (g + 0.02, 1.3, g))
    # Ribs round her, a band of her livery, scorching, and the torn plates aft.
    for y in (1.5, 3.0, 5.6, 7.2):
        rib = [(-5.2 - g - 0.1, -g), (-5.2 - g - 0.1, 2.6 + g * 0.5 + 0.05), (-4.2 - g * 0.5 - 0.05, 3.5 + g + 0.1),
               (4.2 + g * 0.5 + 0.05, 3.5 + g + 0.1), (5.2 + g + 0.1, 2.6 + g * 0.5 + 0.05), (5.2 + g + 0.1, -g)]
        for a, b in zip(rib, rib[1:]):
            if y == 3.0 and a[0] > 5 and b[0] > 5:
                continue
            beam(m('hull'), (a[0], y, a[1]), (b[0], y, b[1]), 0.22)
    kit.box(m('paint_ember'), (-5.2 - g - 0.03, 4.4, 2.2), (0.06, 8.8, 0.35))
    kit.box(m('paint_ember'), (5.2 + g + 0.03, 6.6, 2.2), (0.06, 4.4, 0.35))
    rng = random.Random(19)
    for i in range(10):
        side = rng.choice((-1, 1))
        kit.box(m('rust'), (side * (5.2 + g + 0.02), rng.uniform(0.5, 8.5), rng.uniform(0.3, 2.6)), (0.05, rng.uniform(0.8, 2.2), rng.uniform(0.4, 1.2)))
    rng = random.Random(23)
    for i in range(14):
        a = 2 * math.pi * i / 14
        x = math.cos(a) * 4.6
        z = 1.7 + math.sin(a) * 1.8
        kit.box(m('hull'), (x, -g - 0.4, z), (rng.uniform(0.8, 1.6), 0.08, rng.uniform(0.6, 1.2)),
                Matrix.Rotation(rng.uniform(-0.6, 0.6), 3, 'Z') @ Matrix.Rotation(rng.uniform(0.3, 0.9), 3, 'X'))
        beam(m('seam'), (x * 0.9, -g, z), (x * 0.95 + rng.uniform(-0.3, 0.3), -g - rng.uniform(0.6, 1.4), z + rng.uniform(-0.3, 0.3)), 0.12)
    m.done('bridge_shell')


def debris_plate():
    m = Mats()
    rng = random.Random(29)
    x = 0.0
    a = 0.0
    for k in range(4):
        w = rng.uniform(1.4, 2.0)
        a += rng.uniform(-0.35, 0.45)
        cx = x + math.cos(a) * w / 2
        cz = 0.4 + math.sin(a) * w / 2 + k * 0.05
        kit.box(m('hull'), (cx - 2.5, 0, cz), (w, 2.6, 0.08), Matrix.Rotation(-a, 3, 'Y'))
        for y in (-1.0, 0.0, 1.0):
            kit.box(m('seam'), (cx - 2.5, y, cz - 0.1), (w, 0.12, 0.16), Matrix.Rotation(-a, 3, 'Y'))
        x += math.cos(a) * w
    m.done('debris_plate')


def debris_truss():
    m = Mats()
    L = 6.0
    for y, z in ((-0.5, 0.2), (0.5, 0.2), (0.0, 1.0)):
        beam(m('paint_grey'), (-L / 2, y, z), (L / 2 - (1.4 if z > 0.5 else 0.0), y, z + (0.5 if z > 0.5 else 0.0)), 0.12)
    for k in range(6):
        x = -L / 2 + k * 1.0
        beam(m('paint_grey'), (x, -0.5, 0.2), (x + 0.5, 0.0, 1.0), 0.07)
        beam(m('paint_grey'), (x, 0.5, 0.2), (x + 0.5, 0.0, 1.0), 0.07)
    beam(m('cable'), (L / 2, 0.5, 0.2), (L / 2 + 1.2, 0.8, 0.02), 0.03)
    m.done('debris_truss')


# --- Hearth's old mine ------------------------------------------------------------

def mine_tunnel():
    """The tunnel runs from its mouth (y = 0) 15 m in, under a mound of rock;
    the songline stands at its far end (the game puts it there)."""
    m = Mats()
    L, W, H = 15.0, 3.0, 2.9
    kit.box(m('stone'), (0, L / 2, -0.1), (W + 0.6, L, 0.2))
    for x in (-W / 2 - 0.25, W / 2 + 0.25):
        kit.box(m('stone'), (x, L / 2, H / 2), (0.5, L, H))
    kit.box(m('stone'), (0, L / 2, H + 0.25), (W + 1.0, L, 0.5))
    kit.box(m('stone'), (0, L + 0.25, H / 2), (W + 1.0, 0.5, H + 0.5))
    # Timber sets every 1.8 m, rails, lamps.
    for k in range(9):
        y = 0.2 + k * 1.8
        for x in (-W / 2 + 0.15, W / 2 - 0.15):
            kit.box(m('beam'), (x, y, H / 2), (0.28, 0.28, H))
        kit.box(m('beam'), (0, y, H - 0.14), (W, 0.3, 0.28))
    for x in (-0.45, 0.45):
        kit.box(m('metal'), (x, L / 2 - 0.5, 0.04), (0.06, L - 1.5, 0.06))
    for k in range(int(L / 0.7)):
        kit.box(m('metal_dark'), (0, 0.4 + k * 0.7, 0.02), (1.2, 0.1, 0.05))
    for y in (2.0, 7.4, 12.8):
        kit.sphere(m('lantern'), (W / 2 - 0.35, y, H - 0.5), 0.12, 8)
    kit.box(m('planks'), (0, -0.2, H + 0.45), (2.0, 0.08, 0.55), Matrix.Rotation(-0.15, 3, 'X'))
    # The mound over it.
    rng = random.Random(31)
    for i in range(34):
        y = rng.uniform(0.6, L + 1.5)
        side = rng.choice((-1, 1))
        x = side * rng.uniform(2.2, 4.5)
        z = rng.uniform(0.0, 2.6)
        boulder(m('stone'), (x, y, z), (rng.uniform(1.6, 2.6), rng.uniform(1.8, 2.8), rng.uniform(1.4, 2.4)), 400 + i)
    for i in range(14):
        y = rng.uniform(1.0, L + 1.0)
        boulder(m('stone'), (rng.uniform(-2.0, 2.0), y, rng.uniform(3.6, 4.6)), (rng.uniform(2.0, 3.0), rng.uniform(2.0, 3.0), rng.uniform(1.2, 1.8)), 500 + i)
    # The mouth's frame, as at the village.
    for x in (-1.6, 1.6):
        kit.box(m('beam'), (x, -0.1, 1.5), (0.34, 0.34, 3.0))
    kit.box(m('beam'), (0, -0.1, 3.05), (3.6, 0.38, 0.34))
    m.done('mine_tunnel')


os.makedirs(OUT, exist_ok=True)
PIECES = (songline, songline_wall, arch, column, platform, shrine, engine, engine_door, core, pod, tent, cliff,
          vault, vault_door, drone, bridge_shell, debris_plate, debris_truss, mine_tunnel)
only = sys.argv[sys.argv.index('--') + 2:] if len(sys.argv) > sys.argv.index('--') + 2 else []
for fn in PIECES:
    if only and fn.__name__ not in only:
        continue
    kit.reset()
    fn()
    kit.export(os.path.join(OUT, f'site-{fn.__name__}.glb'))
print('sites: done', OUT)
