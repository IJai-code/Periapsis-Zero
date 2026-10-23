"""Crystal clusters, grown the way quartz grows: hexagonal prisms with
six-sided points, a few large ones and many small, sprouting from one
spot and fanning out within a cone, each a little tapered and turned.
Flat-shaded (the facets catch the light one by one); the game gives them
a crystal shader and stands them in a scanned boulder (Crystals).

    blender -b --factory-startup --python art/godot/crystals.py -- game/art

Writes game/art/crystals-a/b/c.glb, about 3 m tall, origin at the root.
"""
import math
import os
import random
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector as V

OUT = sys.argv[sys.argv.index('--') + 1]


def prism(bm, root, axis, r, length, tip, rng):
    """One crystal: a hexagonal prism from `root` along `axis`, `r` across,
    narrowing a little toward its six-sided point."""
    axis = axis.normalized()
    side = axis.cross(V((0, 0, 1)) if abs(axis.z) < 0.9 else V((1, 0, 0))).normalized()
    up2 = axis.cross(side)
    turn = rng.uniform(0, math.pi / 3)
    taper = rng.uniform(0.82, 0.95)
    ring0, ring1 = [], []
    for k in range(6):
        a = turn + k * math.pi / 3
        d = side * math.cos(a) + up2 * math.sin(a)
        # A face or two a little wider than the rest: real crystals are not
        # perfect hexagons.
        rr = r * rng.uniform(0.9, 1.1)
        ring0.append(bm.verts.new(root - axis * r * 0.5 + d * rr))
        ring1.append(bm.verts.new(root + axis * length + d * rr * taper))
    apex = bm.verts.new(root + axis * (length + tip))
    for k in range(6):
        j = (k + 1) % 6
        bm.faces.new((ring0[k], ring0[j], ring1[j], ring1[k]))
        bm.faces.new((ring1[k], ring1[j], apex))
    bm.faces.new(list(reversed(ring0)))


def cluster(name, seed):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    rng = random.Random(seed)
    me = bpy.data.meshes.new(name)
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    mat = bpy.data.materials.new('crystal')
    me.materials.append(mat)
    bm = bmesh.new()
    count = rng.randint(11, 17)
    for i in range(count):
        big = i < 3
        # Fanned out from the root within a cone, the big ones nearer upright.
        tilt = rng.uniform(0, 0.35 if big else 0.95)
        spin = rng.uniform(0, 2 * math.pi)
        axis = V((math.sin(tilt) * math.cos(spin), math.sin(tilt) * math.sin(spin), math.cos(tilt)))
        root = V((rng.uniform(-0.35, 0.35), rng.uniform(-0.35, 0.35), 0.0))
        r = rng.uniform(0.22, 0.34) if big else rng.uniform(0.06, 0.17)
        length = rng.uniform(1.6, 2.6) if big else rng.uniform(0.35, 1.3)
        prism(bm, root, axis, r, length, r * rng.uniform(1.4, 2.2), rng)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()
    for p in me.polygons:
        p.use_smooth = False
    path = os.path.join(OUT, f'{name}.glb')
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_yup=True, export_apply=True,
                              export_cameras=False, export_lights=False, export_animations=False)
    print(f'CRYSTAL {name}: {len(me.polygons)} faces')


cluster('crystals-a', 3)
cluster('crystals-b', 8)
cluster('crystals-c', 21)
