"""Sandstone pillars for the Wulingyuan valley, sculpted from code.

    blender -b --factory-startup --python art/godot/pillars.py -- game/art

Real quartz-sandstone pillars are cut by vertical joints into blocky
columns, banded by bedding planes that weather into ledges, undercut where
softer layers erode, and capped with soil and trees. Each variant here is a
dense cylinder (48 around, 140 up) pushed in and out by those features:
deep vertical fissures, ledges at the bedding planes, overhangs, rubble
noise, a rounded soil cap. 300 m tall, 25 m in radius; Godot scales them.
Writes game/art/pillar-<n>.glb, one material ("rock"); the shader puts
moss where the rock faces the sky.
"""
import math
import os
import random
import sys

import bmesh
import bpy
from mathutils import Vector as V, noise

OUT = sys.argv[sys.argv.index('--') + 1]
H = 300.0
R = 25.0
AROUND = 48
UP = 140


def pillar(seed):
    rng = random.Random(seed)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    off = V((seed * 17.3, seed * 5.1, seed * 9.7))
    # The joints: angles where the column is split, each with a depth.
    joints = [(rng.uniform(0, math.tau), rng.uniform(0.12, 0.28), rng.uniform(0.04, 0.09)) for _ in range(rng.randint(5, 8))]
    # Bedding planes: heights where a ledge steps out above a softer band.
    beds = sorted(rng.uniform(0.08, 0.92) for _ in range(rng.randint(6, 10)))
    bm = bmesh.new()
    rows = []
    for j in range(UP + 1):
        t = j / UP
        y = t * H
        row = []
        for k in range(AROUND):
            a = math.tau * k / AROUND
            r = 1.0
            for ja, depth, width in joints:
                d = abs((a - ja + math.pi) % math.tau - math.pi)
                # The joint wanders a little as it climbs.
                d = abs(d + 0.03 * math.sin(t * 9.0 + ja * 3.0))
                r -= depth * max(0.0, 1.0 - d / width) ** 1.6
            for b in beds:
                dy = (t - b) * H
                if -9.0 < dy < 0.0:
                    r -= 0.07 * math.sin(math.pi * -dy / 9.0)       # the soft band under it
                elif 0.0 <= dy < 2.5:
                    r += 0.05                                        # the ledge
            p = V((math.cos(a) * 2.0, math.sin(a) * 2.0, t * 14.0)) + off
            r += 0.09 * noise.noise(p) + 0.05 * noise.noise(p * 3.1) + 0.025 * noise.noise(p * 8.3)
            # Flared foot, rounded crown.
            r *= 1.0 + 0.25 * max(0.0, 1.0 - t / 0.08) ** 2
            if t > 0.93:
                r *= math.sqrt(max(0.0, 1.0 - ((t - 0.93) / 0.07) ** 2)) * 0.85 + 0.15
            r = max(0.25, r)
            row.append(bm.verts.new((math.cos(a) * r * R, math.sin(a) * r * R, y)))
        rows.append(row)
    for j in range(UP):
        for k in range(AROUND):
            k2 = (k + 1) % AROUND
            bm.faces.new((rows[j][k], rows[j][k2], rows[j + 1][k2], rows[j + 1][k]))
    top = bm.verts.new((0, 0, H * 1.005))
    for k in range(AROUND):
        bm.faces.new((rows[UP][k], rows[UP][(k + 1) % AROUND], top))
    bm.normal_update()
    me = bpy.data.meshes.new('pillar')
    bm.to_mesh(me)
    bm.free()
    me.materials.append(bpy.data.materials.new('rock'))
    for p in me.polygons:
        p.use_smooth = True
    o = bpy.data.objects.new('pillar', me)
    bpy.context.collection.objects.link(o)
    path = os.path.join(OUT, f'pillar-{seed}.glb')
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_yup=True, export_apply=True,
                              export_cameras=False, export_lights=False, export_animations=False)
    print('pillar:', path)


for s in range(4):
    pillar(s)
