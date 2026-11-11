"""The outpost kit, for the game: everything the explorer can build, and the
ore they build it from. One .glb per piece into game/art/outpost/.

    /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P art/game-outpost/build.py

Origins sit on the ground under each piece; +Y is up in the game. Materials
are plain glTF (no bake): painted hull, dark frame, orange trim, glass,
lights, rock and the three ores.
"""
import math
import os
import random

import bpy
from mathutils import Vector

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "game", "art", "outpost")


def mat(name, color, metal=0.0, rough=0.6, emit=None, strength=0.0, alpha=1.0):
    m = bpy.data.materials.get(name)
    if m:
        return m
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*color, 1.0)
    b.inputs["Metallic"].default_value = metal
    b.inputs["Roughness"].default_value = rough
    if emit:
        b.inputs["Emission Color"].default_value = (*emit, 1.0)
        b.inputs["Emission Strength"].default_value = strength
    if alpha < 1.0:
        b.inputs["Alpha"].default_value = alpha
        m.surface_render_method = "BLENDED"
    return m


def mats():
    return {
        "hull": mat("hull", (0.78, 0.76, 0.7), 0.1, 0.55),
        "dark": mat("dark", (0.07, 0.075, 0.085), 0.8, 0.45),
        "trim": mat("trim", (0.85, 0.33, 0.06), 0.2, 0.5),
        "glass": mat("glass", (0.12, 0.3, 0.42), 0.0, 0.08, (0.25, 0.6, 0.8), 0.6, 0.55),
        "warm": mat("warm", (1.0, 0.8, 0.5), 0.0, 0.4, (1.0, 0.72, 0.38), 2.2),
        "cool": mat("cool", (0.6, 0.9, 1.0), 0.0, 0.4, (0.45, 0.85, 1.0), 2.4),
        "rock": mat("rock", (0.16, 0.15, 0.14), 0.0, 0.95),
        "ferrite": mat("ferrite", (0.55, 0.3, 0.16), 0.9, 0.35, (0.9, 0.35, 0.08), 0.35),
        "lumen": mat("lumen", (0.3, 0.9, 0.95), 0.0, 0.15, (0.2, 0.9, 1.0), 2.2),
        "resin": mat("resin", (0.85, 0.6, 0.12), 0.0, 0.12, (1.0, 0.6, 0.1), 1.6),
    }


M = {}
PARTS = []


def done(o, m, bevel=0.0, smooth=False):
    o.data.materials.append(M[m])
    if bevel > 0.0:
        mod = o.modifiers.new("b", "BEVEL")
        mod.width = bevel
        mod.segments = 2
        mod.limit_method = "ANGLE"
    if smooth:
        for p in o.data.polygons:
            p.use_smooth = True
    PARTS.append(o)
    return o


def box(m, size, at, rot=(0, 0, 0), bevel=0.02):
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=at, rotation=rot)
    o = bpy.context.object
    o.scale = size
    return done(o, m, bevel)


def cyl(m, r, h, at, rot=(0, 0, 0), verts=20, r2=None, bevel=0.0):
    if r2 is None:
        bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=h, vertices=verts, location=at, rotation=rot)
    else:
        bpy.ops.mesh.primitive_cone_add(radius1=r, radius2=r2, depth=h, vertices=verts, location=at, rotation=rot)
    return done(bpy.context.object, m, bevel, True)


def ball(m, r, at, scale=(1, 1, 1), seg=20):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=r, segments=seg, ring_count=seg // 2, location=at)
    o = bpy.context.object
    o.scale = scale
    return done(o, m, 0.0, True)


def dome(m, r, at, squash=0.75):
    """The upper half of a sphere."""
    o = ball(m, r, at, (1, 1, squash), 28)
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.transform_apply(scale=True)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.bisect(plane_co=at, plane_no=(0, 0, 1), clear_inner=True, use_fill=True)
    bpy.ops.object.mode_set(mode="OBJECT")
    return o


