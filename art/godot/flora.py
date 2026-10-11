"""The plants of Earth's wild valleys, built from the foliage cards.

    blender -b --factory-startup --python art/godot/flora.py -- game/art

Each species is a trunk and branches (bark) carrying leaf cards (the
textures art/godot/foliage_cards.py renders). Card normals point out from
the crown's centre, so a crown shades as one rounded mass, lit on the sun
side, dark beneath, the way real foliage reads from a distance. Writes
game/art/flora-<species>.glb; Godot gives the materials their textures by
name (bark, leaf_broad, leaf_dense, leaf_fern, leaf_palm, leaf_vine).
"""
import math
import os
import random
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector as V

OUT = sys.argv[sys.argv.index('--') + 1]


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def mat(name):
    return bpy.data.materials.get(name) or bpy.data.materials.new(name)


def obj(name, bm, material):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    me.materials.append(mat(material))
    o = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(o)
    return o


# --- Wood ---------------------------------------------------------------------

def tube(bm, uv, path, radii, sides=8, flute=0.0, flutes=5):
    """A tapered tube along `path` (points), bark-mapped: u round, v along."""
    rings = []
    length = 0.0
    for i, p in enumerate(path):
        d = (path[min(i + 1, len(path) - 1)] - path[max(i - 1, 0)]).normalized()
        side = d.cross(V((0, 0, 1)))
        if side.length < 0.1:
            side = d.cross(V((1, 0, 0)))
        side.normalize()
        up = side.cross(d).normalized()
        if i > 0:
            length += (p - path[i - 1]).length
        ring = []
        for k in range(sides + 1):
            a = math.tau * k / sides
            r = radii[i] * (1.0 + flute * max(0.0, math.cos(a * flutes)) ** 3)
            ring.append((bm.verts.new(p + (side * math.cos(a) + up * math.sin(a)) * r), k / sides, length / 2.5))
        rings.append(ring)
    for i in range(len(rings) - 1):
        for k in range(sides):
            a, b = rings[i][k], rings[i][k + 1]
            c, d = rings[i + 1][k + 1], rings[i + 1][k]
            f = bm.faces.new((a[0], b[0], c[0], d[0]))
            for loop, src in zip(f.loops, (a, b, c, d)):
                loop[uv].uv = (src[1] * 2.0, src[2])


def curve(start, direction, length, bend, steps, rng, wobble=0.15):
    pts = [start.copy()]
    p = start.copy()
    d = direction.normalized()
    for i in range(steps):
        d = (d + bend / steps + V((rng.uniform(-1, 1), rng.uniform(-1, 1), rng.uniform(-0.3, 0.3))) * wobble / steps).normalized()
        p = p + d * (length / steps)
        pts.append(p.copy())
    return pts


# --- Leaves -------------------------------------------------------------------

def cards(name, material, placements, centre):
    """Quads for leaf cards. Each placement: (anchor, width, height, basis,
    pivot): pivot 'base' hangs the card from its bottom middle (twig cards),
    'centre' centres it (clusters). Normals point away from `centre`."""
    me = bpy.data.meshes.new(name)
    verts, faces, uvs = [], [], []
    for at, w, h, basis, pivot in placements:
        x = basis @ V((w / 2, 0, 0))
        z = basis @ V((0, 0, h))
        o = at - (z / 2 if pivot == 'centre' else V())
        base = len(verts)
        verts += [o - x, o + x, o + x + z, o - x + z]
        faces.append((base, base + 1, base + 2, base + 3))
        uvs += [(0, 0), (1, 0), (1, 1), (0, 1)]
    me.from_pydata([tuple(v) for v in verts], [], faces)
    uvl = me.uv_layers.new()
    for i, uv in enumerate(uvs):
        uvl.data[i].uv = uv
    me.materials.append(mat(material))
    normals = []
    for poly in me.polygons:
        for li in poly.loop_indices:
            v = me.vertices[me.loops[li].vertex_index].co
            n = (V(v) - centre)
            n.z = n.z * 0.8 + abs(n.length) * 0.35
            normals.append(n.normalized())
    for p in me.polygons:
        p.use_smooth = True
    me.normals_split_custom_set(normals)
    o = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(o)
    return o


def basis_facing(rng, tilt=(10, 70)):
    """A random card orientation: any heading, tipped back by `tilt` degrees."""
    yaw = rng.uniform(0, math.tau)
    pitch = math.radians(rng.uniform(*tilt))
    return Matrix.Rotation(yaw, 3, 'Z') @ Matrix.Rotation(-pitch, 3, 'X')


# --- Species ------------------------------------------------------------------

