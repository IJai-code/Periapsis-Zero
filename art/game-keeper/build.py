"""The Keeper, for the game: one of the machines that kept the Engine. An
original design: no legs, no face. A tall dark spindle that hangs in the
air, a band of light where a head would be, two broken rings that turn
round it, and four long blades held close like folded hands.

    /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P art/game-keeper/build.py

Writes game/art/keeper/keeper.glb with separate nodes the game moves:
core, eye, ring_a, ring_b, blade_0..3. Origin at the foot of its hover
(the ground under it); +Y up in the game.
"""
import math
import os

import bpy

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "game", "art", "keeper")


def mat(name, color, metal, rough, emit=None, strength=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*color, 1.0)
    b.inputs["Metallic"].default_value = metal
    b.inputs["Roughness"].default_value = rough
    if emit:
        b.inputs["Emission Color"].default_value = (*emit, 1.0)
        b.inputs["Emission Strength"].default_value = strength
    return m


M = {}
GROUPS = {}


def add(group, o, m, smooth=True, bevel=0.0):
    o.data.materials.append(M[m])
    if bevel > 0.0:
        mod = o.modifiers.new("b", "BEVEL")
        mod.width = bevel
        mod.segments = 2
        mod.limit_method = "ANGLE"
    for p in o.data.polygons:
        p.use_smooth = smooth
    GROUPS.setdefault(group, []).append(o)
    return o


def cone(group, m, r1, r2, h, at, rot=(0, 0, 0), verts=8, smooth=False):
    bpy.ops.mesh.primitive_cone_add(radius1=r1, radius2=r2, depth=h, vertices=verts, location=at, rotation=rot)
    return add(group, bpy.context.object, m, smooth)


def box(group, m, size, at, rot=(0, 0, 0), bevel=0.01):
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=at, rotation=rot)
    o = bpy.context.object
    o.scale = size
    return add(group, o, m, False, bevel)


def arc(group, m, R, r, start, sweep, z, tilt=(0, 0, 0), seg=18):
    """A length of ring: boxes round a circle (a broken torus)."""
    for i in range(seg):
        a = start + sweep * (i + 0.5) / seg
        o = box(group, m, (R * sweep / seg * 1.04, r, r * 1.6), (math.cos(a) * R, math.sin(a) * R, z), (0, 0, a + math.pi / 2), bevel=0.004)
    return GROUPS[group]


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    M["shell"] = mat("keeper_shell", (0.035, 0.04, 0.05), 0.9, 0.28)
    M["bone"] = mat("keeper_bone", (0.5, 0.48, 0.42), 0.3, 0.5)
    M["eye"] = mat("keeper_eye", (0.5, 0.85, 1.0), 0.0, 0.3, (0.35, 0.8, 1.0), 5.0)
    M["vein"] = mat("keeper_vein", (0.2, 0.5, 0.6), 0.0, 0.3, (0.3, 0.75, 1.0), 1.6)
    os.makedirs(OUT, exist_ok=True)
    # The core: two long faceted cones base to base, a waist, a crown.
    cone("core", "shell", 0.34, 0.05, 1.5, (0, 0, 2.05), verts=7)
    cone("core", "shell", 0.05, 0.34, 1.0, (0, 0, 0.8), verts=7)
    cone("core", "bone", 0.36, 0.36, 0.05, (0, 0, 1.3), verts=7)
    # Veins of light down its facets.
    for i in range(7):
        a = math.tau * (i + 0.5) / 7
        box("core", "vein", (0.012, 0.012, 1.1), (math.cos(a) * 0.19, math.sin(a) * 0.19, 1.95), (0, 0, a), bevel=0.0)
    # The eye: a band of light under the crown, brightest toward the front (-Y).
    bpy.ops.mesh.primitive_torus_add(major_radius=0.13, minor_radius=0.035, major_segments=20, minor_segments=6, location=(0, 0, 2.52))
    add("eye", bpy.context.object, "eye")
    box("eye", "eye", (0.16, 0.03, 0.05), (0, -0.14, 2.52), bevel=0.0)
    # Two broken rings.
    arc("ring_a", "bone", 0.72, 0.035, 0.3, 4.6, 1.75)
    arc("ring_b", "shell", 0.56, 0.03, 2.0, 3.6, 1.1)
    # Four blades, each its own node, hinged at the waist.
    for k in range(4):
        a = math.tau * k / 4 + math.pi / 4
        g = "blade_%d" % k
        x, y = math.cos(a) * 0.46, math.sin(a) * 0.46
        cone(g, "shell", 0.07, 0.008, 1.5, (x, y, 0.95), (math.pi, 0, 0), verts=4)
        box(g, "bone", (0.05, 0.05, 0.12), (x, y, 1.66), (0, 0, a), bevel=0.006)
        box(g, "vein", (0.01, 0.01, 0.8), (x * 1.06, y * 1.06, 1.1), (0, 0, a), bevel=0.0)
    tris = 0
    bpy.ops.object.select_all(action="DESELECT")
    made = []
    for name, objs in GROUPS.items():
        bpy.ops.object.select_all(action="DESELECT")
        for o in objs:
            bpy.context.view_layer.objects.active = o
            for mod in list(o.modifiers):
                bpy.ops.object.modifier_apply(modifier=mod.name)
            o.select_set(True)
        bpy.context.view_layer.objects.active = objs[0]
        if len(objs) > 1:
            bpy.ops.object.join()
        o = bpy.context.object
        o.name = name
        bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
        # Each part's origin on the machine's axis at the waist, so the game
        # can turn rings and swing blades about it.
        bpy.context.scene.cursor.location = (0, 0, 1.3)
        bpy.ops.object.origin_set(type="ORIGIN_CURSOR")
        tris += sum(len(p.vertices) - 2 for p in o.data.polygons)
        made.append(o)
    for o in made:
        o.select_set(True)
    bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, "keeper.glb"), export_format="GLB", use_selection=True, export_apply=True, export_yup=True)
    print("KEEPER %d tris, nodes %s" % (tris, [o.name for o in made]))


main()