def torus(m, R, r, at, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_torus_add(major_radius=R, minor_radius=r, major_segments=32, minor_segments=8, location=at, rotation=rot)
    return done(bpy.context.object, m, 0.0, True)


def stone(m, r, at, seed, squash=0.7, detail=2):
    rng = random.Random(seed)
    bpy.ops.mesh.primitive_ico_sphere_add(radius=r, subdivisions=detail, location=at)
    o = bpy.context.object
    for v in o.data.vertices:
        v.co *= 0.72 + rng.random() * 0.5
        v.co.z *= squash
    return done(o, m, 0.0, False)


def shard(m, r, h, at, tilt, turn):
    bpy.ops.mesh.primitive_cone_add(radius1=r, radius2=r * 0.15, depth=h, vertices=6, location=at, rotation=(tilt, 0, turn))
    o = bpy.context.object
    o.location = Vector(at) + o.matrix_world.to_3x3() @ Vector((0, 0, h * 0.4))
    return done(o, m, 0.0, False)


def legs(n, R, h, r=0.05, foot=0.14):
    for i in range(n):
        a = math.tau * i / n + math.pi / n
        x, y = math.cos(a) * R, math.sin(a) * R
        cyl("dark", r, h, (x, y, h / 2), verts=10)
        cyl("dark", foot, 0.04, (x, y, 0.02), verts=12)


def export(name):
    for o in PARTS:
        o.select_set(True)
    bpy.context.view_layer.objects.active = PARTS[0]
    for o in PARTS:
        bpy.context.view_layer.objects.active = o
        for mod in list(o.modifiers):
            bpy.ops.object.modifier_apply(modifier=mod.name)
    bpy.context.view_layer.objects.active = PARTS[0]
    bpy.ops.object.join()
    o = bpy.context.object
    o.name = name
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    tris = sum(len(p.vertices) - 2 for p in o.data.polygons)
    bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, name + ".glb"), export_format="GLB", use_selection=True, export_apply=True, export_yup=True)
    print("OUTPOST %s %d tris" % (name, tris))
    bpy.ops.object.delete()
    PARTS.clear()


def lamp():
    cyl("dark", 0.16, 0.06, (0, 0, 0.03), verts=14)
    cyl("dark", 0.035, 2.2, (0, 0, 1.1), verts=10)
    box("trim", (0.09, 0.09, 0.18), (0, 0, 0.5))
    cyl("dark", 0.14, 0.05, (0, 0, 2.2), verts=14)
    cyl("warm", 0.1, 0.26, (0, 0, 2.36), verts=14)
    cyl("dark", 0.16, 0.04, (0, 0, 2.51), verts=14, r2=0.05)
    for i in range(4):
        a = math.tau * i / 4
        cyl("dark", 0.008, 0.28, (math.cos(a) * 0.12, math.sin(a) * 0.12, 2.36), verts=6)
    export("lamp")


def beacon():
    legs(3, 0.55, 0.5, 0.04)
    cyl("hull", 0.3, 0.5, (0, 0, 0.62), verts=16, bevel=0.03)
    torus("trim", 0.31, 0.03, (0, 0, 0.62))
    box("dark", (0.2, 0.03, 0.26), (0, -0.3, 0.64))
    box("cool", (0.14, 0.01, 0.07), (0, -0.318, 0.7), bevel=0.0)
    cyl("dark", 0.05, 4.2, (0, 0, 2.95), verts=10, r2=0.025)
    for z in (1.6, 2.6, 3.6):
        torus("dark", 0.09, 0.015, (0, 0, z))
    for i in range(3):
        a = math.tau * i / 3
        cyl("dark", 0.008, 2.3, (math.cos(a) * 0.3, math.sin(a) * 0.3, 1.9), rot=(math.sin(a) * 0.27, -math.cos(a) * 0.27, 0), verts=5)
    cyl("dark", 0.12, 0.06, (0, 0, 5.05), verts=12)
    ball("cool", 0.16, (0, 0, 5.22))
    dishes = cyl("hull", 0.3, 0.1, (0.22, 0, 4.2), rot=(0, math.radians(70), 0), verts=16, r2=0.06)
    box("trim", (0.5, 0.02, 0.3), (-0.3, 0, 3.3))
    export("beacon")


