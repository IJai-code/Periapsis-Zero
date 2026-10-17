"""Hearth's valley, on Hearthstone: the trees and the crater's walls.

    blender -b --factory-startup --python art/godot/hearth_valley.py -- <out dir> [names...]

Writes valley-<name>.glb into <out dir>. Origins on the ground; fronts
toward Blender -Y (Godot +Z).

  pine_a, pine_b, pine_c  tall conifers (about 24, 30 and 19 m): a bare
                          lower trunk, then whorls of drooping fronds,
                          each a ridged strip with ragged edges, darker
                          toward the trunk; a dark core so the crown never
                          shows daylight through it. Vertex-coloured (alpha
                          is how much the wind moves it), one material, so
                          the game can draw thousands in one go.
  pine_far                the same shape in a hundred triangles, for far off.
  cliff_a, cliff_b        a 52 m stretch of the crater's wall (an arc of a
                          120 m circle, concave toward -Y): strata of blocky
                          rock stepping back as they rise, ledges, a talus
                          of boulders at the foot. 48 m tall.
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

args = sys.argv[sys.argv.index('--') + 1:]
OUT = args[0]
ONLY = args[1:]


def export(path):
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_yup=True, export_apply=True,
                              export_cameras=False, export_lights=False, export_extras=False, export_animations=False,
                              export_vertex_color='ACTIVE')


class Painter:
    """A bmesh whose faces carry a colour per corner (rgb, and alpha for sway)."""

    def __init__(self):
        self.bm = bmesh.new()
        self.col = self.bm.loops.layers.color.new('Color')

    def tri(self, a, b, c, ca, cb, cc):
        vs = [self.bm.verts.new(V(p)) for p in (a, b, c)]
        try:
            f = self.bm.faces.new(vs)
        except ValueError:
            return
        for loop, col in zip(f.loops, (ca, cb, cc)):
            loop[self.col] = col

    def quad(self, a, b, c, d, ca, cb, cc, cd):
        self.tri(a, b, c, ca, cb, cc)
        self.tri(a, c, d, ca, cc, cd)

    def done(self, name, mat):
        bmesh.ops.remove_doubles(self.bm, verts=self.bm.verts, dist=0.0005)
        self.bm.normal_update()
        me = bpy.data.meshes.new(name)
        self.bm.to_mesh(me)
        self.bm.free()
        # The exporter writes the active colour attribute: make it ours.
        attr = me.color_attributes.get('Color')
        if attr:
            me.color_attributes.active_color = attr
            me.color_attributes.render_color_index = me.color_attributes.find('Color')
        o = bpy.data.objects.new(name, me)
        bpy.context.collection.objects.link(o)
        me.materials.append(kit.material(mat))
        for p in me.polygons:
            p.use_smooth = False
        return o


def mix(a, b, t):
    return tuple(a[i] + (b[i] - a[i]) * t for i in range(4))


def cylinder(p, a, b, r0, r1, sides, col0, col1):
    a, b = V(a), V(b)
    d = (b - a).normalized()
    side = d.cross(V((1, 0, 0)) if abs(d.x) < 0.9 else V((0, 1, 0))).normalized()
    up = d.cross(side)
    for i in range(sides):
        t0 = 2 * math.pi * i / sides
        t1 = 2 * math.pi * (i + 1) / sides
        o0 = side * math.cos(t0) + up * math.sin(t0)
        o1 = side * math.cos(t1) + up * math.sin(t1)
        p.quad(a + o0 * r0, a + o1 * r0, b + o1 * r1, b + o0 * r1, col0, col0, col1, col1)


def cone(p, base, top, r, sides, col_base, col_top, phase=0.0):
    base, top = V(base), V(top)
    for i in range(sides):
        t0 = 2 * math.pi * i / sides + phase
        t1 = 2 * math.pi * (i + 1) / sides + phase
        p.tri(base + V((math.cos(t0) * r, math.sin(t0) * r, 0)), base + V((math.cos(t1) * r, math.sin(t1) * r, 0)), top, col_base, col_base, col_top)
        p.tri(base + V((math.cos(t1) * r, math.sin(t1) * r, 0)), base + V((math.cos(t0) * r, math.sin(t0) * r, 0)), base, col_base, col_base, col_base)


BARK = (0.36, 0.25, 0.17, 0.0)
BARK_DARK = (0.24, 0.16, 0.11, 0.0)
CORE = (0.09, 0.18, 0.12, 0.15)
SPINE = (0.13, 0.26, 0.15, 0.3)
EDGE = (0.27, 0.45, 0.27, 0.6)
TIP = (0.43, 0.6, 0.33, 1.0)


def frond(p, base, a, length, droop, width, rng):
    """One drooping branch: a ridged strip out from the trunk, ragged at
    its edges, lighter toward the tip."""
    out = V((math.cos(a), math.sin(a), 0))
    side = V((-math.sin(a), math.cos(a), 0))
    n = 6
    spine = []
    for i in range(n + 1):
        s = i / n
        rise = 0.18 * s * length - droop * (s ** 1.8) * length
        spine.append(V(base) + out * (s * length) + V((0, 0, rise)))
    for i in range(n):
        s0, s1 = i / n, (i + 1) / n
        w0 = width * math.sin(math.pi * (0.08 + 0.92 * s0)) ** 0.7
        w1 = width * math.sin(math.pi * (0.08 + 0.92 * s1)) ** 0.7
        jag0 = 1.0 + (0.28 if i % 2 else -0.12) + rng.uniform(-0.1, 0.1)
        jag1 = 1.0 + (0.28 if (i + 1) % 2 else -0.12) + rng.uniform(-0.1, 0.1)
        c0 = mix(SPINE, TIP, s0 * 0.7)
        c1 = mix(SPINE, TIP, s1 * 0.7)
        e0 = mix(EDGE, TIP, s0)
        e1 = mix(EDGE, TIP, s1)
        for sgn in (-1, 1):
            # The edges hang below the spine: a ridge, so it reads as thick.
            l0 = spine[i] + side * (sgn * w0 * jag0) - V((0, 0, w0 * 0.45))
            l1 = spine[i + 1] + side * (sgn * w1 * jag1) - V((0, 0, w1 * 0.45))
            p.quad(spine[i], spine[i + 1], l1, l0, c0, c1, e1, e0)


def pine(name, height, seed, slim=1.0):
    kit.reset()
    rng = random.Random(seed)
    p = Painter()
    H = height
    rb = 0.022 * H + 0.16
    # The trunk, a little bent, flaring at the root.
    segs = 6
    pts = [V((0, 0, -0.6))]
    for i in range(1, segs + 1):
        z = H * 0.98 * i / segs
        pts.append(V((rng.uniform(-0.15, 0.15) * i / segs, rng.uniform(-0.15, 0.15) * i / segs, z)))
    for i in range(segs):
        r0 = rb * (1.0 - 0.85 * i / segs) + (0.18 if i == 0 else 0.0)
        r1 = rb * (1.0 - 0.85 * (i + 1) / segs)
        cylinder(p, pts[i], pts[i + 1], r0, max(r1, 0.05), 9, BARK_DARK if i == 0 else BARK, BARK)
    # A few dead stubs on the bare trunk.
    for k in range(5):
        z = rng.uniform(0.1, 0.3) * H
        a = rng.uniform(0, 2 * math.pi)
        d = V((math.cos(a), math.sin(a), -0.2)).normalized()
        cylinder(p, V((0, 0, z)), V((0, 0, z)) + d * rng.uniform(0.6, 1.4), 0.07, 0.02, 4, BARK_DARK, BARK_DARK)
    # The crown.
    start = H * rng.uniform(0.28, 0.36)
    top = H * 0.97
    whorls = int((top - start) / 1.05)
    reach = H * 0.24 * slim
    for i in range(whorls):
        t = i / max(whorls - 1, 1)
        z = start + (top - start) * t
        length = reach * (1.0 - t) ** 0.85 + 0.6
        count = 7 if t < 0.6 else (6 if t < 0.85 else 4)
        for b in range(count):
            a = 2 * math.pi * b / count + i * 0.71 + rng.uniform(-0.25, 0.25)
            frond(p, (0, 0, z + rng.uniform(-0.2, 0.2)), a, length * rng.uniform(0.85, 1.1), rng.uniform(0.28, 0.5), length * 0.32, rng)
    # A dark core so the crown never shows daylight through it.
    cone(p, (0, 0, start + 0.5), (0, 0, top), reach * 0.38, 8, CORE, CORE)
    cone(p, (0, 0, top - 1.2), (0, 0, H * 1.04), 0.6, 6, SPINE, TIP)
    p.done(name, 'pine')
    export(os.path.join(OUT, f'valley-{name}.glb'))


def pine_far():
    kit.reset()
    p = Painter()
    H = 24.0
    cylinder(p, (0, 0, -0.6), (0, 0, H * 0.4), 0.65, 0.4, 6, BARK, BARK)
    for k in range(5):
        t = k / 5
        z0 = H * (0.3 + 0.13 * k)
        r = H * 0.24 * (1 - t) ** 0.85 + 0.6
        cone(p, (0, 0, z0), (0, 0, z0 + H * 0.24), r, 8, EDGE, TIP, k * 0.4)
    cone(p, (0, 0, H * 0.9), (0, 0, H * 1.04), 0.8, 6, EDGE, TIP)
    p.done('pine_far', 'pine')
    export(os.path.join(OUT, 'valley-pine_far.glb'))


def boulder(bm, centre, size, seed, rough=0.3):
    r = bmesh.ops.create_icosphere(bm, subdivisions=2, radius=1.0)
    off = V((seed * 7.31, seed * 3.17, seed * 5.53))
    for v in r['verts']:
        n = noise.noise(v.co * 1.4 + off)
        v.co = v.co * (1.0 + n * rough)
        v.co = V((v.co.x * size[0], v.co.y * size[1], v.co.z * size[2])) + V(centre)


def cliff(name, seed):
    """A 54 m stretch of the crater's wall (an arc of a 120 m circle whose
    centre is 120 m toward -Y), 48 m tall: one carved face of rock. Its
    surface steps back in strata (flat-topped ledges, sheer faces, some
    overhanging), split by vertical joints and worn by noise; flat-shaded so
    it reads as big angular facets. Bands alternate blue-grey and warm.
    Boulders at its foot."""
    kit.reset()
    rng = random.Random(seed)
    R = 120.0
    span = math.radians(27.0)
    NU, NV = 54, 40
    H = 48.0
    off = V((seed * 13.1, seed * 7.7, 0))
    # Strata: heights where the face steps back, and how far.
    steps = []
    z = 0.0
    back = 0.0
    while z < H:
        h = rng.uniform(3.5, 7.5)
        steps.append((z, z + h, back, rng.random() < 0.25))
        z += h
        back += rng.uniform(0.6, 2.4)

    def recess(u, v):
        z = v * H
        for z0, z1, b, over in steps:
            if z <= z1:
                k = (z - z0) / max(z1 - z0, 0.01)
                # Sheer face, then a bevel back to the next ledge; some
                # strata lean out a little (overhang).
                lean = (-0.8 * k if over else 0.4 * k)
                return b + lean
        return steps[-1][2]

    def pos(u, v):
        phi = -span / 2 + span * u
        out = V((math.sin(phi), math.cos(phi), 0))
        centre = V((R * math.sin(phi), -R + R * math.cos(phi), 0))
        z = v * H
        joint = noise.noise(V((u * 18.0, 0.3, seed))) * 1.6
        crack = max(0.0, noise.noise(V((u * 40.0, v * 3.0, seed + 3))) - 0.25) * 3.0
        wear = noise.noise(V((u * 9.0, v * 7.0, seed + 1)) + off) * 1.4 + noise.noise(V((u * 30.0, v * 22.0, seed + 2))) * 0.5
        d = recess(u, v) + joint + wear + crack
        return centre + out * d + V((0, 0, z + noise.noise(V((u * 5.0, v * 4.0, seed + 5))) * 0.8))

    grid = [[pos(i / NU, j / NV) for i in range(NU + 1)] for j in range(NV + 1)]
    bands = {}
    for j in range(NV):
        z = (j + 0.5) / NV * H
        k = 0
        for n, (z0, z1, _b, _o) in enumerate(steps):
            if z <= z1:
                k = n
                break
        mat = 'cliff_warm' if k % 3 == 1 else 'cliff'
        if mat not in bands:
            bands[mat] = bmesh.new()
        bm = bands[mat]
        for i in range(NU):
            a, b, c, d = grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i]
            vs = [bm.verts.new(p) for p in (a, b, c, d)]
            # Facing the crater (toward -Y).
            bm.faces.new((vs[0], vs[1], vs[2], vs[3]))
    # Boulders at the foot.
    rocks = bmesh.new()
    for i in range(18):
        mid = rng.uniform(-span / 2, span / 2)
        out = V((math.sin(mid), math.cos(mid), 0))
        centre = V((R * math.sin(mid), -R + R * math.cos(mid), 0))
        boulder(rocks, centre - out * rng.uniform(0.5, 5.0) + V((0, 0, 0.3)), (rng.uniform(1.2, 3.0), rng.uniform(1.0, 2.6), rng.uniform(0.8, 1.8)), seed * 100 + i)
    bands['cliff'] = bands.get('cliff', bmesh.new())
    for mat, bm in list(bands.items()) + [('cliff', rocks)]:
        o = kit.part(f'{name}_{mat}_{id(bm)}', bm, mat)
        for mod in list(o.modifiers):
            o.modifiers.remove(mod)
        for p in o.data.polygons:
            p.use_smooth = False
    export(os.path.join(OUT, f'valley-{name}.glb'))


# --- Buildings -----------------------------------------------------------------

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
                p.use_smooth = name in ('glass', 'lantern', 'metal')
        self.b = {}


def beam(bm, a, b, w, h=None):
    """A square timber from a to b."""
    a, b = V(a), V(b)
    d = b - a
    rot = d.normalized().to_track_quat('Z', 'Y').to_matrix()
    kit.box(bm, (a + b) / 2, (w, h or w, d.length), rot)


def log(bm, a, b, r, sides=8):
    kit.cylinder(bm, a, b, r, sides)


def deck(m, x0, x1, y0, y1, z, along='x', board=0.26, thick=0.08, mat='planks'):
    """Boards with a hair of gap between them, on joists."""
    if along == 'x':
        y = y0
        while y < y1 - 0.01:
            w = min(board, y1 - y)
            kit.box(m(mat), ((x0 + x1) / 2, y + w / 2, z - thick / 2), (x1 - x0, w - 0.02, thick))
            y += w
        for x in [x0 + 0.1, (x0 + x1) / 2, x1 - 0.1]:
            kit.box(m('beam'), (x, (y0 + y1) / 2, z - thick - 0.1), (0.14, y1 - y0, 0.2))
    else:
        x = x0
        while x < x1 - 0.01:
            w = min(board, x1 - x)
            kit.box(m(mat), (x + w / 2, (y0 + y1) / 2, z - thick / 2), (w - 0.02, y1 - y0, thick))
            x += w
        for y in [y0 + 0.1, (y0 + y1) / 2, y1 - 0.1]:
            kit.box(m('beam'), ((x0 + x1) / 2, y, z - thick - 0.1), (x1 - x0, 0.14, 0.2))


def railing(m, pts, z, h=1.0, gap=None):
    """Posts every metre and a half along a polyline, a top rail and a mid
    rail; `gap` skips the run between two point indices (a stair's mouth)."""
    for i in range(len(pts) - 1):
        if gap and i == gap:
            continue
        a, b = V(pts[i]), V(pts[i + 1])
        n = max(1, int((b - a).length / 1.5))
        for k in range(n + 1):
            p = a.lerp(b, k / n)
            kit.box(m('beam'), (p.x, p.y, z + h / 2), (0.1, 0.1, h))
        beam(m('beam'), (a.x, a.y, z + h), (b.x, b.y, z + h), 0.09)
        beam(m('beam'), (a.x, a.y, z + h * 0.5), (b.x, b.y, z + h * 0.5), 0.05)


def stairs(m, x, y, z_top, direction, width=1.2, rail=True):
    """From (x, y) at deck height z_top down to the ground, going along
    `direction` (a unit 2D vector): treads, stringers, handrails, and an
    unseen ramp to walk on ('collide_only')."""
    d = V((direction[0], direction[1], 0)).normalized()
    side = V((-d.y, d.x, 0))
    steps = max(2, int(round(z_top / 0.2)))
    rise = z_top / steps
    run = 0.3
    top = V((x, y, z_top))
    for i in range(steps):
        c = top + d * (run * (i + 0.5)) - V((0, 0, rise * (i + 1) - 0.04))
        rot = Matrix.Rotation(math.atan2(d.y, d.x), 3, 'Z')
        kit.box(m('planks'), c, (run + 0.04, width, 0.07), rot)
    bottom = top + d * (run * steps) - V((0, 0, z_top))
    for sgn in (-1, 1):
        o = side * (sgn * (width / 2 + 0.04))
        beam(m('beam'), top + o - V((0, 0, 0.1)), bottom + o + V((0, 0, 0.05)), 0.08, 0.26)
        if rail:
            beam(m('beam'), top + o + V((0, 0, 0.95)), bottom + o + V((0, 0, 0.95)), 0.07)
            for k in range(0, steps + 1, 3):
                p = top.lerp(bottom, k / steps) + o
                kit.box(m('beam'), (p.x, p.y, p.z + 0.48), (0.08, 0.08, 0.95))
    # The ramp you actually walk on, from the top nose to the ground.
    a = top + d * 0.02
    b = bottom + d * 0.3
    mid = (a + b) / 2
    ln = (b - a).length
    rot = (b - a).normalized().to_track_quat('Y', 'Z').to_matrix()
    kit.box(m('collide_only'), mid, (width, ln, 0.06), rot)


def gable(m, cx, cy, w, d, h, over, pitch=0.55, mat='roof_tiles'):
    """A pitched roof over a w x d plan (ridge along y) whose walls stop at h."""
    ridge = h + (w / 2 + over) * pitch
    for side in (-1, 1):
        x0 = cx + side * (w / 2 + over)
        verts = [V((x0, cy - d / 2 - over, h - over * pitch)), V((x0, cy + d / 2 + over, h - over * pitch)),
                 V((cx, cy + d / 2 + over, ridge)), V((cx, cy - d / 2 - over, ridge))]
        bm = m(mat)
        vs = [bm.verts.new(v) for v in verts]
        f = bm.faces.new(vs)
        top = bmesh.ops.extrude_face_region(bm, geom=[f])
        moved = [e for e in top['geom'] if isinstance(e, bmesh.types.BMVert)]
        bmesh.ops.translate(bm, verts=moved, vec=(0, 0, 0.14))
    beam(m('beam'), (cx, cy - d / 2 - over, ridge + 0.1), (cx, cy + d / 2 + over, ridge + 0.1), 0.18)
    g = m('wood_siding')
    for y in (cy - d / 2, cy + d / 2):
        tri = [g.verts.new((cx - w / 2, y, h)), g.verts.new((cx + w / 2, y, h)), g.verts.new((cx, y, h + w / 2 * pitch))]
        g.faces.new(tri)
        g.faces.new(list(reversed([g.verts.new(v.co) for v in tri])))
    return ridge


def window(m, x, y, z, w, h, normal):
    """A lit window with a frame and a sill, on a wall facing `normal`."""
    n = V(normal)
    a = 0.0 if abs(n.y) > 0.5 else math.pi / 2
    rot = Matrix.Rotation(a, 3, 'Z')
    p = V((x, y, z)) + n * 0.03
    kit.box(m('window_glow'), p, (w, 0.05, h), rot)
    for dz in (-h / 2 - 0.06, h / 2 + 0.06):
        kit.box(m('beam'), p + n * 0.04 + V((0, 0, dz)), (w + 0.3, 0.1, 0.12), rot)
    for dx in (-1, 1):
        o = (V((dx * (w / 2 + 0.06), 0, 0)) if a == 0.0 else V((0, dx * (w / 2 + 0.06), 0)))
        kit.box(m('beam'), p + n * 0.04 + o, (0.1, 0.1, h + 0.2), rot)
    kit.box(m('beam'), (p + n * 0.1) - V((0, 0, h / 2 + 0.14)), (w + 0.4, 0.22, 0.07), rot)


def dish(m, at, r=0.7):
    at = V(at)
    beam(m('metal_dark'), at, at + V((0, 0, 1.4)), 0.07)
    kit.lathe(m('metal'), [(0.05, 0.0), (r * 0.5, 0.08), (r, 0.3)], segments=14, at=at + V((0, 0, 1.4)), axis='Z', cap_start=True, cap_end=False)
    beam(m('metal_dark'), at + V((0, 0, 1.45)), at + V((0, 0, 1.9)), 0.03)


def lantern_hang(m, at):
    at = V(at)
    beam(m('cable'), at, at - V((0, 0, 0.35)), 0.02)
    kit.box(m('metal_dark'), at - V((0, 0, 0.42)), (0.24, 0.24, 0.05))
    kit.sphere(m('lantern'), at - V((0, 0, 0.58)), 0.11, 8)
    kit.box(m('metal_dark'), at - V((0, 0, 0.74)), (0.2, 0.2, 0.04))


def stilt_house(name, two_floors, seed):
    kit.reset()
    rng = random.Random(seed)
    m = Mats()
    H0 = 2.6                    # deck height
    X0, X1, Y0, Y1 = -5.0, 5.0, -4.0, 4.2
    # Stilts, braced.
    for x in (X0 + 0.3, 0.0, X1 - 0.3):
        for y in (Y0 + 0.3, Y1 - 0.3):
            log(m('bark'), (x, y, -0.6), (x, y, H0 - 0.1), 0.2)
    for y in (Y0 + 0.3, Y1 - 0.3):
        beam(m('beam'), (X0 + 0.3, y, 0.4), (0.0, y, H0 - 0.4), 0.1)
        beam(m('beam'), (X1 - 0.3, y, 0.4), (0.0, y, H0 - 0.4), 0.1)
    deck(m, X0, X1, Y0, Y1, H0)
    # The house: from y = -1 back, on the deck.
    hx0, hx1, hy0, hy1 = -3.6, 3.6, -1.0, 3.8
    wall_h = 3.0
    kit.box(m('wood_siding'), ((hx0 + hx1) / 2, (hy0 + hy1) / 2, H0 + wall_h / 2), (hx1 - hx0, hy1 - hy0, wall_h))
    for x in (hx0, hx1):
        for y in (hy0, hy1):
            kit.box(m('beam'), (x, y, H0 + wall_h / 2), (0.28, 0.28, wall_h + 0.05))
    kit.box(m('beam'), ((hx0 + hx1) / 2, hy0 - 0.03, H0 + 0.1), (hx1 - hx0 + 0.2, 0.16, 0.2))
    # Door, windows.
    kit.box(m('beam'), (-1.0, hy0 - 0.06, H0 + 1.05), (1.0, 0.1, 2.1))
    kit.box(m('metal_dark'), (-0.65, hy0 - 0.13, H0 + 1.0), (0.07, 0.05, 0.07))
    window(m, 1.6, hy0, H0 + 1.6, 1.2, 1.0, (0, -1, 0))
    for y in (0.4, 2.6):
        window(m, hx1, y, H0 + 1.6, 1.0, 0.9, (1, 0, 0))
        window(m, hx0, y, H0 + 1.6, 1.0, 0.9, (-1, 0, 0))
    top = H0 + wall_h
    if two_floors:
        # A second storey set back, its own roof; a shed roof over the front.
        ux0, ux1, uy0, uy1 = -2.6, 2.2, 0.4, 3.8
        kit.box(m('wood_siding'), ((ux0 + ux1) / 2, (uy0 + uy1) / 2, top + 1.3), (ux1 - ux0, uy1 - uy0, 2.6))
        for x in (ux0, ux1):
            for y in (uy0, uy1):
                kit.box(m('beam'), (x, y, top + 1.3), (0.24, 0.24, 2.65))
        window(m, -0.2, uy0, top + 1.4, 1.4, 0.9, (0, -1, 0))
        window(m, ux1, 2.1, top + 1.4, 0.9, 0.8, (1, 0, 0))
        ridge = gable(m, (ux0 + ux1) / 2, (uy0 + uy1) / 2, ux1 - ux0, uy1 - uy0, top + 2.6, 0.5, pitch=0.7)
        kit.box(m('roof_tiles'), ((hx0 + hx1) / 2, -0.4, top + 0.05), (hx1 - hx0 + 0.8, 1.6, 0.12), Matrix.Rotation(0.2, 3, 'X'))
        kit.box(m('roof_tiles'), ((hx0 + hx1) / 2, 3.0, top + 0.02), (hx1 - hx0 + 0.6, 1.8, 0.1))
        chim = (ux0 + 0.6, uy1 - 0.6)
        chim_top = ridge + 1.0
    else:
        ridge = gable(m, (hx0 + hx1) / 2, (hy0 + hy1) / 2, hx1 - hx0, hy1 - hy0, top, 0.6, pitch=0.62)
        chim = (hx0 + 0.7, hy1 - 0.8)
        chim_top = ridge + 0.8
    kit.box(m('stone'), (chim[0], chim[1], (H0 + chim_top) / 2), (0.9, 0.9, chim_top - H0))
    kit.box(m('stone'), (chim[0], chim[1], chim_top + 0.1), (1.1, 1.1, 0.2))
    dish(m, (hx1 - 0.8, hy1 - 0.6, ridge - 0.9 if not two_floors else top + 0.1), 0.65 + rng.uniform(0, 0.2))
    # The porch: its roof on two posts, a railing round the deck, the stair.
    for x in (X0 + 0.4, X1 - 0.4):
        kit.box(m('beam'), (x, Y0 + 0.25, H0 + 1.5), (0.2, 0.2, 3.0))
    beam(m('beam'), (X0 + 0.4, Y0 + 0.25, H0 + 3.0), (X1 - 0.4, Y0 + 0.25, H0 + 3.0), 0.2)
    if not two_floors:
        kit.box(m('roof_tiles'), (0, (Y0 + hy0) / 2 - 0.1, H0 + 3.05), (X1 - X0 + 0.4, hy0 - Y0 + 0.9, 0.1), Matrix.Rotation(0.18, 3, 'X'))
    edge = [(X0 + 1.4, Y0), (X0, Y0), (X0, Y1), (X1, Y1), (X1, Y0), (X0 + 2.7, Y0)]
    railing(m, edge, H0, gap=None)
    stairs(m, X0 + 2.05, Y0, H0, (0, -1), width=1.2)
    for x in (X0 + 0.6, X1 - 0.6):
        lantern_hang(m, (x, Y0 + 0.4, H0 + 2.95))
    # A bench on the porch, crates and a barrel under the deck, firewood.
    kit.box(m('planks'), (2.6, Y0 + 0.6, H0 + 0.45), (2.0, 0.45, 0.08))
    for x in (1.8, 3.4):
        kit.box(m('beam'), (x, Y0 + 0.6, H0 + 0.22), (0.1, 0.4, 0.44))
    for i in range(3):
        kit.box(m('planks'), (X1 - 1.2 - i * 0.9, Y1 - 1.0, 0.4 + (i % 2) * 0.0), (0.8, 0.8, 0.8))
    kit.cylinder(m('beam'), (X0 + 1.0, Y1 - 1.0, 0.0), (X0 + 1.0, Y1 - 1.0, 1.0), 0.35, 10)
    for i in range(4):
        for j in range(3 - i % 2):
            y = Y0 + 1.4 + j * 0.34
            log(m('bark'), (hx1 + 0.4, y, H0 + 0.2 + i * 0.3), (hx1 + 1.3, y, H0 + 0.2 + i * 0.3), 0.15, 7)
    m.done(name)


def launch_tower():
    """A timber derrick 30 m tall, braced on every face, a deck on top big
    enough for the Kestrel (19 m square), struts out to its edges; beside it
    (toward -Y, the village) the lift's own shaft, the deck reaching over it
    with a hatch the car comes up through."""
    kit.reset()
    m = Mats()
    T = 30.0
    SY = -11.0                      # the lift shaft's centre (y)

    def leg(x, y, z):
        k = z / T
        return V((x * (3.2 - 1.2 * k), y * (3.2 - 1.2 * k), z))
    corners = [(-1, -1), (1, -1), (1, 1), (-1, 1)]
    for c in corners:
        beam(m('beam'), leg(c[0], c[1], -0.5), leg(c[0], c[1], T), 0.42)
    z = 0.0
    while z < T - 0.1:
        z1 = min(z + 3.0, T)
        for i in range(4):
            a, b = corners[i], corners[(i + 1) % 4]
            beam(m('beam'), leg(a[0], a[1], z1), leg(b[0], b[1], z1), 0.24)
            beam(m('beam'), leg(a[0], a[1], z), leg(b[0], b[1], z1), 0.14)
            beam(m('beam'), leg(b[0], b[1], z), leg(a[0], a[1], z1), 0.14)
        z = z1
    # Struts from the legs out to the deck's edges.
    for c in corners:
        for k in (0, 1):
            tip = V((c[0] * 9.2, c[1] * 9.2, T - 0.25)) if k == 0 else V((c[0] * (9.2 if c[0] else 0), c[1] * 9.2, T - 0.25))
            beam(m('beam'), leg(c[0], c[1], T - 7.0), V((c[0] * 9.0, c[1] * 2.0 * (1 - k) + c[1] * 9.0 * k, T - 0.25)), 0.2)
    for x in (-9.0, 9.0):
        beam(m('beam'), (x, -9.4, T - 0.25), (x, 9.4, T - 0.25), 0.26)
    for y in (-9.4, 9.4):
        beam(m('beam'), (-9.0, y, T - 0.25), (9.0, y, T - 0.25), 0.26)
    # The deck, and its arm over the lift shaft with the hatch.
    deck(m, -9.5, 9.5, -9.6, 9.5, T + 0.2, along='y')
    deck(m, -3.2, -1.3, -12.6, -9.6, T + 0.2, along='y')
    deck(m, 1.3, 3.2, -12.6, -9.6, T + 0.2, along='y')
    kit.box(m('planks'), (0, -12.45, T + 0.16), (2.6, 0.3, 0.08))
    edge = [(-3.2, -9.6), (-9.5, -9.6), (-9.5, 9.5), (9.5, 9.5), (9.5, -9.6), (3.2, -9.6)]
    railing(m, edge, T + 0.2, h=1.1)
    railing(m, [(-1.3, -9.6), (-3.2, -9.6), (-3.2, -12.6), (-1.3, -12.6)], T + 0.2, h=1.1)
    railing(m, [(1.3, -9.6), (3.2, -9.6), (3.2, -12.6), (1.3, -12.6)], T + 0.2, h=1.1)
    railing(m, [(-1.3, -12.6), (1.3, -12.6)], T + 0.2, h=1.1)
    # The Kestrel's cradle: two ember rails along the deck.
    for x in (-1.8, 1.8):
        kit.box(m('paint_ember'), (x, -0.5, T + 0.32), (0.5, 9.0, 0.24))
    for c in corners:
        p = V((c[0] * 9.3, c[1] * 9.3, T + 0.2))
        beam(m('beam'), p, p + V((0, 0, 2.8)), 0.16)
        kit.sphere(m('lantern'), p + V((0, 0, 2.95)), 0.18, 8)
    beam(m('metal_dark'), V((9.3, 9.3, T + 2.9)), V((9.3, 9.3, T + 5.2)), 0.06)
    kit.cylinder(m('paint_ember'), (9.3, 9.3, T + 5.0), (10.6, 9.3, T + 4.8), 0.25, 8, r2=0.1)
    # The lift shaft: four posts, braced, rails for the car.
    for x, y in ((-1.2, SY - 1.2), (1.2, SY - 1.2), (1.2, SY + 1.2), (-1.2, SY + 1.2)):
        beam(m('beam'), (x, y, -0.4), (x, y, T + 0.1), 0.26)
    z = 0.0
    while z < T - 0.1:
        z1 = min(z + 4.0, T)
        for (ax, ay), (bx, by) in (((-1.2, SY - 1.2), (-1.2, SY + 1.2)), ((1.2, SY - 1.2), (1.2, SY + 1.2)), ((-1.2, SY + 1.2), (1.2, SY + 1.2))):
            beam(m('beam'), (ax, ay, z1), (bx, by, z1), 0.16)
            beam(m('beam'), (ax, ay, z), (bx, by, z1), 0.1)
        z = z1
    for x in (-1.08, 1.08):
        kit.box(m('metal_dark'), (x, SY, T / 2), (0.08, 0.12, T))
    beam(m('beam'), (-1.2, SY + 1.2, T - 4.0), leg(-1, -1, T - 6.0), 0.18)
    beam(m('beam'), (1.2, SY + 1.2, T - 4.0), leg(1, -1, T - 6.0), 0.18)
    beam(m('beam'), (-1.2, SY + 1.2, 10.0), leg(-1, -1, 9.0), 0.18)
    beam(m('beam'), (1.2, SY + 1.2, 10.0), leg(1, -1, 9.0), 0.18)
    # The landing at the foot of the shaft, a ramp up to it, lamps.
    deck(m, -1.6, 1.6, SY - 2.6, SY + 1.4, 0.32, along='y')
    kit.box(m('collide_only'), (0.0, SY - 3.4, 0.12), (1.8, 1.6, 0.06), Matrix.Rotation(0.2, 3, 'X'))
    for x in (-1.5, 1.5):
        beam(m('beam'), (x, SY - 2.5, 0), (x, SY - 2.5, 2.8), 0.14)
        lantern_hang(m, (x, SY - 2.75, 2.8))
    m.done('tower2')


def lift():
    """The lift's car: a deck with a rail each side and a lamp overhead,
    open front and back (on at the foot, off toward the ship at the top)."""
    kit.reset()
    m = Mats()
    deck(m, -1.0, 1.0, -1.0, 1.0, 0.1, along='y')
    for x in (-1.0, 1.0):
        railing(m, [(x, -1.0), (x, 1.0)], 0.1, h=1.05)
        beam(m('metal_dark'), (x, 0.0, 1.15), (x, 0.0, 2.5), 0.06)
    beam(m('metal_dark'), (-1.0, 0.0, 2.5), (1.0, 0.0, 2.5), 0.06)
    kit.sphere(m('lantern'), (0.0, 0.0, 2.3), 0.1, 8)
    kit.box(m('paint_ember'), (0.9, -0.6, 1.0), (0.12, 0.18, 0.26))
    m.done('lift')


def observatory():
    """A drum of stone with a glass dome, a great telescope out through it,
    a balcony round the dome's foot, steps to the door; inside, a floor for
    the exhibits."""
    kit.reset()
    m = Mats()
    R = 8.5
    WALL = 4.2
    segs = 36
    door = 3
    for k in range(segs):
        a = -math.pi / 2 + 2 * math.pi * (k + 0.5) / segs
        if k < door // 2 + 1 or k >= segs - (door - door // 2):
            continue
        rot = Matrix.Rotation(a + math.pi / 2, 3, 'Z')
        kit.box(m('stone'), (math.cos(a) * R, math.sin(a) * R, 1.2), (2 * math.pi * R / segs * 1.05, 0.7, 1.2), rot)
        kit.box(m('wood_siding'), (math.cos(a) * R, math.sin(a) * R, 1.8 + (WALL - 1.2) / 2), (2 * math.pi * R / segs * 1.05, 0.55, WALL - 1.2), rot)
        if k % 3 == 0:
            kit.box(m('beam'), (math.cos(a) * (R + 0.3), math.sin(a) * (R + 0.3), WALL / 2 + 0.9), (0.28, 0.28, WALL), rot)
        if k % 6 == 3:
            window(m, math.cos(a) * (R + 0.28), math.sin(a) * (R + 0.28), 2.9, 1.0, 1.1, (math.cos(a), math.sin(a), 0)) if False else None
    kit.lathe(m('stone'), [(R + 0.6, 0.0), (R + 0.6, 0.6), (0.0, 0.6)], segments=segs, axis='Z', cap_start=True, cap_end=False)
    # Lintel over the door and a timber band round the drum's top.
    kit.box(m('beam'), (0, -R, WALL + 0.35), (3.0, 0.8, 0.5))
    kit.lathe(m('beam'), [(R + 0.4, WALL + 0.5), (R + 0.4, WALL + 0.9), (R - 0.4, WALL + 0.9), (R - 0.4, WALL + 0.5)], segments=segs, axis='Z')
    # The dome: ribs and glass.
    base = WALL + 0.9
    prof = []
    for i in range(13):
        t = (math.pi / 2) * i / 12
        prof.append((R * math.cos(t), base + R * 0.85 * math.sin(t)))
    kit.lathe(m('dome_glass'), prof, segments=segs, axis='Z', cap_start=False, cap_end=False)
    for k in range(12):
        a = 2 * math.pi * k / 12
        pts = [V((math.cos(a) * r, math.sin(a) * r, z)) for r, z in prof]
        for p0, p1 in zip(pts, pts[1:]):
            beam(m('metal_dark'), p0, p1, 0.16)
    for j in (4, 8):
        r, z = prof[j]
        kit.lathe(m('metal_dark'), [(r + 0.08, z - 0.08), (r + 0.08, z + 0.08)], segments=segs, axis='Z', cap_start=False, cap_end=False)
    # The telescope: on a pier in the middle, out through the dome.
    kit.cylinder(m('stone'), (0, 0, 0.6), (0, 0, 3.4), 0.9, 12)
    pivot = V((0, 0.6, 4.4))
    d = V((0.2, -0.55, 0.81)).normalized()
    kit.cylinder(m('metal'), pivot - d * 2.5, pivot + d * 9.5, 0.75, 16, r2=0.9)
    kit.cylinder(m('paint_ember'), pivot + d * 9.2, pivot + d * 9.8, 0.98, 16)
    kit.cylinder(m('metal_dark'), pivot - d * 2.6, pivot - d * 2.2, 0.85, 16)
    kit.sphere(m('metal_dark'), pivot, 0.9, 12)
    # The balcony round the dome's foot, its railing, stairs up to it.
    kit.lathe(m('planks'), [(R + 1.8, base - 0.05), (R + 1.8, base + 0.05), (R + 0.3, base + 0.05), (R + 0.3, base - 0.05)], segments=segs, axis='Z')
    for k in range(24):
        a = 2 * math.pi * k / 24
        p = V((math.cos(a) * (R + 1.7), math.sin(a) * (R + 1.7), base))
        kit.box(m('beam'), p + V((0, 0, 0.5)), (0.1, 0.1, 1.0))
        q = V((math.cos(a) * (R + 1.75), math.sin(a) * (R + 1.75), base - 1.9))
        beam(m('beam'), q, p - V((0, 0, 0.05)) + (q - p).normalized() * 0.0 - V((math.cos(a), math.sin(a), 0)) * 1.2, 0.12)
    kit.lathe(m('beam'), [(R + 1.7, base + 1.0), (R + 1.7, base + 1.08)], segments=segs, axis='Z', cap_start=False, cap_end=False)
    # Steps up to the door (and its ramp), a lamp each side, a sign board.
    for i in range(4):
        kit.box(m('stone'), (0, -R - 1.0 - i * 0.4, 0.45 - i * 0.15), (3.4, 0.45, 0.3))
    kit.box(m('collide_only'), (0, -R - 1.6, 0.32), (3.2, 2.2, 0.06), Matrix.Rotation(-0.3, 3, 'X'))
    for x in (-2.2, 2.2):
        beam(m('beam'), (x, -R - 1.2, 0), (x, -R - 1.2, 2.8), 0.14)
        lantern_hang(m, (x, -R - 1.45, 2.8))
    kit.box(m('planks'), (0, -R - 0.42, WALL + 1.4), (3.4, 0.12, 0.8))
    m.done('observatory2')


def exhibit():
    """A museum stand: a post and a slanted plaque."""
    kit.reset()
    m = Mats()
    kit.box(m('beam'), (0, 0, 0.5), (0.18, 0.18, 1.0))
    kit.box(m('beam'), (0, 0, 0.04), (0.6, 0.6, 0.08))
    kit.box(m('planks'), (0, -0.05, 1.08), (0.8, 0.5, 0.05), Matrix.Rotation(-0.6, 3, 'X'))
    kit.box(m('paint_bone'), (0, -0.07, 1.1), (0.66, 0.36, 0.02), Matrix.Rotation(-0.6, 3, 'X'))
    m.done('exhibit')


def signpost():
    kit.reset()
    m = Mats()
    log(m('bark'), (0, 0, -0.3), (0, 0, 2.9), 0.09, 7)
    for i, (z, a) in enumerate(((2.5, 0.3), (2.05, 2.6), (1.6, -1.2))):
        rot = Matrix.Rotation(a, 3, 'Z')
        d = rot @ V((1, 0, 0))
        kit.box(m('planks'), V((0, 0, z)) + d * 0.65, (1.2, 0.06, 0.3), rot)
        tip = V((0, 0, z)) + d * 1.3
        kit.box(m('planks'), tip, (0.22, 0.06, 0.22), rot @ Matrix.Rotation(math.pi / 4, 3, 'Y'))
    m.done('signpost')


def lamp2():
    kit.reset()
    m = Mats()
    log(m('bark'), (0, 0, -0.3), (0, 0, 3.0), 0.09, 7)
    beam(m('beam'), (0, 0, 2.9), (0.0, -0.75, 2.95), 0.08)
    beam(m('beam'), (0, 0, 2.3), (0.0, -0.45, 2.92), 0.05)
    lantern_hang(m, (0, -0.72, 2.92))
    m.done('lamp2')


def dock():
    kit.reset()
    m = Mats()
    deck(m, -1.2, 1.2, -6.0, 0.0, 0.7, along='x')
    for y in (-5.8, -3.0, -0.2):
        for x in (-1.1, 1.1):
            log(m('bark'), (x, y, -2.0), (x, y, 0.65), 0.12, 7)
    m.done('dock')


def woodpile():
    kit.reset()
    m = Mats()
    rng = random.Random(4)
    for i in range(4):
        for j in range(5 - i):
            y = -0.9 + j * 0.36 + i * 0.18
            log(m('bark'), (-0.7, y, 0.18 + i * 0.31), (0.7 + rng.uniform(-0.1, 0.1), y, 0.18 + i * 0.31), 0.16, 7)
    for x in (-0.8, 0.8):
        kit.box(m('beam'), (x, -1.1, 0.6), (0.1, 0.1, 1.2))
        kit.box(m('beam'), (x, 0.9, 0.6), (0.1, 0.1, 1.2))
    m.done('woodpile')


def chair():
    """A rocking chair, for the fire."""
    kit.reset()
    m = Mats()
    for x in (-0.3, 0.3):
        pts = [V((x, -0.45 + 0.9 * i / 8, 0.06 + 0.12 * ((i / 8 - 0.5) * 2) ** 2)) for i in range(9)]
        for a, b in zip(pts, pts[1:]):
            beam(m('beam'), a, b, 0.05, 0.07)
        kit.box(m('beam'), (x, 0.0, 0.3), (0.05, 0.05, 0.4))
        kit.box(m('beam'), (x, 0.28, 0.75), (0.05, 0.05, 1.1), Matrix.Rotation(-0.18, 3, 'X'))
    kit.box(m('planks'), (0, 0.0, 0.48), (0.66, 0.55, 0.05))
    for i in range(4):
        kit.box(m('planks'), (0, 0.32 + i * 0.03, 0.7 + i * 0.18), (0.62, 0.04, 0.12), Matrix.Rotation(-0.18, 3, 'X'))
    m.done('chair')


def pier():
    """A pier 18 m long from the shore (y = 0) out over the water (+Y), its
    deck 1.1 m up, a T-shaped head at the far end; posts every 2.4 m with
    rope wrapped round their tops, cross-braced below; a ladder down into
    the water; a lantern on a hooked post at the head's corner; a net
    hanging over the rail. The deck's height is its origin (z = 0); the
    posts reach 3 m down."""
    kit.reset()
    m = Mats()
    rng = random.Random(8)
    W = 2.6
    L = 18.0
    deck(m, -W / 2, W / 2, 0.0, L, 0.0, along='x', board=0.24, thick=0.09)
    deck(m, -4.0, 4.0, L, L + 4.2, 0.0, along='x', board=0.24, thick=0.09)
    posts = []
    y = 0.6
    while y < L:
        posts += [(-W / 2 - 0.05, y), (W / 2 + 0.05, y)]
        y += 2.4
    for x in (-4.0, -1.4, 1.4, 4.0):
        posts += [(x, L + 0.1), (x, L + 4.1)]
    for x, y in posts:
        h = 0.55 + rng.uniform(-0.05, 0.15)
        log(m('bark'), (x, y, -3.2), (x, y, h), 0.13, 8)
        kit.cylinder(m('beam'), (x, y, h), (x, y, h + 0.05), 0.15, 8)
        for k in range(3):
            kit.cylinder(m('rope'), (x, y, h - 0.12 - k * 0.07), (x, y, h - 0.07 - k * 0.07), 0.155, 10)
    # Cross-bracing under the deck, between each pair of posts.
    y = 0.6
    while y < L - 2.4:
        for sx in (-1, 1):
            beam(m('beam'), (sx * (W / 2 + 0.05), y, -0.25), (sx * (W / 2 + 0.05), y + 2.4, -1.6), 0.08)
        beam(m('beam'), (-W / 2, y, -0.3), (W / 2, y, -1.5), 0.08)
        y += 2.4
    # A rail down the head's left side; the ladder; the lantern post at the
    # right; the net over the rail.
    railing(m, [(4.0, L + 0.1), (4.0, L + 4.2)], 0.0, h=0.9)
    for k in range(5):
        kit.box(m('beam'), (2.6, L + 4.25, -0.4 - k * 0.32), (0.6, 0.06, 0.05))
    for x in (2.33, 2.87):
        beam(m('beam'), (x, L + 4.25, 0.9), (x, L + 4.25, -2.2), 0.06)
    beam(m('beam'), (-3.9, L + 0.3, 0.0), (-3.9, L + 0.3, 3.4), 0.18)
    beam(m('beam'), (-3.9, L + 0.3, 3.3), (-3.9, L + 1.2, 3.3), 0.12)
    beam(m('beam'), (-3.9, L + 0.3, 2.8), (-3.9, L + 0.8, 3.3), 0.07)
    lantern_hang(m, (-3.9, L + 1.1, 3.24))
    # The net: a sagging mesh over the left rail.
    for i in range(13):
        a = V((4.02, L + 0.6 + i * 0.25, 0.9))
        b = a + V((0.25, 0.0, -0.8 + 0.15 * math.sin(i * 0.9)))
        beam(m('rope'), a, b, 0.012)
    for k in range(5):
        pts = [V((4.02 + 0.05 * k, L + 0.6 + i * 0.25, 0.9 - 0.16 * k + 0.04 * math.sin(i * 0.9 + k))) for i in range(13)]
        for a, b in zip(pts, pts[1:]):
            beam(m('rope'), a, b, 0.012)
    m.done('pier')


def rowboat():
    """A wooden rowboat, 4 m, two thwarts, oars shipped."""
    kit.reset()
    m = Mats()
    prof = []
    for i in range(9):
        t = i / 8
        y = -2.0 + 4.0 * t
        w = 0.72 * math.sin(math.pi * (0.06 + 0.88 * t)) ** 0.6
        prof.append((y, w))
    rings_out, rings_in = [], []
    for y, w in prof:
        rings_out.append([V((-w, y, 0.55)), V((-w * 0.8, y, 0.12)), V((0, y, 0.0)), V((w * 0.8, y, 0.12)), V((w, y, 0.55))])
        rings_in.append([V((w - 0.05, y, 0.55)), V((w * 0.75, y, 0.17)), V((0, y, 0.07)), V((-w * 0.75, y, 0.17)), V((-w + 0.05, y, 0.55))])
    bm = m('boat_paint')
    for ring_set in (rings_out, rings_in):
        vs = [[bm.verts.new(p) for p in r] for r in ring_set]
        for a, b in zip(vs, vs[1:]):
            for i in range(4):
                bm.faces.new((a[i], a[i + 1], b[i + 1], b[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    for y, w in prof:
        kit.box(m('planks'), (0, y, 0.56), (w * 2 + 0.08, 0.1, 0.05))
    for y in (-0.6, 0.6):
        kit.box(m('planks'), (0, y, 0.38), (1.2, 0.26, 0.05))
    for sx in (-1, 1):
        beam(m('beam'), (sx * 0.4, -0.2, 0.42), (sx * 0.2, 1.6, 0.48), 0.04)
        kit.box(m('beam'), (sx * 0.2, 1.75, 0.48), (0.12, 0.35, 0.02))
    kit.box(m('rope'), (0, 1.9, 0.6), (0.08, 0.08, 0.08))
    m.done('rowboat')


def ropecoil():
    kit.reset()
    m = Mats()
    for k in range(5):
        kit.lathe(m('rope'), [(0.3 - k * 0.02, 0.0 + k * 0.045), (0.3 - k * 0.02, 0.045 + k * 0.045), (0.2 - k * 0.02, 0.045 + k * 0.045), (0.2 - k * 0.02, k * 0.045)], segments=16, axis='Z')
    m.done('ropecoil')


def export_named(name):
    export(os.path.join(OUT, f'valley-{name}.glb'))

os.makedirs(OUT, exist_ok=True)
jobs = {
    'pine_a': lambda: pine('pine_a', 24.0, 1),
    'pine_b': lambda: pine('pine_b', 30.0, 2, slim=0.8),
    'pine_c': lambda: pine('pine_c', 19.0, 3, slim=1.15),
    'pine_far': pine_far,
    'cliff_a': lambda: cliff('cliff_a', 5),
    'cliff_b': lambda: cliff('cliff_b', 9),
    'house_a': lambda: (stilt_house('house_a', False, 1), export_named('house_a')),
    'house_b': lambda: (stilt_house('house_b', True, 2), export_named('house_b')),
    'tower2': lambda: (launch_tower(), export_named('tower2')),
    'lift': lambda: (lift(), export_named('lift')),
    'observatory2': lambda: (observatory(), export_named('observatory2')),
    'exhibit': lambda: (exhibit(), export_named('exhibit')),
    'signpost': lambda: (signpost(), export_named('signpost')),
    'lamp2': lambda: (lamp2(), export_named('lamp2')),
    'dock': lambda: (dock(), export_named('dock')),
    'woodpile': lambda: (woodpile(), export_named('woodpile')),
    'chair': lambda: (chair(), export_named('chair')),
    'pier': lambda: (pier(), export_named('pier')),
    'rowboat': lambda: (rowboat(), export_named('rowboat')),
    'ropecoil': lambda: (ropecoil(), export_named('ropecoil')),
}
for name, fn in jobs.items():
    if ONLY and name not in ONLY:
        continue
    fn()
print('valley: done', OUT)
