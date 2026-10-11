"""Ruined towers for the drowned city, built from code.

    blender -b --factory-startup --python art/godot/ruins.py -- game/art

A concrete-frame tower two centuries abandoned: floor slabs on a grid of
columns, the facade's spandrel panels between them (the gaps are the
windows, so they have real depth), a quarter of the panels fallen, the top
floors broken off unevenly. 30 x 24 m, 150 m tall; Godot scales them.
Writes game/art/ruin-<n>.glb, one material ("concrete"); the shader grows
moss on every ledge and up from the waterline.
"""
import math
import os
import random
import sys

import bmesh
import bpy
from mathutils import Vector as V

OUT = sys.argv[sys.argv.index('--') + 1]
W, D, FLOOR = 30.0, 24.0, 3.6
FLOORS = 42


def box(bm, centre, size):
    m = bmesh.ops.create_cube(bm, size=1.0)
    for v in m['verts']:
        v.co = V((centre[0] + v.co.x * size[0], centre[1] + v.co.y * size[1], centre[2] + v.co.z * size[2]))


def tower(seed):
    rng = random.Random(seed)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bm = bmesh.new()
    cols_x = [-W / 2 + 0.4 + i * (W - 0.8) / 4 for i in range(5)]
    cols_y = [-D / 2 + 0.4 + i * (D - 0.8) / 3 for i in range(4)]
    # Where the top has broken away: each column line keeps a different height.
    top = {(i, j): FLOORS - rng.randint(0, 9) for i in range(5) for j in range(4)}
    for f in range(FLOORS):
        z = f * FLOOR
        # The slab, broken back at the top.
        if f < FLOORS - 9 or rng.random() < 0.55:
            cut = 0.0 if f < FLOORS - 9 else rng.uniform(0.0, 0.45)
            box(bm, (cut * W / 2, 0, z), (W * (1.0 - cut), D, 0.35))
        for i, x in enumerate(cols_x):
            for j, y in enumerate(cols_y):
                if f < top[(i, j)] and (i in (0, 4) or j in (0, 3) or f % 3 == 0):
                    box(bm, (x, y, z + FLOOR / 2), (0.75, 0.75, FLOOR))
        # Spandrel panels round the outside: the window rows are between.
        if f < FLOORS - 6:
            for side in range(4):
                along = cols_x if side < 2 else cols_y
                for k in range(len(along) - 1):
                    if rng.random() < 0.24:
                        continue
                    a, b = along[k], along[k + 1]
                    mid, span = (a + b) / 2, b - a - 0.75
                    if side < 2:
                        box(bm, (mid, (D / 2 + 0.15) * (1 if side == 0 else -1), z + 0.75), (span, 0.3, 1.2))
                    else:
                        box(bm, ((W / 2 + 0.15) * (1 if side == 2 else -1), mid, z + 0.75), (0.3, span, 1.2))
    me = bpy.data.meshes.new('ruin')
    bm.to_mesh(me)
    bm.free()
    me.materials.append(bpy.data.materials.new('concrete'))
    o = bpy.data.objects.new('ruin', me)
    bpy.context.collection.objects.link(o)
    path = os.path.join(OUT, f'ruin-{seed}.glb')
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_yup=True, export_apply=True,
                              export_cameras=False, export_lights=False, export_animations=False)
    print('ruin:', path)


for s in range(3):
    tower(s)