def hab():
    R = 2.6
    cyl("dark", R + 0.25, 0.22, (0, 0, 0.11), verts=28, bevel=0.03)
    cyl("hull", R, 1.2, (0, 0, 0.8), verts=28)
    torus("trim", R + 0.01, 0.06, (0, 0, 1.4))
    dome("hull", R, (0, 0, 1.4), 0.6)
    # Ribs over the dome.
    for i in range(6):
        a = math.pi * i / 6
        o = torus("dark", R + 0.02, 0.045, (0, 0, 1.4), rot=(math.pi / 2, 0, a))
        o.scale = (1, 1, 1)
        o.scale.z = 1.0
    # The lock: a short tunnel with a lit doorway.
    box("hull", (1.5, 1.4, 2.1), (0, -R - 0.3, 1.2), bevel=0.08)
    box("dark", (1.7, 0.16, 2.3), (0, -R - 1.02, 1.25), bevel=0.04)
    box("warm", (1.0, 0.04, 1.75), (0, -R - 1.1, 1.1), bevel=0.0)
    box("dark", (1.9, 1.0, 0.1), (0, -R - 1.4, 0.2), rot=(math.radians(-8), 0, 0))
    box("trim", (1.74, 0.18, 0.12), (0, -R - 1.02, 2.42))
    # Windows round the wall.
    for i in range(7):
        a = math.tau * (i + 1.5) / 9 - math.pi / 2 + math.tau / 9
        x, y = math.cos(a) * (R + 0.02), math.sin(a) * (R + 0.02)
        box("dark", (0.9, 0.12, 0.62), (x, y, 0.95), rot=(0, 0, a + math.pi / 2), bevel=0.03)
        box("warm", (0.74, 0.14, 0.46), (x, y, 0.95), rot=(0, 0, a + math.pi / 2), bevel=0.0)
    # On the roof: a vent stack, a tank, an aerial.
    cyl("dark", 0.22, 0.5, (0.8, 0.6, 2.75), verts=12)
    cyl("dark", 0.28, 0.06, (0.8, 0.6, 3.02), verts=12)
    ball("trim", 0.42, (-1.0, 0.9, 2.45), (1, 1, 0.8))
    cyl("dark", 0.02, 1.8, (-0.2, -0.4, 3.7), verts=6)
    ball("cool", 0.06, (-0.2, -0.4, 4.62), seg=10)
    # Tanks against the wall.
    for s in (-1, 1):
        cyl("trim", 0.3, 1.3, (s * (R + 0.34), 0.5, 0.9), verts=14, bevel=0.05)
        cyl("dark", 0.05, 0.6, (s * (R + 0.1), 0.5, 1.5), rot=(0, math.pi / 2, 0), verts=8)
    export("hab")


def pad():
    R = 6.0
    cyl("dark", R, 0.3, (0, 0, 0.15), verts=8, bevel=0.06)
    cyl("hull", R - 0.5, 0.06, (0, 0, 0.32), verts=8)
    torus("trim", R - 1.4, 0.07, (0, 0, 0.35))
    o = torus("trim", 1.3, 0.07, (0, 0, 0.35))
    box("trim", (2.2, 0.3, 0.03), (0, 0, 0.36), bevel=0.0)
    box("trim", (0.3, 2.2, 0.03), (0, 0, 0.36), bevel=0.0)
    for i in range(8):
        a = math.tau * i / 8
        x, y = math.cos(a) * (R - 0.35), math.sin(a) * (R - 0.35)
        cyl("dark", 0.12, 0.2, (x, y, 0.4), verts=10)
        ball("cool" if i % 2 else "warm", 0.1, (x, y, 0.52), seg=10)
    # A service mast and a fuel cart at the edge.
    cyl("dark", 0.09, 3.4, (R - 0.3, 2.0, 1.9), verts=10)
    box("warm", (0.5, 0.12, 0.2), (R - 0.55, 2.0, 3.5))
    box("hull", (1.4, 0.9, 0.9), (-R + 1.0, -2.2, 0.85), bevel=0.08)
    cyl("trim", 0.36, 1.2, (-R + 1.0, -2.2, 1.55), rot=(0, math.pi / 2, 0), verts=14)
    box("dark", (1.5, 1.0, 0.12), (-R + 1.0, -2.2, 0.4))
    export("pad")