def broadleaf(rng, height, crown_r, crown_h, n_broad, n_dense, buttress=False, card=3.0):
    """A jungle tree: a trunk (fluted into buttresses at the foot for the
    giants), branches spreading into the crown, cards along them."""
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new()
    trunk_top = height - crown_h * 0.55
    trunk = curve(V((0, 0, -0.5)), V((rng.uniform(-0.08, 0.08), rng.uniform(-0.08, 0.08), 1)), trunk_top + 0.5, V((0, 0, 0)), 6, rng, 0.25)
    base_r = height * 0.035
    radii = [base_r * (1.0 - 0.55 * i / 6) for i in range(7)]
    radii[0] *= 1.6 if buttress else 1.2
    tube(bm, uv, trunk, radii, sides=10 if buttress else 7, flute=0.9 if buttress else 0.15, flutes=5)
    tips = []
    top = trunk[-1]
    n_branch = 6 if buttress else 5
    for b in range(n_branch):
        a = math.tau * b / n_branch + rng.uniform(-0.3, 0.3)
        out = V((math.cos(a), math.sin(a), rng.uniform(0.35, 0.8)))
        start = trunk[rng.randint(4, 6)]
        br = curve(start, out, crown_r * rng.uniform(0.8, 1.05), V((0, 0, -0.25)), 3, rng, 0.3)
        tube(bm, uv, br, [radii[-1] * 0.7 * (1.0 - i / 4) + 0.03 for i in range(4)], sides=5)
        tips += br[1:]
        for s in range(2):
            j = rng.randint(1, 2)
            a2 = a + rng.uniform(-0.9, 0.9)
            sub = curve(br[j], V((math.cos(a2), math.sin(a2), rng.uniform(0.3, 1.0))), crown_r * 0.5, V((0, 0, -0.1)), 2, rng, 0.3)
            tube(bm, uv, sub, [radii[-1] * 0.3 * (1.0 - i / 3) + 0.02 for i in range(3)], sides=4)
            tips += sub[1:]
    wood = obj('wood', bm, 'bark')
    centre = V((0, 0, height - crown_h * 0.5))
    broad = []
    for i in range(n_broad):
        tip = rng.choice(tips)
        at = tip + V((rng.uniform(-1, 1), rng.uniform(-1, 1), rng.uniform(-0.3, 0.6))) * crown_r * 0.18
        s = card * rng.uniform(0.8, 1.2)
        broad.append((at, s, s, basis_facing(rng, (5, 55)), 'base'))
    dense = []
    for i in range(n_dense):
        # Fill the crown's shell, flattened, thicker on top.
        d = V((rng.gauss(0, 1), rng.gauss(0, 1), abs(rng.gauss(0, 0.8)))).normalized()
        at = centre + V((d.x * crown_r, d.y * crown_r, d.z * crown_h * 0.6)) * rng.uniform(0.55, 0.95)
        s = card * rng.uniform(1.0, 1.4)
        dense.append((at, s, s, basis_facing(rng, (0, 80)), 'centre'))
    cards('leaves', 'leaf_broad', broad, centre)
    cards('leaves_dense', 'leaf_dense', dense, centre)


def palm(rng):
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new()
    lean = V((rng.uniform(-0.3, 0.3), rng.uniform(-0.3, 0.3), 1))
    trunk = curve(V((0, 0, -0.4)), lean, 12.5, V((lean.x * 0.6, lean.y * 0.6, 0)), 7, rng, 0.1)
    tube(bm, uv, trunk, [0.32 - 0.02 * i for i in range(8)], sides=6)
    obj('wood', bm, 'bark')
    top = trunk[-1]
    fronds = []
    for k in range(13):
        a = math.tau * k / 13 + rng.uniform(-0.2, 0.2)
        droop = math.radians(rng.uniform(-15, 35))
        # The card's frond runs along its width from the left edge; hang it
        # from the crown, the frond out along `a`.
        rot = Matrix.Rotation(a, 3, 'Z') @ Matrix.Rotation(droop, 3, 'Y')
        w, h = 6.0, 3.0
        at = top + rot @ V((w / 2 - 0.3, 0, -h * 0.62))
        fronds.append((at, w, h, rot, 'base'))
    cards('fronds', 'leaf_palm', fronds, top + V((0, 0, -3.0)))


def fern(rng):
    fronds = []
    for k in range(7):
        rot = Matrix.Rotation(math.tau * k / 7 + rng.uniform(-0.2, 0.2), 3, 'Z') @ Matrix.Rotation(math.radians(rng.uniform(-15, 15)), 3, 'X')
        fronds.append((V((0, 0, -0.05)), 2.2, 1.5, rot, 'base'))
    cards('fern', 'leaf_fern', fronds, V((0, 0, -0.6)))


def shrub(rng):
    centre = V((0, 0, 1.0))
    dense = []
    for i in range(16):
        d = V((rng.gauss(0, 1), rng.gauss(0, 1), abs(rng.gauss(0, 1)))).normalized()
        dense.append((centre + d * rng.uniform(0.3, 0.9), 1.8, 1.8, basis_facing(rng, (0, 80)), 'centre'))
    broad = []
    for i in range(8):
        broad.append((V((rng.uniform(-0.4, 0.4), rng.uniform(-0.4, 0.4), 0.1)), 1.8, 1.8, basis_facing(rng, (10, 60)), 'base'))
    cards('shrub', 'leaf_dense', dense, centre - V((0, 0, 0.6)))
    cards('shrub_b', 'leaf_broad', broad, centre - V((0, 0, 0.6)))


def vine(rng):
    """A hanging curtain of vine, 18 m: strands in two crossed planes."""
    strands = []
    for k in range(5):
        x = rng.uniform(-1.5, 1.5)
        top = rng.uniform(-0.5, 0.5)
        for j in range(3):
            rot = Matrix.Rotation(math.radians(90 if k % 2 else 0) + rng.uniform(-0.2, 0.2), 3, 'Z')
            strands.append((V((x, 0, top - 6.0 * (j + 1))), 1.5, 6.0, rot, 'base'))
    cards('vine', 'leaf_vine', strands, V((0, 2, -9)))


def save(name):
    path = os.path.join(OUT, f'flora-{name}.glb')
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_yup=True, export_apply=True,
                              export_normals=True, export_cameras=False, export_lights=False, export_animations=False)
    print('flora:', path)


for name, build in [
    ('giant', lambda r: broadleaf(r, 30.0, 11.0, 12.0, 56, 36, buttress=True, card=5.2)),
    ('tree', lambda r: broadleaf(r, 15.0, 5.5, 8.0, 30, 22, card=3.7)),
    ('tree2', lambda r: broadleaf(r, 19.0, 6.5, 10.0, 36, 26, card=4.1)),
    ('palm', palm),
    ('fern', fern),
    ('shrub', shrub),
    ('vine', vine),
]:
    reset()
    build(random.Random(name))
    save(name)
