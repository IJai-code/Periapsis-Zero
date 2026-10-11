"""Foliage cards: the textures every plant in the game is made of.

    blender -b --factory-startup --python art/godot/foliage_cards.py -- game/art/foliage

Real leaves (ambientCG CC0 leaf scans, unpacked into art/sources by
scripts/godot-sync.mjs) are arranged in 3D on twigs, stems and fronds, lit,
and rendered straight on with a transparent background: a twig cluster, a
dense cluster, a fern, a palm frond and a hanging vine. A tree in the game
is a trunk and branches carrying a hundred or so of these cards, the way
open-world games build forests: the depth and shading in each card are real.
"""
import math
import os
import random
import sys

import bpy
from mathutils import Euler, Vector as V

OUT = sys.argv[sys.argv.index('--') + 1]
SRC = os.path.join(os.path.dirname(__file__), '..', 'sources', 'ambientcg')
os.makedirs(OUT, exist_ok=True)

# Each leaf set is a grid of single leaves, stem down: (columns, rows).
ATLAS = {'LeafSet004': (3, 2), 'LeafSet001': (3, 2), 'LeafSet020': (5, 1)}


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    _leaf_mats.clear()
    s = bpy.context.scene
    s.render.engine = 'CYCLES'
    s.cycles.device = 'CPU'
    s.cycles.samples = 32
    s.cycles.use_denoising = True
    s.render.film_transparent = True
    s.view_settings.view_transform = 'Standard'
    s.render.image_settings.file_format = 'PNG'
    s.render.image_settings.color_mode = 'RGBA'
    w = bpy.data.worlds.new('w')
    w.use_nodes = True
    w.node_tree.nodes['Background'].inputs['Color'].default_value = (0.75, 0.82, 0.9, 1)
    w.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.9
    s.world = w
    sun = bpy.data.lights.new('sun', 'SUN')
    sun.energy = 3.2
    o = bpy.data.objects.new('sun', sun)
    s.collection.objects.link(o)
    o.rotation_euler = Euler((math.radians(-50), math.radians(20), 0))


_leaf_mats = {}