def extractor():
    legs(4, 0.95, 0.7, 0.06, 0.18)
    box("hull", (1.3, 1.3, 0.9), (0, 0, 1.1), bevel=0.08)
    box("dark", (1.36, 0.5, 0.5), (0, 0, 1.1), bevel=0.03)
    box("cool", (0.6, 1.38, 0.12), (0, 0, 1.3), bevel=0.0)
    torus("trim", 0.5, 0.05, (0, 0, 1.57))
    cyl("dark", 0.3, 1.5, (0, 0, 2.3), verts=14)
    cyl("trim", 0.36, 0.12, (0, 0, 3.0), verts=14)
    cyl("dark", 0.5, 0.1, (0, 0, 3.12), verts=14, r2=0.1)
    # The drill, down into the ground.
    cyl("dark", 0.16, 0.9, (0, 0, 0.35), verts=10, r2=0.3)
    cyl("ferrite", 0.3, 0.5, (0, 0, -0.1), verts=8, r2=0.02)
    # The hopper it fills.
    box("dark", (0.8, 0.7, 0.6), (1.15, 0, 0.42), bevel=0.05)
    box("trim", (0.84, 0.74, 0.08), (1.15, 0, 0.74), bevel=0.02)
    box("dark", (0.5, 0.2, 0.12), (0.75, 0, 0.95), rot=(0, math.radians(35), 0))
    export("extractor")


def deck():
    box("dark", (4.0, 4.0, 0.14), (0, 0, 0.93), bevel=0.03)
    box("hull", (3.8, 3.8, 0.04), (0, 0, 1.01), bevel=0.0)
    for x in (-1.5, -0.5, 0.5, 1.5):
        box("dark", (0.04, 3.8, 0.012), (x, 0, 1.035), bevel=0.0)
    for x in (-1.8, 1.8):
        for y in (-1.8, 1.8):
            box("dark", (0.16, 0.16, 0.9), (x, y, 0.45), bevel=0.02)
            box("dark", (0.34, 0.34, 0.05), (x, y, 0.025), bevel=0.01)
    box("trim", (4.02, 0.06, 0.08), (0, -1.99, 0.93))
    box("trim", (4.02, 0.06, 0.08), (0, 1.99, 0.93))
    for s in (-1, 1):
        box("dark", (0.05, 5.3, 0.05), (s * 1.8, 0, 0.45), rot=(math.radians(13 * s), 0, 0))
    export("deck")


def wall():
    box("dark", (4.0, 0.16, 0.14), (0, 0, 0.07), bevel=0.02)
    box("hull", (3.9, 0.1, 2.5), (0, 0, 1.36), bevel=0.02)
    box("dark", (4.0, 0.16, 0.12), (0, 0, 2.66), bevel=0.02)
    for x in (-1.95, 0, 1.95):
        box("dark", (0.14, 0.2, 2.7), (x, 0, 1.35), bevel=0.02)
    box("trim", (3.9, 0.12, 0.14), (0, 0, 1.0))
    for x in (-0.98, 0.98):
        box("dark", (1.2, 0.14, 0.8), (x, 0, 1.8), bevel=0.03)
        box("glass", (1.04, 0.06, 0.64), (x, 0, 1.8), bevel=0.0)
    export("wall")


def stairs():
    n = 6
    for i in range(n):
        box("hull", (1.4, 0.36, 0.05), (0, -1.8 + i * 0.36 + 0.18, (i + 1) * 1.0 / n - 0.025), bevel=0.01)
    for s in (-1, 1):
        box("dark", (0.06, 2.45, 0.16), (s * 0.72, -0.7, 0.45), rot=(math.atan2(1.0, 2.16), 0, 0), bevel=0.01)
        box("dark", (0.04, 2.45, 0.04), (s * 0.72, -0.7, 1.35), rot=(math.atan2(1.0, 2.16), 0, 0), bevel=0.0)
        for y, z in ((-1.7, 0.1), (0.3, 1.0)):
            box("dark", (0.04, 0.04, 0.95), (s * 0.72, y, z + 0.42), bevel=0.0)
    export("stairs")


def crate():
    box("hull", (1.0, 0.7, 0.6), (0, 0, 0.34), bevel=0.05)
    box("dark", (1.04, 0.74, 0.08), (0, 0, 0.5), bevel=0.02)
    for x in (-0.36, 0.36):
        box("trim", (0.1, 0.76, 0.64), (x, 0, 0.34), bevel=0.02)
    box("dark", (0.3, 0.04, 0.1), (0, -0.37, 0.4))
    box("cool", (0.1, 0.02, 0.04), (0.3, -0.36, 0.25), bevel=0.0)
    for x in (-0.4, 0.4):
        for y in (-0.25, 0.25):
            box("dark", (0.12, 0.12, 0.05), (x, y, 0.025), bevel=0.0)
    export("crate")


def ore(kind, seed):
    rng = random.Random(seed)
    stone("rock", 0.75, (0, 0, 0.18), seed, 0.6)
    stone("rock", 0.45, (0.6, 0.25, 0.1), seed + 1, 0.65)
    stone("rock", 0.38, (-0.5, -0.35, 0.08), seed + 2, 0.7)
    if kind == "ferrite":
        for i in range(7):
            a = rng.random() * math.tau
            d = rng.random() * 0.55
            stone("ferrite", 0.16 + rng.random() * 0.14, (math.cos(a) * d, math.sin(a) * d, 0.42 + rng.random() * 0.22), seed + 10 + i, 0.9, 1)
    else:
        for i in range(8 if kind == "lumen" else 6):
            a = rng.random() * math.tau
            d = rng.random() * 0.5
            h = 0.5 + rng.random() * (0.9 if kind == "lumen" else 0.4)
            shard(kind, 0.09 + rng.random() * 0.08, h, (math.cos(a) * d, math.sin(a) * d, 0.3), (rng.random() - 0.5) * 0.9, a)
        if kind == "resin":
            for i in range(4):
                a = rng.random() * math.tau
                ball("resin", 0.12 + rng.random() * 0.1, (math.cos(a) * 0.4, math.sin(a) * 0.4, 0.45 + rng.random() * 0.2), (1, 1, 1.3), 10)
    export("ore-" + kind)


def chunk(kind, seed):
    stone(kind, 0.09, (0, 0, 0), seed, 0.9, 1)
    export("chunk-" + kind)


def cutter():
    """The hand tool: held at the right of the view, pointing along -Z in
    the game (+Y here)."""
    cyl("dark", 0.028, 0.3, (0, 0.05, 0), rot=(math.pi / 2, 0, 0), verts=12)
    cyl("hull", 0.04, 0.16, (0, -0.02, 0), rot=(math.pi / 2, 0, 0), verts=12, bevel=0.005)
    torus("trim", 0.042, 0.008, (0, 0.07, 0), rot=(math.pi / 2, 0, 0))
    cyl("cool", 0.016, 0.04, (0, 0.215, 0), rot=(math.pi / 2, 0, 0), verts=10)
    for i in range(3):
        a = math.tau * i / 3
        box("dark", (0.008, 0.09, 0.02), (math.cos(a) * 0.03, 0.2, math.sin(a) * 0.03), rot=(0, -a, 0), bevel=0.0)
    box("dark", (0.035, 0.05, 0.13), (0, -0.07, -0.07), rot=(math.radians(-14), 0, 0), bevel=0.008)
    box("trim", (0.02, 0.03, 0.015), (0, -0.01, -0.045), bevel=0.0)
    box("cool", (0.03, 0.05, 0.006), (0, -0.03, 0.042), bevel=0.0)
    export("cutter")


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    M.update(mats())
    os.makedirs(OUT, exist_ok=True)
    lamp(); beacon(); hab(); pad(); extractor(); deck(); wall(); stairs(); crate(); cutter()
    for i, k in enumerate(("ferrite", "lumen", "resin")):
        ore(k, 40 + i * 7)
        chunk(k, 90 + i)


main()