def leaf_material(atlas, cell, tint):
    key = (atlas, cell, tint)
    if key in _leaf_mats:
        return _leaf_mats[key]
    m = bpy.data.materials.new(f'{atlas}_{cell}_{tint}')
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes['Principled BSDF']
    col = nt.nodes.new('ShaderNodeTexImage')
    col.image = bpy.data.images.load(os.path.join(SRC, atlas, f'{atlas}_2K-JPG_Color.jpg'), check_existing=True)
    alpha = nt.nodes.new('ShaderNodeTexImage')
    alpha.image = bpy.data.images.load(os.path.join(SRC, atlas, f'{atlas}_2K-JPG_Opacity.jpg'), check_existing=True)
    alpha.image.colorspace_settings.name = 'Non-Color'
    # Pick the cell: a mapping node scales and offsets the UVs.
    cols, rows = ATLAS[atlas]
    uv = nt.nodes.new('ShaderNodeTexCoord')
    mp = nt.nodes.new('ShaderNodeMapping')
    mp.inputs['Scale'].default_value = (1.0 / cols, 1.0 / rows, 1)
    mp.inputs['Location'].default_value = ((cell % cols) / cols, (cell // cols) / rows, 0)
    nt.links.new(uv.outputs['UV'], mp.inputs['Vector'])
    nt.links.new(mp.outputs['Vector'], col.inputs['Vector'])
    nt.links.new(mp.outputs['Vector'], alpha.inputs['Vector'])
    mul = nt.nodes.new('ShaderNodeVectorMath')
    mul.operation = 'MULTIPLY'
    nt.links.new(col.outputs['Color'], mul.inputs[0])
    mul.inputs[1].default_value = tint
    nt.links.new(mul.outputs['Vector'], bsdf.inputs['Base Color'])
    nt.links.new(alpha.outputs['Color'], bsdf.inputs['Alpha'])
    bsdf.inputs['Roughness'].default_value = 0.55
    _leaf_mats[key] = m
    return m


def bark_material():
    m = bpy.data.materials.get('twig') or bpy.data.materials.new('twig')
    m.use_nodes = True
    m.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.16, 0.11, 0.07, 1)
    return m


def leaf(at, size, rot, atlas, cell, tint):
    """One leaf: a quad with its stem at `at`, pointing along its local +Y."""
    me = bpy.data.meshes.new('leaf')
    h = size
    w = size * 0.75
    verts = [(-w / 2, 0, 0), (w / 2, 0, 0), (w / 2, 0, h), (-w / 2, 0, h)]
    me.from_pydata(verts, [], [(0, 1, 2, 3)])
    uvl = me.uv_layers.new()
    for i, uv in enumerate([(0, 0), (1, 0), (1, 1), (0, 1)]):
        uvl.data[i].uv = uv
    me.materials.append(leaf_material(atlas, cell, tint))
    o = bpy.data.objects.new('leaf', me)
    bpy.context.collection.objects.link(o)
    o.location = at
    o.rotation_euler = rot
    return o


def twig(a, b, r):
    d = b - a
    bpy.ops.mesh.primitive_cylinder_add(vertices=6, radius=r, depth=d.length, location=(a + b) / 2)
    o = bpy.context.active_object
    o.rotation_euler = d.to_track_quat('Z', 'Y').to_euler()
    o.data.materials.append(bark_material())
    return o


def camera(w, h, centre):
    cam = bpy.data.cameras.new('cam')
    cam.type = 'ORTHO'
    cam.ortho_scale = max(w, h)
    o = bpy.data.objects.new('cam', cam)
    bpy.context.collection.objects.link(o)
    o.location = (centre[0], -5.0, centre[1])
    o.rotation_euler = Euler((math.radians(90), 0, 0))
    s = bpy.context.scene
    s.camera = o
    px = 1024
    s.render.resolution_x = int(px * (w / max(w, h)))
    s.render.resolution_y = int(px * (h / max(w, h)))


def render(name):
    path = os.path.join(OUT, name + '.png')
    bpy.context.scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    bleed(path)
    print('card:', name)


def bleed(path):
    """Fill the see-through pixels with the leaves' own average colour, so
    the smaller mip levels fade to green at the edges rather than black."""
    import numpy as np
    img = bpy.data.images.load(path)
    w, h = img.size
    px = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    px = px.reshape(-1, 4)
    solid = px[:, 3] > 0.5
    if solid.any():
        mean = px[solid, :3].mean(axis=0) * 0.8
        clear = px[:, 3] < 0.02
        px[clear, 0:3] = mean
    img.pixels.foreach_set(px.ravel())
    img.filepath_raw = path
    img.file_format = 'PNG'
    img.save()


GREENS = [(0.82, 1.0, 0.78), (0.62, 0.86, 0.58), (1.0, 1.0, 0.85), (0.55, 0.75, 0.5)]


def broad(rng):
    """A leafy twig cluster, about a metre across: big leaves on forked twigs."""
    reset()
    tips = []
    base = V((0, 0, 0.02))
    for k in range(5):
        a = math.radians(-60 + k * 30 + rng.uniform(-8, 8))
        mid = base + V((math.sin(a) * 0.25, rng.uniform(-0.05, 0.05), 0.25 + math.cos(a) * 0.15))
        end = mid + V((math.sin(a) * 0.3, rng.uniform(-0.1, 0.1), 0.22 + rng.uniform(0, 0.15)))
        twig(base, mid, 0.008)
        twig(mid, end, 0.006)
        tips.append((mid, end))
    for mid, end in tips:
        for i in range(30):
            t = 0.15 + 0.85 * i / 29
            at = mid.lerp(end, t) + V((rng.uniform(-0.03, 0.03), rng.uniform(-0.04, 0.04), rng.uniform(-0.03, 0.03)))
            rot = Euler((math.radians(rng.uniform(-35, 35)), math.radians(rng.uniform(-150, 150)), math.radians(rng.uniform(-30, 30))))
            leaf(at, rng.uniform(0.14, 0.2), rot, 'LeafSet004', rng.randrange(6), rng.choice(GREENS))
    camera(1.0, 1.0, (0, 0.5))
    render('broad')


def dense(rng):
    """A dense mass of small leaves: canopy filler."""
    reset()
    for i in range(650):
        r = math.sqrt(rng.random()) * 0.44
        a = rng.uniform(0, math.tau)
        at = V((math.cos(a) * r, rng.uniform(-0.15, 0.15), 0.5 + math.sin(a) * r * 0.9))
        rot = Euler((math.radians(rng.uniform(-50, 50)), math.radians(rng.uniform(0, 360)), math.radians(rng.uniform(-40, 40))))
        leaf(at, rng.uniform(0.09, 0.13), rot, 'LeafSet001', rng.randrange(6), rng.choice(GREENS))
    camera(1.0, 1.0, (0, 0.5))
    render('dense')


def frond(origin, direction, length, leaflets, size, atlas, cell_range, rng, droop=0.3):
    """A rachis with paired leaflets, curving down toward its tip."""
    pts = []
    p = origin.copy()
    d = direction.normalized()
    step = length / 12
    for i in range(13):
        pts.append(p.copy())
        d = (d + V((0, 0, -droop * 0.08))).normalized()
        p = p + d * step
    for i in range(12):
        twig(pts[i], pts[i + 1], 0.006 * (1.0 - i / 14))
    for k in range(leaflets):
        t = (k + 1) / (leaflets + 1)
        i = min(11, int(t * 12))
        at = pts[i].lerp(pts[i + 1], t * 12 - i)
        along = (pts[i + 1] - pts[i]).normalized()
        heading = math.atan2(along.x, along.z)
        s = size * (1.0 - 0.6 * abs(t - 0.35))
        for side in (-1, 1):
            rot = Euler((math.radians(rng.uniform(-20, 20)), heading + side * math.radians(rng.uniform(55, 75)), 0))
            leaf(at, s, rot, atlas, rng.choice(cell_range), rng.choice(GREENS))
    return pts


def fern(rng):
    """A fern: fronds springing from the ground and arching over."""
    reset()
    for k in range(8):
        a = math.radians(-70 + k * 20 + rng.uniform(-6, 6))
        d = V((math.sin(a), rng.uniform(-0.3, 0.3), math.cos(a) * 1.2))
        frond(V((0, 0, 0.02)), d, rng.uniform(0.42, 0.55), 16, 0.07, 'LeafSet020', range(5), rng, droop=0.5)
    camera(1.1, 0.75, (0, 0.33))
    render('fern')


def palm(rng):
    """One palm frond, horizontal, its leaflets hanging from both sides."""
    reset()
    pts = []
    p = V((-0.95, 0, 0.0))
    d = V((1, 0, 0.18)).normalized()
    for i in range(25):
        pts.append(p.copy())
        d = (d + V((0, 0, -0.012))).normalized()
        p = p + d * 0.078
    for i in range(24):
        twig(pts[i], pts[i + 1], 0.012 * (1.0 - i / 26))
    for i in range(1, 24):
        for side in (-1, 1):
            n = 1.0 - abs(i - 8) / 17
            # Long thin leaflets drooping down and back along the frond.
            rot = Euler((math.radians(side * 28 + rng.uniform(-8, 8)), math.radians(180 - 40 + rng.uniform(-10, 10)), 0))
            o = leaf(pts[i], 0.28 + 0.42 * n, rot, 'LeafSet020', rng.randrange(5), rng.choice(GREENS))
            o.scale = (0.3, 1, 1)
    camera(2.0, 1.0, (0, -0.15))
    render('palm')


def vine(rng):
    """A hanging vine strand, two metres of stem with leaves."""
    reset()
    pts = []
    for i in range(30):
        z = 2.0 - i * 0.068
        pts.append(V((math.sin(i * 0.5) * 0.04 + math.sin(i * 0.17) * 0.06, 0, z)))
    for i in range(29):
        twig(pts[i], pts[i + 1], 0.006)
    for i in range(1, 29):
        for k in range(2):
            rot = Euler((math.radians(rng.uniform(-40, 40)), math.radians(rng.choice([-1, 1]) * rng.uniform(40, 140)), math.radians(rng.uniform(-20, 20))))
            leaf(pts[i] + V((0, 0, rng.uniform(-0.03, 0.03))), rng.uniform(0.07, 0.11), rot, 'LeafSet004', rng.randrange(6), rng.choice(GREENS))
    camera(0.5, 2.0, (0, 1.0))
    render('vine')


rng = random.Random(3091)
only = sys.argv[sys.argv.index('--') + 2:] if len(sys.argv) > sys.argv.index('--') + 2 else None
for fn in (broad, dense, fern, palm, vine):
    if not only or fn.__name__ in only:
        fn(random.Random({'broad': 1, 'dense': 2, 'fern': 3, 'palm': 4, 'vine': 5}[fn.__name__]))
